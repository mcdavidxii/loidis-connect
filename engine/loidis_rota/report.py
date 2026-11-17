"""Turn a solved week into the JSON the viewer reads, with plain-language explanations."""

from __future__ import annotations

from datetime import datetime, timezone

from .models import DAYS, Problem, Visit, hhmm
from .rules import DO_NOT_SEND, carer_rule_failure, fits_block
from .solver import DayResult
from .travel import travel_minutes


def _unfilled_detail(problem: Problem, day: DayResult, visit: Visit, limit: int = 3) -> list[str]:
    """Nearest carers who pass every rule and are working, and what stopped each one."""
    client = problem.client_by_id[visit.client_id]
    out = []
    candidates = []
    for carer in problem.carers:
        if carer_rule_failure(problem, carer, visit):
            continue
        if not any(fits_block(visit, b) for b in carer.blocks_on(visit.day)):
            continue
        candidates.append((travel_minutes(carer.home, client.location, carer.travel_mode), carer))
    candidates.sort(key=lambda x: x[0])
    for _, carer in candidates[:limit]:
        busy = [
            st
            for st in day.routes.get(carer.id, [])
            if st.start < visit.latest + visit.duration and st.end > visit.earliest
        ]
        if busy:
            st = busy[0]
            other = next(v for v in problem.visits if v.id == st.visit_id)
            out.append(
                f"{carer.id} busy {hhmm(st.start)}–{hhmm(st.end)} with {other.client_id}"
            )
        else:
            out.append(f"{carer.id} free but cannot reach in time between other visits")
    return out


def _override_suggestions(problem: Problem, day: DayResult, visit: Visit) -> list[str]:
    """Carers blocked only by the client's do-not-send list who are working and free.

    These are suggestions for the coordinator; the planner never books them. Carers on
    a safeguarding bar are never suggested.
    """
    out = []
    for carer in problem.carers:
        if carer_rule_failure(problem, carer, visit) != DO_NOT_SEND:
            continue
        if carer_rule_failure(problem, carer, visit, ignore_do_not_send=True):
            continue
        if not any(fits_block(visit, b) for b in carer.blocks_on(visit.day)):
            continue
        busy = any(
            st.start < visit.latest + visit.duration and st.end > visit.earliest
            for st in day.routes.get(carer.id, [])
        )
        if not busy:
            out.append(carer.id)
    return out


