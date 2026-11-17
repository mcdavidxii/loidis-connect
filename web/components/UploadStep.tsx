"use client";

import { useRef, useState } from "react";
import { fetchSample, syncFromCareLineLive } from "@/lib/api";
import { mergeSync } from "@/lib/settings";
import { useApp } from "./AppProvider";
import { IconClose, IconDemo, IconRefresh, IconSync, IconUpload } from "./icons";
import { Button, Notice, PageHeader, Section, inputCls } from "./ui";

function DropZone({
  id,
  title,
  hint,
  accept,
  file,
  required,
  onFile,
  onClear,
}: {
  id: string;
  title: string;
  hint: string;
  accept: string;
  file: { name: string } | null;
  required?: boolean;
  onFile: (f: File) => void;
  onClear?: () => void;
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
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={`rounded-xl border border-dashed px-4 py-3.5 ${over ? "border-brand bg-brand-soft" : "border-[#cbd5e1] bg-surface"}`}
    >
      <label htmlFor={id} className="block text-sm font-semibold">
        {title} <span className="text-xs font-normal text-muted">{required ? "required" : "optional"}</span>
      </label>
      <p className="mb-2 text-xs text-muted">{hint}</p>
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex items-center gap-2">
        <Button onClick={() => input.current?.click()}>
          <IconUpload aria-hidden className="h-4 w-4 text-muted" />
          {file ? "Replace" : "Choose file"}
        </Button>
        {file ? (
          <span className="flex min-w-0 items-center gap-1 text-sm">
            <span className="truncate">{file.name}</span>
            {onClear && (
              <button type="button" onClick={onClear} className="rounded-md p-1 text-muted hover:bg-hover" aria-label={`Remove ${title}`}>
                <IconClose aria-hidden className="h-4 w-4" />
              </button>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted">or drop it here</span>
        )}
      </div>
    </div>
  );
}

// Simple similarity between a name in the bookings file and a carer: surname match counts most,
// then a shared first-name prefix. Returns the best carer id, or null when nothing is close.
function norm(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function suggestCarer(name: string, carers: { id: string; name: string }[]): string | null {
  const a = norm(name);
  if (a.length === 0) return null;
  let best: { id: string; score: number } | null = null;
  for (const c of carers) {
    const b = norm(c.name);
    if (b.length === 0) continue;
    let score = 0;
    if (a[a.length - 1] === b[b.length - 1] && a.length > 1 && b.length > 1) score += 3;
    const fa = a[0];
    const fb = b[0];
    let k = 0;
    while (k < Math.min(fa.length, fb.length) && fa[k] === fb[k]) k++;
    if (k >= 2) score += 1 + (k >= 3 ? 1 : 0);
    if (a.join(" ") === b.join(" ")) score += 5;
    if (score > (best?.score ?? 0)) best = { id: c.id, score };
  }
  return best && best.score >= 3 ? best.id : null;
}

export function UploadStep() {
  const app = useApp();
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const info = app.bookingsInfo;
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const unmatched = (app.sync?.missing.unmatched_booking_carers ?? []).filter(
    (n) => !app.settings.carer_name_matches.some((m) => m.booking_name.toLowerCase() === n.toLowerCase()),
  );

  async function loadSamples() {
    setSampleError(null);
    try {
      await app.setBookings(await fetchSample("bookings.csv"));
      const err = await app.loadSettingsFile(await fetchSample("settings.json"));
      setSettingsError(err);
    } catch (e) {
      setSampleError(e instanceof Error ? e.message : "Could not load the sample files.");
    }
  }

  async function runSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await syncFromCareLineLive({ bookings: app.bookings ?? undefined, settings: app.settings });
      app.setSync(res);
      app.setSettings((s) => mergeSync(s, res));
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "The sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  const stats: [string, number][] = info
    ? [
        ["Visits", info.visits],
        ["Clients", info.clients],
        ["Carers allocated", info.carers],
        ["Double-ups", info.doubleUps],
        ["Unallocated", info.unallocated],
        ["Cancelled (ignored)", info.cancelled],
      ]
    : [];

  return (
    <div className="w-full">
      <PageHeader
        title="Upload"
        subtitle="Bookings for one week, and the settings file you kept from last time."
        actions={
          <>
            {app.mock && (
              <Button onClick={loadSamples}>
                <IconDemo aria-hidden className="h-4 w-4 text-muted" />
                Use sample files
              </Button>
            )}
            <Button variant="primary" onClick={() => app.setStep("settings")}>
              Continue
            </Button>
          </>
        }
      />
      {sampleError && <Notice tone="bad" title={sampleError} />}

      <div className="mb-8 grid gap-3 md:grid-cols-3">
        <DropZone
          id="bookings-file"
          title="Bookings CSV"
          hint="Reports > Bookings, one Monday to Sunday week."
          accept=".csv,text/csv"
          required
          file={app.bookings}
          onFile={(f) => void app.setBookings(f)}
          onClear={() => void app.setBookings(null)}
        />
        <DropZone
          id="settings-file"
          title="Settings file"
          hint="Leave empty the first time."
          accept=".json,application/json"
          file={app.settingsFileName ? { name: app.settingsFileName } : null}
          onFile={async (f) => setSettingsError(await app.loadSettingsFile(f))}
        />
        <DropZone
          id="continuity-file"
          title="Continuity report"
          hint="xlsx, the 4 weeks before."
          accept=".xlsx"
          file={app.continuity}
          onFile={app.setContinuity}
          onClear={() => app.setContinuity(null)}
        />
      </div>
      {settingsError && (
        <div className="mb-6">
          <Notice tone="bad" title="The settings file could not be used">
            {settingsError}
          </Notice>
        </div>
      )}

      {info && (
        <Section title="Bookings file">
          <dl className="flex flex-wrap gap-x-8 gap-y-2">
            {stats.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="text-base font-semibold">{v}</dd>
              </div>
            ))}
            {info.firstDate && (
              <div>
                <dt className="text-xs text-muted">Week starting</dt>
                <dd className="text-base font-semibold">{info.firstDate}</dd>
              </div>
            )}
          </dl>
          <div className="mt-3 space-y-2">
            {info.problems.length === 0 ? (
              <p className="text-sm text-ok">No problems found in the file.</p>
            ) : (
              info.problems.map((p) => <Notice key={p} tone="bad" title={p} />)
            )}
          </div>
        </Section>
      )}

      <Section
        title="CareLineLive"
        info="Reads carers, clients, addresses, teams, transport types and leave. Read-only: nothing is written to CareLineLive."
        actions={
          <Button onClick={runSync} disabled={syncing}>
            {syncing ? <IconRefresh aria-hidden className="h-4 w-4 animate-spin text-muted" /> : <IconSync aria-hidden className="h-4 w-4 text-muted" />}
            {syncing ? "Syncing" : "Sync from CareLineLive"}
          </Button>
        }
      >
        {!app.sync && !syncError && <p className="text-sm text-muted">Not synced yet.</p>}
        {syncError && <Notice tone="bad" title="The sync failed">{syncError}</Notice>}
        {app.sync && (
          <div className="space-y-3">
            <dl className="flex flex-wrap gap-x-8 gap-y-2">
              {(
                [
                  ["Carers", app.sync.counts.carers],
                  ["Clients", app.sync.counts.clients],
                  ["Addresses", app.sync.counts.addresses],
                  ["Leave entries", app.sync.counts.leave],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="text-base font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            {app.sync.missing.addresses.length > 0 && (
              <Notice tone="warn" title={`${app.sync.missing.addresses.length} client(s) have no address`}>
                Travel cannot be estimated for {app.sync.missing.addresses.join(", ")}.
              </Notice>
            )}
            {app.sync.missing.carers_not_in_settings.length > 0 && (
              <Notice title={`${app.sync.missing.carers_not_in_settings.length} carer(s) added to Settings`}>
                They have no working hours yet.
              </Notice>
            )}
            {app.sync.missing.clients_not_in_settings.length > 0 && (
              <Notice title={`${app.sync.missing.clients_not_in_settings.length} client(s) added to Settings`}>
                They have no rules yet.
              </Notice>
            )}
            {unmatched.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-semibold">Confirm carer names ({unmatched.length})</p>
                <p className="mb-2 text-xs text-muted">These names in the bookings file could not be matched. Matches are saved in the settings file.</p>
                <ul className="space-y-1.5">
                  {unmatched.map((n) => {
                    const suggestion = suggestCarer(n, app.settings.carers);
                    const value = chosen[n] ?? suggestion ?? "";
                    const confirm = () => {
                      if (value) {
                        app.setSettings((st) => ({
                          ...st,
                          carer_name_matches: [...st.carer_name_matches, { booking_name: n, carer_id: value }],
                        }));
                      }
                    };
                    return (
                      <li key={n} className="flex flex-wrap items-center gap-2">
                        <span className="w-48 truncate">{n}</span>
                        <label className="sr-only" htmlFor={`match-${n}`}>
                          Match {n} to a carer
                        </label>
                        <select id={`match-${n}`} value={value} className={inputCls} onChange={(e) => setChosen((c) => ({ ...c, [n]: e.target.value }))}>
                          <option value="">Choose a carer</option>
                          {app.settings.carers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({c.id})
                            </option>
                          ))}
                        </select>
                        {value && value === suggestion && <span className="rounded-md bg-hover px-1.5 py-0.5 text-xs text-muted">suggested</span>}
                        <Button onClick={confirm} disabled={!value}>
                          Confirm
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {app.sync.missing.addresses.length === 0 && unmatched.length === 0 && app.sync.missing.carers_not_in_settings.length === 0 && (
              <p className="text-sm text-ok">Everything matched.</p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
