import type { AgencySettings, RunWarning, SettingsCarer, SettingsFile, SyncResult } from "./types";
import { DAYS } from "./types";

export const DEFAULT_AGENCY: AgencySettings = {
  move_window_minutes: 30,
  move_cost_pence_per_min: 15,
  continuity_weight_pence: 1000,
  hours_balance: "equal_share_within_team",
  search_seconds_per_day: 10,
  change_cost_pence: 1000,
  arrival_tolerance_minutes: 15,
  pay_pence_per_hour: null,
  mileage_pence_per_mile: null,
  travel_time_paid: null,
};

export function emptySettings(): SettingsFile {
  return {
    version: 1,
    saved_at: null,
    agency: { ...DEFAULT_AGENCY },
    carers: [],
    clients: [],
    carer_name_matches: [],
  };
}

export function blankCarer(id: string, name: string, teams: string[]): SettingsCarer {
  return {
    id,
    name,
    teams,
    working_hours: {},
    available_any_time: true,
    weekly_max_hours: null,
    skills: [],
    dbs_expiry: null,
    training_expiry: null,
    active: true,
  };
}

export function hasAnyHours(c: SettingsCarer): boolean {
  return DAYS.some((d) => (c.working_hours[d]?.length ?? 0) > 0);
}

// Available any time: the flag is on, or there are no hour blocks at all.
// Explicit hour blocks always win; with none, the carer is any time unless the flag is false.
export function isAnyTime(c: SettingsCarer): boolean {
  return !hasAnyHours(c) && c.available_any_time !== false;
}

// Warnings for rules that cannot be checked because an input is missing.
// `today` is passed in so the same function runs in the browser and in the mock.
export function settingsWarnings(s: SettingsFile, today: string): RunWarning[] {
  const out: RunWarning[] = [];
  const active = s.carers.filter((c) => c.active);
  const noHours = active.filter((c) => !hasAnyHours(c) && c.available_any_time === false);
  if (noHours.length) {
    out.push({
      code: "no_working_hours",
      message: `${noHours.length} active carer(s) are marked not available any time but have no working hours, so they will not be planned: ${noHours.map((c) => c.id).join(", ")}.`,
    });
  }
  const noDbs = active.filter((c) => !c.dbs_expiry);
  if (noDbs.length) {
    out.push({
      code: "no_dbs_date",
      message: `DBS expiry is missing for ${noDbs.length} carer(s), so the DBS rule is not checked for them: ${noDbs.map((c) => c.id).join(", ")}.`,
    });
  }
  const noTraining = active.filter((c) => !c.training_expiry);
  if (noTraining.length) {
    out.push({
      code: "no_training_date",
      message: `Training expiry is missing for ${noTraining.length} carer(s), so the training rule is not checked for them: ${noTraining.map((c) => c.id).join(", ")}.`,
    });
  }
  const expired = active.filter((c) => (c.dbs_expiry && c.dbs_expiry < today) || (c.training_expiry && c.training_expiry < today));
  if (expired.length) {
    out.push({
      code: "expired",
      message: `DBS or training has expired for ${expired.length} carer(s); they will not be planned: ${expired.map((c) => c.id).join(", ")}.`,
    });
  }
  const noMax = active.filter((c) => c.weekly_max_hours == null);
  if (noMax.length) {
    out.push({
      code: "no_weekly_max",
      message: `Weekly maximum hours is missing for ${noMax.length} carer(s), so it is not checked for them: ${noMax.map((c) => c.id).join(", ")}.`,
    });
  }
  const a = s.agency;
  if (a.pay_pence_per_hour == null || a.mileage_pence_per_mile == null || a.travel_time_paid == null) {
    out.push({
      code: "agency_defaults",
      message: "Pay rate, mileage rate or travel-time-paid are not set; engine defaults are used to cost travel.",
    });
  }
  return out;
}

export function validateSettings(raw: unknown): { settings?: SettingsFile; error?: string } {
  if (!raw || typeof raw !== "object") return { error: "Not a settings file." };
  const o = raw as Partial<SettingsFile>;
  if (o.version !== 1) return { error: "Unsupported settings file version (expected version 1)." };
  if (!Array.isArray(o.carers) || !Array.isArray(o.clients)) return { error: "The file is missing the carers or clients list." };
  return {
    settings: {
      version: 1,
      saved_at: o.saved_at ?? null,
      agency: { ...DEFAULT_AGENCY, ...(o.agency ?? {}) },
      carers: o.carers.map((c) => {
        const merged = { ...blankCarer(c.id, c.name, c.teams ?? []), ...c };
        return { ...merged, available_any_time: c.available_any_time ?? true };
      }),
      clients: o.clients.map((c) => ({
        ...c,
        gender_preference: c.gender_preference ?? null,
        do_not_send: c.do_not_send ?? [],
        safeguarding_bar: c.safeguarding_bar ?? [],
        required_skills: c.required_skills ?? [],
        time_critical_booking_types: c.time_critical_booking_types ?? [],
      })),
      carer_name_matches: o.carer_name_matches ?? [],
    },
  };
}

// Adds carers and clients that the sync found and the settings file does not have yet.
export function mergeSync(s: SettingsFile, sync: SyncResult): SettingsFile {
  const carerIds = new Set(s.carers.map((c) => c.id));
  const clientIds = new Set(s.clients.map((c) => c.id));
  return {
    ...s,
    carers: [...s.carers, ...sync.carers.filter((c) => !carerIds.has(c.id)).map((c) => blankCarer(c.id, c.name, c.teams))],
    clients: [
      ...s.clients,
      ...sync.clients
        .filter((c) => !clientIds.has(c.id))
        .map((c) => ({
          id: c.id,
          ref: c.ref,
          team: c.team,
          gender_preference: null,
          do_not_send: [],
          safeguarding_bar: [],
          required_skills: [],
          time_critical_booking_types: [],
        })),
    ],
  };
}

export function settingsToJson(s: SettingsFile): string {
  return JSON.stringify({ ...s, saved_at: new Date().toISOString() }, null, 2);
}
