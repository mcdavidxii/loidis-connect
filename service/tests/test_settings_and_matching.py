import json
from datetime import date

import pytest

from loidis_service import fake_data
from loidis_service.bookings import parse_bookings
from loidis_service.build import NOT_CHECKED, build
from loidis_service.cll import fetch_api_data, normalise
from loidis_service.errors import ServiceError
from loidis_service.matching import match_carers
from loidis_service.settings_file import SettingsFile, settings_warnings


def test_round_trip(files):
    s = SettingsFile.from_json(files["settings"])
    again = SettingsFile.from_json(s.to_json())
    assert again.to_dict() == s.to_dict()
    assert s.agency["team_regions"] == {"Leeds": "Leeds", "Dorchester": "Dorset", "Weymouth": "Dorset"}
    night = s.carer("K005")
    assert night.blocks(4) == [(1320, 1860)]  # Friday 22:00 to 07:00 runs into Saturday


def test_defaults_when_agency_is_partial():
    raw = {"version": 1, "carers": [], "clients": [], "agency": {"search_seconds_per_day": 5}}
    s = SettingsFile.from_dict(raw)
    assert s.agency["move_window_minutes"] == 30 and s.agency["search_seconds_per_day"] == 5
    assert s.team_regions["Weymouth"] == "Dorset"


@pytest.mark.parametrize("raw", [{"version": 2, "carers": [], "clients": []}, [], {"version": 1, "carers": "x", "clients": []}])
def test_bad_files(raw):
    with pytest.raises(ServiceError):
        SettingsFile.from_dict(raw)


def test_bad_hours_and_dates_are_counted_not_echoed():
    raw = {"version": 1, "clients": [], "carers": [
        {"id": "K1", "working_hours": {"mon": [{"start": "7am", "end": "14:00"}]}, "dbs_expiry": "soon"}]}
    with pytest.raises(ServiceError) as e:
        SettingsFile.from_dict(raw)
    assert "7am" not in e.value.message


def test_missing_dates_warn_and_are_not_filled_with_placeholders(files):
    s = SettingsFile.from_json(files["settings"])
    codes = {w["code"]: w["message"] for w in settings_warnings(s, date(2026, 11, 16))}
    assert "K010" in codes["no_dbs_date"]
    assert "K003" in codes["expired"]
    assert "K013" in codes["no_working_hours"]
    rows, _ = parse_bookings(files["bookings"])
    b = build(rows, fetch_api_data(), s, "new", 0, {}, None)
    carers = {c.id: c for r in b.regions for c in r.problem.carers}
    assert carers["K010"].dbs_expiry == NOT_CHECKED == date.max  # unchecked, never 2099
    assert carers["K010"].training_expiry == date(2027, 6, 30)
    assert all(c.dbs_expiry.year != 2099 and c.training_expiry.year != 2099 for c in carers.values())
    assert carers["K013"].availability == []  # no hours: not planned
    assert "K013" in next(r for r in b.regions if r.name == "Leeds").not_planned


def test_regions_follow_the_team_mapping(files):
    rows, _ = parse_bookings(files["bookings"])
    s = SettingsFile.from_json(files["settings"])
    b = build(rows, fetch_api_data(), s, "new", 0, {}, None)
    assert {r.name for r in b.regions} == {"Leeds", "Dorset"}
    s.agency["team_regions"] = {"Leeds": "North", "Dorchester": "South", "Weymouth": "South"}
    b = build(rows, fetch_api_data(), s, "new", 0, {}, None)
    assert {r.name for r in b.regions} == {"North", "South"}


def test_improve_mode_sets_current_carers_and_change_cost(files):
    rows, _ = parse_bookings(files["bookings"])
    s = SettingsFile.from_json(files["settings"])
    new = build(rows, fetch_api_data(), s, "new", 700, {}, None)
    imp = build(rows, fetch_api_data(), s, "improve", 700, {}, None)
    assert all(not v.current_carers for r in new.regions for v in r.problem.visits)
    assert new.regions[0].problem.settings.change_pence_per_visit == 0
    assert imp.regions[0].problem.settings.change_pence_per_visit == 700
    assert any(v.current_carers for r in imp.regions for v in r.problem.visits)


def test_time_critical_types_get_window_zero_and_rules_apply(files):
    rows, _ = parse_bookings(files["bookings"])
    s = SettingsFile.from_json(files["settings"])
    b = build(rows, fetch_api_data(), s, "new", 0, {}, None)
    v = {v.id: v for r in b.regions for v in r.problem.visits}
    meta = {k: m for r in b.regions for k, m in r.visit_meta.items()}
    crit = [k for k, m in meta.items() if m.locked and m.lock_reason == "time-critical booking type"]
    assert crit and all(v[k].window == 0 for k in crit)
    assert any(x.window == 30 for x in v.values())
    clients = {c.id: c for r in b.regions for c in r.problem.clients}
    assert clients["api-C03"].gender_preference == "female"
    assert clients["api-C05"].do_not_send == ["K002"]
    assert clients["api-C06"].safeguarding_bar == ["K003"]
    assert all(x.required_skills == ["hoist"] for x in v.values() if x.client_id == "api-C04")


def test_matching_order_and_unmatched(files):
    rows, _ = parse_bookings(files["bookings"])
    names = {n for b in rows for n in b.carer_names}
    api = normalise(fake_data.fake_api_raw())
    s = SettingsFile.from_json(files["settings"])
    m, u = match_carers(names, api, s)
    carers = {c.id: c for c in fake_data.agency()[0]}
    nick = fake_data.booking_name(carers["K012"])
    assert u == [] and m[nick] == "K012"  # the saved match
    assert m[fake_data.booking_name(carers["K005"])] == "K005"  # "Last First" matched from the API name
    s2 = SettingsFile.from_dict({**s.to_dict(), "carer_name_matches": []})
    m2, u2 = match_carers(names, api, s2)
    assert u2 == [nick] and nick not in m2
    # no settings at all: API names still match
    m3, u3 = match_carers(names, api, None)
    assert u3 == [nick]


def test_unmatched_names_stop_a_run_with_a_count_not_names(files):
    rows, _ = parse_bookings(files["bookings"])
    s = SettingsFile.from_dict({**json.loads(files["settings"]), "carer_name_matches": []})
    with pytest.raises(ServiceError) as e:
        build(rows, fetch_api_data(), s, "new", 0, {}, None)
    assert e.value.status == 422 and "1 carer name(s)" in e.value.message
    assert "Ravenscrofty" not in e.value.message


def test_search_seconds_default_and_range():
    base = {"version": 1, "carers": [], "clients": []}
    assert SettingsFile.from_dict(base).agency["search_seconds_per_day"] == 10
    for ok in (1, 10, 30, 120):
        assert SettingsFile.from_dict({**base, "agency": {"search_seconds_per_day": ok}}).agency["search_seconds_per_day"] == ok
    for bad in (0, 121, "x", None):
        with pytest.raises(ServiceError):
            SettingsFile.from_dict({**base, "agency": {"search_seconds_per_day": bad}})
