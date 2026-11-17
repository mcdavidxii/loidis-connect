"""Compare the actual week with the engine's plan, per region and in total.

Reads data/private/trial/<region><suffix>_{actual,actual_eq,engine}_report.json (actual_eq is the
actual week with equal staffing, optional) and <region><suffix>_build_info.json, prints the table
and writes comparison<suffix>.json and comparison<suffix>.md in the same folder.
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
LABELS = {"actual": "actual", "actual_eq": "actual (equal staffing)", "engine": "engine"}


def reason_key(r):
    return re.sub(r"\d+", "N", r or "")


def summarise(report):
    clients = {c["id"]: c for c in report["clients"]}
    hits = total = 0
    for v in report["visits"]:
        for k in v["assigned"] or []:
            total += 1
            hits += k in clients[v["client_id"]]["recent_carers"]
    shifts = [abs(v["start"] - v["preferred_start"]) for v in report["visits"]
              if v["assigned"] and v.get("start") is not None]
    # same definitions as engine report metrics: visits with carers, start vs preferred start
    shift = {"total_abs_shift_min": sum(shifts), "visits_moved": sum(1 for x in shifts if x),
             "mean_abs_shift_min": round(sum(shifts) / max(1, len(shifts)), 1),
             "max_abs_shift_min": max(shifts, default=0),
             "mean_abs_shift_of_moved_min": round(sum(shifts) / max(1, sum(1 for x in shifts if x)), 1)}
    tight = (report.get("trial") or {}).get("overlapping_or_unreachable_consecutive_visits")
    m = report["metrics"]
    # unfilled = visits with an unfilled reason (includes partially staffed actual visits);
    # unfilled carer-hours count the deficit only (carers_needed minus carers who attended)
    unf = [v for v in report["visits"] if v.get("unfilled_reason")]
    reasons = Counter(reason_key(v["unfilled_reason"]) for v in unf)
    unfilled_min = sum(v["duration"] * (v["carers_needed"] - len(v["assigned"] or [])) for v in unf)
    return {
        "visits": m["visits"], "filled": m["filled"], "unfilled": m["unfilled"],
        "partially_staffed": sum(1 for v in unf if v["assigned"]),
        "unfilled_by_reason": dict(reasons), "shift": shift, "consecutive_gaps_below_model_travel": tight,
        "unfilled_carer_hours": round(unfilled_min / 60, 1),
        "care_hours": m["care_hours"], "travel_hours": m["travel_hours"], "miles": m["miles"],
        "continuity_hits": hits, "continuity_total": total,
        "continuity_rate": round(hits / max(1, total), 3),
    }


def spread_from_rows(rows):
    hrs = [h for _, h, _, _ in rows]
    share = rows[0][2] if rows else 0
    return {
        "carers_counted": len(rows),
        "equal_share_hours": round(share, 1),
        "min": round(min(hrs), 1), "median": round(statistics.median(hrs), 1), "max": round(max(hrs), 1),
        "stdev": round(statistics.pstdev(hrs), 1),
        "above_share_by_over_5h": sum(1 for _, h, s, _ in rows if h - s > SPREAD_TOLERANCE_H),
        "below_share_by_over_5h": sum(1 for _, h, s, _ in rows if s - h > SPREAD_TOLERANCE_H),
        "per_carer_hours": {k: round(h, 1) for k, h, _, _ in rows},
        "per_carer_travel_hours": {k: round(t, 1) for k, _, _, t in rows},
    }


def spread(report):
    """Per-region hours per carer, for carers who count towards the equal share (contracted > 0).

    Guest copies (contracted 0) are excluded, so hours a carer works as a guest in the other region
    are NOT in this region's figures. The TOTAL spread is built in main() by summing each carer's
    minutes across both regions' reports."""
    rows = [(c["id"], c["scheduled_minutes"] / 60, c["contracted_minutes"] / 60, c["travel_minutes"] / 60)
            for c in report["carers"] if c["contracted_minutes"] > 0]
    per_carer = {c["id"]: (c["scheduled_minutes"], c["contracted_minutes"]) for c in report["carers"]}
    return spread_from_rows(rows), per_carer


