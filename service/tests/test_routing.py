"""Road routing client and its use in a run, against a fake OSRM server on 127.0.0.1 (no Docker,
no network, made-up places only)."""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs

import pytest

from loidis_rota.models import Location
from loidis_rota.travel import EstimateTravel, MatrixTravel, distance_km
from loidis_service import fake_data, routing
from loidis_service.bookings import parse_bookings
from loidis_service.build import build
from loidis_service.cll import fetch_api_data
from loidis_service.scoring import current_problem
from loidis_service.settings_file import SettingsFile

calls: list[str] = []


def off_map(lon, lat):
    """The fake map covers Dorset and Leeds only: this corner (near Southampton) is outside it."""
    return lon > -1.9 and lat < 52


class Osrm(BaseHTTPRequestHandler):
    mode = "ok"

    def do_GET(self):
        calls.append(self.command)
        if Osrm.mode == "redirect":
            self.send_response(302)
            self.send_header("Location", "/elsewhere")
            self.end_headers()
            return
        path, _, query = self.path.partition("?")  # (urlparse would treat ";" as a params separator)
        pts = [tuple(map(float, c.split(","))) for c in path.rsplit("/", 1)[1].split(";")]
        q = parse_qs(query)
        assert q["annotations"] == ["duration,distance"]
        src = [int(i) for i in q["sources"][0].split(";")] if "sources" in q else list(range(len(pts)))
        km = lambda a, b: distance_km(Location(a[1], a[0]), Location(b[1], b[0])) / 1.35 * 1.1  # noqa: E731
        body = {
            "code": "Ok",
            "durations": [[km(pts[i], p) / 40 * 3600 for p in pts] for i in src],
            "distances": [[km(pts[i], p) * 1000 for p in pts] for i in src],
            "sources": [{"distance": 5000.0 if off_map(*pts[i]) else 8.0} for i in src],
            "destinations": [{"distance": 5000.0 if off_map(*p) else 8.0} for p in pts],
        }
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


@pytest.fixture()
def osrm(monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), Osrm)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    calls.clear()
    Osrm.mode = "ok"
    url = f"http://127.0.0.1:{srv.server_port}"
    monkeypatch.setenv("LOIDIS_OSRM_URLS", f"Leeds={url},Dorset={url}")
    yield url
    srv.shutdown()


A, B, C = Location(50.70, -2.44), Location(50.72, -2.40), Location(50.66, -2.46)


def test_off_by_default_and_loopback_only(monkeypatch):
    monkeypatch.delenv("LOIDIS_OSRM_URLS", raising=False)
    assert routing.configured_urls() == {}
    assert routing.road_provider("Leeds", [A, B]) == (None, routing.RoutingInfo("Leeds"))
    monkeypatch.setenv("LOIDIS_OSRM_URLS", "Leeds=http://example.com:5002,Dorset=http://127.0.0.1:5001/")
    assert routing.configured_urls() == {"dorset": "http://127.0.0.1:5001"}  # a remote host is refused


def test_table_gives_road_figures_for_cars_only(osrm):
    provider, info = routing.road_provider("Leeds", [A, B, C])
    assert info.used and not info.unavailable and info.partial_points == 0
    assert isinstance(provider, MatrixTravel)
    est = EstimateTravel()
    assert provider.miles(A, B) != est.miles(A, B) and provider.miles(A, B) == pytest.approx(
        distance_km(A, B) / 1.35 * 1.1 / 1.609344, rel=1e-3)
    assert provider.minutes(A, B, "car") > 3
    assert provider.minutes(A, B, "foot") == est.minutes(A, B, "foot")  # walkers keep the estimate
    assert set(calls) == {"GET"}


def test_chunking_gives_the_same_table(osrm, monkeypatch):
    pts = [Location(50.6 + i * 0.01, -2.4 - i * 0.005) for i in range(12)]
    whole, _ = routing.road_provider("Leeds", pts)
    n_whole = len(calls)
    monkeypatch.setattr(routing, "MAX_TABLE_CELLS", 30)  # 2 rows per request
    chunked, _ = routing.road_provider("Leeds", pts)
    assert len(calls) - n_whole == 6 and n_whole == 1
    assert whole.table == chunked.table


