"""A fully made-up agency for tests, samples and the fake API mode. No real data anywhere.

Names are invented words so a test can check that none of them reaches a log or an error.
One week (Mon 2026-11-16 to Sun 2026-11-22), 3 teams (Leeds, Dorchester, Weymouth), 13
carers, 20 clients and about 150 visits. It produces:

- `fake_api_raw()`: the made-up CareLineLive API data (same JSON shape as the real API);
- `bookings_csv()`: a bookings CSV in the real CareLineLive optimised format (27 columns);
- `settings_dict()`: a settings file;
- `continuity_xlsx()`: a Continuity report.
"""

from __future__ import annotations

import csv
import io
import random
from dataclasses import dataclass, field
from datetime import date, timedelta
from functools import lru_cache

from .bookings import KNOWN_COLUMNS
from .settings_file import DEFAULT_AGENCY, DAYS

WEEK_START = date(2026, 11, 16)
TEAMS = {"T1": "Leeds", "T2": "Dorchester", "T3": "Weymouth"}
CENTRES = {"Leeds": (53.80, -1.55), "Dorchester": (50.715, -2.44), "Weymouth": (50.61, -2.455)}

CARER_FIRST = ["Bramble", "Corvin", "Dessa", "Fennick", "Galdor", "Hesper", "Ivo", "Jorun",
               "Kestrel", "Lowen", "Marrow", "Nimue", "Orla"]
CARER_LAST = ["Quillfeather", "Thistlewick", "Marblethorn", "Dunmorrow", "Pipkinsworth",
              "Fogbottom", "Larkspurt", "Wimbleby", "Crumpleton", "Snodgrassy", "Hobbleton",
              "Ravenscrofty", "Wickhamish"]
CLIENT_FIRST = ["Aldous", "Berta", "Cuthwin", "Dolly", "Egbert", "Fenella", "Gunnar", "Hilda",
                "Ignatz", "Jessamy", "Kipper", "Lettice", "Mortimer", "Nettie", "Osbert",
                "Pansy", "Quentin", "Rosamund", "Sigmund", "Tabitha"]
CLIENT_LAST = ["Fakeley", "Madeup", "Pretendy", "Notreal", "Imaginary", "Fictional", "Sampleton",
               "Dummerby", "Testwick", "Mockingby", "Phantomley", "Placeholder", "Inventson",
               "Fabricius", "Hypothetic", "Staged", "Mythwell", "Unreal", "Counterfeit", "Spoofington"]

BOOKING_TYPES = {
    # type: (earliest start, latest start, duration)
    "Morning Visit": (450, 540, 45),
    "Lunch Visit": (720, 780, 30),
    "Tea Visit": (990, 1050, 30),
    "Bed Visit": (1230, 1290, 30),
}
# The carer whose name is written differently in the bookings file (no automatic match)
NICKNAME_CARER = "K012"
# The carer written "Last First" in the bookings file (matched automatically)
REVERSED_CARER = "K005"


@dataclass
class FCarer:
    id: str
    first: str
    last: str
    team: str
    gender: str
    mode: str  # driving, walking, transit
    skills: list[str]
    home: tuple[float, float]
    hours: dict[str, list[dict]]
    weekly_max: float | None
    dbs: str | None
    training: str | None
    active: bool = True

    @property
    def name(self) -> str:
        return f"{self.first} {self.last}"


@dataclass
class FClient:
    id: str
    ref: str
    first: str
    last: str
    team: str
    loc: tuple[float, float] | None
    rules: dict = field(default_factory=dict)

    @property
    def name(self) -> str:
        return f"{self.first} {self.last}"


@dataclass
class FVisit:
    booking_id: str
    client: str
    day: int
    start: int
    duration: int
    booking_type: str
    expected: int
    carers: list[str]  # carer ids (the "current rota")
    cancelled: bool = False


def _w(start: str, end: str) -> list[dict]:
    return [{"start": start, "end": end}]


def _days(days: list[str], blocks: list[dict]) -> dict[str, list[dict]]:
    return {d: list(blocks) for d in days}


WEEKDAYS = DAYS[:5]


