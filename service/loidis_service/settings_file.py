"""The settings file (docs/ENGINE_API.md, "Settings file"): read, validate, write, and the
warnings for rules that cannot be checked because an input is missing.

The file holds personal data. Error messages give counts and field names, never values.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date

from .config import DEFAULT_TEAM_REGIONS
from .errors import ServiceError

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

DEFAULT_AGENCY = {
    "move_window_minutes": 30,
    "move_cost_pence_per_min": 15,
    "continuity_weight_pence": 1000,
    "hours_balance": "equal_share_within_team",
    "search_seconds_per_day": 10,  # Quick; the UI also offers 30 (Thorough); any 1-120 is valid
    "change_cost_pence": 1000,
    "pay_pence_per_hour": None,
    "mileage_pence_per_mile": None,
    "travel_time_paid": None,
    # added by the service (docs/ENGINE_API.md): which planning region each team belongs to
    "team_regions": dict(DEFAULT_TEAM_REGIONS),
    # added by the service: a start time that moves by no more than this is a note, not a change.
    # 15 is a placeholder to confirm with the coordinator.
    "arrival_tolerance_minutes": 15,
}


def norm_name(s: str) -> str:
    """Lower case, letters and single spaces only: how names are compared everywhere."""
    return re.sub(r"[^a-z ]", "", re.sub(r"\s+", " ", (s or "").lower().strip()))


def hhmm_to_min(s: str) -> int:
    m = re.fullmatch(r"\s*(\d{1,2}):(\d{2})\s*", s)
    if not m or int(m[1]) > 24 or int(m[2]) > 59:
        raise ValueError("bad time")
    return int(m[1]) * 60 + int(m[2])


@dataclass
class CarerSettings:
    id: str
    name: str = ""
    teams: list[str] = field(default_factory=list)
    working_hours: dict[str, list[dict]] = field(default_factory=dict)
    weekly_max_hours: float | None = None
    skills: list[str] = field(default_factory=list)
    dbs_expiry: date | None = None
    training_expiry: date | None = None
    active: bool = True
    # no working-hours blocks and True (the default): available 00:00-24:00 every day; the engine
    # chooses their hours. Explicit blocks always win. False with no blocks: not planned.
    available_any_time: bool = True

    def blocks(self, day: int) -> list[tuple[int, int]]:
        """Working blocks for a weekday as (start, end) minutes; a block that ends at or
        before its start runs into the next morning."""
        out = []
        for b in self.working_hours.get(DAYS[day], []) or []:
            s, e = hhmm_to_min(b["start"]), hhmm_to_min(b["end"])
            if e <= s:
                e += 1440
            out.append((s, e))
        return out

    def has_hours(self) -> bool:
        return any(self.working_hours.get(d) for d in DAYS)


@dataclass
class ClientSettings:
    id: str
    ref: str = ""
    team: str = ""
    gender_preference: str | None = None
    do_not_send: list[str] = field(default_factory=list)
    safeguarding_bar: list[str] = field(default_factory=list)
    required_skills: list[str] = field(default_factory=list)
    time_critical_booking_types: list[str] = field(default_factory=list)


@dataclass
class SettingsFile:
    saved_at: str | None = None
    agency: dict = field(default_factory=lambda: json.loads(json.dumps(DEFAULT_AGENCY)))
    carers: list[CarerSettings] = field(default_factory=list)
    clients: list[ClientSettings] = field(default_factory=list)
    carer_name_matches: list[dict] = field(default_factory=list)
    tolerance_defaulted: bool = True  # the file did not set agency.arrival_tolerance_minutes

    # --- lookups -------------------------------------------------------------------
    def carer(self, carer_id: str) -> CarerSettings | None:
        return next((c for c in self.carers if c.id == carer_id), None)

    def client(self, client_id: str) -> ClientSettings | None:
        return next((c for c in self.clients if c.id == client_id), None)

    def saved_matches(self) -> dict[str, str]:
        return {norm_name(m["booking_name"]): m["carer_id"] for m in self.carer_name_matches}

    @property
    def team_regions(self) -> dict[str, str]:
        tr = self.agency.get("team_regions")
        return dict(tr) if isinstance(tr, dict) and tr else dict(DEFAULT_TEAM_REGIONS)

    # --- (de)serialisation ---------------------------------------------------------
    def to_dict(self) -> dict:
        def carer(c: CarerSettings) -> dict:
            return {
                "id": c.id, "name": c.name, "teams": c.teams, "working_hours": c.working_hours,
                "weekly_max_hours": c.weekly_max_hours, "skills": c.skills,
                "dbs_expiry": c.dbs_expiry.isoformat() if c.dbs_expiry else None,
                "training_expiry": c.training_expiry.isoformat() if c.training_expiry else None,
                "active": c.active, "available_any_time": c.available_any_time,
            }

        def client(c: ClientSettings) -> dict:
            return {
                "id": c.id, "ref": c.ref, "team": c.team,
                "gender_preference": c.gender_preference, "do_not_send": c.do_not_send,
                "safeguarding_bar": c.safeguarding_bar, "required_skills": c.required_skills,
                "time_critical_booking_types": c.time_critical_booking_types,
            }

        return {
            "version": 1,
            "saved_at": self.saved_at,
            "agency": self.agency,
            "carers": [carer(c) for c in self.carers],
            "clients": [client(c) for c in self.clients],
            "carer_name_matches": self.carer_name_matches,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @staticmethod
    def from_json(data: bytes | str) -> "SettingsFile":
        try:
            raw = json.loads(data)
        except (ValueError, UnicodeDecodeError):
            raise ServiceError("The settings file is not valid JSON.", 422) from None
        return SettingsFile.from_dict(raw)

    @staticmethod
    def from_dict(raw: object) -> "SettingsFile":
        if not isinstance(raw, dict):
            raise ServiceError("The settings file is not a settings file.", 422)
        if raw.get("version") != 1:
            raise ServiceError("Unsupported settings file version (expected version 1).", 422)
        if not isinstance(raw.get("carers", []), list) or not isinstance(raw.get("clients", []), list):
            raise ServiceError("The settings file needs a carers list and a clients list.", 422)

        agency = json.loads(json.dumps(DEFAULT_AGENCY))
        tolerance_defaulted = True
        if isinstance(raw.get("agency"), dict):
            agency.update(raw["agency"])
            tolerance_defaulted = raw["agency"].get("arrival_tolerance_minutes") is None
            agency["arrival_tolerance_minutes"] = agency.get("arrival_tolerance_minutes") if not tolerance_defaulted else 15
        sec = agency.get("search_seconds_per_day")
        if not isinstance(sec, (int, float)) or isinstance(sec, bool) or not 1 <= sec <= 120:
            raise ServiceError("agency.search_seconds_per_day must be between 1 and 120.", 422)
        for key in ("move_window_minutes", "move_cost_pence_per_min", "continuity_weight_pence",
                    "search_seconds_per_day", "change_cost_pence", "arrival_tolerance_minutes"):
            if not isinstance(agency.get(key), (int, float)) or isinstance(agency.get(key), bool):
                raise ServiceError(f"The settings file has a bad value for agency.{key}.", 422)

        bad_hours = bad_date = 0
        carers: list[CarerSettings] = []
        for c in raw.get("carers", []):
            if not isinstance(c, dict) or not c.get("id"):
                raise ServiceError("A carer in the settings file has no id.", 422)
            wh: dict[str, list[dict]] = {}
            for d in DAYS:
                blocks = (c.get("working_hours") or {}).get(d) or []
                ok = []
                for b in blocks:
                    try:
                        hhmm_to_min(b["start"])
                        hhmm_to_min(b["end"])
                        ok.append({"start": b["start"], "end": b["end"]})
                    except (KeyError, TypeError, ValueError):
                        bad_hours += 1
                if ok:
                    wh[d] = ok
            dates = {}
            for k in ("dbs_expiry", "training_expiry"):
                v = c.get(k)
                try:
                    dates[k] = date.fromisoformat(v) if v else None
                except (TypeError, ValueError):
                    dates[k] = None
                    bad_date += 1
            wmax = c.get("weekly_max_hours")
            carers.append(
                CarerSettings(
                    id=str(c["id"]), name=str(c.get("name") or ""), teams=list(c.get("teams") or []),
                    working_hours=wh,
                    weekly_max_hours=float(wmax) if isinstance(wmax, (int, float)) and wmax > 0 else None,
                    skills=list(c.get("skills") or []),
                    dbs_expiry=dates["dbs_expiry"], training_expiry=dates["training_expiry"],
                    active=c.get("active", True) is not False,
                    available_any_time=c.get("available_any_time", True) is not False,
                )
            )
        if bad_hours:
            raise ServiceError(f"{bad_hours} working-hours block(s) in the settings file are not HH:MM.", 422)
        if bad_date:
            raise ServiceError(f"{bad_date} DBS or training date(s) in the settings file are not YYYY-MM-DD.", 422)

        clients: list[ClientSettings] = []
        for c in raw.get("clients", []):
            if not isinstance(c, dict) or not c.get("id"):
                raise ServiceError("A client in the settings file has no id.", 422)
            gp = c.get("gender_preference")
            clients.append(
                ClientSettings(
                    id=str(c["id"]), ref=str(c.get("ref") or ""), team=str(c.get("team") or ""),
                    gender_preference=gp if gp in ("female", "male") else None,
                    do_not_send=[str(x) for x in c.get("do_not_send") or []],
                    safeguarding_bar=[str(x) for x in c.get("safeguarding_bar") or []],
                    required_skills=list(c.get("required_skills") or []),
                    time_critical_booking_types=list(c.get("time_critical_booking_types") or []),
                )
            )
        matches = [
            {"booking_name": str(m["booking_name"]), "carer_id": str(m["carer_id"])}
            for m in raw.get("carer_name_matches") or []
            if isinstance(m, dict) and m.get("booking_name") and m.get("carer_id")
        ]
        return SettingsFile(
            saved_at=raw.get("saved_at"), agency=agency, carers=carers, clients=clients,
            carer_name_matches=matches, tolerance_defaulted=tolerance_defaulted,
        )


def settings_warnings(s: SettingsFile, week_start: date) -> list[dict]:
    """Rules not checked because an input is missing, or that need attention. Carer IDs and
    counts only. Same codes and wording as the web app's own check (lib/settings.ts)."""
    out: list[dict] = []
    active = [c for c in s.carers if c.active]

    def add(code: str, message: str) -> None:
        out.append({"code": code, "message": message})

    no_hours = [c for c in active if not c.has_hours() and not c.available_any_time]
    if no_hours:
        add("no_working_hours",
            f"{len(no_hours)} active carer(s) are marked not available and have no working hours, so "
            f"they will not be planned: "
            f"{', '.join(c.id for c in no_hours)}.")
    no_dbs = [c for c in active if not c.dbs_expiry]
    if no_dbs:
        add("no_dbs_date",
            f"DBS expiry is missing for {len(no_dbs)} carer(s), so the DBS rule is not checked "
            f"for them: {', '.join(c.id for c in no_dbs)}.")
    no_tr = [c for c in active if not c.training_expiry]
    if no_tr:
        add("no_training_date",
            f"Training expiry is missing for {len(no_tr)} carer(s), so the training rule is not "
            f"checked for them: {', '.join(c.id for c in no_tr)}.")
    expired = [
        c for c in active
        if (c.dbs_expiry and c.dbs_expiry < week_start) or (c.training_expiry and c.training_expiry < week_start)
    ]
    if expired:
        add("expired",
            f"DBS or training has expired for {len(expired)} carer(s); they will not be planned: "
            f"{', '.join(c.id for c in expired)}.")
    no_max = [c for c in active if c.weekly_max_hours is None]
    if no_max:
        add("no_weekly_max",
            f"Weekly maximum hours is missing for {len(no_max)} carer(s), so it is not checked "
            f"for them: {', '.join(c.id for c in no_max)}.")
    a = s.agency
    if a.get("pay_pence_per_hour") is None or a.get("mileage_pence_per_mile") is None or a.get("travel_time_paid") is None:
        add("agency_defaults",
            "Pay rate, mileage rate or travel-time-paid are not set; standard rates are used to work out travel cost.")
    return out
