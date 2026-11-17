"""Build the `result` of a run (docs/ENGINE_API.md) from the engine's week plans, and the two
CSV exports. Reasons for changes are worked out from the numbers, never invented.

Nothing here puts home coordinates, client names or health details in the result: carers are
shown by ID and display name (as the settings file has them), clients by reference code.
"""

from __future__ import annotations

import re
import statistics
from datetime import timedelta

from dataclasses import replace

from loidis_rota.report import build_report
from loidis_rota.rules import carer_rule_failure, fits_block
from loidis_rota.solver import DayResult

from .build import Build, RegionBuild
from .csvutil import to_csv
from .scoring import feasible_current, score_current


def clock(minutes: int | float) -> str:
    m = int(round(minutes)) % 1440
    return f"{m // 60:02d}:{m % 60:02d}"


# --------------------------------------------------------------------------- metrics
def contract_metrics(reports: list[dict], moved: int) -> dict:
    """The metrics object of the contract, from one or more region reports (the same code
    scores the engine's plan and the current rota, so the two are comparable)."""
    visits = filled = 0
    care = travel = miles = 0.0
    hits = slots = 0
    carer_off = carer_changed = 0
    pooled: dict[str, list[float]] = {}  # carer id -> [care minutes across regions, home share]
    for rep in reports:
        recent = {c["id"]: set(c["recent_carers"]) for c in rep["clients"]}
        for v in rep["visits"]:
            visits += 1
            if len(v["assigned"]) >= v["carers_needed"]:
                filled += 1
            if v["assigned"] and v.get("start") is not None and v["start"] != v.get("preferred_start", v["start"]):
                carer_off += 1
            if v["assigned"] and "current_assigned" in v and set(v["assigned"]) != set(v["current_assigned"]):
                carer_changed += 1
            for k in v["assigned"]:
                slots += 1
                hits += k in recent.get(v["client_id"], set())
        for c in rep["carers"]:
            care += c["scheduled_minutes"]
            travel += c["travel_minutes"]
            miles += c["miles"]
            row = pooled.setdefault(c["id"], [0.0, 0.0])
            row[0] += c["scheduled_minutes"]
            row[1] = max(row[1], c.get("contracted_minutes", 0))
    # Hours per carer as in the trial: care hours (what the weekly maximum limits, travel not
    # included), each carer once with their hours summed across regions, home carers only
    # (guest entries have no equal-hours share and are left out).
    hours = sorted(m / 60 for m, share in pooled.values() if share > 0)
    r1 = lambda x: round(x, 1)  # noqa: E731
    return {
        "visits": visits,
        "filled": filled,
        "unfilled": visits - filled,
        "fill_rate": round(filled / max(1, visits), 3),
        "care_hours": r1(care / 60),
        "travel_hours": r1(travel / 60),
        "miles": r1(miles),
        "continuity_rate": round(hits / max(1, slots), 3),
        "hours_min": r1(hours[0]) if hours else 0,
        "hours_median": r1(statistics.median(hours)) if hours else 0,
        "hours_max": r1(hours[-1]) if hours else 0,
        "hours_stdev": r1(statistics.pstdev(hours)) if len(hours) > 1 else 0,
        "visits_moved": moved,
        "visits_carer_changed": carer_changed,
        "visits_started_off_booked_time": carer_off,
    }


# --------------------------------------------------------------------------- report
def _humanise(text: str, names: dict[str, str]) -> str:
    """Replace carer and client IDs inside an engine explanation with display names/refs."""
    for key in sorted(names, key=len, reverse=True):
        text = re.sub(rf"(?<![\w-]){re.escape(key)}(?![\w-])", names[key], text)
    return text


def unfilled_cause(rb: RegionBuild, visit_id: str, sched: dict[str, int], engine_reason: str | None):
    """Why a visit is unfilled, from the engine's own rules: ("rules" | "hours" | "weekly_max" |
    "travel_or_booked", plain reason). Counts only; carers are never named here."""
    p = rb.problem
    vv = replace(p.visit_by_id[visit_id], locked_carers=[])
    need = vv.carers_needed
    elig = [k for k in p.carers if carer_rule_failure(p, k, vv) is None]
    if len(elig) < need:
        if need > 1 and elig:
            return "rules", f"Needs {need} carers but only {len(elig)} are allowed to do this visit (rules)."
        return "rules", engine_reason or "No carer is allowed to do this visit (rules)."
    work = [k for k in elig if any(fits_block(vv, b) for b in k.blocks_on(vv.day))]
    if len(work) < need:
        return "hours", (
            f"{len(elig)} carer(s) are allowed but only {len(work)} are working at this time "
            f"(need {need}), after leave and working hours.")
    room = [k for k in work if sched.get(k.id, 0) + vv.duration <= k.max_minutes_week]
    if len(room) < need:
        return "weekly_max", (
            f"{len(work)} carer(s) are working at this time but only {len(room)} are under their "
            f"weekly maximum (need {need}).")
    return "travel_or_booked", engine_reason or (
        f"{len(work)} suitable carer(s) are working, but all are booked or too far away at this time.")


