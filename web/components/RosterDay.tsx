"use client";

import { Fragment } from "react";
import { hhmm } from "@/lib/time";
import { DAYS, type Report, type ReportVisit, type RouteStop } from "@/lib/types";
import { IconDoubleUp, IconLock, IconTimeCritical, IconTravelCar, IconUnallocated, IconWalk } from "./icons";
import {
  STATUS_LABEL,
  UNALLOCATED_STYLE,
  assignedIn,
  durText,
  hoursText,
  isCritical,
  startIn,
  statusOf,
  typeKey,
  typeStyle,
  type RosterCtx,
} from "./rosterShared";
import { Avatar } from "./ui";

const AXIS_START = 4 * 60;
const AXIS_END = 24 * 60;
const SPAN = AXIS_END - AXIS_START;
const clamp = (m: number) => Math.max(AXIS_START, Math.min(AXIS_END, m));
const pos = (m: number) => `${((clamp(m) - AXIS_START) / SPAN) * 100}%`;
const wid = (a: number, b: number) => `${((clamp(b) - clamp(a)) / SPAN) * 100}%`;
const HOURS = Array.from({ length: 21 }, (_, i) => 4 + i);
const ROW_H = 44;

interface Stop {
  v: ReportVisit;
  start: number;
  end: number;
  travel: number | null;
}

function Gutter({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`sticky left-0 z-10 w-56 shrink-0 border-r border-line ${className}`} role="rowheader">
      {children}
    </div>
  );
}

