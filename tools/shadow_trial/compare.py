"""Compare the actual week with the engine's plan, per region and in total.

Reads data/private/trial/<region>_{actual,engine}_report.json and <region>_build_info.json,
prints the table and writes comparison.json and comparison.md in the same folder.
Pseudo IDs and numbers only.
"""
import json
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

TRIAL = Path(__file__).resolve().parents[2] / "data" / "private" / "trial"
REGIONS = ["leeds", "dorset"]
SUFFIX = sys.argv[1] if len(sys.argv) > 1 else ""  # e.g. _wide
SPREAD_TOLERANCE_H = 5.0


def reason_key(r):
    return re.sub(r"\d+", "N", r or "")


def summarise(report):
    carers = report["carers"]
    clients = {c["id"]: c for c in report["clients"]}
    hits = total = 0
    for v in report["visits"]:
        if v["assigned"]:
            for k in v["assigned"]:
                total += 1
                hits += k in clients[v["client_id"]]["recent_carers"]
    shifts = [abs(v["start"] - v["preferred_start"]) for v in report["visits"]
              if v["assigned"] and v.get("start") is not None]
    # same definitions as engine report metrics: filled visits, start vs preferred start
    shift = {"total_abs_shift_min": sum(shifts), "visits_moved": sum(1 for x in shifts if x), "mean_abs_shift_min": round(sum(shifts) / max(1, len(shifts)), 1),
             "max_abs_shift_min": max(shifts, default=0), "mean_abs_shift_of_moved_min":
             round(sum(shifts) / max(1, sum(1 for x in shifts if x)), 1)}
    tight = (report.get("trial") or {}).get("overlapping_or_unreachable_consecutive_visits")
    m = report["metrics"]
    reasons = Counter(reason_key(v.get("unfilled_reason")) for v in report["visits"] if not v["assigned"])
    unfilled_min = sum(v["duration"] * v["carers_needed"] for v in report["visits"] if not v["assigned"])
    return {
        "visits": m["visits"], "filled": m["filled"], "unfilled": m["unfilled"],
        "unfilled_by_reason": dict(reasons), "shift": shift, "consecutive_gaps_below_model_travel": tight,
        "unfilled_carer_hours": round(unfilled_min / 60, 1),
        "care_hours": m["care_hours"], "travel_hours": m["travel_hours"], "miles": m["miles"],
        "continuity_hits": hits, "continuity_total": total,
        "continuity_rate": round(hits / max(1, total), 3),
    }


def spread(report):
    """Hours per carer for carers who count towards the equal share (contracted > 0)."""
    rows = [(c["id"], c["scheduled_minutes"] / 60, c["contracted_minutes"] / 60, c["travel_minutes"] / 60, c["miles"])
            for c in report["carers"] if c["contracted_minutes"] > 0]
    hrs = [h for _, h, _, _, _ in rows]
    share = rows[0][2] if rows else 0
    return {
        "carers_counted": len(rows),
        "equal_share_hours": round(share, 1),
        "min": round(min(hrs), 1), "median": round(statistics.median(hrs), 1), "max": round(max(hrs), 1),
        "stdev": round(statistics.pstdev(hrs), 1),
        "above_share_by_over_5h": sum(1 for _, h, s, _, _ in rows if h - s > SPREAD_TOLERANCE_H),
        "below_share_by_over_5h": sum(1 for _, h, s, _, _ in rows if s - h > SPREAD_TOLERANCE_H),
        "per_carer_hours": {k: round(h, 1) for k, h, _, _, _ in rows},
        "per_carer_travel_hours": {k: round(t, 1) for k, _, _, t, _ in rows},
        "_hours": hrs, "_dev": [(h - s) for _, h, s, _, _ in rows],
    }


