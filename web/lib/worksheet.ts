// Turns a run result into the rows of the Export worksheet and the CSV exports. The browser
// worksheet and the mock's CSV files both use this, so the order and wording match.
// The real service writes the same columns (docs/ENGINE_API.md).

import { addDays, hhmm } from "./time";
import { DAYS, DAY_LABELS, type Report, type ReportVisit, type RunResult } from "./types";

export const CHANGES_HEADER = ["Day", "Date", "Give to", "Booked time", "New start", "Client", "Booking type", "Booking ID", "Action", "Currently with", "Required", "Why", "Done"];
export const NOTES_HEADER = ["Day", "Date", "Booked time", "New start", "Client", "Booking type", "Booking ID", "Currently with", "Why", "Shift (min)", "Note", "Done"];
export const ALLOCATION_HEADER = ["Day", "Date", "Carer", "Start", "End", "New start", "Client", "Booking type", "Booking ID", "Double-up with", "Compared with current", "Done"];

export interface ChangeRow {
  key: string;
  dayIdx: number;
  day: string;
  date: string;
  giveTo: string;
  bookedTime: string;
  bookedEnd: string;
  newStart: string | null;
  client: string;
  bookingType: string;
  bookingId: string;
  action: "Allocate" | "Reassign" | "Reassign + change time" | "Change time";
  currentlyWith: string;
  required: boolean;
  why: string;
}

export interface NoteRow {
  key: string;
  dayIdx: number;
  day: string;
  date: string;
  carer: string;
  bookedTime: string;
  bookedEnd: string;
  plannedStart: string;
  shift: number;
  toleranceNote: string;
  client: string;
  bookingType: string;
  bookingId: string;
  kind: "time_within_tolerance" | "time_note";
  note: string;
}

export interface UnallocatedRow {
  key: string;
  dayIdx: number;
  day: string;
  date: string;
  time: string;
  client: string;
  bookingType: string;
  bookingId: string;
  reason: string;
}

export interface AllocRow {
  key: string;
  dayIdx: number;
  day: string;
  date: string;
  carer: string; // "UNALLOCATED" for unfilled bookings
  start: number;
  end: number;
  newStart: string | null;
  client: string;
  bookingType: string;
  bookingId: string;
  doubleUpWith: string;
  compared: string; // Same | Changed from X | Was unallocated | (empty when unallocated now)
  changed: boolean;
  unallocated: boolean;
}

export interface Worksheet {
  weekStart: string;
  changes: ChangeRow[];
  notes: NoteRow[];
  unallocated: UnallocatedRow[];
  allocation: AllocRow[];
}

const toM = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const sameSet = (a: string[], b: string[]) => a.slice().sort().join() === b.slice().sort().join();

