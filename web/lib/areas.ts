// Planning areas. The service plans teams in areas: Leeds, and Weymouth (which includes
// Dorchester). Old settings files and bookings may still say "Dorset", which means Weymouth.

import type { AgencySettings } from "./types";

export const DEFAULT_TEAM_REGIONS: Record<string, string[]> = {
  Leeds: ["Leeds"],
  Weymouth: ["Weymouth", "Dorchester"],
};

// Used wherever an area or team is named on screen.
export function areaLabel(name: string): string {
  const n = name === "Dorset" ? "Weymouth" : name;
  return n === "Weymouth" ? "Weymouth (incl. Dorchester)" : n;
}

// The area a team is planned in (a team and an area can share a name).
export function areaOf(team: string, regions?: AgencySettings["team_regions"]): string {
  if (team === "Dorset") return "Weymouth";
  const map = regions ?? DEFAULT_TEAM_REGIONS;
  for (const [area, teams] of Object.entries(map)) if (area === team || teams.includes(team)) return area;
  return team;
}

// Accepts the new shape (area -> teams) and the old one (team -> area).
export function normaliseRegions(raw: unknown): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      const area = k === "Dorset" ? "Weymouth" : k;
      out[area] = [...new Set([...(out[area] ?? []), ...v.map(String)])];
    } else if (typeof v === "string") {
      const area = v === "Dorset" ? "Weymouth" : v;
      out[area] = [...new Set([...(out[area] ?? []), k])];
    }
  }
  return Object.keys(out).length ? out : undefined;
}
