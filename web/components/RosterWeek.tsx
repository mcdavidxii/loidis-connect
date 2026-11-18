"use client";

import { useState } from "react";
import { areaLabel } from "@/lib/areas";
import { addDays, hhmm } from "@/lib/time";
import { DAYS, type Report, type ReportVisit } from "@/lib/types";
import { IconDoubleUp, IconLock, IconTimeCritical } from "./icons";
import {
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_SHORT,
  TYPES,
  UNALLOCATED_STYLE,
  assignedIn,
  hoursText,
  isCritical,
  startIn,
  statusOf,
  typeKey,
  typeStyle,
  type RosterCtx,
} from "./rosterShared";
import { Avatar, StatusDot } from "./ui";

const COLS = "200px repeat(7, minmax(112px, 1fr)) 96px";
const MAX_CARDS = 2;

function VisitCard({ v, team, who, ctx }: { v: ReportVisit; team: string; who: string; ctx: RosterCtx }) {
  const st = statusOf(v, ctx.view, ctx.locks);
  const k = typeKey(v.booking_type);
  const start = startIn(v, ctx.view);
  const dim = ctx.highlightOn && !ctx.isHighlighted(v);
  const typeLabel = TYPES.find((t) => t.key === k)?.label ?? "";
  const userLocked = Boolean(ctx.locks[v.booking_id ?? ""]);
  const aria = `${who}, ${v.booking_type}, ${hhmm(start)} to ${hhmm(start + v.duration)}, ${STATUS_LABEL[st]}${v.carers_needed > 1 ? `, double-up of ${v.carers_needed}` : ""}. Open details`;
  return (
    <button
      type="button"
      aria-label={aria}
      title={aria}
      onClick={(e) => {
        ctx.onSelect(v.id);
        ctx.onOpen(team, v.id, e.currentTarget);
      }}
      className={`block w-full rounded-lg border px-2 py-1.5 text-left text-xs leading-[15px] ${dim ? "opacity-30" : ""} ${
        ctx.selected === v.id ? "outline outline-2 outline-offset-1 outline-ink" : ""
      } ${ctx.highlightOn && !dim ? "outline outline-2 outline-offset-1 outline-brand" : ""}`}
      style={st === "unallocated" ? UNALLOCATED_STYLE : typeStyle(k)}
    >
      <span className="flex items-center justify-between gap-1">
        <span className="font-semibold">
          {hhmm(start)}–{hhmm(start + v.duration)}
        </span>
        <span className="flex items-center gap-1">
          {v.carers_needed > 1 && (
            <span className="flex items-center">
              <IconDoubleUp aria-hidden className="h-3 w-3" />
              <span className="font-semibold">{v.carers_needed}</span>
            </span>
          )}
          {isCritical(v) ? <IconTimeCritical aria-hidden className="h-3 w-3" /> : v.locked || userLocked ? <IconLock aria-hidden className="h-3 w-3" /> : null}
        </span>
      </span>
      <span className="mt-0.5 flex items-center gap-1">
        {st === "unallocated" ? (
          <span className="rounded-full bg-white/70 px-1.5 font-semibold">Unallocated</span>
        ) : (
          <>
            <Avatar name={who} size={16} />
            <span className="truncate">{who}</span>
          </>
        )}
      </span>
      <span className="mt-0.5 flex items-center gap-1 opacity-90">
        <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[st] }} />
        <span className="truncate">
          {STATUS_SHORT[st]} · {typeLabel}
        </span>
      </span>
    </button>
  );
}

interface Row {
  id: string;
  label: string;
  sub?: string;
  headerExtra?: string;
  visits: ReportVisit[];
  special?: "unallocated";
}

