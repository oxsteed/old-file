'use strict';

/**
 * restaurantPayrollService — pay, tips and labor data foundation for
 * restaurants (staff review S-04 / S-15 / S-16 / S-20).
 *
 * Scope is deliberately the DATA FOUNDATION the review asks to build
 * in-house:
 *   - tip attribution: order tips are attributed to the acting staff
 *     member through the POS shift recorded on the order
 *     (food_orders.metadata.shiftId -> restaurant_pos_shifts.staff_user_id);
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
 * NOT in scope (review direction is integrate-first, a vendor decision
 * for the owner): scheduling rules engines, availability / swap
 * workflows, overtime rules, and Fair Workweek / predictive-scheduling
 * compliance (S-20).
 *
 * Money is integer cents everywhere. Tip allocation conserves cents
 * exactly: sum(net tips) + unattributed == total tips, always.
 */

const pool = require('../db');

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
  if (!DATE_ONLY_RE.test(value)) return false;
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

async function declareCashTip(restaurantId, { staffUserId, businessDate, amountCents, declaredBy, note }) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO restaurant_declared_cash_tips
       (restaurant_id, staff_user_id, business_date, amount_cents, declared_by, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, restaurant_id, staff_user_id, business_date, amount_cents, declared_by, note, created_at`,
    [restaurantId, staffUserId, businessDate, amountCents, declaredBy || null, note || null]
  );
  return row;
}

// ── Roster ───────────────────────────────────────────────────────────

// Active team of the restaurant's business: members plus the owner,
// with job role + wage of record (migration 951 columns).
async function getRoster(businessId) {
  const { rows } = await pool.query(
    `SELECT bm.member_id AS user_id,
            COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
                     u.email) AS name,
            bm.role AS membership_role,
            bm.job_role,
            bm.hourly_wage_cents
       FROM business_members bm
       JOIN users u ON u.id = bm.member_id
      WHERE bm.business_id = $1 AND bm.status = 'active' AND bm.member_id IS NOT NULL
     UNION ALL
     SELECT b.user_id AS user_id,
            COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
                     u.email) AS name,
            'owner' AS membership_role,
            NULL AS job_role,
            NULL AS hourly_wage_cents
       FROM businesses b
       JOIN users u ON u.id = b.user_id
      WHERE b.id = $1`,
    [businessId]
  );
  return rows;
}

// ── Hours (actual + scheduled) ───────────────────────────────────────

// Actual recorded hours per user from business_time_entries (the
// hours_worked model the working staff-scheduling API writes).
async function getHoursByUser(businessId, fromDate, toDate) {
  const { rows } = await pool.query(
    `SELECT user_id, COALESCE(SUM(hours_worked), 0)::float8 AS hours
       FROM business_time_entries
      WHERE business_id = $1 AND entry_date >= $2 AND entry_date <= $3
      GROUP BY user_id`,
    [businessId, fromDate, toDate]
  );
  const map = new Map();
  for (const row of rows) map.set(row.user_id, Number(row.hours) || 0);
  return map;
}

// Scheduled hours per user from business_staff_shifts (person-based
// schedule, migration 238 + restaurant_id from 951). Shifts pinned to
// another restaurant of the same business are excluded; legacy NULL
// rows belong to the business's (single) restaurant and count.
async function getScheduledHoursByUser(businessId, restaurantId, fromDate, toDate) {
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
        AND (restaurant_id IS NULL OR restaurant_id = $4)
      GROUP BY user_id`,
    [businessId, fromDate, toDate, restaurantId]
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