def _carers() -> list[FCarer]:
    def c(i, team, gender, mode, skills, home, hours, wmax, dbs, tr, active=True):
        return FCarer(f"K{i:03d}", CARER_FIRST[i - 1], CARER_LAST[i - 1], team, gender, mode,
                      skills, home, hours, wmax, dbs, tr, active)

    L, D, W = CENTRES["Leeds"], CENTRES["Dorchester"], CENTRES["Weymouth"]
    return [
        c(1, "Leeds", "female", "driving", ["medication", "hoist"], (L[0] + .01, L[1] - .02),
          _days(WEEKDAYS, _w("07:00", "14:00")), 35, "2027-06-30", "2027-03-31"),
        c(2, "Leeds", "female", "driving", ["medication"], (L[0] - .01, L[1] + .03),
          _days(DAYS[:6], _w("14:00", "22:30")), 30, "2027-01-31", "2027-05-31"),
        # training expired before the week: not planned, "expired" warning
        c(3, "Leeds", "female", "walking", ["medication", "hoist"], (L[0] + .02, L[1] + .01),
          _days(["mon", "tue", "thu", "sat", "sun"], _w("07:00", "13:30")), 28, "2028-02-28", "2026-11-01"),
        c(4, "Leeds", "male", "driving", ["medication"], (L[0] - .02, L[1] - .03),
          _days(DAYS[1:], _w("07:00", "22:00")), 40, "2027-08-31", "2027-02-28"),
        # night carer: Friday and Saturday 22:00 to 07:00
        c(5, "Leeds", "female", "driving", ["medication", "nights"], (L[0], L[1]),
          {"fri": _w("22:00", "07:00"), "sat": _w("22:00", "07:00"), "mon": _w("08:00", "16:00")}, 36,
          "2027-09-30", "2027-10-31"),
        c(6, "Leeds", "male", "transit", ["medication", "hoist"], (L[0] + .015, L[1] - .01),
          _days(DAYS, _w("08:00", "16:00")), 32, "2027-04-30", "2027-04-30"),
        c(7, "Dorchester", "female", "driving", ["medication", "hoist"], (D[0] + .01, D[1] - .02),
          _days(DAYS, _w("07:00", "13:00")), 37, "2027-11-30", "2027-04-30"),
        c(8, "Dorchester", "male", "driving", ["medication", "hoist"], (D[0] - .015, D[1] + .02),
          _days(WEEKDAYS, _w("08:00", "22:30")), 30, "2027-02-28", "2027-07-31"),
        c(9, "Dorchester", "female", "driving", ["medication", "hoist"], (D[0] + .02, D[1] + .03),
          _days(DAYS[3:], _w("07:00", "22:00")), 32, "2027-09-30", "2027-10-31"),
        # no DBS date: "no_dbs_date" warning, rule not checked
        c(10, "Weymouth", "female", "driving", ["medication"], (W[0] + .01, W[1] - .01),
          _days(["mon", "tue", "wed", "fri", "sat"], _w("08:00", "20:00")), 25, None, "2027-06-30"),
        c(11, "Weymouth", "male", "driving", ["medication", "hoist"], (W[0] - .01, W[1] + .015),
          _days(WEEKDAYS, _w("12:00", "22:00")), 30, "2027-05-31", "2027-05-31"),
        c(12, "Weymouth", "female", "driving", ["medication", "hoist"], (W[0] + .005, W[1] + .02),
          _days(["sat", "sun"], _w("07:00", "22:00")), 20, "2027-03-31", "2027-03-31"),
        # on the API list but with no working hours entered: "no_working_hours" warning
        c(13, "Leeds", "female", "driving", ["medication"], (L[0] + .03, L[1] + .03),
          {}, None, "2027-06-30", "2027-06-30"),
    ]


