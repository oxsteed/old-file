const db = require('../db');
const { tableExists, columnExists } = require('../utils/schemaProbe');
const { logAdminAction, logUserAction } = require('../services/auditService');
const { issueRefund } = require('../services/stripeService');
const { sendNotification } = require('../services/notificationService');
const logger = require('../utils/logger');
const socketService = require('../services/socketService');
const tokenRevocationService = require('../services/tokenRevocationService');
const { withTransaction } = require('../utils/transaction');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidParam(id) {
  return typeof id === 'string' && UUID_RE.test(id.trim());
}

// ─── Dashboard helpers ────────────────────────────────────────────────────────

const PERIOD_INTERVAL = {
  '1d':  { interval: '1 day',   prev: '2 days',   trunc: 'hour'  },
  '7d':  { interval: '7 days',  prev: '14 days',  trunc: 'day'   },
  '30d': { interval: '30 days', prev: '60 days',  trunc: 'day'   },
  '90d': { interval: '90 days', prev: '180 days', trunc: 'week'  },
  '1y':  { interval: '1 year',  prev: '2 years',  trunc: 'month' },
};

function safeInt(v) { return parseInt(v, 10) || 0; }
function safeFloat(v) { return parseFloat(v) || 0; }

// ─── DASHBOARD OVERVIEW ───────────────────────────────────────────────────────

exports.getDashboardStats = async (req, res) => {
  try {
    const period = PERIOD_INTERVAL[req.query.period] ? req.query.period : '30d';
    const { interval: cur, prev: prevInterval } = PERIOD_INTERVAL[period];

    // Probe optional tables/columns in parallel — never throws
    const [hasJobs, hasSubs, hasLedger, hasHP, hasST, hasPayouts, hasMig154, hasContentReports] = await Promise.all([
      tableExists('jobs'),
      tableExists('subscriptions'),
      tableExists('platform_ledger'),
      tableExists('helper_profiles'),
      tableExists('support_tickets'),
      tableExists('payouts'),
      columnExists('users', 'is_suspended'),
      tableExists('content_reports'),
    ]);

    // ── Core user stats (always available — no optional tables) ────────────
    const coreStats = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role NOT IN ('admin','super_admin'))                                            AS total_users,
        (SELECT COUNT(*) FROM users WHERE role = 'customer')                                                             AS total_customers,
        (SELECT COUNT(*) FROM users WHERE role IN ('helper','helper_pro'))                                               AS total_helpers,
        (SELECT COUNT(*) FROM users WHERE role = 'broker')                                                               AS total_brokers,
        (SELECT COUNT(*) FROM users WHERE role NOT IN ('admin','super_admin') AND created_at >= now() - $1::interval)    AS new_users_period,
        (SELECT COUNT(*) FROM users WHERE role NOT IN ('admin','super_admin') AND created_at >= date_trunc('day',now())) AS new_users_today,
        (SELECT COUNT(*) FROM users WHERE is_active = FALSE AND role NOT IN ('admin','super_admin'))                     AS suspended_users
    `, [cur]).then(r => r.rows[0]).catch(() => ({}));

    // When migration 154 is present, refine suspended_users to also include is_suspended flag
    let suspended_users = safeInt(coreStats.suspended_users);
    if (hasMig154) {
      try {
        const { rows: sus } = await db.query(
          `SELECT COUNT(*) AS cnt FROM users WHERE (is_suspended = TRUE OR is_active = FALSE) AND role NOT IN ('admin','super_admin')`
        );
        suspended_users = safeInt(sus[0]?.cnt);
      } catch (_) {}
    }

    // ── Helper verification stats ──────────────────────────────────────────
    let verified_helpers = 0, unverified_helpers = 0;
    if (hasHP) {
      try {
        const { rows } = await db.query(`
          SELECT
            COUNT(*) FILTER (WHERE is_identity_verified = TRUE OR is_background_checked = TRUE)  AS verified,
            COUNT(*) FILTER (WHERE is_identity_verified IS NOT TRUE AND is_background_checked IS NOT TRUE) AS unverified
          FROM helper_profiles
        `);
        verified_helpers   = safeInt(rows[0]?.verified);
        unverified_helpers = safeInt(rows[0]?.unverified);
      } catch (_) {}
    }

    // ── Job stats ─────────────────────────────────────────────────────────
    let open_jobs = 0, active_jobs = 0, completed_jobs = 0, cancelled_jobs = 0,
        completed_jobs_period = 0, new_jobs_period = 0, new_jobs_today = 0,
        open_disputes = 0, avg_bids_per_job = null;
    if (hasJobs) {
      try {
        const { rows } = await db.query(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'published')                               AS open_jobs,
            COUNT(*) FILTER (WHERE status = 'in_progress')                             AS active_jobs,
            COUNT(*) FILTER (WHERE status = 'completed')                               AS completed_jobs,
            COUNT(*) FILTER (WHERE status = 'cancelled')                               AS cancelled_jobs,
            COUNT(*) FILTER (WHERE status = 'completed' AND created_at >= now() - $1::interval) AS completed_jobs_period,
            COUNT(*) FILTER (WHERE created_at >= now() - $1::interval)                AS new_jobs_period,
            COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()))             AS new_jobs_today,
            COUNT(*) FILTER (WHERE dispute_status = 'open')                            AS open_disputes,
            ROUND(AVG(bid_count) FILTER (WHERE bid_count > 0 AND created_at >= now() - $1::interval), 1) AS avg_bids_per_job
          FROM jobs
        `, [cur]);
        open_jobs             = safeInt(rows[0]?.open_jobs);
        active_jobs           = safeInt(rows[0]?.active_jobs);
        completed_jobs        = safeInt(rows[0]?.completed_jobs);
        cancelled_jobs        = safeInt(rows[0]?.cancelled_jobs);
        completed_jobs_period = safeInt(rows[0]?.completed_jobs_period);
        new_jobs_period       = safeInt(rows[0]?.new_jobs_period);
        new_jobs_today        = safeInt(rows[0]?.new_jobs_today);
        open_disputes         = safeInt(rows[0]?.open_disputes);
        avg_bids_per_job      = rows[0]?.avg_bids_per_job != null ? parseFloat(rows[0].avg_bids_per_job) : null;
      } catch (jobErr) {
        logger.warn('getDashboardStats: jobs query failed', { err: jobErr.message });
      }
    }

    // ── Revenue stats ─────────────────────────────────────────────────────
    let total_revenue_cents = 0, revenue_period_cents = 0,
        subscription_revenue_period_cents = 0, revenue_mtd_cents = 0,
        subscription_revenue_mtd_cents = 0, refunds_period_cents = 0;
    if (hasLedger) {
      try {
        const { rows } = await db.query(`
          SELECT
            COALESCE(SUM(amount_cents) FILTER (WHERE source_type IN ('job_fee','subscription') AND amount_cents > 0), 0)                                             AS total_revenue_cents,
            COALESCE(SUM(amount_cents) FILTER (WHERE source_type IN ('job_fee','subscription') AND amount_cents > 0 AND created_at >= now() - $1::interval), 0)     AS revenue_period_cents,
            COALESCE(SUM(amount_cents) FILTER (WHERE source_type = 'subscription' AND amount_cents > 0 AND created_at >= now() - $1::interval), 0)                  AS subscription_revenue_period_cents,
            COALESCE(SUM(amount_cents) FILTER (WHERE source_type IN ('job_fee','subscription') AND amount_cents > 0 AND created_at >= date_trunc('month', now())), 0) AS revenue_mtd_cents,
            COALESCE(SUM(amount_cents) FILTER (WHERE source_type = 'subscription' AND amount_cents > 0 AND created_at >= date_trunc('month', now())), 0)             AS subscription_revenue_mtd_cents,
            COALESCE(SUM(ABS(amount_cents)) FILTER (WHERE source_type = 'refund' AND created_at >= now() - $1::interval), 0)                                        AS refunds_period_cents
          FROM platform_ledger
        `, [cur]);
        total_revenue_cents               = safeInt(rows[0]?.total_revenue_cents);
        revenue_period_cents              = safeInt(rows[0]?.revenue_period_cents);
        subscription_revenue_period_cents = safeInt(rows[0]?.subscription_revenue_period_cents);
        revenue_mtd_cents                 = safeInt(rows[0]?.revenue_mtd_cents);
        subscription_revenue_mtd_cents    = safeInt(rows[0]?.subscription_revenue_mtd_cents);
        refunds_period_cents              = safeInt(rows[0]?.refunds_period_cents);
      } catch (_) {}
    }

    // ── Subscription count ────────────────────────────────────────────────
    let active_subscriptions = 0;
    if (hasSubs) {
      try {
        const { rows } = await db.query(`SELECT COUNT(*) AS cnt FROM subscriptions WHERE status = 'active'`);
        active_subscriptions = safeInt(rows[0]?.cnt);
      } catch (_) {}
    }

    // ── Pending payouts ───────────────────────────────────────────────────
    let pending_payouts = 0;
    if (hasPayouts) {
      try {
        // Try amount_cents first; fall back to amount * 100
        const { rows } = await db.query(
          `SELECT COALESCE(SUM(CASE WHEN amount_cents IS NOT NULL THEN amount_cents ELSE CAST(amount * 100 AS BIGINT) END), 0) AS total
           FROM payouts WHERE status = 'pending'`
        );
        pending_payouts = safeFloat(rows[0]?.total) / 100; // convert to dollars
      } catch (_) {}
    }

    // ── Support tickets ───────────────────────────────────────────────────
    let open_support_tickets = 0;
    if (hasST) {
      try {
        const { rows } = await db.query(
          `SELECT COUNT(*) AS cnt FROM support_tickets WHERE status NOT IN ('resolved','closed')`
        );
        open_support_tickets = safeInt(rows[0]?.cnt);
      } catch (_) {}
    }

    // ── Content reports ───────────────────────────────────────────────────
    let pending_reports = 0;
    if (hasContentReports) {
      try {
        const { rows } = await db.query(`SELECT COUNT(*) AS cnt FROM content_reports WHERE status = 'pending'`);
        pending_reports = safeInt(rows[0]?.cnt);
      } catch (_) {}
    }

    // ── Previous-period comparison ────────────────────────────────────────
    let new_users_prev = 0, new_jobs_prev = 0, revenue_prev_cents = 0;
    try {
      const { rows } = await db.query(
        `SELECT COUNT(*) AS cnt FROM users WHERE role NOT IN ('admin','super_admin') AND created_at BETWEEN now() - $2::interval AND now() - $1::interval`,
        [cur, prevInterval]
      );
      new_users_prev = safeInt(rows[0]?.cnt);
    } catch (_) {}
    if (hasJobs) {
      try {
        const { rows } = await db.query(
          `SELECT COUNT(*) AS cnt FROM jobs WHERE created_at BETWEEN now() - $2::interval AND now() - $1::interval`,
          [cur, prevInterval]
        );
        new_jobs_prev = safeInt(rows[0]?.cnt);
      } catch (_) {}
    }
    if (hasLedger) {
      try {
        const { rows } = await db.query(
          `SELECT COALESCE(SUM(amount_cents),0) AS total FROM platform_ledger WHERE source_type IN ('job_fee','subscription') AND amount_cents > 0 AND created_at BETWEEN now() - $2::interval AND now() - $1::interval`,
          [cur, prevInterval]
        );
        revenue_prev_cents = safeInt(rows[0]?.total);
      } catch (_) {}
    }

    // ── Completion rate ────────────────────────────────────────────────────
    const totalFinished = completed_jobs_period + cancelled_jobs;
    const completion_rate = totalFinished > 0
      ? Math.round((completed_jobs_period / totalFinished) * 100)
      : null;

    const stats = {
      total_users:          safeInt(coreStats.total_users),
      total_customers:      safeInt(coreStats.total_customers),
      total_helpers:        safeInt(coreStats.total_helpers),
      total_brokers:        safeInt(coreStats.total_brokers),
      new_users_period:     safeInt(coreStats.new_users_period),
      new_users_today:      safeInt(coreStats.new_users_today),
      suspended_users,
      verified_helpers,
      unverified_helpers,
      open_jobs,
      active_jobs,
      completed_jobs,
      cancelled_jobs,
      new_jobs_period,
      new_jobs_today,
      open_disputes,
      avg_bids_per_job,
      completion_rate,
      total_revenue_cents,
      revenue_period_cents,
      subscription_revenue_period_cents,
      revenue_mtd_cents,
      subscription_revenue_mtd_cents,
      refunds_period_cents,
      active_subscriptions,
      pending_payouts,
      open_support_tickets,
      pending_reports,
      new_users_delta:     safeInt(coreStats.new_users_period) - new_users_prev,
      new_jobs_delta:      new_jobs_period - new_jobs_prev,
      revenue_delta_cents: revenue_period_cents - revenue_prev_cents,
      // Legacy aliases
      new_users_30d: safeInt(coreStats.new_users_period),
      new_jobs_30d:  new_jobs_period,
      escrow_held:   0,
    };

    res.json({ stats, period, mrr: 0 });
  } catch (err) {
    logger.error('getDashboardStats error', { err });
    res.status(500).json({ error: 'Failed to load dashboard stats.' });
  }
};

// ─── REVENUE CHART (period-aware, broken out by type) ─────────────────────────

