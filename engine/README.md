# Rota engine (prototype)

Auto-generates a week's rota and re-plans a day when a carer drops out. Python + Google
OR-Tools. Runs on **made-up data** until Loidis's anonymised sample is available.

Design and rules: [`../docs/ROTA_ENGINE.md`](../docs/ROTA_ENGINE.md).

## Run it

```bash
cd engine
pip install ortools pytest

# 1. make a made-up Weymouth-area agency (60 clients, 38 carers, ~920 visits)
python -m loidis_rota generate --out ../data/sample/problem.json

# 2. auto-generate the week (about 1 minute at 8 s per day)
python -m loidis_rota solve --problem ../data/sample/problem.json \
    --out ../viewer/rota.json --seconds 8 --state week.pkl

# 3. a carer phones in sick on Wednesday: re-plan that day only
python -m loidis_rota cover --problem ../data/sample/problem.json \
    --state week.pkl --day wed --carer K004 --out ../viewer/rota-cover.json

# 4. look at it
cd ../viewer && python -m http.server 8765
#   http://localhost:8765/                         week plan
#   http://localhost:8765/?data=rota-cover.json    after sickness cover

# tests: the engine must never break a must-have rule
cd ../engine && python -m pytest -q
```

## Results on the made-up agency

| Measure | Result |
|---|---|
| Visits filled | 822 of 924 (89%); shortages are the 08:00 peak and some sleep-ins |
| Run time | about 1 minute for the week (8 s per day) |
| Sickness cover (K021, Wednesday) | 8 of 13 visits re-covered; 0 other visits changed |

The made-up agency is deliberately short-staffed at peaks, so the screens show
unfilled visits and their reasons. The fill rate is a property of the data, not the
engine.

## Code

| File | Purpose |
|---|---|
| `loidis_rota/models.py` | Clients, carers, visits, absences, cost settings |
| `loidis_rota/rules.py` | Must-have rules, each with a plain-language reason |
| `loidis_rota/travel.py` | Travel time and miles (straight-line estimate for now) |
| `loidis_rota/solver.py` | Day and week planning, sickness cover |
| `loidis_rota/report.py` | JSON for the viewer: routes, hours, mileage, unfilled reasons, shortfall |
| `loidis_rota/synthetic.py` | Made-up agency for development |
| `tests/test_rules.py` | Checks every must-have rule on a solved week |
| `tests/test_shift_cost.py` | Checks the cost of moving a visit off its booked start (`shift_pence_per_min`) |

## Known limits (prototype)

- Travel times are straight-line estimates, not road routing.
- Weekly hours are balanced day by day (Monday first), not across the whole week at once.
- Rest rule applies only after sleep-ins; meal breaks are not enforced yet (see open
  questions).
- Loading Loidis's real CSV sample needs postcode lookup; not built yet.
