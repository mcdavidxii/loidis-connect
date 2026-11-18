"""The bookings CSV from CareLineLive (Reports > Bookings, the optimised CSV option).

27 columns: BookingId, ClientId, Date (dd/mm/yyyy), Start, Finish (hh:mm:ss), Duration
(h:mm), ConfirmedDuration, DurationVarianceSeconds, BookingType, ClientName,
ClientReferenceCode, ExpectedCarers, AllocatedCarers, Carers (names, comma-separated for
double-ups), Status, CarerNotes, IsCancelled, CancellationReason, CancellationCharged,
OriginalStart, OriginalFinish, OriginalDuration, HasBeenInvoiced, ServiceContract,
ServiceContractType, Unplanned, Team.

Validation messages give counts and column names only, never cell values.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from .errors import ServiceError

KNOWN_COLUMNS = [
    "BookingId", "ClientId", "Date", "Start", "Finish", "Duration", "ConfirmedDuration",
    "DurationVarianceSeconds", "BookingType", "ClientName", "ClientReferenceCode",
    "ExpectedCarers", "AllocatedCarers", "Carers", "Status", "CarerNotes", "IsCancelled",
    "CancellationReason", "CancellationCharged", "OriginalStart", "OriginalFinish",
    "OriginalDuration", "HasBeenInvoiced", "ServiceContract", "ServiceContractType",
    "Unplanned", "Team",
]
REQUIRED_COLUMNS = [
    "BookingId", "ClientId", "Date", "Start", "Duration", "BookingType",
    "ClientReferenceCode", "ExpectedCarers", "Carers", "IsCancelled", "Team",
]


def _key(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


_CANON = {_key(c): c for c in KNOWN_COLUMNS}


@dataclass
class Booking:
    row: int
    booking_id: str
    client_id: str
    client_ref: str
    client_name: str
    day: date
    start: int  # minutes after midnight
    duration: int  # minutes
    booking_type: str
    expected: int
    carer_names: list[str]
    teams: list[str]
    cancelled: bool
    generated: bool = False  # made from a client schedule: no CareLineLive booking exists yet

    @property
    def team(self) -> str:
        return self.teams[0] if self.teams else ""


@dataclass
class BookingsInfo:
    rows: int = 0
    visits: int = 0
    clients: int = 0
    carers: int = 0
    double_ups: int = 0
    cancelled: int = 0
    unallocated: int = 0
    week_start: date | None = None
    problems: list[str] = field(default_factory=list)  # block a run
    notes: list[str] = field(default_factory=list)  # worth knowing, do not block

    def to_dict(self) -> dict:
        d = {
            k: getattr(self, k)
            for k in (
                "rows", "visits", "clients", "carers", "double_ups", "cancelled",
                "unallocated", "problems", "notes",
            )
        }
        d["week_start"] = self.week_start.isoformat() if self.week_start else None
        return d


def _date(s: str) -> date | None:
    s = s.strip().split(" ")[0]
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    return None


def _clock(s: str) -> int | None:
    m = re.fullmatch(r"\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*", s or "")
    if not m:
        return None
    h, mi = int(m[1]), int(m[2])
    return h * 60 + mi if mi < 60 else None


def _duration(s: str) -> int | None:
    m = re.fullmatch(r"\s*(\d+):(\d{2})(?::\d{2})?\s*", s or "")
    return int(m[1]) * 60 + int(m[2]) if m else None


_TITLES = {"mr", "mrs", "miss", "ms", "dr", "mx", "master", "sir", "lady", "rev", "prof"}


def short_client_name(full: str) -> str:
    """"Surname, I" for the coordinator's screens, from "First Last", "Last, First" or with a
    title (Mr, Mrs, Miss, Ms, Dr...). Shown only in the result sent to the web app: never
    logged and never put in an error message."""
    text = re.sub(r"\s+", " ", (full or "").strip())
    if not text:
        return ""
    if "," in text:
        sur, _, rest = text.partition(",")
        words = rest.split()
    else:
        parts = text.split()
        sur, words = (parts[-1], parts[:-1]) if len(parts) > 1 else (parts[0], [])
    words = [w for w in words if w.strip(".").lower() not in _TITLES]
    sur_words = [w for w in sur.split() if w.strip(".").lower() not in _TITLES]
    sur = " ".join(sur_words) or sur
    return f"{sur}, {words[0][0].upper()}" if words else sur


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def split_names(cell: str) -> list[str]:
    return [x.strip() for x in re.split(r"[;,]", cell or "") if x.strip()]


def parse_bookings(data: bytes, allow_many_weeks: bool = False) -> tuple[list[Booking], BookingsInfo]:
    """Parse and validate. Returns every usable row (cancelled ones flagged) and the checks.

    Problems are recorded in the info; call `require_valid` to raise on them. A file normally
    holds one week; `allow_many_weeks` (learning client schedules) lets it hold several."""
    info = BookingsInfo()
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    if len(rows) < 2:
        info.problems.append("The bookings file has no booking rows.")
        return [], info

    col: dict[str, int] = {}
    unknown = 0
    for i, h in enumerate(rows[0]):
        canon = _CANON.get(_key(h))
        if canon is None:
            unknown += 1
        elif canon not in col:
            col[canon] = i
    missing = [c for c in REQUIRED_COLUMNS if c not in col]
    if unknown:
        info.notes.append(
            f"{unknown} column(s) in the bookings file are not recognised and were ignored."
        )
    if missing:
        info.problems.append(
            f"Columns not found in the bookings file: {', '.join(missing)}. "
            "Use the bookings CSV export from Reports > Bookings."
        )
        return [], info

    def cell(r: list[str], name: str) -> str:
        i = col.get(name)
        return r[i].strip() if i is not None and i < len(r) else ""

    out: list[Booking] = []
    bad_date = bad_start = bad_dur = missing_id = dup = bad_expected = 0
    seen: set[str] = set()
    for n, r in enumerate(rows[1:], start=2):
        info.rows += 1
        bid = cell(r, "BookingId")
        d = _date(cell(r, "Date"))
        start = _clock(cell(r, "Start"))
        dur = _duration(cell(r, "Duration"))
        if dur is None:
            fin = _clock(cell(r, "Finish"))
            if fin is not None and start is not None:
                dur = (fin - start) % 1440 or None
        cancelled = cell(r, "IsCancelled").lower() in {"yes", "true", "1", "y", "cancelled"}
        if not bid:
            missing_id += 1
        elif bid in seen:
            dup += 1
        seen.add(bid)
        if d is None:
            bad_date += 1
        if start is None:
            bad_start += 1
        if (dur is None or dur <= 0) and not cancelled:
            bad_dur += 1
        try:
            expected = int(float(cell(r, "ExpectedCarers") or 1))
            if expected < 1:
                raise ValueError
        except ValueError:
            expected = 1
            bad_expected += 1
        if d is None or start is None:
            continue
        out.append(
            Booking(
                row=n, booking_id=bid, client_id=cell(r, "ClientId"),
                client_ref=cell(r, "ClientReferenceCode"), client_name=cell(r, "ClientName"),
                day=d, start=start, duration=dur or 0, booking_type=cell(r, "BookingType"),
                expected=expected, carer_names=split_names(cell(r, "Carers")),
                teams=[t.strip() for t in cell(r, "Team").split(",") if t.strip()],
                cancelled=cancelled,
            )
        )

    if missing_id:
        info.problems.append(f"{missing_id} row(s) have no BookingId.")
    if dup:
        info.problems.append(f"{dup} row(s) repeat a BookingId.")
    if bad_date:
        info.problems.append(f"{bad_date} row(s) have a Date that is not dd/mm/yyyy.")
    if bad_start:
        info.problems.append(f"{bad_start} row(s) have a Start that is not hh:mm:ss.")
    if bad_dur:
        info.problems.append(f"{bad_dur} row(s) have a Duration that is not h:mm.")
    if bad_expected:
        info.notes.append(f"{bad_expected} row(s) have no usable ExpectedCarers; 1 was assumed.")

    # Bookings with no client at all (e.g. "Office" time) are not client visits: leave them out
    # with a note rather than refusing the file.
    no_client = sum(1 for b in out if not b.client_id and not b.client_ref and not b.client_name)
    if no_client:
        out = [b for b in out if b.client_id or b.client_ref or b.client_name]
        info.notes.append(
            f"{no_client} booking(s) without a client (for example office time) were left out."
        )
    live = [b for b in out if not b.cancelled]
    unmatched_client = sum(1 for b in live if not b.client_id)
    if unmatched_client:
        info.problems.append(f"{unmatched_client} row(s) name a client but have no ClientId.")
    info.cancelled = sum(1 for b in out if b.cancelled)
    info.visits = len(live)
    info.clients = len({b.client_id for b in live})
    info.carers = len({n for b in live for n in b.carer_names})
    info.double_ups = sum(1 for b in live if b.expected >= 2)
    info.unallocated = sum(1 for b in live if not b.carer_names)
    weeks = {monday_of(b.day) for b in live}
    if len(weeks) > 1 and allow_many_weeks:
        info.week_start = min(weeks)
    elif len(weeks) > 1:
        info.problems.append(
            f"The bookings cover {len(weeks)} different weeks; upload one week (Monday to Sunday)."
        )
    elif weeks:
        info.week_start = next(iter(weeks))
    if not live and not info.problems:
        info.problems.append("The bookings file has no live (not cancelled) bookings.")
    return out, info


def require_valid(data: bytes, allow_many_weeks: bool = False) -> tuple[list[Booking], BookingsInfo]:
    bookings, info = parse_bookings(data, allow_many_weeks)
    if info.problems:
        raise ServiceError(" ".join(info.problems), 422)
    return bookings, info
