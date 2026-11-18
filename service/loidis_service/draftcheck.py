"""Final check of a draft against the real week.

The draft is the allocation.csv exported from a run made from client schedules. Each real booking
is matched to a draft row by client + date + start (within 15 minutes) + booking type. The client
column of the export is the client's display name ("Surname, I"), or the reference code when no
name was known, so a booking matches on either. Matched rows give the real booking its
`current_carers` (improve mode then starts from the draft plan).

Nothing here is logged or put in an error beyond counts and column names.
"""

from __future__ import annotations

import csv
import io
from datetime import date

from .bookings import Booking, _clock, _date, short_client_name
from .errors import ServiceError

TOLERANCE_MIN = 15
NEEDED = ["Date", "Carer", "Start", "End", "Client", "Booking type"]
_DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _hhmm(m: int) -> str:
    m %= 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def _norm(s: str) -> str:
    return " ".join((s or "").lower().split())


def parse_draft(data: bytes) -> list[dict]:
    """One entry per draft visit: client (as exported), date, start, end, booking type, carers."""
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    if len(rows) < 2:
        raise ServiceError("The draft file has no rows.", 422)
    col = {h.strip(): i for i, h in enumerate(rows[0])}
    missing = [c for c in NEEDED if c not in col]
    if missing:
        raise ServiceError(
            f"Columns not found in the draft file: {', '.join(missing)}. Use the allocation.csv exported from the draft.", 422)

    def cell(r: list[str], name: str) -> str:
        i = col.get(name)
        return r[i].strip() if i is not None and i < len(r) else ""

    out: dict[tuple, dict] = {}
    bad = 0
    for r in rows[1:]:
        d, s, e = _date(cell(r, "Date")), _clock(cell(r, "Start")), _clock(cell(r, "End"))
        if d is None or s is None or e is None:
            bad += 1
            continue
        client, btype = cell(r, "Client"), cell(r, "Booking type")
        key = (_norm(client), d, s, _norm(btype))
        row = out.setdefault(key, {"client": client, "date": d, "start": s, "end": e, "booking_type": btype, "carers": []})
        carer = cell(r, "Carer")
        if carer and carer.lower() != "unallocated" and carer not in row["carers"]:
            row["carers"].append(carer)
    if bad:
        raise ServiceError(f"{bad} row(s) in the draft file have a Date, Start or End that is not readable.", 422)
    if not out:
        raise ServiceError("The draft file has no rows.", 422)
    return list(out.values())


def apply_draft(bookings: list[Booking], draft_rows: list[dict]) -> dict:
    """Match the live bookings to the draft, set the carers of matched bookings to the draft's
    (in place), and return the `draft_check` object."""
    live = [b for b in bookings if not b.cancelled]

    def names_of(b: Booking) -> set[str]:
        return {_norm(b.client_ref), _norm(short_client_name(b.client_name))} - {""}

    free = list(range(len(draft_rows)))
    matched: list[tuple[Booking, dict]] = []
    unmatched: list[Booking] = []
    # pass 1: same client, date and type, start within the tolerance (nearest first)
    for b in sorted(live, key=lambda b: (b.day, b.start, b.booking_id)):
        cands = [i for i in free
                 if _norm(draft_rows[i]["client"]) in names_of(b) and draft_rows[i]["date"] == b.day
                 and _norm(draft_rows[i]["booking_type"]) == _norm(b.booking_type)
                 and abs(draft_rows[i]["start"] - b.start) <= TOLERANCE_MIN]
        if cands:
            i = min(cands, key=lambda i: abs(draft_rows[i]["start"] - b.start))
            free.remove(i)
            matched.append((b, draft_rows[i]))
        else:
            unmatched.append(b)
    # pass 2: same client, date and type but a start further away: retimed
    retimed_pairs: list[tuple[Booking, dict]] = []
    added: list[Booking] = []
    for b in unmatched:
        cands = [i for i in free
                 if _norm(draft_rows[i]["client"]) in names_of(b) and draft_rows[i]["date"] == b.day
                 and _norm(draft_rows[i]["booking_type"]) == _norm(b.booking_type)]
        if cands:
            i = min(cands, key=lambda i: abs(draft_rows[i]["start"] - b.start))
            free.remove(i)
            retimed_pairs.append((b, draft_rows[i]))
        else:
            added.append(b)
    for b, row in matched + retimed_pairs:
        b.carer_names = list(row["carers"])

    def label(b: Booking) -> str:
        return short_client_name(b.client_name) or b.client_ref

    def when(d: date) -> str:
        return f"{_DAY[d.weekday()]} {d.strftime('%d/%m/%Y')}"

    out_added = [{
        "client": label(b), "client_ref": b.client_ref, "date": b.day.isoformat(), "start": _hhmm(b.start),
        "end": _hhmm(b.start + b.duration), "booking_type": b.booking_type,
        "summary": f"In the real week but not in the draft: {label(b)}, {when(b.day)}, "
                   f"{_hhmm(b.start)}–{_hhmm(b.start + b.duration)}, {b.booking_type}.",
    } for b in sorted(added, key=lambda b: (b.day, b.start, b.booking_id))]
    out_removed = [{
        "client": draft_rows[i]["client"], "client_ref": "", "date": draft_rows[i]["date"].isoformat(),
        "start": _hhmm(draft_rows[i]["start"]), "end": _hhmm(draft_rows[i]["end"]),
        "booking_type": draft_rows[i]["booking_type"],
        "summary": f"In the draft but not in the real week: {draft_rows[i]['client']}, {when(draft_rows[i]['date'])}, "
                   f"{_hhmm(draft_rows[i]['start'])}–{_hhmm(draft_rows[i]['end'])}, {draft_rows[i]['booking_type']}.",
    } for i in sorted(free, key=lambda i: (draft_rows[i]["date"], draft_rows[i]["start"], draft_rows[i]["client"]))]
    out_retimed = []
    for b, row in sorted(retimed_pairs, key=lambda p: (p[0].day, p[0].start, p[0].booking_id)):
        diff = b.start - row["start"]
        out_retimed.append({
            "client": label(b), "client_ref": b.client_ref, "date": b.day.isoformat(), "start": _hhmm(b.start),
            "end": _hhmm(b.start + b.duration), "draft_start": _hhmm(row["start"]),
            "booking_type": b.booking_type,
            "summary": f"{label(b)}, {b.booking_type} on {when(b.day)}: the draft had {_hhmm(row['start'])}, the real "
                       f"booking starts at {_hhmm(b.start)} ({abs(diff)} min {'later' if diff > 0 else 'earlier'}).",
        })
    total = len(live)
    summary = (f"{len(matched)} of {total} bookings in the real week match the draft; "
               f"{len(out_added)} not in the draft, {len(out_removed)} in the draft but not in the real week, "
               f"{len(out_retimed)} at a different time.")
    return {
        "matched": len(matched), "added": out_added, "removed": out_removed, "retimed": out_retimed,
        "tolerance_minutes": TOLERANCE_MIN, "summary": summary,
    }
