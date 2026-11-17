"use client";

import { useMemo, useState } from "react";
import { plainReason } from "@/lib/warnings";
import { hhmm, niceDate } from "@/lib/time";
import { buildWorksheet, type AllocRow, type ChangeRow, type NoteRow, type UnallocatedRow } from "@/lib/worksheet";
import { DAYS, DAY_LABELS, type RunResult } from "@/lib/types";
import { IconCopy, IconUnallocated } from "./icons";
import { Badge, tdCls, thCls } from "./ui";

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <code className="font-mono text-xs">{id}</code>
      <button
        type="button"
        aria-label={`Copy booking ID ${id}`}
        title={copied ? "Copied" : "Copy booking ID"}
        className="rounded-md p-1 text-muted hover:bg-hover print:hidden"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(id);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard not available; the ID is still selectable */
          }
        }}
      >
        <IconCopy aria-hidden className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function Tick({ id, done, onToggle, label }: { id: string; done: boolean; onToggle: (id: string) => void; label: string }) {
  return (
    <>
      <input
        type="checkbox"
        aria-label={`Done: ${label}`}
        className="h-4 w-4 accent-[#0f7b6c] print:hidden"
        checked={done}
        onChange={() => onToggle(id)}
      />
      <span aria-hidden className="hidden h-3.5 w-3.5 border border-black print:inline-block" />
    </>
  );
}

