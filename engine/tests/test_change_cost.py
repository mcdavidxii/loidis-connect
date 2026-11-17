"""change_pence_per_visit: improve mode keeps the current carer unless the gain is worth it."""

from datetime import date

from loidis_rota.models import Block, Carer, Client, Location, Problem, Settings, Visit
from loidis_rota.report import build_report
from loidis_rota.solver import solve_week


def _carer(cid, lat):
    return Carer(
        id=cid, area="Weymouth", home=Location(lat, -2.452), travel_mode="car", skills=[],
        gender="female", contracted_minutes_week=0, max_minutes_week=3000,
        dbs_expiry=date(2028, 1, 1), training_expiry=date(2028, 1, 1),
        availability=[Block(0, 7 * 60, 20 * 60)],
    )


def _problem(current, change_cost, near="K001", far="K002"):
    carers = [_carer(near, 50.612), _carer(far, 50.76)]  # far is roughly 10 miles away
    client = Client(
        id="C001", area="Weymouth", location=Location(50.612, -2.452),
        commissioned_minutes_week=0, funder="council",
    )
    visit = Visit(
        id="V1", client_id="C001", day=0, start=10 * 60, window=0, duration=60,
        current_carers=current,
    )
    return Problem(
        date(2026, 11, 16), [client], carers, [visit],
        settings=Settings(change_pence_per_visit=change_cost, continuity_penalty_pence=0),
    )


def _run(problem):
    week = solve_week(problem, seconds_per_day=2)
    return week, build_report(problem, week)


def test_zero_cost_ignores_current_allocation():
    week, _ = _run(_problem(["K002"], 0))
    assert week[0].assigned["V1"] == ["K001"]


def test_high_cost_keeps_a_good_enough_current_allocation():
    week, rep = _run(_problem(["K002"], 1_000_000))
    assert week[0].assigned["V1"] == ["K002"]
    m = rep["metrics"]
    assert m["visits_carer_changed"] == 0 and m["visits_unchanged"] == 1


def test_clearly_bad_current_allocation_still_changes_at_moderate_cost():
    week, rep = _run(_problem(["K002"], 300))
    assert week[0].assigned["V1"] == ["K001"]
    v = rep["visits"][0]
    assert v["carer_changed"] and v["current_carers"] == ["K002"]
    assert v["change_reason"] == "replaces_current"
    assert rep["metrics"]["visits_carer_changed"] == 1


def test_unallocated_visit_has_no_change_cost():
    week, rep = _run(_problem([], 1_000_000))
    assert week[0].assigned["V1"] == ["K001"]
    v = rep["visits"][0]
    assert "current_carers" not in v and v["change_reason"] == "fills_unallocated"
    assert rep["metrics"]["visits_carer_changed"] == 0


def test_round_trip_of_new_fields():
    p = _problem(["K002"], 700)
    q = Problem.from_dict(p.to_dict())
    assert q.visits[0].current_carers == ["K002"]
    assert q.settings.change_pence_per_visit == 700
    old = p.to_dict()
    del old["visits"][0]["current_carers"]
    del old["settings"]["change_pence_per_visit"]
    r = Problem.from_dict(old)
    assert r.visits[0].current_carers == [] and r.settings.change_pence_per_visit == 0


def test_change_classes_time_with_change_and_time_note():
    # K001 is current on V1 (day 0, 10:00) and V2 (day 0, 10:30 booked, window 30, so it must
    # slide to 11:00). V3 is a different day, also K001, in no conflict. Nothing else changes
    # carers, so the day-0 shift is a note; then add V4 unallocated on day 0 to touch K001's day.
    def mk(extra):
        client = Client(id="C001", area="W", location=Location(50.612, -2.452),
                        commissioned_minutes_week=0, funder="council")
        mk_v = lambda i, d, s, w, cur: Visit(id=i, client_id="C001", day=d, start=s, window=w,
                                              duration=60, current_carers=cur)
        visits = [mk_v("V1", 0, 600, 0, ["K001"]), mk_v("V2", 0, 630, 30, ["K001"]),
                  mk_v("V3", 1, 600, 0, ["K001"])] + extra
        carer = _carer("K001", 50.612)
        carer.availability.append(Block(1, 7 * 60, 20 * 60))
        p = Problem(date(2026, 11, 16), [client], [carer], visits,
                    settings=Settings(change_pence_per_visit=100000, continuity_penalty_pence=0,
                                      shift_pence_per_min=5))
        return build_report(p, solve_week(p, seconds_per_day=2))

    m = mk([])["metrics"]
    assert m["time_notes"] == 1 and m["visits_time_with_change"] == 0 and m["changes_to_apply"] == 0
    assert m["visits_unchanged"] == 2 and m["visits_carer_changed"] == 0
    rep = mk([Visit(id="V4", client_id="C001", day=0, start=720, window=0, duration=60)])
    m = rep["metrics"]
    assert m["visits_time_with_change"] == 1 and m["time_notes"] == 0 and m["changes_to_apply"] == 2  # V4 fills + V2 shift


