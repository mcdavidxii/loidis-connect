"""Read the exports and cached API data, pseudonymise, and write
data/private/trial/prepared.json and id_map.json. Prints counts only.

Run fetch_api.py first. No personal data lives in this file."""
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

import openpyxl

REPO = Path(__file__).resolve().parents[2]
TRIAL = REPO / "data" / "private" / "trial"
RAW = TRIAL / "api_raw"
PRIV = REPO / "data" / "private"
WEEK_START = date(2026, 11, 16)
WEEK_END = date(2026, 11, 22)
BOOKINGS = PRIV / "bookings_report_2026-11-16_2026-11-22 (1).xlsx"
CONTINUITY = PRIV / "continuity_report_2026-11-16_2026-11-22.xlsx"
CLIENT_CSV = PRIV / "bookings_optimised_2026-11-17_2026-11-19.csv"  # client name -> ClientId
SCHEDULE_CSV = PRIV / "client_schedule.csv"
REGION_OF_TEAM = {"Leeds": "leeds", "Dorchester": "dorset", "Weymouth": "dorset"}


def norm(s):
    return re.sub(r"[^a-z ]", "", re.sub(r"\s+", " ", (s or "").lower().strip()))


def load(name):
    return json.loads((RAW / f"{name}.json").read_text())


