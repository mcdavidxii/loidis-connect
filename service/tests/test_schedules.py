"""Client schedules (learn, settings, draft run), the final check against the real week, and the team
rules (no team = not planned; Dorchester is planned with Weymouth). Made-up data only."""

import csv
import io
import json
from datetime import date, timedelta

import pytest

from loidis_service import fake_data
from loidis_service.bookings import parse_bookings
from loidis_service.build import build
from loidis_service.cll import fetch_api_data, normalise
from loidis_service.errors import ServiceError
from loidis_service.schedules import scheduled_bookings
from loidis_service.settings_file import SettingsFile, normalise_team_regions

from conftest import client_names, wait_done

WEEKS = [fake_data.schedule_week_csv(i).encode() for i in range(4)]
CLIENT_LIST = fake_data.client_list_csv().encode()
DRAFT_WEEK = "2026-11-23"  # four weeks after the first learned week: the fortnightly client is in


def learn(client, files=None, client_list=CLIENT_LIST, settings=None):
    fs = [("bookings", (f"w{i}.csv", b, "text/csv")) for i, b in enumerate(files or WEEKS)]
    if client_list:
        fs.append(("client_list", ("clients.csv", client_list, "text/csv")))
    if settings:
        fs.append(("settings", ("s.json", settings, "application/json")))
    return client.post("/schedules/learn", files=fs)


# --------------------------------------------------------------------------- learning
def test_learn_weekly_fortnightly_one_offs_and_flags(client, logs):
    r = learn(client)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["weeks"] == ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]
    sch = out["schedules"]

    def visits(cid):
        return {(tuple(v["days"]), v["start"], v["booking_type"]): v for v in sch[cid]["visits"]}

    # weekly, start times 07:59-08:01 rounded to 5 minutes, five weekdays merged into one visit
    c01 = sch["api-C01"]
    assert c01["confirmed"] is False and c01["client_ref"] == "CL-001" and c01["learned_from"] == out["weeks"]
    assert len(c01["visits"]) == 1
    v = c01["visits"][0]
    assert v["days"] == ["mon", "tue", "wed", "thu", "fri"] and v["start"] == "08:00" and v["duration_min"] == 45
    assert v["repeat"] == "weekly" and v["fortnight_anchor"] is None and v["carers_needed"] == 1
    assert c01["display_name"] == "Fakeley, A"
    # two visits of the same client stay apart when their time or type differ; same time merges days
    v2 = visits("api-C02")
    assert set(v2) == {(("mon", "wed"), "20:30", "Bed Visit"), (("tue",), "12:30", "Lunch Visit")}
    # double-up
    assert sch["api-C04"]["visits"][0]["carers_needed"] == 2 and len(sch["api-C04"]["visits"][0]["days"]) == 7
    # fortnightly: in weeks 0 and 2 only; the anchor is the first week it was seen
    c03 = sch["api-C03"]["visits"][0]
    assert c03["repeat"] == "fortnightly" and c03["fortnight_anchor"] == "2026-10-26" and c03["days"] == ["thu"]
    # a cancelled booking is ignored (C05 has a cancelled Tuesday visit every week)
    assert sch["api-C05"]["visits"][0]["days"] == ["mon"]
    # a one-off is listed, not added
    assert [o["client_ref"] for o in out["one_offs"]] == ["CL-009"] and "api-C09" not in sch
    o = out["one_offs"][0]
    assert (o["date"], o["start"], o["duration_min"], o["booking_type"]) == ("2026-11-06", "14:00", 30, "Tea Visit")
    assert o["display_name"] == "Testwick, I" and o["client_id"] == "api-C09"
    # flags
    flags = {(f["client_ref"], f["kind"]): f for f in out["flags"]}
    ch = flags[("CL-006", "changed")]
    assert ch["detail"] == "Schedule changed in CareLineLive on 12/11/2026 – check their visits"
    assert ch["client_id"] == "api-C06" and ch["display_name"]
    assert ("CL-007", "suspended") in flags
    assert ("CL-008", "no_bookings_in_period") in flags
    assert ("CL-001", "changed") not in flags
    assert out["counts"]["schedules"] == len(sch) == 8 and out["counts"]["fortnightly"] == 1
    assert out["counts"]["one_offs"] == 1 and out["counts"]["weeks"] == 4
    # nothing personal in the logs
    joined = "\n".join(logs.lines)
    assert not [n for n in client_names() if n in joined]


