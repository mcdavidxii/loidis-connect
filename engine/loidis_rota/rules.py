"""Must-have rules: which carers may do which visit.

Every check returns a short reason when it fails, so unfilled visits can be explained.
"""

from __future__ import annotations

from .models import Block, Carer, Client, Problem, Visit


def fits_block(visit: Visit, block: Block) -> bool:
    """True if the visit can start inside its window and finish inside the block."""
    if block.day != visit.day:
        return False
    start = max(visit.earliest, block.start)
    return start <= visit.latest and start + visit.duration <= block.end


def carer_rule_failure(problem: Problem, carer: Carer, visit: Visit) -> str | None:
    """Reason this carer can never do this visit (ignoring availability), or None."""
    client: Client = problem.client_by_id[visit.client_id]
    when = problem.date_of(visit.day)
    absence = problem.absence(carer.id, visit.day)
    if absence:
        return {"sick": "off sick", "annual_leave": "on annual leave"}.get(absence.type, "absent")
    if carer.dbs_expiry < when:
        return "DBS check expired"
    if carer.training_expiry < when:
        return "mandatory training expired"
    missing = set(visit.required_skills) - set(carer.skills)
    if missing:
        return "missing skill: " + ", ".join(sorted(missing))
    if client.gender_preference and carer.gender != client.gender_preference:
        return f"client needs a {client.gender_preference} carer"
    if carer.id in client.do_not_send:
        return "on client's do-not-send list"
    if visit.locked_carers and carer.id not in visit.locked_carers:
        return "visit locked to other carers"
    return None


def eligible_blocks(problem: Problem, carer: Carer, visit: Visit) -> list[Block]:
    if carer_rule_failure(problem, carer, visit):
        return []
    return [b for b in carer.blocks_on(visit.day) if fits_block(visit, b)]


def explain_unfilled(problem: Problem, visit: Visit) -> str:
    """Plain-language reason a visit could not be filled."""
    reasons: dict[str, int] = {}
    rule_ok = []
    for carer in problem.carers:
        why = carer_rule_failure(problem, carer, visit)
        if why:
            reasons[why] = reasons.get(why, 0) + 1
        else:
            rule_ok.append(carer)

    available = [c for c in rule_ok if any(fits_block(visit, b) for b in c.blocks_on(visit.day))]
    need = visit.carers_needed

    if not rule_ok:
        top = max(reasons, key=reasons.get)
        return f"No suitable carer at all (most common: {top})"
    if len(available) < need:
        return (
            f"{len(rule_ok)} suitable carer(s), but only {len(available)} working "
            f"at this time (need {need})"
        )
    return (
        f"{len(available)} suitable carer(s) working, but all are booked "
        f"or too far away at this time"
    )
