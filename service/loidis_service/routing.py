"""Road routing from a local OSRM server (public OpenStreetMap data, nothing leaves the machine).

Configured by one environment variable, off by default:

  LOIDIS_OSRM_URLS="Leeds=http://127.0.0.1:5002,Weymouth=http://127.0.0.1:5001"

(region name = the planning region names of the settings file; "Dorset" is an old name for
Weymouth and still works; the host must be this machine).
For a run and a region the service asks OSRM once for a table of driving time and distance
between every carer home and client location (GET /table/v1/driving/...), keeps it in memory for
the run only, and gives it to the engine as a MatrixTravel. Walking and bus carers keep the
estimate, so does any place OSRM could not snap to a road near it, and everything if OSRM is off or
unreachable. Only GET requests are made, redirects are refused, and nothing is logged but counts.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass
from urllib.parse import urlparse

from loidis_rota.models import Location
from loidis_rota.travel import MatrixTravel, TravelProvider

from .config import REGION_ALIASES
from .safe_http import build_opener

log = logging.getLogger("loidis_service")

SNAP_LIMIT_M = 1000  # a place further than this from a road OSRM knows is outside the extract
MAX_TABLE_CELLS = 1500  # per request; the OSRM server is started with --max-table-size 2000
TIMEOUT_S = 60
METRES_PER_MILE = 1609.344


def configured_urls() -> dict[str, str]:
    """{region lower-case: base URL} from LOIDIS_OSRM_URLS; empty = routing off."""
    out: dict[str, str] = {}
    for part in os.environ.get("LOIDIS_OSRM_URLS", "").split(","):
        if "=" not in part:
            continue
        name, url = part.split("=", 1)
        u = urlparse(url.strip())
        if u.scheme in ("http", "https") and u.hostname in ("127.0.0.1", "localhost", "::1"):
            key = name.strip().lower()
            out[REGION_ALIASES.get(key, key).lower()] = url.strip().rstrip("/")
    return out


class OsrmError(Exception):
    """OSRM could not be used. The text never contains coordinates."""


class OsrmClient:
    def __init__(self, base_url: str):
        self.base = base_url.rstrip("/")
        self._opener = build_opener()  # refuses redirects

    def _get(self, path: str, params: dict) -> dict:
        url = f"{self.base}{path}?{urllib.parse.urlencode(params)}"
        try:
            req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
            with self._opener.open(req, timeout=TIMEOUT_S) as r:
                body = json.loads(r.read())
        except Exception as e:  # noqa: BLE001 - only the class goes in the message
            raise OsrmError(type(e).__name__) from None
        if body.get("code") != "Ok":
            raise OsrmError(str(body.get("code", "bad answer")))
        return body

    def table(self, points: list[Location]):
        """(seconds, metres, snap distance in metres per point) for every pair of points."""
        n = len(points)
        coords = ";".join(f"{p.lon:.6f},{p.lat:.6f}" for p in points)
        rows_per = max(1, MAX_TABLE_CELLS // max(1, n))
        dur: list = []
        dist: list = []
        snap = [0.0] * n
        for start in range(0, n, rows_per):
            idx = list(range(start, min(n, start + rows_per)))
            body = self._get(
                f"/table/v1/driving/{coords}",
                {"annotations": "duration,distance", "sources": ";".join(map(str, idx))},
            )
            dur += body["durations"]
            dist += body["distances"]
            if not snap_filled(snap, idx, body):
                raise OsrmError("no snap data")
        return dur, dist, snap


def snap_filled(snap: list[float], idx: list[int], body: dict) -> bool:
    """Record how far each point is from the road network (the table answer lists the sources
    asked for, and every destination, each with its snap distance)."""
    dests = body.get("destinations") or []
    if len(dests) != len(snap):
        return False
    for i, d in enumerate(dests):
        snap[i] = float(d.get("distance") or 0.0)
    return True


@dataclass
class RoutingInfo:
    region: str
    used: bool = False
    unavailable: bool = False
    partial_points: int = 0  # places left on the estimate because they are too far from a road
    unlocated_points: int = 0  # stand-in places (no address): never routed
    points: int = 0


def road_provider(region: str, points: list[Location], skip: set[Location] | None = None,
                  client: OsrmClient | None = None) -> tuple[TravelProvider | None, RoutingInfo]:
    """Road travel for the places of one region, or (None, info) if routing is off or unusable.

    `skip`: places that are not real addresses (a stand-in was used): never routed."""
    info = RoutingInfo(region)
    if client is None:
        url = configured_urls().get(region.lower())
        if not url:
            return None, info  # off for this region
        client = OsrmClient(url)
    skip = skip or set()
    pts = list(dict.fromkeys(p for p in points if p not in skip))
    info.points = len(pts)
    info.unlocated_points = len(set(points) & skip)
    if len(pts) < 2:
        return None, info
    try:
        dur, dist, snap = client.table(pts)
    except OsrmError as e:
        info.unavailable = True
        log.warning("routing %s unavailable: %s", region, e)
        return None, info
    good = [i for i, s in enumerate(snap) if s <= SNAP_LIMIT_M]
    info.partial_points = len(pts) - len(good)
    table = {}
    for i in good:
        for j in good:
            d, m = dur[i][j], dist[i][j]
            if d is None or m is None:
                continue  # no road between the two: estimate for this pair
            table[(pts[i], pts[j])] = (d / 60.0, m / METRES_PER_MILE)
    info.used = bool(table)
    log.info("routing %s points=%d pairs=%d off_road=%d", region, len(pts), len(table), info.partial_points)
    return (MatrixTravel(table) if table else None), info