async function getRevenueByCurrency(restaurantId, fromDate, toDate, timezone) {
  const { rows } = await pool.query(
    `${ORDER_FINANCIALS_CTE}
     SELECT COALESCE(NULLIF(currency_code, ''), 'USD') AS currency,
            COALESCE(SUM(net_collected_cents), 0)::int AS revenue_cents
       FROM order_financials
      GROUP BY 1
      ORDER BY revenue_cents DESC`,
    [restaurantId, fromDate, toDate, timezone]
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

async function getOrderTips(restaurantId, fromDate, toDate, timezone) {
  // Tips count only on orders that actually collected money (the F-07
  // rule), excluding cancelled/refunded orders. Attribution: the staff
  // member who owned the POS shift recorded on the order; orders with
  // no shift (online, kiosk without a shift) are unattributed.
  const { rows } = await pool.query(
    `${ORDER_FINANCIALS_CTE}
     SELECT COALESCE(NULLIF(fo.currency_code, ''), 'USD') AS currency,
            s.staff_user_id AS staff_user_id,
            COALESCE(SUM(fo.tip_cents), 0)::int AS tips_cents
       FROM order_financials fo
       LEFT JOIN restaurant_pos_shifts s
         ON s.id = CASE WHEN fo.metadata->>'shiftId' ~ '^[0-9]+$'
                        THEN (fo.metadata->>'shiftId')::bigint END
      WHERE fo.tip_cents > 0
        AND fo.net_collected_cents > 0
        AND fo.status NOT IN ('cancelled', 'refunded')
      GROUP BY 1, 2`,
    [restaurantId, fromDate, toDate, timezone]
  );
  return rows;
}

async function getDeclaredCashTips(restaurantId, fromDate, toDate) {
  const { rows } = await pool.query(
    `SELECT staff_user_id, COALESCE(SUM(amount_cents), 0)::int AS tips_cents
       FROM restaurant_declared_cash_tips
      WHERE restaurant_id = $1 AND business_date >= $2 AND business_date <= $3
      GROUP BY staff_user_id`,
    [restaurantId, fromDate, toDate]
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
async function computeTipAllocations({ restaurant, fromDate, toDate }) {
  const timezone = resolveReportTimezone(restaurant);
  const restaurantId = restaurant.id;
  const businessId = restaurant.business_id;
  const settings = await getTipPoolSettings(restaurantId);
  const [orderTips, cashTips, roster, hoursByUser] = await Promise.all([
    getOrderTips(restaurantId, fromDate, toDate, timezone),
    getDeclaredCashTips(restaurantId, fromDate, toDate),
    getRoster(businessId),
    getHoursByUser(businessId, fromDate, toDate),
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

async function computeLabor({ restaurant, fromDate, toDate }) {
  const timezone = resolveReportTimezone(restaurant);
  const businessId = restaurant.business_id;
  const restaurantCurrency = restaurant.currency_code || 'USD';
  const [roster, hoursByUser, scheduledByUser, revenues, tipAllocations] = await Promise.all([
    getRoster(businessId),
    getHoursByUser(businessId, fromDate, toDate),
    getScheduledHoursByUser(businessId, restaurant.id, fromDate, toDate),
    getRevenueByCurrency(restaurant.id, fromDate, toDate, timezone),
    computeTipAllocations({ restaurant, fromDate, toDate }),
  ]);

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
  const missingWageUserIds = [];
  const employees = [];
  for (const userId of employeeIds) {
    const member = rosterById.get(userId);
    const hours = Math.round((hoursByUser.get(userId) || 0) * 100) / 100;
    const scheduledHours = Math.round((scheduledByUser.get(userId) || 0) * 100) / 100;
    const wage = member && member.hourly_wage_cents != null ? Number(member.hourly_wage_cents) : null;
    const wagesCents = wage != null ? Math.round(hours * wage) : null;
    if (hours > 0 && wage == null && member && member.membership_role !== 'owner') {
      missingWageUserIds.push(userId);
    }
    if (wagesCents != null) laborCostCents += wagesCents;
    totalHours += hours;
    totalScheduledHours += scheduledHours;
    const tips = tipsByUser.get(userId) || {
      gross_tips_cents: 0, tip_out_cents: 0, tip_in_cents: 0, net_tips_cents: 0,
    };
    employees.push({
      user_id: userId,
      name: member ? member.name : null,
      membership_role: member ? member.membership_role : null,
      job_role: member ? member.job_role : null,
      hours,
      scheduled_hours: scheduledHours,
      hourly_wage_cents: wage,
      wages_cents: wagesCents,
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
    'employee', 'user_id', 'job_role', 'hours', 'scheduled_hours',
    'hourly_wage_cents', 'wages_cents', 'gross_tips_cents', 'tip_out_cents',
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
      e.scheduled_hours,
      e.hourly_wage_cents == null ? '' : e.hourly_wage_cents,
      e.wages_cents == null ? '' : e.wages_cents,
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
async function computeExceptions({ restaurant, fromDate, toDate }) {
  const timezone = resolveReportTimezone(restaurant);
  const restaurantId = restaurant.id;
  const businessId = restaurant.business_id;
  const params = [restaurantId, fromDate, toDate, timezone];

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
        WHERE restaurant_id = $1 AND created_by IS NOT NULL
          AND created_at >= (($2::date)::timestamp AT TIME ZONE $4)
          AND created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
        GROUP BY created_by`,
      params
    ),
    pool.query(
      `SELECT s.staff_user_id AS user_id,
              COUNT(*)::int AS discounted_orders,
              COALESCE(SUM(fo.discount_cents), 0)::int AS discount_cents
         FROM food_orders fo
         JOIN restaurant_pos_shifts s
           ON s.id = CASE WHEN fo.metadata->>'shiftId' ~ '^[0-9]+$'
                          THEN (fo.metadata->>'shiftId')::bigint END
        WHERE fo.restaurant_id = $1
          AND fo.discount_cents > 0
          AND fo.status NOT IN ('cancelled', 'refunded')
          AND s.staff_user_id IS NOT NULL
          AND fo.created_at >= (($2::date)::timestamp AT TIME ZONE $4)
          AND fo.created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
        GROUP BY s.staff_user_id`,
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
        WHERE restaurant_id = $1 AND created_by IS NOT NULL
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
          AND (sh.restaurant_id IS NULL OR sh.restaurant_id = $4)
          AND NOT EXISTS (
            SELECT 1 FROM business_time_entries te
             WHERE te.business_id = sh.business_id
               AND te.user_id = sh.user_id
               AND te.entry_date = sh.shift_date
          )
        GROUP BY sh.user_id`,
      [businessId, fromDate, toDate, restaurantId]
    ),
    getRoster(businessId),
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
  parseLocalRange,
  normalizeTipOutRules,
  getTipPoolSettings,
  saveTipPoolSettings,
  declareCashTip,
  getRoster,
  computeTipAllocations,
  computeLabor,
  buildPayrollCsv,
  computeExceptions,
  distributeCents,
};
