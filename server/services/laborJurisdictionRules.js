// OxSteed Restaurants — S-20 native labor-law jurisdiction rules engine.
//
// This is the NATIVE engine: it evaluates only rule parameters stored in
// restaurant_labor_jurisdictions (per location), never a vendor API.
// Vendor rule sets (7shifts, Homebase, Fourth) remain Emile's call; when a
// vendor is connected its findings would arrive through a separate adapter,
// not through this module.
//
// Jurisdiction presets encode the well-known statutory baselines. They
// are STARTING POINTS, not legal advice: statutes change, and a stored
// row always wins over its preset (explicit values override; NULL falls
// back to the preset). An operator in any jurisdiction must confirm the
// preset against current local law before relying on it for pay.
//
//   US-FED : 40h weekly overtime (FLSA).
//   US-CA  : 8h daily OT, 12h double time, 7th consecutive day OT, 10h rest
//            between shifts (clopening guard), 30-min meal break after 5h,
//            one hour at the regular rate per missed meal period
//            (Cal. Labor Code 226.7).
//   US-NYC : Fair Workweek fast-food: 14-day advance notice (predictability),
//            11h rest between shifts. US-SFO / US-SEA / US-CHI / US-OR share
//            the Fair Workweek family with their own notice/rest values.
//            NYC prices predictability in dollars, not hours: Local Law
//            107 sets $10/$15 for added or moved hours and $20/$45/$75
//            for reduced or cancelled hours by notice band (see the
//            US-NYC preset's predictability_premium_tiers).
//   GB-UK  : Working Time Regulations 1998: 48h average weekly maximum,
//            no statutory daily-overtime premium, no statutory meal-break
//            premium (20-min rest break after 6h, unpaid).
//   CA-ON  : Ontario ESA: overtime after 44h/week, no daily overtime,
//            30-min meal break after 5h (unpaid, no premium).
//   HT     : Haiti Labour Code: 8h day / 48h week, overtime at 1.5x,
//            no double-time tier, no 7th-day rule.
//   CUSTOM : every parameter set explicitly per location. A CUSTOM row
//            that leaves overtime parameters NULL is not payable:
//            the pay path fails closed (see assertPayableRules) instead
//            of silently paying straight time.
//
// The workweek starts on Sunday by default (workweek_start_day 0):
// that is the pay calc's long-standing week, and every surface that
// groups by week (pay, validator, forecast, copy-week, the punch-time
// minor check) reads it from the same rule. A jurisdiction row may
// store its own start (0 = Sunday .. 6 = Saturday); stored NULL falls
// back to the preset, which is Sunday everywhere.
//
// Pay rules are jurisdiction-driven through this table: the payroll
// service reads these parameters per location and never branches on a
// country or state code. California is one row in the table, not the
// logic. A jurisdiction with no daily-overtime threshold simply has
// daily_overtime_hours NULL, and the calc pays straight time.
//
// The engine is advisory: evaluateSchedule returns warnings; the publish
// endpoint stores them on the schedule version (evidence) and returns them
// to the manager. Nothing here blocks a publish.

'use strict';