def _region_report(
    rb: RegionBuild, week: list[DayResult], cur_week: list[DayResult]
) -> tuple[dict, dict, dict]:
    """(contract report, raw engine report, raw current report) for a region."""
    p = rb.problem
    raw = build_report(p, week, settings_note="")
    from .scoring import current_problem

    cur_p = current_problem(rb)
    cur_raw = build_report(cur_p, cur_week, settings_note="")
    names = {**rb.carer_name, **{cid: ref for cid, ref in rb.client_ref.items() if ref}}

    sched = {c["id"]: c["scheduled_minutes"] for c in raw["carers"]}
    carers = []
    for c in raw["carers"]:
        issues = list(c.get("issues", [])) + list(rb.carer_notes.get(c["id"], []))
        carers.append(
            {
                "id": c["id"], "name": rb.carer_name.get(c["id"], c["id"]), "area": c["area"],
                "gender": c["gender"], "skills": c["skills"],
                "contracted_minutes": c["contracted_minutes"], "max_minutes": c["max_minutes"],
                "scheduled_minutes": c["scheduled_minutes"], "travel_minutes": c["travel_minutes"],
                "miles": c["miles"], "availability": c["availability"], "issues": issues,
                "travel_mode": c["travel_mode"],
            }
        )
    clients = [
        {"id": c["id"], "ref": rb.client_ref.get(c["id"], ""), "display_name": rb.client_display.get(c["id"], ""),
         "area": c["area"], "recent_carers": c["recent_carers"]}
        for c in raw["clients"]
    ]
    visits = []
    for v in raw["visits"]:
        meta = rb.visit_meta[v["id"]]
        cur = rb.current.get(v["id"], [])
        assigned = v["assigned"]
        moved = set(assigned) != set(cur) or (bool(assigned) and v["start"] != v["preferred_start"])
        reason, cause = v.get("unfilled_reason"), None
        if not assigned:
            cause, reason = unfilled_cause(rb, v["id"], sched, reason)
        visits.append(
            {
                "id": v["id"], "booking_id": meta.booking.booking_id, "client_id": v["client_id"],
                "day": v["day"], "preferred_start": v["preferred_start"], "window": v["window"],
                "duration": v["duration"], "carers_needed": v["carers_needed"], "kind": v["kind"],
                "booking_type": meta.booking.booking_type, "assigned": assigned, "start": v["start"],
                "current_assigned": cur, "moved": moved, "locked": meta.locked,
                "lock_reason": meta.lock_reason,
                "unfilled_reason": reason,
                "unfilled_cause": cause,
                "unfilled_detail": [_humanise(d, names) for d in v.get("unfilled_detail", [])],
                "override_suggestions": v.get("override_suggestions", []),
                "change_class": v.get("change_class"),
                "new_time_needed": v.get("new_time_needed"),
            }
        )
    report = {
        "week_start": raw["week_start"],
        "days": raw["days"],
        "metrics": {},  # filled by the caller
        "carers": carers,
        "clients": clients,
        "visits": visits,
        "routes": raw["routes"],
        "current_routes": cur_raw["routes"],
    }
    cur_report = {
        "carers": [
            {"id": c["id"], "scheduled_minutes": c["scheduled_minutes"], "travel_minutes": c["travel_minutes"],
             "miles": c["miles"], "availability": c["availability"],
             "contracted_minutes": c["contracted_minutes"]}
            for c in cur_raw["carers"]
        ],
        "clients": [{"id": c["id"], "recent_carers": c["recent_carers"]} for c in cur_raw["clients"]],
        "visits": [{"client_id": v["client_id"], "assigned": v["assigned"], "carers_needed": v["carers_needed"]}
                   for v in cur_raw["visits"]],
    }
    return report, raw, cur_report


# --------------------------------------------------------------------------- changes
def _carer_day_travel(week: list[DayResult], cid: str, day: int) -> int:
    res = week[day]
    return sum(st.travel_before for st in res.routes.get(cid, [])) + res.travel_home.get(cid, (0, 0.0))[0]


