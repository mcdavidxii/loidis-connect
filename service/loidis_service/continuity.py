"""Read a CareLineLive Continuity report (xlsx, the 4 weeks before the planned week).

Same layout and matching as tools/shadow_trial/continuity.py: sheet "Continuity", client
name on the first row of each group (carried down), carer name in column 2, share in
column 4 (0-1 or 0-100). Names are matched to the problem's clients and carers by
normalised name; the carer's name only has to contain the matched carer's words.
"""

from __future__ import annotations

import io
from collections import defaultdict

from .errors import ServiceError
from .settings_file import norm_name

RECENT_SHARE = 0.2  # a carer who did at least this share of a client's visits is "familiar"


def parse_continuity(data: bytes) -> list[tuple[str, str, float]]:
    """Rows of (normalised client name, normalised carer text, share 0-1)."""
    import openpyxl

    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        sheet = wb["Continuity"] if "Continuity" in wb.sheetnames else wb[wb.sheetnames[0]]
        rows = list(sheet.iter_rows(values_only=True))
    except Exception:
        raise ServiceError("The Continuity report could not be read as an xlsx file.", 422) from None
    cur = None
    raw: list[tuple[str, str, float]] = []
    for r in rows[1:]:
        if len(r) < 4:
            continue
        if r[0]:
            cur = norm_name(str(r[0]))
        if not r[1] or cur is None or not isinstance(r[3], (int, float)):
            continue
        raw.append((cur, norm_name(str(r[1])), float(r[3])))
    scale = 100.0 if raw and max(p for _, _, p in raw) > 1.0 else 1.0
    return [(c, k, p / scale) for c, k, p in raw]


def recent_carers_from_report(
    rows: list[tuple[str, str, float]],
    client_by_name: dict[str, str],
    carer_names: dict[str, set[str]],
) -> tuple[dict[str, list[str]], dict[str, int]]:
    """{client id: [carer ids]} for shares >= RECENT_SHARE, and counts of rows used/unmatched.

    carer_names: carer id -> set of normalised names that identify them."""
    out: dict[str, set[str]] = defaultdict(set)
    stats = {"rows": len(rows), "used": 0, "client_unmatched": 0, "carer_unmatched": 0, "carer_ambiguous": 0}
    for client, carer_text, share in rows:
        cid = client_by_name.get(client)
        if cid is None:
            stats["client_unmatched"] += 1
            continue
        words = set(carer_text.split())
        hits = {k for k, names in carer_names.items() if any(set(n.split()) <= words for n in names if n)}
        if len(hits) > 1:
            stats["carer_ambiguous"] += 1
            continue
        if not hits:
            stats["carer_unmatched"] += 1
            continue
        stats["used"] += 1
        if share >= RECENT_SHARE:
            out[cid].add(next(iter(hits)))
    return {c: sorted(v) for c, v in out.items()}, stats
