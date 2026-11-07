'use strict';

/**
 * restaurantPayrollService — pay, tips and labor data foundation for
 * restaurants (staff review S-04 / S-15 / S-16 / S-20).
 *
 * Scope is deliberately the DATA FOUNDATION the review asks to build
 * in-house:
 *   - tip attribution: order tips are attributed to the acting staff
 *     member stamped on the order (food_orders.acting_staff_user_id,
 *     migration 948), falling back to the POS shift recorded on the
 *     order (food_orders.metadata.shiftId -> restaurant_pos_shifts.staff_user_id);
 *     declared cash tips are recorded per person in
 *     restaurant_declared_cash_tips (migration 951).
 *   - tip pools / tip-out rules per restaurant (restaurant_tip_pool_settings).
 *   - labor cost and labor % of sales from the person-based schedule /
 *     time-entry model (business_staff_shifts, business_time_entries)
 *     and membership wages (business_members.hourly_wage_cents), with
 *     revenue taken from the SAME net-collected definition as the F-07
 *     sales report (restaurantReportsController) so the two reports
 *     can never disagree about what a sale was.
 *   - a per-pay-period payroll rollup + CSV (hours, wages, tips).
 *   - a per-employee exception report (voids, comps, refunds, discounts,
 *     no-sales, payouts, missing time entries for scheduled shifts).
 *
 * Scheduling vendor integration and availability/swap workflows remain
 * outside this service. The in-house report does, however, apply the
 * restaurant's explicit overtime and break policy to recorded punches.
 *
 * Money is integer cents everywhere. Tip allocation conserves cents
 * exactly: sum(net tips) + unattributed == total tips, always.
 */

const pool = require('../db');
const AppError = require('../utils/appError');
// Shared CSV cell sanitizer (ADM-152): neutralizes formula injection
// (leading =, +, -, @) on top of RFC 4180 quoting.
const { csvCell } = require('../utils/csv');
// Jurisdiction rule tables drive the pay calc (Phase 1, international
// by default): daily/double-time/7th-day thresholds and premium rules
// come from the location's jurisdiction row, never from a hardcoded
// country branch. California is one row in that table, not the logic.
const laborJurisdiction = require('./laborJurisdictionRules');
const punchHours = require('./restaurantPunchHours');
const { minorUnitDecimals } = require('../utils/currencyPrecision');
// Phase 7 (gap 17): break attestations surface in the labor and
// exceptions reports. The attestation never changes the premium math
// (tierRows still prices from the punch record); it only confirms or
// disputes it, so the report counts attested, waived, and disputed
// breaks alongside the premium the punch record already owes.
const breakAttestation = require('./restaurantBreakAttestation');

function storeFilter(locationIds, column, parameter) {
  return locationIds === null ? '' : ` AND ${column} = ANY($${parameter}::bigint[])`;
}
function storeParams(params, locationIds) { return locationIds === null ? params : [...params, locationIds]; }

// Finding 57: the restaurant currency is schema NOT NULL, so a
// missing value here means corrupt data — fail visibly instead of
// silently pricing in USD.
function requireRestaurantCurrency(restaurant) {
  const code = String(restaurant?.currency_code || '').trim().toUpperCase();
  if (!code) {
    throw new AppError('This restaurant has no currency configured; payroll cannot be priced', 409, 'restaurant_currency_missing');
  }
  return code;
}

const MAX_RANGE_DAYS = 366;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Local-date range handling (mirrors restaurantReportsController) ──

function resolveReportTimezone(restaurant) {
  const tz = restaurant && restaurant.timezone ? String(restaurant.timezone) : 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function localDateString(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function shiftDateString(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isRealDateString(value) {
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value) || value.startsWith('0000')) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// from/to are local calendar dates (YYYY-MM-DD) in the restaurant's
// timezone. Defaults: the last 30 local days including today.
// Throws a plain Error with .code = 'invalid_range' / 'range_too_wide'
// so the controller can map it to a 400.
function parseLocalRange(query, timezone) {
  const q = query || {};
  if ((q.from && !isRealDateString(q.from)) || (q.to && !isRealDateString(q.to))) {
    const err = new Error('Invalid date range');
    err.code = 'invalid_range';
    throw err;
  }
  const toDate = q.to || localDateString(new Date(), timezone);
  const fromDate = q.from || shiftDateString(toDate, -29);
  if (fromDate > toDate) {
    const err = new Error('Invalid date range');
    err.code = 'invalid_range';
    throw err;
  }
  const days = Math.round(
    (new Date(`${toDate}T12:00:00Z`) - new Date(`${fromDate}T12:00:00Z`)) / 86400000
  ) + 1;
  if (days > MAX_RANGE_DAYS) {
    const err = new Error(`Date range capped at ${MAX_RANGE_DAYS} days`);
    err.code = 'range_too_wide';
    throw err;
  }
  return { fromDate, toDate };
}

// ── Tip pool settings ────────────────────────────────────────────────

function normalizeTipOutRules(rules) {
  if (rules == null) return [];
  if (!Array.isArray(rules)) {
    const err = new Error('tip_out_rules must be an array');
    err.code = 'validation_failed';
    throw err;
  }
  const seen = new Set();
  const normalized = [];
  let totalBps = 0;
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') {
      const err = new Error('Each tip-out rule must be an object');
      err.code = 'validation_failed';
      throw err;
    }
    const targetType = String(rule.target_type || rule.targetType || '').trim().toLowerCase();
    const targetKey = String(rule.target_key || rule.targetKey || '').trim();
    const percentBps = Number(rule.percent_bps ?? rule.percentBps);
    if (targetType !== 'role' && targetType !== 'pool') {
      const err = new Error("Tip-out rule target_type must be 'role' or 'pool'");
      err.code = 'validation_failed';
      throw err;
    }
    if (targetType === 'role' && !targetKey) {
      const err = new Error('A role tip-out rule needs a target job role');
      err.code = 'validation_failed';
      throw err;
    }
    if (!Number.isInteger(percentBps) || percentBps <= 0 || percentBps > 10000) {
      const err = new Error('Tip-out percent_bps must be an integer between 1 and 10000');
      err.code = 'validation_failed';
      throw err;
    }
    // Phase 6 (gap 12): how the pot is split among the rule's recipients.
    // 'equal' is the historical behavior and the default, so existing pools
    // do not change; 'hours' weights by hours worked in the period and
    // 'gross_tips' by gross tips earned. Per-shift/per-day pooling is
    // deliberately not part of this change.
    const weightBasis = String(rule.weight_basis || rule.weightBasis || 'equal').trim().toLowerCase();
    if (!['equal', 'hours', 'gross_tips'].includes(weightBasis)) {
      const err = new Error("Tip-out weight_basis must be 'equal', 'hours', or 'gross_tips'");
      err.code = 'validation_failed';
      throw err;
    }
    const dedupeKey = `${targetType}:${targetKey.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      const err = new Error(`Duplicate tip-out rule for ${dedupeKey}`);
      err.code = 'validation_failed';
      throw err;
    }
    seen.add(dedupeKey);
    totalBps += percentBps;
    normalized.push({
      target_type: targetType,
      target_key: targetType === 'role' ? targetKey : null,
      percent_bps: percentBps,
      weight_basis: weightBasis,
    });
  }
  if (totalBps > 10000) {
    const err = new Error('Tip-out rules cannot exceed 100% of tips in total');
    err.code = 'validation_failed';
    throw err;
  }
  return normalized;
}

async function getTipPoolSettings(restaurantId, locationId = null) {
  // Phase 8 Track B: a store's own tip-pool row wins; otherwise the
  // restaurant-level row is the fallback (same shape as the Phase 1
  // per-location labor policies). The `source` field says which one
  // answered so a store manager can see the fallback is in effect.
  if (locationId != null) {
    const { rows: [locationRow] } = await pool.query(
      `SELECT restaurant_id, location_id, pooling_enabled, tip_out_rules, updated_by, updated_at
         FROM restaurant_location_tip_pool_settings
        WHERE restaurant_id = $1 AND location_id = $2`,
      [restaurantId, locationId]
    );
    if (locationRow) {
      return {
        restaurant_id: restaurantId,
        location_id: Number(locationRow.location_id),
        pooling_enabled: locationRow.pooling_enabled === true,
        tip_out_rules: normalizeTipOutRules(Array.isArray(locationRow.tip_out_rules) ? locationRow.tip_out_rules : []),
        updated_by: locationRow.updated_by,
        updated_at: locationRow.updated_at,
        source: 'location',
      };
    }
  }
  const { rows: [row] } = await pool.query(
    'SELECT restaurant_id, pooling_enabled, tip_out_rules, updated_by, updated_at FROM restaurant_tip_pool_settings WHERE restaurant_id = $1',
    [restaurantId]
  );
  if (!row) return { restaurant_id: restaurantId, location_id: locationId != null ? Number(locationId) : null, pooling_enabled: false, tip_out_rules: [], updated_by: null, updated_at: null, source: 'restaurant_fallback' };
  return {
    restaurant_id: row.restaurant_id,
    location_id: locationId != null ? Number(locationId) : null,
    pooling_enabled: row.pooling_enabled === true,
    tip_out_rules: normalizeTipOutRules(Array.isArray(row.tip_out_rules) ? row.tip_out_rules : []),
    updated_by: row.updated_by,
    updated_at: row.updated_at,
    source: 'restaurant_fallback',
  };
}

async function saveTipPoolSettings(restaurantId, { poolingEnabled, tipOutRules, updatedBy }, locationId = null) {
  const rules = normalizeTipOutRules(tipOutRules || []);
  if (locationId != null) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_location_tip_pool_settings (restaurant_id, location_id, pooling_enabled, tip_out_rules, updated_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (restaurant_id, location_id) DO UPDATE
         SET pooling_enabled = EXCLUDED.pooling_enabled,
             tip_out_rules = EXCLUDED.tip_out_rules,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
       RETURNING restaurant_id, location_id, pooling_enabled, tip_out_rules, updated_by, updated_at`,
      [restaurantId, locationId, poolingEnabled === true, JSON.stringify(rules), updatedBy || null]
    );
    return {
      restaurant_id: row.restaurant_id,
      location_id: Number(row.location_id),
      pooling_enabled: row.pooling_enabled === true,
      tip_out_rules: normalizeTipOutRules(Array.isArray(row.tip_out_rules) ? row.tip_out_rules : []),
      updated_by: row.updated_by,
      updated_at: row.updated_at,
      source: 'location',
    };
  }
  const { rows: [row] } = await pool.query(
    `INSERT INTO restaurant_tip_pool_settings (restaurant_id, pooling_enabled, tip_out_rules, updated_by)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (restaurant_id) DO UPDATE
       SET pooling_enabled = EXCLUDED.pooling_enabled,
           tip_out_rules = EXCLUDED.tip_out_rules,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
     RETURNING restaurant_id, pooling_enabled, tip_out_rules, updated_by, updated_at`,
    [restaurantId, poolingEnabled === true, JSON.stringify(rules), updatedBy || null]
  );
  return {
    restaurant_id: row.restaurant_id,
    location_id: null,
    pooling_enabled: row.pooling_enabled === true,
    tip_out_rules: normalizeTipOutRules(Array.isArray(row.tip_out_rules) ? row.tip_out_rules : []),
    updated_by: row.updated_by,
    updated_at: row.updated_at,
    source: 'restaurant_fallback',
  };
}

