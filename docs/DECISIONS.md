# Decision log

Newest first. Each entry: decision, why, and what it rules out.

| Date | Decision | Why | Status |
|---|---|---|---|
| 2026-11-14 | Keep the platform in its own repo, separate from the public website (`loidiscare`) | Care records need much stricter security than a marketing site | Decided |
| 2026-11-14 | Start with a rota engine prototype on realistic made-up data, then swap in anonymised real data | Rota is the biggest pain; made-up data lets work start before client data and compliance are ready | Decided |
| 2026-11-14 | Staged replacement of CareLineLive, not a single cut-over | Care cannot pause; lower clinical and operational risk | Decided |
| 2026-11-14 | Use a proven solver (OR-Tools or Timefold) for the rota engine | Visit scheduling with time windows is a hard optimisation problem with mature open-source solvers | Decided |
| — | Technology stack | To be chosen in Phase 0. Leaning: web app (Next.js/TypeScript, which the team already uses for the website) with a Python service for the rota engine | Open |
| — | Hosting location (UK vs EEA) | Depends on council contract terms (OPEN_QUESTIONS) | Open |
| — | Product name in code and UI | Keep a neutral internal name in code if the platform may be sold to other agencies | Open |
