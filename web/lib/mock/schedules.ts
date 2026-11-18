// The mock's side of client schedules: made-up past bookings and a client list to learn from,
// the learning itself, the visits of a draft week, and the check of a draft against the real
// bookings. Everything here is made up; it only has to behave like the contract
// (docs/ENGINE_API.md) closely enough to build the screens.

import { parseCsv, toCsv } from "../csv";
import { addDays, hhmm, toMins } from "../time";
import { DAYS, type DraftCheck, type DraftCheckItem, type LearnResult, type OneOffVisit, type ScheduleFlag, type ScheduleVisit, type SettingsFile } from "../types";
import { getAgency, isoDate, type FakeVisit } from "./agency";
import { clientDisplayName } from "./engine";

const nameOf = (id: string): { client_ref: string; display_name?: string } => {
  const c = getAgency().clients.find((x) => x.id === id);
  return c ? { client_ref: c.ref, display_name: clientDisplayName(c) } : { client_ref: "" };
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const weekNo = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / (7 * 86400000));
const mondayOf = (iso: string) => addDays(iso, -((new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7));

// Client ids that a client list CSV marks as suspended (matched by reference code or id).
export async function suspendedFromList(list: File | null): Promise<Set<string>> {
  const out = new Set<string>();
  if (!list) return out;
  const rows = parseCsv(await list.text());
  const header = (rows[0] ?? []).map(norm);
  const si = header.indexOf("clientsuspended");
  const ri = header.indexOf("clientreferencecode");
  const ci = header.indexOf("clientid");
  if (si < 0) return out;
  const a = getAgency();
  for (const r of rows.slice(1)) {
    if (!["true", "yes", "1"].includes((r[si] ?? "").trim().toLowerCase())) continue;
    const ref = ri >= 0 ? (r[ri] ?? "").trim() : "";
    const id = ci >= 0 ? (r[ci] ?? "").trim() : "";
    const c = a.clients.find((x) => x.ref === ref || x.id === id);
    if (c) out.add(c.id);
  }
  return out;
}

function parseDate(s: string): string | null {
  const t = s.trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}
const dmy = (iso: string) => iso.split("-").reverse().join("/");

// ---------- made-up past bookings (4 weeks before the made-up week) ----------

export const LEARN_WEEKS = 4;

const HEAD = [
  "BookingId", "ClientId", "Date", "Start", "Finish", "Duration", "ConfirmedDuration", "DurationVarianceSeconds", "BookingType",
  "ClientName", "ClientReferenceCode", "ExpectedCarers", "AllocatedCarers", "Carers", "Status", "CarerNotes", "IsCancelled",
  "CancellationReason", "CancellationCharged", "OriginalStart", "OriginalFinish", "OriginalDuration", "HasBeenInvoiced",
  "ServiceContract", "ServiceContractType", "Unplanned", "Team",
];

// Week 1 is the oldest. Made-up quirks, so the screens have something to show: one client has a
// tea visit every other week, one has a single extra lunch, one has no bookings at all.
export function sampleLearnBookingsCsv(week: number): { name: string; csv: string } {
  const a = getAgency();
  const monday = addDays(a.weekStart, -7 * (LEARN_WEEKS - week + 1));
  const rows: (string | number)[][] = [];
  let n = 0;
  a.visits.forEach((v) => {
    const idx = a.clients.findIndex((c) => c.id === v.clientId);
    if (idx === 12) return; // no bookings in the weeks
    if (idx === 4 && v.bookingType === "Tea Visit" && week % 2 === 0) return; // every other week
    n++;
    const c = a.clients[idx];
    const start = `${hhmm(v.start)}:00`;
    const finish = `${hhmm(v.start + v.duration)}:00`;
    const d = `${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, "0")}`;
    rows.push([`L${week}${String(n).padStart(3, "0")}`, c.id, dmy(isoDate(monday, v.day)), start, finish, d, "", "", v.bookingType, `Client ${c.id.slice(1)}`, c.ref, v.carersNeeded, v.carersNeeded, "", "Scheduled", "", "False", "", "", start, finish, d, "False", "Made-up contract", "Private", "False", c.team]);
  });
  if (week === 2) {
    const c = a.clients[2];
    rows.push([`L2X01`, c.id, dmy(isoDate(monday, 2)), "13:00:00", "13:30:00", "0:30", "", "", "Lunch Visit", `Client ${c.id.slice(1)}`, c.ref, 1, 1, "", "Scheduled", "", "False", "", "", "13:00:00", "13:30:00", "0:30", "False", "Made-up contract", "Private", "False", c.team]);
  }
  return { name: `sample-past-bookings-${dmy(monday).replace(/\//g, "-")}.csv`, csv: toCsv([HEAD, ...rows]) };
}

// A made-up client list: one client suspended, one whose schedule changed recently.
export function sampleClientListCsv(): string {
  const a = getAgency();
  const rows = a.clients.map((c, i) => [
    c.id,
    c.ref,
    dmy(i === 7 ? addDays(a.weekStart, -3) : addDays(a.weekStart, -90)),
    i === 11 ? "True" : "False",
  ]);
  return toCsv([["ClientId", "ClientReferenceCode", "LastScheduleUpdate", "ClientSuspended"], ...rows]);
}

// ---------- learning ----------

interface Occ {
  clientId: string;
  ref: string;
  week: number; // week number, for gaps
  monday: string;
  date: string;
  day: (typeof DAYS)[number];
  start: string;
  dur: number;
  type: string;
  carers: number;
}

export async function learnFromFiles(files: File[], clientList: File | null, settings: SettingsFile | null): Promise<LearnResult | string> {
  const occ: Occ[] = [];
  for (const f of files) {
    const rows = parseCsv(await f.text());
    const header = (rows[0] ?? []).map(norm);
    const col = (n: string) => header.indexOf(norm(n));
    const need = ["ClientId", "Date", "Start", "Duration", "BookingType", "ExpectedCarers", "IsCancelled"];
    const missing = need.filter((n) => col(n) < 0);
    if (missing.length) return `A bookings file is missing column(s): ${missing.join(", ")}.`;
    for (const r of rows.slice(1)) {
      if (["true", "yes", "1"].includes((r[col("IsCancelled")] ?? "").trim().toLowerCase())) continue;
      const date = parseDate(r[col("Date")] ?? "");
      if (!date) continue;
      const dm = /^(\d+):(\d+)/.exec((r[col("Duration")] ?? "").trim());
      const monday = mondayOf(date);
      occ.push({
        clientId: (r[col("ClientId")] ?? "").trim(),
        ref: col("ClientReferenceCode") >= 0 ? (r[col("ClientReferenceCode")] ?? "").trim() : "",
        week: weekNo(monday),
        monday,
        date,
        day: DAYS[(new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7],
        start: hhmm(toMins((r[col("Start")] ?? "").trim())),
        dur: dm ? Number(dm[1]) * 60 + Number(dm[2]) : 30,
        type: (r[col("BookingType")] ?? "").trim(),
        carers: Math.max(1, Number(r[col("ExpectedCarers")]) || 1),
      });
    }
  }
  if (occ.length === 0) return "The bookings files have no live booking rows.";
  const weeks = [...new Set(occ.map((o) => o.monday))].sort();

  const oneOffs: OneOffVisit[] = [];
  const schedules: LearnResult["schedules"] = {};
  const refOf = new Map<string, string>();
  const byClient = new Map<string, Occ[]>();
  occ.forEach((o) => {
    byClient.set(o.clientId, [...(byClient.get(o.clientId) ?? []), o]);
    if (o.ref) refOf.set(o.clientId, o.ref);
  });
  const now = new Date().toISOString();
  for (const [clientId, list] of byClient) {
    const keys = new Map<string, Occ[]>();
    list.forEach((o) => {
      const k = `${o.day}|${o.start}|${o.dur}|${o.type}|${o.carers}`;
      keys.set(k, [...(keys.get(k) ?? []), o]);
    });
    const merged = new Map<string, ScheduleVisit>();
    for (const group of keys.values()) {
      const first = group[0];
      const present = [...new Set(group.map((o) => o.week))].sort((x, y) => x - y);
      let repeat: "weekly" | "fortnightly" = "weekly";
      let anchor: string | null = null;
      if (weeks.length > 1 && present.length === 1) {
        group.forEach((o) => oneOffs.push({ client_id: clientId, ...nameOf(clientId), date: o.date, start: o.start, duration_min: o.dur, booking_type: o.type }));
        continue;
      }
      if (weeks.length > 1 && present.length >= 2 && present.length < weeks.length && present.every((w, i) => i === 0 || w - present[i - 1] === 2)) {
        repeat = "fortnightly";
        anchor = group.find((o) => o.week === present[0])!.monday;
      }
      const mk = `${first.start}|${first.dur}|${first.type}|${first.carers}|${repeat}|${anchor ?? ""}`;
      const existing = merged.get(mk);
      if (existing) existing.days.push(first.day);
      else
        merged.set(mk, {
          id: "",
          days: [first.day],
          start: first.start,
          duration_min: first.dur,
          booking_type: first.type,
          carers_needed: first.carers,
          repeat,
          fortnight_anchor: anchor,
        });
    }
    const visits = [...merged.values()]
      .map((v) => ({ ...v, days: DAYS.filter((d) => v.days.includes(d)) }))
      .sort((x, y) => x.start.localeCompare(y.start))
      .map((v, i) => ({ ...v, id: `${clientId}-v${i + 1}` }));
    if (visits.length) {
      schedules[clientId] = { client_ref: refOf.get(clientId) ?? nameOf(clientId).client_ref, display_name: nameOf(clientId).display_name, confirmed: false, learned_from: weeks, updated_at: now, visits };
    }
  }

  const flags: ScheduleFlag[] = [];
  const listed = new Map<string, { ref: string; updated: string | null; suspended: boolean }>();
  if (clientList) {
    const rows = parseCsv(await clientList.text());
    const header = (rows[0] ?? []).map(norm);
    const ci = header.indexOf("clientid");
    const ri = header.indexOf("clientreferencecode");
    const ui = header.indexOf("lastscheduleupdate");
    const si = header.indexOf("clientsuspended");
    if (ci < 0) return "The client list needs a ClientId column.";
    rows.slice(1).forEach((r) =>
      listed.set((r[ci] ?? "").trim(), {
        ref: ri >= 0 ? (r[ri] ?? "").trim() : "",
        updated: ui >= 0 ? parseDate(r[ui] ?? "") : null,
        suspended: si >= 0 && ["true", "yes", "1"].includes((r[si] ?? "").trim().toLowerCase()),
      }),
    );
  }
  const NONE = "No bookings in the weeks uploaded";
  for (const [id, c] of listed) {
    const who = { client_id: id, ...nameOf(id), client_ref: c.ref || nameOf(id).client_ref };
    if (c.suspended) flags.push({ ...who, kind: "suspended", detail: "Suspended in CareLineLive – left out" });
    else if (c.updated && c.updated > weeks[0]) flags.push({ ...who, kind: "changed", detail: `Schedule changed in CareLineLive on ${dmy(c.updated)} – check their visits` });
    if (!c.suspended && !byClient.has(id)) flags.push({ ...who, kind: "no_bookings_in_period", detail: NONE });
  }
  if (!clientList) {
    (settings?.clients ?? []).filter((c) => !byClient.has(c.id)).forEach((c) => flags.push({ client_id: c.id, ...nameOf(c.id), client_ref: c.ref, kind: "no_bookings_in_period", detail: NONE }));
  }
  oneOffs.sort((x, y) => x.date.localeCompare(y.date) || x.start.localeCompare(y.start));
  const visitCount = Object.values(schedules).reduce((a, s) => a + s.visits.length, 0);
  const fortnightly = Object.values(schedules).reduce((a, s) => a + s.visits.filter((v) => v.repeat === "fortnightly").length, 0);
  return {
    weeks,
    schedules,
    one_offs: oneOffs,
    flags,
    counts: { weeks: weeks.length, bookings: occ.length, clients: byClient.size, schedules: Object.keys(schedules).length, visits: visitCount, weekly: visitCount - fortnightly, fortnightly, one_offs: oneOffs.length, flags: flags.length },
  };
}

// ---------- a draft week from schedules ----------

const weekIndex = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / (7 * 86400000));
function happens(v: ScheduleVisit, weekStart: string): boolean {
  if (v.repeat !== "fortnightly" || !v.fortnight_anchor) return true;
  return (((weekIndex(weekStart) - weekIndex(v.fortnight_anchor)) % 2) + 2) % 2 === 0;
}

export interface DraftVisits {
  visits: FakeVisit[];
  confirmed: number;
  unconfirmed: number;
  missing: number;
  suspended: number;
}

export function visitsFromSchedules(weekStart: string, settings: SettingsFile | null, suspendedIds: Set<string>): DraftVisits {
  const a = getAgency();
  const out: DraftVisits = { visits: [], confirmed: 0, unconfirmed: 0, missing: 0, suspended: 0 };
  let n = 0;
  for (const c of a.clients) {
    if (suspendedIds.has(c.id)) {
      out.suspended++;
      continue;
    }
    const s = settings?.client_schedules?.[c.id];
    if (!s || s.visits.length === 0) {
      out.missing++;
      continue;
    }
    if (!s.confirmed) {
      out.unconfirmed++;
      continue; // only confirmed schedules are planned
    }
    out.confirmed++;
    for (const v of s.visits) {
      if (!happens(v, weekStart)) continue;
      for (const d of v.days) {
        n++;
        const type = v.booking_type;
        out.visits.push({
          id: `DRAFT-${c.id}-${v.id}-${d}`,
          bookingId: `DRAFT${n}`,
          clientId: c.id,
          team: c.team,
          day: DAYS.indexOf(d),
          start: toMins(v.start),
          duration: v.duration_min,
          carersNeeded: v.carers_needed,
          bookingType: type,
          skills: c.requiredSkills,
          timeCritical: c.timeCriticalTypes.includes(type),
        });
      }
    }
  }
  return out;
}

// ---------- checking a draft against the real bookings ----------

// The mock always plans its own made-up bookings, so those are the "real" bookings here.
export async function checkDraft(draft: File): Promise<DraftCheck | string> {
  const a = getAgency();
  const rows = parseCsv(await draft.text());
  const header = (rows[0] ?? []).map(norm);
  const col = (n: string) => header.indexOf(norm(n));
  const need = ["Date", "Start", "Client", "Bookingtype"];
  if (need.some((n) => col(n) < 0)) return "The draft file is not an allocation.csv exported from a draft plan (columns missing).";
  const byDisplay = new Map(a.clients.flatMap((c) => [[clientDisplayName(c), c] as const, [c.ref, c] as const]));
  const draftKeys = new Map<string, { start: string; ref: string; type: string; day: number }>();
  for (const r of rows.slice(1)) {
    const date = parseDate(r[col("Date")] ?? "");
    const client = byDisplay.get((r[col("Client")] ?? "").trim());
    if (!date || !client) continue;
    const day = (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
    const type = (r[col("Bookingtype")] ?? "").trim();
    draftKeys.set(`${client.id}|${day}|${type}`, { start: (r[col("Start")] ?? "").trim().slice(0, 5), ref: client.ref, type, day });
  }
  let matched = 0;
  const added: DraftCheckItem[] = [];
  const removed: DraftCheckItem[] = [];
  const retimed: DraftCheckItem[] = [];
  const seen = new Set<string>();
  for (const v of a.visits) {
    const k = `${v.clientId}|${v.day}|${v.bookingType}`;
    seen.add(k);
    const d = draftKeys.get(k);
    const cl = a.clients.find((x) => x.id === v.clientId)!;
    const item: DraftCheckItem = { client: clientDisplayName(cl), client_ref: cl.ref, date: isoDate(a.weekStart, v.day), start: hhmm(v.start), end: hhmm(v.start + v.duration), booking_type: v.bookingType, summary: "" };
    if (!d) added.push({ ...item, summary: `In the real week but not in the draft: ${item.client}, ${item.booking_type} on ${dmy(item.date)} at ${item.start}.` });
    else if (Math.abs(toMins(d.start) - v.start) > 15) {
      const diff = v.start - toMins(d.start);
      retimed.push({ ...item, draft_start: d.start, summary: `${item.client}, ${item.booking_type} on ${dmy(item.date)}: the draft had ${d.start}, the real booking starts at ${item.start} (${Math.abs(diff)} min ${diff > 0 ? "later" : "earlier"}).` });
    } else matched++;
  }
  for (const [k, d] of draftKeys) {
    if (!seen.has(k)) {
      const cl = a.clients.find((x) => x.ref === d.ref)!;
      removed.push({ client: clientDisplayName(cl), client_ref: "", date: isoDate(a.weekStart, d.day), start: d.start, end: d.start, booking_type: d.type, summary: `In the draft but not in the real week: ${clientDisplayName(cl)}, ${d.type} on ${dmy(isoDate(a.weekStart, d.day))} at ${d.start}.` });
    }
  }
  const byDate = (x: DraftCheckItem, y: DraftCheckItem) => String(x.date).localeCompare(String(y.date)) || String(x.start).localeCompare(String(y.start));
  added.sort(byDate);
  removed.sort(byDate);
  retimed.sort(byDate);
  return { matched, added, removed, retimed, tolerance_minutes: 15, summary: `${matched} of ${a.visits.length} bookings in the real week match the draft; ${added.length} not in the draft, ${removed.length} in the draft but not in the real week, ${retimed.length} at a different time.` };
}