async function declareCashTip(restaurantId, { staffUserId, businessDate, amountCents, declaredBy, note, locationId = null, idempotencyKey = null, status = 'confirmed' }) {
  const key = typeof idempotencyKey === 'string' && idempotencyKey.trim() ? idempotencyKey.trim().slice(0, 128) : null;
  // Review state (Phase 3 Track B): manager-entered declarations are
  // confirmed at entry; employee self-declarations arrive 'pending'
  // and stay out of pay until a manager confirms them.
  const reviewStatus = status === 'pending' || status === 'rejected' ? status : 'confirmed';
  const declarationColumns = 'id, restaurant_id, staff_user_id, business_date, amount_cents, declared_by, note, location_id, idempotency_key, status, reviewed_by, reviewed_at, created_at';
  // Background-jobs audit (finding P1): dedupe on a client-generated key
  // so a retry cannot double-declare and inflate the payroll basis. A
  // replay returns the original row instead of inserting a duplicate.
  if (key) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_declared_cash_tips
         (restaurant_id, staff_user_id, business_date, amount_cents, declared_by, note, location_id, idempotency_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING ${declarationColumns}`,
      [restaurantId, staffUserId, businessDate, amountCents, declaredBy || null, note || null, locationId, key, reviewStatus]
    );
    if (row) return row;
    const { rows: [existing] } = await pool.query(
      `SELECT ${declarationColumns}
         FROM restaurant_declared_cash_tips
        WHERE restaurant_id = $1 AND idempotency_key = $2
        LIMIT 1`,
      [restaurantId, key]
    );
    return { ...existing, replayed: true };
  }
  const { rows: [row] } = await pool.query(
    `INSERT INTO restaurant_declared_cash_tips
       (restaurant_id, staff_user_id, business_date, amount_cents, declared_by, note, location_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${declarationColumns}`,
    [restaurantId, staffUserId, businessDate, amountCents, declaredBy || null, note || null, locationId, reviewStatus]
  );
  return row;
}

// One employee's own declared cash tips in a period, every status:
// the employee sees pending/confirmed/rejected; pay only ever sees
// confirmed (see getDeclaredCashTips).
async function listDeclaredCashTipsForUser(restaurantId, staffUserId, fromDate, toDate) {
  const { rows } = await pool.query(
    `SELECT id, restaurant_id, staff_user_id, business_date, amount_cents,
            declared_by, note, location_id, idempotency_key, status,
            reviewed_by, reviewed_at, created_at
       FROM restaurant_declared_cash_tips
      WHERE restaurant_id = $1 AND staff_user_id = $2
        AND business_date >= $3 AND business_date <= $4
      ORDER BY business_date DESC, id DESC`,
    [restaurantId, staffUserId, fromDate, toDate]
  );
  return rows;
}

// Manager review of a self-declared cash tip. Only a pending row can
// move; confirming puts it into pay from the next computation on,
// rejecting keeps it out of pay forever. Returns null when the row
// does not exist or is not pending (the caller distinguishes).
//
// Finding 23: the reviewer can never be the person the tip belongs
// to — a payroll manager cannot confirm (or reject) their own cash-tip
// declaration. The check lives here, at the service boundary, so both
// controller paths (confirm and reject) are covered by the one rule.
async function reviewCashTip(restaurantId, declarationId, { status, reviewedBy }) {
  const next = status === 'rejected' ? 'rejected' : 'confirmed';
  const { rows: [existing] } = await pool.query(
    `SELECT id, staff_user_id, status FROM restaurant_declared_cash_tips
      WHERE id = $1 AND restaurant_id = $2`,
    [declarationId, restaurantId]
  );
  if (!existing || existing.status !== 'pending') return null;
  if (reviewedBy != null && String(existing.staff_user_id) === String(reviewedBy)) {
    throw new AppError(
      'You cannot review your own cash-tip declaration; a different payroll manager must confirm or reject it',
      403,
      'cash_tip_self_review'
    );
  }
  const { rows: [row] } = await pool.query(
    `UPDATE restaurant_declared_cash_tips
        SET status = $3, reviewed_by = $4, reviewed_at = NOW()
      WHERE id = $1 AND restaurant_id = $2 AND status = 'pending'
      RETURNING id, restaurant_id, staff_user_id, business_date, amount_cents,
                declared_by, note, location_id, idempotency_key, status,
                reviewed_by, reviewed_at, created_at`,
    [declarationId, restaurantId, next, reviewedBy || null]
  );
  return row || null;
}

// ── Roster ───────────────────────────────────────────────────────────

// Active team of the restaurant's business: members plus the owner,
// with job role + wage of record (migration 951 columns).
async function getRoster(businessId, locationIds = null, restaurantId = null) {
  // S-18: when a single store is scoped, its per-store pay rate wins over
  // the business-level wage. The LEFT JOIN matches the member's active
  // location assignment for that store; NULL keeps the business rate.
  const singleLocationId = Array.isArray(locationIds) && locationIds.length === 1 ? Number(locationIds[0]) : null;
  const { rows } = await pool.query(
    `SELECT bm.member_id AS user_id,
            COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
                     u.email) AS name,
            bm.role AS membership_role,
            bm.job_role,
            -- Wage of record (951) wins; otherwise the hourly pay rate
            -- captured at invite time (946) is the wage until one is set.
            -- Non-hourly invite rates (week/month/year) are not hourly
            -- wages and stay unset here, so salaried staff surface in
            -- missing_wage_user_ids instead of being silently misconverted.
            -- S-18: a per-store hourly rate overrides the business rate.
            COALESCE(
              ${singleLocationId === null ? 'NULL' : 'CASE WHEN lm.pay_rate_period = \'hour\' THEN lm.pay_rate_cents END'},
              bm.hourly_wage_cents,
              CASE WHEN bm.pay_rate_period = 'hour' THEN bm.pay_rate_cents END
            ) AS hourly_wage_cents
       FROM business_members bm
       JOIN users u ON u.id = bm.member_id
       ${singleLocationId === null ? '' : 'LEFT JOIN restaurant_location_memberships lm ON lm.membership_id = bm.id AND lm.restaurant_id = $3 AND lm.location_id = $4 AND lm.status = \'active\''}
      WHERE bm.business_id = $1 AND bm.status = 'active' AND bm.member_id IS NOT NULL${locationIds === null ? '' : ` AND EXISTS (SELECT 1 FROM restaurant_location_memberships lm2 WHERE lm2.membership_id=bm.id AND lm2.restaurant_id=$3 AND lm2.status='active' AND lm2.location_id=ANY($2::bigint[]))`}
     UNION ALL
     SELECT b.user_id AS user_id,
            COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
                     u.email) AS name,
            'owner' AS membership_role,
            NULL AS job_role,
            NULL AS hourly_wage_cents
       FROM businesses b
       JOIN users u ON u.id = b.user_id
      WHERE b.id = $1${locationIds === null ? '' : ' AND FALSE'}`,
    locationIds === null
      ? [businessId]
      : singleLocationId === null
        ? [businessId, locationIds, restaurantId]
        : [businessId, locationIds, restaurantId, singleLocationId]
  );
  return rows;
}

const DEFAULT_LABOR_POLICY = Object.freeze({
  overtime_threshold_hours: 40,
  overtime_multiplier_bps: 15000,
  // Double time pays 2x the regular rate unless the policy says
  // otherwise (finding 47): the multiplier is a policy parameter in
  // the same shape as overtime_multiplier_bps, never a hardcoded 2.
  doubletime_multiplier_bps: 20000,
  break_after_minutes: 360,
  break_duration_minutes: 30,
});

function normalizeLaborPolicy(row, restaurantId = null) {
  const source = row || {};
  return {
    restaurant_id: restaurantId != null ? restaurantId : source.restaurant_id,
    // NULL location_id = the restaurant-level fallback policy. A
    // per-location row carries its location id plus the country and
    // region it applies in.
    location_id: source.location_id == null ? null : Number(source.location_id),
    country_code: source.country_code || null,
    region_code: source.region_code || null,
    overtime_threshold_hours: Number(source.overtime_threshold_hours ?? DEFAULT_LABOR_POLICY.overtime_threshold_hours),
    // Whether the threshold was explicitly configured on this row.
    // A missing row (or a NULL threshold) falls back to the 40h
    // default, which is a US-FED assumption, not an operator choice:
    // tierRows lets the jurisdiction's weekly threshold govern over
    // that default, while an explicit threshold still caps straight
    // time at the lower of the two.
    overtime_threshold_explicit: source.overtime_threshold_hours != null,
    overtime_multiplier_bps: Number(source.overtime_multiplier_bps ?? DEFAULT_LABOR_POLICY.overtime_multiplier_bps),
    doubletime_multiplier_bps: Number(source.doubletime_multiplier_bps ?? DEFAULT_LABOR_POLICY.doubletime_multiplier_bps),
    break_after_minutes: Number(source.break_after_minutes ?? DEFAULT_LABOR_POLICY.break_after_minutes),
    break_duration_minutes: Number(source.break_duration_minutes ?? DEFAULT_LABOR_POLICY.break_duration_minutes),
    updated_by: source.updated_by || null,
    updated_at: source.updated_at || null,
  };
}

// Effective policy for one location: the location's own row when one
// exists, otherwise the restaurant-level fallback. locationId NULL
// returns the fallback directly.
async function getLaborPolicy(restaurantId, locationId = null) {
  if (locationId != null) {
    const { rows: [locationRow] } = await pool.query(
      `SELECT restaurant_id, location_id, country_code, region_code,
              overtime_threshold_hours, overtime_multiplier_bps, doubletime_multiplier_bps,
              break_after_minutes, break_duration_minutes, updated_by, updated_at
         FROM restaurant_location_labor_policies
        WHERE restaurant_id = $1 AND location_id = $2`,
      [restaurantId, locationId]
    );
    if (locationRow) return normalizeLaborPolicy(locationRow, restaurantId);
  }
  const { rows: [row] } = await pool.query(
    `SELECT restaurant_id, overtime_threshold_hours, overtime_multiplier_bps, doubletime_multiplier_bps,
            break_after_minutes, break_duration_minutes, updated_by, updated_at
       FROM restaurant_labor_policies WHERE restaurant_id = $1`,
    [restaurantId]
  );
  return normalizeLaborPolicy(row, restaurantId);
}

function validateLaborPolicy(normalized) {
  if (!Number.isFinite(normalized.overtime_threshold_hours)
    || normalized.overtime_threshold_hours <= 0 || normalized.overtime_threshold_hours > 168) {
    const err = new Error('overtime_threshold_hours must be between 0 and 168');
    err.code = 'validation_failed';
    throw err;
  }
  if (!Number.isInteger(normalized.overtime_multiplier_bps)
    || normalized.overtime_multiplier_bps < 10000 || normalized.overtime_multiplier_bps > 50000) {
    const err = new Error('overtime_multiplier_bps must be between 10000 and 50000');
    err.code = 'validation_failed';
    throw err;
  }
  if (!Number.isInteger(normalized.doubletime_multiplier_bps)
    || normalized.doubletime_multiplier_bps < 10000 || normalized.doubletime_multiplier_bps > 50000) {
    const err = new Error('doubletime_multiplier_bps must be between 10000 and 50000');
    err.code = 'validation_failed';
    throw err;
  }
  if (!Number.isInteger(normalized.break_after_minutes)
    || normalized.break_after_minutes <= 0 || normalized.break_after_minutes > 1440) {
    const err = new Error('break_after_minutes must be between 1 and 1440');
    err.code = 'validation_failed';
    throw err;
  }
  if (!Number.isInteger(normalized.break_duration_minutes)
    || normalized.break_duration_minutes < 0 || normalized.break_duration_minutes > 240) {
    const err = new Error('break_duration_minutes must be between 0 and 240');
    err.code = 'validation_failed';
    throw err;
  }
}

async function saveLaborPolicy(restaurantId, policy, updatedBy, locationId = null) {
  const normalized = normalizeLaborPolicy({ ...policy, restaurant_id: restaurantId });
  validateLaborPolicy(normalized);
  if (locationId != null) {
    // Country/region default to the location's own address when the
    // caller does not state them: the policy row records where it
    // applies, it does not make the caller retype the address.
    let countryCode = normalized.country_code;
    let regionCode = normalized.region_code;
    if (countryCode == null || regionCode == null) {
      const { rows: [loc] } = await pool.query(
        `SELECT address_country, address_state FROM restaurant_locations
          WHERE restaurant_id = $1 AND id = $2 AND status <> 'archived'`,
        [restaurantId, locationId]
      );
      if (!loc) {
        const err = new Error('Location not found');
        err.code = 'validation_failed';
        throw err;
      }
      countryCode = countryCode || loc.address_country || null;
      regionCode = regionCode || loc.address_state || null;
    }
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_location_labor_policies
         (restaurant_id, location_id, overtime_threshold_hours, overtime_multiplier_bps, doubletime_multiplier_bps,
          break_after_minutes, break_duration_minutes, country_code, region_code, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (restaurant_id, location_id) DO UPDATE SET
         overtime_threshold_hours = EXCLUDED.overtime_threshold_hours,
         overtime_multiplier_bps = EXCLUDED.overtime_multiplier_bps,
         doubletime_multiplier_bps = EXCLUDED.doubletime_multiplier_bps,
         break_after_minutes = EXCLUDED.break_after_minutes,
         break_duration_minutes = EXCLUDED.break_duration_minutes,
         country_code = EXCLUDED.country_code,
         region_code = EXCLUDED.region_code,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING restaurant_id, location_id, country_code, region_code,
                 overtime_threshold_hours, overtime_multiplier_bps, doubletime_multiplier_bps,
                 break_after_minutes, break_duration_minutes, updated_by, updated_at`,
      [restaurantId, locationId, normalized.overtime_threshold_hours, normalized.overtime_multiplier_bps,
        normalized.doubletime_multiplier_bps,
        normalized.break_after_minutes, normalized.break_duration_minutes,
        countryCode, regionCode, updatedBy || null]
    );
    return normalizeLaborPolicy(row, restaurantId);
  }
  const { rows: [row] } = await pool.query(
    `INSERT INTO restaurant_labor_policies
       (restaurant_id, overtime_threshold_hours, overtime_multiplier_bps, doubletime_multiplier_bps,
        break_after_minutes, break_duration_minutes, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (restaurant_id) DO UPDATE SET
       overtime_threshold_hours = EXCLUDED.overtime_threshold_hours,
       overtime_multiplier_bps = EXCLUDED.overtime_multiplier_bps,
       doubletime_multiplier_bps = EXCLUDED.doubletime_multiplier_bps,
       break_after_minutes = EXCLUDED.break_after_minutes,
       break_duration_minutes = EXCLUDED.break_duration_minutes,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING restaurant_id, overtime_threshold_hours, overtime_multiplier_bps, doubletime_multiplier_bps,
               break_after_minutes, break_duration_minutes, updated_by, updated_at`,
    [restaurantId, normalized.overtime_threshold_hours, normalized.overtime_multiplier_bps,
      normalized.doubletime_multiplier_bps,
      normalized.break_after_minutes, normalized.break_duration_minutes, updatedBy || null]
  );
  return normalizeLaborPolicy(row, restaurantId);
}

// Per-location pay context for one restaurant: effective labor policy
// per location, resolved jurisdiction rules per location, and the
// location's own currency/country/timezone. The pay calc reads rules
// from here, never from a hardcoded country branch. When locationIds
// is null the context covers every location of the restaurant.
async function getLocationPayContext(restaurantId, locationIds = null) {
  const [policyRows, jurisdictionMap, locationRows, restaurantRow] = await Promise.all([
    pool.query(
      `SELECT restaurant_id, location_id, country_code, region_code,
              overtime_threshold_hours, overtime_multiplier_bps, doubletime_multiplier_bps,
              break_after_minutes, break_duration_minutes, updated_by, updated_at
         FROM restaurant_location_labor_policies WHERE restaurant_id = $1`,
      [restaurantId]
    ).then(({ rows }) => rows),
    laborJurisdiction.getJurisdictions(pool, restaurantId, locationIds),
    pool.query(
      `SELECT id, currency_code, address_country, address_state, timezone
         FROM restaurant_locations WHERE restaurant_id = $1 AND status <> 'archived'`,
      [restaurantId]
    ).then(({ rows }) => rows),
    pool.query(
      'SELECT timezone FROM food_restaurants WHERE id = $1',
      [restaurantId]
    ).then(({ rows }) => rows[0] || null),
  ]);
  const policiesByLocation = new Map();
  for (const row of policyRows) {
    policiesByLocation.set(Number(row.location_id), normalizeLaborPolicy(row, restaurantId));
  }
  const locationsById = new Map();
  for (const row of locationRows) {
    locationsById.set(Number(row.id), {
      currency_code: row.currency_code || null,
      country_code: row.address_country || null,
      region_code: row.address_state || null,
      timezone: row.timezone || null,
    });
  }
  // The restaurant timezone is the fallback for the overnight split
  // when a location carries none of its own.
  return { policiesByLocation, jurisdictionsByLocation: jurisdictionMap, locationsById, timezone: restaurantRow?.timezone || null };
}

// ── Hours (actual + scheduled) ───────────────────────────────────────

// Phase 2: hours that came from a system-closed punch, per user.
// System-closed hours are real stamped hours (they are paid), but they
// must stay visible as system-closed in payroll: a manager reviews
// them before the pay run instead of discovering a forgotten punch
// after it was paid. Voided entries are excluded, like everywhere else.
async function getSystemClosedByUser(businessId, fromDate, toDate, locationIds = null) {
  const { rows } = await pool.query(
    `SELECT user_id, COUNT(*)::int AS entries, COALESCE(SUM(hours_worked), 0)::float8 AS hours
       FROM business_time_entries
      WHERE business_id = $1 AND entry_date >= $2 AND entry_date <= $3
        AND system_closed_at IS NOT NULL AND voided_at IS NULL
        ${storeFilter(locationIds, 'location_id', 4)}
      GROUP BY user_id`,
    storeParams([businessId, fromDate, toDate], locationIds)
  );
  const map = new Map();
  for (const row of rows) {
    map.set(row.user_id, { entries: Number(row.entries) || 0, hours: Number(row.hours) || 0 });
  }
  return map;
}

// Actual recorded hours per user from business_time_entries (the
// hours_worked model the working staff-scheduling API writes).
async function getHoursByUser(businessId, fromDate, toDate, locationIds = null) {
  const { rows } = await pool.query(
    `SELECT user_id, COALESCE(SUM(hours_worked), 0)::float8 AS hours
       FROM business_time_entries
      WHERE business_id = $1 AND entry_date >= $2 AND entry_date <= $3
        ${storeFilter(locationIds, 'location_id', 4)}
        AND voided_at IS NULL
      GROUP BY user_id`,
    storeParams([businessId, fromDate, toDate], locationIds)
  );
  const map = new Map();
  for (const row of rows) map.set(row.user_id, Number(row.hours) || 0);
  return map;
}