exports.getRevenueChart = async (req, res) => {
  try {
    const hasLedger = await tableExists('platform_ledger');
    if (!hasLedger) return res.json({ chart: [], totals: { job_fee: 0, subscription: 0, refunds: 0 }, period: req.query.period || '30d' });

    const period = PERIOD_INTERVAL[req.query.period] ? req.query.period : '30d';
    const { interval, trunc } = PERIOD_INTERVAL[period];

    const { rows } = await db.query(`
      SELECT
        date_trunc($1, created_at) AS period,
        COALESCE(SUM(CASE WHEN source_type = 'job_fee'      AND amount_cents > 0 THEN amount_cents ELSE 0 END), 0)  AS job_fee_cents,
        COALESCE(SUM(CASE WHEN source_type = 'subscription' AND amount_cents > 0 THEN amount_cents ELSE 0 END), 0)  AS subscription_cents,
        COALESCE(SUM(CASE WHEN source_type = 'refund'                            THEN ABS(amount_cents) ELSE 0 END), 0) AS refunds_cents
      FROM platform_ledger
      WHERE created_at >= now() - $2::interval
      GROUP BY 1
      ORDER BY 1 ASC
    `, [trunc, interval]);

    // Aggregate totals for the summary line
    const totals = rows.reduce((acc, r) => ({
      job_fee:      acc.job_fee      + parseInt(r.job_fee_cents, 10),
      subscription: acc.subscription + parseInt(r.subscription_cents, 10),
      refunds:      acc.refunds      + parseInt(r.refunds_cents, 10),
    }), { job_fee: 0, subscription: 0, refunds: 0 });

    res.json({ chart: rows, totals, period });
  } catch (err) {
    logger.error('getRevenueChart error', { err });
    res.status(500).json({ error: 'Failed to load revenue chart.' });
  }
};

// ─── DASHBOARD RECENT ACTIVITY ────────────────────────────────────────────────

exports.getDashboardActivity = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const events = [];

    const [hasJobs, hasST, hasHP, hasMig154] = await Promise.all([
      tableExists('jobs'),
      tableExists('support_tickets'),
      tableExists('helper_profiles'),
      columnExists('users', 'is_suspended'),
    ]);

    // Recent user signups
    try {
      const { rows } = await db.query(
        `SELECT 'user_registered' AS type, u.id AS entity_id,
                u.first_name || ' ' || u.last_name AS label,
                u.role, u.created_at AS occurred_at
         FROM users u
         WHERE u.role NOT IN ('admin','super_admin')
         ORDER BY u.created_at DESC LIMIT $1`,
        [limit]
      );
      events.push(...rows);
    } catch (_) {}

    // Recent jobs
    if (hasJobs) {
      try {
        const { rows } = await db.query(
          `SELECT j.status || '_job' AS type, j.id AS entity_id,
                  j.title AS label, j.status, j.created_at AS occurred_at
           FROM jobs j
           ORDER BY j.created_at DESC LIMIT $1`,
          [limit]
        );
        events.push(...rows);
      } catch (_) {}
    }

    // Recent support tickets
    if (hasST) {
      try {
        const { rows } = await db.query(
          `SELECT 'support_ticket' AS type, t.id AS entity_id,
                  t.subject AS label, t.status, t.created_at AS occurred_at
           FROM support_tickets t
           ORDER BY t.created_at DESC LIMIT $1`,
          [limit]
        );
        events.push(...rows);
      } catch (_) {}
    }

    // Sort all events by occurred_at desc, take top N
    events.sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
    res.json({ activity: events.slice(0, limit) });
  } catch (err) {
    logger.error('getDashboardActivity error', { err });
    res.status(500).json({ error: 'Failed to load activity.' });
  }
};

// ─── DASHBOARD GEOGRAPHIC DISTRIBUTION ───────────────────────────────────────

exports.getDashboardGeo = async (req, res) => {
  try {
    const hasJobs = await tableExists('jobs');
    const [userGeo, jobGeo] = await Promise.all([
      db.query(
        `SELECT TRIM(city) AS city, TRIM(state) AS state, COUNT(*) AS count
         FROM users
         WHERE role NOT IN ('admin','super_admin') AND city IS NOT NULL AND city <> ''
         GROUP BY 1, 2 ORDER BY count DESC LIMIT 10`
      ).then(r => r.rows).catch(() => []),
      hasJobs
        ? db.query(
            `SELECT TRIM(location_city) AS city, TRIM(location_state) AS state, COUNT(*) AS count
             FROM jobs
             WHERE location_city IS NOT NULL AND location_city <> ''
             GROUP BY 1, 2 ORDER BY count DESC LIMIT 10`
          ).then(r => r.rows).catch(() => [])
        : Promise.resolve([]),
    ]);
    res.json({ userGeo, jobGeo });
  } catch (err) {
    logger.error('getDashboardGeo error', { err });
    res.status(500).json({ error: 'Failed to load geo data.' });
  }
};

