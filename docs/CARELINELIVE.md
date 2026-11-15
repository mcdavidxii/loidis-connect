# How CareLineLive's rota works (and what it means for us)

Summary of CareLineLive's public User Guide and API documentation, read 2026-11-15.
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

- Access is free but must be enabled by CareLineLive support; it uses personal access
  tokens that inherit the user's permissions.
- **Read and write:** carers, clients, addresses, carer contracts, leave, teams,
  qualifications, employee requirements, booking types, transport types, work patterns,
  **visit rounds**.
- **Not available:** bookings, visits, client schedule entries, carer availability,
  carer compatibility.
- **Visit rounds can be created with a list of booking IDs.**

### What this means for Stage A (rota companion)

- We **can sync** carers, clients, addresses and leave automatically.
- We **cannot read or write bookings** through the API. Visits must come from a
  CareLineLive export or report.
- **Possible bridge:** if an export includes booking IDs, the engine can create one
  **round per carer per day** through the API with that carer's bookings in order. The
  coordinator then drags each round onto its carer: one drag per carer per day instead
  of one per visit. Then preview and save as usual.
- CareLineLive takes API feature requests; we can ask for booking allocation endpoints.

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
