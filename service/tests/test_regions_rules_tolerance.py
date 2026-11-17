"""Carers who work in more than one region, rule-breaking current carers, arrival tolerance.
Build-level tests (no search), made-up data only."""

import csv
import io
import json

from loidis_service import fake_data
from loidis_service.bookings import KNOWN_COLUMNS, parse_bookings
from loidis_service.build import build
from loidis_service.cll import fetch_api_data
from loidis_service.result import _not_allowed, contract_metrics
from loidis_service.settings_file import SettingsFile

C = {c.id: c for c in fake_data.agency()[0]}


def _why(*a):
    r = _not_allowed(*a)
    return r[0] if r else None

COL = {n: i for i, n in enumerate(KNOWN_COLUMNS)}


def edit_bookings(files, edits):
    """edits: {booking_id: carer names cell}"""
    rows = list(csv.reader(io.StringIO(files["bookings"].decode())))
    for r in rows[1:]:
        if r[COL["BookingId"]] in edits:
            r[COL["Carers"]] = edits[r[COL["BookingId"]]]
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\r\n").writerows(rows)
    return parse_bookings(buf.getvalue().encode())[0]


def pick(files, team_leeds, day, n, btype=None):
    """The first n single-carer bookings of Leeds (or not Leeds) on a date, as booking ids."""
    rows = list(csv.reader(io.StringIO(files["bookings"].decode())))
    out = []
    for r in rows[1:]:
        if ((r[COL["Team"]] == "Leeds") == team_leeds and r[COL["Date"]] == day
                and r[COL["ExpectedCarers"]] == "1" and r[COL["IsCancelled"]] == "No"
                and (btype is None or r[COL["BookingType"]] == btype)):
            out.append(r[COL["BookingId"]])
    return out[:n]


def region(b, name):
    return next(r for r in b.regions if r.name == name)


def test_cross_region_carer_is_home_plus_guest(files):
    s = SettingsFile.from_json(files["settings"])
    k1 = fake_data.booking_name(C["K001"])
    dorset = pick(files, False, "18/11/2026", 2)
    # K001 (Leeds) is put on two Dorset visits on Wednesday, in the current rota
    base = parse_bookings(files["bookings"])[0]
    k1_leeds = [b for b in base if b.carer_names and k1 in b.carer_names and b.teams[0] == "Leeds"]
    assert len(k1_leeds) > len(dorset)
    rows = edit_bookings(files, {bid: k1 for bid in dorset})
    for mode in ("new", "improve"):
        b = build(rows, fetch_api_data(), s, mode, 1000, {}, None)
        leeds, dors = region(b, "Leeds"), region(b, "Dorset")
        home = leeds.problem.carer_by_id["K001"]
        guest = dors.problem.carer_by_id["K001"]
        minutes = sum(v.duration for v in dors.problem.visits if v.id in dorset)
        # home (Leeds): no default hours on Wednesday, weekly maximum reduced by the Dorset minutes
        assert not [x for x in home.availability if x.day == 2]
        assert any(x.day == 0 for x in home.availability)
        assert home.max_minutes_week == 35 * 60 - minutes
        # guest (Dorset): only blocks around their own visits, no share of hours, visits locked to them
        assert guest.contracted_minutes_week == 0
        assert {x.day for x in guest.availability} == {2}
        assert guest.max_minutes_week == 35 * 60
        locked = {v.id: v for v in dors.problem.visits if v.id in dorset}
        assert all(v.locked_carers == ["K001"] and v.window == 0 for v in locked.values())
        assert all(dors.visit_meta[i].lock_reason == "kept: carer's home area is elsewhere" for i in dorset)
        # and nobody else has those visits locked
        assert not [v for v in dors.problem.visits if v.id not in dorset and "K001" in v.locked_carers]
        msg = next(w["message"] for w in b.warnings if w["code"] == "cross_region_carers")
        assert "K001" in msg and "weekly maximum is reduced" in msg


def test_carer_with_no_visits_is_planned_only_in_their_team_region(files):
    d = json.loads(files["settings"])
    k13 = next(c for c in d["carers"] if c["id"] == "K013")
    k13["working_hours"] = {"mon": [{"start": "09:00", "end": "17:00"}]}
    k13["teams"] = ["Dorchester", "Leeds"]  # two regions, no current visits
    s = SettingsFile.from_dict(d)
    rows = parse_bookings(files["bookings"])[0]
    b = build(rows, fetch_api_data(), s, "new", 0, {}, None)
    assert "K013" in region(b, "Dorset").problem.carer_by_id
    assert "K013" not in region(b, "Leeds").problem.carer_by_id
    assert not any(w["code"] == "cross_region_carers" and "K013" in w["message"] for w in b.warnings)


