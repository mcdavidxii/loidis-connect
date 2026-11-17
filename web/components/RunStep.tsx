"use client";

import { ListChecks, Lock, Play, RotateCcw, Sparkles } from "lucide-react";
import { useApp } from "./AppProvider";
import { Banner, Button, Card, PageTitle } from "./ui";

const COSTS: { pence: number; label: string; text: string }[] = [
  { pence: 300, label: "£3", text: "Many changes, biggest savings." },
  { pence: 500, label: "£5", text: "A good number of changes; most of the savings." },
  { pence: 1000, label: "£10 (default)", text: "Balanced: changes that clearly help, without a long list." },
  { pence: 2000, label: "£20", text: "Only changes that clearly pay off, fewest edits in CareLineLive." },
];

export function RunStep() {
  const app = useApp();
  const { mode, setMode, settings, setSettings, running, runState, runError, bookings, locks } = app;
  const lockCount = Object.keys(locks).length;
  const pct = Math.round((runState?.progress ?? 0) * 100);

  return (
    <div className="max-w-4xl space-y-5">
      <PageTitle title="Run" intro="Choose what you want the engine to do. It only suggests: you check every change and make it in CareLineLive yourself." />

      {!bookings && (
        <Banner tone="warn" title="No bookings file yet">
          Upload the week&apos;s bookings CSV on the Upload screen first.
          <div className="mt-2">
            <Button onClick={() => app.setStep("upload")}>Go to Upload</Button>
          </div>
        </Banner>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">What do you want?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              { id: "new", title: "New rota", text: "The engine allocates every booking from scratch. You get the full allocation per carer per day.", Icon: Sparkles },
              { id: "improve", title: "Improve my rota", text: "Starts from your current allocation and suggests a short list of changes, each with a reason.", Icon: ListChecks },
            ] as const
          ).map(({ id, title, text, Icon }) => (
            <label
              key={id}
              className={`flex cursor-pointer gap-3 rounded-lg border-2 p-4 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-700 ${
                mode === id ? "border-brand bg-brand-soft" : "border-line bg-surface"
              }`}
            >
              <input type="radio" name="mode" className="sr-only" checked={mode === id} onChange={() => setMode(id)} />
              <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
              <span>
                <span className="block font-semibold">
                  {title} {mode === id && <span className="text-sm font-normal text-brand-strong">(selected)</span>}
                </span>
                <span className="mt-0.5 block text-sm text-muted">{text}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "improve" && (
        <Card title="Change cost">
          <p className="mb-3 max-w-2xl text-sm text-muted">
            The change cost is how much a change must save before we suggest it. A carer&apos;s paid time costs about 21p a minute, so £10 is
            roughly 48 minutes of travel. A lower cost gives a longer list of changes; a higher cost gives a shorter, safer list.
          </p>
          <fieldset>
            <legend className="sr-only">Change cost</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {COSTS.map((c) => {
                const on = settings.agency.change_cost_pence === c.pence;
                return (
                  <label
                    key={c.pence}
                    className={`flex cursor-pointer gap-3 rounded-md border p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-700 ${
                      on ? "border-brand bg-brand-soft" : "border-line"
                    }`}
                  >
                    <input
                      type="radio"
                      name="change-cost"
                      checked={on}
                      onChange={() => setSettings((s) => ({ ...s, agency: { ...s.agency, change_cost_pence: c.pence } }))}
                    />
                    <span>
                      <span className="block text-sm font-semibold">{c.label}</span>
                      <span className="block text-sm text-muted">{c.text}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </Card>
      )}

      <Card title="Search time">
        <fieldset>
          <legend className="sr-only">Search time</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { s: 10, label: "Quick (10 s per day)", text: "Default. A result in about a minute or two." },
              { s: 30, label: "Thorough (30 s per day, a few minutes)", text: "Slower, may be slightly better." },
            ].map((o) => {
              const on = settings.agency.search_seconds_per_day === o.s;
              return (
                <label
                  key={o.s}
                  className={`flex cursor-pointer gap-3 rounded-md border p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-700 ${
                    on ? "border-brand bg-brand-soft" : "border-line"
                  }`}
                >
                  <input
                    type="radio"
                    name="search-time"
                    checked={on}
                    onChange={() => setSettings((st) => ({ ...st, agency: { ...st.agency, search_seconds_per_day: o.s } }))}
                  />
                  <span>
                    <span className="block text-sm font-semibold">{o.label}</span>
                    <span className="block text-sm text-muted">{o.text}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </Card>

      {lockCount > 0 && (
        <Banner tone="info" title={`${lockCount} booking(s) locked to a carer`}>
          <span className="inline-flex items-center gap-1">
            <Lock aria-hidden className="h-4 w-4" />
            Locked bookings keep their carer in this run.
          </span>
        </Banner>
      )}

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={() => void app.start()} disabled={!bookings || running}>
          {app.result ? <RotateCcw aria-hidden className="h-4 w-4" /> : <Play aria-hidden className="h-4 w-4" />}
          {running ? "Running" : app.result ? "Run again" : "Run"}
        </Button>
        {app.result && !running && (
          <Button variant="ghost" onClick={() => app.setStep("review")}>
            Back to the review
          </Button>
        )}
      </div>

      {runState && (running || runError) && (
        <Card>
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
            className="h-3 overflow-hidden rounded-full bg-canvas"
          >
            <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">A real run takes a few minutes. You can stay on this page.</p>
        </Card>
      )}
      {runError && <Banner tone="bad" title="The run did not finish">{runError}</Banner>}
    </div>
  );
}
