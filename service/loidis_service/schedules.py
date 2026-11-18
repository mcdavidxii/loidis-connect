"""Client schedules: learned from past bookings, kept in the settings file, turned into the
visits of a draft week (docs/ENGINE_API.md, "Client schedules").

CareLineLive has no API or export for client schedule entries, so the service learns them from
bookings CSVs of past weeks; the coordinator confirms them. Nothing here is stored or logged:
logs and errors carry counts only.
"""

from __future__ import annotations

import csv
import io
import logging
import re
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from .bookings import Booking, _date, monday_of, require_valid, short_client_name
from .errors import ServiceError
from .settings_file import DAYS, ClientSchedule, ScheduleVisit, SettingsFile

log = logging.getLogger("loidis_service")

ROUND_MIN = 5
DRAFT_NOTICE = "Draft from client schedules – bookings for this week are not generated in CareLineLive yet."


def _key(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _truthy(s: str) -> bool:
    return (s or "").strip().lower() in {"yes", "true", "1", "y", "suspended"}


def hhmm(minutes: int) -> str:
    m = minutes % 1440
    return f"{m // 60:02d}:{m % 60:02d}"


_DAYNAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
SLOT_MIN = 30  # a booking belongs to a slot if its start is within this many minutes of the slot's median


def _mode(values: list[int]) -> int:
    """Most common value; ties go to the larger one."""
    c: dict[int, int] = defaultdict(int)
    for v in values:
        c[v] += 1
    return max(c, key=lambda v: (c[v], v))


def _cluster(items: list[Booking]) -> list[list[Booking]]:
    """Greedy by start time: a booking joins the current slot while its start is within SLOT_MIN of the
    slot's median start, else it starts a new slot."""
    out: list[list[Booking]] = []
    for b in sorted(items, key=lambda b: (b.start, b.day)):
        if out and abs(b.start - statistics.median([x.start for x in out[-1]])) <= SLOT_MIN:
            out[-1].append(b)
        else:
            out.append([b])
    return out


def _uk(d: date) -> str:
    return d.strftime("%d/%m/%Y")


# --------------------------------------------------------------------------- client list
def parse_client_list(data: bytes) -> list[dict]:
    """The CareLineLive client CSV: ClientReferenceCode (required), ClientName, ClientDefaultTeam,
    LastCompletedBooking, LastScheduleUpdate, ClientSuspended, SuspensionReason."""
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    if len(rows) < 2:
        raise ServiceError("The client list has no rows.", 422)
    col = {_key(h): i for i, h in enumerate(rows[0])}
    if "clientreferencecode" not in col:
        raise ServiceError("Columns not found in the client list: ClientReferenceCode.", 422)

    def cell(r: list[str], name: str) -> str:
        i = col.get(_key(name))
        return r[i].strip() if i is not None and i < len(r) else ""

    out = []
    for r in rows[1:]:
        ref = cell(r, "ClientReferenceCode")
        if not ref:
            continue
        out.append({
            "ref": ref, "name": cell(r, "ClientName"), "team": cell(r, "ClientDefaultTeam"),
            "last_booking": _date(cell(r, "LastCompletedBooking")) if cell(r, "LastCompletedBooking") else None,
            "last_update": _date(cell(r, "LastScheduleUpdate")) if cell(r, "LastScheduleUpdate") else None,
            "suspended": _truthy(cell(r, "ClientSuspended")),
        })
    if not out:
        raise ServiceError("The client list has no rows with a ClientReferenceCode.", 422)
    return out


# --------------------------------------------------------------------------- learning
def _combine(files: list[bytes]) -> list[Booking]:
    seen: set[str] = set()
    live: list[Booking] = []
    for n, data in enumerate(files, 1):
        try:
            rows, _ = require_valid(data, allow_many_weeks=True)
        except ServiceError as e:
            if len(files) > 1:
                raise ServiceError(f"Bookings file {n}: {e.message}", e.status) from None
            raise
        for b in rows:
            if b.cancelled or b.booking_id in seen:
                continue
            seen.add(b.booking_id)
            live.append(b)
    return live


def learn(files: list[bytes], client_list: bytes | None, settings: SettingsFile | None) -> dict:
    live = _combine(files)
    if not live:
        raise ServiceError("The bookings files have no live (not cancelled) bookings.", 422)
    weeks = sorted({monday_of(b.day) for b in live})
    n_weeks = len(weeks)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    by_client: dict[str, list[Booking]] = defaultdict(list)
    for b in live:
        by_client[b.client_id].append(b)

    schedules: dict[str, dict] = {}
    one_offs: list[dict] = []
    counts = {"weekly": 0, "fortnightly": 0, "visits": 0}
    irregular = 0
    period_changes: list[dict] = []
    display: dict[str, str] = {}
    refs: dict[str, str] = {}

    for cid, bs in sorted(by_client.items()):
        refs[cid] = next((b.client_ref for b in bs if b.client_ref), "")
        display[cid] = short_client_name(next((b.client_name for b in bs if b.client_name), "")) or refs[cid]
        base_c = {"client_id": cid, "client_ref": refs[cid], "display_name": display[cid]}
        merged: dict[tuple, dict] = {}
        by_slot: dict[tuple[int, str], list[Booking]] = defaultdict(list)
        for b in bs:
            by_slot[(b.day.weekday(), b.booking_type)].append(b)
        for (wd, btype), items in sorted(by_slot.items()):
            slots = _cluster(items)
            infos = []
            for sl in slots:
                present: dict[date, list[date]] = defaultdict(list)
                for b in sl:
                    present[monday_of(b.day)].append(b.day)
                starts = sorted(b.start for b in sl)
                med = statistics.median(starts)
                start = (int(round(med / ROUND_MIN)) * ROUND_MIN) % 1440
                dur = _mode([b.duration for b in sl])
                need = _mode([b.expected for b in sl])
                infos.append((sl, present, start, dur, need))
            # a slot that moved by more than 30 minutes inside the period: its earlier and later
            # clusters share no week (counts only; the flag text has times, not names)
            for i, (_, pa, sa, *_r) in enumerate(infos):
                for _, pb, sb, *_r2 in infos[i + 1:]:
                    if max(pa) < min(pb) or max(pb) < min(pa):
                        (ea, sa_), (la, sb_) = ((pa, sa), (pb, sb)) if max(pa) < min(pb) else ((pb, sb), (pa, sa))
                        if len(la) >= 2:
                            text = (f"{_DAYNAME[wd]} {btype}: the usual time moved from {hhmm(sa_)} to "
                                    f"{hhmm(sb_)} during the weeks supplied – check their visits")
                        else:
                            wk0 = min(la)
                            text = (f"{_DAYNAME[wd]} {btype}: at {hhmm(sb_)} instead of the usual {hhmm(sa_)} in the "
                                    f"week of {wk0.strftime('%d/%m')} – a one-off or a new time? Check their visits")
                        period_changes.append({**base_c, "kind": "changed_in_period", "detail": text})
            for i, (sl, present, start, dur, need) in enumerate(infos):
                pw = sorted(present)
                # a later slot that shares no week with this one replaced it (a time change inside the
                # period): keep only the later slot, and drop this one without listing it as irregular
                # (only if the later slot is in 2 or more weeks; a single later week is a one-off)
                if any(min(q[1]) > max(present) and len(q[1]) >= 2 for q in infos if q is not infos[i]):
                    continue
                earlier = any(max(q[1]) < min(present) for q in infos if q is not infos[i])
                replaced = earlier and len(pw) >= 2
                single_later = earlier and len(pw) < 2
                # a slot that replaced an earlier one is judged on the weeks since it started
                wk = [w for w in weeks if w >= pw[0]] if replaced else weeks
                repeat, anchor = None, None
                # fortnightly: 4+ weeks counted, in 2+ weeks all the same parity and none of the other
                if single_later:
                    pass  # one week at a new time after a regular one: listed, not added
                elif (len(wk) >= 4 and len(pw) >= 2 and all((w - pw[0]).days % 14 == 0 for w in pw)):
                    repeat, anchor = "fortnightly", pw[0]
                elif len(pw) * 2 >= len(wk):  # at least half the weeks counted (rounded up)
                    repeat = "weekly"
                if repeat is None:
                    irregular += 1
                    for b in sorted(sl, key=lambda b: (b.day, b.start)):
                        one_offs.append({
                            **base_c, "date": b.day.isoformat(), "start": hhmm(round(b.start / ROUND_MIN) * ROUND_MIN),
                            "duration_min": b.duration, "booking_type": btype,
                            "detail": "Happened in fewer than half of the weeks supplied, so it was not added."})
                    continue
                m = merged.setdefault((start, dur, btype, need, repeat, anchor), {"days": set()})
                m["days"].add(wd)
        visits: list[ScheduleVisit] = []
        for i, ((start, dur, btype, need, repeat, anchor), m) in enumerate(
                sorted(merged.items(), key=lambda kv: (min(kv[1]["days"]), kv[0][0], kv[0][2])), 1):
            visits.append(ScheduleVisit(
                id=f"v{i}", days=[DAYS[d] for d in sorted(m["days"])], start=hhmm(start), duration_min=dur,
                booking_type=btype, carers_needed=need, repeat=repeat, fortnight_anchor=anchor))
            counts[repeat] += 1
        if visits:
            sc = ClientSchedule(client_ref=refs[cid], confirmed=False, learned_from=[w.isoformat() for w in weeks],
                                updated_at=now, visits=visits)
            schedules[cid] = {**sc.to_dict(), "display_name": display[cid]}
            counts["visits"] += len(visits)
    one_offs.sort(key=lambda o: (o["date"], o["start"], o["client_id"]))

    flags: list[dict] = list(period_changes)
    if client_list:
        ref_to_id = {r: c for c, r in refs.items() if r}
        if settings:
            for sc_ in settings.clients:
                if sc_.ref:
                    ref_to_id.setdefault(sc_.ref, sc_.id)
        for row in parse_client_list(client_list):
            cid = ref_to_id.get(row["ref"], row["ref"])
            name = short_client_name(row["name"]) or display.get(cid) or row["ref"]
            display.setdefault(cid, name)
            base = {"client_id": cid, "client_ref": row["ref"], "display_name": name}
            if row["suspended"]:
                flags.append({**base, "kind": "suspended",
                              "detail": "Suspended in CareLineLive – check before using their schedule."})
            elif cid not in by_client:
                flags.append({**base, "kind": "no_bookings_in_period",
                              "detail": "No bookings in the weeks supplied, so no schedule was learned."})
            if row["last_update"] and row["last_update"] > weeks[0]:
                flags.append({**base, "kind": "changed",
                              "detail": f"Schedule changed in CareLineLive on {_uk(row['last_update'])} – check their visits"})
    log.info("learn weeks=%d bookings=%d schedules=%d irregular=%d changed_in_period=%d flags=%d",
             n_weeks, len(live), len(schedules), irregular, len(period_changes), len(flags))
    return {
        "weeks": [w.isoformat() for w in weeks],
        "schedules": schedules,
        "one_offs": one_offs,
        "flags": flags,
        "counts": {
            "weeks": n_weeks, "bookings": len(live), "clients": len(by_client), "schedules": len(schedules),
            "visits": counts["visits"], "weekly": counts["weekly"], "fortnightly": counts["fortnightly"],
            "one_offs": len(one_offs), "irregular": irregular, "changed_in_period": len(period_changes),
            "flags": len(flags),
        },
    }


# --------------------------------------------------------------------------- generating a draft week
def scheduled_bookings(
    settings: SettingsFile, week_start: date, suspended_refs: set[str] | None = None,
    names: dict[str, str] | None = None,
) -> tuple[list[Booking], dict]:
    """The visits of a draft week from the confirmed client schedules, as Booking objects (not
    cancelled, no carers, `generated` True, a synthetic booking id). Info: unconfirmed (clients
    whose schedule is not confirmed), suspended (clients with a schedule left out), the ids of
    clients with any schedule entry."""
    suspended_refs = suspended_refs or set()
    names = names or {}
    refs_by_id = {c.id: c.ref for c in settings.clients}
    out: list[Booking] = []
    unconfirmed = suspended = 0
    suspended_ids: set[str] = set()
    for cid, sc in sorted(settings.client_schedules.items()):
        ref = sc.client_ref or refs_by_id.get(cid, "")
        if ref and ref in suspended_refs:
            suspended += 1
            suspended_ids.add(cid)
            continue
        if not sc.confirmed:
            unconfirmed += 1
            continue
        team = (settings.client(cid).team if settings.client(cid) else "") or ""
        seen: set[str] = set()
        for i, v in enumerate(sc.visits, 1):
            if not v.happens_in(week_start):
                continue
            h, m = v.start.split(":")
            start = int(h) * 60 + int(m)
            for d in v.days:
                day = week_start + timedelta(days=DAYS.index(d))
                bid = f"DRAFT-{cid}-{v.id}-{d}"
                if bid in seen:
                    bid = f"DRAFT-{cid}-{v.id}{i}-{d}"
                seen.add(bid)
                out.append(Booking(
                    row=0, booking_id=bid, client_id=cid, client_ref=ref, client_name=names.get(ref, ""),
                    day=day, start=start, duration=v.duration_min, booking_type=v.booking_type,
                    expected=v.carers_needed, carer_names=[], teams=[team] if team else [], cancelled=False,
                    generated=True))
    info = {
        "unconfirmed": unconfirmed, "suspended": suspended, "suspended_ids": suspended_ids,
        "clients_with_schedule": set(settings.client_schedules),
    }
    return out, info
