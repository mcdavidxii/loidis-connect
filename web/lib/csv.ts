// Small CSV helpers (no dependencies).

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return (
    rows
      .map((r) =>
        r
          .map((v) => {
            const s = v == null ? "" : String(v);
            return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(","),
      )
      .join("\r\n") + "\r\n"
  );
}

export interface BookingsInfo {
  rows: number;
  visits: number;
  clients: number;
  carers: number;
  doubleUps: number;
  cancelled: number;
  unallocated: number;
  weeks: number;
  firstDate: string | null; // ISO date of the Monday
  problems: string[]; // never contain names or other personal data
}

// The real CareLineLive optimised bookings CSV (27 columns). Names are matched ignoring
// case, spaces and punctuation. Only these are needed; the rest are ignored.
const REQUIRED = [
  "BookingId",
  "ClientId",
  "Date",
  "Start",
  "Duration",
  "BookingType",
  "ClientReferenceCode",
  "ExpectedCarers",
  "Carers",
  "IsCancelled",
  "Team",
] as const;

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function parseDate(s: string): Date | null {
  const t = s.trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t) ?? null;
  const d = m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : /^\d{4}-\d{2}-\d{2}/.test(t) ? new Date(t.slice(0, 10) + "T00:00:00Z") : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

// Checks the bookings CSV in the browser, only to show counts and problems.
// Messages mention counts and column names, never cell values.
export function summariseBookings(text: string): BookingsInfo {
  const info: BookingsInfo = {
    rows: 0, visits: 0, clients: 0, carers: 0, doubleUps: 0, cancelled: 0, unallocated: 0, weeks: 0, firstDate: null, problems: [],
  };
  const rows = parseCsv(text);
  if (rows.length < 2) {
    info.problems.push("The file has no booking rows.");
    return info;
  }
  const header = rows[0].map(norm);
  const col: Record<string, number> = {};
  for (const name of REQUIRED) col[name] = header.indexOf(norm(name));
  const missingCols = REQUIRED.filter((n) => col[n] < 0);
  if (missingCols.length) {
    info.problems.push(`Required column(s) not found: ${missingCols.join(", ")}.`);
    return info;
  }
  const cell = (r: string[], name: string) => (r[col[name]] ?? "").trim();

  const clients = new Set<string>();
  const carers = new Set<string>();
  const mondays = new Set<string>();
  const seenIds = new Set<string>();
  let missingId = 0;
  let badDate = 0;
  let duplicateIds = 0;
  let shortRows = 0;
  for (const r of rows.slice(1)) {
    info.rows++;
    if (r.length < header.length) shortRows++;
    if (["true", "yes", "1"].includes(cell(r, "IsCancelled").toLowerCase())) {
      info.cancelled++;
      continue;
    }
    const id = cell(r, "BookingId");
    if (!id) missingId++;
    else if (seenIds.has(id)) duplicateIds++;
    else seenIds.add(id);
    info.visits++;
    clients.add(cell(r, "ClientId"));
    const d = parseDate(cell(r, "Date"));
    if (!d) badDate++;
    else {
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const iso = monday.toISOString().slice(0, 10);
      mondays.add(iso);
      if (!info.firstDate || iso < info.firstDate) info.firstDate = iso;
    }
    if (Number(cell(r, "ExpectedCarers")) >= 2) info.doubleUps++;
    const names = cell(r, "Carers").split(",").map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) info.unallocated++;
    names.forEach((n) => carers.add(n));
  }
  info.clients = clients.size;
  info.carers = carers.size;
  info.weeks = mondays.size;
  if (info.visits === 0) info.problems.push("Every row is cancelled; there is nothing to plan.");
  if (shortRows) info.problems.push(`${shortRows} row(s) have fewer columns than the header.`);
  if (missingId) info.problems.push(`${missingId} row(s) have no BookingId.`);
  if (duplicateIds) info.problems.push(`${duplicateIds} row(s) repeat a BookingId.`);
  if (badDate) info.problems.push(`${badDate} row(s) have a Date that is not dd/mm/yyyy.`);
  if (mondays.size > 1) {
    info.problems.push(`The file covers ${mondays.size} different weeks; upload one week (Monday to Sunday).`);
  }
  return info;
}
