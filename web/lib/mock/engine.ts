// A small stand-in for the Python rota engine. It works on the made-up agency only and
// returns the same result shape as the real service (docs/ENGINE_API.md). It is a greedy
// allocator, not an optimiser: good enough to make the screens realistic.

import type {
  Change,
  Comparison,
  DayKey,
  Report,
  ReportCarer,
  ReportMetrics,
  ReportVisit,
  FillCheck,
  RouteStop,
  RunResult,
  RunWarning,
  SettingsFile,
  TimeNote,
} from "../types";
import { DAYS } from "../types";
import { hhmm, toMins } from "../time";
import { isAnyTime, settingsWarnings } from "../settings";
import { type FakeCarer, type FakeClient, type FakeVisit, getAgency, isoDate, rng } from "./agency";

const PENCE_PER_TRAVEL_MIN = 21;
const FILL_BONUS_PENCE = 5000;
const MOVE_WINDOW = 30;

interface Ctx {
  weekStart: string;
  carers: FakeCarer[];
  clients: FakeClient[];
  visits: FakeVisit[];
  carerById: Map<string, FakeCarer>;
  clientById: Map<string, FakeClient>;
  inactive: Set<string>;
  continuityPence: number;
  tolerance: number;
}

// Applies an uploaded settings file (when there is one) on top of the made-up agency.
function buildCtx(settings: SettingsFile | null): Ctx {
  const a = getAgency();
  const inactive = new Set<string>();
  const carers = a.carers.map((c) => {
    const s = settings?.carers.find((x) => x.id === c.id);
    if (!s) return c;
    if (!s.active) inactive.add(c.id);
    return {
      ...c,
      hours: isAnyTime(s) ? Object.fromEntries(DAYS.map((d) => [d, [{ start: "00:00", end: "24:00" }]])) : s.working_hours,
      skills: s.skills,
      weeklyMaxHours: s.weekly_max_hours ?? 60,
      dbsExpiry: s.dbs_expiry,
      trainingExpiry: s.training_expiry,
    };
  });
  const clients = a.clients.map((c) => {
    const s = settings?.clients.find((x) => x.id === c.id);
    if (!s) return c;
    return {
      ...c,
      genderPreference: s.gender_preference,
      doNotSend: s.do_not_send,
      safeguardingBar: s.safeguarding_bar,
      requiredSkills: s.required_skills,
      timeCriticalTypes: s.time_critical_booking_types,
    };
  });
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const visits = a.visits.map((v) => {
    const c = clientById.get(v.clientId)!;
    return {
      ...v,
      skills: c.requiredSkills,
      timeCritical: c.timeCriticalTypes.includes(v.bookingType),
    };
  });
  return {
    weekStart: a.weekStart,
    carers,
    clients,
    visits,
    carerById: new Map(carers.map((c) => [c.id, c])),
    clientById,
    inactive,
    continuityPence: settings?.agency.continuity_weight_pence ?? 1000,
    tolerance: settings?.agency.arrival_tolerance_minutes ?? 15,
  };
}

// ---------- geometry ----------

function miles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return (2 * R * Math.asin(Math.sqrt(h)) * 1.3) / 1.609; // straight line x road factor, in miles
}

function travelMinutes(mi: number): number {
  return mi <= 0 ? 0 : Math.round((mi * 60) / 25) + 2;
}

// ---------- rules ----------

function blocksFor(c: FakeCarer, day: number): [number, number][] {
  return (c.hours[DAYS[day]] ?? []).map((b) => {
    const s = toMins(b.start);
    let e = toMins(b.end);
    if (e <= s) e += 1440;
    return [s, e];
  });
}

function working(c: FakeCarer, day: number, start: number, end: number): boolean {
  return blocksFor(c, day).some(([s, e]) => start >= s && end <= e);
}

function eligible(ctx: Ctx, c: FakeCarer, v: FakeVisit): boolean {
  if (c.team !== v.team || ctx.inactive.has(c.id)) return false;
  const date = isoDate(ctx.weekStart, v.day);
  if (c.dbsExpiry && c.dbsExpiry < date) return false;
  if (c.trainingExpiry && c.trainingExpiry < date) return false;
  const cl = ctx.clientById.get(v.clientId)!;
  if (cl.doNotSend.includes(c.id) || cl.safeguardingBar.includes(c.id)) return false;
  if (cl.genderPreference && cl.genderPreference !== c.gender) return false;
  return v.skills.every((s) => c.skills.includes(s));
}

