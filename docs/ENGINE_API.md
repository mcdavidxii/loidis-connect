# Engine API (contract between the web app and the Python engine service)

Status: **first version, implemented**, 2026-11-17. Written for the engine test described
in [`MVP.md`](MVP.md). The Python service is in `service/` (see `service/README.md`); the
web app (`web/`) also implements this same contract as a **mock** with made-up data. The
service must match this contract; if it needs to differ, change this file first. Changes
made while building the service are listed under [Service notes](#service-notes).

## Principles

- **Nothing is stored.** Uploaded files and results exist only for the life of a run and
  are deleted by `DELETE /runs/{id}` (the web app sends it when the page closes) and by a
  server-side time limit (the mock uses 30 minutes).
- **No personal data in errors or logs.** Error messages name row counts, column names
  and IDs only, never names, addresses or health details.
- **Read-only towards CareLineLive** (`CLAUDE.md` rule 2). `POST /sync` only makes `GET`
  calls to CareLineLive. The CareLineLive token lives on the server only.
- **The engine only suggests.** Nothing here writes a rota anywhere.
- The browser never talks to this service directly. It calls `/api/engine/...` on the
  Next.js server, which forwards to `ENGINE_API_URL` (or answers from the mock when that
  variable is not set). Paths below are relative to the service root.

Errors are `{ "error": "<plain message>" }` with a 4xx or 5xx status.

## Endpoints

### `GET /health`
`{ "ok": true, "mock": false }`. `mock` is true only for the built-in mock; the web app
shows a "Demo mode" label when it is. The real service adds `"fake_api": true` when it is
running on made-up CareLineLive data (`ENGINE_FAKE_API=1`).

### `POST /runs`
`multipart/form-data`:

| Field | Type | Notes |
|---|---|---|
| `bookings` | file, CSV | Required. One week, from CareLineLive Reports > Bookings (the optimised CSV, 27 columns, see [Bookings CSV](#bookings-csv)). Needs a booking ID on every row. The allocated carers are the current rota. |
| `settings` | file, JSON | Optional. The [settings file](#settings-file). |
| `continuity` | file, xlsx | Optional. Continuity report for the 4 weeks before. |
| `mode` | `new` or `improve` | Required. |
| `change_cost_pence` | int | Improve mode: how much a change must save, in pence. The web app offers 300, 500, 1000 (default) and 2000. A carer's paid time is about 21p a minute. Ignored in `new` mode. |
| `locks` | JSON object | Optional. `{ "<booking_id>": "<carer id>" }`. Those bookings keep that carer. Time-critical bookings (see settings) never move in either mode. |

Returns `201 { "run_id": "<opaque string>" }`. A bad bookings file or settings file is
refused at once with `422` and a plain message (counts and column names only). Problems
found later (for example a carer name that is not matched, see `POST /sync`) end the run
with `status: "failed"` and the same kind of message.

### `GET /runs/{id}`
```json
{ "status": "queued|running|done|failed", "progress": 0.0, "message": "Planning day 3 of 7", "result": { } }
```
`progress` is 0 to 1. `message` is plain text with no personal data (when `status` is
`failed` it says why). `result` is present only when `status` is `done`. Poll every 0.5
to 2 seconds. A real run takes a few minutes (`search_seconds_per_day` times 7, with the
planning regions searched at the same time); the mock fakes about 3 seconds.

### `result`
```json
{
  "mode": "new | improve",
  "change_cost_pence": 1000,
  "teams": { "<team name>": { "<report>": "..." } },
  "comparison": { "engine": { "<metrics>": "..." }, "current": { "<metrics>": "..." } },
  "changes": [ ],
  "time_notes": [ ],
  "warnings": [ { "code": "no_dbs_date", "message": "..." } ]
}
```

**`teams[name]` (report)** follows the engine report (`engine/loidis_rota/report.py`,
example `viewer/rota.json`). Teams are planned separately. Fields the web app reads:

- `week_start` (Monday, `YYYY-MM-DD`), `days` (`mon`..`sun`).
- `metrics`: `visits, filled, unfilled, fill_rate, care_hours, travel_hours, miles,
  continuity_rate, hours_min, hours_median, hours_max, hours_stdev, visits_moved`.
  Hours per carer are care hours only (what the weekly maximum limits; travel is in `travel_hours`), each home carer counted once with their hours summed across regions (see Service notes).
- `carers[]`: `id, name, area, gender, skills, contracted_minutes, max_minutes,
  scheduled_minutes, travel_minutes, miles, availability[{day,start,end}], issues[]`.
  Minutes are after midnight; `day` 0 is Monday. **`name` is an addition** to the engine
  report (which has IDs only) so the roster can show names.
- `clients[]`: `id, ref, area, recent_carers[]`. **`ref` is an addition** (the client
  reference code, not a name).
- `visits[]`: `id, booking_id, client_id, day, preferred_start, window, duration,
  carers_needed, kind, booking_type, assigned[], start|null, unfilled_reason,
  unfilled_detail[]`, plus these additions: `current_assigned[]` (carer ids in the
  current rota), `moved` (carer(s) or time differ from the current rota), `locked`
  (time-critical or locked by the coordinator) and `lock_reason`.
- `routes{ <carer id>: { <day>: [ { visit_id, client_id, start, end, travel_before,
  miles_before, shared_with[] } ] } }`.

**`comparison`**: the same `metrics` object for the whole agency, once for the engine's
result and once for the current rota scored with the same travel model. The web app
shows the two side by side, with the difference.

**`changes[]`** (improve mode; empty in new mode), sorted by date and time:
```json
{ "booking_id": "B10060", "client_ref": "CL-009", "date": "2026-11-16",
  "booked_start": "08:05", "new_start": null,
  "from_carers": [], "to_carers": ["Carer H"],
  "kind": "carer", "reason": "fills an unallocated booking" }
```
`kind` is `carer` (a different carer, same time) or `time_with_change` (a new start time,
which then needs `new_start`: a different carer and a new time, or the same carer, with
`from_carers` equal to `to_carers`, whose start must move to fit other changes to their
day). `reason` is short plain
text, for example `saves 18 min travel`, `familiar carer`, `fills an unallocated booking`,
`fairer hours`; more than one may be joined with a comma. Carer fields are display names
because the coordinator applies the change in CareLineLive by hand.

**`time_notes[]`** (improve mode): same carer, only the start time shifts to fit the
travel estimate. Shown as "Tight gaps to check", not as changes.
```json
{ "booking_id": "B10031", "client_ref": "CL-007", "date": "2026-11-17", "carer": "Carer C",
  "booked_start": "08:50", "new_start": "08:58", "kind": "time_note",
  "reason": "Same carer; 8 min later to fit the travel time. Check the gap." }
```

**`warnings[]`**: rules that were not checked because an input is missing, or need
attention (`no_settings`, `no_working_hours`, `no_dbs_date`, `no_training_date`,
`expired`, `no_weekly_max`, `agency_defaults`, `unallocated`). `message` may list carer
IDs, client reference codes and counts, never names. The service also raises
`no_continuity`, `continuity_unreadable`, `missing_address`, `carer_no_location`,
`transport_defaulted`, `clients_not_in_settings`, `unmapped_team`, `cross_region_carers`,
`carer_no_team`, `hours_padded` and `lock_ignored` (see [Service notes](#service-notes)). The trial's placeholders (DBS and training 2099, empty
rules) must not be used to fill gaps.

### Exports (layout of 2026-11-17, replaces the first draft)
The coordinator copies the export into CareLineLive by hand, day by day, carer by carer, so
each line is one instruction. All exports are UTF-8 **with BOM** (Excel shows names and pound
signs), dates `dd/mm/yyyy`, times `HH:MM`, sent as downloads (`Content-Disposition`), and end
with a blank `Done` column for ticking. Carer and client names are the display names of the
result (personal data for the coordinator only).

### `GET /runs/{id}/export/allocation.csv` (New rota)
Columns, in order: `Day, Date, Carer, Start, End, New start, Client, Booking type, Booking ID,
Double-up with, Compared with current, Done`. One row per carer per booking (a double-up has a
row for each carer; `Double-up with` names the other), sorted by date, then carer, then start.
`Start`/`End` are the booked times; `New start` is blank if the plan keeps the booked start.
`Compared with current` is `No change`, `Changed from <carer(s)>` or `Was unallocated`. Unfilled
bookings come first on each day with `Carer` = `Unallocated` and the reason in
`Compared with current`.

### `GET /runs/{id}/export/changes.csv` (Improve my rota)
Columns, in order: `Day, Date, Give to, Booked time, New start, Client, Booking type, Booking ID,
Action, Currently with, Required, Why, Done`. One row per booking to change, sorted by date, then
`Give to`, then booked start. `Booked time` is `HH:MM–HH:MM` (en dash). `Action` is `Allocate`
(unallocated booking), `Reassign`, `Reassign + change time` or `Change time` (same carer in
`Give to`). `Currently with` is the current carer(s) or `Unallocated`. `Required` is `Yes` when
`forced_by_rules`, else blank. `Why` is the change reason. Within-tolerance shifts and time notes
are not in this file.

### `GET /runs/{id}/export/notes.csv` (Improve my rota)
Columns, in order: `Day, Date, Booked time, New start, Client, Booking type, Booking ID,
Currently with, Why, Shift (min), Note, Done`, sorted by date, carer, booked start. One row per
entry of `time_notes` (same carer, start moved). `Shift (min)` is the size of the shift (no sign;
`New start` shows the direction). `Note` is `within N min – no edit needed` (N is
`arrival_tolerance_minutes`, now also in the result) or `Short gap – check travel`. In New rota mode
the file has only the header.

### `DELETE /runs/{id}`
Deletes the uploaded files and the result. `{ "deleted": true }`. Idempotent in effect
(a second call returns 404).

### `POST /sync`
Reads carers, clients, addresses, teams, transport types and leave from CareLineLive
(GET only). Optional multipart fields `settings` and `bookings` let the service say what
is new or unmatched. Returns:
```json
{
  "counts": { "carers": 8, "clients": 15, "addresses": 14, "leave": 3 },
  "carers":  [ { "id": "K001", "name": "Carer A", "teams": ["Leeds"] } ],
  "clients": [ { "id": "C01", "ref": "CL-001", "team": "Leeds" } ],
  "missing": {
    "addresses": ["CL-014"],
    "carers_not_in_settings": ["K008"],
    "clients_not_in_settings": ["CL-003"],
    "unmatched_booking_carers": ["Carer H (Dorset)"]
  }
}
```
`missing.addresses` and `clients_not_in_settings` use client reference codes.
`unmatched_booking_carers` are carer names found in the bookings CSV that match neither
an API carer nor a saved name match. The web app adds the listed carers and clients to
the settings with blank rules, and asks the coordinator to confirm each unmatched name;
confirmed matches go into `carer_name_matches`.

### Sample endpoints
`GET /sample/bookings.csv` and `GET /sample/settings.json` return made-up files. The
mock's match its own agency. The real service serves its own made-up files too (they
match its fake API mode, not a real CareLineLive account).

### `POST /validate` (service only, optional)
Multipart field `bookings`. Returns the checks the service makes before a run (`rows,
visits, clients, carers, double_ups, cancelled, unallocated, week_start, problems,
notes`), with the same plain messages. The web app does not need it.

## Bookings CSV

The optimised bookings CSV from CareLineLive, 27 columns (`docs/CARELINELIVE.md`):
BookingId, ClientId, Date (dd/mm/yyyy), Start and Finish (hh:mm:ss), Duration (h:mm),
ConfirmedDuration, DurationVarianceSeconds, BookingType, ClientName, ClientReferenceCode,
ExpectedCarers, AllocatedCarers, Carers (names, comma-separated for double-ups), Status,
CarerNotes, IsCancelled, CancellationReason, CancellationCharged, OriginalStart,
OriginalFinish, OriginalDuration, HasBeenInvoiced, ServiceContract, ServiceContractType,
Unplanned, Team. Required: BookingId, ClientId, Date, Start, Duration, BookingType,
ClientReferenceCode, ExpectedCarers, Carers, IsCancelled, Team. Column names are matched
ignoring case, spaces and punctuation; other columns are ignored (and counted). Cancelled
rows are ignored. All live rows must fall in one Monday to Sunday week. `ClientId` is the
CareLineLive client ID, which is the `id` of a client in the settings file; carers appear
by name only. The `Team` of a client's rows decides the planning region.

## Settings file

A JSON file the coordinator downloads and keeps (see `MVP.md`, "No database for now").
It holds personal data. Versioned so that a later release can read old files.

```json
{
  "version": 1,
  "saved_at": "2026-11-17T09:30:00Z",
  "agency": {
    "move_window_minutes": 30,
    "move_cost_pence_per_min": 15,
    "continuity_weight_pence": 1000,
    "hours_balance": "equal_share_within_team",
    "search_seconds_per_day": 10,
    "change_cost_pence": 1000,
    "pay_pence_per_hour": null,
    "mileage_pence_per_mile": null,
    "travel_time_paid": null,
    "team_regions": { "Leeds": "Leeds", "Dorchester": "Dorset", "Weymouth": "Dorset" }
  },
  "carers": [
    {
      "id": "K001", "name": "Carer A", "teams": ["Leeds"],
      "working_hours": {
        "mon": [ { "start": "07:00", "end": "14:00" } ],
        "fri": [ { "start": "22:00", "end": "07:00" } ]
      },
      "weekly_max_hours": 35,
      "skills": ["medication", "hoist"],
      "dbs_expiry": "2027-06-30",
      "training_expiry": "2027-03-31",
      "active": true
    }
  ],
  "clients": [
    {
      "id": "C01", "ref": "CL-001", "team": "Leeds",
      "gender_preference": null,
      "do_not_send": ["K002"],
      "safeguarding_bar": [],
      "required_skills": ["hoist"],
      "time_critical_booking_types": ["Medication Call"]
    }
  ],
  "carer_name_matches": [ { "booking_name": "Carer H (Dorset)", "carer_id": "K008" } ]
}
```

| Field | Rules |
|---|---|
| `version` | Integer, currently `1`. A service must reject a version it does not know, with a plain message. |
| `agency.*` | The agency settings table in `MVP.md`. `null` for the pay, mileage and travel-time fields means "engine default" (and raises the `agency_defaults` warning). `change_cost_pence` is overridden by the `change_cost_pence` form field of `POST /runs`. |
| `agency.team_regions` | **Added by the service.** Which planning region each CareLineLive team belongs to; teams in the same region are planned together and each region is one entry in `result.teams`. Optional; the default is the mapping shown (Leeds; Dorset = Dorchester + Weymouth). A client's team comes from the `Team` column of the bookings; a carer's regions come from `carers[].teams` (else CareLineLive, else the regions of the visits they are on now). |
| `carers[].working_hours` | Keys `mon`..`sun`; each a list of blocks with `HH:MM` `start` and `end`. An `end` earlier than or equal to `start` means the block ends the next day (a night). **A carer with no blocks at all is available any time** (see `available_any_time`); a carer with some blocks is only available in them (a missing day or empty list on such a carer means not working that day). |
| `carers[].available_any_time` | **Added by the service.** Boolean, default `true` (also when the key is missing, and for carers new to the file). With no working-hours blocks: `true` = available 00:00 to 24:00 every day they are not on leave, and the engine chooses their hours; `false` = not planned. Explicit blocks always win. |
| `carers[].weekly_max_hours` | Number or `null` (rule not checked, warning raised). |
| `carers[].dbs_expiry`, `training_expiry` | `YYYY-MM-DD` or `null`. `null` means that rule is not checked, with a warning. A date before the visit means the carer is not planned for it. |
| `carers[].active` | `false` for carers who are employed but not on the rota. |
| `clients[].gender_preference` | `"female"`, `"male"` or `null`. |
| `clients[].do_not_send` | Carer IDs. Never booked; may be suggested as a last resort with a warning, as the engine does today. |
| `clients[].safeguarding_bar` | Carer IDs. Never booked or suggested. |
| `clients[].time_critical_booking_types` | Booking types (for example `Morning Visit`) whose visits must not move from their booked time. |
| `carer_name_matches` | Maps a carer name as written in the bookings CSV to an API carer ID. |

The web app tolerates missing optional fields when reading (it fills defaults), and
always writes the full shape.

## Mock behaviour (the web app's stand-in)

- Always plans its own made-up agency (2 teams, 8 carers, 15 clients, about 116 visits),
  so uploaded bookings are only checked for presence. It does honour the posted
  settings (hours, skills, active, DBS and training dates, client rules, time-critical
  types), `mode`, `change_cost_pence` and `locks`, so the settings screens have a visible
  effect.
- A simple greedy allocator, not the real engine. Numbers are not meaningful.
- `GET /runs/{id}` reports a fake `queued`, then `running` with `progress` rising over
  about 3 seconds, then `done`.
- Runs are kept in memory only and purged after 30 minutes or on `DELETE`.

## Service notes

Differences and additions found while building `service/` (2026-11-17). None changes what
the web app already sends or reads.

- **Bookings CSV format.** The contract only said "from Reports > Bookings". The service
  reads the real 27-column optimised CSV ([Bookings CSV](#bookings-csv)). **The web app's
  own pre-upload check (`web/lib/csv.ts`) does not understand that format** (it looks for
  `client ref`, ISO dates and `;` or `|` between carer names), so with a real file it
  reports a problem and blocks the Upload step. The mock's sample CSV uses the guessed
  format. The web app needs its check updated to the real columns.
- **`changes[].kind = time_with_change`** also covers the same carer whose start moves
  because other changes touch their day (`from_carers` equals `to_carers`); the contract
  only described a different carer with a new time.
- **`agency.team_regions`** is new (above). It is kept inside `agency` because the web
  app preserves unknown `agency` keys when it reads and writes the settings file, but
  drops unknown top-level keys.
- **Unmatched carer names stop a run** (status `failed`, message with the count). The
  web app is expected to have confirmed them via `POST /sync` first.
- **Missing DBS or training dates and weekly maximum are not filled in.** The engine
  needs a date, so the service gives it `date.max` (no expiry, rule unchecked), never a
  real-looking date, and raises the warning; the carer's `issues` say "rule not checked".
- **Time-critical visits at the edge of a shift.** A visit with window 0 cannot move, so
  the carer must be able to travel there first; the service stretches a working-hours
  block by the carer's travel time (at most 90 minutes) where a time-critical visit would
  otherwise not fit, and raises `hours_padded` (the trial padded locked visits the same way).
- **Locks on double-ups** keep the named carer plus the other carers currently on the
  visit; if the others are not known the lock is ignored with `lock_ignored`.
- **Familiar carers (continuity).** From the uploaded Continuity report (a carer with at
  least 20% of a client's visits); without one, the carers on the current rota, with a
  `no_continuity` warning.
- **Result privacy.** `carers[].name` is a carer's display name from the settings file
  (else CareLineLive); no client names, home coordinates or addresses are in the result.
  `unfilled_detail` shows carer display names and client reference codes.
- **Run expiry** is 60 minutes (configurable), not 30 as in the mock.
- **`POST /sync`** lists every CareLineLive carer and client; a client's `ref` comes from
  CareLineLive if it has one, else from the bookings file; teams from CareLineLive's
  default team, else the bookings' `Team`. `carers_not_in_settings` lists active carers
  only. `addresses` counts clients with a geocoded address.

### Service notes: second round (carers in two regions, forced changes, arrival tolerance)

- **Carers with visits in more than one region** are no longer planned independently. A
  carer's home region is where the current rota gives them most visits (ties: the earlier
  region); with no current visits it is the region of their settings team (the first, if
  several). In their home region they get no default hours on days they have visits in
  another region, and their weekly maximum is reduced by those minutes. In the other
  region they are a guest: availability only around their own visits there (plus 90 min
  travel slack), no share of the equal-hours target, and those visits are locked to them
  (`locked: true`, `lock_reason: "kept: carer's home area is elsewhere"`, window 0). This
  applies in both modes. Warning `cross_region_carers` says this and lists the carer IDs.
  A carer with no team and no visits is placed in the busiest region (`carer_no_team`).
- **Changes forced by rules.** In improve mode, when a current carer is not allowed (do-not-send,
  safeguarding bar, gender preference, missing skill, on leave, expired DBS or training,
  outside working hours, no working hours, over weekly maximum), the change's `reason`
  starts with a plain statement, for example `current carer not allowed: do-not-send` or
  `current carer not allowed: on leave`, and the change has `forced_by_rules: true`. Other reasons
  may follow. The result has a new top-level `change_summary` (null in new mode):
  `{ total, forced_by_rules, fills_unallocated, for_travel_continuity_hours,
  new_time_needed, time_notes, time_within_tolerance }`. Show forced changes separately from
  the others. The three counts add up to `total`.
- **Arrival tolerance.** `agency.arrival_tolerance_minutes` (new, integer) goes to the engine.
  If the settings file does not have it, 15 is used (a placeholder to confirm) and the
  warning `arrival_tolerance_default` is raised. Every change now has `new_time_needed`
  (boolean): false means keep the booked time (`kind: "carer"`, `new_start: null`); true
  means change the time to `new_start` (`kind: "time_with_change"`). A same-carer start
  shift beyond the tolerance on an untouched day is a `time_notes` entry with
  `kind: "time_note"` (check the gap); a shift within the tolerance is a `time_notes`
  entry with `kind: "time_within_tolerance"` (no change needed). The `changes.csv` export
  lists both kinds in its `kind` column. The web type for `TimeNote.kind` needs to accept
  both values.

### Service notes: why fewer bookings are filled than in the current rota

- Each unfilled visit has `unfilled_cause` (null when filled): `rules` (too few carers are
  allowed to do it: skills, gender, do-not-send, bar, leave, expired DBS or training),
  `hours` (enough are allowed but too few work at that time), `weekly_max`, or
  `travel_or_booked` (enough work then, but they are busy or too far away). `unfilled_reason`
  says it in plain words.
- New top-level `fill_check`: `unfilled`, `because_rules`, `because_hours`,
  `because_weekly_max`, `because_travel_or_booked` (these four add up to `unfilled`),
  `unfilled_but_filled_in_current_rota`, `current_rota_fully_staffed` and
  `current_rota_feasible` (how many of those the engine's rules could keep: every carer
  passes the rules, is working then, and can reach the visit after their previous visit
  under the travel model). The `unallocated` warning spells out the same counts, and
  `current_rota_not_feasible` is raised when the current rota fills visits the engine
  cannot keep. Show these next to the fill figures so a drop in fills is explained.
- `agency.search_seconds_per_day` is the engine's search time for each of the 7 days, per
  region (the service uses the value in the settings file, 30 if absent). A run takes about
  that times 7 plus about 10 seconds; regions are searched at the same time. On the made-up
  week, 2, 5, 12 and 30 seconds a day gave the same fill (47, 46, 46, 46 unfilled) and, at
  5 and 30, identical travel (55.7 hours), but 30 took 301 s and 5 took 48 s. Suggested UI
  default: 5 to 10 seconds a day; offer 30 as "slower, may be slightly better" for the real
  week, where the trial used 30.

### Service notes: real-week check (hours, outside-hours visits, weekly maximum)

- **Hours per carer** (`hours_min`, `hours_median`, `hours_max`, `hours_stdev`) are **care hours
  only**, as in the trial (the weekly maximum limits care, not travel; travel is in
  `travel_hours`). Each home carer is counted once, with their hours summed across regions, and
  guest entries (no equal-hours share) are left out. A region's own `metrics` count only that
  region's hours for its home carers.
- **Visits moved.** `visits_moved` is visits whose carers or start differ from the current rota.
  The trial's "started off booked time" is now `visits_started_off_booked_time`, and
  `visits_carer_changed` counts visits whose carers differ (including ones the current rota left
  unallocated); both are in every `metrics` object (0 for the current rota).
- **Outside-hours visits.** A visit the current rota fully staffs, that no carer allowed to do it
  is working at (even allowing for its move window), stays with its current carers (window 0,
  their availability stretched by 90 minutes around it), as the trial did for nights. Both
  modes. Warning `locked_outside_hours` gives the count; `lock_reason` is "outside working hours:
  kept with current carer(s)". Partly staffed or unstaffed visits are not locked.
- **Weekly maximum.** A change away from a carer who is over the cap in the current rota has the
  reason `current carer over weekly maximum` and is counted as forced (`forced_by_rules`) only
  when the carer would still be over the cap with that visit kept
  (`current carer not allowed: over weekly maximum`).

- **Search time default.** `agency.search_seconds_per_day` defaults to 10 when the settings file lacks it
  (Quick); the UI offers 10 (Quick) and 30 (Thorough). Any value from 1 to 120 is accepted; outside that
  range the settings file is refused with a 422. A run takes about 7 times this plus under 10 seconds.

### Service notes: display names, travel modes, current routes

- `teams[].clients[].display_name` is a short client name for the coordinator's screens,
  "Surname, I" (for example "Smith, J"), built from the bookings CSV's `ClientName` with titles
  (Mr, Mrs, Miss, Ms, Dr, ...) removed. Like carer names, it is **personal data shown to the
  coordinator only**: it exists in the result returned to the web app, is deleted with the run,
  and is never written to a log or an error message. No other client name is in a result.
- `teams[].carers[].travel_mode` is `car`, `foot` or `bus`, as the engine uses it.
- `teams[].current_routes` is the current rota's routes in the same shape as `routes`
  (`{ <carer id>: { <day>: [ { visit_id, client_id, start, end, travel_before, miles_before,
  shared_with[] } ] } }`), from the scoring of the current rota with the same travel model.

### Service notes: availability any time, exports
- **Available any time (decision 2026-11-17).** A carer with no working-hours blocks is available at
  any time unless `available_any_time` is `false`. The engine gets one block a day from 00:00 to
  48:00 (a block ending at 24:00 could not hold a visit that runs past midnight, because the engine
  needs the whole visit inside the block; the next day's block starts at 00:00 again, and the
  engine's rest after anything ending past midnight stops a late-night carer starting early). In
  the result the block is shown as 00:00 to 24:00. The weekly maximum, equal-hours balancing and
  leave still apply. The `no_working_hours` warning is now raised only for a carer marked not
  available with no hours. A quiet **notice** replaces it: the result has `notices`, a list of
  `{ code, message }` (not warnings), with `available_any_time` and a count: "N carer(s) are
  available any time (no working hours set), so the engine chooses their hours".
- **Long days.** Nothing stops one carer getting a very long or split day (for example 06:00 and
  23:00 visits): there is no per-day hours limit, no span limit and no break rule; only the weekly
  maximum (a carer with none set has no limit at all) and the 11-hour rest after anything that runs
  past midnight. Proposed, not built: settings `max_hours_per_day` and `max_span_hours` (first start
  to last end), done in the engine as a cap on the day's work and `SetSpanUpperBoundForVehicle` on
  the time dimension.
- **Exports** are laid out as above (UTF-8 with BOM, `dd/mm/yyyy`, `HH:MM`); the old column lists
  are gone and `notes.csv` is new. The result has `arrival_tolerance_minutes`.

### Service notes: wording (coordinator language)
Every coordinator-visible text is plain language and never says engine, solver, optimise, model,
penalty, feasible or pence per minute (a test checks the result and the CSVs). Texts:
- **Change reasons** (joined by commas, at most three): `current carer not allowed: <do-not-send |
  safeguarding bar | gender preference | missing skill: x | on leave | off sick | DBS expired | training
  expired | outside working hours | no working hours | over weekly maximum>`, `current carer over weekly
  maximum`, `fills an unallocated booking`, `saves N min travel`, `familiar carer`, `fairer hours`,
  `better overall (travel and hours)`, `start moves to fit the other changes to this carer's day`.
- **Unfilled reasons** (`unfilled_reason`, by `unfilled_cause`): `rules`: "No carer meets the rules for
  this visit (skills, gender, not allowed or leave)." or "This visit needs N carers but only K meet the
  rules for it (...)."; `hours`: "No carer is working then." or "Only K carer(s) working then; this visit
  needs N."; `weekly_max`: "The carers who are working then are at their weekly maximum."; `travel_or_booked`:
  "Carers are busy or too far away at this time (nearest: ...)." (the nearest carers and what kept them busy).
- **Kept-as-is reasons** (`lock_reason`): "kept with the carer who already has it (outside everyone's hours)",
  "kept: carer's home area is elsewhere", "locked by coordinator", "time-critical booking type".
- **Notes**: reasons "Same carer; N min later to fit the travel time. Check the gap." and "Same carer; N min
  later, within the N min arrival tolerance. No change needed."; `notes.csv` `Note`: "within N min – no edit
  needed" or "Short gap – check travel".
- **allocation.csv**: `Carer` "Unallocated"; `Compared with current` "No change", "Changed from <carer(s)>",
  "Was unallocated" (or the unfilled reason for an unallocated row). Column headers are unchanged.