def main():
    stats = {}
    # ---- bookings ---------------------------------------------------------------
    wb = openpyxl.load_workbook(BOOKINGS, read_only=True, data_only=True)
    rows = list(wb["Bookings"].iter_rows(values_only=True))
    labels = rows[1]
    col = {l: i for i, l in enumerate(labels) if l}
    raw = []
    for n, r in enumerate(rows[2:], start=3):
        if r[col["Date"]] is None:
            continue
        m = re.fullmatch(r"(\d+):(\d+)", r[col["Planned"]].strip())
        dt = r[col["Date"]]
        st = r[col["Start"]]
        names = [x.strip() for x in (r[col["Carer(s)"]] or "").split(",") if x.strip()]
        raw.append({
            "row": n,
            "date": dt.date(),
            "start": st.hour * 60 + st.minute,
            "duration": int(m[1]) * 60 + int(m[2]),
            "btype": r[col["Booking Type"]],
            "client": r[col["Client"]],
            "expected": r[col["Expected Carers"]],
            "allocated": r[col["Allocated Carers"]],
            "carers": names,
            "cancelled": bool(r[col["Cancelled"]]),
        })
    stats["booking_rows"] = len(raw)
    bookings = [b for b in raw if not b["cancelled"]]
    stats["dropped_cancelled"] = len(raw) - len(bookings)
    stats["visits_kept"] = len(bookings)
    stats["expect1_allocated2"] = sum(1 for b in bookings if b["expected"] == 1 and len(b["carers"]) == 2)
    stats["expect1_allocated2_minutes"] = sum(b["duration"] for b in bookings if b["expected"] == 1 and len(b["carers"]) == 2)
    stats["no_carer_allocated"] = sum(1 for b in bookings if not b["carers"])
    stats["allocated_less_than_expected"] = sum(1 for b in bookings if len(b["carers"]) < b["expected"])
    stats["allocated_count_mismatch_with_names"] = sum(1 for b in bookings if len(b["carers"]) != b["allocated"])
    stats["cross_midnight_visits"] = sum(1 for b in bookings if b["start"] + b["duration"] > 1440)
    stats["visits_outside_week"] = sum(1 for b in bookings if not (WEEK_START <= b["date"] <= WEEK_END))

    # ---- client ids and teams -------------------------------------------------------
    with open(CLIENT_CSV, newline="", encoding="utf-8-sig") as f:
        csv_rows = list(csv.DictReader(f))
    with open(SCHEDULE_CSV, newline="", encoding="utf-8-sig") as f:
        sched = list(csv.DictReader(f))
    csv_by_name = {}
    for r in csv_rows:
        csv_by_name.setdefault(norm(r["ClientName"]), r)
    sched_by_ref = {r["ClientReferenceCode"]: r for r in sched}
    sched_by_name = {norm(r["ClientName"]): r for r in sched}
    api_clients = {c["id"]: c for c in load("clients")}

    names = sorted({norm(b["client"]) for b in bookings})
    client_rows = []
    for nm in names:
        cr = csv_by_name.get(nm)
        api_id = cr["ClientId"] if cr else None
        ref = cr["ClientReferenceCode"] if cr else None
        sr = sched_by_ref.get(ref) or sched_by_name.get(nm)
        team = (sr or {}).get("ClientDefaultTeam") or (cr or {}).get("Team", "").split(",")[0].strip()
        client_rows.append({"name": nm, "api_id": api_id, "ref": ref, "team": team,
                            "csv_team": (cr or {}).get("Team"), "in_api": api_id in api_clients})
    client_rows.sort(key=lambda c: c["api_id"] or ("~" + c["name"]))
    for i, c in enumerate(client_rows, 1):
        c["pid"] = f"C{i:03d}"
    cid_by_name = {c["name"]: c["pid"] for c in client_rows}
    stats["clients_in_bookings"] = len(client_rows)
    stats["clients_matched_to_csv_id"] = sum(1 for c in client_rows if c["api_id"])
    stats["clients_found_in_api"] = sum(1 for c in client_rows if c["in_api"])
    stats["clients_with_schedule_team"] = sum(1 for c in client_rows if c["team"] in REGION_OF_TEAM)
    stats["clients_csv_team_differs_from_default_team"] = sum(
        1 for c in client_rows if c["csv_team"] and c["csv_team"] != c["team"])
    stats["client_team_counts"] = dict(Counter(c["team"] for c in client_rows))

    for c in client_rows:
        ac = api_clients.get(c["api_id"])
        geo = ((ac or {}).get("relationships", {}).get("preferred_address") or {}).get("meta", {}).get("geocoding") or {}
        ok = geo.get("status") == "success" and geo.get("latitude") is not None
        c["lat"], c["lon"] = (geo["latitude"], geo["longitude"]) if ok else (None, None)
        c["geo_ok"] = ok
    stats["clients_geocoded"] = sum(1 for c in client_rows if c["geo_ok"])
    stats["clients_geocode_missing"] = sum(1 for c in client_rows if not c["geo_ok"])

    # ---- carers -----------------------------------------------------------------------
    api_carers = load("carers")
    tt_mode = {t["id"]: t["attributes"]["mode_of_transport"] for t in load("transport_types")}
    addrs = load("carer_addresses")

    def variants(c):
        p = c["relationships"]["person"]["attributes"]
        s = set()
        for fn in (p.get("first_name"), p.get("preferred_name")):
            if fn and p.get("last_name"):
                ln = p["last_name"]
                s |= {norm(f"{fn} {ln}"), norm(f"{ln} {fn}"), norm(f"{ln}, {fn}")}
        return s

    booked_names = sorted({norm(n) for b in bookings for n in b["carers"]})
    match = {}
    for c in api_carers:
        v = variants(c)
        for n in booked_names:
            if n in v:
                match.setdefault(n, c)
    carer_rows = []
    for n in booked_names:
        c = match.get(n)
        row = {"name": n, "api_id": c["id"] if c else None}
        if c:
            p = c["relationships"]["person"]["attributes"]
            g = (p.get("gender") or "").lower()
            row["gender"] = {"f": "female", "m": "male"}.get(g, g or "unknown")
            row["api_mode"] = tt_mode.get(c["attributes"].get("primary_transport_type_id"))
            a = addrs.get(c["id"], [])
            geo = (a[0].get("meta", {}).get("geocoding") if a else None) or {}
            ok = geo.get("status") == "success" and geo.get("latitude") is not None
            row["lat"], row["lon"] = (geo["latitude"], geo["longitude"]) if ok else (None, None)
            row["has_address"] = bool(a)
            row["geo_ok"] = ok
        else:
            row.update(gender="unknown", api_mode=None, lat=None, lon=None, has_address=False, geo_ok=False)
        carer_rows.append(row)
    carer_rows.sort(key=lambda c: c["api_id"] or ("~" + c["name"]))
    for i, c in enumerate(carer_rows, 1):
        c["pid"] = f"K{i:03d}"
    kid_by_name = {c["name"]: c["pid"] for c in carer_rows}
    stats["carers_in_bookings"] = len(carer_rows)
    stats["carers_matched_to_api"] = sum(1 for c in carer_rows if c["api_id"])
    stats["carers_unmatched"] = sum(1 for c in carer_rows if not c["api_id"])
    stats["carers_geocoded"] = sum(1 for c in carer_rows if c["geo_ok"])
    stats["carers_no_address"] = sum(1 for c in carer_rows if not c["has_address"])
    stats["carers_geocode_failed_other"] = sum(1 for c in carer_rows if c["has_address"] and not c["geo_ok"])
    stats["carer_transport_from_api"] = dict(Counter(c["api_mode"] or "none" for c in carer_rows))
    stats["api_carers_total"] = len(api_carers)
    booked_ids = {c["api_id"] for c in carer_rows}
    stats["api_active_carers_not_in_bookings"] = sum(
        1 for c in api_carers if c["meta"]["active"] and c["id"] not in booked_ids)

    # ---- regions ---------------------------------------------------------------------
    client_region = {c["pid"]: REGION_OF_TEAM.get(c["team"]) for c in client_rows}
    visits = []
    for b in sorted(bookings, key=lambda b: (cid_by_name[norm(b["client"])], b["date"], b["start"], b["row"])):
        visits.append({
            "row": b["row"],
            "client": cid_by_name[norm(b["client"])],
            "day": (b["date"] - WEEK_START).days,
            "start": b["start"],
            "duration": b["duration"],
            "btype": b["btype"],
            "expected": b["expected"],
            "carers": [kid_by_name[norm(n)] for n in b["carers"]],
        })
    for i, v in enumerate(visits, 1):
        v["id"] = f"V{i:04d}"
        v["region"] = client_region[v["client"]]
    cnt = defaultdict(Counter)
    for v in visits:
        for k in v["carers"]:
            cnt[k][v["region"]] += 1
    carer_region = {}
    for c in carer_rows:
        r = cnt[c["pid"]]
        carer_region[c["pid"]] = r.most_common(1)[0][0] if r else None
    stats["carers_covering_both_regions"] = sum(1 for k, r in cnt.items() if len(r) > 1)
    stats["carer_visit_pairs_outside_home_region"] = sum(
        n for k, r in cnt.items() for reg, n in r.items() if reg != carer_region[k])
    stats["carers_per_region"] = dict(Counter(carer_region.values()))
    stats["visits_per_region"] = dict(Counter(v["region"] for v in visits))
    stats["clients_per_region"] = dict(Counter(client_region.values()))

    # ---- leave ----------------------------------------------------------------------------
    api_id_to_pid = {c["api_id"]: c["pid"] for c in carer_rows if c["api_id"]}
    leaves = load("leaves")
    stats["leave_records_total"] = len(leaves)
    leave_days = []
    overlap = approved = used = 0
    for l in leaves:
        a = l["attributes"]
        s, f = date.fromisoformat(a["start"][:10]), date.fromisoformat(a["finish"][:10])
        if f > s and a["finish"][11:19] == "00:00:00":
            f -= timedelta(days=1)
        if f < WEEK_START or s > WEEK_END:
            continue
        overlap += 1
        if not a["is_approved"] or a["is_declined"]:
            continue
        approved += 1
        if not a["is_full_days"]:
            continue
        pid = api_id_to_pid.get(a["carer_id"])
        if not pid:
            continue
        used += 1
        d = max(s, WEEK_START)
        while d <= min(f, WEEK_END):
            leave_days.append({"carer": pid, "day": (d - WEEK_START).days})
            d += timedelta(days=1)
    stats["leave_overlapping_week"] = overlap
    stats["leave_approved_overlapping_week"] = approved
    stats["leave_full_day_used_for_booked_carers"] = used
    stats["leave_days_used"] = len(leave_days)
    stats["leave_ends_after_2026_11_01"] = sum(1 for l in leaves if l["attributes"]["finish"][:10] >= "2026-11-01")

    # ---- continuity ---------------------------------------------------------------------------
    wb2 = openpyxl.load_workbook(CONTINUITY, read_only=True, data_only=True)
    crow = list(wb2["Continuity"].iter_rows(values_only=True))
    cur = None
    cont = defaultdict(dict)
    n_rows = unm_c = unm_k = ambiguous = 0
    pcts = []
    for r in crow[1:]:
        if r[0]:
            cur = norm(r[0])
        if not r[1] or not isinstance(r[3], (int, float)):
            continue
        n_rows += 1
        cp = cid_by_name.get(cur)
        toks = set(norm(r[1]).split())
        hits = [pid for nm, pid in kid_by_name.items() if set(nm.split()) <= toks]
        if len(hits) > 1:
            ambiguous += 1
        kp = hits[0] if len(hits) == 1 else None
        if not cp:
            unm_c += 1
            continue
        if not kp:
            unm_k += 1
            continue
        pcts.append(r[3])
        cont[cp][kp] = r[3]
    scale = 100.0 if pcts and max(pcts) > 1.0 else 1.0
    stats["continuity_rows"] = n_rows
    stats["continuity_rows_client_unmatched"] = unm_c
    stats["continuity_rows_carer_unmatched"] = unm_k
    stats["continuity_carer_ambiguous"] = ambiguous
    stats["continuity_pct_max_raw"] = max(pcts) if pcts else None
    cont = {c: {k: v / scale for k, v in d.items()} for c, d in cont.items()}
    stats["clients_with_continuity_rows"] = len(cont)

    # ---- write -----------------------------------------------------------------------------------
    prepared = {
        "week_start": WEEK_START.isoformat(),
        "clients": [{k: c[k] for k in ("pid", "team", "lat", "lon", "geo_ok")} | {"region": client_region[c["pid"]]}
                    for c in client_rows],
        "carers": [{k: c[k] for k in ("pid", "gender", "api_mode", "lat", "lon", "geo_ok", "has_address")}
                   | {"matched": bool(c["api_id"]), "region": carer_region[c["pid"]]} for c in carer_rows],
        "visits": visits,
        "leave_days": leave_days,
        "continuity": cont,
        "stats": stats,
    }
    (TRIAL / "prepared.json").write_text(json.dumps(prepared))
    (TRIAL / "id_map.json").write_text(json.dumps({
        "clients": [{"name_normalised": c["name"], "api_id": c["api_id"], "pseudo_id": c["pid"]} for c in client_rows],
        "carers": [{"name_normalised": c["name"], "api_id": c["api_id"], "pseudo_id": c["pid"]} for c in carer_rows],
        "visits": [{"pseudo_id": v["id"], "bookings_xlsx_row": v["row"]} for v in visits],
    }, indent=1))
    for k, v in stats.items():
        print(f"{k}: {v}")


if __name__ == "__main__":
    sys.exit(main())