// ── Jurisdiction-driven hour tiering ─────────────────────────────────
// The pay calc reads its rules from the location's jurisdiction row,
// never from a hardcoded country branch.
//
// Tiering order, per person:
//   1. Daily buckets (per entry_date, per location): hours up to the
//      jurisdiction's daily threshold are regular; hours between the
//      daily and double-time thresholds are overtime (1.5x); hours
//      past the double-time threshold are double time (2x). A
//      jurisdiction with no daily threshold (NULL) pays straight time
//      for the whole day.
//   2. 7th consecutive day: where the jurisdiction has the rule, the
//      seventh consecutive worked day inside one workweek (the
//      jurisdiction's workweek start, Sunday by default)
//      pays the first daily-threshold hours at 1.5x and the rest at 2x,
//      with no regular hours that day. (A streak is counted inside the
//      workweek; a day off, or the week boundary, resets it.)
//   3. Weekly overtime: regular hours past the labor policy's weekly
//      threshold convert to overtime. Hours already tiered as daily
//      overtime or double time are NOT counted again.
//   4. Meal-break premium: where the jurisdiction requires it, one
//      premium per person per day when the day's total hours pass the
//      meal-break point without one continuous break of the required
//      duration (e.g. one hour in California). Split breaks never add
//      up to a meal period. The policy-based breakExceptions count is
//      kept alongside it, per original punch.
//
// `rulesResolver` is a function (locationId) => jurisdiction rules, a
// single rules object applied to every row, or null for the US-FED
// preset (weekly-only). Rows carry entry_date, hours_worked, breaks,
// clock_in_at and location_id.
//
// `options.timezoneFor` is a function (locationId) => IANA timezone
// for the midnight split below; `options.defaultTimezone` is the
// fallback when a location has none (UTC). A row whose clock-in and
// clock-out fall on different local dates is split at local midnight
// before any tiering, so overnight hours tier on the day they were
// actually worked (finding 17); rows without usable clock times stay
// whole on their entry_date.
//
// The workweek start is the jurisdiction's (finding 32): each row's
// week is computed from its own location's rules, defaulting to
// Sunday. A week spanning locations with different starts groups by
// each row's own week start.
//
// Returns { byUser, allocations }: byUser maps user_id to the summed
// tiers; allocations is the per-row split (user, date, location,
// regular/overtime/doubletime hours, missed-meal and premium hours),
// which scoped (single-store) reports filter after the cross-store
// weekly threshold has been applied to the full set.
function tierRows(rows, policy, rulesResolver, options = {}) {
  const resolve = typeof rulesResolver === 'function'
    ? (locationId) => rulesResolver(locationId) || laborJurisdiction.resolveRules(null)
    : () => (rulesResolver || laborJurisdiction.resolveRules(null));
  const round2 = (n) => Math.round(n * 100) / 100;
  const timezoneFor = typeof options.timezoneFor === 'function' ? options.timezoneFor : null;
  const defaultTimezone = options.defaultTimezone || 'UTC';
  const timezoneOf = (locationId) => {
    const tz = timezoneFor ? timezoneFor(locationId) : null;
    return tz || defaultTimezone;
  };
  // Fail closed on a CUSTOM jurisdiction that leaves overtime
  // parameters NULL (finding 48): the run must not silently pay
  // straight time. Checked once per distinct rules object.
  const payableChecked = new Set();
  const assertPayable = (rules) => {
    if (!rules || payableChecked.has(rules)) return;
    payableChecked.add(rules);
    laborJurisdiction.assertPayableRules(rules);
  };

  const rowsByUser = new Map();
  for (const row of rows || []) {
    if (row.user_id == null) continue;
    const list = rowsByUser.get(row.user_id) || [];
    list.push(row);
    rowsByUser.set(row.user_id, list);
  }

  const byUser = new Map();
  const allocations = [];
  for (const [userId, userRows] of rowsByUser) {
    const sorted = [...userRows].sort((a, b) => {
      const da = String(a.entry_date).slice(0, 10);
      const db = String(b.entry_date).slice(0, 10);
      if (da !== db) return da < db ? -1 : 1;
      const ca = a.clock_in_at ? new Date(a.clock_in_at).getTime() : 0;
      const cb = b.clock_in_at ? new Date(b.clock_in_at).getTime() : 0;
      if (ca !== cb) return ca - cb;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
    const entryDate = (row) => row.entry_date instanceof Date
      ? row.entry_date.toISOString().slice(0, 10)
      : String(row.entry_date).slice(0, 10);
    const weekStartOf = (dateStr, locationId) => laborJurisdiction.weekStartOf(
      dateStr, laborJurisdiction.workweekStartDay(resolve(locationId == null ? null : Number(locationId)))
    );
    // Overnight rows split at local midnight before any tiering, so
    // the hours land on the local dates they were worked. Each piece
    // keeps the original row's location and user and carries the
    // breaks that start on its date, whole, for the meal-break test.
    const pieces = [];
    for (const row of sorted) {
      assertPayable(resolve(row.location_id == null ? null : Number(row.location_id)));
      const splits = punchHours.splitAcrossLocalDates({
        clockInAt: row.clock_in_at,
        clockOutAt: row.clock_out_at,
        hoursWorked: row.hours_worked,
        breaks: row.breaks,
        timezone: timezoneOf(row.location_id == null ? null : Number(row.location_id)),
        entryDate: entryDate(row),
      });
      // The policy break exception is per original punch, not per
      // split piece: an overnight row split in two must not count
      // twice. Each piece carries its source row's hours and total
      // break minutes; only the first piece can raise the exception.
      const sourceBreakMinutes = (Array.isArray(row.breaks) ? row.breaks : []).reduce((sum, item) => {
        const start = Date.parse(item?.started_at || '');
        const end = Date.parse(item?.ended_at || '');
        return Number.isFinite(start) && Number.isFinite(end) && end > start
          ? sum + ((end - start) / 60000) : sum;
      }, 0);
      splits.forEach((piece, index) => {
        pieces.push({
          ...row,
          entry_date: piece.date,
          hours_worked: piece.hours,
          breaks: piece.breaks,
          clock_in_at: piece.startMs != null ? new Date(piece.startMs).toISOString() : row.clock_in_at,
          clock_out_at: piece.endMs != null ? new Date(piece.endMs).toISOString() : row.clock_out_at,
          firstPieceOfSource: index === 0,
          sourceHours: Math.max(0, Number(row.hours_worked) || 0),
          sourceBreakMinutes,
        });
      });
    }
    const sortedPieces = pieces;

    // Consecutive-day streaks, counted inside each workweek.
    const streakByDate = new Map();
    const datesByWeek = new Map();
    for (const row of sortedPieces) {
      const week = weekStartOf(entryDate(row), row.location_id == null ? null : Number(row.location_id));
      const set = datesByWeek.get(week) || new Set();
      set.add(entryDate(row));
      datesByWeek.set(week, set);
    }
    for (const dates of datesByWeek.values()) {
      let streak = 0;
      let prev = null;
      for (const day of [...dates].sort()) {
        const prevDay = prev ? shiftDateString(prev, 1) : null;
        streak = prevDay === day ? streak + 1 : 1;
        streakByDate.set(day, streak);
        prev = day;
      }
    }

    // Daily buckets per person per day, across locations: a person
    // who works 6h at one store and 6h at another works one 12-hour
    // day, not two 6-hour days. Tier the day's total, then hand the
    // tiers to the day's rows in chronological order, so the tiers
    // attribute to the locations where the threshold was crossed.
    // Where the day's locations disagree, the strictest defined
    // threshold wins: the lowest daily-overtime threshold, the
    // lowest double-time threshold, and seventh-day overtime if any
    // location in the day has it.
    const dayGroups = new Map();
    for (const row of sortedPieces) {
      const key = entryDate(row);
      const group = dayGroups.get(key) || { date: entryDate(row), rows: [], total: 0 };
      group.rows.push(row);
      group.total += Math.max(0, Number(row.hours_worked) || 0);
      dayGroups.set(key, group);
    }
    const rowSplit = new Map(); // row -> { regular, overtime, doubletime }
    for (const group of dayGroups.values()) {
      const dayRules = group.rows.map((row) => resolve(row.location_id == null ? null : Number(row.location_id)));
      const definedThresholds = (values) => values.filter((v) => v != null);
      const dailyValues = definedThresholds(dayRules.map((r) => (r.daily_overtime_hours == null ? null : Number(r.daily_overtime_hours))));
      const dblValues = definedThresholds(dayRules.map((r) => (r.daily_doubletime_hours == null ? null : Number(r.daily_doubletime_hours))));
      const daily = dailyValues.length ? Math.min(...dailyValues) : null;
      const dbl = dblValues.length ? Math.min(...dblValues) : null;
      const isSeventh = dayRules.some((r) => r.seventh_day_overtime === true) && streakByDate.get(group.date) === 7;
      const H = group.total;
      let regular = 0;
      let overtime = 0;
      let doubletime = 0;
      if (isSeventh) {
        // First daily-threshold hours at 1.5x, the rest at 2x.
        const cap = daily == null ? 8 : daily;
        overtime = Math.min(H, cap);
        doubletime = Math.max(0, H - cap);
      } else if (daily != null) {
        regular = Math.min(H, daily);
        const rest = Math.max(0, H - daily);
        const otCap = dbl == null ? Infinity : Math.max(0, dbl - daily);
        overtime = Math.min(rest, otCap);
        doubletime = Math.max(0, rest - overtime);
      } else {
        regular = H;
      }
      let remaining = { regular, overtime, doubletime };
      for (const row of group.rows) {
        const hours = Math.max(0, Number(row.hours_worked) || 0);
        const split = { regular: 0, overtime: 0, doubletime: 0 };
        let left = hours;
        for (const tier of ['regular', 'overtime', 'doubletime']) {
          const take = Math.min(left, remaining[tier]);
          split[tier] = take;
          remaining[tier] -= take;
          left -= take;
        }
        // Defensive: any rounding residue lands in the tier it came from.
        if (left > 0) split.regular += left;
        rowSplit.set(row, split);
      }
    }

    // Weekly overtime: convert regular hours past the policy threshold
    // to overtime, walking the week in REVERSE chronological order so
    // the last regular hours in the week are the overtime ones (the
    // threshold is crossed at the end of the week, not the start).
    const weeks = new Map();
    for (const row of sortedPieces) {
      const week = weekStartOf(entryDate(row), row.location_id == null ? null : Number(row.location_id));
      const split = rowSplit.get(row);
      weeks.set(week, (weeks.get(week) || 0)
        + (split.regular + split.overtime + split.doubletime));
    }
    const weeklyRegular = new Map();
    for (const row of sortedPieces) {
      const week = weekStartOf(entryDate(row), row.location_id == null ? null : Number(row.location_id));
      weeklyRegular.set(week, (weeklyRegular.get(week) || 0) + (rowSplit.get(row)?.regular || 0));
    }
    const weeklyExcess = new Map();
    // Weekly overtime threshold: the jurisdiction's weekly threshold
    // for the week, not just the policy number. When no explicit
    // policy threshold exists (the 40h default), the jurisdiction
    // row governs: GB-UK pays OT above 48h, CA-ON above 44h. An
    // explicitly configured threshold still applies, capped by the
    // jurisdiction: an operator may pay OT earlier than the statute,
    // never later. A week spanning jurisdictions uses the lowest
    // weekly threshold among its locations. Caller-constructed
    // policies without the explicit flag count as explicit.
    const policyThreshold = Number(policy.overtime_threshold_hours);
    const policyExplicit = policy.overtime_threshold_explicit !== false;
    const jurisdictionWeekly = new Map();
    for (const row of sortedPieces) {
      const week = weekStartOf(entryDate(row), row.location_id == null ? null : Number(row.location_id));
      const rules = resolve(row.location_id == null ? null : Number(row.location_id));
      const weekly = rules.weekly_overtime_hours == null ? null : Number(rules.weekly_overtime_hours);
      if (weekly == null) continue;
      const current = jurisdictionWeekly.get(week);
      jurisdictionWeekly.set(week, current == null ? weekly : Math.min(current, weekly));
    }
    for (const [week, regularTotal] of weeklyRegular) {
      const jurisdictionThreshold = jurisdictionWeekly.get(week);
      const effectiveThreshold = jurisdictionThreshold == null
        ? policyThreshold
        : policyExplicit
          ? Math.min(policyThreshold, jurisdictionThreshold)
          : jurisdictionThreshold;
      weeklyExcess.set(week, Math.max(0, regularTotal - effectiveThreshold));
    }
    for (const row of [...sortedPieces].reverse()) {
      const week = weekStartOf(entryDate(row), row.location_id == null ? null : Number(row.location_id));
      let excess = weeklyExcess.get(week) || 0;
      if (excess > 0) {
        const split = rowSplit.get(row);
        const convert = Math.min(split.regular, excess);
        split.regular -= convert;
        split.overtime += convert;
        weeklyExcess.set(week, excess - convert);
      }
    }

    // Meal-break premium, one per person per day (finding 16): the
    // day's TOTAL hours decide whether a meal period was owed, and
    // only one CONTINUOUS break of the required duration satisfies
    // it — two 15-minute breaks do not add up to a 30-minute meal.
    // The strictest rule among the day's locations governs (earliest
    // trigger, longest required break, largest premium), matching
    // the daily-tier strictest-wins rule. The premium is attributed
    // to the day's first piece in the allocations, so scoped reports
    // still sum it exactly once. A missed meal is counted even where
    // the jurisdiction pays no premium for it (GB-UK).
    const mealByDate = new Map(); // date -> { missed, premiumHours }
    const firstPieceByDate = new Set(); // the first piece object per date
    const seenDates = new Set();
    const dayPieces = new Map();
    for (const row of sortedPieces) {
      const date = entryDate(row);
      if (!seenDates.has(date)) {
        seenDates.add(date);
        firstPieceByDate.add(row);
      }
      const list = dayPieces.get(date) || [];
      list.push(row);
      dayPieces.set(date, list);
    }
    for (const [date, dayRows] of dayPieces) {
      const dayRules = dayRows.map((row) => resolve(row.location_id == null ? null : Number(row.location_id)));
      const afters = dayRules
        .map((r) => (r.meal_break_after_minutes == null ? null : Number(r.meal_break_after_minutes)))
        .filter((v) => v != null);
      if (!afters.length) continue;
      const totalHours = dayRows.reduce((sum, r) => sum + Math.max(0, Number(r.hours_worked) || 0), 0);
      if (totalHours * 60 < Math.min(...afters)) continue;
      const durations = dayRules
        .map((r) => (r.meal_break_duration_minutes == null ? null : Number(r.meal_break_duration_minutes)))
        .filter((v) => v != null);
      const duration = durations.length ? Math.max(...durations) : 0;
      // Longest single continuous break that day. Breaks were
      // attributed whole to the piece their start falls on, so a
      // break spanning midnight still counts at its full length.
      let longestBreak = 0;
      for (const row of dayRows) {
        for (const item of Array.isArray(row.breaks) ? row.breaks : []) {
          const start = Date.parse(item?.started_at || '');
          const end = Date.parse(item?.ended_at || '');
          if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
            longestBreak = Math.max(longestBreak, (end - start) / 60000);
          }
        }
      }
      if (longestBreak < duration) {
        const premiumHours = Math.max(0, ...dayRules.map((r) => laborJurisdiction.mealBreakPremiumHours(r) || 0));
        mealByDate.set(date, { missed: 1, premiumHours });
      }
    }

    // Per-piece tiers with the per-day meal-break premium (above) and
    // the policy break exception, which stays per original punch.
    const user = {
      totalHours: 0, regularHours: 0, overtimeHours: 0, doubletimeHours: 0,
      breakExceptions: 0, missedMealBreaks: 0, mealBreakPremiumHours: 0, weeks,
    };
    for (const row of sortedPieces) {
      const hours = Math.max(0, Number(row.hours_worked) || 0);
      const split = rowSplit.get(row);
      const date = entryDate(row);
      const dayMeal = mealByDate.get(date);
      let missedMeal = 0;
      let mealPremiumHours = 0;
      if (dayMeal && firstPieceByDate.has(row)) {
        missedMeal = dayMeal.missed;
        mealPremiumHours = dayMeal.premiumHours;
      }
      let breakException = 0;
      if (row.firstPieceOfSource && row.sourceHours * 60 >= policy.break_after_minutes
        && row.sourceBreakMinutes < policy.break_duration_minutes) {
        breakException = 1;
      }
      user.totalHours += hours;
      user.regularHours += split.regular;
      user.overtimeHours += split.overtime;
      user.doubletimeHours += split.doubletime;
      user.breakExceptions += breakException;
      user.missedMealBreaks += missedMeal;
      user.mealBreakPremiumHours += mealPremiumHours;
      allocations.push({
        user_id: userId,
        entry_date: date,
        location_id: row.location_id == null ? null : Number(row.location_id),
        regular: split.regular,
        overtime: split.overtime,
        doubletime: split.doubletime,
        missed_meal_breaks: missedMeal,
        meal_break_premium_hours: mealPremiumHours,
        break_exception: breakException,
      });
    }
    user.totalHours = round2(user.totalHours);
    user.regularHours = round2(user.regularHours);
    user.overtimeHours = round2(user.overtimeHours);
    user.doubletimeHours = round2(user.doubletimeHours);
    user.mealBreakPremiumHours = round2(user.mealBreakPremiumHours);
    byUser.set(userId, user);
  }
  return { byUser, allocations };
}

// Calculate per-person hours under the restaurant's overtime/break
// policy and the locations' jurisdiction rules. `entry_date` is the
// local business date captured at clock-in, which keeps the calculation
// deterministic across DST boundaries. Kept backward compatible: with
// no rules resolver the US-FED preset applies (weekly-only), so the
// old weekly-threshold behavior is unchanged.
function calculatePolicyHours(rows, policy, rulesResolver = null, options = {}) {
  return tierRows(rows, policy, rulesResolver, options).byUser;
}

// Attribute overtime after applying the person's full weekly threshold across
// stores. Filtering punches first would silently reset overtime at each store.
// Daily/double-time tiers are per person per day across locations, so
// they attribute by row; the weekly threshold is applied to the full
// cross-store set first, then the in-scope rows are summed.
function scopedPolicyHours(rows, policy, locationIds, fromDate, toDate, rulesResolver = null, options = {}) {
  const { allocations } = tierRows(rows, policy, rulesResolver, options);
  const result = new Map();
  for (const alloc of allocations) {
    if (!locationIds.includes(Number(alloc.location_id)) || alloc.entry_date < fromDate || alloc.entry_date > toDate) continue;
    const user = result.get(alloc.user_id) || {
      totalHours: 0, regularHours: 0, overtimeHours: 0, doubletimeHours: 0,
      breakExceptions: 0, missedMealBreaks: 0, mealBreakPremiumHours: 0,
    };
    user.totalHours += alloc.regular + alloc.overtime + alloc.doubletime;
    user.regularHours += alloc.regular;
    user.overtimeHours += alloc.overtime;
    user.doubletimeHours += alloc.doubletime;
    user.breakExceptions += alloc.break_exception;
    user.missedMealBreaks += alloc.missed_meal_breaks;
    user.mealBreakPremiumHours += alloc.meal_break_premium_hours;
    result.set(alloc.user_id, user);
  }
  for (const user of result.values()) {
    user.totalHours = Math.round(user.totalHours * 100) / 100;
    user.regularHours = Math.round(user.regularHours * 100) / 100;
    user.overtimeHours = Math.round(user.overtimeHours * 100) / 100;
    user.doubletimeHours = Math.round(user.doubletimeHours * 100) / 100;
    user.mealBreakPremiumHours = Math.round(user.mealBreakPremiumHours * 100) / 100;
  }
  return result;
}

async function getPolicyHoursByUser(businessId, fromDate, toDate, policy, locationIds = null, payContext = null) {
  // Widen the fetch to whole workweeks so weekly overtime is computed
  // from full weeks: each in-scope location's week may start on a
  // different day (finding 32), so the range covers the earliest week
  // start and the latest week end among them. Without a pay context
  // the Sunday default reproduces the previous widening exactly.
  let rangeStart = fromDate;
  let rangeEnd = toDate;
  if (locationIds !== null) {
    const startDays = (Array.isArray(locationIds) ? locationIds : [])
      .map((id) => payContext?.jurisdictionsByLocation?.get(Number(id)))
      .filter(Boolean)
      .map((rules) => laborJurisdiction.workweekStartDay(rules));
    const days = startDays.length ? startDays : [0];
    const starts = days.map((d) => laborJurisdiction.weekStartOf(fromDate, d));
    const ends = days.map((d) => shiftDateString(laborJurisdiction.weekStartOf(toDate, d), 6));
    rangeStart = starts.sort()[0];
    rangeEnd = ends.sort().pop();
  }
  const { rows } = await pool.query(
    `SELECT user_id, entry_date, hours_worked, breaks, clock_in_at, clock_out_at, location_id
       FROM business_time_entries
      WHERE business_id = $1 AND entry_date >= $2 AND entry_date <= $3
        AND voided_at IS NULL AND hours_worked IS NOT NULL
      ORDER BY entry_date, clock_in_at NULLS FIRST, id`,
    [businessId, rangeStart, rangeEnd]
  );
  const rulesResolver = (locationId) => {
    if (payContext?.jurisdictionsByLocation?.has(locationId)) {
      return payContext.jurisdictionsByLocation.get(locationId);
    }
    return laborJurisdiction.resolveRules(null);
  };
  // Overnight hours split at the location's local midnight: the
  // location's own timezone wins, then the restaurant's, then UTC.
  const timezoneFor = (locationId) => {
    const loc = payContext?.locationsById?.get(Number(locationId));
    return loc?.timezone || payContext?.timezone || 'UTC';
  };
  const tierOptions = { timezoneFor, defaultTimezone: payContext?.timezone || 'UTC' };
  // Single-store scope prices the week under that store's own policy;
  // a multi-store or brand-wide view prices it under the restaurant
  // fallback policy (the cross-store weekly threshold is one number).
  let effectivePolicy = policy;
  if (Array.isArray(locationIds) && locationIds.length === 1
    && payContext?.policiesByLocation?.has(Number(locationIds[0]))) {
    effectivePolicy = payContext.policiesByLocation.get(Number(locationIds[0]));
  }
  return locationIds === null
    ? calculatePolicyHours(rows, effectivePolicy, rulesResolver, tierOptions)
    : scopedPolicyHours(rows, effectivePolicy, locationIds, fromDate, toDate, rulesResolver, tierOptions);
}

// ── Predictability premiums ──────────────────────────────────────────

// Sum predictability premiums for a period from the recorded schedule
// changes. The amount is the one stored at change time when the wage
// was known; when it was not, it is priced here from the current wage
// of record. Hours that still cannot be priced (no wage at all) are
// reported as unpriced hours so they are never silently treated as
// zero-owed: pay-run finalization fails closed while any remain.
//
// Currency: premiums are priced in the location currency at change
// time and recorded with that currency. Only premiums recorded in
// the run's currency (`currency`) land in premium_cents. A stored
// amount in another currency — or with no recorded currency, which
// cannot be verified — is excluded from pay and reported as
// excluded_premium_cents with its currencies, never silently
// converted or dropped; unpriced hours in another currency stay
// unpriced instead of being priced at this run's wage. Callers must
// pass the run currency; a null currency leaves the old unfiltered
// behavior for legacy callers.
async function getPredictabilityPremiums({ businessId, fromDate, toDate, timezone, locationIds = null, wagesByUser = new Map(), currency = null }) {
  const runCurrency = currency ? String(currency).trim().toUpperCase() : null;
  const { rows } = await pool.query(
    `SELECT user_id, location_id, premium_currency_code,
            COUNT(*)::int AS change_count,
            COALESCE(SUM(premium_hours), 0)::float8 AS premium_hours,
            COALESCE(SUM(premium_cents), 0)::int AS stored_cents,
            COUNT(*) FILTER (WHERE premium_cents IS NULL AND premium_hours IS NOT NULL)::int AS unpriced_rows,
            COALESCE(SUM(premium_hours) FILTER (WHERE premium_cents IS NULL), 0)::float8 AS unpriced_hours
       FROM business_staff_schedule_changes
      WHERE business_id = $1 AND premium_due
        AND created_at >= (($2::date)::timestamp AT TIME ZONE $3)
        AND created_at < ((($4::date + 1))::timestamp AT TIME ZONE $3)
        ${storeFilter(locationIds, 'location_id', 5)}
      GROUP BY user_id, location_id, premium_currency_code`,
    storeParams([businessId, fromDate, timezone, toDate], locationIds)
  );
  const byUser = new Map();
  for (const row of rows) {
    const user = byUser.get(row.user_id) || { premium_cents: 0, premium_hours: 0, unpriced_premium_hours: 0, change_count: 0, excluded_premium_cents: 0, excluded_premium_currencies: [] };
    const wage = wagesByUser.get(row.user_id);
    const storedCents = Number(row.stored_cents) || 0;
    const unpricedHours = Number(row.unpriced_hours) || 0;
    const storedCurrency = row.premium_currency_code ? String(row.premium_currency_code).trim().toUpperCase() : null;
    const currencyMatches = runCurrency == null || storedCurrency === runCurrency;
    if (currencyMatches) {
      const pricedNow = wage != null && unpricedHours > 0 ? Math.round(unpricedHours * wage) : 0;
      const stillUnpriced = wage != null ? 0 : unpricedHours;
      user.premium_cents += storedCents + pricedNow;
      user.unpriced_premium_hours += stillUnpriced;
    } else {
      user.excluded_premium_cents += storedCents;
      if (storedCurrency && !user.excluded_premium_currencies.includes(storedCurrency)) {
        user.excluded_premium_currencies.push(storedCurrency);
      }
      user.unpriced_premium_hours += unpricedHours;
    }
    user.premium_hours += Number(row.premium_hours) || 0;
    user.change_count += Number(row.change_count) || 0;
    byUser.set(row.user_id, user);
  }
  return byUser;
}

// Scheduled hours per user from business_staff_shifts (person-based
// schedule, migration 238 + restaurant_id from 951). Shifts pinned to
// another restaurant of the same business are excluded; legacy NULL
// rows belong to the business's (single) restaurant and count.
async function getScheduledHoursByUser(businessId, restaurantId, fromDate, toDate, locationIds = null) {
  const { rows } = await pool.query(
    `SELECT user_id,
            COALESCE(SUM(
              EXTRACT(EPOCH FROM (
                (end_time - start_time) +
                CASE WHEN end_time <= start_time THEN INTERVAL '24 hours' ELSE INTERVAL '0' END
              )) / 3600.0
            ), 0)::float8 AS hours
       FROM business_staff_shifts
      WHERE business_id = $1
        AND shift_date >= $2 AND shift_date <= $3
        AND (restaurant_id IS NULL OR restaurant_id = $4)${storeFilter(locationIds, 'location_id', 5)}
        -- S-04: planned labor counts published shifts; drafts are not
        -- commitments yet.
        AND published_at IS NOT NULL
      GROUP BY user_id`,
    storeParams([businessId, fromDate, toDate, restaurantId], locationIds)
  );
  const map = new Map();
  for (const row of rows) map.set(row.user_id, Number(row.hours) || 0);
  return map;
}

// ── Net collected revenue (F-07 definition, mirrored) ────────────────

// Per-order financials with the exact net-collected definition the
// F-07 sales report uses: recorded/captured POS payments minus refund
// payments when the order has payments, else the order total when
// payment_status = 'paid', else 0. Labor % divides by this number so
// the labor report and the sales report can never disagree.
const ORDER_FINANCIALS_CTE = `
  WITH order_financials AS (
    SELECT fo.*,
           CASE
             WHEN COALESCE(pos.payment_count, 0) > 0
               THEN GREATEST(0, pos.collected_cents - pos.refunded_cents)
             WHEN fo.payment_status = 'paid' THEN fo.total_cents
             ELSE 0
           END::int AS net_collected_cents
      FROM food_orders fo
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (
                 WHERE payment_type <> 'refund' AND status IN ('recorded','captured')
               )::int AS payment_count,
               COALESCE(SUM(amount_cents) FILTER (
                 WHERE payment_type <> 'refund' AND status IN ('recorded','captured')
               ), 0)::int AS collected_cents,
               COALESCE(SUM(amount_cents) FILTER (
                 WHERE payment_type = 'refund' AND status IN ('recorded','captured','refunded')
               ), 0)::int AS refunded_cents
          FROM restaurant_pos_payments p
         WHERE p.food_order_id = fo.id
      ) pos ON TRUE
     WHERE fo.restaurant_id = $1
       AND fo.created_at >= (($2::date)::timestamp AT TIME ZONE $4)
       AND fo.created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
  )`;

async function getRevenueByCurrency(restaurantId, fromDate, toDate, timezone, locationIds = null) {
  const { rows } = await pool.query(
    `${locationIds === null ? ORDER_FINANCIALS_CTE : ORDER_FINANCIALS_CTE.replace('WHERE fo.restaurant_id = $1', 'WHERE fo.restaurant_id = $1 AND fo.location_id = ANY($5::bigint[])')}
     SELECT COALESCE(NULLIF(currency_code, ''), 'USD') AS currency,
            COALESCE(SUM(net_collected_cents), 0)::int AS revenue_cents
       FROM order_financials
      GROUP BY 1
      ORDER BY revenue_cents DESC`,
    storeParams([restaurantId, fromDate, toDate, timezone], locationIds)
  );
  return rows.map((r) => ({ currency: r.currency, revenue_cents: Number(r.revenue_cents) || 0 }));
}

// ── Tip attribution + pool math ──────────────────────────────────────

// Split `amount` across weighted entries with exact cent conservation
// (largest remainder). entries: [{ key, weight }]. Returns Map key->cents.
function distributeCents(amount, entries) {
  const result = new Map();
  const totalWeight = entries.reduce((sum, e) => sum + Math.max(0, e.weight), 0);
  if (amount <= 0 || totalWeight <= 0) {
    for (const e of entries) result.set(e.key, 0);
    return result;
  }
  let assigned = 0;
  const parts = entries.map((e) => {
    const exact = (amount * Math.max(0, e.weight)) / totalWeight;
    const base = Math.floor(exact);
    assigned += base;
    return { key: e.key, base, remainder: exact - base };
  });
  parts.sort((a, b) => b.remainder - a.remainder);
  let leftover = amount - assigned;
  for (const part of parts) {
    if (leftover <= 0) break;
    part.base += 1;
    leftover -= 1;
  }
  for (const part of parts) result.set(part.key, part.base);
  return result;
}

async function getOrderTips(restaurantId, fromDate, toDate, timezone, locationIds = null) {
  // Tips count only on orders that actually collected money (the F-07
  // rule), excluding cancelled/refunded orders. Attribution: the acting
  // staff member stamped on the order (S-06), falling back to the staff
  // member who owned the POS shift recorded on the order; orders with
  // neither (online, kiosk without a shift) are unattributed.
  const { rows } = await pool.query(
    `${locationIds === null ? ORDER_FINANCIALS_CTE : ORDER_FINANCIALS_CTE.replace('WHERE fo.restaurant_id = $1', 'WHERE fo.restaurant_id = $1 AND fo.location_id = ANY($5::bigint[])')}
     SELECT COALESCE(NULLIF(fo.currency_code, ''), 'USD') AS currency,
            -- S-06: the acting staff member stamped on the order is the
            -- precise attribution; the POS shift owner is the fallback
            -- for orders placed before PIN sessions existed.
            COALESCE(fo.acting_staff_user_id, s.staff_user_id) AS staff_user_id,
            COALESCE(SUM(fo.tip_cents), 0)::int AS tips_cents
       FROM order_financials fo
       LEFT JOIN restaurant_pos_shifts s
         ON s.id = CASE WHEN fo.metadata->>'shiftId' ~ '^[0-9]+$'
                        THEN (fo.metadata->>'shiftId')::bigint END
      WHERE fo.tip_cents > 0
        AND fo.net_collected_cents > 0
        AND fo.status NOT IN ('cancelled', 'refunded')
      GROUP BY 1, 2`,
    storeParams([restaurantId, fromDate, toDate, timezone], locationIds)
  );
  return rows;
}

async function getDeclaredCashTips(restaurantId, fromDate, toDate, locationIds = null) {
  // Review state (Phase 3 Track B): only CONFIRMED declarations count
  // toward tips and pay. A pending self-declaration, or a rejected one,
  // must never inflate the payroll basis.
  const { rows } = await pool.query(
    `SELECT staff_user_id, COALESCE(SUM(amount_cents), 0)::int AS tips_cents
       FROM restaurant_declared_cash_tips
      WHERE restaurant_id = $1 AND business_date >= $2 AND business_date <= $3
        AND status = 'confirmed'${storeFilter(locationIds, 'location_id', 4)}
      GROUP BY staff_user_id`,
    storeParams([restaurantId, fromDate, toDate], locationIds)
  );
  return rows;
}

/**
 * Compute tip allocations for a period.
 * ctx: { restaurant, fromDate, toDate } where restaurant is the
 * resolveRestaurantAccess row (id, business_id, currency_code, timezone).
 * Returns { currencies: [ { currency, total_tips_cents, unattributed_cents,
 *           pooling_enabled, employees: [{ user_id, name, job_role,
 *           gross_tips_cents, tip_out_cents, tip_in_cents, net_tips_cents }] } ],
 *           from_date, to_date, timezone }
 */
async function computeTipAllocations({ restaurant, fromDate, toDate, locationIds = null }) {
  const timezone = resolveReportTimezone(restaurant);
  const restaurantId = restaurant.id;
  const businessId = restaurant.business_id;
  const settings = await getTipPoolSettings(
    restaurantId,
    // Phase 8 Track B: a single-store computation prices tips with
    // that store's own pool settings. A multi-store computation
    // cannot price one pool two ways, so it keeps the
    // restaurant-level fallback — the per-store split is visible in
    // the per-store labor view, not inside one pooled allocation.
    Array.isArray(locationIds) && locationIds.length === 1 ? Number(locationIds[0]) : null
  );
  const [orderTips, cashTips, roster, hoursByUser] = await Promise.all([
    getOrderTips(restaurantId, fromDate, toDate, timezone, locationIds),
    getDeclaredCashTips(restaurantId, fromDate, toDate, locationIds),
    getRoster(businessId, locationIds, restaurant.id),
    getHoursByUser(businessId, fromDate, toDate, locationIds),
  ]);
  const rosterById = new Map(roster.map((m) => [m.user_id, m]));
  const restaurantCurrency = requireRestaurantCurrency(restaurant);

  // Gross per currency per user; declared cash lands in the
  // restaurant's own currency.
  const buckets = new Map(); // currency -> { gross: Map(userId->cents), unattributed }
  const bucketFor = (currency) => {
    if (!buckets.has(currency)) buckets.set(currency, { gross: new Map(), unattributed: 0 });
    return buckets.get(currency);
  };
  for (const row of orderTips) {
    const bucket = bucketFor(row.currency);
    const cents = Number(row.tips_cents) || 0;
    if (row.staff_user_id) {
      bucket.gross.set(row.staff_user_id, (bucket.gross.get(row.staff_user_id) || 0) + cents);
    } else {
      bucket.unattributed += cents;
    }
  }
  for (const row of cashTips) {
    const bucket = bucketFor(restaurantCurrency);
    const cents = Number(row.tips_cents) || 0;
    bucket.gross.set(row.staff_user_id, (bucket.gross.get(row.staff_user_id) || 0) + cents);
  }

  const currencies = [];
  for (const [currency, bucket] of buckets) {
    const grossTotal = [...bucket.gross.values()].reduce((a, b) => a + b, 0);
    const totalTips = grossTotal + bucket.unattributed;
    if (totalTips <= 0) continue;
    const tipOut = new Map(); // userId -> cents given
    const tipIn = new Map();  // userId -> cents received
    let unattributed = bucket.unattributed;

    if (settings.pooling_enabled && settings.tip_out_rules.length > 0) {
      const earners = [...bucket.gross.entries()]
        .filter(([, cents]) => cents > 0)
        .map(([userId, cents]) => ({ key: userId, weight: cents }));
      for (const rule of settings.tip_out_rules) {
        const pot = Math.floor((totalTips * rule.percent_bps) / 10000);
        if (pot <= 0) continue;
        // Who receives?
        let recipients = [];
        if (rule.target_type === 'role') {
          recipients = roster
            .filter((m) => m.job_role && m.job_role.toLowerCase() === rule.target_key.toLowerCase()
              && m.membership_role !== 'owner'
              && ((hoursByUser.get(m.user_id) || 0) > 0 || (bucket.gross.get(m.user_id) || 0) > 0))
            .map((m) => m.user_id);
        } else {
          recipients = earners.map((e) => e.key);
          if (recipients.length === 0) {
            recipients = roster
              .filter((m) => (hoursByUser.get(m.user_id) || 0) > 0)
              .map((m) => m.user_id);
          }
        }
        if (recipients.length === 0) continue; // nowhere for it to go: no deduction.
        // Deduct the pot from earners proportional to gross tips;
        // whatever cannot come from earners comes from unattributed.
        let remaining = pot;
        if (earners.length > 0) {
          const deductions = distributeCents(Math.min(pot, grossTotal), earners);
          for (const [userId, cents] of deductions) {
            if (cents > 0) tipOut.set(userId, (tipOut.get(userId) || 0) + cents);
            remaining -= cents;
          }
        }
        if (remaining > 0 && unattributed > 0) {
          const fromUnattributed = Math.min(remaining, unattributed);
          unattributed -= fromUnattributed;
          remaining -= fromUnattributed;
        }
        const payable = pot - remaining;
        if (payable <= 0) continue;
        // Phase 6 (gap 12): weight the split by the rule's weight_basis.
        // 'equal' is the historical headcount split; 'hours' weights by
        // hours worked in the period (hoursByUser, already fetched) and
        // 'gross_tips' by gross tips earned. When every recipient weighs
        // zero under hours/gross_tips (e.g. support staff with no recorded
        // hours or tips), fall back to equal so the pot still distributes
        // in full and cent conservation holds.
        const weightBasis = rule.weight_basis || 'equal';
        const weightedRecipients = recipients.map((userId) => ({
          key: userId,
          weight: weightBasis === 'hours'
            ? (hoursByUser.get(userId) || 0)
            : weightBasis === 'gross_tips'
              ? (bucket.gross.get(userId) || 0)
              : 1,
        }));
        const totalWeight = weightedRecipients.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
        const shares = distributeCents(
          payable,
          totalWeight > 0 ? weightedRecipients : recipients.map((userId) => ({ key: userId, weight: 1 }))
        );
        for (const [userId, cents] of shares) {
          if (cents > 0) tipIn.set(userId, (tipIn.get(userId) || 0) + cents);
        }
      }
    }

    const employeeIds = new Set([...bucket.gross.keys(), ...tipIn.keys()]);
    const employees = [...employeeIds].map((userId) => {
      const member = rosterById.get(userId);
      const gross = bucket.gross.get(userId) || 0;
      const out = tipOut.get(userId) || 0;
      const into = tipIn.get(userId) || 0;
      return {
        user_id: userId,
        name: member ? member.name : null,
        job_role: member ? member.job_role : null,
        gross_tips_cents: gross,
        tip_out_cents: out,
        tip_in_cents: into,
        net_tips_cents: gross - out + into,
      };
    }).sort((a, b) => b.net_tips_cents - a.net_tips_cents);

    currencies.push({
      currency,
      total_tips_cents: totalTips,
      unattributed_cents: unattributed,
      pooling_enabled: settings.pooling_enabled,
      employees,
    });
  }
  currencies.sort((a, b) => b.total_tips_cents - a.total_tips_cents);
  return { from_date: fromDate, to_date: toDate, timezone, currencies };
}

// ── Labor + payroll ──────────────────────────────────────────────────

async function computeLabor({ restaurant, fromDate, toDate, locationIds = null }) {
  const timezone = resolveReportTimezone(restaurant);
  const businessId = restaurant.business_id;
  // Currency is per location: a single-store view prices in that
  // store's currency when it has one, otherwise the restaurant's.
  // Amounts stay integer minor units; the currency's precision is
  // reported alongside so clients format them correctly.
  const payContext = await getLocationPayContext(restaurant.id, locationIds);
  const singleLocationId = Array.isArray(locationIds) && locationIds.length === 1 ? Number(locationIds[0]) : null;
  const restaurantCurrency = requireRestaurantCurrency(restaurant);
  const locationCurrency = singleLocationId != null
    ? payContext.locationsById.get(singleLocationId)?.currency_code || null
    : null;
  const effectiveCurrency = locationCurrency || restaurantCurrency;
  const [roster, hoursByUser, scheduledByUser, revenues, tipAllocations, fallbackPolicy, systemClosedByUser, attestationByUser] = await Promise.all([
    getRoster(businessId, locationIds, restaurant.id),
    getHoursByUser(businessId, fromDate, toDate, locationIds),
    getScheduledHoursByUser(businessId, restaurant.id, fromDate, toDate, locationIds),
    getRevenueByCurrency(restaurant.id, fromDate, toDate, timezone, locationIds),
    computeTipAllocations({ restaurant, fromDate, toDate, locationIds }),
    getLaborPolicy(restaurant.id),
    getSystemClosedByUser(businessId, fromDate, toDate, locationIds),
    breakAttestation.attestationSummaryByUser(pool, { businessId, fromDate, toDate, locationIds }),
  ]);
  // The policy this report was computed under: the single scoped
  // store's own policy when one store is in scope, else the
  // restaurant-level fallback.
  const laborPolicy = singleLocationId != null && payContext.policiesByLocation.has(singleLocationId)
    ? payContext.policiesByLocation.get(singleLocationId)
    : fallbackPolicy;
  const policyHours = await getPolicyHoursByUser(businessId, fromDate, toDate, laborPolicy, locationIds, payContext);
  const rosterByIdForWages = new Map(roster.map((m) => [m.user_id, m]));
  const wagesByUser = new Map();
  for (const [userId, member] of rosterByIdForWages) {
    if (member.hourly_wage_cents != null) wagesByUser.set(userId, Number(member.hourly_wage_cents));
  }
  const predictabilityPremiums = await getPredictabilityPremiums({
    businessId, fromDate, toDate, timezone, locationIds, wagesByUser,
    currency: effectiveCurrency,
  });

  const tipsFor = (currency) => tipAllocations.currencies.find((c) => c.currency === currency)
    || { employees: [], unattributed_cents: 0, total_tips_cents: 0 };
  const primaryTips = tipsFor(effectiveCurrency);
  const tipsByUser = new Map(primaryTips.employees.map((e) => [e.user_id, e]));

  const employeeIds = new Set([
    ...roster.map((m) => m.user_id),
    ...hoursByUser.keys(),
    ...scheduledByUser.keys(),
    ...tipsByUser.keys(),
    ...predictabilityPremiums.keys(),
  ]);
  const rosterById = new Map(roster.map((m) => [m.user_id, m]));

  let totalHours = 0;
  let totalScheduledHours = 0;
  let laborCostCents = 0;
  let overtimeHours = 0;
  let overtimeWagesCents = 0;
  let doubletimeHours = 0;
  let doubletimeWagesCents = 0;
  let mealBreakPremiumCents = 0;
  let predictabilityPremiumCents = 0;
  let excludedPredictabilityPremiumCents = 0;
  let unpricedPremiumHours = 0;
  let missedMealBreaks = 0;
  let breakExceptions = 0;
  let attestedBreaks = 0;
  let waivedBreaks = 0;
  let missedBreaksAttested = 0;
  let disputedAttestations = 0;
  const missingWageUserIds = [];
  const employees = [];
  for (const userId of employeeIds) {
    const member = rosterById.get(userId);
    const policy = policyHours.get(userId) || { totalHours: 0, regularHours: 0, overtimeHours: 0, doubletimeHours: 0, breakExceptions: 0, missedMealBreaks: 0, mealBreakPremiumHours: 0 };
    const hours = Math.round((policy.totalHours || hoursByUser.get(userId) || 0) * 100) / 100;
    const regularHours = Math.max(0, Math.min(hours, Math.round((Number(policy.regularHours) || 0) * 100) / 100));
    const employeeOvertimeHours = Math.max(0, Math.min(hours - regularHours, Math.round((Number(policy.overtimeHours) || 0) * 100) / 100));
    const employeeDoubletimeHours = Math.max(0, Math.min(
      hours - regularHours - employeeOvertimeHours,
      Math.round((Number(policy.doubletimeHours) || 0) * 100) / 100));
    const employeeMealPremiumHours = Math.round((Number(policy.mealBreakPremiumHours) || 0) * 100) / 100;
    const employeeMissedMeals = Number(policy.missedMealBreaks) || 0;
    const scheduledHours = Math.round((scheduledByUser.get(userId) || 0) * 100) / 100;
    const wage = member && member.hourly_wage_cents != null ? Number(member.hourly_wage_cents) : null;
    const regularWagesCents = wage != null ? Math.round(regularHours * wage) : null;
    const employeeOvertimeWagesCents = wage != null
      ? Math.round(employeeOvertimeHours * wage * (laborPolicy.overtime_multiplier_bps / 10000)) : null;
    // Double time pays the policy's doubletime multiplier (2x by
    // default), never a hardcoded 2: the rate is a policy parameter
    // in the same shape as the overtime multiplier.
    const employeeDoubletimeWagesCents = wage != null
      ? Math.round(employeeDoubletimeHours * wage * (Number(laborPolicy.doubletime_multiplier_bps ?? 20000) / 10000)) : null;
    const employeeMealPremiumCents = wage != null
      ? Math.round(employeeMealPremiumHours * wage) : 0;
    const premium = predictabilityPremiums.get(userId)
      || { premium_cents: 0, premium_hours: 0, unpriced_premium_hours: 0, excluded_premium_cents: 0, excluded_premium_currencies: [] };
    const employeePredictabilityCents = Math.round(Number(premium.premium_cents) || 0);
    const employeeExcludedPredictabilityCents = Math.round(Number(premium.excluded_premium_cents) || 0);
    // Premium hours with no wage to price them are unpriced, never
    // silently zero: meal premiums need a wage, predictability
    // premiums already carry their own unpriced hours.
    const employeeUnpricedPremiumHours = Math.round(
      ((Number(premium.unpriced_premium_hours) || 0) + (wage == null ? employeeMealPremiumHours : 0)) * 100) / 100;
    const wagesCents = wage != null
      ? regularWagesCents + employeeOvertimeWagesCents + employeeDoubletimeWagesCents : null;
    if (hours > 0 && wage == null && member && member.membership_role !== 'owner') {
      missingWageUserIds.push(userId);
    }
    // Labor cost is everything owed for the work: wages plus both
    // premium types.
    if (wagesCents != null) laborCostCents += wagesCents;
    laborCostCents += employeeMealPremiumCents + employeePredictabilityCents;
    totalHours += hours;
    totalScheduledHours += scheduledHours;
    overtimeHours += employeeOvertimeHours;
    if (employeeOvertimeWagesCents != null) overtimeWagesCents += employeeOvertimeWagesCents;
    doubletimeHours += employeeDoubletimeHours;
    if (employeeDoubletimeWagesCents != null) doubletimeWagesCents += employeeDoubletimeWagesCents;
    mealBreakPremiumCents += employeeMealPremiumCents;
    predictabilityPremiumCents += employeePredictabilityCents;
    excludedPredictabilityPremiumCents += employeeExcludedPredictabilityCents;
    unpricedPremiumHours += employeeUnpricedPremiumHours;
    missedMealBreaks += employeeMissedMeals;
    breakExceptions += Number(policy.breakExceptions) || 0;
    const attestation = attestationByUser.get(userId);
    if (attestation) {
      attestedBreaks += attestation.attestations;
      waivedBreaks += attestation.waived_breaks;
      missedBreaksAttested += attestation.missed_breaks;
      disputedAttestations += attestation.disputed_attestations;
    }
    const tips = tipsByUser.get(userId) || {
      gross_tips_cents: 0, tip_out_cents: 0, tip_in_cents: 0, net_tips_cents: 0,
    };
    employees.push({
      user_id: userId,
      name: member ? member.name : null,
      membership_role: member ? member.membership_role : null,
      job_role: member ? member.job_role : null,
      hours,
      regular_hours: regularHours,
      overtime_hours: employeeOvertimeHours,
      doubletime_hours: employeeDoubletimeHours,
      scheduled_hours: scheduledHours,
      // Phase 2: hours from system-closed (forgotten) punches, kept
      // visible in payroll so they are reviewed, never silently paid
      // as ordinary hours.
      system_closed_hours: Math.round(((systemClosedByUser.get(userId)?.hours) || 0) * 100) / 100,
      system_closed_entries: (systemClosedByUser.get(userId)?.entries) || 0,
      hourly_wage_cents: wage,
      regular_wages_cents: regularWagesCents,
      overtime_wages_cents: employeeOvertimeWagesCents,
      doubletime_wages_cents: employeeDoubletimeWagesCents,
      wages_cents: wagesCents,
      break_exceptions: Number(policy.breakExceptions) || 0,
      missed_meal_breaks: employeeMissedMeals,
      meal_break_premium_hours: employeeMealPremiumHours,
      meal_break_premium_cents: employeeMealPremiumCents,
      predictability_premium_hours: Math.round((Number(premium.premium_hours) || 0) * 100) / 100,
      predictability_premium_cents: employeePredictabilityCents,
      excluded_predictability_premium_cents: employeeExcludedPredictabilityCents,
      excluded_predictability_premium_currencies: [...(premium.excluded_premium_currencies || [])],
      unpriced_premium_hours: employeeUnpricedPremiumHours,
      gross_tips_cents: tips.gross_tips_cents,
      tip_out_cents: tips.tip_out_cents,
      tip_in_cents: tips.tip_in_cents,
      net_tips_cents: tips.net_tips_cents,
      total_pay_cents: (wagesCents || 0) + employeeMealPremiumCents + employeePredictabilityCents + tips.net_tips_cents,
    });
  }
  employees.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const primaryRevenue = revenues.find((r) => r.currency === effectiveCurrency);
  const revenueCents = primaryRevenue ? primaryRevenue.revenue_cents : 0;
  const laborPercent = revenueCents > 0
    ? Math.round((laborCostCents / revenueCents) * 10000) / 100
    : null;
  const salesPerLaborHourCents = totalHours > 0
    ? Math.round(revenueCents / totalHours)
    : null;

  return {
    from_date: fromDate,
    to_date: toDate,
    timezone,
    currency: effectiveCurrency,
    currency_minor_unit_decimals: minorUnitDecimals(effectiveCurrency),
    revenues,
    revenue_cents: revenueCents,
    labor_cost_cents: laborCostCents,
    labor_percent: laborPercent,
    total_hours: Math.round(totalHours * 100) / 100,
    scheduled_hours: Math.round(totalScheduledHours * 100) / 100,
    overtime_hours: Math.round(overtimeHours * 100) / 100,
    overtime_wages_cents: overtimeWagesCents,
    doubletime_hours: Math.round(doubletimeHours * 100) / 100,
    doubletime_wages_cents: doubletimeWagesCents,
    meal_break_premium_cents: mealBreakPremiumCents,
    predictability_premium_cents: predictabilityPremiumCents,
    excluded_predictability_premium_cents: excludedPredictabilityPremiumCents,
    unpriced_premium_hours: Math.round(unpricedPremiumHours * 100) / 100,
    missed_meal_breaks: missedMealBreaks,
    break_exceptions: breakExceptions,
    break_attestations: {
      attested: attestedBreaks,
      waived: waivedBreaks,
      missed_attested: missedBreaksAttested,
      disputed: disputedAttestations,
    },
    labor_policy: laborPolicy,
    sales_per_labor_hour_cents: salesPerLaborHourCents,
    missing_wage_user_ids: missingWageUserIds,
    unattributed_tips_cents: primaryTips.unattributed_cents,
    employees,
  };
}

// ── Employee self-service (Phase 3 Track B) ─────────────────────────
// Every function here is scoped by the caller's own user id, passed in
// by the controller from req.user.id. No caller-supplied user id is
// ever accepted, so one employee cannot widen the scope to another's
// numbers. All math is the Phase 1-corrected computeTipAllocations /
// computeLabor, filtered to the caller after the fact — never recomputed.

function declarationShape(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    restaurant_id: Number(row.restaurant_id),
    staff_user_id: row.staff_user_id,
    business_date: row.business_date instanceof Date
      ? row.business_date.toISOString().slice(0, 10)
      : String(row.business_date).slice(0, 10),
    amount_cents: Number(row.amount_cents),
    declared_by: row.declared_by || null,
    note: row.note || null,
    location_id: row.location_id == null ? null : Number(row.location_id),
    idempotency_key: row.idempotency_key || null,
    status: row.status || 'confirmed',
    reviewed_by: row.reviewed_by || null,
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at || null,
  };
}

