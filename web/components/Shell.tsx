"use client";

import { useApp, type Step } from "./AppProvider";
import { IconCarer, IconCheck, IconDownload, IconPlay, IconReview, IconSearch, IconSettings, IconUpload, type IconType } from "./icons";
import { UploadStep } from "./UploadStep";
import { SettingsStep } from "./SettingsStep";
import { RunStep } from "./RunStep";
import { ReviewStep } from "./ReviewStep";
import { ExportStep } from "./ExportStep";
import { inputCls } from "./ui";

const STEPS: { id: Step; label: string; Icon: IconType }[] = [
  { id: "upload", label: "Upload", Icon: IconUpload },
  { id: "settings", label: "Settings", Icon: IconSettings },
  { id: "run", label: "Run", Icon: IconPlay },
  { id: "review", label: "Review", Icon: IconReview },
  { id: "export", label: "Export", Icon: IconDownload },
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
    <div className="flex min-h-screen gap-4 p-4 print:block print:p-0">
      <nav aria-label="Steps" className="panel sticky top-4 flex h-[calc(100vh-2rem)] w-52 shrink-0 flex-col justify-between p-3 print:hidden">
        <div>
          <div className="mb-5 px-2 pt-1">
            <p className="font-semibold">Loidis Connect</p>
            <p className="text-xs text-muted">Rota engine test</p>
          </div>
          <ol className="space-y-1">
            {STEPS.map(({ id, label, Icon }) => {
              const current = app.step === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    disabled={blocked(id)}
                    aria-current={current ? "step" : undefined}
                    onClick={() => app.setStep(id)}
                    className={`flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                      current ? "bg-brand-soft font-semibold text-brand" : "text-ink hover:bg-hover"
                    }`}
                  >
                    <Icon aria-hidden className={`h-5 w-5 ${current ? "" : "text-muted"}`} />
                    <span className="flex-1">
                      {label}
                      {done[id] && <span className="sr-only"> (done)</span>}
                    </span>
                    {done[id] && !current && <IconCheck aria-hidden className="h-4 w-4 text-ok" />}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <div>
          <p className="mb-3 px-2 text-xs text-muted">Nothing is stored on the server. Results are deleted when you close this page.</p>
          <div className="flex items-center gap-2.5 rounded-xl bg-hover px-3 py-2">
            <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-brand">
              <IconCarer className="h-4 w-4" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold">Coordinator</span>
              <span className="block text-xs text-muted">Rota planning</span>
            </span>
          </div>
        </div>
      </nav>

      <div className="min-w-0 flex-1">
        <div className="mx-auto mb-4 flex max-w-[1280px] items-center justify-between gap-3 print:hidden">
          <div className="relative w-full max-w-md">
            <IconSearch aria-hidden className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <input
              type="search"
              aria-label="Search clients and carers"
              placeholder="Search clients and carers"
              className={`${inputCls} h-10 w-full rounded-xl pl-9 shadow-sm`}
              value={app.query}
              onChange={(e) => app.setQuery(e.target.value)}
            />
          </div>
          {app.mock && <span className="rounded-full bg-surface px-3 py-1 text-xs text-muted shadow-sm">Demo data</span>}
        </div>
        <main className="mx-auto min-w-0 max-w-[1280px] print:max-w-none print:p-0">
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
