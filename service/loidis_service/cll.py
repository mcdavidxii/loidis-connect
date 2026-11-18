"""Read-only CareLineLive client. GET requests only (CLAUDE.md rule 2): there is no code in
this service that sends POST, PUT, PATCH or DELETE to CareLineLive.

The token comes from the environment at the moment of use (CARELINE_API and CARELINE_DOMAIN,
or an env file whose path is in CARELINE_ENV_FILE). It is never logged or returned, and the
opener refuses redirects so the token only goes to the URL that was asked for.

`normalise` turns the raw API JSON (real or fake, same shape) into the service's own types.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, timedelta

from .errors import ServiceError
from .safe_http import build_opener

MODE_MAP = {"driving": "car", "walking": "foot", "transit": "bus", "bicycling": "foot"}


# --------------------------------------------------------------------------- normalised types
@dataclass
class ApiCarer:
    id: str
    first_name: str
    last_name: str
    preferred_name: str
    gender: str  # female, male or unknown
    active: bool
    mode: str | None  # car, foot, bus or None when the API does not say
    lat: float | None
    lon: float | None
    has_address: bool
    teams: list[str] = field(default_factory=list)

    @property
    def geo_ok(self) -> bool:
        return self.lat is not None

    @property
    def display_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()


@dataclass
class ApiClient:
    id: str
    ref: str
    team: str
    lat: float | None
    lon: float | None
    has_address: bool

    @property
    def geo_ok(self) -> bool:
        return self.lat is not None


@dataclass
class ApiLeave:
    carer_id: str
    start: date
    finish: date
    approved: bool
    full_days: bool


@dataclass
class ApiData:
    carers: list[ApiCarer]
    clients: list[ApiClient]
    leaves: list[ApiLeave]
    teams: list[str]


# --------------------------------------------------------------------------- normalise
def _geo(meta_owner: dict | None) -> tuple[float | None, float | None]:
    geo = ((meta_owner or {}).get("meta") or {}).get("geocoding") or {}
    if geo.get("status") == "success" and geo.get("latitude") is not None:
        return float(geo["latitude"]), float(geo["longitude"])
    return None, None


def normalise(raw: dict) -> ApiData:
    team_name = {t["id"]: (t.get("attributes") or {}).get("name", "") for t in raw.get("teams", [])}
    tt_mode = {
        t["id"]: (t.get("attributes") or {}).get("mode_of_transport") for t in raw.get("transport_types", [])
    }
    carers: list[ApiCarer] = []
    for c in raw.get("carers", []):
        person = ((c.get("relationships") or {}).get("person") or {}).get("attributes") or {}
        g = (person.get("gender") or "").lower()
        addrs = (raw.get("carer_addresses") or {}).get(c["id"], [])
        lat, lon = _geo(addrs[0]) if addrs else (None, None)
        tids = [t.get("id") for t in (((c.get("relationships") or {}).get("teams") or {}).get("data") or [])]
        carers.append(
            ApiCarer(
                id=str(c["id"]),
                first_name=person.get("first_name") or "",
                last_name=person.get("last_name") or "",
                preferred_name=person.get("preferred_name") or "",
                gender={"f": "female", "m": "male", "female": "female", "male": "male"}.get(g, "unknown"),
                active=bool((c.get("meta") or {}).get("active", True)),
                mode=MODE_MAP.get(tt_mode.get((c.get("attributes") or {}).get("primary_transport_type_id"))),
                lat=lat, lon=lon, has_address=bool(addrs),
                teams=[team_name[t] for t in tids if t in team_name],
            )
        )
    clients: list[ApiClient] = []
    for c in raw.get("clients", []):
        attrs = c.get("attributes") or {}
        rel = c.get("relationships") or {}
        pref = rel.get("preferred_address") or {}
        lat, lon = _geo(pref)
        ref = ""
        for key in ("reference_code", "client_reference_code", "reference", "ref"):
            if attrs.get(key):
                ref = str(attrs[key])
                break
        dt = ((rel.get("default_team") or {}).get("data") or {}).get("id")
        clients.append(
            ApiClient(
                id=str(c["id"]), ref=ref, team=team_name.get(dt, ""), lat=lat, lon=lon,
                has_address=bool(pref.get("data") or pref.get("meta")),
            )
        )
    leaves: list[ApiLeave] = []
    for l in raw.get("leaves", []):
        a = l.get("attributes") or {}
        try:
            s, f = date.fromisoformat(a["start"][:10]), date.fromisoformat(a["finish"][:10])
        except (KeyError, ValueError, TypeError):
            continue
        if f > s and str(a["finish"])[11:19] == "00:00:00":
            f -= timedelta(days=1)  # a finish at midnight is the end of the previous day
        leaves.append(
            ApiLeave(
                carer_id=str(a.get("carer_id")), start=s, finish=f,
                approved=bool(a.get("is_approved")) and not a.get("is_declined"),
                full_days=bool(a.get("is_full_days")),
            )
        )
    return ApiData(carers, clients, leaves, [v for v in team_name.values() if v])


# --------------------------------------------------------------------------- real client
def load_env(path: str, wanted: set[str]) -> dict[str, str]:
    found: dict[str, str] = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            if k.startswith("export "):
                k = k[7:].strip()
            if k.lower() in wanted:
                found[k.lower()] = v.strip().strip('"').strip("'")
    return found


class CareLineLive:
    """GET-only client. Errors name the status code and path only."""

    def __init__(self) -> None:
        token = os.environ.get("CARELINE_API")
        domain = os.environ.get("CARELINE_DOMAIN")
        env_file = os.environ.get("CARELINE_ENV_FILE")
        if (not token or not domain) and env_file:
            try:
                found = load_env(env_file, {"careline_api", "careline_domain"})
            except OSError:
                raise ServiceError("The CareLineLive env file could not be read.", 503) from None
            token = token or found.get("careline_api")
            domain = domain or found.get("careline_domain")
        if not token or not domain:
            raise ServiceError(
                "CareLineLive is not configured (set CARELINE_API and CARELINE_DOMAIN, or "
                "CARELINE_ENV_FILE), or start the service with ENGINE_FAKE_API=1.", 503)
        self._token = token
        dom = domain.rstrip("/")
        if "://" not in dom:
            dom = "https://" + (dom if "." in dom else dom + ".carelinelive.app")
        self._base = dom if dom.endswith("/api/v2") else dom + "/api/v2"
        self._opener = build_opener()

    def get(self, path: str, params: dict | None = None, retries: int = 2) -> dict:
        q = urllib.parse.urlencode(params or {}, doseq=True)
        url = f"{self._base}{path}" + (f"?{q}" if q else "")
        req = urllib.request.Request(
            url, method="GET",
            headers={
                "Authorization": f"Bearer {self._token}",
                "Accept": "application/json",
                "X-Api-Version": "2025-01-01",
            },
        )
        for attempt in range(retries + 1):
            try:
                with self._opener.open(req, timeout=120) as r:
                    return json.loads(r.read() or b"{}")
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                    time.sleep(3 * (attempt + 1))
                    continue
                raise ServiceError(f"CareLineLive answered HTTP {e.code} on {path}.", 502) from None
            except RuntimeError as e:  # a refused redirect: never retry
                raise ServiceError(f"{e} on {path}.", 502) from None
            except Exception as e:
                if attempt < retries:
                    time.sleep(3)
                    continue
                raise ServiceError(f"CareLineLive could not be reached ({type(e).__name__}) on {path}.", 502) from None
        raise ServiceError("CareLineLive could not be reached.", 502)

    def get_all(self, path: str, params: dict | None = None, limit: int = 100) -> list[dict]:
        out: list[dict] = []
        page = 1
        while True:
            body = self.get(path, {**(params or {}), "limit": limit, "page": page})
            out += body.get("data", [])
            total = (body.get("meta") or {}).get("pagination", {}).get("total", len(out))
            if len(out) >= total or not body.get("data"):
                return out
            page += 1
            time.sleep(0.2)

    def fetch_raw(self) -> dict:
        clients = self.get_all("/clients", {"include": "preferred_address,default_team"})
        carers = self.get_all("/carers", {"include": "person"})
        raw = {
            "clients": clients,
            "carers": carers,
            "transport_types": self.get_all("/transport-types"),
            "teams": self.get_all("/teams"),
            "leaves": self.get_all("/leaves"),
            "carer_addresses": {},
        }
        for c in carers:
            raw["carer_addresses"][c["id"]] = self.get_all(f"/carers/{c['id']}/addresses")
            time.sleep(0.2)
        return raw


def fetch_api_data() -> ApiData:
    """Fake data in fake API mode (no network at all), the real read-only API otherwise."""
    from . import config

    if config.fake_api():
        from .fake_data import fake_api_raw

        return normalise(fake_api_raw())
    return normalise(CareLineLive().fetch_raw())
