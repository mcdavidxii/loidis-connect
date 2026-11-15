"""The engine may leave visits unfilled, but must never break a must-have rule."""

import pytest

from loidis_rota.report import build_report
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
            problem.counted_minutes(problem.visit_by_id[st.visit_id])
            for day in week
            for st in day.routes.get(carer.id, [])
        )
        assert worked <= carer.max_minutes_week


def test_no_work_on_leave_or_sick_days(solved):
    problem, week = solved
    for a in problem.absences:
        assert a.carer_id not in week[a.day].routes


def test_rest_after_sleep_in(solved):
    problem, week = solved
    rest = problem.settings.rest_after_sleep_in_minutes
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
    # cover must never drop someone else's planned visit to fill the absent carer's
    others = [vid for vid, cs in week[day].assigned.items() if busiest not in cs]
    assert all(vid in after.assigned for vid in others)
    assert summary["other_visits_moved"] <= max(2, len(others) // 10)


def test_do_not_send_and_safeguarding(solved):
    problem, week = solved
    report = build_report(problem, week)
    for v in report["visits"]:
        client = problem.client_by_id[v["client_id"]]
        barred = set(client.do_not_send) | set(client.safeguarding_bar)
        assert not barred & set(v["assigned"]), "barred carer booked"
        for cid in v.get("override_suggestions", []):
            assert cid in client.do_not_send, "only do-not-send carers may be suggested"
            assert cid not in client.safeguarding_bar, "safeguarding bar is never suggested"


def test_override_suggestion_appears_but_is_never_booked():
    """One visit, two free carers: one on do-not-send, one barred for safeguarding."""
    from datetime import date

    from loidis_rota.models import Block, Carer, Client, Location, Problem, Visit

    week = date(2026, 11, 16)
    home = Location(50.61, -2.45)

    def carer(cid):
        return Carer(
            id=cid, area="Weymouth", home=home, travel_mode="car", skills=["medication"],
            gender="female", contracted_minutes_week=1200, max_minutes_week=1800,
            dbs_expiry=date(2028, 1, 1), training_expiry=date(2028, 1, 1),
            availability=[Block(0, 7 * 60, 14 * 60)],
        )

    client = Client(
        id="C001", area="Weymouth", location=Location(50.612, -2.452),
        commissioned_minutes_week=30, funder="council",
        do_not_send=["K001"], safeguarding_bar=["K002"],
    )
    visit = Visit(id="V1", client_id="C001", day=0, start=8 * 60, window=30, duration=30)
    problem = Problem(week, [client], [carer("K001"), carer("K002")], [visit])

    result = solve_week(problem, seconds_per_day=1)
    report = build_report(problem, result)
    v = report["visits"][0]
    assert v["assigned"] == []
    assert v["override_suggestions"] == ["K001"]
