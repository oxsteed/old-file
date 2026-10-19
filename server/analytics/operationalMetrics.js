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

module.exports = { DEFINITIONS, operationalMetricSql };
