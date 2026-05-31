/**
 * investorController.js
 *
 * Platform KPI aggregation for the investor dashboard.
 * Pulls from the same underlying tables as the super-admin dashboard
 * but is scoped to the 'investor' role (plus admin / super_admin).
 *
 * All queries fail open — missing tables return zero-values so the
 * dashboard never hard-errors on a fresh or partial deployment.
 *
 * Routes (all under /api/investor):
 *   GET /kpis          — platform health snapshot + period deltas
 *   GET /revenue-chart — time-series revenue by source type
 *   GET /franchise     — franchise application pipeline stages
 *   GET /supply-demand — helper/customer ratio, bid depth, completion rate
 */

const pool   = require('../db');
const logger = require('../utils/logger');

// ── Period map (mirrors superAdminController) ────────────────────────────
const PERIODS = {
  '7d':  { interval: '7 days',   prev: '14 days',  trunc: 'day'   },
  '30d': { interval: '30 days',  prev: '60 days',  trunc: 'day'   },
  '90d': { interval: '90 days',  prev: '180 days', trunc: 'week'  },
  '1y':  { interval: '365 days', prev: '730 days', trunc: 'month' },
};

// ── Fail-open helpers ────────────────────────────────────────────────────
const safeInt   = (v) => parseInt(v  ?? 0, 10)  || 0;
const safeFlt   = (v) => parseFloat(v ?? 0)     || 0;
const safeQuery = async (sql, params = []) => {
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } catch (e) {
    logger.warn('[investor] query skipped', { msg: e.message });
    return [];
  }
};
const tableExists = async (name) => {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
    [name],
  ).catch(() => ({ rows: [] }));
  return rows.length > 0;
};

