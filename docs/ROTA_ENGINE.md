# Rota engine

The engine builds a draft week of visits and suggests cover for absences. It follows
every must-have rule, keeps travel and mileage down, balances carers' hours, and
rewards continuity. **It only suggests; a coordinator approves before anything is
published.** Prototype code: [`../engine/`](../engine/).

## Inputs

| Input | Fields |
|---|---|
| Visits | Client, day, preferred start, time window (e.g. ±15 or ±30 min), duration, carers needed (1 or 2), required skills, locked carer (optional) |
| Clients | Location, commissioned hours per week, funder (council/private), gender preference, do-not-send carers, recent carers |
| Carers | Home location, availability blocks (including night shifts past midnight), skills, travel mode (car/foot/bus), contracted and maximum hours, DBS and training expiry |
| Absences | Annual leave, sickness, training, by day |
| Travel | Time and miles between every pair of locations, per travel mode |
| Settings | Pay rate, mileage rate, whether travel time is paid, weights for continuity and hours balance, rest after nights |

## Rules

| Rule | Type | Status |
|---|---|---|
| Carer available, not on annual leave or sick | Must | Built |
| DBS check and mandatory training current on the visit date | Must | Built |
| Required skills present (hoist, medication, nights) | Must | Built |
| Visit starts within its time window (±15/±30 min, set per visit) | Must | Built |
| Two different carers on double-up visits, starting together; each travels from and to their own places | Must | Built |
| Client's gender preference (e.g. no male carers) | Must | Built |
| Client's do-not-send list (carers not allowed to that client) | Must; may be **suggested** to the coordinator when it blocks a visit | Built |
| Client's safeguarding bar | Must; **never** suggested | Built |
| Weekly maximum hours | Must | Built |
| Sleep-ins (22:00 to 07:00 at the client's home); count towards carers' hours in full, as in CareLineLive (setting); sleep-in pay handled in payroll later | Must | Built |
| Rest after a sleep-in before the next shift (default 11 h, to confirm) | Must | Built |
| Late shift followed by an early shift | Allowed (Loidis) | — |
| Meal breaks on long shifts | Must | Not yet (policy to confirm) |
| Lowest cost of travel: paid travel time + mileage for drivers | Preference, **priority** (Loidis) | Built |
| Balanced hours: carers reach their target share, avoid going over. Loidis (decision 2026-11-16, `DECISIONS.md`) sets the target as an equal share of hours within each team; the weekly maximum is the hard limit | Preference, **priority** (Loidis) | Built |
| Same carers as recently (continuity) | Preference, tie-breaker | Built |

## How a run works

1. Take the week's visits (from each client's repeating pattern).
2. Keep locked visits as they are.
3. Solve each day as a vehicle routing problem with time windows (OR-Tools): each
   carer availability block is a "vehicle" starting and ending at home. The engine
   plans each carer's whole day at once, so the next visit is close to the last one.
4. Double-ups are solved in two passes: first find a plan, drop any half-filled
   double-ups, then polish with "both carers or neither".
5. Days run Monday to Sunday so weekly hours and rest after nights carry forward.
6. Output: each carer's route and timeline, travel time and miles, unfilled visits
   with reasons and the nearest carers who were busy, client and carer hours gaps,
   and unfilled carer-minutes by hour (where extra carers are needed).

## Costs the engine balances (pence, all settings)

- Travel time at the carer's pay rate (if travel time is paid)
- Mileage for drivers (default 45p per mile); walkers and bus users cost none
- Continuity penalty for a carer new to the client (small: Loidis puts travel and
  carers' hours first; on the same data this cut travel 8% and filled 2 more visits)
- Unused contracted time (paid anyway) and time beyond contract
- Moving a visit off its booked start: `shift_pence_per_min` pence per minute of difference (default 0, so any start inside the visit's window is free). Same units as the travel and hours costs above, so 15 means a 20-minute move costs the same as 300p of travel. A double-up is charged once; sickness-cover pins are not charged
- Changing a visit's carer: `change_pence_per_visit` pence for each carer slot filled by someone not in the visit's `current_carers` (default 0 = ignore the current allocation). Applied on the arcs into the visit's stop, the same way as the continuity penalty, so swapping one carer of a double-up costs one change. Visits with no current carers (unallocated) have no change cost.

### Two modes

- **New rota** (no `current_carers`, or `change_pence_per_visit` 0): plans the week from scratch.
- **Improve my rota** (`current_carers` set from the coordinator's allocation and `change_pence_per_visit` above 0): starts from the current allocation and changes a carer only when the saving in travel, hours balance or continuity beats the change cost. The report adds per visit `current_carers`, `carer_changed`, `time_changed` and a `change_reason` hint (`fills_unallocated`, `replaces_current`), and the metrics `visits_carer_changed`, `visits_time_changed_only` and `visits_unchanged`.

### Change classes (Improve my rota)

Each visit with carers gets a `change_class`:

- `carer`: the carers differ from `current_carers`, or the visit was unallocated. Also has `new_time_needed` (shift from the booked start beyond `arrival_tolerance_minutes`): false means "keep the booked time", true means "change the time to HH:MM".
- `time_with_change`: same carers, start shifted beyond the tolerance, and a carer on it gains or loses another visit that day (must be applied too).
- `time_note`: same carers, shifted beyond the tolerance, carer-day untouched (only fits the travel model).
- `time_within_tolerance`: same carers, shifted by no more than the tolerance (a note).
- `unchanged`.

Metrics: `changes_to_apply` = `carer` + `time_with_change`; also `time_notes`, `time_within_tolerance` and `carer_changes_new_time`.
- `arrival_tolerance_minutes` (default 0 = any shift counts): reporting only, the solver ignores it. In Improve my rota, a visit whose carer is unchanged and whose start differs from the booked start by no more than this is classed `time_within_tolerance` (a note, not a change to apply). Default value for the coordinator-facing tool is a placeholder to confirm.
- A very large penalty for any unfilled visit, so filling visits always comes first

## Sickness cover

Mark the carer absent, keep every other visit with its carer near its planned time,
and re-plan only the affected visits. The search starts from the existing plan, and a
planned visit is never dropped to cover someone else's (it would just move the problem
to another client). On made-up data, a carer with 13 visits off sick on Wednesday:
8 re-covered, 5 not covered (morning peak), 0 other visits changed.

## Unfilled visits

Each unfilled visit shows the reason, the nearest suitable carers and what kept them
busy, and any free carer blocked only by the client's do-not-send list ("possible if
you approve"). The coordinator decides; the engine never books them.

## Travel times

- Default (the estimate): straight-line distance times a road factor (1.35), at typical speeds per mode.
- Travel is pluggable (`loidis_rota/travel.py`): a `TravelProvider` gives minutes and miles for a pair of
  places and a mode. `problem.travel` holds it (default `EstimateTravel`; it is not part of the Problem
  JSON); the solver, the report and the scoring of a current rota all use it, so every plan being compared
  uses the same figures. `solve_week(..., travel=provider)` and `cover_absence(..., travel=provider)` set it
  for a call. `MatrixTravel(table)` holds precomputed car travel keyed by (from, to) place; a pair that is
  not in the table, and every other mode (walking, bus), falls back to the estimate.
- Road routing: a local OSRM server on public OpenStreetMap extracts (see `tools/routing/README.md`); the
  service builds the table and passes a `MatrixTravel` (see `service/README.md`). Live traffic is not used.

## Open questions

See [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md), section "Rota rules".
