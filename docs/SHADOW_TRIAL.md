# Shadow-mode trial: week 2026-11-16 to 2026-11-22

Status: engine runs done 2026-11-17; recommended settings re-run after an external
review's fixes (run 7 below, the current result); **awaiting the coordinator's review**
(Decision 2 in [`PLAN.md`](PLAN.md)). Nothing was written to CareLineLive, and nothing in
this trial is published or acted on: the engine only suggests.

> **Safety rules NOT checked.** The trial sets every carer's DBS and training expiry to
> 2099 and leaves required skills, gender preferences, do-not-send pairs and safeguarding
> bars empty. The engine's suggested allocations have therefore **not** been checked
> against any of these rules. A coordinator must check every suggested allocation against
> them before it is relied on.

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
  4 h or longer, visits outside the placeholder day, and visits done by a carer from the
  other region. A visit is locked only if the actual week fully staffed it; a partly
  staffed visit stays open (carers who attended keep their availability around it if it
  falls outside the day).
- **Carers who work in both regions** (since the review fixes): in the region where a carer
  is a guest the visits are locked; in their home region they get no default working day
  on days they have visits in the other region, and their weekly maximum is reduced by
  those minutes, so a plan cannot book them in two regions at once or over the cap.
- **Actual week:** scored with the same travel model, by building the engine's own
  report from the real allocation (`evaluate_actual.py`). A visit with some but fewer
  carers than needed counts as partially staffed (their travel and continuity count; it
  is listed as unfilled, with only the missing carer-hours as the deficit). A second
  baseline, "actual (equal staffing)", keeps only the first listed carer on visits that
  had 2 carers where 1 was expected (which carer is dropped is arbitrary), so the effect
  of staffing can be separated from routing.
- **Hours per carer (total):** each carer's hours summed across both regions, including
  hours as a guest. Per-region figures count only home carers' hours in that region.
- **Engine code** unchanged, except the new shift cost setting (`shift_pence_per_min`,
  see [`ROTA_ENGINE.md`](ROTA_ENGINE.md)).
- **Travel model:** straight-line distance x 1.35, car at 28 km/h plus 3 minutes per
  trip. Simpler than Google's; see caveats.

## Actual week (the baseline)

From the re-run (run 7, scored after the fixes): 1,064 of 1,065 visits fully staffed
(1 with no carer allocated, none partially staffed); travel 273.2 h; 3,463 miles; hours
per carer 21.0 to 65.5 h (stdev 8.6 h); continuity 0.349 against the previous 4 weeks.
With equal staffing (7 Dorset visits reduced to 1 carer): travel 272.3 h, 3,453.8 miles,
care hours 1,007.7 h (vs 1,012.2), continuity 0.349, hours 21.0 to 65.5 h (stdev 8.6 h).
The staffing difference accounts for about 1 h of travel and 9 miles, so nearly all of
the engine's saving comes from routing, not staffing.

## Runs

Totals for both regions. "Filled" is out of 1,065.

Runs 1 to 6b were made **before** the review fixes (cross-region carers, partly staffed
visits, pooled hours spread) and are kept for history; their figures are not directly
comparable with run 7.

| # | Settings | Result | What it taught |
|---|---|---|---|
| 1 | Booked times fixed (window 0), day 07:00-22:00 | 949 filled | The travel model cannot fit the back-to-back visits at exact times |
| 2 | Window ±30 min, no move cost | 1,064 filled; 93% of visits moved, average 21 min | Free movement is not acceptable; added `shift_pence_per_min` |
| 3 | Window ±30, move cost 15p/min, day 07:00-22:00 | 13 unfilled, all 07:00-08:00 starts; a 30 s search did not change it | The placeholder day starts too late |
| 4 | As 3, day 06:30-22:30 | 1,059 filled | Day length was the cause |
| 5 | Continuity measured against the previous 4 weeks (19 Oct to 15 Nov); default continuity cost 60p | Actual 0.349; engine 0.277 (Leeds 0.354 vs actual 0.555) | Same-week continuity flattered the actual week; at 60p the engine is below the coordinator |
| 6a | Continuity cost £3 | 1,062 filled; travel 219.1 h; 2,592.9 mi; continuity 0.444; hours stdev 6.6 h | Better, still below actual |
| 6b | Continuity cost £10 (before fixes) | 1,063 filled; travel 226.0 h (-17%); 2,697.8 mi (-22%); continuity 0.564; hours per carer 30.2-60.0 h, stdev 7.2 h; 651 visits moved, mean 9.4 min, max 30 | Superseded by run 7 |
| 7 | As 6b, **after the fixes** (current recommended result) | 1,061 filled (4 unfilled, all Dorset); travel 229.1 h (-16%); 2,753.3 mi (-20%); continuity 0.566; hours per carer 25.8-59.8 h, stdev 7.9 h; 626 visits moved, mean 8.9 min overall (15.2 min of those moved), max 30 | See findings |

