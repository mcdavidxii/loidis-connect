# Decision log

Newest first. Each entry: decision, why, and what it rules out.

| Date | Decision | Why | Status |
|---|---|---|---|
| 2026-11-15 | Do-not-send stays a hard rule; when it blocks a visit the carer is suggested to the coordinator. Separate safeguarding bar is never suggested | Loidis: hard rule but sometimes worth suggesting; safeguarding restrictions must not be offered | Decided |
| 2026-11-15 | Priorities: travel and carers' hours first, continuity as a tie-breaker | Loidis's answer; continuity still kept because clients and CQC value it | Decided |
| 2026-11-15 | Night shifts modelled as sleep-ins; their weight towards hours is a setting (default 0) | Loidis uses sleep-ins; sleep-in pay and hours treatment to confirm | Decided |
| 2026-11-15 | Sickness cover never drops a planned visit to cover another | Otherwise it only moves the problem to another client | Decided |
| 2026-11-15 | Replace CareLineLive in stages (A rota companion, B own rota and carer app, C full replacement); see PLAN.md | Lowest risk for a live care service; rota delivers value first | Decided |
| 2026-11-15 | Rota engine in Python with Google OR-Tools, as a separate service from the web app | Strongest free solver for visit routing with time windows; keeps the engine independent of the web stack | Decided |
| 2026-11-15 | Mileage and payroll export is the next module after the rota | Requested by the client; reuses the engine's travel calculations | Decided |
| 2026-11-14 | Keep the platform in its own repo, separate from the public website (`loidiscare`) | Care records need much stricter security than a marketing site | Decided |
| 2026-11-14 | Start with a rota engine prototype on realistic made-up data, then swap in anonymised real data | Rota is the biggest pain; made-up data lets work start before client data and compliance are ready | Decided |
| 2026-11-14 | Staged replacement of CareLineLive, not a single cut-over | Care cannot pause; lower clinical and operational risk | Decided |
| 2026-11-14 | Use a proven solver (OR-Tools or Timefold) for the rota engine | Visit scheduling with time windows is a hard optimisation problem with mature open-source solvers | Decided |
| — | Technology stack | To be chosen in Phase 0. Leaning: web app (Next.js/TypeScript, which the team already uses for the website) with a Python service for the rota engine | Open |
| — | Hosting location (UK vs EEA) | Depends on council contract terms (OPEN_QUESTIONS) | Open |
| — | Product name in code and UI | Keep a neutral internal name in code if the platform may be sold to other agencies | Open |