// The caller's own tips for a period: one entry per currency the caller
// actually earned in, plus their own declared cash tips (every status,
// so pending declarations are visible but clearly not yet in pay).
async function getMyTips({ restaurant, fromDate, toDate, userId, locationIds = null }) {
  const allocations = await computeTipAllocations({ restaurant, fromDate, toDate, locationIds });
  const currencies = [];
  for (const bucket of allocations.currencies) {
    const mine = (bucket.employees || []).find((e) => e.user_id === userId);
    if (!mine) continue;
    currencies.push({
      currency: bucket.currency,
      pooling_enabled: bucket.pooling_enabled,
      gross_tips_cents: mine.gross_tips_cents,
      tip_out_cents: mine.tip_out_cents,
      tip_in_cents: mine.tip_in_cents,
      net_tips_cents: mine.net_tips_cents,
    });
  }
  const declared = await listDeclaredCashTipsForUser(restaurant.id, userId, fromDate, toDate);
  return {
    from_date: fromDate,
    to_date: toDate,
    timezone: allocations.timezone,
    currencies,
    cash_tips: declared.map(declarationShape),
  };
}

// The caller's own pay for a period: their single computeLabor row
// (hours, wages, premiums, tips, total) or null when they are not on
// the roster / earned nothing in the period.
async function getMyPay({ restaurant, fromDate, toDate, userId, locationIds = null }) {
  const labor = await computeLabor({ restaurant, fromDate, toDate, locationIds });
  const employee = (labor.employees || []).find((e) => e.user_id === userId) || null;
  return {
    from_date: labor.from_date,
    to_date: labor.to_date,
    timezone: labor.timezone,
    currency: labor.currency,
    currency_minor_unit_decimals: labor.currency_minor_unit_decimals,
    employee,
  };
}

