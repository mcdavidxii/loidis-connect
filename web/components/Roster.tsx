"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { addDays, hhmm } from "@/lib/time";
import { DAYS, type Change, type Report, type ReportVisit, type RouteStop } from "@/lib/types";
import { useApp } from "./AppProvider";
import {
  IconCarer,
  IconChanged,
  IconClient,
  IconClose,
  IconDoubleUp,
  IconInfo,
  IconLock,
  IconMoved,
  IconNext,
  IconPrev,
  IconRefresh,
  IconSearch,
  IconTimeCritical,
  IconTravelCar,
  IconUnallocated,
  IconUnchanged,
  IconWalk,
} from "./icons";
import { Button, inputCls } from "./ui";

// ---------- axis ----------
const AXIS_START = 4 * 60;
const AXIS_END = 24 * 60;
const SPAN = AXIS_END - AXIS_START;
const clamp = (m: number) => Math.max(AXIS_START, Math.min(AXIS_END, m));
const pos = (m: number) => `${((clamp(m) - AXIS_START) / SPAN) * 100}%`;
const wid = (a: number, b: number) => `${((clamp(b) - clamp(a)) / SPAN) * 100}%`;
const HOURS = Array.from({ length: 21 }, (_, i) => 4 + i);
const ROW_H = 40;

// ---------- booking types ----------
const TYPES = [
  { key: "morning", label: "Morning" },
  { key: "lunch", label: "Lunch" },
  { key: "tea", label: "Tea" },
  { key: "bed", label: "Bed" },
  { key: "domestic", label: "Domestic" },
  { key: "respite", label: "Respite" },
  { key: "night", label: "Waking night" },
  { key: "other", label: "Other" },
] as const;
type TypeKey = (typeof TYPES)[number]["key"];

function typeKey(bt: string): TypeKey {
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

const typeStyle = (k: TypeKey) => ({
  background: `var(--bt-${k}-bg)`,
  color: `var(--bt-${k}-fg)`,
  borderColor: `var(--bt-${k}-bd)`,
});

// ---------- status ----------
type Status = "unchanged" | "changed" | "moved" | "locked" | "unallocated";
const STATUS_LABEL: Record<Status, string> = {
  unchanged: "Unchanged",
  changed: "Changed by engine",
  moved: "Moved (time)",
  locked: "Locked / time-critical",
  unallocated: "Unallocated",
};

const CLASS_LABEL: Record<string, string> = {
  carer: "Carer change",
  time_with_change: "Time change with other changes",
  time_note: "Tight gap, check",
  time_within_tolerance: "Within arrival tolerance, no edit needed",
  unchanged: "Unchanged",
};

type View = "current" | "engine";

const sameCarers = (a: string[], b: string[]) => a.slice().sort().join() === b.slice().sort().join();
const isCritical = (v: ReportVisit) => Boolean(v.lock_reason?.toLowerCase().includes("time-critical"));
const durText = (m: number) => (m % 60 === 0 ? `${m / 60}h` : m > 60 ? `${Math.floor(m / 60)}h${m % 60}` : `${m}m`);
const hoursText = (m: number) => `${+(m / 60).toFixed(2)}h`;

interface Stop {
  v: ReportVisit;
  start: number;
  end: number;
  travel: number | null; // minutes of travel before this visit; null when unknown
}

interface Props {
  reports: Record<string, Report>;
  changes: Change[];
}

function Gutter({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`sticky left-0 z-10 w-56 shrink-0 border-r border-line ${className}`} role="rowheader">
      {children}
    </div>
  );
}

