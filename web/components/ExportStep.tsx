"use client";

import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { exportUrl } from "@/lib/api";
import { settingsToJson } from "@/lib/settings";
import { useApp } from "./AppProvider";
import { downloadText } from "./SettingsStep";
import { Banner, Card, PageTitle } from "./ui";

const linkCls =
  "inline-flex items-center justify-center gap-2 rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-strong";

export function ExportStep() {
  const { result, runId, settings, setStep } = useApp();
  if (!result || !runId) {
    return (
      <div className="max-w-3xl">
        <PageTitle title="Export" />
        <Banner tone="info" title="Nothing to export yet">Run the engine first.</Banner>
      </div>
    );
  }
  return (
    <div className="max-w-3xl space-y-5">
      <PageTitle
        title="Export"
        intro="Download what you need and make the changes in CareLineLive by hand. The engine never writes to CareLineLive."
      />
      {result.mode === "new" ? (
        <Card title="Full allocation">
          <p className="mb-3 text-sm text-muted">Every booking with its carer(s), start time and status, for both teams.</p>
          <a className={linkCls} href={exportUrl(runId, "allocation.csv")} download>
            <FileSpreadsheet aria-hidden className="h-4 w-4" />
            Download allocation CSV
          </a>
        </Card>
      ) : (
        <>
          <Card title="Changes list">
            <p className="mb-3 text-sm text-muted">
              {result.changes.length} change(s): booking ID, client reference, date, booked time, new time, from carer(s), to carer(s) and the reason. Tight gaps to
              check are included, marked as time_note.
            </p>
            <a className={linkCls} href={exportUrl(runId, "changes.csv")} download>
              <FileSpreadsheet aria-hidden className="h-4 w-4" />
              Download changes CSV
            </a>
          </Card>
          <Card title="Full allocation (for reference)">
            <a className={linkCls} href={exportUrl(runId, "allocation.csv")} download>
              <FileSpreadsheet aria-hidden className="h-4 w-4" />
              Download allocation CSV
            </a>
          </Card>
        </>
      )}
      <Card title="Settings file">
        <p className="mb-3 text-sm text-muted">Download it again so you have the latest, and keep it for next week.</p>
        <button
          type="button"
          className={linkCls}
          onClick={() => downloadText(settingsToJson(settings), "loidis-settings.json", "application/json")}
        >
          <Download aria-hidden className="h-4 w-4" />
          Download settings file
        </button>
      </Card>
      <Banner tone="warn" title="These files hold personal data">
        Store them like other staff and client files, and delete them from Downloads when you have finished. Results are removed from the server when you close this page.
      </Banner>
      <p className="flex items-center gap-2 text-sm text-muted">
        <FileText aria-hidden className="h-4 w-4" />
        A printable summary is planned for a later version.
        <button type="button" className="text-brand underline" onClick={() => setStep("review")}>
          Back to Review
        </button>
      </p>
    </div>
  );
}