def _clients() -> list[FClient]:
    out = []
    plan = [("Leeds", 8), ("Dorchester", 7), ("Weymouth", 5)]
    n = 0
    rng = random.Random(11)
    for team, count in plan:
        cx, cy = CENTRES[team]
        for _ in range(count):
            n += 1
            loc = (cx + (rng.random() - .5) * .07, cy + (rng.random() - .5) * .09)
            out.append(FClient(f"C{n:02d}", f"CL-{n:03d}", CLIENT_FIRST[n - 1], CLIENT_LAST[n - 1],
                               team, None if n == 20 else loc))  # C20: no geocoded address
    by = {c.id: c for c in out}
    by["C03"].rules = {"gender_preference": "female"}
    by["C05"].rules = {"do_not_send": ["K002"]}
    by["C06"].rules = {"safeguarding_bar": ["K003"]}
    by["C04"].rules = {"required_skills": ["hoist"], "time_critical_booking_types": ["Morning Visit"]}
    by["C08"].rules = {"required_skills": ["nights"], "time_critical_booking_types": ["Waking Night"]}
    by["C10"].rules = {"gender_preference": "male"}
    by["C12"].rules = {"required_skills": ["hoist"], "time_critical_booking_types": ["Morning Visit"]}
    return out


def _plan(c: FClient) -> list[tuple[str, list[int], int]]:
    """(booking type, days, carers expected) for a client."""
    n = int(c.id[1:])
    weekdays, week = [0, 1, 2, 3, 4], list(range(7))
    if c.id == "C08":
        return [("Waking Night", [4, 5], 1), ("Tea Visit", week, 1)]
    if c.id in ("C04", "C12"):
        return [("Morning Visit", week, 2), ("Bed Visit", weekdays, 1)]
    plans = [
        [("Morning Visit", week, 1)],
        [("Morning Visit", week, 1), ("Bed Visit", week, 1)],
        [("Lunch Visit", week, 1), ("Tea Visit", weekdays, 1)],
        [("Tea Visit", week, 1)],
    ]
    return plans[n % 4]


@lru_cache(maxsize=1)
def agency() -> tuple[list[FCarer], list[FClient], list[FVisit]]:
    carers, clients = _carers(), _clients()
    rng = random.Random(20261116)
    visits: list[FVisit] = []
    k = 0
    for cl in clients:
        for btype, days, expected in _plan(cl):
            for day in days:
                k += 1
                if btype == "Waking Night":
                    start, dur = 22 * 60, 9 * 60
                else:
                    lo, hi, dur = BOOKING_TYPES[btype]
                    start = round((lo + rng.random() * (hi - lo)) / 5) * 5
                visits.append(FVisit(f"B{10000 + k}", cl.id, day, start, dur, btype, expected, []))
    # a current rota: someone from the team whose hours cover the visit, not optimised
    cmap = {c.id: c for c in carers}
    used: dict[tuple[str, int], int] = {}
    for v in visits:
        cl = next(c for c in clients if c.id == v.client)
        region = "Leeds" if cl.team == "Leeds" else "Weymouth"
        pool = []
        for c in carers:
            if (c.team == "Leeds") != (region == "Leeds") or c.id == "K013":
                continue
            for b in c.hours.get(DAYS[v.day], []):
                s, e = _m(b["start"]), _m(b["end"])
                e = e + 1440 if e <= s else e
                if s <= v.start and v.start + v.duration <= e:
                    pool.append(c.id)
        if v.booking_type == "Waking Night":
            pool = [p for p in pool if "nights" in cmap[p].skills]
        if rng.random() < .05 or len(pool) < v.expected:
            continue  # not yet allocated
        rng.shuffle(pool)
        v.carers = pool[: v.expected]
    # a visit booked for 1 carer but allocated 2, as seen in real data
    for v in visits:
        if v.expected == 1 and len(v.carers) == 1 and v.day == 2 and v.booking_type == "Tea Visit":
            pool = [c.id for c in carers if c.team == cmap[v.carers[0]].team and c.id not in v.carers and c.id != "K013"]
            if pool:
                v.carers.append(pool[0])
                break
    return carers, clients, visits


