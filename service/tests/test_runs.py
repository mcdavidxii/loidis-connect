"""End to end through the HTTP API in fake API mode: runs in both modes, the result shape of
docs/ENGINE_API.md, exports, privacy, locks, DELETE and expiry. Made-up data only."""

import csv
import io
import json
import re
import time

import pytest

from loidis_service import fake_data
from loidis_service.runs import RunStore

from conftest import client_names, fake_names, post_run, wait_done

METRICS = {"visits", "filled", "unfilled", "fill_rate", "care_hours", "travel_hours", "miles", "continuity_rate",
           "hours_min", "hours_median", "hours_max", "hours_stdev", "visits_moved"}
CARER = {"id", "name", "area", "gender", "skills", "contracted_minutes", "max_minutes", "scheduled_minutes",
         "travel_minutes", "miles", "availability", "issues"}
VISIT = {"id", "booking_id", "client_id", "day", "preferred_start", "window", "duration", "carers_needed", "kind",
         "booking_type", "assigned", "start", "current_assigned", "moved", "locked", "lock_reason",
         "unfilled_reason", "unfilled_detail"}
STOP = {"visit_id", "client_id", "start", "end", "travel_before", "miles_before", "shared_with"}


# --------------------------------------------------------------------------- small endpoints
def test_health_and_samples(client):
    h = client.get("/health").json()
    assert h["ok"] is True and h["mock"] is False and h["fake_api"] is True
    b = client.get("/sample/bookings.csv")
    assert b.status_code == 200 and "attachment" in b.headers["content-disposition"]
    assert b.text.splitlines()[0].startswith("BookingId,ClientId,Date")
    s = client.get("/sample/settings.json").json()
    assert s["version"] == 1 and s["carer_name_matches"] == []  # the name-matching step has work to do


def test_post_runs_rejects_bad_input_without_names(client, files):
    r = client.post("/runs", data={"mode": "improve"}, files={})
    assert r.status_code in (400, 422) and "error" in r.json()
    r = client.post("/runs", data={"mode": "sideways"}, files={"bookings": ("b.csv", files["bookings"], "text/csv")})
    assert r.status_code == 400 and "mode" in r.json()["error"]
    r = client.post("/runs", data={"mode": "new", "locks": "{nope"}, files={"bookings": ("b.csv", files["bookings"], "text/csv")})
    assert r.status_code == 400
    rows = list(csv.reader(io.StringIO(files["bookings"].decode())))
    rows[1][0] = ""
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\r\n").writerows(rows)
    r = post_run(client, files, bookings=buf.getvalue().encode())
    assert r.status_code == 422 and "no BookingId" in r.json()["error"]
    r = client.post("/runs", data={"mode": "new"}, files={
        "bookings": ("b.csv", files["bookings"], "text/csv"), "settings": ("s.json", b'{"version": 9}', "application/json")})
    assert r.status_code == 422 and "version" in r.json()["error"]
    for body in (r.text,):
        assert not (fake_names() & set(body.replace('"', " ").replace(".", " ").split()))


def test_validate_endpoint(client, files):
    r = client.post("/validate", files={"bookings": ("b.csv", files["bookings"], "text/csv")})
    d = r.json()
    assert d["problems"] == [] and d["visits"] > 100 and d["week_start"] == "2026-11-16"


def test_sync_in_fake_mode(client, files):
    r = client.post("/sync", files={
        "bookings": ("b.csv", files["bookings"], "text/csv"),
        "settings": ("s.json", json.dumps({**json.loads(files["settings"]), "carer_name_matches": []}), "application/json")})
    assert r.status_code == 200
    d = r.json()
    assert d["counts"] == {"carers": 13, "clients": 20, "addresses": 19, "leave": 3}
    assert {c["id"] for c in d["carers"]} >= {"K001", "K013"}
    assert d["clients"][0] == {"id": "api-C01", "ref": "CL-001", "team": "Leeds"}
    m = d["missing"]
    assert m["addresses"] == ["CL-020"]
    assert m["carers_not_in_settings"] == [] and m["clients_not_in_settings"] == []
    assert len(m["unmatched_booking_carers"]) == 1  # the nickname, until the coordinator confirms it
    # with the saved match the name is no longer unmatched; without settings everyone is new
    d2 = client.post("/sync", files={"bookings": ("b.csv", files["bookings"], "text/csv"),
                                     "settings": ("s.json", files["settings"], "application/json")}).json()
    assert d2["missing"]["unmatched_booking_carers"] == []
    d3 = client.post("/sync").json()
    assert len(d3["missing"]["carers_not_in_settings"]) == 13 and d3["missing"]["unmatched_booking_carers"] == []


