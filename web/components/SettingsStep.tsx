"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { hasAnyHours, isAnyTime, settingsToJson, settingsWarnings } from "@/lib/settings";
import { DAYS, DAY_LABELS, type DayKey, type HoursBlock, type SettingsCarer, type SettingsClient } from "@/lib/types";
import { areaLabel } from "@/lib/areas";
import { useApp } from "./AppProvider";
import { IconAdd, IconDelete, IconDownload, IconUpload, IconWarning } from "./icons";
import { Badge, Button, Notice, PageHeader, ScrollBox, inputCls, tableCls, tdCls, thCls } from "./ui";

type Tab = "carers" | "clients" | "agency";
// Default block when "Add" is pressed on a day: a 12-hour day shift, edited per carer.
const DEFAULT_SHIFT: HoursBlock = { start: "07:00", end: "19:00" };
const SKILL_OPTIONS = ["medication", "hoist", "nights", "dementia", "peg feeding"];
const BOOKING_TYPES = ["Morning Visit", "Medication Call", "Lunch Visit", "Tea Visit", "Bed Visit", "Night Check"];

export function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Chips({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const all = [...new Set([...options, ...value])];
  const [extra, setExtra] = useState("");
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap items-center gap-1.5">
        {all.map((o) => {
          const on = value.includes(o);
          return (
            <label
              key={o}
              className={`inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand ${
                on ? "border-brand bg-brand-soft font-semibold text-brand-strong" : "border-line bg-surface text-ink hover:bg-hover"
              }`}
            >
              <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])} />
              <span aria-hidden>{on ? "✓" : "+"}</span>
              {o}
            </label>
          );
        })}
        <input
          aria-label={`Add another to ${label}`}
          className={`${inputCls} h-7 w-32`}
          placeholder="Add other"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && extra.trim()) {
              e.preventDefault();
              onChange([...value, extra.trim()]);
              setExtra("");
            }
          }}
        />
      </div>
    </fieldset>
  );
}

