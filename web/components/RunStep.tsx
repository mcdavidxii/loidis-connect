"use client";

import { useApp } from "./AppProvider";
import { IconLock, IconPlay, IconRerun } from "./icons";
import { Button, Notice, PageHeader, RadioRow, Section } from "./ui";

const COSTS: { pence: number; label: string; text: string }[] = [
  { pence: 300, label: "£3", text: "Many changes, biggest savings" },
  { pence: 500, label: "£5", text: "A good number of changes, most of the savings" },
  { pence: 1000, label: "£10 (default)", text: "Balanced: changes that clearly help, without a long list" },
  { pence: 2000, label: "£20", text: "Only changes that clearly pay off, fewest edits in CareLineLive" },
];

const SEARCH = [
  { s: 10, label: "Quick (10 s per day)", text: "Default" },
  { s: 30, label: "Thorough (30 s per day, a few minutes)", text: "Slower, may be slightly better" },
];

export function RunStep() {
  const app = useApp();
  const { mode, setMode, settings, setSettings, running, runState, runError, bookings, locks } = app;
  const lockCount = Object.keys(locks).length;
  const pct = Math.round((runState?.progress ?? 0) * 100);

  return (
    <div className="w-full">
      <PageHeader
        title="Run"
        subtitle="The engine only suggests. You make every change in CareLineLive yourself."
        actions={
          <>
            {app.result && !running && <Button onClick={() => app.setStep("review")}>Back to review</Button>}
            <Button variant="primary" onClick={() => void app.start()} disabled={!bookings || running}>
              {app.result ? <IconRerun aria-hidden className="h-4 w-4" /> : <IconPlay aria-hidden className="h-4 w-4" />}
              {running ? "Running" : app.result ? "Run again" : "Run"}
            </Button>
          </>
        }
      />

      {!bookings && (
        <div className="mb-6">
          <Notice tone="warn" title="No bookings file yet">
            Upload the week&apos;s bookings CSV first.{" "}
            <button type="button" className="text-brand-strong underline" onClick={() => app.setStep("upload")}>
              Go to Upload
            </button>
          </Notice>
        </div>
      )}

      <Section title="What do you want?">
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Mode</legend>
          <RadioRow name="mode" checked={mode === "new"} onChange={() => setMode("new")} title="New rota" text="Allocate every booking from scratch" />
          <RadioRow name="mode" checked={mode === "improve"} onChange={() => setMode("improve")} title="Improve my rota" text="Suggest a short list of changes to the current allocation" />
        </fieldset>
      </Section>

      {mode === "improve" && (
        <Section
          title="Change cost"
          info="How much a change must save before we suggest it. A carer's paid time costs about 21p a minute, so £10 is roughly 48 minutes of travel. A lower cost gives a longer list of changes."
        >
          <fieldset className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <legend className="sr-only">Change cost</legend>
            {COSTS.map((c) => (
              <RadioRow
                key={c.pence}
                name="change-cost"
                checked={settings.agency.change_cost_pence === c.pence}
                onChange={() => setSettings((s) => ({ ...s, agency: { ...s.agency, change_cost_pence: c.pence } }))}
                title={c.label}
                text={c.text}
              />
            ))}
          </fieldset>
        </Section>
      )}

      <Section title="Search time">
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Search time</legend>
          {SEARCH.map((o) => (
            <RadioRow
              key={o.s}
              name="search-time"
              checked={settings.agency.search_seconds_per_day === o.s}
              onChange={() => setSettings((st) => ({ ...st, agency: { ...st.agency, search_seconds_per_day: o.s } }))}
              title={o.label}
              text={o.text}
            />
          ))}
        </fieldset>
      </Section>

      {lockCount > 0 && (
        <p className="mb-6 flex items-center gap-1.5 text-sm text-muted">
          <IconLock aria-hidden className="h-4 w-4" />
          {lockCount} booking(s) locked to a carer for this run.
        </p>
      )}

      {runState && (running || runError) && (
        <div className="mb-6">
          <div className="mb-1 flex justify-between text-sm">
            <span aria-live="polite">{runState.message}</span>
            <span>{pct}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Run progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="h-2 overflow-hidden rounded-md bg-hover"
          >
            <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {runError && <Notice tone="bad" title="The run did not finish">{runError}</Notice>}
    </div>
  );
}