const PRESETS = {
  'US-FED': {
    weekly_overtime_hours: 40,
    daily_overtime_hours: null,
    daily_doubletime_hours: null,
    seventh_day_overtime: false,
    min_rest_between_shifts_hours: 8,
    meal_break_after_minutes: 360,
    meal_break_duration_minutes: 30,
    meal_break_premium_hours: null,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 40,
    minor_latest_end_time: '22:00',
    workweek_start_day: 0, // 0 = Sunday; the pay calc's long-standing week
    schedule_notice_hours: null,
    predictability_premium_hours: null,
  },
  'US-CA': {
    weekly_overtime_hours: 40,
    daily_overtime_hours: 8,
    daily_doubletime_hours: 12,
    seventh_day_overtime: true,
    min_rest_between_shifts_hours: 10,
    meal_break_after_minutes: 300,
    meal_break_duration_minutes: 30,
    // Cal. Labor Code 226.7: one hour at the regular rate per workday
    // a meal period is missed.
    meal_break_premium_hours: 1,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 48,
    minor_latest_end_time: '22:00',
    workweek_start_day: 0, // 0 = Sunday; the pay calc's long-standing week
    schedule_notice_hours: null,
    predictability_premium_hours: null,
  },
  'US-NYC': {
    weekly_overtime_hours: 40,
    daily_overtime_hours: null,
    daily_doubletime_hours: null,
    seventh_day_overtime: false,
    min_rest_between_shifts_hours: 11,
    meal_break_after_minutes: 360,
    meal_break_duration_minutes: 30,
    meal_break_premium_hours: null,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 40,
    minor_latest_end_time: '22:00',
    workweek_start_day: 0, // 0 = Sunday; the pay calc's long-standing week
    schedule_notice_hours: 336, // 14 days, Fair Workweek predictability
    // NYC Fair Workweek (Local Law 107 of 2017, fast food) prices
    // predictability in dollars, not hours: $10-$75 per change by
    // change type and notice band (DCWP enforcement summary):
    //   added hours / moved shift, no loss of hours:
    //     $10 with 7-14 days' notice, $15 with under 7 days' notice;
    //   hours reduced / shift cancelled:
    //     $20 with 7-14 days' notice, $45 with 24h-7 days' notice,
    //     $75 with under 24 hours' notice.
    // Amounts are integer minor units in the location's currency
    // (USD for a NYC store). A location may override the tier table
    // with its own predictability_premium_tiers JSONB row.
    predictability_premium_tiers: {
      add_change_7_14_days: 1000,
      add_change_under_7_days: 1500,
      reduce_cancel_7_14_days: 2000,
      reduce_cancel_24h_7_days: 4500,
      reduce_cancel_under_24h: 7500,
    },
  },
  'US-SFO': {
    weekly_overtime_hours: 40,
    daily_overtime_hours: 8,
    daily_doubletime_hours: 12,
    seventh_day_overtime: true,
    min_rest_between_shifts_hours: 11,
    meal_break_after_minutes: 300,
    meal_break_duration_minutes: 30,
    meal_break_premium_hours: 1,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 48,
    minor_latest_end_time: '22:00',
    workweek_start_day: 0, // 0 = Sunday; the pay calc's long-standing week
    schedule_notice_hours: 336,
    predictability_premium_hours: 1,
  },
  'US-SEA': {
    weekly_overtime_hours: 40,
    daily_overtime_hours: null,
    daily_doubletime_hours: null,
    seventh_day_overtime: false,
    min_rest_between_shifts_hours: 10,
    meal_break_after_minutes: 360,
    meal_break_duration_minutes: 30,
    meal_break_premium_hours: null,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 40,
    minor_latest_end_time: '22:00',
    workweek_start_day: 0, // 0 = Sunday; the pay calc's long-standing week
    schedule_notice_hours: 336,
    predictability_premium_hours: 1,
  },
  'US-CHI': {
    weekly_overtime_hours: 40,
    daily_overtime_hours: null,
    daily_doubletime_hours: null,
    seventh_day_overtime: false,
    min_rest_between_shifts_hours: 10,
    meal_break_after_minutes: 450,
    meal_break_duration_minutes: 20,
    meal_break_premium_hours: null,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 40,
    minor_latest_end_time: '21:00',
    workweek_start_day: 0, // 0 = Sunday; the pay calc's long-standing week
    schedule_notice_hours: 240, // 10 days
    predictability_premium_hours: 1,
  },
  'US-OR': {
    weekly_overtime_hours: 40,
    daily_overtime_hours: null,
    daily_doubletime_hours: null,
    seventh_day_overtime: false,
    min_rest_between_shifts_hours: 10,
    meal_break_after_minutes: 360,
    meal_break_duration_minutes: 30,
    meal_break_premium_hours: null,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 40,
    minor_latest_end_time: '22:00',
    workweek_start_day: 0, // 0 = Sunday; the pay calc's long-standing week
    schedule_notice_hours: 336,
    predictability_premium_hours: 1,
  },
  'GB-UK': {
    weekly_overtime_hours: 48,
    daily_overtime_hours: null,
    daily_doubletime_hours: null,
    seventh_day_overtime: false,
    min_rest_between_shifts_hours: 11,
    meal_break_after_minutes: 360,
    meal_break_duration_minutes: 20,
    meal_break_premium_hours: null,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 40,
    minor_latest_end_time: '22:00',
    workweek_start_day: 0, // 0 = Sunday; the pay calc's long-standing week
    schedule_notice_hours: null,
    predictability_premium_hours: null,
  },
  'CA-ON': {
    weekly_overtime_hours: 44,
    daily_overtime_hours: null,
    daily_doubletime_hours: null,
    seventh_day_overtime: false,
    min_rest_between_shifts_hours: 11,
    meal_break_after_minutes: 300,
    meal_break_duration_minutes: 30,
    meal_break_premium_hours: null,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 48,
    minor_latest_end_time: '22:00',
    workweek_start_day: 0, // 0 = Sunday; the pay calc's long-standing week
    schedule_notice_hours: null,
    predictability_premium_hours: null,
  },
  HT: {
    weekly_overtime_hours: 48,
    daily_overtime_hours: 8,
    daily_doubletime_hours: null,
    seventh_day_overtime: false,
    min_rest_between_shifts_hours: 10,
    meal_break_after_minutes: 300,
    meal_break_duration_minutes: 30,
    meal_break_premium_hours: null,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 48,
    minor_latest_end_time: '22:00',
    workweek_start_day: 0, // 0 = Sunday; the pay calc's long-standing week
    schedule_notice_hours: null,
    predictability_premium_hours: null,
  },
  CUSTOM: {},
};

