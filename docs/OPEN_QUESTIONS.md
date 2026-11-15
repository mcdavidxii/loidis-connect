# Open questions

Tick items off and record answers in `DECISIONS.md` where they lead to a decision.

## From CareLineLive (logged in)

- [ ] Screenshots (names blurred): rota day and week view, assigning a visit, a client's
      package/hours page, a carer profile, travel and mileage settings, the Reports menu
- [ ] Which exports exist (rota/visits, clients, carers, timesheets) and in what format
- [ ] Is there an API or integrations section?

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
- [ ] Sleep-ins: flat rate? Do they count towards contracted hours (engine: 0 minutes)?
      Rest needed afterwards (engine: 11 hours)?
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