function CarerPicker({ label, carers, value, onChange }: { label: string; carers: SettingsCarer[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {carers.map((c) => (
          <label key={c.id} className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              className="accent-[#0f7b6c]"
              checked={value.includes(c.id)}
              onChange={() => onChange(value.includes(c.id) ? value.filter((x) => x !== c.id) : [...value, c.id])}
            />
            {c.name}
          </label>
        ))}
        {carers.length === 0 && <span className="text-sm text-muted">No carers yet.</span>}
      </div>
    </fieldset>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function HoursEditor({ carer, onChange }: { carer: SettingsCarer; onChange: (h: SettingsCarer["working_hours"]) => void }) {
  const wh = carer.working_hours;
  const set = (d: DayKey, blocks: HoursBlock[]) => onChange({ ...wh, [d]: blocks });
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold">Working hours</legend>
      <p className="mb-2 text-xs text-muted">An end earlier than the start means a night that ends the next morning.</p>
      <table className={tableCls}>
        <caption className="sr-only">Working hours by weekday</caption>
        <tbody>
          {DAYS.map((d) => {
            const blocks = wh[d] ?? [];
            return (
              <tr key={d}>
                <th scope="row" className={`${tdCls} w-28 font-normal`}>
                  {DAY_LABELS[d]}
                </th>
                <td className={tdCls}>
                  <div className="flex flex-wrap items-center gap-2">
                    {blocks.length === 0 && <span className="text-muted">Not working</span>}
                    {blocks.map((b, i) => (
                      <span key={i} className="inline-flex items-center gap-1">
                        <input
                          type="time"
                          aria-label={`${DAY_LABELS[d]} block ${i + 1} start`}
                          className={inputCls}
                          value={b.start}
                          onChange={(e) => set(d, blocks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                        />
                        <span aria-hidden className="text-muted">
                          to
                        </span>
                        <input
                          type="time"
                          aria-label={`${DAY_LABELS[d]} block ${i + 1} end`}
                          className={inputCls}
                          value={b.end}
                          onChange={(e) => set(d, blocks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                        />
                        {b.end <= b.start && <span className="text-xs text-muted">night</span>}
                        <button
                          type="button"
                          aria-label={`Remove ${DAY_LABELS[d]} block ${i + 1}`}
                          className="rounded-md p-1 text-muted hover:bg-hover"
                          onClick={() => set(d, blocks.filter((_, j) => j !== i))}
                        >
                          <IconDelete aria-hidden className="h-4 w-4" />
                        </button>
                      </span>
                    ))}
                  </div>
                </td>
                <td className={`${tdCls} w-28 text-right`}>
                  <Button variant="ghost" onClick={() => set(d, [...blocks, { ...DEFAULT_SHIFT }])}>
                    <IconAdd aria-hidden className="h-4 w-4 text-muted" />
                    Add
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2">
        <Button
          onClick={() => {
            const mon = wh.mon ?? [];
            onChange({ ...wh, tue: mon, wed: mon, thu: mon, fri: mon });
          }}
        >
          Copy Monday to Tuesday-Friday
        </Button>
      </div>
    </fieldset>
  );
}

function CarersTab() {
  const { settings, setSettings } = useApp();
  const [sel, setSel] = useState<string | null>(settings.carers[0]?.id ?? null);
  const carer = settings.carers.find((c) => c.id === sel) ?? settings.carers[0];
  const patch = (p: Partial<SettingsCarer>) =>
    setSettings((s) => ({ ...s, carers: s.carers.map((c) => (c.id === carer?.id ? { ...c, ...p } : c)) }));
  const incomplete = (c: SettingsCarer) => c.active && (!c.dbs_expiry || !c.training_expiry || c.weekly_max_hours == null);

  if (!carer) return <Notice title="No carers yet">Upload a settings file or sync from CareLineLive on the Upload screen.</Notice>;
  return (
    <div>
      <ScrollBox count={settings.carers.length} label="Carers"><table className={tableCls}>
        <caption className="sr-only">Carers. Choose a row to edit.</caption>
        <thead>
          <tr>
            <th scope="col" className={thCls}>Carer</th>
            <th scope="col" className={thCls}>Team</th>
            <th scope="col" className={thCls}>Hours</th>
            <th scope="col" className={thCls}>Max hours</th>
            <th scope="col" className={thCls}>DBS expiry</th>
            <th scope="col" className={thCls}>Training expiry</th>
            <th scope="col" className={thCls}>Status</th>
          </tr>
        </thead>
        <tbody>
          {settings.carers.map((c) => (
            <tr key={c.id} className={c.id === carer.id ? "bg-brand-soft" : "hover:bg-canvas"}>
              <th scope="row" className={`${tdCls} font-normal`}>
                <button
                  type="button"
                  aria-current={c.id === carer.id ? "true" : undefined}
                  onClick={() => setSel(c.id)}
                  className={`text-left ${c.id === carer.id ? "font-semibold" : ""}`}
                >
                  {c.name}
                </button>
              </th>
              <td className={tdCls}>{c.teams.map(areaLabel).join(", ")}</td>
              <td className={tdCls}>{isAnyTime(c) ? "Any time" : `${DAYS.filter((d) => (c.working_hours[d]?.length ?? 0) > 0).length} days`}</td>
              <td className={tdCls}>{c.weekly_max_hours ?? "-"}</td>
              <td className={tdCls}>{c.dbs_expiry ?? "-"}</td>
              <td className={tdCls}>{c.training_expiry ?? "-"}</td>
              <td className={tdCls}>
                {!c.active ? (
                  <Badge tone="neutral">Inactive</Badge>
                ) : incomplete(c) ? (
                  <Badge tone="warn" icon={<IconWarning aria-hidden className="h-3 w-3" />}>
                    Incomplete
                  </Badge>
                ) : (
                  <span className="text-muted">Complete</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></ScrollBox>

      <div className="mt-6 border-t border-line pt-5"><h2 className="mb-3 text-base">{carer.name}</h2>
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Weekly maximum hours" hint="Empty: not checked.">
              <input
                type="number"
                min={0}
                max={80}
                className={`${inputCls} w-24`}
                value={carer.weekly_max_hours ?? ""}
                onChange={(e) => patch({ weekly_max_hours: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label="DBS expiry">
              <input type="date" className={inputCls} value={carer.dbs_expiry ?? ""} onChange={(e) => patch({ dbs_expiry: e.target.value || null })} />
            </Field>
            <Field label="Training expiry">
              <input type="date" className={inputCls} value={carer.training_expiry ?? ""} onChange={(e) => patch({ training_expiry: e.target.value || null })} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-1 text-sm">
              <input type="checkbox" className="accent-[#0f7b6c]" checked={carer.active} onChange={(e) => patch({ active: e.target.checked })} />
              Active in planning
            </label>
          </div>
          <Chips label="Skills" options={SKILL_OPTIONS} value={carer.skills} onChange={(skills) => patch({ skills })} />
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                className="accent-[#0f7b6c]"
                checked={isAnyTime(carer)}
                onChange={(e) =>
                  e.target.checked
                    ? patch({ available_any_time: true, working_hours: {} })
                    : patch({
                        available_any_time: false,
                        // With no blocks a carer counts as any time, so start with one 12-hour block.
                        working_hours: hasAnyHours(carer) ? carer.working_hours : { mon: [{ ...DEFAULT_SHIFT }] },
                      })
                }
              />
              Available any time
            </label>
            {isAnyTime(carer) ? (
              <p className="text-sm text-muted">Any time — we&apos;ll suggest this carer&apos;s hours.</p>
            ) : (
              <HoursEditor carer={carer} onChange={(working_hours) => patch({ working_hours })} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ClientsTab() {
  const { settings, setSettings } = useApp();
  const [sel, setSel] = useState<string | null>(settings.clients[0]?.id ?? null);
  const client = settings.clients.find((c) => c.id === sel) ?? settings.clients[0];
  const patch = (p: Partial<SettingsClient>) =>
    setSettings((s) => ({ ...s, clients: s.clients.map((c) => (c.id === client?.id ? { ...c, ...p } : c)) }));
  if (!client) return <Notice title="No clients yet">Upload a settings file or sync from CareLineLive on the Upload screen.</Notice>;
  const teamCarers = settings.carers.filter((c) => c.teams.includes(client.team));
  return (
    <div>
      <ScrollBox count={settings.clients.length} label="Clients"><table className={tableCls}>
        <caption className="sr-only">Clients. Choose a row to edit.</caption>
        <thead>
          <tr>
            <th scope="col" className={thCls}>Client</th>
            <th scope="col" className={thCls}>Team</th>
            <th scope="col" className={thCls}>Gender preference</th>
            <th scope="col" className={thCls}>Do not send</th>
            <th scope="col" className={thCls}>Bar</th>
            <th scope="col" className={thCls}>Required skills</th>
            <th scope="col" className={thCls}>Time-critical types</th>
          </tr>
        </thead>
        <tbody>
          {settings.clients.map((c) => (
            <tr key={c.id} className={c.id === client.id ? "bg-brand-soft" : "hover:bg-canvas"}>
              <th scope="row" className={`${tdCls} font-normal`}>
                <button
                  type="button"
                  aria-current={c.id === client.id ? "true" : undefined}
                  onClick={() => setSel(c.id)}
                  className={`text-left ${c.id === client.id ? "font-semibold" : ""}`}
                >
                  {c.ref}
                </button>
              </th>
              <td className={tdCls}>{areaLabel(c.team)}</td>
              <td className={tdCls}>{c.gender_preference ?? "-"}</td>
              <td className={tdCls}>{c.do_not_send.length || "-"}</td>
              <td className={tdCls}>{c.safeguarding_bar.length || "-"}</td>
              <td className={tdCls}>{c.required_skills.join(", ") || "-"}</td>
              <td className={tdCls}>{c.time_critical_booking_types.join(", ") || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table></ScrollBox>

      <div className="mt-6 border-t border-line pt-5"><h2 className="mb-3 text-base">{client.ref}</h2>
        <div className="space-y-5">
          <Field label="Gender preference of carer">
            <select
              className={inputCls}
              value={client.gender_preference ?? ""}
              onChange={(e) => patch({ gender_preference: (e.target.value || null) as SettingsClient["gender_preference"] })}
            >
              <option value="">No preference</option>
              <option value="female">Female carers only</option>
              <option value="male">Male carers only</option>
            </select>
          </Field>
          <CarerPicker label="Do not send (a last resort, with a warning)" carers={teamCarers} value={client.do_not_send} onChange={(do_not_send) => patch({ do_not_send })} />
          <CarerPicker label="Safeguarding bar (never booked or suggested)" carers={teamCarers} value={client.safeguarding_bar} onChange={(safeguarding_bar) => patch({ safeguarding_bar })} />
          <Chips label="Required skills" options={SKILL_OPTIONS} value={client.required_skills} onChange={(required_skills) => patch({ required_skills })} />
          <Chips
            label="Time-critical booking types (never moved from the booked time)"
            options={BOOKING_TYPES}
            value={client.time_critical_booking_types}
            onChange={(time_critical_booking_types) => patch({ time_critical_booking_types })}
          />
        </div>
      </div>
    </div>
  );
}

function NumberInput({
  label,
  suffix,
  value,
  onChange,
  allowEmpty,
}: {
  label: string;
  suffix: string;
  value: number | null;
  onChange: (v: number | null) => void;
  allowEmpty?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <input
        type="number"
        aria-label={label}
        min={0}
        className={`${inputCls} w-24`}
        value={value ?? ""}
        placeholder={allowEmpty ? "default" : undefined}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
      <span className="text-xs text-muted">{suffix}</span>
    </span>
  );
}

function AgencyTab() {
  const { settings, setSettings } = useApp();
  const a = settings.agency;
  const set = (p: Partial<typeof a>) => setSettings((s) => ({ ...s, agency: { ...s.agency, ...p } }));
  const rows: { name: string; input: ReactNode; meaning: string }[] = [
    {
      name: "How far a visit may move",
      meaning: "How far a visit that is not time-critical may move.",
      input: <NumberInput label="Visit move window" suffix="minutes either way" value={a.move_window_minutes} onChange={(v) => set({ move_window_minutes: v ?? 30 })} />,
    },
    {
      name: "Cost of moving a visit",
      meaning: "Visits only move when it saves enough travel to be worth it.",
      input: <NumberInput label="Move cost" suffix="p a minute" value={a.move_cost_pence_per_min} onChange={(v) => set({ move_cost_pence_per_min: v ?? 15 })} />,
    },
    {
      name: "Value of a familiar carer",
      meaning: "How much it is worth sending a carer the client has seen in the last 4 weeks.",
      input: <NumberInput label="Continuity weight" suffix="£ per visit" value={a.continuity_weight_pence / 100} onChange={(v) => set({ continuity_weight_pence: Math.round((v ?? 10) * 100) })} />,
    },
    {
      name: "Fair hours",
      meaning: "Hours are shared as evenly as possible within each team.",
      input: <span>Each carer in a team gets an equal share</span>,
    },
    {
      name: "Planning time",
      meaning: "Longer can give slightly better suggestions. Also set on the Plan screen.",
      input: <NumberInput label="Search time" suffix="seconds a day" value={a.search_seconds_per_day} onChange={(v) => set({ search_seconds_per_day: v ?? 10 })} />,
    },
    {
      name: "Small time changes we ignore",
      meaning: "A time change this small needs no edit in CareLineLive. Placeholder: confirm with the coordinator / contracts.",
      input: <NumberInput label="Small time changes we ignore (minutes)" suffix="minutes" value={a.arrival_tolerance_minutes} onChange={(v) => set({ arrival_tolerance_minutes: v ?? 15 })} />,
    },
    {
      name: "Areas planned together",
      meaning: "Which teams are planned together. Set for you; read-only.",
      input: a.team_regions ? (
        <ul>
          {Object.keys(a.team_regions).map((area) => (
            <li key={area}>{areaLabel(area)}</li>
          ))}
        </ul>
      ) : (
        <span className="text-muted">Service default</span>
      ),
    },
    {
      name: "How many changes",
      meaning: "Chosen on the Plan screen.",
      input: <span>{({ 300: "More changes", 500: "Fewer changes", 1000: "Balanced (recommended)", 2000: "Only clear wins" } as Record<number, string>)[a.change_cost_pence] ?? "Custom"}</span>,
    },
    {
      name: "Pay rate",
      meaning: "Used to cost travel. Empty uses the standard value.",
      input: <NumberInput label="Pay rate" suffix="p an hour" value={a.pay_pence_per_hour} onChange={(v) => set({ pay_pence_per_hour: v })} allowEmpty />,
    },
    {
      name: "Mileage rate",
      meaning: "Used to cost travel. Empty uses the standard value.",
      input: <NumberInput label="Mileage rate" suffix="p a mile" value={a.mileage_pence_per_mile} onChange={(v) => set({ mileage_pence_per_mile: v })} allowEmpty />,
    },
    {
      name: "Travel time paid",
      meaning: "Whether carers are paid for travel between visits.",
      input: (
        <select
          aria-label="Travel time paid"
          className={inputCls}
          value={a.travel_time_paid == null ? "" : a.travel_time_paid ? "yes" : "no"}
          onChange={(e) => set({ travel_time_paid: e.target.value === "" ? null : e.target.value === "yes" })}
        >
          <option value="">Standard</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      ),
    },
  ];
  return (
    <table className={tableCls}>
      <caption className="sr-only">Agency settings</caption>
      <thead>
        <tr>
          <th scope="col" className={thCls}>Setting</th>
          <th scope="col" className={thCls}>Value</th>
          <th scope="col" className={thCls}>Meaning</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <th scope="row" className={`${tdCls} w-48 font-semibold`}>{r.name}</th>
            <td className={`${tdCls} w-72`}>{r.input}</td>
            <td className={`${tdCls} text-muted`}>{r.meaning}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SettingsStep() {
  const { settings, loadSettingsFile, setStep } = useApp();
  const [tab, setTab] = useState<Tab>("carers");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const warnings = useMemo(() => settingsWarnings(settings, new Date().toISOString().slice(0, 10)), [settings]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "carers", label: `Carers (${settings.carers.length})` },
    { id: "clients", label: `Clients (${settings.clients.length})` },
    { id: "agency", label: "Agency" },
  ];

  return (
    <div className="w-full">
      <PageHeader
        title="Settings"
        subtitle="Kept in a settings file you download and upload again next week. It holds personal data."
        actions={
          <>
            <Button onClick={() => fileRef.current?.click()}>
              <IconUpload aria-hidden className="h-4 w-4 text-muted" />
              Upload settings
            </Button>
            <Button onClick={() => downloadText(settingsToJson(settings), "loidis-settings.json", "application/json")}>
              <IconDownload aria-hidden className="h-4 w-4 text-muted" />
              Download settings
            </Button>
            <Button variant="primary" onClick={() => setStep("run")}>
              Continue
            </Button>
          </>
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-label="Upload settings file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setError(await loadSettingsFile(f));
          e.target.value = "";
        }}
      />
      {error && (
        <div className="mb-4">
          <Notice tone="bad" title="The settings file could not be used">
            {error}
          </Notice>
        </div>
      )}

      {settings.carers.some((c) => c.active && isAnyTime(c)) && (
        <p className="mb-4 text-sm text-muted">
          {settings.carers.filter((c) => c.active && isAnyTime(c)).length} carer(s) are available any time; we&apos;ll suggest their hours.
        </p>
      )}
      {warnings.length > 0 && (
        <details className="mb-5 rounded-xl bg-warn-soft px-4 py-3 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold">
            <IconWarning aria-hidden className="h-4 w-4 text-warn" />
            {warnings.length} thing(s) to check before planning
          </summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-6 text-muted">
            {warnings.map((w) => (
              <li key={w.code}>{w.message}</li>
            ))}
          </ul>
        </details>
      )}

      <div role="tablist" aria-label="Settings sections" className="mb-4 inline-flex gap-0.5 rounded-lg bg-hover p-0.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            type="button"
            onClick={() => setTab(t.id)}
            className={`h-8 rounded-md px-3 text-sm ${tab === t.id ? "bg-surface font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="panel p-6">
        {tab === "carers" && <CarersTab />}
        {tab === "clients" && <ClientsTab />}
        {tab === "agency" && <AgencyTab />}
      </div>
    </div>
  );
}
