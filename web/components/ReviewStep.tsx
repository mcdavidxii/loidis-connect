"use client";

import { AlertCircle, ArrowDown, ArrowRight, ArrowUp, Equal, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { addDays, niceDate } from "@/lib/time";
import type { Change, ReportMetrics, RunResult, TimeNote } from "@/lib/types";
import { useApp } from "./AppProvider";
import { Roster } from "./Roster";
import { Badge, Banner, Button, Card, PageTitle } from "./ui";

type Good = "down" | "up" | "none";

function Diff({ engine, current, good, unit = "", dp = 0 }: { engine: number; current: number; good: Good; unit?: string; dp?: number }) {
  const d = Math.round((engine - current) * 10 ** dp) / 10 ** dp;
  if (d === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted">
        <Equal aria-hidden className="h-4 w-4" /> No difference
      </span>
    );
  }
  const better = good === "none" ? null : good === "down" ? d < 0 : d > 0;
  const tone = better == null ? "text-muted" : better ? "text-ok" : "text-bad";
  const word = better == null ? "" : better ? "better" : "worse";
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${tone}`}>
      {d < 0 ? <ArrowDown aria-hidden className="h-4 w-4" /> : <ArrowUp aria-hidden className="h-4 w-4" />}
      {d < 0 ? "-" : "+"}
      {Math.abs(d).toFixed(dp)}
      {unit}
      {word && <span>({word})</span>}
    </span>
  );
}

function Stat({ label, engine, current, children }: { label: string; engine: ReactNode; current: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{engine}</p>
      <p className="text-sm text-muted">Current rota: {current}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Overview({ result }: { result: RunResult }) {
  const e = result.comparison.engine;
  const c = result.comparison.current;
  const pct = (m: ReportMetrics) => `${Math.round(m.continuity_rate * 100)}%`;
  const range = (m: ReportMetrics) => `${m.hours_min}-${m.hours_max} h`;
  const label = result.mode === "new" ? "Engine" : "After changes";
  return (
    <section aria-label="Overview">
      <h2 className="mb-2 text-lg font-semibold">Overview: {label.toLowerCase()} against your current rota</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Bookings filled" engine={`${e.filled} of ${e.visits}`} current={`${c.filled} of ${c.visits}`}>
          <Diff engine={e.filled} current={c.filled} good="up" />
        </Stat>
        <Stat label="Unallocated" engine={e.unfilled} current={c.unfilled}>
          <Diff engine={e.unfilled} current={c.unfilled} good="down" />
        </Stat>
        <Stat label="Travel time" engine={`${e.travel_hours} h`} current={`${c.travel_hours} h`}>
          <Diff engine={e.travel_hours} current={c.travel_hours} good="down" unit=" h" dp={1} />
        </Stat>
        <Stat label="Miles" engine={e.miles} current={c.miles}>
          <Diff engine={e.miles} current={c.miles} good="down" dp={1} />
        </Stat>
        <Stat label="Continuity (familiar carer)" engine={pct(e)} current={pct(c)}>
          <Diff engine={Math.round(e.continuity_rate * 100)} current={Math.round(c.continuity_rate * 100)} good="up" unit=" pts" />
        </Stat>
        <Stat label="Hours per carer (range)" engine={range(e)} current={range(c)}>
          <p className="text-sm text-muted">
            Median {e.hours_median} h (now {c.hours_median} h)
          </p>
        </Stat>
        <Stat label="Spread of hours (std. deviation)" engine={`${e.hours_stdev} h`} current={`${c.hours_stdev} h`}>
          <Diff engine={e.hours_stdev} current={c.hours_stdev} good="down" unit=" h" dp={1} />
        </Stat>
        <Stat label="Visits moved" engine={e.visits_moved} current={0}>
          <p className="text-sm text-muted">Different carer or time from the current rota.</p>
        </Stat>
      </div>
    </section>
  );
}

function Unallocated({ result }: { result: RunResult }) {
  const rows = Object.values(result.teams).flatMap((rep) => {
    const refs = new Map(rep.clients.map((c) => [c.id, c.ref]));
    return rep.visits
      .filter((v) => v.assigned.length === 0)
      .map((v) => ({ v, ref: refs.get(v.client_id) ?? "", date: addDays(rep.week_start, v.day) }));
  });
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return (
    <Card title={`Unallocated bookings (${rows.length})`}>
      {rows.length === 0 ? (
        <Banner tone="ok" title="Every booking has a carer." />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map(({ v, ref, date }) => (
            <li key={v.id} className="py-3 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <Badge tone="bad" icon={<AlertCircle aria-hidden className="h-3 w-3" />}>Unallocated</Badge>
                {v.booking_id} · {ref} · {niceDate(date)} {hhmm(v.preferred_start)} · {v.booking_type}
                {v.carers_needed > 1 && <span className="text-muted">(needs {v.carers_needed} carers)</span>}
              </p>
              <p className="mt-1">{v.unfilled_reason}</p>
              {v.unfilled_detail.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-muted">
                  {v.unfilled_detail.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NoteList({ notes }: { notes: TimeNote[] }) {
  if (notes.length === 0) return <p className="text-sm text-muted">None.</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {notes.map((n) => (
        <li key={n.booking_id} className="py-2">
          <span className="font-medium">
            {n.booking_id} · {n.client_ref} · {niceDate(n.date)}
          </span>{" "}
          with {n.carer}: booked {n.booked_start}, planned {n.new_start}. <span className="text-muted">{n.reason}</span>
        </li>
      ))}
    </ul>
  );
}

function Changes({ result }: { result: RunResult }) {
  const { locks, toggleLock, settings } = useApp();
  const tol = settings.agency.arrival_tolerance_minutes;
  const isSmall = (n: TimeNote) => n.kind === "time_within_tolerance";
  const forced = result.changes.filter((c) => c.forced_by_rules);
  const others = result.changes.filter((c) => !c.forced_by_rules);
  const summary = result.change_summary;
  const small = result.time_notes.filter(isSmall);
  const tight = result.time_notes.filter((n) => !isSmall(n));
  const findCurrent = (bookingId: string) => {
    for (const rep of Object.values(result.teams)) {
      const v = rep.visits.find((x) => x.booking_id === bookingId);
      if (v) return v.current_assigned[0];
    }
    return undefined;
  };
  const renderChange = (c: Change) => {
              const cur = findCurrent(c.booking_id);
              const locked = Boolean(locks[c.booking_id]);
              return (
                <li key={c.booking_id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {c.booking_id} · {c.client_ref} · {niceDate(c.date)} {c.booked_start}
                      <Badge tone="moved">{c.kind === "carer" ? "Carer change" : "Carer and time change"}</Badge>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1">
                      <span>{c.from_carers.join(" + ") || "Unallocated"}</span>
                      <ArrowRight aria-hidden className="h-4 w-4" />
                      <span className="font-medium">{c.to_carers.join(" + ")}</span>
                    </p>
                    <p className="mt-1 font-medium">
                      {(c.new_time_needed ?? c.new_start != null) && c.new_start
                        ? `Change the time to ${c.new_start}`
                        : `Keep the booked time (${c.booked_start})`}
                    </p>
                    <p className="mt-1 text-muted">Why: {c.reason}</p>
                  </div>
                  {cur && (
                    <Button onClick={() => toggleLock(c.booking_id, cur)}>
                      <Lock aria-hidden className="h-4 w-4" />
                      {locked ? "Unlock" : "Keep with current carer"}
                    </Button>
                  )}
                </li>
              );
            };
  return (
    <>
      <Card title={`Changes to make in CareLineLive (${result.changes.length})`}>
        {summary && (
          <p className="mb-2 rounded-md bg-canvas p-3 text-sm" data-testid="change-summary">
            <strong>{summary.total} change(s):</strong> {summary.forced_by_rules} required by the rules, {summary.fills_unallocated} fill an unallocated booking,{" "}
            {summary.for_travel_continuity_hours} for travel, continuity or hours. {summary.new_time_needed} need a new time.{" "}
            {summary.time_notes} tight gap(s) to check and {summary.time_within_tolerance} small shift(s) need no edit.
          </p>
        )}
        <p className="mb-3 text-sm text-muted">
          Change cost: £{((result.change_cost_pence ?? 0) / 100).toFixed(0)} per change. Each change is listed with why.
        </p>
        {result.changes.length === 0 ? (
          <Banner tone="info" title="No changes are worth making at this change cost." />
        ) : (
          <>
            {forced.length > 0 && (
              <div className="mb-4">
                <h3 className="mb-1 text-sm font-semibold">Required: the current carer is not allowed ({forced.length})</h3>
                <p className="mb-1 text-sm text-muted">These must change whatever the change cost.</p>
                <ul className="divide-y divide-line rounded-md border border-warn/40 px-3">
                  {forced.map(renderChange)}
                </ul>
              </div>
            )}
            {others.length > 0 && (
              <div>
                {forced.length > 0 && <h3 className="mb-1 text-sm font-semibold">Worth making ({others.length})</h3>}
                <ul className="divide-y divide-line">
                  {others.map(renderChange)}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>
      <details className="rounded-lg border border-line bg-surface p-5">
        <summary className="cursor-pointer text-base font-semibold">Tight gaps to check ({tight.length})</summary>
        <p className="mb-3 mt-2 text-sm text-muted">
          Same carer, and the start time shifts by more than the arrival tolerance to fit the travel estimate. These are not changes; check the gap is realistic.
        </p>
        <NoteList notes={tight} />
      </details>
      <details className="rounded-lg border border-line bg-surface p-5">
        <summary className="cursor-pointer text-base font-semibold">Small time shifts, no edit needed ({small.length})</summary>
        <p className="mb-3 mt-2 text-sm text-muted">
          Within {tol} min of the booked time, so nothing needs editing in CareLineLive (the arrival tolerance is a placeholder until confirmed).
        </p>
        <NoteList notes={small} />
      </details>
    </>
  );
}

export function ReviewStep() {
  const app = useApp();
  const result = app.result;
  if (!result) {
    return (
      <div className="max-w-3xl">
        <PageTitle title="Review" />
        <Banner tone="info" title="No result yet">Run the engine first.</Banner>
      </div>
    );
  }
  const lockCount = Object.keys(app.locks).length;
  return (
    <div className="max-w-7xl space-y-5">
      <PageTitle
        title="Review"
        intro={
          result.mode === "new"
            ? "New rota: the engine's full allocation, compared with your current rota."
            : "Improve my rota: a short list of changes to your current rota, each with a reason."
        }
      />
      {result.warnings.length > 0 && (
        <Banner tone="warn" title={`${result.warnings.length} warning(s): some rules were not checked or need attention`}>
          <ul className="list-disc pl-5">
            {result.warnings.map((w) => (
              <li key={w.code}>{w.message}</li>
            ))}
          </ul>
        </Banner>
      )}

      <Overview result={result} />

      <Card title="Roster">
        <Roster reports={result.teams} mode={result.mode} />
      </Card>

      <Unallocated result={result} />
      {result.mode === "improve" && <Changes result={result} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button onClick={() => app.setStep("run")}>
            Adjust and re-run{lockCount > 0 ? ` (${lockCount} locked)` : ""}
          </Button>
          {lockCount > 0 && <span className="text-sm text-muted">Locks are used the next time you run.</span>}
        </div>
        <Button variant="primary" onClick={() => app.setStep("export")}>
          Continue to Export
        </Button>
      </div>
    </div>
  );
}
