"""shift_pence_per_min: a cost for starting a visit away from its booked time."""

from datetime import date

from loidis_rota.models import Block, Carer, Client, Location, Problem, Settings, Visit
from loidis_rota.report import build_report
from loidis_rota.solver import solve_week


def _problem(visits, shift_cost):
    home = Location(50.61, -2.45)
    carer = Carer(
        id="K001", area="Weymouth", home=home, travel_mode="car", skills=[],
        gender="female", contracted_minutes_week=0, max_minutes_week=3000,
        dbs_expiry=date(2028, 1, 1), training_expiry=date(2028, 1, 1),
        availability=[Block(0, 7 * 60, 20 * 60)],
    )
    client = Client(
        id="C001", area="Weymouth", location=Location(50.612, -2.452),
        commissioned_minutes_week=0, funder="council",
    )
    return Problem(
        date(2026, 11, 16), [client], [carer], visits,
        settings=Settings(shift_pence_per_min=shift_cost),
    )


def _v(vid, start, window, duration=60):
    return Visit(id=vid, client_id="C001", day=0, start=start, window=window, duration=duration)


def test_lone_visit_stays_at_booked_time_when_moving_is_not_needed():
    problem = _problem([_v("V1", 10 * 60, 30)], shift_cost=10)
    week = solve_week(problem, seconds_per_day=2)
    assert week[0].starts["V1"] == 10 * 60
    m = build_report(problem, week)["metrics"]
    assert m["visits_shifted"] == 0
    assert m["mean_abs_shift_minutes"] == 0
    assert m["max_abs_shift_minutes"] == 0


def test_zero_cost_keeps_window_free_and_stays_inside_it():
    problem = _problem([_v("V1", 10 * 60, 30)], shift_cost=0)
    week = solve_week(problem, seconds_per_day=2)
    assert 9 * 60 + 30 <= week[0].starts["V1"] <= 10 * 60 + 30
    assert problem.settings.shift_pence_per_min == 0
    assert Problem.from_dict(problem.to_dict()).settings.shift_pence_per_min == 0


def test_moderate_cost_still_moves_a_visit_when_that_is_the_only_way_to_fill_it():
    # V2 is booked at 10:30 but V1 occupies the carer until 11:00 (same client, no travel)
    visits = [_v("V1", 10 * 60, 0), _v("V2", 10 * 60 + 30, 30)]
    problem = _problem(visits, shift_cost=15)
    week = solve_week(problem, seconds_per_day=2)
    assert set(week[0].assigned) == {"V1", "V2"}
    assert week[0].starts["V2"] >= 11 * 60
    m = build_report(problem, week)["metrics"]
    assert m["visits_shifted"] == 1
    assert 20 <= m["max_abs_shift_minutes"] <= 30
    assert m["mean_abs_shift_minutes"] == m["max_abs_shift_minutes"] / 2


def test_settings_round_trip():
    s = Settings(shift_pence_per_min=7)
    problem = _problem([_v("V1", 600, 0)], 7)
    assert Problem.from_dict(problem.to_dict()).settings.shift_pence_per_min == 7 == s.shift_pence_per_min
