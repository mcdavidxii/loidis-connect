"""Score the coordinator's current rota with the same travel model as the engine.

Same approach as tools/shadow_trial/evaluate_actual.py: one route per carer per day (visits
in start order, from and back to the carer's home, using the engine's travel functions),
wrapped in the engine's DayResult/Stop objects, so the current rota and the engine's plan
are reported by the same code (`build_report`).

A visit with fewer carers than booked but at least one is kept as partially staffed (their
stops, travel and continuity count) and listed as unfilled; only a visit with no carer at all
is wholly unfilled.
"""

from __future__ import annotations

from dataclasses import replace

from loidis_rota.models import Problem
from loidis_rota.solver import DayResult, Stop

from .build import RegionBuild


def current_problem(rb: RegionBuild) -> Problem:
    """The region's problem with no current_carers, so the report does not classify changes."""
    p = rb.problem
    visits = [replace(v, current_carers=[]) for v in p.visits]
    return Problem(p.week_start, p.clients, p.carers, visits, p.absences, p.settings, travel=p.travel)


def score_current(rb: RegionBuild) -> tuple[Problem, list[DayResult]]:
    problem = current_problem(rb)
    week = [DayResult(d) for d in range(7)]
    per: dict[tuple[int, str], list] = {}
    for v in problem.visits:
        carers = list(rb.current.get(v.id, []))
        res = week[v.day]
        if not carers:
            res.unfilled[v.id] = "no carer allocated in the current rota"
            continue
        if len(carers) < v.carers_needed:
            res.unfilled[v.id] = (
                f"partially staffed in the current rota ({len(carers)} of {v.carers_needed} carers)"
            )
        res.assigned[v.id] = carers
        res.starts[v.id] = v.start
        for k in carers:
            per.setdefault((v.day, k), []).append(v)
    for (day, k), vs in per.items():
        carer = problem.carer_by_id[k]
        vs.sort(key=lambda v: (v.start, v.id))
        pos = carer.home
        drives = carer.travel_mode == "car"
        stops = []
        for v in vs:
            loc = problem.client_by_id[v.client_id].location
            tm = problem.travel.minutes(pos, loc, carer.travel_mode)
            mi = round(problem.travel.miles(pos, loc), 2) if drives else 0.0
            stops.append(Stop(v.id, v.start, v.start + v.duration, tm, mi))
            pos = loc
        week[day].routes[k] = stops
        week[day].travel_home[k] = (
            problem.travel.minutes(pos, carer.home, carer.travel_mode),
            round(problem.travel.miles(pos, carer.home), 2) if drives else 0.0,
        )
    return problem, week


def feasible_current(rb: RegionBuild, problem: Problem, week: list[DayResult]) -> tuple[int, int]:
    """(visits the current rota fully staffs, how many of those the engine's rules could keep).

    A visit is kept when every carer on it passes the rules (skills, gender, do-not-send, bar,
    leave, DBS and training), is working then, and can reach it after their previous kept visit
    under the travel model. A current rota that double-books a carer or sends them across town
    with no gap fails the last test; the engine will not plan that."""
    from loidis_rota.rules import carer_rule_failure, fits_block

    dropped: set[str] = set()
    for d in range(7):
        for k, stops in week[d].routes.items():
            carer = problem.carer_by_id[k]
            prev = None
            for st in stops:
                v = replace(problem.visit_by_id[st.visit_id], locked_carers=[])
                if carer_rule_failure(problem, carer, v) or not any(fits_block(v, b) for b in carer.blocks_on(d)):
                    dropped.add(v.id)
                    continue
                loc = problem.client_by_id[v.client_id].location
                if prev is not None:
                    pv, ploc = prev
                    if pv.start + pv.duration + problem.travel.minutes(ploc, loc, carer.travel_mode) > v.start:
                        dropped.add(v.id)
                        continue
                prev = (v, loc)
    full = [v for v in problem.visits if len(rb.current.get(v.id, [])) >= v.carers_needed]
    return len(full), sum(1 for v in full if v.id not in dropped)
