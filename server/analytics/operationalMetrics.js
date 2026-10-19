'use strict';

// Windowed cohorts shared by the query builder and alert evaluator. Rates
// expose their numerator/denominator so an empty cohort stays unknown.
const DEFINITIONS = Object.freeze({
  dispute_rate_pct: {
    valueColumn: 'dispute_rate_pct',
    unit: 'pct', permission: 'manage_disputes', preference: 'notify_disputes',
    definition: 'Share of non-deleted jobs created in the window with at least one dispute record, regardless of dispute state.',
    text: `SELECT COUNT(*)::INT AS total,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM disputes d WHERE d.job_id=j.id))::INT AS disputed,
      ROUND(100.0*COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM disputes d WHERE d.job_id=j.id))
        /NULLIF(COUNT(*),0),2)::FLOAT AS dispute_rate_pct
      FROM jobs j WHERE j.deleted_at IS NULL AND j.created_at >= NOW()-$1::interval AND j.created_at < NOW()`,
    columns: ['dispute_rate_pct', 'disputed', 'total'],
  },
  refund_rate_pct: {
    valueColumn: 'refund_rate_pct',
    unit: 'pct', permission: 'view_financials', preference: 'notify_incidents',
    definition: 'Share of captured/released/refunded payment records created in the window with a positive refund or refunded status; a count rate, not a sum of currencies.',
    text: `SELECT COUNT(*)::INT AS total,
      COUNT(*) FILTER (WHERE status='refunded' OR COALESCE(refunded_amount,0)>0)::INT AS refunded,
      ROUND(100.0*COUNT(*) FILTER (WHERE status='refunded' OR COALESCE(refunded_amount,0)>0)
        /NULLIF(COUNT(*),0),2)::FLOAT AS refund_rate_pct
      FROM payments WHERE status IN ('captured','released','refunded') AND created_at >= NOW()-$1::interval AND created_at < NOW()`,
    columns: ['refund_rate_pct', 'refunded', 'total'],
  },
  job_completion_rate_pct: {
    valueColumn: 'completion_rate_pct',
    unit: 'pct', permission: 'manage_operations', preference: null,
    definition: 'Completed share of decided (completed or cancelled) non-deleted jobs created in the window. One cohort for every dashboard: the period selected on the page.',
    text: `SELECT COUNT(*) FILTER (WHERE j.status IN ('completed','cancelled'))::INT AS decided,
      COUNT(*) FILTER (WHERE j.status='completed')::INT AS completed,
      ROUND(100.0*COUNT(*) FILTER (WHERE j.status='completed')
        /NULLIF(COUNT(*) FILTER (WHERE j.status IN ('completed','cancelled')),0),2)::FLOAT AS completion_rate_pct
      FROM jobs j WHERE j.deleted_at IS NULL AND j.created_at >= NOW()-$1::interval AND j.created_at < NOW()`,
    columns: ['completion_rate_pct', 'completed', 'decided'],
  },
  payout_failure_count: {
    unit: 'count', permission: 'view_financials', preference: 'notify_payout_failures',
    definition: 'Failed main_app_payout_requests created in the window. Other payout products are separate ledgers and are not folded into this count.',
    text: `SELECT COUNT(*)::INT AS value FROM main_app_payout_requests
      WHERE status='failed' AND created_at >= NOW()-$1::interval AND created_at < NOW()`,
    columns: ['value'],
  },
});

function operationalMetricSql(metric, interval) {
  const def = DEFINITIONS[metric];
  if (!Object.hasOwn(DEFINITIONS, metric)) throw new Error('Unknown operational metric');
  return { text: def.text, params: [interval], columns: def.columns };
}

// Shared value for dashboard consumers (super-admin and investor). Returns
// the same numbers the builder and alert evaluator compute.
async function jobCompletionRate(db, interval) {
  const built = operationalMetricSql('job_completion_rate_pct', interval);
  const { rows } = await db.query(built.text, built.params);
  const row = rows[0] || {};
  return {
    completion_rate_pct: row.completion_rate_pct == null ? null : Number(row.completion_rate_pct),
    completed: Number(row.completed || 0),
    decided: Number(row.decided || 0),
  };
}

module.exports = { DEFINITIONS, operationalMetricSql, jobCompletionRate };
