"""Generate a realistic, entirely made-up home care agency around Weymouth.

No real people or addresses: locations are random points near town centres, and IDs
are generated. Use this to develop and demo the engine before real data is available.
"""

from __future__ import annotations

import math
import random
from datetime import date, timedelta

from .models import Absence, Block, Carer, Client, Location, Problem, Visit
from .travel import distance_km

# (name, centre lat, centre lon, radius km, share of clients)
AREAS = [
    ("Weymouth", 50.6139, -2.4570, 2.2, 0.40),
    ("Portland", 50.5480, -2.4410, 1.8, 0.18),
    ("Dorchester", 50.7150, -2.4370, 1.8, 0.20),
    ("Chickerell", 50.6230, -2.5050, 1.0, 0.10),
    ("Preston", 50.6420, -2.4180, 1.2, 0.12),
]

# Visit slots: (name, preferred start range, typical durations)
SLOTS = {
    "morning": ((7 * 60 + 30, 9 * 60 + 30), [30, 45, 45, 60]),
    "lunch": ((12 * 60, 13 * 60 + 15), [30, 30, 45]),
    "tea": ((16 * 60 + 30, 17 * 60 + 45), [30, 30, 45]),
    "bed": ((19 * 60 + 30, 21 * 60), [30, 30, 45]),
}

PACKAGES = [
    (0.20, ["morning", "lunch", "tea", "bed"]),
    (0.25, ["morning", "lunch", "bed"]),
    (0.15, ["morning", "tea"]),
    (0.15, ["morning", "bed"]),
    (0.25, ["morning"]),
]

SHIFTS = [
    (0.35, [(7 * 60, 14 * 60 + 30)]),  # earlies
    (0.25, [(16 * 60, 22 * 60)]),  # lates
    (0.30, [(7 * 60, 13 * 60 + 30), (16 * 60 + 30, 21 * 60 + 45)]),  # split shift
    (0.10, [(7 * 60, 21 * 60 + 45)]),  # long day
]


def _pick(rng: random.Random, weighted):
    r = rng.random()
    acc = 0.0
    for w, item in weighted:
        acc += w
        if r <= acc:
            return item
    return weighted[-1][1]


def _point(rng: random.Random, area) -> Location:
    _, lat, lon, radius_km, _ = area
    # random point in a disc; 1 deg lat ~ 111 km, 1 deg lon ~ 70 km at this latitude
    r = radius_km * rng.random() ** 0.5
    angle = rng.random() * 6.283185
    return Location(
        round(lat + r * 0.0090 * math.sin(angle), 5),
        round(lon + r * 0.0143 * math.cos(angle), 5),
    )


def _round5(m: int) -> int:
    return int(round(m / 5) * 5)


