"""Download the read-only API data the trial needs into data/private/trial/api_raw/.
GET only. Prints counts only."""
import json
import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
import cll

OUT = cll.TRIAL / "api_raw"
OUT.mkdir(parents=True, exist_ok=True)


def save(name, obj):
    (OUT / f"{name}.json").write_text(json.dumps(obj))


clients, _ = cll.get_all("/clients", {"include": "preferred_address"})
save("clients", clients)
carers, _ = cll.get_all("/carers", {"include": "person"})
save("carers", carers)
tt, _ = cll.get_all("/transport-types")
save("transport_types", tt)
teams, _ = cll.get_all("/teams")
save("teams", teams)
leaves, _ = cll.get_all("/leaves")
save("leaves", leaves)
print("clients", len(clients), "carers", len(carers), "transport_types", len(tt),
      "teams", len(teams), "leaves", len(leaves))

addrs = {}
for c in carers:
    d, _ = cll.get_all(f"/carers/{c['id']}/addresses")
    addrs[c["id"]] = d
    time.sleep(0.2)
save("carer_addresses", addrs)
print("carer address lists", len(addrs), "total addresses", sum(len(v) for v in addrs.values()))
print("GET calls", cll.calls["n"])
