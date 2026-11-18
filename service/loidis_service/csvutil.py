"""CSV writing for the exports."""

import csv
import io


def _safe(v) -> str:
    s = "" if v is None else str(v)
    # a cell that starts with = + - @ would be run as a formula by a spreadsheet
    return "'" + s if s and s[0] in "=+-@" else s


def to_csv(rows: list[list]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    for r in rows:
        w.writerow([_safe(v) for v in r])
    return buf.getvalue()