def _m(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def booking_name(c: FCarer) -> str:
    """How the carer is written in the bookings file."""
    if c.id == NICKNAME_CARER:
        return f"{c.first[:3]} {c.last}"  # nickname: does not match the API name
    if c.id == REVERSED_CARER:
        return f"{c.last} {c.first}"
    return c.name


# --------------------------------------------------------------------------- API
def fake_api_raw() -> dict:
    carers, clients, _ = agency()
    teams = [{"id": i, "attributes": {"name": n}} for i, n in TEAMS.items()]
    team_id = {n: i for i, n in TEAMS.items()}
    mode_id = {"driving": "TT1", "walking": "TT2", "transit": "TT3"}
    tts = [
        {"id": "TT1", "attributes": {"mode_of_transport": "driving"}},
        {"id": "TT2", "attributes": {"mode_of_transport": "walking"}},
        {"id": "TT3", "attributes": {"mode_of_transport": "transit"}},
    ]

    def geo(loc):
        if loc is None:
            return {"data": None}
        return {"data": {"id": "addr"}, "meta": {"geocoding": {"status": "success", "latitude": loc[0], "longitude": loc[1]}}}

    api_clients = [
        {
            "id": f"api-{c.id}",
            "attributes": {"reference_code": c.ref},
            "relationships": {"preferred_address": geo(c.loc), "default_team": {"data": {"id": team_id[c.team]}}},
        }
        for c in clients
    ]
    api_carers = [
        {
            "id": c.id,
            "attributes": {"primary_transport_type_id": mode_id[c.mode]},
            "meta": {"active": c.active},
            "relationships": {
                "person": {"attributes": {"first_name": c.first, "last_name": c.last,
                                          "preferred_name": c.first, "gender": c.gender[0].upper()}},
                "teams": {"data": [{"id": team_id[c.team]}]},
            },
        }
        for c in carers
    ]
    addresses = {
        c.id: [{"meta": {"geocoding": {"status": "success", "latitude": c.home[0], "longitude": c.home[1]}}}]
        for c in carers
    }
    leaves = [
        {"id": "L1", "attributes": {"carer_id": "K002", "start": "2026-11-18T00:00:00", "finish": "2026-11-19T00:00:00",
                                    "is_approved": True, "is_declined": False, "is_full_days": True}},
        {"id": "L2", "attributes": {"carer_id": "K008", "start": "2026-11-16T00:00:00", "finish": "2026-11-18T00:00:00",
                                    "is_approved": True, "is_declined": False, "is_full_days": True}},
        {"id": "L3", "attributes": {"carer_id": "K010", "start": "2026-11-20T00:00:00", "finish": "2026-11-21T00:00:00",
                                    "is_approved": False, "is_declined": False, "is_full_days": True}},
    ]
    return {"clients": api_clients, "carers": api_carers, "transport_types": tts, "teams": teams,
            "leaves": leaves, "carer_addresses": addresses}


def api_client_id(client_id: str) -> str:
    """The ClientId the bookings file uses for a fake client (matches the fake API)."""
    return f"api-{client_id}"


# --------------------------------------------------------------------------- bookings csv
def _hms(m: int) -> str:
    m %= 1440
    return f"{m // 60:02d}:{m % 60:02d}:00"


def bookings_csv(current_rota: bool = True) -> str:
    carers, clients, visits = agency()
    cmap = {c.id: c for c in carers}
    cl = {c.id: c for c in clients}
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(KNOWN_COLUMNS)
    rows = list(visits)
    for v in rows:
        c = cl[v.client]
        d = WEEK_START + timedelta(days=v.day)
        names = [booking_name(cmap[i]) for i in v.carers] if current_rota else []
        row = {
            "BookingId": v.booking_id, "ClientId": api_client_id(c.id), "Date": d.strftime("%d/%m/%Y"),
            "Start": _hms(v.start), "Finish": _hms(v.start + v.duration),
            "Duration": f"{v.duration // 60}:{v.duration % 60:02d}", "BookingType": v.booking_type,
            "ClientName": c.name, "ClientReferenceCode": c.ref, "ExpectedCarers": v.expected,
            "AllocatedCarers": len(names), "Carers": ", ".join(names), "IsCancelled": "No",
            "OriginalStart": _hms(v.start), "OriginalFinish": _hms(v.start + v.duration),
            "OriginalDuration": f"{v.duration // 60}:{v.duration % 60:02d}", "HasBeenInvoiced": "No",
            "ServiceContract": "Fake contract",
            "ServiceContractType": "Service Contract- Leeds" if c.team == "Leeds" else "Client Contract- Dorset",
            "Team": c.team,
        }
        w.writerow([row.get(col, "") for col in KNOWN_COLUMNS])
    # two cancelled bookings, to show the count
    for i, (cid, day, start) in enumerate([("C01", 2, 15 * 60), ("C09", 4, 12 * 60)]):
        c = cl[cid]
        d = WEEK_START + timedelta(days=day)
        row = {
            "BookingId": f"B19{i:03d}", "ClientId": api_client_id(c.id), "Date": d.strftime("%d/%m/%Y"),
            "Start": _hms(start), "Finish": _hms(start + 30), "Duration": "0:30", "BookingType": "Tea Visit",
            "ClientName": c.name, "ClientReferenceCode": c.ref, "ExpectedCarers": 1, "AllocatedCarers": 0,
            "IsCancelled": "Yes", "Team": c.team,
        }
        w.writerow([row.get(col, "") for col in KNOWN_COLUMNS])
    return buf.getvalue()


# --------------------------------------------------------------------------- schedule weeks
# Four past weeks of made-up bookings for learning client schedules, and a made-up client list.
SCHEDULE_WEEKS = [date(2026, 10, 26), date(2026, 11, 2), date(2026, 11, 9), date(2026, 11, 16)]
# (client, weekdays, start (minutes, varies by a minute or two), duration, type, carers, weeks it is in)
_PATTERN = [
    ("C01", [0, 1, 2, 3, 4], 8 * 60, 45, "Morning Visit", 1, "all"),      # weekly
    ("C02", [1], 12 * 60 + 30, 30, "Lunch Visit", 1, "all"),               # weekly, one day
    ("C02", [0, 2], 20 * 60 + 30, 30, "Bed Visit", 1, "all"),              # weekly, two days merged
    ("C03", [3], 16 * 60 + 30, 30, "Tea Visit", 1, (0, 2)),                # fortnightly, anchor week 0
    ("C04", [0, 1, 2, 3, 4, 5, 6], 8 * 60 + 15, 45, "Morning Visit", 2, "all"),  # weekly double-up
    ("C05", [0], 9 * 60, 30, "Morning Visit", 1, "all"),                   # weekly (a cancelled extra is ignored)
    ("C06", [2], 11 * 60, 30, "Lunch Visit", 1, "all"),                    # schedule changed in CareLineLive
    ("C07", [1], 15 * 60, 30, "Tea Visit", 1, "all"),                      # suspended
    ("C10", [0, 2, 4], 17 * 60, 30, "Tea Visit", 1, "all"),                # weekly, Dorchester team
    ("C09", [4], 14 * 60, 30, "Tea Visit", 1, (1,)),                       # a one-off (week 1 only)
]


def schedule_rows(week_index: int) -> list[dict]:
    """The made-up bookings of one of the SCHEDULE_WEEKS as dicts (cancelled ones flagged)."""
    cl = {c.id: c for c in agency()[1]}
    out = []
    for n, (cid, days, start, dur, btype, need, weeks) in enumerate(_PATTERN):
        if weeks != "all" and week_index not in weeks:
            continue
        for d in days:
            out.append({"client": cid, "date": SCHEDULE_WEEKS[week_index] + timedelta(days=d),
                        "start": start + (week_index * 7 + d) % 3 - 1,  # 07:59-08:01: rounds to 5 minutes
                        "duration": dur, "type": btype, "need": need, "cancelled": False, "n": n})
    out.append({"client": "C05", "date": SCHEDULE_WEEKS[week_index] + timedelta(days=1), "start": 9 * 60,
                "duration": 30, "type": "Morning Visit", "need": 1, "cancelled": True, "n": 99})
    return out


def rows_csv(rows: list[dict]) -> str:
    """Bookings CSV (the real 27-column layout) from schedule_rows-style dicts; no carers."""
    cl = {c.id: c for c in agency()[1]}
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(KNOWN_COLUMNS)
    for i, r in enumerate(rows):
        c = cl[r["client"]]
        row = {
            "BookingId": r.get("booking_id") or f"S{r['date']:%y%m%d}{r['client']}{i}",
            "ClientId": api_client_id(c.id), "Date": r["date"].strftime("%d/%m/%Y"),
            "Start": _hms(r["start"]), "Finish": _hms(r["start"] + r["duration"]),
            "Duration": f"{r['duration'] // 60}:{r['duration'] % 60:02d}", "BookingType": r["type"],
            "ClientName": c.name, "ClientReferenceCode": c.ref, "ExpectedCarers": r["need"],
            "AllocatedCarers": 0, "Carers": "", "IsCancelled": "Yes" if r["cancelled"] else "No",
            "Team": c.team,
        }
        w.writerow([row.get(col, "") for col in KNOWN_COLUMNS])
    return buf.getvalue()


def schedule_week_csv(week_index: int) -> str:
    return rows_csv(schedule_rows(week_index))


def client_list_csv() -> str:
    """Made-up CareLineLive client list: CL-006 changed its schedule after the first week, CL-007 is
    suspended, CL-008 had no bookings in the period."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(["ClientReferenceCode", "ClientName", "ClientDefaultTeam", "LastCompletedBooking",
                "LastScheduleUpdate", "ClientSuspended", "SuspensionReason"])
    for c in agency()[1]:
        update = {"CL-006": "12/11/2026"}.get(c.ref, "01/09/2026")
        w.writerow([c.ref, c.name, c.team, "15/11/2026", update, "Yes" if c.ref == "CL-007" else "No",
                    "Made-up reason" if c.ref == "CL-007" else ""])
    return buf.getvalue()


# --------------------------------------------------------------------------- settings
def settings_dict(all_matches: bool = True) -> dict:
    carers, clients, _ = agency()
    agency_s = dict(DEFAULT_AGENCY)
    agency_s["search_seconds_per_day"] = 10
    agency_s.pop("arrival_tolerance_minutes")  # like a file saved before the setting existed
    matches = []
    if all_matches:
        matches.append({"booking_name": booking_name(next(c for c in carers if c.id == NICKNAME_CARER)),
                        "carer_id": NICKNAME_CARER})
    return {
        "version": 1,
        "saved_at": None,
        "agency": agency_s,
        "carers": [
            {
                "id": c.id, "name": c.name, "teams": [c.team], "working_hours": c.hours,
                "weekly_max_hours": c.weekly_max, "skills": c.skills, "dbs_expiry": c.dbs,
                "training_expiry": c.training, "active": c.active, "available_any_time": True,
            }
            for c in carers
        ],
        "clients": [
            {
                "id": api_client_id(c.id), "ref": c.ref, "team": c.team,
                "gender_preference": c.rules.get("gender_preference"),
                "do_not_send": c.rules.get("do_not_send", []),
                "safeguarding_bar": c.rules.get("safeguarding_bar", []),
                "required_skills": c.rules.get("required_skills", []),
                "time_critical_booking_types": c.rules.get("time_critical_booking_types", []),
            }
            for c in clients
        ],
        "carer_name_matches": matches,
    }


# --------------------------------------------------------------------------- continuity
def continuity_xlsx() -> bytes:
    """A Continuity report in the layout the service reads: sheet "Continuity", client name
    on the first row of each group, carer name in column 2, share in column 4."""
    import openpyxl

    carers, clients, visits = agency()
    cmap = {c.id: c for c in carers}
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Continuity"
    ws.append(["Client", "Carer", "Visits", "Continuity %"])
    for cl in clients:
        seen: dict[str, int] = {}
        for v in visits:
            if v.client == cl.id:
                for k in v.carers:
                    seen[k] = seen.get(k, 0) + 1
        top = sorted(seen.items(), key=lambda kv: -kv[1])[:3]
        total = sum(n for _, n in top) or 1
        for i, (k, n) in enumerate(top):
            ws.append([cl.name if i == 0 else None, cmap[k].name, n, round(100 * n / total, 1)])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def write_files(out_dir: str) -> list[str]:
    """Write bookings.csv, settings.json and continuity.xlsx (all made up) into a folder."""
    import json
    from pathlib import Path

    p = Path(out_dir)
    p.mkdir(parents=True, exist_ok=True)
    (p / "bookings.csv").write_text(bookings_csv(), encoding="utf-8", newline="")
    (p / "settings.json").write_text(json.dumps(settings_dict(), indent=2), encoding="utf-8")
    (p / "continuity.xlsx").write_bytes(continuity_xlsx())
    return ["bookings.csv", "settings.json", "continuity.xlsx"]


if __name__ == "__main__":
    import sys

    print("wrote", ", ".join(write_files(sys.argv[1] if len(sys.argv) > 1 else "fake_files")))
