"""Command line for the rota engine.

  python -m loidis_rota generate --out ../data/sample/problem.json
  python -m loidis_rota solve --problem ../data/sample/problem.json --out ../viewer/rota.json
  python -m loidis_rota cover --problem ../data/sample/problem.json --day wed --carer K012
"""

from __future__ import annotations

import argparse
import json
import pickle
import sys
import time
from pathlib import Path

from .models import DAYS, Absence, Problem, hhmm
from .report import build_report
from .solver import cover_absence, solve_week
from .synthetic import generate


def _load(path: str) -> Problem:
    return Problem.from_dict(json.loads(Path(path).read_text()))


def _write(path: str, data: dict) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, indent=1))
    print(f"wrote {path}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="loidis_rota")
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="make a made-up agency for testing")
    g.add_argument("--out", required=True)
    g.add_argument("--seed", type=int, default=7)

    s = sub.add_parser("solve", help="auto-generate the week's rota")
    s.add_argument("--problem", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--seconds", type=int, default=10, help="search time per day")
    s.add_argument("--state", help="also save the plan for later sickness cover")

    c = sub.add_parser("cover", help="re-plan a day after a carer drops out")
    c.add_argument("--problem", required=True)
    c.add_argument("--state", required=True, help="saved plan from 'solve --state'")
    c.add_argument("--day", required=True, choices=DAYS)
    c.add_argument("--carer", required=True)
    c.add_argument("--seconds", type=int, default=10)
    c.add_argument("--out", help="write the updated week report here")

    args = ap.parse_args(argv)

    if args.cmd == "generate":
        _write(args.out, generate(seed=args.seed).to_dict())
        return 0

    problem = _load(args.problem)

    if args.cmd == "solve":
        t0 = time.time()

        def progress(day, res):
            n = sum(1 for v in problem.visits if v.day == day)
            print(f"  {DAYS[day]}: {len(res.assigned)}/{n} visits filled ({time.time() - t0:.0f}s)")

        week = solve_week(problem, args.seconds, progress)
        report = build_report(problem, week)
        m = report["metrics"]
        print(
            f"filled {m['filled']}/{m['visits']} ({m['fill_rate']:.0%}), "
            f"travel {m['travel_hours']} h, {m['miles']} miles (£{m['mileage_pounds']}), "
            f"continuity {m['continuity_rate']:.0%}"
        )
        _write(args.out, report)
        if args.state:
            Path(args.state).write_bytes(pickle.dumps(week))
        return 0

    if args.cmd == "cover":
        week = pickle.loads(Path(args.state).read_bytes())
        day = DAYS.index(args.day)
        new_day, summary = cover_absence(problem, week, day, args.carer, args.seconds)
        print(f"{args.carer} off on {args.day}: {summary['affected_visits']} visits affected")
        for item in summary["covered"]:
            print(f"  {item['visit_id']} -> {', '.join(item['new_carers'])} at {hhmm(item['start'])}")
        for item in summary["still_unfilled"]:
            print(f"  {item['visit_id']} NOT covered: {item['reason']}")
        print(f"  other visits changed: {summary['other_visits_moved']}")
        if args.out:
            week[day] = new_day
            problem.absences.append(Absence(args.carer, day, "sick"))
            report = build_report(problem, week)
            report["cover"] = summary
            _write(args.out, report)
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
