"use client";

import { useEffect, useRef, useState } from "react";
import { addDays } from "@/lib/time";
import type { Change, Report, ReportVisit } from "@/lib/types";
import { useApp } from "./AppProvider";
import { IconDoubleUp, IconInfo, IconLock, IconNext, IconPrev, IconRefresh, IconTimeCritical, IconTravelCar, IconWalk } from "./icons";
import { RosterDay } from "./RosterDay";
import { RosterWeek } from "./RosterWeek";
import {
  STATUS_COLOR,
  STATUS_LABEL,
  TYPES,
  assignedIn,
  changedFlag,
  shiftOf,
  typeKey,
  typeStyle,
  type RosterCtx,
  type Status,
  type TypeKey,
  type View,
} from "./rosterShared";
import { VisitDrawer } from "./VisitDrawer";
import { Button, Segmented, inputCls } from "./ui";

type StatusFilter = "all" | "changed" | "unallocated";

export function Roster({ reports, changes }: { reports: Record<string, Report>; changes: Change[] }) {
  const { locks, toggleLock, query } = useApp();
  const teams = Object.keys(reports);
  const [layout, setLayout] = useState<"week" | "day">("week");
  const [group, setGroup] = useState<"client" | "carer">("client");
  const [view, setView] = useState<View>("engine");
  const [teamSel, setTeamSel] = useState<string>("all");
  const [day, setDay] = useState(0);
  const [typeFilter, setTypeFilter] = useState<TypeKey | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [hlChanged, setHlChanged] = useState(false);
  const [hlMoved, setHlMoved] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<{ team: string; id: string } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [hourPx, setHourPx] = useState(96);
  const returnFocus = useRef<HTMLElement | null>(null);

  const activeTeams = teamSel === "all" ? teams : [teamSel];
  const weekStart = reports[teams[0]].week_start;
  const date = addDays(weekStart, day);
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
  const dayTitle = fmt(date, { weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(",", "");
  const weekTitle = `${fmt(weekStart, { day: "numeric", month: "short" })} – ${fmt(addDays(weekStart, 6), { day: "numeric", month: "short", year: "numeric" })}`;

  const highlightOn = hlChanged || hlMoved > 0;
  const isHighlighted = (v: ReportVisit) => {
    if (!highlightOn) return true;
    const carersDiffer = v.assigned.join() !== v.current_assigned.join() && changedFlag(v);
    return (hlChanged && carersDiffer) || (hlMoved > 0 && v.assigned.length > 0 && shiftOf(v) >= hlMoved);
  };
  const visible = (v: ReportVisit) => {
    if (typeFilter !== "all" && typeKey(v.booking_type) !== typeFilter) return false;
    if (statusFilter === "changed") return changedFlag(v);
    if (statusFilter === "unallocated") return assignedIn(v, view).length === 0;
    return true;
  };

  const allVisits = activeTeams.flatMap((t) => reports[t].visits);
  const counts = {
    all: allVisits.length,
    changed: allVisits.filter(changedFlag).length,
    unallocated: allVisits.filter((v) => assignedIn(v, view).length === 0).length,
  };

  const ctx: RosterCtx = {
    view,
    locks,
    selected,
    highlightOn,
    isHighlighted,
    visible,
    query,
    filtering: typeFilter !== "all" || statusFilter !== "all",
    onSelect: setSelected,
    onOpen: (team, id, el) => {
      returnFocus.current = el;
      setSelected(id);
      setOpen({ team, id });
    },
  };

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

  const openReport = open ? reports[open.team] : undefined;
  const openV = open && openReport ? openReport.visits.find((v) => v.id === open.id) : undefined;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented<"week" | "day">
          label="Layout"
          value={layout}
          onChange={setLayout}
          options={[
            { id: "week", label: "Week" },
            { id: "day", label: "Day" },
          ]}
        />
        <Segmented<"client" | "carer">
          label="Rows"
          value={group}
          onChange={setGroup}
          options={[
            { id: "client", label: "By client" },
            { id: "carer", label: "By carer" },
          ]}
        />
        <Segmented<View>
          label="Rota to show"
          value={view}
          onChange={setView}
          options={[
            { id: "current", label: "Your rota" },
            { id: "engine", label: "Suggested rota" },
          ]}
        />
        <div className="ml-auto flex items-center gap-1">
          {layout === "day" ? (
            <>
              <button type="button" aria-label="Previous day" disabled={day === 0} onClick={() => setDay(day - 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface hover:bg-hover disabled:opacity-40">
                <IconPrev aria-hidden className="h-4 w-4" />
              </button>
              <input
                type="date"
                aria-label="Date"
                className={inputCls}
                value={date}
                min={weekStart}
                max={addDays(weekStart, 6)}
                onChange={(e) => {
                  const d = Math.round((Date.parse(e.target.value) - Date.parse(weekStart)) / 86400000);
                  if (d >= 0 && d <= 6) setDay(d);
                }}
              />
              <button type="button" aria-label="Next day" disabled={day === 6} onClick={() => setDay(day + 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface hover:bg-hover disabled:opacity-40">
                <IconNext aria-hidden className="h-4 w-4" />
              </button>
            </>
          ) : (
            <span className="px-2 text-sm font-semibold">{weekTitle}</span>
          )}
          <button
            type="button"
            aria-label="Reset filters and highlights"
            title="Reset filters and highlights"
            onClick={() => {
              setTypeFilter("all");
              setStatusFilter("all");
              setHlChanged(false);
              setHlMoved(0);
              setSelected(null);
            }}
            className="ml-1 grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface hover:bg-hover"
          >
            <IconRefresh aria-hidden className="h-4 w-4 text-muted" />
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<StatusFilter>
          label="Show"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { id: "all", label: "All", count: counts.all },
            { id: "changed", label: "Suggested changes", count: counts.changed },
            { id: "unallocated", label: "Unallocated", count: counts.unallocated },
          ]}
        />
        {teams.length > 1 && (
          <Segmented<string>
            label="Team"
            value={teamSel}
            onChange={(t) => {
              setTeamSel(t);
              setOpen(null);
            }}
            options={[{ id: "all", label: "All teams" }, ...teams.map((t) => ({ id: t, label: t }))]}
          />
        )}
        <div className="relative">
          <Button aria-expanded={filterOpen} onClick={() => setFilterOpen(!filterOpen)}>
            Add filter{typeFilter !== "all" ? " (on)" : ""}
          </Button>
          {filterOpen && (
            <div className="absolute left-0 top-10 z-30 w-60 space-y-2 rounded-xl border border-line bg-surface p-3 text-sm shadow-xl">
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
              <p className="text-xs text-muted">Teams and status are chosen with the buttons beside this one.</p>
            </div>
          )}
        </div>
        <div role="group" aria-label="Highlight" className="flex items-center gap-2 text-sm">
          <span className="text-xs text-muted">Highlight</span>
          <label className="sr-only" htmlFor="hl-changed">
            Suggested changes
          </label>
          <select id="hl-changed" className={inputCls} value={hlChanged ? "on" : "off"} onChange={(e) => setHlChanged(e.target.value === "on")}>
            <option value="off">Suggested changes: off</option>
            <option value="on">Suggested changes: on</option>
          </select>
          <label className="sr-only" htmlFor="hl-moved">
            New time by at least
          </label>
          <select id="hl-moved" className={inputCls} value={hlMoved} onChange={(e) => setHlMoved(Number(e.target.value))}>
            <option value={0}>New time by at least: off</option>
            {[5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                New time by at least {m} min
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
              className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface hover:bg-hover"
            >
              <IconInfo aria-hidden className="h-4 w-4 text-muted" />
            </button>
            {legendOpen && (
              <div role="dialog" aria-label="Legend" className="absolute right-0 top-10 z-30 w-64 rounded-xl border border-line bg-surface p-3 text-xs shadow-xl">
                <p className="mb-1 font-semibold">Status</p>
                <ul className="mb-3 space-y-1">
                  {(Object.keys(STATUS_LABEL) as Status[]).map((st) => (
                    <li key={st} className="flex items-center gap-2">
                      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[st] }} />
                      <span aria-hidden className={`inline-block h-1 w-5 strip-${st}`} />
                      {STATUS_LABEL[st]}
                    </li>
                  ))}
                </ul>
                <p className="mb-1 font-semibold">Travel between visits (day view, by carer)</p>
                <ul className="mb-3 space-y-1">
                  <li className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-md bg-ok-soft px-1 text-ok">
                      <IconTravelCar aria-hidden className="h-3 w-3" />
                    </span>
                    Gap fits the travel estimate
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-md bg-bad-soft px-1 text-bad ring-1 ring-bad">
                      <IconWalk aria-hidden className="h-3 w-3" />
                    </span>
                    Short gap (car or walking icon by carer)
                  </li>
                </ul>
                <p className="mb-1 font-semibold">Icons</p>
                <ul className="space-y-1">
                  <li className="flex items-center gap-2"><IconDoubleUp aria-hidden className="h-3 w-3" /> Double-up (number of carers)</li>
                  <li className="flex items-center gap-2"><IconLock aria-hidden className="h-3 w-3" /> Kept as is</li>
                  <li className="flex items-center gap-2"><IconTimeCritical aria-hidden className="h-3 w-3" /> Time-critical</li>
                </ul>
              </div>
            )}
          </div>
        </div>
        {layout === "day" && (
          <Segmented<string>
            label="Zoom"
            value={String(hourPx)}
            onChange={(v) => setHourPx(Number(v))}
            options={[
              { id: "64", label: "S" },
              { id: "96", label: "M" },
              { id: "128", label: "L" },
            ]}
          />
        )}
      </div>

      <ul className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" aria-label="Booking types">
        {TYPES.map((t) => (
          <li key={t.key} className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-3 w-3 rounded-[3px] border" style={typeStyle(t.key)} />
            {t.label}
          </li>
        ))}
      </ul>

      {layout === "week" ? (
        <RosterWeek reports={reports} teams={activeTeams} group={group} ctx={ctx} onDay={(d) => { setDay(d); setLayout("day"); }} />
      ) : (
        <div>
          <h3 className="mb-2 text-base" aria-live="polite">
            {dayTitle}
          </h3>
          {activeTeams.map((t) => (
            <RosterDay key={t} report={reports[t]} team={t} group={group} ctx={ctx} day={day} hourPx={hourPx} showTeam={activeTeams.length > 1} />
          ))}
          <p className="mt-1 text-xs text-muted">Click a visit to select it. Double-click, or press Enter, for details. Escape closes them.</p>
        </div>
      )}

      {openV && openReport && (
        <VisitDrawer
          v={openV}
          report={openReport}
          names={new Map(Object.values(reports).flatMap((r) => r.carers.map((c) => [c.id, c.name] as const)))}
          clientRef={openReport.clients.find((c) => c.id === openV.client_id)?.ref ?? ""}
          clientName={(() => {
            const c = openReport.clients.find((x) => x.id === openV.client_id);
            return c?.display_name || c?.ref || "";
          })()}
          date={addDays(weekStart, openV.day)}
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
