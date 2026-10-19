'use strict';
const AppError = require('../utils/appError');

const integer = value => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : String(value);
};

async function helperEarnings(db, userId, { currencyCode, offset = 0, limit = 20 } = {}) {
  offset = Number(offset); limit = Number(limit);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError('Invalid earnings page', 400, 'invalid_page');
  }
  const requested = currencyCode == null ? null : String(currencyCode).trim().toUpperCase();
  if (requested != null && !/^[A-Z]{3}$/.test(requested)) throw new AppError('Invalid currency', 400, 'invalid_currency');
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: accounts } = await client.query(`SELECT UPPER(currency_code) AS currency_code,COUNT(*)::INT AS jobs
      FROM jobs WHERE assigned_helper_id=$1 AND status='completed' AND deleted_at IS NULL
      GROUP BY 1 ORDER BY 1`, [userId]);
    const currency = requested || (accounts.find(a => a.currency_code === 'USD') || accounts[0])?.currency_code || 'USD';
    const scope = `assigned_helper_id=$1 AND status='completed' AND deleted_at IS NULL AND UPPER(currency_code)=$2`;
    const params = [userId, currency];
    const { rows: [r] } = await client.query(`SELECT COUNT(*)::INT AS count,
      COUNT(*) FILTER (WHERE helper_payout_cents IS NULL)::INT AS unpriced,
      COALESCE(SUM(helper_payout_cents),0)::BIGINT AS lifetime,
      COALESCE(SUM(helper_payout_cents) FILTER (WHERE completed_at>=date_trunc('week',NOW())),0)::BIGINT AS week,
      COALESCE(SUM(helper_payout_cents) FILTER (WHERE completed_at>=date_trunc('month',NOW())),0)::BIGINT AS month,
      COALESCE(SUM(helper_payout_cents) FILTER (WHERE payout_status='earned'),0)::BIGINT AS available,
      COALESCE(SUM(helper_payout_cents) FILTER (WHERE payout_status IN ('pending','processing','not_ready')),0)::BIGINT AS pending,
      COALESCE(SUM(helper_payout_cents) FILTER (WHERE payout_status='paid'),0)::BIGINT AS paid
      FROM jobs WHERE ${scope}`, params);
    const { rows: jobs } = await client.query(`SELECT id,title,completed_at,helper_payout_cents AS amount_cents,currency_code,payout_status
      FROM jobs WHERE ${scope} ORDER BY completed_at DESC NULLS LAST,id DESC LIMIT $3 OFFSET $4`, [...params, limit, offset]);
    const series = async unit => (await client.query(`SELECT date_trunc('${unit}',completed_at)::date AS period,
      COALESCE(SUM(helper_payout_cents),0)::BIGINT AS amount_cents FROM jobs WHERE ${scope}
      AND completed_at>=NOW()-INTERVAL '12 ${unit}s' GROUP BY 1 ORDER BY 1 DESC`, params)).rows
      .map(row => ({ period: row.period, amountCents: integer(row.amount_cents) }));
    const weekly = await series('week'), monthly = await series('month');
    await client.query('COMMIT');
    return {
      contract: { version: 'main-helper-earnings-v2', generatedAt: new Date().toISOString(), dataSource: 'production' },
      accounts: accounts.map(a => ({ currencyCode: a.currency_code, completedJobs: a.jobs })),
      summary: { currencyCode: currency, completedJobs: r.count, unpricedJobs: r.unpriced,
        lifetimeCents: integer(r.lifetime), weekCents: integer(r.week), monthCents: integer(r.month),
        availableCents: integer(r.available), pendingCents: integer(r.pending), paidCents: integer(r.paid) },
      jobs: jobs.map(job => ({ id: String(job.id), title: job.title, completedAt: job.completed_at,
        amountCents: integer(job.amount_cents), currencyCode: job.currency_code, payoutStatus: job.payout_status || 'not_ready' })),
      weekly, monthly, pagination: { offset, limit, total: r.count, hasMore: offset + jobs.length < r.count },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

module.exports = { helperEarnings };
