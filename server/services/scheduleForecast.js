'use strict';

// Phase 4 Track B (goal goal_a0fc7c0f0394): scheduled-cost forecast.
//
// A read-only projection over DRAFT shifts (published_at IS NULL) for
// a date range, for the scheduler UI only. It never writes pay lines,
// never touches a pay run, and never corrects the ledger.
//
// Math, per person per workweek (the jurisdiction's workweek start,
// Sunday by default):
//   scheduled hours = sum of draft shift durations (overnight shifts
//   count past midnight, via the same shiftHours as Track A's
//   validation, so the forecast and the validator agree on a shift's
//   length).
//   regular hours = min(scheduled, overtime threshold)
//   overtime hours = max(0, scheduled - threshold)
//   cost = regular * wage + overtime * wage * overtime multiplier
// The threshold and multiplier come from the restaurant's labor policy
// (the same getLaborPolicy computeLabor uses); the caller resolves the
// policy and passes the numbers in, so this module stays pure and
// testable against a fake db.
//
// Wage of record, same rules as computeLabor's getRoster: the
// per-store hourly rate (restaurant_location_memberships, hourly only)
// wins over business_members.hourly_wage_cents, which wins over the
// hourly invite rate on business_members.pay_rate_cents. Non-hourly
// rates are not wages: those people surface in missing_wage_user_ids
// with their hours counted and their cost left null, never silently
// misconverted.

const { shiftHours } = require('./shiftConflictValidation');
const laborJurisdiction = require('./laborJurisdictionRules');

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

async function computeScheduleForecast(db, {
  businessId, from, to,
  overtimeThresholdHours = 40, overtimeMultiplierBps = 15000,
  workweekStartDay = 0,
}) {
  const { rows: shifts } = await db.query(
    `SELECT s.id, s.user_id,
            s.shift_date::text AS shift_date,
            s.start_time::text AS start_time,
            s.end_time::text AS end_time,
            s.role_label,
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

  const byPerson = new Map();
  const byWeek = new Map();
  const missingWage = new Set();
  let totalHours = 0;
  let totalRegularHours = 0;
  let totalOvertimeHours = 0;
  let totalCostCents = 0;

  const startDay = laborJurisdiction.workweekStartDay({ workweek_start_day: workweekStartDay });
  // Hours are tallied per person per week first: overtime is a weekly
  // threshold, so a person at 45 hours in one week and 10 in the next
  // owes 5 overtime hours, not 15.
  const weekly = new Map(); // `${userId}|${week}` -> { userId, name, wage, week, hours }
  for (const shift of shifts || []) {
    const hours = shiftHours(shift);
    const week = weekStartOf(String(shift.shift_date).slice(0, 10), startDay);
    const key = `${shift.user_id}|${week}`;
    let entry = weekly.get(key);
    if (!entry) {
      entry = {
        user_id: shift.user_id,
        user_name: shift.user_name || null,
        hourly_wage_cents: shift.hourly_wage_cents == null ? null : Number(shift.hourly_wage_cents),
        week_start: week,
        hours: 0,
      };
      weekly.set(key, entry);
    }
    entry.hours = round2(entry.hours + hours);
  }

  for (const entry of weekly.values()) {
    const regular = Math.min(entry.hours, overtimeThresholdHours);
    const overtime = round2(Math.max(0, entry.hours - overtimeThresholdHours));
    const wage = entry.hourly_wage_cents;
    const cost = wage == null
      ? null
      : Math.round(regular * wage + overtime * wage * (overtimeMultiplierBps / 10000));
    if (wage == null) missingWage.add(entry.user_id);
    totalHours = round2(totalHours + entry.hours);
    totalRegularHours = round2(totalRegularHours + regular);
    totalOvertimeHours = round2(totalOvertimeHours + overtime);
    if (cost != null) totalCostCents += cost;

    let person = byPerson.get(entry.user_id);
    if (!person) {
      person = {
        user_id: entry.user_id,
        user_name: entry.user_name,
        hourly_wage_cents: wage,
        hours: 0, regular_hours: 0, overtime_hours: 0,
        cost_cents: wage == null ? null : 0,
        projected_overtime: false,
      };
      byPerson.set(entry.user_id, person);
    }
    person.hours = round2(person.hours + entry.hours);
    person.regular_hours = round2(person.regular_hours + regular);
    person.overtime_hours = round2(person.overtime_hours + overtime);
    if (cost != null) person.cost_cents += cost;
    if (overtime > 0) person.projected_overtime = true;

    let week = byWeek.get(entry.week_start);
    if (!week) {
      week = { week_start: entry.week_start, hours: 0, overtime_hours: 0, cost_cents: 0 };
      byWeek.set(entry.week_start, week);
    }
    week.hours = round2(week.hours + entry.hours);
    week.overtime_hours = round2(week.overtime_hours + overtime);
    if (cost != null) week.cost_cents += cost;
  }

  return {
    from, to,
    overtime_threshold_hours: overtimeThresholdHours,
    overtime_multiplier_bps: overtimeMultiplierBps,
    workweek_start_day: startDay,
    draft_shift_count: (shifts || []).length,
    total_hours: totalHours,
    total_regular_hours: totalRegularHours,
    total_overtime_hours: totalOvertimeHours,
    total_cost_cents: totalCostCents,
    missing_wage_user_ids: [...missingWage],
    per_person: [...byPerson.values()].sort((a, b) => (a.user_name || '').localeCompare(b.user_name || '')),
    per_week: [...byWeek.values()].sort((a, b) => a.week_start.localeCompare(b.week_start)),
  };
}

module.exports = { computeScheduleForecast, weekStartOf };
