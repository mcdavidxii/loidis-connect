"use client";

import { CheckCircle2, CloudDownload, FileSpreadsheet, FileText, FlaskConical, RefreshCw, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { fetchSample, syncFromCareLineLive } from "@/lib/api";
import { mergeSync } from "@/lib/settings";
import { useApp } from "./AppProvider";
import { Banner, Button, Card, PageTitle, inputCls } from "./ui";

function DropZone({
  id,
  title,
  hint,
  accept,
  file,
  required,
  onFile,
  onClear,
  Icon,
}: {
  id: string;
  title: string;
  hint: string;
  accept: string;
  file: { name: string } | null;
  required?: boolean;
  onFile: (f: File) => void;
  onClear: () => void;
  Icon: typeof FileText;
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
      className={`rounded-lg border-2 border-dashed p-4 ${over ? "border-brand bg-brand-soft" : "border-line bg-surface"}`}
    >
      <div className="flex items-start gap-3">
        <Icon aria-hidden className="mt-0.5 h-6 w-6 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="block text-sm font-semibold">
            {title} {required ? <span className="font-normal text-muted">(required)</span> : <span className="font-normal text-muted">(optional)</span>}
          </label>
          <p className="mt-0.5 text-xs text-muted">{hint}</p>
          {file ? (
            <p className="mt-2 flex items-center gap-2 text-sm">
              <CheckCircle2 aria-hidden className="h-4 w-4 text-ok" />
              <span className="truncate">{file.name}</span>
              <button type="button" onClick={onClear} className="rounded p-1 text-muted hover:bg-canvas" aria-label={`Remove ${title}`}>
                <X aria-hidden className="h-4 w-4" />
              </button>
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">Drop a file here, or choose one.</p>
          )}
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
          <Button className="mt-2" onClick={() => input.current?.click()}>
            <Upload aria-hidden className="h-4 w-4" />
            {file ? "Replace file" : "Choose file"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function UploadStep() {
  const app = useApp();
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const info = app.bookingsInfo;

  const unmatched = (app.sync?.missing.unmatched_booking_carers ?? []).filter(
    (n) => !app.settings.carer_name_matches.some((m) => m.booking_name.toLowerCase() === n.toLowerCase()),
  );

  async function loadSamples() {
    setSampleError(null);
    try {
      await app.setBookings(await fetchSample("bookings.csv"));
      const err = await app.loadSettingsFile(await fetchSample("settings.json"));
      if (err) setSettingsError(err);
      else setSettingsError(null);
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

  return (
    <div className="max-w-5xl space-y-5">
      <PageTitle
        title="Upload"
        intro="Upload this week's bookings, and the settings file you kept from last week. Files are used for this run only and are not stored on the server."
      />

      {app.mock && (
        <Banner tone="warn" title="Demo mode">
          <p>This version works on made-up carers, clients and visits (no real data). Use the sample files to try it. With the built-in mock, uploaded files are not used for planning.</p>
          <Button className="mt-2" onClick={loadSamples}>
            <FlaskConical aria-hidden className="h-4 w-4" />
            Use the made-up sample files
          </Button>
          {sampleError && <p className="mt-1 text-bad">{sampleError}</p>}
        </Banner>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <DropZone
          id="bookings-file"
          title="Bookings CSV"
          hint="One week, Monday to Sunday, from CareLineLive Reports > Bookings."
          accept=".csv,text/csv"
          required
          file={app.bookings}
          onFile={(f) => void app.setBookings(f)}
          onClear={() => void app.setBookings(null)}
          Icon={FileText}
        />
        <DropZone
          id="settings-file"
          title="Settings file"
          hint="The file you downloaded last week. Leave empty on the first run."
          accept=".json,application/json"
          file={app.settingsFileName ? { name: app.settingsFileName } : null}
          onFile={async (f) => setSettingsError(await app.loadSettingsFile(f))}
          onClear={() => undefined}
          Icon={FileText}
        />
        <DropZone
          id="continuity-file"
          title="Continuity report"
          hint="The Continuity report (xlsx) for the 4 weeks before."
          accept=".xlsx"
          file={app.continuity}
          onFile={app.setContinuity}
          onClear={() => app.setContinuity(null)}
          Icon={FileSpreadsheet}
        />
      </div>
      {settingsError && <Banner tone="bad" title="The settings file could not be used">{settingsError}</Banner>}

      {info && (
        <Card title="What is in the bookings file">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
            {[
              ["Visits", info.visits],
              ["Clients", info.clients],
              ["Carers allocated", info.carers],
              ["Double-ups", info.doubleUps],
              ["Unallocated", info.unallocated],
              ["Cancelled (ignored)", info.cancelled],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-muted">{k}</dt>
                <dd className="text-xl font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          {info.firstDate && <p className="mt-3 text-sm text-muted">Week starting {info.firstDate}.</p>}
          <div className="mt-3 space-y-2">
            {info.problems.length === 0 ? (
              <Banner tone="ok" title="No problems found in the file" />
            ) : (
              info.problems.map((p) => (
                <Banner key={p} tone="bad" title={p} />
              ))
            )}
          </div>
        </Card>
      )}

      <Card
        title="Sync from CareLineLive"
        actions={
          <Button variant="primary" onClick={runSync} disabled={syncing}>
            {syncing ? <RefreshCw aria-hidden className="h-4 w-4 animate-spin" /> : <CloudDownload aria-hidden className="h-4 w-4" />}
            {syncing ? "Syncing" : "Sync from CareLineLive"}
          </Button>
        }
      >
        <p className="text-sm text-muted">
          Reads carers, clients, addresses, teams, transport types and leave (read-only). Nothing is written to CareLineLive.
        </p>
        {syncError && (
          <div className="mt-3">
            <Banner tone="bad" title="The sync failed">{syncError}</Banner>
          </div>
        )}
        {app.sync && (
          <div className="mt-4 space-y-3">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {(
                [
                  ["Carers", app.sync.counts.carers],
                  ["Clients", app.sync.counts.clients],
                  ["Addresses", app.sync.counts.addresses],
                  ["Leave entries", app.sync.counts.leave],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-xl font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            {app.sync.missing.addresses.length > 0 && (
              <Banner tone="warn" title={`${app.sync.missing.addresses.length} client(s) have no address in CareLineLive`}>
                Travel cannot be estimated for: {app.sync.missing.addresses.join(", ")}.
              </Banner>
            )}
            {app.sync.missing.carers_not_in_settings.length > 0 && (
              <Banner tone="info" title={`${app.sync.missing.carers_not_in_settings.length} carer(s) were not in your settings file`}>
                They were added to Settings with no working hours. Fill them in before running.
              </Banner>
            )}
            {app.sync.missing.clients_not_in_settings.length > 0 && (
              <Banner tone="info" title={`${app.sync.missing.clients_not_in_settings.length} client(s) were not in your settings file`}>
                They were added to Settings with no rules.
              </Banner>
            )}
            {unmatched.length > 0 && (
              <Banner tone="warn" title={`${unmatched.length} carer name(s) in the bookings file could not be matched`}>
                <p>Choose who each one is. Matches are saved in the settings file.</p>
                <ul className="mt-2 space-y-2">
                  {unmatched.map((n) => (
                    <li key={n} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{n}</span>
                      <label className="sr-only" htmlFor={`match-${n}`}>
                        Match {n} to a carer
                      </label>
                      <select
                        id={`match-${n}`}
                        defaultValue=""
                        className={inputCls}
                        onChange={(e) => {
                          const carerId = e.target.value;
                          if (carerId) app.setSettings((s) => ({ ...s, carer_name_matches: [...s.carer_name_matches, { booking_name: n, carer_id: carerId }] }));
                        }}
                      >
                        <option value="">Choose a carer</option>
                        {app.settings.carers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.id})
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </Banner>
            )}
            {app.sync.missing.addresses.length === 0 && unmatched.length === 0 && app.sync.missing.carers_not_in_settings.length === 0 && (
              <Banner tone="ok" title="Everything matched" />
            )}
          </div>
        )}
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" onClick={() => app.setStep("settings")}>
          Continue to Settings
        </Button>
      </div>
    </div>
  );
}
