// A fully made-up agency for the mock engine. No real data anywhere.
// Two teams (Leeds, Dorset), 8 carers, 15 clients, about 120 visits over one week.

import type { DayKey, HoursBlock, SettingsFile } from "../types";
import { DAYS } from "../types";
import { DEFAULT_AGENCY } from "../settings";
import { hhmm } from "../time";

export const WEEK_START = "2026-11-16"; // a Monday

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FakeCarer {
  id: string;
  name: string;
  team: string;
  gender: "female" | "male";
  skills: string[];
  home: { lat: number; lon: number };
  hours: Partial<Record<DayKey, HoursBlock[]>>;
  weeklyMaxHours: number;
  dbsExpiry: string | null;
  trainingExpiry: string | null;
}

export interface FakeClient {
  id: string;
  ref: string;
  name: string;
  team: string;
  loc: { lat: number; lon: number };
  genderPreference: "female" | "male" | null;
  doNotSend: string[];
  safeguardingBar: string[];
  requiredSkills: string[];
  timeCriticalTypes: string[];
  recentCarers: string[];
}

export interface FakeVisit {
  id: string;
  bookingId: string;
  clientId: string;
  team: string;
  day: number;
  start: number;
  duration: number;
  carersNeeded: number;
  bookingType: string;
  skills: string[];
  timeCritical: boolean;
}

const wk = (start: string, end: string): HoursBlock[] => [{ start, end }];
function days(list: DayKey[], blocks: HoursBlock[]): Partial<Record<DayKey, HoursBlock[]>> {
  const out: Partial<Record<DayKey, HoursBlock[]>> = {};
  list.forEach((d) => (out[d] = blocks));
  return out;
}
const WEEKDAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri"];

const LEEDS = { lat: 53.8, lon: -1.55 };
const DORSET = { lat: 50.71, lon: -2.44 };

export const CARERS: FakeCarer[] = [
  { id: "K001", name: "Carer A", team: "Leeds", gender: "female", skills: ["medication", "hoist"], home: { lat: 53.81, lon: -1.57 }, hours: days(WEEKDAYS, wk("07:00", "14:00")), weeklyMaxHours: 35, dbsExpiry: "2027-06-30", trainingExpiry: "2027-03-31" },
  { id: "K002", name: "Carer B", team: "Leeds", gender: "female", skills: ["medication"], home: { lat: 53.79, lon: -1.52 }, hours: days(["mon", "tue", "wed", "thu", "fri", "sat"], wk("14:00", "22:30")), weeklyMaxHours: 30, dbsExpiry: "2027-01-31", trainingExpiry: "2027-05-31" },
  { id: "K003", name: "Carer C", team: "Leeds", gender: "female", skills: ["medication", "hoist"], home: { lat: 53.82, lon: -1.54 }, hours: { ...days(["mon", "tue", "thu", "sat", "sun"], wk("07:00", "13:30")), ...days(["tue", "thu", "sat", "sun"], [{ start: "07:00", end: "13:30" }, { start: "16:00", end: "22:00" }]) }, weeklyMaxHours: 28, dbsExpiry: "2028-02-28", trainingExpiry: "2027-09-30" },
  { id: "K004", name: "Carer D", team: "Leeds", gender: "male", skills: ["medication"], home: { lat: 53.78, lon: -1.58 }, hours: days(["tue", "wed", "thu", "fri", "sat", "sun"], wk("07:00", "22:00")), weeklyMaxHours: 40, dbsExpiry: "2027-08-31", trainingExpiry: "2027-02-28" },
  { id: "K005", name: "Carer E", team: "Dorset", gender: "female", skills: ["medication", "hoist"], home: { lat: 50.72, lon: -2.46 }, hours: days(["mon", "tue", "wed", "thu", "fri", "sat", "sun"], wk("07:00", "13:00")), weeklyMaxHours: 37, dbsExpiry: "2027-11-30", trainingExpiry: "2027-04-30" },
  { id: "K006", name: "Carer F", team: "Dorset", gender: "male", skills: ["medication", "hoist"], home: { lat: 50.7, lon: -2.42 }, hours: days(["mon", "tue", "wed", "thu", "fri"], wk("08:00", "22:30")), weeklyMaxHours: 30, dbsExpiry: "2027-02-28", trainingExpiry: "2027-07-31" },
  { id: "K007", name: "Carer G", team: "Dorset", gender: "female", skills: ["medication", "hoist"], home: { lat: 50.73, lon: -2.43 }, hours: days(["thu", "fri", "sat", "sun"], wk("07:00", "22:00")), weeklyMaxHours: 32, dbsExpiry: "2027-09-30", trainingExpiry: "2027-10-31" },
  { id: "K008", name: "Carer H", team: "Dorset", gender: "female", skills: ["medication"], home: { lat: 50.69, lon: -2.45 }, hours: days(["mon", "tue", "wed", "fri", "sat"], wk("08:00", "20:00")), weeklyMaxHours: 25, dbsExpiry: null, trainingExpiry: "2027-06-30" },
];

const SLOT_TIMES: Record<string, [number, number, number]> = {
  // booking type: [earliest start, latest start, duration]
  "Morning Visit": [450, 540, 45],
  "Medication Call": [480, 495, 30],
  "Lunch Visit": [720, 780, 30],
  "Tea Visit": [990, 1050, 30],
  "Bed Visit": [1230, 1290, 30],
};

