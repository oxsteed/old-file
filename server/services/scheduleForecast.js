'use strict';

// Phase 4 Track B (goal goal_a0fc7c0f0394): scheduled-cost forecast.
//
// A read-only projection over DRAFT shifts (published_at IS NULL) for
// a date range, for the scheduler UI only. It never writes pay lines,
// never touches a pay run, and never corrects the ledger.
//
// Math (finding 36): the forecast reuses restaurantPayrollService
// tierRows, the same hour tiering pay uses, so the projected cost
// reflects daily overtime, double time, 7th-day overtime, weekly
// overtime, and missed-meal premiums the same way pay does. The old
// weekly-threshold-only math understated every schedule with a long
// day, a 7th consecutive day, or a missed meal break. The labor policy
// (thresholds, overtime / double-time multipliers, break minutes)
// comes from the caller, resolved the same way computeLabor resolves
// it; the jurisdiction rules come from the locations' rows.
//
// Draft shifts carry no break record, so the forecast assumes no meal
// break is taken: a day whose hours pass the meal-break point accrues
// the missed-meal premium where the jurisdiction pays one. That is
// the cost-inclusive reading of the schedule as written; scheduling a
// break removes the premium from the forecast, exactly as taking one
// removes it from pay.
//
// Overnight shifts are split at local midnight before tiering (via
// tierRows' split): the clock times are synthesized from the shift's
// wall-clock start/end in the store's timezone, so the hours land on
// the local dates they were worked. A store with no timezone falls
// back to UTC and the shift stays whole on its start date.
//
// The forecast uses one workweek definition (the caller's
// workweekStartDay, resolved from the jurisdiction by the endpoint):
// each location's rules are applied with that week start overridden,
// so tierRows' internal week grouping and the forecast's per-week
// output agree. A location with no jurisdiction row resolves to the
// US-FED preset, exactly like pay.
//
// Wage of record, same rules as computeLabor's getRoster: the
// per-store hourly rate (restaurant_location_memberships, hourly only)
// wins over business_members.hourly_wage_cents, which wins over the
// hourly invite rate on business_members.pay_rate_cents. Non-hourly
// rates are not wages: those people surface in missing_wage_user_ids
// with their hours counted and their cost left null, never silently
// misconverted. Where one person has different wages at different
// stores, the first wage seen wins (the same approximation the old
// forecast made).

const { shiftHours } = require('./shiftConflictValidation');
const laborJurisdiction = require('./laborJurisdictionRules');
const punchHours = require('./restaurantPunchHours');
const { tierRows } = require('./restaurantPayrollService');