def main():
    out = {"regions": {}, "trial_settings": None}
    pooled = {"actual": {"hours": [], "dev": []}, "engine": {"hours": [], "dev": []}}
    sums = {"actual": Counter(), "engine": Counter()}
    for region in REGIONS:
        info = json.loads((TRIAL / f"{region}{SUFFIX}_build_info.json").read_text())
        out["trial_settings"] = info["trial_settings"]
        entry = {"build_info": {k: v for k, v in info.items() if k not in ("trial_settings", "region")}}
        for side in ("actual", "engine"):
            rep = json.loads((TRIAL / f"{region}{SUFFIX}_{side}_report.json").read_text())
            s, sp = summarise(rep), spread(rep)
            pooled[side]["hours"] += sp.pop("_hours")
            pooled[side]["dev"] += sp.pop("_dev")
            sums[side]["moved"] += s["shift"]["visits_moved"]
            sums[side]["shift_total"] += s["shift"]["total_abs_shift_min"]
            sums[side]["shift_max"] = max(sums[side]["shift_max"], s["shift"]["max_abs_shift_min"])
            sums[side]["gaps"] += s["consecutive_gaps_below_model_travel"] or 0
            for k in ("visits", "filled", "unfilled", "care_hours", "travel_hours", "miles",
                      "continuity_hits", "continuity_total", "unfilled_carer_hours"):
                sums[side][k] += s[k]
            for k, v in s["unfilled_by_reason"].items():
                sums[side]["reason:" + k] += v
            entry[side] = {**s, "spread": sp}
        out["regions"][region] = entry

    total = {}
    for side in ("actual", "engine"):
        c = sums[side]
        hrs, dev = pooled[side]["hours"], pooled[side]["dev"]
        total[side] = {
            "visits": c["visits"], "filled": c["filled"], "unfilled": c["unfilled"],
            "unfilled_by_reason": {k[7:]: v for k, v in c.items() if k.startswith("reason:")},
            "unfilled_carer_hours": round(c["unfilled_carer_hours"], 1),
            "shift": {"visits_moved": c["moved"], "mean_abs_shift_min": round(c["shift_total"] / max(1, c["filled"]), 1),
                      "mean_abs_shift_of_moved_min": round(c["shift_total"] / max(1, c["moved"]), 1),
                      "max_abs_shift_min": c["shift_max"]},
            "consecutive_gaps_below_model_travel": c["gaps"],
            "care_hours": round(c["care_hours"], 1), "travel_hours": round(c["travel_hours"], 1),
            "miles": round(c["miles"], 1),
            "continuity_rate": round(c["continuity_hits"] / max(1, c["continuity_total"]), 3),
            "spread": {
                "carers_counted": len(hrs), "min": round(min(hrs), 1), "median": round(statistics.median(hrs), 1),
                "max": round(max(hrs), 1), "stdev": round(statistics.pstdev(hrs), 1),
                "above_share_by_over_5h": sum(1 for d in dev if d > SPREAD_TOLERANCE_H),
                "below_share_by_over_5h": sum(1 for d in dev if d < -SPREAD_TOLERANCE_H),
            },
        }
    out["total"] = total
    (TRIAL / f"comparison{SUFFIX}.json").write_text(json.dumps(out, indent=1))

    # ---- text table ---------------------------------------------------------------------
    cols = [(r, out["regions"][r]) for r in REGIONS] + [("total", total)]
    rows_def = [
        ("visits", lambda e: e["visits"]), ("filled", lambda e: e["filled"]), ("unfilled", lambda e: e["unfilled"]),
        ("unfilled carer-hours", lambda e: e["unfilled_carer_hours"]),
        ("care hours (filled)", lambda e: e["care_hours"]), ("travel hours", lambda e: e["travel_hours"]),
        ("miles", lambda e: e["miles"]), ("continuity rate", lambda e: e["continuity_rate"]),
        ("visits started off booked time", lambda e: e["shift"]["visits_moved"]),
        ("mean abs shift (min, all filled)", lambda e: e["shift"]["mean_abs_shift_min"]),
        ("mean abs shift (min, moved only)", lambda e: e["shift"]["mean_abs_shift_of_moved_min"]),
        ("max abs shift (min)", lambda e: e["shift"]["max_abs_shift_min"]),
        ("hours/carer min", lambda e: e["spread"]["min"]), ("hours/carer median", lambda e: e["spread"]["median"]),
        ("hours/carer max", lambda e: e["spread"]["max"]), ("hours/carer stdev", lambda e: e["spread"]["stdev"]),
        ("carers > share +5h", lambda e: e["spread"]["above_share_by_over_5h"]),
        ("carers < share -5h", lambda e: e["spread"]["below_share_by_over_5h"]),
    ]
    lines = ["| metric | " + " | ".join(f"{n} actual | {n} engine" for n, _ in cols) + " |",
             "|---|" + "---|" * (2 * len(cols))]
    for label, f in rows_def:
        cells = []
        for _, e in cols:
            a = e["actual"] if "actual" in e else None
            cells += [str(f(e["actual"])), str(f(e["engine"]))]
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    md = ["# Shadow trial comparison (numbers only)", "",
          f"Trial settings: {json.dumps(out['trial_settings'])}", ""] + lines + [""]
    for n, e in cols:
        for side in ("actual", "engine"):
            md.append(f"- {n} {side} unfilled by reason: {json.dumps(e[side]['unfilled_by_reason'])}")
    md.append("")
    for n, e in cols:
        md.append(f"- {n} actual consecutive visit pairs with gap below model travel time: {e['actual']['consecutive_gaps_below_model_travel']}")
    md += ["", "Equal share (hours per carer): " + ", ".join(
        f"{r} {out['regions'][r]['actual']['spread']['equal_share_hours']}" for r in REGIONS),
        "", "Caveats: see the report that accompanies this file; continuity (recent_carers) comes from "
        f"{out['trial_settings'].get('continuity_file', 'the continuity file')}, for both the actual week and the engine; 7 visits expected 1 carer but had 2 (counted as 2 in actual care hours, 1 in the engine)."]
    (TRIAL / f"comparison{SUFFIX}.md").write_text("\n".join(md))
    print("\n".join(md))


if __name__ == "__main__":
    sys.exit(main())
