'use strict';

const AppError = require('../utils/appError');

function storeShape(row, sales = [], health = {}) {
  return {
    id: Number(row.id),
    name: row.display_name,
    city: row.address_city || null,
    state: row.address_state || null,
    timezone: row.timezone,
    status: row.status,
    sales: sales.map((entry) => ({ currencyCode: entry.currency_code, orderCount: Number(entry.order_count || 0), netCollectedCents: Number(entry.net_collected_cents || 0) })),
    health: { latestAuditScorePercent: health.latestAuditScorePercent == null ? null : Number(health.latestAuditScorePercent), openFindings: Number(health.openFindings || 0) },
  };
}

async function rollup(client, { businessId, restaurantIds, from, to }) {
  if (!Array.isArray(restaurantIds) || !restaurantIds.length) throw new AppError('No accessible stores found', 403, 'hq_scope_empty');
  const salesParams = [businessId, restaurantIds, from, to];
  const { rows: salesRows } = await client.query(
    `SELECT restaurant_id, currency_code,
            COUNT(*) FILTER (WHERE payment_status = 'paid' AND status NOT IN ('cancelled','refunded'))::int AS order_count,
            COALESCE(SUM(total_cents) FILTER (WHERE payment_status = 'paid' AND status NOT IN ('cancelled','refunded')), 0)::bigint AS net_collected_cents
       FROM food_orders
      WHERE business_id = $1 AND restaurant_id = ANY($2::bigint[])
        AND created_at >= $3::timestamptz AND created_at < $4::timestamptz
      GROUP BY restaurant_id, currency_code
      ORDER BY restaurant_id, currency_code`,
    salesParams
  );
  const { rows: healthRows } = await client.query(
    `SELECT r.id AS restaurant_id,
            (SELECT ROUND(100.0 * a.total_score / NULLIF(a.max_score, 0), 1)
               FROM restaurant_audits a
              WHERE a.restaurant_id = r.id AND a.status = 'completed'
              ORDER BY a.completed_at DESC NULLS LAST, a.id DESC LIMIT 1) AS latest_audit_score_percent,
            (SELECT COUNT(*)::int
               FROM restaurant_audit_findings f
               JOIN restaurant_audits a ON a.id = f.audit_id
              WHERE a.restaurant_id = r.id AND f.severity IN ('high','critical')) AS open_findings
       FROM food_restaurants r
      WHERE r.business_id = $1 AND r.id = ANY($2::bigint[])`,
    [businessId, restaurantIds]
  );
  return { salesRows, healthRows };
}

module.exports = { storeShape, rollup };