const RULE_COLUMNS = [
  'weekly_overtime_hours',
  'daily_overtime_hours',
  'daily_doubletime_hours',
  'seventh_day_overtime',
  'min_rest_between_shifts_hours',
  'meal_break_after_minutes',
  'meal_break_duration_minutes',
  // Premium rules, in hours at the regular rate. NULL on a stored row
  // falls back to the preset; a preset NULL means "no premium rule".
  'meal_break_premium_hours',
  'minor_max_daily_hours',
  'minor_max_weekly_hours',
  'minor_latest_end_time',
  'schedule_notice_hours',
  'predictability_premium_hours',
  // Dollar-amount predictability tiers (integer minor units, keyed by
  // change type and notice band; see the US-NYC preset). NULL on a
  // stored row falls back to the preset; a preset without tiers means
  // "no dollar rule" and the hours rule above governs instead.
  'predictability_premium_tiers',
  // First day of the workweek, 0 = Sunday .. 6 = Saturday. NULL on a
  // stored row falls back to the preset (Sunday everywhere).
  'workweek_start_day',
];

// Predictability premium owed for one late schedule change, in hours at
// the regular rate. The stored/preset rule wins when set. Where a
// jurisdiction has a notice statute but no premium amount of its own,
// the documented default is one hour at the regular rate. Where there
// is no notice statute at all, no premium is owed. Returns null when
// no premium is owed, and null for a jurisdiction whose premium is
// priced in dollars (see predictabilityPremiumCents): an hours figure
// for a dollar jurisdiction would double-price the change.
function predictabilityPremiumHours(rules) {
  const r = rules || resolveRules(null);
  if (r.predictability_premium_tiers != null) return null;
  if (r.predictability_premium_hours != null) return Number(r.predictability_premium_hours);
  if (r.schedule_notice_hours != null) return 1;
  return null;
}

// Predictability premium owed for one late schedule change, in integer
// minor units of the location's currency, for jurisdictions whose rule
// is a dollar table (US-NYC Fair Workweek). Returns null where the
// jurisdiction prices predictability in hours instead, or owes none.
//
// hoursBeforeStart is the notice the change was made with; a cancelled
// shift (after == null) or one that loses hours prices on the
// reduce/cancel tiers, anything else on the add/change tiers. The tier
// keys are the US-NYC preset's (see above for the statutory amounts).
function predictabilityPremiumCents(rules, { hoursBeforeStart, reducedOrCancelled = false } = {}) {
  const r = rules || resolveRules(null);
  const tiers = r.predictability_premium_tiers;
  if (tiers == null || typeof tiers !== 'object') return null;
  const notice = Number(hoursBeforeStart);
  if (!Number.isFinite(notice) || notice < 0) return null;
  const pick = (key) => (tiers[key] == null ? null : Math.round(Number(tiers[key])));
  if (reducedOrCancelled) {
    if (notice >= 7 * 24) return pick('reduce_cancel_7_14_days');
    if (notice >= 24) return pick('reduce_cancel_24h_7_days');
    return pick('reduce_cancel_under_24h');
  }
  if (notice >= 7 * 24) return pick('add_change_7_14_days');
  return pick('add_change_under_7_days');
}

// First day of the workweek for a set of resolved rules: 0 = Sunday
// .. 6 = Saturday. Anything missing or out of range is Sunday, the
// pay calc's long-standing week.
function workweekStartDay(rules) {
  const day = rules == null ? null : Number(rules.workweek_start_day);
  return Number.isInteger(day) && day >= 0 && day <= 6 ? day : 0;
}