function windowFor(v: FakeVisit, window: number): number {
  return v.timeCritical || v.carersNeeded > 1 ? 0 : window;
}

interface Sim {
  starts: number[];
  travel: number[];
  miles: number[];
  travelTotal: number;
  shiftTotal: number;
}

function simulate(ctx: Ctx, c: FakeCarer, list: FakeVisit[], window: number): Sim | null {
  const out: Sim = { starts: [], travel: [], miles: [], travelTotal: 0, shiftTotal: 0 };
  let prevEnd = -Infinity;
  let prevLoc: { lat: number; lon: number } | null = null;
  for (const v of list) {
    const loc = ctx.clientById.get(v.clientId)!.loc;
    let mi = 0;
    let tm = 0;
    if (prevLoc && prevLoc !== loc) {
      mi = miles(prevLoc, loc);
      tm = travelMinutes(mi);
    }
    const earliest = prevLoc ? prevEnd + tm : -Infinity;
    const s = Math.max(v.start, earliest);
    if (s > v.start + windowFor(v, window)) return null;
    if (!working(c, v.day, s, s + v.duration)) return null;
    out.starts.push(s);
    out.travel.push(tm);
    out.miles.push(mi);
    out.travelTotal += tm;
    out.shiftTotal += s - v.start;
    prevEnd = s + v.duration;
    prevLoc = loc;
  }
  return out;
}

// ---------- allocation ----------

type Assign = Map<string, string[]>;

function listFor(ctx: Ctx, assign: Assign, carerId: string, day: number): FakeVisit[] {
  return ctx.visits
    .filter((v) => v.day === day && assign.get(v.id)?.includes(carerId))
    .sort((a, b) => a.start - b.start);
}

function loadOf(ctx: Ctx, assign: Assign, carerId: string): number {
  let m = 0;
  for (const v of ctx.visits) if (assign.get(v.id)?.includes(carerId)) m += v.duration;
  return m;
}

function familiar(ctx: Ctx, carerId: string, v: FakeVisit): boolean {
  return ctx.clientById.get(v.clientId)!.recentCarers.includes(carerId);
}

function overWeeklyMax(ctx: Ctx, assign: Assign, c: FakeCarer, extra: number): boolean {
  return loadOf(ctx, assign, c.id) + extra > c.weeklyMaxHours * 60;
}

function allocate(
  ctx: Ctx,
  kind: "engine" | "current",
  locks: Record<string, string>,
): Assign {
  const assign: Assign = new Map();
  const r = rng(kind === "current" ? 77 : 5);
  const window = kind === "engine" ? MOVE_WINDOW : 0;
  const order = [...ctx.visits].sort((a, b) => a.day - b.day || a.start - b.start);
  for (const v of order) {
    if (kind === "current" && r() < 0.06) continue; // not yet allocated by the coordinator
    const scored: { c: FakeCarer; score: number }[] = [];
    for (const c of ctx.carers) {
      if (!eligible(ctx, c, v)) continue;
      const list = listFor(ctx, assign, c.id, v.day);
      const before = simulate(ctx, c, list, window);
      const after = simulate(ctx, c, [...list, v].sort((a, b) => a.start - b.start), window);
      if (!before || !after) continue;
      if (overWeeklyMax(ctx, assign, c, v.duration)) continue;
      let score: number;
      if (kind === "engine") {
        score =
          (after.travelTotal - before.travelTotal) * PENCE_PER_TRAVEL_MIN -
          (familiar(ctx, c.id, v) ? ctx.continuityPence : 0) +
          loadOf(ctx, assign, c.id) * 0.4;
        if (locks[v.bookingId] === c.id) score -= 1e9;
      } else score = r() * 100;
      scored.push({ c, score });
    }
    scored.sort((a, b) => a.score - b.score);
    if (scored.length >= v.carersNeeded) assign.set(v.id, scored.slice(0, v.carersNeeded).map((s) => s.c.id));
  }
  return assign;
}

interface Applied {
  assign: Assign;
  reasons: Map<string, string>;
}

