# Open questions

Tick items off and record answers in `DECISIONS.md` where they lead to a decision.

## From CareLineLive (logged in)

- [ ] Screenshots (names blurred): rota day and week view, assigning a visit, a client's
      package/hours page, a carer profile, travel and mileage settings, the Reports menu
- [ ] Which exports exist (rota/visits, clients, carers, timesheets) and in what format
- [x] Is there an API? **Yes, but no bookings endpoints** (see `CARELINELIVE.md`)
- [x] Ask CareLineLive support to enable API access for Loidis. **Enabled; token works** (read-only check 2026-11-16)
- [ ] Which export or report lists bookings **with booking IDs**, carers and times?
      (Needed for the "round per carer" bridge)
- [ ] Do task completions (`/client-task-completions`) include future, planned visits?
      If yes, they give booking IDs without an export (check read-only)
- [ ] Create a dedicated view-only CareLineLive user and replace the API token with one
      created from it
- [ ] Ask CareLineLive whether booking read and allocation endpoints are planned
- [ ] How Loidis uses carer compatibility today (Warn / Exclude / Preferred / Only)
- [ ] Are regular carers set on client schedule entries, or allocated each week?
- [ ] Do clients have multi-week schedules (week 1 / week 2)?
- [ ] Are carer service areas set up?

## Rota (care coordinator)

- [ ] Is the rota copied forward from last week or built from scratch? Hours per week?
- [ ] How often is sickness cover needed, and how long does it take?
- [ ] Rank what makes a good rota: travel, continuity, carer hours, client preferences
- [ ] Top 3 frustrations with the CareLineLive rota
- [ ] How do you see which clients are short of hours today?
- [ ] Do carers have fixed areas or rounds?
- [ ] How many visits need two carers?
- [ ] Is travel time paid, and how is it calculated?
- [ ] Number of active clients, carers, and visits per week
- [ ] How many carers drive vs walk or use buses?

## Rota rules (engine settings to confirm)

- [ ] Carer pay rate (engine assumes £12.71/h)
- [x] Is travel time between visits paid? **Yes** (2026-11-15)
- [ ] Mileage rate per mile (engine assumes 45p) and does it include the first and last
      trip from and to home?
- [x] Night shifts are **sleep-ins** (2026-11-15)
- [x] Sleep-ins count towards carers' hours in full (CareLineLive shows a 10 h block in
      the carer's total) (2026-11-15)
- [ ] Sleep-in pay (flat rate or hourly): for the payroll module
- [ ] Rest needed after a sleep-in (engine: 11 hours)?
- [x] Late shift followed by an early shift: **allowed** (2026-11-15)
- [ ] Breaks: is a meal break required on long shifts?
- [ ] Hours balancing: contracted hours guaranteed, or zero-hours?
- [x] Priority when they conflict: **less travel and carers getting their hours**, then
      continuity (2026-11-15)
- [x] Do-not-send: **hard rule**, but can be suggested to the coordinator when it
      blocks a visit (2026-11-15). Which restrictions are safeguarding (never suggested)?
- [ ] Any clients who accept only named carers (an allow-list, not just do-not-send)?
- [ ] Which time windows are standard (±15, ±30) and which visits are time-critical?

## Owner / manager

- [ ] Which councils fund clients? Do contracts require a call monitoring provider
      (e.g. CM2000), UK-only hosting, or an NHS-assured records system?
- [ ] CareLineLive renewal date and notice period
- [ ] Is there a registered nurse who could be the Clinical Safety Officer?
- [ ] Budget, target date, and whether Loidis owns the software or licenses it

## Development team

- [ ] Team size and skills
- [ ] Will the development team host and support the platform after launch?
- [ ] Might the platform be sold to other agencies later? (Affects naming and NHS assurance)
