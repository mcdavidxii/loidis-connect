// The mock of the engine API (docs/ENGINE_API.md). Used when ENGINE_API_URL is not set.
// Everything here is made up. Runs live in memory only and are purged after 30 minutes.

import { parseCsv, toCsv } from "../csv";
import { toMins } from "../time";
import type { RunResult, RunState, SettingsFile, SyncResult } from "../types";
import { validateSettings } from "../settings";
import { getAgency, exampleSettings, isoDate } from "./agency";
import { runMock, sampleBookingRows } from "./engine";
import { allocationCsvRows, buildWorksheet, changesCsvRows, notesCsvRows } from "../worksheet";

interface StoredRun {
  created: number;
  result?: RunResult;
  error?: string;
}

const g = globalThis as unknown as { __mockRuns?: Map<string, StoredRun> };
const runs = (g.__mockRuns ??= new Map<string, StoredRun>());

const FAKE_DURATION_MS = 3000;
const MAX_AGE_MS = 30 * 60 * 1000;

function purge() {
  const now = Date.now();
  for (const [id, r] of runs) if (now - r.created > MAX_AGE_MS) runs.delete(id);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function download(text: string, filename: string, type: string): Response {
  return new Response("\uFEFF" + text, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function readSettings(form: FormData): Promise<SettingsFile | null> {
  const f = form.get("settings");
  if (!(f instanceof File) || f.size === 0) return null;
  try {
    return validateSettings(JSON.parse(await f.text())).settings ?? null;
  } catch {
    return null;
  }
}

const dmy = (iso: string) => iso.split("-").reverse().join("/");
const dur = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

// The made-up bookings in the real CareLineLive optimised format (27 columns).
function sampleBookingsCsv(): string {
  const head = [
    "BookingId", "ClientId", "Date", "Start", "Finish", "Duration", "ConfirmedDuration", "DurationVarianceSeconds", "BookingType",
    "ClientName", "ClientReferenceCode", "ExpectedCarers", "AllocatedCarers", "Carers", "Status", "CarerNotes", "IsCancelled",
    "CancellationReason", "CancellationCharged", "OriginalStart", "OriginalFinish", "OriginalDuration", "HasBeenInvoiced",
    "ServiceContract", "ServiceContractType", "Unplanned", "Team",
  ];
  const clientName = (id: string) => `Client ${id.slice(1)}`;
  const rows: (string | number)[][] = sampleBookingRows().map((r) => {
    const start = `${r.start}:00`;
    const finish = `${r.end}:00`;
    const d = dur(toMins(r.end) - toMins(r.start));
    return [
      r.bookingId, r.clientId, dmy(r.date), start, finish, d, "", "", r.bookingType, clientName(r.clientId), r.clientRef, r.expected,
      r.allocatedNames.length, r.allocatedNames.join(", "), "Scheduled", "", "False", "", "", start, finish, d, "False",
      "Made-up contract", "Private", "False", r.team,
    ];
  });
  // Two cancelled rows, to show the count on the Upload screen.
  const wk = getAgency().weekStart;
  [["B19001", "C01", 2, "15:00", "15:30", "Tea Visit", "Leeds"], ["B19002", "C09", 4, "12:00", "12:30", "Lunch Visit", "Dorset"]].forEach(
    ([id, cid, day, s0, e0, type, team]) => {
      const c = getAgency().clients.find((x) => x.id === cid)!;
      rows.push([
        id as string, cid as string, dmy(isoDate(wk, day as number)), `${s0}:00`, `${e0}:00`, "0:30", "", "", type as string, clientName(cid as string),
        c.ref, 1, 0, "", "Cancelled", "", "True", "Made-up reason", "False", `${s0}:00`, `${e0}:00`, "0:30", "False", "Made-up contract", "Private",
        "False", team as string,
      ]);
    },
  );
  return toCsv([head, ...rows]);
}

function progressMessage(p: number): string {
  if (p < 0.1) return "Reading the bookings and settings";
  if (p < 0.3) return "Building travel times";
  if (p < 0.95) return `Planning day ${Math.min(7, Math.floor(((p - 0.3) / 0.65) * 7) + 1)} of 7`;
  return "Checking the result";
}

export async function handleMock(req: Request, path: string[]): Promise<Response> {
  purge();
  const method = req.method;
  const [a, b, c, d] = path;

  if (a === "health" && method === "GET") return json({ ok: true, mock: true });

  if (a === "sample" && method === "GET") {
    if (b === "bookings.csv") {
      return download(sampleBookingsCsv(), "sample-bookings.csv", "text/csv");
    }
    if (b === "settings.json") {
      return download(JSON.stringify(exampleSettings(), null, 2), "sample-settings.json", "application/json");
    }
  }

  if (a === "sync" && method === "POST") {
    const form = await req.formData().catch(() => new FormData());
    const settings = await readSettings(form);
    const agency = getAgency();
    const apiCarers = agency.carers.map((x) => ({ id: x.id, name: x.name, teams: [x.team] }));
    const apiClients = agency.clients.map((x) => ({ id: x.id, ref: x.ref, team: x.team }));
    const matches = new Set((settings?.carer_name_matches ?? []).map((m) => m.booking_name.toLowerCase()));
    const known = new Set(apiCarers.map((x) => x.name.toLowerCase()));
    const names = new Set<string>();
    const bookings = form.get("bookings");
    if (bookings instanceof File && bookings.size > 0) {
      const rows = parseCsv(await bookings.text());
      const idx = rows[0]?.findIndex((h) => h.toLowerCase().replace(/[^a-z0-9]/g, "") === "carers") ?? -1;
      if (idx >= 0) {
        rows.slice(1).forEach((r) => (r[idx] ?? "").split(",").map((n) => n.trim()).filter(Boolean).forEach((n) => names.add(n)));
      }
    }
    const result: SyncResult = {
      counts: { carers: apiCarers.length, clients: apiClients.length, addresses: apiClients.length - 1, leave: 3 },
      carers: apiCarers,
      clients: apiClients,
      missing: {
        addresses: [apiClients[13].ref],
        carers_not_in_settings: apiCarers.filter((x) => !settings?.carers.some((s) => s.id === x.id)).map((x) => x.id),
        clients_not_in_settings: apiClients.filter((x) => !settings?.clients.some((s) => s.id === x.id)).map((x) => x.ref),
        unmatched_booking_carers: [...names].filter((n) => !known.has(n.toLowerCase()) && !matches.has(n.toLowerCase())),
      },
    };
    return json(result);
  }

  if (a === "runs" && !b && method === "POST") {
    const form = await req.formData().catch(() => null);
    if (!form) return json({ error: "Expected a multipart form." }, 400);
    const bookings = form.get("bookings");
    const mode = form.get("mode");
    if (!(bookings instanceof File) || bookings.size === 0) return json({ error: "The bookings CSV is required." }, 400);
    if (mode !== "new" && mode !== "improve") return json({ error: "mode must be 'new' or 'improve'." }, 400);
    const cost = Number(form.get("change_cost_pence") ?? 1000);
    let locks: Record<string, string> = {};
    try {
      const raw = form.get("locks");
      if (typeof raw === "string" && raw) locks = JSON.parse(raw);
    } catch {
      return json({ error: "locks must be JSON." }, 400);
    }
    const id = crypto.randomUUID();
    const stored: StoredRun = { created: Date.now() };
    try {
      stored.result = runMock({ mode, changeCostPence: Number.isFinite(cost) ? cost : 1000, settings: await readSettings(form), locks });
    } catch {
      stored.error = "Something went wrong while making suggestions.";
    }
    runs.set(id, stored);
    return json({ run_id: id }, 201);
  }

  if (a === "runs" && b) {
    const run = runs.get(b);
    if (!run) return json({ error: "Plan not found (it may have been deleted)." }, 404);

    if (!c && method === "DELETE") {
      runs.delete(b);
      return json({ deleted: true });
    }
    if (!c && method === "GET") {
      const elapsed = Date.now() - run.created;
      const progress = Math.min(1, elapsed / FAKE_DURATION_MS);
      let body: RunState;
      if (run.error) body = { status: "failed", progress, message: run.error };
      else if (progress >= 1) body = { status: "done", progress: 1, message: "Done", result: run.result };
      else if (elapsed < 300) body = { status: "queued", progress: 0, message: "Waiting to start" };
      else body = { status: "running", progress, message: progressMessage(progress) };
      return json(body);
    }
    if (c === "export" && method === "GET" && run.result) {
      const res = run.result;
      const w = buildWorksheet(res);
      if (d === "allocation.csv") return download(toCsv(allocationCsvRows(w)), "allocation.csv", "text/csv");
      if (d === "changes.csv") return download(toCsv(changesCsvRows(w)), "changes.csv", "text/csv");
      if (d === "notes.csv") return download(toCsv(notesCsvRows(w)), "notes.csv", "text/csv");
    }
    if (c === "export" && !run.result) return json({ error: "No result." }, 409);
  }

  return json({ error: "Not found." }, 404);
}
