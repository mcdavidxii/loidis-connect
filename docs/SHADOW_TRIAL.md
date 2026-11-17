# Shadow-mode trial: week 2026-11-16 to 2026-11-22

Status: engine runs done 2026-11-17; **awaiting the coordinator's review** (Decision 2 in
[`PLAN.md`](PLAN.md)). Nothing was written to CareLineLive, and nothing in this trial is
published or acted on: the engine only suggests.

This page holds aggregate numbers only. The data, plans and reports behind it are in
`data/private/trial/` (git-ignored). Scripts: [`../tools/shadow_trial/`](../tools/shadow_trial/README.md).

## Purpose

Run the engine on a real week of Loidis visits, and score it against the coordinator's
actual allocation with the same travel model, to see (1) whether it fills the visits,
(2) what it does to travel, miles, carers' hours and continuity, and (3) what settings
it needs. Decision log entries: 2026-11-16 (trial) and 2026-11-17 (continuity cost) in
[`DECISIONS.md`](DECISIONS.md).

## Method

- **Regions** solved separately: Leeds, and Dorset (Dorchester and Weymouth together).
- **Visits:** CareLineLive Bookings report for the week, 1,065 visits after dropping 4
  cancelled ones.
- **Carers, clients, addresses:** read-only API (GET only). Map coordinates are
  CareLineLive's own address geocoding; no external services were used.
- **Carers:** the 21 who worked that week.
- **Hours target:** equal hours per carer within each region (46.8 h Leeds, 49.1 h
  Dorset), as decided 2026-11-16.
- **Placeholders:** a working day for every carer and a weekly maximum of 60 h. Real
  working hours are not entered anywhere yet.
- **Locked to the carer who did them:** Waking Nights, Client Respite and all visits of
  4 h or longer.
- **Actual week:** scored with the same travel model, by building the engine's own
  report from the real allocation (`evaluate_actual.py`).
- **Engine code** unchanged, except the new shift cost setting (`shift_pence_per_min`,
  see [`ROTA_ENGINE.md`](ROTA_ENGINE.md)).
- **Travel model:** straight-line distance x 1.35, car at 28 km/h plus 3 minutes per
  trip. Simpler than Google's; see caveats.

## Actual week (the baseline)

1,064 of 1,065 visits filled; travel 273.2 h; 3,463 miles; hours per carer 19.8 to
65.5 h (stdev 8.8 h); continuity 0.349 against the previous 4 weeks.

## Runs

Totals for both regions. "Filled" is out of 1,065.

| # | Settings | Result | What it taught |
|---|---|---|---|
| 1 | Booked times fixed (window 0), day 07:00-22:00 | 949 filled | The travel model cannot fit the back-to-back visits at exact times |
| 2 | Window ±30 min, no move cost | 1,064 filled; 93% of visits moved, average 21 min | Free movement is not acceptable; added `shift_pence_per_min` |
| 3 | Window ±30, move cost 15p/min, day 07:00-22:00 | 13 unfilled, all 07:00-08:00 starts; a 30 s search did not change it | The placeholder day starts too late |
| 4 | As 3, day 06:30-22:30 | 1,059 filled | Day length was the cause |
| 5 | Continuity measured against the previous 4 weeks (19 Oct to 15 Nov); default continuity cost 60p | Actual 0.349; engine 0.277 (Leeds 0.354 vs actual 0.555) | Same-week continuity flattered the actual week; at 60p the engine is below the coordinator |
| 6a | Continuity cost £3 | 1,062 filled; travel 219.1 h; 2,592.9 mi; continuity 0.444; hours stdev 6.6 h | Better, still below actual |
| 6b | Continuity cost £10 (recommended) | 1,063 filled; travel 226.0 h (-17%); 2,697.8 mi (-22%); continuity 0.564; hours per carer 30.2-60.0 h, stdev 7.2 h; 651 visits moved, mean 9.4 min, max 30 | See findings |

Run 6b by region: continuity Leeds 0.711 (actual 0.555), Dorset 0.478 (actual 0.231).
Percentages are against the actual week.