// Week-start date (YYYY-MM-DD) for the workweek containing `dateStr`,
// under a workweek that starts on `startDay` (0 = Sunday, as above).
// The one week definition every surface shares: pay, the shift
// validator, the forecast, copy-week, and the punch-time minor check.
function weekStartOf(dateStr, startDay = 0) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00Z`);
  const offset = ((d.getUTCDay() - workweekStartDay({ workweek_start_day: startDay })) % 7 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

// Meal-break premium owed per missed meal period, in hours at the
// regular rate, or null where the jurisdiction requires no premium.
function mealBreakPremiumHours(rules) {
  const r = rules || resolveRules(null);
  return r.meal_break_premium_hours == null ? null : Number(r.meal_break_premium_hours);
}

// Merge the stored row over its preset: explicit NULLs fall back to the
// preset, so a location only overrides what it means to.
//
// Fail closed on an unknown code: a stored row naming a jurisdiction
// this engine does not know must raise, naming the code, instead of
// silently resolving to the US-FED preset and paying under the wrong
// rules. A missing row (null) still resolves to the US-FED preset —
// "no row configured" is the documented default, not an unknown code.
function resolveRules(row) {
  const code = row?.jurisdiction_code || 'US-FED';
  const preset = PRESETS[code];
  if (!preset) {
    throw new Error(`Unknown jurisdiction code: ${code}`);
  }
  const rules = { jurisdiction_code: code };
  for (const col of RULE_COLUMNS) {
    const stored = row ? row[col] : null;
    rules[col] = stored === null || stored === undefined ? preset[col] : stored;
  }
  // The workweek starts Sunday unless the preset or the row says
  // otherwise (CUSTOM has no preset value, so it defaults here too).
  if (rules.workweek_start_day == null) rules.workweek_start_day = 0;
  return rules;
}

// A CUSTOM row with NULL overtime parameters is not payable: NULL
// means "no rule" for CUSTOM, not "use the default", so paying
// straight time would silently underpay. Returns the names of the
// missing parameters (empty when the row can price overtime).
// The weekly threshold is always required; a daily double-time
// threshold without a daily overtime threshold cannot tier either.
function customRulesErrors(rules) {
  const r = rules || {};
  if (r.jurisdiction_code !== 'CUSTOM') return [];
  const missing = [];
  if (r.weekly_overtime_hours == null) missing.push('weekly_overtime_hours');
  if (r.daily_doubletime_hours != null && r.daily_overtime_hours == null) {
    missing.push('daily_overtime_hours');
  }
  return missing;
}

// Fail closed for the pay path: throw naming the missing CUSTOM
// overtime parameters instead of computing a run that pays straight
// time. Non-CUSTOM rules always pass (their presets carry the values).
function assertPayableRules(rules) {
  const missing = customRulesErrors(rules);
  if (missing.length) {
    throw new Error(
      `CUSTOM jurisdiction leaves overtime parameters unset: ${missing.join(', ')} — set them on the jurisdiction row before running pay`
    );
  }
}

async function getJurisdiction(db, restaurantId, locationId) {
  if (!restaurantId || !locationId) return resolveRules(null);
  // A database error propagates: returning the US-FED preset on a
  // failed lookup would price pay under rules nobody configured.
  // Callers that can proceed without rules (the publish advisory
  // warnings, the punch-time minor check) catch at the call site.
  const { rows: [row] } = await db.query(
    `SELECT * FROM restaurant_labor_jurisdictions
      WHERE restaurant_id = $1 AND location_id = $2 AND is_active
      LIMIT 1`,
    [restaurantId, locationId]
  );
  return resolveRules(row || null);
}

// Batch version of getJurisdiction: resolved rules per location id for
// one restaurant. Locations with no stored row resolve to the US-FED
// preset (weekly-only), exactly like getJurisdiction. A database
// error propagates instead of resolving every location to US-FED.
async function getJurisdictions(db, restaurantId, locationIds) {
  const result = new Map();
  const ids = [...new Set((locationIds || []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (!restaurantId || !ids.length) return result;
  const { rows } = await db.query(
    `SELECT * FROM restaurant_labor_jurisdictions
      WHERE restaurant_id = $1 AND location_id = ANY($2::bigint[]) AND is_active`,
    [restaurantId, ids]
  );
  for (const row of rows) result.set(Number(row.location_id), resolveRules(row));
  for (const id of ids) {
    if (!result.has(id)) result.set(id, resolveRules(null));
  }
  return result;
}

// Shift length in hours from the shift's start/end time strings.
function shiftHours(shift) {
  const toMin = (t) => {
    if (!t) return null;
    const m = String(t).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const s = toMin(shift.start_time);
  const e = toMin(shift.end_time);
  if (s === null || e === null) return 0;
  const mins = e <= s ? e + 1440 - s : e - s;
  return Math.round((mins / 60) * 100) / 100;
}

function shiftStartDateTime(shift) {
  // shift_date is YYYY-MM-DD; times are local wall-clock HH:MM.
  return new Date(`${shift.shift_date}T${String(shift.start_time || '00:00').slice(0, 5)}:00`);
}

function shiftEndDateTime(shift) {
  const start = shiftStartDateTime(shift);
  const m = String(shift.end_time || '00:00').match(/^(\d{1,2}):(\d{2})/);
  const end = new Date(start);
  end.setHours(Number(m ? m[1] : 0), Number(m ? m[2] : 0), 0, 0);
  if (end <= start) end.setDate(end.getDate() + 1);
  return end;
}

// Week key for weekly overtime accounting: the start of the workweek
// containing `dateStr`, under the jurisdiction's workweek start
// (Sunday by default). One definition, shared with pay, the validator,
// the forecast, copy-week, and the punch-time minor check.
function weekKey(dateStr, startDay = 0) {
  return weekStartOf(dateStr, startDay);
}

// ── Federal under-16 rules (FLSA, 29 CFR 570.35) ─────────────────────
// 3h on a school day, 18h in a school week, 8h on a non-school day, 40h in a
// non-school week, only between 07:00 and 19:00 (21:00 from June 1 through
// Labor Day). The school calendar is not known here, so school-year
// weekdays (after Labor Day through May 31) are treated as school days and
// the warning says so. Advisory, like everything in this engine.
const FLSA_UNDER_16 = {
  school_day_hours: 3, school_week_hours: 18, non_school_day_hours: 8, non_school_week_hours: 40,
  earliest_start: '07:00', latest_end: '19:00', summer_latest_end: '21:00',
};
function laborDay(year) {
  const d = new Date(Date.UTC(year, 8, 1));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function isSummer(dateStr) {
  const year = Number(String(dateStr).slice(0, 4));
  return dateStr >= `${year}-06-01` && dateStr <= laborDay(year);
}
function isSchoolDay(dateStr) {
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5 && !isSummer(dateStr);
}
function under16Warnings(userId, mine, list, startDay = 0) {
  const out = [];
  const L = FLSA_UNDER_16;
  const hoursOn = (day) => list.filter((s) => String(s.shift_date) === day).reduce((a, s) => a + shiftHours(s), 0);
  for (const s of mine) {
    const day = String(s.shift_date);
    const start = String(s.start_time || '').slice(0, 5);
    const end = String(s.end_time || '').slice(0, 5);
    const latest = isSummer(day) ? L.summer_latest_end : L.latest_end;
    if (start && start < L.earliest_start) out.push({ rule: 'minor_u16_window', severity: 'warn', user_id: userId, shift_ids: [Number(s.id)],
      message: `Under-16 shift on ${day} starts at ${start}; federal law allows work from ${L.earliest_start}.` });
    if (end && (end > latest || end <= start)) out.push({ rule: 'minor_u16_window', severity: 'warn', user_id: userId, shift_ids: [Number(s.id)],
      message: `Under-16 shift on ${day} ends at ${end}; federal law allows work until ${latest}.` });
    const limit = isSchoolDay(day) ? L.school_day_hours : L.non_school_day_hours;
    if (hoursOn(day) > limit) out.push({ rule: 'minor_u16_daily', severity: 'warn', user_id: userId, shift_ids: [Number(s.id)],
      message: `Under-16 scheduled ${hoursOn(day).toFixed(1)}h on ${day}; limit ${limit}h${isSchoolDay(day) ? ' on a school day (if school is in session)' : ''}.` });
  }
  for (const wk of new Set(mine.map((s) => weekKey(String(s.shift_date), startDay)))) {
    const weekShifts = list.filter((s) => weekKey(String(s.shift_date), startDay) === wk);
    const hours = weekShifts.reduce((a, s) => a + shiftHours(s), 0);
    const schoolWeek = weekShifts.some((s) => isSchoolDay(String(s.shift_date))) || isSchoolDay(wk);
    const limit = schoolWeek ? L.school_week_hours : L.non_school_week_hours;
    if (hours > limit) out.push({ rule: 'minor_u16_weekly', severity: 'warn', user_id: userId, shift_ids: mine.map((s) => Number(s.id)),
      message: `Under-16 scheduled ${hours.toFixed(1)}h in week of ${wk}; limit ${limit}h${schoolWeek ? ' in a school week (if school is in session)' : ''}.` });
  }
  return out;
}

// ── Fair Workweek: changes to a published shift ─────────────────────
// Inside the notice window an employer-initiated edit or cancellation owes
// predictability pay. Hours-based jurisdictions price it as premium_hours
// (priced at the regular rate by the caller); dollar jurisdictions (US-NYC
// Fair Workweek) price it as premium_cents from the tier table, and
// premium_hours is null — the two never mix. Employee-requested changes
// (swaps, their own request) are recorded with no premium. Pure.
function evaluateChange({ before, after = null, rules, now = new Date(), employeeRequested = false }) {
  const r = rules || resolveRules(null);
  const starts = [before, after].filter(Boolean).map((s) => shiftStartDateTime(s).getTime());
  const soonest = Math.min(...starts);
  const hoursBeforeStart = Math.round(((soonest - now.getTime()) / 3600000) * 100) / 100;
  const notice = r.schedule_notice_hours == null ? null : Number(r.schedule_notice_hours);
  const premiumDue = !employeeRequested && notice != null && hoursBeforeStart >= 0 && hoursBeforeStart < notice;
  // A cancellation (no `after`) or a change that loses hours prices on
  // the reduce/cancel tiers; anything else on the add/change tiers.
  const reducedOrCancelled = after == null || shiftHours(after) < shiftHours(before);
  return {
    premium_due: premiumDue,
    premium_hours: premiumDue ? predictabilityPremiumHours(r) : null,
    premium_cents: premiumDue
      ? predictabilityPremiumCents(r, { hoursBeforeStart, reducedOrCancelled })
      : null,
    hours_before_start: hoursBeforeStart, notice_hours: notice, jurisdiction_code: r.jurisdiction_code,
  };
}

/**
 * Evaluate a batch of shifts (the ones about to be published) against the
 * location's native rules. existingShifts are already-published shifts in
 * the same window for context (weekly totals, consecutive days).
 *
 * Returns an array of { rule, severity, message, user_id, shift_ids }.
 * Pure function: no DB, no throws on bad input.
 */
function evaluateSchedule(shifts, { rules, existingShifts = [], now = new Date() } = {}) {
  const warnings = [];
  const r = rules || resolveRules(null);
  const startDay = workweekStartDay(r);
  const all = [...(existingShifts || []), ...(shifts || [])].filter(Boolean);
  if (!all.length) return warnings;

  const byUser = new Map();
  for (const s of all) {
    if (!s.user_id) continue;
    const list = byUser.get(String(s.user_id)) || [];
    list.push(s);
    byUser.set(String(s.user_id), list);
  }

  const publishedIds = new Set((shifts || []).map((s) => Number(s.id)));

  for (const [userId, list] of byUser) {
    const mine = list.filter((s) => publishedIds.has(Number(s.id)));
    if (!mine.length) continue;
    const shiftIds = mine.map((s) => Number(s.id));

    // ── Daily overtime / double time (e.g. California) ──────────────
    if (r.daily_overtime_hours != null) {
      const byDay = new Map();
      for (const s of list) {
        const key = String(s.shift_date);
        byDay.set(key, (byDay.get(key) || 0) + shiftHours(s));
      }
      for (const [day, hours] of byDay) {
        const onThisPublish = list.some((s) => String(s.shift_date) === day && publishedIds.has(Number(s.id)));
        if (!onThisPublish) continue;
        if (hours > Number(r.daily_doubletime_hours || Infinity)) {
          warnings.push({
            rule: 'daily_doubletime', severity: 'warn', user_id: userId, shift_ids: shiftIds,
            message: `${hours.toFixed(1)}h scheduled on ${day} exceeds the ${r.daily_doubletime_hours}h double-time threshold.`,
          });
        } else if (hours > Number(r.daily_overtime_hours)) {
          warnings.push({
            rule: 'daily_overtime', severity: 'info', user_id: userId, shift_ids: shiftIds,
            message: `${hours.toFixed(1)}h scheduled on ${day} exceeds the ${r.daily_overtime_hours}h daily overtime threshold.`,
          });
        }
      }
    }

    // ── Weekly overtime (FLSA 40h and friends) ───────────────────────
    if (r.weekly_overtime_hours != null) {
      const byWeek = new Map();
      for (const s of list) {
        const key = weekKey(String(s.shift_date), startDay);
        byWeek.set(key, (byWeek.get(key) || 0) + shiftHours(s));
      }
      for (const [week, hours] of byWeek) {
        const onThisPublish = list.some((s) => weekKey(String(s.shift_date), startDay) === week && publishedIds.has(Number(s.id)));
        if (!onThisPublish) continue;
        if (hours > Number(r.weekly_overtime_hours)) {
          warnings.push({
            rule: 'weekly_overtime', severity: 'warn', user_id: userId, shift_ids: shiftIds,
            message: `${hours.toFixed(1)}h in week of ${week} exceeds the ${r.weekly_overtime_hours}h weekly overtime threshold.`,
          });
        }
      }
    }

    // ── Clopening: minimum rest between consecutive shifts ───────────
    if (r.min_rest_between_shifts_hours != null) {
      const sorted = [...list].sort((a, b) => shiftStartDateTime(a) - shiftStartDateTime(b));
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (!publishedIds.has(Number(cur.id)) && !publishedIds.has(Number(prev.id))) continue;
        const restH = (shiftStartDateTime(cur) - shiftEndDateTime(prev)) / 3600000;
        if (restH >= 0 && restH < Number(r.min_rest_between_shifts_hours)) {
          warnings.push({
            rule: 'min_rest_between_shifts', severity: 'warn', user_id: userId,
            shift_ids: [Number(prev.id), Number(cur.id)],
            message: `Only ${restH.toFixed(1)}h rest between shifts on ${prev.shift_date} and ${cur.shift_date} (minimum ${r.min_rest_between_shifts_hours}h).`,
          });
        }
      }
    }

    // ── Meal break prompt: long single shifts without a break flag ───
    if (r.meal_break_after_minutes != null) {
      for (const s of mine) {
        const mins = shiftHours(s) * 60;
        if (mins >= Number(r.meal_break_after_minutes) && !s.has_meal_break) {
          warnings.push({
            rule: 'meal_break', severity: 'info', user_id: userId, shift_ids: [Number(s.id)],
            message: `Shift on ${s.shift_date} is ${(mins / 60).toFixed(1)}h: schedule a ${r.meal_break_duration_minutes || 30}-minute meal break.`,
          });
        }
      }
    }

    // ── Minor hour limits ────────────────────────────────────────────
    // State limits come from the jurisdiction row; the federal under-16
    // rules (FLSA child labor, 29 CFR 570.35) apply everywhere on top.
    const minorShifts = mine.filter((s) => s.is_minor || s.minor_band);
    if (minorShifts.length) {
      const publishDays = new Set(minorShifts.map((s) => String(s.shift_date)));
      const dayHours = new Map();
      const weekHours = new Map();
      for (const s of list) {
        dayHours.set(String(s.shift_date), (dayHours.get(String(s.shift_date)) || 0) + shiftHours(s));
        const wk = weekKey(String(s.shift_date), startDay);
        weekHours.set(wk, (weekHours.get(wk) || 0) + shiftHours(s));
      }
      if (r.minor_max_daily_hours != null) {
        for (const day of publishDays) {
          const hours = dayHours.get(day) || 0;
          if (hours > Number(r.minor_max_daily_hours)) {
            warnings.push({
              rule: 'minor_daily_hours', severity: 'warn', user_id: userId, shift_ids: shiftIds,
              message: `Minor scheduled ${hours.toFixed(1)}h on ${day} (limit ${r.minor_max_daily_hours}h).`,
            });
          }
        }
      }
      if (r.minor_max_weekly_hours != null) {
        for (const wk of new Set([...publishDays].map((d) => weekKey(d, startDay)))) {
          const hours = weekHours.get(wk) || 0;
          if (hours > Number(r.minor_max_weekly_hours)) {
            warnings.push({
              rule: 'minor_weekly_hours', severity: 'warn', user_id: userId, shift_ids: shiftIds,
              message: `Minor scheduled ${hours.toFixed(1)}h in week of ${wk} (limit ${r.minor_max_weekly_hours}h).`,
            });
          }
        }
      }
      if (r.minor_latest_end_time) {
        for (const s of minorShifts) {
          const end = String(s.end_time || '').slice(0, 5);
          const overnight = shiftHours(s) > 0 && end <= String(s.start_time || '').slice(0, 5);
          if (end && (overnight || end > String(r.minor_latest_end_time).slice(0, 5))) {
            warnings.push({
              rule: 'minor_latest_end', severity: 'warn', user_id: userId, shift_ids: [Number(s.id)],
              message: `Minor shift on ${s.shift_date} ends at ${end} (limit ${r.minor_latest_end_time}).`,
            });
          }
        }
      }
      const under16 = minorShifts.filter((s) => s.minor_band === 'under_16');
      if (under16.length) warnings.push(...under16Warnings(userId, under16, list, startDay));
    }

    // ── Predictive-scheduling advance notice ─────────────────────────
    if (r.schedule_notice_hours != null) {
      for (const s of mine) {
        const hoursOut = (shiftStartDateTime(s) - now) / 3600000;
        if (hoursOut >= 0 && hoursOut < Number(r.schedule_notice_hours)) {
          warnings.push({
            rule: 'schedule_notice', severity: 'warn', user_id: userId, shift_ids: [Number(s.id)],
            message: `Shift on ${s.shift_date} is published ${Math.max(0, Math.round(hoursOut))}h ahead; ${r.schedule_notice_hours}h notice is required (${r.jurisdiction_code}).`,
          });
          break; // one notice warning per person per publish is enough
        }
      }
    }
  }

  return warnings;
}

// ── Phase 7: punch-time minor check ──────────────────────────────────
// evaluateSchedule only warns at publish; a minor could still punch in
// for a non-compliant shift. This is the punch-time counterpart, pure
// so the clock-in handler and tests share it exactly.
//
// Inputs are all business-local wall-clock values for the day of the
// punch: clockInTime 'HH:MM', the day's published shift (or null),
// hours already worked today / this week (closed punches only; the
// open punch being created is not counted yet), and the projected
// totals if the shift runs to its scheduled end.
//
// A violation BLOCKS the punch (409 with the rule named): the law
// states a hard limit and the punch would break it. A missing
// published shift only WARNS (flagged on the punch for a manager):
// plenty of legitimate shifts are unscheduled cover, and stranding a
// minor at the door over a missing schedule row is not enforcement,
// it is a staffing failure. The under-16 school-day / school-week
// hour caps also only WARN (finding 31, applied per review): whether
// a weekday is a school day is a guessed calendar, so the cap is
// advisory until a school calendar input exists; the non-school caps
// and the work window still block. An expired minor_until (band no longer
// applies) returns applies:false.
function evaluateMinorPunch({
  band, minorUntil = null, rules,
  workDate, clockInTime, shift = null,
  hoursWorkedToday = 0, hoursWorkedThisWeek = 0,
} = {}) {
  const r = rules || resolveRules(null);
  if (!band || (band !== 'under_16' && band !== 'age_16_17')) return { applies: false, violations: [], warnings: [], blocked: false };
  if (minorUntil && workDate && String(workDate) > String(minorUntil)) {
    return { applies: false, violations: [], warnings: [], blocked: false };
  }
  const violations = [];
  const warnings = [];
  const shiftHoursValue = shift ? shiftHours(shift) : 0;
  const projectedDayHours = Math.round((Number(hoursWorkedToday) + shiftHoursValue) * 100) / 100;
  const projectedWeekHours = Math.round((Number(hoursWorkedThisWeek) + shiftHoursValue) * 100) / 100;
  const endTime = shift ? String(shift.end_time || '').slice(0, 5) : null;
  if (!shift) {
    warnings.push({
      rule: 'minor_no_shift',
      message: `Minor clocked in on ${workDate} with no published shift for the day; a manager should confirm the shift is compliant.`,
    });
  }
  if (band === 'under_16') {
    const L = FLSA_UNDER_16;
    const latest = isSummer(workDate) ? L.summer_latest_end : L.latest_end;
    if (clockInTime && clockInTime < L.earliest_start) {
      violations.push({ rule: 'minor_u16_window', message: `Under-16 clock-in at ${clockInTime}; federal law allows work from ${L.earliest_start}.` });
    }
    if (endTime && (endTime > latest || (shift && endTime <= String(shift.start_time || '').slice(0, 5)))) {
      violations.push({ rule: 'minor_u16_window', message: `Under-16 shift on ${workDate} ends at ${endTime}; federal law allows work until ${latest}.` });
    }
    const dailyLimit = isSchoolDay(workDate) ? L.school_day_hours : L.non_school_day_hours;
    if (projectedDayHours > dailyLimit) {
      // Finding 31 (applied per review): the school-day cap is
      // advisory, never blocking — the school calendar is a guess
      // (see isSchoolDay), so it warns; the non-school cap still
      // blocks the punch.
      const entry = { rule: 'minor_u16_daily', message: `Under-16 would work ${projectedDayHours}h on ${workDate}; limit ${dailyLimit}h${isSchoolDay(workDate) ? ' on a school day (if school is in session)' : ''}.` };
      if (isSchoolDay(workDate)) warnings.push(entry);
      else violations.push(entry);
    }
    const schoolWeek = isSchoolDay(workDate);
    const weeklyLimit = schoolWeek ? L.school_week_hours : L.non_school_week_hours;
    if (projectedWeekHours > weeklyLimit) {
      const entry = { rule: 'minor_u16_weekly', message: `Under-16 would work ${projectedWeekHours}h in the week of ${workDate}; limit ${weeklyLimit}h${schoolWeek ? ' in a school week (if school is in session)' : ''}.` };
      if (schoolWeek) warnings.push(entry);
      else violations.push(entry);
    }
  } else {
    const dailyLimit = r.minor_max_daily_hours == null ? null : Number(r.minor_max_daily_hours);
    const weeklyLimit = r.minor_max_weekly_hours == null ? null : Number(r.minor_max_weekly_hours);
    const latest = r.minor_latest_end_time ? String(r.minor_latest_end_time).slice(0, 5) : null;
    if (latest && endTime && endTime > latest) {
      violations.push({ rule: 'minor_latest_end', message: `Shift on ${workDate} ends at ${endTime}; the jurisdiction allows minors to work until ${latest}.` });
    }
    if (dailyLimit != null && projectedDayHours > dailyLimit) {
      violations.push({ rule: 'minor_daily', message: `Minor would work ${projectedDayHours}h on ${workDate}; the jurisdiction allows ${dailyLimit}h per day.` });
    }
    if (weeklyLimit != null && projectedWeekHours > weeklyLimit) {
      violations.push({ rule: 'minor_weekly', message: `Minor would work ${projectedWeekHours}h this week; the jurisdiction allows ${weeklyLimit}h per week.` });
    }
  }
  return { applies: true, band, violations, warnings, blocked: violations.length > 0 };
}

module.exports = {
  PRESETS,
  RULE_COLUMNS,
  resolveRules,
  getJurisdiction,
  getJurisdictions,
  predictabilityPremiumHours,
  predictabilityPremiumCents,
  mealBreakPremiumHours,
  weekStartOf,
  workweekStartDay,
  customRulesErrors,
  assertPayableRules,
  evaluateSchedule,
  evaluateChange,
  evaluateMinorPunch,
  FLSA_UNDER_16,
  isSchoolDay,
  isSummer,
};