// The workweek starts on the jurisdiction's workweek_start_day
// (Sunday by default); see laborJurisdictionRules.weekStartOf. The
// forecast groups draft shifts by that week, never a hardcoded Monday
// week, so the projected overtime lines up with the pay calc's weeks.
function weekStartOf(dateStr, startDay) {
  return laborJurisdiction.weekStartOf(dateStr, startDay);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function addDays(dateStr, days) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toMinutes(time) {
  const m = String(time || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

async function computeScheduleForecast(db, {
  businessId, from, to,
  policy = null,
  overtimeThresholdHours = null, overtimeMultiplierBps = null,
  workweekStartDay = 0,
  restaurantId = null,
}) {
  const { rows: shifts } = await db.query(
    `SELECT s.id, s.user_id,
            s.shift_date::text AS shift_date,
            s.start_time::text AS start_time,
            s.end_time::text AS end_time,
            s.role_label,
            s.location_id, s.restaurant_id,
            COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS user_name,
            COALESCE(
              CASE WHEN lm.pay_rate_period = 'hour' THEN lm.pay_rate_cents END,
              bm.hourly_wage_cents,
              CASE WHEN bm.pay_rate_period = 'hour' THEN bm.pay_rate_cents END
            ) AS hourly_wage_cents
       FROM business_staff_shifts s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN business_members bm
              ON bm.business_id = s.business_id AND bm.member_id = s.user_id
       LEFT JOIN restaurant_location_memberships lm
              ON lm.membership_id = bm.id AND lm.location_id = s.location_id
             AND (s.restaurant_id IS NULL OR lm.restaurant_id = s.restaurant_id)
             AND lm.status = 'active'
      WHERE s.business_id = $1 AND s.published_at IS NULL
        AND s.shift_date >= $2::date AND s.shift_date <= $3::date
      ORDER BY s.shift_date, s.start_time`,
    [businessId, from, to]
  );

  const startDay = laborJurisdiction.workweekStartDay({ workweek_start_day: workweekStartDay });
  // The full labor policy (thresholds, multipliers, break minutes),
  // as computeLabor uses it. Callers that only pass the old scalar
  // threshold/multiplier get the same defaults pay uses.
  const laborPolicy = policy || {
    overtime_threshold_hours: overtimeThresholdHours ?? 40,
    overtime_threshold_explicit: overtimeThresholdHours != null,
    overtime_multiplier_bps: overtimeMultiplierBps ?? 15000,
    doubletime_multiplier_bps: 20000,
    break_after_minutes: 360,
    break_duration_minutes: 30,
  };
  const otMult = Number(laborPolicy.overtime_multiplier_bps) / 10000;
  const dtMult = Number(laborPolicy.doubletime_multiplier_bps) / 10000;

  // Jurisdiction rules and timezones per location, only when the
  // forecast is scoped to a restaurant. Without a restaurant there
  // are no locations to resolve and the US-FED preset applies, so no
  // extra query runs at all.
  const rulesByLocation = new Map();
  const timezoneByLocation = new Map();
  const locationIds = [...new Set(
    (shifts || []).map((s) => s.location_id).filter((id) => id != null)
  )].map(Number);
  if (restaurantId != null && locationIds.length) {
    const { rows: locRows } = await db.query(
      'SELECT id, timezone FROM restaurant_locations WHERE restaurant_id = $1 AND id = ANY($2::bigint[])',
      [restaurantId, locationIds]
    );
    for (const loc of locRows || []) {
      if (loc.timezone) timezoneByLocation.set(Number(loc.id), String(loc.timezone));
    }
    const rulesMap = await laborJurisdiction.getJurisdictions(db, restaurantId, locationIds);
    for (const [locId, rules] of rulesMap) rulesByLocation.set(locId, rules);
  }
  // One week definition for the whole forecast: each location's rules
  // carry the caller's workweek start (a copy, never the shared
  // preset), so tierRows' week grouping matches this output.
  const rulesResolver = (locationId) => {
    const base = (locationId == null ? null : rulesByLocation.get(Number(locationId)))
      || laborJurisdiction.resolveRules(null);
    return { ...base, workweek_start_day: startDay };
  };
  const timezoneFor = (locationId) => (
    locationId == null ? null : (timezoneByLocation.get(Number(locationId)) || null)
  );

  // tierRows input: one row per draft shift, with epoch clock times
  // synthesized in the store's timezone so overnight shifts split at
  // local midnight. No break record exists on a draft shift, so breaks
  // are empty and the missed-meal premium is priced as owed (see the
  // header note). Rows without usable clock times stay whole on their
  // start date, exactly like pay rows without clock times.
  const tierInput = [];
  const wageByUser = new Map();
  const nameByUser = new Map();
  for (const shift of shifts || []) {
    const date = String(shift.shift_date).slice(0, 10);
    const start = String(shift.start_time).slice(0, 5);
    const end = String(shift.end_time).slice(0, 5);
    const startMin = toMinutes(start);
    const endMin = toMinutes(end);
    const overnight = startMin != null && endMin != null && endMin <= startMin;
    const tz = timezoneFor(shift.location_id);
    let clockInAt = null;
    let clockOutAt = null;
    if (startMin != null && endMin != null) {
      const inMs = punchHours.zonedTimeToUtc(date, start, tz || 'UTC');
      const outMs = punchHours.zonedTimeToUtc(overnight ? addDays(date, 1) : date, end, tz || 'UTC');
      if (Number.isFinite(inMs) && Number.isFinite(outMs) && outMs > inMs) {
        clockInAt = new Date(inMs).toISOString();
        clockOutAt = new Date(outMs).toISOString();
      }
    }
    tierInput.push({
      id: shift.id,
      user_id: shift.user_id,
      entry_date: date,
      hours_worked: shiftHours(shift),
      breaks: [],
      clock_in_at: clockInAt,
      clock_out_at: clockOutAt,
      location_id: shift.location_id == null ? null : Number(shift.location_id),
    });
    if (!wageByUser.has(shift.user_id)) {
      wageByUser.set(
        shift.user_id,
        shift.hourly_wage_cents == null ? null : Number(shift.hourly_wage_cents)
      );
      nameByUser.set(shift.user_id, shift.user_name || null);
    }
  }

  const { byUser, allocations } = tierRows(
    tierInput, laborPolicy, rulesResolver,
    { timezoneFor, defaultTimezone: 'UTC' }
  );

  const costFor = (wage, tiers) => {
    if (wage == null) return null;
    return Math.round(
      tiers.regular * wage
      + tiers.overtime * wage * otMult
      + tiers.doubletime * wage * dtMult
      + tiers.mealPremium * wage
    );
  };

  const byPerson = new Map();
  const byWeek = new Map();
  const missingWage = new Set();
  let totalHours = 0;
  let totalRegularHours = 0;
  let totalOvertimeHours = 0;
  let totalDoubletimeHours = 0;
  let totalMealPremiumHours = 0;
  let totalCostCents = 0;

  for (const [userId, tiers] of byUser) {
    const wage = wageByUser.get(userId);
    if (wage == null) missingWage.add(userId);
    const personTiers = {
      regular: tiers.regularHours, overtime: tiers.overtimeHours,
      doubletime: tiers.doubletimeHours, mealPremium: tiers.mealBreakPremiumHours,
    };
    const cost = costFor(wage, personTiers);
    totalHours = round2(totalHours + tiers.totalHours);
    totalRegularHours = round2(totalRegularHours + tiers.regularHours);
    totalOvertimeHours = round2(totalOvertimeHours + tiers.overtimeHours);
    totalDoubletimeHours = round2(totalDoubletimeHours + tiers.doubletimeHours);
    totalMealPremiumHours = round2(totalMealPremiumHours + tiers.mealBreakPremiumHours);
    if (cost != null) totalCostCents += cost;
    byPerson.set(userId, {
      user_id: userId,
      user_name: nameByUser.get(userId) || null,
      hourly_wage_cents: wage,
      hours: tiers.totalHours,
      regular_hours: tiers.regularHours,
      overtime_hours: tiers.overtimeHours,
      doubletime_hours: tiers.doubletimeHours,
      meal_break_premium_hours: tiers.mealBreakPremiumHours,
      missed_meal_breaks: tiers.missedMealBreaks,
      cost_cents: cost,
      projected_overtime: tiers.overtimeHours > 0 || tiers.doubletimeHours > 0,
    });
  }

  for (const alloc of allocations) {
    const wage = wageByUser.get(alloc.user_id);
    const week = weekStartOf(alloc.entry_date, startDay);
    let entry = byWeek.get(week);
    if (!entry) {
      entry = {
        week_start: week, hours: 0, overtime_hours: 0,
        doubletime_hours: 0, meal_break_premium_hours: 0, cost_cents: 0,
      };
      byWeek.set(week, entry);
    }
    const allocHours = round2(alloc.regular + alloc.overtime + alloc.doubletime);
    entry.hours = round2(entry.hours + allocHours);
    entry.overtime_hours = round2(entry.overtime_hours + alloc.overtime);
    entry.doubletime_hours = round2(entry.doubletime_hours + alloc.doubletime);
    entry.meal_break_premium_hours = round2(entry.meal_break_premium_hours + alloc.meal_break_premium_hours);
    const allocCost = costFor(wage, {
      regular: alloc.regular, overtime: alloc.overtime,
      doubletime: alloc.doubletime, mealPremium: alloc.meal_break_premium_hours,
    });
    if (allocCost != null) entry.cost_cents += allocCost;
  }

  return {
    from, to,
    overtime_threshold_hours: Number(laborPolicy.overtime_threshold_hours),
    overtime_multiplier_bps: Number(laborPolicy.overtime_multiplier_bps),
    doubletime_multiplier_bps: Number(laborPolicy.doubletime_multiplier_bps),
    workweek_start_day: startDay,
    draft_shift_count: (shifts || []).length,
    total_hours: totalHours,
    total_regular_hours: totalRegularHours,
    total_overtime_hours: totalOvertimeHours,
    total_doubletime_hours: totalDoubletimeHours,
    total_meal_break_premium_hours: totalMealPremiumHours,
    total_cost_cents: totalCostCents,
    missing_wage_user_ids: [...missingWage],
    per_person: [...byPerson.values()].sort((a, b) => (a.user_name || '').localeCompare(b.user_name || '')),
    per_week: [...byWeek.values()].sort((a, b) => a.week_start.localeCompare(b.week_start)),
  };
}

module.exports = { computeScheduleForecast, weekStartOf };
