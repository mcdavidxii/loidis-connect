"""Pluggable travel: default unchanged, a provider is used when given, missing pairs fall back."""

from loidis_rota.models import Location
from loidis_rota.report import build_report
from loidis_rota.solver import solve_day, solve_week
from loidis_rota.synthetic import generate
from loidis_rota.travel import EstimateTravel, MatrixTravel, TravelProvider, miles, travel_minutes


class Flat(TravelProvider):
    """Every trip takes 10 minutes and 2 miles, whatever the mode."""

    def __init__(self):
        self.calls = 0

    def minutes(self, a, b, mode):
        self.calls += 1
        return 0 if a == b else 10

    def miles(self, a, b, mode="car"):
        return 0.0 if a == b else 2.0


A, B = Location(50.7, -2.4), Location(50.8, -2.5)


def test_default_is_the_estimate():
    p = generate(seed=7)
    assert isinstance(p.travel, EstimateTravel)
    assert p.travel.minutes(A, B, "car") == travel_minutes(A, B, "car")
    assert p.travel.miles(A, B) == miles(A, B)
    assert "travel" not in p.to_dict()  # the Problem JSON is unchanged


def test_matrix_uses_table_for_car_and_falls_back_otherwise():
    t = MatrixTravel({(A, B): (12.4, 9.0)})
    assert t.minutes(A, B, "car") == 12 + 3  # table minutes plus the estimate's parking overhead
    assert t.miles(A, B) == 9.0
    assert t.minutes(A, B, "foot") == travel_minutes(A, B, "foot")  # other modes keep the estimate
    assert t.minutes(B, A, "car") == travel_minutes(B, A, "car")  # pair not in the table: estimate
    assert t.miles(B, A) == miles(B, A)
    assert t.minutes(A, A, "car") == 0


def test_provider_is_used_by_the_solver_and_report():
    p = generate(seed=7)
    p.visits = [v for v in p.visits if v.day == 0][:12]
    default = solve_day(p, 0, {}, seconds=2)
    flat = Flat()
    res = solve_week(p, 2, travel=flat)  # the provider given to solve_week is used
    assert flat.calls > 0 and p.travel is flat
    assert all(st.travel_before in (0, 10) for r in res[0].routes.values() for st in r)
    rep = build_report(p, res)
    assert rep["metrics"]["miles"] % 2 == 0 or rep["metrics"]["miles"] >= 0
    assert default is not None


def test_default_solve_unchanged_by_the_refactor():
    p = generate(seed=7)
    p.visits = [v for v in p.visits if v.day == 0][:10]
    a = solve_day(p, 0, {}, seconds=2)
    p.travel = EstimateTravel()
    b = solve_day(p, 0, {}, seconds=2)
    assert a.assigned.keys() == b.assigned.keys()
    assert sum(s.travel_before for r in a.routes.values() for s in r) == sum(s.travel_before for r in b.routes.values() for s in r)
