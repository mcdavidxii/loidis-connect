# Scope

The MVP is the smallest set of features that lets Loidis run visits safely without
CareLineLive's rota. Clinical features (eMAR, care plans) come later, once the core is
proven and the clinical safety process is running. Rollout is staged, not a single
cut-over.

## Phase 0 — discovery and rota prototype (about 3 weeks)

- Shadow the care coordinator for a day; record how the rota is built and covered.
- Collect one week of anonymised rota data (templates in `data/templates/`).
- Build a rota engine prototype on that data with a simple screen: carer timelines,
  map, unfilled visits with reasons, hours panel.
- Choose the technology stack.
- Exit: the coordinator reviews the prototype on their own data.

## Features by phase

| Feature | What it includes | Main user | Phase |
|---|---|---|---|
| Security foundation | Two-factor login, role-based access, audit log of every view and change, encryption including on carers' phones, remote logout | Everyone | MVP |
| Clients and care plans (basic) | Client record, visit tasks, preferences, version history | Field supervisor | MVP |
| Staff records and compliance | DBS, right to work, training expiry, booking block for non-compliant staff | HR, coordinator | MVP |
| Rostering | Repeating visits, auto-generated draft week, travel-aware suggestions, sickness cover, hours tracking | Coordinator | MVP |
| Carer app (offline first) | Rota, directions, GPS/QR check-in/out, tasks, notes, raise a concern | Carer | MVP |
| Live visit monitoring | Late and missed visit board with alerts, including on-call | Coordinator | MVP |
| Council call monitoring feed | Export or feed in the format each council contract needs | Commissioner | MVP (if contracts require) |
| Data import | Clients, staff, care plans and history from CareLineLive | Office | MVP |
| eMAR | Prompt/assist/administer levels, PRN rules, time-critical alerts, allergies, audits | Carer, manager | Phase 2 |
| Incidents and safeguarding | Incident log, escalation, body maps | Manager | Phase 2 |
| Invoicing | From actual visit times, council and private rates, split billing | Finance | Phase 2 |
| Payroll export | Hours, travel time (minimum wage), mileage, holiday pay | Finance | Phase 2 |
| Spot checks and supervisions | Forms, schedules, follow-ups | Field supervisor | Phase 2 |
| Office–carer messaging | Secure messages and broadcasts | Coordinator, carer | Phase 2 |
| Rota assistant (AI) | Natural-language requests ("cover Sarah tomorrow"); coordinator approves | Coordinator | Phase 2 |
| Family portal | Read-only visits, notes, upcoming carers | Family | Phase 3 |
| Reports and CQC evidence | Dashboards, audit packs, inspector view | Manager | Phase 3 |
| Recruitment pipeline | Applicants, interviews, onboarding | HR | Phase 3 |
| NHS links | GP Connect, MODS data standard, NHS assured listing | Manager | Only if sold to other agencies |

## Where we aim to be better than competitors

- Rota auto-generation that plans each carer's whole day, not just "closest next".
- A carer app that genuinely works with no signal.
- Staff compliance built into rostering (expired DBS or training blocks the booking).
- AI suggestions that the coordinator always approves.