def test_rule_breaking_current_carers_are_named(files):
    d = json.loads(files["settings"])
    next(c for c in d["clients"] if c["ref"] == "CL-006")["safeguarding_bar"] = ["K006"]  # K003's training has expired anyway
    s = SettingsFile.from_dict(d)
    rows = parse_bookings(files["bookings"])[0]
    names = {c: fake_data.booking_name(C[c]) for c in ("K002", "K003", "K004", "K001", "K006")}
    # CL-005 (C05) has K002 on its do-not-send list; CL-006 (C06) bars K003; K002 is on leave on Wednesday
    by_ref = {}
    for b in rows:
        by_ref.setdefault(b.client_ref, []).append(b)
    dns = next(b for b in by_ref["CL-005"] if b.day.weekday() == 0)
    bar = next(b for b in by_ref["CL-006"] if b.day.weekday() == 0)
    dns2 = next(b for b in by_ref["CL-006"] if b.day.weekday() == 1)
    leave = next(b for b in by_ref["CL-001"] if b.day.weekday() == 2)
    gender = next(b for b in by_ref["CL-003"] if b.day.weekday() == 0)
    rows = edit_bookings(files, {dns.booking_id: names["K002"], bar.booking_id: names["K006"], dns2.booking_id: names["K003"],
                                 leave.booking_id: names["K002"], gender.booking_id: names["K004"]})
    b = build(rows, fetch_api_data(), s, "improve", 1000, {}, None)
    leeds = region(b, "Leeds")
    assert _why(leeds, dns.booking_id, "K002", {}) == "current carer not allowed: do-not-send"
    assert _why(leeds, bar.booking_id, "K006", {}) == "current carer not allowed: safeguarding bar"
    assert _why(leeds, dns2.booking_id, "K003", {}) == "current carer not allowed: training expired"
    assert _why(leeds, leave.booking_id, "K002", {}) == "current carer not allowed: on leave"
    assert _why(leeds, gender.booking_id, "K004", {}) == "current carer not allowed: gender preference"
    # a carer who is allowed gets no reason, until the weekly maximum is exceeded
    ok = next(b for b in by_ref["CL-001"] if b.day.weekday() == 0)
    rows2 = edit_bookings(files, {ok.booking_id: names["K001"]})
    b2 = build(rows2, fetch_api_data(), s, "improve", 1000, {}, None)
    assert _why(region(b2, "Leeds"), ok.booking_id, "K001", {}) is None
    over = _not_allowed(region(b2, "Leeds"), ok.booking_id, "K001", {"K001": 36 * 60}, {"K001": 10 * 60})
    assert over == ("current carer over weekly maximum", False)  # the plan leaves room: a reason, not forced
    over = _not_allowed(region(b2, "Leeds"), ok.booking_id, "K001", {"K001": 36 * 60}, {"K001": 35 * 60})
    assert over == ("current carer not allowed: over weekly maximum", True)  # would still be over if it stayed


def test_arrival_tolerance_default_and_setting(files):
    rows = parse_bookings(files["bookings"])[0]
    s = SettingsFile.from_json(files["settings"])
    assert s.tolerance_defaulted and s.agency["arrival_tolerance_minutes"] == 15
    b = build(rows, fetch_api_data(), s, "improve", 1000, {}, None)
    assert b.regions[0].problem.settings.arrival_tolerance_minutes == 15
    assert any(w["code"] == "arrival_tolerance_default" and "placeholder" in w["message"] for w in b.warnings)
    d = json.loads(files["settings"])
    d["agency"]["arrival_tolerance_minutes"] = 25
    s2 = SettingsFile.from_dict(d)
    assert not s2.tolerance_defaulted
    b2 = build(rows, fetch_api_data(), s2, "improve", 1000, {}, None)
    assert b2.regions[0].problem.settings.arrival_tolerance_minutes == 25
    assert not any(w["code"] == "arrival_tolerance_default" for w in b2.warnings)
    assert SettingsFile.from_json(s2.to_json()).agency["arrival_tolerance_minutes"] == 25


def test_outside_hours_visits_with_current_carers_are_locked(files):
    d = json.loads(files["settings"])
    k5 = next(c for c in d["carers"] if c["id"] == "K005")
    k5["working_hours"] = {"mon": [{"start": "08:00", "end": "16:00"}]}  # no night hours any more
    s = SettingsFile.from_dict(d)
    base = parse_bookings(files["bookings"])[0]
    nights = [b for b in base if b.booking_type == "Waking Night" and not b.cancelled]
    assert len(nights) == 2 and all(b.carer_names for b in nights)
    # one night is left unstaffed in the current rota: only the staffed one may be locked
    rows = edit_bookings(files, {nights[1].booking_id: ""})
    for mode in ("new", "improve"):
        b = build(rows, fetch_api_data(), s, mode, 1000, {}, None)
        leeds = region(b, "Leeds")
        v = leeds.problem.visit_by_id
        locked, free = v[nights[0].booking_id], v[nights[1].booking_id]
        assert locked.locked_carers == ["K005"] and locked.window == 0
        assert leeds.visit_meta[locked.id].lock_reason == "kept with the carer who already has it (outside everyone's hours)"
        assert not free.locked_carers  # not staffed now: left to the engine
        blk = [x for x in leeds.problem.carer_by_id["K005"].availability if x.day == locked.day]
        assert any(x.start <= locked.start - 90 and x.end >= locked.start + locked.duration + 90 for x in blk)
        w = next(w for w in b.warnings if w["code"] == "locked_outside_hours")
        assert w["message"].startswith("1 booking(s)")
    # with night hours back, nothing is locked
    s2 = SettingsFile.from_json(files["settings"])
    b = build(rows, fetch_api_data(), s2, "new", 0, {}, None)
    assert not any(w["code"] == "locked_outside_hours" for w in b.warnings)