def test_places_off_the_map_use_the_estimate_and_are_counted(osrm):
    far = Location(50.9, -1.6)
    provider, info = routing.road_provider("Leeds", [A, B, far])
    assert info.partial_points == 1 and info.used
    assert (A, far) not in provider.table and (A, B) in provider.table
    assert provider.minutes(A, far, "car") == EstimateTravel().minutes(A, far, "car")


def test_stand_in_places_are_never_routed(osrm):
    provider, info = routing.road_provider("Leeds", [A, B, C], skip={C})
    assert info.unlocated_points == 1 and (A, C) not in provider.table


def test_unreachable_server_and_redirects_fall_back(osrm):
    Osrm.mode = "redirect"
    p, info = routing.road_provider("Leeds", [A, B])
    assert p is None and info.unavailable and calls == ["GET"]  # the redirect was not followed
    p, info = routing.road_provider("Leeds", [A, B], client=routing.OsrmClient("http://127.0.0.1:9"))
    assert p is None and info.unavailable


# ---- in a run ---------------------------------------------------------------------------
def _build(files, mode="improve"):
    rows = parse_bookings(files["bookings"])[0]
    return build(rows, fetch_api_data(), SettingsFile.from_json(files["settings"]), mode, 1000, {}, None)


def test_run_uses_road_routes_for_the_plan_and_the_current_rota(osrm, files):
    b = _build(files)
    assert all(isinstance(r.problem.travel, MatrixTravel) for r in b.regions)
    assert all(current_problem(r).travel is r.problem.travel for r in b.regions)  # same provider: fair comparison
    note = next(n for n in b.notices if n["code"] == "travel_source")
    assert note["message"].startswith("Travel: road routes")
    assert not any(w["code"] in ("routing_unavailable", "routing_partial") for w in b.warnings)
    assert "missing_address" in {w["code"] for w in b.warnings}
    assert "can't be estimated" in next(w["message"] for w in b.warnings if w["code"] == "missing_address")


def test_run_without_routing_says_estimated(files, monkeypatch):
    monkeypatch.delenv("LOIDIS_OSRM_URLS", raising=False)
    b = _build(files, "new")
    assert all(isinstance(r.problem.travel, EstimateTravel) for r in b.regions)
    assert next(n for n in b.notices if n["code"] == "travel_source")["message"].startswith("Travel: estimated")


def test_run_warns_when_routing_is_down_or_partial(files, monkeypatch, osrm):
    monkeypatch.setenv("LOIDIS_OSRM_URLS", "Leeds=http://127.0.0.1:9,Dorset=http://127.0.0.1:9")
    b = _build(files, "new")
    w = next(w for w in b.warnings if w["code"] == "routing_unavailable")
    assert "Leeds" in w["message"] and "Dorset" in w["message"]
    assert "estimated" in next(n for n in b.notices if n["code"] == "travel_source")["message"]
    # a carer whose home is outside the map (but within 100 km of their clients): partial
    from loidis_service.cll import normalise

    raw = fake_data.fake_api_raw()
    raw["carer_addresses"]["K007"] = [{"meta": {"geocoding": {"status": "success", "latitude": 50.7, "longitude": -1.6}}}]
    monkeypatch.setenv("LOIDIS_OSRM_URLS", f"Leeds={osrm},Dorset={osrm}")
    rows = parse_bookings(files["bookings"])[0]
    b = build(rows, normalise(raw), SettingsFile.from_json(files["settings"]), "new", 0, {}, None)
    w = next(w for w in b.warnings if w["code"] == "routing_partial")
    assert w["message"].startswith("1 place(s)")
    assert all(isinstance(r.problem.travel, MatrixTravel) for r in b.regions)  # the rest is still routed
