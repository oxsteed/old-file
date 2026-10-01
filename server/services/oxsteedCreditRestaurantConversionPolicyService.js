'use strict';

/**
 * Restaurant conversion allowlist (Emile's requirement).
 *
 * OxSteed controls which restaurants' credit may be converted INTO OxSteed
 * Credit (the from_restaurant direction), so the platform only allows
 * conversion out where it controls the underlying cash, not the restaurant
 * owner. Table restaurant_credit_conversion_policy (migration 642) is the
 * per-restaurant allowlist: a row with allow_restaurant_to_oxsteed = TRUE
 * enables the direction. Default-deny: a missing row means NOT enabled.
 *
 * This module intentionally does NOT require oxsteedCreditService (the same
 * one-way-dependency rule as oxsteedCreditReserveService): both the
 * conversion service and the pending-action executor require this module,
 * so it must stay dependency-free (pool, AppError, withTransaction only).
 */

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

function parseRestaurantId(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new AppError('Invalid restaurant for the conversion policy', 400, 'credit_conversion_policy_restaurant_invalid', {
      restaurantId: String(value ?? ''),
    });
  }
  return n;
}

function parseAllowFlag(value) {
  if (value === true || value === 1 || value === 'true' || value === '1') return true;
  if (value === false || value === 0 || value === 'false' || value === '0') return false;
  throw new AppError('The conversion policy flag must be a boolean', 400, 'credit_conversion_policy_flag_invalid', {
    allowRestaurantToOxsteed: String(value ?? ''),
  });
}

/**
 * Shared 400-validation for admin writes: used by the admin route (reject
 * bad input before queueing) and re-run by the maker-checker executor at
 * execution time. Returns { restaurantId, allowRestaurantToOxsteed }.
 */
function validateConversionPolicyInput({ restaurantId, allowRestaurantToOxsteed } = {}) {
  return {
    restaurantId: parseRestaurantId(restaurantId),
    allowRestaurantToOxsteed: parseAllowFlag(allowRestaurantToOxsteed),
  };
}

function formatPolicy(row) {
  if (!row) return null;
  return {
    restaurantId: Number(row.restaurant_id),
    allowRestaurantToOxsteed: row.allow_restaurant_to_oxsteed === true,
    updatedAt: row.updated_at,
    updatedByUserId: row.updated_by_user_id ? String(row.updated_by_user_id) : null,
  };
}

/**
 * Admin read model: every policy row, newest writes last. The caller joins
 * restaurant names from its own directory data; this table intentionally
 * carries no restaurant metadata.
 */
async function listConversionPolicies(client, { restaurantId = null } = {}) {
  const conditions = [];
  const params = [];
  if (restaurantId !== null && restaurantId !== undefined && restaurantId !== '') {
    conditions.push(`restaurant_id = $${params.length + 1}`);
    params.push(parseRestaurantId(restaurantId));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const executor = client || pool;
  const { rows } = await executor.query(
    `SELECT * FROM restaurant_credit_conversion_policy ${where} ORDER BY restaurant_id ASC`,
    params
  );
  return rows.map(formatPolicy);
}

/**
 * Create-or-update a policy row. Runs inside the caller's transaction (the
 * maker-checker executor runs it inside the decision transaction).
 */
async function upsertRestaurantConversionPolicy(client, { restaurantId, allowRestaurantToOxsteed, updatedByUserId = null } = {}) {
  const normalized = validateConversionPolicyInput({ restaurantId, allowRestaurantToOxsteed });
  const { rows } = await client.query(
    `INSERT INTO restaurant_credit_conversion_policy
       (restaurant_id, allow_restaurant_to_oxsteed, updated_at, updated_by_user_id)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (restaurant_id)
     DO UPDATE SET allow_restaurant_to_oxsteed = EXCLUDED.allow_restaurant_to_oxsteed,
                   updated_at = NOW(),
                   updated_by_user_id = EXCLUDED.updated_by_user_id
     RETURNING *`,
    [normalized.restaurantId, normalized.allowRestaurantToOxsteed, updatedByUserId]
  );
  if (!rows[0]) throw new AppError('Conversion policy could not be saved', 500, 'credit_conversion_policy_save_failed');
  return formatPolicy(rows[0]);
}

/**
 * Fail-closed read: true only when an explicit allow row exists. A missing
 * row (or a FALSE row) denies the from_restaurant conversion.
 */
async function isRestaurantConversionToOxsteedEnabled(client, restaurantId) {
  const id = parseRestaurantId(restaurantId);
  const executor = client || pool;
  const { rows } = await executor.query(
    `SELECT allow_restaurant_to_oxsteed FROM restaurant_credit_conversion_policy WHERE restaurant_id = $1`,
    [id]
  );
  return rows[0] ? rows[0].allow_restaurant_to_oxsteed === true : false;
}

/**
 * The conversion gate used by convertRestaurantToOxsteed: 403
 * credit_conversion_restaurant_not_enabled when OxSteed has not enabled
 * this restaurant for conversion into OxSteed Credit. Runs after the rail
 * kill switch, before any money moves.
 */
async function assertRestaurantConversionToOxsteedEnabled(client, restaurantId) {
  const id = parseRestaurantId(restaurantId);
  const enabled = await isRestaurantConversionToOxsteedEnabled(client, id);
  if (!enabled) {
    throw new AppError(
      'This restaurant is not enabled for conversion of its credit into OxSteed Credit.',
      403,
      'credit_conversion_restaurant_not_enabled',
      { restaurantId: String(id) }
    );
  }
}

/**
 * Customer read model for the eligibility endpoint: the full set of
 * restaurant ids with the from_restaurant direction currently enabled.
 */
async function listConversionEnabledRestaurantIds(client) {
  const executor = client || pool;
  const { rows } = await executor.query(
    `SELECT restaurant_id FROM restaurant_credit_conversion_policy WHERE allow_restaurant_to_oxsteed = TRUE ORDER BY restaurant_id ASC`
  );
  return rows.map((row) => Number(row.restaurant_id));
}

module.exports = {
  validateConversionPolicyInput,
  listConversionPolicies,
  upsertRestaurantConversionPolicy,
  isRestaurantConversionToOxsteedEnabled,
  assertRestaurantConversionToOxsteedEnabled,
  listConversionEnabledRestaurantIds,
};
