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

function storeFilter(locationIds, column, parameter) {
  return locationIds === null ? '' : ` AND ${column} = ANY($${parameter}::bigint[])`;
}
function storeParams(params, locationIds) { return locationIds === null ? params : [...params, locationIds]; }

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
    });
  }
  if (totalBps > 10000) {
    const err = new Error('Tip-out rules cannot exceed 100% of tips in total');
    err.code = 'validation_failed';
    throw err;
  }
  return normalized;
}

async function getTipPoolSettings(restaurantId) {
  const { rows: [row] } = await pool.query(
    'SELECT restaurant_id, pooling_enabled, tip_out_rules, updated_by, updated_at FROM restaurant_tip_pool_settings WHERE restaurant_id = $1',
    [restaurantId]
  );
  if (!row) return { restaurant_id: restaurantId, pooling_enabled: false, tip_out_rules: [], updated_by: null, updated_at: null };
  return {
    restaurant_id: row.restaurant_id,
    pooling_enabled: row.pooling_enabled === true,
    tip_out_rules: normalizeTipOutRules(Array.isArray(row.tip_out_rules) ? row.tip_out_rules : []),
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

async function saveTipPoolSettings(restaurantId, { poolingEnabled, tipOutRules, updatedBy }) {
  const rules = normalizeTipOutRules(tipOutRules || []);
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
  return row;
}

async function declareCashTip(restaurantId, { staffUserId, businessDate, amountCents, declaredBy, note, locationId = null, idempotencyKey = null }) {
  const key = typeof idempotencyKey === 'string' && idempotencyKey.trim() ? idempotencyKey.trim().slice(0, 128) : null;
  // Background-jobs audit (finding P1): dedupe on a client-generated key
  // so a retry cannot double-declare and inflate the payroll basis. A
  // replay returns the original row instead of inserting a duplicate.
  if (key) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_declared_cash_tips
         (restaurant_id, staff_user_id, business_date, amount_cents, declared_by, note, location_id, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING id, restaurant_id, staff_user_id, business_date, amount_cents, declared_by, note, location_id, idempotency_key, created_at`,
      [restaurantId, staffUserId, businessDate, amountCents, declaredBy || null, note || null, locationId, key]
    );
    if (row) return row;
    const { rows: [existing] } = await pool.query(
      `SELECT id, restaurant_id, staff_user_id, business_date, amount_cents, declared_by, note, location_id, idempotency_key, created_at
         FROM restaurant_declared_cash_tips
        WHERE restaurant_id = $1 AND idempotency_key = $2
        LIMIT 1`,
      [restaurantId, key]
    );
    return { ...existing, replayed: true };
  }
  const { rows: [row] } = await pool.query(
    `INSERT INTO restaurant_declared_cash_tips
       (restaurant_id, staff_user_id, business_date, amount_cents, declared_by, note, location_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, restaurant_id, staff_user_id, business_date, amount_cents, declared_by, note, created_at`,
    [restaurantId, staffUserId, businessDate, amountCents, declaredBy || null, note || null, locationId]
  );
  return row;
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
  break_after_minutes: 360,
  break_duration_minutes: 30,
});

function normalizeLaborPolicy(row, restaurantId = null) {
  const source = row || {};
  return {
    restaurant_id: restaurantId != null ? restaurantId : source.restaurant_id,
    overtime_threshold_hours: Number(source.overtime_threshold_hours ?? DEFAULT_LABOR_POLICY.overtime_threshold_hours),
    overtime_multiplier_bps: Number(source.overtime_multiplier_bps ?? DEFAULT_LABOR_POLICY.overtime_multiplier_bps),
    break_after_minutes: Number(source.break_after_minutes ?? DEFAULT_LABOR_POLICY.break_after_minutes),
    break_duration_minutes: Number(source.break_duration_minutes ?? DEFAULT_LABOR_POLICY.break_duration_minutes),
    updated_by: source.updated_by || null,
    updated_at: source.updated_at || null,
  };
}

async function getLaborPolicy(restaurantId) {
  const { rows: [row] } = await pool.query(
    `SELECT restaurant_id, overtime_threshold_hours, overtime_multiplier_bps,
            break_after_minutes, break_duration_minutes, updated_by, updated_at
       FROM restaurant_labor_policies WHERE restaurant_id = $1`,
    [restaurantId]
  );
  return normalizeLaborPolicy(row, restaurantId);
}

async function saveLaborPolicy(restaurantId, policy, updatedBy) {
  const normalized = normalizeLaborPolicy({ ...policy, restaurant_id: restaurantId });
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
  const { rows: [row] } = await pool.query(
    `INSERT INTO restaurant_labor_policies
       (restaurant_id, overtime_threshold_hours, overtime_multiplier_bps,
        break_after_minutes, break_duration_minutes, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (restaurant_id) DO UPDATE SET
       overtime_threshold_hours = EXCLUDED.overtime_threshold_hours,
       overtime_multiplier_bps = EXCLUDED.overtime_multiplier_bps,
       break_after_minutes = EXCLUDED.break_after_minutes,
       break_duration_minutes = EXCLUDED.break_duration_minutes,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING restaurant_id, overtime_threshold_hours, overtime_multiplier_bps,
               break_after_minutes, break_duration_minutes, updated_by, updated_at`,
    [restaurantId, normalized.overtime_threshold_hours, normalized.overtime_multiplier_bps,
      normalized.break_after_minutes, normalized.break_duration_minutes, updatedBy || null]
  );
  return normalizeLaborPolicy(row, restaurantId);
}

// ── Hours (actual + scheduled) ───────────────────────────────────────

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

// Calculate per-person hours under the restaurant's weekly overtime and break
// policy. `entry_date` is the local business date captured at clock-in, which
// keeps the calculation deterministic across DST boundaries.
function calculatePolicyHours(rows, policy) {
  const byUser = new Map();
  for (const row of rows) {
    const user = byUser.get(row.user_id) || { totalHours: 0, overtimeHours: 0, breakExceptions: 0, weeks: new Map() };
    const hours = Math.max(0, Number(row.hours_worked) || 0);
    const entryDate = row.entry_date instanceof Date
      ? row.entry_date.toISOString().slice(0, 10)
      : String(row.entry_date).slice(0, 10);
    const date = new Date(`${entryDate}T12:00:00Z`);
    const weekStart = new Date(date);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    const weekKey = weekStart.toISOString().slice(0, 10);
    user.weeks.set(weekKey, (user.weeks.get(weekKey) || 0) + hours);
    user.totalHours += hours;
    if (hours * 60 >= policy.break_after_minutes) {
      const breaks = Array.isArray(row.breaks) ? row.breaks : [];
      const breakMinutes = breaks.reduce((sum, item) => {
        const start = Date.parse(item?.started_at || '');
        const end = Date.parse(item?.ended_at || '');
        return Number.isFinite(start) && Number.isFinite(end) && end > start
          ? sum + ((end - start) / 60000) : sum;
      }, 0);
      if (breakMinutes < policy.break_duration_minutes) user.breakExceptions += 1;
    }
    byUser.set(row.user_id, user);
  }
  for (const user of byUser.values()) {
    for (const weeklyHours of user.weeks.values()) {
      user.overtimeHours += Math.max(0, weeklyHours - policy.overtime_threshold_hours);
    }
    user.overtimeHours = Math.round(user.overtimeHours * 100) / 100;
    user.totalHours = Math.round(user.totalHours * 100) / 100;
  }
  return byUser;
}

// Attribute overtime after applying the person's full weekly threshold across
// stores. Filtering punches first would silently reset overtime at each store.
function scopedPolicyHours(rows, policy, locationIds, fromDate, toDate) {
  const weekly = new Map();
  const result = new Map();
  for (const row of rows) {
    const day = row.entry_date instanceof Date ? row.entry_date.toISOString().slice(0, 10) : String(row.entry_date).slice(0, 10);
    const date = new Date(`${day}T12:00:00Z`);
    const sunday = shiftDateString(day, -date.getUTCDay());
    const key = `${row.user_id}:${sunday}`;
    const before = weekly.get(key) || 0;
    const hours = Math.max(0, Number(row.hours_worked) || 0);
    weekly.set(key, before + hours);
    if (!locationIds.includes(Number(row.location_id)) || day < fromDate || day > toDate) continue;
    const entry = calculatePolicyHours([row], policy).get(row.user_id);
    const user = result.get(row.user_id) || { totalHours: 0, overtimeHours: 0, breakExceptions: 0 };
    user.totalHours += hours;
    user.overtimeHours += Math.max(0, before + hours - policy.overtime_threshold_hours) - Math.max(0, before - policy.overtime_threshold_hours);
    user.breakExceptions += entry.breakExceptions;
    result.set(row.user_id, user);
  }
  for (const user of result.values()) {
    user.totalHours = Math.round(user.totalHours * 100) / 100;
    user.overtimeHours = Math.round(user.overtimeHours * 100) / 100;
  }
  return result;
}

async function getPolicyHoursByUser(businessId, fromDate, toDate, policy, locationIds = null) {
  const rangeStart = locationIds === null ? fromDate : shiftDateString(fromDate, -new Date(`${fromDate}T12:00:00Z`).getUTCDay());
  const rangeEnd = locationIds === null ? toDate : shiftDateString(toDate, 6 - new Date(`${toDate}T12:00:00Z`).getUTCDay());
  const { rows } = await pool.query(
    `SELECT user_id, entry_date, hours_worked, breaks, clock_in_at, clock_out_at, location_id
       FROM business_time_entries
      WHERE business_id = $1 AND entry_date >= $2 AND entry_date <= $3
        AND voided_at IS NULL AND hours_worked IS NOT NULL
      ORDER BY entry_date, clock_in_at NULLS FIRST, id`,
    [businessId, rangeStart, rangeEnd]
  );
  return locationIds === null ? calculatePolicyHours(rows, policy) : scopedPolicyHours(rows, policy, locationIds, fromDate, toDate);
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
  const { rows } = await pool.query(
    `SELECT staff_user_id, COALESCE(SUM(amount_cents), 0)::int AS tips_cents
       FROM restaurant_declared_cash_tips
      WHERE restaurant_id = $1 AND business_date >= $2 AND business_date <= $3${storeFilter(locationIds, 'location_id', 4)}
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
  const settings = await getTipPoolSettings(restaurantId);
  const [orderTips, cashTips, roster, hoursByUser] = await Promise.all([
    getOrderTips(restaurantId, fromDate, toDate, timezone, locationIds),
    getDeclaredCashTips(restaurantId, fromDate, toDate, locationIds),
    getRoster(businessId, locationIds, restaurant.id),
    getHoursByUser(businessId, fromDate, toDate, locationIds),
  ]);
  const rosterById = new Map(roster.map((m) => [m.user_id, m]));
  const restaurantCurrency = restaurant.currency_code || 'USD';

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
        const shares = distributeCents(payable, recipients.map((userId) => ({ key: userId, weight: 1 })));
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
  const restaurantCurrency = restaurant.currency_code || 'USD';
  const [roster, hoursByUser, scheduledByUser, revenues, tipAllocations, laborPolicy] = await Promise.all([
    getRoster(businessId, locationIds, restaurant.id),
    getHoursByUser(businessId, fromDate, toDate, locationIds),
    getScheduledHoursByUser(businessId, restaurant.id, fromDate, toDate, locationIds),
    getRevenueByCurrency(restaurant.id, fromDate, toDate, timezone, locationIds),
    computeTipAllocations({ restaurant, fromDate, toDate, locationIds }),
    getLaborPolicy(restaurant.id),
  ]);
  const policyHours = await getPolicyHoursByUser(businessId, fromDate, toDate, laborPolicy, locationIds);

  const tipsFor = (currency) => tipAllocations.currencies.find((c) => c.currency === currency)
    || { employees: [], unattributed_cents: 0, total_tips_cents: 0 };
  const primaryTips = tipsFor(restaurantCurrency);
  const tipsByUser = new Map(primaryTips.employees.map((e) => [e.user_id, e]));

  const employeeIds = new Set([
    ...roster.map((m) => m.user_id),
    ...hoursByUser.keys(),
    ...scheduledByUser.keys(),
    ...tipsByUser.keys(),
  ]);
  const rosterById = new Map(roster.map((m) => [m.user_id, m]));

  let totalHours = 0;
  let totalScheduledHours = 0;
  let laborCostCents = 0;
  let overtimeHours = 0;
  let overtimeWagesCents = 0;
  let breakExceptions = 0;
  const missingWageUserIds = [];
  const employees = [];
  for (const userId of employeeIds) {
    const member = rosterById.get(userId);
    const policy = policyHours.get(userId) || { totalHours: 0, overtimeHours: 0, breakExceptions: 0 };
    const hours = Math.round((policy.totalHours || hoursByUser.get(userId) || 0) * 100) / 100;
    const employeeOvertimeHours = Math.min(hours, Math.max(0, Number(policy.overtimeHours) || 0));
    const regularHours = Math.max(0, Math.round((hours - employeeOvertimeHours) * 100) / 100);
    const scheduledHours = Math.round((scheduledByUser.get(userId) || 0) * 100) / 100;
    const wage = member && member.hourly_wage_cents != null ? Number(member.hourly_wage_cents) : null;
    const regularWagesCents = wage != null ? Math.round(regularHours * wage) : null;
    const employeeOvertimeWagesCents = wage != null
      ? Math.round(employeeOvertimeHours * wage * (laborPolicy.overtime_multiplier_bps / 10000)) : null;
    const wagesCents = wage != null ? regularWagesCents + employeeOvertimeWagesCents : null;
    if (hours > 0 && wage == null && member && member.membership_role !== 'owner') {
      missingWageUserIds.push(userId);
    }
    if (wagesCents != null) laborCostCents += wagesCents;
    totalHours += hours;
    totalScheduledHours += scheduledHours;
    overtimeHours += employeeOvertimeHours;
    if (employeeOvertimeWagesCents != null) overtimeWagesCents += employeeOvertimeWagesCents;
    breakExceptions += Number(policy.breakExceptions) || 0;
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
      scheduled_hours: scheduledHours,
      hourly_wage_cents: wage,
      regular_wages_cents: regularWagesCents,
      overtime_wages_cents: employeeOvertimeWagesCents,
      wages_cents: wagesCents,
      break_exceptions: Number(policy.breakExceptions) || 0,
      gross_tips_cents: tips.gross_tips_cents,
      tip_out_cents: tips.tip_out_cents,
      tip_in_cents: tips.tip_in_cents,
      net_tips_cents: tips.net_tips_cents,
      total_pay_cents: (wagesCents || 0) + tips.net_tips_cents,
    });
  }
  employees.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const primaryRevenue = revenues.find((r) => r.currency === restaurantCurrency);
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
    currency: restaurantCurrency,
    revenues,
    revenue_cents: revenueCents,
    labor_cost_cents: laborCostCents,
    labor_percent: laborPercent,
    total_hours: Math.round(totalHours * 100) / 100,
    scheduled_hours: Math.round(totalScheduledHours * 100) / 100,
    overtime_hours: Math.round(overtimeHours * 100) / 100,
    overtime_wages_cents: overtimeWagesCents,
    break_exceptions: breakExceptions,
    labor_policy: laborPolicy,
    sales_per_labor_hour_cents: salesPerLaborHourCents,
    missing_wage_user_ids: missingWageUserIds,
    unattributed_tips_cents: primaryTips.unattributed_cents,
    employees,
  };
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildPayrollCsv(labor) {
  const header = [
    'employee', 'user_id', 'job_role', 'hours', 'regular_hours', 'overtime_hours', 'scheduled_hours',
    'hourly_wage_cents', 'regular_wages_cents', 'overtime_wages_cents', 'wages_cents', 'break_exceptions', 'gross_tips_cents', 'tip_out_cents',
    'tip_in_cents', 'net_tips_cents', 'total_pay_cents', 'currency',
    'period_from', 'period_to',
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
    ].map(csvEscape).join(','));
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

  const [payments, discounts, drawerEvents, missingPunches, roster] = await Promise.all([
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
  ]);

  const rosterById = new Map(roster.map((m) => [m.user_id, m]));
  const byUser = new Map();
  const blank = () => ({
    voids: 0, voided_cents: 0, refunds: 0, refund_cents: 0,
    comps: 0, comp_cents: 0, discounted_orders: 0, discount_cents: 0,
    no_sales: 0, payouts: 0, payout_cents: 0, cash_outs: 0, cash_out_cents: 0,
    missing_punches: 0,
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

module.exports = {
  resolveReportTimezone,
  isRealDateString,
  shiftDateString,
  parseLocalRange,
  normalizeTipOutRules,
  getTipPoolSettings,
  saveTipPoolSettings,
  declareCashTip,
  getRoster,
  getLaborPolicy,
  saveLaborPolicy,
  normalizeLaborPolicy,
  getPolicyHoursByUser,
  calculatePolicyHours,
  computeTipAllocations,
  computeLabor,
  buildPayrollCsv,
  computeExceptions,
  distributeCents,
};