def test_learn_accepts_many_weeks_in_one_file_and_without_a_client_list(client):
    rows = list(csv.reader(io.StringIO(WEEKS[0].decode())))
    for w in WEEKS[1:]:
        rows += list(csv.reader(io.StringIO(w.decode())))[1:]
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\r\n").writerows(rows)
    r = learn(client, files=[buf.getvalue().encode()], client_list=None)
    assert r.status_code == 200 and len(r.json()["weeks"]) == 4 and r.json()["flags"] == []
    # one week alone: everything is weekly (it is in at least half the weeks supplied)
    one = learn(client, files=[WEEKS[0]], client_list=None).json()
    assert one["one_offs"] == [] and one["schedules"]["api-C03"]["visits"][0]["repeat"] == "weekly"


def test_learn_two_weeks_is_not_fortnightly_and_errors_are_plain(client):
    two = learn(client, files=[WEEKS[0], WEEKS[1]], client_list=None).json()
    # C03 is only in week 0 of 2: half the weeks, so weekly; fortnightly needs 3 weeks supplied
    assert two["schedules"]["api-C03"]["visits"][0]["repeat"] == "weekly"
    assert learn(client, files=[b"nope"], client_list=None).status_code == 422
    r = client.post("/schedules/learn", files=[("client_list", ("c.csv", CLIENT_LIST, "text/csv"))])
    assert r.status_code == 400
    bad = learn(client, client_list=b"Name,Team\r\nx,y\r\n")
    assert bad.status_code == 422 and "ClientReferenceCode" in bad.json()["error"]


def test_runs_still_take_only_one_week(client, files):
    both = WEEKS[0].decode() + "\n".join(WEEKS[1].decode().splitlines()[1:]) + "\r\n"
    r = client.post("/runs", data={"mode": "new"}, files={"bookings": ("b.csv", both.encode(), "text/csv"),
                                                          "settings": ("s.json", files["settings"], "application/json")})
    assert r.status_code == 422 and "different weeks" in r.json()["error"]


# --------------------------------------------------------------------------- settings file
def schedules_settings(files, confirm=True, **over):
    d = json.loads(files["settings"])
    d["version"] = 2
    learned = learn_dict()
    d["client_schedules"] = {}
    for cid, sc in learned["schedules"].items():
        sc = {k: v for k, v in sc.items() if k != "display_name"}
        sc["confirmed"] = confirm
        d["client_schedules"][cid] = sc
    d["client_schedules"].update(over)
    return d


def learn_dict():
    from loidis_service.schedules import learn as _learn

    return _learn(WEEKS, CLIENT_LIST, None)


def test_settings_version_two_round_trip_and_old_files(files):
    d = schedules_settings(files)
    s = SettingsFile.from_dict(d)
    assert s.to_dict()["version"] == 2
    assert SettingsFile.from_dict(s.to_dict()).to_dict() == s.to_dict()
    assert s.client_schedules["api-C03"].visits[0].fortnight_anchor == date(2026, 10, 26)
    assert s.to_dict()["client_schedules"]["api-C01"]["visits"][0]["days"] == ["mon", "tue", "wed", "thu", "fri"]
    old = SettingsFile.from_json(files["settings"])  # a version 1 file
    assert json.loads(files["settings"])["version"] == 1 and old.client_schedules == {}
    assert old.to_dict()["client_schedules"] == {}


def test_bad_schedules_are_counted_not_echoed(files):
    d = schedules_settings(files)
    d["client_schedules"]["api-C03"]["visits"][0]["fortnight_anchor"] = "2026-10-27"  # not a Monday
    d["client_schedules"]["api-C01"]["visits"][0]["days"] = ["funday"]
    with pytest.raises(ServiceError) as e:
        SettingsFile.from_dict(d)
    assert e.value.status == 422 and "2 client schedule(s)" in e.value.message and "funday" not in e.value.message


def test_fortnightly_weeks_and_confirmed_only(files):
    s = SettingsFile.from_dict(schedules_settings(files, confirm=True))
    wk = {w: {b.client_id for b in scheduled_bookings(s, date.fromisoformat(w))[0]} for w in ("2026-11-23", "2026-11-30")}
    assert "api-C03" in wk["2026-11-23"] and "api-C03" not in wk["2026-11-30"]  # every second week
    assert {"api-C01", "api-C04"} <= wk["2026-11-23"] & wk["2026-11-30"]
    bs, info = scheduled_bookings(s, date(2026, 11, 23), {"CL-007"})
    assert "api-C07" not in {b.client_id for b in bs} and info["suspended"] == 1
    assert all(b.booking_id.startswith("DRAFT-") and b.generated and not b.carer_names for b in bs)
    s2 = SettingsFile.from_dict(schedules_settings(files, confirm=False))
    bs, info = scheduled_bookings(s2, date(2026, 11, 23))
    assert bs == [] and info["unconfirmed"] == len(s2.client_schedules)