def test_filling_an_unallocated_visit_counts_as_a_change_to_apply():
    client = Client(id="C001", area="W", location=Location(50.612, -2.452),
                    commissioned_minutes_week=0, funder="council")
    visits = [
        Visit(id="V1", client_id="C001", day=0, start=600, window=0, duration=60, current_carers=["K001"]),
        Visit(id="V2", client_id="C001", day=0, start=720, window=0, duration=60),  # unallocated
    ]
    p = Problem(date(2026, 11, 16), [client], [_carer("K001", 50.612)], visits,
                settings=Settings(change_pence_per_visit=100000, continuity_penalty_pence=0))
    rep = build_report(p, solve_week(p, seconds_per_day=2))
    by = {v["id"]: v for v in rep["visits"]}
    assert by["V2"]["change_class"] == "carer" and by["V2"]["change_reason"] == "fills_unallocated"
    assert by["V1"]["change_class"] == "unchanged"
    m = rep["metrics"]
    assert m["changes_to_apply"] == 1 and m["visits_carer_changed"] == 1


# --- arrival tolerance (reporting only) -----------------------------------------------


def _shifted_report(shift, tol, current=("K001",)):
    """One visit, same carer unless current differs, started `shift` minutes after the booked start."""
    p = _problem(list(current), 0)
    p.settings.arrival_tolerance_minutes = tol
    week = solve_week(p, seconds_per_day=2)
    week[0].starts["V1"] = p.visits[0].start + shift
    return build_report(p, week), week


def test_shift_within_tolerance_is_a_note():
    rep, _ = _shifted_report(10, 15)
    v = rep["visits"][0]
    assert v["change_class"] == "time_within_tolerance"
    m = rep["metrics"]
    assert m["time_within_tolerance"] == 1 and m["changes_to_apply"] == 0


def test_shift_beyond_tolerance_is_a_change_or_note_as_before():
    rep, _ = _shifted_report(20, 15)
    v = rep["visits"][0]
    # carer-day untouched, so today's class is time_note (not within tolerance)
    assert v["change_class"] == "time_note"
    assert rep["metrics"]["time_within_tolerance"] == 0


def test_zero_tolerance_keeps_current_results():
    rep, _ = _shifted_report(10, 0)
    assert rep["visits"][0]["change_class"] == "time_note"
    assert rep["metrics"]["time_within_tolerance"] == 0


def test_carer_change_flags_new_time_needed():
    p = _problem(["K002"], 300)
    p.settings.arrival_tolerance_minutes = 15
    week = solve_week(p, seconds_per_day=2)
    assert week[0].assigned["V1"] == ["K001"]
    week[0].starts["V1"] = p.visits[0].start + 10
    rep = build_report(p, week)
    v = rep["visits"][0]
    assert v["change_class"] == "carer" and v["new_time_needed"] is False
    week[0].starts["V1"] = p.visits[0].start + 20
    rep = build_report(p, week)
    assert rep["visits"][0]["new_time_needed"] is True
    assert rep["metrics"]["carer_changes_new_time"] == 1 and rep["metrics"]["changes_to_apply"] == 1


def test_tolerance_setting_round_trips():
    p = _problem(["K001"], 0)
    p.settings.arrival_tolerance_minutes = 15
    assert Problem.from_dict(p.to_dict()).settings.arrival_tolerance_minutes == 15
    old = p.to_dict()
    del old["settings"]["arrival_tolerance_minutes"]
    assert Problem.from_dict(old).settings.arrival_tolerance_minutes == 0