export function buildWorksheet(result: RunResult): Worksheet {
  const reports: Report[] = Object.values(result.teams);
  const weekStart = reports[0]?.week_start ?? "";
  const carerName = new Map<string, string>();
  const clientName = new Map<string, string>(); // by ref
  const byBooking = new Map<string, { v: ReportVisit; rep: Report }>();
  for (const rep of reports) {
    rep.carers.forEach((c) => carerName.set(c.id, c.name));
    rep.clients.forEach((c) => clientName.set(c.ref, c.display_name || c.ref));
    rep.visits.forEach((v) => v.booking_id && byBooking.set(v.booking_id, { v, rep }));
  }
  const names = (ids: string[]) => ids.map((id) => carerName.get(id) ?? id);
  const dayInfo = (date: string) => {
    const idx = Math.round((Date.parse(date) - Date.parse(weekStart)) / 86400000);
    return { dayIdx: idx, day: DAY_LABELS[DAYS[Math.max(0, Math.min(6, idx))]] };
  };

  const changes: ChangeRow[] = result.changes.map((c) => {
    const found = byBooking.get(c.booking_id);
    const needsTime = Boolean((c.new_time_needed ?? c.new_start != null) && c.new_start);
    const same = sameSet(c.from_carers, c.to_carers);
    const action: ChangeRow["action"] =
      c.from_carers.length === 0 ? "Allocate" : same ? "Change time" : needsTime ? "Reassign + change time" : "Reassign";
    return {
      key: `${c.booking_id}|${c.to_carers.join("+")}`,
      ...dayInfo(c.date),
      date: c.date,
      giveTo: c.to_carers.join(" + "),
      bookedTime: c.booked_start,
      bookedEnd: found ? hhmm(found.v.preferred_start + found.v.duration) : c.booked_start,
      newStart: needsTime ? c.new_start : null,
      client: clientName.get(c.client_ref) ?? c.client_ref,
      bookingType: found?.v.booking_type ?? "",
      bookingId: c.booking_id,
      action,
      currentlyWith: c.from_carers.join(" + ") || "Unallocated",
      required: Boolean(c.forced_by_rules),
      why: c.reason,
    };
  });
  changes.sort((a, b) => a.date.localeCompare(b.date) || a.giveTo.localeCompare(b.giveTo) || a.bookedTime.localeCompare(b.bookedTime));

  const notes: NoteRow[] = result.time_notes.map((n) => ({
    key: `${n.booking_id}|note`,
    ...dayInfo(n.date),
    date: n.date,
    carer: n.carer,
    bookedTime: n.booked_start,
    bookedEnd: byBooking.get(n.booking_id) ? hhmm(byBooking.get(n.booking_id)!.v.preferred_start + byBooking.get(n.booking_id)!.v.duration) : n.booked_start,
    plannedStart: n.new_start,
    shift: Math.abs(toM(n.new_start) - toM(n.booked_start)),
    toleranceNote: n.kind === "time_within_tolerance" ? `within ${result.arrival_tolerance_minutes ?? 15} min – no edit needed` : "tight gap – check",
    client: clientName.get(n.client_ref) ?? n.client_ref,
    bookingType: byBooking.get(n.booking_id)?.v.booking_type ?? "",
    bookingId: n.booking_id,
    kind: n.kind === "time_within_tolerance" ? "time_within_tolerance" : "time_note",
    note: n.reason,
  }));
  notes.sort((a, b) => a.date.localeCompare(b.date) || a.carer.localeCompare(b.carer) || a.bookedTime.localeCompare(b.bookedTime));

  const unallocated: UnallocatedRow[] = [];
  const allocation: AllocRow[] = [];
  for (const rep of reports) {
    const refName = new Map(rep.clients.map((c) => [c.id, c.display_name || c.ref]));
    for (const v of rep.visits) {
      const date = addDays(rep.week_start, v.day);
      // A draft has no booking IDs yet: the id is empty and the screens say "not generated yet".
      const bookingId = v.booking_id ?? "";
      const base = { dayIdx: v.day, day: DAY_LABELS[DAYS[v.day]], date, client: refName.get(v.client_id) ?? v.client_id, bookingType: v.booking_type, bookingId };
      if (v.assigned.length === 0) {
        unallocated.push({ key: `${v.id}|un`, dayIdx: v.day, day: base.day, date, time: hhmm(v.preferred_start), client: base.client, bookingType: v.booking_type, bookingId, reason: v.unfilled_reason ?? "" });
        allocation.push({ ...base, key: `${v.id}|UNALLOCATED`, carer: "UNALLOCATED", start: v.preferred_start, end: v.preferred_start + v.duration, newStart: null, doubleUpWith: "", compared: v.unfilled_reason ?? "", changed: v.current_assigned.length > 0, unallocated: true });
        continue;
      }
      const start = v.start ?? v.preferred_start;
      const compared = v.current_assigned.length === 0 ? "Was unallocated" : sameSet(v.assigned, v.current_assigned) ? "Same" : `Changed from ${names(v.current_assigned).join(" + ")}`;
      for (const id of v.assigned) {
        allocation.push({
          ...base,
          key: `${v.id}|${id}`,
          carer: carerName.get(id) ?? id,
          start: v.preferred_start,
          end: v.preferred_start + v.duration,
          newStart: start !== v.preferred_start ? hhmm(start) : null,
          doubleUpWith: names(v.assigned.filter((x) => x !== id)).join(" + "),
          compared,
          changed: compared !== "Same",
          unallocated: false,
        });
      }
    }
  }
  unallocated.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  allocation.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(b.unallocated) - Number(a.unallocated) ||
      a.carer.localeCompare(b.carer) ||
      a.start - b.start,
  );
  return { weekStart, changes, notes, unallocated, allocation };
}

const dmy = (iso: string) => iso.split("-").reverse().join("/");

export function changesCsvRows(w: Worksheet): (string | number)[][] {
  return [
    CHANGES_HEADER,
    ...w.changes.map((r) => [r.day, dmy(r.date), r.giveTo, `${r.bookedTime}\u2013${r.bookedEnd}`, r.newStart ?? "", r.client, r.bookingType, r.bookingId, r.action, r.currentlyWith, r.required ? "Yes" : "", r.why, ""]),
  ];
}

export function notesCsvRows(w: Worksheet): (string | number)[][] {
  return [
    NOTES_HEADER,
    ...w.notes.map((r) => [r.day, dmy(r.date), `${r.bookedTime}\u2013${r.bookedEnd}`, r.plannedStart, r.client, r.bookingType, r.bookingId, r.carer, r.note, r.shift, r.toleranceNote, ""]),
  ];
}

export function allocationCsvRows(w: Worksheet): (string | number)[][] {
  return [
    ALLOCATION_HEADER,
    ...w.allocation.map((r) => [r.day, dmy(r.date), r.carer, hhmm(r.start), hhmm(r.end), r.newStart ?? "", r.client, r.bookingType, r.bookingId || "not generated yet", r.doubleUpWith, r.compared, ""]),
  ];
}
