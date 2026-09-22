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
 * returns 200.
 */
async function enrichBusinessesWithRestaurantFields(pool, rows, { logLabel = 'businessList' } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const ids = rows.map((r) => r.id).filter((id) => id != null);
  if (ids.length === 0) {
    return rows.map((row) => withNullRestaurantFields(row));
  }

  let byBizId = new Map();
  try {
    const { rows: frRows } = await pool.query(
      `SELECT DISTINCT ON (business_id)
         business_id,
         id,
         status,
         discovery_status,
         accepts_online_orders,
         is_accepting_orders_now
       FROM food_restaurants
       WHERE business_id = ANY($1::int[])
       ORDER BY business_id, id`,
      [ids]
    );
    for (const fr of frRows) {
      byBizId.set(Number(fr.business_id), fr);
    }
  } catch (err) {
    logger.warn(`${logLabel}: food_restaurants enrichment skipped`, {
      err: err && err.message,
      code: err && err.code,
      detail: err && err.detail,
    });
    byBizId = new Map();
  }

  return rows.map((row) => {
    const fr = byBizId.get(Number(row.id));
    if (!fr) return withNullRestaurantFields(row);
    return {
      ...row,
      restaurant_id: fr.id,
      restaurant_status: fr.status,
      restaurant_discovery_status: fr.discovery_status,
      restaurant_accepts_online_orders: fr.accepts_online_orders,
      restaurant_is_accepting_orders_now: fr.is_accepting_orders_now,
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
};