function improve(ctx: Ctx, current: Assign, changeCost: number, locks: Record<string, string>): Applied {
  const assign: Assign = new Map([...current].map(([k, v]) => [k, [...v]]));
  const reasons = new Map<string, string>();
  const done = new Set<string>();
  const order = [...ctx.visits].sort((a, b) => a.day - b.day || a.start - b.start);
  for (let pass = 0; pass < 4; pass++) {
    for (const v of order) {
      if (v.carersNeeded > 1 || done.has(v.id) || locks[v.bookingId]) continue;
      const curId = assign.get(v.id)?.[0];
      const cur = curId ? ctx.carerById.get(curId)! : null;
      const curList = cur ? listFor(ctx, assign, cur.id, v.day) : [];
      const curBefore = cur ? simulate(ctx, cur, curList, MOVE_WINDOW) : null;
      const curAfter = cur
        ? simulate(ctx, cur, curList.filter((x) => x.id !== v.id), MOVE_WINDOW)
        : null;
      let best: { c: FakeCarer; gain: number; parts: Record<string, number> } | null = null;
      for (const c of ctx.carers) {
        if (c.id === curId || !eligible(ctx, c, v) || overWeeklyMax(ctx, assign, c, v.duration)) continue;
        const list = listFor(ctx, assign, c.id, v.day);
        const before = simulate(ctx, c, list, MOVE_WINDOW);
        const after = simulate(ctx, c, [...list, v].sort((a, b) => a.start - b.start), MOVE_WINDOW);
        if (!before || !after) continue;
        const travelSavedMin =
          (curBefore?.travelTotal ?? 0) - (curAfter?.travelTotal ?? 0) - (after.travelTotal - before.travelTotal);
        const shiftCost = Math.max(0, after.shiftTotal - before.shiftTotal) * 15;
        const parts: Record<string, number> = {
          fill: cur ? 0 : FILL_BONUS_PENCE,
          travel: travelSavedMin * PENCE_PER_TRAVEL_MIN - shiftCost,
          familiar:
            (familiar(ctx, c.id, v) ? ctx.continuityPence : 0) - (cur && familiar(ctx, cur.id, v) ? ctx.continuityPence : 0),
          balance: 0,
        };
        if (cur) {
          const diff = loadOf(ctx, assign, cur.id) - loadOf(ctx, assign, c.id);
          parts.balance = diff > 240 ? 250 : diff < -240 ? -250 : 0;
        }
        const gain = parts.fill + parts.travel + parts.familiar + parts.balance;
        if (!best || gain > best.gain) best = { c, gain, parts };
      }
      if (best && best.gain > changeCost) {
        assign.set(v.id, [best.c.id]);
        done.add(v.id);
        const bits: [string, number][] = [];
        if (best.parts.fill) bits.push(["fills unallocated booking", best.parts.fill]);
        if (best.parts.familiar > 0) bits.push(["familiar carer", best.parts.familiar]);
        if (best.parts.travel > 0) {
          bits.push([`saves ${Math.max(1, Math.round(best.parts.travel / PENCE_PER_TRAVEL_MIN))} min travel`, best.parts.travel]);
        }
        if (best.parts.balance > 0) bits.push(["evens hours", best.parts.balance]);
        bits.sort((a, b) => b[1] - a[1]);
        reasons.set(v.id, bits.slice(0, 2).map((b) => b[0]).join(", ") || "saves travel");
      }
    }
  }
  return { assign, reasons };
}

// ---------- solution -> report ----------

interface Solution {
  assign: Assign;
  start: Map<string, number>; // visit id -> actual start (assigned visits only)
  stops: Map<string, Partial<Record<DayKey, RouteStop[]>>>;
  travelMin: Map<string, number>;
  milesBy: Map<string, number>;
}