def main():
    out = {"regions": {}, "trial_settings": None}
    sides = list(LABELS)
    pooled = {side: {} for side in sides}  # carer id -> [scheduled minutes across regions, home share minutes]
    sums = {side: Counter() for side in sides}
    have = {side: True for side in sides}
    for region in REGIONS:
        info = json.loads((TRIAL / f"{region}{SUFFIX}_build_info.json").read_text())
        out["trial_settings"] = info["trial_settings"]
        entry = {"build_info": {k: v for k, v in info.items() if k not in ("trial_settings", "region")}}
        for side in sides:
            f = TRIAL / f"{region}{SUFFIX}_{side}_report.json"
            if not f.exists():
                have[side] = False
                continue
            s = summarise(json.loads(f.read_text()))
            sp, per_carer = spread(json.loads(f.read_text()))
            for k, (mins, contracted) in per_carer.items():
                row = pooled[side].setdefault(k, [0, 0])
                row[0] += mins
                row[1] = max(row[1], contracted)  # share of the region where the carer is home (guest copies are 0)
            c = sums[side]
            c["moved"] += s["shift"]["visits_moved"]
            c["shift_total"] += s["shift"]["total_abs_shift_min"]
            c["shift_max"] = max(c["shift_max"], s["shift"]["max_abs_shift_min"])
            c["gaps"] += s["consecutive_gaps_below_model_travel"] or 0
            for k in ("visits", "filled", "unfilled", "partially_staffed", "care_hours", "travel_hours", "miles",
                      "continuity_hits", "continuity_total", "unfilled_carer_hours"):
                c[k] += s[k]
            for k, v in s["unfilled_by_reason"].items():
                c["reason:" + k] += v
            entry[side] = {**s, "spread": sp}
        out["regions"][region] = entry

    sides = [x for x in sides if have[x]]
    total = {}
    for side in sides:
        c = sums[side]
        # TOTAL spread: each carer's minutes summed across both regions (home + guest), over carers
        # who are a home carer in one region (share > 0)
        rows = [(k, m / 60, sh / 60, 0) for k, (m, sh) in pooled[side].items() if sh > 0]
        sp = spread_from_rows(rows)
        total[side] = {
            "visits": c["visits"], "filled": c["filled"], "unfilled": c["unfilled"],
            "partially_staffed": c["partially_staffed"],
            "unfilled_by_reason": {k[7:]: v for k, v in c.items() if k.startswith("reason:")},
            "unfilled_carer_hours": round(c["unfilled_carer_hours"], 1),
            "shift": {"visits_moved": c["moved"], "mean_abs_shift_min": round(c["shift_total"] / max(1, c["filled"] + c["partially_staffed"]), 1),
                      "mean_abs_shift_of_moved_min": round(c["shift_total"] / max(1, c["moved"]), 1),
                      "max_abs_shift_min": c["shift_max"]},
            "consecutive_gaps_below_model_travel": c["gaps"],
            "care_hours": round(c["care_hours"], 1), "travel_hours": round(c["travel_hours"], 1),
            "miles": round(c["miles"], 1),
            "continuity_rate": round(c["continuity_hits"] / max(1, c["continuity_total"]), 3),
            "spread": {k: sp[k] for k in ("carers_counted", "min", "median", "max", "stdev",
                                          "above_share_by_over_5h", "below_share_by_over_5h")},
        }
    out["total"] = total
    (TRIAL / f"comparison{SUFFIX}.json").write_text(json.dumps(out, indent=1))

    # ---- text table ---------------------------------------------------------------------
    cols = [(r, out["regions"][r]) for r in REGIONS] + [("total", total)]
    rows_def = [
        ("visits", lambda e: e["visits"]), ("filled (fully staffed)", lambda e: e["filled"]),
        ("unfilled (incl. partially staffed)", lambda e: e["unfilled"]),
        ("of which partially staffed", lambda e: e["partially_staffed"]),
        ("unfilled carer-hours (deficit)", lambda e: e["unfilled_carer_hours"]),
        ("care hours", lambda e: e["care_hours"]), ("travel hours", lambda e: e["travel_hours"]),
        ("miles", lambda e: e["miles"]), ("continuity rate", lambda e: e["continuity_rate"]),
        ("visits started off booked time", lambda e: e["shift"]["visits_moved"]),
        ("mean abs shift (min, all with carers)", lambda e: e["shift"]["mean_abs_shift_min"]),
        ("mean abs shift (min, moved only)", lambda e: e["shift"]["mean_abs_shift_of_moved_min"]),
        ("max abs shift (min)", lambda e: e["shift"]["max_abs_shift_min"]),
        ("hours/carer min", lambda e: e["spread"]["min"]), ("hours/carer median", lambda e: e["spread"]["median"]),
        ("hours/carer max", lambda e: e["spread"]["max"]), ("hours/carer stdev", lambda e: e["spread"]["stdev"]),
        ("carers > share +5h", lambda e: e["spread"]["above_share_by_over_5h"]),
        ("carers < share -5h", lambda e: e["spread"]["below_share_by_over_5h"]),
    ]
    lines = ["| metric | " + " | ".join(f"{n} {LABELS[x]}" for n, _ in cols for x in sides) + " |",
             "|---|" + "---|" * (len(sides) * len(cols))]
    for label, f in rows_def:
        cells = [str(f(e[x])) for _, e in cols for x in sides]
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    extra = sum(json.loads((TRIAL / f"{r}{SUFFIX}_actual_report.json").read_text()).get("trial", {})
                .get("visits_with_more_carers_than_needed", 0) for r in REGIONS)
    md = ["# Shadow trial comparison (numbers only)", "",
          f"Trial settings: {json.dumps(out['trial_settings'])}", ""] + lines + [""]
    for n, e in cols:
        for side in sides:
            md.append(f"- {n} {LABELS[side]} unfilled by reason: {json.dumps(e[side]['unfilled_by_reason'])}")
    md.append("")
    for n, e in cols:
        md.append(f"- {n} actual consecutive visit pairs with gap below model travel time: {e['actual']['consecutive_gaps_below_model_travel']}")
    md += ["", "Equal share (hours per carer): " + ", ".join(
        f"{r} {out['regions'][r]['actual']['spread']['equal_share_hours']}" for r in REGIONS),
        "", "Hours spread: the per-region columns count only carers whose home is that region and only their hours in that "
        "region (guest hours in the other region are excluded there); the total column sums each carer's hours across both regions.",
        "", "UNCHECKED SAFETY RULES: this trial sets DBS and training expiry to 2099 and leaves required skills, gender "
        "preferences, do-not-send pairs and safeguarding bars empty, so the engine's suggested allocations have NOT been checked "
        "against those rules. A coordinator must check every suggested allocation against them before it is relied on.",
        "", "Caveats: see the report that accompanies this file; continuity (recent_carers) comes from "
        f"{out['trial_settings'].get('continuity_file', 'the continuity file')}, for both the actual week and the engine; "
        f"{extra} visits expected 1 carer but had 2 (counted as 2 in actual care hours and travel, 1 in the engine and in the "
        "equal-staffing column, where which carer is dropped is arbitrary: the first listed is kept)."]
    (TRIAL / f"comparison{SUFFIX}.md").write_text("\n".join(md))
    print("\n".join(md))


if __name__ == "__main__":
    sys.exit(main())
