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

**Key unknown:** whether an approved rota can be written back into CareLineLive (API or
import). If it cannot, Stage A means re-typing every visit, so we go straight to Stage B
with a pilot group of carers.

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