function finalise(ctx: Ctx, assign: Assign, window: number): Solution {
  const start = new Map<string, number>();
  const stops = new Map<string, Partial<Record<DayKey, RouteStop[]>>>();
  const travelMin = new Map<string, number>();
  const milesBy = new Map<string, number>();
  for (const c of ctx.carers) {
    for (let d = 0; d < 7; d++) {
      const list = listFor(ctx, assign, c.id, d);
      if (!list.length) continue;
      const sim = simulate(ctx, c, list, window) ?? simulate(ctx, c, list, 120);
      if (!sim) continue;
      const route: RouteStop[] = list.map((v, i) => {
        start.set(v.id, sim.starts[i]);
        return {
          visit_id: v.id,
          client_id: v.clientId,
          start: sim.starts[i],
          end: sim.starts[i] + v.duration,
          travel_before: sim.travel[i],
          miles_before: Math.round(sim.miles[i] * 100) / 100,
          shared_with: (assign.get(v.id) ?? []).filter((x) => x !== c.id),
        };
      });
      const byDay = stops.get(c.id) ?? {};
      byDay[DAYS[d]] = route;
      stops.set(c.id, byDay);
      travelMin.set(c.id, (travelMin.get(c.id) ?? 0) + sim.travelTotal);
      milesBy.set(c.id, (milesBy.get(c.id) ?? 0) + sim.miles.reduce((a, b) => a + b, 0));
    }
  }
  return { assign, start, stops, travelMin, milesBy };
}

const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

function metricsFor(
  ctx: Ctx,
  sol: Solution,
  visits: FakeVisit[],
  carers: FakeCarer[],
  moved: number,
): ReportMetrics {
  const filled = visits.filter((v) => sol.assign.has(v.id));
  const care = filled.reduce((a, v) => a + v.duration * v.carersNeeded, 0);
  const trav = carers.reduce((a, c) => a + (sol.travelMin.get(c.id) ?? 0), 0);
  const mi = carers.reduce((a, c) => a + (sol.milesBy.get(c.id) ?? 0), 0);
  const cont = filled.filter((v) => sol.assign.get(v.id)!.every((id) => familiar(ctx, id, v))).length;
  const planned = carers.filter((c) => !ctx.inactive.has(c.id) && DAYS.some((_, d) => blocksFor(c, d).length > 0));
  const hours = planned
    .map((c) => (loadOf(ctx, sol.assign, c.id) + (sol.travelMin.get(c.id) ?? 0)) / 60)
    .sort((a, b) => a - b);
  const mean = hours.reduce((a, b) => a + b, 0) / (hours.length || 1);
  const sd = Math.sqrt(hours.reduce((a, b) => a + (b - mean) ** 2, 0) / (hours.length || 1));
  const mid = hours.length ? (hours[Math.floor((hours.length - 1) / 2)] + hours[Math.ceil((hours.length - 1) / 2)]) / 2 : 0;
  return {
    visits: visits.length,
    filled: filled.length,
    unfilled: visits.length - filled.length,
    fill_rate: round(filled.length / (visits.length || 1), 3),
    care_hours: round(care / 60),
    travel_hours: round(trav / 60),
    miles: round(mi),
    continuity_rate: round(cont / (filled.length || 1), 3),
    hours_min: round(hours[0] ?? 0),
    hours_median: round(mid),
    hours_max: round(hours[hours.length - 1] ?? 0),
    hours_stdev: round(sd),
    visits_moved: moved,
  };
}

type Cause = "rules" | "hours" | "weekly_max" | "travel_or_booked";

function explainUnfilled(ctx: Ctx, assign: Assign, v: FakeVisit): { reason: string; detail: string[]; cause: Cause } {
  const teamCarers = ctx.carers.filter((c) => c.team === v.team && !ctx.inactive.has(c.id));
  const ok = teamCarers.filter((c) => eligible(ctx, c, v));
  if (ok.length < v.carersNeeded) {
    return { cause: "rules", reason: "No carer meets the rules for this client (skills, gender preference, do-not-send, DBS or training).", detail: [] };
  }
  const there = ok.filter((c) => working(c, v.day, v.start, v.start + v.duration));
  if (there.length < v.carersNeeded) return { cause: "hours", reason: "No suitable carer is working at this time.", detail: [] };
  const detail: string[] = [];
  for (const c of there) {
    const clash = listFor(ctx, assign, c.id, v.day).find((x) => x.start < v.start + v.duration && x.start + x.duration > v.start);
    if (clash) {
      const cl = ctx.clientById.get(clash.clientId)!;
      detail.push(`${c.name} busy ${hhmm(clash.start)}-${hhmm(clash.start + clash.duration)} with ${cl.name}`);
    } else if (overWeeklyMax(ctx, assign, c, v.duration)) {
      detail.push(`${c.name} is at the weekly maximum`);
    } else detail.push(`${c.name} is too far from the previous visit to arrive in time`);
  }
  const n = there.length;
  const allMax = there.every((c) => overWeeklyMax(ctx, assign, c, v.duration) && !listFor(ctx, assign, c.id, v.day).some((x) => x.start < v.start + v.duration && x.start + x.duration > v.start));
  return {
    cause: allMax ? "weekly_max" : "travel_or_booked",
    reason: `${n} suitable carer${n > 1 ? "s" : ""} working, but ${n > 1 ? "all are" : "they are"} booked or too far away at this time${v.carersNeeded > 1 ? " (needs 2 carers)" : ""}.`,
    detail: detail.slice(0, 3),
  };
}