def _rep(carers):
    return {"clients": [], "visits": [], "carers": [
        {"id": i, "scheduled_minutes": m, "travel_minutes": 600, "miles": 0, "availability": [1], "contracted_minutes": s}
        for i, m, s in carers]}


def test_hours_per_carer_counts_each_carer_once_without_guests():
    # K1 is home in region A (share 3000 min) and a guest in B (share 0); K2, K3 are home carers
    a = _rep([("K1", 1200, 3000), ("K2", 3000, 3000)])
    b = _rep([("K1", 600, 0), ("K3", 1800, 3000)])
    m = contract_metrics([a, b], 0)
    # care hours only, K1 = 1200 + 600 min = 30 h; three carers, not four
    assert (m["hours_min"], m["hours_median"], m["hours_max"]) == (30.0, 30.0, 50.0)
    assert m["hours_stdev"] == 9.4  # population stdev of 30, 30, 50
    one = contract_metrics([b], 0)  # a region alone leaves the guest out
    assert (one["hours_min"], one["hours_max"]) == (30.0, 30.0)


def test_available_any_time_default_and_flag(files):
    from loidis_rota.models import Block, Visit
    from loidis_rota.rules import fits_block

    d = json.loads(files["settings"])
    rows = parse_bookings(files["bookings"])[0]
    # K013 has no hours and no flag in the file: any time, one block a day from 00:00 to 48:00
    b = build(rows, fetch_api_data(), SettingsFile.from_dict(d), "new", 0, {}, None)
    k13 = region(b, "Leeds").problem.carer_by_id["K013"]
    assert sorted((x.day, x.start, x.end) for x in k13.availability) == [(i, 0, 2880) for i in range(7)]
    assert not any(w["code"] == "no_working_hours" for w in b.warnings)
    assert b.notices and b.notices[0]["code"] == "available_any_time"
    # a visit that runs past midnight fits such a block (a block ending at 24:00 could not hold it)
    night = Visit("v", "c", 4, 22 * 60, 0, 9 * 60)
    assert fits_block(night, Block(4, 0, 2880)) and not fits_block(night, Block(4, 0, 1440))
    # explicit hours win, even with the flag on
    k5 = next(c for c in d["carers"] if c["id"] == "K005")
    assert k5["working_hours"] and SettingsFile.from_dict(d).carer("K005").available_any_time
    b2 = build(rows, fetch_api_data(), SettingsFile.from_dict(d), "new", 0, {}, None)
    assert {(x.start, x.end) for x in region(b2, "Leeds").problem.carer_by_id["K005"].availability} != {(0, 2880)}
    # flag off and no hours: not planned, with a warning (not the quiet notice)
    next(c for c in d["carers"] if c["id"] == "K013")["available_any_time"] = False
    b3 = build(rows, fetch_api_data(), SettingsFile.from_dict(d), "new", 0, {}, None)
    assert "K013" in region(b3, "Leeds").not_planned
    assert any(w["code"] == "no_working_hours" and "K013" in w["message"] for w in b3.warnings)
    assert not b3.notices
    # leave still removes the day; the flag survives a round trip
    s = SettingsFile.from_dict(d)
    assert SettingsFile.from_json(s.to_json()).carer("K013").available_any_time is False


def test_any_time_carer_can_work_a_night_visit(files):
    """The engine plans a night visit that crosses midnight for a carer with no set hours."""
    from loidis_rota.solver import solve_day

    d = json.loads(files["settings"])
    k5 = next(c for c in d["carers"] if c["id"] == "K005")
    k5["working_hours"] = {}  # the night carer is now available any time
    rows = parse_bookings(files["bookings"])[0]
    b = build(rows, fetch_api_data(), SettingsFile.from_dict(d), "new", 0, {}, None)
    leeds = region(b, "Leeds").problem
    night = next(v for v in leeds.visits if v.duration == 540 and v.day == 4)
    assert night.start + night.duration > 1440
    res = solve_day(leeds, 4, {}, seconds=3)
    assert night.id in res.assigned and res.assigned[night.id] == ["K005"]
