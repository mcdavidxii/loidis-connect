"use client";

import { useMemo, useRef, useState } from "react";
import { fetchSample, learnSchedules } from "@/lib/api";
import { areaLabel, areaOf } from "@/lib/areas";
import { summariseBookings, type BookingsInfo } from "@/lib/csv";
import { DAY_SHORT, blankVisit, emptySchedule, endTime, lengthText, mondayOf, totalVisitsPerWeek, visitsOnDay } from "@/lib/schedules";
import { niceDate } from "@/lib/time";
import { DAYS, DAY_LABELS, type ClientSchedule, type DayKey, type ScheduleFlag, type ScheduleVisit } from "@/lib/types";
import { useApp } from "./AppProvider";
import { IconAdd, IconClose, IconCheck, IconDelete, IconDemo, IconDoubleUp, IconChanged, IconRefresh, IconUpload, IconWarning } from "./icons";
import { TYPES, typeKey, typeStyle } from "./rosterShared";
import { Avatar, Badge, Button, Notice, PageHeader, Section, Segmented, inputCls } from "./ui";

const BOOKING_TYPES = ["Morning Visit", "Medication Call", "Lunch Visit", "Tea Visit", "Bed Visit", "Night Check"];
const COLS = "180px repeat(7, minmax(104px, 1fr)) 150px";

// The service sends a ready-made sentence (dates already dd/mm/yyyy); show it as it is.
function flagText(f: ScheduleFlag): string {
  if (f.detail) return f.detail;
  if (f.kind === "changed") return "Schedule changed in CareLineLive – check their visits";
  if (f.kind === "suspended") return "Suspended – left out";
  return "No bookings in the weeks uploaded";
}

interface Picked {
  file: File;
  info: BookingsInfo;
}

function FilePicker({
  id,
  title,
  hint,
  multiple,
  onFiles,
}: {
  id: string;
  title: string;
  hint: string;
  multiple?: boolean;
  onFiles: (f: File[]) => void;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const fs = [...e.dataTransfer.files];
        if (fs.length) onFiles(multiple ? fs : fs.slice(0, 1));
      }}
      className={`rounded-xl border border-dashed px-4 py-3.5 ${over ? "border-brand bg-brand-soft" : "border-[#cbd5e1] bg-surface"}`}
    >
      <label htmlFor={id} className="block text-sm font-semibold">
        {title}
      </label>
      <p className="mb-2 text-xs text-muted">{hint}</p>
      <input
        ref={input}
        id={id}
        type="file"
        accept=".csv,text/csv"
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          const fs = [...(e.target.files ?? [])];
          if (fs.length) onFiles(fs);
          e.target.value = "";
        }}
      />
      <div className="flex items-center gap-2">
        <Button onClick={() => input.current?.click()}>
          <IconUpload aria-hidden className="h-4 w-4 text-muted" />
          {multiple ? "Add files" : "Choose file"}
        </Button>
        <span className="text-xs text-muted">or drop {multiple ? "them" : "it"} here</span>
      </div>
    </div>
  );
}

function VisitCard({ v, weekStart }: { v: ScheduleVisit; weekStart?: string }) {
  void weekStart;
  const k = typeKey(v.booking_type);
  const label = TYPES.find((t) => t.key === k)?.label ?? v.booking_type;
  return (
    <div className="rounded-lg border px-2 py-1.5 text-xs leading-[15px]" style={typeStyle(k)} title={`${v.booking_type}, ${v.start} for ${lengthText(v.duration_min)}`}>
      <span className="flex items-center justify-between gap-1">
        <span className="font-semibold">
          {v.start}–{endTime(v.start, v.duration_min)}
        </span>
        {v.carers_needed > 1 && (
          <span className="flex items-center">
            <IconDoubleUp aria-hidden className="h-3 w-3" />
            <span className="font-semibold">{v.carers_needed}</span>
            <span className="sr-only"> carers needed</span>
          </span>
        )}
      </span>
      <span className="block truncate">
        {label} · {lengthText(v.duration_min)}
      </span>
      <span className="mt-0.5 inline-block rounded-full bg-white/70 px-1.5">{v.repeat === "weekly" ? "every week" : "every other week"}</span>
    </div>
  );
}

