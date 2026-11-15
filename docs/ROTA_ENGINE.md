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
| Sleep-ins (22:00 to 07:00 at the client's home); count towards hours as a setting (default 0) | Must | Built |
| Rest after a sleep-in before the next shift (default 11 h, to confirm) | Must | Built |
| Late shift followed by an early shift | Allowed (Loidis) | — |
| Meal breaks on long shifts | Must | Not yet (policy to confirm) |
| Lowest cost of travel: paid travel time + mileage for drivers | Preference, **priority** (Loidis) | Built |
| Balanced hours: carers reach their contracted share, avoid going over | Preference, **priority** (Loidis) | Built |
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

- Prototype: straight-line distance times a road factor, at typical speeds per mode.
- Next: road routing, either Google Maps (live traffic, paid per request) or a
  self-hosted OSRM server (free, no live traffic). Cache results between postcodes.

## Open questions

See [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md), section "Rota rules".
