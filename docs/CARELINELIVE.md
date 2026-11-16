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

### What it covers

- **Read and write:** carers, carer contracts, carer addresses, carer teams, leave,
  leave types, teams, qualifications, employee requirements and templates, booking
  types, transport types, work patterns, visit rounds, visit validation exceptions,
  incidents, reviews, users, and many lookup lists.
- **Clients:** list, read and create only (no update).
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
    Years of visit history: a likely source for **continuity** (who visited whom), and
    possibly booking IDs if future visits are included (to check).
- **Permissions:** the token can read everything its user can, including NHS numbers
  and DBS numbers. The API has no read-only tokens, so the token should come from a
  **dedicated view-only CareLineLive user** (see `OPEN_QUESTIONS.md`).

### Visit rounds (the possible bridge)

- `POST /visit-rounds` takes `name` (required), `description`, `teams.data[].id`
  (required) and `bookings.data[].id` (optional booking UUIDs).
- A round has **no carer, no date and no visit order**. Its stored attributes are only
  `name` and `description`, with a link to teams.
- `PATCH` cannot change a round's bookings, and reading a round back does not list its
  bookings. To change the contents, delete the round and create a new one.

### Where booking IDs might come from

- **An export or report** that lists bookings with their IDs, carers and times. None is
  confirmed. Articles to check while logged in: "Create and use Rounds", "Bulk updating
  bookings", and the Tempaid and Hastee integration exports *(unverified)*.
- **Task completions (lead, to test):** `GET /client-task-completions` returns
  `booking_id`, `carer_id`, `occurrence_date` and `is_cancelled`. This may give booking
  IDs through the API, but it is our inference: it may only cover visits that have
  tasks, and only after they happen. Test with a read-only token.

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
  endpoints.

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