def _change_class(v: dict, tolerance: int) -> str:
    """The engine's own classification (docs/ROTA_ENGINE.md, "Change classes"); a minimal
    one only if the engine's report does not have it."""
    if v.get("change_class"):
        return v["change_class"]
    if not v["assigned"]:
        return "unchanged"
    if set(v["assigned"]) != set(v["current_assigned"]):
        return "carer"
    if v["start"] is not None and abs(v["start"] - v["preferred_start"]) > tolerance:
        return "time_note"
    return "unchanged"


def _not_allowed(
    rb: RegionBuild, visit_id: str, carer_id: str, week_minutes: dict[str, int],
    plan_minutes: dict[str, int] | None = None,
) -> tuple[str, bool] | None:
    """Why the current carer is moved off this visit, as (plain reason, forced by the rules), or
    None. Forced means the rules do not allow them on it. Over the weekly maximum is forced only
    if the carer would still be over it with this visit kept (their minutes in the plan plus this
    visit); otherwise it is only a reason."""
    p = rb.problem
    carer = p.carer_by_id.get(carer_id)
    if carer is None:
        return None
    visit = replace(p.visit_by_id[visit_id], locked_carers=[])
    why = carer_rule_failure(p, carer, visit)
    if why:
        if "do-not-send" in why:
            text = "current carer not allowed: do-not-send"
        elif why.startswith("barred"):
            text = "current carer not allowed: safeguarding bar"
        elif why.startswith("client needs"):
            text = "current carer not allowed: gender preference"
        elif why.startswith("missing skill"):
            text = f"current carer not allowed: {why}"
        elif why in ("on annual leave", "off sick", "absent"):
            text = "current carer on leave" if why != "off sick" else "current carer off sick"
        elif why.startswith("DBS"):
            text = "current carer not allowed: DBS expired"
        elif why.startswith("mandatory training"):
            text = "current carer not allowed: training expired"
        else:
            text = f"current carer not allowed: {why}"
        return text, True
    if not carer.availability:
        return "current carer not allowed: no working hours", True
    if not any(fits_block(visit, blk) for blk in carer.blocks_on(visit.day)):
        return "current carer not allowed: outside working hours", True
    if week_minutes.get(carer_id, 0) > carer.max_minutes_week:
        stays_over = plan_minutes is not None and plan_minutes.get(carer_id, 0) + visit.duration > carer.max_minutes_week
        if stays_over:
            return "current carer not allowed: over weekly maximum", True
        return "current carer over weekly maximum", False
    return None