Percentages are against the actual week (total, not equal-staffing).

### Run 7 in detail (recommended settings, after the fixes)

| Metric | Leeds actual | Leeds actual (equal staffing) | Leeds engine | Dorset actual | Dorset actual (equal staffing) | Dorset engine | Total actual | Total actual (equal staffing) | Total engine |
|---|---|---|---|---|---|---|---|---|---|
| Visits | 386 | 386 | 386 | 679 | 679 | 679 | 1,065 | 1,065 | 1,065 |
| Filled (fully staffed) | 386 | 386 | 386 | 678 | 678 | 675 | 1,064 | 1,064 | 1,061 |
| Unfilled (incl. partly staffed) | 0 | 0 | 0 | 1 | 1 | 4 | 1 | 1 | 4 |
| Unfilled carer-hours | 0.0 | 0.0 | 0.0 | 5.2 | 5.2 | 8.0 | 5.2 | 5.2 | 8.0 |
| Care hours | 374.2 | 374.2 | 374.2 | 638.0 | 633.5 | 630.8 | 1,012.2 | 1,007.7 | 1,005.0 |
| Travel hours | 111.7 | 111.7 | 94.6 | 161.5 | 160.6 | 134.5 | 273.2 | 272.3 | 229.1 |
| Miles | 1,453.6 | 1,453.6 | 1,179.1 | 2,009.4 | 2,000.2 | 1,574.2 | 3,463.0 | 3,453.8 | 2,753.3 |
| Continuity | 0.555 | 0.555 | 0.701 | 0.231 | 0.229 | 0.487 | 0.349 | 0.349 | 0.566 |
| Visits moved from booked time | 0 | 0 | 185 | 0 | 0 | 441 | 0 | 0 | 626 |
| Mean shift (min, all with carers / moved only) | 0 | 0 | 6.7 / 14.0 | 0 | 0 | 10.2 / 15.6 | 0 | 0 | 8.9 / 15.2 |
| Hours per carer min / median / max | 41.5 / 46.2 / 53.0 | same | 36.0 / 46.8 / 55.8 | 19.8 / 51.8 / 65.5 | same | 24.5 / 49.0 / 59.8 | 21.0 / 48.2 / 65.5 | same | 25.8 / 48.2 / 59.8 |
| Hours stdev | 3.7 | 3.7 | 5.0 | 10.7 | 10.7 | 9.4 | 8.6 | 8.6 | 7.9 |

The per-region hours columns exclude hours a carer works as a guest in the other region;
the total columns include them. Counts for the fixes: in Dorset, 1 home carer had visits
in Leeds, so 2 default working days were removed and 75 minutes taken off their weekly
cap; Leeds had none. No actual visit was partly staffed, so no lock was relaxed for that
reason (1 Dorset visit had no carer at all).

## Findings

1. **Estimated scheduling conflicts in the current rota, under our travel model.** 699
   consecutive visit pairs (Leeds 228, Dorset 471) have less planned gap between them
   than our model's travel estimate for the journey. This is a statement about our
   simplified travel model (straight-line x 1.35, 28 km/h plus 3 min), not evidence of
   what happens in practice: the coordinator should confirm against what actually
   happens (for example check-in times). In earlier runs (before the fixes), with a high
   move cost the engine still had to shift about 500 visits, most of them next to such
   pairs, and a booked-times-only run (run 1) could not fill the week.