const FAKE_SURNAMES = ["Alder", "Birch", "Cedar", "Dogwood", "Elm", "Fir", "Gorse", "Hazel", "Ivy", "Juniper", "Kale", "Larch", "Maple", "Nettle", "Oak"];
function displayName(c: FakeClient): string {
  const n = Number(c.id.slice(1)) - 1;
  return `${FAKE_SURNAMES[n % FAKE_SURNAMES.length]}, ${String.fromCharCode(65 + (n % 26))}`;
}

function classOf(ctx: Ctx, v: FakeVisit, sol: Solution, cur: Solution, assigned: string[]): ReportVisit["change_class"] {
  if (!assigned.length) return null;
  const a = assigned.slice().sort().join();
  const b = (cur.assign.get(v.id) ?? []).slice().sort().join();
  if (a !== b) return "carer";
  const shift = Math.abs((sol.start.get(v.id) ?? v.start) - v.start);
  if (shift === 0) return "unchanged";
  return shift <= ctx.tolerance ? "time_within_tolerance" : "time_note";
}

function reportFor(ctx: Ctx, team: string, sol: Solution, cur: Solution, locks: Record<string, string>): Report {
  const carers = ctx.carers.filter((c) => c.team === team);
  const visits = ctx.visits.filter((v) => v.team === team);
  const reportCarers: ReportCarer[] = carers.map((c) => ({
    id: c.id,
    name: c.name,
    area: c.team,
    gender: c.gender,
    skills: c.skills,
    contracted_minutes: Math.round(c.weeklyMaxHours * 60 * 0.7),
    max_minutes: c.weeklyMaxHours * 60,
    scheduled_minutes: loadOf(ctx, sol.assign, c.id),
    travel_minutes: sol.travelMin.get(c.id) ?? 0,
    miles: round(sol.milesBy.get(c.id) ?? 0),
    travel_mode: c.id === "K004" ? "walk" : "car",
    availability: DAYS.flatMap((_, day) => blocksFor(c, day).map(([s, e]) => ({ day, start: s, end: Math.min(e, 1440) }))),
    issues: [],
  }));
  const movedOf = (v: FakeVisit) => {
    const a = (sol.assign.get(v.id) ?? []).slice().sort().join();
    const b = (cur.assign.get(v.id) ?? []).slice().sort().join();
    return a !== b || (sol.start.has(v.id) && sol.start.get(v.id) !== v.start);
  };
  const reportVisits: ReportVisit[] = visits.map((v) => {
    const assigned = sol.assign.get(v.id) ?? [];
    const un = assigned.length ? null : explainUnfilled(ctx, sol.assign, v);
    return {
      id: v.id,
      booking_id: v.bookingId,
      client_id: v.clientId,
      day: v.day,
      preferred_start: v.start,
      window: v.timeCritical ? 0 : MOVE_WINDOW,
      duration: v.duration,
      carers_needed: v.carersNeeded,
      kind: "care",
      booking_type: v.bookingType,
      assigned,
      start: assigned.length ? (sol.start.get(v.id) ?? v.start) : null,
      current_assigned: cur.assign.get(v.id) ?? [],
      moved: movedOf(v),
      locked: v.timeCritical || Boolean(locks[v.bookingId]),
      lock_reason: locks[v.bookingId] ? "locked by coordinator" : v.timeCritical ? "time-critical booking type" : null,
      unfilled_cause: un?.cause ?? null,
      change_class: classOf(ctx, v, sol, cur, assigned),
      unfilled_reason: un?.reason ?? null,
      unfilled_detail: un?.detail ?? [],
    };
  });
  const routes: Report["routes"] = {};
  const currentRoutes: Report["routes"] = {};
  carers.forEach((c) => {
    if (sol.stops.has(c.id)) routes[c.id] = sol.stops.get(c.id)!;
    if (cur.stops.has(c.id)) currentRoutes[c.id] = cur.stops.get(c.id)!;
  });
  return {
    week_start: ctx.weekStart,
    days: [...DAYS],
    metrics: metricsFor(ctx, sol, visits, carers, reportVisits.filter((v) => v.moved).length),
    carers: reportCarers,
    clients: ctx.clients
      .filter((c) => c.team === team)
      .map((c) => ({ id: c.id, ref: c.ref, display_name: displayName(c), area: c.team, recent_carers: c.recentCarers })),
    visits: reportVisits,
    routes,
    current_routes: currentRoutes,
  };
}

