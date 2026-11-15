"""Rota engine: assign carers to visits and order each carer's day.

Each day is solved as a vehicle routing problem with time windows (OR-Tools):

- a "vehicle" is one availability block of one carer, starting and ending at home;
  night blocks run past midnight;
- a visit needing two carers becomes two linked stops that must start at the same
  time with different carers; each carer travels in from and out to their own places;
- must-have rules (skills, compliance, leave and sickness, gender preference,
  do-not-send, locks, availability) decide which vehicles may serve each stop;
- the cost, in pence, is: paid travel time + mileage for drivers + a penalty for
  carers new to the client (continuity) + penalties that balance hours (carers below
  their fair share, or above their contract);
- any visit may be left unfilled, at a very large penalty, and is explained afterwards.

Days are solved Monday to Sunday so weekly hours and rest after night shifts carry
forward.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from .models import Block, Carer, Problem, Visit
from .rules import carer_rule_failure, explain_unfilled, fits_block
from .travel import MODES, miles, travel_minutes

DAY_MINUTES = 24 * 60


@dataclass
class Stop:
    visit_id: str
    start: int
    end: int
    travel_before: int  # minutes
    miles_before: float  # driving miles (0 for walkers and bus users)


@dataclass
class DayResult:
    day: int
    assigned: dict[str, list[str]] = field(default_factory=dict)  # visit -> carers
    starts: dict[str, int] = field(default_factory=dict)  # visit -> start
    unfilled: dict[str, str] = field(default_factory=dict)  # visit -> reason
    routes: dict[str, list[Stop]] = field(default_factory=dict)  # carer -> stops
    travel_home: dict[str, tuple[int, float]] = field(default_factory=dict)  # last stop -> home


@dataclass
class Pin:
    """Keep a visit with given carers near a given start (used for sickness cover)."""

    carers: list[str]
    start: int
    tolerance: int = 10


def _working_days_left(problem: Problem, carer: Carer, day: int) -> int:
    return sum(
        1
        for d in range(day, 7)
        if carer.blocks_on(d) and not problem.absence(carer.id, d)
    )


def solve_day(
    problem: Problem,
    day: int,
    used_minutes: dict[str, int],
    seconds: int = 10,
    pins: dict[str, Pin] | None = None,
    absent: set[str] | None = None,
    not_before: dict[str, int] | None = None,
    initial: dict[str, list[str]] | None = None,
) -> DayResult:
    """Plan one day.

    used_minutes: care minutes each carer has already worked this week.
    pins: visits to keep with given carers (sickness cover).
    absent: extra carers to treat as unavailable today.
    not_before: earliest start per carer today (rest after a night shift).
    initial: an existing plan to start from (carer -> visit ids in order), so the
        search keeps it unless it finds something better (sickness cover).
    """
    s = problem.settings
    pins = pins or {}
    absent = absent or set()
    not_before = not_before or {}
    result = DayResult(day)
    visits = [v for v in problem.visits if v.day == day]
    visit_by_id = {v.id: v for v in visits}
    pay_per_min = s.pay_pence_per_hour / 60 if s.travel_time_paid else 0.0

    # --- vehicles: one per carer availability block --------------------------------
    vehicles: list[tuple[Carer, Block]] = []
    for carer in problem.carers:
        if carer.id in absent or problem.absence(carer.id, day):
            continue
        if carer.max_minutes_week - used_minutes.get(carer.id, 0) <= 0:
            continue
        for block in carer.blocks_on(day):
            start = max(block.start, not_before.get(carer.id, 0))
            if block.end - start >= 60:
                vehicles.append((carer, Block(day, start, block.end)))

    # --- stops: one per carer needed on each visit ----------------------------------
    stops: list[tuple[Visit, int]] = []  # (visit, slot number)
    allowed: list[list[int]] = []
    slot_of: dict[tuple[str, str], int] = {}  # (visit, pinned carer) -> stop number
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
            slot_vehicles = ok_vehicles
            if slot < len(pinned):
                kept = [vi for vi in ok_vehicles if vehicles[vi][0].id == pinned[slot]]
                slot_vehicles = kept or ok_vehicles
                if kept:
                    slot_of[(visit.id, pinned[slot])] = len(stops)
            stops.append((visit, slot))
            allowed.append(slot_vehicles)

    if not vehicles or not stops:
        return result

    # --- nodes: vehicle homes first, then stops --------------------------------------
    n_veh = len(vehicles)
    locations = [carer.home for carer, _ in vehicles]
    locations += [problem.client_by_id[v.client_id].location for v, _ in stops]
    service = [0] * n_veh + [v.duration for v, _ in stops]
    client_of = [None] * n_veh + [v.client_id for v, _ in stops]
    n = len(locations)

    travel = {
        mode: [[travel_minutes(locations[i], locations[j], mode) for j in range(n)] for i in range(n)]
        for mode in MODES
    }
    dist = [[miles(locations[i], locations[j]) for j in range(n)] for i in range(n)]

    def build(strict_pairs: bool):
        """Build the routing model. strict_pairs adds "both carers or neither" for
        double-ups; insertion heuristics cannot start from it, so it is only used to
        polish a plan found without it."""
        manager = pywrapcp.RoutingIndexManager(n, n_veh, list(range(n_veh)), list(range(n_veh)))
        routing = pywrapcp.RoutingModel(manager)
        solver = routing.solver()

        # time = service at the stop you leave + travel to the next one
        time_cb = {
            mode: routing.RegisterTransitMatrix(
                [[service[i] + travel[mode][i][j] for j in range(n)] for i in range(n)]
            )
            for mode in MODES
        }
        routing.AddDimensionWithVehicleTransits(
            [time_cb[carer.travel_mode] for carer, _ in vehicles],
            DAY_MINUTES,  # waiting allowed between visits
            2 * DAY_MINUTES,  # night shifts run into the next morning
            False,
            "Time",
        )
        time_dim = routing.GetDimensionOrDie("Time")

        # cost per carer, in pence: paid travel time + mileage + continuity penalty
        cost_cb: dict[str, int] = {}
        for vi, (carer, _) in enumerate(vehicles):
            if carer.id not in cost_cb:
                cost_cb[carer.id] = routing.RegisterTransitMatrix(cost_matrix[carer.id])
            routing.SetArcCostEvaluatorOfVehicle(cost_cb[carer.id], vi)

        # work minutes, capped by remaining weekly maximum, softly balanced
        work_cb = routing.RegisterUnaryTransitVector(service)
        routing.AddDimensionWithVehicleCapacity(work_cb, 0, caps, True, "Work")
        work_dim = routing.GetDimensionOrDie("Work")
        for cid, vis in by_carer.items():
            if len(vis) > 1:
                solver.Add(
                    solver.Sum([work_dim.CumulVar(routing.End(v)) for v in vis]) <= remaining_max[cid]
                )
        for v, (lower, upper) in balance.items():
            work_dim.SetCumulVarSoftLowerBound(routing.End(v), lower, s.under_target_pence_per_min)
            work_dim.SetCumulVarSoftUpperBound(routing.End(v), upper, s.over_contract_pence_per_min)

        # availability windows
        for vi, (_, block) in enumerate(vehicles):
            time_dim.CumulVar(routing.Start(vi)).SetRange(block.start, block.end)
            time_dim.CumulVar(routing.End(vi)).SetRange(block.start, block.end)

        # stops: time windows, allowed carers, optional
        first_slot: dict[str, int] = {}
        for k, (visit, slot) in enumerate(stops):
            idx = manager.NodeToIndex(n_veh + k)
            pin = pins.get(visit.id)
            if pin:
                time_dim.CumulVar(idx).SetRange(pin.start - pin.tolerance, pin.start + pin.tolerance)
            else:
                time_dim.CumulVar(idx).SetRange(visit.earliest, visit.latest)
            # -1 means "not served"; otherwise only the allowed vehicles
            routing.VehicleVar(idx).SetValues([-1] + allowed[k])
            routing.AddDisjunction([idx], s.unfilled_penalty)
            if slot == 0:
                first_slot[visit.id] = idx
            else:  # second carer: same start, different carer
                a = first_slot[visit.id]
                solver.Add(time_dim.CumulVar(idx) == time_dim.CumulVar(a))
                solver.Add(
                    abs(routing.VehicleVar(idx) - routing.VehicleVar(a))
                    >= routing.ActiveVar(a) * routing.ActiveVar(idx)
                )
                if strict_pairs:
                    solver.Add(routing.ActiveVar(idx) == routing.ActiveVar(a))

        for vi in range(n_veh):
            routing.AddVariableMinimizedByFinalizer(time_dim.CumulVar(routing.End(vi)))
            routing.AddVariableMaximizedByFinalizer(time_dim.CumulVar(routing.Start(vi)))
        return manager, routing, time_dim

    # precompute costs and limits shared by both passes
    cost_matrix: dict[str, list[list[int]]] = {}
    for carer, _ in vehicles:
        if carer.id in cost_matrix:
            continue
        t = travel[carer.travel_mode]
        per_mile = s.mileage_pence_per_mile if carer.travel_mode == "car" else 0
        rows = []
        for i in range(n):
            row = []
            for j in range(n):
                c = t[i][j] * pay_per_min + dist[i][j] * per_mile
                if j >= n_veh and carer.id not in problem.client_by_id[client_of[j]].recent_carers:
                    c += s.continuity_penalty_pence
                row.append(int(round(c)))
            rows.append(row)
        cost_matrix[carer.id] = rows

    caps = [
        min(block.end - block.start, carer.max_minutes_week - used_minutes.get(carer.id, 0))
        for carer, block in vehicles
    ]
    by_carer: dict[str, list[int]] = {}
    for vi, (carer, _) in enumerate(vehicles):
        by_carer.setdefault(carer.id, []).append(vi)
    remaining_max: dict[str, int] = {}
    balance: dict[int, tuple[int, int]] = {}
    for cid, vis in by_carer.items():
        carer = problem.carer_by_id[cid]
        used = used_minutes.get(cid, 0)
        remaining_max[cid] = carer.max_minutes_week - used
        # fair share today = contracted minutes still to work / working days left
        remaining_contract = max(0, carer.contracted_minutes_week - used)
        target_today = remaining_contract / max(1, _working_days_left(problem, carer, day))
        total_len = sum(vehicles[v][1].end - vehicles[v][1].start for v in vis)
        for v in vis:
            share = (vehicles[v][1].end - vehicles[v][1].start) / total_len
            balance[v] = (int(target_today * share), int(remaining_contract * share))

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH

    # pass 1: find a plan, double-ups may end up half-filled
    manager, routing, time_dim = build(strict_pairs=False)
    params.time_limit.FromSeconds(max(1, seconds // 2))
    solution = None
    if initial:
        start_routes = []
        for carer, block in vehicles:
            route = []
            for vid in initial.get(carer.id, []):
                k = slot_of.get((vid, carer.id))
                if k is not None and block.start <= pins[vid].start <= block.end:
                    route.append(manager.NodeToIndex(n_veh + k))
            start_routes.append(route)
        routing.CloseModelWithParameters(params)
        seed = routing.ReadAssignmentFromRoutes(start_routes, True)
        if seed is not None:
            solution = routing.SolveFromAssignmentWithParameters(seed, params) or seed
    if solution is None:
        solution = routing.SolveWithParameters(params)
    if solution is None:
        raise RuntimeError(f"No rota found for day {day}")
    routes = []  # routing indices of the stops on each vehicle, in order
    for vi in range(n_veh):
        idx = solution.Value(routing.NextVar(routing.Start(vi)))
        route = []
        while not routing.IsEnd(idx):
            route.append(idx)
            idx = solution.Value(routing.NextVar(idx))
        routes.append(route)

    # drop half-filled double-ups, then pass 2: polish with "both or neither"
    def visit_at(idx):
        return stops[manager.IndexToNode(idx) - n_veh][0]

    slots_served: dict[str, int] = {}
    for route in routes:
        for idx in route:
            vid = visit_at(idx).id
            slots_served[vid] = slots_served.get(vid, 0) + 1
    half = {vid for vid, cnt in slots_served.items() if cnt < visit_by_id[vid].carers_needed}
    routes = [[idx for idx in route if visit_at(idx).id not in half] for route in routes]

    manager, routing, time_dim = build(strict_pairs=True)
    routing.CloseModelWithParameters(params)
    initial = routing.ReadAssignmentFromRoutes(routes, True)
    params.time_limit.FromSeconds(max(1, seconds - seconds // 2))
    polished = routing.SolveFromAssignmentWithParameters(initial, params) if initial else None
    solution = polished or initial
    if solution is None:
        raise RuntimeError(f"No rota found for day {day} (polish step)")

    # --- read the answer ---------------------------------------------------------------
    for vi, (carer, _) in enumerate(vehicles):
        idx = routing.Start(vi)
        prev = manager.IndexToNode(idx)
        idx = solution.Value(routing.NextVar(idx))
        t = travel[carer.travel_mode]
        drives = carer.travel_mode == "car"
        while not routing.IsEnd(idx):
            node = manager.IndexToNode(idx)
            visit, _ = stops[node - n_veh]
            start = solution.Min(time_dim.CumulVar(idx))
            result.routes.setdefault(carer.id, []).append(
                Stop(
                    visit.id,
                    start,
                    start + visit.duration,
                    t[prev][node],
                    round(dist[prev][node], 2) if drives else 0.0,
                )
            )
            result.assigned.setdefault(visit.id, []).append(carer.id)
            result.starts[visit.id] = start
            prev = node
            idx = solution.Value(routing.NextVar(idx))
        if prev != manager.IndexToNode(routing.Start(vi)):  # worked: trip home
            home = manager.IndexToNode(routing.Start(vi))
            result.travel_home[carer.id] = (t[prev][home], round(dist[prev][home], 2) if drives else 0.0)

    for visit, _ in stops:
        if visit.id not in result.assigned and visit.id not in result.unfilled:
            result.unfilled[visit.id] = explain_unfilled(problem, visit)
    for route in result.routes.values():
        route.sort(key=lambda st: st.start)
    return result


def _rest_after(problem: Problem, res: DayResult) -> dict[str, int]:
    """Earliest start next day for carers who worked past midnight."""
    out = {}
    for cid, stops in res.routes.items():
        last_end = max(st.end for st in stops)
        if last_end > DAY_MINUTES:
            out[cid] = last_end - DAY_MINUTES + problem.settings.rest_after_night_minutes
    return out


def solve_week(problem: Problem, seconds_per_day: int = 10, progress=None) -> list[DayResult]:
    used: dict[str, int] = {}
    not_before: dict[str, int] = {}
    results = []
    for day in range(7):
        res = solve_day(problem, day, used, seconds_per_day, not_before=not_before)
        for cid, stops in res.routes.items():
            used[cid] = used.get(cid, 0) + sum(st.end - st.start for st in stops)
        not_before = _rest_after(problem, res)
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
            used[cid] = used.get(cid, 0) + sum(st.end - st.start for st in stops)
    not_before = _rest_after(problem, week[day - 1]) if day > 0 else {}

    pins = {}
    for vid, carers in before.assigned.items():
        others = [c for c in carers if c != absent_carer]
        if not others:
            continue  # the absent carer's solo visits are free to move
        tolerance = 10 if len(others) == len(carers) else 30
        pins[vid] = Pin(carers=others, start=before.starts[vid], tolerance=tolerance)

    initial = {
        cid: [st.visit_id for st in stops]
        for cid, stops in before.routes.items()
        if cid != absent_carer
    }
    after = solve_day(
        problem, day, used, seconds, pins=pins, absent={absent_carer},
        not_before=not_before, initial=initial,
    )

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
            if absent_carer not in carers and set(after.assigned.get(vid, [])) != set(carers)
        ),
        "previously_unfilled_now_filled": sum(
            1 for vid in before.unfilled if vid in after.assigned
        ),
    }
    return after, summary
