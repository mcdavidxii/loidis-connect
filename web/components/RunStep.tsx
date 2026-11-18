"use client";

import { addDays, niceDate } from "@/lib/time";
import { nextMondays } from "@/lib/schedules";
import { useApp } from "./AppProvider";
import { IconLock, IconPlay, IconRerun } from "./icons";
import { Button, Notice, PageHeader, RadioRow, Section, inputCls } from "./ui";

const COSTS: { pence: number; label: string; text: string }[] = [
  { pence: 300, label: "More changes", text: "Biggest savings, longest list" },
  { pence: 500, label: "Fewer changes", text: "Most of the savings, a shorter list" },
  { pence: 1000, label: "Balanced (recommended)", text: "Changes that clearly help, without a long list" },
  { pence: 2000, label: "Only clear wins", text: "Fewest edits in CareLineLive" },
];

const SEARCH = [
  { s: 10, label: "Quick (about 1–2 min)", text: "Recommended" },
  { s: 30, label: "Thorough (about 5 min)", text: "Slower, may find slightly better suggestions" },
];

export function RunStep() {
  const app = useApp();
  const { mode, setMode, settings, setSettings, running, runState, runError, bookings, locks, source, setSource, weekStart, setWeekStart, draftFile } = app;
  const fromSchedules = source === "schedules";
  const sch = settings.client_schedules;
  const scheduleCounts = {
    confirmed: settings.clients.filter((c) => sch[c.id]?.confirmed).length,
    unconfirmed: settings.clients.filter((c) => sch[c.id] && !sch[c.id].confirmed).length,
    missing: settings.clients.filter((c) => !sch[c.id]).length,
  };
  const mondays = [...new Set([...nextMondays(8), weekStart])].sort();
  const canRun = fromSchedules ? settings.clients.length > 0 && Boolean(weekStart) : Boolean(bookings);
  const lockCount = Object.keys(locks).length;
  const pct = Math.round((runState?.progress ?? 0) * 100);

  return (
    <div className="w-full">
      <PageHeader
        title="Plan"
        subtitle="These are suggestions. You make every change in CareLineLive yourself."
        actions={
          <>
            {app.result && !running && <Button onClick={() => app.setStep("review")}>Back to suggestions</Button>}
            <Button variant="primary" onClick={() => void app.start()} disabled={!canRun || running}>
              {app.result ? <IconRerun aria-hidden className="h-4 w-4" /> : <IconPlay aria-hidden className="h-4 w-4" />}
              {running ? "Planning" : app.result ? "Make suggestions again" : "Make suggestions"}
            </Button>
          </>
        }
      />

      {!fromSchedules && !bookings && (
        <div className="mb-6">
          <Notice tone="warn" title="No bookings file yet">
            Upload the week&apos;s bookings CSV first.{" "}
            <button type="button" className="text-brand-strong underline" onClick={() => app.setStep("upload")}>
              Go to Upload
            </button>
          </Notice>
        </div>
      )}

      <Section title="What do you want to plan?">
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">What to plan</legend>
          <RadioRow name="source" checked={!fromSchedules} onChange={() => setSource("bookings")} title="This week's bookings" text="Upload them on the Upload screen" />
          <RadioRow name="source" checked={fromSchedules} onChange={() => setSource("schedules")} title="A future week from client schedules (draft)" text="Plan a week CareLineLive has not generated yet" />
        </fieldset>
        {fromSchedules && (
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-semibold">Week starting (Monday)</span>
              <select className={`${inputCls} w-full max-w-xs`} value={weekStart} onChange={(e) => setWeekStart(e.target.value)}>
                {mondays.map((m) => (
                  <option key={m} value={m}>
                    {niceDate(m)} to {niceDate(addDays(m, 6))}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-muted">This is a draft until CareLineLive generates the week. Plan the real bookings when they exist, and check them against this draft.</p>
            <dl className="flex flex-wrap gap-x-8 gap-y-2">
              <div>
                <dt className="text-xs text-muted">Clients with confirmed schedules</dt>
                <dd className="text-base font-semibold">{scheduleCounts.confirmed}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Not confirmed yet</dt>
                <dd className="text-base font-semibold">{scheduleCounts.unconfirmed}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">No schedule (left out)</dt>
                <dd className="text-base font-semibold">{scheduleCounts.missing}</dd>
              </div>
            </dl>
            {(scheduleCounts.unconfirmed > 0 || scheduleCounts.missing > 0) && (
              <Notice tone="warn" title="Some schedules need attention">
                <button type="button" className="text-brand-strong underline" onClick={() => app.setStep("schedules")}>
                  Go to Schedules
                </button>{" "}
                to confirm or add them.
              </Notice>
            )}
          </div>
        )}
      </Section>

      <Section title="What do you want?">
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">What to plan</legend>
          <RadioRow name="mode" checked={mode === "new"} onChange={() => setMode("new")} title="Plan the whole week" text={fromSchedules ? "A draft is always the whole week" : draftFile ? "Not available while a draft is uploaded" : "Plan every booking from scratch"} disabled={fromSchedules || Boolean(draftFile)} />
          <RadioRow name="mode" checked={mode === "improve" && !fromSchedules} onChange={() => setMode("improve")} title="Improve my rota" text={draftFile ? "Chosen because you uploaded a draft to check against" : "Suggest a short list of changes to your rota"} disabled={fromSchedules} />
        </fieldset>
      </Section>

      {mode === "improve" && !fromSchedules && (
        <Section
          title="How many changes?"
          info="A change is only suggested if it saves enough to be worth making by hand. The options mean about £3, £5, £10 or £20 saved per change; a carer's paid time costs about 21p a minute, so £10 is roughly 48 minutes. A lower amount gives a longer list."
        >
          <fieldset className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <legend className="sr-only">How many changes</legend>
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

      <Section title="Planning time">
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Planning time</legend>
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
          {lockCount} booking(s) kept with a carer in the next plan.
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
            aria-label="Planning progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="h-2 overflow-hidden rounded-md bg-hover"
          >
            <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {runError && <Notice tone="bad" title="Planning did not finish">{runError}</Notice>}
    </div>
  );
}
