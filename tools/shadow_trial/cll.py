"""Read-only CareLineLive client for the shadow trial. GET only; never prints values."""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TRIAL = REPO / "data" / "private" / "trial"


def load_env(path, wanted):
    found = {}
    with open(path) as f:
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


_env = load_env(REPO / ".env", {"careline_api", "careline_domain"})
_TOKEN = _env["careline_api"]
_dom = _env["careline_domain"].rstrip("/")
if "://" not in _dom:
    _dom = "https://" + (_dom if "." in _dom else _dom + ".carelinelive.app")
BASE = _dom if _dom.endswith("/api/v2") else _dom + "/api/v2"
calls = {"n": 0}


def get(path, params=None, retries=2):
    """GET only. Returns parsed JSON or raises RuntimeError with status code only."""
    q = urllib.parse.urlencode(params or {}, doseq=True)
    url = f"{BASE}{path}" + (f"?{q}" if q else "")
    req = urllib.request.Request(url, method="GET", headers={
        "Authorization": f"Bearer {_TOKEN}",
        "Accept": "application/json",
        "X-Api-Version": "2025-01-01",
    })
    for attempt in range(retries + 1):
        calls["n"] += 1
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(3 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {e.code} on {path}") from None
        except Exception as e:
            if attempt < retries:
                time.sleep(3)
                continue
            raise RuntimeError(f"{type(e).__name__} on {path}") from None


def get_all(path, params=None, limit=100):
    out, included, page = [], [], 1
    while True:
        body = get(path, {**(params or {}), "limit": limit, "page": page})
        out += body.get("data", [])
        included += body.get("included", [])
        pg = body.get("meta", {}).get("pagination", {})
        total = pg.get("total", len(out))
        if len(out) >= total or not body.get("data"):
            break
        page += 1
        time.sleep(0.2)
    return out, included


def keys_tree(x, depth=0, maxdepth=4):
    """Structure only: field names and types, never values."""
    if depth > maxdepth:
        return "..."
    if isinstance(x, dict):
        return {k: keys_tree(v, depth + 1, maxdepth) for k, v in x.items()}
    if isinstance(x, list):
        return [keys_tree(x[0], depth + 1, maxdepth)] if x else []
    return type(x).__name__