def test_unmatched_carer_fails_the_run_with_a_count(client, files, store):
    s = json.loads(files["settings"])
    s["carer_name_matches"] = []
    f = dict(files, settings=json.dumps(s).encode())
    r = post_run(client, f, mode="new")
    assert r.status_code == 201
    body = wait_done(client, r.json()["run_id"])
    assert body["status"] == "failed" and "1 carer name(s)" in body["message"]
    assert "result" not in body
    assert not (fake_names() & set(body["message"].replace(".", " ").split()))
    client.delete(f"/runs/{r.json()['run_id']}")


# --------------------------------------------------------------------------- the result
def result_of(two_runs, mode):
    run_id, body = two_runs[mode]
    assert body["status"] == "done", body
    assert body["progress"] == 1.0
    return run_id, body["result"]


def test_result_shape_new_mode(two_runs):
    _, res = result_of(two_runs, "new")
    assert set(res) == {"mode", "change_cost_pence", "teams", "comparison", "changes", "change_summary", "fill_check", "time_notes", "warnings", "notices", "arrival_tolerance_minutes"}
    assert res["mode"] == "new" and res["change_cost_pence"] is None
    assert res["changes"] == [] and res["time_notes"] == [] and res["change_summary"] is None
    check_result_shape(res)


def test_result_shape_improve_mode(two_runs):
    _, res = result_of(two_runs, "improve")
    assert res["mode"] == "improve" and res["change_cost_pence"] == 1000
    check_result_shape(res)
    assert res["changes"], "the made-up current rota is not optimal, so there should be changes"


def test_unfilled_visits_say_why_and_are_counted(two_runs):
    for mode in ("new", "improve"):
        _, res = result_of(two_runs, mode)
        fc = res["fill_check"]
        unfilled = [v for rep in res["teams"].values() for v in rep["visits"] if not v["assigned"]]
        assert fc["unfilled"] == len(unfilled) == res["comparison"]["engine"]["unfilled"] > 0
        assert fc["unfilled"] == (fc["because_rules"] + fc["because_hours"] + fc["because_weekly_max"]
                                  + fc["because_travel_or_booked"])
        causes = {v["unfilled_cause"] for v in unfilled}
        assert causes <= {"rules", "hours", "weekly_max", "travel_or_booked"} and None not in causes
        assert all(v["unfilled_reason"] for v in unfilled)
        assert all(v["unfilled_cause"] is None for rep in res["teams"].values() for v in rep["visits"] if v["assigned"])
        # the made-up current rota is not feasible: it breaks rules and double-books carers
        assert fc["current_rota_feasible"] < fc["current_rota_fully_staffed"]
        assert any(w["code"] == "current_rota_not_feasible" for w in res["warnings"])
        msg = next(w["message"] for w in res["warnings"] if w["code"] == "unallocated")
        assert "because" in msg
        # fewer fills than the current rota are explained: the engine fills at least what is feasible there
        assert res["comparison"]["engine"]["filled"] >= fc["current_rota_feasible"]