def generate(
    seed: int = 7,
    n_clients: int = 60,
    n_carers: int = 38,
    week_start: date = date(2026, 11, 16),
) -> Problem:
    rng = random.Random(seed)
    area_weights = [(a[4], a) for a in AREAS]

    # --- carers -----------------------------------------------------------------
    carers: list[Carer] = []
    for i in range(1, n_carers + 1):
        mode = _pick(rng, [(0.70, "car"), (0.18, "foot"), (0.12, "bus")])
        if mode == "car":
            area = _pick(rng, area_weights)
        else:  # non-drivers live in the bigger towns
            area = _pick(rng, [(0.6, AREAS[0]), (0.25, AREAS[1]), (0.15, AREAS[2])])
        skills = []
        if rng.random() < 0.85:
            skills.append("medication")
        if rng.random() < 0.60:
            skills.append("hoist")
        contracted = rng.choice([16, 20, 24, 30, 30, 37.5])
        cid = f"K{i:03d}"

        # availability: 5 working days, fewer at weekends
        days_off = set(rng.sample(range(7), 2))
        shift = _pick(rng, SHIFTS)
        blocks = [
            Block(day, s, e) for day in range(7) if day not in days_off for s, e in shift
        ]

        carers.append(
            Carer(
                id=cid,
                area=area[0],
                home=_point(rng, area),
                travel_mode=mode,
                skills=skills,
                gender="female" if rng.random() < 0.85 else "male",
                contracted_minutes_week=int(contracted * 60),
                max_minutes_week=int(min(contracted + 10, 48) * 60),
                dbs_expiry=week_start + timedelta(days=rng.randint(60, 900)),
                training_expiry=week_start + timedelta(days=rng.randint(30, 400)),
                availability=blocks,
            )
        )

    # Compliance examples so the screens can show them
    carers[4].dbs_expiry = week_start - timedelta(days=10)  # expired before the week
    carers[9].training_expiry = week_start + timedelta(days=2)  # expires mid-week

    # --- clients and their weekly visit patterns ---------------------------------
    clients: list[Client] = []
    visits: list[Visit] = []
    vcount = 0
    for i in range(1, n_clients + 1):
        area = _pick(rng, area_weights)
        loc = _point(rng, area)
        package = _pick(rng, PACKAGES)
        double_up = rng.random() < 0.13
        needs_meds = rng.random() < 0.55
        time_critical = needs_meds and rng.random() < 0.10
        r = rng.random()
        days = list(range(7)) if r < 0.75 else ([0, 1, 2, 3, 4] if r < 0.9 else [0, 2, 4])

        cid = f"C{i:03d}"
        pattern = []
        for slot in package:
            (lo, hi), durs = SLOTS[slot]
            start = _round5(rng.randint(lo, hi))
            dur = rng.choice(durs)
            if double_up and slot in ("morning", "bed"):
                dur = max(dur, 45)
            pattern.append((slot, start, dur))

        weekly = 0
        for day in days:
            for slot, start, dur in pattern:
                vcount += 1
                two = double_up and slot in ("morning", "bed")
                skills = []
                if two:
                    skills.append("hoist")
                if needs_meds and slot in ("morning", "bed"):
                    skills.append("medication")
                window = 15 if (time_critical and slot == "morning") else 30
                if slot == "lunch" and not needs_meds:
                    window = 45
                visits.append(
                    Visit(
                        id=f"V{vcount:05d}",
                        client_id=cid,
                        day=day,
                        start=start,
                        window=window,
                        duration=dur,
                        carers_needed=2 if two else 1,
                        required_skills=skills,
                    )
                )
                weekly += dur

        clients.append(
            Client(
                id=cid,
                area=area[0],
                location=loc,
                commissioned_minutes_week=weekly,
                funder="council" if rng.random() < 0.7 else "private",
                gender_preference=_pick(rng, [(0.18, "female"), (0.03, "male"), (0.79, None)]),
            )
        )

    # do-not-send lists and recent carers (for continuity), chosen from nearby carers
    for client in clients:
        nearby = sorted(carers, key=lambda c: distance_km(c.home, client.location))
        if rng.random() < 0.06:
            client.do_not_send = [rng.choice(nearby[:6]).id]
        options = [c for c in nearby[:10] if c.id not in client.do_not_send]
        if client.gender_preference:
            options = [c for c in options if c.gender == client.gender_preference]
        client.recent_carers = [c.id for c in options[: rng.randint(2, 4)]]

    # --- night shifts: two clients with sleep-in nights, four carers who do nights ----
    night_start, night_end = 22 * 60, 31 * 60  # 22:00 to 07:00 next morning
    night_carers = carers[-4:]
    for carer in night_carers:
        carer.skills = sorted(set(carer.skills) | {"nights"})
        nights = set(rng.sample(range(7), 4))
        carer.availability = [b for b in carer.availability if b.day not in nights]
        carer.availability += [Block(d, night_start - 30, night_end + 30) for d in sorted(nights)]
    for client in rng.sample(clients, 2):
        for day in range(7):
            vcount += 1
            visits.append(
                Visit(
                    id=f"V{vcount:05d}",
                    client_id=client.id,
                    day=day,
                    start=night_start,
                    window=0,
                    duration=night_end - night_start,
                    required_skills=["nights"],
                )
            )
            client.commissioned_minutes_week += night_end - night_start
        client.recent_carers = [c.id for c in night_carers[:2]]

    # --- leave and sickness ----------------------------------------------------------
    absences = []
    for carer in rng.sample(carers[:-4], 2):  # a week of annual leave
        absences += [Absence(carer.id, d, "annual_leave") for d in range(7)]
    sick = rng.choice(carers[:-4])
    absences += [Absence(sick.id, d, "sick") for d in (2, 3)]

    return Problem(week_start, clients, carers, visits, absences)