## Findings

1. **The current rota relies on carers running late or shortening visits.** 699
   consecutive visit pairs (Leeds 228, Dorset 471) have less gap between them than the
   travel time between them, and about half of all moves between clients are back to
   back with under 5 minutes gap. With a high move cost the engine still had to shift
   about 500 visits, 84% of them next to such pairs. This is why a booked-times-only
   run (run 1) cannot fill the week.
2. **At £10 per unfamiliar carer the engine beats the actual week on every measure
   except evenness of hours:** less travel time and fewer miles, better continuity in
   both regions, and nearly every visit filled (1,063 of 1,065). Hours stdev is 7.2 h
   against 8.8 h actual, so it is also more even than the actual week, but less even
   than at the default continuity cost (5.8 h).
3. **Continuity needs a real cost.** At the default 60p the engine broke existing
   carer-client relationships (0.277 vs 0.349 actual). It rose to 0.444 at £3 and 0.564
   at £10.
4. **Hours range.** Actual week 19.8 to 65.5 h; engine 30.2 to 60.0 h (60 h is the
   placeholder cap).
5. **Day length matters.** A 07:00 start left early visits unfilled; 06:30 fixed it.
   Real working hours need entering before any result is relied on.

## Recommended trial settings

Decided 2026-11-17 (see [`DECISIONS.md`](DECISIONS.md)): run 6b.

| Setting | Value |
|---|---|
| Visit window | ±30 min (locked visits 0) |
| Shift cost (`shift_pence_per_min`) | 15p per minute |
| Day | 06:30 to 22:30 (placeholder) |
| Weekly maximum | 60 h (placeholder) |
| Continuity cost (`continuity_penalty_pence`) | 1000 (£10 per visit by an unfamiliar carer) |
| Continuity history | previous 4 weeks |
| Search | 30 s per day |

Trade-off: about 12 h more travel and 200 more miles than at the default cost, and less
even hours (stdev 7.2 h vs 5.8 h), for much better continuity.

## Caveats

- **One week only.** Nothing here shows the result holds for other weeks.
- **Placeholder working hours**, not real availability, and a placeholder 60 h maximum.
- **Simpler travel model** (straight-line x 1.35, 28 km/h plus 3 min) than Google's.
  CareLineLive's own mileage report gives 4,594.5 booked miles for the week; our model
  scores the actual week at 3,463. Compare plans with each other, not with that report.
- **Data oddities:** 7 Dorset visits had 2 carers where 1 was expected; 3 Dorset
  carers use an approximate home location; 7 of 56 clients have no carer history in
  the previous 4 weeks, so continuity cannot reward anything for them.
- **2 visits unfilled by the engine are not yet diagnosed.**
- Rest and working-time rules are the engine's existing ones, still to be confirmed
  (see [`ROTA_ENGINE.md`](ROTA_ENGINE.md)); this trial makes no compliance claim.

## What the coordinator should review

1. **The moved visits** (651 in the recommended run, mean 9.4 min, max 30): are those
   moves acceptable, and which visits must never move?
2. **The back-to-back finding:** are visits really booked closer together than the
   journey, and what happens in practice (late arrival, shortened visit)?
3. **Hours fairness:** the spread per carer, and whether an equal share is the right
   target given real preferences and availability.
4. **Unfilled visits:** the 2 the engine could not place, once diagnosed.
5. **Continuity:** whether the relationships kept and broken are the right ones,
   including the 7 clients with no recent history.
6. **Locked visits:** whether locking Waking Nights, Client Respite and 4 h+ visits is
   right, or holds too much fixed.

## Next steps

1. **Coordinator review** of this trial on their own data = Decision 2 in
   [`PLAN.md`](PLAN.md).
2. **A second week**, to see whether the findings hold.
3. **Real working hours** entered in Loidis Connect (carers' hours and weekly
   maximums), replacing the placeholders, then re-run.
4. **Diagnose the 2 remaining unfilled visits.**
5. Revisit the continuity and shift costs after the review and the second week.