def build_changes(
    build: Build, reports: dict[str, dict], weeks: dict[str, list[DayResult]],
    cur_weeks: dict[str, list[DayResult]], cur_reports: dict[str, dict],
) -> tuple[list[dict], list[dict]]:
    rbs = {rb.name: rb for rb in build.regions}
    rows: list[dict] = []
    notes: list[dict] = []
    for region, rep in reports.items():
        rb = rbs[region]
        tolerance = int(getattr(rb.problem.settings, "arrival_tolerance_minutes", 0) or 0)
        names = rb.carer_name
        refs = {c["id"]: c["ref"] for c in rep["clients"]}
        cur_minutes = {c["id"]: c["scheduled_minutes"] for c in cur_reports[region]["carers"]}
        plan_minutes = {c["id"]: c["scheduled_minutes"] for c in rep["carers"]}
        recent = {c["id"]: set(c["recent_carers"]) for c in rep["clients"]}
        cands = []
        for v in rep["visits"]:
            cls = _change_class(v, tolerance)
            if cls in ("carer", "time_with_change"):
                cands.append((v, cls))
        # carer-days touched by each change, so a day's travel saving is shared, not repeated
        touch: dict[tuple[str, int], int] = {}
        for v, _ in cands:
            for k in set(v["current_assigned"]) | set(v["assigned"]):
                touch[(k, v["day"])] = touch.get((k, v["day"]), 0) + 1
        for v, cls in cands:
            d = v["day"]
            saved = 0.0
            for k in set(v["current_assigned"]) | set(v["assigned"]):
                delta = _carer_day_travel(cur_weeks[region], k, d) - _carer_day_travel(weeks[region], k, d)
                saved += delta / touch[(k, d)]
            cur, new = v["current_assigned"], v["assigned"]
            carers_differ = set(cur) != set(new)
            needed = bool(v.get("new_time_needed")) if cls == "carer" else True
            if cls == "carer" and v.get("new_time_needed") is None and v["start"] is not None:
                needed = abs(v["start"] - v["preferred_start"]) > tolerance
            reasons: list[str] = []
            forced = False
            if carers_differ:
                for k in cur:
                    if k in new:
                        continue
                    res = _not_allowed(rb, v["id"], k, cur_minutes, plan_minutes)
                    if res and res[0] not in reasons:
                        reasons.append(res[0])
                        forced = forced or res[1]
                if not cur:
                    reasons.append("fills unallocated booking")
                if round(saved) >= 1:
                    reasons.append(f"saves {round(saved)} min travel")
                gained = [k for k in new if k not in cur]
                if gained and any(k in recent.get(v["client_id"], set()) for k in gained) and not all(
                    k in recent.get(v["client_id"], set()) for k in cur if k not in new
                ):
                    reasons.append("familiar carer")
                if cur and len(cur) == len(new) == 1 and cur_minutes.get(cur[0], 0) - cur_minutes.get(new[0], 0) >= 240:
                    reasons.append("evens hours")
                if not reasons:
                    reasons.append("lower overall cost in the plan")
            else:
                reasons.append("start moves to fit the other changes to this carer's day")
            meta = rb.visit_meta[v["id"]]
            rows.append(
                {
                    "booking_id": v["booking_id"], "client_ref": refs.get(v["client_id"], ""),
                    "date": meta.booking.day.isoformat(), "booked_start": clock(v["preferred_start"]),
                    "new_start": clock(v["start"]) if needed else None,
                    "from_carers": [names.get(k, k) for k in cur],
                    "to_carers": [names.get(k, k) for k in new],
                    "kind": "time_with_change" if needed else "carer",
                    "new_time_needed": needed,
                    "forced_by_rules": forced,
                    "reason": ", ".join(reasons[:3]),
                    "_sort": (meta.booking.day.isoformat(), v["preferred_start"], v["booking_id"]),
                }
            )
        for v in rep["visits"]:
            cls = _change_class(v, tolerance)
            if cls not in ("time_note", "time_within_tolerance") or v["start"] is None:
                continue
            meta = rb.visit_meta[v["id"]]
            shift = v["start"] - v["preferred_start"]
            how = f"{abs(shift)} min {'later' if shift > 0 else 'earlier'}"
            reason = (
                f"Same carer; {how} to fit the travel estimate. Check the gap."
                if cls == "time_note"
                else f"Same carer; {how}, within the {tolerance} min arrival tolerance. No change needed."
            )
            notes.append(
                {
                    "booking_id": v["booking_id"], "client_ref": refs.get(v["client_id"], ""),
                    "date": meta.booking.day.isoformat(),
                    "carer": " + ".join(names.get(k, k) for k in v["assigned"]),
                    "booked_start": clock(v["preferred_start"]), "new_start": clock(v["start"]),
                    "kind": cls, "reason": reason,
                    "_sort": (meta.booking.day.isoformat(), v["preferred_start"], v["booking_id"]),
                }
            )
    for lst in (rows, notes):
        lst.sort(key=lambda r: r["_sort"])
        for r in lst:
            del r["_sort"]
    return rows, notes


def change_summary(changes: list[dict], notes: list[dict]) -> dict:
    forced = sum(1 for c in changes if c["forced_by_rules"])
    fills = sum(1 for c in changes if not c["forced_by_rules"] and not c["from_carers"])
    return {
        "total": len(changes),
        "forced_by_rules": forced,
        "fills_unallocated": fills,
        "for_travel_continuity_hours": len(changes) - forced - fills,
        "new_time_needed": sum(1 for c in changes if c["new_time_needed"]),
        "time_notes": sum(1 for n in notes if n["kind"] == "time_note"),
        "time_within_tolerance": sum(1 for n in notes if n["kind"] == "time_within_tolerance"),
    }