const PAY_STUB_STATUSES = ['finalized', 'paid'];

// Finalized (or paid) pay runs that carry a line for the caller, most
// recent period first. Draft and voided runs are never listed: a draft
// is not a pay statement, and a voided run is not payable.
async function listMyPayStubs(restaurantId, userId) {
  const { rows } = await pool.query(
    `SELECT pr.id, pr.period_from, pr.period_to, pr.status, pr.finalized_at,
            l.staff_label, l.total_pay_cents
       FROM restaurant_pay_runs pr
       JOIN restaurant_pay_run_lines l ON l.pay_run_id = pr.id
      WHERE pr.restaurant_id = $1 AND pr.status = ANY($3::text[])
        AND l.staff_user_id = $2
      ORDER BY pr.period_from DESC, pr.id DESC`,
    [restaurantId, userId, PAY_STUB_STATUSES]
  );
  return rows.map((row) => ({
    pay_run_id: Number(row.id),
    period_from: row.period_from instanceof Date ? row.period_from.toISOString().slice(0, 10) : String(row.period_from).slice(0, 10),
    period_to: row.period_to instanceof Date ? row.period_to.toISOString().slice(0, 10) : String(row.period_to).slice(0, 10),
    status: row.status,
    finalized_at: row.finalized_at || null,
    staff_label: row.staff_label || null,
    total_pay_cents: Number(row.total_pay_cents),
  }));
}