// USER MANAGEMENT
exports.getUsers = async (req, res) => {
  try {
    const {
      search, role, status, plan, location,
      page = 1, limit = 25, sort = 'created_at', order = 'desc'
    } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let paramIdx = 1;

    // Base exclusion: Never return administrative accounts via the standard user list.
    const baseConditions = [`u.role NOT IN ('admin','super_admin')`];

    if (search) {
      baseConditions.push(`(u.first_name ILIKE $${paramIdx} OR u.last_name ILIKE $${paramIdx} OR u.email ILIKE $${paramIdx} OR u.phone ILIKE $${paramIdx})`);
      params.push(`%${search}%`); paramIdx++;
    }
    if (role) { baseConditions.push(`u.role = $${paramIdx++}`); params.push(role); }
    if (status === 'active') baseConditions.push(`u.is_active = true`);
    else if (status === 'banned') baseConditions.push(`u.is_active = false`);
    if (location) {
      baseConditions.push(`(u.city ILIKE $${paramIdx} OR u.state ILIKE $${paramIdx} OR u.zip_code ILIKE $${paramIdx})`);
      params.push(`%${location}%`); paramIdx++;
    }

    // Check which optional tables/columns exist
    const [hasSubs, hasHP, hasJobs, hasPayouts, hasDeletionCols] = await Promise.all([
      tableExists('subscriptions'),
      tableExists('helper_profiles'),
      tableExists('jobs'),
      tableExists('payouts'),
      columnExists('users', 'deletion_scheduled_at'),
    ]);
    const hasPlanTable = hasSubs && await tableExists('plans');

    if (plan && hasPlanTable) { baseConditions.push(`p.slug = $${paramIdx++}`); params.push(plan); }

    const allowedSorts = ['created_at', 'first_name', 'email', 'last_login_at'];
    // avg_rating sort must be prefixed with hp. when hasHP, falls back to u.created_at otherwise
    const sortIsRating = sort === 'avg_rating' && hasHP;
    const safeSort = sortIsRating ? 'hp.avg_rating' : (allowedSorts.includes(sort) ? `u.${sort}` : 'u.created_at');
    const safeOrder = order === 'asc' ? 'ASC' : 'DESC';

    const finalWhereClause = `WHERE ${baseConditions.join(' AND ')}`;

    const selectCols = [
      // Core user fields. Note: users table has no avatar_url column — avatar comes from helper_profiles.
      'u.id, u.first_name, u.last_name, u.email, u.role, u.is_active, u.phone, u.created_at, u.email_verified, u.is_verified, u.last_login_at',
      'u.city, u.state, u.zip_code',
      'u.subscription_status AS user_sub_status',
      'u.deleted_at',
      // Migration-165 deletion scheduling columns (only when present)
      ...(hasDeletionCols ? ['u.deletion_scheduled_at, u.deletion_type, u.deletion_reason'] : []),
    ];
    const joins = [];
    if (hasSubs) {
      joins.push("LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'");
      selectCols.push('s.status AS subscription_status, s.current_period_end');
    } else { selectCols.push('NULL AS subscription_status, NULL AS current_period_end'); }
    if (hasPlanTable) {
      joins.push('LEFT JOIN plans p ON p.id = s.plan_id');
      selectCols.push('p.slug AS plan_slug, p.name AS plan_name');
    } else { selectCols.push('NULL AS plan_slug, NULL AS plan_name'); }
    if (hasHP) {
      joins.push('LEFT JOIN helper_profiles hp ON hp.user_id = u.id');
      // profile_photo_url aliased as avatar_url so the frontend can use user.avatar_url uniformly
      selectCols.push('hp.avg_rating, hp.completed_jobs_count, hp.total_reviews, hp.is_background_checked, hp.is_identity_verified, hp.tier AS helper_tier, hp.profile_photo_url AS avatar_url');
    } else { selectCols.push('NULL AS avg_rating, NULL AS completed_jobs_count, NULL AS total_reviews, NULL AS is_background_checked, NULL AS is_identity_verified, NULL AS helper_tier, NULL AS avatar_url'); }
    if (hasJobs) {
      selectCols.push("(SELECT COUNT(*) FROM jobs WHERE client_id = u.id) AS jobs_posted");
      selectCols.push("(SELECT COUNT(*) FROM jobs WHERE assigned_helper_id = u.id AND status = 'completed') AS jobs_completed_as_helper");
    } else { selectCols.push('0 AS jobs_posted, 0 AS jobs_completed_as_helper'); }
    if (hasPayouts) {
      selectCols.push("(SELECT COALESCE(SUM(amount_cents),0)/100.0 FROM payouts WHERE user_id = u.id AND status = 'paid') AS earnings_total");
    } else { selectCols.push('0 AS earnings_total'); }

    const { rows: users } = await db.query(`
      SELECT ${selectCols.join(', ')}
      FROM users u
      ${joins.join(' ')}
      ${finalWhereClause}
      ORDER BY ${safeSort} ${safeOrder} NULLS LAST
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, limit, offset]);

    const countJoins = hasSubs ? "LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'" : '';
    const countJoins2 = hasPlanTable ? 'LEFT JOIN plans p ON p.id = s.plan_id' : '';
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM users u ${countJoins} ${countJoins2} ${finalWhereClause}`,
      params
    );

    // Summary stats (always across all non-admin users, ignoring current filters)
    const { rows: summaryRows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE role NOT IN ('admin','super_admin'))                             AS total,
        COUNT(*) FILTER (WHERE role NOT IN ('admin','super_admin') AND is_active = true)        AS active,
        COUNT(*) FILTER (WHERE role NOT IN ('admin','super_admin') AND is_active = false)       AS suspended,
        COUNT(*) FILTER (WHERE role IN ('helper','helper_pro'))                                 AS helpers,
        COUNT(*) FILTER (WHERE role = 'customer')                                               AS customers,
        COUNT(*) FILTER (WHERE role NOT IN ('admin','super_admin') AND created_at >= now() - interval '7 days') AS new_this_week
      FROM users
    `);

    res.json({
      users,
      total: parseInt(countRows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(countRows[0].count / limit),
      summary: summaryRows[0],
    });
  } catch (err) {
    logger.error('getUsers error', { err });
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
};

exports.getUserDetail = async (req, res) => {
  try {
    const { userId } = req.params;
    const hasHP   = await tableExists('helper_profiles');
    const hasSubs = await tableExists('subscriptions');
    const hasPlanTable = hasSubs && await tableExists('plans');
    const hasCA   = await tableExists('connect_accounts');

    // Check for columns added in migration 154 (non-fatal if migration hasn't run)
    const hasMig154Cols = await columnExists('users', 'is_suspended');

    // Explicit list of columns to retrieve. NEVER use SELECT * in production to
    // prevent leaking sensitive internal flags or secrets (e.g. password_hash, otp_secret).
    const cols = [
      'u.id', 'u.first_name', 'u.last_name', 'u.email', 'u.role', 'u.is_active',
      'u.phone', 'u.created_at', 'u.updated_at', 'u.email_verified', 'u.is_verified',
      'u.onboarding_status', 'u.onboarding_completed', 'u.contact_completed', 'u.profile_completed',
      'u.tier_selected', 'u.w9_completed', 'u.terms_accepted', 'u.membership_tier', 'u.id_verified',
      'u.background_check_passed', 'u.city', 'u.state', 'u.zip_code',
      'u.didit_status', 'u.didit_verified_at',
      'COALESCE(u.didit_enforcement_required, FALSE) AS didit_enforcement_required',
      'u.last_login_at',
      'u.subscription_status', 'u.background_check_status', 'u.identity_verified',
    ];

    // Columns added in migration 154 — only include when the migration has run
    if (hasMig154Cols) {
      cols.push(
        'u.last_login_ip',
        'COALESCE(u.is_suspended, FALSE) AS is_suspended',
        'u.suspended_until',
        'u.suspension_reason',
        'COALESCE(u.is_restricted, FALSE) AS is_restricted',
        'u.restriction_reason',
        'COALESCE(u.warning_count, 0) AS warning_count',
        'u.bio',
        'u.country',
      );
    } else {
      // Provide safe defaults so the frontend never receives undefined for these fields
      cols.push(
        'NULL AS last_login_ip',
        'FALSE AS is_suspended',
        'NULL AS suspended_until',
        'NULL AS suspension_reason',
        'FALSE AS is_restricted',
        'NULL AS restriction_reason',
        '0 AS warning_count',
        'NULL AS bio',
        "NULL AS country",
      );
    }

    const joins = [];
    if (hasSubs) { joins.push("LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'"); cols.push('s.status AS sub_status, s.stripe_subscription_id, s.current_period_start, s.current_period_end, s.cancel_at_period_end'); }
    if (hasPlanTable) { joins.push('LEFT JOIN plans p ON p.id = s.plan_id'); cols.push('p.slug AS plan_slug, p.name AS plan_name'); }
    if (hasHP)   { joins.push('LEFT JOIN helper_profiles hp ON hp.user_id = u.id'); cols.push('hp.bio_short, hp.bio_long, hp.avg_rating, hp.total_reviews, hp.completed_jobs_count, hp.is_background_checked, hp.is_identity_verified, hp.tier AS helper_tier, hp.hourly_rate_min, hp.hourly_rate_max, hp.service_city, hp.service_state, hp.profile_photo_url AS hp_profile_photo_url, hp.stripe_account_id AS hp_stripe_account_id, hp.stripe_charges_enabled AS hp_charges_enabled, hp.stripe_payouts_enabled AS hp_payouts_enabled'); }
    // connect_accounts is the authoritative source for Stripe Connect status
    if (hasCA)   { joins.push('LEFT JOIN connect_accounts ca ON ca.user_id = u.id'); cols.push('ca.stripe_account_id AS ca_stripe_account_id, ca.charges_enabled AS ca_charges_enabled, ca.payouts_enabled AS ca_payouts_enabled, ca.onboarding_complete AS ca_onboarding_complete'); }
    
    const { rows: userRows } = await db.query(`SELECT ${cols.join(', ')} FROM users u ${joins.join(' ')} WHERE u.id = $1`, [userId]);
    if (!userRows.length) return res.status(404).json({ error: 'User not found.' });

    const raw = userRows[0];
    // Normalize field names to match what the admin UI expects.
    // connect_accounts is authoritative for Stripe Connect fields; fall back to
    // helper_profiles for deployments that haven't migrated to connect_accounts.
    const user = {
      ...raw,
      avatar_url:          raw.hp_profile_photo_url || null,
      id_verified:         raw.identity_verified ?? raw.is_identity_verified ?? false,
      stripe_account_id:   raw.ca_stripe_account_id   || raw.hp_stripe_account_id   || null,
      charges_enabled:     raw.ca_charges_enabled      ?? raw.hp_charges_enabled      ?? false,
      payouts_enabled:     raw.ca_payouts_enabled      ?? raw.hp_payouts_enabled      ?? false,
      onboarding_complete: raw.ca_onboarding_complete  ?? false,
      average_rating:      raw.avg_rating,
      completed_jobs:      raw.completed_jobs_count,
    };

    let recentJobs = [], recentReviews = [], recentPayouts = [];
    if (await tableExists('jobs')) {
      const r = await db.query(
        `SELECT id, title, status, job_value AS final_price, created_at
         FROM jobs WHERE client_id = $1 OR assigned_helper_id = $1
         ORDER BY created_at DESC LIMIT 10`, [userId]);
      recentJobs = r.rows;
    }
    if (await tableExists('reviews')) {
      const r = await db.query(
        `SELECT r.rating, r.comment, r.created_at, u2.first_name || ' ' || u2.last_name AS reviewer_name
         FROM reviews r JOIN users u2 ON r.reviewer_id = u2.id
         WHERE r.reviewee_id = $1 ORDER BY r.created_at DESC LIMIT 5`, [userId]);
      recentReviews = r.rows;
    }
    if (await tableExists('payments')) {
      const r = await db.query(
        `SELECT j.title AS job_title, p.created_at AS completed_at,
                ROUND(COALESCE(p.helper_payout, 0) * 100)::INTEGER AS net_to_helper_cents
         FROM payments p JOIN jobs j ON p.job_id = j.id
         WHERE p.payee_id = $1 AND p.status = 'captured'
         ORDER BY p.created_at DESC LIMIT 10`, [userId]);
      recentPayouts = r.rows;
    }
    res.json({ user, recentJobs, recentPayouts, recentReviews, billing: [] });
  } catch (err) { logger.error('getUserDetail error', { err }); res.status(500).json({ error: 'Failed to fetch user detail.' }); }
};

/**
 * PUT /admin/users/:userId/didit-enforcement
 * Body: { required: boolean }
 * When required=true, user must complete Didit (skipped no longer satisfies API gate).
 * If they had skipped, didit_status is reset to pending so they see the flow again.
 */
exports.setUserDiditEnforcement = async (req, res) => {
  try {
    const { userId } = req.params;
    const { required } = req.body;
    if (typeof required !== 'boolean') {
      return res.status(400).json({ error: 'required must be a boolean' });
    }
    const adminId = req.user.id;
    const { rows: before } = await db.query(
      'SELECT id, role, didit_enforcement_required, didit_status FROM users WHERE id = $1',
      [userId]
    );
    if (!before.length) return res.status(404).json({ error: 'User not found.' });
    if (['admin', 'super_admin'].includes(before[0].role)) {
      return res.status(403).json({ error: 'Cannot change Didit policy for admin accounts.' });
    }

    const { rows: updateRows } = await db.query(
      `UPDATE users SET
         didit_enforcement_required = $2,
         didit_status = CASE
           WHEN $2 = TRUE AND didit_status = 'skipped' THEN 'pending'
           ELSE didit_status
         END,
         updated_at = NOW()
       WHERE id = $1 AND didit_enforcement_required IS DISTINCT FROM $2 RETURNING id`,
      [userId, required]
    );
    if (updateRows.length === 0) {
      return res.status(409).json({ error: 'Didit enforcement status unchanged - operation may have been concurrent.' });
    }

    if (required) {
      try {
        await db.query('UPDATE sessions SET is_valid = false WHERE user_id = $1', [userId]);
        socketService.broadcastToUser(userId, 'force_logout', { reason: 'didit_enforcement_required' });
      } catch (e) { /* non-fatal */ }
    }

    try {
      await logAdminAction({
        adminId,
        action: 'user_didit_enforcement',
        targetType: 'user',
        targetId: userId,
        description: `didit_enforcement_required=${required}`,
        before: { didit_enforcement_required: before[0].didit_enforcement_required, didit_status: before[0].didit_status },
        after: { didit_enforcement_required: required },
        req,
      });
    } catch (e) { /* non-fatal */ }

    return res.json({
      message: required
        ? 'Identity verification is now required for this user.'
        : 'Optional identity verification restored for this user.',
      didit_enforcement_required: required,
    });
  } catch (err) {
    logger.error('setUserDiditEnforcement error', { err });
    return res.status(500).json({ error: 'Failed to update Didit enforcement.' });
  }
};

exports.toggleUserBan = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;
    const { rows: before } = await db.query('SELECT is_active, role FROM users WHERE id = $1', [userId]);
    if (!before.length) return res.status(404).json({ error: 'User not found.' });
    if (['admin','super_admin'].includes(before[0].role)) return res.status(403).json({ error: 'Cannot ban admin accounts.' });
    const newStatus = !before[0].is_active;
    const { rows: updateRows } = await db.query('UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 AND is_active = $3 RETURNING id', [newStatus, userId, before[0].is_active]);
    if (updateRows.length === 0) {
      return res.status(409).json({ error: 'User status changed during ban operation - concurrent modification detected.' });
    }
    try { await logAdminAction({ adminId, action: newStatus ? 'user_unbanned' : 'user_banned', targetType: 'user', targetId: userId, description: reason || null, before: { is_active: before[0].is_active }, after: { is_active: newStatus }, req }); } catch(e) {}
    try { await sendNotification({ userId, type: newStatus ? 'account_restored' : 'account_banned', title: newStatus ? 'Account restored' : 'Account suspended', body: newStatus ? 'Your account has been restored.' : `Your account has been suspended. Reason: ${reason || 'Policy violation'}` }); } catch(e) {}
    // Kick any live WebSocket session immediately so the user can't keep browsing
    if (!newStatus) socketService.broadcastToUser(userId, 'force_logout', { reason: 'account_banned' });
    res.json({ message: `User ${newStatus ? 'unbanned' : 'banned'} successfully.`, is_active: newStatus });
  } catch (err) { logger.error('toggleUserBan error', { err }); res.status(500).json({ error: 'Failed to update user status.' }); }
};

/**
 * POST /admin/users/:userId/verify - super-admin only (route).
 * Body: { field: 'is_identity_verified' | 'is_background_checked' }
 * Confirms ID or background at the platform level (users + helper_profiles).
 */
exports.verifyUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { field } = req.body;
    const adminId = req.user.id;
    const allowed = ['is_identity_verified', 'is_background_checked'];
    if (!allowed.includes(field)) return res.status(400).json({ error: 'Invalid verification field.' });

    const { rows: targets } = await db.query(
      'SELECT id, role FROM users WHERE id = $1',
      [userId]
    );
    if (!targets.length) return res.status(404).json({ error: 'User not found.' });
    if (['admin', 'super_admin'].includes(targets[0].role)) {
      return res.status(403).json({ error: 'Cannot modify verification flags for admin accounts.' });
    }

    const isHelperRole = ['helper', 'helper_pro', 'broker'].includes(targets[0].role);

    if (field === 'is_identity_verified') {
      const { rows: idVerifyRows } = await db.query(
        `UPDATE users SET
           didit_status = 'verified',
           identity_verified = TRUE,
           id_verified = TRUE,
           didit_verified_at = COALESCE(didit_verified_at, NOW()),
           didit_enforcement_required = FALSE,
           updated_at = NOW()
         WHERE id = $1 RETURNING id`,
        [userId]
      );
      if (idVerifyRows.length === 0) {
        return res.status(409).json({ error: 'User state changed during verification - operation may have been concurrent.' });
      }
      if (isHelperRole && (await tableExists('helper_profiles'))) {
        await db.query(
          `INSERT INTO helper_profiles (user_id, is_identity_verified, tier, is_listed, created_at, updated_at)
           VALUES ($1, TRUE, 'tier1', FALSE, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             is_identity_verified = TRUE,
             updated_at = NOW()`,
          [userId]
        );
      }
    } else if (field === 'is_background_checked') {
      const { rows: bgCheckRows } = await db.query(
        `UPDATE users SET
           background_check_status = 'passed',
           background_check_passed = TRUE,
           background_check_passed_at = COALESCE(background_check_passed_at, NOW()),
           background_check_expiry = COALESCE(background_check_expiry, NOW() + INTERVAL '1 year'),
           updated_at = NOW()
         WHERE id = $1 RETURNING id`,
        [userId]
      );
      if (bgCheckRows.length === 0) {
        return res.status(409).json({ error: 'User state changed during verification - operation may have been concurrent.' });
      }
      if (isHelperRole && (await tableExists('helper_profiles'))) {
        await db.query(
          `INSERT INTO helper_profiles (user_id, is_background_checked, tier, is_listed, created_at, updated_at)
           VALUES ($1, TRUE, 'tier1', FALSE, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             is_background_checked = TRUE,
             updated_at = NOW()`,
          [userId]
        );
      }
    }

    try {
      await logAdminAction({
        adminId,
        action: 'user_verified',
        targetType: 'user',
        targetId: userId,
        description: `Super-admin confirmed ${field}`,
        req,
      });
    } catch (e) { /* non-fatal */ }

    res.json({ message: `${field} confirmed successfully.` });
  } catch (err) {
    logger.error('verifyUser error', { err });
    res.status(500).json({ error: 'Failed to verify user.' });
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    const adminId = req.user.id;
    const allowed = ['customer','helper','helper_pro','broker','admin'];
    if (!allowed.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    if (role === 'admin' && !req.isSuper) return res.status(403).json({ error: 'Super Admin required.' });
    const { rows: before } = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (!before.length) return res.status(404).json({ error: 'User not found.' });
    const { rows: updateRows } = await db.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND role = $3 RETURNING id', [role, userId, before[0].role]);
    if (updateRows.length === 0) {
      return res.status(409).json({ error: 'User role changed during update - concurrent modification detected.' });
    }
    try { await logAdminAction({ adminId, action: 'user_role_changed', targetType: 'user', targetId: userId, before: { role: before[0].role }, after: { role }, req }); } catch(e) {}
    res.json({ message: `User role updated to ${role}.` });
  } catch (err) { logger.error('updateUserRole error', { err }); res.status(500).json({ error: 'Failed to update role.' }); }
};

exports.updateUserName = async (req, res) => {
  try {
    const { userId } = req.params;
    const { first_name, last_name } = req.body;
    const adminId = req.user.id;
    if (!first_name || !last_name) return res.status(400).json({ error: 'First name and last name are required.' });
    const trimFirst = first_name.trim();
    const trimLast = last_name.trim();
    if (!trimFirst || !trimLast) return res.status(400).json({ error: 'First name and last name cannot be blank.' });
    const { rows: before } = await db.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
    if (!before.length) return res.status(404).json({ error: 'User not found.' });
    const { rows: updateRows } = await db.query('UPDATE users SET first_name = $1, last_name = $2, updated_at = NOW() WHERE id = $3 RETURNING id', [trimFirst, trimLast, userId]);
    if (updateRows.length === 0) {
      return res.status(409).json({ error: 'User not found during update - concurrent deletion detected.' });
    }
    try { await logAdminAction({ adminId, action: 'user_name_changed', targetType: 'user', targetId: userId, before: { first_name: before[0].first_name, last_name: before[0].last_name }, after: { first_name: trimFirst, last_name: trimLast }, req }); } catch(e) {}
    res.json({ message: 'User name updated successfully.' });
  } catch (err) { logger.error('updateUserName error', { err }); res.status(500).json({ error: 'Failed to update name.' }); }
};

// JOB MANAGEMENT
exports.getJobs = async (req, res) => {
  try {
    if (!(await tableExists('jobs'))) return res.json({ jobs: [], total: 0, page: 1, limit: 25, pages: 0 });
    const { search, status, category, page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;
    const params = []; let paramIdx = 1; let conditions = [];
    if (search) { conditions.push(`(j.title ILIKE $${paramIdx} OR j.description ILIKE $${paramIdx})`); params.push(`%${search}%`); paramIdx++; }
    if (status) { conditions.push(`j.status = $${paramIdx++}`); params.push(status); }
    if (category) { conditions.push(`j.category_name = $${paramIdx++}`); params.push(category); }
    const wc = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(`SELECT j.id, j.title, j.status, j.budget_min, j.budget_max, j.job_value, j.is_broker_mediated, j.created_at, j.bid_count, j.location_city, j.location_state, j.category_name, u_c.first_name || ' ' || u_c.last_name AS client_name, u_c.email AS client_email, u_h.first_name || ' ' || u_h.last_name AS helper_name FROM jobs j JOIN users u_c ON j.client_id = u_c.id LEFT JOIN users u_h ON j.assigned_helper_id = u_h.id ${wc} ORDER BY j.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`, [...params, limit, offset]);
    const { rows: countRows } = await db.query(`SELECT COUNT(*) FROM jobs j ${wc}`, params);
    res.json({ jobs: rows, total: parseInt(countRows[0].count), page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(countRows[0].count / limit) });
  } catch (err) { logger.error('getJobs error', { err }); res.status(500).json({ error: 'Failed to fetch jobs.' }); }
};

exports.forceJobAction = async (req, res) => {
  try {
    if (!(await tableExists('jobs'))) return res.status(400).json({ error: 'Jobs table not available.' });
    const { jobId } = req.params;
    const { action, reason } = req.body;
    const adminId = req.user.id;
    const allowed = ['cancel','remove','flag','unflag'];
    if (!allowed.includes(action)) return res.status(400).json({ error: 'Invalid action.' });
    const { rows: jobRows } = await db.query('SELECT status, metadata FROM jobs WHERE id = $1', [jobId]);
    if (!jobRows.length) return res.status(404).json({ error: 'Job not found.' });

    if (action === 'cancel' || action === 'remove') {
      const { rows: updateRows } = await db.query(
        `UPDATE jobs SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status != 'cancelled' RETURNING id`,
        [jobId]
      );
      if (updateRows.length === 0) {
        return res.status(409).json({ error: 'Job is already cancelled or was cancelled during this operation.' });
      }
    }
    if (action === 'flag') {
      const { rows: flagRows } = await db.query(
        `UPDATE jobs SET metadata = jsonb_set(COALESCE(metadata,'{}'), '{admin_flagged}', 'true',  true), updated_at = now() WHERE id = $1 AND NOT (COALESCE(metadata,'{}')->>'admin_flagged') = 'true' RETURNING id`,
        [jobId]
      );
      if (flagRows.length === 0) {
        return res.status(409).json({ error: 'Job is already flagged or flag state changed during operation.' });
      }
    }
    if (action === 'unflag') {
      const { rows: unflagRows } = await db.query(
        `UPDATE jobs SET metadata = jsonb_set(COALESCE(metadata,'{}'), '{admin_flagged}', 'false', true), updated_at = now() WHERE id = $1 AND (COALESCE(metadata,'{}')->>'admin_flagged') = 'true' RETURNING id`,
        [jobId]
      );
      if (unflagRows.length === 0) {
        return res.status(409).json({ error: 'Job is not flagged or flag state changed during operation.' });
      }
    }
    try { await logAdminAction({ adminId, action: `job_${action}`, targetType: 'job', targetId: jobId, description: reason || null, req }); } catch(e) {}
    res.json({ message: `Job ${action} successful.` });
  } catch (err) { logger.error('forceJobAction error', { err }); res.status(500).json({ error: 'Failed to perform job action.' }); }
};

exports.deleteJob = async (req, res) => {
  try {
    if (!(await tableExists('jobs'))) return res.status(404).json({ error: 'Job not found.' });
    const { jobId } = req.params;
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason is required to delete a job.' });
    const { rows } = await db.query('SELECT id, title, client_id, status FROM jobs WHERE id = $1', [jobId]);
    if (!rows.length) return res.status(404).json({ error: 'Job not found.' });
    // Only allow deletion of jobs not in in_progress or completed states to prevent data loss
    const deletableStatuses = ['published', 'cancelled', 'closed'];
    if (!deletableStatuses.includes(rows[0].status)) {
      return res.status(400).json({ error: `Cannot delete job in '${rows[0].status}' status. Only jobs in ${deletableStatuses.join(', ')} status can be deleted.` });
    }
    // Hard delete - cascades to bids, payments if FK'd with ON DELETE CASCADE; otherwise clean up first
    const { rows: deleteRows } = await db.query('DELETE FROM jobs WHERE id = $1 AND status IN ($2, $3, $4) RETURNING id', [jobId, 'published', 'cancelled', 'closed']);
    if (deleteRows.length === 0) {
      return res.status(409).json({ error: 'Job status changed during deletion - concurrent modification detected.' });
    }
    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'job_deleted',
        targetType: 'job',
        targetId: jobId,
        description: `[HARD DELETE] "${rows[0].title}" - ${reason.trim()}`,
        req,
      });
    } catch(e) {}
    res.json({ message: 'Job permanently deleted.' });
  } catch (err) {
    logger.error('deleteJob error', { err });
    res.status(500).json({ error: 'Failed to delete job.' });
  }
};

exports.getJobDetail = async (req, res) => {
  try {
    const { jobId } = req.params;
    logger.debug('getJobDetail called', { jobId });

    if (!jobId || jobId.trim() === '') {
      return res.status(400).json({ error: 'Job ID is required.' });
    }

    // Check jobs table exists
    const jobsTableExists = await tableExists('jobs');
    if (!jobsTableExists) {
      logger.warn('Jobs table does not exist');
      return res.status(404).json({ error: 'Job not found.' });
    }

    logger.debug('Fetching job from database', { jobId });
    const { rows: jobRows } = await db.query(`
      SELECT
        j.*,
        (j.metadata->>'admin_flagged') = 'true'   AS admin_flagged,
        u_c.first_name || ' ' || u_c.last_name AS client_name,
        u_c.email        AS client_email,
        u_h.id           AS helper_user_id,
        u_h.first_name || ' ' || u_h.last_name AS helper_name,
        u_h.email        AS helper_email
      FROM jobs j
      JOIN users u_c ON u_c.id = j.client_id
      LEFT JOIN users u_h ON u_h.id = j.assigned_helper_id
      WHERE j.id = $1
    `, [jobId]);

    if (!jobRows.length) {
      logger.debug('Job not found', { jobId });
      return res.status(404).json({ error: 'Job not found.' });
    }
    const job = jobRows[0];
    logger.debug('Job fetched successfully', { jobId, title: job.title });

    let bids = [];
    if (await tableExists('bids')) {
      try {
        logger.debug('Fetching bids for job', { jobId });
        const r = await db.query(`
          SELECT b.id, b.amount, b.status, b.message, b.created_at,
                 u.id AS helper_id,
                 u.first_name || ' ' || u.last_name AS helper_name,
                 u.email AS helper_email
          FROM bids b
          JOIN users u ON u.id = b.helper_id
          WHERE b.job_id = $1
          ORDER BY b.created_at ASC
        `, [jobId]);
        bids = r.rows;
        logger.debug('Bids fetched', { jobId, count: bids.length });
      } catch (bidErr) {
        logger.warn('Error fetching bids', { jobId, err: bidErr.message });
        // Continue without bids on error
      }
    }

    let payment = null;
    if (await tableExists('payments')) {
      try {
        logger.debug('Fetching payment for job', { jobId });
        const r = await db.query(`
          SELECT id, status, amount, helper_payout, platform_fee,
                 stripe_payment_intent_id, created_at
          FROM payments
          WHERE job_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `, [jobId]);
        payment = r.rows[0] || null;
        logger.debug('Payment fetched', { jobId, hasPayment: !!payment });
      } catch (paymentErr) {
        logger.warn('Error fetching payment', { jobId, err: paymentErr.message });
        // Continue without payment on error
      }
    }

    logger.debug('getJobDetail complete', { jobId });
    res.json({ job, bids, payment });
  } catch (err) {
    logger.error('getJobDetail error', {
      message: err.message || String(err),
      code: err.code,
      detail: err.detail,
      stack: err.stack,
      jobId: req.params.jobId
    });
    res.status(500).json({ error: 'Failed to fetch job detail.' });
  }
};

exports.createUser = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { first_name, last_name, email, password, role = 'customer' } = req.body;

    const ALLOWED_ROLES = ['customer', 'helper', 'broker'];
    if (!first_name?.trim()) return res.status(400).json({ error: 'first_name is required.' });
    if (!last_name?.trim())  return res.status(400).json({ error: 'last_name is required.' });
    if (!email?.trim())      return res.status(400).json({ error: 'email is required.' });
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${ALLOWED_ROLES.join(', ')}.` });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const { rows: existing } = await db.query(
      'SELECT id FROM users WHERE email = $1', [normalizedEmail]
    );
    if (existing.length) return res.status(409).json({ error: 'An account with this email already exists.' });

    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash(password, 12);

    // For accounts created via admin, mark onboarding as complete so ProtectedRoute
    // doesn't bounce them to registration flows on first login.
    // Both helpers and customers skip the self-serve wizard when created by admins.
    const isHelper = role === 'helper';
    const onboardingCompleted = true;  // Admin-created accounts are always marked complete
    const onboardingStatus    = 'onboarding_complete';  // Valid for all roles
    const membershipTier      = isHelper ? 'tier1' : null;

    const { rows } = await db.query(`
      INSERT INTO users (first_name, last_name, email, password_hash, role,
                         is_active, email_verified,
                         onboarding_completed, onboarding_status,
                         membership_tier,
                         created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, true, true,
              $6, $7,
              $8,
              NOW(), NOW())
      RETURNING id, first_name, last_name, email, role, is_active, email_verified, created_at
    `, [first_name.trim(), last_name.trim(), normalizedEmail, passwordHash, role,
        onboardingCompleted, onboardingStatus, membershipTier]);

    // For helper accounts, ensure a helper_profiles row exists so that
    // toggleListing (and any other helper-profile queries) never return 404.
    // is_listed = false keeps the helper offline by default until they
    // explicitly click "Go Online" after setting up their profile.
    if (isHelper) {
      await db.query(`
        INSERT INTO helper_profiles (user_id, tier, is_listed, created_at, updated_at)
        VALUES ($1, 'tier1', false, NOW(), NOW())
        ON CONFLICT (user_id) DO NOTHING
      `, [rows[0].id]);
    }

    try {
      await logAdminAction({
        adminId,
        action: 'user_created',
        targetType: 'user',
        targetId: rows[0].id,
        description: `Admin-created ${role} account for ${normalizedEmail}`,
        after: { role, email: normalizedEmail },
        req,
      });
    } catch(e) {}

    res.status(201).json({ user: rows[0] });
  } catch (err) {
    logger.error('createUser error', { err });
    res.status(500).json({ error: 'Failed to create user.' });
  }
};