# --------------------------------------------------------------------------- the result
def build_result(
    build: Build, weeks: dict[str, list[DayResult]], change_cost_pence: int
) -> dict:
    improve = build.mode == "improve"
    reports: dict[str, dict] = {}
    raws: dict[str, dict] = {}
    cur_reports: dict[str, dict] = {}
    cur_weeks: dict[str, list[DayResult]] = {}
    for rb in build.regions:
        _, cw = score_current(rb)
        cur_weeks[rb.name] = cw
        rep, raw, cur_rep = _region_report(rb, weeks[rb.name], cw)
        reports[rb.name] = rep
        raws[rb.name] = raw
        cur_reports[rb.name] = cur_rep

    total_moved = 0
    for name, rep in reports.items():
        moved = sum(1 for v in rep["visits"] if v["moved"])
        total_moved += moved
        m = contract_metrics([rep], moved)
        rep["metrics"] = {**{k: v for k, v in raws[name]["metrics"].items() if k not in m}, **m}
    comparison = {
        "engine": contract_metrics(list(reports.values()), total_moved),
        "current": contract_metrics(list(cur_reports.values()), 0),
    }

    changes: list[dict] = []
    time_notes: list[dict] = []
    if improve:
        changes, time_notes = build_changes(build, reports, weeks, cur_weeks, cur_reports)

    causes = {"rules": 0, "hours": 0, "weekly_max": 0, "travel_or_booked": 0}
    lost = 0
    cur_full = cur_ok = 0
    for rb in build.regions:
        for v in reports[rb.name]["visits"]:
            if v["unfilled_cause"]:
                causes[v["unfilled_cause"]] += 1
                lost += len(rb.current.get(v["id"], [])) >= v["carers_needed"]
        cp, cw = score_current(rb)
        f, k = feasible_current(rb, cp, cw)
        cur_full += f
        cur_ok += k
    fill_check = {
        "unfilled": sum(causes.values()),
        "because_rules": causes["rules"],
        "because_hours": causes["hours"],
        "because_weekly_max": causes["weekly_max"],
        "because_travel_or_booked": causes["travel_or_booked"],
        "unfilled_but_filled_in_current_rota": lost,
        "current_rota_fully_staffed": cur_full,
        "current_rota_feasible": cur_ok,
    }
    warnings = list(build.warnings)
    if fill_check["unfilled"] > 0:
        warnings.append({
            "code": "unallocated",
            "message": (
                f"{fill_check['unfilled']} booking(s) could not be allocated: "
                f"{causes['rules']} because no carer is allowed (rules or leave), "
                f"{causes['hours']} because too few carers work at that time, "
                f"{causes['weekly_max']} because of weekly maximums, "
                f"{causes['travel_or_booked']} because the carers who could do them are busy or too far away. "
                "See Unallocated bookings."),
        })
    if cur_full > cur_ok:
        warnings.append({
            "code": "current_rota_not_feasible",
            "message": (
                f"{cur_full - cur_ok} of the {cur_full} bookings the current rota fills break the engine's "
                "rules (skills, gender, do-not-send, leave, expired DBS or training, working hours) or cannot "
                "be reached in time (a carer double-booked, or too far from their previous visit). The engine "
                f"will not plan those, so only {cur_ok} of the current rota's fills are comparable "
                f"(fill_check). {lost} bookings are filled in the current rota but not in this plan."),
        })
    return {
        "mode": build.mode,
        "change_cost_pence": change_cost_pence if improve else None,
        "teams": reports,
        "comparison": comparison,
        "changes": changes,
        "change_summary": change_summary(changes, time_notes) if improve else None,
        "fill_check": fill_check,
        "time_notes": time_notes,
        "warnings": warnings,
    }


# --------------------------------------------------------------------------- exports
def allocation_csv(result: dict) -> str:
    rows: list[list] = [
        ["booking_id", "client_ref", "date", "start", "end", "booking_type", "team", "carer_1", "carer_2", "status"]
    ]
    for team, rep in result["teams"].items():
        names = {c["id"]: c["name"] for c in rep["carers"]}
        refs = {c["id"]: c["ref"] for c in rep["clients"]}
        week = rep["week_start"]
        from datetime import date

        monday = date.fromisoformat(week)
        for v in sorted(rep["visits"], key=lambda x: (x["day"], x["preferred_start"], x["booking_id"])):
            start = v["start"] if v["start"] is not None else v["preferred_start"]
            a = v["assigned"]
            rows.append(
                [
                    v["booking_id"], refs.get(v["client_id"], ""), (monday + timedelta(days=v["day"])).isoformat(),
                    clock(start), clock(start + v["duration"]), v["booking_type"], team,
                    names.get(a[0], a[0]) if len(a) > 0 else "", names.get(a[1], a[1]) if len(a) > 1 else "",
                    ("changed" if v["moved"] else "unchanged") if a else "unallocated",
                ]
            )
    return to_csv(rows)


def changes_csv(result: dict) -> str:
    rows: list[list] = [
        ["booking_id", "client_ref", "date", "booked_start", "new_start", "from_carers", "to_carers", "kind", "reason"]
    ]
    for x in result["changes"]:
        rows.append([x["booking_id"], x["client_ref"], x["date"], x["booked_start"], x["new_start"] or "",
                     "; ".join(x["from_carers"]), "; ".join(x["to_carers"]), x["kind"], x["reason"]])
    for x in result["time_notes"]:
        rows.append([x["booking_id"], x["client_ref"], x["date"], x["booked_start"], x["new_start"],
                     x["carer"], x["carer"], x["kind"], x["reason"]])
    return to_csv(rows)
