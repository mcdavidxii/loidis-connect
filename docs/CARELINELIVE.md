# How CareLineLive's rota works (and what it means for us)

Summary of CareLineLive's public User Guide and API documentation, read 2026-11-15; API section re-checked 2026-11-16.
Sources: [User Guide](https://support.carelinelive.com/hc/en-us/categories/5979350783519-User-Guide),
[API docs](https://api.docs.carelinelive.com) (API v2, version 2025-01-01).

## The rota workflow in CareLineLive

1. **Client schedule (the template).** Each client has repeating schedule entries: days,
   start time, duration, booking type, service contract, team, round, number of carers,
   and optionally the regular carer(s). Entries can follow multi-week cycles
   (week 1 / week 2). "Restrict times" sets how far a visit may move and how much its
   length may change.
2. **Generate bookings.** Schedule entries are turned into live bookings for a date
   range, in bulk ("batches"). Entries with carers set are created already allocated;
   the rest are created **unallocated**. Validation flags clashes (client or carer
   double-booked), inactive contracts, and round conflicts.
3. **Roster.** A day grid (carers or clients as rows) and a multi-day overview showing
   each carer's utilisation (high / medium / low availability). The coordinator
   **drags** unallocated bookings onto carers, or right-clicks "Move to". Changes are
   previewed and saved in one go.
4. **Rounds.** A group of bookings that can be dragged onto a carer in one move. Rounds
   can be set on schedule entries so they repeat.
5. **Travel.** Google Maps travel estimates per carer transport type. After changes are
   saved, a green or red bar between visits shows whether there is enough time.
   Clicking a carer shows their route on a map. Estimates are skipped for gaps over
   2 hours.
6. **Publishing.** Bookings are only visible to carers once published.

## Rules and settings that affect allocation

| Feature | What it does | Our engine |
|---|---|---|
| Carer compatibility (per client) | Actions: **Warn** (allowed with a warning), **Exclude** (never), **Preferred** (top of the list), **Only** (allow-list). Kinds: specific carer, gender, vaccination, qualification, requirement, requirement template | Partly: do-not-send (= Exclude, with "suggest"), safeguarding bar, gender. **To add:** Warn, Preferred, Only, qualification/requirement kinds |
| Restrictions (opt-in) | Carer must be scheduled available; cannot be scheduled unavailable; must have address; no incomplete requirements | Built as always-on rules; **make them settings** to match |
| Leave vs unavailability | Leave blocks allocation and feeds payroll; unavailability is a recurring preference | Absences by day built; part-day leave and unavailability to add |
| Shifts | Paid periods of work that bookings sit inside | Availability blocks used the same way |
| Service areas | Per-carer areas (postcode or drawn), with transport type and a buffer in km | **To add** as a rule or preference |
| Capacity tools | Check which carers could take a new package at given times; map of clients and carers by area | Our engine can answer this better ("what-if": run the plan with the new client added) |
| Overlapping | Client or carer may have bookings at the same time (e.g. two carers at different times or lengths) | Double-ups modelled as same start; **different start or length to add** |
| Thresholds | Check-in punctuality, location, duration for call monitoring | Not a rota feature; carer app later |

## What CareLineLive does not do

The User Guide describes **no automatic allocation, no suggested carers ranked by
travel or hours, and no route optimisation**. Allocation is manual: pre-set carers on
schedule entries, then drag-and-drop. Travel is checked after a change, not used to
choose carers. Preferred carers only move to the top of a dropdown. This confirms where
Loidis Connect adds value: auto-generating the week, suggesting cover, and explaining
gaps.

## The API: what we can and cannot connect to

Checked against the OpenAPI spec (`https://api.docs.carelinelive.com/openapi.json`,
154 paths) on 2026-11-16. Support-site articles could not be opened by automated tools;
points marked *(unverified)* come from search snippets only.

### Basics

- **Base URL:** `https://<subdomain>.carelinelive.app/api/v2` (one per agency).
- **Version:** send `X-Api-Version: 2025-01-01` on every request; without it the API
  returns the latest version, which may change under us. v1 is internal only.
- **Login:** personal access tokens, sent as `Authorization: Bearer <token>`. A token
  inherits **all** the permissions and teams of the user who created it; there are no
  narrower token scopes. For read-only use, create the token from a user account whose
  role can only view.
- **Access:** must be switched on for the agency by CareLineLive support *(unverified)*.
  Whether it costs extra is not stated.
- **Responses:** `data` with `id`, `type`, `attributes`, `relationships`; `include=`
  embeds related resources. Lists are paged (`page`, `limit`, default 25) with
  `links` and `meta.pagination`. Errors use plain HTTP codes (401, 403, 404, 422).
- **Not documented:** rate limits, webhooks/events, a sandbox or test environment.
  So we poll on a schedule, and there is nowhere safe to try write calls.
- **No report or export endpoints (checked 2026-11-16):** none of the 154 paths in the
  public spec mentions report, export or download. The words "export", "csv", "xlsx",
  "download" and "webhook" do not appear; "report" appears only in incident fields
  (`reported_at`, `report_comments`) and one client field description. Exports must be
  run and downloaded from the CareLineLive web app; the API cannot fetch them.

### What it covers

- **Read and write:** carers, carer contracts, carer addresses, carer teams, leave,
  leave types, teams, qualifications, employee requirements and templates, booking
  types, transport types, work patterns, visit rounds, visit validation exceptions,
  incidents, reviews, users, and many lookup lists.
- **Clients:** list, read and create only (no update). A client record has no schedule,
  visit days or times, durations, carer counts, regular carer or package hours. Its
  attributes are reference codes, NHS number, invoice reference, `care_package_summary`,
  `contingency_plan`, client type and default team. `include=` only offers
  `default_team`, `teams`, `preferred_address`, `client_type` and `priority`.
  `meta.active` means the client has an active service contract, with no hours or days.
- **Read only:** medications (plus delete), roles, permissions, team service areas.
- **Not available:** bookings, visits, client schedule entries, carer availability,
  carer compatibility, timesheets.
- **Indirect links to bookings (read only):** task completions, incidents and
  observations each carry a `booking_id`. There is no way to list unallocated visits,
  read a booking's time, length or client, or create or allocate a booking.
- **Writes that change bookings as a side effect:** creating leave (`POST /leaves`)
  takes a `bookings_strategy` (e.g. `"unallocated"`), and finishing a carer contract
  takes `finishing_unallocate_bookings`. Either can take a carer off live bookings, so
  even "harmless" writes can disturb the rota. Another reason we stay read only.
- **Internal v1 API:** CareLineLive's own apps use it, but the docs say it is internal
  with no stability guarantees. We do not build on it. Ask CareLineLive whether booking
  read and allocation endpoints are planned.

### Live check on Loidis's account (2026-11-16)

API access is switched on and the token works. Checked with `GET` requests only, using
`tools/carelinelive_probe.py`; it prints status codes, record counts and field names,
never record values. Nothing was written.

- **Documented list endpoints:** 67 of 69 answered 200. `/document-types` timed out;
  `/clients/client-journal-entries` returned 404 although it is documented.
- **Undocumented guesses, all 404:** `/bookings`, `/bookings/unallocated`, `/visits`,
  `/appointments`, `/schedules`, `/schedule-entries`, `/client-schedule-entries`,
  `/clients/schedule-entries`, `/rota`, `/rotas`, `/rounds`, `/shifts`,
  `/availabilities`, `/carer-availabilities`, `/compatibilities`,
  `/carer-compatibilities`, `/timesheets`, `/service-contracts`, `/invoices`. There is
  no hidden booking API on this account.
- **Record counts:** 83 clients, 27 carers, 75 users, 3 teams, 22 leave records,
  19 qualifications, 8 employee requirements, 16 booking types, 8 transport types,
  0 visit rounds (rounds are not used today), 422,670 task completions.
- **Useful fields seen:**
  - Transport types: `travel_time_paid`, `mileage_paid`, `mode_of_transport` (for
    travel and payroll).
  - Booking types: `has_carers`, `max_carers`, `must_check_in`, `billable`, `payable`.
  - Leave: `carer_id`, `start`, `finish`, `duration`, `is_full_days`, `is_approved`.
  - Task completions: `booking_id`, `carer_id`, `occurrence_date`, `is_cancelled`.
    About a year of visit history (oldest record 2025-10-24): a likely source for **continuity** (who visited whom). They
    do **not** include future visits (see "Task completions" below).
  - Task completions, all attributes: `booking_id`, `carer_id`, `comments`,
    `completion_date`, `is_cancelled`, `manual_completion_at`, `manual_completion_by_id`,
    `manual_completion_reason`, `medication_dosage_given`, `occurrence_date`,
    `scheduled_task_id`, `status_id`, `when`.
- **Permissions:** the token can read everything its user can, including NHS numbers
  and DBS numbers. The API has no read-only tokens, so the token should come from a
  **dedicated view-only CareLineLive user** (see `OPEN_QUESTIONS.md`).
- **Clients (checked 2026-11-16):** `care_package_summary` and `contingency_plan` are
  empty on all 83 clients (56 active), and `include=service_contracts` is silently
  ignored. Client schedules and packages must come from an export.

### Visit rounds (the possible bridge)

- `POST /visit-rounds` takes `name` (required), `description`, `teams.data[].id`
  (required) and `bookings.data[].id` (optional booking UUIDs).
- A round has **no carer, no date and no visit order**. Its stored attributes are only
  `name` and `description`, with a link to teams.
- `PATCH` cannot change a round's bookings, and reading a round back does not list its
  bookings. To change the contents, delete the round and create a new one.

### Where booking IDs might come from

- **The bookings CSV export (main lead, checked 2026-11-16):** a second bookings export,
  `bookings_optimised.csv`, **has a booking ID on every row** (UUIDs) plus client IDs
  that match the API. See "The bookings CSV export" below. Per the user (2026-11-16) it
  is another option of the Bookings report in Reports (exact option name still to be
  noted), so it can be reproduced from the web app whenever bookings exist. Still to
  check: run it for a full generated week.
- **The .xlsx Bookings report has no booking IDs** (checked 2026-11-16, see "The
  Bookings report export" below). Still to check: the Tempaid and Hastee integration
  exports and any other report. Articles to check while logged in: "Create and use
  Rounds", "Bulk updating bookings" *(unverified)*.
- **No report or export through the API:** see "No report or export endpoints" above,
  so any export must be run and downloaded from the CareLineLive web app.
- **Task completions (checked 2026-11-16, not a source for future visits):**
  `GET /client-task-completions` returns `booking_id`, `carer_id`, `occurrence_date` and
  `is_cancelled`, but only for tasks that have been completed. The default order is
  ascending by `occurrence_date` (first page starts 2025-10-24). The last two pages
  (142 rows at `limit=100`) were all dated the day of the check, none later. The total
  (about 422,742) grew by a few rows during the check, and `completion_date` was
  populated on every sampled record (236), so a row appears to exist only once a task
  is completed. They are useful for history and continuity, not for booking IDs of
  future visits. Limit of the evidence: the two ends of the collection were sampled,
  not a full scan. Server-side `sort=-occurrence_date` and
  `filter[occurrence_date][gte]=...` both timed out at 60s on this table (support
  unconfirmed); `occurrence_date_from=` was silently ignored.

### The Bookings report export (checked 2026-11-16)

Found by inspecting the file structure only; values were not printed.

- **File:** CareLineLive "Bookings" report, `.xlsx`, one sheet named "Bookings", file
  name `bookings_report_<from>_<to>.xlsx`.
- **Layout:** two header rows. Row 1 holds group labels, row 2 the column labels.
  - "Duration" over column 6 (Planned, Confirmed, Variance are columns 6-8),
    "Cancellation" over column 17 (columns 17-19), "Original" over column 20
    (columns 20-22).
  - Columns 1 and 2 have no label. Column 1 is a **client heading**: the client name in
    "Surname, First" form, on the first row of each client's block (56 rows). Column 2
    is a **date heading** such as "16 Nov 2026" (366 rows). An importer must treat these
    as group-heading cells and carry them down to the visit rows below.
- **Columns 3-22 (row 2):** Date, Start, Finish, Planned, Confirmed, Variance, Booking
  Type, Client, Expected Carers, Allocated Carers, Carer(s), Transport Type, Status,
  Carer Notes, Cancelled, Cancellation Reason, Cancellation Charged?, Original Start,
  Original Finish, Original Planned.
- **Types:** Date, Start, Finish, Original Start and Original Finish are Excel
  datetimes. Planned and Original Planned are "H:MM" text. Expected and Allocated
  Carers are numbers. Cancelled is boolean. Confirmed and Variance are mostly empty
  (only visits already confirmed). Status is mostly empty (seen: Confirmed,
  Cancelled). Transport Type is "Car" or empty.
- **No booking IDs.** No column holds UUIDs or numeric IDs. Clients and carers appear
  by name only, so matching to API records must be by name. There are no addresses
  (those come from the API). The report therefore does not enable the visit-round
  bridge.
- **Week 2026-11-16 to 2026-11-22:** 1,069 visits, 56 clients, 96 distinct values in the
  Carer(s) cell (double-ups list two carers).
  - Booking types: Morning Visit 343, Bed Visit 245, Tea Visit 221, Lunch Visit 207,
    Client Respite 30, Domestic Care 16, Waking Night 7.
  - Carers: 733 single visits covered, 328 double-ups covered, 7 visits expecting 1
    with 2 allocated, 1 unallocated. 4 cancelled.
- **Weeks 2026-11-23 to 2026-11-29 and 2026-11-24 to 2026-11-29:** both exports held only
  the header rows, no visits. Explained (user, 2026-11-16): the coordinator generates the
  next bookings only "when there is availability to actually make it", so bookings exist
  up to 22 Nov and none after. Not a filter problem.
- **Use:** enough input for the export importer (times, durations, visit types, carer
  counts, current allocations, and a real week to compare the engine against).

### The bookings CSV export (checked 2026-11-16)

Found by inspecting structure and counts only; values were not printed.

- **File:** `bookings_optimised.csv`. Produced as another option of the Bookings report in
  Reports (per the user, 2026-11-16; exact option name as shown on screen to be noted
  next time). The help centre says "Optimised" report variants exist (see "Reports in
  CareLineLive" below).
- **Layout:** flat CSV, comma-separated, one header row, no group-heading rows (unlike the
  .xlsx report, nothing to carry down). 27 columns: BookingId, ClientId, Date
  (dd/mm/yyyy), Start, Finish (hh:mm:ss), Duration (h:mm), ConfirmedDuration,
  DurationVarianceSeconds, BookingType, ClientName, ClientReferenceCode, ExpectedCarers,
  AllocatedCarers, Carers, Status, CarerNotes, IsCancelled, CancellationReason,
  CancellationCharged, OriginalStart, OriginalFinish, OriginalDuration, HasBeenInvoiced,
  ServiceContract, ServiceContractType, Unplanned, Team.
- **Rows:** 461, covering 2026-11-17, 18 and 19 (153, 153 and 155 rows). These were
  future visits at the time of the check.
- **IDs:** BookingId is a UUID on every row, all 461 distinct. ClientId holds UUIDs, 56
  distinct, and all 56 match client IDs returned by the read-only `GET /clients` (83
  clients). So the export uses the same IDs as the API and clients can be matched by ID.
- **Carers by name only:** no carer ID column. Multi-carer visits list names
  comma-separated (143 rows). Carers still have to be matched to the API by name.
- **Empty in this file:** ConfirmedDuration, DurationVarianceSeconds, Status, CarerNotes,
  IsCancelled, CancellationReason, CancellationCharged, Unplanned. HasBeenInvoiced is
  "No" on every row.
- **Category values seen:**
  - BookingType: Morning Visit 147, Bed Visit 105, Tea Visit 95, Lunch Visit 87, Client
    Respite 14, Domestic Care 10, Waking Night 3.
  - ExpectedCarers: 1 on 321 rows, 2 on 140. (Expected, Allocated): (1,1) 318, (2,2)
    140, (1,2) 3.
  - Team: Dorchester 155, Leeds 167, Weymouth 119, "Dorchester, Weymouth" 20.
  - ServiceContractType: "Client Contract- Dorset" 283, "Service Contract- Leeds" 178.
  - Start equals OriginalStart on 443 of 461 rows (18 were moved).
- **Difference from the .xlsx report:** the CSV has booking and client IDs, flat
  columns, ServiceContract, ServiceContractType, Team and invoicing fields, and no group
  headings; the .xlsx has none of the IDs and has Transport Type, which the CSV lacks.
  Both name carers rather than giving IDs.
- **Consequence:** an export with booking IDs for future visits exists, which is what the
  visit-round bridge (Stage A) needs. **Decision 1 is still open.** It needs (1)
  a check that the CSV, run for a full generated week, has every day present and a
  booking ID on every row (it is reproducible from Reports, but only once bookings exist),
  and (2) the user's explicit approval before any write (creating visit rounds).

### Reports in CareLineLive (checked 2026-11-16)

How reports work, from the public help centre
([Reports](https://support.carelinelive.com/hc/en-us/articles/5947875664159-Reports),
read 2026-11-16): choose Reports, then a report type, timeframe and teams, then View
Report. All reports export to PDF and some to Excel or CSV (exports may add columns).
"Optimised" variants (from June 2026) use pre-built database views, are faster and should
give the same figures, with columns possibly in a different order.

Reports run on 2026-11-16 for 2026-11-16 to 2026-11-22, all teams, saved as .xlsx in
`data/private/` (git-ignored). Each file has a data sheet plus a "Filters" sheet recording
From, To, Grouped by/Subject and Team. Inspected by structure, labels, filter sheets and
totals only.

| Report | What it gave |
|---|---|
| Carer Availability | **Empty** (header rows only). Columns: Available and Unavailable, each Scheduled, Ad-hoc, Total, grouped by carer. Carer availability is not recorded in CareLineLive |
| Carer Work Patterns | **Empty** (header row only). Columns: Carer, Work Pattern, Week, Min, Max, Expected, Worked, Bookings, Shifts (all hours). No work patterns are assigned |
| Continuity | Sheet "Continuity" (Client, Carer, Bookings, Percentage): 297 client-carer pairs across 56 clients, plus "Client Matrix" and "Carer Matrix" grids (21 carers x 56 clients). Gives who usually visits whom, without the API |
| Mileage | Subject Carers; Booked, Payable and Paid, each Miles and Travel Time; one row per carer (21) plus a "Total" row. Week totals: 4,594.5 booked miles, 191 booked travel time (unit not stated, probably hours), 2,721.8 payable miles; payable travel time and all Paid columns are 0. Use: a "before" baseline to compare the engine's plan against |
| Bookings, 2026-11-23 to 2026-11-29 | Empty (headers only), like the 24-29 Nov one: bookings not yet generated |

- **Carers working:** 21 carers worked that week (Continuity and Mileage agree), against
  27 carers in the API.
- **No compatibility, schedule or rounds export:** no report or export lists carer
  compatibility rules, client schedule entries or rounds. That data must come from the
  coordinator or CareLineLive (added to the "ask CareLineLive" item).
- **Availability seems to be held outside CareLineLive** (our inference: the Carer
  Availability report is empty, and the user says bookings are generated once
  availability is known). The engine's availability input must come from the
  coordinator (PLAN step 4); where they keep it is an open question.

### What this means for Stage A (rota companion)

- We **can sync** carers, clients and leave automatically (read only, per `CLAUDE.md`).
- We **cannot read or write bookings** through the API. Visits must come from a
  CareLineLive export or report.
- **Bridge, if we get booking IDs:** create one round per carer per day, named for the
  carer and date (e.g. "K004 Tue 18 Nov"), holding that carer's bookings. The
  coordinator drags each round onto its carer: one drag per carer per day instead of
  one per visit, then preview and save as usual. Creating rounds is a write, so it
  needs the user's explicit approval first (`CLAUDE.md` rule 2).
- CareLineLive takes API feature requests; we can ask for booking read and allocation
  endpoints, and for a way to export carer compatibility rules, client schedule entries
  and rounds.
- **When the engine runs (user, 2026-11-16):** the coordinator generates the next
  bookings once they know staff availability; there is no fixed day. The engine runs
  after bookings are generated and before they are published, triggered by the
  coordinator rather than on a weekly slot.

## Things to align in our engine (next)

1. Compatibility model with Warn / Exclude / Preferred / Only, by carer, gender,
   qualification and requirement, so Loidis's existing settings import directly.
2. "Fill gaps" mode: keep carers already set on schedule entries (regular carers) and
   only allocate unallocated bookings, as an option beside "re-plan everything".
3. Multi-week schedule cycles and "restrict times" from schedule entries.
4. Carer service areas.
5. Two-carer visits where the carers arrive at different times or stay for different
   lengths.
6. Restrictions as settings (on or off), matching CareLineLive.