function fillCheck(ctx: Ctx, sol: Solution, cur: Solution): FillCheck {
  const fc: FillCheck = {
    unfilled: 0, because_rules: 0, because_hours: 0, because_weekly_max: 0, because_travel_or_booked: 0,
    unfilled_but_filled_in_current_rota: 0, current_rota_fully_staffed: 0, current_rota_feasible: 0,
  };
  const feasible = (v: FakeVisit) =>
    (cur.assign.get(v.id) ?? []).every((id) => {
      const c = ctx.carerById.get(id)!;
      return eligible(ctx, c, v) && working(c, v.day, v.start, v.start + v.duration);
    });
  for (const v of ctx.visits) {
    const curStaffed = (cur.assign.get(v.id)?.length ?? 0) >= v.carersNeeded;
    if (curStaffed) {
      fc.current_rota_fully_staffed++;
      if (feasible(v)) fc.current_rota_feasible++;
    }
    if (sol.assign.has(v.id)) continue;
    fc.unfilled++;
    const cause = explainUnfilled(ctx, sol.assign, v).cause;
    fc[`because_${cause}`]++;
    if (curStaffed) fc.unfilled_but_filled_in_current_rota++;
  }
  return fc;
}

export interface MockParams {
  mode: "new" | "improve";
  changeCostPence: number;
  settings: SettingsFile | null;
  locks: Record<string, string>;
}

