'use strict';

// Phase 7 (gap 17): break attestation at clock-out.
//
// The employee states, on their own record, whether they took their
// meal break (and rest break), or waived/missed it and why. The
// attestation is EVIDENCE, not a pay override:
//
//   - The meal-break premium is still computed by the Phase 1 math
//     (restaurantPayrollService.tierRows) from the punch record
//     (hours + recorded breaks + jurisdiction rules). Nothing here
//     re-derives or replaces that math.
//   - A waived/missed break where the jurisdiction requires a premium
//     therefore already flows through the premium line; the attestation
//     confirms it and surfaces it in the exceptions report.
//   - An attestation that disagrees with the punch record is stored as
//     disputed and surfaced for a manager; it never suppresses a premium
//     the punch record owes. Failing closed toward paying the worker.
//   - A missing attestation on a qualifying shift does not block
//     clock-out (a worker must never be stranded by a prompt), but the
//     clock-out response flags it and the exceptions report counts it
//     via the attestation summary.

const { AppError } = require('../middleware/errorHandler');
const laborJurisdiction = require('./laborJurisdictionRules');
const { breakSeconds, computedHours } = require('./restaurantPunchHours');

function entryBreakMinutes(entry, nowMs = Date.now()) {
  return breakSeconds(entry?.breaks, nowMs) / 60;
}

// Does this closed punch show a missed meal break under the
// jurisdiction rules? Same test tierRows applies: shift long enough
// that a meal break was due, recorded breaks shorter than required.
function punchShowsMissedMeal(entry, rules) {
  const hours = Math.max(0, Number(entry?.hours_worked) || computedHours(entry) || 0);
  const breakMinutes = entryBreakMinutes(entry);
  if (rules.meal_break_after_minutes == null) return false;
  return hours * 60 >= Number(rules.meal_break_after_minutes)
    && breakMinutes < Number(rules.meal_break_duration_minutes ?? 0);
}

async function resolveRestaurantId(db, businessId, locationId) {
  if (locationId != null) {
    const { rows: [row] } = await db.query(
      'SELECT restaurant_id FROM restaurant_locations WHERE id = $1',
      [locationId]
    );
    if (row?.restaurant_id != null) return Number(row.restaurant_id);
  }
  const { rows: [row] } = await db.query(
    'SELECT id FROM food_restaurants WHERE business_id = $1 ORDER BY id LIMIT 1',
    [businessId]
  );
  return row ? Number(row.id) : null;
}

async function recordBreakAttestation(db, {
  businessId, userId, timeEntryId,
  mealBreakTaken, restBreakTaken = false, waived = false,
  waiverReason = null, attestedBy = null,
} = {}) {
  if (mealBreakTaken !== true && mealBreakTaken !== false) {
    throw new AppError('mealBreakTaken is required', 400, 'validation_failed');
  }
  if (waived && mealBreakTaken) {
    throw new AppError('A break cannot be both taken and waived', 400, 'validation_failed');
  }
  if (waived && (waiverReason == null || String(waiverReason).trim() === '')) {
    throw new AppError('A waiver reason is required', 400, 'validation_failed');
  }
  const { rows: [entry] } = await db.query(
    `SELECT * FROM business_time_entries WHERE id = $1 AND business_id = $2`,
    [timeEntryId, businessId]
  );
  if (!entry || entry.voided_at) throw new AppError('Time entry not found', 404, 'time_entry_not_found');
  if (String(entry.user_id) !== String(userId)) {
    throw new AppError('Attestation must come from the entry owner', 403, 'forbidden');
  }
  const restaurantId = await resolveRestaurantId(db, businessId, entry.location_id);
  const rules = await laborJurisdiction.getJurisdiction(db, restaurantId, entry.location_id);
  const missedByPunch = punchShowsMissedMeal(entry, rules);
  const premiumHours = missedByPunch
    ? (laborJurisdiction.mealBreakPremiumHours(rules) || 0)
    : 0;
  // Dispute in either direction: the statement and the record disagree.
  const disputed = (mealBreakTaken === true && missedByPunch)
    || (mealBreakTaken === false && !waived && !missedByPunch);
  const { rows: [row] } = await db.query(
    `INSERT INTO restaurant_break_attestations
       (business_id, user_id, time_entry_id, entry_date, location_id,
        meal_break_taken, rest_break_taken, waived, waiver_reason,
        attested_by, disputed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (time_entry_id) DO UPDATE
       SET meal_break_taken = EXCLUDED.meal_break_taken,
           rest_break_taken = EXCLUDED.rest_break_taken,
           waived = EXCLUDED.waived,
           waiver_reason = EXCLUDED.waiver_reason,
           attested_by = EXCLUDED.attested_by,
           attested_at = NOW(),
           disputed = EXCLUDED.disputed
     RETURNING *`,
    [
      businessId,
      userId,
      timeEntryId,
      entry.entry_date,
      entry.location_id,
      mealBreakTaken,
      restBreakTaken === true,
      waived === true,
      waived ? String(waiverReason).trim().slice(0, 1000) : null,
      attestedBy || userId,
      disputed,
    ]
  );
  return {
    attestation: row,
    entry,
    rules,
    missedMealBreak: missedByPunch,
    mealBreakPremiumHours: premiumHours,
    disputed,
  };
}

