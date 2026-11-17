# Rota engine test (first version of the Stage A MVP)

Status: **draft for review**, 2026-11-17. Narrowed by the user on 2026-11-17: no
database yet, two modes, our own hosting for the test. Technology decided (Next.js UI,
Python engine); see [Hosting](#hosting-for-the-test) and [Open decisions](#open-decisions).

This is the first usable version of the rota planner for **Loidis only**. It is the
Stage A "rota companion" from [`PLAN.md`](PLAN.md), cut down to what is needed to
**test the engine on real weeks**, not the full platform MVP in [`SCOPE.md`](SCOPE.md)
(carer app, care plans, live monitoring), which comes later.

It turns the shadow trial ([`SHADOW_TRIAL.md`](SHADOW_TRIAL.md)) into something the
coordinator runs themselves each week. The engine only suggests: the coordinator
reviews every change and applies it in CareLineLive by hand. Nothing is written to
CareLineLive.

## Who uses it

One user: Loidis's care coordinator (and whoever covers for them), plus the dev team
while testing. No carer, client or family access.

## No database for now

Nothing about clients, carers or rotas is stored on the server.

- Each run goes: **upload, run, review, download**. Uploaded files and results exist
  only for the length of the run and are deleted afterwards. No personal data goes into
  server logs.
- The settings the coordinator enters (carers' working hours, weekly maximum, skills,
  DBS and training dates, do-not-send, safeguarding bars, gender preferences, required
  skills, time-critical visits, carer name matches, engine settings) are downloaded as a
  **settings file the coordinator keeps**, and uploaded again with the next week.

**Trade-off.** This keeps real data off our server between runs and avoids building
storage, backups and retention rules before we know the engine is worth it. The cost
falls on the coordinator: the settings file can be lost, can go stale (a carer's hours
change and nobody updates it), and can be copied around, emailed or left in Downloads.
It holds personal data (names, DBS dates, safeguarding bars), so Loidis must keep it as
carefully as any other staff and client file. A database (PostgreSQL, already chosen)
comes once the engine is proven; see [Later](#later).

## Two modes

Both modes read the same inputs and show the same overview against the current rota.

- **New rota (from scratch).** The engine allocates every booking. Output: the full
  allocation per carer per day. The bookings already exist in CareLineLive; the
  coordinator only assigns carers and, where shown, changes times, in CareLineLive, as
  the engine suggests.
- **Improve my rota.** The engine starts from the coordinator's current allocation (read
  from the bookings CSV) and changes a visit only when the gain is worth a change. A
  **per-change cost** setting says how much a change must save. Output: a short list of
  changes. Each change shows what to change (booking ID, client reference, date, time,
  from carer(s), to carer(s), new time if any) and why (for example travel saved, familiar
  carer, fills an unallocated visit, evens hours). The coordinator applies the changes
  in CareLineLive.
  **Arrival tolerance:** a visit that keeps its carer and starts within the arrival
  tolerance (setting below) of its booked time is shown as a **note**, not a change to
  apply. Where the carer does change, the list says either "keep the booked time" (the
  shift is within the tolerance) or "change the time to HH:MM".

  What the trial found for Improve my rota (aggregates only, Leeds and Dorset together,
  change cost £10): about 395 carer changes in the week. The time shifts the engine
  shows are mostly forced by its travel model rather than a real saving, which is why the
  tolerance exists. The full new rota touches about 140 carer-days, so with visit rounds
  (see [Visit rounds](#visit-rounds-later)) it would be about 140 drags instead of
  hundreds of per-booking changes. Visit rounds remain a later step and need the user's
  explicit approval in chat first, because they write to CareLineLive.

## The weekly loop

1. The coordinator generates next week's bookings in CareLineLive, as today.
2. **Upload:** the week's optimised bookings CSV (it carries booking and client IDs) and
   the settings file kept from last week (none on the first run). The app pulls carers,
   clients, addresses, teams, transport types and leave from the CareLineLive API
   (GET only), and the Continuity report for the 4 weeks before is uploaded (until
   there is stored history).
3. **Check settings:** confirm or update carers' working hours and the rules (most weeks
   nothing changes; the app shows what is new or missing). Download the updated settings
   file and keep it.
4. **Run:** choose New rota or Improve my rota and run.
5. **Review:** compare with the current rota; look at unfilled visits, hours per carer,
   travel and continuity; lock or change anything and re-run.
6. **Export:** download the allocation (New rota) or the changes list (Improve my rota)
   and apply it in CareLineLive. Results are deleted from the server when the session
   ends.
7. Publish to carers in CareLineLive, as today.

Daily sickness cover (re-plan only one carer's visits) uses the engine's existing
`cover` command and is a **stretch goal** (see [Scope](#scope)).

## Look and feel

Clean, and **familiar to a CareLineLive user** so it is not a shock:

- The same words: bookings, rounds, roster, unallocated, booking types, teams.
- A **carer-per-row day grid** like their roster: one row per carer, the day across,
  visits as blocks.
- Familiar status colours (for example one for allocated, one for unallocated, one for
  warnings), always with a label or icon as well, never colour alone.
- Icons from a standard open icon set (for example Lucide), chosen to mean the same
  things as in CareLineLive.

We do **not** copy CareLineLive's logo, icons, colours or screen designs: that is their
product. Ours is a clean design of its own that feels familiar.

## Screens

### 1. Upload
- Upload the bookings CSV for one week (Monday to Sunday). Check: one week, a booking
  ID on every row, known columns; show counts (visits, clients, carers, double-ups,
  cancelled) and anything unexpected. Never show names in error messages that leave
  the app.
- Upload the settings file (if there is one) and the Continuity report.
- "Sync from CareLineLive" button: carers, clients, addresses (with CareLineLive's own
  map coordinates), teams, transport types, leave. Shows counts and anything missing
  (missing address, a carer or client not in the settings file).
- Matching: carers in the bookings CSV appear by name only, so the app matches them to
  API carers by name and asks the coordinator to confirm any it cannot match. Matches go
  into the settings file.

### 2. Settings
Everything the coordinator enters, in one place, with **Download settings file** and
**Upload settings file** buttons. Missing working hours or DBS/training dates are shown
as warnings; a carer with no working hours is not planned.

**Carers.** One row per carer: team(s), gender, transport, and the fields only Loidis
Connect holds:
- **Working hours:** blocks per weekday (for example Mon-Fri 07:00-14:00), including
  nights.
- **Weekly maximum hours.**
- **Skills** (for example hoist, medication, nights).
- **DBS expiry and training expiry** (from the API if available, see open questions;
  otherwise entered).
- **Active in planning:** on or off (for carers who are employed but not on the rota).

**Clients.** One row per client: team, address check, and:
- **Gender preference** of carer.
- **Do-not-send carers** (never booked; may be suggested as a last resort with a
  warning, as the engine does today).
- **Safeguarding bar** (never booked or suggested).
- **Required skills** for this client's visits.
- **Time-critical visits:** visits that must not move from their booked time (for
  example medication). Set per client and booking type (for example "Morning Visit").

**Agency settings.** The trial's recommended values as defaults, editable, with a plain
explanation of each:

| Setting | Default | Meaning |
|---|---|---|
| Visit move window | ±30 min | How far a non-time-critical visit may move |
| Move cost | 15p per minute | Discourages moving visits unless it saves travel |
| Continuity weight | £10 per visit | Cost of sending a carer the client has not seen in 4 weeks |
| Hours balance | Equal share within each team | Decision 2026-11-16 |
| Search time | 10 s per day (Quick); 30 s per day (Thorough) as an option | Longer can give a slightly better plan |
| Change cost (Improve my rota only) | £10 per change | How much a change must save to be worth suggesting. Options on the Run screen: £3, £5, £10, £20 |
| Arrival tolerance (Improve my rota only) | 15 min (placeholder: to confirm with the coordinator and Loidis's contracts; not a regulatory or contractual standard) | A visit that keeps its carer and moves by no more than this is a note, not a change to apply |
| Pay rate, mileage rate, travel time paid | Engine defaults until the coordinator confirms | Used to cost travel |

Teams are planned separately (Leeds; Dorset = Dorchester and Weymouth), as in the trial.

### 3. Run
- Choose **New rota** or **Improve my rota**, and the week.
- For Improve my rota, choose the **change cost** (default **£10**):
  - **£3**: suggests many changes, for the biggest possible saving.
  - **£5**: suggests a lot of changes; a small saving is enough.
  - **£10** (default): a balance; only changes that clearly save travel, hours or continuity.
  - **£20**: suggests few changes; keeps the current rota unless the gain is large.
- Show progress (a few minutes).

### 4. Review
- **Overview** (both modes): bookings filled, unallocated (with reasons), travel hours
  and miles, continuity, hours per carer (range and spread), visits moved; each next to
  the current rota's figure, scored with the same travel model.
- **Roster view:** carer-per-row day grid, with visits in order and travel between them;
  moved visits highlighted, locked visits marked. (Start from the existing `viewer/`.)
- **Unallocated bookings:** reason and the nearest carers who were busy.
- **Changes list (Improve my rota):** each change with what and why, as above.
- **Warnings:** any rule not checked because its input is missing (for example a carer
  with no DBS date), shown at the top, not buried.
- **Adjust:** lock a visit to a carer (or to its current carer), then re-run.

### 5. Export
- **New rota:** the full allocation per carer per day (CSV, plus a printable view).
- **Improve my rota:** CSV of changes: booking ID, client reference code, date, booked
  time, new time if any, from carer(s), to carer(s), reason.
- The settings file (download again, so the coordinator has the latest).
- Optional printable summary (aggregate figures, no names).
- The coordinator applies all of this in CareLineLive by hand.

## Data

| Data | Source | Notes |
|---|---|---|
| Visits for the week | Optimised bookings CSV (Reports > Bookings, CSV option), uploaded | Booking ID, client ID, date, times, booking type, expected and allocated carers, carers by name, team. The allocated carers are the "current rota" |
| Carers, clients, addresses, teams, transport, leave | CareLineLive API, GET only, fetched during the run | Map coordinates from CareLineLive's own geocoding; flag any missing |
| Working hours, weekly maximum, skills | Settings file | Decision 2026-11-16 |
| Do-not-send, safeguarding bar, gender preference, required skills, time-critical | Settings file | Decision 2026-11-16 |
| DBS and training expiry | API if available (to check), else settings file | |
| Carer name matches | Settings file | |
| Continuity history | Continuity report upload (4 weeks before) | Until there is stored history (later) |
| Engine settings | Settings file | |

Nothing is kept on the server after the run. Code keeps one clear boundary between
"CareLineLive import" and everything else (the engine and screens see only the app's
own data), as `PLAN.md` already requires. This version does not add support for other
agencies.

## Hosting for the test

Our own hosting, for the test. Must-haves (this is not legal advice; the full list is in
[`COMPLIANCE.md`](COMPLIANCE.md)):

- Loidis's **written agreement and data processing agreement** before any real data goes
  in (`COMPLIANCE.md` item 3).
- **UK region** hosting, **HTTPS** only.
- A **login** (simple is fine) for the coordinator and the dev team only.
- **No third-party scripts, analytics, fonts or map tiles** in the page: everything the
  page loads comes from our own server. Travel uses our own model, with no external
  maps or geocoding.
- The CareLineLive token lives **only on the server**, never in the page, and comes from
  a **view-only** CareLineLive user (not yet set up).
- No personal data in server logs; uploads and results deleted after the run (see
  [No database for now](#no-database-for-now)).
- Settings files and exports leave the app only when the coordinator downloads them.

## Safety and approvals

- The engine only suggests; nothing reaches carers until the coordinator applies it in
  CareLineLive and publishes there.
- No writes to CareLineLive. Creating visit rounds is a later step and needs explicit
  approval first (`CLAUDE.md` rule 2); see [Visit rounds (later)](#visit-rounds-later).
- Every rule the engine applies is only as good as its input: the app must show clearly
  which rules could not be checked because data is missing, and the trial's
  placeholders (DBS/training 2099, empty rules) must not be used.
- Time-critical visits are never moved, in either mode.
- Changing care plans or medication records is out of scope (`CLAUDE.md` rule 6).

## Visit rounds (later)

CareLineLive's API cannot create, read or allocate bookings, but it **can create visit
rounds** that group existing bookings by booking ID. A round has no carer, date or order.
In the roster the coordinator drags one round onto a carer instead of dragging each
booking. So the engine could create **one round per carer per day** of its plan, and the
coordinator makes **one drag per carer per day** instead of one change per booking.

This is a **write to CareLineLive**. It needs the user's explicit approval in chat first,
and a token that is allowed to create rounds (a view-only user cannot). It is **out of
scope for the engine test**. Details: [`CARELINELIVE.md`](CARELINELIVE.md) ("Visit
rounds").

## Scope

**In:** the five screens above, upload of the bookings CSV, settings file and
Continuity report, CareLineLive read-only sync, both modes, review against the current
rota, export, warnings for missing rule data, login, hosting set-up for the test.

**Stretch:** daily sickness cover for one carer; printable summary.

**Later:** a database (PostgreSQL), stored history of imports and runs, "find last
week's run", settings kept on the server, an audit log of imports/runs/exports (needed
once data is stored); writing visit rounds to CareLineLive; other agencies; a carer app;
live visit monitoring; road routing (travel uses the straight-line model with a road
factor, as in the trial); mileage and payroll export; mobile layout.

## Acceptance criteria

The engine test is ready for the pilot when the coordinator can, without help:
1. Upload a generated week and the settings file, and sync from CareLineLive, with every
   carer and client matched.
2. Enter working hours and rules for all active carers and clients, with no missing-data
   warnings left that they have not chosen to accept, and download the settings file.
3. Run either mode and get a result in under 10 minutes.
4. See unallocated bookings with reasons, moved visits, hours per carer, travel and
   continuity, each against the current rota.
5. Lock changes, re-run, and export: the full allocation (New rota) or the changes list
   with a reason for each change (Improve my rota).
6. Upload the settings file again the next week and get the same settings back.

And on the server side: after a run, no uploaded file, result or personal data remains
(checked), and server logs hold no names or other personal data.

And on the pilot week, the coordinator judges the suggestions safe and worth applying
(this is Decision 2 in `PLAN.md`).

## Open decisions

1. **Hosting: decided 2026-11-17**, our own hosting for the test, with the must-haves
   above. Still to choose: the provider and region (UK), and who looks after it.
2. **Technology: decided 2026-11-17**, as in `PLAN.md`: a **Next.js** web app for the
   screens, the rota engine stays in **Python** (OR-Tools) as a separate service the web
   app calls. The CareLineLive import (reusing `tools/shadow_trial/`) runs on the Python
   side, next to the engine. **PostgreSQL** is still the choice for the app's data, but
   comes later (no database in this version). To settle while building: how the web app
   calls the engine (a small HTTP API around `loidis_rota` is the simplest) and how runs
   that take a few minutes report progress.

## Open questions

- Does the API give carers' DBS and training expiry (qualifications or employee
  requirements endpoints)? If not, the coordinator enters them.
- Which visits are time-critical (medication, insulin, meals), and is booking type
  enough to tell?
- Can the bookings CSV be produced for a full generated week every week, and what is
  the exact report option name?
- The 4 visits the trial left unfilled in Dorset: undiagnosed; check before the pilot.
- Does the coordinator want an extra-carer rule (the trial week had 7 visits with 2
  carers where 1 was booked)?
- Improve my rota: does £10 feel right to the coordinator (how many minutes of travel
  is a change worth)? And what arrival tolerance is acceptable (15 min is a placeholder
  to confirm with the coordinator and Loidis's contracts)?
- Where will the coordinator keep the settings file, and who else may see it?

## Build order

1. Python service around the engine: run endpoint with **New rota** and **Improve my
   rota** (start from the current allocation, per-change cost, a reason for each change);
   bookings CSV import and CareLineLive API sync (reusing `tools/shadow_trial/`); carer
   name matching; delete inputs and results after the run; no personal data in logs.
2. **Settings file:** format, validation, download and upload; missing-data warnings.
3. Next.js screens: Upload, Settings, Run, Review (overview, roster view from `viewer/`,
   unallocated, changes), Export; time-critical visits never moved.
4. **Hosting set-up:** UK region, HTTPS, login, no third-party assets, token on the
   server only, view-only CareLineLive user; agreement in place before real data.
5. Pilot week with the coordinator; then Decision 2.
