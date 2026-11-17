// Helpers shared by the roster views (week, day) and the details drawer.

import type { ReportVisit } from "@/lib/types";

export const TYPES = [
  { key: "morning", label: "Morning" },
  { key: "lunch", label: "Lunch" },
  { key: "tea", label: "Tea" },
  { key: "bed", label: "Bed" },
  { key: "domestic", label: "Domestic" },
  { key: "respite", label: "Respite" },
  { key: "night", label: "Waking night" },
  { key: "other", label: "Other" },
] as const;
export type TypeKey = (typeof TYPES)[number]["key"];

export function typeKey(bt: string): TypeKey {
  const s = bt.toLowerCase();
  if (s.includes("morning")) return "morning";
  if (s.includes("lunch")) return "lunch";
  if (s.includes("tea")) return "tea";
  if (s.includes("bed")) return "bed";
  if (s.includes("domestic")) return "domestic";
  if (s.includes("respite")) return "respite";
  if (s.includes("night")) return "night";
  return "other";
}

export const typeStyle = (k: TypeKey) => ({
  background: `var(--bt-${k}-bg)`,
  color: `var(--bt-${k}-fg)`,
  borderColor: `var(--bt-${k}-bd)`,
});

export const UNALLOCATED_STYLE = { background: "#fffbeb", color: "#78350f", borderColor: "#d97706", borderStyle: "dashed" as const };

export type View = "current" | "engine";
export type Status = "unchanged" | "changed" | "moved" | "locked" | "unallocated";

export const STATUS_LABEL: Record<Status, string> = {
  unchanged: "No change",
  changed: "Suggested change",
  moved: "New time",
  locked: "Kept as is / time-critical",
  unallocated: "Unallocated",
};
export const STATUS_SHORT: Record<Status, string> = {
  unchanged: "No change",
  changed: "Suggested change",
  moved: "New time",
  locked: "Kept as is",
  unallocated: "Unallocated",
};
export const STATUS_COLOR: Record<Status, string> = {
  unchanged: "#94a3b8",
  changed: "#6366f1",
  moved: "#0e7490",
  locked: "#0f172a",
  unallocated: "#b45309",
};

export const CLASS_LABEL: Record<string, string> = {
  carer: "Carer change",
  time_with_change: "New time, with other changes",
  time_note: "Short gap, check travel",
  time_within_tolerance: "Small time change, no edit needed",
  unchanged: "No change",
};

export const sameCarers = (a: string[], b: string[]) => a.slice().sort().join() === b.slice().sort().join();
export const isCritical = (v: ReportVisit) => Boolean(v.lock_reason?.toLowerCase().includes("time-critical"));
export const durText = (m: number) => (m % 60 === 0 ? `${m / 60}h` : m > 60 ? `${Math.floor(m / 60)}h${m % 60}` : `${m}m`);
export const hoursText = (m: number) => `${+(m / 60).toFixed(2)}h`;

export const assignedIn = (v: ReportVisit, view: View) => (view === "engine" ? v.assigned : v.current_assigned);
export const startIn = (v: ReportVisit, view: View) => (view === "engine" ? (v.start ?? v.preferred_start) : v.preferred_start);

// Carer(s) or time differ from the current rota.
export const changedFlag = (v: ReportVisit) => !sameCarers(v.assigned, v.current_assigned) || (v.start != null && v.start !== v.preferred_start);

export function statusOf(v: ReportVisit, view: View, locks: Record<string, string>): Status {
  if (assignedIn(v, view).length === 0) return "unallocated";
  if (view === "engine") {
    const changed = v.change_class ? v.change_class === "carer" : !sameCarers(v.assigned, v.current_assigned);
    if (changed) return "changed";
    if (v.start != null && v.start !== v.preferred_start) return "moved";
  }
  if (v.locked || locks[v.booking_id]) return "locked";
  return "unchanged";
}

export function shiftOf(v: ReportVisit) {
  return v.start != null ? Math.abs(v.start - v.preferred_start) : 0;
}

// What every roster view needs to know to decide how to show a visit.
export interface RosterCtx {
  view: View;
  locks: Record<string, string>;
  selected: string | null;
  highlightOn: boolean;
  isHighlighted: (v: ReportVisit) => boolean;
  visible: (v: ReportVisit) => boolean;
  query: string;
  filtering: boolean; // a type or status filter is on: rows with nothing to show are hidden
  onOpen: (team: string, id: string, el: HTMLElement | null) => void;
  onSelect: (id: string) => void;
}
