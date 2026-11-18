# Delivery plan

Build Loidis Connect around CareLineLive, then replace it piece by piece (the "strangler"
approach). Rota comes first because it is the agency's biggest pain. Mileage and payroll
follow next, reusing the travel data the rota engine already calculates.

## Stages

| Stage | Loidis Connect does | Stays in CareLineLive | Carers use |
|---|---|---|---|
| A. Rota companion | Imports clients, carers and visits; auto-generates the rota; coordinator approves; result goes back into CareLineLive | Carer app, notes, eMAR, call monitoring, billing | CareLineLive app |
| B. Own rota and carer app | Main system for scheduling and visits: our carer app, check-in/out, monitoring; mileage and payroll export | Care plans, eMAR, invoicing (synced) | Our app |
| C. Full replacement | Care plans, eMAR, finance, family portal; CareLineLive switched off | Nothing | Our app |

**Key unknown, now partly answered (2026-11-15):** CareLineLive's API cannot read or
write bookings, but it can create **visit rounds containing booking IDs**. If an export
gives us booking IDs, Stage A works as: engine plans the week, creates one round per
carer per day, coordinator drags each round onto its carer. If not, we go straight to
Stage B with a pilot group of carers. Details: [`CARELINELIVE.md`](CARELINELIVE.md).

## Where we aim to beat CareLineLive's rota (to confirm with the coordinator)

1. Whole-week auto-generation, planning every carer's whole day at once
2. Clear hours gaps: clients short of commissioned hours, carers short of wanted hours
3. Unfilled visits with reasons, not blanks
4. Fast sickness cover: re-plan only the affected visits, ranked options
5. Travel that depends on how each carer travels (car, foot, bus)
6. What-if planning before accepting a new client

## Architecture

```
CareLineLive --export/API--> Import & sync --> Database (PostgreSQL)
     ^                                              |
     +---- approved rota (Stage A) <---+            v
                                  Web app (Next.js) <--> Rota engine (Python + OR-Tools)
                                                              |
                                                              v
                                              Travel times (estimates -> road routing)
```

Only the import & sync part talks to CareLineLive, so replacing it later does not touch
the rest.

**Next build (2026-11-17):** the Stage A rota companion, first as an **engine test (no
database yet)**, for Loidis only. Spec: [`MVP.md`](MVP.md) (draft). The database comes
once the engine is proven.

## Workflow

- **Weekly:** import latest data -> generate next week -> review gaps and unfilled visits
  -> lock and adjust -> approve -> publish.
- **Daily:** carer off sick -> mark absent -> engine suggests cover for their visits only
  -> coordinator picks -> publish.

## Order of work and decision points

1. Get CareLineLive export/import/API details and the coordinator's top rota frustrations.
2. **Decision 1:** can we write back to CareLineLive? Stage A if yes, Stage B pilot if not.
3. Rota engine and screens on made-up data, then on Loidis's anonymised data
   (`engine/`, `viewer/`).
4. **Decision 2:** coordinator tries it on real data. If it saves time, build the chosen
   stage properly, with logins, security and the compliance items.
5. Next module: mileage and payroll export.

## Next steps (as of 2026-11-16)