// ── GET /api/investor/kpis ───────────────────────────────────────────────
exports.getKpis = async (req, res) => {
  try {
    const period = PERIODS[req.query.period] ? req.query.period : '30d';
    const { interval: cur, prev: prevInterval } = PERIODS[period];

    const [hasLedger, hasSubs, hasJobs, hasHP, hasPayouts] = await Promise.all([
      tableExists('platform_ledger'),
      tableExists('subscriptions'),
      tableExists('jobs'),
      tableExists('helper_profiles'),
      tableExists('payouts'),
    ]);

    // ── Users ──────────────────────────────────────────────────────────
    const [userRows] = await safeQuery(`
      SELECT
        COUNT(*) FILTER (WHERE role NOT IN ('admin','super_admin'))                                                AS total_users,
        COUNT(*) FILTER (WHERE role = 'customer')                                                                  AS total_customers,
        COUNT(*) FILTER (WHERE role IN ('helper','helper_pro'))                                                    AS total_helpers,
        COUNT(*) FILTER (WHERE role NOT IN ('admin','super_admin') AND created_at >= now() - $1::interval)         AS new_users_cur,
        COUNT(*) FILTER (WHERE role NOT IN ('admin','super_admin') AND created_at >= now() - $2::interval
                           AND created_at <  now() - $1::interval)                                                 AS new_users_prev,
        COUNT(*) FILTER (WHERE role NOT IN ('admin','super_admin') AND email_verified = TRUE)                      AS verified_users
    `, [cur, prevInterval]);

    // ── Helper quality ─────────────────────────────────────────────────
    let verified_helpers = 0, avg_helper_rating = null;
    if (hasHP) {
      const [hpRow] = await safeQuery(`
        SELECT
          COUNT(*) FILTER (WHERE is_identity_verified = TRUE OR is_background_checked = TRUE) AS verified,
          ROUND(AVG(avg_rating) FILTER (WHERE total_reviews >= 3), 2)                         AS avg_rating
        FROM helper_profiles
      `);
      verified_helpers  = safeInt(hpRow?.verified);
      avg_helper_rating = hpRow?.avg_rating ? safeFlt(hpRow.avg_rating) : null;
    }

    // ── Jobs ───────────────────────────────────────────────────────────
    let open_jobs = 0, active_jobs = 0, completed_jobs = 0, cancelled_jobs = 0,
        new_jobs_cur = 0, new_jobs_prev = 0, avg_bids = null, completion_rate = null;
    if (hasJobs) {
      const [jr] = await safeQuery(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'published')                                                              AS open_jobs,
          COUNT(*) FILTER (WHERE status = 'in_progress')                                                            AS active_jobs,
          COUNT(*) FILTER (WHERE status = 'completed')                                                              AS completed_jobs,
          COUNT(*) FILTER (WHERE status = 'cancelled')                                                              AS cancelled_jobs,
          COUNT(*) FILTER (WHERE created_at >= now() - $1::interval)                                                AS new_jobs_cur,
          COUNT(*) FILTER (WHERE created_at >= now() - $2::interval AND created_at < now() - $1::interval)          AS new_jobs_prev,
          ROUND(AVG(bid_count) FILTER (WHERE bid_count > 0 AND created_at >= now() - $1::interval), 1)              AS avg_bids
        FROM jobs
      `, [cur, prevInterval]);
      open_jobs       = safeInt(jr?.open_jobs);
      active_jobs     = safeInt(jr?.active_jobs);
      completed_jobs  = safeInt(jr?.completed_jobs);
      cancelled_jobs  = safeInt(jr?.cancelled_jobs);
      new_jobs_cur    = safeInt(jr?.new_jobs_cur);
      new_jobs_prev   = safeInt(jr?.new_jobs_prev);
      avg_bids        = jr?.avg_bids != null ? safeFlt(jr.avg_bids) : null;
      const fin = safeInt(jr?.completed_jobs) + safeInt(jr?.cancelled_jobs);
      completion_rate = fin > 0 ? Math.round((safeInt(jr?.completed_jobs) / fin) * 100) : null;
    }

    // ── Revenue ────────────────────────────────────────────────────────
    let revenue_total = 0, revenue_cur = 0, revenue_prev = 0,
        revenue_mtd = 0, sub_revenue_cur = 0, refunds_cur = 0;
    if (hasLedger) {
      const [rv] = await safeQuery(`
        SELECT
          COALESCE(SUM(amount_cents) FILTER (WHERE source_type IN ('job_fee','subscription') AND amount_cents > 0), 0)                                              AS total,
          COALESCE(SUM(amount_cents) FILTER (WHERE source_type IN ('job_fee','subscription') AND amount_cents > 0 AND created_at >= now() - $1::interval), 0)      AS cur,
          COALESCE(SUM(amount_cents) FILTER (WHERE source_type IN ('job_fee','subscription') AND amount_cents > 0
                                               AND created_at >= now() - $2::interval AND created_at < now() - $1::interval), 0)                                  AS prev,
          COALESCE(SUM(amount_cents) FILTER (WHERE source_type IN ('job_fee','subscription') AND amount_cents > 0
                                               AND created_at >= date_trunc('month', now())), 0)                                                                   AS mtd,
          COALESCE(SUM(amount_cents) FILTER (WHERE source_type = 'subscription' AND amount_cents > 0 AND created_at >= now() - $1::interval), 0)                   AS sub_cur,
          COALESCE(SUM(ABS(amount_cents)) FILTER (WHERE source_type = 'refund' AND created_at >= now() - $1::interval), 0)                                         AS refunds
        FROM platform_ledger
      `, [cur, prevInterval]);
      revenue_total   = safeInt(rv?.total);
      revenue_cur     = safeInt(rv?.cur);
      revenue_prev    = safeInt(rv?.prev);
      revenue_mtd     = safeInt(rv?.mtd);
      sub_revenue_cur = safeInt(rv?.sub_cur);
      refunds_cur     = safeInt(rv?.refunds);
    }

    // ── Subscriptions ──────────────────────────────────────────────────
    let active_subs = 0;
    if (hasSubs) {
      const [sr] = await safeQuery(`SELECT COUNT(*) AS cnt FROM subscriptions WHERE status = 'active'`);
      active_subs = safeInt(sr?.cnt);
    }

    // ── Pending payouts ────────────────────────────────────────────────
    let pending_payouts_cents = 0;
    if (hasPayouts) {
      const [pr] = await safeQuery(`
        SELECT COALESCE(SUM(CASE WHEN amount_cents IS NOT NULL THEN amount_cents
                                 ELSE CAST(amount * 100 AS BIGINT) END), 0) AS total
        FROM payouts WHERE status = 'pending'
      `);
      pending_payouts_cents = safeInt(pr?.total);
    }

    res.json({
      period,
      kpis: {
        // Users
        total_users:         safeInt(userRows?.total_users),
        total_customers:     safeInt(userRows?.total_customers),
        total_helpers:       safeInt(userRows?.total_helpers),
        new_users_cur,
        new_users_prev,
        new_users_delta:     new_users_cur - safeInt(userRows?.new_users_prev ?? 0),
        verified_users:      safeInt(userRows?.verified_users),
        verified_helpers,
        avg_helper_rating,

        // Jobs
        open_jobs, active_jobs, completed_jobs, cancelled_jobs,
        new_jobs_cur, new_jobs_prev,
        new_jobs_delta:      new_jobs_cur - new_jobs_prev,
        avg_bids_per_job:    avg_bids,
        completion_rate,

        // Revenue (cents)
        revenue_total_cents:   revenue_total,
        revenue_cur_cents:     revenue_cur,
        revenue_prev_cents:    revenue_prev,
        revenue_mtd_cents:     revenue_mtd,
        sub_revenue_cur_cents: sub_revenue_cur,
        refunds_cur_cents:     refunds_cur,
        revenue_delta_cents:   revenue_cur - revenue_prev,

        // Subscriptions & payouts
        active_subscriptions: active_subs,
        pending_payouts_cents,

        // Derived
        take_rate_pct: completed_jobs > 0 && revenue_total > 0 ? null : null, // placeholder
      },
    });
  } catch (err) {
    logger.error('[investor] getKpis error', { err: err.message });
    res.status(500).json({ error: 'Failed to load investor KPIs' });
  }
};

// ── GET /api/investor/revenue-chart ─────────────────────────────────────
exports.getRevenueChart = async (req, res) => {
  try {
    const period = PERIODS[req.query.period] ? req.query.period : '30d';
    const { interval, trunc } = PERIODS[period];

    const hasLedger = await tableExists('platform_ledger');
    if (!hasLedger) return res.json({ chart: [], period });

    const rows = await safeQuery(`
      SELECT
        date_trunc($1, created_at)                                                                                      AS period,
        COALESCE(SUM(CASE WHEN source_type = 'job_fee'      AND amount_cents > 0 THEN amount_cents ELSE 0 END), 0)     AS job_fee_cents,
        COALESCE(SUM(CASE WHEN source_type = 'subscription' AND amount_cents > 0 THEN amount_cents ELSE 0 END), 0)     AS subscription_cents,
        COALESCE(SUM(CASE WHEN source_type = 'refund'                             THEN ABS(amount_cents) ELSE 0 END), 0) AS refunds_cents
      FROM platform_ledger
      WHERE created_at >= now() - $2::interval
      GROUP BY 1
      ORDER BY 1 ASC
    `, [trunc, interval]);

    const totals = rows.reduce((acc, r) => ({
      job_fee:      acc.job_fee      + safeInt(r.job_fee_cents),
      subscription: acc.subscription + safeInt(r.subscription_cents),
      refunds:      acc.refunds      + safeInt(r.refunds_cents),
    }), { job_fee: 0, subscription: 0, refunds: 0 });

    res.json({ chart: rows, totals, period });
  } catch (err) {
    logger.error('[investor] getRevenueChart error', { err: err.message });
    res.status(500).json({ error: 'Failed to load revenue chart' });
  }
};

// ── GET /api/investor/franchise ──────────────────────────────────────────
exports.getFranchisePipeline = async (req, res) => {
  try {
    const hasTable = await tableExists('franchise_applications');
    if (!hasTable) return res.json({ pipeline: [], total: 0 });

    const rows = await safeQuery(`
      SELECT
        status,
        COUNT(*)                                                    AS count,
        MIN(created_at)                                             AS oldest,
        MAX(updated_at)                                             AS latest_activity
      FROM franchise_applications
      GROUP BY status
      ORDER BY
        CASE status
          WHEN 'pending'    THEN 1
          WHEN 'reviewing'  THEN 2
          WHEN 'approved'   THEN 3
          WHEN 'activated'  THEN 4
          WHEN 'rejected'   THEN 5
          ELSE 6
        END
    `);

    const total = rows.reduce((s, r) => s + safeInt(r.count), 0);
    res.json({ pipeline: rows, total });
  } catch (err) {
    logger.error('[investor] getFranchisePipeline error', { err: err.message });
    res.status(500).json({ error: 'Failed to load franchise pipeline' });
  }
};

// ── GET /api/investor/supply-demand ─────────────────────────────────────
exports.getSupplyDemand = async (req, res) => {
  try {
    const hasJobs = await tableExists('jobs');
    const hasHP   = await tableExists('helper_profiles');

    // Weekly job posting trend (last 8 weeks)
    let weekly = [];
    if (hasJobs) {
      weekly = await safeQuery(`
        SELECT
          date_trunc('week', created_at) AS week,
          COUNT(*) FILTER (WHERE status != 'cancelled')  AS jobs_posted,
          COUNT(*) FILTER (WHERE status = 'completed')   AS jobs_completed
        FROM jobs
        WHERE created_at >= now() - interval '8 weeks'
        GROUP BY 1
        ORDER BY 1 ASC
      `);
    }

    // Category breakdown
    let categories = [];
    if (hasJobs) {
      categories = await safeQuery(`
        SELECT
          COALESCE(category_name, 'Uncategorised') AS category,
          COUNT(*)                                  AS total,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          ROUND(AVG(bid_count) FILTER (WHERE bid_count > 0), 1) AS avg_bids
        FROM jobs
        WHERE created_at >= now() - interval '90 days'
        GROUP BY 1
        ORDER BY total DESC
        LIMIT 10
      `);
    }

    // Helper availability
    let helpers_available = 0, helpers_listed = 0;
    if (hasHP) {
      const [hr] = await safeQuery(`
        SELECT
          COUNT(*) FILTER (WHERE is_available_now = TRUE)     AS available_now,
          COUNT(*) FILTER (WHERE COALESCE(is_listed, TRUE))   AS listed
        FROM helper_profiles
      `);
      helpers_available = safeInt(hr?.available_now);
      helpers_listed    = safeInt(hr?.listed);
    }

    res.json({ weekly, categories, helpers_available, helpers_listed });
  } catch (err) {
    logger.error('[investor] getSupplyDemand error', { err: err.message });
    res.status(500).json({ error: 'Failed to load supply/demand data' });
  }
};