export function runMock(p: MockParams): RunResult {
  const ctx = buildCtx(p.settings);
  const currentAssign = allocate(ctx, "current", {});
  const cur = finalise(ctx, currentAssign, 0);

  let finalAssign: Assign;
  let reasons = new Map<string, string>();
  if (p.mode === "new") finalAssign = allocate(ctx, "engine", p.locks);
  else {
    const a = improve(ctx, currentAssign, p.changeCostPence, p.locks);
    finalAssign = a.assign;
    reasons = a.reasons;
  }
  const sol = finalise(ctx, finalAssign, MOVE_WINDOW);

  const teams = [...new Set(ctx.carers.map((c) => c.team))];
  const teamReports: Record<string, Report> = {};
  for (const t of teams) teamReports[t] = reportFor(ctx, t, sol, cur, p.locks);

  const allMoved = Object.values(teamReports).reduce((a, r) => a + r.metrics.visits_moved, 0);
  const comparison: Comparison = {
    engine: metricsFor(ctx, sol, ctx.visits, ctx.carers, allMoved),
    current: metricsFor(ctx, cur, ctx.visits, ctx.carers, 0),
  };

  const changes: Change[] = [];
  const timeNotes: TimeNote[] = [];
  if (p.mode === "improve") {
    const name = (id: string) => ctx.carerById.get(id)!.name;
    for (const v of [...ctx.visits].sort((a, b) => a.day - b.day || a.start - b.start)) {
      const before = (cur.assign.get(v.id) ?? []).slice().sort().join();
      const after = (sol.assign.get(v.id) ?? []).slice().sort().join();
      const actual = sol.start.get(v.id);
      const cl = ctx.clientById.get(v.clientId)!;
      if (before !== after) {
        const shifted = actual != null && actual - v.start > ctx.tolerance;
        changes.push({
          booking_id: v.bookingId,
          client_ref: cl.ref,
          date: isoDate(ctx.weekStart, v.day),
          booked_start: hhmm(v.start),
          new_start: shifted ? hhmm(actual) : null,
          from_carers: (cur.assign.get(v.id) ?? []).map(name),
          to_carers: (sol.assign.get(v.id) ?? []).map(name),
          new_time_needed: shifted,
          forced_by_rules: false,
          kind: shifted ? "time_with_change" : "carer",
          reason: reasons.get(v.id) ?? "saves travel",
        });
      } else if (actual != null && actual !== v.start) {
        timeNotes.push({
          booking_id: v.bookingId,
          client_ref: cl.ref,
          date: isoDate(ctx.weekStart, v.day),
          carer: (sol.assign.get(v.id) ?? []).map(name).join(" + "),
          booked_start: hhmm(v.start),
          new_start: hhmm(actual),
          kind: Math.abs(actual - v.start) <= ctx.tolerance ? "time_within_tolerance" : "time_note",
          within_tolerance: Math.abs(actual - v.start) <= ctx.tolerance,
          reason:
            Math.abs(actual - v.start) <= ctx.tolerance
              ? `Same carer; ${actual - v.start} min later, within the ${ctx.tolerance} min limit for small time changes. No edit needed.`
              : `Same carer; ${actual - v.start} min later to fit the travel estimate. Check the gap.`,
        });
      }
    }
  }

  const warnings: RunWarning[] = p.settings
    ? settingsWarnings(p.settings, ctx.weekStart)
    : [
        {
          code: "no_settings",
          message:
            "No settings file was uploaded. The mock used its built-in made-up carers and rules; DBS, training and other rules are not checked from your data.",
        },
      ];
  const fcheck = fillCheck(ctx, sol, cur);
  if (fcheck.current_rota_feasible < fcheck.current_rota_fully_staffed) {
    warnings.push({
      code: "current_rota_not_feasible",
      message: `${fcheck.current_rota_fully_staffed - fcheck.current_rota_feasible} booking(s) filled in the current rota would not be kept under our rules and travel estimates.`,
    });
  }
  const unfilled = comparison.engine.unfilled;
  if (unfilled > 0) {
    warnings.push({ code: "unallocated", message: `${unfilled} booking(s) could not be allocated; see Unallocated bookings.` });
  }

  return {
    mode: p.mode,
    change_cost_pence: p.mode === "improve" ? p.changeCostPence : null,
    teams: teamReports,
    comparison,
    changes,
    time_notes: timeNotes,
    arrival_tolerance_minutes: ctx.tolerance,
    fill_check: fillCheck(ctx, sol, cur),
    change_summary:
      p.mode === "improve"
        ? {
            total: changes.length,
            forced_by_rules: 0,
            fills_unallocated: changes.filter((c) => c.from_carers.length === 0).length,
            for_travel_continuity_hours: changes.filter((c) => c.from_carers.length > 0).length,
            new_time_needed: changes.filter((c) => c.new_time_needed).length,
            time_notes: timeNotes.filter((n) => n.kind === "time_note").length,
            time_within_tolerance: timeNotes.filter((n) => n.kind === "time_within_tolerance").length,
          }
        : null,
    warnings,
  };
}

export interface SampleBookingRow {
  bookingId: string;
  clientId: string;
  clientRef: string;
  date: string;
  start: string;
  end: string;
  bookingType: string;
  team: string;
  expected: number;
  allocatedNames: string[];
}

// The made-up "current rota" as booking rows, for the sample bookings CSV.
export function sampleBookingRows(): SampleBookingRow[] {
  const ctx = buildCtx(null);
  const cur = allocate(ctx, "current", {});
  return ctx.visits.map((v) => ({
    bookingId: v.bookingId,
    clientId: v.clientId,
    clientRef: ctx.clientById.get(v.clientId)!.ref,
    date: isoDate(ctx.weekStart, v.day),
    start: hhmm(v.start),
    end: hhmm(v.start + v.duration),
    bookingType: v.bookingType,
    team: v.team,
    expected: v.carersNeeded,
    // Carer H is written differently in the bookings file so the name-matching step has work to do.
    allocatedNames: (cur.get(v.id) ?? []).map((id) => (id === "K008" ? "Carer H (Dorset)" : ctx.carerById.get(id)!.name)),
  }));
}
