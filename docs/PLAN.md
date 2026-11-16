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
2. **Task completions (read only).** Check whether they include future, planned visits.
   If yes, they give booking IDs (the visit-round bridge) without an export. Either
   way, use their history for continuity (who visited whom recently).
3. **Export from Loidis.** One week of visits, clients and carers, anonymised into
   `data/private/` per `data/README.md`. Find out which export lists bookings **with
   booking IDs**.
4. **Coordinator input.** Top 3 rota frustrations and the open engine settings (pay
   rate, mileage rate, meal breaks, contracted vs zero-hours).
5. **Read-only sync.** Importer that pulls carers, clients, addresses, leave,
   qualifications and transport types through the API into the engine's input.
6. **Export importer.** Turn the visits export into the engine's input; run the engine
   on Loidis's real week.
7. **Decision 2.** Coordinator reviews the result on their own data.
8. **Decision 1.** Booking IDs available: Stage A with one visit round per carer per
   day (a write: needs explicit approval first). Not available: Stage B pilot.
9. **Ask CareLineLive** whether booking read and allocation endpoints are planned.