function groupBy<T>(rows: T[], key: (r: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  rows.forEach((r) => m.set(key(r), [...(m.get(key(r)) ?? []), r]));
  return [...m.entries()];
}

export function Worksheet({ result }: { result: RunResult }) {
  const w = useMemo(() => buildWorksheet(result), [result]);
  const improve = result.mode === "improve";
  const [dayIdx, setDayIdx] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set()); // browser only, this session
  const [onlyChanged, setOnlyChanged] = useState(false);
  const toggle = (k: string) =>
    setDone((d) => {
      const n = new Set(d);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const rowsOf = (d: number): { key: string }[] => (improve ? w.changes.filter((r) => r.dayIdx === d) : w.allocation.filter((r) => r.dayIdx === d && !r.unallocated));
  const dayTotal = (d: number) => rowsOf(d).length;
  const dayDone = (d: number) => rowsOf(d).filter((r) => done.has(r.key)).length;
  const total = DAYS.reduce((a, _, d) => a + dayTotal(d), 0);
  const totalDone = DAYS.reduce((a, _, d) => a + dayDone(d), 0);
  const dayDate = (d: number) => {
    const x = new Date(w.weekStart + "T00:00:00Z");
    x.setUTCDate(x.getUTCDate() + d);
    return x.toISOString().slice(0, 10);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div role="tablist" aria-label="Day" className="flex gap-1">
          {DAYS.map((d, i) => (
            <button
              key={d}
              role="tab"
              type="button"
              aria-selected={dayIdx === i}
              onClick={() => setDayIdx(i)}
              className={`h-9 rounded-lg border px-3 text-sm ${dayIdx === i ? "border-brand bg-brand-soft font-semibold" : "border-line bg-surface hover:bg-hover"}`}
            >
              {d[0].toUpperCase() + d.slice(1)} {niceDate(dayDate(i)).split(" ")[0]}
              <span className="ml-1 text-xs text-muted">{dayTotal(i)}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 text-sm">
          {!improve && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-[#0f7b6c]" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
              Show only changed
            </label>
          )}
          <span className="text-muted" aria-live="polite">
            Overall: {totalDone} of {total} done
          </span>
        </div>
      </div>

      {DAYS.map((_, d) => {
        const active = d === dayIdx;
        const date = dayDate(d);
        const unalloc = w.unallocated.filter((u) => u.dayIdx === d);
        const notes = w.notes.filter((n) => n.dayIdx === d);
        return (
          <section
            key={d}
            aria-label={`${DAY_LABELS[DAYS[d]]} ${date}`}
            className={`${active ? "" : "hidden"} print:block print:break-after-page`}
          >
            <header className="mb-3 flex items-baseline justify-between border-b border-line pb-1">
              <h3 className="text-base">
                {DAY_LABELS[DAYS[d]]} {niceDate(date)}
              </h3>
              <span className="text-xs text-muted" aria-live="polite">
                {dayDone(d)} of {dayTotal(d)} done
              </span>
            </header>

            {unalloc.length > 0 && <UnallocatedBlock rows={unalloc} done={done} onToggle={toggle} />}

            {improve ? (
              <ChangeSections rows={w.changes.filter((r) => r.dayIdx === d)} done={done} onToggle={toggle} />
            ) : (
              <AllocSections rows={w.allocation.filter((r) => r.dayIdx === d && !r.unallocated && (!onlyChanged || r.changed))} done={done} onToggle={toggle} />
            )}

            {improve && notes.length > 0 && <NotesBlock rows={notes} />}
          </section>
        );
      })}
    </div>
  );
}

function UnallocatedBlock({ rows, done, onToggle }: { rows: UnallocatedRow[]; done: Set<string>; onToggle: (k: string) => void }) {
  return (
    <div className="mb-5 break-inside-avoid rounded-md border border-warn/40 bg-warn-soft px-3 py-2">
      <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-warn">
        <IconUnallocated aria-hidden className="h-4 w-4" />
        Still unallocated ({rows.length})
      </h4>
      <table className="w-full text-left text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="w-8 py-1">
                <Tick id={r.key} done={done.has(r.key)} onToggle={onToggle} label={`${r.client} ${r.time}`} />
              </td>
              <td className="w-16 py-1">{r.time}</td>
              <td className="py-1">{r.client}</td>
              <td className="py-1">{r.bookingType}</td>
              <td className="py-1">
                <CopyId id={r.bookingId} />
              </td>
              <td className="py-1 text-xs text-muted">{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChangeSections({ rows, done, onToggle }: { rows: ChangeRow[]; done: Set<string>; onToggle: (k: string) => void }) {
  if (rows.length === 0) return <p className="mb-4 text-sm text-muted">No changes this day.</p>;
  return (
    <>
      {groupBy(rows, (r) => r.giveTo).map(([carer, list]) => (
        <section key={carer} aria-label={`Give to ${carer}`} className="mb-5 break-inside-avoid">
          <h4 className="mb-1 text-sm">
            Give to <span className="font-semibold">{carer}</span> <span className="text-xs text-muted">({list.filter((r) => done.has(r.key)).length} of {list.length} done)</span>
          </h4>
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className={`${thCls} w-8`}><span className="sr-only">Done</span></th>
                <th scope="col" className={thCls}>Booked</th>
                <th scope="col" className={thCls}>New start</th>
                <th scope="col" className={thCls}>Client</th>
                <th scope="col" className={thCls}>Booking type</th>
                <th scope="col" className={thCls}>Booking ID</th>
                <th scope="col" className={thCls}>Action</th>
                <th scope="col" className={thCls}>Currently with</th>
                <th scope="col" className={thCls}>Why</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.key} className={done.has(r.key) ? "text-muted" : ""}>
                  <td className={tdCls}>
                    <Tick id={r.key} done={done.has(r.key)} onToggle={onToggle} label={`${r.client} ${r.bookedTime}`} />
                  </td>
                  <td className={`${tdCls} whitespace-nowrap`}>{r.bookedTime}</td>
                  <td className={`${tdCls} whitespace-nowrap`}>
                    {r.newStart ? <span className="rounded-md bg-warn-soft px-1.5 py-0.5 font-semibold text-ink">{r.newStart}</span> : "-"}
                  </td>
                  <td className={tdCls}>{r.client}</td>
                  <td className={tdCls}>{r.bookingType}</td>
                  <td className={tdCls}>
                    <CopyId id={r.bookingId} />
                  </td>
                  <td className={`${tdCls} whitespace-nowrap font-semibold`}>{r.action}</td>
                  <td className={tdCls}>{r.currentlyWith}</td>
                  <td className={tdCls}>
                    {r.required && (
                      <span className="mr-1">
                        <Badge tone="warn">Required</Badge>
                      </span>
                    )}
                    <span className="text-xs text-muted">{plainReason(r.why)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

function AllocSections({ rows, done, onToggle }: { rows: AllocRow[]; done: Set<string>; onToggle: (k: string) => void }) {
  if (rows.length === 0) return <p className="mb-4 text-sm text-muted">Nothing to show.</p>;
  return (
    <>
      {groupBy(rows, (r) => r.carer).map(([carer, list]) => (
        <section key={carer} aria-label={`Carer ${carer}`} className="mb-5 break-inside-avoid">
          <h4 className="mb-1 text-sm">
            <span className="font-semibold">{carer}</span> <span className="text-xs text-muted">({list.filter((r) => done.has(r.key)).length} of {list.length} done)</span>
          </h4>
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className={`${thCls} w-8`}><span className="sr-only">Done</span></th>
                <th scope="col" className={thCls}>Start</th>
                <th scope="col" className={thCls}>End</th>
                <th scope="col" className={thCls}>New start</th>
                <th scope="col" className={thCls}>Client</th>
                <th scope="col" className={thCls}>Booking type</th>
                <th scope="col" className={thCls}>Booking ID</th>
                <th scope="col" className={thCls}>Double-up with</th>
                <th scope="col" className={thCls}>Compared with current</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.key} className={done.has(r.key) ? "text-muted" : ""}>
                  <td className={tdCls}>
                    <Tick id={r.key} done={done.has(r.key)} onToggle={onToggle} label={`${r.client} ${hhmm(r.start)}`} />
                  </td>
                  <td className={`${tdCls} whitespace-nowrap`}>{hhmm(r.start)}</td>
                  <td className={`${tdCls} whitespace-nowrap`}>{hhmm(r.end)}</td>
                  <td className={`${tdCls} whitespace-nowrap`}>
                    {r.newStart ? <span className="rounded-md bg-warn-soft px-1.5 py-0.5 font-semibold text-ink">{r.newStart}</span> : "-"}
                  </td>
                  <td className={tdCls}>{r.client}</td>
                  <td className={tdCls}>{r.bookingType}</td>
                  <td className={tdCls}>
                    <CopyId id={r.bookingId} />
                  </td>
                  <td className={tdCls}>{r.doubleUpWith || "-"}</td>
                  <td className={tdCls}>
                    {r.changed ? <span className="font-semibold">{r.compared}</span> : <span className="text-muted">{r.compared}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

function NotesBlock({ rows }: { rows: NoteRow[] }) {
  return (
    <details className="mb-5 text-sm">
      <summary className="cursor-pointer font-semibold">No edit needed ({rows.length})</summary>
      <table className="mt-2 w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            <th scope="col" className={thCls}>Carer</th>
            <th scope="col" className={thCls}>Booked</th>
            <th scope="col" className={thCls}>Planned</th>
            <th scope="col" className={thCls}>Client</th>
            <th scope="col" className={thCls}>Booking ID</th>
            <th scope="col" className={thCls}>Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className={tdCls}>{r.carer}</td>
              <td className={tdCls}>{r.bookedTime}</td>
              <td className={tdCls}>{r.plannedStart}</td>
              <td className={tdCls}>{r.client}</td>
              <td className={tdCls}>
                <CopyId id={r.bookingId} />
              </td>
              <td className={tdCls}>
                <Badge tone={r.kind === "time_note" ? "warn" : "neutral"}>{r.kind === "time_note" ? "Short gap, check travel" : "Small time change"}</Badge>{" "}
                <span className="text-xs text-muted">{plainReason(r.note)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