function DayChips({ value, onChange }: { value: DayKey[]; onChange: (d: DayKey[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold">Days</legend>
      <div className="flex flex-wrap gap-1.5">
        {DAYS.map((d) => {
          const on = value.includes(d);
          return (
            <label
              key={d}
              className={`inline-flex h-8 cursor-pointer items-center rounded-md border px-2.5 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand ${
                on ? "border-brand bg-brand-soft font-semibold text-brand-strong" : "border-line bg-surface hover:bg-hover"
              }`}
            >
              <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== d) : DAYS.filter((x) => x === d || value.includes(x)))} />
              <span aria-hidden>{on ? "✓ " : ""}</span>
              {DAY_SHORT[d]}
              <span className="sr-only"> ({DAY_LABELS[d]})</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function EditDrawer({
  clientId,
  clientRef,
  initial,
  learnedWeeks,
  onSave,
  onClose,
}: {
  clientId: string;
  clientRef: string;
  initial: ClientSchedule | undefined;
  learnedWeeks: string[];
  onSave: (s: ClientSchedule) => void;
  onClose: () => void;
}) {
  const [visits, setVisits] = useState<ScheduleVisit[]>(() => (initial?.visits.length ? initial.visits.map((v) => ({ ...v })) : [blankVisit()]));
  const patch = (id: string, p: Partial<ScheduleVisit>) => setVisits((vs) => vs.map((v) => (v.id === id ? { ...v, ...p } : v)));
  // The two weeks of an "every other week" visit, to choose which one it falls in.
  const thisMonday = mondayOf(new Date().toISOString().slice(0, 10));
  const anchors = learnedWeeks.length ? [learnedWeeks[learnedWeeks.length - 1], learnedWeeks[learnedWeeks.length - 2] ?? mondayOf(thisMonday)] : [thisMonday, mondayOf(thisMonday)];
  const weekOptions = [anchors[0], anchors[1] === anchors[0] ? thisMonday : anchors[1]];
  const invalid = visits.some((v) => v.days.length === 0 || !v.start || v.duration_min < 5);

  return (
    <aside role="dialog" aria-modal="false" aria-label={`Edit schedule for ${clientRef}`} className="fixed bottom-4 right-4 top-4 z-40 w-[28rem] overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-2xl">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base">{initial ? "Edit schedule" : "Add schedule"}</h3>
          <p className="text-xs text-muted">{clientRef}</p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-hover">
          <IconClose aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-4">
        {visits.map((v, i) => (
          <div key={v.id} className="space-y-3 rounded-xl border border-line p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Visit {i + 1}</p>
              <button type="button" aria-label={`Remove visit ${i + 1}`} onClick={() => setVisits((vs) => vs.filter((x) => x.id !== v.id))} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-hover">
                <IconDelete aria-hidden className="h-4 w-4" />
              </button>
            </div>
            <DayChips value={v.days} onChange={(days) => patch(v.id, { days })} />
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted">Start</span>
                <input type="time" className={`${inputCls} w-full`} value={v.start} onChange={(e) => patch(v.id, { start: e.target.value })} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted">Length (minutes)</span>
                <input type="number" min={5} step={5} className={`${inputCls} w-full`} value={v.duration_min} onChange={(e) => patch(v.id, { duration_min: Number(e.target.value) })} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted">Booking type</span>
                <input list="schedule-booking-types" className={`${inputCls} w-full`} value={v.booking_type} onChange={(e) => patch(v.id, { booking_type: e.target.value })} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted">Carers needed</span>
                <select className={`${inputCls} w-full`} value={v.carers_needed} onChange={(e) => patch(v.id, { carers_needed: Number(e.target.value) })}>
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <Segmented<"weekly" | "fortnightly">
                label="How often"
                value={v.repeat}
                onChange={(repeat) => patch(v.id, { repeat, fortnight_anchor: repeat === "fortnightly" ? (v.fortnight_anchor ?? weekOptions[0]) : null })}
                options={[
                  { id: "weekly", label: "Every week" },
                  { id: "fortnightly", label: "Every other week" },
                ]}
              />
              {v.repeat === "fortnightly" && (
                <label className="mt-2 block text-sm">
                  <span className="mb-1 block text-xs text-muted">Which week</span>
                  <select className={`${inputCls} w-full`} value={v.fortnight_anchor ?? ""} onChange={(e) => patch(v.id, { fortnight_anchor: e.target.value })}>
                    {[...new Set([...weekOptions, ...(v.fortnight_anchor ? [v.fortnight_anchor] : [])])].map((w) => (
                      <option key={w} value={w}>
                        Week starting {niceDate(w)} (and every other week after)
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        ))}
        <datalist id="schedule-booking-types">
          {BOOKING_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <Button onClick={() => setVisits((vs) => [...vs, blankVisit()])}>
          <IconAdd aria-hidden className="h-4 w-4 text-muted" />
          Add a visit
        </Button>
      </div>
      {invalid && <p className="mt-3 text-xs text-warn">Every visit needs at least one day, a start time and a length.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={invalid}
          onClick={() =>
            onSave({
              ...(initial ?? emptySchedule(clientRef)),
              client_ref: clientRef,
              // Editing a schedule by hand counts as checking it.
              confirmed: true,
              updated_at: new Date().toISOString(),
              visits: visits.map((v) => ({ ...v, days: DAYS.filter((d) => v.days.includes(d)) })),
            })
          }
        >
          Save and confirm
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
      <p className="sr-only">{clientId}</p>
    </aside>
  );
}

export function SchedulesStep() {
  const app = useApp();
  const { settings, setSettings, learned, setLearned } = app;
  const [picked, setPicked] = useState<Picked[]>([]);
  const { clientList, setClientList } = app;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [oneOffsOpen, setOneOffsOpen] = useState(false);
  const [area, setArea] = useState<string>("all");

  const flagsBy = useMemo(() => {
    const m = new Map<string, ScheduleFlag[]>();
    (learned?.flags ?? []).forEach((f) => m.set(f.client_id, [...(m.get(f.client_id) ?? []), f]));
    return m;
  }, [learned]);

  const schedules = settings.client_schedules;
  // Display names come with the learn result and are for the screen only.
  const names = useMemo(() => {
    const m = new Map<string, string>();
    Object.entries(learned?.schedules ?? {}).forEach(([id, s]) => s.display_name && m.set(id, s.display_name));
    (learned?.flags ?? []).forEach((f) => f.display_name && m.set(f.client_id, f.display_name));
    (learned?.one_offs ?? []).forEach((o) => o.display_name && m.set(o.client_id, o.display_name));
    return m;
  }, [learned]);
  const clients = settings.clients;
  const areas = useMemo(() => [...new Set(clients.map((c) => areaOf(c.team, settings.agency.team_regions)))].sort(), [clients, settings.agency.team_regions]);
  const suspended = (id: string) => (flagsBy.get(id) ?? []).some((f) => f.kind === "suspended");
  const hasFlags = (id: string) => (flagsBy.get(id) ?? []).length > 0 || !schedules[id];
  const unconfirmedClean = clients.filter((c) => schedules[c.id] && !schedules[c.id].confirmed && !hasFlags(c.id));
  const counts = {
    confirmed: clients.filter((c) => schedules[c.id]?.confirmed).length,
    toCheck: clients.filter((c) => schedules[c.id] && !schedules[c.id].confirmed).length,
    none: clients.filter((c) => !schedules[c.id]).length,
  };

  const setSchedule = (id: string, s: ClientSchedule) => setSettings((st) => ({ ...st, client_schedules: { ...st.client_schedules, [id]: s } }));
  const confirm = (ids: string[]) =>
    setSettings((st) => {
      const next = { ...st.client_schedules };
      ids.forEach((id) => next[id] && (next[id] = { ...next[id], confirmed: true }));
      return { ...st, client_schedules: next };
    });

  async function addFiles(files: File[]) {
    const out: Picked[] = [];
    for (const file of files) out.push({ file, info: summariseBookings(await file.text()) });
    setPicked((p) => [...p, ...out]);
  }

  async function learn() {
    setBusy(true);
    setError(null);
    try {
      const res = await learnSchedules({ bookings: picked.map((p) => p.file), clientList: clientList ?? undefined, settings });
      setLearned(res);
      setSettings((st) => {
        const next = { ...st.client_schedules };
        for (const [id, s] of Object.entries(res.schedules)) {
          if (next[id]?.confirmed) continue; // a schedule you confirmed is never overwritten
          // display_name is for the screen only; it is not saved in the settings file.
          const { display_name: _name, ...stored } = s;
          void _name;
          next[id] = { ...stored, confirmed: false };
        }
        // Clients the files mention that the settings do not know yet.
        const known = new Set(st.clients.map((c) => c.id));
        const added = Object.entries(res.schedules)
          .filter(([id]) => !known.has(id))
          .map(([id, s]) => ({ id, ref: s.client_ref || id, team: "Leeds", gender_preference: null, do_not_send: [], safeguarding_bar: [], required_skills: [], time_critical_booking_types: [] }));
        return { ...st, client_schedules: next, clients: [...st.clients, ...added] };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not learn the schedules.");
    } finally {
      setBusy(false);
    }
  }

  async function loadSamples() {
    setError(null);
    try {
      const files: File[] = [];
      for (let i = 1; i <= 4; i++) files.push(await fetchSample(`learn-bookings-${i}.csv`));
      setPicked([]);
      await addFiles(files);
      setClientList(await fetchSample("client-list.csv"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the sample files.");
    }
  }

  const editClient = clients.find((c) => c.id === edit);
  // A file may hold one week or several (e.g. one export for 26 Oct - 15 Nov); count every week.
  const weeksCovered = { size: picked.reduce((n, p) => n + (p.info.weeks || 0), 0) };
  const problems = picked.filter((p) => p.info.problems.some((x) => !x.includes("different weeks")));
  const topFlags = clients.flatMap((c) => {
    const out: { id: string; ref: string; text: string }[] = [];
    if (!schedules[c.id] && !suspended(c.id)) out.push({ id: c.id, ref: c.ref, text: "New client – no schedule yet" });
    (flagsBy.get(c.id) ?? []).forEach((f) => out.push({ id: c.id, ref: c.ref, text: flagText(f) }));
    return out;
  });

  return (
    <div className="w-full">
      <PageHeader
        title="Client schedules"
        subtitle="Each client's usual visits in a week. Used to draft a future week before CareLineLive generates it."
        actions={
          <>
            {app.mock && (
              <Button onClick={loadSamples}>
                <IconDemo aria-hidden className="h-4 w-4 text-muted" />
                Use sample files
              </Button>
            )}
            <Button variant="primary" onClick={() => app.setStep("run")}>
              Continue to Plan
            </Button>
          </>
        }
      />

      <Section title="Learn from past bookings">
        <div className="grid gap-3 md:grid-cols-2">
          <FilePicker id="learn-bookings" title="Bookings CSVs" hint="Several past weeks, from Reports > Bookings (one file per week)." multiple onFiles={(f) => void addFiles(f)} />
          <FilePicker id="learn-clients" title="Client list CSV (optional)" hint="From CareLineLive. Lets us spot schedules that changed and suspended clients." onFiles={(f) => setClientList(f[0])} />
        </div>
        {(picked.length > 0 || clientList) && (
          <div className="mt-4">
            {picked.length > 0 && (
              <ul className="space-y-1.5">
                {picked.map((p, i) => (
                  <li key={`${p.file.name}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-hover px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-semibold">{p.file.name}</span>
                    <span className="text-muted">
                      {!p.info.firstDate
                        ? "No week found"
                        : p.info.weeks > 1
                          ? `${p.info.weeks} weeks from ${niceDate(p.info.firstDate)}`
                          : `Week of ${niceDate(p.info.firstDate)}`}
                    </span>
                    <span className="text-muted">{p.info.visits} visits</span>
                    <span className="text-muted">{p.info.clients} clients</span>
                    {p.info.cancelled > 0 && <span className="text-muted">{p.info.cancelled} cancelled (ignored)</span>}
                    {p.info.problems.filter((x) => !x.includes("different weeks")).map((x) => (
                      <Badge key={x} tone="bad">
                        {x}
                      </Badge>
                    ))}
                    <button type="button" aria-label={`Remove ${p.file.name}`} onClick={() => setPicked((l) => l.filter((_, j) => j !== i))} className="rounded-md p-1 text-muted hover:bg-surface">
                      <IconClose aria-hidden className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {clientList && (
              <p className="mt-2 flex items-center gap-1 text-sm">
                Client list: <span className="font-semibold">{clientList.name}</span>
                <button type="button" aria-label="Remove the client list" onClick={() => setClientList(null)} className="rounded-md p-1 text-muted hover:bg-hover">
                  <IconClose aria-hidden className="h-4 w-4" />
                </button>
              </p>
            )}
            <p className="mt-2 text-xs text-muted">
              {picked.length} file{picked.length === 1 ? "" : "s"} covering {weeksCovered.size} week{weeksCovered.size === 1 ? "" : "s"}.
              {weeksCovered.size < 3 && picked.length > 0 && " Three or four weeks work best for spotting visits that happen every other week."}
            </p>
          </div>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" onClick={() => void learn()} disabled={busy || picked.length === 0 || problems.length > 0}>
            {busy && <IconRefresh aria-hidden className="h-4 w-4 animate-spin" />}
            {busy ? "Learning" : "Learn schedules"}
          </Button>
          {problems.length > 0 && <span className="text-xs text-bad">Fix or remove the files with problems first.</span>}
        </div>
        {error && (
          <div className="mt-3">
            <Notice tone="bad" title="Could not learn the schedules">
              {error}
            </Notice>
          </div>
        )}
      </Section>

      {topFlags.length > 0 && (
        <div className="mb-6 rounded-xl bg-warn-soft px-4 py-3 text-sm">
          <p className="mb-1 flex items-center gap-2 font-semibold">
            <IconWarning aria-hidden className="h-4 w-4 text-warn" />
            {topFlags.length} thing{topFlags.length === 1 ? "" : "s"} to look at
          </p>
          <ul className="max-h-40 list-disc space-y-0.5 overflow-auto pl-6">
            {topFlags.map((f, i) => (
              <li key={`${f.id}-${i}`}>
                <span className="font-semibold">{f.ref}</span>: {f.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section
        title="Weekly pattern"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted">
              {counts.confirmed} confirmed · {counts.toCheck} to check · {counts.none} without a schedule
            </span>
            <Button onClick={() => confirm(unconfirmedClean.map((c) => c.id))} disabled={unconfirmedClean.length === 0}>
              <IconCheck aria-hidden className="h-4 w-4 text-muted" />
              Confirm all without flags ({unconfirmedClean.length})
            </Button>
          </div>
        }
      >
        {clients.length === 0 ? (
          <Notice title="No clients yet">Upload a settings file or sync from CareLineLive on the Upload screen, or learn schedules from bookings above.</Notice>
        ) : (
          <>
            {areas.length > 1 && (
              <div className="mb-3">
                <Segmented<string> label="Area" value={area} onChange={setArea} options={[{ id: "all", label: "All areas" }, ...areas.map((a) => ({ id: a, label: a }))]} />
              </div>
            )}
            <div tabIndex={0} role="region" aria-label="Weekly pattern, scrollable" className="h-[calc(100vh-300px)] min-h-[360px] overflow-auto rounded-xl border border-line bg-surface">
              <div style={{ minWidth: 180 + 7 * 104 + 150 }} role="table" aria-label="Client schedules by weekday">
                <div className="sticky top-0 z-20 grid border-b border-line bg-surface" style={{ gridTemplateColumns: COLS }} role="row">
                  <div className="sticky left-0 z-30 bg-surface px-3 py-2 text-xs font-semibold text-muted" role="columnheader">
                    Client
                  </div>
                  {DAYS.map((d) => (
                    <div key={d} role="columnheader" className="px-1 py-2 text-center text-xs font-semibold uppercase text-muted">
                      {DAY_SHORT[d]}
                    </div>
                  ))}
                  <div className="px-3 py-2 text-xs font-semibold text-muted" role="columnheader">
                    Status
                  </div>
                </div>
                {areas
                  .filter((a) => area === "all" || a === area)
                  .map((a) => {
                    const rows = clients.filter((c) => areaOf(c.team, settings.agency.team_regions) === a).sort((x, y) => x.ref.localeCompare(y.ref));
                    const q = app.query.trim().toLowerCase();
                    const shown = rows.filter((c) => !q || c.ref.toLowerCase().includes(q));
                    return (
                      <div key={a}>
                        <div className="sticky top-[34px] z-10 bg-canvas px-3 py-1.5 text-xs font-semibold text-muted" role="row">
                          <span role="rowheader">
                            {areaLabel(a)} <span className="font-normal">({shown.length})</span>
                          </span>
                        </div>
                        {shown.map((c) => {
                          const s = schedules[c.id];
                          const fl = flagsBy.get(c.id) ?? [];
                          const sus = suspended(c.id);
                          return (
                            <div key={c.id} className="grid border-b border-line" style={{ gridTemplateColumns: COLS }} role="row">
                              <div className="sticky left-0 z-10 bg-surface px-3 py-2" role="rowheader">
                                <div className="flex items-start gap-2">
                                  <Avatar name={names.get(c.id) ?? c.ref} size={28} />
                                  <span className="min-w-0 leading-tight">
                                    <span className="block truncate font-semibold">{names.get(c.id) ?? c.ref}</span>
                                    <span className="block text-xs text-muted">{names.has(c.id) ? `${c.ref} · ` : ""}{s ? `${totalVisitsPerWeek(s)} visits a week` : "No schedule"}</span>
                                  </span>
                                </div>
                                {!s && !sus && <p className="mt-1 text-xs text-warn">New client – no schedule yet</p>}
                                {fl.map((f, i) => (
                                  <p key={`${f.kind}-${i}`} className="mt-1 text-xs text-warn">
                                    {flagText(f)}
                                  </p>
                                ))}
                              </div>
                              {DAYS.map((d) => (
                                <div key={d} role="cell" className={`space-y-1 border-l border-line px-1 py-1.5 ${sus ? "opacity-40" : ""}`}>
                                  {visitsOnDay(s, d).map((v) => (
                                    <VisitCard key={v.id} v={v} />
                                  ))}
                                </div>
                              ))}
                              <div className="space-y-1.5 border-l border-line px-3 py-2" role="cell">
                                {sus ? (
                                  <Badge tone="neutral">Suspended</Badge>
                                ) : s ? (
                                  s.confirmed ? (
                                    <Badge tone="ok" icon={<IconCheck aria-hidden className="h-3 w-3" />}>
                                      Confirmed
                                    </Badge>
                                  ) : (
                                    <Badge tone="warn" icon={<IconWarning aria-hidden className="h-3 w-3" />}>
                                      To check
                                    </Badge>
                                  )
                                ) : (
                                  <Badge tone="neutral">No schedule</Badge>
                                )}
                                <div className="flex flex-wrap gap-1">
                                  {s && !s.confirmed && (
                                    <Button className="!h-7 !px-2" onClick={() => confirm([c.id])}>
                                      Confirm
                                    </Button>
                                  )}
                                  <Button className="!h-7 !px-2" onClick={() => setEdit(c.id)}>
                                    {s ? <IconChanged aria-hidden className="h-3.5 w-3.5 text-muted" /> : <IconAdd aria-hidden className="h-3.5 w-3.5 text-muted" />}
                                    {s ? "Edit" : "Add schedule"}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">Saved in your settings file – download it to keep it (Settings or Export screen). Editing a schedule confirms it.</p>
          </>
        )}
      </Section>

      {learned && learned.one_offs.length > 0 && (
        <details className="panel mb-6 p-4 text-sm" open={oneOffsOpen} onToggle={(e) => setOneOffsOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer font-semibold">Not added – happened only once ({learned.one_offs.length})</summary>
          <p className="my-2 text-xs text-muted">These visits appeared in one week only, so they are not part of anyone&apos;s usual schedule.</p>
          <div className="max-h-[300px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {["Client", "Date", "Time", "Length", "Type"].map((h) => (
                    <th key={h} scope="col" className="sticky top-0 border-b border-line bg-surface px-3 py-2 text-xs font-semibold text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {learned.one_offs.map((o, i) => (
                  <tr key={i}>
                    <td className="border-b border-line px-3 py-2">{o.display_name || o.client_ref || clients.find((c) => c.id === o.client_id)?.ref || o.client_id}</td>
                    <td className="border-b border-line px-3 py-2">{niceDate(o.date)}</td>
                    <td className="border-b border-line px-3 py-2">{o.start}</td>
                    <td className="border-b border-line px-3 py-2">{lengthText(o.duration_min)}</td>
                    <td className="border-b border-line px-3 py-2">{o.booking_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {editClient && (
        <EditDrawer
          key={editClient.id}
          clientId={editClient.id}
          clientRef={editClient.ref}
          initial={schedules[editClient.id]}
          learnedWeeks={schedules[editClient.id]?.learned_from ?? learned?.weeks ?? []}
          onSave={(s) => {
            setSchedule(editClient.id, s);
            setEdit(null);
          }}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}
