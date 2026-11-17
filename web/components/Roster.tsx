"use client";

import { AlertCircle, ArrowLeftRight, Check, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { addDays, hhmm, niceDate } from "@/lib/time";
import { DAYS, DAY_LABELS, type Report, type ReportVisit } from "@/lib/types";
import { useApp } from "./AppProvider";
import { Badge, Button } from "./ui";

const AXIS_START = 6 * 60;
const AXIS_END = 23 * 60;
const SPAN = AXIS_END - AXIS_START;
const pos = (m: number) => `${(Math.max(0, Math.min(SPAN, m - AXIS_START)) / SPAN) * 100}%`;
const wid = (a: number, b: number) => `${((Math.max(AXIS_START, Math.min(AXIS_END, b)) - Math.max(AXIS_START, Math.min(AXIS_END, a))) / SPAN) * 100}%`;
const HOURS = Array.from({ length: 18 }, (_, i) => 6 + i);

function shortRef(ref: string) {
  return ref.replace(/^CL-0*/, "") || ref;
}

type State = "unallocated" | "moved" | "locked" | "normal";

function stateOf(v: ReportVisit, userLocked: boolean): State {
  if (v.assigned.length === 0) return "unallocated";
  if (v.moved) return "moved";
  if (v.locked || userLocked) return "locked";
  return "normal";
}

const STATE_CLS: Record<State, string> = {
  normal: "border-brand bg-brand-soft text-brand-strong",
  moved: "border-moved bg-moved-soft text-moved",
  locked: "border-locked bg-locked-soft text-locked",
  unallocated: "border-dashed border-bad bg-bad-soft text-bad",
};

function StateIcon({ s }: { s: State }) {
  const c = "h-3 w-3 shrink-0";
  if (s === "unallocated") return <AlertCircle aria-hidden className={c} />;
  if (s === "moved") return <ArrowLeftRight aria-hidden className={c} />;
  if (s === "locked") return <Lock aria-hidden className={c} />;
  return <Check aria-hidden className={c} />;
}

function Block({
  v,
  label,
  start,
  state,
  selected,
  onSelect,
  top,
}: {
  v: ReportVisit;
  label: string;
  start: number;
  state: State;
  selected: boolean;
  onSelect: () => void;
  top?: number;
}) {
  const stateText = { normal: "allocated", moved: "moved", locked: "locked", unallocated: "unallocated" }[state];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Client ${label}, ${hhmm(start)} to ${hhmm(start + v.duration)}, ${v.booking_type}, ${stateText}`}
      title={`${label} ${hhmm(start)}-${hhmm(start + v.duration)} ${v.booking_type} (${stateText})`}
      className={`absolute flex items-center gap-0.5 overflow-hidden rounded border px-1 text-[11px] font-medium leading-none ${STATE_CLS[state]} ${selected ? "ring-2 ring-blue-700" : ""}`}
      style={{ left: pos(start), width: wid(start, start + v.duration), minWidth: 22, top: top ?? 4, height: 28 }}
    >
      <StateIcon s={state} />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function Roster({ reports, mode }: { reports: Record<string, Report>; mode: "new" | "improve" }) {
  const { locks, toggleLock } = useApp();
  const teams = Object.keys(reports);
  const [team, setTeam] = useState(teams[0]);
  const [day, setDay] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const report = reports[team];
  const dayKey = DAYS[day];

  const refs = useMemo(() => new Map(report.clients.map((c) => [c.id, c.ref])), [report]);
  const names = useMemo(() => new Map(report.carers.map((c) => [c.id, c.name])), [report]);
  const visitsById = useMemo(() => new Map(report.visits.map((v) => [v.id, v])), [report]);
  const dayVisits = report.visits.filter((v) => v.day === day);
  const unallocated = dayVisits.filter((v) => v.assigned.length === 0).sort((a, b) => a.preferred_start - b.preferred_start);

  // Stack unallocated visits that overlap in time into lanes.
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
  const unallocHeight = Math.max(1, lanes.length) * 34 + 6;

  const sel = selected ? visitsById.get(selected) : undefined;
  const selLocked = sel ? Boolean(locks[sel.booking_id]) : false;
  const lockTarget = sel ? (sel.current_assigned[0] ?? sel.assigned[0]) : undefined;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <div role="group" aria-label="Team" className="inline-flex overflow-hidden rounded-md border border-line">
          {teams.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={t === team}
              onClick={() => {
                setTeam(t);
                setSelected(null);
              }}
              className={`px-3 py-1.5 text-sm ${t === team ? "bg-brand font-semibold text-white" : "bg-surface hover:bg-canvas"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Day" className="inline-flex flex-wrap overflow-hidden rounded-md border border-line">
          {DAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              aria-pressed={i === day}
              aria-label={`${DAY_LABELS[d]} ${niceDate(addDays(report.week_start, i))}`}
              onClick={() => {
                setDay(i);
                setSelected(null);
              }}
              className={`px-3 py-1.5 text-sm ${i === day ? "bg-brand font-semibold text-white" : "bg-surface hover:bg-canvas"}`}
            >
              {d[0].toUpperCase() + d.slice(1)} <span className="text-xs opacity-80">{niceDate(addDays(report.week_start, i)).split(" ")[0]}</span>
            </button>
          ))}
        </div>
      </div>

      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
        <li className="flex items-center gap-1"><Badge tone="ok" icon={<Check aria-hidden className="h-3 w-3" />}>Allocated</Badge></li>
        <li className="flex items-center gap-1"><Badge tone="moved" icon={<ArrowLeftRight aria-hidden className="h-3 w-3" />}>Moved (differs from current rota)</Badge></li>
        <li className="flex items-center gap-1"><Badge tone="locked" icon={<Lock aria-hidden className="h-3 w-3" />}>Locked / time-critical</Badge></li>
        <li className="flex items-center gap-1"><Badge tone="bad" icon={<AlertCircle aria-hidden className="h-3 w-3" />}>Unallocated</Badge></li>
        <li className="flex items-center gap-1"><span aria-hidden className="travel-gap inline-block h-3 w-6 rounded-sm border border-line" /> Travel</li>
        <li className="flex items-center gap-1"><span aria-hidden className="worktime inline-block h-3 w-6 rounded-sm border border-line" /> Working hours</li>
        <li>Block label = client number</li>
      </ul>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <div className="min-w-[1180px]" role="table" aria-label={`Roster for ${team}, ${DAY_LABELS[dayKey]}`}>
          <div className="flex border-b border-line bg-canvas text-xs text-muted" role="row">
            <div className="sticky left-0 z-10 w-44 shrink-0 border-r border-line bg-canvas px-3 py-2" role="columnheader">Carer</div>
            <div className="relative h-8 flex-1" role="columnheader" aria-label="Time of day, 06:00 to 23:00">
              {HOURS.map((h) => (
                <span key={h} className="absolute top-2 -translate-x-1/2" style={{ left: pos(h * 60) }} aria-hidden>
                  {String(h).padStart(2, "0")}
                </span>
              ))}
            </div>
          </div>

          <div className="flex border-b border-line bg-bad-soft/40" role="row">
            <div className="sticky left-0 z-10 flex w-44 shrink-0 flex-col justify-center border-r border-line bg-bad-soft px-3 py-2 text-sm" role="rowheader">
              <span className="flex items-center gap-1 font-semibold text-bad">
                <AlertCircle aria-hidden className="h-4 w-4" /> Unallocated
              </span>
              <span className="text-xs text-muted">{unallocated.length} booking(s)</span>
            </div>
            <div className="relative flex-1" style={{ height: unallocHeight }} role="cell">
              {unallocated.map((v) => (
                <Block key={v.id} v={v} label={shortRef(refs.get(v.client_id) ?? "")} start={v.preferred_start} state="unallocated" selected={selected === v.id} onSelect={() => setSelected(v.id)} top={4 + (laneOf.get(v.id) ?? 0) * 34} />
              ))}
            </div>
          </div>

          {report.carers.map((c) => {
            const stops = report.routes[c.id]?.[dayKey] ?? [];
            const mins = stops.reduce((a, s) => a + (s.end - s.start), 0);
            return (
              <div key={c.id} className="flex border-b border-line last:border-0" role="row">
                <div className="sticky left-0 z-10 w-44 shrink-0 border-r border-line bg-surface px-3 py-2 text-sm" role="rowheader">
                  <span className="block font-medium">{c.name}</span>
                  <span className="text-xs text-muted">{stops.length} visit(s), {(mins / 60).toFixed(1)} h</span>
                </div>
                <div className="relative h-10 flex-1" role="cell">
                  {c.availability
                    .filter((a) => a.day === day)
                    .map((a, i) => (
                      <div key={i} className="worktime absolute inset-y-0" style={{ left: pos(a.start), width: wid(a.start, a.end) }} />
                    ))}
                  {HOURS.map((h) => (
                    <div key={h} aria-hidden className="absolute inset-y-0 border-l border-line/60" style={{ left: pos(h * 60) }} />
                  ))}
                  {stops.map((s) => {
                    const v = visitsById.get(s.visit_id);
                    if (!v) return null;
                    return (
                      <div key={s.visit_id}>
                        {s.travel_before > 0 && (
                          <div
                            className="travel-gap absolute top-3 h-4 rounded-sm"
                            title={`Travel ${s.travel_before} min`}
                            style={{ left: pos(s.start - s.travel_before), width: wid(s.start - s.travel_before, s.start) }}
                          />
                        )}
                        <Block v={v} label={shortRef(refs.get(s.client_id) ?? "")} start={s.start} state={stateOf(v, Boolean(locks[v.booking_id]))} selected={selected === v.id} onSelect={() => setSelected(v.id)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 min-h-20 rounded-lg border border-line bg-surface p-4 text-sm" aria-live="polite">
        {!sel ? (
          <p className="text-muted">Select a visit to see its details.</p>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">Booking</dt>
              <dd>{sel.booking_id} ({refs.get(sel.client_id)}), {sel.booking_type}</dd>
              <dt className="text-muted">Time</dt>
              <dd>
                booked {hhmm(sel.preferred_start)}
                {sel.start != null && sel.start !== sel.preferred_start && <>, planned {hhmm(sel.start)} ({sel.start - sel.preferred_start} min later)</>}
                , {sel.duration} min
              </dd>
              <dt className="text-muted">Carer(s)</dt>
              <dd>
                {sel.assigned.length ? sel.assigned.map((id) => names.get(id)).join(" + ") : "None (unallocated)"}
                {sel.moved && <> (currently: {sel.current_assigned.map((id) => names.get(id)).join(" + ") || "unallocated"})</>}
              </dd>
              {sel.assigned.length === 0 && (
                <>
                  <dt className="text-muted">Why</dt>
                  <dd>{sel.unfilled_reason}</dd>
                </>
              )}
              {(sel.locked || selLocked) && (
                <>
                  <dt className="text-muted">Locked</dt>
                  <dd>{selLocked ? "Locked to a carer by you" : sel.lock_reason}</dd>
                </>
              )}
            </dl>
            {lockTarget && !sel.locked && (
              <Button onClick={() => toggleLock(sel.booking_id, lockTarget)}>
                <Lock aria-hidden className="h-4 w-4" />
                {selLocked ? "Unlock" : mode === "improve" ? "Lock to current carer" : "Lock to carer"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