// One pay stub: the finalized/paid run plus the caller's own line only.
// Returns null when the run is not finalized/paid, has no line for the
// caller, or does not exist — all three read the same to the caller.
async function getMyPayStub(restaurantId, payRunId, userId) {
  const { rows: [run] } = await pool.query(
    `SELECT id, period_from, period_to, status, finalized_at, totals
       FROM restaurant_pay_runs
      WHERE id = $1 AND restaurant_id = $2 AND status = ANY($3::text[])`,
    [payRunId, restaurantId, PAY_STUB_STATUSES]
  );
  if (!run) return null;
  const { rows: [line] } = await pool.query(
    `SELECT * FROM restaurant_pay_run_lines
      WHERE pay_run_id = $1 AND staff_user_id = $2`,
    [payRunId, userId]
  );
  if (!line) return null;
  // Phase 5: the run totals are every employee's pay summed together,
  // so they never leave the server on an employee-scoped stub. The
  // caller gets their own line plus the run currency only.
  const runCurrency = (run.totals && typeof run.totals === 'object' && run.totals.currency)
    ? String(run.totals.currency)
    : null;
  return {
    pay_run: {
      id: Number(run.id),
      period_from: run.period_from instanceof Date ? run.period_from.toISOString().slice(0, 10) : String(run.period_from).slice(0, 10),
      period_to: run.period_to instanceof Date ? run.period_to.toISOString().slice(0, 10) : String(run.period_to).slice(0, 10),
      status: run.status,
      finalized_at: run.finalized_at || null,
      totals: runCurrency ? { currency: runCurrency } : {},
    },
    line: {
      staff_label: line.staff_label || null,
      regular_hours: Number(line.regular_hours),
      overtime_hours: Number(line.overtime_hours),
      doubletime_hours: Number(line.doubletime_hours || 0),
      hourly_wage_cents: line.hourly_wage_cents == null ? null : Number(line.hourly_wage_cents),
      regular_wages_cents: line.regular_wages_cents == null ? null : Number(line.regular_wages_cents),
      overtime_wages_cents: line.overtime_wages_cents == null ? null : Number(line.overtime_wages_cents),
      doubletime_wages_cents: line.doubletime_wages_cents == null ? null : Number(line.doubletime_wages_cents),
      wages_cents: line.wages_cents == null ? null : Number(line.wages_cents),
      meal_break_premium_cents: Number(line.meal_break_premium_cents || 0),
      predictability_premium_cents: Number(line.predictability_premium_cents || 0),
      gross_tips_cents: Number(line.gross_tips_cents),
      tip_out_cents: Number(line.tip_out_cents || 0),
      tip_in_cents: Number(line.tip_in_cents || 0),
      net_tips_cents: Number(line.net_tips_cents),
      total_pay_cents: Number(line.total_pay_cents),
    },
  };
}

