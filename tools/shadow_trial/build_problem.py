"""Build one engine problem per region from prepared.json (see prepare_inputs.py).

  python -I tools/shadow_trial/build_problem.py [--max-hours 60] [--day-start 07:00]
                                                [--day-end 22:00] [--region leeds --region dorset]

Writes to data/private/trial/: <region>_problem.json (engine input, pseudo IDs only),
<region>_actual_assignments.json (who really did each visit) and <region>_build_info.json
(counts and the trial settings used). Prints counts only. No personal data in this file."""
import argparse
import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "engine"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from loidis_rota.models import Location  # noqa: E402  (engine reused as-is, read-only)
from loidis_rota.travel import distance_km  # noqa: E402

FAR_HOME_KM = 100  # a geocoded home this far from every client the carer visited here is treated as unusable
TRIAL = REPO / "data" / "private" / "trial"
MODE_MAP = {"driving": "car", "walking": "foot", "transit": "bus", "bicycling": "foot"}
LOCK_TYPES = {"Waking Night", "Client Respite"}
LOCK_MIN_DURATION = 240


def hhmm_to_min(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def merge(blocks):
    out = []
    for s, e in sorted(blocks):
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-hours", type=float, default=60, help="weekly maximum hours per carer (hard cap)")
    ap.add_argument("--day-start", default="07:00", help="start of each carer's available day (HH:MM)")
    ap.add_argument("--day-end", default="22:00", help="end of each carer's available day (HH:MM)")
    ap.add_argument("--lock-pad", type=int, default=90,
                    help="minutes added before and after each locked/outside-window visit in the carer's "
                         "availability, so travel from and back home fits inside the block")
    ap.add_argument("--window", type=int, default=0,
                    help="minutes a non-locked visit may start earlier or later than booked (locked visits stay 0)")
    ap.add_argument("--shift-cost", type=int, default=0,
                    help="engine setting shift_pence_per_min: pence per minute a visit starts away from its booked time")
    ap.add_argument("--continuity-cost", type=int, default=None,
                    help="engine setting continuity_penalty_pence (pence per visit with a carer not in recent_carers); "
                         "default: leave the engine default")
    ap.add_argument("--continuity-file", default=str(REPO / "data" / "private" / "continuity_report_2026-11-16_2026-11-22.xlsx"),
                    help="continuity report used for recent_carers (same format as the current one)")
    ap.add_argument("--region", action="append", choices=["leeds", "dorset"])
    ap.add_argument("--suffix", default="", help="added to output file names, e.g. _wide, for sensitivity runs")
    args = ap.parse_args()
    regions = args.region or ["leeds", "dorset"]
    day_start, day_end = hhmm_to_min(args.day_start), hhmm_to_min(args.day_end)
    max_minutes = int(round(args.max_hours * 60))
    trial_settings = {
        "max_hours": args.max_hours,
        "max_minutes_week": max_minutes,
        "day_start": args.day_start,
        "day_end": args.day_end,
        "visit_window_minutes": args.window,
        "continuity_file": Path(args.continuity_file).name,
        "lock_booking_types": sorted(LOCK_TYPES),
        "lock_min_duration_minutes": LOCK_MIN_DURATION,
        "lock_pad_minutes": args.lock_pad,
        "equal_hours_contracted": True,
        "shift_pence_per_min": args.shift_cost,
        "continuity_penalty_pence": args.continuity_cost if args.continuity_cost is not None else "engine default",
        "engine_settings": "defaults" if not (args.shift_cost or args.continuity_cost is not None) else "defaults plus overrides listed here",
    }

    P = json.loads((TRIAL / "prepared.json").read_text())
    clients = {c["pid"]: c for c in P["clients"]}
    carers = {c["pid"]: c for c in P["carers"]}
    visits_all = P["visits"]
    from continuity import load_continuity
    continuity, cstats = load_continuity(args.continuity_file, TRIAL / "id_map.json")
    trial_settings["continuity_parse"] = cstats

    # centroid of clients each carer visited (fallback home)
    visited = {}
    for v in visits_all:
        for k in v["carers"]:
            visited.setdefault(k, []).append(clients[v["client"]])
    leave = {}
    for l in P["leave_days"]:
        leave.setdefault(l["carer"], set()).add(l["day"])

    # other-region visits per carer: (region, carer) -> {day: minutes}; used so a home carer is not
    # planned in one region while locked into a visit in another (finding: cross-region carers)
    other_visits = {}
    for v in visits_all:
        for k in v["carers"]:
            other_visits.setdefault(k, []).append(v)

    for region in regions:
        info = {"region": region, "trial_settings": trial_settings}
        r_visits = [v for v in visits_all if v["region"] == region]
        r_client_ids = sorted({v["client"] for v in r_visits})
        home_carers = sorted(k for k, c in carers.items() if c["region"] == region)
        guest_carers = sorted({k for v in r_visits for k in v["carers"]} - set(home_carers))
        info["clients"] = len(r_client_ids)
        info["visits"] = len(r_visits)
        info["home_carers"] = len(home_carers)
        info["guest_carers_only_for_locked_visits"] = len(guest_carers)
        info["visits_done_by_guest_carers"] = sum(1 for v in r_visits if set(v["carers"]) & set(guest_carers))

        # --- visits ---------------------------------------------------------------------
        out_visits, locked_blocks = [], {}
        n_locked_type = n_locked_window = n_locked_guest = 0
        n_partial_unlocked = n_partial_outside_window = n_partial_guest_blocks = 0
        for v in r_visits:
            lock_reason = None
            outside = v["start"] < day_start or v["start"] + v["duration"] > day_end
            if v["btype"] in LOCK_TYPES or v["duration"] >= LOCK_MIN_DURATION:
                lock_reason = "type"
            elif outside:
                lock_reason = "window"
            elif set(v["carers"]) & set(guest_carers):
                lock_reason = "guest"
            # lock only when the actual week fully staffed the visit; a partly staffed visit stays
            # fillable (locking fewer carers than needed would make it impossible to fill)
            partial = bool(lock_reason and v["carers"]) and len(v["carers"]) < v["expected"]
            locked = list(v["carers"]) if lock_reason and v["carers"] and not partial else []
            pad_for = locked
            window = 0 if locked else args.window
            if partial:
                n_partial_unlocked += 1
                if outside:
                    # cannot be placed inside the placeholder day: keep the pad blocks of those who attended
                    pad_for = list(v["carers"])
                    window = 0
                    n_partial_outside_window += 1
                else:
                    pad_for = [k for k in v["carers"] if k in guest_carers]
                    n_partial_guest_blocks += bool(pad_for)
            if locked:
                n_locked_type += lock_reason == "type"
                n_locked_window += lock_reason == "window"
                n_locked_guest += lock_reason == "guest"
            for k in pad_for:
                locked_blocks.setdefault((k, v["day"]), []).append(
                    (max(0, v["start"] - args.lock_pad), v["start"] + v["duration"] + args.lock_pad))
            out_visits.append({
                "id": v["id"], "client_id": v["client"], "day": v["day"], "start": v["start"],
                "window": window, "duration": v["duration"], "carers_needed": v["expected"],
                "required_skills": [], "locked_carers": locked, "kind": "care",
            })
        info["visits_partially_staffed_would_lock_left_unlocked"] = n_partial_unlocked
        info["of_which_outside_day_window_pad_blocks_kept_for_attendees"] = n_partial_outside_window
        info["of_which_guest_attendee_pad_blocks_kept"] = n_partial_guest_blocks
        info["visits_locked_long_or_type"] = n_locked_type
        info["visits_locked_outside_day_window"] = n_locked_window
        info["visits_locked_guest_carer"] = n_locked_guest
        info["visits_expected1_but_allocated2"] = sum(1 for v in r_visits if v["expected"] == 1 and len(v["carers"]) == 2)
        info["visits_with_no_carer_actually_allocated"] = sum(1 for v in r_visits if not v["carers"])
        info["visits_fewer_allocated_than_expected"] = sum(1 for v in r_visits if len(v["carers"]) < v["expected"])
        info["visits_double_up_expected"] = sum(1 for v in r_visits if v["expected"] == 2)

        # --- carers ------------------------------------------------------------------------
        out_carers, absences = [], []
        fallback_home = unknown_mode = far_home = 0
        n_with_day = 0
        xr_carers = xr_days = xr_minutes = 0
        for k in home_carers + guest_carers:
            c = carers[k]
            is_guest = k in guest_carers
            pts = [p for p in visited.get(k, []) if p["region"] == region] or visited.get(k, [])
            far = c["geo_ok"] and pts and min(
                distance_km(Location(c["lat"], c["lon"]), Location(p["lat"], p["lon"])) for p in pts) > FAR_HOME_KM
            if c["geo_ok"] and not far:
                lat, lon = c["lat"], c["lon"]
            else:
                far_home += bool(far)
                lat = sum(p["lat"] for p in pts) / len(pts)
                lon = sum(p["lon"] for p in pts) / len(pts)
                fallback_home += 1
            mode = MODE_MAP.get(c["api_mode"])
            if mode is None:
                mode = "car"
                unknown_mode += 1
            # home carer with visits in another region this week: no default day block on those days,
            # and the weekly cap is reduced by those minutes
            other_days, other_min = set(), 0
            if not is_guest:
                for ov in other_visits.get(k, []):
                    if ov["region"] != region:
                        other_days.add(ov["day"])
                        other_min += ov["duration"]
                if other_days:
                    xr_carers += 1
                    xr_minutes += other_min
            cap = max(0, max_minutes - other_min)
            av = []
            for d in range(7):
                if d in leave.get(k, ()):
                    absences.append({"carer_id": k, "day": d, "type": "annual_leave"})
                    continue
                blocks = list(locked_blocks.get((k, d), []))
                if not is_guest:
                    if d in other_days:
                        xr_days += 1
                    else:
                        blocks.append((day_start, day_end))
                for s, e in merge(blocks):
                    av.append({"day": d, "start": s, "end": e})
            if not is_guest and any(True for _ in av):
                n_with_day += 1
            out_carers.append({
                "id": k, "area": region, "home": {"lat": lat, "lon": lon}, "travel_mode": mode,
                "skills": [], "gender": c["gender"], "contracted_minutes_week": 0,
                "max_minutes_week": cap, "dbs_expiry": "2099-12-31", "training_expiry": "2099-12-31",
                "availability": av,
            })
        info["cross_region_home_carers_with_visits_elsewhere"] = xr_carers
        info["cross_region_day_blocks_removed"] = xr_days
        info["cross_region_minutes_reserved_from_weekly_cap"] = xr_minutes
        info["carers_with_fallback_home_location"] = fallback_home
        info["of_which_geocoded_home_over_100km_from_all_their_clients"] = far_home
        info["carers_travel_mode_defaulted_to_car"] = unknown_mode
        info["carer_modes"] = dict(Counter(c["travel_mode"] for c in out_carers))
        info["absence_days"] = len(absences)

        total_minutes = sum(v["duration"] * v["expected"] for v in r_visits)
        share = int(round(total_minutes / max(1, n_with_day)))
        for c in out_carers:
            if c["id"] in guest_carers:
                c["contracted_minutes_week"] = 0
            else:
                c["contracted_minutes_week"] = share
        info["region_care_minutes_needed"] = total_minutes
        info["carers_counted_for_equal_share"] = n_with_day
        info["equal_share_minutes_per_carer"] = share

        # --- clients -------------------------------------------------------------------------
        present = {c["id"] for c in out_carers}
        out_clients = []
        fb_clients = 0
        for cid in r_client_ids:
            c = clients[cid]
            if c["geo_ok"]:
                lat, lon = c["lat"], c["lon"]
            else:
                fb_clients += 1
                same = [x for x in clients.values() if x["geo_ok"] and x["region"] == region]
                lat = sum(x["lat"] for x in same) / len(same)
                lon = sum(x["lon"] for x in same) / len(same)
            recent = sorted(k for k, pct in continuity.get(cid, {}).items() if pct >= 0.2 and k in present)
            out_clients.append({
                "id": cid, "area": region, "location": {"lat": lat, "lon": lon},
                "commissioned_minutes_week": sum(v["duration"] for v in r_visits if v["client"] == cid),
                "funder": "council", "gender_preference": None, "do_not_send": [],
                "safeguarding_bar": [], "recent_carers": recent,
            })
        info["clients_with_fallback_location"] = fb_clients
        info["clients_with_recent_carers"] = sum(1 for c in out_clients if c["recent_carers"])

        # --- validate --------------------------------------------------------------------------
        cids = {c["id"] for c in out_clients}
        kids = {c["id"] for c in out_carers}
        assert all(v["client_id"] in cids for v in out_visits), "visit with unknown client"
        assert all(k in kids for v in out_visits for k in v["locked_carers"]), "locked carer missing"
        assert all(k in kids for v in r_visits for k in v["carers"]), "actual carer missing from problem"

        engine_settings = {}
        if args.shift_cost:
            engine_settings["shift_pence_per_min"] = args.shift_cost
        if args.continuity_cost is not None:
            engine_settings["continuity_penalty_pence"] = args.continuity_cost
        problem = {
            "week_start": P["week_start"], "clients": out_clients, "carers": out_carers,
            "visits": out_visits, "absences": absences,
            "settings": engine_settings,
            "trial_settings": trial_settings,
        }
        (TRIAL / f"{region}{args.suffix}_problem.json").write_text(json.dumps(problem, indent=1))
        (TRIAL / f"{region}{args.suffix}_actual_assignments.json").write_text(
            json.dumps({v["id"]: v["carers"] for v in r_visits}, indent=1))
        (TRIAL / f"{region}{args.suffix}_build_info.json").write_text(json.dumps(info, indent=1))
        print(f"== {region}")
        for k, v in info.items():
            if k not in ("trial_settings", "region"):
                print(f"  {k}: {v}")
    print("trial_settings:", trial_settings)


if __name__ == "__main__":
    sys.exit(main())
