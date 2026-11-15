"""Rota engine: assign carers to visits and order each carer's day.

Each day is solved as a vehicle routing problem with time windows (OR-Tools):

- a "vehicle" is one availability block of one carer, starting and ending at home;
- a visit needing two carers becomes two linked stops that must start at the same
  time with different carers;
- must-have rules (skills, compliance, gender, do-not-send, locks, availability)
  restrict which vehicles may serve each stop;
- the cost is travel time, plus a penalty for carers the client has not had recently
  (continuity) and for using carers already past their contracted hours;
- any visit may be left unfilled, at a large penalty, and is explained afterwards.

Days are solved Monday to Sunday so weekly hour limits carry forward.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from .models import Block, Carer, Problem, Visit
from .rules import carer_rule_failure, explain_unfilled, fits_block
from .travel import MODES, travel_minutes

UNFILLED_PENALTY = 100_000
CONTINUITY_PENALTY = 12  # minutes-equivalent per visit by a carer new to the client
OVER_CONTRACT_COST = 40  # discourages using carers already past contracted hours


@dataclass
class Stop:
    visit_id: str
    start: int
    end: int
    travel_before: int


@dataclass
class DayResult:
    day: int
    assigned: dict[str, list[str]] = field(default_factory=dict)  # visit -> carers
    starts: dict[str, int] = field(default_factory=dict)  # visit -> start
    unfilled: dict[str, str] = field(default_factory=dict)  # visit -> reason
    routes: dict[str, list[Stop]] = field(default_factory=dict)  # carer -> stops


@dataclass
class Pin:
    """Keep a visit with given carers near a given start (used for sickness cover)."""

    carers: list[str]
    start: int
    tolerance: int = 10


def solve_day(
    problem: Problem,
    day: int,
    used_minutes: dict[str, int],
    seconds: int = 10,
    pins: dict[str, Pin] | None = None,
    absent: set[str] | None = None,
) -> DayResult:
    pins = pins or {}
    absent = absent or set()
    result = DayResult(day)
    visits = [v for v in problem.visits if v.day == day]

    # --- vehicles: one per carer availability block --------------------------------
    vehicles: list[tuple[Carer, Block]] = []
    for carer in problem.carers:
        if carer.id in absent:
            continue
        remaining = carer.max_minutes_week - used_minutes.get(carer.id, 0)
        if remaining <= 0:
            continue
        for block in carer.blocks_on(day):
            vehicles.append((carer, block))

    # --- stops: one per carer needed on each visit ----------------------------------
    stops: list[tuple[Visit, int]] = []  # (visit, slot number)
    allowed: list[list[int]] = []
    for visit in visits:
        pin = pins.get(visit.id)
        ok_vehicles = []
        for vi, (carer, block) in enumerate(vehicles):
            if carer_rule_failure(problem, carer, visit):
                continue
            if pin:
                lo, hi = pin.start - pin.tolerance, pin.start + pin.tolerance
                start = max(lo, block.start)
                if start > hi or start + visit.duration > block.end:
                    continue
            elif not fits_block(visit, block):
                continue
            ok_vehicles.append(vi)

        distinct = {vehicles[vi][0].id for vi in ok_vehicles}
        if len(distinct) < visit.carers_needed:
            result.unfilled[visit.id] = explain_unfilled(problem, visit)
            continue

        pinned = [c for c in (pin.carers if pin else []) if c not in absent]
        for slot in range(visit.carers_needed):
            if slot < len(pinned):
                slot_vehicles = [vi for vi in ok_vehicles if vehicles[vi][0].id == pinned[slot]]
                if not slot_vehicles:  # pinned carer no longer possible: free slot
                    slot_vehicles = ok_vehicles
            else:
                slot_vehicles = ok_vehicles
            stops.append((visit, slot))
            allowed.append(slot_vehicles)

    if not vehicles or not stops:
        for visit, _ in stops:
            result.unfilled[visit.id] = explain_unfilled(problem, visit)
        return result

    # --- nodes: vehicle homes first, then stops --------------------------------------
    n_veh = len(vehicles)
    locations = [carer.home for carer, _ in vehicles]
    locations += [problem.client_by_id[v.client_id].location for v, _ in stops]
    service = [0] * n_veh + [v.duration for v, _ in stops]
    clients = [None] * n_veh + [v.client_id for v, _ in stops]
    n = len(locations)

    travel = {
        mode: [[travel_minutes(locations[i], locations[j], mode) for j in range(n)] for i in range(n)]
        for mode in MODES
    }

    manager = pywrapcp.RoutingIndexManager(n, n_veh, list(range(n_veh)), list(range(n_veh)))
    routing = pywrapcp.RoutingModel(manager)
    solver = routing.solver()

    # time: service at the stop you leave + travel to the next one
    time_cb = {}
    for mode in MODES:
        t = travel[mode]
        time_cb[mode] = routing.RegisterTransitMatrix(
            [[service[i] + t[i][j] for j in range(n)] for i in range(n)]
        )
    routing.AddDimensionWithVehicleTransits(
        [time_cb[carer.travel_mode] for carer, _ in vehicles], 24 * 60, 24 * 60, False, "Time"
    )
    time_dim = routing.GetDimensionOrDie("Time")

    # cost: travel + continuity penalty, per carer
    cost_cb: dict[str, int] = {}
    for vi, (carer, block) in enumerate(vehicles):
        if carer.id not in cost_cb:
            t = travel[carer.travel_mode]
            matrix = []
            for i in range(n):
                row = []
                for j in range(n):
                    c = t[i][j]
                    if j >= n_veh and carer.id not in problem.client_by_id[clients[j]].recent_carers:
                        c += CONTINUITY_PENALTY
                    row.append(c)
                matrix.append(row)
            cost_cb[carer.id] = routing.RegisterTransitMatrix(matrix)
        routing.SetArcCostEvaluatorOfVehicle(cost_cb[carer.id], vi)
        if used_minutes.get(carer.id, 0) >= carer.contracted_minutes_week:
            routing.SetFixedCostOfVehicle(OVER_CONTRACT_COST, vi)

    # work minutes, capped by remaining weekly hours
    work_cb = routing.RegisterUnaryTransitVector(service)
    caps = [
        min(block.end - block.start, carer.max_minutes_week - used_minutes.get(carer.id, 0))
        for carer, block in vehicles
    ]
    routing.AddDimensionWithVehicleCapacity(work_cb, 0, caps, True, "Work")
    work_dim = routing.GetDimensionOrDie("Work")
    by_carer: dict[str, list[int]] = {}
    for vi, (carer, _) in enumerate(vehicles):
        by_carer.setdefault(carer.id, []).append(vi)
    for cid, vis in by_carer.items():
        if len(vis) > 1:
            carer = problem.carer_by_id[cid]
            remaining = carer.max_minutes_week - used_minutes.get(cid, 0)
            solver.Add(solver.Sum([work_dim.CumulVar(routing.End(v)) for v in vis]) <= remaining)

    # vehicle availability windows
    for vi, (_, block) in enumerate(vehicles):
        time_dim.CumulVar(routing.Start(vi)).SetRange(block.start, block.end)
        time_dim.CumulVar(routing.End(vi)).SetRange(block.start, block.end)

    # stops: windows, allowed carers, optional
    first_slot: dict[str, int] = {}
    for k, (visit, slot) in enumerate(stops):
        idx = manager.NodeToIndex(n_veh + k)
        pin = pins.get(visit.id)
        if pin:
            time_dim.CumulVar(idx).SetRange(pin.start - pin.tolerance, pin.start + pin.tolerance)
        else:
            time_dim.CumulVar(idx).SetRange(visit.earliest, visit.latest)
        # -1 means 'not served'; otherwise only the allowed vehicles
        routing.VehicleVar(idx).SetValues([-1] + allowed[k])
        routing.AddDisjunction([idx], UNFILLED_PENALTY)
        if slot == 0:
            first_slot[visit.id] = idx
        else:  # second carer: same start, same fate, different carer
            a = first_slot[visit.id]
            solver.Add(time_dim.CumulVar(idx) == time_dim.CumulVar(a))
            solver.Add(routing.ActiveVar(idx) == routing.ActiveVar(a))
            solver.Add(abs(routing.VehicleVar(idx) - routing.VehicleVar(a)) >= routing.ActiveVar(a))

    for vi in range(n_veh):
        routing.AddVariableMinimizedByFinalizer(time_dim.CumulVar(routing.End(vi)))

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.FromSeconds(seconds)
    solution = routing.SolveWithParameters(params)
    if solution is None:
        params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.ALL_UNPERFORMED
        solution = routing.SolveWithParameters(params)
    if solution is None:
        raise RuntimeError(f"No rota found for day {day}")

    # --- read the answer ---------------------------------------------------------------
    for vi, (carer, _) in enumerate(vehicles):
        idx = routing.Start(vi)
        prev = manager.IndexToNode(idx)
        idx = solution.Value(routing.NextVar(idx))
        mode_t = travel[carer.travel_mode]
        while not routing.IsEnd(idx):
            node = manager.IndexToNode(idx)
            visit, _ = stops[node - n_veh]
            start = solution.Min(time_dim.CumulVar(idx))
            result.routes.setdefault(carer.id, []).append(
                Stop(visit.id, start, start + visit.duration, mode_t[prev][node])
            )
            result.assigned.setdefault(visit.id, []).append(carer.id)
            result.starts[visit.id] = start
            prev = node
            idx = solution.Value(routing.NextVar(idx))

    for visit, _ in stops:
        if visit.id not in result.assigned and visit.id not in result.unfilled:
            result.unfilled[visit.id] = explain_unfilled(problem, visit)
    for stops_ in result.routes.values():
        stops_.sort(key=lambda s: s.start)
    return result


def solve_week(problem: Problem, seconds_per_day: int = 10, progress=None) -> list[DayResult]:
    used: dict[str, int] = {}
    results = []
    for day in range(7):
        res = solve_day(problem, day, used, seconds_per_day)
        for cid, stops in res.routes.items():
            used[cid] = used.get(cid, 0) + sum(s.end - s.start for s in stops)
        results.append(res)
        if progress:
            progress(day, res)
    return results


def cover_absence(
    problem: Problem,
    week: list[DayResult],
    day: int,
    absent_carer: str,
    seconds: int = 10,
) -> tuple[DayResult, dict]:
    """Re-plan one day after a carer drops out, keeping everyone else's visits in place.

    Returns the new day plan and a summary of what changed.
    """
    before = week[day]
    used: dict[str, int] = {}
    for d in range(7):
        if d == day:
            continue
        for cid, stops in week[d].routes.items():
            used[cid] = used.get(cid, 0) + sum(s.end - s.start for s in stops)

    pins = {
        vid: Pin(carers=[c for c in carers if c != absent_carer], start=before.starts[vid])
        for vid, carers in before.assigned.items()
        if absent_carer not in carers
    }
    # double-ups that lose one carer keep the other one in place
    for vid, carers in before.assigned.items():
        if absent_carer in carers and len(carers) > 1:
            pins[vid] = Pin(carers=[c for c in carers if c != absent_carer], start=before.starts[vid], tolerance=30)

    after = solve_day(problem, day, used, seconds, pins=pins, absent={absent_carer})

    affected = [vid for vid, carers in before.assigned.items() if absent_carer in carers]
    summary = {
        "day": day,
        "absent_carer": absent_carer,
        "affected_visits": len(affected),
        "covered": [
            {"visit_id": vid, "new_carers": after.assigned[vid], "start": after.starts[vid]}
            for vid in affected
            if vid in after.assigned
        ],
        "still_unfilled": [
            {"visit_id": vid, "reason": after.unfilled.get(vid, "")}
            for vid in affected
            if vid not in after.assigned
        ],
        "other_visits_moved": sum(
            1
            for vid, carers in before.assigned.items()
            if absent_carer not in carers and after.assigned.get(vid) != carers
        ),
    }
    return after, summary