function buildPayrollCsv(labor) {
  const header = [
    'employee', 'user_id', 'job_role', 'hours', 'regular_hours', 'overtime_hours', 'scheduled_hours',
    'hourly_wage_cents', 'regular_wages_cents', 'overtime_wages_cents', 'wages_cents', 'break_exceptions', 'gross_tips_cents', 'tip_out_cents',
    'tip_in_cents', 'net_tips_cents', 'total_pay_cents', 'currency',
    'period_from', 'period_to',
    // Phase 1 pay lines, appended so existing positional consumers keep
    // working. All amounts are integer minor units in labor.currency.
    'doubletime_hours', 'doubletime_wages_cents',
    'missed_meal_breaks', 'meal_break_premium_hours', 'meal_break_premium_cents',
    'predictability_premium_hours', 'predictability_premium_cents', 'unpriced_premium_hours',
  ];
  const lines = [header.join(',')];
  for (const e of labor.employees) {
    lines.push([
      e.name || '',
      e.user_id,
      e.job_role || '',
      e.hours,
      e.regular_hours,
      e.overtime_hours,
      e.scheduled_hours,
      e.hourly_wage_cents == null ? '' : e.hourly_wage_cents,
      e.regular_wages_cents == null ? '' : e.regular_wages_cents,
      e.overtime_wages_cents == null ? '' : e.overtime_wages_cents,
      e.wages_cents == null ? '' : e.wages_cents,
      e.break_exceptions,
      e.gross_tips_cents,
      e.tip_out_cents,
      e.tip_in_cents,
      e.net_tips_cents,
      e.total_pay_cents,
      labor.currency,
      labor.from_date,
      labor.to_date,
      e.doubletime_hours ?? 0,
      e.doubletime_wages_cents == null ? '' : e.doubletime_wages_cents,
      e.missed_meal_breaks ?? 0,
      e.meal_break_premium_hours ?? 0,
      e.meal_break_premium_cents ?? 0,
      e.predictability_premium_hours ?? 0,
      e.predictability_premium_cents ?? 0,
      e.unpriced_premium_hours ?? 0,
    ].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

// ── Exception report (S-16) ──────────────────────────────────────────

/**
 * Per-employee exceptions for a period: voids, refunds, comps and
 * discounts (POS data), no-sales / payouts / cash-outs (drawer ledger),
 * and scheduled shifts with no matching time entry ("missing punches" —
 * the hours model records dates + hours, not punch timestamps, so a
 * true late-punch delta cannot be computed until punch data exists;
 * a scheduled shift with no time entry is the honest exception).
 */
async function computeExceptions({ restaurant, fromDate, toDate, locationIds = null }) {
  const timezone = resolveReportTimezone(restaurant);
  const restaurantId = restaurant.id;
  const businessId = restaurant.business_id;
  const params = storeParams([restaurantId, fromDate, toDate, timezone], locationIds);

  const payContext = await getLocationPayContext(restaurantId, locationIds);
  const fallbackPolicy = await getLaborPolicy(restaurantId);
  const singleLocationId = Array.isArray(locationIds) && locationIds.length === 1 ? Number(locationIds[0]) : null;
  const effectivePolicy = singleLocationId != null && payContext.policiesByLocation.has(singleLocationId)
    ? payContext.policiesByLocation.get(singleLocationId)
    : fallbackPolicy;

  const [payments, discounts, drawerEvents, missingPunches, roster, policyHours, attestationByUser] = await Promise.all([
    pool.query(
      `SELECT created_by AS user_id,
              COUNT(*) FILTER (WHERE status = 'voided')::int AS voids,
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'voided'), 0)::int AS voided_cents,
              COUNT(*) FILTER (WHERE payment_type = 'refund' AND status IN ('recorded','captured','refunded'))::int AS refunds,
              COALESCE(SUM(amount_cents) FILTER (WHERE payment_type = 'refund' AND status IN ('recorded','captured','refunded')), 0)::int AS refund_cents,
              COUNT(*) FILTER (WHERE payment_type = 'comp' AND status IN ('recorded','captured'))::int AS comps,
              COALESCE(SUM(amount_cents) FILTER (WHERE payment_type = 'comp' AND status IN ('recorded','captured')), 0)::int AS comp_cents
         FROM restaurant_pos_payments
        WHERE restaurant_id = $1${storeFilter(locationIds, 'location_id', 5)} AND created_by IS NOT NULL
          AND created_at >= (($2::date)::timestamp AT TIME ZONE $4)
          AND created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
        GROUP BY created_by`,
      params
    ),
    pool.query(
      `SELECT COALESCE(fo.acting_staff_user_id, s.staff_user_id) AS user_id,
              COUNT(*)::int AS discounted_orders,
              COALESCE(SUM(fo.discount_cents), 0)::int AS discount_cents
         FROM food_orders fo
         JOIN restaurant_pos_shifts s
           ON s.id = CASE WHEN fo.metadata->>'shiftId' ~ '^[0-9]+$'
                          THEN (fo.metadata->>'shiftId')::bigint END
        WHERE fo.restaurant_id = $1${storeFilter(locationIds, 'fo.location_id', 5)}
          AND fo.discount_cents > 0
          AND fo.status NOT IN ('cancelled', 'refunded')
          AND COALESCE(fo.acting_staff_user_id, s.staff_user_id) IS NOT NULL
          AND fo.created_at >= (($2::date)::timestamp AT TIME ZONE $4)
          AND fo.created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
        GROUP BY COALESCE(fo.acting_staff_user_id, s.staff_user_id)`,
      params
    ),
    pool.query(
      `SELECT created_by AS user_id,
              COUNT(*) FILTER (WHERE event_type = 'no_sale')::int AS no_sales,
              COUNT(*) FILTER (WHERE event_type = 'payout')::int AS payouts,
              COALESCE(SUM(amount_cents) FILTER (WHERE event_type = 'payout'), 0)::int AS payout_cents,
              COUNT(*) FILTER (WHERE event_type = 'cash_out')::int AS cash_outs,
              COALESCE(SUM(amount_cents) FILTER (WHERE event_type = 'cash_out'), 0)::int AS cash_out_cents
         FROM restaurant_pos_drawer_events
        WHERE restaurant_id = $1${storeFilter(locationIds, 'location_id', 5)} AND created_by IS NOT NULL
          AND created_at >= (($2::date)::timestamp AT TIME ZONE $4)
          AND created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
        GROUP BY created_by`,
      params
    ),
    pool.query(
      `SELECT sh.user_id, COUNT(*)::int AS missing_punches
         FROM business_staff_shifts sh
        WHERE sh.business_id = $1
          AND sh.shift_date >= $2 AND sh.shift_date <= $3
          AND (sh.restaurant_id IS NULL OR sh.restaurant_id = $4)${storeFilter(locationIds, 'sh.location_id', 5)}
          -- S-04: only published shifts can be "missed punches".
          AND sh.published_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM business_time_entries te
             WHERE te.business_id = sh.business_id
               AND te.user_id = sh.user_id
               AND te.entry_date = sh.shift_date AND te.voided_at IS NULL AND te.location_id IS NOT DISTINCT FROM sh.location_id
          )
        GROUP BY sh.user_id`,
      storeParams([businessId, fromDate, toDate, restaurantId], locationIds)
    ),
    getRoster(businessId, locationIds, restaurant.id),
    getPolicyHoursByUser(businessId, fromDate, toDate, effectivePolicy, locationIds, payContext),
    breakAttestation.attestationSummaryByUser(pool, { businessId, fromDate, toDate, locationIds }),
  ]);

  const rosterById = new Map(roster.map((m) => [m.user_id, m]));
  const wagesByUser = new Map();
  for (const m of roster) {
    if (m.hourly_wage_cents != null) wagesByUser.set(m.user_id, Number(m.hourly_wage_cents));
  }
  // Premiums in the exceptions report are priced in the same
  // currency as the labor report for this scope, so the two reports
  // can never disagree about a premium (see getPredictabilityPremiums).
  const exceptionCurrency = singleLocationId != null
    ? payContext.locationsById.get(singleLocationId)?.currency_code || requireRestaurantCurrency(restaurant)
    : requireRestaurantCurrency(restaurant);
  const predictabilityPremiums = await getPredictabilityPremiums({
    businessId, fromDate, toDate, timezone, locationIds, wagesByUser,
    currency: exceptionCurrency,
  });
  const byUser = new Map();
  const blank = () => ({
    voids: 0, voided_cents: 0, refunds: 0, refund_cents: 0,
    comps: 0, comp_cents: 0, discounted_orders: 0, discount_cents: 0,
    no_sales: 0, payouts: 0, payout_cents: 0, cash_outs: 0, cash_out_cents: 0,
    missing_punches: 0,
    missed_meal_breaks: 0, meal_break_premium_hours: 0, meal_break_premium_cents: 0,
    // Phase 7 (gap 17): waived/missed breaks the employee attested, and
    // attestations that dispute the punch record. The premium for these
    // already flows through meal_break_premium_cents above (Phase 1
    // math on the punch record); these counts are the exception surface.
    waived_breaks: 0, missed_breaks_attested: 0, disputed_attestations: 0,
    predictability_premium_count: 0, predictability_premium_cents: 0,
    excluded_predictability_premium_cents: 0,
    unpriced_premium_hours: 0,
  });
  const merge = (userId, source) => {
    if (!userId) return;
    const row = byUser.get(userId) || blank();
    for (const key of Object.keys(blank())) {
      if (source[key] != null) row[key] = Number(source[key]) || 0;
    }
    byUser.set(userId, row);
  };
  for (const r of payments.rows) merge(r.user_id, r);
  for (const r of discounts.rows) merge(r.user_id, r);
  for (const r of drawerEvents.rows) merge(r.user_id, r);
  for (const r of missingPunches.rows) merge(r.user_id, r);
  // Missed meal breaks and their premium, priced from the wage of
  // record; unpriced when there is no wage.
  for (const [userId, policy] of policyHours) {
    const wage = wagesByUser.get(userId);
    const mealHours = Number(policy.mealBreakPremiumHours) || 0;
    merge(userId, {
      missed_meal_breaks: Number(policy.missedMealBreaks) || 0,
      meal_break_premium_hours: mealHours,
      meal_break_premium_cents: wage != null ? Math.round(mealHours * wage) : 0,
      unpriced_premium_hours: wage == null ? mealHours : 0,
    });
  }
  for (const [userId, premium] of predictabilityPremiums) {
    const row = byUser.get(userId) || blank();
    row.predictability_premium_count = Number(premium.change_count) || 0;
    row.predictability_premium_cents = Math.round(Number(premium.premium_cents) || 0);
    row.excluded_predictability_premium_cents = Math.round(Number(premium.excluded_premium_cents) || 0);
    row.excluded_predictability_premium_currencies = [...(premium.excluded_premium_currencies || [])];
    row.unpriced_premium_hours = Math.round(((row.unpriced_premium_hours || 0)
      + (Number(premium.unpriced_premium_hours) || 0)) * 100) / 100;
    byUser.set(userId, row);
  }
  for (const [userId, attestation] of attestationByUser) {
    merge(userId, {
      waived_breaks: attestation.waived_breaks,
      missed_breaks_attested: attestation.missed_breaks,
      disputed_attestations: attestation.disputed_attestations,
    });
  }

  const employees = [...byUser.entries()].map(([userId, counts]) => {
    const member = rosterById.get(userId);
    return {
      user_id: userId,
      name: member ? member.name : null,
      job_role: member ? member.job_role : null,
      ...counts,
    };
  }).sort((a, b) =>
    (b.voids + b.refunds + b.comps + b.no_sales + b.missing_punches)
    - (a.voids + a.refunds + a.comps + a.no_sales + a.missing_punches));

  return { from_date: fromDate, to_date: toDate, timezone, employees };
}

// ── Late inputs after finalization (finding 5) ───────────────────────
// A finalized run is an immutable snapshot, but the world does not
// stop at finalization: a predictability premium can be recorded
// late, a cash tip confirmed late, a punch correction approved late.
// Each of those was windowed out of the run it belonged to, and
// without a catch-up it would never be paid. Two halves:
//
// (a) Carry-forward: when the next run for the same restaurant is
//     built, late inputs from earlier finalized runs are pulled in
//     as separate, clearly-marked lines (carry_forward_* columns),
//     never merged into the regular lines. restaurant_pay_run_
//     carry_forwards records every carried input so one input is
//     never carried twice; the claim is an INSERT ... ON CONFLICT
//     DO NOTHING inside the run-creation transaction, so two runs
//     built at once cannot double-pay the same input.
// (b) Indicator: a finalized run reports inputs_changed_since_
//     finalization — late inputs that exist and have not been carried
//     forward yet — so a manager can see the money is outstanding.
//
// Pricing notes, all fail-closed:
// - Premiums carry only in the run currency (finding 6). A premium
//   stored in another currency, or with no recorded currency, stays
//   flagged in the indicator instead of being silently converted.
//   A premium with hours but no stored amount is priced at the
//   employee's current wage; with no wage at all its hours ride as
//   unpriced_premium_hours, which blocks finalization.
// - Late cash tips carry at face value as direct net tips. The prior
//   period's tip pool is not re-run: the pool already settled, and
//   re-pooling would rewrite other employees' settled shares.
// - Late-approved corrections change hours, so they are priced from
//   a recompute of the source period: current tier hours minus the
//   finalized lines' tier hours (carry-forward lines excluded from
//   the baseline), minus hours already carried, priced at the current
//   wage with the current overtime multiplier. Only a positive net
//   delta carries; a negative delta means the employee was overpaid
//   in the source run, which is flagged in the indicator and never
//   auto-deducted from a later run.

function runDateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function locationScopeClause(locationIds) {
  const ids = Array.isArray(locationIds) ? locationIds.map((id) => Number(id)).filter((id) => Number.isSafeInteger(id)) : [];
  return { ids, scoped: ids.length > 0 };
}

// Late predictability premiums for one source run: recorded after
// its finalization, for a shift dated inside its period. `excludeTargetRunId`
// is the run being (re)built, whose own carry rows must not count as
// "already carried" (-1 when there is no such run).
async function getLatePremiums(clientOrPool, { businessId, sourceRun, excludeTargetRunId = -1 }) {
  const { ids, scoped } = locationScopeClause(sourceRun.location_ids);
  const params = [businessId, sourceRun.finalized_at, runDateOnly(sourceRun.period_from), runDateOnly(sourceRun.period_to)];
  const locationClause = scoped ? `AND (sc.location_id IS NULL OR sc.location_id = ANY($${params.push(ids)}::bigint[]))` : '';
  const excludeParam = params.push(excludeTargetRunId);
  const { rows } = await clientOrPool.query(
    `SELECT sc.id, sc.user_id, sc.premium_cents, sc.premium_hours, sc.premium_currency_code
       FROM business_staff_schedule_changes sc
      WHERE sc.business_id = $1 AND sc.premium_due AND sc.created_at > $2
        AND (sc.before_state->>'shift_date')::date >= $3
        AND (sc.before_state->>'shift_date')::date <= $4
        ${locationClause}
        AND NOT EXISTS (
          SELECT 1 FROM restaurant_pay_run_carry_forwards cf
           WHERE cf.input_type = 'premium' AND cf.input_id = sc.id
             AND cf.target_pay_run_id <> $${excludeParam})
      ORDER BY sc.id`,
    params
  );
  return rows;
}

// Late-confirmed cash tips for one source run: business date inside
// its period, confirmed after its finalization. A declaration
// confirmed at creation has no reviewed_at, so its created_at is the
// confirmation time in that case.
async function getLateCashTips(clientOrPool, { restaurantId, sourceRun, excludeTargetRunId = -1 }) {
  const { ids, scoped } = locationScopeClause(sourceRun.location_ids);
  const params = [restaurantId, runDateOnly(sourceRun.period_from), runDateOnly(sourceRun.period_to), sourceRun.finalized_at];
  const locationClause = scoped ? `AND (location_id IS NULL OR location_id = ANY($${params.push(ids)}::bigint[]))` : '';
  const excludeParam = params.push(excludeTargetRunId);
  const { rows } = await clientOrPool.query(
    `SELECT id, staff_user_id, amount_cents
       FROM restaurant_declared_cash_tips
      WHERE restaurant_id = $1 AND business_date >= $2 AND business_date <= $3
        AND status = 'confirmed'
        AND (reviewed_at > $4 OR (reviewed_at IS NULL AND created_at > $4))
        ${locationClause}
        AND NOT EXISTS (
          SELECT 1 FROM restaurant_pay_run_carry_forwards cf
           WHERE cf.input_type = 'cash_tip' AND cf.input_id = restaurant_declared_cash_tips.id
             AND cf.target_pay_run_id <> $${excludeParam})
      ORDER BY id`,
    params
  );
  return rows;
}

// Late-approved punch corrections for one source run: decided after
// its finalization, for an entry dated inside its period. A
// correction is covered when a correction-hours carry row for the
// same employee was created after the decision — the carry is a
// per-employee hours delta, so coverage is per employee, not per
// correction row.
async function getLateCorrectionCount(clientOrPool, { businessId, sourceRun, excludeTargetRunId = -1 }) {
  const { ids, scoped } = locationScopeClause(sourceRun.location_ids);
  const params = [businessId, sourceRun.finalized_at, runDateOnly(sourceRun.period_from), runDateOnly(sourceRun.period_to)];
  const locationClause = scoped ? `AND (e.location_id IS NULL OR e.location_id = ANY($${params.push(ids)}::bigint[]))` : '';
  const sourceParam = params.push(sourceRun.id);
  const excludeParam = params.push(excludeTargetRunId);
  const { rows: [row] } = await clientOrPool.query(
    `SELECT COUNT(*)::int AS n
       FROM business_time_entry_corrections c
       JOIN business_time_entries e ON e.id = c.entry_id
      WHERE c.business_id = $1 AND c.status = 'approved' AND c.decided_at > $2
        AND e.entry_date >= $3 AND e.entry_date <= $4
        ${locationClause}
        AND NOT EXISTS (
          SELECT 1 FROM restaurant_pay_run_carry_forwards cf
           WHERE cf.source_pay_run_id = $${sourceParam} AND cf.input_type = 'correction_hours'
             AND cf.staff_user_id = e.user_id AND cf.created_at >= c.decided_at
             AND cf.target_pay_run_id <> $${excludeParam})`,
    params
  );
  return Number(row?.n || 0);
}

async function getLateInputsSummary(clientOrPool, { businessId, restaurantId, run, currency = null }) {
  const empty = {
    has_late_inputs: false,
    late_premiums: { count: 0, cents: 0, other_currency_count: 0, unpriced_hours: 0 },
    late_cash_tips: { count: 0, cents: 0 },
    late_corrections: { count: 0 },
    carried_forward: { premiums: 0, cash_tips: 0, correction_hours: 0 },
  };
  if (!run || !run.finalized_at) return empty;
  const runCurrency = (currency || run.currency_code || '').toString().trim().toUpperCase() || null;
  const [premiums, tips, correctionCount, carried] = await Promise.all([
    getLatePremiums(clientOrPool, { businessId, sourceRun: run, excludeTargetRunId: -1 }),
    getLateCashTips(clientOrPool, { restaurantId, sourceRun: run, excludeTargetRunId: -1 }),
    getLateCorrectionCount(clientOrPool, { businessId, sourceRun: run, excludeTargetRunId: -1 }),
    clientOrPool.query(
      `SELECT input_type, COUNT(*)::int AS n FROM restaurant_pay_run_carry_forwards
        WHERE source_pay_run_id = $1 GROUP BY input_type`,
      [run.id]
    ).catch(() => ({ rows: [] })),
  ]);
  const summary = { ...empty, late_corrections: { count: correctionCount } };
  for (const row of carried.rows || []) {
    if (row.input_type === 'premium') summary.carried_forward.premiums = Number(row.n) || 0;
    if (row.input_type === 'cash_tip') summary.carried_forward.cash_tips = Number(row.n) || 0;
    if (row.input_type === 'correction_hours') summary.carried_forward.correction_hours = Number(row.n) || 0;
  }
  for (const row of premiums) {
    const storedCurrency = row.premium_currency_code ? String(row.premium_currency_code).trim().toUpperCase() : null;
    summary.late_premiums.count += 1;
    if (runCurrency && storedCurrency !== runCurrency) {
      summary.late_premiums.other_currency_count += 1;
    } else {
      summary.late_premiums.cents += Number(row.premium_cents) || 0;
      if (row.premium_cents == null) summary.late_premiums.unpriced_hours += Number(row.premium_hours) || 0;
    }
  }
  for (const row of tips) {
    summary.late_cash_tips.count += 1;
    summary.late_cash_tips.cents += Number(row.amount_cents) || 0;
  }
  summary.has_late_inputs = summary.late_premiums.count > 0
    || summary.late_cash_tips.count > 0
    || summary.late_corrections.count > 0;
  return summary;
}

// Per-employee correction-hour deltas for one source run, from a
// recompute of the source period. Returns a Map userId -> {
// regular_hours, overtime_hours, doubletime_hours, wages_cents,
// hourly_wage_cents } for positive nets only.
async function getCorrectionHourDeltas(clientOrPool, { restaurant, sourceRun, excludeTargetRunId = -1 }) {
  const sourceLocationIds = locationScopeClause(sourceRun.location_ids).scoped
    ? locationScopeClause(sourceRun.location_ids).ids
    : null;
  const { rows: lines } = await clientOrPool.query(
    `SELECT staff_user_id,
            COALESCE(SUM(regular_hours), 0)::float8 AS regular_hours,
            COALESCE(SUM(overtime_hours), 0)::float8 AS overtime_hours,
            COALESCE(SUM(doubletime_hours), 0)::float8 AS doubletime_hours
       FROM restaurant_pay_run_lines
      WHERE pay_run_id = $1 AND carry_forward_source_run_id IS NULL
      GROUP BY staff_user_id`,
    [sourceRun.id]
  );
  const baseline = new Map(lines.map((row) => [String(row.staff_user_id), {
    regular_hours: Number(row.regular_hours) || 0,
    overtime_hours: Number(row.overtime_hours) || 0,
    doubletime_hours: Number(row.doubletime_hours) || 0,
  }]));
  const { rows: carriedRows } = await clientOrPool.query(
    `SELECT staff_user_id, details FROM restaurant_pay_run_carry_forwards
      WHERE source_pay_run_id = $1 AND input_type = 'correction_hours'
        AND target_pay_run_id <> $2`,
    [sourceRun.id, excludeTargetRunId]
  ).catch(() => ({ rows: [] }));
  const alreadyCarried = new Map();
  for (const row of carriedRows) {
    const key = String(row.staff_user_id);
    const details = row.details && typeof row.details === 'object' ? row.details : {};
    const prev = alreadyCarried.get(key) || { regular_hours: 0, overtime_hours: 0, doubletime_hours: 0 };
    prev.regular_hours += Number(details.regular_hours) || 0;
    prev.overtime_hours += Number(details.overtime_hours) || 0;
    prev.doubletime_hours += Number(details.doubletime_hours) || 0;
    alreadyCarried.set(key, prev);
  }
  const labor = await computeLabor({
    restaurant,
    fromDate: runDateOnly(sourceRun.period_from),
    toDate: runDateOnly(sourceRun.period_to),
    locationIds: sourceLocationIds,
  });
  const multiplier = Number(labor?.labor_policy?.overtime_multiplier_bps || 15000) / 10000;
  // Finding 47: double time prices at the policy multiplier, not a
  // hardcoded 2x — the same parameter computeLabor uses, so a carried
  // correction pays what the next run would pay for the same hour.
  const doubletimeMultiplier = Number(labor?.labor_policy?.doubletime_multiplier_bps ?? 20000) / 10000;
  // Wages for the delta come from the business membership directly,
  // not the recompute's roster: the recompute is store-scoped, and a
  // member without a store assignment would read as wageless even
  // though the business has a wage of record for them.
  const deltaUserIds = [];
  const rawDeltas = [];
  for (const employee of labor.employees || []) {
    if (employee.user_id == null) continue;
    const key = String(employee.user_id);
    const base = baseline.get(key) || { regular_hours: 0, overtime_hours: 0, doubletime_hours: 0 };
    const carried = alreadyCarried.get(key) || { regular_hours: 0, overtime_hours: 0, doubletime_hours: 0 };
    const regular = Math.round(((Number(employee.regular_hours) || 0) - base.regular_hours - carried.regular_hours) * 100) / 100;
    const overtime = Math.round(((Number(employee.overtime_hours) || 0) - base.overtime_hours - carried.overtime_hours) * 100) / 100;
    const doubletime = Math.round(((Number(employee.doubletime_hours) || 0) - base.doubletime_hours - carried.doubletime_hours) * 100) / 100;
    if (regular === 0 && overtime === 0 && doubletime === 0) continue;
    rawDeltas.push({ user_id: employee.user_id, regular, overtime, doubletime, fallbackWage: employee.hourly_wage_cents });
    deltaUserIds.push(employee.user_id);
  }
  const wagesByUser = new Map();
  if (deltaUserIds.length) {
    const { rows: wageRows } = await clientOrPool.query(
      `SELECT member_id,
              COALESCE(hourly_wage_cents,
                       CASE WHEN pay_rate_period = 'hour' THEN pay_rate_cents END) AS wage_cents
         FROM business_members
        WHERE business_id = $1 AND member_id = ANY($2::uuid[]) AND status = 'active'`,
      [restaurant.business_id, deltaUserIds]
    ).catch(() => ({ rows: [] }));
    for (const row of wageRows) {
      if (row.wage_cents != null) wagesByUser.set(String(row.member_id), Number(row.wage_cents));
    }
  }
  const deltas = new Map();
  for (const raw of rawDeltas) {
    const key = String(raw.user_id);
    const wage = wagesByUser.get(key) ?? (raw.fallbackWage == null ? null : Number(raw.fallbackWage));
    // No wage of record: the delta cannot be priced. It stays
    // flagged on the source run's indicator instead of being
    // carried at a guessed rate (or blocking the new run).
    if (wage == null) continue;
    const wages = Math.round(raw.regular * wage + raw.overtime * wage * multiplier + raw.doubletime * wage * doubletimeMultiplier);
    // A negative net is an overpayment in the source run. It is
    // flagged, never auto-deducted from a later run.
    if (wages <= 0) continue;
    deltas.set(key, {
      user_id: raw.user_id,
      regular_hours: raw.regular,
      overtime_hours: raw.overtime,
      doubletime_hours: raw.doubletime,
      hourly_wage_cents: wage,
      regular_wages_cents: Math.round(raw.regular * wage),
      overtime_wages_cents: Math.round(raw.overtime * wage * multiplier),
      doubletime_wages_cents: Math.round(raw.doubletime * wage * doubletimeMultiplier),
      wages_cents: wages,
    });
  }
  return deltas;
}

// Collect every not-yet-carried late input from finalized runs
// before the target period. Returns claimable items; the caller
// claims them inside the run-creation transaction via
// applyCarryForward, which drops any item another run claimed first.
// `wagesByUser` prices premiums that were stored as hours only.
async function buildCarryForwardItems(clientOrPool, {
  restaurant, targetPeriodFrom, targetPeriodTo, locationIds = null, currency = null, wagesByUser = new Map(), excludeTargetRunId = -1,
}) {
  // Finding 57: the run currency is the caller's priced currency
  // (labor.currency) or the restaurant's configured currency — never
  // an invented USD.
  const runCurrency = String(currency || requireRestaurantCurrency(restaurant)).trim().toUpperCase();
  const { ids: targetIds, scoped: targetScoped } = locationScopeClause(locationIds);
  const { rows: sources } = await clientOrPool.query(
    `SELECT * FROM restaurant_pay_runs
      WHERE restaurant_id = $1 AND status IN ('finalized', 'paid')
        AND period_to < $2
      ORDER BY period_to DESC, id DESC
      LIMIT 5`,
    [restaurant.id, runDateOnly(targetPeriodFrom)]
  ).catch(() => ({ rows: [] }));
  const items = [];
  for (const source of sources) {
    // A source run only feeds a target that covers at least one of
    // its stores (or either side is unscoped/legacy).
    const { ids: sourceIds, scoped: sourceScoped } = locationScopeClause(source.location_ids);
    if (targetScoped && sourceScoped && !sourceIds.some((id) => targetIds.includes(id))) continue;
    const businessId = restaurant.business_id;
    const [premiums, tips, deltas] = await Promise.all([
      getLatePremiums(clientOrPool, { businessId, sourceRun: source, excludeTargetRunId }),
      getLateCashTips(clientOrPool, { restaurantId: restaurant.id, sourceRun: source, excludeTargetRunId }),
      getCorrectionHourDeltas(clientOrPool, { restaurant, sourceRun: source, excludeTargetRunId }),
    ]);
    for (const row of premiums) {
      const storedCurrency = row.premium_currency_code ? String(row.premium_currency_code).trim().toUpperCase() : null;
      if (storedCurrency !== runCurrency) continue;
      // A premium stored as hours only is priced at the current wage;
      // fall back to the business membership when the new run's
      // (possibly store-scoped) labor has no wage for this employee.
      let wage = wagesByUser.get(String(row.user_id));
      if (wage == null) {
        const { rows: [wageRow] } = await clientOrPool.query(
          `SELECT COALESCE(hourly_wage_cents,
                           CASE WHEN pay_rate_period = 'hour' THEN pay_rate_cents END) AS wage_cents
             FROM business_members
            WHERE business_id = $1 AND member_id = $2 AND status = 'active'`,
          [businessId, row.user_id]
        ).catch(() => ({ rows: [] }));
        if (wageRow?.wage_cents != null) {
          wage = Number(wageRow.wage_cents);
          wagesByUser.set(String(row.user_id), wage);
        }
      }
      const storedCents = row.premium_cents == null ? null : Number(row.premium_cents);
      const pricedCents = storedCents != null
        ? storedCents
        : (wage != null ? Math.round((Number(row.premium_hours) || 0) * wage) : null);
      items.push({
        source_pay_run_id: Number(source.id),
        input_type: 'premium',
        input_id: Number(row.id),
        staff_user_id: row.user_id,
        amount_cents: pricedCents == null ? 0 : pricedCents,
        unpriced_premium_hours: pricedCents == null ? Math.round((Number(row.premium_hours) || 0) * 100) / 100 : 0,
        predictability_premium_cents: pricedCents == null ? 0 : pricedCents,
      });
    }
    for (const row of tips) {
      items.push({
        source_pay_run_id: Number(source.id),
        input_type: 'cash_tip',
        input_id: Number(row.id),
        staff_user_id: row.staff_user_id,
        amount_cents: Number(row.amount_cents) || 0,
        gross_tips_cents: Number(row.amount_cents) || 0,
        net_tips_cents: Number(row.amount_cents) || 0,
      });
    }
    for (const delta of deltas.values()) {
      items.push({
        source_pay_run_id: Number(source.id),
        input_type: 'correction_hours',
        input_id: null,
        staff_user_id: delta.user_id,
        amount_cents: delta.wages_cents,
        regular_hours: delta.regular_hours,
        overtime_hours: delta.overtime_hours,
        doubletime_hours: delta.doubletime_hours,
        hourly_wage_cents: delta.hourly_wage_cents,
        regular_wages_cents: delta.regular_wages_cents,
        overtime_wages_cents: delta.overtime_wages_cents,
        doubletime_wages_cents: delta.doubletime_wages_cents,
        wages_cents: delta.wages_cents,
        correction_details: {
          regular_hours: delta.regular_hours,
          overtime_hours: delta.overtime_hours,
          doubletime_hours: delta.doubletime_hours,
          wages_cents: delta.wages_cents,
        },
      });
    }
  }
  return items;
}

// Claim carry-forward items inside the run-creation transaction and
// build the marked lines for the claimed ones. Items another run
// claimed first are dropped (ON CONFLICT DO NOTHING), so a late
// input is paid exactly once. Returns the pay-run-line-shaped rows
// (with carry_forward_* markers) for the caller to insert.
async function applyCarryForward(client, targetPayRunId, items) {
  const claimed = [];
  for (const item of items) {
    const { rows } = await client.query(
      `INSERT INTO restaurant_pay_run_carry_forwards
         (source_pay_run_id, target_pay_run_id, input_type, input_id,
          staff_user_id, amount_cents, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        item.source_pay_run_id,
        targetPayRunId,
        item.input_type,
        item.input_id,
        item.staff_user_id,
        item.amount_cents,
        JSON.stringify(item.correction_details || {}),
      ]
    );
    if (rows.length) claimed.push(item);
  }
  if (!claimed.length) return [];
  // One marked line per employee per source run, so a carry is never
  // silently merged into that employee's regular line.
  const byKey = new Map();
  for (const item of claimed) {
    const key = `${item.source_pay_run_id}|${String(item.staff_user_id)}`;
    const line = byKey.get(key) || {
      staff_user_id: item.staff_user_id,
      staff_label: null,
      regular_hours: 0,
      overtime_hours: 0,
      doubletime_hours: 0,
      hourly_wage_cents: null,
      regular_wages_cents: 0,
      overtime_wages_cents: 0,
      doubletime_wages_cents: 0,
      wages_cents: 0,
      meal_break_premium_cents: 0,
      predictability_premium_cents: 0,
      unpriced_premium_hours: 0,
      gross_tips_cents: 0,
      tip_out_cents: 0,
      tip_in_cents: 0,
      net_tips_cents: 0,
      total_pay_cents: 0,
      carry_forward_source_run_id: item.source_pay_run_id,
      carry_forward_kind: item.input_type,
      _kinds: new Set(),
    };
    line._kinds.add(item.input_type);
    if (item.input_type === 'premium') {
      line.predictability_premium_cents += Number(item.predictability_premium_cents) || 0;
      line.unpriced_premium_hours = Math.round(((Number(line.unpriced_premium_hours) || 0)
        + (Number(item.unpriced_premium_hours) || 0)) * 100) / 100;
    }
    if (item.input_type === 'cash_tip') {
      line.gross_tips_cents += Number(item.gross_tips_cents) || 0;
      line.net_tips_cents += Number(item.net_tips_cents) || 0;
    }
    if (item.input_type === 'correction_hours') {
      line.regular_hours = Math.round(((Number(line.regular_hours) || 0) + (Number(item.regular_hours) || 0)) * 100) / 100;
      line.overtime_hours = Math.round(((Number(line.overtime_hours) || 0) + (Number(item.overtime_hours) || 0)) * 100) / 100;
      line.doubletime_hours = Math.round(((Number(line.doubletime_hours) || 0) + (Number(item.doubletime_hours) || 0)) * 100) / 100;
      line.hourly_wage_cents = item.hourly_wage_cents;
      line.regular_wages_cents += Number(item.regular_wages_cents) || 0;
      line.overtime_wages_cents += Number(item.overtime_wages_cents) || 0;
      line.doubletime_wages_cents += Number(item.doubletime_wages_cents) || 0;
      line.wages_cents += Number(item.wages_cents) || 0;
    }
    byKey.set(key, line);
  }
  const lines = [...byKey.values()];
  // Names for the marked lines, from the users table.
  const userIds = [...new Set(lines.map((line) => String(line.staff_user_id)).filter(Boolean))];
  if (userIds.length) {
    const { rows } = await client.query(
      `SELECT id, COALESCE(NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), email) AS name
         FROM users WHERE id = ANY($1::uuid[])`,
      [userIds]
    ).catch(() => ({ rows: [] }));
    const names = new Map(rows.map((row) => [String(row.id), row.name]));
    for (const line of lines) line.staff_label = names.get(String(line.staff_user_id)) || null;
  }
  for (const line of lines) {
    line.total_pay_cents = (Number(line.wages_cents) || 0)
      + (Number(line.meal_break_premium_cents) || 0)
      + (Number(line.predictability_premium_cents) || 0)
      + (Number(line.net_tips_cents) || 0);
    line.carry_forward_kind = line._kinds.size > 1 ? 'mixed' : [...line._kinds][0];
    delete line._kinds;
  }
  return lines.filter((line) => Number(line.total_pay_cents) !== 0 || Number(line.unpriced_premium_hours) > 0);
}

module.exports = {
  resolveReportTimezone,
  isRealDateString,
  shiftDateString,
  parseLocalRange,
  normalizeTipOutRules,
  getTipPoolSettings,
  saveTipPoolSettings,
  declareCashTip,
  listDeclaredCashTipsForUser,
  reviewCashTip,
  declarationShape,
  getMyTips,
  getMyPay,
  listMyPayStubs,
  getMyPayStub,
  getRoster,
  getLaborPolicy,
  saveLaborPolicy,
  normalizeLaborPolicy,
  getLocationPayContext,
  getPolicyHoursByUser,
  calculatePolicyHours,
  scopedPolicyHours,
  tierRows,
  getPredictabilityPremiums,
  computeTipAllocations,
  computeLabor,
  buildPayrollCsv,
  computeExceptions,
  distributeCents,
  getLateInputsSummary,
  buildCarryForwardItems,
  applyCarryForward,
};
