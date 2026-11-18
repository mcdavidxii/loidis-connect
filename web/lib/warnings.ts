// Plain-language wording for the warnings the service sends. The service's own message is
// only used for a code we do not know.

import type { RunNotice, RunWarning } from "./types";

const count = (m: string) => {
  const x = /\d+/.exec(m);
  return x ? Number(x[0]) : null;
};
const some = (n: number | null, one: string, many: string) => (n === 1 ? one : many.replace("{n}", String(n ?? "Some")));

export function plainWarning(w: RunWarning): string {
  const n = count(w.message);
  switch (w.code) {
    case "no_settings":
      return "No settings file was uploaded, so carers' hours, skills and rules were not checked.";
    case "no_working_hours":
      return some(n, "1 carer has no working hours set and will not get visits.", "{n} carers have no working hours set and will not get visits.");
    case "no_dbs_date":
      return some(n, "1 carer has no DBS date, so it cannot be checked for them.", "{n} carers have no DBS date, so it cannot be checked for them.");
    case "no_training_date":
      return some(n, "1 carer has no training date, so it cannot be checked for them.", "{n} carers have no training date, so it cannot be checked for them.");
    case "expired":
      return some(n, "1 carer has an expired DBS or training and will not get visits.", "{n} carers have an expired DBS or training and will not get visits.");
    case "no_weekly_max":
      return some(n, "1 carer has no weekly maximum, so it is not checked for them.", "{n} carers have no weekly maximum, so it is not checked for them.");
    case "agency_defaults":
      return "Pay rate, mileage rate or paid travel time are not set, so standard values are used to cost travel.";
    case "unallocated":
      return `${n ?? "Some"} booking${n === 1 ? "" : "s"} could not be filled. See "Why some bookings can't be filled".`;
    case "no_continuity":
      return "No Continuity report was uploaded, so the carers on your rota are counted as familiar carers. Familiar-carer figures are only as good as that.";
    case "continuity_unreadable":
      return "The Continuity report could not be read, so the carers on your rota are counted as familiar carers.";
    case "missing_address":
      return some(n, "1 client has no address in CareLineLive, so a nearby position was used for travel.", "{n} clients have no address in CareLineLive, so a nearby position was used for travel.");
    case "carer_no_location":
      return some(n, "1 carer has no home location, so a typical position was used for travel.", "{n} carers have no home location, so a typical position was used for travel.");
    case "transport_defaulted":
      return some(n, "1 carer has no transport type, so a car is assumed.", "{n} carers have no transport type, so a car is assumed.");
    case "clients_not_in_settings":
      return some(n, "1 client is not in your settings file, so they have no rules.", "{n} clients are not in your settings file, so they have no rules.");
    case "unmapped_team":
      return "Some teams are not part of a planning area, so their bookings were not planned.";
    case "cross_region_carers":
      return some(n, "1 carer works in more than one area, so their weekly hours are shared between areas.", "{n} carers work in more than one area, so their weekly hours are shared between areas.");
    case "carer_no_team":
      return some(n, "1 carer has no team in CareLineLive, so they were left out of the rota.", "{n} carers have no team in CareLineLive, so they were left out of the rota.");
    case "hours_padded":
      return `${n ?? "Some"} working-hours block${n === 1 ? " was" : "s were"} stretched by up to 90 minutes so a carer can reach a time-critical visit at the edge of their shift.`;
    case "lock_ignored":
      return some(n, "1 \"keep as is\" choice could not be applied.", "{n} \"keep as is\" choices could not be applied.");
    case "locked_outside_hours":
      return `${n ?? "Some"} booking${n === 1 ? " is" : "s are"} at times no suitable carer works, so ${n === 1 ? "it stays" : "they stay"} with the current carer. Check that carer can do ${n === 1 ? "it" : "them"}.`;
    case "current_rota_not_feasible":
      return "Some bookings on your rota leave too little time to travel between visits, or break a carer rule. The suggested rota may fill fewer bookings; that is not necessarily worse.";
    case "arrival_tolerance_default":
      return "The small time changes we ignore are not set, so 15 minutes is used. Please confirm this.";
    case "available_any_time":
      return some(n, "1 carer is available any time; we will suggest their hours.", "{n} carers are available any time; we will suggest their hours.");
    case "schedule_missing":
      return some(
        n,
        "1 client has no schedule yet, so they are not in this draft. Add their schedule on the Schedules screen.",
        "{n} clients have no schedule yet, so they are not in this draft. Add their schedules on the Schedules screen.",
      );
    case "schedule_unconfirmed":
      return some(
        n,
        "1 client schedule is not confirmed yet, so that client is left out of this draft. Confirm it on the Schedules screen.",
        "{n} client schedules are not confirmed yet, so those clients are left out of this draft. Confirm them on the Schedules screen.",
      );
    default:
      return w.message;
  }
}

// Plain wording for the quiet notices the service sends alongside the result.
export function plainNotice(x: RunNotice): string {
  const n = count(x.message);
  switch (x.code) {
    case "available_any_time":
      return some(n, "1 carer is available any time (no working hours set), so we suggest their hours.", "{n} carers are available any time (no working hours set), so we suggest their hours.");
    case "draft_from_schedules":
      return "Draft from client schedules. The bookings for this week are not generated in CareLineLive yet.";
    case "clients_suspended":
      return some(n, "1 client is suspended in CareLineLive, so they are left out.", "{n} clients are suspended in CareLineLive, so they are left out.");
    default:
      return x.message;
  }
}

// Plain wording for the reason text the service gives a change.
export function plainReason(r: string): string {
  return r
    .replace(/evens hours/g, "fairer hours")
    .replace(/lower overall cost in the plan/g, "better overall plan")
    .replace(/current carer over weekly maximum/g, "current carer is over their weekly maximum");
}

// Plain wording for why a visit is kept as is.
export function plainLock(r: string): string {
  const s = r.toLowerCase();
  if (s.includes("time-critical")) return "Time-critical visit: the time cannot move";
  if (s.includes("home region") || s.includes("main area")) return "This carer's main area is elsewhere, so the visit stays with them";
  if (s.includes("outside working hours")) return "No suitable carer works then, so it stays with the current carer";
  if (s.includes("coordinator")) return "You chose to keep this as is";
  return r;
}