# --------------------------------------------------------------------------- the draft run
@pytest.fixture(scope="module")
def draft(client, files):
    d = schedules_settings(files)
    d["agency"]["search_seconds_per_day"] = 1
    d["client_schedules"]["api-C06"]["confirmed"] = False  # one unconfirmed schedule
    settings = json.dumps(d).encode()
    r = client.post("/runs", data={"source": "schedules", "week_start": DRAFT_WEEK, "mode": "new"},
                    files={"settings": ("s.json", settings, "application/json"),
                           "client_list": ("c.csv", CLIENT_LIST, "text/csv")})
    assert r.status_code == 201, r.text
    run_id = r.json()["run_id"]
    body = wait_done(client, run_id)
    assert body["status"] == "done", body
    return {"id": run_id, "result": body["result"], "settings": settings}


def test_draft_run_result(client, draft):
    res = draft["result"]
    assert res["draft"] is True and res["mode"] == "new" and res["draft_check"] is None
    assert any(n["message"] == "Draft from client schedules – bookings for this week are not generated in CareLineLive yet."
               for n in res["notices"])
    visits = [v for t in res["teams"].values() for v in t["visits"]]
    assert visits and all(v["booking_id"] is None and v["id"].startswith("DRAFT-") for v in visits)
    assert all(v["current_assigned"] == [] for v in visits)
    assert {t["week_start"] for t in res["teams"].values()} == {DRAFT_WEEK}
    assert list(res["teams"]) == ["Leeds", "Weymouth"]
    ids = {t["id"] for t in [c for rep in res["teams"].values() for c in rep["clients"]]}
    assert "api-C07" not in ids and "api-C06" not in ids  # suspended, and unconfirmed
    assert "api-C03" in ids  # the fortnightly client is in this week
    w = {x["code"]: x["message"] for x in res["warnings"]}
    assert w["schedule_unconfirmed"].startswith("1 client schedule(s) are not confirmed")
    assert "clients have no schedule yet, so they are not in this draft" in w["schedule_missing"]
    assert any(n["code"] == "clients_suspended" for n in res["notices"])
    assert res["changes"] == [] and res["change_summary"] is None