// Per-user attestation counts for a period, for the exceptions report:
// waived and attested-missed breaks are the exceptions a manager must
// see; disputed rows are the ones where statement and record disagree.
async function attestationSummaryByUser(db, { businessId, fromDate, toDate, locationIds = null }) {
  const params = [businessId, fromDate, toDate];
  let locationFilter = '';
  if (Array.isArray(locationIds)) {
    params.push(locationIds);
    locationFilter = ` AND location_id = ANY($${params.length}::bigint[])`;
  }
  const { rows } = await db.query(
    `SELECT user_id,
            COUNT(*)::int AS attestations,
            COUNT(*) FILTER (WHERE waived)::int AS waived_breaks,
            COUNT(*) FILTER (WHERE NOT meal_break_taken AND NOT waived)::int AS missed_breaks,
            COUNT(*) FILTER (WHERE disputed)::int AS disputed_attestations
       FROM restaurant_break_attestations
      WHERE business_id = $1 AND entry_date >= $2::date AND entry_date <= $3::date${locationFilter}
      GROUP BY user_id`,
    params
  );
  const byUser = new Map();
  for (const row of rows) byUser.set(String(row.user_id), {
    attestations: Number(row.attestations),
    waived_breaks: Number(row.waived_breaks),
    missed_breaks: Number(row.missed_breaks),
    disputed_attestations: Number(row.disputed_attestations),
  });
  return byUser;
}

async function listAttestations(db, { businessId, fromDate = null, toDate = null, userId = null, waivedOnly = false, disputedOnly = false, limit = 100, offset = 0 } = {}) {
  const params = [businessId];
  const where = ['business_id = $1'];
  if (fromDate) { params.push(fromDate); where.push(`entry_date >= $${params.length}::date`); }
  if (toDate) { params.push(toDate); where.push(`entry_date <= $${params.length}::date`); }
  if (userId) { params.push(userId); where.push(`user_id = $${params.length}`); }
  if (waivedOnly) where.push('waived = TRUE');
  if (disputedOnly) where.push('disputed = TRUE');
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  params.push(Math.max(Number(offset) || 0, 0));
  const { rows } = await db.query(
    `SELECT a.*, COALESCE(u.display_name_preference, u.first_name || ' ' || u.last_name) AS user_name
       FROM restaurant_break_attestations a
       JOIN users u ON u.id = a.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.entry_date DESC, a.attested_at DESC, a.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

module.exports = {
  recordBreakAttestation,
  attestationSummaryByUser,
  listAttestations,
  punchShowsMissedMeal,
  entryBreakMinutes,
};
