# Loidis Connect: engine service

A small HTTP service around the rota engine (`../engine`, imported as the library
`loidis_rota`, not copied). It implements the contract in `../docs/ENGINE_API.md`, so the
Next.js app in `../web` can switch from its mock to this service by setting
`ENGINE_API_URL`. Built for the engine test described in `../docs/MVP.md`.

The engine only suggests. Nothing here writes a rota anywhere, and the only calls to
CareLineLive are `GET` requests.

## Run it

```bash
cd service
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt     # Windows; on Linux/macOS: .venv/bin/python

# fake API mode: made-up carers, clients, addresses, teams and leave, no network at all
ENGINE_FAKE_API=1 .venv/Scripts/python -m loidis_service --port 8000

# make made-up input files (bookings.csv in the real 27-column format, settings.json,
# continuity.xlsx) to use with it
.venv/Scripts/python -m loidis_service.fake_data some_folder
```

Then point the web app at it (see `../web/README.md`):

```bash
cd ../web
ENGINE_API_URL=http://127.0.0.1:8000 npm run dev      # or: npm run build && npx next start
```

**Real mode** is the same command without `ENGINE_FAKE_API`, with the CareLineLive details
in the environment of the service process:

| Variable | Meaning |
|---|---|
| `CARELINE_API` | The CareLineLive API token (use a view-only user). Never logged or returned. |
| `CARELINE_DOMAIN` | Your CareLineLive domain, for example `loidis` or `loidis.carelinelive.app`. |
| `CARELINE_ENV_FILE` | Alternative to the two above: path to an env file holding `CARELINE_API` and `CARELINE_DOMAIN`. The service reads it only when it needs the API. |
| `ENGINE_FAKE_API` | `1` serves made-up CareLineLive data and never touches the network. |
| `RUN_TTL_MINUTES` | How long a run lives before it is deleted (default 60). |
| `MAX_UPLOAD_MB` | Largest accepted upload (default 25). |

The service listens on `127.0.0.1` by default. It has no login of its own: only the web
app should reach it (the web app holds `ENGINE_API_URL`; the browser never talks to it).

## What it does

`POST /runs` checks the bookings CSV (one Monday to Sunday week, a BookingId on every row,
known columns; counts and column names only in messages), then in the background:

1. reads carers, clients, addresses, teams, transport types and leave from CareLineLive
   (or the fake API), matches the carer names in the bookings to CareLineLive carers
   (the settings file's saved matches first);
2. builds one engine problem per planning region (Leeds; Weymouth, which includes the Dorchester team,
   set by `agency.team_regions` in the settings file) with the settings applied: working
   hours per weekday including nights, weekly maximum, skills, DBS and training expiry,
   active, client rules (gender preference, do-not-send, safeguarding bar, required skills,
   time-critical booking types get a move window of 0), agency settings (window, shift
   cost, continuity cost, change cost, search seconds), equal-hours share per region;
3. scores the current rota with the same travel model (the `evaluate_actual` approach);
4. searches each region in its own process (so the web server stays responsive and a
   DELETE stops the search at once), with progress;
5. builds `result`: a report per region, the comparison with the current rota, the list of
   changes with reasons worked out from the numbers (travel minutes saved on that carer's
   day, familiar carer, fills an unallocated booking, fairer hours), short-gap notes, and
   warnings.

Missing DBS or training dates are never filled with placeholders: the rule is left
unchecked and a warning is raised. A carer with no working hours is not planned.

Exports (UTF-8 with BOM, `dd/mm/yyyy`, `HH:MM`, a blank `Done` column for ticking):
`allocation.csv`, `changes.csv`, `notes.csv`; the exact column lists are in `docs/ENGINE_API.md`.

A carer with no working hours is available any time (settings `available_any_time`, default true;
explicit hours win); the result notes it in `notices`, not as a warning. Nothing limits a carer's
hours per day yet (only the weekly maximum): see the Service notes.

Endpoints: `GET /health`, `POST /runs`, `GET /runs/{id}`, `GET /runs/{id}/export/allocation.csv`,
`GET /runs/{id}/export/changes.csv`, `GET /runs/{id}/export/notes.csv`, `DELETE /runs/{id}`, `POST /sync`,
`GET /sample/bookings.csv`, `GET /sample/settings.json`, and `POST /validate` (extra).
Differences from the first draft of the contract are in `../docs/ENGINE_API.md`, under
"Service notes".

## Nothing is stored

- Uploads and results live **in memory only**. No file is written to disk by a run.
- A run is deleted by `DELETE /runs/{id}`, when it is older than `RUN_TTL_MINUTES`, and
  when the service shuts down. Deleting stops its search processes. The uploaded files are
  dropped as soon as the engine has its input, before the search starts.
- Logs hold run IDs (first 8 characters), counts, timings, error class names and HTTP
  status codes only. No request or response body is logged; uvicorn access logging is off
  (`python -m loidis_service` sets `access_log=False`; if you start uvicorn yourself, pass
  `--no-access-log`). Unexpected errors are turned into a plain 500 so a traceback never
  reaches the log. Error messages to the user carry counts, column names and IDs only.
- The result carries carers' names and a short client name ("Surname, I") for the coordinator's
  screens: personal data shown to the coordinator only, deleted with the run, never logged and
  never in an error message.
- The settings file and exports hold personal data and leave the service only when the web
  app downloads them.
- No external services: travel uses the engine's own straight-line model with a road
  factor, from CareLineLive's own geocoded coordinates (no maps, no geocoding calls).

## CareLineLive access

`loidis_service/cll.py` makes `GET` requests only, with an opener that refuses every
redirect (so the token is only sent to the URL asked for; same approach as
`tools/shadow_trial/safe_http.py`). `tests/test_cll_client.py` checks that, and checks the
token never appears in an error. There is no code path that sends POST, PUT, PATCH or
DELETE to CareLineLive.

The shapes of the API responses (clients with `preferred_address`, carers with `person`,
transport types, teams, leaves, carer addresses) follow what `tools/shadow_trial` already
reads. Two things are not yet confirmed against the real API and are read defensively: the
client reference code attribute (several names are tried, else the bookings CSV's
`ClientReferenceCode` is used) and a carer's teams (else the settings file's `teams`, else
the teams of the visits they are on).

