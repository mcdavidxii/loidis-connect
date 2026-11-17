"""Score the coordinator's actual week with the engine's own report code.

For each region: load <region>_problem.json and <region>_actual_assignments.json, build one
route per carer per day (visits in start order, from and back to the carer's home, using the
engine's travel functions), wrap them in the engine's DayResult/Stop objects and call
build_report, so the actual week and the engine's plan share one report format.
Writes data/private/trial/<region>_actual_report.json. Prints counts only.

  python -I tools/shadow_trial/evaluate_actual.py [--equal-staffing] [region ...]   (run from anywhere)

A visit with fewer carers than needed but at least one is kept as partially staffed (their stops,
travel and continuity count); it is also listed as unfilled in the report with the deficit noted, and
the headline "filled" counts only fully staffed visits, as the engine's own report does. Only a visit
with no carer at all is wholly unfilled.

--equal-staffing keeps only the first `carers_needed` carers listed on over-staffed visits (which
carer is dropped is arbitrary: the first listed is kept) and writes <region>_actual_eq_report.json,
so the staffing difference can be separated from routing."""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "engine"))
TRIAL = REPO / "data" / "private" / "trial"

from loidis_rota.models import Problem  # noqa: E402
from loidis_rota.report import build_report  # noqa: E402
from loidis_rota.solver import DayResult, Stop  # noqa: E402
from loidis_rota.travel import miles, travel_minutes  # noqa: E402


def evaluate(region, equal=False):
    problem = Problem.from_dict(json.loads((TRIAL / f"{region}_problem.json").read_text()))
    actual = json.loads((TRIAL / f"{region}_actual_assignments.json").read_text())
    week = [DayResult(d) for d in range(7)]
    per = {}  # (day, carer) -> visits
    partial = missing_min = dropped = 0
    for v in problem.visits:
        carers = list(actual[v.id])
        if equal and len(carers) > v.carers_needed:
            dropped += len(carers) - v.carers_needed
            carers = carers[: v.carers_needed]
        res = week[v.day]
        if not carers:
            res.unfilled[v.id] = "no carer allocated in the actual week"
            continue
        if len(carers) < v.carers_needed:
            res.unfilled[v.id] = (
                f"partially staffed in the actual week ({len(carers)} of {v.carers_needed} carers)")
            partial += 1
            missing_min += v.duration * (v.carers_needed - len(carers))
        res.assigned[v.id] = list(carers)
        res.starts[v.id] = v.start
        for k in carers:
            per.setdefault((v.day, k), []).append(v)

    overlaps = 0
    for (day, k), vs in per.items():
        carer = problem.carer_by_id[k]
        vs.sort(key=lambda v: (v.start, v.id))
        pos, t_end, prev_end = carer.home, None, None
        stops = []
        drives = carer.travel_mode == "car"
        for v in vs:
            loc = problem.client_by_id[v.client_id].location
            tm = travel_minutes(pos, loc, carer.travel_mode)
            mi = round(miles(pos, loc), 2) if drives else 0.0
            if prev_end is not None and prev_end + tm > v.start:
                overlaps += 1  # not enough time between visits to travel (engine would forbid this)
            stops.append(Stop(v.id, v.start, v.start + v.duration, tm, mi))
            pos, prev_end = loc, v.start + v.duration
        week[day].routes[k] = stops
        week[day].travel_home[k] = (
            travel_minutes(pos, carer.home, carer.travel_mode),
            round(miles(pos, carer.home), 2) if drives else 0.0,
        )

    report = build_report(problem, week, settings_note="Actual week as worked (baseline), scored with the engine's own functions"
                          + (", equal staffing (first carers_needed carers kept)" if equal else ""))
    m = report["metrics"]
    # build_report counts any visit with a carer as filled; the engine only fills visits fully, so
    # headline filled/unfilled here count partially staffed visits as unfilled (care hours, travel,
    # continuity still include the carers who attended)
    m["filled"] -= partial
    m["unfilled"] += partial
    m["fill_rate"] = round(m["filled"] / max(1, m["visits"]), 3)
    report["trial"] = {
        "kind": "actual_equal_staffing" if equal else "actual",
        "partially_staffed_visits": partial,
        "missing_carer_minutes": missing_min,
        "carers_dropped_for_equal_staffing": dropped,
        "overlapping_or_unreachable_consecutive_visits": overlaps,
        "visits_with_more_carers_than_needed": sum(1 for v in problem.visits if len(actual[v.id]) > v.carers_needed and not equal),
        "extra_carer_visit_minutes_vs_needed": 0 if equal else sum(
            v.duration * (len(actual[v.id]) - v.carers_needed) for v in problem.visits if len(actual[v.id]) > v.carers_needed),
    }
    out = TRIAL / f"{region}_actual{'_eq' if equal else ''}_report.json"
    out.write_text(json.dumps(report, indent=1))
    print(f"{region}{' (equal staffing)' if equal else ''}: partially_staffed {partial} missing_carer_min {missing_min} dropped {dropped} visits {m['visits']} filled {m['filled']} unfilled {m['unfilled']} care_h {m['care_hours']} "
          f"travel_h {m['travel_hours']} miles {m['miles']} continuity {m['continuity_rate']} "
          f"overlaps {overlaps} extra_carer_visits {report['trial']['visits_with_more_carers_than_needed']}")


if __name__ == "__main__":
    args = sys.argv[1:]
    eq = "--equal-staffing" in args
    for r in [a for a in args if not a.startswith("--")] or ["leeds", "dorset"]:
        evaluate(r, eq)
