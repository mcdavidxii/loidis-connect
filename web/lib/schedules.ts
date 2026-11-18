// Helpers for client schedules (the weekly pattern kept in the settings file).

import { addDays } from "./time";
import { DAYS, type ClientSchedule, type DayKey, type ScheduleVisit } from "./types";

export const DAY_SHORT: Record<DayKey, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

export function mondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The next `n` Mondays after today (a future week to plan).
export function nextMondays(n: number): string[] {
  const first = addDays(mondayOf(todayIso()), 7);
  return Array.from({ length: n }, (_, i) => addDays(first, 7 * i));
}

export function isMonday(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && new Date(iso + "T00:00:00Z").getUTCDay() === 1;
}

const weekIndex = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / (7 * 86400000));

// Does this visit happen in the week starting `weekStart`?
export function happensInWeek(v: ScheduleVisit, weekStart: string): boolean {
  if (v.repeat !== "fortnightly" || !v.fortnight_anchor) return true;
  return (((weekIndex(weekStart) - weekIndex(v.fortnight_anchor)) % 2) + 2) % 2 === 0;
}

export function newVisitId(): string {
  return `sv-${Math.random().toString(36).slice(2, 9)}`;
}

export function blankVisit(): ScheduleVisit {
  return { id: newVisitId(), days: [], start: "08:00", duration_min: 30, booking_type: "Morning Visit", carers_needed: 1, repeat: "weekly", fortnight_anchor: null };
}

export function emptySchedule(ref: string): ClientSchedule {
  return { client_ref: ref, confirmed: false, learned_from: [], updated_at: null, visits: [] };
}

export function visitsOnDay(s: ClientSchedule | undefined, day: DayKey): ScheduleVisit[] {
  return (s?.visits ?? []).filter((v) => v.days.includes(day)).sort((a, b) => a.start.localeCompare(b.start));
}

export function endTime(start: string, mins: number): string {
  const t = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + mins;
  const m = ((t % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export const lengthText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m} min`);

export function totalVisitsPerWeek(s: ClientSchedule | undefined): number {
  return (s?.visits ?? []).reduce((a, v) => a + v.days.length, 0);
}

export { DAYS };