export function Roster({ reports, changes }: Props) {
  const { locks, toggleLock } = useApp();
  const teams = Object.keys(reports);
  const [team, setTeam] = useState(teams[0]);
  const [day, setDay] = useState(0);
  const [view, setView] = useState<View>("engine");
  const [tab, setTab] = useState<"carers" | "clients">("carers");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeKey | "all">("all");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [hlChanged, setHlChanged] = useState(false);
  const [hlMoved, setHlMoved] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [hourPx, setHourPx] = useState(96);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackW = 20 * hourPx;
  const returnFocus = useRef<HTMLElement | null>(null);

  const report = reports[team];
  const dayKey = DAYS[day];
  const date = addDays(report.week_start, day);

  const visitsById = useMemo(() => new Map(report.visits.map((v) => [v.id, v])), [report]);
  const labels = useMemo(() => new Map(report.clients.map((c) => [c.id, c.display_name || c.ref])), [report]);
  const refs = useMemo(() => new Map(report.clients.map((c) => [c.id, c.ref])), [report]);
  const names = useMemo(() => new Map(report.carers.map((c) => [c.id, c.name])), [report]);
  const dayVisits = useMemo(() => report.visits.filter((v) => v.day === day), [report, day]);

  const assignedIn = (v: ReportVisit) => (view === "engine" ? v.assigned : v.current_assigned);
  const startIn = (v: ReportVisit) => (view === "engine" ? (v.start ?? v.preferred_start) : v.preferred_start);

  function statusOf(v: ReportVisit): Status {
    if (assignedIn(v).length === 0) return "unallocated";
    const userLocked = Boolean(locks[v.booking_id]);
    if (view === "engine") {
      const changed = v.change_class ? v.change_class === "carer" : !sameCarers(v.assigned, v.current_assigned);
      if (changed) return "changed";
      if (v.start != null && v.start !== v.preferred_start) return "moved";
    }
    if (v.locked || userLocked) return "locked";
    return "unchanged";
  }

  function shiftOf(v: ReportVisit) {
    return v.start != null ? Math.abs(v.start - v.preferred_start) : 0;
  }

  const highlightOn = hlChanged || hlMoved > 0;
  function isHighlighted(v: ReportVisit) {
    if (!highlightOn) return true;
    const changed = !sameCarers(v.assigned, v.current_assigned);
    return (hlChanged && changed) || (hlMoved > 0 && v.assigned.length > 0 && shiftOf(v) >= hlMoved);
  }

  function stopsFor(carerId: string): Stop[] {
    if (view === "engine") {
      return (report.routes[carerId]?.[dayKey] ?? []).flatMap((s: RouteStop) => {
        const v = visitsById.get(s.visit_id);
        return v ? [{ v, start: s.start, end: s.end, travel: s.travel_before }] : [];
      });
    }
    const cur = report.current_routes?.[carerId]?.[dayKey];
    if (cur) {
      return cur.flatMap((s) => {
        const v = visitsById.get(s.visit_id);
        return v ? [{ v, start: s.start, end: s.end, travel: s.travel_before }] : [];
      });
    }
    return dayVisits
      .filter((v) => v.current_assigned.includes(carerId))
      .sort((a, b) => a.preferred_start - b.preferred_start)
      .map((v) => ({ v, start: v.preferred_start, end: v.preferred_start + v.duration, travel: null }));
  }

  const shown = (v: ReportVisit) => typeFilter === "all" || typeKey(v.booking_type) === typeFilter;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = (6.5 - 4) * hourPx;
  }, [hourPx]);

  // Close the drawer with Escape and put focus back where it was.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(null);
        returnFocus.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const unallocated = dayVisits
    .filter((v) => assignedIn(v).length === 0 && shown(v))
    .sort((a, b) => a.preferred_start - b.preferred_start);
  const lanes: number[] = [];
  const laneOf = new Map<string, number>();
  unallocated.forEach((v) => {
    let l = lanes.findIndex((end) => end <= v.preferred_start);
    if (l < 0) {
      l = lanes.length;
      lanes.push(0);
    }
    lanes[l] = v.preferred_start + v.duration;
    laneOf.set(v.id, l);
  });
  const unallocHeight = ROW_H + Math.max(0, lanes.length - 1) * (ROW_H - 4);

  const q = search.trim().toLowerCase();
  const carerRows = report.carers
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .map((c) => ({ c, stops: stopsFor(c.id) }))
    .filter((r) => !hideEmpty || r.stops.length > 0);
  const clientRows = report.clients
    .filter((c) => !q || c.ref.toLowerCase().includes(q) || (c.display_name ?? "").toLowerCase().includes(q))
    .map((c) => ({ c, visits: dayVisits.filter((v) => v.client_id === c.id && shown(v)) }))
    .filter((r) => !hideEmpty || r.visits.length > 0);

  function openVisit(id: string, el: HTMLElement | null) {
    returnFocus.current = el;
    setSelected(id);
    setOpen(id);
  }

  const renderBlock = ({ v, start, label, top = 3 }: { v: ReportVisit; start: number; label: string; top?: number }) => {
    const st = statusOf(v);
    const k = typeKey(v.booking_type);
    const userLocked = Boolean(locks[v.booking_id]);
    const dim = highlightOn && !isHighlighted(v);
    const lockIcon = isCritical(v) ? (
      <IconTimeCritical aria-hidden className="h-3 w-3 shrink-0" />
    ) : v.locked || userLocked ? (
      <IconLock aria-hidden className="h-3 w-3 shrink-0" />
    ) : null;
    const aria = `${label}, ${v.booking_type}, ${hhmm(start)} to ${hhmm(start + v.duration)}, ${STATUS_LABEL[st]}${
      v.carers_needed > 1 ? `, double-up of ${v.carers_needed}` : ""
    }`;
    return (
      <button
        type="button"
        aria-label={aria}
        aria-pressed={selected === v.id}
        title={aria}
        onClick={() => setSelected(v.id)}
        onDoubleClick={(e) => openVisit(v.id, e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            openVisit(v.id, e.currentTarget);
          }
        }}
        className={`absolute overflow-hidden rounded-[4px] border text-left text-[11px] leading-[13px] ${selected === v.id ? "outline outline-2 outline-offset-1 outline-ink" : ""} ${
          dim ? "opacity-30" : ""
        } ${highlightOn && !dim ? "outline outline-2 outline-offset-1 outline-brand" : ""}`}
        style={{ ...typeStyle(k), left: pos(start), width: wid(start, start + v.duration), minWidth: 26, top, height: ROW_H - 6 }}
      >
        <span className="flex items-start justify-between gap-0.5 px-1 pt-[2px]">
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-semibold">{label}</span>
            <span className="truncate">
              {hhmm(start)} ({durText(v.duration)})
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            {v.carers_needed > 1 && (
              <span className="flex items-center">
                <IconDoubleUp aria-hidden className="h-3 w-3" />
                <span className="text-[10px] font-semibold">{v.carers_needed}</span>
              </span>
            )}
            {lockIcon}
          </span>
        </span>
        <span aria-hidden className={`absolute inset-x-0 bottom-0 h-1 strip-${st}`} />
      </button>
    );
  };

  const shortRef = (id: string) => labels.get(id) ?? refs.get(id) ?? id;
  const dateTitle = new Date(date + "T00:00:00Z")
    .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .replace(",", "");

  const openV = open ? visitsById.get(open) : undefined;

  return (
    <div>
      {/* Title row and top bar */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 className="mr-2 text-base" aria-live="polite">
          {dateTitle}
        </h3>
        <div role="group" aria-label="Rota to show" className="inline-flex overflow-hidden rounded-md border border-line">
          {(
            [
              ["current", "Current rota"],
              ["engine", "Engine plan"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => setView(id)}
              className={`h-8 px-3 text-sm ${view === id ? "bg-brand font-semibold text-white" : "bg-surface text-ink hover:bg-hover"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous day" disabled={day === 0} onClick={() => setDay(day - 1)} className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface hover:bg-hover disabled:opacity-40">
            <IconPrev aria-hidden className="h-4 w-4" />
          </button>
          <input
            type="date"
            aria-label="Date"
            className={inputCls}
            value={date}
            min={report.week_start}
            max={addDays(report.week_start, 6)}
            onChange={(e) => {
              const d = Math.round((Date.parse(e.target.value) - Date.parse(report.week_start)) / 86400000);
              if (d >= 0 && d <= 6) setDay(d);
            }}
          />
          <button type="button" aria-label="Next day" disabled={day === 6} onClick={() => setDay(day + 1)} className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface hover:bg-hover disabled:opacity-40">
            <IconNext aria-hidden className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Reset search, filters and highlights"
            title="Reset search, filters and highlights"
            onClick={() => {
              setSearch("");
              setTypeFilter("all");
              setHideEmpty(false);
              setHlChanged(false);
              setHlMoved(0);
              setSelected(null);
            }}
            className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface hover:bg-hover"
          >
            <IconRefresh aria-hidden className="h-4 w-4 text-muted" />
          </button>
        </div>
        <div role="group" aria-label="Team" className="inline-flex overflow-hidden rounded-md border border-line">
          {teams.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={t === team}
              onClick={() => {
                setTeam(t);
                setSelected(null);
                setOpen(null);
              }}
              className={`h-8 px-3 text-sm ${t === team ? "bg-brand font-semibold text-white" : "bg-surface text-ink hover:bg-hover"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div role="tablist" aria-label="Roster rows" className="mb-3 flex gap-4 border-b border-line">
        {(
          [
            ["carers", "Carers", IconCarer],
            ["clients", "Clients", IconClient],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px flex h-9 items-center gap-1.5 border-b-2 text-sm ${tab === id ? "border-brand font-semibold" : "border-transparent text-muted hover:text-ink"}`}
          >
            <Icon aria-hidden className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative">
          <IconSearch aria-hidden className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted" />
          <input
            type="search"
            aria-label={tab === "carers" ? "Search carers" : "Search clients"}
            placeholder={tab === "carers" ? "Search carers" : "Search clients"}
            className={`${inputCls} w-48 pl-8`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="relative">
          <Button aria-expanded={filterOpen} onClick={() => setFilterOpen(!filterOpen)}>
            Add filter{typeFilter !== "all" || hideEmpty ? " (on)" : ""}
          </Button>
          {filterOpen && (
            <div className="absolute left-0 top-9 z-20 w-60 space-y-2 rounded-md border border-line bg-surface p-3 text-sm shadow-md">
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Booking type</span>
                <select className={`${inputCls} w-full`} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeKey | "all")}>
                  <option value="all">All types</option>
                  {TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-[#0f766e]" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
                Hide rows with no visits
              </label>
              <p className="text-xs text-muted">The team is chosen above.</p>
            </div>
          )}
        </div>
        <div role="group" aria-label="Highlight" className="flex items-center gap-2 text-sm">
          <span className="text-xs text-muted">Highlight</span>
          <label className="sr-only" htmlFor="hl-changed">
            Changed by engine
          </label>
          <select id="hl-changed" className={inputCls} value={hlChanged ? "on" : "off"} onChange={(e) => setHlChanged(e.target.value === "on")}>
            <option value="off">Changed by engine: off</option>
            <option value="on">Changed by engine: on</option>
          </select>
          <label className="sr-only" htmlFor="hl-moved">
            Moved by at least
          </label>
          <select id="hl-moved" className={inputCls} value={hlMoved} onChange={(e) => setHlMoved(Number(e.target.value))}>
            <option value={0}>Moved by at least: off</option>
            {[5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                Moved by at least {m} min
              </option>
            ))}
          </select>
          <div className="relative">
            <button
              type="button"
              aria-label="Legend"
              aria-expanded={legendOpen}
              title="Legend"
              onClick={() => setLegendOpen(!legendOpen)}
              className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface hover:bg-hover"
            >
              <IconInfo aria-hidden className="h-4 w-4 text-muted" />
            </button>
            {legendOpen && (
              <div role="dialog" aria-label="Legend" className="absolute right-0 top-9 z-30 w-64 rounded-md border border-line bg-surface p-3 text-xs shadow-md">
                <p className="mb-1 font-semibold">Status strip</p>
                <ul className="mb-3 space-y-1">
                  {(Object.keys(STATUS_LABEL) as Status[]).map((st) => (
                    <li key={st} className="flex items-center gap-2">
                      <span aria-hidden className={`inline-block h-1 w-6 strip-${st}`} />
                      {STATUS_LABEL[st]}
                    </li>
                  ))}
                </ul>
                <p className="mb-1 font-semibold">Travel between visits</p>
                <ul className="mb-3 space-y-1">
                  <li className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-[4px] bg-ok-soft px-1 text-ok">
                      <IconTravelCar aria-hidden className="h-3 w-3" />
                    </span>
                    Gap fits the travel estimate
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-[4px] bg-bad-soft px-1 text-bad ring-1 ring-bad">
                      <IconWalk aria-hidden className="h-3 w-3" />
                    </span>
                    Tight gap (car or walking icon by carer)
                  </li>
                </ul>
                <p className="mb-1 font-semibold">Icons</p>
                <ul className="space-y-1">
                  <li className="flex items-center gap-2"><IconDoubleUp aria-hidden className="h-3 w-3" /> Double-up (number of carers)</li>
                  <li className="flex items-center gap-2"><IconLock aria-hidden className="h-3 w-3" /> Locked</li>
                  <li className="flex items-center gap-2"><IconTimeCritical aria-hidden className="h-3 w-3" /> Time-critical</li>
                </ul>
              </div>
            )}
          </div>
        </div>
        <div role="group" aria-label="Zoom" className="flex items-center gap-1 text-xs text-muted">
          <span>Zoom</span>
          <div className="inline-flex overflow-hidden rounded-md border border-line">
            {[64, 96, 128].map((px) => (
              <button
                key={px}
                type="button"
                aria-pressed={hourPx === px}
                aria-label={`1 hour is ${px} pixels wide`}
                onClick={() => setHourPx(px)}
                className={`h-8 px-2 text-sm ${hourPx === px ? "bg-brand font-semibold text-white" : "bg-surface text-ink hover:bg-hover"}`}
              >
                {px === 64 ? "S" : px === 96 ? "M" : "L"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Booking types */}
      <ul className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" aria-label="Booking types">
        {TYPES.map((t) => (
          <li key={t.key} className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-3 w-3 rounded-[3px] border" style={typeStyle(t.key)} />
            {t.label}
          </li>
        ))}
      </ul>

      {/* Grid */}
      <div ref={scrollRef} className="max-h-[70vh] overflow-auto rounded-md border border-line bg-surface">
        <div style={{ width: 224 + trackW }} role="table" aria-label={`${tab === "carers" ? "Carer" : "Client"} roster for ${team}, ${dateTitle}, ${view === "engine" ? "engine plan" : "current rota"}`}>
          <div className="sticky top-0 z-20 flex border-b border-line bg-canvas text-xs text-muted" role="row">
            <Gutter className="z-30 bg-canvas px-3 py-2">
              <span role="columnheader">{tab === "carers" ? "Carer" : "Client"}</span>
            </Gutter>
            <div className="relative h-8 shrink-0" style={{ width: trackW }} role="columnheader" aria-label="Time of day, 04:00 to 24:00">
              {HOURS.map((h) => (
                <span key={h} aria-hidden className="absolute top-2 -translate-x-1/2" style={{ left: pos(h * 60) }}>
                  {String(h % 24).padStart(2, "0")}
                </span>
              ))}
            </div>
          </div>

          <div className="flex border-b border-line bg-bad-soft" role="row">
            <Gutter className="flex items-center justify-between gap-2 bg-bad-soft px-3">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-bad">
                <IconUnallocated aria-hidden className="h-4 w-4" /> Unallocated
              </span>
              <span className="text-xs text-muted">{unallocated.length}</span>
            </Gutter>
            <div className="relative shrink-0" style={{ height: unallocHeight, width: trackW }} role="cell">
              {HOURS.map((h) => (
                <div key={h} aria-hidden className="hour-line absolute inset-y-0" style={{ left: pos(h * 60) }} />
              ))}
              {unallocated.map((v) => (
                <Fragment key={v.id}>{renderBlock({ v, start: v.preferred_start, label: shortRef(v.client_id), top: 3 + (laneOf.get(v.id) ?? 0) * (ROW_H - 4) })}</Fragment>
              ))}
            </div>
          </div>

          {tab === "carers" &&
            carerRows.map(({ c, stops }) => {
              const mins = stops.reduce((a, s) => a + s.v.duration, 0);
              const walk = c.travel_mode != null && c.travel_mode !== "car";
              const TravelIcon = walk ? IconWalk : IconTravelCar;
              return (
                <div key={c.id} className="flex border-b border-line last:border-0" role="row">
                  <Gutter className="flex items-center gap-2 bg-surface px-3" >
                    <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-canvas">
                      <IconCarer className="h-3.5 w-3.5 text-muted" />
                    </span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate font-semibold">{c.name}</span>
                      <span className="block truncate text-xs text-muted">{team}</span>
                    </span>
                    <span className="rounded-md bg-hover px-1.5 py-0.5 text-xs font-semibold" title="Booked care hours this day">
                      {hoursText(mins)}
                    </span>
                  </Gutter>
                  <div className="relative shrink-0" style={{ height: ROW_H, width: trackW }} role="cell">
                    {c.availability
                      .filter((a) => a.day === day)
                      .length === 0 && <div aria-hidden className="off-hours absolute inset-0" />}
                    {c.availability
                      .filter((a) => a.day === day)
                      .map((a, i) => (
                        <div key={i} aria-hidden className="absolute inset-y-0 bg-ok-soft/60" style={{ left: pos(a.start), width: wid(a.start, a.end) }} />
                      ))}
                    {HOURS.map((h) => (
                      <div key={h} aria-hidden className="hour-line absolute inset-y-0" style={{ left: pos(h * 60) }} />
                    ))}
                    {stops.map((s, i) => {
                      const prev = stops[i - 1];
                      const chip =
                        prev && s.travel != null && s.travel > 0 ? (
                          (() => {
                            const gap = s.start - prev.end;
                            const fits = gap >= s.travel;
                            const text = `Travel ${s.travel} min, gap ${gap} min: ${fits ? "fits" : "tight gap"}`;
                            return (
                              <span
                                role="img"
                                aria-label={text}
                                title={text}
                                className={`absolute z-[5] inline-flex h-4 -translate-x-1/2 items-center rounded-[4px] px-1 ${fits ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad ring-1 ring-bad"}`}
                                style={{ left: pos(prev.end + Math.max(gap, 0) / 2), top: ROW_H / 2 - 8 }}
                              >
                                <TravelIcon aria-hidden className="h-3 w-3" />
                              </span>
                            );
                          })()
                        ) : null;
                      return (
                        <div key={s.v.id}>
                          {chip}
                          {renderBlock({ v: s.v, start: s.start, label: shortRef(s.v.client_id) })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

          {tab === "clients" &&
            clientRows.map(({ c, visits }) => (
              <div key={c.id} className="flex border-b border-line last:border-0" role="row">
                <Gutter className="flex items-center gap-2 bg-surface px-3">
                  <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-canvas">
                    <IconClient className="h-3.5 w-3.5 text-muted" />
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-semibold">{c.display_name || c.ref}</span>
                    <span className="block truncate text-xs text-muted">{team}</span>
                  </span>
                  <span className="rounded-md bg-hover px-1.5 py-0.5 text-xs font-semibold" title="Booked care hours this day">
                    {hoursText(visits.reduce((a, v) => a + v.duration, 0))}
                  </span>
                </Gutter>
                <div className="relative shrink-0" style={{ height: ROW_H, width: trackW }} role="cell">
                  {HOURS.map((h) => (
                    <div key={h} aria-hidden className="hour-line absolute inset-y-0" style={{ left: pos(h * 60) }} />
                  ))}
                  {visits.map((v) => {
                    const who = assignedIn(v).map((id) => names.get(id) ?? id).join(" + ");
                    return <Fragment key={v.id}>{renderBlock({ v, start: startIn(v), label: who || "Unallocated" })}</Fragment>;
                  })}
                </div>
              </div>
            ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">Click a visit to select it. Double-click, or press Enter, for details. Escape closes them.</p>

      {openV && (
        <Drawer
          v={openV}
          report={report}
          names={names}
          clientRef={refs.get(openV.client_id) ?? ""}
          clientName={labels.get(openV.client_id) ?? ""}
          date={addDays(report.week_start, openV.day)}
          change={changes.find((c) => c.booking_id === openV.booking_id)}
          lockedTo={locks[openV.booking_id]}
          onLock={(carerId) => toggleLock(openV.booking_id, carerId)}
          onClose={() => {
            setOpen(null);
            returnFocus.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function Drawer({
  v,
  report,
  names,
  clientRef,
  clientName,
  date,
  change,
  lockedTo,
  onLock,
  onClose,
}: {
  v: ReportVisit;
  report: Report;
  names: Map<string, string>;
  clientRef: string;
  clientName: string;
  date: string;
  change?: Change;
  lockedTo?: string;
  onLock: (carerId: string) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), [v.id]);
  const dayKey = DAYS[v.day];
  const list = (ids: string[]) => ids.map((id) => names.get(id) ?? id).join(" + ") || "None";
  const planned = v.start ?? v.preferred_start;
  const shift = v.start != null ? v.start - v.preferred_start : 0;
  const carerId = v.assigned[0];
  const stops = carerId ? (report.routes[carerId]?.[dayKey] ?? []) : [];
  const idx = stops.findIndex((s) => s.visit_id === v.id);
  const before = idx > 0 ? stops[idx].travel_before : null;
  const after = idx >= 0 && idx < stops.length - 1 ? stops[idx + 1].travel_before : null;
  const cls = v.change_class ?? (v.assigned.length === 0 ? null : sameCarers(v.assigned, v.current_assigned) ? "unchanged" : "carer");

  // Rule warnings: what the report tells us about this visit.
  const warnings: string[] = [];
  if (v.lock_reason) warnings.push(`Locked: ${v.lock_reason}`);
  if (v.assigned.length === 0 && v.unfilled_reason) warnings.push(v.unfilled_reason);
  if (idx > 0) {
    const gap = stops[idx].start - stops[idx - 1].end;
    if (gap < stops[idx].travel_before) warnings.push(`Tight gap: ${gap} min between visits, ${stops[idx].travel_before} min travel`);
  }
  v.assigned.forEach((id) => {
    const c = report.carers.find((x) => x.id === id);
    c?.issues.forEach((i) => warnings.push(`${c.name}: ${i}`));
  });

  const row = (k: string, val: React.ReactNode) => (
    <div className="grid grid-cols-[8rem_1fr] gap-2 border-b border-line py-1.5">
      <dt className="text-xs text-muted">{k}</dt>
      <dd>{val}</dd>
    </div>
  );

  return (
    <aside role="dialog" aria-modal="false" aria-label="Visit details" className="fixed right-0 top-0 z-40 h-full w-[26rem] overflow-y-auto border-l border-line bg-surface p-4 shadow-lg">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base">{clientName || clientRef}</h3>
          <p className="text-xs text-muted">{clientRef} · {v.booking_id}</p>
        </div>
        <button ref={closeRef} type="button" aria-label="Close details" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md hover:bg-hover">
          <IconClose aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <dl className="text-sm">
        {row("Booking type", v.booking_type)}
        {row("Date", date)}
        {row("Booked", `${hhmm(v.preferred_start)} to ${hhmm(v.preferred_start + v.duration)}`)}
        {row(
          "Engine plan",
          v.start == null ? "Not planned" : `${hhmm(planned)} to ${hhmm(planned + v.duration)}${shift !== 0 ? ` (${shift > 0 ? "+" : ""}${shift} min)` : " (no shift)"}`,
        )}
        {row("Current rota", list(v.current_assigned))}
        {row("Engine plan carers", list(v.assigned))}
        {row(
          "Change",
          <span className="flex items-center gap-1.5">
            {cls === "carer" ? <IconChanged aria-hidden className="h-4 w-4 text-muted" /> : cls && cls !== "unchanged" ? <IconMoved aria-hidden className="h-4 w-4 text-muted" /> : <IconUnchanged aria-hidden className="h-4 w-4 text-muted" />}
            {cls ? (CLASS_LABEL[cls] ?? cls) : "Unallocated"}
          </span>,
        )}
        {change && row("Reason", change.reason)}
        {row("Travel before", before == null ? "-" : `${before} min`)}
        {row("Travel after", after == null ? "-" : `${after} min`)}
        {row(
          "Rule warnings",
          warnings.length ? (
            <ul className="list-disc pl-4">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : (
            "None"
          ),
        )}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {lockedTo ? (
          <Button onClick={() => onLock(lockedTo)}>
            <IconLock aria-hidden className="h-4 w-4 text-muted" />
            Unlock ({names.get(lockedTo) ?? lockedTo})
          </Button>
        ) : (
          <>
            {v.assigned[0] && (
              <Button onClick={() => onLock(v.assigned[0])}>
                <IconLock aria-hidden className="h-4 w-4 text-muted" />
                Lock to this carer
              </Button>
            )}
            {v.current_assigned[0] && (
              <Button onClick={() => onLock(v.current_assigned[0])}>
                <IconLock aria-hidden className="h-4 w-4 text-muted" />
                Lock to current carer
              </Button>
            )}
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">Locks apply the next time you run.</p>
    </aside>
  );
}
