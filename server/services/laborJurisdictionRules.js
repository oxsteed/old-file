// OxSteed Restaurants — S-20 native labor-law jurisdiction rules engine.
//
// This is the NATIVE engine: it evaluates only rule parameters stored in
// restaurant_labor_jurisdictions (per location), never a vendor API.
// Vendor rule sets (7shifts, Homebase, Fourth) remain Emile's call; when a
// vendor is connected its findings would arrive through a separate adapter,
// not through this module.
//
// Jurisdiction presets encode the well-known statutory baselines:
//
//   US-FED : 40h weekly overtime (FLSA).
//   US-CA  : 8h daily OT, 12h double time, 7th consecutive day OT, 10h rest
//            between shifts (clopening guard), 30-min meal break after 5h.
//   US-NYC : Fair Workweek fast-food: 14-day advance notice (predictability),
//            11h rest between shifts. US-SFO / US-SEA / US-CHI / US-OR share
//            the Fair Workweek family with their own notice/rest values.
//   CUSTOM : every parameter set explicitly per location.
//
// The engine is advisory: evaluateSchedule returns warnings; the publish
// endpoint stores them on the schedule version (evidence) and returns them
// to the manager. Nothing here blocks a publish.

'use strict';

const logger = require('../utils/logger');

const PRESETS = {
  'US-FED': {
    weekly_overtime_hours: 40,
    daily_overtime_hours: null,
    daily_doubletime_hours: null,
    seventh_day_overtime: false,
    min_rest_between_shifts_hours: 8,
    meal_break_after_minutes: 360,
    meal_break_duration_minutes: 30,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 40,
    minor_latest_end_time: '22:00',
    schedule_notice_hours: null,
  },
  'US-CA': {
    weekly_overtime_hours: 40,
    daily_overtime_hours: 8,
    daily_doubletime_hours: 12,
    seventh_day_overtime: true,
    min_rest_between_shifts_hours: 10,
    meal_break_after_minutes: 300,
    meal_break_duration_minutes: 30,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 48,
    minor_latest_end_time: '22:00',
    schedule_notice_hours: null,
  },
  'US-NYC': {
    weekly_overtime_hours: 40,
    daily_overtime_hours: null,
    daily_doubletime_hours: null,
    seventh_day_overtime: false,
    min_rest_between_shifts_hours: 11,
    meal_break_after_minutes: 360,
    meal_break_duration_minutes: 30,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 40,
    minor_latest_end_time: '22:00',
    schedule_notice_hours: 336, // 14 days, Fair Workweek predictability
  },
  'US-SFO': {
    weekly_overtime_hours: 40,
    daily_overtime_hours: 8,
    daily_doubletime_hours: 12,
    seventh_day_overtime: true,
    min_rest_between_shifts_hours: 11,
    meal_break_after_minutes: 300,
    meal_break_duration_minutes: 30,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 48,
    minor_latest_end_time: '22:00',
    schedule_notice_hours: 336,
  },
  'US-SEA': {
    weekly_overtime_hours: 40,
    daily_overtime_hours: null,
    daily_doubletime_hours: null,
    seventh_day_overtime: false,
    min_rest_between_shifts_hours: 10,
    meal_break_after_minutes: 360,
    meal_break_duration_minutes: 30,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 40,
    minor_latest_end_time: '22:00',
    schedule_notice_hours: 336,
  },
  'US-CHI': {
    weekly_overtime_hours: 40,
    daily_overtime_hours: null,
    daily_doubletime_hours: null,
    seventh_day_overtime: false,
    min_rest_between_shifts_hours: 10,
    meal_break_after_minutes: 450,
    meal_break_duration_minutes: 20,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 40,
    minor_latest_end_time: '21:00',
    schedule_notice_hours: 240, // 10 days
  },
  'US-OR': {
    weekly_overtime_hours: 40,
    daily_overtime_hours: null,
    daily_doubletime_hours: null,
    seventh_day_overtime: false,
    min_rest_between_shifts_hours: 10,
    meal_break_after_minutes: 360,
    meal_break_duration_minutes: 30,
    minor_max_daily_hours: 8,
    minor_max_weekly_hours: 40,
    minor_latest_end_time: '22:00',
    schedule_notice_hours: 336,
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
  'minor_max_daily_hours',
  'minor_max_weekly_hours',
  'minor_latest_end_time',
  'schedule_notice_hours',
];

// Merge the stored row over its preset: explicit NULLs fall back to the
// preset, so a location only overrides what it means to.
function resolveRules(row) {
  const code = row?.jurisdiction_code || 'US-FED';
  const preset = PRESETS[code] || PRESETS['US-FED'];
  const rules = { jurisdiction_code: code };
  for (const col of RULE_COLUMNS) {
    const stored = row ? row[col] : null;
    rules[col] = stored === null || stored === undefined ? preset[col] : stored;
  }
  return rules;
}

async function getJurisdiction(db, restaurantId, locationId) {
  if (!restaurantId || !locationId) return resolveRules(null);
  try {
    const { rows: [row] } = await db.query(
      `SELECT * FROM restaurant_labor_jurisdictions
        WHERE restaurant_id = $1 AND location_id = $2 AND is_active
        LIMIT 1`,
      [restaurantId, locationId]
    );
    return resolveRules(row || null);
  } catch (err) {
    logger.warn('laborJurisdictionRules.getJurisdiction failed', { err: err.message });
    return resolveRules(null);
  }
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

// Week key (Monday-start) for weekly overtime accounting.
function weekKey(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
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
function under16Warnings(userId, mine, list) {
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
  for (const wk of new Set(mine.map((s) => weekKey(String(s.shift_date))))) {
    const weekShifts = list.filter((s) => weekKey(String(s.shift_date)) === wk);
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
// predictability pay (amount set by local law; recorded, not computed).
// Employee-requested changes (swaps, their own request) are recorded with
// no premium. Pure.
function evaluateChange({ before, after = null, rules, now = new Date(), employeeRequested = false }) {
  const r = rules || resolveRules(null);
  const starts = [before, after].filter(Boolean).map((s) => shiftStartDateTime(s).getTime());
  const soonest = Math.min(...starts);
  const hoursBeforeStart = Math.round(((soonest - now.getTime()) / 3600000) * 100) / 100;
  const notice = r.schedule_notice_hours == null ? null : Number(r.schedule_notice_hours);
  const premiumDue = !employeeRequested && notice != null && hoursBeforeStart >= 0 && hoursBeforeStart < notice;
  return { premium_due: premiumDue, hours_before_start: hoursBeforeStart, notice_hours: notice, jurisdiction_code: r.jurisdiction_code };
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
        const key = weekKey(String(s.shift_date));
        byWeek.set(key, (byWeek.get(key) || 0) + shiftHours(s));
      }
      for (const [week, hours] of byWeek) {
        const onThisPublish = list.some((s) => weekKey(String(s.shift_date)) === week && publishedIds.has(Number(s.id)));
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
        const wk = weekKey(String(s.shift_date));
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
        for (const wk of new Set([...publishDays].map(weekKey))) {
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
      if (under16.length) warnings.push(...under16Warnings(userId, under16, list));
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

module.exports = {
  PRESETS,
  RULE_COLUMNS,
  resolveRules,
  getJurisdiction,
  evaluateSchedule,
  evaluateChange,
  FLSA_UNDER_16,
  isSchoolDay,
  isSummer,
};