// FINANCIAL MANAGEMENT
exports.getFinancials = async (req, res) => {
  try {
    if (!(await tableExists('platform_ledger'))) return res.json({ ledger: [], totals: {}, page: 1, limit: 25 });
    const { page = 1, limit = 25, type } = req.query;
    const offset = (page - 1) * limit;
    const params = []; let paramIdx = 1; let condition = '';
    if (type) { condition = `WHERE source_type = $${paramIdx++}`; params.push(type); }
    const { rows } = await db.query(`SELECT pl.*, u.first_name || ' ' || u.last_name AS user_name, u.email AS user_email FROM platform_ledger pl LEFT JOIN users u ON pl.user_id = u.id ${condition} ORDER BY pl.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`, [...params, limit, offset]);
    const { rows: totals } = await db.query(`SELECT SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS gross_revenue_cents, SUM(amount_cents) AS net_revenue_cents FROM platform_ledger`);
    res.json({ ledger: rows, totals: totals[0], page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { logger.error('getFinancials error', { err }); res.status(500).json({ error: 'Failed to fetch financials.' }); }
};

exports.issueManualRefund = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { reason, amount_cents } = req.body;
    if (!reason) return res.status(400).json({ error: 'Refund reason required.' });
    const refund = await issueRefund(jobId, reason, amount_cents || null);
    res.json({ message: `Refund issued successfully.`, refundId: refund.id });
  } catch (err) { logger.error('issueManualRefund error', { err }); res.status(500).json({ error: 'Refund failed.' }); }
};

exports.getPayouts = async (req, res) => {
  try {
    const { status = '', page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Map frontend tab names to DB payment statuses
    const STATUS_MAP = {
      pending:    "p.status IN ('pending','authorized')",
      processing: "p.status = 'captured'",
      completed:  "p.status = 'released'",
      failed:     "p.status IN ('failed','refunded','disputed')",
    };
    const statusClause = STATUS_MAP[status] || 'p.helper_payout > 0';
    const baseFilter   = `p.helper_payout > 0 AND (${statusClause})`;

    const { rows: payouts } = await db.query(`
      SELECT p.id, p.amount, p.platform_fee, p.helper_payout, p.status,
             p.stripe_transfer_id, p.captured_at, p.released_at, p.created_at,
             j.title AS job_title,
             u.first_name || ' ' || u.last_name AS helper_name,
             u.email AS helper_email,
             ca.stripe_account_id,
             ca.payouts_enabled
        FROM payments p
        JOIN users u ON p.payee_id = u.id
        LEFT JOIN jobs j ON p.job_id = j.id
        LEFT JOIN connect_accounts ca ON ca.user_id = u.id
       WHERE ${baseFilter}
       ORDER BY p.created_at DESC
       LIMIT $1 OFFSET $2
    `, [parseInt(limit), offset]);

    const { rows: statsRows } = await db.query(`
      SELECT
        SUM(CASE WHEN status IN ('pending','authorized') THEN helper_payout ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'captured'               THEN helper_payout ELSE 0 END) AS processing,
        SUM(CASE WHEN status = 'released'               THEN helper_payout ELSE 0 END) AS completed,
        SUM(CASE WHEN status IN ('failed','refunded','disputed') THEN helper_payout ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'released'               THEN helper_payout ELSE 0 END) AS "totalPaid"
        FROM payments WHERE helper_payout > 0
    `);

    res.json({
      payouts,
      stats: statsRows[0],
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    logger.error('getPayouts error', { err });
    res.status(500).json({ error: 'Failed to fetch payouts.' });
  }
};

exports.getRevenueSummary = async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const intervalMap = {
      '7d':  { interval: '7 days',   prev: '14 days'  },
      '30d': { interval: '30 days',  prev: '60 days'  },
      '90d': { interval: '90 days',  prev: '180 days' },
      '1y':  { interval: '1 year',   prev: '2 years'  },
    };
    const { interval, prev } = intervalMap[period] || intervalMap['30d'];

    const hasLedger = await tableExists('platform_ledger');
    if (!hasLedger) {
      return res.json({ stats: { totalRevenue: 0, subscriptionRevenue: 0, jobFeeRevenue: 0, refunds: 0, growth: 0 }, transactions: [] });
    }

    // Current period totals
    const { rows: totals } = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0)::float / 100 AS total_revenue,
        COALESCE(SUM(CASE WHEN source_type = 'subscription' AND amount_cents > 0 THEN amount_cents ELSE 0 END), 0)::float / 100 AS subscription_revenue,
        COALESCE(SUM(CASE WHEN source_type = 'job_fee' AND amount_cents > 0 THEN amount_cents ELSE 0 END), 0)::float / 100 AS job_fee_revenue,
        COALESCE(SUM(CASE WHEN amount_cents < 0 THEN ABS(amount_cents) ELSE 0 END), 0)::float / 100 AS refunds
      FROM platform_ledger
      WHERE created_at >= now() - $1::interval
    `, [interval]);

    // Previous period for growth calc
    const { rows: prevTotals } = await db.query(`
      SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0)::float / 100 AS total_revenue
      FROM platform_ledger
      WHERE created_at >= now() - $1::interval AND created_at < now() - $2::interval
    `, [prev, interval]);

    const current = totals[0].total_revenue;
    const previous = prevTotals[0].total_revenue;
    const growth = previous > 0 ? ((current - previous) / previous) * 100 : 0;

    // Recent transactions
    const { rows: transactions } = await db.query(`
      SELECT
        pl.id AS _id,
        pl.created_at AS "createdAt",
        pl.source_type AS type,
        pl.amount_cents::float / 100 AS amount,
        CASE WHEN pl.amount_cents >= 0 THEN 'completed' ELSE 'refunded' END AS status,
        u.email AS "userEmail",
        json_build_object('name', u.first_name || ' ' || u.last_name) AS user
      FROM platform_ledger pl
      LEFT JOIN users u ON pl.user_id = u.id
      WHERE pl.created_at >= now() - $1::interval
      ORDER BY pl.created_at DESC
      LIMIT 50
    `, [interval]);

    res.json({
      stats: {
        totalRevenue:        totals[0].total_revenue,
        subscriptionRevenue: totals[0].subscription_revenue,
        jobFeeRevenue:       totals[0].job_fee_revenue,
        refunds:             totals[0].refunds,
        growth:              Math.round(growth * 10) / 10,
      },
      transactions,
    });
  } catch (err) {
    logger.error('getRevenueSummary error', { err });
    res.status(500).json({ error: 'Failed to fetch revenue summary.' });
  }
};

exports.getRevenueExport = async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const intervalMap = { '7d': '7 days', '30d': '30 days', '90d': '90 days', '1y': '1 year' };
    const interval = intervalMap[period] || '30 days';

    const hasLedger = await tableExists('platform_ledger');
    if (!hasLedger) {
      res.setHeader('Content-Type', 'text/csv');
      return res.send('date,type,amount,user_email\n');
    }

    const { rows } = await db.query(`
      SELECT
        pl.created_at AS date,
        pl.source_type AS type,
        (pl.amount_cents::float / 100)::text AS amount,
        COALESCE(u.email, '') AS user_email
      FROM platform_ledger pl
      LEFT JOIN users u ON pl.user_id = u.id
      WHERE pl.created_at >= now() - $1::interval
      ORDER BY pl.created_at DESC
    `, [interval]);

    const headers = 'date,type,amount,user_email';
    const csvRows = rows.map(r =>
      [r.date, r.type, r.amount, r.user_email]
        .map(v => (String(v || '').includes(',') ? `"${String(v).replace(/"/g, '""')}"` : String(v || '')))
        .join(',')
    );
    const csv = [headers, ...csvRows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="revenue_${period}_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (err) {
    logger.error('getRevenueExport error', { err });
    res.status(500).json({ error: 'Export failed.' });
  }
};

