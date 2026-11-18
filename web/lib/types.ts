// Types for the engine API contract (see docs/ENGINE_API.md).

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAYS)[number];
export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

// ---------- Settings file ----------

export interface HoursBlock {
  start: string; // "HH:MM"
  end: string; // "HH:MM"; earlier than start means it ends the next day (nights)
}

export interface SettingsCarer {
  id: string;
  name: string;
  teams: string[];
  working_hours: Partial<Record<DayKey, HoursBlock[]>>;
  // true (default for new carers): available 00:00-24:00 and the engine chooses their hours.
  // A carer with no blocks is treated the same way.
  available_any_time?: boolean;
  weekly_max_hours: number | null;
  skills: string[];
  dbs_expiry: string | null; // YYYY-MM-DD
  training_expiry: string | null;
  active: boolean;
}

export interface SettingsClient {
  id: string;
  ref: string;
  team: string;
  gender_preference: "female" | "male" | null;
  do_not_send: string[]; // carer ids
  safeguarding_bar: string[]; // carer ids
  required_skills: string[];
  time_critical_booking_types: string[];
}

export interface AgencySettings {
  move_window_minutes: number;
  move_cost_pence_per_min: number;
  continuity_weight_pence: number;
  hours_balance: "equal_share_within_team";
  search_seconds_per_day: number;
  change_cost_pence: number;
  arrival_tolerance_minutes: number;
  // Planning area -> the teams planned in it, for example {"Weymouth": ["Weymouth", "Dorchester"]}.
  // Set by the service; shown read-only. Older files map team -> area (a string); the web app
  // converts those when it reads the file.
  team_regions?: Record<string, string[]>;
  pay_pence_per_hour: number | null;
  mileage_pence_per_mile: number | null;
  travel_time_paid: boolean | null;
}

export interface CarerNameMatch {
  booking_name: string;
  carer_id: string;
}

// ---------- Client schedules (learned from past bookings, kept in the settings file) ----------

export interface ScheduleVisit {
  id: string;
  days: DayKey[];
  start: string; // "HH:MM"
  duration_min: number;
  booking_type: string;
  carers_needed: number;
  repeat: "weekly" | "fortnightly";
  fortnight_anchor: string | null; // a Monday (YYYY-MM-DD) of a week the visit happens, for "fortnightly"
}

export interface ClientSchedule {
  client_ref: string;
  confirmed: boolean;
  learned_from: string[]; // week starts (Mondays)
  updated_at: string | null;
  visits: ScheduleVisit[];
}

export interface SettingsFile {
  version: 2; // 2 added client_schedules; version 1 files are still read
  saved_at: string | null;
  agency: AgencySettings;
  carers: SettingsCarer[];
  clients: SettingsClient[];
  carer_name_matches: CarerNameMatch[];
  client_schedules: Record<string, ClientSchedule>; // by client id
}

export interface OneOffVisit {
  client_id: string;
  client_ref: string;
  display_name?: string;
  date: string; // YYYY-MM-DD
  start: string;
  duration_min: number;
  booking_type: string;
}

export interface ScheduleFlag {
  client_id: string;
  client_ref: string;
  display_name?: string;
  kind: "changed" | "suspended" | "no_bookings_in_period";
  detail: string; // a ready-made sentence (dates already dd/mm/yyyy): shown as it is
}

export interface LearnResult {
  weeks: string[]; // Mondays covered
  // display_name is for the screen only: it is not part of the stored schedule (strip it when saving).
  schedules: Record<string, ClientSchedule & { display_name?: string }>;
  one_offs: OneOffVisit[];
  flags: ScheduleFlag[];
  counts?: Record<string, number>;
}

// ---------- Report (engine report shape, simplified) ----------

export interface ReportMetrics {
  visits: number;
  filled: number;
  unfilled: number;
  fill_rate: number;
  care_hours: number;
  travel_hours: number;
  miles: number;
  continuity_rate: number;
  hours_min: number;
  hours_median: number;
  hours_max: number;
  hours_stdev: number;
  visits_moved: number;
}

export interface ReportCarer {
  id: string;
  name: string;
  area: string;
  gender: string;
  skills: string[];
  contracted_minutes: number;
  max_minutes: number;
  scheduled_minutes: number;
  travel_minutes: number;
  miles: number;
  travel_mode?: string; // "car" or other; the roster shows a car or a walking icon
  availability: { day: number; start: number; end: number }[];
  issues: string[];
}

export interface ReportClient {
  id: string;
  ref: string;
  display_name?: string; // for example "Smith, J"; falls back to ref
  area: string;
  recent_carers: string[];
}

