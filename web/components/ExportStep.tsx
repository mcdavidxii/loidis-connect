"use client";

import { exportUrl } from "@/lib/api";
import { settingsToJson } from "@/lib/settings";
import { niceDate } from "@/lib/time";
import { useApp } from "./AppProvider";
import { IconDownload, IconPrint } from "./icons";
import { downloadText } from "./SettingsStep";
import { Button, Notice, PageHeader, Section, tableCls, tdCls, thCls } from "./ui";
import { Worksheet } from "./Worksheet";

const linkCls =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-hover";

export function ExportStep() {
  const { result, runId, settings, setStep } = useApp();
  if (!result || !runId) {
    return (
      <div className="w-full">
        <PageHeader title="Export" />
        <Notice title="Nothing to export yet">Make suggestions first.</Notice>
      </div>
    );
  }
  const weekStart = Object.values(result.teams)[0]?.week_start ?? "";
  const dl = (file: "changes.csv" | "allocation.csv" | "notes.csv") => (
    <a className={linkCls} href={exportUrl(runId, file)} download>
      <IconDownload aria-hidden className="h-4 w-4 text-muted" />
      Download
    </a>
  );
  const rows: { name: string; what: string; action: React.ReactNode }[] = [];
  if (result.mode === "improve") {
    rows.push({ name: "changes.csv", what: `${result.changes.length} suggested change(s), by day and carer, with the reason for each`, action: dl("changes.csv") });
    if (result.time_notes.length > 0) {
      rows.push({ name: "notes.csv", what: `${result.time_notes.length} small time change(s) and short gap(s): no edit needed, or check travel`, action: dl("notes.csv") });
    }
  }
  rows.push({ name: "allocation.csv", what: "Every booking by day and carer, unfilled ones first", action: dl("allocation.csv") });
  rows.push({
    name: "loidis-settings.json",
    what: "The settings file; keep the latest copy for next week",
    action: (
      <Button onClick={() => downloadText(settingsToJson(settings), "loidis-settings.json", "application/json")}>
        <IconDownload aria-hidden className="h-4 w-4 text-muted" />
        Download
      </Button>
    ),
  });

  return (
    <div className="w-full">
      <div className="print:hidden">
        <PageHeader
          title="Export"
          subtitle="Work through the worksheet day by day and apply each line in CareLineLive by hand. Nothing is written to CareLineLive for you."
          actions={
            <>
              <Button onClick={() => setStep("review")}>Back to suggestions</Button>
              <Button variant="primary" onClick={() => window.print()}>
                <IconPrint aria-hidden className="h-4 w-4" />
                Print worksheet
              </Button>
            </>
          }
        />
      </div>
      <p className="mb-3 hidden text-sm print:block">
        Loidis Connect worksheet, week of {weekStart ? niceDate(weekStart) : ""} ({result.draft ? "Draft from client schedules" : result.mode === "new" ? "Whole week planned" : "Improve my rota"})
      </p>

      <Section title={result.mode === "new" ? "Whole-week worksheet" : "Changes worksheet"} className="print:mb-0">
        <Worksheet result={result} />
      </Section>

      <div className="print:hidden">
        <Section title="Files">
          <table className={tableCls}>
            <caption className="sr-only">Files to download</caption>
            <thead>
              <tr>
                <th scope="col" className={thCls}>File</th>
                <th scope="col" className={thCls}>Contents</th>
                <th scope="col" className={`${thCls} text-right`}>
                  <span className="sr-only">Download</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <th scope="row" className={`${tdCls} font-semibold`}>{r.name}</th>
                  <td className={`${tdCls} text-muted`}>{r.what}</td>
                  <td className={`${tdCls} text-right`}>{r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <p className="text-xs text-muted">These files and the printout hold personal data. Store them like other staff and client files. Ticks on screen are kept only in this browser session.</p>
      </div>
    </div>
  );
}
