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
    health: {
      latestAuditScorePercent: health.latestAuditScorePercent == null ? null : Number(health.latestAuditScorePercent),
      openFindings: Number(health.openFindings || 0),
    },
    compliance: {
      checklistCompletionPercent: health.checklistCompletionPercent == null ? null : Number(health.checklistCompletionPercent),
      checklistRuns: Number(health.checklistRuns || 0),
      trainingCompletionPercent: health.trainingCompletionPercent == null ? null : Number(health.trainingCompletionPercent),
      trainingAssignments: Number(health.trainingAssignments || 0),
      overdueTraining: Number(health.overdueTraining || 0),
    },
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
  const { rows: complianceRows } = await client.query(
    `WITH checklist AS (
       SELECT restaurant_id,
              COUNT(*)::int AS runs,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_runs
         FROM restaurant_checklist_runs
        WHERE restaurant_id = ANY($1::bigint[])
          AND started_at >= $2::timestamptz AND started_at < $3::timestamptz
        GROUP BY restaurant_id
     ), training AS (
       SELECT a.restaurant_id,
              COUNT(*)::int AS assignments,
              COUNT(*) FILTER (
                WHERE a.status = 'completed'
                  AND EXISTS (
                    SELECT 1 FROM restaurant_training_completions c
                     WHERE c.assignment_id = a.id
                       AND c.passed = TRUE
                       AND (c.expires_at IS NULL OR c.expires_at >= NOW())
                  )
              )::int AS completed_assignments,
              COUNT(*) FILTER (WHERE a.status = 'overdue')::int AS overdue_assignments
         FROM restaurant_training_assignments a
        WHERE a.restaurant_id = ANY($1::bigint[])
        GROUP BY a.restaurant_id
     )
     SELECT r.id AS restaurant_id,
            COALESCE(checklist.runs, 0)::int AS checklist_runs,
            CASE WHEN COALESCE(checklist.runs, 0) = 0 THEN NULL
                 ELSE ROUND(100.0 * checklist.completed_runs / checklist.runs, 1) END AS checklist_completion_percent,
            COALESCE(training.assignments, 0)::int AS training_assignments,
            CASE WHEN COALESCE(training.assignments, 0) = 0 THEN NULL
                 ELSE ROUND(100.0 * training.completed_assignments / training.assignments, 1) END AS training_completion_percent,
            COALESCE(training.overdue_assignments, 0)::int AS overdue_training
       FROM food_restaurants r
       LEFT JOIN checklist ON checklist.restaurant_id = r.id
       LEFT JOIN training ON training.restaurant_id = r.id
      WHERE r.business_id = $4 AND r.id = ANY($1::bigint[])`,
    [restaurantIds, from, to, businessId]
  );
  return { salesRows, healthRows, complianceRows };
}

module.exports = { storeShape, rollup };