// PLATFORM SETTINGS
exports.getSettings = async (req, res) => {
  try {
    let settings = [];
    try { const r = await db.query('SELECT * FROM platform_settings ORDER BY key ASC'); settings = r.rows; } catch(e) {}
    let flags = [];
    if (await tableExists('feature_flags')) { const r = await db.query('SELECT * FROM feature_flags ORDER BY key ASC'); flags = r.rows; }
    res.json({ settings, flags });
  } catch (err) { logger.error('getSettings error', { err }); res.status(500).json({ error: 'Failed to fetch settings.' }); }
};

exports.updateSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const adminId = req.user.id;
    const { rows: updateRows } = await db.query('UPDATE platform_settings SET value = $1, updated_by = $2, updated_at = now() WHERE key = $3 RETURNING key', [String(value), adminId, key]);
    if (updateRows.length === 0) {
      return res.status(404).json({ error: `Setting "${key}" not found.` });
    }
    res.json({ message: `Setting "${key}" updated.` });
  } catch (err) { logger.error('updateSetting error', { err }); res.status(500).json({ error: 'Failed to update setting.' }); }
};

exports.updateFeatureFlag = async (req, res) => {
  try {
    const { key } = req.params;
    const { enabled } = req.body;
    const adminId = req.user.id;
    const { rows: updateRows } = await db.query('UPDATE feature_flags SET is_enabled = $1, updated_by = $2, updated_at = now() WHERE key = $3 RETURNING key', [Boolean(enabled), adminId, key]);
    if (updateRows.length === 0) {
      return res.status(404).json({ error: `Feature flag "${key}" not found.` });
    }
    res.json({ message: `Feature flag "${key}" set to ${enabled}.` });
  } catch (err) { logger.error('updateFeatureFlag error', { err }); res.status(500).json({ error: 'Failed to update feature flag.' }); }
};