export function RosterWeek({
  reports,
  teams,
  group,
  ctx,
  onDay,
}: {
  reports: Record<string, Report>;
  teams: string[];
  group: "client" | "carer";
  ctx: RosterCtx;
  onDay: (d: number) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const weekStart = reports[teams[0]].week_start;
  const q = ctx.query.trim().toLowerCase();

  function rowsFor(rep: Report): Row[] {
    if (group === "client") {
      return rep.clients
        .map((c) => ({
          id: c.id,
          label: c.display_name || c.ref,
          sub: c.ref,
          visits: rep.visits.filter((v) => v.client_id === c.id && ctx.visible(v)),
        }))
        .filter((r) => !q || r.label.toLowerCase().includes(q) || (r.sub ?? "").toLowerCase().includes(q))
        .filter((r) => !ctx.filtering || r.visits.length > 0)
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    const rows: Row[] = [];
    const un = rep.visits.filter((v) => assignedIn(v, ctx.view).length === 0 && ctx.visible(v));
    if (un.length) rows.push({ id: "unallocated", label: "Unallocated", visits: un, special: "unallocated" });
    rep.carers
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .forEach((c) => {
        const all = rep.visits.filter((v) => assignedIn(v, ctx.view).includes(c.id));
        const mins = all.reduce((a, v) => a + v.duration, 0);
        const visits = all.filter((v) => ctx.visible(v));
        if (ctx.filtering && visits.length === 0) return;
        rows.push({
          id: c.id,
          label: c.name,
          headerExtra: c.max_minutes ? `${hoursText(mins)} of ${hoursText(c.max_minutes)}` : hoursText(mins),
          visits,
        });
      });
    return rows.sort((a, b) => (a.special ? -1 : b.special ? 1 : a.label.localeCompare(b.label)));
  }

  return (
    <div>
      <div style={{ minWidth: 200 + 7 * 112 + 96 }} role="table" aria-label={`Week roster by ${group}, ${ctx.view === "engine" ? "suggested rota" : "your rota"}`}>
        <div className="sticky top-0 z-20 grid border-b border-line bg-surface" style={{ gridTemplateColumns: COLS }} role="row">
          <div className="sticky left-0 z-30 bg-surface px-3 py-2 text-xs font-semibold text-muted" role="columnheader">
            {group === "client" ? "Client" : "Carer"}
          </div>
          {DAYS.map((d, i) => {
            const date = addDays(weekStart, i);
            return (
              <div key={d} role="columnheader" className="px-1 py-1 text-center">
                <button
                  type="button"
                  onClick={() => onDay(i)}
                  aria-label={`Open ${d} ${date} in day view`}
                  className="w-full rounded-lg px-2 py-1 hover:bg-hover"
                >
                  <span className="block text-2xl font-semibold leading-8">{Number(date.slice(8))}</span>
                  <span className="block text-[11px] uppercase text-muted">{d}</span>
                </button>
              </div>
            );
          })}
          <div className="px-3 py-2 text-right text-xs font-semibold text-muted" role="columnheader">
            Week
          </div>
        </div>

        {teams.map((team) => {
          const rep = reports[team];
          const rows = rowsFor(rep);
          const names = new Map(rep.carers.map((c) => [c.id, c.name]));
          const labels = new Map(rep.clients.map((c) => [c.id, c.display_name || c.ref]));
          return (
            <div key={team}>
              <div className="sticky top-[66px] z-10 bg-canvas px-3 py-1.5 text-xs font-semibold text-muted" role="row">
                <span role="rowheader">
                  {areaLabel(team)} <span className="font-normal">({rows.length})</span>
                </span>
              </div>
              {rows.length === 0 && <p className="px-3 py-3 text-sm text-muted">Nothing to show.</p>}
              {rows.map((r) => {
                const mins = r.visits.reduce((a, v) => a + v.duration, 0);
                return (
                  <div key={r.id} className="grid border-b border-line" style={{ gridTemplateColumns: COLS }} role="row">
                    <div className="sticky left-0 z-10 flex items-start gap-2 bg-surface px-3 py-2" role="rowheader">
                      <Avatar name={r.label} size={28} />
                      <span className="min-w-0 leading-tight">
                        <span className={`block truncate font-semibold ${r.special ? "text-warn" : ""}`}>{r.label}</span>
                        {(r.sub || r.headerExtra) && <span className="block truncate text-xs text-muted">{r.headerExtra ?? r.sub}</span>}
                      </span>
                    </div>
                    {DAYS.map((_, d) => {
                      const list = r.visits.filter((v) => v.day === d).sort((a, b) => startIn(a, ctx.view) - startIn(b, ctx.view));
                      const key = `${team}|${r.id}|${d}`;
                      const open = expanded.has(key);
                      const shown = open ? list : list.slice(0, MAX_CARDS);
                      return (
                        <div key={d} role="cell" className="space-y-1 border-l border-line px-1 py-1.5">
                          {shown.map((v) => (
                            <VisitCard
                              key={v.id}
                              v={v}
                              team={team}
                              ctx={ctx}
                              who={group === "client" ? assignedIn(v, ctx.view).map((id) => names.get(id) ?? id).join(" + ") || "Unallocated" : (labels.get(v.client_id) ?? v.client_id)}
                            />
                          ))}
                          {list.length > MAX_CARDS && (
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() =>
                                setExpanded((s) => {
                                  const n = new Set(s);
                                  if (n.has(key)) n.delete(key);
                                  else n.add(key);
                                  return n;
                                })
                              }
                              className="w-full rounded-lg bg-hover px-2 py-1 text-xs text-muted hover:text-ink"
                            >
                              {open ? "Show less" : `+${list.length - MAX_CARDS} more`}
                            </button>
                          )}
                        </div>
                      );
                    })}
                    <div className="border-l border-line px-3 py-2 text-right text-xs text-muted" role="cell">
                      <span className="block font-semibold text-ink">{r.visits.length} visits</span>
                      {hoursText(mins)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="Status">
        {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => (
          <li key={s}>
            <StatusDot color={STATUS_COLOR[s]} label={STATUS_LABEL[s]} />
          </li>
        ))}
      </ul>
    </div>
  );
}
