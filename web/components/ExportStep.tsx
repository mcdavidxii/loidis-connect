"use client";

import { exportUrl } from "@/lib/api";
import { settingsToJson } from "@/lib/settings";
import { useApp } from "./AppProvider";
import { IconDownload } from "./icons";
import { downloadText } from "./SettingsStep";
import { Button, Notice, PageHeader, Section, tableCls, tdCls, thCls } from "./ui";

const linkCls =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-hover";

export function ExportStep() {
  const { result, runId, settings, setStep } = useApp();
  if (!result || !runId) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Export" />
        <Notice title="Nothing to export yet">Run the engine first.</Notice>
      </div>
    );
  }
  const rows: { name: string; what: string; action: React.ReactNode }[] = [];
  if (result.mode === "improve") {
    rows.push({
      name: "changes.csv",
      what: `${result.changes.length} change(s) with the reason for each, plus tight gaps to check`,
      action: (
        <a className={linkCls} href={exportUrl(runId, "changes.csv")} download>
          <IconDownload aria-hidden className="h-4 w-4 text-muted" />
          Download
        </a>
      ),
    });
  }
  rows.push({
    name: "allocation.csv",
    what: "Every booking with its carer(s), start time and status, for all teams",
    action: (
      <a className={linkCls} href={exportUrl(runId, "allocation.csv")} download>
        <IconDownload aria-hidden className="h-4 w-4 text-muted" />
        Download
      </a>
    ),
  });
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
    <div className="max-w-3xl">
      <PageHeader
        title="Export"
        subtitle="Apply the changes in CareLineLive by hand. The engine never writes to CareLineLive."
        actions={<Button onClick={() => setStep("review")}>Back to review</Button>}
      />
      <Section>
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
      <p className="text-xs text-muted">These files hold personal data. Store them like other staff and client files and delete them from Downloads when finished.</p>
    </div>
  );
}