export function RosterDay({
  report,
  team,
  group,
  ctx,
  day,
  hourPx,
  showTeam,
}: {
  report: Report;
  team: string;
  group: "client" | "carer";
  ctx: RosterCtx;
  day: number;
  hourPx: number;
  showTeam: boolean;
}) {
  const trackW = 20 * hourPx;
  const dayKey = DAYS[day];
  const q = ctx.query.trim().toLowerCase();
  const { view, locks } = ctx;


  const visitsById = new Map(report.visits.map((v) => [v.id, v]));
  const names = new Map(report.carers.map((c) => [c.id, c.name]));
  const labels = new Map(report.clients.map((c) => [c.id, c.display_name || c.ref]));
  const dayVisits = report.visits.filter((v) => v.day === day);

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

  const renderBlock = (v: ReportVisit, start: number, label: string, top = 3) => {
    const st = statusOf(v, view, locks);
    const k = typeKey(v.booking_type);
    const userLocked = Boolean(locks[v.booking_id]);
    const dim = ctx.highlightOn && !ctx.isHighlighted(v);
    const lockIcon = isCritical(v) ? (
      <IconTimeCritical aria-hidden className="h-3 w-3 shrink-0" />
    ) : v.locked || userLocked ? (
      <IconLock aria-hidden className="h-3 w-3 shrink-0" />
    ) : null;
    const aria = `${label}, ${v.booking_type}, ${hhmm(start)} to ${hhmm(start + v.duration)}, ${STATUS_LABEL[st]}${v.carers_needed > 1 ? `, double-up of ${v.carers_needed}` : ""}`;
    return (
      <button
        key={`${v.id}-${top}`}
        type="button"
        aria-label={aria}
        aria-pressed={ctx.selected === v.id}
        title={aria}
        onClick={() => ctx.onSelect(v.id)}
        onDoubleClick={(e) => ctx.onOpen(team, v.id, e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            ctx.onOpen(team, v.id, e.currentTarget);
          }
        }}
        className={`absolute overflow-hidden rounded-lg border text-left text-[11px] leading-[13px] ${ctx.selected === v.id ? "outline outline-2 outline-offset-1 outline-ink" : ""} ${
          dim ? "opacity-30" : ""
        } ${ctx.highlightOn && !dim ? "outline outline-2 outline-offset-1 outline-brand" : ""}`}
        style={{
          ...(st === "unallocated" ? UNALLOCATED_STYLE : typeStyle(k)),
          left: pos(start),
          width: wid(start, start + v.duration),
          minWidth: 26,
          top,
          height: ROW_H - 8,
        }}
      >
        <span className="flex items-start justify-between gap-0.5 px-1.5 pt-[3px]">
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

  const hourLines = HOURS.map((h) => <div key={h} aria-hidden className="hour-line absolute inset-y-0" style={{ left: pos(h * 60) }} />);

  // Unallocated visits (carer view only; in the client view they sit in the client's row).
  const unallocated = dayVisits.filter((v) => assignedIn(v, view).length === 0 && ctx.visible(v)).sort((a, b) => a.preferred_start - b.preferred_start);
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
  const unallocHeight = ROW_H + Math.max(0, lanes.length - 1) * (ROW_H - 6);

  const carerRows = report.carers
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .map((c) => ({ c, stops: stopsFor(c.id).filter((s) => ctx.visible(s.v)) }))
    .filter((r) => !ctx.filtering || r.stops.length > 0);
  const clientRows = report.clients
    .filter((c) => !q || c.ref.toLowerCase().includes(q) || (c.display_name ?? "").toLowerCase().includes(q))
    .map((c) => ({ c, visits: dayVisits.filter((v) => v.client_id === c.id && ctx.visible(v)) }))
    .filter((r) => !ctx.filtering || r.visits.length > 0)
    .sort((a, b) => (a.c.display_name || a.c.ref).localeCompare(b.c.display_name || b.c.ref));

  return (
    <div className="mb-4">
      {showTeam && <p className="mb-1 text-xs font-semibold text-muted">{team}</p>}
      <div className="rounded-xl border border-line bg-surface">
        <div style={{ width: 224 + trackW }} role="table" aria-label={`${group === "carer" ? "Carer" : "Client"} day roster for ${team}, ${view === "engine" ? "suggested rota" : "your rota"}`}>
          <div className="sticky top-0 z-20 flex border-b border-line bg-canvas text-xs text-muted" role="row">
            <Gutter className="z-30 bg-canvas px-3 py-2">
              <span role="columnheader">{group === "carer" ? "Carer" : "Client"}</span>
            </Gutter>
            <div className="relative h-8 shrink-0" style={{ width: trackW }} role="columnheader" aria-label="Time of day, 04:00 to 24:00">
              {HOURS.map((h) => (
                <span key={h} aria-hidden className="absolute top-2 -translate-x-1/2" style={{ left: pos(h * 60) }}>
                  {String(h % 24).padStart(2, "0")}
                </span>
              ))}
            </div>
          </div>

          {group === "carer" && (
            <div className="flex border-b border-line bg-warn-soft" role="row">
              <Gutter className="flex items-center justify-between gap-2 bg-warn-soft px-3">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-warn">
                  <IconUnallocated aria-hidden className="h-4 w-4" /> Unallocated
                </span>
                <span className="text-xs text-muted">{unallocated.length}</span>
              </Gutter>
              <div className="relative shrink-0" style={{ height: unallocHeight, width: trackW }} role="cell">
                {hourLines}
                {unallocated.map((v) => (
                  <Fragment key={v.id}>{renderBlock(v, v.preferred_start, labels.get(v.client_id) ?? v.client_id, 4 + (laneOf.get(v.id) ?? 0) * (ROW_H - 6))}</Fragment>
                ))}
              </div>
            </div>
          )}

          {group === "carer" &&
            carerRows.map(({ c, stops }) => {
              const mins = stops.reduce((a, s) => a + s.v.duration, 0);
              const walk = c.travel_mode != null && c.travel_mode !== "car";
              const TravelIcon = walk ? IconWalk : IconTravelCar;
              const avail = c.availability.filter((a) => a.day === day);
              return (
                <div key={c.id} className="flex border-b border-line last:border-0" role="row">
                  <Gutter className="flex items-center gap-2 bg-surface px-3">
                    <Avatar name={c.name} size={28} />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate font-semibold">{c.name}</span>
                      <span className="block truncate text-xs text-muted">{team}</span>
                    </span>
                    <span className="rounded-full bg-hover px-2 py-0.5 text-xs font-semibold" title="Booked care hours this day">
                      {hoursText(mins)}
                    </span>
                  </Gutter>
                  <div className="relative shrink-0" style={{ height: ROW_H, width: trackW }} role="cell">
                    {avail.length === 0 && <div aria-hidden className="off-hours absolute inset-0" />}
                    {avail.map((a, i) => (
                      <div key={i} aria-hidden className="absolute inset-y-0 bg-ok-soft/60" style={{ left: pos(a.start), width: wid(a.start, a.end) }} />
                    ))}
                    {hourLines}
                    {stops.map((s, i) => {
                      const prev = stops[i - 1];
                      let chip: React.ReactNode = null;
                      if (prev && s.travel != null && s.travel > 0) {
                        const gap = s.start - prev.end;
                        const fits = gap >= s.travel;
                        const text = `Travel ${s.travel} min, gap ${gap} min: ${fits ? "fits" : "short gap"}`;
                        chip = (
                          <span
                            role="img"
                            aria-label={text}
                            title={text}
                            className={`absolute z-[5] inline-flex h-4 -translate-x-1/2 items-center rounded-md px-1 ${fits ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn ring-1 ring-bad"}`}
                            style={{ left: pos(prev.end + Math.max(gap, 0) / 2), top: ROW_H / 2 - 8 }}
                          >
                            <TravelIcon aria-hidden className="h-3 w-3" />
                          </span>
                        );
                      }
                      return (
                        <div key={s.v.id}>
                          {chip}
                          {renderBlock(s.v, s.start, labels.get(s.v.client_id) ?? s.v.client_id, 4)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

          {group === "client" &&
            clientRows.map(({ c, visits }) => (
              <div key={c.id} className="flex border-b border-line last:border-0" role="row">
                <Gutter className="flex items-center gap-2 bg-surface px-3">
                  <Avatar name={c.display_name || c.ref} size={28} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-semibold">{c.display_name || c.ref}</span>
                    <span className="block truncate text-xs text-muted">{c.ref}</span>
                  </span>
                  <span className="rounded-full bg-hover px-2 py-0.5 text-xs font-semibold" title="Booked care hours this day">
                    {hoursText(visits.reduce((a, v) => a + v.duration, 0))}
                  </span>
                </Gutter>
                <div className="relative shrink-0" style={{ height: ROW_H, width: trackW }} role="cell">
                  {hourLines}
                  {visits.map((v) => {
                    const who = assignedIn(v, view).map((id) => names.get(id) ?? id).join(" + ");
                    return renderBlock(v, startIn(v, view), who || "Unallocated", 4);
                  })}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

