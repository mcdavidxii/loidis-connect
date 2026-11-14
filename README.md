# Loidis Connect

Care management platform for **Loidis Care Services Ltd**, a CQC-regulated domiciliary
(home) care provider in Dorset, England. It is planned to replace the agency's current
system (CareLineLive) in stages.

> Status: **Phase 0 — discovery and rota prototype.** No production code yet; the
> technology stack is still to be chosen (see [`docs/DECISIONS.md`](docs/DECISIONS.md)).

## The problem we solve first

Building the rota is the agency's biggest daily pain. Coordinators need to see which
clients are short of commissioned hours, which carers need hours, and who is closest,
then build a week of visits that respects every rule. Loidis Connect starts with a rota
engine that **auto-generates a draft week** and **suggests cover** when a carer is off sick,
with the coordinator always approving the result.

## What the full platform covers

| Area | Examples |
|---|---|
| Rostering | Auto-generated weekly rota, travel-aware suggestions, sickness cover, hours tracking |
| Carer app | Offline-first rota, check-in/out, tasks, notes, eMAR |
| Care records | Clients, assessments, care plans, medication (eMAR), incidents |
| Staff compliance | DBS, right to work, training expiry, booking blocks |
| Monitoring | Live late/missed visit alerts, council call monitoring feed |
| Finance | Invoicing from actual visits, payroll export with travel time |
| Family portal | Read-only visits and notes for relatives |

Phases and priorities: [`docs/SCOPE.md`](docs/SCOPE.md).

## Repository layout

```
docs/
  SCOPE.md            Features and phases (MVP, Phase 2, Phase 3)
  ROTA_ENGINE.md      How the rota auto-generator works
  COMPLIANCE.md       Compliance checklist and where to do each item
  OPEN_QUESTIONS.md   What we still need from the client
  DECISIONS.md        Decision log
data/
  README.md           Rules for handling rota data
  templates/          CSV templates for the anonymised rota sample
```

## Rules

- **Never commit real personal data.** Real exports go in `data/private/`, which git
  ignores. See [`data/README.md`](data/README.md).
- **Never invent regulatory or compliance claims.** If unsure, flag it.
- Keep the docs in `docs/` up to date as decisions are made.

## Related

- Public website: [`mcdavidxii/loidiscare`](https://github.com/mcdavidxii/loidiscare)
  (kept separate on purpose: different security needs).
- Market research and scope doc (Claude Docs, private until shared):
  https://claude.ai/artifact/FkxhgrFpTmofzhkV4by4Mk