export interface ReportVisit {
  id: string;
  booking_id: string | null; // null in a draft: CareLineLive has not generated the booking yet
  client_id: string;
  day: number; // 0 = Monday
  preferred_start: number; // minutes after midnight
  window: number;
  duration: number;
  carers_needed: number;
  kind: string;
  booking_type: string;
  assigned: string[]; // carer ids
  start: number | null;
  current_assigned: string[];
  moved: boolean; // carer(s) or time differ from the current rota
  locked: boolean;
  lock_reason: string | null;
  unfilled_cause?: "rules" | "hours" | "weekly_max" | "travel_or_booked" | null;
  change_class?: "carer" | "time_with_change" | "time_note" | "time_within_tolerance" | "unchanged" | null;
  unfilled_reason: string | null;
  unfilled_detail: string[];
}

export interface RouteStop {
  visit_id: string;
  client_id: string;
  start: number;
  end: number;
  travel_before: number;
  miles_before: number;
  shared_with: string[];
}

export interface Report {
  week_start: string;
  days: DayKey[];
  metrics: ReportMetrics;
  carers: ReportCarer[];
  clients: ReportClient[];
  visits: ReportVisit[];
  routes: Record<string, Partial<Record<DayKey, RouteStop[]>>>;
  // The current rota in the same shape as `routes`, with travel_before per stop. Optional:
  // the roster rebuilds it from visits (without travel) when it is missing.
  current_routes?: Record<string, Partial<Record<DayKey, RouteStop[]>>>;
}

export interface Comparison {
  engine: ReportMetrics;
  current: ReportMetrics;
}

export interface Change {
  booking_id: string;
  client_ref: string;
  date: string;
  booked_start: string;
  new_start: string | null;
  from_carers: string[];
  to_carers: string[];
  kind: "carer" | "time_with_change";
  new_time_needed?: boolean;
  forced_by_rules?: boolean;
  reason: string;
}

export interface TimeNote {
  booking_id: string;
  client_ref: string;
  date: string;
  carer: string;
  booked_start: string;
  new_start: string;
  kind: "time_note" | "time_within_tolerance";
  within_tolerance?: boolean;
  reason: string;
}

export interface FillCheck {
  unfilled: number;
  because_rules: number;
  because_hours: number;
  because_weekly_max: number;
  because_travel_or_booked: number;
  unfilled_but_filled_in_current_rota: number;
  current_rota_fully_staffed: number;
  current_rota_feasible: number;
}

export interface ChangeSummary {
  total: number;
  forced_by_rules: number;
  fills_unallocated: number;
  for_travel_continuity_hours: number;
  new_time_needed: number;
  time_notes: number;
  time_within_tolerance: number;
}

export interface RunWarning {
  code: string;
  message: string;
}

// One line of the "Changes since the draft" check.
export interface DraftCheckItem {
  client: string; // display name, or the reference when no name is known
  client_ref: string; // blank for "removed" rows
  date: string;
  start: string;
  end: string;
  booking_type: string;
  summary: string;
  draft_start?: string; // only on "retimed" rows
}

export interface DraftCheck {
  matched: number;
  added: DraftCheckItem[];
  removed: DraftCheckItem[];
  retimed: DraftCheckItem[];
  tolerance_minutes: number;
  summary: string;
}

export interface RunNotice {
  code: string;
  message: string;
}

export interface RunResult {
  mode: "new" | "improve";
  draft: boolean; // planned from client schedules, so there are no booking IDs yet
  draft_check?: DraftCheck | null;
  notices?: RunNotice[];
  change_cost_pence: number | null;
  teams: Record<string, Report>;
  comparison: Comparison;
  changes: Change[];
  time_notes: TimeNote[];
  arrival_tolerance_minutes?: number;
  change_summary?: ChangeSummary | null;
  fill_check?: FillCheck | null;
  warnings: RunWarning[];
}

export type RunStatus = "queued" | "running" | "done" | "failed";

export interface RunState {
  status: RunStatus;
  progress: number;
  message: string;
  result?: RunResult;
}

export interface SyncResult {
  counts: { carers: number; clients: number; addresses: number; leave: number };
  carers: { id: string; name: string; teams: string[] }[];
  clients: { id: string; ref: string; team: string }[];
  missing: {
    addresses: string[]; // client refs
    carers_not_in_settings: string[]; // carer ids
    clients_not_in_settings: string[]; // client refs
    unmatched_booking_carers: string[]; // names as in the bookings CSV
  };
}
