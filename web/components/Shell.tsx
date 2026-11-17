"use client";

import { CalendarRange, Check, Download, FlaskConical, Play, Settings, Upload, UserRound, type LucideIcon } from "lucide-react";
import { useApp, type Step } from "./AppProvider";
import { UploadStep } from "./UploadStep";
import { SettingsStep } from "./SettingsStep";
import { RunStep } from "./RunStep";
import { ReviewStep } from "./ReviewStep";
import { ExportStep } from "./ExportStep";

const STEPS: { id: Step; label: string; Icon: LucideIcon }[] = [
  { id: "upload", label: "Upload", Icon: Upload },
  { id: "settings", label: "Settings", Icon: Settings },
  { id: "run", label: "Run", Icon: Play },
  { id: "review", label: "Review", Icon: CalendarRange },
  { id: "export", label: "Export", Icon: Download },
];

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
      <header className="flex items-center justify-between border-b border-line bg-surface px-5 py-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-md bg-brand text-sm font-bold text-white">
            LC
          </span>
          <div>
            <p className="text-sm font-semibold leading-tight">Loidis Connect</p>
            <p className="text-xs leading-tight text-muted">Rota engine test</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {app.mock && (
            <span className="inline-flex items-center gap-1.5 rounded bg-warn-soft px-2 py-1 text-xs font-medium text-warn">
              <FlaskConical aria-hidden className="h-3.5 w-3.5" />
              Demo mode: made-up data
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1">
            <UserRound aria-hidden className="h-4 w-4" />
            Coordinator
          </span>
        </div>
      </header>

      <div className="flex flex-1">
        <nav aria-label="Steps" className="w-52 shrink-0 border-r border-line bg-surface p-3">
          <ol className="space-y-1">
            {STEPS.map(({ id, label, Icon }, i) => {
              const current = app.step === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    disabled={blocked(id)}
                    aria-current={current ? "step" : undefined}
                    onClick={() => app.setStep(id)}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-45 ${
                      current ? "bg-brand-soft font-semibold text-brand-strong" : "hover:bg-canvas"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs ${
                        done[id] && !current ? "border-ok bg-ok text-white" : current ? "border-brand bg-brand text-white" : "border-line text-muted"
                      }`}
                    >
                      {done[id] && !current ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <Icon aria-hidden className="h-4 w-4 shrink-0" />
                    <span>
                      {label}
                      {done[id] && <span className="sr-only"> (done)</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="mt-6 px-3 text-xs text-muted">Nothing is stored on the server. Results are deleted when you close this page.</p>
        </nav>

        <main className="min-w-0 flex-1 p-6">
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
