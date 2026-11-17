// Browser-side client for the engine API. Requests go to /api/engine/..., which is the
// mock or a proxy to the real service (see app/api/engine/[...path]/route.ts).

import type { RunState, SettingsFile, SyncResult } from "./types";
import { settingsToJson } from "./settings";

const BASE = "/api/engine";

// Error messages come from the API and never contain personal data by contract.
async function fail(res: Response): Promise<never> {
  let msg = `The request failed (${res.status}).`;
  try {
    const body = await res.json();
    if (typeof body?.error === "string") msg = body.error;
  } catch {
    /* keep the generic message */
  }
  throw new Error(msg);
}

export async function getHealth(): Promise<{ ok: boolean; mock: boolean; fake_api?: boolean }> {
  const res = await fetch(`${BASE}/health`, { cache: "no-store" });
  if (!res.ok) return fail(res);
  return res.json();
}

export async function fetchSample(name: "bookings.csv" | "settings.json"): Promise<File> {
  const res = await fetch(`${BASE}/sample/${name}`, { cache: "no-store" });
  if (!res.ok) return fail(res);
  const blob = await res.blob();
  return new File([blob], `sample-${name}`, { type: blob.type });
}

export async function syncFromCareLineLive(files: { bookings?: File; settings?: SettingsFile }): Promise<SyncResult> {
  const form = new FormData();
  if (files.bookings) form.set("bookings", files.bookings);
  if (files.settings) form.set("settings", new File([settingsToJson(files.settings)], "settings.json", { type: "application/json" }));
  const res = await fetch(`${BASE}/sync`, { method: "POST", body: form });
  if (!res.ok) return fail(res);
  return res.json();
}

export interface StartRunInput {
  bookings: File;
  settings: SettingsFile;
  continuity?: File;
  mode: "new" | "improve";
  changeCostPence: number;
  locks: Record<string, string>; // booking_id -> carer id
}

export async function startRun(input: StartRunInput): Promise<string> {
  const form = new FormData();
  form.set("bookings", input.bookings);
  form.set("settings", new File([settingsToJson(input.settings)], "settings.json", { type: "application/json" }));
  if (input.continuity) form.set("continuity", input.continuity);
  form.set("mode", input.mode);
  form.set("change_cost_pence", String(input.changeCostPence));
  form.set("locks", JSON.stringify(input.locks));
  const res = await fetch(`${BASE}/runs`, { method: "POST", body: form });
  if (!res.ok) return fail(res);
  return (await res.json()).run_id;
}

export async function getRun(id: string): Promise<RunState> {
  const res = await fetch(`${BASE}/runs/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) return fail(res);
  return res.json();
}

export function deleteRun(id: string): void {
  // keepalive lets this finish while the tab is closing.
  fetch(`${BASE}/runs/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
}

export function exportUrl(id: string, file: "allocation.csv" | "changes.csv"): string {
  return `${BASE}/runs/${encodeURIComponent(id)}/export/${file}`;
}
