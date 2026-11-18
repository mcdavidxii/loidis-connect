"use client";

import { addDays, niceDate } from "@/lib/time";
import type { Change, DraftCheck, FillCheck, ReportMetrics, RunResult, TimeNote } from "@/lib/types";
import { plainNotice, plainReason, plainWarning } from "@/lib/warnings";
import { useApp } from "./AppProvider";
import {
  IconArrowDown,
  IconArrowRight,
  IconArrowUp,
  IconEqual,
  IconInfo,
  IconLock,
  IconStatBookings,
  IconStatContinuity,
  IconStatHours,
  IconStatMiles,
  IconStatMoved,
  IconStatSpread,
  IconStatTravel,
  IconStatUnallocated,
  IconUnallocated,
  IconWarning,
} from "./icons";
import { Roster } from "./Roster";
import { Badge, Button, Notice, PageHeader, ScrollBox, Section, StatPanel, tableCls, tdCls, thCls } from "./ui";

type Good = "down" | "up" | "none";

function Delta({ engine, current, good, unit = "", dp = 0 }: { engine: number; current: number; good: Good; unit?: string; dp?: number }) {
  const d = Math.round((engine - current) * 10 ** dp) / 10 ** dp;
  if (d === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted">
        <IconEqual aria-hidden className="h-3.5 w-3.5" /> No difference
      </span>
    );
  }
  const better = good === "none" ? null : good === "down" ? d < 0 : d > 0;
  const tone = better == null ? "text-muted" : better ? "text-ok" : "text-bad";
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${tone}`}>
      {d < 0 ? <IconArrowDown aria-hidden className="h-3.5 w-3.5" /> : <IconArrowUp aria-hidden className="h-3.5 w-3.5" />}
      {Math.abs(d).toFixed(dp)}
      {unit}
      {better != null && <span>{better ? "better" : "worse"}</span>}
    </span>
  );
}

const CAUSE_TEXT: Record<string, string> = {
  rules: "a carer rule (skills, gender, not allowed, leave)",
  hours: "no carer working then",
  weekly_max: "carers at their weekly maximum",
  travel_or_booked: "carers busy or too far away",
};

function FillCheckText({ fc }: { fc: FillCheck }) {
  const parts = (
    [
      ["rules", fc.because_rules],
      ["hours", fc.because_hours],
      ["weekly_max", fc.because_weekly_max],
      ["travel_or_booked", fc.because_travel_or_booked],
    ] as const
  ).filter(([, n]) => n > 0);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted">Why some bookings can&apos;t be filled</summary>
      <div className="mt-2 space-y-1 text-muted">
        <p>
          Your rota fills {fc.current_rota_fully_staffed} visits, but only {fc.current_rota_feasible} of them leave enough time to travel between visits and follow the carer rules.
        </p>
        <p>
          {fc.unfilled} booking{fc.unfilled === 1 ? "" : "s"} can&apos;t be filled
          {parts.length > 0 && ": "}
          {parts.map(([k, n], i) => (
            <span key={k}>
              {i > 0 && "; "}
              {n} {CAUSE_TEXT[k]}
            </span>
          ))}
          {fc.unfilled_but_filled_in_current_rota > 0 && `. ${fc.unfilled_but_filled_in_current_rota} of these are filled on your rota`}.
        </p>
      </div>
    </details>
  );
}

function Overview({ result }: { result: RunResult }) {
  const e = result.comparison.engine;
  const c = result.comparison.current;
  const pct = (m: ReportMetrics) => `${Math.round(m.continuity_rate * 100)}%`;
  const range = (m: ReportMetrics) => `${m.hours_min}-${m.hours_max} h`;
  const ic = "h-5 w-5";
  return (
    <section aria-label="Overview" className="mb-6">
      <h2 className="mb-3 text-base">{"Suggested rota compared with your rota"}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatPanel icon={<IconStatBookings aria-hidden className={ic} />} label="Bookings filled" value={`${e.filled} of ${e.visits}`} sub={`Your rota ${c.filled}`}>
          <Delta engine={e.filled} current={c.filled} good="up" />
        </StatPanel>
        <StatPanel icon={<IconStatUnallocated aria-hidden className={ic} />} label="Unallocated" value={e.unfilled} sub={`Your rota ${c.unfilled}`}>
          <Delta engine={e.unfilled} current={c.unfilled} good="down" />
        </StatPanel>
        <StatPanel icon={<IconStatTravel aria-hidden className={ic} />} label="Travel time" value={`${e.travel_hours} h`} sub={`Your rota ${c.travel_hours} h`}>
          <Delta engine={e.travel_hours} current={c.travel_hours} good="down" unit=" h" dp={1} />
        </StatPanel>
        <StatPanel icon={<IconStatMiles aria-hidden className={ic} />} label="Miles" value={e.miles} sub={`Your rota ${c.miles}`}>
          <Delta engine={e.miles} current={c.miles} good="down" dp={1} />
        </StatPanel>
        <StatPanel icon={<IconStatContinuity aria-hidden className={ic} />} label="Visits by a familiar carer" value={pct(e)} sub={`Your rota ${pct(c)}`}>
          <Delta engine={Math.round(e.continuity_rate * 100)} current={Math.round(c.continuity_rate * 100)} good="up" unit=" pts" />
        </StatPanel>
        <StatPanel icon={<IconStatHours aria-hidden className={ic} />} label="Hours per carer" value={range(e)} sub={`Your rota ${range(c)}, middle ${e.hours_median} h`} />
        <StatPanel icon={<IconStatSpread aria-hidden className={ic} />} label="Hours balance between carers" value={`${e.hours_stdev} h`} sub={`Your rota ${c.hours_stdev} h (lower is more even)`}>
          <Delta engine={e.hours_stdev} current={c.hours_stdev} good="down" unit=" h" dp={1} />
        </StatPanel>
        <StatPanel icon={<IconStatMoved aria-hidden className={ic} />} label="Visits changed" value={e.visits_moved} sub="Different carer or time" />
      </div>
      {result.fill_check && (
        <div className="panel mt-4 px-5 py-3">
          <FillCheckText fc={result.fill_check} />
        </div>
      )}
    </section>
  );
}

function nameMap(result: RunResult): Map<string, string> {
  const m = new Map<string, string>();
  Object.values(result.teams).forEach((r) => r.clients.forEach((c) => m.set(c.ref, c.display_name || c.ref)));
  return m;
}

function Unallocated({ result }: { result: RunResult }) {
  const rows = Object.values(result.teams).flatMap((rep) => {
    const refs = new Map(rep.clients.map((c) => [c.id, c.ref]));
    return rep.visits
      .filter((v) => v.assigned.length === 0)
      .map((v) => ({ v, ref: refs.get(v.client_id) ?? "", date: addDays(rep.week_start, v.day) }));
  });
  const nm = nameMap(result);
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return (
    <Section title={`Unallocated bookings (${rows.length})`}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Every booking has a carer.</p>
      ) : (
        <ScrollBox count={rows.length} label="Unallocated bookings"><table className={tableCls}>
          <caption className="sr-only">Unallocated bookings</caption>
          <thead>
            <tr>
              <th scope="col" className={thCls}>Booking</th>
              <th scope="col" className={thCls}>Client</th>
              <th scope="col" className={thCls}>When</th>
              <th scope="col" className={thCls}>Type</th>
              <th scope="col" className={thCls}>Cause</th>
              <th scope="col" className={thCls}>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, ref, date }) => (
              <tr key={v.id}>
                <td className={tdCls}>{v.booking_id ?? <span className="text-xs text-muted">not generated yet</span>}</td>
                <td className={tdCls}>{nm.get(ref) ?? ref}</td>
                <td className={`${tdCls} whitespace-nowrap`}>
                  {niceDate(date)} {hhmm(v.preferred_start)}
                </td>
                <td className={tdCls}>
                  {v.booking_type}
                  {v.carers_needed > 1 && <span className="text-muted"> (needs {v.carers_needed})</span>}
                </td>
                <td className={tdCls}>
                  {v.unfilled_cause ? (
                    <Badge tone="warn" icon={<IconUnallocated aria-hidden className="h-3 w-3" />}>
                      {CAUSE_TEXT[v.unfilled_cause] ?? v.unfilled_cause}
                    </Badge>
                  ) : (
                    "-"
                  )}
                </td>
                <td className={tdCls}>
                  {v.unfilled_reason}
                  {v.unfilled_detail.length > 0 && (
                    <ul className="mt-0.5 list-disc pl-4 text-xs text-muted">
                      {v.unfilled_detail.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></ScrollBox>
      )}
    </Section>
  );
}

function NoteTable({ notes, nm }: { notes: TimeNote[]; nm: Map<string, string> }) {
  if (notes.length === 0) return <p className="text-sm text-muted">None.</p>;
  return (
    <ScrollBox count={notes.length} label="Notes"><table className={tableCls}>
      <thead>
        <tr>
          <th scope="col" className={thCls}>Booking</th>
          <th scope="col" className={thCls}>Client</th>
          <th scope="col" className={thCls}>Date</th>
          <th scope="col" className={thCls}>Carer</th>
          <th scope="col" className={thCls}>Booked</th>
          <th scope="col" className={thCls}>Planned</th>
          <th scope="col" className={thCls}>Note</th>
        </tr>
      </thead>
      <tbody>
        {notes.map((n) => (
          <tr key={n.booking_id}>
            <td className={tdCls}>{n.booking_id}</td>
            <td className={tdCls}>{nm.get(n.client_ref) ?? n.client_ref}</td>
            <td className={tdCls}>{niceDate(n.date)}</td>
            <td className={tdCls}>{n.carer}</td>
            <td className={tdCls}>{n.booked_start}</td>
            <td className={tdCls}>{n.new_start}</td>
            <td className={`${tdCls} text-muted`}>{plainReason(n.reason)}</td>
          </tr>
        ))}
      </tbody>
    </table></ScrollBox>
  );
}

function ChangeTable({ rows, currentCarer, nm }: { rows: Change[]; currentCarer: (bookingId: string) => string | undefined; nm: Map<string, string> }) {
  const { locks, toggleLock } = useApp();
  return (
    <ScrollBox count={rows.length} label="Suggested changes"><table className={tableCls}>
      <caption className="sr-only">Changes</caption>
      <thead>
        <tr>
          <th scope="col" className={thCls}>Booking</th>
          <th scope="col" className={thCls}>Client</th>
          <th scope="col" className={thCls}>When</th>
          <th scope="col" className={thCls}>Carer change</th>
          <th scope="col" className={thCls}>Time</th>
          <th scope="col" className={thCls}>Why</th>
          <th scope="col" className={thCls}>
            <span className="sr-only">Action</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const cur = currentCarer(c.booking_id);
          const locked = Boolean(locks[c.booking_id]);
          const newTime = (c.new_time_needed ?? c.new_start != null) && c.new_start;
          return (
            <tr key={c.booking_id}>
              <td className={tdCls}>{c.booking_id}</td>
              <td className={tdCls}>{nm.get(c.client_ref) ?? c.client_ref}</td>
              <td className={`${tdCls} whitespace-nowrap`}>
                {niceDate(c.date)} {c.booked_start}
              </td>
              <td className={tdCls}>
                <span className="inline-flex flex-wrap items-center gap-1">
                  <span className="text-muted">{c.from_carers.join(" + ") || "Unallocated"}</span>
                  <IconArrowRight aria-hidden className="h-3.5 w-3.5 text-muted" />
                  <span className="font-semibold">{c.to_carers.join(" + ")}</span>
                </span>
              </td>
              <td className={`${tdCls} whitespace-nowrap`}>{newTime ? `Change to ${newTime}` : "Keep booked time"}</td>
              <td className={tdCls}>{plainReason(c.reason)}</td>
              <td className={`${tdCls} text-right`}>
                {cur && (
                  <Button variant="ghost" onClick={() => toggleLock(c.booking_id, cur)}>
                    <IconLock aria-hidden className="h-4 w-4 text-muted" />
                    {locked ? "Stop keeping" : "Keep as is"}
                  </Button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table></ScrollBox>
  );
}

function Changes({ result }: { result: RunResult }) {
  const { settings } = useApp();
  const nm = nameMap(result);
  const tol = settings.agency.arrival_tolerance_minutes;
  const forced = result.changes.filter((c) => c.forced_by_rules);
  const others = result.changes.filter((c) => !c.forced_by_rules);
  const s = result.change_summary;
  const small = result.time_notes.filter((n) => n.kind === "time_within_tolerance");
  const tight = result.time_notes.filter((n) => n.kind !== "time_within_tolerance");
  const currentCarer = (bookingId: string) => {
    for (const rep of Object.values(result.teams)) {
      const v = rep.visits.find((x) => x.booking_id === bookingId);
      if (v) return v.current_assigned[0];
    }
    return undefined;
  };
  return (
    <>
      <Section
        title={`Suggested changes to make in CareLineLive (${result.changes.length})`}
        info={`A change is only suggested if it saves enough to be worth making by hand (about £${((result.change_cost_pence ?? 0) / 100).toFixed(0)}, or roughly ${Math.round((result.change_cost_pence ?? 0) / 21)} minutes of paid time).`}
      >
        {s && (
          <p className="mb-3 text-sm text-muted">
            {s.forced_by_rules} needed because the current carer is not allowed, {s.fills_unallocated} fill an unallocated booking, {s.for_travel_continuity_hours} for less travel, a familiar carer or fairer hours.{" "}
            {s.new_time_needed} need a new time.
          </p>
        )}
        {result.changes.length === 0 && <p className="text-sm text-muted">No changes are worth making at this setting.</p>}
        {forced.length > 0 && (
          <div className="mb-5">
            <h3 className="mb-1 flex items-center gap-2 text-sm">
              Needed: the current carer is not allowed ({forced.length})
              <Badge tone="warn" icon={<IconWarning aria-hidden className="h-3 w-3" />}>
                Needed
              </Badge>
            </h3>
            <ChangeTable rows={forced} currentCarer={currentCarer} nm={nm} />
          </div>
        )}
        {others.length > 0 && (
          <div>
            {forced.length > 0 && <h3 className="mb-1 text-sm">Worth making ({others.length})</h3>}
            <ChangeTable rows={others} currentCarer={currentCarer} nm={nm} />
          </div>
        )}
      </Section>
      <details className="panel mb-4 p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Short gaps to check ({tight.length})</summary>
        <p className="my-2 text-xs text-muted">Same carer; the start moves a little to leave time to travel. Check the gap is realistic.</p>
        <NoteTable notes={tight} nm={nm} />
      </details>
      <details className="panel mb-6 p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Small time shifts, no edit needed ({small.length})</summary>
        <p className="my-2 text-xs text-muted">Within {tol} min of the booked time, so nothing needs editing (this limit is a placeholder until confirmed).</p>
        <NoteTable notes={small} nm={nm} />
      </details>
    </>
  );
}

function DraftCheckPanel({ check }: { check: DraftCheck }) {
  const tables: { key: "added" | "removed" | "retimed"; title: string; help: string; items: DraftCheck["added"] }[] = [
    { key: "added", title: "Added", help: "In the real bookings, not in the draft", items: check.added },
    { key: "removed", title: "Removed", help: "In the draft, not in the real bookings", items: check.removed },
    { key: "retimed", title: "New time", help: "In both, at a different time", items: check.retimed },
  ];
  return (
    <Section title="Changes since the draft">
      <p className="mb-4 text-sm text-muted">
        <span className="font-semibold text-ink">{check.matched}</span> visits are the same as in the draft.{" "}
        {check.added.length} added, {check.removed.length} removed, {check.retimed.length} with a new time (more than {check.tolerance_minutes} min different).
      </p>
      <div className="grid gap-4 xl:grid-cols-3">
        {tables.map((t) => (
          <div key={t.key} className="min-w-0">
            <h3 className="text-sm">
              {t.title} ({t.items.length})
            </h3>
            <p className="mb-1 text-xs text-muted">{t.help}</p>
            {t.items.length === 0 ? (
              <p className="text-sm text-muted">None.</p>
            ) : (
              <div className="max-h-[300px] overflow-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label={`${t.title}, scrollable`}>
                <table className={tableCls}>
                  <thead>
                    <tr className="sticky top-0 bg-surface">
                      <th scope="col" className={thCls}>Client</th>
                      <th scope="col" className={thCls}>When</th>
                      <th scope="col" className={thCls}>{t.key === "retimed" ? "Draft, now" : "Type"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.items.map((it, i) => {
                      return (
                        <tr key={i} title={it.summary}>
                          <td className={tdCls}>{it.client || it.client_ref}</td>
                          <td className={`${tdCls} whitespace-nowrap`}>
                            {niceDate(it.date)} {t.key === "retimed" ? "" : it.start}
                          </td>
                          <td className={tdCls}>{t.key === "retimed" ? `${it.draft_start ?? "?"} to ${it.start}` : it.booking_type}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

export function ReviewStep() {
  const app = useApp();
  const result = app.result;
  if (!result) {
    return (
      <div className="w-full">
        <PageHeader title="Suggestions" />
        <Notice title="No result yet">Make suggestions first.</Notice>
      </div>
    );
  }
  const lockCount = Object.keys(app.locks).length;
  return (
    <div className="w-full">
      <PageHeader
        title={result.draft ? <span className="flex items-center gap-2">Suggestions <Badge tone="info">Draft</Badge></span> : "Suggestions"}
        subtitle={result.mode === "new" ? "The whole week planned from scratch, compared with your rota." : "Suggested changes to your rota."}
        actions={
          <>
            <Button onClick={() => app.setStep("run")}>Adjust and plan again{lockCount > 0 ? ` (${lockCount} locked)` : ""}</Button>
            <Button variant="primary" onClick={() => app.setStep("export")}>
              Continue to export
            </Button>
          </>
        }
      />
      {result.draft && (
        <div className="mb-6">
          <Notice tone="info" title="This is a draft">
            It is planned from client schedules, not real bookings, so there are no booking IDs yet. When CareLineLive generates the week, upload its bookings with this draft on the Upload screen to see what changed.
          </Notice>
        </div>
      )}
      {result.draft_check && <DraftCheckPanel check={result.draft_check} />}
      {(result.notices ?? []).length > 0 && (
        <ul className="mb-6 space-y-1 text-sm text-muted">
          {(result.notices ?? []).map((x) => (
            <li key={x.code} className="flex items-start gap-1.5">
              <IconInfo aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              {plainNotice(x)}
            </li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <details className="mb-6 rounded-xl bg-warn-soft px-4 py-3 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold">
            <IconWarning aria-hidden className="h-4 w-4 text-warn" />
            {result.warnings.length} warning{result.warnings.length > 1 ? "s" : ""}
            <span className="font-normal text-muted">Some checks could not be made, or need a look</span>
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            {result.warnings.map((w) => (
              <li key={w.code}>
                {plainWarning(w)}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Overview result={result} />

      <Section title="Roster">
        <Roster reports={result.teams} changes={result.changes} />
      </Section>

      <Unallocated result={result} />
      {result.mode === "improve" && <Changes result={result} />}
    </div>
  );
}
