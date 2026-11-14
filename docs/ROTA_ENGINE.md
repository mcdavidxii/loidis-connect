# Rota engine

The engine builds a draft week of visits and suggests cover for absences. It follows
every must-have rule, minimises travel, and rewards continuity and carers reaching their
hours. **It only suggests; a coordinator approves before anything is published.**

## Inputs

| Input | Fields |
|---|---|
| Visits | Client, day, preferred start, time window (e.g. ±30 min), duration, carers needed (1 or 2), required skills, locked carer (optional) |
| Clients | Location, commissioned hours per week, funder (council/private), preferences (gender, language), do-not-send list |
| Carers | Home location, availability and leave, skills, travel mode (car/foot/bus), contracted or wanted hours, maximum hours |
| Travel times | Between every pair of locations, per travel mode |
| History | Who visited whom recently (for continuity) |

## Rules

| Rule | Type |
|---|---|
| Carer available, not on leave or sick | Must |
| Carer's DBS and required training are current | Must |
| Required skills present (e.g. hoist, medication) | Must |
| Visit starts within its time window | Must |
| Two different carers on double-up visits, arriving together | Must |
| Working-time limits and rest breaks | Must |
| Client do-not-send list | Must |
| Gender or language preference written in the care plan | Must |
| Shortest travel between visits | Preference |
| Same carers as recent weeks (continuity) | Preference |
| Carers reach their wanted hours | Preference |
| Other client preferences | Preference |

## How a run works

1. **Generate the week's visits** from each client's repeating weekly pattern.
2. **Keep locked visits** as they are.
3. **Solve:** assign carers to visits and order each carer's day. This is a vehicle
   routing problem with time windows; use a proven solver (Google OR-Tools or Timefold)
   rather than writing one.
4. **Output:**
   - Each carer's day as a timeline and a map route
   - Unfilled visits, each with a reason ("no hoist-trained carer free at 08:00")
   - Hours panel: client commissioned vs scheduled; carer wanted vs scheduled
   - Totals: travel time, continuity score
5. **Coordinator adjusts:** drag, lock, re-run, then publish.

## Sickness cover

Remove the absent carer, then re-plan **only the affected visits**, with a penalty for
changing anything else, so the rest of the rota stays stable. Show ranked options with
a plain explanation of each (travel added, continuity, hours).

## Why not "closest client next"

Picking the nearest visit each time leaves long gaps and late visits nobody can reach.
The engine plans each carer's whole day at once, and treats continuity as important as
distance.

## Travel times

- Prototype: straight-line distance with a road factor and per-mode speed.
- Later: road routing, either Google Maps (live traffic, paid per request) or a
  self-hosted OSRM server (free, no live traffic). Cache results between postcodes.

## Open design questions

See [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md), section "Rota".