def test_draft_exports_say_not_generated_yet(client, draft):
    r = client.get(f"/runs/{draft['id']}/export/allocation.csv")
    assert r.status_code == 200
    rows = list(csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert rows and {x["Booking ID"] for x in rows} == {"not generated yet"}
    assert client.get(f"/runs/{draft['id']}/export/changes.csv").status_code == 200
    assert client.get(f"/runs/{draft['id']}/export/notes.csv").status_code == 200


def test_schedule_run_refusals(client, files, draft):
    s = ("s.json", draft["settings"], "application/json")
    base = {"source": "schedules", "week_start": DRAFT_WEEK}
    r = client.post("/runs", data={**base, "mode": "improve"}, files={"settings": s})
    assert r.status_code == 422 and "can only make a new rota" in r.json()["error"]
    assert client.post("/runs", data={"source": "schedules", "mode": "new"}, files={"settings": s}).status_code == 400
    assert client.post("/runs", data={**base, "week_start": "2026-11-24", "mode": "new"}, files={"settings": s}).status_code == 400
    assert client.post("/runs", data={**base, "mode": "new"}, files={"x": ("x", b"1")}).status_code == 422  # no settings
    # a week with nothing to plan: every schedule unconfirmed
    d = schedules_settings(files, confirm=False)
    r = client.post("/runs", data={**base, "mode": "new"},
                    files={"settings": ("s.json", json.dumps(d).encode(), "application/json")})
    assert r.status_code == 422 and "No confirmed client schedule" in r.json()["error"]


# --------------------------------------------------------------------------- final check against the real week
def real_week_rows(drop=(), add=(), retime=()):
    """The 'real' bookings of the draft week: the schedule pattern of week 3 moved forward four weeks,
    for the clients that are in the draft. Edits: drop a (client, weekday), add a booking, retime."""
    rows = []
    for r in fake_data.schedule_rows(3):
        if r["cancelled"] or r["client"] in ("C06", "C07", "C09"):
            continue
        r = dict(r, date=r["date"] + timedelta(days=7), start=round(r["start"] / 5) * 5)
        if r["client"] == "C03":
            continue
        if (r["client"], r["date"].weekday()) in drop:
            continue
        for (cl, wd), new in retime:
            if (r["client"], r["date"].weekday()) == (cl, wd):
                r["start"] = new
        rows.append(r)
    # C03 is fortnightly: in the draft week (Thursday 16:30)
    rows.append({"client": "C03", "date": date(2026, 11, 26), "start": 16 * 60 + 30, "duration": 30,
                 "type": "Tea Visit", "need": 1, "cancelled": False})
    rows += list(add)
    return rows


@pytest.fixture(scope="module")
def checked(client, files, draft):
    alloc = client.get(f"/runs/{draft['id']}/export/allocation.csv").content
    extra = {"client": "C01", "date": date(2026, 11, 28), "start": 10 * 60, "duration": 45, "type": "Morning Visit",
             "need": 1, "cancelled": False}
    rows = real_week_rows(drop={("C10", 4)}, add=[extra], retime={(("C05", 0), 9 * 60 + 45)})
    real = fake_data.rows_csv(rows).encode()
    n_real = len(rows)
    settings = draft["settings"]
    r = client.post("/runs", data={"mode": "new", "change_cost_pence": "1000"},
                    files={"bookings": ("b.csv", real, "text/csv"), "settings": ("s.json", settings, "application/json"),
                           "draft": ("allocation.csv", alloc, "text/csv")})
    assert r.status_code == 201, r.text
    body = wait_done(client, r.json()["run_id"])
    assert body["status"] == "done", body
    return {"result": body["result"], "n_real": n_real, "rows": rows}


def test_draft_check_added_removed_retimed(checked):
    res = checked["result"]
    assert res["mode"] == "improve" and res["draft"] is False  # a draft file forces improve mode
    dc = res["draft_check"]
    assert [x["date"] for x in dc["added"]] == ["2026-11-28"] and dc["added"][0]["start"] == "10:00"
    assert dc["added"][0]["client"] == "Fakeley, A" and dc["added"][0]["booking_type"] == "Morning Visit"
    assert [(x["date"], x["start"]) for x in dc["removed"]] == [("2026-11-27", "17:00")]
    assert dc["removed"][0]["booking_type"] == "Tea Visit"
    assert [(x["date"], x["start"], x["draft_start"]) for x in dc["retimed"]] == [("2026-11-23", "09:45", "09:00")]
    assert "45 min later" in dc["retimed"][0]["summary"]
    assert dc["matched"] == checked["n_real"] - 2  # the added and the retimed one are not exact matches
    assert all(x["summary"] for k in ("added", "removed", "retimed") for x in dc[k]) and dc["summary"]
    assert "not in the draft" in dc["added"][0]["summary"] and "not in the real week" in dc["removed"][0]["summary"]
    # improve mode starts from the draft plan: the matched visits carry the draft's carers
    visits = [v for t in res["teams"].values() for v in t["visits"]]
    assert sum(1 for v in visits if v["current_assigned"]) > 0.7 * len(visits)
    assert all(v["booking_id"] for v in visits)  # the real week has booking ids
    assert res["change_summary"] is not None


# --------------------------------------------------------------------------- team rules
def _api_without_teams(*carer_ids):
    raw = fake_data.fake_api_raw()
    for c in raw["carers"]:
        if c["id"] in carer_ids:
            c["relationships"]["teams"] = {"data": []}
    return normalise(raw)


def _settings_no_teams(files, *carer_ids):
    d = json.loads(files["settings"])
    for c in d["carers"]:
        if c["id"] in carer_ids:
            c["teams"] = []
    return SettingsFile.from_dict(d)


def test_carer_with_no_team_is_left_out_and_their_visits_are_not_kept_with_them(files):
    rows = parse_bookings(files["bookings"])[0]
    k7 = fake_data.booking_name(next(c for c in fake_data.agency()[0] if c.id == "K007"))
    on_k7 = {b.booking_id for b in rows if k7 in b.carer_names}
    assert on_k7
    for mode in ("new", "improve"):
        s = _settings_no_teams(files, "K007", "K013")
        b = build(rows, _api_without_teams("K007", "K013"), s, mode, 1000, {}, None)
        planned = {c.id for r in b.regions for c in r.problem.carers}
        assert "K007" not in planned and "K013" not in planned
        w = next(w for w in b.warnings if w["code"] == "carer_no_team")
        assert w["message"].startswith("2 carers have no team in CareLineLive, so they were left out of the rota.")
        assert "K007" in w["message"] and "K013" in w["message"]
        # their visits: not kept with them (no current carer, nothing locked to them)
        cur = {k: v for r in b.regions for k, v in r.current.items()}
        for bid in on_k7:
            assert "K007" not in cur.get(bid, []) and "K007" not in " ".join(cur.get(bid, []))
        assert all("K007" not in v.locked_carers and "K007" not in v.current_carers
                   for r in b.regions for v in r.problem.visits)
        assert on_k7 <= {k for r in b.regions for k in r.left_out_current}


def test_carer_team_from_settings_counts_and_inactive_no_team_is_quiet(files):
    rows = parse_bookings(files["bookings"])[0]
    # no team in CareLineLive but one in the settings file: planned, no warning
    s = SettingsFile.from_json(files["settings"])
    b = build(rows, _api_without_teams("K013"), s, "new", 0, {}, None)
    assert "K013" in {c.id for r in b.regions for c in r.problem.carers}
    assert not any(w["code"] == "carer_no_team" for w in b.warnings)
    # an inactive carer with no team and no visits does not raise the warning
    d = json.loads(files["settings"])
    k13 = next(c for c in d["carers"] if c["id"] == "K013")
    k13["teams"], k13["active"] = [], False
    b = build(rows, _api_without_teams("K013"), SettingsFile.from_dict(d), "new", 0, {}, None)
    assert not any(w["code"] == "carer_no_team" for w in b.warnings)


def test_dorchester_is_planned_with_weymouth_and_dorset_is_an_old_name(files):
    assert normalise_team_regions(None) == {"Leeds": ["Leeds"], "Weymouth": ["Weymouth", "Dorchester"]}
    old = {"Leeds": "Leeds", "Dorchester": "Dorset", "Weymouth": "Dorset"}
    assert normalise_team_regions(old) == {"Leeds": ["Leeds"], "Weymouth": ["Dorchester", "Weymouth"]}
    assert normalise_team_regions({"Dorset": ["Weymouth", "Dorchester"], "Leeds": ["Leeds"]}) == {
        "Weymouth": ["Weymouth", "Dorchester"], "Leeds": ["Leeds"]}
    rows = parse_bookings(files["bookings"])[0]
    d = json.loads(files["settings"])
    d["agency"]["team_regions"] = old  # a settings file saved before the change
    b = build(rows, fetch_api_data(), SettingsFile.from_dict(d), "new", 0, {}, None)
    assert [r.name for r in b.regions] == ["Leeds", "Weymouth"]
    assert not any(w["code"] == "unmapped_team" for w in b.warnings)
    # Dorchester and Weymouth clients are in the same region, and Dorchester carers are too
    region = next(r for r in b.regions if r.name == "Weymouth")
    assert {"K007", "K010"} <= set(region.problem.carer_by_id)
    teams_in = {t for b_ in rows for t in b_.teams if b_.client_id in region.client_ref}
    assert teams_in == {"Dorchester", "Weymouth"}


# --------------------------------------------------------------------------- tolerant learning
def _rows(client_id, week_days, start=8 * 60, dur=30, typ="Morning Visit", need=1):
    """week_days: [(week index, weekday, start offset in minutes)] for one fake client."""
    return [{"client": client_id, "date": fake_data.SCHEDULE_WEEKS[w] + timedelta(days=d), "start": start + off,
             "duration": dur, "type": typ, "need": need, "cancelled": False} for w, d, off in week_days]


def _learn_rows(client, rows_by_week):
    files = [fake_data.rows_csv(r).encode() for r in rows_by_week]
    return learn(client, files=files, client_list=None).json()


def test_a_visit_moved_ten_to_fifteen_minutes_stays_weekly(client):
    wk = [_rows("C01", [(i, 0, off)]) for i, off in enumerate([0, 15, -10])]
    out = _learn_rows(client, wk)
    v = out["schedules"]["api-C01"]["visits"]
    assert len(v) == 1 and v[0]["repeat"] == "weekly" and v[0]["start"] == "08:00" and out["one_offs"] == []
    assert out["counts"]["irregular"] == 0


def test_slot_values_are_median_start_most_common_duration_and_carers(client):
    rows = [
        _rows("C01", [(0, 0, 20)], dur=30, need=1), _rows("C01", [(1, 0, 0)], dur=45, need=2),
        _rows("C01", [(2, 0, 25)], dur=45, need=1), _rows("C01", [(3, 0, 0)], dur=30, need=2)]
    v = _learn_rows(client, rows)["schedules"]["api-C01"]["visits"][0]
    assert v["start"] == "08:10" and v["duration_min"] == 45 and v["carers_needed"] == 2  # ties: longer, higher


def test_slot_missing_in_one_of_three_weeks_is_weekly_and_fortnightly_needs_four_weeks(client):
    three = [_rows("C01", [(0, 1, 0)]), [], _rows("C01", [(2, 1, 0)])]
    three[1] = _rows("C02", [(1, 1, 0)])  # a week with other bookings only
    out = _learn_rows(client, three)
    assert out["schedules"]["api-C01"]["visits"][0]["repeat"] == "weekly"
    four = [_rows("C01", [(0, 1, 0)]), _rows("C02", [(1, 1, 0)]), _rows("C01", [(2, 1, 0)]), _rows("C02", [(3, 1, 0)])]
    v = _learn_rows(client, four)["schedules"]["api-C01"]["visits"][0]
    assert v["repeat"] == "fortnightly" and v["fortnight_anchor"] == "2026-10-26"


def test_irregular_slots_are_counted_and_listed_with_plain_text(client):
    wk = [_rows("C01", [(0, 0, 0), (0, 3, 0)]) + _rows("C04", [(0, 0, 0)]), _rows("C01", [(1, 0, 0)]) + _rows("C04", [(1, 0, 0)]),
          _rows("C01", [(2, 0, 0)]) + _rows("C04", [(2, 0, 0)]), _rows("C01", [(3, 0, 0)]) + _rows("C04", [(3, 0, 0)])]
    out = _learn_rows(client, wk)
    assert out["counts"]["irregular"] == 1 and out["counts"]["one_offs"] == 1  # the Thursday visit, once in four weeks
    assert out["one_offs"][0]["date"] == "2026-10-29"
    assert "fewer than half of the weeks" in out["one_offs"][0]["detail"]
    assert out["schedules"]["api-C01"]["visits"][0]["days"] == ["mon"]


def test_slot_that_moves_more_than_thirty_minutes_is_flagged_changed_in_period(client, logs):
    wk = [_rows("C01", [(0, 0, 0)]), _rows("C01", [(1, 0, 0)]), _rows("C01", [(2, 0, 90)]), _rows("C01", [(3, 0, 90)])]
    out = _learn_rows(client, wk)
    f = [x for x in out["flags"] if x["kind"] == "changed_in_period"]
    assert len(f) == 1 and "08:00 to 09:30" in f[0]["detail"] and f[0]["client_ref"] == "CL-001"
    assert out["counts"]["changed_in_period"] == 1
    v = out["schedules"]["api-C01"]["visits"]
    assert [x["start"] for x in v] == ["09:30"] and v[0]["repeat"] == "weekly"  # only the later time is kept
    assert out["one_offs"] == [] and out["counts"]["irregular"] == 0  # the old time is not listed as irregular
    # a later slot in 2 weeks of 3 (weeks 2 and 3 at 09:30) replaces the earlier one
    wk2 = [_rows("C01", [(0, 0, 0)]), _rows("C01", [(1, 0, 90)]), _rows("C01", [(2, 0, 90)])]
    v2 = _learn_rows(client, wk2)["schedules"]["api-C01"]["visits"]
    assert [x["start"] for x in v2] == ["09:30"] and v2[0]["repeat"] == "weekly"


def test_a_single_later_week_at_a_new_time_is_a_one_off_not_a_replacement(client):
    wk = [_rows("C01", [(0, 0, 0)]), _rows("C01", [(1, 0, 0)]), _rows("C01", [(2, 0, 0)]), _rows("C01", [(3, 0, 90)])]
    out = _learn_rows(client, wk)
    v = out["schedules"]["api-C01"]["visits"]
    assert [x["start"] for x in v] == ["08:00"] and v[0]["repeat"] == "weekly"  # the earlier slot stays
    assert [(o["date"], o["start"]) for o in out["one_offs"]] == [("2026-11-16", "09:30")]
    assert out["counts"]["irregular"] == 1
    f = [x for x in out["flags"] if x["kind"] == "changed_in_period"]
    assert len(f) == 1 and f[0]["detail"] == (
        "Monday Morning Visit: at 09:30 instead of the usual 08:00 in the week of 16/11 – "
        "a one-off or a new time? Check their visits")
