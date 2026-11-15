"""The engine may leave visits unfilled, but must never break a must-have rule."""

import pytest

from loidis_rota.rules import carer_rule_failure
from loidis_rota.solver import cover_absence, solve_week
from loidis_rota.synthetic import generate


@pytest.fixture(scope="module")
def solved():
    problem = generate(seed=3, n_clients=22, n_carers=16)
    week = solve_week(problem, seconds_per_day=2)
    return problem, week


def test_assigned_carers_pass_every_rule(solved):
    problem, week = solved
    for v in problem.visits:
        carers = week[v.day].assigned.get(v.id)
        if not carers:
            continue
        assert len(carers) == v.carers_needed
        assert len(set(carers)) == len(carers), "double-up needs two different carers"
        for cid in carers:
            assert carer_rule_failure(problem, problem.carer_by_id[cid], v) is None


def test_start_inside_time_window_and_availability(solved):
    problem, week = solved
    for day in week:
        for cid, stops in day.routes.items():
            blocks = problem.carer_by_id[cid].blocks_on(day.day)
            for st in stops:
                v = next(x for x in problem.visits if x.id == st.visit_id)
                assert v.earliest <= st.start <= v.latest
                assert any(b.start <= st.start and st.end <= b.end for b in blocks)


def test_no_overlaps_including_travel(solved):
    _, week = solved
    for day in week:
        for stops in day.routes.values():
            for a, b in zip(stops, stops[1:]):
                assert a.end + b.travel_before <= b.start


def test_double_ups_start_together(solved):
    problem, week = solved
    for day in week:
        for vid, carers in day.assigned.items():
            if len(carers) == 2:
                starts = {
                    st.start
                    for cid in carers
                    for st in day.routes[cid]
                    if st.visit_id == vid
                }
                assert len(starts) == 1


def test_weekly_maximum_hours(solved):
    problem, week = solved
    for carer in problem.carers:
        worked = sum(
            st.end - st.start for day in week for st in day.routes.get(carer.id, [])
        )
        assert worked <= carer.max_minutes_week


def test_no_work_on_leave_or_sick_days(solved):
    problem, week = solved
    for a in problem.absences:
        assert a.carer_id not in week[a.day].routes


def test_rest_after_night_shift(solved):
    problem, week = solved
    rest = problem.settings.rest_after_night_minutes
    for d in range(6):
        for cid, stops in week[d].routes.items():
            last = max(st.end for st in stops)
            if last > 24 * 60 and cid in week[d + 1].routes:
                first = min(st.start for st in week[d + 1].routes[cid])
                assert first >= last - 24 * 60 + rest


def test_sickness_cover_removes_carer_and_keeps_others(solved):
    problem, week = solved
    day = 2
    busiest = max(week[day].routes, key=lambda c: len(week[day].routes[c]))
    after, summary = cover_absence(problem, week, day, busiest, seconds=2)
    assert busiest not in after.routes
    assert summary["affected_visits"] == len(week[day].routes[busiest])
    # everyone else's visits should stay almost entirely as they were
    others = [vid for vid, cs in week[day].assigned.items() if busiest not in cs]
    assert summary["other_visits_moved"] <= max(2, len(others) // 10)
