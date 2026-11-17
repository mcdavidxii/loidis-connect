"""Parse a CareLineLive continuity report into {client pseudo id: {carer pseudo id: share 0-1}}
using id_map.json for the name -> pseudo ID mapping. Same matching logic as prepare_inputs.py."""
import json
import re
from collections import defaultdict
from pathlib import Path

import openpyxl


def norm(s):
    return re.sub(r"[^a-z ]", "", re.sub(r"\s+", " ", (s or "").lower().strip()))


def load_continuity(path, id_map_path):
    ids = json.loads(Path(id_map_path).read_text())
    cid = {c["name_normalised"]: c["pseudo_id"] for c in ids["clients"]}
    kid = {c["name_normalised"]: c["pseudo_id"] for c in ids["carers"]}
    rows = list(openpyxl.load_workbook(path, read_only=True, data_only=True)["Continuity"].iter_rows(values_only=True))
    cur, out, pcts = None, defaultdict(dict), []
    stats = {"rows": 0, "client_unmatched": 0, "carer_unmatched": 0, "carer_ambiguous": 0}
    for r in rows[1:]:
        if r[0]:
            cur = norm(r[0])
        if not r[1] or not isinstance(r[3], (int, float)):
            continue
        stats["rows"] += 1
        cp = cid.get(cur)
        toks = set(norm(r[1]).split())
        hits = [p for nm, p in kid.items() if set(nm.split()) <= toks]
        if len(hits) > 1:
            stats["carer_ambiguous"] += 1
        if not cp:
            stats["client_unmatched"] += 1
            continue
        if len(hits) != 1:
            stats["carer_unmatched"] += 1
            continue
        pcts.append(r[3])
        out[cp][hits[0]] = r[3]
    scale = 100.0 if pcts and max(pcts) > 1.0 else 1.0
    return {c: {k: v / scale for k, v in d.items()} for c, d in out.items()}, stats