const CLIENT_PLAN: { team: string; slots: string[]; days: number[] }[] = [
  { team: "Leeds", slots: ["Morning Visit"], days: [0, 1, 2, 3, 4, 5, 6] },
  { team: "Leeds", slots: ["Medication Call"], days: [0, 1, 2, 3, 4, 5, 6] },
  { team: "Leeds", slots: ["Tea Visit"], days: [0, 1, 2, 3, 4, 5, 6] },
  { team: "Leeds", slots: ["Lunch Visit"], days: [0, 1, 2, 3, 4, 5, 6] },
  { team: "Leeds", slots: ["Bed Visit"], days: [0, 1, 2, 3, 4] },
  { team: "Leeds", slots: ["Tea Visit"], days: [0, 1, 2, 3, 4] },
  { team: "Leeds", slots: ["Morning Visit", "Bed Visit"], days: [0, 1, 2, 3, 4, 5, 6] },
  { team: "Dorset", slots: ["Morning Visit"], days: [0, 1, 2, 3, 4, 5, 6] },
  { team: "Dorset", slots: ["Medication Call"], days: [0, 1, 2, 3, 4, 5, 6] },
  { team: "Dorset", slots: ["Lunch Visit"], days: [0, 1, 2, 3, 4, 5, 6] },
  { team: "Dorset", slots: ["Tea Visit"], days: [0, 1, 2, 3, 4] },
  { team: "Dorset", slots: ["Morning Visit"], days: [0, 1, 2, 3, 4] },
  { team: "Dorset", slots: ["Bed Visit"], days: [0, 1, 2, 3, 4] },
  { team: "Dorset", slots: ["Morning Visit", "Bed Visit"], days: [0, 1, 2, 3, 4, 5, 6] },
  { team: "Dorset", slots: ["Lunch Visit", "Tea Visit"], days: [0, 1, 2, 3, 4, 5, 6] },
];

export interface FakeAgency {
  weekStart: string;
  carers: FakeCarer[];
  clients: FakeClient[];
  visits: FakeVisit[];
  currentSeed: number;
}

let cached: FakeAgency | null = null;

export function getAgency(): FakeAgency {
  if (cached) return cached;
  const r = rng(20261116);
  const carers = CARERS;
  const clients: FakeClient[] = CLIENT_PLAN.map((p, i) => {
    const centre = p.team === "Leeds" ? LEEDS : DORSET;
    const teamCarers = carers.filter((c) => c.team === p.team);
    const n = String(i + 1).padStart(2, "0");
    const usual = [teamCarers[i % 4].id, teamCarers[(i + 1) % 4].id];
    return {
      id: `C${n}`,
      ref: `CL-0${n}`,
      name: `Client ${n}`,
      team: p.team,
      loc: { lat: centre.lat + (r() - 0.5) * 0.07, lon: centre.lon + (r() - 0.5) * 0.09 },
      genderPreference: null,
      doNotSend: [],
      safeguardingBar: [],
      requiredSkills: [],
      timeCriticalTypes: p.slots.includes("Medication Call") ? ["Medication Call"] : [],
      recentCarers: usual,
    };
  });
  // A few made-up rules so the rules screens have something to show.
  clients[3].requiredSkills = ["hoist"];
  clients[13].requiredSkills = ["hoist"];
  clients[2].genderPreference = "female";
  clients[10].genderPreference = "male";
  clients[4].doNotSend = ["K002"];
  clients[5].safeguardingBar = ["K003"];
  clients[11].doNotSend = ["K008"];

  const visits: FakeVisit[] = [];
  let n = 0;
  CLIENT_PLAN.forEach((p, i) => {
    const client = clients[i];
    p.days.forEach((day) => {
      p.slots.forEach((slot) => {
        const [lo, hi, dur] = SLOT_TIMES[slot];
        const start = Math.round((lo + r() * (hi - lo)) / 5) * 5;
        n++;
        visits.push({
          id: `V${String(n).padStart(3, "0")}`,
          bookingId: `B${10000 + n}`,
          clientId: client.id,
          team: client.team,
          day,
          start,
          duration: dur,
          carersNeeded: client.requiredSkills.includes("hoist") && slot === "Morning Visit" ? 2 : 1,
          bookingType: slot,
          skills: client.requiredSkills,
          timeCritical: client.timeCriticalTypes.includes(slot),
        });
      });
    });
  });
  cached = { weekStart: WEEK_START, carers, clients, visits, currentSeed: 77 };
  return cached;
}

export function isoDate(weekStart: string, day: number): string {
  const d = new Date(weekStart + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

export function exampleSettings(): SettingsFile {
  const a = getAgency();
  return {
    version: 1,
    saved_at: null,
    agency: { ...DEFAULT_AGENCY },
    carers: a.carers.map((c) => ({
      id: c.id,
      name: c.name,
      teams: [c.team],
      working_hours: c.hours,
      weekly_max_hours: c.weeklyMaxHours,
      skills: c.skills,
      dbs_expiry: c.dbsExpiry,
      training_expiry: c.trainingExpiry,
      active: true,
    })),
    clients: a.clients.map((c) => ({
      id: c.id,
      ref: c.ref,
      team: c.team,
      gender_preference: c.genderPreference,
      do_not_send: c.doNotSend,
      safeguarding_bar: c.safeguardingBar,
      required_skills: c.requiredSkills,
      time_critical_booking_types: c.timeCriticalTypes,
    })),
    // Carer H is deliberately missing so the name-matching step has something to confirm.
    carer_name_matches: a.carers.filter((c) => c.id !== "K008").map((c) => ({ booking_name: c.name, carer_id: c.id })),
  };
}

export const SKILLS = ["medication", "hoist", "nights", "dementia", "peg feeding"];

export { DAYS, hhmm };