def _mins(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def test_forced_changes_are_counted_separately(two_runs):
    _, res = result_of(two_runs, "improve")
    sm = res["change_summary"]
    assert sm["total"] == len(res["changes"])
    assert sm["forced_by_rules"] + sm["fills_unallocated"] + sm["for_travel_continuity_hours"] == sm["total"]
    forced = [c for c in res["changes"] if c["forced_by_rules"]]
    # the made-up current rota puts carers on visits they are not allowed to do (for example
    # a carer whose training has expired), so some changes are forced
    assert sm["forced_by_rules"] == len(forced) >= 1
    assert all(c["reason"].startswith("current carer") and c["from_carers"] for c in forced)
    assert not any(c["reason"].startswith("current carer not allowed") or c["reason"].startswith("current carer on leave")
                   for c in res["changes"] if not c["forced_by_rules"])
    assert sm["new_time_needed"] == sum(1 for c in res["changes"] if c["new_time_needed"])
    assert sm["time_notes"] + sm["time_within_tolerance"] == len(res["time_notes"])


def test_new_time_needed_matches_new_start(two_runs):
    _, res = result_of(two_runs, "improve")
    for c in res["changes"]:
        assert c["new_time_needed"] == (c["new_start"] is not None) == (c["kind"] == "time_with_change")
    assert any(not c["new_time_needed"] for c in res["changes"])  # most carer changes keep the booked time
    ws = {w["code"] for w in res["warnings"]}
    assert "arrival_tolerance_default" in ws  # the test settings file does not set it


def check_result_shape(res):
    assert list(res["teams"]) == ["Leeds", "Dorset"]
    assert set(res["comparison"]) == {"engine", "current"}
    for side in res["comparison"].values():
        assert METRICS <= set(side)
    total = sum(t["metrics"]["visits"] for t in res["teams"].values())
    assert res["comparison"]["engine"]["visits"] == res["comparison"]["current"]["visits"] == total > 150
    assert res["comparison"]["current"]["visits_moved"] == 0
    for name, rep in res["teams"].items():
        assert {"week_start", "days", "metrics", "carers", "clients", "visits", "routes"} <= set(rep)
        assert rep["week_start"] == "2026-11-16" and rep["days"] == ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
        assert METRICS <= set(rep["metrics"])
        assert rep["metrics"]["visits"] == len(rep["visits"])
        for c in rep["carers"]:
            assert CARER <= set(c) and c["name"]
        for cl in rep["clients"]:
            assert {"id", "ref", "area", "recent_carers"} <= set(cl) and cl["ref"].startswith("CL-")
        for v in rep["visits"]:
            assert VISIT <= set(v)
            assert (v["start"] is None) == (not v["assigned"])
            assert v["booking_id"] == v["id"]
            if not v["assigned"]:
                assert v["unfilled_reason"]
            else:
                assert len(v["assigned"]) == v["carers_needed"]
        carers = {c["id"] for c in rep["carers"]}
        for cid, days in rep["routes"].items():
            assert cid in carers
            for day, stops in days.items():
                assert day in rep["days"]
                for s in stops:
                    assert STOP <= set(s)
    for w in res["warnings"]:
        assert set(w) == {"code", "message"}


def test_warnings_for_missing_inputs_and_no_placeholders(two_runs):
    _, res = result_of(two_runs, "improve")
    codes = {w["code"]: w["message"] for w in res["warnings"]}
    for c in ("no_dbs_date", "expired", "no_weekly_max", "agency_defaults", "missing_address", "unallocated"):
        assert c in codes, c
    assert "K010" in codes["no_dbs_date"] and "CL-020" in codes["missing_address"]
    assert "no_continuity" not in codes  # the Continuity report was uploaded
    assert "2099" not in json.dumps(res)


def test_rules_are_respected(two_runs):
    for mode in ("new", "improve"):
        _, res = result_of(two_runs, mode)
        visits = {v["id"]: (team, v) for team, rep in res["teams"].items() for v in rep["visits"]}
        carers = {c["id"]: c for rep in res["teams"].values() for c in rep["carers"]}
        refs = {c["id"]: c["ref"] for rep in res["teams"].values() for c in rep["clients"]}
        for team, v in visits.values():
            ref = refs[v["client_id"]]
            for k in v["assigned"]:
                assert not (ref == "CL-005" and k == "K002"), "do-not-send"
                assert not (ref == "CL-006" and k == "K003"), "safeguarding bar"
                if ref == "CL-003":
                    assert carers[k]["gender"] == "female"
                if ref in ("CL-004", "CL-012"):
                    assert "hoist" in carers[k]["skills"]
            if v["window"] == 0 and v["assigned"]:
                assert v["start"] == v["preferred_start"], "time-critical visits never move"
                assert v["locked"] and v["lock_reason"] == "time-critical booking type"
        assert carers["K003"]["scheduled_minutes"] == 0  # training expired
        assert any("any time" in i for i in carers["K013"]["issues"])  # no hours set: available any time
        assert any("rule not checked" in i for i in carers["K010"]["issues"])
        # leave: K002 off on Wednesday, K008 off Monday and Tuesday (approved); not planned on those days
        leeds, dorset = res["teams"]["Leeds"]["routes"], res["teams"]["Dorset"]["routes"]
        assert "wed" not in leeds.get("K002", {})
        assert not ({"mon", "tue"} & set(dorset.get("K008", {})))


def test_improve_changes_are_explained(two_runs):
    _, res = result_of(two_runs, "improve")
    ch = res["changes"]
    assert [(c["date"], c["booked_start"]) for c in ch] == sorted((c["date"], c["booked_start"]) for c in ch)
    allowed = ("current carer", "fills unallocated booking", "saves ", "familiar carer", "evens hours", "lower overall cost", "start moves to fit")
    for c in ch:
        assert set(c) == {"booking_id", "client_ref", "date", "booked_start", "new_start", "from_carers", "to_carers", "kind", "reason", "new_time_needed", "forced_by_rules"}
        assert c["kind"] in ("carer", "time_with_change")
        assert (c["kind"] == "time_with_change") == (c["new_start"] is not None)
        assert c["to_carers"] and c["reason"]
        assert all(p.strip().startswith(allowed) for p in c["reason"].split(","))
        assert all(" " in n for n in c["to_carers"])  # display names, not IDs
    assert any(c["from_carers"] == [] and c["reason"].startswith("fills unallocated") for c in ch)
    for n in res["time_notes"]:
        assert n["kind"] in ("time_note", "time_within_tolerance") and n["new_start"] != n["booked_start"]
        shift = abs(_mins(n["new_start"]) - _mins(n["booked_start"]))
        assert (shift <= 15) == (n["kind"] == "time_within_tolerance")
    # the engine plan moved fewer visits than it would from scratch
    _, new_res = result_of(two_runs, "new")
    assert res["comparison"]["engine"]["visits_moved"] < new_res["comparison"]["engine"]["visits_moved"]


def test_change_reason_numbers_are_honest(two_runs):
    _, res = result_of(two_runs, "improve")
    # any "saves N min travel" claim: the engine plan's total travel is not above the current rota's
    claims = [c for c in res["changes"] if "saves" in c["reason"]]
    assert claims
    assert res["comparison"]["engine"]["travel_hours"] <= res["comparison"]["current"]["travel_hours"]


# --------------------------------------------------------------------------- exports
def csv_rows(text):
    return list(csv.reader(io.StringIO(text)))


def csv_download(client, run_id, name):
    r = client.get(f"/runs/{run_id}/export/{name}")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    assert r.content.startswith(b"\xef\xbb\xbf"), "UTF-8 with BOM, so Excel shows names and pound signs"
    return csv_rows(r.content.decode("utf-8-sig"))


CHANGES_COLS = ["Day", "Date", "Give to", "Booked time", "New start", "Client", "Booking type", "Booking ID",
                "Action", "Currently with", "Required", "Why", "Done"]
NOTES_COLS = ["Day", "Date", "Booked time", "New start", "Client", "Booking type", "Booking ID",
              "Currently with", "Why", "Shift (min)", "Note", "Done"]
ALLOC_COLS = ["Day", "Date", "Carer", "Start", "End", "New start", "Client", "Booking type", "Booking ID",
              "Double-up with", "Compared with current", "Done"]


def _key_date(d):
    dd, mm, yy = d.split("/")
    return (yy, mm, dd)


def test_exports(client, two_runs):
    new_id, new_res = result_of(two_runs, "new")
    imp_id, imp_res = result_of(two_runs, "improve")
    # ---- allocation.csv (New rota)
    rows = csv_download(client, new_id, "allocation.csv")
    assert rows[0] == ALLOC_COLS
    body = rows[1:]
    expected = sum(max(1, len(v["assigned"])) for rep in new_res["teams"].values() for v in rep["visits"])
    assert len(body) == expected  # one row per carer per booking, plus one per unallocated booking
    assert all(re.fullmatch(r"\d\d/\d\d/\d{4}", r[1]) and re.fullmatch(r"\d\d:\d\d", r[3]) for r in body)
    assert {r[0] for r in body} <= {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}
    assert all(r[11] == "" for r in body)  # Done is blank, for ticking
    # sorted by date, then unallocated first, then carer, then start
    keys = [(_key_date(r[1]), 0 if r[2] == "UNALLOCATED" else 1, r[2].lower(), r[3]) for r in body]
    assert keys == sorted(keys)
    un = [r for r in body if r[2] == "UNALLOCATED"]
    assert un and all(r[10] and r[9] == "" for r in un)  # the reason is in "Compared with current"
    assert {r[10].split(" from")[0] for r in body if r[2] != "UNALLOCATED"} <= {"Same", "Changed", "Was unallocated"}
    assert any(r[9] for r in body)  # a double-up names the other carer
    # a name in the export is a display name ("Surname, I"), not the full client name
    assert all(re.fullmatch(r"[A-Za-z' -]+, [A-Z]", r[6]) for r in body)
    # ---- changes.csv (Improve my rota)
    rows = csv_download(client, imp_id, "changes.csv")
    assert rows[0] == CHANGES_COLS
    body = rows[1:]
    assert len(body) == len(imp_res["changes"])  # no notes in this file
    assert {r[8] for r in body} <= {"Allocate", "Reassign", "Reassign + change time", "Change time"}
    assert {r[10] for r in body} <= {"", "Yes"} and sum(1 for r in body if r[10] == "Yes") == imp_res["change_summary"]["forced_by_rules"]
    assert all(re.fullmatch(r"\d\d:\d\d\u2013\d\d:\d\d", r[3]) and r[12] == "" and r[11] for r in body)
    assert all((r[8] == "Allocate") == (r[9] == "Unallocated") for r in body)
    assert all((r[8] in ("Reassign + change time", "Change time")) == (r[4] != "") for r in body if r[8] != "Allocate")
    assert all(r[4] for r in body if r[8] in ("Reassign + change time", "Change time"))
    keys = [(_key_date(r[1]), r[2].lower(), r[3][:5]) for r in body]
    assert keys == sorted(keys)
    # ---- notes.csv
    rows = csv_download(client, imp_id, "notes.csv")
    assert rows[0] == NOTES_COLS
    body = rows[1:]
    assert len(body) == len(imp_res["time_notes"]) > 0
    tol = imp_res["arrival_tolerance_minutes"]
    for r in body:
        assert r[10] in (f"within {tol} min \u2013 no edit needed", "tight gap \u2013 check")
        assert (int(r[9]) <= tol) == (r[10].startswith("within")) and r[11] == ""
    keys = [(_key_date(r[1]), r[7].lower(), r[2][:5]) for r in body]
    assert keys == sorted(keys)
    # unknown run
    assert client.get("/runs/nope/export/notes.csv").status_code == 404
    assert client.get("/runs/nope/export/changes.csv").status_code == 404


def test_progress_and_status_values(client, files):
    r = post_run(client, files, mode="new")
    run_id = r.json()["run_id"]
    seen = set()
    last = -1.0
    t0 = time.time()
    while time.time() - t0 < 240:
        b = client.get(f"/runs/{run_id}").json()
        assert b["status"] in ("queued", "running", "done", "failed")
        assert 0 <= b["progress"] <= 1 and b["progress"] >= last - 1e-9
        last = b["progress"]
        seen.add(b["status"])
        if "result" in b:
            assert b["status"] == "done"
        if b["status"] == "done":
            break
        time.sleep(0.4)
    assert "running" in seen and b["status"] == "done"
    client.delete(f"/runs/{run_id}")


# --------------------------------------------------------------------------- privacy
def test_no_client_names_or_home_locations_in_the_result(two_runs):
    for mode in ("new", "improve"):
        _, res = result_of(two_runs, mode)
        res = json.loads(json.dumps(res))  # a copy: the shared result is left as it is
        # the only client name in a result is the short display name ("Surname, I")
        for rep in res["teams"].values():
            for cl in rep["clients"]:
                assert re.fullmatch(r"[A-Za-z' -]+, [A-Z]", cl["display_name"]), cl["display_name"]
                assert cl["display_name"].split(",")[0] in fake_data.CLIENT_LAST
                cl["display_name"] = ""
        text = json.dumps(res)
        assert not {n for n in fake_data.CLIENT_FIRST if n in text}, "client first names must never appear"
        assert not {n for n in fake_data.CLIENT_LAST if n in text}, "client surnames only in display_name"
        assert '"home"' not in text and '"location"' not in text and '"lat"' not in text


def test_display_names_travel_modes_and_current_routes(two_runs):
    _, res = result_of(two_runs, "improve")
    modes = {c["id"]: c["travel_mode"] for rep in res["teams"].values() for c in rep["carers"]}
    assert set(modes.values()) <= {"car", "foot", "bus"} and modes["K001"] == "car"
    assert modes["K003"] == "foot" and modes["K006"] == "bus"
    for rep in res["teams"].values():
        cur = rep["current_routes"]
        assert cur and set(cur) <= {c["id"] for c in rep["carers"]}
        for days in cur.values():
            for day, stops in days.items():
                assert day in rep["days"]
                for st in stops:
                    assert STOP <= set(st)
        # the current routes hold exactly the current rota's visits
        cur_visits = sorted(s["visit_id"] for days in cur.values() for stops in days.values() for s in stops)
        expected = sorted(v["id"] for v in rep["visits"] for _ in v["current_assigned"])
        assert cur_visits == expected


def test_logs_hold_no_names(logs, two_runs):
    assert logs.lines, "the service should log something (run IDs and counts)"
    joined = "\n".join(logs.lines)
    leaked = {n for n in fake_names() if n in joined}
    assert not leaked, "no personal data in logs"
    assert any("run " in line and "done" in line for line in logs.lines)


# --------------------------------------------------------------------------- locks
def test_a_lock_keeps_the_visit_with_that_carer(client, files, two_runs):
    _, res = result_of(two_runs, "new")
    pick = None
    for rep in res["teams"].values():
        for v in rep["visits"]:
            if v["carers_needed"] == 1 and len(v["current_assigned"]) == 1 and v["moved"] and v["assigned"] and not v["locked"]:
                pick = v
                break
        if pick:
            break
    assert pick
    wanted = pick["current_assigned"][0]
    r = post_run(client, files, mode="new", locks={pick["booking_id"]: wanted, "no-such-booking": "K001"})
    run_id = r.json()["run_id"]
    body = wait_done(client, run_id)
    assert body["status"] == "done"
    v = next(v for rep in body["result"]["teams"].values() for v in rep["visits"] if v["booking_id"] == pick["booking_id"])
    assert v["locked"] and v["lock_reason"] == "locked by coordinator"
    assert v["assigned"] in ([wanted], [])  # kept with that carer, or unfilled if the carer cannot do it; never someone else
    assert any(w["code"] == "lock_ignored" for w in body["result"]["warnings"])
    client.delete(f"/runs/{run_id}")


# --------------------------------------------------------------------------- nothing is kept
def test_delete_removes_the_run_and_its_data(client, store, files):
    r = post_run(client, files, mode="new")
    run_id = r.json()["run_id"]
    run = store.get(run_id)
    t0 = time.time()
    while not run.procs and time.time() - t0 < 30:
        time.sleep(0.2)
    procs = list(run.procs)
    assert procs, "the search should be running"
    assert client.delete(f"/runs/{run_id}").json() == {"deleted": True}
    assert client.get(f"/runs/{run_id}").status_code == 404
    assert client.delete(f"/runs/{run_id}").status_code == 404
    assert client.get(f"/runs/{run_id}/export/allocation.csv").status_code == 404
    assert store.get(run_id) is None and run_id not in store.ids()
    assert run.inputs is None and run.result is None
    for p in procs:
        p.join(timeout=10)
        assert not p.is_alive(), "the search process must be stopped when the run is deleted"


def test_delete_after_done_clears_the_result(client, store, files):
    r = post_run(client, files, mode="improve")
    run_id = r.json()["run_id"]
    assert wait_done(client, run_id)["status"] == "done"
    run = store.get(run_id)
    assert run.result is not None and run.inputs is None  # the uploads are dropped as soon as the engine has them
    client.delete(f"/runs/{run_id}")
    assert run.result is None and store.get(run_id) is None


def test_runs_expire(store, client, files):
    s = json.loads(files["settings"])
    s["carer_name_matches"] = []
    r = post_run(client, dict(files, settings=json.dumps(s).encode()), mode="new")
    run_id = r.json()["run_id"]
    wait_done(client, run_id)
    store.get(run_id).created -= 3 * 3600  # pretend it is old
    assert store.purge_expired() >= 1
    assert client.get(f"/runs/{run_id}").status_code == 404


def test_shutdown_discards_everything(files):
    st = RunStore(ttl_minutes=60)
    run = st.create({"bookings": files["bookings"], "settings": None, "continuity": None, "mode": "new",
                     "change_cost_pence": 1000, "locks": {}})
    time.sleep(1)
    st.shutdown()
    assert st.ids() == [] and run.inputs is None and run.result is None
    time.sleep(0.5)
    assert all(not p.is_alive() for p in run.procs)


def test_no_files_are_written(files, tmp_path, monkeypatch):
    """The service keeps uploads and results in memory: a run creates no files in its working folder."""
    monkeypatch.chdir(tmp_path)
    st = RunStore()
    try:
        run = st.create({"bookings": files["bookings"], "settings": files["settings"], "continuity": files["continuity"],
                         "mode": "improve", "change_cost_pence": 1000, "locks": {}})
        while run.status in ("queued", "running"):
            time.sleep(0.2)
        assert run.status == "done"
    finally:
        st.shutdown()
    assert list(tmp_path.iterdir()) == []


def test_fake_data_is_made_up():
    assert fake_data.WEEK_START.isoformat() == "2026-11-16"
    names = {c.name for c in fake_data.agency()[0]} | {c.name for c in fake_data.agency()[1]}
    assert len(names) == 33
