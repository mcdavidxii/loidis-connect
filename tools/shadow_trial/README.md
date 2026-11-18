# Shadow trial pipeline

Runs the rota engine on a real week and compares it with the actual allocation. Results
and settings: [`../../docs/SHADOW_TRIAL.md`](../../docs/SHADOW_TRIAL.md).

Rules:

- **Read-only.** The API client (`cll.py`) only sends GET requests. Never add writes.
- **No personal data is printed.** Scripts print counts and pseudo IDs only. Keep it so.
- **Outputs go to `data/private/trial/` only** (git-ignored). Never copy them elsewhere,
  paste them into chat, issues or commits.
- Secrets are loaded by the code at runtime. Never open or print them.

## Setup

Use the engine's virtual environment (from the repo root; PowerShell shown, use
`engine/.venv/bin/python` on Linux or macOS):

```powershell
engine\.venv\Scripts\python.exe -I tools\shadow_trial\<script>.py
```

Inputs expected in `data/private/`: the Bookings report for the week and the
continuity report (see `data/README.md`).

## Order

1. `fetch_api.py` downloads carers, clients, leave etc. (GET only) into
   `data/private/trial/api_raw/`.
2. `prepare_inputs.py` reads the exports and cached API data, pseudonymises, and writes
   `prepared.json` and `id_map.json`.
3. `build_problem.py` writes, per region, `<region>_problem.json`,
   `<region>_actual_assignments.json` and `<region>_build_info.json`. Options:
   - `--max-hours` weekly maximum per carer (default 60)
   - `--day-start`, `--day-end` placeholder working day (defaults 07:00, 22:00)
   - `--window` minutes a visit may start earlier or later than booked (default 0)
   - `--shift-cost` pence per minute away from the booked time (default 0)
   - `--continuity-cost` pence per visit by an unfamiliar carer (default: engine default)
   - `--continuity-file` continuity report used for recent carers
   - `--mode new|improve` (default `new`): `new` plans from scratch; `improve` fills each
     visit's `current_carers` from the actual allocation so the engine only changes a carer
     when the gain beats the change cost
   - `--change-cost` pence per changed carer slot (engine `change_pence_per_visit`, default 0;
     only used with `--mode improve`). Mode and cost are recorded in `trial_settings`
   - `--lock-pad` minutes added around locked visits (default 90)
   - `--region leeds` / `--region dorset` (repeatable; default both)
   - `--suffix _x` added to output names, for sensitivity runs
4. `evaluate_actual.py [region ...]` scores the actual week with the engine's report
   code and writes `<region>_actual_report.json`. Run it again with `--equal-staffing`
   to write `<region>_actual_eq_report.json` (visits with more carers than needed keep
   only the first listed; the choice is arbitrary); `compare.py` shows it as an extra
   column when present. Partly staffed actual visits count as unfilled but keep their
   carers' travel and continuity.
5. Solve each region with the engine, as the `<region>_engine_report.json` that
   `compare.py` expects:

   ```powershell
   cd engine
   .venv\Scripts\python.exe -m loidis_rota solve --problem ..\data\private\trial\leeds_problem.json --out ..\data\private\trial\leeds_engine_report.json --seconds 30
   ```

   Run from `engine/` (the package is not importable from the repo root). Repeat for
   `dorset`. With `--suffix _x`, the files are `leeds_x_problem.json` and
   `leeds_x_engine_report.json`, and `evaluate_actual.py` takes `leeds_x dorset_x`.
6. `compare.py [suffix]` prints the actual-vs-engine table (counts and numbers only) and
   writes `comparison<suffix>.json` and `comparison<suffix>.md` in `data/private/trial/`.

`compare.py` also reports, for the engine columns, visits with the carer changed, with only
the time changed, unchanged, and carer-days touched (distinct carer x day pairs that gain or
lose a visit), measured against the actual allocation.

## Improve mode runs

Same recommended settings plus, for example, `--mode improve --change-cost 2000 --suffix _imp2000`;
solve, then `evaluate_actual.py leeds_imp2000 dorset_imp2000` and `compare.py _imp2000`.

## Settings of the recommended run

```powershell
engine\.venv\Scripts\python.exe -I tools\shadow_trial\build_problem.py --window 30 --shift-cost 15 --day-start 06:30 --day-end 22:30 --max-hours 60 --continuity-cost 1000 --continuity-file <report for the previous 4 weeks>
```

then solve with `--seconds 30`.

Other files: `cll.py` (read-only API client; `safe_http.py` makes it refuse redirects so the token is never forwarded; `test_no_redirect.py` checks that offline), `continuity.py` (parses the continuity
report).