def build_report(problem: Problem, week: list[DayResult], settings_note: str = "") -> dict:
    s = problem.settings
    visit_by_id = {v.id: v for v in problem.visits}

    # --- per visit ---------------------------------------------------------------------
    visits_out = []
    for v in problem.visits:
        day = week[v.day]
        item = {
            "id": v.id,
            "client_id": v.client_id,
            "day": v.day,
            "preferred_start": v.start,
            "window": v.window,
            "duration": v.duration,
            "carers_needed": v.carers_needed,
            "skills": v.required_skills,
            "kind": v.kind,
            "assigned": day.assigned.get(v.id, []),
            "start": day.starts.get(v.id),
        }
        if v.id in day.unfilled:
            item["unfilled_reason"] = day.unfilled[v.id]
            item["unfilled_detail"] = _unfilled_detail(problem, day, v)
            item["override_suggestions"] = _override_suggestions(problem, day, v)
        visits_out.append(item)

    # --- per carer -----------------------------------------------------------------------
    routes_out: dict[str, dict[str, list]] = {}
    carers_out = []
    for c in problem.carers:
        care = travel = sleep_ins = 0
        mi = 0.0
        days = {}
        for d, res in enumerate(week):
            stops = res.routes.get(c.id, [])
            if not stops:
                continue
            home_t, home_mi = res.travel_home.get(c.id, (0, 0.0))
            days[DAYS[d]] = [
                {
                    "visit_id": st.visit_id,
                    "client_id": visit_by_id[st.visit_id].client_id,
                    "start": st.start,
                    "end": st.end,
                    "travel_before": st.travel_before,
                    "miles_before": st.miles_before,
                    "shared_with": [x for x in res.assigned[st.visit_id] if x != c.id],
                }
                for st in stops
            ]
            care += sum(problem.counted_minutes(visit_by_id[st.visit_id]) for st in stops)
            sleep_ins += sum(1 for st in stops if visit_by_id[st.visit_id].kind == "sleep_in")
            travel += sum(st.travel_before for st in stops) + home_t
            mi += sum(st.miles_before for st in stops) + home_mi
        routes_out[c.id] = days

        issues = []
        start, end = problem.week_start, problem.date_of(6)
        if c.dbs_expiry < start:
            issues.append(f"DBS check expired {c.dbs_expiry.isoformat()}")
        elif c.dbs_expiry <= end:
            issues.append(f"DBS check expires {c.dbs_expiry.isoformat()}")
        if c.training_expiry < start:
            issues.append(f"Mandatory training expired {c.training_expiry.isoformat()}")
        elif c.training_expiry <= end:
            issues.append(f"Mandatory training expires {c.training_expiry.isoformat()}")
        absences = [{"day": a.day, "type": a.type} for a in problem.absences if a.carer_id == c.id]

        carers_out.append(
            {
                "id": c.id,
                "area": c.area,
                "travel_mode": c.travel_mode,
                "gender": c.gender,
                "skills": c.skills,
                "home": {"lat": c.home.lat, "lon": c.home.lon},
                "contracted_minutes": c.contracted_minutes_week,
                "max_minutes": c.max_minutes_week,
                "scheduled_minutes": care,
                "sleep_ins": sleep_ins,
                "travel_minutes": travel,
                "miles": round(mi, 1),
                "mileage_pence": int(round(mi * s.mileage_pence_per_mile)) if c.travel_mode == "car" else 0,
                "availability": [{"day": b.day, "start": b.start, "end": b.end} for b in c.availability],
                "absences": absences,
                "issues": issues,
            }
        )

    # --- per client ----------------------------------------------------------------------
    clients_out = []
    for cl in problem.clients:
        mine = [v for v in problem.visits if v.client_id == cl.id and v.kind == "care"]
        nights = [v for v in problem.visits if v.client_id == cl.id and v.kind == "sleep_in"]
        scheduled = sum(v.duration for v in mine if v.id in week[v.day].assigned)
        clients_out.append(
            {
                "id": cl.id,
                "area": cl.area,
                "location": {"lat": cl.location.lat, "lon": cl.location.lon},
                "funder": cl.funder,
                "gender_preference": cl.gender_preference,
                "do_not_send": cl.do_not_send,
                "recent_carers": cl.recent_carers,
                "commissioned_minutes": cl.commissioned_minutes_week,
                "scheduled_minutes": scheduled,
                "gap_minutes": cl.commissioned_minutes_week - scheduled,
                "sleep_ins_needed": len(nights),
                "sleep_ins_covered": sum(1 for v in nights if v.id in week[v.day].assigned),
            }
        )

    # --- shortfall by day and hour (where extra carers are needed) -------------------
    shortfall: dict[tuple[int, int], int] = {}
    for v in problem.visits:
        if v.id in week[v.day].unfilled:
            key = (v.day, (v.start // 60) % 24)
            shortfall[key] = shortfall.get(key, 0) + v.duration * v.carers_needed

    # --- totals ----------------------------------------------------------------------------
    filled = [v for v in problem.visits if v.id in week[v.day].assigned]
    continuity_hits = continuity_total = 0
    for v in filled:
        for cid in week[v.day].assigned[v.id]:
            continuity_total += 1
            continuity_hits += cid in problem.client_by_id[v.client_id].recent_carers
    shifts = [abs(week[v.day].starts[v.id] - v.start) for v in filled if v.id in week[v.day].starts]
    total_miles = sum(c["miles"] for c in carers_out)
    metrics = {
        "visits": len(problem.visits),
        "filled": len(filled),
        "unfilled": len(problem.visits) - len(filled),
        "fill_rate": round(len(filled) / max(1, len(problem.visits)), 3),
        "care_hours": round(sum(c["scheduled_minutes"] for c in carers_out) / 60, 1),
        "travel_hours": round(sum(c["travel_minutes"] for c in carers_out) / 60, 1),
        "miles": round(total_miles, 1),
        "mileage_pounds": round(sum(c["mileage_pence"] for c in carers_out) / 100, 2),
        "continuity_rate": round(continuity_hits / max(1, continuity_total), 3),
        "visits_shifted": sum(1 for x in shifts if x),
        "mean_abs_shift_minutes": round(sum(shifts) / max(1, len(shifts)), 1),
        "max_abs_shift_minutes": max(shifts, default=0),
        "clients_short": sum(1 for c in clients_out if c["gap_minutes"] > 0),
        "sleep_ins": sum(1 for v in problem.visits if v.kind == "sleep_in"),
        "sleep_ins_filled": sum(
            1 for v in filled if v.kind == "sleep_in"
        ),
    }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "week_start": problem.week_start.isoformat(),
        "days": DAYS,
        "settings": {**s.__dict__},
        "note": settings_note,
        "metrics": metrics,
        "carers": carers_out,
        "clients": clients_out,
        "visits": visits_out,
        "routes": routes_out,
        "shortfall": [
            {"day": d, "hour": h, "minutes": m} for (d, h), m in sorted(shortfall.items())
        ],
    }
