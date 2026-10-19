'use strict';

// Shared executable definitions. Each result row belongs to exactly one
// currency and BIGINTs remain strings through the PostgreSQL driver.
const MONEY_METRICS = Object.freeze(['platform_revenue_cents', 'investor_gmv_cents',
  'investor_take_rate_pct', 'mrr_cents', 'escrow_held_cents', 'promo_discount_cents']);

function majorUnitScaleSql(expression) {
  const cases = [];
  for (const code of Intl.supportedValuesOf('currency')) {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
    if (digits !== 2) cases.push(`WHEN '${code}' THEN ${10 ** digits}`);
  }
  return `(CASE UPPER(${expression}) ${cases.join(' ')} ELSE 100 END)`;
}

function financialMetricSql(metric, { interval = '30 days', trunc = null } = {}) {
  switch (metric) {
    case 'platform_revenue_cents': {
      const bucket = trunc ? `date_trunc('${trunc}', created_at) AS bucket,` : '';
      if (trunc && !['hour', 'day', 'week', 'month'].includes(trunc)) throw new Error('Unsupported bucket');
      return { text: `SELECT ${bucket} UPPER(currency) AS currency_code,
          COALESCE(SUM(amount_cents), 0)::BIGINT AS revenue_cents
        FROM platform_ledger WHERE source_type IN ('job_fee','subscription') AND amount_cents > 0
          AND created_at >= NOW() - $1::interval AND created_at < NOW()
        GROUP BY ${trunc ? '1,2 ORDER BY 1,2' : '1 ORDER BY 1'}`,
        params: [interval], columns: [...(trunc ? ['bucket'] : []), 'currency_code', 'revenue_cents'] };
    }
    case 'investor_gmv_cents':
      return { text: `SELECT UPPER(currency_code) AS currency_code,
          COALESCE(SUM(final_price_cents),0)::BIGINT AS gmv_cents,
          COUNT(*)::INT AS completed_jobs, COUNT(*) FILTER (WHERE final_price_cents IS NULL)::INT AS unpriced_jobs
        FROM jobs WHERE status='completed' AND deleted_at IS NULL
        GROUP BY 1 ORDER BY 1`, params: [], columns: ['currency_code', 'gmv_cents', 'completed_jobs', 'unpriced_jobs'] };
    case 'investor_take_rate_pct':
      return { text: `WITH cohort AS (
          SELECT id, UPPER(currency_code) AS currency_code, final_price_cents
          FROM jobs WHERE status='completed' AND deleted_at IS NULL AND final_price_cents IS NOT NULL
        ), gmv AS (
          SELECT currency_code,SUM(final_price_cents)::BIGINT AS gmv_cents FROM cohort GROUP BY 1
        ), fees AS (
          SELECT UPPER(l.currency) AS currency_code,SUM(l.amount_cents)::BIGINT AS fee_cents
          FROM platform_ledger l JOIN cohort j ON j.id=l.job_id AND j.currency_code=UPPER(l.currency)
          WHERE l.source_type='job_fee' AND l.amount_cents>0 GROUP BY 1
        ) SELECT g.currency_code,g.gmv_cents,COALESCE(f.fee_cents,0)::BIGINT AS fee_cents,
          ROUND(100.0*COALESCE(f.fee_cents,0)/NULLIF(g.gmv_cents,0),2)::FLOAT AS take_rate_pct
        FROM gmv g LEFT JOIN fees f USING(currency_code) ORDER BY 1`, params: [],
        columns: ['currency_code', 'gmv_cents', 'fee_cents', 'take_rate_pct'] };
    case 'mrr_cents':
      return { text: `SELECT UPPER(p.currency) AS currency_code,
          ROUND(SUM(CASE p.interval WHEN 'year' THEN p.amount_cents/12.0 ELSE p.amount_cents END))::BIGINT AS mrr_cents
        FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.status='active'
        GROUP BY 1 ORDER BY 1`, params: [], columns: ['currency_code', 'mrr_cents'] };
    case 'escrow_held_cents':
      return { text: `SELECT UPPER(currency) AS currency_code,
          SUM(GREATEST(COALESCE(capture_amount_cents,ROUND(amount*${majorUnitScaleSql('currency')})::BIGINT,0)
          -COALESCE(ROUND(refunded_amount*${majorUnitScaleSql('currency')})::BIGINT,0),0))::BIGINT AS escrow_held_cents
        FROM payments WHERE escrow_status IN ('held','disputed') AND status IN ('authorized','captured')
        GROUP BY 1 ORDER BY 1`, params: [], columns: ['currency_code', 'escrow_held_cents'] };
    case 'promo_discount_cents':
      // Decision 2: redeemed checkout promo discounts, by redemption time.
      // Funding follows the surface (jobs/bookings platform, food restaurant).
      return { text: `SELECT UPPER(currency_code) AS currency_code,
          COALESCE(SUM(discount_cents),0)::BIGINT AS promo_discount_cents,
          COUNT(*)::INT AS redemptions,
          COALESCE(SUM(discount_cents) FILTER (WHERE funded_by='platform'),0)::BIGINT AS platform_funded_cents,
          COALESCE(SUM(gross_cents),0)::BIGINT AS gross_cents
        FROM promo_redemptions WHERE status='redeemed'
          AND redeemed_at >= NOW() - $1::interval AND redeemed_at < NOW()
        GROUP BY 1 ORDER BY 1`, params: [interval],
        columns: ['currency_code', 'promo_discount_cents', 'redemptions', 'platform_funded_cents', 'gross_cents'] };
    default: throw new Error('Unsupported financial metric');
  }
}

async function financialMetricValue(db, metric, currencyCode, options = {}) {
  const built = financialMetricSql(metric, options);
  const { rows } = await db.query(built.text, built.params);
  const row = rows.find(r => r.currency_code === String(currencyCode).toUpperCase());
  const key = { platform_revenue_cents: 'revenue_cents', investor_gmv_cents: 'gmv_cents', investor_take_rate_pct: 'take_rate_pct' }[metric] || metric;
  return row?.[key] ?? (metric === 'investor_take_rate_pct' ? null : '0');
}

module.exports = { MONEY_METRICS, financialMetricSql, financialMetricValue, majorUnitScaleSql };
