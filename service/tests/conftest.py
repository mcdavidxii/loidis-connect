"""Shared fixtures. Everything here is made up; fake API mode is forced on so no test can
reach the network."""

import json
import logging
import os
import sys
import time
from pathlib import Path

os.environ["ENGINE_FAKE_API"] = "1"
for k in ("CARELINE_API", "CARELINE_DOMAIN", "CARELINE_ENV_FILE"):
    os.environ.pop(k, None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import loidis_service  # noqa: E402,F401
from loidis_service import fake_data  # noqa: E402
from loidis_service.app import create_app  # noqa: E402
from loidis_service.runs import RunStore  # noqa: E402


def fake_names() -> set[str]:
    """Every invented first and last name (clients and carers)."""
    return set(fake_data.CARER_FIRST + fake_data.CARER_LAST + fake_data.CLIENT_FIRST + fake_data.CLIENT_LAST)


def client_names() -> set[str]:
    return set(fake_data.CLIENT_FIRST + fake_data.CLIENT_LAST)


@pytest.fixture(scope="session")
def files():
    s = fake_data.settings_dict(all_matches=True)
    s["agency"]["search_seconds_per_day"] = 1  # the engine still uses about 2 s a day
    return {
        "bookings": fake_data.bookings_csv().encode(),
        "settings": json.dumps(s).encode(),
        "settings_dict": s,
        "continuity": fake_data.continuity_xlsx(),
    }


class LogCapture(logging.Handler):
    def __init__(self):
        super().__init__(logging.DEBUG)
        self.lines: list[str] = []

    def emit(self, record):
        self.lines.append(record.getMessage())


@pytest.fixture(scope="session")
def logs():
    h = LogCapture()
    root = logging.getLogger()
    root.addHandler(h)
    root.setLevel(logging.DEBUG)
    yield h
    root.removeHandler(h)


@pytest.fixture(scope="session")
def store():
    s = RunStore()
    yield s
    s.shutdown()


@pytest.fixture(scope="session")
def client(store, logs):
    with TestClient(create_app(store)) as c:
        yield c


def post_run(client, files, mode="improve", settings=True, continuity=True, locks=None, cost=1000, bookings=None):
    data = {"mode": mode, "change_cost_pence": str(cost), "locks": json.dumps(locks or {})}
    fs = {"bookings": ("bookings.csv", bookings or files["bookings"], "text/csv")}
    if settings:
        fs["settings"] = ("settings.json", files["settings"], "application/json")
    if continuity:
        fs["continuity"] = ("continuity.xlsx", files["continuity"], "application/octet-stream")
    return client.post("/runs", data=data, files=fs)


def wait_done(client, run_id, timeout=240):
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = client.get(f"/runs/{run_id}")
        assert r.status_code == 200
        body = r.json()
        if body["status"] in ("done", "failed"):
            return body
        time.sleep(0.5)
    raise AssertionError("run did not finish in time")


@pytest.fixture(scope="session")
def two_runs(client, files):
    """Start a new-rota run and an improve run together (they search in parallel)."""
    ids = {}
    for mode in ("new", "improve"):
        r = post_run(client, files, mode=mode)
        assert r.status_code == 201, r.text
        ids[mode] = r.json()["run_id"]
    return {m: (i, wait_done(client, i)) for m, i in ids.items()}
