"""Core data types for the rota engine.

Times are minutes after midnight of the visit's day; values past 1440 run into the
next morning (night shifts). Days are 0 (Monday) to 6 (Sunday).
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
    gender_preference: str | None = None  # "female" or "male" if the client requires it
    do_not_send: list[str] = field(default_factory=list)  # never booked; may be suggested
    safeguarding_bar: list[str] = field(default_factory=list)  # never booked or suggested
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
    kind: str = "care"  # "care" or "sleep_in"
    # carers on this visit in the coordinator's current rota (improve mode); empty = unallocated
    current_carers: list[str] = field(default_factory=list)

    @property
    def earliest(self) -> int:
        return self.start - self.window

    @property
    def latest(self) -> int:
        return self.start + self.window


@dataclass
class Absence:
    """A whole day a carer cannot work."""

    carer_id: str
    day: int
    type: str  # "annual_leave", "sick" or "training"


@dataclass
class Settings:
    """Costs and limits the engine balances. All money in pence. Values are assumptions
    to confirm with Loidis."""

    pay_pence_per_hour: int = 1271  # assumed carer hourly pay; used to cost travel time
    travel_time_paid: bool = True
    mileage_pence_per_mile: int = 45  # paid to car drivers
    continuity_penalty_pence: int = 60  # tie-breaker: travel and hours matter more (Loidis)
    under_target_pence_per_min: int = 21  # unused contracted time is paid anyway (~pay rate)
    over_contract_pence_per_min: int = 15  # carer beyond contracted hours
    # minutes a sleep-in counts towards carer hours; None = its full length, as
    # CareLineLive's rota does (sleep-in pay is a payroll question, handled later)
    sleep_in_counted_minutes: int | None = None
    rest_after_sleep_in_minutes: int = 11 * 60  # rest before the next shift (to confirm)
    # pence per minute a visit starts away from its booked (preferred) start; 0 = moving
    # inside the visit's window is free
    shift_pence_per_min: int = 0
    # improve mode: pence charged per carer slot filled by someone not in the visit's
    # current_carers; 0 = ignore the current allocation (plan from scratch)
    change_pence_per_visit: int = 0
    # improve mode, reporting only (the solver ignores it): a visit whose carer is unchanged
    # and whose start moves by at most this many minutes is a note, not a change to apply;
    # 0 = any shift counts. Placeholder to confirm with the coordinator / contracts.
    arrival_tolerance_minutes: int = 0
    unfilled_penalty: int = 10_000_000


def _default_travel():
    from .travel import EstimateTravel  # imported here: travel imports this module

    return EstimateTravel()


@dataclass
class Problem:
    week_start: date
    clients: list[Client]
    carers: list[Carer]
    visits: list[Visit]
    absences: list[Absence] = field(default_factory=list)
    settings: Settings = field(default_factory=Settings)
    # travel times and distances; default is the estimate. Not saved in the Problem JSON.
    travel: TravelProvider = field(default_factory=_default_travel, repr=False, compare=False)

    def __post_init__(self) -> None:
        self.client_by_id = {c.id: c for c in self.clients}
        self.carer_by_id = {c.id: c for c in self.carers}
        self.visit_by_id = {v.id: v for v in self.visits}

    def counted_minutes(self, visit: Visit) -> int:
        """Minutes a visit counts towards a carer's hours."""
        if visit.kind == "sleep_in" and self.settings.sleep_in_counted_minutes is not None:
            return self.settings.sleep_in_counted_minutes
        return visit.duration

    def absence(self, carer_id: str, day: int) -> Absence | None:
        for a in self.absences:
            if a.carer_id == carer_id and a.day == day:
                return a
        return None

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
            "absences": [enc(a) for a in self.absences],
            "settings": enc(self.settings),
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
        absences = [Absence(**a) for a in d.get("absences", [])]
        settings = Settings(**d.get("settings", {}))
        return Problem(
            date.fromisoformat(d["week_start"]), clients, carers, visits, absences, settings
        )


def hhmm(minutes: int) -> str:
    """Clock time; times past midnight get a "+1" (night shifts)."""
    suffix = "+1" if minutes >= 24 * 60 else ""
    minutes %= 24 * 60
    return f"{minutes // 60:02d}:{minutes % 60:02d}{suffix}"
