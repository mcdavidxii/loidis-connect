"""Read-only probe of the CareLineLive API.

Usage (from the repo root):
    python3 -I tools/carelinelive_probe.py .env path/to/openapi.json
The spec is public: https://api.docs.carelinelive.com/openapi.json

Safety:
- Sends GET requests only (enforced in http_get).
- Loads careline_api / careline_domain from .env at runtime; never prints them.
- Prints only status codes, record totals and field NAMES. Never record values.
"""
import json
import sys
import time
import urllib.error
import urllib.request

ENV_PATH, SPEC_PATH = sys.argv[1], sys.argv[2]


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


env = load_env(ENV_PATH, {"careline_api", "careline_domain"})
missing = {"careline_api", "careline_domain"} - set(env)
if missing:
    sys.exit(f"Missing in .env: {sorted(missing)}")
TOKEN, dom = env["careline_api"], env["careline_domain"].rstrip("/")
if "://" not in dom:
    dom = "https://" + (dom if "." in dom else dom + ".carelinelive.app")
BASE = dom if dom.endswith("/api/v2") else dom + "/api/v2"
print("domain form:", "full URL" if "://" in env["careline_domain"] else
      ("host" if "." in env["careline_domain"] else "subdomain"), "| token length:", len(TOKEN))


def http_get(path, query="limit=1"):
    method = "GET"
    assert method == "GET"
    req = urllib.request.Request(f"{BASE}{path}?{query}", method=method, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/json",
        "X-Api-Version": "2025-01-01",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:  # network errors: type only
        return f"ERR {type(e).__name__}", None


def summary(body):
    if not isinstance(body, dict):
        return ""
    total = body.get("meta", {}).get("pagination", {}).get("total")
    data = body.get("data")
    fields = []
    if isinstance(data, list) and data and isinstance(data[0], dict):
        fields = sorted(data[0].get("attributes", {}).keys())
    return f"total={total}" + (f" fields={fields}" if fields else "")


spec = json.load(open(SPEC_PATH))
documented = sorted(p for p, v in spec["paths"].items() if "get" in v and "{" not in p)

# Sanity check before the sweep: if auth fails, stop.
code, _ = http_get("/permissions")
print("auth check /permissions:", code)
if code != 200:
    sys.exit("Stopping: auth check did not return 200.")

print(f"\n== Documented list endpoints ({len(documented)})")
counts = {}
for p in documented:
    code, body = http_get(p)
    counts[code] = counts.get(code, 0) + 1
    print(f"{code}  {p}  {summary(body) if code == 200 else ''}")
    time.sleep(0.25)
print("status totals:", counts)

GUESSES = ["/bookings", "/visits", "/appointments", "/schedule-entries",
           "/client-schedule-entries", "/schedules", "/rota", "/rotas", "/shifts",
           "/carer-availabilities", "/availabilities", "/carer-compatibilities",
           "/compatibilities", "/timesheets", "/service-contracts", "/invoices",
           "/rounds", "/clients/schedule-entries", "/bookings/unallocated"]
print(f"\n== Undocumented guesses ({len(GUESSES)})  [404 = not there, 401/403 = exists but blocked, 200 = exists]")
for p in GUESSES:
    code, body = http_get(p)
    print(f"{code}  {p}  {summary(body) if code == 200 else ''}")
    time.sleep(0.25)
