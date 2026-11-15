"""Core data types for the rota engine.

Times are minutes after midnight. Days are 0 (Monday) to 6 (Sunday).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


@dataclass(frozen=True)
class Location:
    lat: float
    lon: float


@dataclass
class Client:
    id: str
    area: str
    location: Location
    commissioned_minutes_week: int
    funder: str  # "council" or "private"
    female_carer_only: bool = False
    do_not_send: list[str] = field(default_factory=list)
    recent_carers: list[str] = field(default_factory=list)


@dataclass
class Block:
    """A period a carer is available on one day."""

    day: int
    start: int
    end: int


@dataclass
class Carer:
    id: str
    area: str
    home: Location
    travel_mode: str  # "car", "foot" or "bus"
    skills: list[str]
    gender: str
    contracted_minutes_week: int
    max_minutes_week: int
    dbs_expiry: date
    training_expiry: date
    availability: list[Block] = field(default_factory=list)

    def blocks_on(self, day: int) -> list[Block]:
        return [b for b in self.availability if b.day == day]


@dataclass
class Visit:
    id: str
    client_id: str
    day: int
    start: int  # preferred start
    window: int  # start may move this many minutes either way
    duration: int
    carers_needed: int = 1
    required_skills: list[str] = field(default_factory=list)
    locked_carers: list[str] = field(default_factory=list)

    @property
    def earliest(self) -> int:
        return self.start - self.window

    @property
    def latest(self) -> int:
        return self.start + self.window


@dataclass
class Problem:
    week_start: date
    clients: list[Client]
    carers: list[Carer]
    visits: list[Visit]

    def __post_init__(self) -> None:
        self.client_by_id = {c.id: c for c in self.clients}
        self.carer_by_id = {c.id: c for c in self.carers}

    def date_of(self, day: int) -> date:
        return self.week_start + timedelta(days=day)

    # --- serialisation -------------------------------------------------------

    def to_dict(self) -> dict:
        def enc(obj):
            d = asdict(obj)
            for k, v in d.items():
                if isinstance(v, date):
                    d[k] = v.isoformat()
            return d

        return {
            "week_start": self.week_start.isoformat(),
            "clients": [enc(c) for c in self.clients],
            "carers": [enc(c) for c in self.carers],
            "visits": [enc(v) for v in self.visits],
        }

    @staticmethod
    def from_dict(d: dict) -> "Problem":
        clients = [
            Client(**{**c, "location": Location(**c["location"])}) for c in d["clients"]
        ]
        carers = [
            Carer(
                **{
                    **c,
                    "home": Location(**c["home"]),
                    "dbs_expiry": date.fromisoformat(c["dbs_expiry"]),
                    "training_expiry": date.fromisoformat(c["training_expiry"]),
                    "availability": [Block(**b) for b in c["availability"]],
                }
            )
            for c in d["carers"]
        ]
        visits = [Visit(**v) for v in d["visits"]]
        return Problem(date.fromisoformat(d["week_start"]), clients, carers, visits)


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"
