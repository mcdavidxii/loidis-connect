"""Turn the bookings, the CareLineLive data and the settings file into one engine problem per
planning region (Leeds; Dorset = Dorchester + Weymouth by default).

Follows tools/shadow_trial/prepare_inputs.py and build_problem.py, with the settings file in
place of the trial's placeholders:

- working hours per weekday (nights included), weekly maximum, skills and DBS/training
  dates come from the settings file. A carer with no working hours (or not active) is not
  planned. A missing DBS or training date leaves that rule unchecked (the engine gets the
  "no expiry" date `date.max`, never a made-up real date) and raises a warning.
- client rules: gender preference, do-not-send, safeguarding bar, required skills; booking
  types marked time-critical get a move window of 0.
- the equal-hours share per region, as in the trial.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field, replace
from datetime import date, timedelta

from .bookings import Booking, monday_of, short_client_name
from .cll import ApiCarer, ApiData
from .continuity import parse_continuity, recent_carers_from_report
from .errors import ServiceError
from .matching import carer_name_sets, match_carers
from .routing import road_provider
from .settings_file import DAYS, SettingsFile, norm_name, settings_warnings

from loidis_rota.models import (  # noqa: E402
    Absence, Block, Carer, Client, Location, Problem, Settings, Visit,
)
from loidis_rota.rules import carer_rule_failure, fits_block  # noqa: E402
from loidis_rota.travel import distance_km, travel_minutes  # noqa: E402

NOT_CHECKED = date.max  # "no expiry known": the rule is not checked, and a warning is raised
UNLIMITED_MINUTES = 7 * 24 * 60
FAR_HOME_KM = 100  # a geocoded home this far from every client the carer visits is unusable
MAX_NAMES_IN_WARNING = 30
PAD_MAX_MINUTES = 90
# "Available any time" is one block per day from 00:00 to 48:00. A block that ended at 24:00 could
# not hold a visit that runs past midnight (the engine needs the whole visit inside the block); the
# next day's block starts at 00:00 again, and the engine's rest after a stop past midnight keeps a
# carer from starting the next morning.
ANY_TIME_END = 2 * 24 * 60
GUEST_PAD_MINUTES = 90  # travel slack around a guest carer's own visits, as in the trial
DEFAULT_ARRIVAL_TOLERANCE = 15  # placeholder, to confirm with the coordinator


@dataclass
class VisitMeta:
    booking: Booking
    locked: bool
    lock_reason: str | None


@dataclass
class RegionBuild:
    name: str
    problem: Problem
    visit_meta: dict[str, VisitMeta]
    client_ref: dict[str, str]
    carer_name: dict[str, str]
    current: dict[str, list[str]]  # visit id -> carers in the current rota
    not_planned: set[str]  # carers in the problem who are not planned
    carer_notes: dict[str, list[str]]  # carer id -> issues to show
    routing: object = None  # RoutingInfo for this region
    client_display: dict[str, str] = field(default_factory=dict)  # client id -> "Surname, I" (result only)


@dataclass
class Build:
    week_start: date
    regions: list[RegionBuild]
    warnings: list[dict]
    seconds_per_day: int
    mode: str
    notices: list[dict] = field(default_factory=list)  # information, not warnings


def _pad_blocks(blocks: list[Block], critical: list, week_start: date, home: Location, mode: str) -> int:
    """Stretch blocks (in place) so travel to/from home fits around the time-critical visits
    they nominally cover; merge blocks that then touch. Returns how many were stretched."""
    n = 0
    for blk in blocks:
        s0, e0 = blk.start, blk.end
        for b, loc in critical:
            if (b.day - week_start).days != blk.day:
                continue
            if blk.start <= b.start and b.start + b.duration <= blk.end:
                t = min(PAD_MAX_MINUTES, travel_minutes(home, Location(*loc), mode))
                s0 = min(s0, max(0, b.start - t))
                e0 = max(e0, b.start + b.duration + t)
        if (s0, e0) != (blk.start, blk.end):
            n += 1
            blk.start, blk.end = s0, e0
    blocks.sort(key=lambda x: (x.day, x.start))
    merged: list[Block] = []
    for blk in blocks:
        if merged and merged[-1].day == blk.day and blk.start <= merged[-1].end:
            merged[-1].end = max(merged[-1].end, blk.end)
        else:
            merged.append(blk)
    blocks[:] = merged
    return n


def _lock_outside_hours(problem: Problem, meta: dict, current: dict[str, list[str]]) -> int:
    """As the trial did for night and long visits: a visit the current rota fully staffs, that no
    carer allowed to do it is working at (even allowing for its move window), stays with its
    current carers (window 0), whose availability is stretched around it. Visits that are
    already locked to carers (guest or coordinator), partly staffed or unstaffed, or whose current carers break a
    rule, are left alone. Returns how many visits were locked."""
    n = 0
    for v in problem.visits:
        cur = current.get(v.id, [])
        if v.locked_carers or len(cur) < v.carers_needed:
            continue
        vv = replace(v, locked_carers=[])
        works = any(
            fits_block(vv, b)
            for c in problem.carers if carer_rule_failure(problem, c, vv) is None
            for b in c.blocks_on(v.day)
        )
        if works or any(carer_rule_failure(problem, problem.carer_by_id[k], vv) for k in cur):
            continue
        v.locked_carers = list(cur)
        v.window = 0
        for k in cur:
            c = problem.carer_by_id[k]
            c.availability = _merge_blocks(
                c.availability + [Block(v.day, max(0, v.start - GUEST_PAD_MINUTES),
                                        v.start + v.duration + GUEST_PAD_MINUTES)])
        meta[v.id] = VisitMeta(meta[v.id].booking, True, "kept with the carer who already has it (outside everyone's hours)")
        n += 1
    return n


def _merge_blocks(blocks: list[Block]) -> list[Block]:
    blocks = sorted(blocks, key=lambda x: (x.day, x.start))
    merged: list[Block] = []
    for blk in blocks:
        if merged and merged[-1].day == blk.day and blk.start <= merged[-1].end:
            merged[-1].end = max(merged[-1].end, blk.end)
        else:
            merged.append(blk)
    return merged


def _ids(items, limit: int = MAX_NAMES_IN_WARNING) -> str:
    items = list(items)
    s = ", ".join(items[:limit])
    return s + (f" and {len(items) - limit} more" if len(items) > limit else "")


def _centroid(points: list[tuple[float, float]]) -> tuple[float, float]:
    return sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)


def build(
    bookings: list[Booking],
    api: ApiData,
    settings: SettingsFile | None,
    mode: str,
    change_cost_pence: int,
    locks: dict[str, str],
    continuity: bytes | None,
) -> Build:
    warnings: list[dict] = []

    def warn(code: str, message: str) -> None:
        warnings.append({"code": code, "message": message})

    live = [b for b in bookings if not b.cancelled]
    if not live:
        raise ServiceError("The bookings file has no live (not cancelled) bookings.", 422)
    week_start = monday_of(min(b.day for b in live))
    week_end = week_start + timedelta(days=6)
    agency = (settings or SettingsFile()).agency
    team_regions = (settings or SettingsFile()).team_regions
    region_of_team = {k.lower(): v for k, v in team_regions.items()}

    had_settings = settings is not None
    if settings is None or settings.tolerance_defaulted:
        warn("arrival_tolerance_default",
             f"agency.arrival_tolerance_minutes is not set; {DEFAULT_ARRIVAL_TOLERANCE} minutes (a "
             "placeholder to confirm) is used: a start time that moves by no more than this is only "
             "a note, not a change to apply.")
    if settings is None:
        warn("no_settings",
             "No settings file was uploaded, so no carer has working hours and nothing can be "
             "planned. Add working hours in Settings and upload the file.")
        settings = SettingsFile()
    else:
        warnings.extend(settings_warnings(settings, week_start))

    # ---- carer names -> ids -----------------------------------------------------------
    booking_names = {n for b in live for n in b.carer_names}
    matches, unmatched = match_carers(booking_names, api, settings)
    if unmatched:
        raise ServiceError(
            f"{len(unmatched)} carer name(s) in the bookings file could not be matched to "
            "CareLineLive carers. Use Sync from CareLineLive on the Upload screen to confirm "
            "them, then run again.", 422)

    # ---- regions of visits --------------------------------------------------------------
    def region_for(b: Booking) -> str | None:
        for t in b.teams:
            r = region_of_team.get(t.lower())
            if r:
                return r
        return None

    kept: list[Booking] = []
    unmapped: Counter = Counter()
    for b in live:
        if region_for(b):
            kept.append(b)
        else:
            unmapped[b.team or "(no team)"] += 1
    if unmapped:
        warn("unmapped_team",
             f"{sum(unmapped.values())} booking(s) are in teams with no planning region and were "
             f"left out: {', '.join(sorted(unmapped))}. Set agency.team_regions in the settings file.")
    if not kept:
        raise ServiceError("No booking belongs to a team with a planning region.", 422)

    visits_by_region: dict[str, list[Booking]] = defaultdict(list)
    for b in kept:
        visits_by_region[region_for(b)].append(b)
    # regions in the order the team mapping lists them (Leeds first by default), then any others
    listed = list(dict.fromkeys(team_regions.values()))
    region_order = sorted(visits_by_region, key=lambda r: (listed.index(r) if r in listed else len(listed), r))

    # ---- carers -------------------------------------------------------------------------
    api_carer = {c.id: c for c in api.carers}
    api_client = {c.id: c for c in api.clients}
    cur_regions: dict[str, set[str]] = defaultdict(set)
    for r, bs in visits_by_region.items():
        for b in bs:
            for n in b.carer_names:
                cur_regions[matches[n]].add(r)

    def teams_of(cid: str) -> list[str]:
        sc = settings.carer(cid)
        if sc and sc.teams:
            return sc.teams
        return api_carer[cid].teams if cid in api_carer else []

    def home_regions(cid: str) -> set[str]:
        return {region_of_team[t.lower()] for t in teams_of(cid) if t.lower() in region_of_team}

    candidate_ids = {c.id for c in settings.carers} | set(cur_regions)
    order_idx = {r: i for i, r in enumerate(region_order)}
    visits_of_carer_all: dict[str, dict[str, list[Booking]]] = defaultdict(lambda: defaultdict(list))
    for r, bs_ in visits_by_region.items():
        for b_ in bs_:
            for n in b_.carer_names:
                visits_of_carer_all[matches[n]][r].append(b_)
    largest = max(region_order, key=lambda r: len(visits_by_region[r]))
    # A carer's home region is where they have most visits on the current rota (ties: the
    # earlier region); with no current visits, the region of their settings team. In any other
    # region where they have visits they are a guest (see the region loop).
    home_of: dict[str, str] = {}
    guest_of: dict[str, set[str]] = {}
    no_team: list[str] = []
    for cid in sorted(candidate_ids):
        vr = visits_of_carer_all.get(cid)
        if vr:
            home = max(vr, key=lambda r: (len(vr[r]), -order_idx[r]))
            home_of[cid] = home
            guest_of[cid] = set(vr) - {home}
            continue
        regs = [r for r in dict.fromkeys(
            region_of_team[t.lower()] for t in teams_of(cid) if t.lower() in region_of_team)
            if r in visits_by_region]
        sc = settings.carer(cid)
        if regs:
            home_of[cid] = regs[0]
        elif sc and sc.active and (sc.has_hours() or sc.available_any_time) and not teams_of(cid):
            home_of[cid] = largest  # no team known, no visits: the busiest region
            no_team.append(cid)
    if no_team:
        warn("carer_no_team",
             f"{len(no_team)} carer(s) have no team in the settings file or CareLineLive and no "
             f"visits this week, so they were placed in the region with the most visits "
             f"({largest}): {_ids(no_team)}.")
    cross = sorted(cid for cid, g in guest_of.items() if g)
    if cross:
        warn("cross_region_carers",
             f"{len(cross)} carer(s) have visits in more than one planning region ({_ids(cross)}). "
             "Their home region is where they have most visits: there they get no default hours "
             "on days they have visits in another region, and their weekly maximum is reduced by "
             "those minutes. In the other region they only keep their own current visits (locked "
             "to them), so those visits are not moved.")

    display: dict[str, str] = {}
    for cid in candidate_ids:
        sc = settings.carer(cid)
        display[cid] = (sc.name if sc and sc.name else "") or (
            api_carer[cid].display_name if cid in api_carer else "") or next(
            (n for n, k in matches.items() if k == cid), cid)

    # ---- leave ---------------------------------------------------------------------------
    leave_days: dict[str, set[int]] = defaultdict(set)
    for lv in api.leaves:
        if not lv.approved or not lv.full_days or lv.finish < week_start or lv.start > week_end:
            continue
        d = max(lv.start, week_start)
        while d <= min(lv.finish, week_end):
            leave_days[lv.carer_id].add((d - week_start).days)
            d += timedelta(days=1)

    # ---- continuity ------------------------------------------------------------------------
    client_by_name = {norm_name(b.client_name): b.client_id for b in live if b.client_name}
    report_recent: dict[str, list[str]] | None = None
    if continuity:
        rows = parse_continuity(continuity)
        report_recent, stats = recent_carers_from_report(
            rows, client_by_name, carer_name_sets(api, settings, matches))
        if stats["rows"] == 0 or stats["used"] == 0:
            warn("continuity_unreadable",
                 f"The Continuity report had {stats['rows']} row(s) and none could be matched to "
                 "clients and carers; the current rota was used for familiar carers instead.")
            report_recent = None
    if report_recent is None:
        warn("no_continuity",
             "No usable Continuity report was uploaded, so the carers on the current rota are "
             "counted as familiar to each client. Continuity figures are only as good as that.")

    # ---- engine settings --------------------------------------------------------------------
    def engine_settings() -> Settings:
        s = Settings()
        s.shift_pence_per_min = int(agency["move_cost_pence_per_min"])
        s.continuity_penalty_pence = int(agency["continuity_weight_pence"])
        if agency.get("pay_pence_per_hour") is not None:
            s.pay_pence_per_hour = int(agency["pay_pence_per_hour"])
        if agency.get("mileage_pence_per_mile") is not None:
            s.mileage_pence_per_mile = int(agency["mileage_pence_per_mile"])
        if agency.get("travel_time_paid") is not None:
            s.travel_time_paid = bool(agency["travel_time_paid"])
        if mode == "improve":
            s.change_pence_per_visit = max(0, int(change_cost_pence))
        tol = agency.get("arrival_tolerance_minutes")
        s.arrival_tolerance_minutes = max(0, int(tol)) if tol is not None else DEFAULT_ARRIVAL_TOLERANCE
        return s

    window = max(0, int(agency["move_window_minutes"]))
    seconds = max(1, int(agency["search_seconds_per_day"]))

    # ---- per region -------------------------------------------------------------------------
    regions: list[RegionBuild] = []
    no_geo_clients: list[str] = []
    no_geo_carers: list[str] = []
    transport_defaulted: list[str] = []
    clients_not_in_settings: set[str] = set()
    padded_blocks = 0
    routing_infos: list = []
    no_geo_set: set[str] = set()
    any_time_ids: list[str] = []
    locked_outside = 0
    ignored_locks: set[str] = set()
    all_booking_ids = {b.booking_id for b in live}
    for bid in locks:
        if bid not in all_booking_ids:
            ignored_locks.add(bid)

    for region in region_order:
        bs = visits_by_region[region]
        client_ids = sorted({b.client_id for b in bs})
        locs: dict[str, tuple[float, float]] = {}
        for cid in client_ids:
            ac = api_client.get(cid)
            if ac and ac.geo_ok:
                locs[cid] = (ac.lat, ac.lon)
        if not locs:
            raise ServiceError(
                f"No client in the {region} region has a geocoded address in CareLineLive, so "
                "travel cannot be estimated.", 422)
        centre = _centroid(list(locs.values()))
        client_ref: dict[str, str] = {}
        for b in bs:
            client_ref.setdefault(b.client_id, b.client_ref or (api_client[b.client_id].ref if b.client_id in api_client else ""))

        # carers of this region
        region_carers = sorted(
            cid for cid, h in home_of.items() if h == region or region in guest_of.get(cid, ()))
        guest_here = {cid for cid in region_carers if region in guest_of.get(cid, ())}
        visits_of_carer: dict[str, list[Booking]] = defaultdict(list)
        for b in bs:
            for n in b.carer_names:
                visits_of_carer[matches[n]].append(b)

        # --- carers
        carers: list[Carer] = []
        absences: list[Absence] = []
        not_planned: set[str] = set()
        notes: dict[str, list[str]] = {}
        planned_for_share: list[str] = []
        # time-critical visits (window 0) cannot move, so a carer must be able to travel there
        # before the visit: a block that nominally covers one is stretched by the travel time
        # it needs at either edge (at most PAD_MAX_MINUTES), as the trial padded locked visits
        critical = [
            (b, locs.get(b.client_id, centre)) for b in bs
            if (ss0 := settings.client(b.client_id)) and b.booking_type in ss0.time_critical_booking_types
        ]
        for cid in region_carers:
            sc = settings.carer(cid)
            ac = api_carer.get(cid)
            issues: list[str] = []
            # home
            pts = [locs[b.client_id] for b in visits_of_carer.get(cid, []) if b.client_id in locs] or list(locs.values())
            if ac and ac.geo_ok and min(
                distance_km(Location(ac.lat, ac.lon), Location(*p)) for p in pts) <= FAR_HOME_KM:
                home = (ac.lat, ac.lon)
            else:
                home = _centroid(pts) if pts else centre
                no_geo_carers.append(cid)
                no_geo_set.add(cid)
                issues.append("Home location unknown or too far away; a position near their clients was used for travel")
            mode_ = ac.mode if ac and ac.mode else None
            if mode_ is None:
                transport_defaulted.append(cid)
                mode_ = "car"
            # hours
            blocks: list[Block] = []
            is_guest = cid in guest_here
            other_days: set[int] = set()
            other_min = 0
            if not is_guest:
                for r2 in guest_of.get(cid, ()):
                    for b2 in visits_of_carer_all[cid][r2]:
                        other_days.add((b2.day - week_start).days)
                        other_min += b2.duration
            if is_guest:
                blocks = _merge_blocks([
                    Block((b2.day - week_start).days, max(0, b2.start - GUEST_PAD_MINUTES),
                          b2.start + b2.duration + GUEST_PAD_MINUTES)
                    for b2 in visits_of_carer[cid]])
                issues.append("Works mainly in another region: kept on their own visits here")
            elif sc is None:
                issues.append("Not in the settings file: no working hours, so not planned")
            elif not sc.active:
                issues.append("Not active in planning")
            elif not sc.has_hours() and not sc.available_any_time:
                issues.append("Marked not available and no working hours: not planned")
            else:
                any_time = not sc.has_hours()
                if any_time:
                    any_time_ids.append(cid)
                    issues.append("Available any time: their hours are chosen in the plan")
                for d in range(7):
                    if d in leave_days.get(cid, ()) or d in other_days:
                        continue
                    if any_time:
                        blocks.append(Block(d, 0, ANY_TIME_END))
                    else:
                        blocks += [Block(d, s, e) for s, e in sc.blocks(d)]
                n_padded = _pad_blocks(blocks, critical, week_start, Location(*home), mode_)
                if n_padded:
                    padded_blocks += n_padded
                    issues.append(f"Working hours stretched at the edge on {n_padded} block(s) so travel to a time-critical visit fits")
            if other_days and not is_guest:
                issues.append(
                    f"No default hours on {len(other_days)} day(s) when they have visits in another "
                    f"region; weekly maximum reduced by {other_min} min")
            if sc and sc.active and not sc.dbs_expiry:
                issues.append("DBS expiry not set: rule not checked")
            if sc and sc.active and not sc.training_expiry:
                issues.append("Training expiry not set: rule not checked")
            if sc and sc.active and sc.weekly_max_hours is None:
                issues.append("Weekly maximum not set: rule not checked")
            dbs = sc.dbs_expiry if sc and sc.dbs_expiry else NOT_CHECKED
            tr = sc.training_expiry if sc and sc.training_expiry else NOT_CHECKED
            if not blocks:
                not_planned.add(cid)
            elif not is_guest and dbs >= week_start and tr >= week_start:
                planned_for_share.append(cid)
            for d in sorted(leave_days.get(cid, ())):
                absences.append(Absence(cid, d, "annual_leave"))
            notes[cid] = issues
            carers.append(
                Carer(
                    id=cid, area=region, home=Location(*home), travel_mode=mode_,
                    skills=list(sc.skills) if sc else [],
                    gender=ac.gender if ac else "unknown",
                    contracted_minutes_week=0,
                    max_minutes_week=(
                        max(0, int(round(sc.weekly_max_hours * 60)) - other_min)
                        if sc and sc.weekly_max_hours else UNLIMITED_MINUTES),
                    dbs_expiry=dbs, training_expiry=tr, availability=blocks,
                )
            )
        total_minutes = sum(b.duration * b.expected for b in bs)
        share = int(round(total_minutes / max(1, len(planned_for_share))))
        for c in carers:
            c.contracted_minutes_week = share if c.id in planned_for_share else 0

        # --- clients
        present = {c.id for c in carers}
        current_by_client: dict[str, set[str]] = defaultdict(set)
        for b in bs:
            for n in b.carer_names:
                current_by_client[b.client_id].add(matches[n])
        clients: list[Client] = []
        for cid in client_ids:
            ss = settings.client(cid)
            if ss is None:
                clients_not_in_settings.add(client_ref.get(cid) or cid)
            if cid in locs:
                loc = locs[cid]
            else:
                loc = centre
                no_geo_clients.append(client_ref.get(cid) or cid)
            if report_recent is not None:
                recent = [k for k in report_recent.get(cid, []) if k in present]
            else:
                recent = sorted(k for k in current_by_client.get(cid, set()) if k in present)
            clients.append(
                Client(
                    id=cid, area=region, location=Location(*loc),
                    commissioned_minutes_week=sum(b.duration for b in bs if b.client_id == cid),
                    funder="council",
                    gender_preference=ss.gender_preference if ss else None,
                    do_not_send=list(ss.do_not_send) if ss else [],
                    safeguarding_bar=list(ss.safeguarding_bar) if ss else [],
                    recent_carers=recent,
                )
            )
        client_settings = {c.id: settings.client(c.id) for c in clients}

        # --- visits
        visits: list[Visit] = []
        meta: dict[str, VisitMeta] = {}
        current: dict[str, list[str]] = {}
        for b in sorted(bs, key=lambda b: (b.day, b.start, b.booking_id)):
            ss = client_settings[b.client_id]
            critical = bool(ss and b.booking_type in ss.time_critical_booking_types)
            cur = [matches[n] for n in b.carer_names]
            cur = list(dict.fromkeys(cur))
            current[b.booking_id] = cur
            lock_to = locks.get(b.booking_id)
            locked_carers: list[str] = []
            if lock_to:
                if lock_to not in present:
                    ignored_locks.add(b.booking_id)
                elif b.expected == 1:
                    locked_carers = [lock_to]
                else:
                    others = [k for k in cur if k != lock_to][: b.expected - 1]
                    if len(others) == b.expected - 1:
                        locked_carers = [lock_to, *others]
                    else:
                        ignored_locks.add(b.booking_id)
            guest_locked = bool(cur) and len(cur) >= b.expected and any(k in guest_here for k in cur)
            if guest_locked:
                locked_carers = list(cur)  # a guest keeps their own visits here
            reason = None
            if guest_locked:
                reason = "kept: carer's home area is elsewhere"
            elif locked_carers:
                reason = "locked by coordinator"
            elif critical:
                reason = "time-critical booking type"
            visits.append(
                Visit(
                    id=b.booking_id, client_id=b.client_id, day=(b.day - week_start).days,
                    start=b.start, window=0 if (critical or guest_locked) else window, duration=b.duration,
                    carers_needed=b.expected,
                    required_skills=list(ss.required_skills) if ss else [],
                    locked_carers=locked_carers, kind="care",
                    current_carers=cur if mode == "improve" else [],
                )
            )
            meta[b.booking_id] = VisitMeta(b, critical or bool(locked_carers), reason)

        problem = Problem(week_start, clients, carers, visits, absences, engine_settings())
        # real road travel for car trips if a local OSRM server is set up for this region; the same
        # provider scores the current rota, so the comparison stays fair. Otherwise the estimate.
        stand_ins = {c.location for c in clients if c.id not in locs}
        stand_ins |= {c.home for c in carers if c.id in no_geo_set}
        provider, rinfo = road_provider(
            region, [c.location for c in clients] + [c.home for c in carers if c.travel_mode == "car"], stand_ins)
        if provider is not None:
            problem.travel = provider
        routing_infos.append(rinfo)
        locked_outside += _lock_outside_hours(problem, meta, current)
        regions.append(
            RegionBuild(
                name=region, problem=problem, visit_meta=meta, client_ref=client_ref,
                carer_name={c.id: display[c.id] for c in carers}, current=current, routing=rinfo,
                not_planned=not_planned, carer_notes=notes,
                client_display={b.client_id: short_client_name(b.client_name) for b in bs},
            )
        )

    # ---- warnings from the build ----------------------------------------------------------------
    if no_geo_clients:
        warn("missing_address",
             f"{len(set(no_geo_clients))} client(s) have no geocoded address in CareLineLive, so travel to "
             f"them can't be estimated; a position near the team's other clients was used: "
             f"{_ids(sorted(set(no_geo_clients)))}.")
    if no_geo_carers:
        warn("carer_no_location",
             f"{len(set(no_geo_carers))} carer(s) have no usable home location, so a position near "
             f"their clients was used for travel: {_ids(sorted(set(no_geo_carers)))}.")
    if transport_defaulted:
        warn("transport_defaulted",
             f"{len(set(transport_defaulted))} carer(s) have no transport type in CareLineLive; "
             f"'car' was assumed: {_ids(sorted(set(transport_defaulted)))}.")
    if clients_not_in_settings and had_settings:
        warn("clients_not_in_settings",
             f"{len(clients_not_in_settings)} client(s) are not in the settings file, so they have "
             f"no rules (gender, do-not-send, skills, time-critical): {_ids(sorted(clients_not_in_settings))}.")
    if locked_outside:
        warn("locked_outside_hours",
             f"{locked_outside} booking(s) that the current rota staffs fall outside every allowed "
             "carer's working hours (for example nights), so they stay with their current carers, "
             f"with their availability stretched by {GUEST_PAD_MINUTES} minutes around each visit.")
    if padded_blocks:
        warn("hours_padded",
             f"{padded_blocks} working-hours block(s) were stretched by up to {PAD_MAX_MINUTES} minutes at "
             "the start or end, so a carer can travel to a time-critical visit at the edge of their shift.")
    if ignored_locks:
        warn("lock_ignored",
             f"{len(ignored_locks)} lock(s) could not be applied (unknown booking, carer not in "
             "that region, or a double-up whose other carers are not known).")
    notices: list[dict] = []
    if routing_infos:
        roads = [r.region for r in routing_infos if r.used]
        est = [r.region for r in routing_infos if not r.used]
        if roads and not est:
            text = "Travel: road routes (OpenStreetMap), worked out on this computer."
        elif roads:
            text = f"Travel: road routes for {', '.join(roads)}; estimated travel for {', '.join(est)}."
        else:
            text = "Travel: estimated (straight-line distance with an allowance for roads), not road routes."
        notices.append({"code": "travel_source", "message": text})
        down = [r.region for r in routing_infos if r.unavailable]
        if down:
            warn("routing_unavailable",
                 f"Road routes could not be used for {', '.join(down)} (the routing server did not answer), so "
                 "estimated travel was used there.")
        off = sum(r.partial_points for r in routing_infos)
        if off:
            warn("routing_partial",
                 f"{off} place(s) are too far from a mapped road (outside the map area), so estimated travel "
                 "was used for trips to or from them.")
    any_ids = sorted(set(any_time_ids))
    if any_ids:
        notices.append({
            "code": "available_any_time",
            "message": f"{len(any_ids)} carer(s) are available any time (no working hours set), so "
                       f"their hours are chosen in the plan: {_ids(any_ids)}."})
    return Build(week_start, regions, warnings, seconds, mode, notices)