// AUDIT LOG
exports.getAuditLog = async (req, res) => {
  try {
    if (!(await tableExists('admin_audit_log'))) return res.json({ log: [], page: 1, limit: 50 });
    const { page = 1, limit = 50, admin_id, action, target_type } = req.query;
    const offset = (page - 1) * limit;
    const params = []; let paramIdx = 1; const conditions = [];
    if (admin_id) { conditions.push(`a.admin_id = $${paramIdx++}`); params.push(admin_id); }
    if (action) { conditions.push(`a.action ILIKE $${paramIdx++}`); params.push(`%${action}%`); }
    if (target_type) { conditions.push(`a.target_type = $${paramIdx++}`); params.push(target_type); }
    const wc = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(`SELECT a.*, u.first_name || ' ' || u.last_name AS admin_name, u.email AS admin_email FROM admin_audit_log a LEFT JOIN users u ON a.admin_id = u.id ${wc} ORDER BY a.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`, [...params, limit, offset]);
    res.json({ log: rows, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { logger.error('getAuditLog error', { err }); res.status(500).json({ error: 'Failed to fetch audit log.' }); }
};

// DATA EXPORT
exports.exportData = async (req, res) => {
  try {
    const { type } = req.params;
    const queries = {
      users: 'SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.is_active, u.created_at FROM users u WHERE u.role NOT IN (\'admin\',\'super_admin\') ORDER BY u.created_at DESC',
      jobs: await tableExists('jobs') ? 'SELECT j.id, j.title, j.status, j.created_at FROM jobs j ORDER BY j.created_at DESC' : null,
      revenue: await tableExists('platform_ledger') ? 'SELECT source_type, amount_cents, created_at FROM platform_ledger ORDER BY created_at DESC' : null,
      bids: await tableExists('bids') ? 'SELECT b.id, b.job_id, b.helper_id, b.amount, b.status, b.created_at FROM bids b ORDER BY b.created_at DESC LIMIT 10000' : null,
      reviews: await tableExists('reviews') ? 'SELECT r.id, r.reviewer_id, r.reviewee_id, r.rating, r.comment, r.is_public, r.created_at FROM reviews r ORDER BY r.created_at DESC LIMIT 10000' : null,
      businesses: await tableExists('businesses') ? 'SELECT b.id, b.user_id, b.business_name, b.business_type, b.is_active, b.created_at FROM businesses b ORDER BY b.created_at DESC' : null,
      disputes: await tableExists('disputes') ? 'SELECT d.id, d.job_id, d.opened_by, d.status, d.reason, d.resolution, d.created_at FROM disputes d ORDER BY d.created_at DESC' : null,
      support_tickets: await tableExists('support_tickets') ? 'SELECT t.id, t.user_id, t.subject, t.status, t.priority, t.created_at FROM support_tickets t ORDER BY t.created_at DESC' : null,
    };
    if (!queries[type]) return res.status(400).json({ error: 'Invalid or unavailable export type.' });
    const { rows } = await db.query(queries[type]);
    if (!rows.length) return res.json({ data: [], csv: '' });
    const headers = Object.keys(rows[0]).join(',');
    const csvRows = rows.map(row => Object.values(row).map(val => { if (val === null || val === undefined) return ''; const str = String(val).replace(/"/g, '""'); return str.includes(',') || str.includes('\n') ? `"${str}"` : str; }).join(','));
    const csv = [headers, ...csvRows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="oxsteed_${type}_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (err) { logger.error('exportData error', { err }); res.status(500).json({ error: 'Export failed.' }); }
};

// DELETE USER ACCOUNT — admin soft-delete with 30-day recovery window (super_admin only)
//
// Admin deletion is a SOFT delete. The account is:
//   1. Immediately locked (is_active=false, tokens revoked, sockets disconnected)
//   2. Marked with deletion_scheduled_at = NOW() + 30 days
//   3. Data is NOT removed until the background job processes it after 30 days
//   4. Admin can RESTORE the account within 30 days (see restoreUser below)
//
// Pre-deletion guards:
//   - Active jobs (open/accepted/in_progress/escrow_held): block with 409
//   - Pending payments owed by/to user: block with 409
//   - Business team members: warn in response but don't block (admin decision)
//
// Why not hard-delete immediately?
//   - Counterparty protection: helpers mid-job don't lose their job record
//   - Financial safety: Stripe PaymentIntents aren't orphaned
//   - Admin error recovery: 30 days to reverse a mistake
//   - Audit trail: full history survives the grace window
exports.deleteUser = async (req, res) => {
  const crypto = require('crypto');
  try {
    const { userId } = req.params;
    if (!isUuidParam(userId)) {
      return res.status(400).json({
        error: 'Invalid user id.',
        detail: 'The user id in the URL must be a valid UUID.',
      });
    }
    const { reason, force = false } = req.body;
    const adminId = req.user.id;

    // Probe migration-165 columns at runtime — they may not be on the live DB yet
    const [
      hasDeletionScheduled,
      hasDeletionType,
      hasDeletionReason,
      hasDeletionAdminId,
      hasWasBanned,
      hasOriginalEmailHash,
      hasIsBanned,
    ] = await Promise.all([
      columnExists('users', 'deletion_scheduled_at'),
      columnExists('users', 'deletion_type'),
      columnExists('users', 'deletion_reason'),
      columnExists('users', 'deletion_admin_id'),
      columnExists('users', 'was_banned_at_deletion'),
      columnExists('users', 'original_email_hash'),
      columnExists('users', 'is_banned'),
    ]);
    const hasMig165 = hasDeletionScheduled && hasDeletionType;

    // Build SELECT dynamically based on available columns
    const selectCols = ['id', 'first_name', 'last_name', 'email', 'role', 'deleted_at'];
    if (hasIsBanned) selectCols.push('is_banned');
    if (hasDeletionScheduled) selectCols.push('deletion_scheduled_at');

    const { rows: userRows } = await db.query(
      `SELECT ${selectCols.join(', ')} FROM users WHERE id = $1`,
      [userId],
    );
    if (!userRows.length) return res.status(404).json({ error: 'User not found.' });
    const user = userRows[0];

    if (['admin', 'super_admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Cannot delete admin accounts.' });
    }

    if (user.deleted_at) {
      return res.status(409).json({ error: 'This account has already been permanently deleted.' });
    }

    if (hasMig165 && user.deletion_scheduled_at) {
      return res.status(409).json({
        error: 'This account is already scheduled for deletion.',
        deletion_scheduled_at: user.deletion_scheduled_at,
      });
    }

    // ── Pre-deletion guards ────────────────────────────────────────────────

    // Check active jobs (correct column names: client_id / assigned_helper_id)
    const jobsExist = await tableExists('jobs');
    if (jobsExist) {
      const { rows: activeJobs } = await db.query(
        `SELECT id, title, status FROM jobs
         WHERE (client_id = $1 OR assigned_helper_id = $1)
           AND status IN ('open', 'accepted', 'in_progress', 'escrow_held', 'pending_completion')`,
        [userId]
      );
      if (activeJobs.length > 0 && !force) {
        return res.status(409).json({
          error: 'Cannot delete this account while the user has active or in-progress jobs. Resolve or reassign all jobs first, or use force=true to override.',
          activeJobs: activeJobs.map(j => ({ id: j.id, title: j.title, status: j.status })),
          canForce: true,
        });
      }
    }

    // Check pending payments
    const paymentsExist = await tableExists('payments');
    if (paymentsExist) {
      const { rows: pendingPayments } = await db.query(
        `SELECT id FROM payments
         WHERE (payer_id = $1 OR payee_id = $1)
           AND status IN ('pending', 'authorized', 'processing', 'captured')
         LIMIT 10`,
        [userId]
      );
      if (pendingPayments.length > 0 && !force) {
        return res.status(409).json({
          error: 'Cannot delete this account while the user has pending payments or uncollected earnings. Use force=true to override.',
          pendingPaymentCount: pendingPayments.length,
          canForce: true,
        });
      }
    }

    // Warn about business team members (non-blocking — admin decides)
    const { rows: teamMembers } = await db.query(
      `SELECT COUNT(*) AS count FROM businesses b
       JOIN business_members bm ON bm.business_id = b.id
       WHERE b.user_id = $1`,
      [userId]
    ).catch(() => ({ rows: [{ count: 0 }] }));
    const memberCount = parseInt(teamMembers[0]?.count || 0);

    // ── Lock the account immediately ──────────────────────────────────────

    try { await tokenRevocationService.revokeAllUserTokens(userId); } catch { /* non-fatal */ }
    try { await db.query('UPDATE sessions SET is_valid = false WHERE user_id = $1', [userId]); } catch { /* non-fatal */ }
    try { socketService.disconnectUserSockets(userId); } catch { /* non-fatal */ }

    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (hasMig165) {
      // Full soft-delete with 30-day scheduling (migration 165 columns present)
      const originalEmailHash = crypto
        .createHash('sha256')
        .update(user.email.toLowerCase().trim())
        .digest('hex');

      // Build SET clause for only columns that exist
      const sets = [
        'is_active = FALSE',
        'deleted_at = NOW()',
        'updated_at = NOW()',
      ];
      const params = [userId];
      let pi = 2;

      if (hasDeletionScheduled) { sets.push(`deletion_scheduled_at = $${pi++}`); params.push(thirtyDaysFromNow); }
      if (hasDeletionType)      { sets.push(`deletion_type = $${pi++}`); params.push('admin'); }
      if (hasDeletionReason)    { sets.push(`deletion_reason = $${pi++}`); params.push(reason || null); }
      if (hasDeletionAdminId)   { sets.push(`deletion_admin_id = $${pi++}`); params.push(adminId); }
      if (hasWasBanned)         { sets.push(`was_banned_at_deletion = $${pi++}`); params.push(user.is_banned || false); }
      if (hasOriginalEmailHash) { sets.push(`original_email_hash = $${pi++}`); params.push(originalEmailHash); }

      await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params);
    } else {
      // Fallback: migration 165 not yet applied — use only pre-existing columns
      // Still locks the account and marks deleted_at; no 30-day scheduling yet
      logger.warn('deleteUser: migration 165 columns not present — using legacy soft-delete fallback', { userId });
      await db.query(
        `UPDATE users SET is_active = FALSE, deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [userId]
      );
    }

    try {
      await logAdminAction({
        adminId,
        action: 'user_deletion_scheduled',
        targetType: 'user',
        targetId: userId,
        description: `Scheduled deletion of ${user.email}${reason ? `: ${reason}` : ''}${hasMig165 ? `. Hard delete scheduled for ${thirtyDaysFromNow.toISOString()}` : ' (migration 165 pending — 30-day window not yet active)'}.`,
        before: { email: user.email, role: user.role, name: `${user.first_name} ${user.last_name}` },
        after: { deleted_at: new Date().toISOString(), ...(hasMig165 ? { deletion_scheduled_at: thirtyDaysFromNow.toISOString() } : {}) },
        req,
      });
    } catch { /* audit non-fatal */ }

    res.json({
      message: hasMig165
        ? `Account for ${user.email} has been locked and scheduled for permanent deletion in 30 days.`
        : `Account for ${user.email} has been locked and marked for deletion.`,
      ...(hasMig165 ? {
        deletion_scheduled_at: thirtyDaysFromNow.toISOString(),
        can_restore_until: thirtyDaysFromNow.toISOString(),
      } : {}),
      warnings: [
        ...(memberCount > 0 ? [`This user has ${memberCount} business team member(s). Their memberships will be cascade-deleted when the account is permanently removed.`] : []),
        ...(!hasMig165 ? ['Migration 165 is not yet applied. The 30-day recovery window will become active after the next deployment.'] : []),
      ],
    });
  } catch (err) {
    logger.error('deleteUser error', { err });

    // Map known PostgreSQL / application errors to specific messages
    const pgCode = err.code;
    let userMessage = 'Failed to delete user.';
    let detail = null;

    if (pgCode === '22P02') {
      userMessage = 'Invalid data type in the request or database.';
      detail =
        'PostgreSQL rejected a value (often an invalid UUID in the URL, or a type mismatch in a query parameter). '
        + 'Verify the user id is a valid UUID. If the id is correct, check server logs for the underlying query error.';
    } else if (pgCode === '23503') {
      userMessage = 'Cannot delete this account because it is still referenced by another record.';
      detail = 'A foreign-key constraint blocked the deletion. Check for pending payments, escrow holds, or other linked records.';
    } else if (pgCode === '23505') {
      userMessage = 'A conflict occurred while updating the account status.';
      detail = 'Concurrent modification detected. Reload the page and try again.';
    } else if (pgCode === '42703') {
      userMessage = 'Database schema mismatch — a required column does not exist.';
      detail = `Column: ${err.message}. A migration has not been applied. Redeploy and retry.`;
    } else if (pgCode === '42P01') {
      userMessage = 'A required database table does not exist.';
      detail = `Table: ${err.message}. A migration has not been applied. Redeploy and retry.`;
    } else if (err.message?.includes('connect ECONNREFUSED') || err.message?.includes('connection')) {
      userMessage = 'Database connection failed.';
      detail = 'The server could not reach the database. Check the DATABASE_URL and database server status.';
    } else if (err.message) {
      detail = err.message;
    }

    res.status(500).json({ error: userMessage, detail, code: pgCode || null });
  }
};

// RESTORE USER ACCOUNT — cancel a pending admin deletion (super_admin only)
// Only works within the 30-day window (deletion_scheduled_at has not passed AND
// the actual hard-delete job has not run yet).
exports.restoreUser = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isUuidParam(userId)) {
      return res.status(400).json({
        error: 'Invalid user id.',
        detail: 'The user id in the URL must be a valid UUID.',
      });
    }
    const { reason } = req.body;
    const adminId = req.user.id;

    const hasMig165 = await columnExists('users', 'deletion_scheduled_at');

    if (!hasMig165) {
      return res.status(409).json({
        error: 'The restore feature requires migration 165 to be applied. The database has not been updated yet.',
      });
    }

    const { rows: userRows } = await db.query(
      `SELECT id, first_name, last_name, email, role,
              deletion_scheduled_at, deleted_at, deletion_type
       FROM users WHERE id = $1`,
      [userId]
    );
    if (!userRows.length) return res.status(404).json({ error: 'User not found.' });
    const user = userRows[0];

    // Can only restore admin-type deletions
    if (user.deletion_type !== 'admin') {
      return res.status(409).json({
        error: 'This account was self-deleted by the user. Admin restoration is not permitted for self-deletes. If you believe this account should be reopened, contact the legal team.',
      });
    }

    if (!user.deleted_at || !user.deletion_scheduled_at) {
      return res.status(409).json({ error: 'This account is not currently scheduled for deletion.' });
    }

    // Check the 30-day window has not expired
    const now = new Date();
    const scheduledFor = new Date(user.deletion_scheduled_at);
    if (now >= scheduledFor) {
      return res.status(409).json({
        error: 'The 30-day recovery window has expired. This account has been permanently deleted and cannot be restored.',
      });
    }

    // Restore the account
    await db.query(
      `UPDATE users SET
        is_active             = TRUE,
        deleted_at            = NULL,
        deletion_scheduled_at = NULL,
        deletion_type         = NULL,
        deletion_reason       = NULL,
        deletion_admin_id     = NULL,
        updated_at            = NOW()
       WHERE id = $1`,
      [userId]
    );

    try {
      await logAdminAction({
        adminId,
        action: 'user_restoration',
        targetType: 'user',
        targetId: userId,
        description: `Restored account for ${user.email}${reason ? `. Reason: ${reason}` : ''}`,
        before: { deleted_at: user.deleted_at, deletion_scheduled_at: user.deletion_scheduled_at },
        after: { deleted_at: null, is_active: true },
        req,
      });
    } catch { /* non-fatal */ }

    res.json({
      message: `Account for ${user.email} has been restored. The user may log in again.`,
    });
  } catch (err) {
    logger.error('restoreUser error', { err });
    const pgCode = err.code;
    let userMessage = 'Failed to restore user account.';
    let detail = null;
    if (pgCode === '42703') {
      userMessage = 'Database schema mismatch — a required column does not exist.';
      detail = 'Migration 165 has not been applied. Redeploy and retry.';
    } else if (pgCode === '23505') {
      userMessage = 'A conflict occurred while restoring the account.';
      detail = 'Concurrent modification detected. Reload the page and try again.';
    } else if (err.message) {
      detail = err.message;
    }
    res.status(500).json({ error: userMessage, detail, code: pgCode || null });
  }
};

// ─── Admin Account Management (super_admin only) ───────────────

// GET /admin/super/admin-accounts
exports.getAdminAccounts = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        u.id, u.first_name, u.last_name, u.email, u.role,
        u.is_active, u.created_at, u.last_login_at,
        (SELECT COUNT(*) FROM admin_audit_log WHERE admin_id = u.id) AS action_count,
        (SELECT MAX(created_at) FROM admin_audit_log WHERE admin_id = u.id) AS last_action_at
      FROM users u
      WHERE u.role IN ('admin', 'super_admin')
      ORDER BY u.role DESC, u.created_at ASC
    `);
    res.json({ admins: rows });
  } catch (err) {
    logger.error('getAdminAccounts error', { err });
    res.status(500).json({ error: 'Failed to fetch admin accounts.' });
  }
};

// POST /admin/super/admin-accounts  - create a new admin account
exports.createAdminAccount = async (req, res) => {
  try {
    const bcrypt = require('bcrypt');
    const { email, first_name, last_name, role = 'admin', temporary_password } = req.body;
    if (!email || !first_name || !last_name || !temporary_password) {
      return res.status(400).json({ error: 'email, first_name, last_name, and temporary_password are required.' });
    }
    if (!['admin', 'super_admin'].includes(role)) {
      return res.status(400).json({ error: 'role must be admin or super_admin.' });
    }
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super_admin can create another super_admin.' });
    }
    if (temporary_password.length < 12) {
      return res.status(400).json({ error: 'Temporary password must be at least 12 characters.' });
    }
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: 'Email already in use.' });

    const passwordHash = await bcrypt.hash(temporary_password, 12);
    const { rows } = await db.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, role, is_active, email_verified)
      VALUES ($1, $2, $3, $4, $5, true, true)
      RETURNING id, email, first_name, last_name, role, is_active, created_at
    `, [email.toLowerCase(), passwordHash, first_name.trim(), last_name.trim(), role]);

    await logAdminAction({
      adminId: req.user.id,
      action: 'admin_account_created',
      targetType: 'user',
      targetId: rows[0].id,
      description: `Created ${role} account for ${email}`,
      after: { email, role },
      req,
    });

    res.status(201).json({ admin: rows[0], message: 'Admin account created. They must change their password on first login.' });
  } catch (err) {
    logger.error('createAdminAccount error', { err });
    res.status(500).json({ error: 'Failed to create admin account.' });
  }
};

// PUT /admin/super/admin-accounts/:id/status  - enable or disable an admin
exports.toggleAdminAccountStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    // Cannot disable yourself
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot disable your own account.' });
    const { rows } = await db.query('SELECT id, role, is_active, email FROM users WHERE id = $1 AND role IN (\'admin\',\'super_admin\')', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Admin account not found.' });
    // Only super_admin can disable another super_admin
    if (rows[0].role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Cannot change status of a super_admin account.' });
    }
    const newStatus = !rows[0].is_active;
    const { rows: updateRows } = await db.query('UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 AND is_active = $3 RETURNING id', [newStatus, id, rows[0].is_active]);
    if (updateRows.length === 0) {
      return res.status(409).json({ error: 'Admin status changed during update - concurrent modification detected.' });
    }
    // Invalidate all sessions for this admin and kick any live WebSocket connection
    await db.query('UPDATE sessions SET is_valid = false WHERE user_id = $1', [id]);
    if (!newStatus) socketService.broadcastToUser(id, 'force_logout', { reason: 'account_disabled' });
    await logAdminAction({
      adminId: req.user.id,
      action: newStatus ? 'admin_account_enabled' : 'admin_account_disabled',
      targetType: 'user',
      targetId: id,
      description: reason || null,
      before: { is_active: rows[0].is_active, email: rows[0].email },
      after: { is_active: newStatus },
      req,
    });
    res.json({ message: `Admin account ${newStatus ? 'enabled' : 'disabled'}.`, is_active: newStatus });
  } catch (err) {
    logger.error('toggleAdminAccountStatus error', { err });
    res.status(500).json({ error: 'Failed to update admin account status.' });
  }
};

// GET /admin/super/admin-activity/:adminId  - audit log filtered to one admin
exports.getAdminActivity = async (req, res) => {
  try {
    const { adminId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(parseInt(limit) || 50, 100);
    const { rows } = await db.query(`
      SELECT
        al.*,
        u.first_name || ' ' || u.last_name AS admin_name,
        u.email AS admin_email,
        u.role AS admin_role
      FROM admin_audit_log al
      JOIN users u ON al.admin_id = u.id
      WHERE al.admin_id = $1
      ORDER BY al.created_at DESC
      LIMIT $2 OFFSET $3
    `, [adminId, Math.min(parseInt(limit) || 50, 100), offset]);
    const { rows: countRows } = await db.query('SELECT COUNT(*) FROM admin_audit_log WHERE admin_id = $1', [adminId]);
    res.json({ log: rows, total: parseInt(countRows[0].count), page: parseInt(page) });
  } catch (err) {
    logger.error('getAdminActivity error', { err });
    res.status(500).json({ error: 'Failed to fetch admin activity.' });
  }
};

// POST /admin/super/force-logout/:userId  - invalidate all sessions for any user
exports.forceLogout = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const { rows } = await db.query('SELECT id, email, role FROM users WHERE id = $1', [userId]);
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    await db.query('UPDATE sessions SET is_valid = false WHERE user_id = $1', [userId]);
    await logAdminAction({
      adminId: req.user.id,
      action: 'force_logout',
      targetType: 'user',
      targetId: userId,
      description: reason || 'Sessions invalidated by super admin',
      req,
    });
    res.json({ message: `All sessions for ${rows[0].email} have been invalidated.` });
  } catch (err) {
    logger.error('forceLogout error', { err });
    res.status(500).json({ error: 'Failed to force logout.' });
  }
};

// POST /admin/super/users/:userId/message  - send a direct message to any user
// Creates or re-uses a job-less conversation between the admin and the target user.
exports.sendAdminMessage = async (req, res) => {
  const socketService = require('../services/socketService');
  try {
    const { userId } = req.params;
    const { content } = req.body;

    if (!content?.trim()) {
      return res.status(400).json({ error: 'Message content is required.' });
    }
    if (content.length > 4000) {
      return res.status(400).json({ error: 'Message must be 4000 characters or fewer.' });
    }

    // Verify target user exists and is not an admin
    const { rows: targetRows } = await db.query(
      `SELECT id, first_name, last_name, email, role FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    if (!targetRows.length) return res.status(404).json({ error: 'User not found.' });
    if (['admin', 'super_admin'].includes(targetRows[0].role)) {
      return res.status(400).json({ error: 'Cannot send messages to admin accounts.' });
    }

    const adminId  = req.user.id;
    const targetId = userId;

    // All conversation + message writes in one transaction to prevent
    // orphaned conversations on failure and race-condition duplicates.
    const client = await db.connect();
    let conversationId, msgRows;
    try {
      await client.query('BEGIN');

      // Find-or-create the admin→user conversation.
      // ON CONFLICT DO NOTHING cannot be used here because PostgreSQL's
      // UNIQUE constraint treats NULL job_id values as distinct, so every
      // INSERT would succeed and create a new conversation.
      // Instead, lock any existing row first (FOR UPDATE serializes
      // concurrent callers), then insert only if none was found.
      const { rows: existing } = await client.query(`
        SELECT id FROM conversations
        WHERE job_id IS NULL AND customer_id = $1 AND helper_id = $2
        LIMIT 1
        FOR UPDATE
      `, [adminId, targetId]);

      if (existing.length) {
        conversationId = existing[0].id;
      } else {
        const { rows: newConv } = await client.query(`
          INSERT INTO conversations (customer_id, helper_id, job_id, status)
          VALUES ($1, $2, NULL, 'active')
          RETURNING id
        `, [adminId, targetId]);
        conversationId = newConv[0].id;
      }

      // Insert the message
      const result = await client.query(`
        INSERT INTO messages (conversation_id, sender_id, content, message_type)
        VALUES ($1, $2, $3, 'system')
        RETURNING id, created_at
      `, [conversationId, adminId, content.trim()]);
      msgRows = result.rows;

      // Update conversation timestamp
      await client.query(
        `UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [conversationId]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Push real-time event to target user
    socketService.broadcastToUser(targetId, 'new_message', {
      conversation_id: conversationId,
      message: {
        id:              msgRows[0].id,
        conversation_id: conversationId,
        sender_id:       adminId,
        content:         content.trim(),
        message_type:    'system',
        is_read:         false,
        created_at:      msgRows[0].created_at,
      },
      sender: {
        id:         req.user.id,
        first_name: req.user.first_name,
        last_name:  req.user.last_name,
        role:       req.user.role,
      },
    });

    await logAdminAction({
      adminId: req.user.id,
      action: 'admin_message_sent',
      targetType: 'user',
      targetId,
      description: `Admin message sent to ${targetRows[0].email}`,
      after: { conversation_id: conversationId, message_id: msgRows[0].id, preview: content.slice(0, 100) },
      req,
    });

    res.status(201).json({
      conversation_id: conversationId,
      message_id:      msgRows[0].id,
      created_at:      msgRows[0].created_at,
    });
  } catch (err) {
    logger.error('sendAdminMessage error', { err });
    res.status(500).json({ error: 'Failed to send message.' });
  }
};

// POST /admin/users/:userId/password - super-admin sets a new password for any user
exports.setUserPasswordBySuperAdmin = async (req, res) => {
  try {
    const { userId } = req.params;
    const { password } = req.body || {};
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'password is required.' });
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
    }

    const { rows } = await db.query('SELECT id, email FROM users WHERE id = $1', [userId]);
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash(password, 12);
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, userId],
    );

    try {
      await tokenRevocationService.revokeAllUserTokens(userId);
    } catch (e) {
      /* non-fatal */
    }
    await db.query('UPDATE sessions SET is_valid = false WHERE user_id = $1', [userId]);
    socketService.disconnectUserSockets(userId);

    await logUserAction({
      adminId: req.user.id,
      targetUserId: userId,
      actionType: 'edit_password',
      fieldName: 'password',
      oldValue: '[REDACTED]',
      newValue: '[HASHED]',
      ipAddress: req.ip || null,
    });

    await logAdminAction({
      adminId: req.user.id,
      action: 'super_admin_set_password',
      targetType: 'user',
      targetId: userId,
      description: `Password set by super admin for ${rows[0].email}`,
      req,
    });

    res.json({
      message:
        'Password updated successfully. All sessions for this user were signed out.',
    });
  } catch (err) {
    logger.error('setUserPasswordBySuperAdmin error', { err });
    res.status(500).json({ error: 'Failed to update password.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// IMPERSONATION  (super-admin only)
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const jwt    = require('jsonwebtoken');

/**
 * POST /admin/users/:userId/impersonate
 * Generates a short-lived (30 min) impersonation JWT for the target user.
 * The token is returned to the admin client which opens it in a new tab.
 * Every session is logged in user_impersonation_log.
 */
exports.impersonateUser = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { userId } = req.params;

    if (adminId === userId) {
      return res.status(400).json({ error: 'Cannot impersonate yourself.' });
    }

    const { rows } = await db.query(
      `SELECT id, first_name, last_name, email, role FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    const target = rows[0];

    // Prevent impersonating other admins
    if (['admin', 'super_admin'].includes(target.role)) {
      return res.status(403).json({ error: 'Cannot impersonate admin accounts.' });
    }

    const jti = crypto.randomUUID();
    const impersonationToken = jwt.sign(
      {
        id:              target.id,
        email:           target.email,
        role:            target.role,
        impersonation:   true,
        impersonated_by: adminId,
        jti,
      },
      process.env.JWT_SECRET,
      { expiresIn: '30m', algorithm: 'HS256' }
    );

    // Log the session
    await db.query(
      `INSERT INTO user_impersonation_log (admin_id, target_user_id, token_jti, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, userId, jti, req.ip || null, req.headers['user-agent'] || null]
    );

    await logAdminAction({
      adminId,
      action:      'user_impersonation_started',
      targetType:  'user',
      targetId:    userId,
      description: `Admin impersonated ${target.first_name} ${target.last_name} (${target.email})`,
      req,
    });

    logger.info('Admin impersonation started', { adminId, targetUserId: userId, jti });

    res.json({
      impersonationToken,
      userId,
      user: {
        id:         target.id,
        first_name: target.first_name,
        last_name:  target.last_name,
        email:      target.email,
        role:       target.role,
      },
    });
  } catch (err) {
    logger.error('impersonateUser error', { err });
    res.status(500).json({ error: 'Failed to create impersonation session.' });
  }
};

/**
 * POST /admin/users/:userId/impersonate/end
 * Marks the impersonation session ended (by jti).
 */
exports.endImpersonation = async (req, res) => {
  try {
    const { jti } = req.body;
    if (!jti) return res.status(400).json({ error: 'jti required.' });

    await db.query(
      `UPDATE user_impersonation_log SET ended_at = NOW() WHERE token_jti = $1 AND ended_at IS NULL`,
      [jti]
    );

    res.json({ message: 'Impersonation session ended.' });
  } catch (err) {
    logger.error('endImpersonation error', { err });
    res.status(500).json({ error: 'Failed to end impersonation session.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY LOG
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /admin/users/:userId/activity?page=1&limit=50
 * Returns a merged, time-sorted list of:
 *   - admin_user_action_log  (admin edits to this account)
 *   - admin_audit_log        (general admin actions targeting this user)
 *   - user_login_history     (login attempts)
 *   - user_impersonation_log (impersonation sessions)
 */
exports.getUserActivityLog = async (req, res) => {
  try {
    const { userId } = req.params;
    const limit  = Math.min(parseInt(req.query.limit  || '100', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);

    const hasActionLog    = await tableExists('admin_user_action_log');
    const hasAuditLog     = await tableExists('admin_audit_log');
    const hasLoginHistory = await tableExists('user_login_history');
    const hasImpLog       = await tableExists('user_impersonation_log');

    const parts = [];

    if (hasActionLog) {
      parts.push(`
        SELECT
          l.id::TEXT AS id,
          'admin_action' AS source,
          l.action_type AS event_type,
          l.field_name,
          l.old_value,
          l.new_value,
          l.notes,
          l.ip_address::TEXT AS ip_address,
          l.created_at,
          u.first_name || ' ' || u.last_name AS actor_name,
          u.email AS actor_email,
          u.role  AS actor_role
        FROM admin_user_action_log l
        JOIN users u ON u.id = l.admin_id
        WHERE l.target_user_id = $1
      `);
    }

    if (hasAuditLog) {
      parts.push(`
        SELECT
          a.id::TEXT AS id,
          'audit_log'   AS source,
          a.action      AS event_type,
          NULL          AS field_name,
          NULL          AS old_value,
          a.description AS new_value,
          NULL          AS notes,
          a.ip_address::TEXT AS ip_address,
          a.created_at,
          u.first_name || ' ' || u.last_name AS actor_name,
          u.email AS actor_email,
          u.role  AS actor_role
        FROM admin_audit_log a
        JOIN users u ON u.id = a.admin_id
        WHERE a.target_id = $1
      `);
    }

    if (hasLoginHistory) {
      parts.push(`
        SELECT
          h.id::TEXT AS id,
          'login'         AS source,
          CASE WHEN h.success THEN 'user_login' ELSE 'login_failed' END AS event_type,
          NULL            AS field_name,
          NULL            AS old_value,
          h.failure_reason AS new_value,
          NULL            AS notes,
          h.ip_address::TEXT AS ip_address,
          h.login_at      AS created_at,
          NULL            AS actor_name,
          NULL            AS actor_email,
          'system'        AS actor_role
        FROM user_login_history h
        WHERE h.user_id = $1
      `);
    }

    if (hasImpLog) {
      parts.push(`
        SELECT
          l.id::TEXT AS id,
          'impersonation'  AS source,
          CASE WHEN l.ended_at IS NULL THEN 'impersonation_started' ELSE 'impersonation_ended' END AS event_type,
          NULL             AS field_name,
          NULL             AS old_value,
          NULL             AS new_value,
          l.notes          AS notes,
          l.ip_address::TEXT AS ip_address,
          l.started_at     AS created_at,
          u.first_name || ' ' || u.last_name AS actor_name,
          u.email          AS actor_email,
          u.role           AS actor_role
        FROM user_impersonation_log l
        JOIN users u ON u.id = l.admin_id
        WHERE l.target_user_id = $1
      `);
    }

    if (!parts.length) {
      return res.json({ events: [], total: 0 });
    }

    const unionSql = `
      SELECT * FROM (
        ${parts.join('\n UNION ALL \n')}
      ) combined
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const { rows } = await db.query(unionSql, [userId, limit, offset]);

    // Count total (without pagination)
    const countSql = `SELECT COUNT(*) AS total FROM (${parts.join('\n UNION ALL \n')}) counted`;
    const { rows: countRows } = await db.query(countSql, [userId]);

    res.json({
      events: rows,
      total:  parseInt(countRows[0]?.total || '0', 10),
    });
  } catch (err) {
    logger.error('getUserActivityLog error', { err });
    res.status(500).json({ error: 'Failed to fetch activity log.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN NOTES
// ─────────────────────────────────────────────────────────────────────────────

/** GET /admin/users/:userId/notes */
exports.getUserNotes = async (req, res) => {
  try {
    const { userId } = req.params;
    const hasTable = await tableExists('admin_user_notes');
    if (!hasTable) return res.json({ notes: [] });

    const { rows } = await db.query(
      `SELECT n.id, n.note_text, n.created_at, n.updated_at,
              u.first_name || ' ' || u.last_name AS author_name,
              u.email AS author_email, u.role AS author_role
       FROM admin_user_notes n
       JOIN users u ON u.id = n.admin_id
       WHERE n.target_user_id = $1
       ORDER BY n.created_at DESC`,
      [userId]
    );
    res.json({ notes: rows });
  } catch (err) {
    logger.error('getUserNotes error', { err });
    res.status(500).json({ error: 'Failed to fetch notes.' });
  }
};

/** POST /admin/users/:userId/notes  Body: { note_text } */
exports.addUserNote = async (req, res) => {
  try {
    const { userId } = req.params;
    const { note_text } = req.body;
    if (!note_text?.trim()) return res.status(400).json({ error: 'note_text is required.' });
    if (note_text.length > 4000) return res.status(400).json({ error: 'Note too long (max 4000 chars).' });

    const { rows } = await db.query(
      `INSERT INTO admin_user_notes (target_user_id, admin_id, note_text)
       VALUES ($1, $2, $3)
       RETURNING id, note_text, created_at, updated_at`,
      [userId, req.user.id, note_text.trim()]
    );

    res.status(201).json({ note: rows[0] });
  } catch (err) {
    logger.error('addUserNote error', { err });
    res.status(500).json({ error: 'Failed to add note.' });
  }
};

/** PUT /admin/users/:userId/notes/:noteId  Body: { note_text } */
exports.updateUserNote = async (req, res) => {
  try {
    const { userId, noteId } = req.params;
    const { note_text } = req.body;
    if (!note_text?.trim()) return res.status(400).json({ error: 'note_text is required.' });

    const { rows } = await db.query(
      `UPDATE admin_user_notes
       SET note_text = $1, updated_at = NOW()
       WHERE id = $2 AND target_user_id = $3 AND admin_id = $4
       RETURNING id, note_text, updated_at`,
      [note_text.trim(), noteId, userId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Note not found or not owned by you.' });
    res.json({ note: rows[0] });
  } catch (err) {
    logger.error('updateUserNote error', { err });
    res.status(500).json({ error: 'Failed to update note.' });
  }
};

/** DELETE /admin/users/:userId/notes/:noteId */
exports.deleteUserNote = async (req, res) => {
  try {
    const { userId, noteId } = req.params;
    // Super-admins can delete any note; regular admins only their own
    const isSuper = req.user.role === 'super_admin';
    const ownerClause = isSuper ? '' : 'AND admin_id = $3';
    const params      = isSuper ? [noteId, userId] : [noteId, userId, req.user.id];

    const { rowCount } = await db.query(
      `DELETE FROM admin_user_notes WHERE id = $1 AND target_user_id = $2 ${ownerClause}`,
      params
    );
    if (!rowCount) return res.status(404).json({ error: 'Note not found.' });
    res.json({ message: 'Note deleted.' });
  } catch (err) {
    logger.error('deleteUserNote error', { err });
    res.status(500).json({ error: 'Failed to delete note.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GRANULAR ACCOUNT STATUS CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /admin/users/:userId/suspend
 * Body: { reason, days }  — days=0 means indefinite
 */
exports.suspendUser = async (req, res) => {
  try {
    const adminId        = req.user.id;
    const { userId }     = req.params;
    const { reason = '', days = 0 } = req.body;
    if (!reason.trim()) return res.status(400).json({ error: 'Suspension reason is required.' });

    const { rows: existing } = await db.query('SELECT id, email, first_name FROM users WHERE id = $1', [userId]);
    if (!existing.length) return res.status(404).json({ error: 'User not found.' });

    const suspendedUntil = days > 0 ? new Date(Date.now() + days * 86400000) : null;

    await db.query(
      `UPDATE users
       SET is_suspended = TRUE,
           is_active    = FALSE,
           suspended_until   = $1,
           suspension_reason = $2,
           suspended_by      = $3,
           updated_at        = NOW()
       WHERE id = $4`,
      [suspendedUntil, reason.trim(), adminId, userId]
    );

    // Force-logout the user
    try { socketService.disconnectUserSockets(userId); } catch (_) {}

    await logUserAction({ adminId, targetUserId: userId, actionType: 'account_suspended', notes: reason.trim(), ipAddress: req.ip });
    await logAdminAction({ adminId, action: 'user_suspended', targetType: 'user', targetId: userId, description: reason.trim(), req });

    res.json({
      message:         `User suspended ${days > 0 ? `for ${days} day(s)` : 'indefinitely'}.`,
      suspended_until: suspendedUntil,
    });
  } catch (err) {
    logger.error('suspendUser error', { err });
    res.status(500).json({ error: 'Failed to suspend user.' });
  }
};

/**
 * POST /admin/users/:userId/restrict
 * Body: { reason }  — user can still log in but cannot post jobs/bids
 */
exports.restrictUser = async (req, res) => {
  try {
    const adminId    = req.user.id;
    const { userId } = req.params;
    const { reason = '' } = req.body;
    if (!reason.trim()) return res.status(400).json({ error: 'Restriction reason is required.' });

    const { rows } = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    await db.query(
      `UPDATE users
       SET is_restricted      = TRUE,
           restriction_reason = $1,
           restricted_by      = $2,
           updated_at         = NOW()
       WHERE id = $3`,
      [reason.trim(), adminId, userId]
    );

    await logUserAction({ adminId, targetUserId: userId, actionType: 'account_restricted', notes: reason.trim(), ipAddress: req.ip });
    await logAdminAction({ adminId, action: 'user_restricted', targetType: 'user', targetId: userId, description: reason.trim(), req });

    res.json({ message: 'User account restricted.' });
  } catch (err) {
    logger.error('restrictUser error', { err });
    res.status(500).json({ error: 'Failed to restrict user.' });
  }
};

/**
 * POST /admin/users/:userId/warn
 * Body: { reason }  — increments warning_count and sends an in-app message
 */
exports.warnUser = async (req, res) => {
  try {
    const adminId    = req.user.id;
    const { userId } = req.params;
    const { reason = '' } = req.body;
    if (!reason.trim()) return res.status(400).json({ error: 'Warning reason is required.' });

    const { rows } = await db.query(
      `UPDATE users SET warning_count = COALESCE(warning_count, 0) + 1, updated_at = NOW()
       WHERE id = $1 RETURNING warning_count, email, first_name`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    // Send in-app notification
    try {
      const { sendNotification } = require('../services/notificationService');
      await sendNotification({
        userId,
        type:    'admin_warning',
        title:   'Official Warning from OxSteed',
        message: reason.trim(),
        adminId,
      });
    } catch (_) {}

    await logUserAction({ adminId, targetUserId: userId, actionType: 'account_warned', notes: reason.trim(), ipAddress: req.ip });
    await logAdminAction({ adminId, action: 'user_warned', targetType: 'user', targetId: userId, description: reason.trim(), req });

    res.json({ message: `Warning issued. User now has ${rows[0].warning_count} warning(s).`, warning_count: rows[0].warning_count });
  } catch (err) {
    logger.error('warnUser error', { err });
    res.status(500).json({ error: 'Failed to issue warning.' });
  }
};

/**
 * POST /admin/users/:userId/reactivate
 * Lifts any suspension or restriction; can also unban.
 */
exports.reactivateUser = async (req, res) => {
  try {
    const adminId    = req.user.id;
    const { userId } = req.params;
    const { notes = '' } = req.body;

    const { rows } = await db.query(
      `UPDATE users
       SET is_suspended      = FALSE,
           suspended_until   = NULL,
           suspension_reason = NULL,
           suspended_by      = NULL,
           is_restricted     = FALSE,
           restriction_reason= NULL,
           restricted_by     = NULL,
           is_active         = TRUE,
           is_banned         = FALSE,
           ban_reason        = NULL,
           updated_at        = NOW()
       WHERE id = $1
       RETURNING id, email, first_name`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    await logUserAction({ adminId, targetUserId: userId, actionType: 'account_reactivated', notes: notes.trim() || null, ipAddress: req.ip });
    await logAdminAction({ adminId, action: 'user_reactivated', targetType: 'user', targetId: userId, description: notes.trim() || 'Account reactivated by admin', req });

    res.json({ message: 'User account fully reactivated.' });
  } catch (err) {
    logger.error('reactivateUser error', { err });
    res.status(500).json({ error: 'Failed to reactivate user.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXTENDED PROFILE EDITING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PUT /admin/users/:userId/profile
 * Body: { email, phone, bio, city, state, country }
 * Logs each changed field individually to admin_user_action_log.
 */
exports.updateUserProfile = async (req, res) => {
  try {
    const adminId    = req.user.id;
    const { userId } = req.params;
    const allowed    = ['email', 'phone', 'bio', 'city', 'state', 'country'];
    const updates    = {};

    for (const field of allowed) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    // Validate email uniqueness if changing
    if (updates.email) {
      const { rows } = await db.query(
        'SELECT id FROM users WHERE email = $1 AND id <> $2',
        [updates.email, userId]
      );
      if (rows.length) return res.status(409).json({ error: 'Email already in use by another account.' });
    }

    const { rows: before } = await db.query(`SELECT ${allowed.join(',')} FROM users WHERE id = $1`, [userId]);
    if (!before.length) return res.status(404).json({ error: 'User not found.' });

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`);
    setClauses.push(`updated_at = NOW()`);
    const vals = [...Object.values(updates), userId];

    await db.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${vals.length}`,
      vals
    );

    // Log each changed field
    for (const field of Object.keys(updates)) {
      const oldVal = String(before[0][field] ?? '');
      const newVal = String(updates[field] ?? '');
      if (oldVal !== newVal) {
        await logUserAction({
          adminId,
          targetUserId: userId,
          actionType:  'edit_profile_field',
          fieldName:    field,
          oldValue:     field === 'email' ? '[REDACTED]' : oldVal,
          newValue:     field === 'email' ? '[REDACTED]' : newVal,
          ipAddress:    req.ip,
        });
      }
    }

    await logAdminAction({ adminId, action: 'user_profile_updated', targetType: 'user', targetId: userId, req });

    res.json({ message: 'Profile updated successfully.', updated: Object.keys(updates) });
  } catch (err) {
    logger.error('updateUserProfile error', { err });
    res.status(500).json({ error: 'Failed to update profile.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORT TICKETS FOR USER
// ─────────────────────────────────────────────────────────────────────────────

/** GET /admin/users/:userId/support-tickets */
exports.getUserSupportTickets = async (req, res) => {
  try {
    const { userId } = req.params;
    const hasTable   = await tableExists('support_tickets');
    if (!hasTable) return res.json({ tickets: [] });

    const { rows } = await db.query(
      `SELECT id, ticket_number, title, status, priority, category,
              created_at, updated_at, resolved_at
       FROM support_tickets
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );
    res.json({ tickets: rows });
  } catch (err) {
    logger.error('getUserSupportTickets error', { err });
    res.status(500).json({ error: 'Failed to fetch support tickets.' });
  }
};