**Approach: exports first, API second.** The API cannot read or create bookings (checked
on Loidis's account, see [`CARELINELIVE.md`](CARELINELIVE.md)), so visits must come from
a CareLineLive export. The API is used read-only to keep carers, clients, leave,
qualifications and transport types in sync, so the export only needs to cover visits
and client packages.

1. **Safer token.** Create a dedicated CareLineLive user with view-only permissions and
   replace the API token with one created from that user.
2. **Task completions (read only). Done 2026-11-16.** They do **not** include future,
   planned visits (rows appear only once a task is completed; the newest rows were dated
   the day of the check). So they are not the visit-round bridge. Use their history for
   continuity (who visited whom recently). Details in
   [`CARELINELIVE.md`](CARELINELIVE.md).
3. **Export from Loidis.** One week of visits, clients and carers, anonymised into
   `data/private/` per `data/README.md`. Find out which export lists bookings **with
   booking IDs**: this now decides Decision 1 (step 8).
   *Progress 2026-11-16:* the Bookings report was received for one week
   (2026-11-16 to 2026-11-22). It has **no booking IDs** (clients and carers by name
   only) but is enough for step 6. Still open: find whether any other export (the
   Tempaid or Hastee integration exports, another report) has booking IDs; check why
   the 2026-11-24 to 2026-11-29 export was empty; move the files into `data/private/`
   (they are still in Downloads). Format in [`CARELINELIVE.md`](CARELINELIVE.md).
   *Update 2026-11-16:* a second export, the CSV `bookings_optimised.csv`, **does have
   booking IDs** (461 rows, 17 to 19 Nov, a UUID on every row), and its client IDs match
   the API's. Carers are still by name only. Still to confirm: how it is produced in
   CareLineLive, and that it can be produced every week for the coming week. The API has
   no export endpoints, so it must be downloaded from the web app.
   *Update 2026-11-16 (later):* reports received for 16 to 22 Nov (Carer Availability
   and Carer Work Patterns empty; Continuity and Mileage useful, see
   [`CARELINELIVE.md`](CARELINELIVE.md)). The empty 23-29 / 24-29 Nov exports are
   explained: bookings are generated only once availability is known. The CSV is
   another option of the Bookings report in Reports, so it is reproducible from the web
   app whenever bookings exist (exact option name to note). **Next check:** run it for a
   full generated week and confirm every day is present with a booking ID on every row.
4. **Coordinator input.** Top 3 rota frustrations and the open engine settings (pay
   rate, mileage rate, meal breaks, contracted vs zero-hours). **Key question: where
   does the coordinator keep carers' availability?** It is not in CareLineLive (the
   Carer Availability and Work Patterns reports are empty), so it must come from the
   coordinator. Also: where carer compatibility rules are kept (no report or export
   lists them). *Decided 2026-11-16 (DECISIONS.md):* Loidis Connect holds carers'
   working hours, weekly maximums and do-not-send pairs, entered by the coordinator;
   the first run is a shadow-mode trial on 16 to 22 Nov with placeholder hours.
5. **Read-only sync.** Importer that pulls carers, clients, addresses, leave,
   qualifications and transport types through the API into the engine's input.
6. **Export importer.** Turn the visits export into the engine's input; run the engine
   on Loidis's real week.
   *Progress 2026-11-17:* done for 16 to 22 Nov; the engine filled 1,061 of 1,065
   visits (actual 1,064) with less travel (-16%), fewer miles (-20%) and better continuity
   than the actual week (re-run after review fixes), at the cost of 626 visits moved by up
   to 30 min; safety rules (skills, gender, do-not-send, safeguarding, DBS/training) were
   not applied and must be checked. Method, runs,
   findings and caveats in [`SHADOW_TRIAL.md`](SHADOW_TRIAL.md); pipeline in
   `tools/shadow_trial/README.md`. Four unfilled visits (Dorset) still to diagnose.
7. **Decision 2.** Coordinator reviews the result on their own data. *Ready for review
   2026-11-17* (settings agreed in `DECISIONS.md`; review list in
   [`SHADOW_TRIAL.md`](SHADOW_TRIAL.md)). A second week and real working hours should
   follow.
8. **Decision 1.** Booking IDs available: Stage A with one visit round per carer per
   day (a write: needs explicit approval first). Not available: Stage B pilot. Still
   open: the CSV with booking IDs exists and is reproducible from Reports; the remaining
   conditions are confirming a full week's CSV (every day, a booking ID on every row)
   and the user's approval. Engine run timing: the coordinator triggers it after
   bookings are generated and before they are published, not on a fixed weekly slot.
9. **Ask CareLineLive** whether booking read and allocation endpoints are planned, and
   whether carer compatibility rules, client schedule entries and rounds can be exported
   (no report does).