2. **Run 7 against the actual week.**
   Improvements: travel 229.1 h vs 273.2 h (-16%); miles 2,753 vs 3,463 (-20%);
   continuity 0.566 vs 0.349 (Leeds 0.701 vs 0.555, Dorset 0.487 vs 0.231); hours per
   carer range 25.8 to 59.8 h vs 21.0 to 65.5 h, stdev 7.9 h vs 8.6 h (more even than
   actual).
   Regressions and costs: 3 fewer visits fully staffed than actual (1,061 vs 1,064; all
   4 engine-unfilled visits are in Dorset and are not yet diagnosed); 626 visits start
   up to 30 min from their booked time; in Leeds hours are less even than actual (stdev
   5.0 h vs 3.7 h; the gain in evenness is all in Dorset); hours are less even than at the default
   continuity cost (earlier run, before the fixes: stdev 5.8 h); and the unchecked safety
   rules above.
   Against the equal-staffing baseline the travel and mile savings are almost the same
   (-16% and -20%), so they come from routing, not from the 7 double-staffed visits.
3. **Continuity needs a real cost.** At the default 60p the engine broke existing
   carer-client relationships (0.277 vs 0.349 actual, earlier run). It rose to 0.444 at
   £3 and 0.564 at £10 (earlier runs), and was 0.566 after the fixes.
4. **Hours range.** Actual week 21.0 to 65.5 h; engine 25.8 to 59.8 h (60 h is the
   placeholder cap), both counting each carer's hours in both regions.
5. **Day length matters.** A 07:00 start left early visits unfilled; 06:30 fixed it.
   Real working hours need entering before any result is relied on.

## Recommended trial settings

Decided 2026-11-17 (see [`DECISIONS.md`](DECISIONS.md)): the settings of run 6b, re-run
as run 7 after the fixes.

| Setting | Value |
|---|---|
| Visit window | ±30 min (locked visits 0) |
| Shift cost (`shift_pence_per_min`) | 15p per minute |
| Day | 06:30 to 22:30 (placeholder) |
| Weekly maximum | 60 h (placeholder) |
| Continuity cost (`continuity_penalty_pence`) | 1000 (£10 per visit by an unfamiliar carer) |
| Continuity history | previous 4 weeks |
| Search | 30 s per day |

Trade-off (the comparison with the default cost is from the earlier run, before the
fixes): about 12 h more travel and 200 more miles than at the default cost, and less even
hours (stdev 7.2 h vs 5.8 h), for much better continuity.

## Caveats

- **Unchecked safety rules.** DBS and training expiry set to 2099; required skills, gender
  preferences, do-not-send pairs and safeguarding bars empty. Suggested allocations have
  NOT been checked against them; check each one before relying on it.
- **One week only.** Nothing here shows the result holds for other weeks.
- **Placeholder working hours**, not real availability, and a placeholder 60 h maximum.
- **Simpler travel model** (straight-line x 1.35, 28 km/h plus 3 min) than Google's.
  CareLineLive's own mileage report gives 4,594.5 booked miles for the week; our model
  scores the actual week at 3,463. Compare plans with each other, not with that report.
- **Equal-staffing baseline:** which carer is dropped from the 7 over-staffed visits is
  arbitrary (the first listed), so that column is indicative.
- **Hours spread:** per-region figures exclude hours worked as a guest in the other
  region; the total pools both regions.
- **Data oddities:** 7 Dorset visits had 2 carers where 1 was expected; 3 Dorset
  carers use an approximate home location; 7 of 56 clients have no carer history in
  the previous 4 weeks, so continuity cannot reward anything for them.
- **4 Dorset visits unfilled by the engine (run 7) are not yet diagnosed.**
- Rest and working-time rules are the engine's existing ones, still to be confirmed
  (see [`ROTA_ENGINE.md`](ROTA_ENGINE.md)); this trial makes no compliance claim.

## What the coordinator should review

0. **Safety rules first:** check every suggested allocation for DBS and training status,
   required skills, gender preferences, do-not-send pairs and safeguarding bars, none of
   which the trial applied.
1. **The moved visits** (626 in run 7, mean 15.2 min of those moved, max 30): are those
   moves acceptable, and which visits must never move?
2. **The tight gaps:** our model estimates 699 visit pairs with less gap than the
   journey. Is that real? Check against what actually happens (for example check-in
   times), not our model.
3. **Hours fairness:** the spread per carer, and whether an equal share is the right
   target given real preferences and availability.
4. **Unfilled visits:** the 4 the engine could not place in run 7, once diagnosed.
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
4. **Diagnose the 4 unfilled visits in run 7.**
5. Revisit the continuity and shift costs after the review and the second week.
