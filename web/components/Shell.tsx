"use client";

import { useApp, type Step } from "./AppProvider";
import { IconCarer, IconCheck, type IconType } from "./icons";
import { UploadStep } from "./UploadStep";
import { SettingsStep } from "./SettingsStep";
import { RunStep } from "./RunStep";
import { ReviewStep } from "./ReviewStep";
import { ExportStep } from "./ExportStep";

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "settings", label: "Settings" },
  { id: "run", label: "Run" },
  { id: "review", label: "Review" },
  { id: "export", label: "Export" },
];

export type { IconType };

export function Shell() {
  const app = useApp();
  const done: Record<Step, boolean> = {
    upload: Boolean(app.bookings) && (app.bookingsInfo?.problems.length ?? 0) === 0,
    settings: app.settings.carers.length > 0,
    run: Boolean(app.result),
    review: Boolean(app.result),
    export: false,
  };
  const blocked = (id: Step) => (id === "review" || id === "export") && !app.result;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-12 items-center justify-between border-b border-line bg-surface px-4">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">Loidis Connect</span>
          <span className="text-xs text-muted">Rota engine test</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {app.mock && <span className="rounded-md border border-line px-2 py-0.5 text-xs text-muted">Demo data</span>}
          <span className="flex items-center gap-1.5 text-muted">
            <IconCarer aria-hidden className="h-5 w-5" />
            Coordinator
          </span>
        </div>
      </header>

      <div className="flex flex-1">
        <nav aria-label="Steps" className="flex w-44 shrink-0 flex-col justify-between border-r border-line bg-surface p-2">
          <ol className="space-y-0.5">
            {STEPS.map(({ id, label }, i) => {
              const current = app.step === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    disabled={blocked(id)}
                    aria-current={current ? "step" : undefined}
                    onClick={() => app.setStep(id)}
                    className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                      current ? "bg-brand-soft font-semibold text-brand-strong" : "text-ink hover:bg-hover"
                    }`}
                  >
                    <span aria-hidden className="grid h-4 w-4 place-items-center text-xs text-muted">
                      {done[id] && !current ? <IconCheck className="h-4 w-4 text-ok" /> : i + 1}
                    </span>
                    <span>
                      {label}
                      {done[id] && <span className="sr-only"> (done)</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="px-2 pb-1 text-xs text-muted">Nothing is stored on the server. Results are deleted when you close this page.</p>
        </nav>

        <main className="min-w-0 flex-1 px-6 py-5">
          {app.step === "upload" && <UploadStep />}
          {app.step === "settings" && <SettingsStep />}
          {app.step === "run" && <RunStep />}
          {app.step === "review" && <ReviewStep />}
          {app.step === "export" && <ExportStep />}
        </main>
      </div>
    </div>
  );
}