## Fake API mode

`ENGINE_FAKE_API=1` makes `fetch_api_data()` return made-up data (`loidis_service/fake_data.py`):
3 teams, 13 carers, 20 clients, about 212 visits over 2026-11-16 to 2026-11-22, with a few
deliberate problems so the warnings and the name-matching step have something to show (a
carer with no DBS date, one with expired training, one with no working hours, a client with
no geocoded address, a carer written under a nickname in the bookings, approved and pending
leave). It is in the same JSON shape as the real API, so the real parsing code runs on it.
Names are invented words; the tests check none reaches a log or an error.

## Tests

```bash
cd service
.venv/Scripts/python -m pytest        # about 1.5 minutes: two full runs take about 25 s each
```

They cover CSV validation, the settings round trip, carer matching, client schedule learning, draft runs and the
check against the real week, the team rules, full runs in both
modes (result shape, rules, reasons), both exports, locks, DELETE/expiry/shutdown, no
redirect following, and that logs and errors contain no names.

## Road routing (optional)

Off by default. To use real road travel for car trips, run the local OSRM servers (`tools/routing/README.md`:
`build.ps1` once, then `servers.ps1 start`: Weymouth (Dorset) on 127.0.0.1:5001, Leeds on 127.0.0.1:5002) and start the
service with

```
LOIDIS_OSRM_URLS="Leeds=http://127.0.0.1:5002,Weymouth=http://127.0.0.1:5001"
```

(`Dorset` still works as another name for `Weymouth`, so an older setting does not need changing.)

(region names as in the settings file's `agency.team_regions`; only `localhost`/`127.0.0.1` URLs are accepted).
For each run and region the service asks OSRM once (`GET /table/v1/driving/...`, `annotations=duration,distance`,
in chunks, redirects refused, 60 s timeout) for travel between every client and car-driving carer's home, keeps
the table in memory for the run only (deleted with it), and uses it for the plan and for scoring the current
rota. Walking and bus carers keep the estimate; so does any place more than 1 km from a mapped road (warning
`routing_partial`) and everything if OSRM is unreachable (warning `routing_unavailable`). The result has a
`travel_source` notice saying which was used. Only counts are logged. Tests use a fake OSRM server.

## Client schedules and drafts

CareLineLive has no API or export for client schedule entries, so the service learns them from past bookings and the
coordinator confirms them; they live in the settings file (`client_schedules`, settings version 2).

- `POST /schedules/learn` takes one or more bookings CSVs (any number of weeks), optionally the CareLineLive client list
  CSV and the settings file, and returns learned schedules (`confirmed: false`), one-off visits and flags (schedule
  changed after the first week, suspended, no bookings). Bookings are clustered into slots (same client, weekday and type, starts within 30 minutes); a slot in at least half
  the weeks is weekly, one only in alternating weeks (4+ weeks supplied) is fortnightly (anchor Monday), the rest are irregular
  and only listed.
- `POST /runs` with `source=schedules` and a Monday `week_start` makes a **draft** from the confirmed schedules before
  the week's bookings exist (new rota only; unconfirmed schedules, clients with no schedule and suspended clients are
  left out with a warning or notice). Visits have no booking id (`not generated yet` in the export).
- `POST /runs` with `source=bookings` and a `draft` file (the draft's `allocation.csv`) is the **final check**: the real
  bookings are matched to the draft, the run starts from the draft plan (improve mode) and the result's `draft_check`
  lists what was added, removed or retimed.

Carers with no team (in CareLineLive or the settings file) are left out of planning with the warning `carer_no_team`.
Details and field lists are in `docs/ENGINE_API.md`.

## Search time

`agency.search_seconds_per_day` (settings file; 10 if absent, "Quick"; the UI also offers 30, "Thorough"; any 1 to 120 is valid) is the search time per day per
region; a run is about 7 times that plus 10 seconds (10 gives about 80 seconds, 30 about 5 minutes). On the made-up
week 5 seconds a day gave the same fill and travel as 30 (48 s against 301 s).

## Fewer fills than the current rota

Each unfilled visit has `unfilled_cause` (rules, hours, weekly_max, travel_or_booked) and the
result has `fill_check` with the counts. A current rota's "fills" can include visits the engine
may not plan (a carer on leave, a missing skill, double-booked or too far from their previous
visit); `fill_check.current_rota_feasible` counts the ones it could keep. The made-up rota is
heavily broken this way (93 of 201 feasible), so it is a poor baseline for fill counts.

## Limits to know

- A carer with no team is not planned (`carer_no_team`).
- A carer with visits in more than one region is planned in their home region (most visits) with
  reduced hours there, and is a locked guest elsewhere (warning `cross_region_carers`).
- The current rota may break the engine's rules (an expired DBS, a do-not-send): the
  engine will not keep such a visit, so a fill count can go down in Improve mode. Those
  changes are labelled (`forced_by_rules`) and counted apart in `change_summary`.
- A time-critical visit at the very edge of a shift stretches that block by the travel
  time (at most 90 minutes) so it can be filled (warning `hours_padded`).
- Real runs take about `search_seconds_per_day` x 7 seconds (the regions search at once).
