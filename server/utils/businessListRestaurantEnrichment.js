'use strict';

const logger = require('./logger');

/**
 * Best-effort attach of food_restaurants summary fields onto business list rows.
 *
 * GET /api/businesses and /managed must not 500 when food_restaurants is
 * missing, lagged on migrations (e.g. discovery_status), or otherwise
 * unavailable — getBusiness/loadBusinessEditorRow never joins that table, so
 * owner workspace-by-id can succeed while the list endpoint used to fail.
 *
 * On enrichment failure, restaurant_* columns are null and the core list still
 * returns 200. Prefer progressive column fallback over all-or-nothing nulls
 * when only newer discovery columns are missing.
 */

function isUndefinedColumnError(err) {
  return Boolean(err && (err.code === '42703' || /column .* does not exist/i.test(String(err.message || ''))));
}

function isMissingRelationError(err) {
  return Boolean(err && (err.code === '42P01' || /relation .* does not exist/i.test(String(err.message || ''))));
}

const FULL_SUMMARY_SQL = `
  SELECT DISTINCT ON (business_id)
    business_id,
    id,
    status,
    discovery_status,
    accepts_online_orders,
    is_accepting_orders_now
  FROM food_restaurants
  WHERE business_id = ANY($1::int[])
  ORDER BY business_id, id
`;

/** Baseline columns present since migration 305 (no 351 discovery fields). */
const BASELINE_SUMMARY_SQL = `
  SELECT DISTINCT ON (business_id)
    business_id,
    id,
    status,
    accepts_online_orders
  FROM food_restaurants
  WHERE business_id = ANY($1::int[])
  ORDER BY business_id, id
`;

async function loadRestaurantSummariesByBusinessId(pool, ids, { logLabel = 'businessList' } = {}) {
  try {
    const { rows } = await pool.query(FULL_SUMMARY_SQL, [ids]);
    return { rows, mode: 'full' };
  } catch (fullErr) {
    if (isMissingRelationError(fullErr)) {
      logger.warn(`${logLabel}: food_restaurants enrichment skipped (missing relation)`, {
        err: fullErr && fullErr.message,
        code: fullErr && fullErr.code,
      });
      return { rows: [], mode: 'none' };
    }

    if (!isUndefinedColumnError(fullErr)) {
      logger.warn(`${logLabel}: food_restaurants enrichment skipped`, {
        err: fullErr && fullErr.message,
        code: fullErr && fullErr.code,
        detail: fullErr && fullErr.detail,
      });
      return { rows: [], mode: 'none' };
    }

    logger.warn(`${logLabel}: food_restaurants full enrichment unavailable; retrying baseline columns`, {
      err: fullErr && fullErr.message,
      code: fullErr && fullErr.code,
    });

    try {
      const { rows } = await pool.query(BASELINE_SUMMARY_SQL, [ids]);
      return { rows, mode: 'baseline' };
    } catch (baselineErr) {
      logger.warn(`${logLabel}: food_restaurants baseline enrichment skipped`, {
        err: baselineErr && baselineErr.message,
        code: baselineErr && baselineErr.code,
        detail: baselineErr && baselineErr.detail,
      });
      return { rows: [], mode: 'none' };
    }
  }
}

async function enrichBusinessesWithRestaurantFields(pool, rows, { logLabel = 'businessList' } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const ids = rows.map((r) => r.id).filter((id) => id != null);
  if (ids.length === 0) {
    return rows.map((row) => withNullRestaurantFields(row));
  }

  const { rows: frRows } = await loadRestaurantSummariesByBusinessId(pool, ids, { logLabel });
  const byBizId = new Map();
  for (const fr of frRows) {
    byBizId.set(Number(fr.business_id), fr);
  }

  return rows.map((row) => {
    const fr = byBizId.get(Number(row.id));
    if (!fr) return withNullRestaurantFields(row);
    return {
      ...row,
      restaurant_id: fr.id,
      restaurant_status: fr.status != null ? fr.status : null,
      restaurant_discovery_status: fr.discovery_status != null ? fr.discovery_status : null,
      restaurant_accepts_online_orders:
        fr.accepts_online_orders != null ? fr.accepts_online_orders : null,
      restaurant_is_accepting_orders_now:
        fr.is_accepting_orders_now != null ? fr.is_accepting_orders_now : null,
    };
  });
}

function withNullRestaurantFields(row) {
  return {
    ...row,
    restaurant_id: null,
    restaurant_status: null,
    restaurant_discovery_status: null,
    restaurant_accepts_online_orders: null,
    restaurant_is_accepting_orders_now: null,
  };
}

module.exports = {
  enrichBusinessesWithRestaurantFields,
  withNullRestaurantFields,
  loadRestaurantSummariesByBusinessId,
  isUndefinedColumnError,
  isMissingRelationError,
};
