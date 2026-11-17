"use client";

import { AlertTriangle, Download, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { hasAnyHours, settingsToJson, settingsWarnings } from "@/lib/settings";
import { DAYS, DAY_LABELS, type DayKey, type HoursBlock, type SettingsCarer, type SettingsClient } from "@/lib/types";
import { useApp } from "./AppProvider";
import { Banner, Button, Card, PageTitle, inputCls } from "./ui";

type Tab = "carers" | "clients" | "agency";
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
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {all.map((o) => {
          const on = value.includes(o);
          return (
            <label
              key={o}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-700 ${
                on ? "border-brand bg-brand-soft font-medium text-brand-strong" : "border-line bg-surface"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
              />
              <span aria-hidden>{on ? "✓" : "+"}</span>
              {o}
            </label>
          );
        })}
        <span className="inline-flex items-center gap-1">
          <input
            aria-label={`Add another to ${label}`}
            className={`${inputCls} w-36`}
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
        </span>
      </div>
    </fieldset>
  );
}

function CarerPicker({ label, carers, value, onChange }: { label: string; carers: SettingsCarer[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {carers.map((c) => (
          <label key={c.id} className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
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
      <span className="mb-1 block text-sm font-medium">{label}</span>
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
      <legend className="mb-1 text-sm font-medium">Working hours</legend>
      <p className="mb-2 text-xs text-muted">
        Blocks per weekday. For a night, set the end earlier than the start (for example 22:00 to 07:00 ends the next morning).
      </p>
      <div className="divide-y divide-line rounded-md border border-line">
        {DAYS.map((d) => {
          const blocks = wh[d] ?? [];
          return (
            <div key={d} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="w-24 text-sm font-medium">{DAY_LABELS[d]}</span>
              <div className="flex flex-1 flex-wrap items-center gap-2">
                {blocks.length === 0 && <span className="text-sm text-muted">Not working</span>}
                {blocks.map((b, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-md bg-canvas px-2 py-1">
                    <input
                      type="time"
                      aria-label={`${DAY_LABELS[d]} block ${i + 1} start`}
                      className={inputCls}
                      value={b.start}
                      onChange={(e) => set(d, blocks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                    />
                    <span aria-hidden>to</span>
                    <input
                      type="time"
                      aria-label={`${DAY_LABELS[d]} block ${i + 1} end`}
                      className={inputCls}
                      value={b.end}
                      onChange={(e) => set(d, blocks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                    />
                    {b.end <= b.start && <span className="text-xs font-medium text-moved">night</span>}
                    <button
                      type="button"
                      aria-label={`Remove ${DAY_LABELS[d]} block ${i + 1}`}
                      className="rounded p-1 text-muted hover:bg-line/50"
                      onClick={() => set(d, blocks.filter((_, j) => j !== i))}
                    >
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </button>
                  </span>
                ))}
              </div>
              <Button variant="ghost" onClick={() => set(d, [...blocks, { start: "07:00", end: "14:00" }])}>
                <Plus aria-hidden className="h-4 w-4" />
                Add block
              </Button>
            </div>
          );
        })}
      </div>
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
  const incomplete = (c: SettingsCarer) => c.active && (!hasAnyHours(c) || !c.dbs_expiry || !c.training_expiry || c.weekly_max_hours == null);

  if (!carer) return <Banner tone="info" title="No carers yet">Upload a settings file or use Sync from CareLineLive on the Upload screen.</Banner>;
  return (
    <div className="grid gap-5 lg:grid-cols-[14rem_1fr]">
      <ul aria-label="Carers" className="space-y-1">
        {settings.carers.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              aria-current={c.id === carer.id ? "true" : undefined}
              onClick={() => setSel(c.id)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${c.id === carer.id ? "bg-brand-soft font-semibold" : "hover:bg-canvas"}`}
            >
              <span>
                {c.name} <span className="text-muted">{c.teams.join(", ")}</span>
              </span>
              {incomplete(c) && (
                <span className="inline-flex items-center gap-1 text-xs text-warn">
                  <AlertTriangle aria-hidden className="h-4 w-4" />
                  <span>Incomplete</span>
                </span>
              )}
              {!c.active && <span className="text-xs text-muted">Inactive</span>}
            </button>
          </li>
        ))}
      </ul>
      <Card title={`${carer.name} (${carer.id})`}>
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Team(s)" hint="From CareLineLive.">
              <input className={`${inputCls} w-full`} value={carer.teams.join(", ")} readOnly />
            </Field>
            <Field label="Weekly maximum hours" hint="Leave empty if not known; the rule is then not checked.">
              <input
                type="number"
                min={0}
                max={80}
                className={`${inputCls} w-32`}
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
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={carer.active} onChange={(e) => patch({ active: e.target.checked })} />
            Active in planning (untick for carers who are employed but not on the rota)
          </label>
          <Chips label="Skills" options={SKILL_OPTIONS} value={carer.skills} onChange={(skills) => patch({ skills })} />
          <HoursEditor carer={carer} onChange={(working_hours) => patch({ working_hours })} />
        </div>
      </Card>
    </div>
  );
}

function ClientsTab() {
  const { settings, setSettings } = useApp();
  const [sel, setSel] = useState<string | null>(settings.clients[0]?.id ?? null);
  const client = settings.clients.find((c) => c.id === sel) ?? settings.clients[0];
  const patch = (p: Partial<SettingsClient>) =>
    setSettings((s) => ({ ...s, clients: s.clients.map((c) => (c.id === client?.id ? { ...c, ...p } : c)) }));
  if (!client) return <Banner tone="info" title="No clients yet">Upload a settings file or use Sync from CareLineLive on the Upload screen.</Banner>;
  const teamCarers = settings.carers.filter((c) => c.teams.includes(client.team));
  return (
    <div className="grid gap-5 lg:grid-cols-[14rem_1fr]">
      <ul aria-label="Clients" className="space-y-1">
        {settings.clients.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              aria-current={c.id === client.id ? "true" : undefined}
              onClick={() => setSel(c.id)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${c.id === client.id ? "bg-brand-soft font-semibold" : "hover:bg-canvas"}`}
            >
              <span>{c.ref}</span>
              <span className="text-xs text-muted">{c.team}</span>
            </button>
          </li>
        ))}
      </ul>
      <Card title={`${client.ref} (${client.team})`}>
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
          <CarerPicker
            label="Do-not-send carers (never booked; a last resort with a warning)"
            carers={teamCarers}
            value={client.do_not_send}
            onChange={(do_not_send) => patch({ do_not_send })}
          />
          <CarerPicker
            label="Safeguarding bar (never booked or suggested)"
            carers={teamCarers}
            value={client.safeguarding_bar}
            onChange={(safeguarding_bar) => patch({ safeguarding_bar })}
          />
          <Chips label="Required skills for this client&apos;s visits" options={SKILL_OPTIONS} value={client.required_skills} onChange={(required_skills) => patch({ required_skills })} />
          <Chips
            label="Time-critical booking types (these visits never move from their booked time)"
            options={BOOKING_TYPES}
            value={client.time_critical_booking_types}
            onChange={(time_critical_booking_types) => patch({ time_critical_booking_types })}
          />
        </div>
      </Card>
    </div>
  );
}

function AgencyTab() {
  const { settings, setSettings } = useApp();
  const a = settings.agency;
  const set = (p: Partial<typeof a>) => setSettings((s) => ({ ...s, agency: { ...s.agency, ...p } }));
  const rows: { name: string; input: ReactNode; meaning: string }[] = [
    {
      name: "Visit move window",
      meaning: "How far a visit that is not time-critical may move from its booked time.",
      input: <NumberInput label="Visit move window" suffix="min either way" value={a.move_window_minutes} onChange={(v) => set({ move_window_minutes: v ?? 30 })} />,
    },
    {
      name: "Move cost",
      meaning: "Discourages moving visits unless it saves travel.",
      input: <NumberInput label="Move cost" suffix="pence per minute" value={a.move_cost_pence_per_min} onChange={(v) => set({ move_cost_pence_per_min: v ?? 15 })} />,
    },
    {
      name: "Continuity weight",
      meaning: "Cost of sending a carer the client has not seen in the last 4 weeks.",
      input: (
        <NumberInput label="Continuity weight" suffix="pounds per visit" value={a.continuity_weight_pence / 100} onChange={(v) => set({ continuity_weight_pence: Math.round((v ?? 10) * 100) })} />
      ),
    },
    {
      name: "Hours balance",
      meaning: "Each carer in a team gets an equal share of the hours (decision of 2026-11-16).",
      input: <span className="text-sm">Equal share within each team</span>,
    },
    {
      name: "Search time",
      meaning: "Longer can give a slightly better plan.",
      input: <NumberInput label="Search time" suffix="seconds per day" value={a.search_seconds_per_day} onChange={(v) => set({ search_seconds_per_day: v ?? 30 })} />,
    },
    {
      name: "Arrival tolerance",
      meaning:
        "How late a carer may arrive without the booked time needing an edit. Placeholder: confirm with the coordinator / contracts.",
      input: (
        <NumberInput
          label="Arrival tolerance (minutes)"
          suffix="minutes"
          value={a.arrival_tolerance_minutes}
          onChange={(v) => set({ arrival_tolerance_minutes: v ?? 15 })}
        />
      ),
    },
    {
      name: "Team regions",
      meaning: "Which planning region each CareLineLive team belongs to. Set by the service for now; shown here, not editable.",
      input: a.team_regions ? (
        <ul className="text-sm">
          {Object.entries(a.team_regions).map(([team, region]) => (
            <li key={team}>
              {team} <span aria-hidden>&rarr;</span> <span className="sr-only">in region</span> {region}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-sm text-muted">Service default (Leeds; Dorset = Dorchester + Weymouth)</span>
      ),
    },
    {
      name: "Change cost",
      meaning: "Improve my rota only: how much a change must save to be suggested. Chosen on the Run screen.",
      input: <span className="text-sm">£{(a.change_cost_pence / 100).toFixed(0)} per change</span>,
    },
    {
      name: "Pay rate",
      meaning: "Used to cost travel. Empty means the engine default.",
      input: <NumberInput label="Pay rate" suffix="pence per hour" value={a.pay_pence_per_hour} onChange={(v) => set({ pay_pence_per_hour: v })} allowEmpty />,
    },
    {
      name: "Mileage rate",
      meaning: "Used to cost travel. Empty means the engine default.",
      input: <NumberInput label="Mileage rate" suffix="pence per mile" value={a.mileage_pence_per_mile} onChange={(v) => set({ mileage_pence_per_mile: v })} allowEmpty />,
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
          <option value="">Engine default</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      ),
    },
  ];
  return (
    <Card>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Agency settings</caption>
        <thead>
          <tr className="border-b border-line text-muted">
            <th scope="col" className="py-2 pr-4 font-medium">Setting</th>
            <th scope="col" className="py-2 pr-4 font-medium">Value</th>
            <th scope="col" className="py-2 font-medium">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-line last:border-0 align-top">
              <th scope="row" className="py-3 pr-4 font-medium">{r.name}</th>
              <td className="py-3 pr-4">{r.input}</td>
              <td className="py-3 text-muted">{r.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted">Defaults are the shadow trial&apos;s recommended values. Teams are planned separately.</p>
    </Card>
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
      <span className="text-muted">{suffix}</span>
    </span>
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
    <div className="max-w-6xl space-y-5">
      <PageTitle
        title="Settings"
        intro="Everything you enter here is kept in a settings file that you download and keep. Upload it again next week. It holds personal data, so store it as carefully as other staff and client files."
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => downloadText(settingsToJson(settings), "loidis-settings.json", "application/json")}
        >
          <Download aria-hidden className="h-4 w-4" />
          Download settings file
        </Button>
        <Button onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden className="h-4 w-4" />
          Upload settings file
        </Button>
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
      </div>
      {error && <Banner tone="bad" title="The settings file could not be used">{error}</Banner>}

      {warnings.length > 0 && (
        <Banner tone="warn" title={`${warnings.length} thing(s) to check before running`}>
          <ul className="list-disc pl-5">
            {warnings.map((w) => (
              <li key={w.code}>{w.message}</li>
            ))}
          </ul>
        </Banner>
      )}

      <div role="tablist" aria-label="Settings sections" className="flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t.id ? "border-brand font-semibold text-brand-strong" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "carers" && <CarersTab />}
        {tab === "clients" && <ClientsTab />}
        {tab === "agency" && <AgencyTab />}
      </div>

      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setStep("run")}>
          Continue to Run
        </Button>
      </div>
    </div>
  );
}
