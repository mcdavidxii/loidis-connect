"use client";

import { useEffect, useRef } from "react";
import { hhmm } from "@/lib/time";
import { DAYS, type Change, type Report, type ReportVisit } from "@/lib/types";
import { IconChanged, IconClose, IconLock, IconMoved, IconUnchanged } from "./icons";
import { plainLock, plainReason } from "@/lib/warnings";
import { CLASS_LABEL, sameCarers } from "./rosterShared";
import { Button } from "./ui";

export function VisitDrawer({
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
  if (v.lock_reason) warnings.push(`Kept as is: ${plainLock(v.lock_reason)}`);
  if (v.assigned.length === 0 && v.unfilled_reason) warnings.push(v.unfilled_reason);
  if (idx > 0) {
    const gap = stops[idx].start - stops[idx - 1].end;
    if (gap < stops[idx].travel_before) warnings.push(`Short gap: ${gap} min between visits, ${stops[idx].travel_before} min travel`);
  }
  v.assigned.forEach((id) => {
    const c = report.carers.find((x) => x.id === id);
    c?.issues.forEach((i) => warnings.push(`${c.name}: ${i}`));
  });

  const row = (k: string, val: React.ReactNode) => (
    <div className="grid grid-cols-[8rem_1fr] gap-2 border-b border-line py-2">
      <dt className="text-xs text-muted">{k}</dt>
      <dd>{val}</dd>
    </div>
  );

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Visit details"
      className="fixed bottom-4 right-4 top-4 z-40 w-[26rem] overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-2xl"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base">{clientName || clientRef}</h3>
          <p className="text-xs text-muted">
            {clientRef} · {v.booking_id}
          </p>
        </div>
        <button ref={closeRef} type="button" aria-label="Close details" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-hover">
          <IconClose aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <dl className="text-sm">
        {row("Booking type", v.booking_type)}
        {row("Date", date)}
        {row("Booked", `${hhmm(v.preferred_start)} to ${hhmm(v.preferred_start + v.duration)}`)}
        {row("Suggested rota", v.start == null ? "Not planned" : `${hhmm(planned)} to ${hhmm(planned + v.duration)}${shift !== 0 ? ` (${shift > 0 ? "+" : ""}${shift} min)` : " (same time)"}`)}
        {row("Your rota", list(v.current_assigned))}
        {row("Suggested carers", list(v.assigned))}
        {row(
          "Change",
          <span className="flex items-center gap-1.5">
            {cls === "carer" ? (
              <IconChanged aria-hidden className="h-4 w-4 text-muted" />
            ) : cls && cls !== "unchanged" ? (
              <IconMoved aria-hidden className="h-4 w-4 text-muted" />
            ) : (
              <IconUnchanged aria-hidden className="h-4 w-4 text-muted" />
            )}
            {cls ? (CLASS_LABEL[cls] ?? cls) : "Unallocated"}
          </span>,
        )}
        {change && row("Why", plainReason(change.reason))}
        {row("Travel before", before == null ? "-" : `${before} min`)}
        {row("Travel after", after == null ? "-" : `${after} min`)}
        {row(
          "Warnings",
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
            Stop keeping with {names.get(lockedTo) ?? lockedTo}
          </Button>
        ) : (
          <>
            {v.assigned[0] && (
              <Button onClick={() => onLock(v.assigned[0])}>
                <IconLock aria-hidden className="h-4 w-4 text-muted" />
                Keep with this carer
              </Button>
            )}
            {v.current_assigned[0] && (
              <Button onClick={() => onLock(v.current_assigned[0])}>
                <IconLock aria-hidden className="h-4 w-4 text-muted" />
                Keep with current carer
              </Button>
            )}
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">This applies the next time you make suggestions.</p>
    </aside>
  );
}
