const db = require('../db');
const { tableExists, columnExists, userIdEq, ACTIVE_JOB_STATUS_SQL_IN } = require('../utils/schemaProbe');
const { logAdminAction, logUserAction } = require('../services/auditService');
const { processPaymentRefund } = require('../services/paymentRefundService');
const { sendNotification } = require('../services/notificationService');
const logger = require('../utils/logger');
const socketService = require('../services/socketService');
const tokenRevocationService = require('../services/tokenRevocationService');
const { withTransaction } = require('../utils/transaction');
const { enqueueMessageNotification } = require('../services/messageNotificationService');
const { parseBoundedPagination } = require('../utils/pagination');
const { cancelJobTransaction, finalizeJobCancellation } = require('../services/jobCancellationService');
const AppError = require('../utils/appError');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AI_BOOKING_PLACEHOLDER_USER_ID = '00000000-0000-4000-8000-000000000001';
const INTERNAL_EMAIL_SUFFIX = '@oxsteed.internal';

// ── Revenue reporting helpers (RV1a) ─────────────────────────────────
// platform_ledger rows carry their own currency. Revenue math must never sum
// mixed currencies, must classify by source event type (not amount sign),
// and must not divide zero-decimal currencies (JPY, KRW, ...) by 100.
const REVENUE_SOURCE_TYPES = ['job_fee', 'subscription', 'protection_fee', 'broker_fee'];
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);
const REVENUE_EXPORT_ROW_LIMIT = 10000;

function revenueDivisor(currency) {
  return ZERO_DECIMAL_CURRENCIES.has(String(currency || '').toLowerCase()) ? 1 : 100;
}

function parseRevenueCurrency(query) {
  const currency = String(query && query.currency ? query.currency : 'usd').toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) {
    return { error: 'Invalid currency. Use a 3-letter ISO code.' };
  }
  return { currency };
}

function revenueCsvEscape(val) {
  if (val === null || val === undefined) return '';
  let s = String(val);
  // Keep exported values inert when opened in spreadsheet software.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const BOOLEAN_SETTING_KEYS = new Set([
  'maintenance_mode',
  'new_user_registrations',
  'require_id_verification',
]);

const NUMERIC_SETTING_LIMITS = {
  platform_fee_starter: [0, 1],
  platform_fee_pro: [0, 1],
  platform_fee_elite: [0, 1],
  platform_fee_broker: [0, 1],
  broker_cut_rate: [0, 1],
  max_job_budget: [0.01, 1000000],
  bid_expiry_hours: [1, 720],
  // Reconciled with migration 591: a zero escrow delay (immediate release)
  // is a valid legacy value, so the fallback bounds allow 0 when a row
  // carries no min/max metadata of its own.
  escrow_release_delay_hrs: [0, 720],
  min_helper_rating: [0, 5],
};

function parsePlatformSettingValue(row, rawValue) {
  const key = String(row.key || '');
  const valueType = String(row.value_type || '').toLowerCase();
  const isBoolean = valueType === 'boolean' || BOOLEAN_SETTING_KEYS.has(key);
  const isNumber = valueType === 'number' || Object.prototype.hasOwnProperty.call(NUMERIC_SETTING_LIMITS, key);

  if (isBoolean) {
    if (rawValue === true || rawValue === false) return { value: String(rawValue), normalized: rawValue };
    if (rawValue === 'true' || rawValue === 'false') return { value: rawValue, normalized: rawValue === 'true' };
    return { error: 'Boolean settings must be true or false.' };
  }

  if (isNumber) {
    const number = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim());
    if (!Number.isFinite(number)) return { error: 'Numeric settings must contain a finite number.' };
    const bounds = NUMERIC_SETTING_LIMITS[key];
    const min = row.min_numeric_value == null ? bounds?.[0] : Number(row.min_numeric_value);
    const max = row.max_numeric_value == null ? bounds?.[1] : Number(row.max_numeric_value);
    if (Number.isFinite(min) && number < min) return { error: `Value must be at least ${min}.` };
    if (Number.isFinite(max) && number > max) return { error: `Value must be at most ${max}.` };
    return { value: String(number), normalized: number };
  }

  if (valueType === 'json') {
    try {
      const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
      return { value: JSON.stringify(parsed), normalized: parsed };
    } catch {
      return { error: 'JSON settings must contain valid JSON.' };
    }
  }

  const value = String(rawValue ?? '').trim();
  if (value.length > 5000) return { error: 'Text settings cannot exceed 5,000 characters.' };
  if (key === 'support_email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { error: 'Support email must be a valid email address.' };
  }
  if (row.validation_pattern && key !== 'support_email' && !(new RegExp(row.validation_pattern).test(value))) {
    return { error: 'The setting value has an invalid format.' };
  }
  return { value, normalized: value };
}

function parseStrictBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function isUuidParam(id) {
  return typeof id === 'string' && UUID_RE.test(id.trim());
}

function isInternalSystemUser(user = {}) {
  return (
    String(user.id || '').toLowerCase() === AI_BOOKING_PLACEHOLDER_USER_ID ||
    String(user.email || '').toLowerCase().endsWith(INTERNAL_EMAIL_SUFFIX)
  );
}

/**
 * When an admin re-enables an account (unban / reactivate), clear migration-165
 * scheduled deletion markers so the user list no longer shows "Pending deletion".
 *
 * Matches any row with a scheduled deletion that is **not** an explicit self-delete
 * (`deletion_type = 'self'`). Covers `deletion_type = 'admin'`, NULL, or legacy odd values.
 */
async function clearAdminScheduledDeletionIfPresent(userId) {
  const [hasSched, hasType, hasReason, hasAdminId] = await Promise.all([
    columnExists('users', 'deletion_scheduled_at'),
    columnExists('users', 'deletion_type'),
    columnExists('users', 'deletion_reason'),
    columnExists('users', 'deletion_admin_id'),
  ]);
  if (!hasSched) return;
  const sets = ['deleted_at = NULL', 'deletion_scheduled_at = NULL', 'updated_at = NOW()'];
  if (hasType) sets.push('deletion_type = NULL');
  if (hasReason) sets.push('deletion_reason = NULL');
  if (hasAdminId) sets.push('deletion_admin_id = NULL');

  const notSelf = hasType ? `AND (deletion_type IS DISTINCT FROM 'self')` : '';
  const { rowCount } = await db.query(
    `UPDATE users SET ${sets.join(', ')}
     WHERE ${userIdEq('id')}
       AND deletion_scheduled_at IS NOT NULL
       ${notSelf}`,
    [String(userId)]
  );
  if (rowCount === 0) {
    logger.warn('clearAdminScheduledDeletionIfPresent: no row updated', {
      userId: String(userId),
      hadDeletionTypeColumn: hasType,
    });
  }
}

/** Clears admin-scheduled deletion state and sets the account active (never for self-deletes). */
async function reinstateAfterPendingAdminDeletion(userId) {
  await clearAdminScheduledDeletionIfPresent(userId);
  const hasType = await columnExists('users', 'deletion_type');
  const notSelf = hasType ? `AND deletion_type IS DISTINCT FROM 'self'` : '';
  await db.query(
    `UPDATE users SET deleted_at = NULL, is_active = TRUE, updated_at = NOW()
     WHERE id::text = $1 ${notSelf}`,
    [String(userId)],
  );
}

/** Best-effort email + in-app for material account / admin actions (never throws). */
async function notifyUserAccountEvent(userId, { type, title, body, action_url = null, data = {} }) {
  try {
    await sendNotification({ userId, type, title, body, data, action_url });
  } catch (e) {
    logger.warn('notifyUserAccountEvent failed', { userId, type, error: e.message });
  }
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
        completed_jobs_period = 0, cancelled_jobs_period = 0, new_jobs_period = 0, new_jobs_today = 0,
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
            COUNT(*) FILTER (WHERE status = 'cancelled' AND created_at >= now() - $1::interval) AS cancelled_jobs_period,
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
        cancelled_jobs_period = safeInt(rows[0]?.cancelled_jobs_period);
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
    // T35-F01: the cohort must be consistent. Both completions and
    // cancellations are counted over the same period.
    const totalFinished = completed_jobs_period + cancelled_jobs_period;
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
    const { limit } = parseBoundedPagination(req.query, { defaultLimit: 20, maxLimit: 50 });
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
      sort = 'created_at', order = 'desc'
    } = req.query;
    const { page, limit, offset } = parseBoundedPagination(req.query, { defaultLimit: 25, maxLimit: 100 });
    const params = [];
    let paramIdx = 1;

    // Base exclusion: Never return administrative or internal system accounts via the standard user list.
    const baseConditions = [
      `u.role NOT IN ('admin','super_admin')`,
      `u.id::text <> '${AI_BOOKING_PLACEHOLDER_USER_ID}'`,
      `LOWER(u.email) NOT LIKE '%${INTERNAL_EMAIL_SUFFIX}'`,
    ];

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
        COUNT(*) FILTER (WHERE role NOT IN ('admin','super_admin') AND id::text <> '${AI_BOOKING_PLACEHOLDER_USER_ID}' AND LOWER(email) NOT LIKE '%${INTERNAL_EMAIL_SUFFIX}')                             AS total,
        COUNT(*) FILTER (WHERE role NOT IN ('admin','super_admin') AND id::text <> '${AI_BOOKING_PLACEHOLDER_USER_ID}' AND LOWER(email) NOT LIKE '%${INTERNAL_EMAIL_SUFFIX}' AND is_active = true)        AS active,
        COUNT(*) FILTER (WHERE role NOT IN ('admin','super_admin') AND id::text <> '${AI_BOOKING_PLACEHOLDER_USER_ID}' AND LOWER(email) NOT LIKE '%${INTERNAL_EMAIL_SUFFIX}' AND is_active = false)       AS suspended,
        COUNT(*) FILTER (WHERE role IN ('helper','helper_pro'))                                 AS helpers,
        COUNT(*) FILTER (WHERE role = 'customer' AND id::text <> '${AI_BOOKING_PLACEHOLDER_USER_ID}' AND LOWER(email) NOT LIKE '%${INTERNAL_EMAIL_SUFFIX}')                                               AS customers,
        COUNT(*) FILTER (WHERE role NOT IN ('admin','super_admin') AND id::text <> '${AI_BOOKING_PLACEHOLDER_USER_ID}' AND LOWER(email) NOT LIKE '%${INTERNAL_EMAIL_SUFFIX}' AND created_at >= now() - interval '7 days') AS new_this_week
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
    if (String(userId || '').toLowerCase() === AI_BOOKING_PLACEHOLDER_USER_ID) {
      return res.status(404).json({ error: 'System account is hidden from user management.' });
    }

    const hasHP   = await tableExists('helper_profiles');
    const hasSubs = await tableExists('subscriptions');
    const hasPlanTable = hasSubs && await tableExists('plans');
    const hasCA   = await tableExists('connect_accounts');

    // Check for columns added in migration 154 (non-fatal if migration hasn't run)
    const [hasMig154Cols, hasPhoneNumber] = await Promise.all([
      columnExists('users', 'is_suspended'),
      columnExists('users', 'phone_number'),
    ]);

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
    if (hasPhoneNumber) cols.push('u.phone_number');

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
    if (isInternalSystemUser(raw)) {
      return res.status(404).json({ error: 'System account is hidden from user management.' });
    }
    // Normalize field names to match what the admin UI expects.
    // connect_accounts is authoritative for Stripe Connect fields; fall back to
    // helper_profiles for deployments that haven't migrated to connect_accounts.
    const user = {
      ...raw,
      phone: raw.phone || raw.phone_number || null,
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
         FROM jobs WHERE ${userIdEq('client_id')} OR ${userIdEq('assigned_helper_id')}
         ORDER BY created_at DESC LIMIT 10`, [String(userId)]);
      recentJobs = r.rows;
    }
    if (await tableExists('reviews')) {
      const r = await db.query(
        `SELECT r.rating, r.comment, r.created_at, u2.first_name || ' ' || u2.last_name AS reviewer_name
         FROM reviews r JOIN users u2 ON r.reviewer_id::text = u2.id::text
         WHERE ${userIdEq('r.reviewee_id')} ORDER BY r.created_at DESC LIMIT 5`, [String(userId)]);
      recentReviews = r.rows;
    }
    if (await tableExists('payments')) {
      const r = await db.query(
        `SELECT j.title AS job_title, p.created_at AS completed_at,
                ROUND(COALESCE(p.helper_payout, 0) * 100)::INTEGER AS net_to_helper_cents
         FROM payments p JOIN jobs j ON p.job_id = j.id
         WHERE ${userIdEq('p.payee_id')} AND p.status = 'captured'
         ORDER BY p.created_at DESC LIMIT 10`, [String(userId)]);
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
        await db.query(
          `UPDATE sessions SET is_valid = false WHERE ${userIdEq('user_id')}`,
          [String(userId)],
        );
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
    const { rows: before } = await db.query(
      `SELECT is_active, role FROM users WHERE id::text = $1`,
      [String(userId)],
    );
    if (!before.length) return res.status(404).json({ error: 'User not found.' });
    if (['admin','super_admin'].includes(before[0].role)) return res.status(403).json({ error: 'Cannot ban admin accounts.' });
    const newStatus = !before[0].is_active;
    const { rows: updateRows } = await db.query(
      `UPDATE users SET is_active = $1, updated_at = NOW()
       WHERE id::text = $3 AND is_active = $2 RETURNING id`,
      [newStatus, before[0].is_active, String(userId)],
    );
    if (updateRows.length === 0) {
      return res.status(409).json({ error: 'User status changed during ban operation - concurrent modification detected.' });
    }
    try { await logAdminAction({ adminId, action: newStatus ? 'user_unbanned' : 'user_banned', targetType: 'user', targetId: userId, description: reason || null, before: { is_active: before[0].is_active }, after: { is_active: newStatus }, req }); } catch(e) {}
    try { await sendNotification({
      userId,
      type: newStatus ? 'account_restored' : 'account_banned',
      action_url: newStatus ? '/login' : null,
      data: { reason: reason || null },
    }); } catch (e) {}
    if (newStatus) {
      try { await reinstateAfterPendingAdminDeletion(userId); } catch (e) { logger.warn('toggleUserBan: reinstate after unban failed', { userId, err: e.message }); }
    }
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
    // Never allow demoting the sole remaining super_admin (fail closed).
    if (before[0].role === 'super_admin' && role !== 'super_admin') {
      const { rows: remaining } = await db.query(
        `SELECT COUNT(*)::int AS n FROM users WHERE role = 'super_admin' AND id <> $1`,
        [userId]
      );
      if (remaining[0].n === 0) {
        return res.status(400).json({ error: 'Cannot demote the last remaining super_admin.' });
      }
    }
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
    const { search, status, category } = req.query;
    const { page, limit, offset } = parseBoundedPagination(req.query, { defaultLimit: 25, maxLimit: 100 });
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

exports.forceJobAction = async (req, res, next) => {
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
      // RV1(b): admin force-cancels run through the shared cancellation
      // service, exactly like the user-facing and agent flows, so escrow
      // blocks, bid cleanup, appointment release, and audit are handled.
      // Admin-initiated cancels never charge a cancellation fee.
      const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
      if (jobRows[0].status === 'cancelled') {
        return res.json({ message: `Job ${action} successful.`, alreadyCancelled: true });
      }
      let result;
      try {
        result = await cancelJobTransaction({ jobId, actorId: adminId, actorKind: 'admin', reason: cleanReason });
      } catch (err) {
        // Race-safe idempotency: a concurrent cancel may have won the row
        // between our fast-path check and the guarded UPDATE. Only surface
        // the 409 if the job is genuinely not cancelled.
        if (err instanceof AppError && err.status === 409) {
          const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [jobId]);
          if (rows[0]?.status === 'cancelled') {
            return res.json({ message: `Job ${action} successful.`, alreadyCancelled: true });
          }
        }
        throw err;
      }
      // Post-commit notifications to both parties (never throws).
      await finalizeJobCancellation(result);
    }
    if (action === 'flag') {
      const { rows: flagRows } = await db.query(
        `UPDATE jobs SET metadata = jsonb_set(COALESCE(metadata,'{}'), '{admin_flagged}', 'true',  true), updated_at = now() WHERE id = $1 AND COALESCE(metadata->>'admin_flagged', 'false') <> 'true' RETURNING id`,
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
  } catch (err) {
    if (err instanceof AppError) return next(err);
    logger.error('forceJobAction error', { err });
    res.status(500).json({ error: 'Failed to perform job action.' });
  }
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
    const { type } = req.query;
    const { page, limit, offset } = parseBoundedPagination(req.query, { defaultLimit: 25, maxLimit: 100 });
    const params = []; let paramIdx = 1; let condition = '';
    if (type) { condition = `WHERE source_type = $${paramIdx++}`; params.push(type); }
    const { rows } = await db.query(`SELECT pl.*, u.first_name || ' ' || u.last_name AS user_name, u.email AS user_email FROM platform_ledger pl LEFT JOIN users u ON pl.user_id = u.id ${condition} ORDER BY pl.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`, [...params, limit, offset]);
    const { rows: totals } = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS gross_revenue_cents,
        COALESCE(SUM(CASE WHEN source_type = 'job_fee' AND amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS job_fee_revenue_cents,
        COALESCE(SUM(CASE WHEN source_type = 'subscription' AND amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS subscription_revenue_cents,
        COALESCE(SUM(CASE WHEN amount_cents < 0 THEN ABS(amount_cents) ELSE 0 END), 0) AS total_refunds_cents,
        COALESCE(SUM(amount_cents), 0) AS net_revenue_cents
      FROM platform_ledger
    `);
    res.json({ ledger: rows, totals: totals[0], page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { logger.error('getFinancials error', { err }); res.status(500).json({ error: 'Failed to fetch financials.' }); }
};

exports.issueManualRefund = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { reason, amount_cents } = req.body;
    const adminId = req.user.id;
    if (!reason) return res.status(400).json({ error: 'Refund reason required.' });

    const refundAmountCents = amount_cents == null ? null : Number(amount_cents);
    if (refundAmountCents != null && (!Number.isInteger(refundAmountCents) || refundAmountCents <= 0)) {
      return res.status(400).json({ error: 'Refund amount must be a positive integer number of cents.' });
    }

    const { rows } = await db.query(
      `SELECT id, amount, stripe_payment_intent_id, stripe_account_id
       FROM payments
       WHERE job_id = $1
         AND stripe_payment_intent_id IS NOT NULL
         AND status IN ('authorized', 'captured', 'released')
       ORDER BY created_at DESC
       LIMIT 1`,
      [jobId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Refundable payment not found for this job.' });
    }

    const payment = rows[0];
    // Server-side guard: never refund more than was captured.
    const capturedCents = Math.round(Number(payment.amount) * 100);
    if (!Number.isInteger(capturedCents) || capturedCents <= 0) {
      return res.status(409).json({ error: 'Payment has no captured amount to refund against.' });
    }
    if (refundAmountCents != null && refundAmountCents > capturedCents) {
      return res.status(400).json({ error: 'Refund amount cannot exceed the captured amount.' });
    }

    const requestId = `admin-job-refund-${jobId}-${payment.id}-${refundAmountCents || 'full'}`;
    const refundResult = await processPaymentRefund({
      paymentId: payment.id,
      requestedAmountCents: refundAmountCents,
      reason,
      actorUserId: adminId,
      requestId,
    });
    if (refundResult.attempt.status !== 'succeeded') {
      return res.status(202).json({
        message: 'Refund accepted for provider reconciliation.',
        refundStatus: refundResult.attempt.status,
        refundAttemptId: refundResult.attempt.id,
      });
    }
    const refund = { id: refundResult.attempt.stripe_refund_id };
    try {
      await logAdminAction({
        adminId,
        action: 'manual_refund_issued',
        targetType: 'payment',
        targetId: String(payment.id),
        description: `Manual refund issued for job ${jobId}: ${reason}`,
        before: { captured_cents: capturedCents },
        after: { refund_cents: refundAmountCents == null ? capturedCents : refundAmountCents, stripe_refund_id: refund.id, request_id: requestId },
        req,
      });
    } catch (e) {
      // The refund has already succeeded at this point, so the response
      // stays 200; but a missing manual_refund_issued audit row is a
      // compliance gap. Log loudly (was: catch (e) {}) so the gap is
      // visible and can be backfilled from the Stripe refund id.
      logger.error('manual_refund_issued audit write failed AFTER refund issued', {
        jobId,
        paymentId: payment.id,
        adminId,
        stripeRefundId: refund.id,
        requestId,
        error: e.message,
      });
    }
  } catch (err) { logger.error('issueManualRefund error', { err }); res.status(500).json({ error: 'Refund failed.' }); }
};

exports.getPayouts = async (req, res) => {
  try {
    const { status = '' } = req.query;
    const { page, limit, offset } = parseBoundedPagination(req.query, { defaultLimit: 25, maxLimit: 100 });

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
    `, [limit, offset]);

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
      page,
      limit,
    });
  } catch (err) {
    logger.error('getPayouts error', { err });
    res.status(500).json({ error: 'Failed to fetch payouts.' });
  }
};

/**
 * POST /admin/super/payouts/:id/retry
 * Requeues a failed helper payout for processing (resets it to pending so
 * the payout pipeline picks it up again). Super-admin only: no
 * payouts-write grant exists in the permission catalogue, so fail closed.
 * Idempotent: a payout that is already released is a no-op; concurrent
 * retries race safely on the conditional UPDATE.
 */
exports.retryPayout = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;

    const { rows } = await db.query(
      `SELECT id, job_id, helper_payout, status, failure_reason
       FROM payments
       WHERE id = $1 AND helper_payout > 0`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Payout not found.' });

    const payout = rows[0];
    if (payout.status === 'released') {
      return res.json({
        retried: false,
        reason: 'Payout already completed.',
        payout: { id: payout.id, status: payout.status },
      });
    }
    if (payout.status !== 'failed') {
      return res.status(409).json({ error: 'Only failed payouts can be retried.' });
    }

    const { rows: updated } = await db.query(
      `UPDATE payments
       SET status = 'pending', failure_reason = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'failed'
       RETURNING id, status`,
      [id]
    );
    if (!updated.length) {
      // Lost a race with another retry; re-read for an accurate answer.
      const { rows: reread } = await db.query('SELECT id, status FROM payments WHERE id = $1', [id]);
      return res.json({
        retried: false,
        reason: 'Payout is no longer in a failed state.',
        payout: reread[0] || null,
      });
    }

    try {
      await logAdminAction({
        adminId,
        action: 'payout_retry_queued',
        targetType: 'payment',
        targetId: String(payout.id),
        description: `Requeued failed payout ${payout.id} (helper_payout ${payout.helper_payout})`,
        before: { status: 'failed', failure_reason: payout.failure_reason },
        after: { status: 'pending' },
        req,
      });
    } catch (e) {}

    res.json({ retried: true, payout: updated[0] });
  } catch (err) {
    logger.error('retryPayout error', { err });
    res.status(500).json({ error: 'Failed to retry payout.' });
  }
};

exports.getRevenueSummary = async (req, res) => {
  try {
    // RV1(a): revenue is reported per currency. Mixing currencies in one sum
    // (and dividing zero-decimal amounts by 100) produced wrong totals.
    const { currency, error: currencyError } = parseRevenueCurrency(req.query);
    if (currencyError) return res.status(400).json({ error: currencyError });
    const divisor = revenueDivisor(currency);

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
      return res.json({ stats: { totalRevenue: 0, subscriptionRevenue: 0, jobFeeRevenue: 0, refunds: 0, growth: 0, currency }, transactions: [], currencies: [] });
    }

    // Current period totals, classified by source event type (not amount sign):
    // revenue buckets only count revenue source types; refunds only count
    // source_type = 'refund'. A negative adjustment or payout is an outflow of
    // its own kind, never a refund and never revenue.
    const { rows: totals } = await db.query(`
      SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE source_type = ANY($3) AND amount_cents > 0), 0)::float / $4::float AS total_revenue,
        COALESCE(SUM(amount_cents) FILTER (WHERE source_type = 'subscription' AND amount_cents > 0), 0)::float / $4::float AS subscription_revenue,
        COALESCE(SUM(amount_cents) FILTER (WHERE source_type = 'job_fee' AND amount_cents > 0), 0)::float / $4::float AS job_fee_revenue,
        COALESCE(SUM(ABS(amount_cents)) FILTER (WHERE source_type = 'refund'), 0)::float / $4::float AS refunds
      FROM platform_ledger
      WHERE created_at >= now() - $1::interval AND currency = $2
    `, [interval, currency, REVENUE_SOURCE_TYPES, divisor]);

    // Previous period for growth calc (same classification + currency).
    const { rows: prevTotals } = await db.query(`
      SELECT COALESCE(SUM(amount_cents) FILTER (WHERE source_type = ANY($4) AND amount_cents > 0), 0)::float / $5::float AS total_revenue
      FROM platform_ledger
      WHERE created_at >= now() - $1::interval AND created_at < now() - $2::interval AND currency = $3
    `, [prev, interval, currency, REVENUE_SOURCE_TYPES, divisor]);

    const current = totals[0].total_revenue;
    const previous = prevTotals[0].total_revenue;
    const growth = previous > 0 ? ((current - previous) / previous) * 100 : 0;

    // Recent transactions
    const { rows: transactions } = await db.query(`
      SELECT
        pl.id AS _id,
        pl.created_at AS "createdAt",
        pl.source_type AS type,
        pl.currency AS currency,
        pl.amount_cents::float / $2::float AS amount,
        CASE WHEN pl.source_type = 'refund' THEN 'refunded' ELSE 'completed' END AS status,
        u.email AS "userEmail",
        json_build_object('name', u.first_name || ' ' || u.last_name) AS user
      FROM platform_ledger pl
      LEFT JOIN users u ON pl.user_id = u.id
      WHERE pl.created_at >= now() - $1::interval AND pl.currency = $3
      ORDER BY pl.created_at DESC
      LIMIT 50
    `, [interval, divisor, currency]);

    const { rows: currencyRows } = await db.query(
      `SELECT DISTINCT currency FROM platform_ledger ORDER BY currency`
    );

    res.json({
      stats: {
        totalRevenue:        totals[0].total_revenue,
        subscriptionRevenue: totals[0].subscription_revenue,
        jobFeeRevenue:       totals[0].job_fee_revenue,
        refunds:             totals[0].refunds,
        growth:              Math.round(growth * 10) / 10,
        currency,
      },
      transactions,
      currencies: currencyRows.map(r => r.currency),
    });
  } catch (err) {
    logger.error('getRevenueSummary error', { err });
    res.status(500).json({ error: 'Failed to fetch revenue summary.' });
  }
};

exports.getRevenueExport = async (req, res) => {
  try {
    // RV1(a): export is scoped to one currency and bounded. The export fetches
    // one row past the cap to detect truncation; truncation is disclosed via
    // the X-Export-Truncated header (surfaced in the admin UI).
    const { currency, error: currencyError } = parseRevenueCurrency(req.query);
    if (currencyError) return res.status(400).json({ error: currencyError });
    const divisor = revenueDivisor(currency);

    const { period = '30d' } = req.query;
    const intervalMap = { '7d': '7 days', '30d': '30 days', '90d': '90 days', '1y': '1 year' };
    const interval = intervalMap[period] || '30 days';

    const headers = ['date', 'type', 'currency', 'amount', 'user_email'];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="revenue_${period}_${currency}_${new Date().toISOString().split('T')[0]}.csv"`);

    const hasLedger = await tableExists('platform_ledger');
    if (!hasLedger) {
      return res.send(headers.join(',') + '\r\n');
    }

    const { rows } = await db.query(`
      SELECT
        pl.created_at AS date,
        pl.source_type AS type,
        pl.currency AS currency,
        (pl.amount_cents::float / $2::float)::text AS amount,
        COALESCE(u.email, '') AS user_email
      FROM platform_ledger pl
      LEFT JOIN users u ON pl.user_id = u.id
      WHERE pl.created_at >= now() - $1::interval AND pl.currency = $3
      ORDER BY pl.created_at DESC
      LIMIT $4
    `, [interval, divisor, currency, REVENUE_EXPORT_ROW_LIMIT + 1]);

    const truncated = rows.length > REVENUE_EXPORT_ROW_LIMIT;
    const exportRows = truncated ? rows.slice(0, REVENUE_EXPORT_ROW_LIMIT) : rows;
    if (truncated) res.setHeader('X-Export-Truncated', 'true');

    const csvRows = exportRows.map(r =>
      headers.map(h => revenueCsvEscape(r[h])).join(',')
    );
    res.send([headers.join(','), ...csvRows].join('\r\n') + '\r\n');
  } catch (err) {
    logger.error('getRevenueExport error', { err });
    res.status(500).json({ error: 'Export failed.' });
  }
};

exports.getMoneyOverview = async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const intervalMap = {
      '7d': { interval: '7 days', prev: '14 days' },
      '30d': { interval: '30 days', prev: '60 days' },
      '90d': { interval: '90 days', prev: '180 days' },
      '1y': { interval: '1 year', prev: '2 years' },
    };
    const { interval, prev } = intervalMap[period] || intervalMap['30d'];

    const [
      hasLedger,
      hasSubscriptions,
      hasPayments,
      hasConsultingPayments,
      hasMarketplaceOrders,
      hasApiProducts,
      hasApiProductSubscriptions,
      hasAffiliateCommissions,
      hasAffiliatePayouts,
      hasFranchisePrograms,
      hasFranchiseAgreements,
      hasFranchiseApplications,
      hasPricingOverrides,
      hasPlatformSettings,
    ] = await Promise.all([
      tableExists('platform_ledger'),
      tableExists('subscriptions'),
      tableExists('payments'),
      tableExists('consulting_payments'),
      tableExists('marketplace_orders'),
      tableExists('api_products'),
      tableExists('api_product_subscriptions'),
      tableExists('affiliate_commissions'),
      tableExists('affiliate_payouts'),
      tableExists('franchise_programs'),
      tableExists('franchise_agreements'),
      tableExists('franchise_applications'),
      tableExists('pricing_overrides'),
      tableExists('platform_settings'),
    ]);

    const revenueLedgerSources = new Set([
      'subscription',
      'job_fee',
      'protection_fee',
      'broker_fee',
      'marketing',
      'adjustment',
    ]);

    let ledgerBySource = [];
    let ledgerMovements = [];
    // T36-F01: reporting currency for headline money totals. Per-currency
    // breakdowns are exposed separately; mixed-currency sums are never implied.
    const REPORTING_CURRENCY = 'USD';
    if (hasLedger) {
      const [{ rows: sourceRows }, { rows: movementRows }] = await Promise.all([
        db.query(`
          SELECT
            source_type,
            UPPER(currency) AS currency,
            COUNT(*) FILTER (WHERE created_at >= now() - $1::interval) AS period_count,
            COUNT(*) AS lifetime_count,
            COALESCE(SUM(CASE WHEN amount_cents > 0 AND created_at >= now() - $1::interval THEN amount_cents ELSE 0 END), 0) AS period_positive_cents,
            COALESCE(SUM(CASE WHEN amount_cents < 0 AND created_at >= now() - $1::interval THEN ABS(amount_cents) ELSE 0 END), 0) AS period_negative_cents,
            COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS lifetime_positive_cents,
            COALESCE(SUM(CASE WHEN amount_cents < 0 THEN ABS(amount_cents) ELSE 0 END), 0) AS lifetime_negative_cents
          FROM platform_ledger
          GROUP BY source_type, UPPER(currency)
          ORDER BY lifetime_positive_cents DESC, source_type ASC, currency ASC
        `, [interval]),
        db.query(`
          SELECT
            id::text AS id,
            'ledger' AS source,
            created_at,
            source_type AS label,
            amount_cents,
            description
          FROM platform_ledger
          WHERE created_at >= now() - $1::interval
          ORDER BY created_at DESC
          LIMIT 10
        `, [interval]),
      ]);
      ledgerBySource = sourceRows;
      ledgerMovements = movementRows;
    }

    // T36-F01: ledger totals are grouped by (source_type, currency). Headline
    // sums cover the reporting currency only; per-currency breakdowns are
    // exposed separately so mixed-currency sums are never implied.
    const ledgerMap = ledgerBySource.reduce((acc, row) => {
      const key = `${row.source_type}:${row.currency || REPORTING_CURRENCY}`;
      acc[key] = {
        sourceType: row.source_type,
        currency: row.currency || REPORTING_CURRENCY,
        periodCount: safeInt(row.period_count),
        lifetimeCount: safeInt(row.lifetime_count),
        periodPositiveCents: safeInt(row.period_positive_cents),
        periodNegativeCents: safeInt(row.period_negative_cents),
        lifetimePositiveCents: safeInt(row.lifetime_positive_cents),
        lifetimeNegativeCents: safeInt(row.lifetime_negative_cents),
      };
      return acc;
    }, {});

    const ledgerRevenuePeriodCents = Object.values(ledgerMap).reduce((sum, value) => (
      revenueLedgerSources.has(value.sourceType) && value.currency === REPORTING_CURRENCY
        ? sum + value.periodPositiveCents : sum
    ), 0);
    const ledgerRevenueLifetimeCents = Object.values(ledgerMap).reduce((sum, value) => (
      revenueLedgerSources.has(value.sourceType) && value.currency === REPORTING_CURRENCY
        ? sum + value.lifetimePositiveCents : sum
    ), 0);
    const ledgerRefundsPeriodCents = Object.values(ledgerMap).reduce(
      (sum, value) => value.currency === REPORTING_CURRENCY ? sum + value.periodNegativeCents : sum, 0);
    const ledgerOutflowsLifetimeCents = Object.values(ledgerMap).reduce(
      (sum, value) => value.currency === REPORTING_CURRENCY ? sum + value.lifetimeNegativeCents : sum, 0);

    let activeSubscriptions = 0;
    if (hasSubscriptions) {
      const { rows } = await db.query(`
        SELECT COUNT(*) AS count
        FROM subscriptions
        WHERE status = 'active'
      `);
      activeSubscriptions = safeInt(rows[0]?.count);
    }

    let servicePayments = {
      capturedPeriodCents: 0,
      capturedLifetimeCents: 0,
      pendingVolumeCents: 0,
      refundsPeriodCents: 0,
      capturedCount: 0,
    };
    if (hasPayments) {
      const { rows } = await db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN status IN ('captured', 'released') AND created_at >= now() - $1::interval THEN platform_fee * 100 ELSE 0 END), 0) AS captured_period_cents,
          COALESCE(SUM(CASE WHEN status IN ('captured', 'released') THEN platform_fee * 100 ELSE 0 END), 0) AS captured_lifetime_cents,
          COALESCE(SUM(CASE WHEN status IN ('pending', 'authorized') THEN amount * 100 ELSE 0 END), 0) AS pending_volume_cents,
          COALESCE(SUM(CASE WHEN status = 'refunded' AND refunded_at >= now() - $1::interval THEN refund_amount * 100 ELSE 0 END), 0) AS refunds_period_cents,
          COUNT(*) FILTER (WHERE status IN ('captured', 'released')) AS captured_count
        FROM payments
      `, [interval]);
      servicePayments = {
        capturedPeriodCents: safeInt(rows[0]?.captured_period_cents),
        capturedLifetimeCents: safeInt(rows[0]?.captured_lifetime_cents),
        pendingVolumeCents: safeInt(rows[0]?.pending_volume_cents),
        refundsPeriodCents: safeInt(rows[0]?.refunds_period_cents),
        capturedCount: safeInt(rows[0]?.captured_count),
      };
    }

    let consulting = {
      completedPeriodCents: 0,
      completedLifetimeCents: 0,
      pendingCents: 0,
      refundedPeriodCents: 0,
      completedCount: 0,
      recent: [],
    };
    if (hasConsultingPayments) {
      const [{ rows: consultingRows }, { rows: consultingRecentRows }] = await Promise.all([
        db.query(`
          SELECT
            COALESCE(SUM(CASE WHEN status = 'completed' AND created_at >= now() - $1::interval THEN amount_cents ELSE 0 END), 0) AS completed_period_cents,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN amount_cents ELSE 0 END), 0) AS completed_lifetime_cents,
            COALESCE(SUM(CASE WHEN status IN ('pending', 'processing') THEN amount_cents ELSE 0 END), 0) AS pending_cents,
            COALESCE(SUM(CASE WHEN status = 'refunded' AND updated_at >= now() - $1::interval THEN amount_cents ELSE 0 END), 0) AS refunded_period_cents,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed_count
          FROM consulting_payments
        `, [interval]),
        db.query(`
          SELECT
            id::text AS id,
            'consulting' AS source,
            created_at,
            service_tier AS label,
            CASE
              WHEN status = 'refunded' THEN -amount_cents
              ELSE amount_cents
            END AS amount_cents,
            status AS description
          FROM consulting_payments
          WHERE created_at >= now() - $1::interval
          ORDER BY created_at DESC
          LIMIT 8
        `, [interval]),
      ]);
      consulting = {
        completedPeriodCents: safeInt(consultingRows[0]?.completed_period_cents),
        completedLifetimeCents: safeInt(consultingRows[0]?.completed_lifetime_cents),
        pendingCents: safeInt(consultingRows[0]?.pending_cents),
        refundedPeriodCents: safeInt(consultingRows[0]?.refunded_period_cents),
        completedCount: safeInt(consultingRows[0]?.completed_count),
        recent: consultingRecentRows,
      };
    }

    let marketplace = {
      periodGmvCents: 0,
      lifetimeGmvCents: 0,
      pendingCents: 0,
      refundedPeriodCents: 0,
      paidOrderCount: 0,
    };
    if (hasMarketplaceOrders) {
      const { rows } = await db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN status IN ('paid', 'processing', 'completed') AND created_at >= now() - $1::interval THEN total_cents ELSE 0 END), 0) AS period_gmv_cents,
          COALESCE(SUM(CASE WHEN status IN ('paid', 'processing', 'completed') THEN total_cents ELSE 0 END), 0) AS lifetime_gmv_cents,
          COALESCE(SUM(CASE WHEN status = 'pending' THEN total_cents ELSE 0 END), 0) AS pending_cents,
          COALESCE(SUM(CASE WHEN status = 'refunded' AND updated_at >= now() - $1::interval THEN total_cents ELSE 0 END), 0) AS refunded_period_cents,
          COUNT(*) FILTER (WHERE status IN ('paid', 'processing', 'completed')) AS paid_order_count
        FROM marketplace_orders
      `, [interval]);
      marketplace = {
        periodGmvCents: safeInt(rows[0]?.period_gmv_cents),
        lifetimeGmvCents: safeInt(rows[0]?.lifetime_gmv_cents),
        pendingCents: safeInt(rows[0]?.pending_cents),
        refundedPeriodCents: safeInt(rows[0]?.refunded_period_cents),
        paidOrderCount: safeInt(rows[0]?.paid_order_count),
      };
    }

    let apiProducts = {
      publishedCount: 0,
      activeSubscriptions: 0,
      monthlyRevenueSnapshotCents: 0,
      recurringProducts: 0,
    };
    if (hasApiProducts) {
      const { rows } = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'published') AS published_count,
          COUNT(*) FILTER (WHERE pricing_type = 'recurring' AND status = 'published') AS recurring_products,
          COALESCE(SUM(CASE WHEN status = 'published' THEN monthly_revenue_cents ELSE 0 END), 0) AS monthly_revenue_snapshot_cents
        FROM api_products
      `);
      apiProducts = {
        ...apiProducts,
        publishedCount: safeInt(rows[0]?.published_count),
        monthlyRevenueSnapshotCents: safeInt(rows[0]?.monthly_revenue_snapshot_cents),
        recurringProducts: safeInt(rows[0]?.recurring_products),
      };
    }
    if (hasApiProductSubscriptions) {
      const { rows } = await db.query(`
        SELECT COUNT(*) FILTER (WHERE status = 'active') AS active_count
        FROM api_product_subscriptions
      `);
      apiProducts.activeSubscriptions = safeInt(rows[0]?.active_count);
    }

    let affiliates = {
      pendingCommissionCents: 0,
      confirmedCommissionCents: 0,
      paidCommissionCents: 0,
      payoutsCompletedCents: 0,
      commissionCount: 0,
    };
    if (hasAffiliateCommissions) {
      const { rows } = await db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'pending' THEN commission_cents ELSE 0 END), 0) AS pending_commission_cents,
          COALESCE(SUM(CASE WHEN status = 'confirmed' THEN commission_cents ELSE 0 END), 0) AS confirmed_commission_cents,
          COALESCE(SUM(CASE WHEN status = 'paid' THEN commission_cents ELSE 0 END), 0) AS paid_commission_cents,
          COUNT(*) AS commission_count
        FROM affiliate_commissions
      `);
      affiliates = {
        ...affiliates,
        pendingCommissionCents: safeInt(rows[0]?.pending_commission_cents),
        confirmedCommissionCents: safeInt(rows[0]?.confirmed_commission_cents),
        paidCommissionCents: safeInt(rows[0]?.paid_commission_cents),
        commissionCount: safeInt(rows[0]?.commission_count),
      };
    }
    if (hasAffiliatePayouts) {
      const { rows } = await db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'completed' THEN total_commission_cents ELSE 0 END), 0) AS payouts_completed_cents
        FROM affiliate_payouts
      `);
      affiliates.payoutsCompletedCents = safeInt(rows[0]?.payouts_completed_cents);
    }

    let franchise = {
      activePrograms: 0,
      signedInitialFeesCents: 0,
      pendingInitialFeesCents: 0,
      signedAgreements: 0,
      pipelineApplications: 0,
      launchedStores: 0,
      averageRoyaltyBps: 0,
      averageMarketingFeeBps: 0,
    };
    if (hasFranchisePrograms) {
      const { rows } = await db.query(`
        SELECT COUNT(*) FILTER (WHERE is_active = TRUE) AS active_programs
        FROM franchise_programs
      `);
      franchise.activePrograms = safeInt(rows[0]?.active_programs);
    }
    if (hasFranchiseAgreements) {
      const { rows } = await db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN signed_at IS NOT NULL THEN initial_fee_cents ELSE 0 END), 0) AS signed_initial_fees_cents,
          COALESCE(SUM(CASE WHEN signed_at IS NULL THEN initial_fee_cents ELSE 0 END), 0) AS pending_initial_fees_cents,
          COUNT(*) FILTER (WHERE signed_at IS NOT NULL) AS signed_agreements,
          COALESCE(AVG(NULLIF(royalty_bps, 0)), 0) AS average_royalty_bps,
          COALESCE(AVG(NULLIF(marketing_fee_bps, 0)), 0) AS average_marketing_fee_bps
        FROM franchise_agreements
      `);
      franchise = {
        ...franchise,
        signedInitialFeesCents: safeInt(rows[0]?.signed_initial_fees_cents),
        pendingInitialFeesCents: safeInt(rows[0]?.pending_initial_fees_cents),
        signedAgreements: safeInt(rows[0]?.signed_agreements),
        averageRoyaltyBps: Math.round(safeFloat(rows[0]?.average_royalty_bps)),
        averageMarketingFeeBps: Math.round(safeFloat(rows[0]?.average_marketing_fee_bps)),
      };
    }
    if (hasFranchiseApplications) {
      const { rows } = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('rejected', 'archived', 'launched')) AS pipeline_applications,
          COUNT(*) FILTER (WHERE status = 'launched') AS launched_stores
        FROM franchise_applications
      `);
      franchise.pipelineApplications = safeInt(rows[0]?.pipeline_applications);
      franchise.launchedStores = safeInt(rows[0]?.launched_stores);
    }

    let pricing = {
      overrideCount: 0,
      overrideCountries: [],
      feeSettings: {},
    };
    if (hasPricingOverrides) {
      const { rows } = await db.query(`
        SELECT country_code
        FROM pricing_overrides
        WHERE is_active = TRUE
        ORDER BY country_code ASC
      `);
      pricing.overrideCount = rows.length;
      pricing.overrideCountries = rows.map((row) => row.country_code);
    }
    if (hasPlatformSettings) {
      const { rows } = await db.query(`
        SELECT key, value
        FROM platform_settings
        WHERE key IN (
          'platform_fee_starter',
          'platform_fee_pro',
          'platform_fee_elite',
          'platform_fee_broker',
          'broker_cut_rate',
          'tier2_subscription_cents',
          'tier3_subscription_cents'
        )
      `);
      pricing.feeSettings = rows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {});
    }

    let previousTrackedRevenueCents = 0;
    if (hasLedger) {
      const { rows } = await db.query(`
        SELECT
          COALESCE(SUM(CASE
            WHEN source_type IN ('subscription', 'job_fee', 'protection_fee', 'broker_fee', 'marketing', 'adjustment')
             AND amount_cents > 0
            THEN amount_cents
            ELSE 0
          END), 0) AS total_cents
        FROM platform_ledger
        WHERE created_at >= now() - $1::interval
          AND created_at < now() - $2::interval
      `, [prev, interval]);
      previousTrackedRevenueCents += safeInt(rows[0]?.total_cents);
    }
    if (hasConsultingPayments) {
      const { rows } = await db.query(`
        SELECT
          COALESCE(SUM(amount_cents), 0) AS total_cents
        FROM consulting_payments
        WHERE status = 'completed'
          AND created_at >= now() - $1::interval
          AND created_at < now() - $2::interval
      `, [prev, interval]);
      previousTrackedRevenueCents += safeInt(rows[0]?.total_cents);
    }

    const trackedRevenuePeriodCents = ledgerRevenuePeriodCents + consulting.completedPeriodCents;
    const trackedRevenueLifetimeCents = ledgerRevenueLifetimeCents + consulting.completedLifetimeCents;
    const trackedGrowth = previousTrackedRevenueCents > 0
      ? ((trackedRevenuePeriodCents - previousTrackedRevenueCents) / previousTrackedRevenueCents) * 100
      : 0;

    const serviceFeeSources = ['job_fee', 'protection_fee', 'broker_fee'];
    const serviceFeesPeriodCents = serviceFeeSources.reduce(
      (sum, src) => sum + (ledgerMap[`${src}:${REPORTING_CURRENCY}`]?.periodPositiveCents || 0), 0);
    const serviceFeesLifetimeCents = serviceFeeSources.reduce(
      (sum, src) => sum + (ledgerMap[`${src}:${REPORTING_CURRENCY}`]?.lifetimePositiveCents || 0), 0);
    const otherLiveLedgerSources = Object.entries(ledgerMap)
      .filter(([, value]) => revenueLedgerSources.has(value.sourceType)
        && value.currency === REPORTING_CURRENCY
        && !['subscription', ...serviceFeeSources].includes(value.sourceType))
      .map(([, value]) => ({
        source: value.sourceType,
        currency: value.currency,
        periodCents: value.periodPositiveCents,
        lifetimeCents: value.lifetimePositiveCents,
      }))
      .filter((row) => row.periodCents > 0 || row.lifetimeCents > 0);

    const channels = [
      {
        key: 'subscriptions',
        label: 'Premium subscriptions',
        category: 'direct_revenue',
        trackingStatus: 'live_revenue',
        periodCents: ledgerMap[`subscription:${REPORTING_CURRENCY}`]?.periodPositiveCents || 0,
        lifetimeCents: ledgerMap[`subscription:${REPORTING_CURRENCY}`]?.lifetimePositiveCents || 0,
        pendingCents: 0,
        refundsCents: ledgerMap[`subscription:${REPORTING_CURRENCY}`]?.periodNegativeCents || 0,
        count: activeSubscriptions,
        note: 'Recurring paid plans already captured in the platform ledger.',
        sources: ['platform_ledger', 'subscriptions'],
      },
      {
        key: 'service_fees',
        label: 'Service, escrow, and broker fees',
        category: 'direct_revenue',
        trackingStatus: 'live_revenue',
        periodCents: serviceFeesPeriodCents,
        lifetimeCents: serviceFeesLifetimeCents,
        pendingCents: servicePayments.pendingVolumeCents,
        refundsCents: servicePayments.refundsPeriodCents,
        count: servicePayments.capturedCount,
        note: 'OxSteed take-rate on protected job payments, escrow coverage, and brokered work.',
        sources: ['platform_ledger', 'payments'],
      },
      {
        key: 'consulting',
        label: 'Consulting packages',
        category: 'direct_revenue',
        trackingStatus: 'live_revenue',
        periodCents: consulting.completedPeriodCents,
        lifetimeCents: consulting.completedLifetimeCents,
        pendingCents: consulting.pendingCents,
        refundsCents: consulting.refundedPeriodCents,
        count: consulting.completedCount,
        note: 'Direct OxSteed consulting revenue from strategy, launch, and implementation packages.',
        sources: ['consulting_payments'],
      },
      {
        key: 'marketplace_orders',
        label: 'Marketplace commerce',
        category: 'volume_signal',
        trackingStatus: 'volume_only',
        periodCents: marketplace.periodGmvCents,
        lifetimeCents: marketplace.lifetimeGmvCents,
        pendingCents: marketplace.pendingCents,
        refundsCents: marketplace.refundedPeriodCents,
        count: marketplace.paidOrderCount,
        note: 'Tracks gross merchandise volume. The codebase does not yet expose a separate OxSteed platform cut here.',
        sources: ['marketplace_orders', 'marketplace_transactions'],
      },
      {
        key: 'api_products',
        label: 'API products and recurring digital sales',
        category: 'volume_signal',
        trackingStatus: 'volume_only',
        periodCents: apiProducts.monthlyRevenueSnapshotCents,
        lifetimeCents: apiProducts.monthlyRevenueSnapshotCents,
        pendingCents: 0,
        refundsCents: 0,
        count: apiProducts.activeSubscriptions,
        note: 'Current code tracks creator-side recurring revenue snapshots and active subscriptions, not a distinct OxSteed take rate.',
        sources: ['api_products', 'api_product_subscriptions'],
      },
      {
        key: 'affiliate_network',
        label: 'Affiliate network',
        category: 'partner_flow',
        trackingStatus: 'partner_payout_flow',
        periodCents: affiliates.confirmedCommissionCents + affiliates.paidCommissionCents,
        lifetimeCents: affiliates.confirmedCommissionCents + affiliates.paidCommissionCents,
        pendingCents: affiliates.pendingCommissionCents,
        refundsCents: 0,
        count: affiliates.commissionCount,
        note: 'This is partner commission flow payable out to affiliates, not direct OxSteed revenue in the current implementation.',
        sources: ['affiliate_commissions', 'affiliate_payouts'],
      },
      {
        key: 'franchise_program',
        label: 'Franchise economics',
        category: 'configured_program',
        trackingStatus: 'configured_program_economics',
        periodCents: franchise.signedInitialFeesCents,
        lifetimeCents: franchise.signedInitialFeesCents,
        pendingCents: franchise.pendingInitialFeesCents,
        refundsCents: 0,
        count: franchise.pipelineApplications,
        note: 'Captures configured initial fees, royalties, and marketing fees for signed and in-flight franchise agreements.',
        sources: ['franchise_programs', 'franchise_agreements', 'franchise_applications'],
      },
    ];

    if (otherLiveLedgerSources.length) {
      channels.push({
        key: 'other_live_ledger',
        label: 'Other ledger-coded revenue',
        category: 'direct_revenue',
        trackingStatus: 'live_revenue',
        periodCents: otherLiveLedgerSources.reduce((sum, row) => sum + row.periodCents, 0),
        lifetimeCents: otherLiveLedgerSources.reduce((sum, row) => sum + row.lifetimeCents, 0),
        pendingCents: 0,
        refundsCents: 0,
        count: otherLiveLedgerSources.length,
        note: `Additional ledger source types currently posting revenue: ${otherLiveLedgerSources.map((row) => row.source).join(', ')}.`,
        sources: ['platform_ledger'],
      });
    }

    const recentMovements = [...ledgerMovements, ...consulting.recent]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 12);

    res.json({
      period,
      summary: {
        trackedRevenuePeriodCents,
        trackedRevenueLifetimeCents,
        trackedGrowth: Math.round(trackedGrowth * 10) / 10,
        ledgerRevenuePeriodCents,
        consultingRevenuePeriodCents: consulting.completedPeriodCents,
        refundsPeriodCents: ledgerRefundsPeriodCents + consulting.refundedPeriodCents,
        gmvPeriodCents: marketplace.periodGmvCents,
        pipelineCents: consulting.pendingCents + marketplace.pendingCents + franchise.pendingInitialFeesCents,
        outflowsLifetimeCents: ledgerOutflowsLifetimeCents + affiliates.payoutsCompletedCents,
      },
      channels,
      controls: {
        pricingOverrides: pricing.overrideCount,
        overrideCountries: pricing.overrideCountries,
        feeSettings: pricing.feeSettings,
        franchiseRoyaltyBps: franchise.averageRoyaltyBps,
        franchiseMarketingFeeBps: franchise.averageMarketingFeeBps,
      },
      diagnostics: {
        activeSubscriptions,
        launchedFranchiseStores: franchise.launchedStores,
        publishedApiProducts: apiProducts.publishedCount,
        recurringApiProducts: apiProducts.recurringProducts,
      },
      recentMovements,
    });
  } catch (err) {
    logger.error('getMoneyOverview error', { err });
    res.status(500).json({ error: 'Failed to fetch money overview.' });
  }
};

// PLATFORM SETTINGS
exports.getSettings = async (req, res) => {
  try {
    if (!(await tableExists('platform_settings')) || !(await tableExists('feature_flags'))) {
      return res.status(503).json({
        error: 'Platform settings are temporarily unavailable until the control-plane schema is ready.',
        code: 'admin_settings_unavailable',
      });
    }
    const [{ rows: settings }, { rows: flags }] = await Promise.all([
      db.query('SELECT * FROM platform_settings ORDER BY key ASC'),
      db.query('SELECT * FROM feature_flags ORDER BY key ASC'),
    ]);
    res.json({ settings, flags });
  } catch (err) { logger.error('getSettings error', { err }); res.status(500).json({ error: 'Failed to fetch settings.' }); }
};

exports.updateSetting = async (req, res) => {
  let client;
  try {
    client = await db.connect();
    const { key } = req.params;
    const { value } = req.body;
    const adminId = req.user.id;
    await client.query('BEGIN');
    const { rows: before } = await client.query('SELECT * FROM platform_settings WHERE key = $1 FOR UPDATE', [key]);
    if (before.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Setting "${key}" not found.` });
    }
    const parsed = parsePlatformSettingValue(before[0], value);
    if (parsed.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: parsed.error, code: 'invalid_setting_value' });
    }
    await client.query('UPDATE platform_settings SET value = $1, version = COALESCE(version, 1) + 1, updated_by = $2, updated_at = now() WHERE key = $3', [parsed.value, adminId, key]);
    await logAdminAction({
      client,
      adminId,
      action: 'platform_setting_updated',
      targetType: 'platform_setting',
      targetKey: key,
      description: `Setting "${key}" updated`,
      before: { value: before[0].value, version: before[0].version || 1 },
      after: { value: parsed.value, version: (before[0].version || 1) + 1 },
      req,
      throwOnError: true,
    });
    await client.query('COMMIT');
    res.json({ message: `Setting "${key}" updated.` });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    logger.error('updateSetting error', { err });
    res.status(err.code === '22P02' ? 400 : 500).json({ error: err.code === '22P02' ? 'Invalid setting value.' : 'Failed to update setting.' });
  } finally { client?.release(); }
};

// Restore the immediately previous audited value. Rollback is itself a new
// forward change, so the audit trail remains append-only and another rollback
// can recover the prior state if an operator changes their mind.
exports.rollbackSetting = async (req, res) => {
  let client;
  try {
    client = await db.connect();
    const { key } = req.params;
    const adminId = req.user.id;
    await client.query('BEGIN');
    const { rows: currentRows } = await client.query(
      'SELECT * FROM platform_settings WHERE key = $1 FOR UPDATE',
      [key],
    );
    if (!currentRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Setting "${key}" not found.` });
    }
    const { rows: history } = await client.query(
      `SELECT before_state
         FROM admin_audit_log
        WHERE target_type = 'platform_setting'
          AND target_key = $1
          AND action IN ('platform_setting_updated', 'platform_setting_rollback')
          AND before_state IS NOT NULL
          AND before_state->>'value' IS NOT NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [key],
    );
    const previousValue = history[0]?.before_state?.value;
    if (previousValue === undefined) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'No audited previous value is available for rollback.', code: 'rollback_unavailable' });
    }
    const parsed = parsePlatformSettingValue(currentRows[0], previousValue);
    if (parsed.error) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'The audited value is no longer valid under current platform bounds.', code: 'rollback_invalidated' });
    }
    const previousVersion = currentRows[0].version || 1;
    await client.query(
      'UPDATE platform_settings SET value = $1, version = COALESCE(version, 1) + 1, updated_by = $2, updated_at = now() WHERE key = $3',
      [parsed.value, adminId, key],
    );
    await logAdminAction({
      client,
      adminId,
      action: 'platform_setting_rollback',
      targetType: 'platform_setting',
      targetKey: key,
      description: `Setting "${key}" rolled back`,
      before: { value: currentRows[0].value, version: previousVersion },
      after: { value: parsed.value, version: previousVersion + 1 },
      req,
      throwOnError: true,
    });
    await client.query('COMMIT');
    return res.json({ message: `Setting "${key}" rolled back.`, value: parsed.value });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    logger.error('rollbackSetting error', { err });
    return res.status(500).json({ error: 'Failed to roll back setting.' });
  } finally { client?.release(); }
};

exports.updateFeatureFlag = async (req, res) => {
  const { enabled } = req.body;
  const newEnabled = parseStrictBoolean(enabled);
  if (newEnabled === null) return res.status(400).json({ error: 'Feature flags must be true or false.', code: 'invalid_feature_flag_value' });
  let client;
  try {
    client = await db.connect();
    const { key } = req.params;
    const adminId = req.user.id;
    await client.query('BEGIN');
    const { rows: before } = await client.query('SELECT is_enabled FROM feature_flags WHERE key = $1 FOR UPDATE', [key]);
    if (before.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Feature flag "${key}" not found.` });
    }
    await client.query('UPDATE feature_flags SET is_enabled = $1, updated_by = $2, updated_at = now() WHERE key = $3', [newEnabled, adminId, key]);
    await logAdminAction({
      client,
      adminId,
      action: 'feature_flag_updated',
      targetType: 'feature_flag',
      targetKey: key,
      description: `Feature flag "${key}" set to ${newEnabled}`,
      before: { is_enabled: before[0].is_enabled },
      after: { is_enabled: newEnabled },
      req,
      throwOnError: true,
    });
    await client.query('COMMIT');
    res.json({ message: `Feature flag "${key}" set to ${newEnabled}.` });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    logger.error('updateFeatureFlag error', { err });
    res.status(500).json({ error: 'Failed to update feature flag.' });
  } finally { client?.release(); }
};

exports.rollbackFeatureFlag = async (req, res) => {
  let client;
  try {
    client = await db.connect();
    const { key } = req.params;
    const adminId = req.user.id;
    await client.query('BEGIN');
    const { rows: currentRows } = await client.query(
      'SELECT is_enabled FROM feature_flags WHERE key = $1 FOR UPDATE',
      [key],
    );
    if (!currentRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Feature flag "${key}" not found.` });
    }
    const { rows: history } = await client.query(
      `SELECT before_state
         FROM admin_audit_log
        WHERE target_type = 'feature_flag'
          AND target_key = $1
          AND action IN ('feature_flag_updated', 'feature_flag_rollback')
          AND before_state IS NOT NULL
          AND before_state->>'is_enabled' IS NOT NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [key],
    );
    const previousValue = history[0]?.before_state?.is_enabled;
    const previousEnabled = parseStrictBoolean(previousValue);
    if (previousEnabled === null) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'No audited previous flag state is available for rollback.', code: 'rollback_unavailable' });
    }
    await client.query(
      'UPDATE feature_flags SET is_enabled = $1, updated_by = $2, updated_at = now() WHERE key = $3',
      [previousEnabled, adminId, key],
    );
    await logAdminAction({
      client,
      adminId,
      action: 'feature_flag_rollback',
      targetType: 'feature_flag',
      targetKey: key,
      description: `Feature flag "${key}" rolled back`,
      before: { is_enabled: currentRows[0].is_enabled },
      after: { is_enabled: previousEnabled },
      req,
      throwOnError: true,
    });
    await client.query('COMMIT');
    return res.json({ message: `Feature flag "${key}" rolled back.`, enabled: previousEnabled });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    logger.error('rollbackFeatureFlag error', { err });
    return res.status(500).json({ error: 'Failed to roll back feature flag.' });
  } finally { client?.release(); }
};

// AUDIT LOG
exports.getAuditLog = async (req, res) => {
  try {
    if (!(await tableExists('admin_audit_log'))) {
      return res.status(503).json({ error: 'Audit log is temporarily unavailable.', code: 'admin_audit_unavailable' });
    }
    const pageNumber = Math.min(1000000, Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1));
    const limitNumber = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || '50'), 10) || 50));
    const { admin_id, action, target_type } = req.query;
    const offset = (pageNumber - 1) * limitNumber;
    const params = []; let paramIdx = 1; const conditions = [];
    if (admin_id) { conditions.push(`a.admin_id = $${paramIdx++}`); params.push(admin_id); }
    if (action) { conditions.push(`a.action ILIKE $${paramIdx++}`); params.push(`%${action}%`); }
    if (target_type) { conditions.push(`a.target_type = $${paramIdx++}`); params.push(target_type); }
    const wc = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(`SELECT a.*, u.first_name || ' ' || u.last_name AS admin_name, u.email AS admin_email FROM admin_audit_log a LEFT JOIN users u ON a.admin_id = u.id ${wc} ORDER BY a.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`, [...params, limitNumber, offset]);
    res.json({ log: rows, page: pageNumber, limit: limitNumber });
  } catch (err) { logger.error('getAuditLog error', { err }); res.status(500).json({ error: 'Failed to fetch audit log.' }); }
};

// DATA EXPORT
exports.exportData = async (req, res) => {
  try {
    // Exports contain controlled operational data and must never be cached by
    // a browser, proxy, or shared workstation. The route is also protected by
    // the dedicated sensitive-operation limiter in server/routes/admin.js.
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    const { type } = req.params;
    const exportLimit = 10000;
    const queries = {
      users: `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.is_active, u.created_at FROM users u WHERE u.role NOT IN ('admin','super_admin') ORDER BY u.created_at DESC LIMIT ${exportLimit}`,
      jobs: await tableExists('jobs') ? `SELECT j.id, j.title, j.status, j.created_at FROM jobs j ORDER BY j.created_at DESC LIMIT ${exportLimit}` : null,
      revenue: await tableExists('platform_ledger') ? `SELECT source_type, amount_cents, created_at FROM platform_ledger ORDER BY created_at DESC LIMIT ${exportLimit}` : null,
      bids: await tableExists('bids') ? 'SELECT b.id, b.job_id, b.helper_id, b.amount, b.status, b.created_at FROM bids b ORDER BY b.created_at DESC LIMIT 10000' : null,
      reviews: await tableExists('reviews') ? 'SELECT r.id, r.reviewer_id, r.reviewee_id, r.rating, r.comment, r.is_public, r.created_at FROM reviews r ORDER BY r.created_at DESC LIMIT 10000' : null,
      businesses: await tableExists('businesses') ? `SELECT b.id, b.user_id, b.business_name, b.business_type, b.is_active, b.created_at FROM businesses b ORDER BY b.created_at DESC LIMIT ${exportLimit}` : null,
      disputes: await tableExists('disputes') ? `SELECT d.id, d.job_id, d.opened_by, d.status, d.reason, d.resolution, d.created_at FROM disputes d ORDER BY d.created_at DESC LIMIT ${exportLimit}` : null,
      support_tickets: await tableExists('support_tickets') ? `SELECT t.id, t.user_id, t.subject, t.status, t.priority, t.created_at FROM support_tickets t ORDER BY t.created_at DESC LIMIT ${exportLimit}` : null,
    };
    if (!queries[type]) return res.status(400).json({ error: 'Invalid or unavailable export type.' });
    const { rows } = await db.query(queries[type]);
    if (!rows.length) return res.json({ data: [], csv: '' });
    const csvCell = (val) => {
      if (val === null || val === undefined) return '';
      let str = String(val);
      // Prevent spreadsheet formula execution when an exported value starts
      // with a formula-capable character.
      if (/^[=+\-@]/.test(str)) str = `'${str}`;
      return `"${str.replace(/"/g, '""')}"`;
    };
    const headers = Object.keys(rows[0]).map(csvCell).join(',');
    const csvRows = rows.map(row => Object.values(row).map(csvCell).join(','));
    await logAdminAction({
      adminId: req.user.id,
      action: 'data_exported',
      targetType: 'export',
      targetKey: type,
      description: `Exported ${type} data (up to ${exportLimit} rows)`,
      req,
    });
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
//   - Active jobs (published through in_progress per job_status enum): block with 409
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
      `SELECT ${selectCols.join(', ')} FROM users WHERE ${userIdEq('id')}`,
      [String(userId)],
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
         WHERE (${userIdEq('client_id')} OR ${userIdEq('assigned_helper_id')})
           AND status IN ${ACTIVE_JOB_STATUS_SQL_IN}`,
        [String(userId)]
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
         WHERE (${userIdEq('payer_id')} OR ${userIdEq('payee_id')})
           AND status IN ('pending', 'authorized', 'processing', 'captured')
         LIMIT 10`,
        [String(userId)]
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
       WHERE ${userIdEq('b.user_id')}`,
      [String(userId)]
    ).catch(() => ({ rows: [{ count: 0 }] }));
    const memberCount = parseInt(teamMembers[0]?.count || 0);

    // ── Lock the account immediately ──────────────────────────────────────

    try {
      await tokenRevocationService.revokeAllUserTokens(userId);
    } catch (err) {
      if (err?.code === 'token_revocation_unavailable') {
        return res.status(503).json({
          error: 'Account deletion is temporarily unavailable. Please retry.',
          code: 'token_revocation_unavailable',
          retryable: true,
        });
      }
      throw err;
    }
    try {
      await db.query(
        `UPDATE sessions SET is_valid = false WHERE ${userIdEq('user_id')}`,
        [String(userId)],
      );
    } catch { /* non-fatal */ }
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
      const params = [String(userId)];
      let pi = 2;

      if (hasDeletionScheduled) { sets.push(`deletion_scheduled_at = $${pi++}`); params.push(thirtyDaysFromNow); }
      if (hasDeletionType)      { sets.push(`deletion_type = $${pi++}`); params.push('admin'); }
      if (hasDeletionReason)    { sets.push(`deletion_reason = $${pi++}`); params.push(reason || null); }
      if (hasDeletionAdminId)   { sets.push(`deletion_admin_id = $${pi++}`); params.push(adminId); }
      if (hasWasBanned)         { sets.push(`was_banned_at_deletion = $${pi++}`); params.push(user.is_banned || false); }
      if (hasOriginalEmailHash) { sets.push(`original_email_hash = $${pi++}`); params.push(originalEmailHash); }

      await db.query(`UPDATE users SET ${sets.join(', ')} WHERE ${userIdEq('id')}`, params);
    } else {
      // Fallback: migration 165 not yet applied — use only pre-existing columns
      // Still locks the account and marks deleted_at; no 30-day scheduling yet
      logger.warn('deleteUser: migration 165 columns not present — using legacy soft-delete fallback', { userId });
      await db.query(
        `UPDATE users SET is_active = FALSE, deleted_at = NOW(), updated_at = NOW() WHERE ${userIdEq('id')}`,
        [String(userId)]
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

    const graceEndIso = hasMig165 ? thirtyDaysFromNow.toISOString() : null;
    await notifyUserAccountEvent(userId, {
      type: 'account_deletion_scheduled',
      data: {
        deletionNotice: 'account_deletion_scheduled',
        hasMigration165: Boolean(hasMig165),
        graceEndIso: graceEndIso || null,
        reason: reason || null,
      },
    });

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
    logger.error('deleteUser error', { err, message: err.message, code: err.code, detail: err.detail, hint: err.hint, where: err.where });

    // Map known PostgreSQL / application errors to specific messages
    const pgCode = err.code;
    let userMessage = 'Failed to delete user.';
    let detail = null;

    if (pgCode === '22P02') {
      const msg = err.message || '';
      if (/enum/i.test(msg) && /job_status/i.test(msg)) {
        userMessage = 'Account deletion check failed due to a job status mismatch.';
        detail =
          'The database job_status enum does not match the status values used in the guard query. '
          + 'Report this error (and the log line) so the active-status list can be aligned with your schema.';
      } else {
        userMessage = 'Invalid data type in the request or database.';
        detail =
          'PostgreSQL could not compare the user id to a column (often jobs/payments use BIGINT while users.id is UUID), '
          + 'or an enum/cast failed. Check server logs for message and position. '
          + 'Verify the URL user id matches your users.id type.';
      }
    } else if (pgCode === '23503') {
      userMessage = 'Cannot delete this account because it is still referenced by another record.';
      detail = 'A foreign-key constraint blocked the deletion. Check for pending payments, escrow holds, or other linked records.';
    } else if (pgCode === '23505') {
      userMessage = 'A conflict occurred while updating the account status.';
      detail = 'Concurrent modification detected. Reload the page and try again.';
    } else if (pgCode === '42703') {
      userMessage = 'Database schema mismatch: a required column does not exist.';
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

// RESTORE USER ACCOUNT — cancel pending admin deletion / reinstate (super_admin only)
// Clears soft-delete + migration-165 schedule when the account is locked for admin deletion
// (deleted_at and/or deletion_scheduled_at). 30-day window enforced only when a schedule exists.
exports.restoreUser = async (req, res) => {
  try {
    const { userId } = req.params;
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
       FROM users WHERE id::text = $1`,
      [String(userId)]
    );
    if (!userRows.length) return res.status(404).json({ error: 'User not found.' });
    const user = userRows[0];

    if (user.deletion_type === 'self') {
      return res.status(409).json({
        error: 'This account was self-deleted by the user. Admin restoration is not permitted for self-deletes. If you believe this account should be reopened, contact the legal team.',
      });
    }

    const hasPendingSchedule = Boolean(user.deletion_scheduled_at);
    const lockedForDeletion = Boolean(user.deleted_at || hasPendingSchedule);

    if (!lockedForDeletion) {
      return res.status(409).json({ error: 'This account is not currently scheduled for deletion.' });
    }

    if (hasPendingSchedule) {
      const now = new Date();
      const scheduledFor = new Date(user.deletion_scheduled_at);
      if (now >= scheduledFor) {
        return res.status(409).json({
          error: 'The 30-day recovery window has expired. This account has been permanently deleted and cannot be restored.',
        });
      }
    }

    await reinstateAfterPendingAdminDeletion(userId);

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

    await notifyUserAccountEvent(userId, {
      type: 'account_restored',
      action_url: '/login',
    });

    res.json({
      message: `Account for ${user.email} has been restored. The user may log in again.`,
    });
  } catch (err) {
    logger.error('restoreUser error', { err });
    const pgCode = err.code;
    let userMessage = 'Failed to restore user account.';
    let detail = null;
    if (pgCode === '42703') {
      userMessage = 'Database schema mismatch: a required column does not exist.';
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

/**
 * POST /admin/users/:userId/cancel-pending-deletion
 * Super-admin: same reinstatement as restore when a future deletion_scheduled_at exists.
 */
exports.cancelPendingDeletion = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;
    const { rows } = await db.query(
      `SELECT id, email, first_name, role, deletion_scheduled_at, deletion_type
       FROM users WHERE id::text = $1`,
      [String(userId)],
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    if (['admin', 'super_admin'].includes(rows[0].role)) {
      return res.status(403).json({ error: 'Cannot modify admin accounts.' });
    }
    if (!rows[0].deletion_scheduled_at) {
      return res.status(409).json({ error: 'This account has no pending scheduled deletion.' });
    }
    if (rows[0].deletion_type === 'self') {
      return res.status(409).json({
        error: 'Cannot cancel a self-service deletion from this endpoint.',
      });
    }
    await reinstateAfterPendingAdminDeletion(userId);
    try {
      await logAdminAction({
        adminId,
        action: 'user_pending_deletion_cancelled',
        targetType: 'user',
        targetId: userId,
        description: `Cancelled scheduled deletion for ${rows[0].email}`,
        before: { deletion_scheduled_at: rows[0].deletion_scheduled_at },
        after: { deletion_scheduled_at: null, deleted_at: null },
        req,
      });
    } catch { /* non-fatal */ }

    await notifyUserAccountEvent(userId, {
      type: 'account_restored',
      action_url: '/login',
    });

    res.json({ message: `Pending deletion cleared for ${rows[0].email}.` });
  } catch (err) {
    logger.error('cancelPendingDeletion error', { err });
    res.status(500).json({ error: 'Failed to cancel pending deletion.' });
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

// GET /admin/super/internal-staff
exports.getInternalStaffAccounts = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        u.id, u.first_name, u.last_name, u.email, u.role, u.logistics_role,
        u.is_active, u.created_at, u.last_login_at
      FROM users u
      WHERE u.role IN ('employee', 'admin', 'super_admin')
      ORDER BY
        CASE
          WHEN u.role = 'super_admin' THEN 0
          WHEN u.role = 'admin' THEN 1
          ELSE 2
        END,
        u.created_at ASC
    `);
    res.json({ accounts: rows });
  } catch (err) {
    logger.error('getInternalStaffAccounts error', { err });
    res.status(500).json({ error: 'Failed to fetch internal staff accounts.' });
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
    await db.query(
      `UPDATE sessions SET is_valid = false WHERE ${userIdEq('user_id')}`,
      [String(id)],
    );
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
    await db.query(
      `UPDATE sessions SET is_valid = false WHERE ${userIdEq('user_id')}`,
      [String(userId)],
    );
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
    const clientMessageId = req.get?.('Idempotency-Key')
      || req.body?.clientMessageId
      || req.body?.client_message_id
      || null;

    if (!content?.trim()) {
      return res.status(400).json({ error: 'Message content is required.' });
    }
    if (content.length > 4000) {
      return res.status(400).json({ error: 'Message must be 4000 characters or fewer.' });
    }
    if (clientMessageId && !UUID_RE.test(String(clientMessageId).trim())) {
      return res.status(400).json({ error: 'clientMessageId must be a valid UUID' });
    }

    // Verify target user exists, is not an admin, and is not soft-deleted (scheduled deletion
    // locks the row — use cancel-pending-deletion / restore first).
    const { rows: targetRows } = await db.query(
      `SELECT id, first_name, last_name, email, role FROM users
       WHERE id::text = $1
         AND role NOT IN ('admin', 'super_admin')
         AND deleted_at IS NULL`,
      [String(userId)]
    );
    if (!targetRows.length) return res.status(404).json({ error: 'User not found.' });

    const adminId  = req.user.id;
    const targetId = userId;

    // All conversation + message writes in one transaction to prevent
    // orphaned conversations on failure and race-condition duplicates.
    const client = await db.connect();
    let conversationId, msgRows, replayed = false;
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
          ON CONFLICT DO NOTHING
          RETURNING id
        `, [adminId, targetId]);
        conversationId = newConv[0]?.id;
        if (!conversationId) {
          const { rows: raced } = await client.query(`
            SELECT id FROM conversations
            WHERE job_id IS NULL AND customer_id = $1 AND helper_id = $2
            LIMIT 1
            FOR UPDATE
          `, [adminId, targetId]);
          conversationId = raced[0]?.id;
        }
      }

      if (!conversationId) throw new Error('Failed to resolve admin conversation');

      // Insert the message
      const result = await client.query(`
        INSERT INTO messages (conversation_id, sender_id, content, message_type, client_message_id)
        VALUES ($1, $2, $3, 'system', $4)
        ON CONFLICT (conversation_id, client_message_id)
        WHERE client_message_id IS NOT NULL DO NOTHING
        RETURNING id, created_at
      `, [conversationId, adminId, content.trim(), clientMessageId]);
      msgRows = result.rows;
      replayed = !msgRows[0] && Boolean(clientMessageId);
      if (!msgRows[0] && clientMessageId) {
        const existingMessage = await client.query(`
          SELECT id, created_at FROM messages
          WHERE conversation_id = $1 AND client_message_id = $2
        `, [conversationId, clientMessageId]);
        msgRows = existingMessage.rows;
      }
      if (!msgRows[0]) throw new Error('Message insert did not return a row');

      // Update conversation timestamp
      if (!replayed) {
        await client.query(
          `UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [conversationId]
        );
        await enqueueMessageNotification({
          dbClient: client,
          messageId: msgRows[0].id,
          conversationId,
          recipientId: targetId,
          senderName: 'OxSteed Admin',
          body: content.trim(),
          actionUrl: `/messages/${conversationId}`,
        });
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    if (!replayed) {
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
    }

    res.status(replayed ? 200 : 201).json({
      conversation_id: conversationId,
      message_id:      msgRows[0].id,
      created_at:      msgRows[0].created_at,
      ...(replayed ? { idempotent: true } : {}),
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

    // Revoke existing tokens before changing the password. A revocation-store
    // outage must block the password change rather than leave the old session
    // usable after the admin believes credentials were rotated.
    try {
      await tokenRevocationService.revokeAllUserTokens(userId);
    } catch (err) {
      if (err?.code === 'token_revocation_unavailable') {
        return res.status(503).json({
          error: 'Password change is temporarily unavailable. Please retry.',
          code: 'token_revocation_unavailable',
          retryable: true,
        });
      }
      throw err;
    }

    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash(password, 12);
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, userId],
    );

    await db.query(
      `UPDATE sessions SET is_valid = false WHERE ${userIdEq('user_id')}`,
      [String(userId)],
    );
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
      `SELECT id, first_name, last_name, email, role, is_active FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    const target = rows[0];

    // Prevent impersonating other admins
    if (['admin', 'super_admin'].includes(target.role)) {
      return res.status(403).json({ error: 'Cannot impersonate admin accounts.' });
    }
    // H8b/M23: refuse impersonating deactivated accounts.
    if (target.is_active === false) {
      return res.status(403).json({ error: 'Cannot impersonate a deactivated account.' });
    }

    const jti = crypto.randomUUID();

    // Log the session
    await db.query(
      `INSERT INTO user_impersonation_log (admin_id, target_user_id, token_jti, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, userId, jti, req.ip || null, req.headers['user-agent'] || null]
    );

    // H8b: the JWT never goes in the URL. Issue a one-time, 60s exchange code;
    // the /impersonate page swaps it for the JWT via an authenticated POST.
    const exchangeCode = crypto.randomBytes(32).toString('hex');
    const exchangeCodeHash = crypto.createHash('sha256').update(exchangeCode).digest('hex');
    await db.query(
      `UPDATE user_impersonation_log
          SET exchange_code_hash = $1,
              exchange_code_expires_at = NOW() + INTERVAL '60 seconds',
              exchange_code_used_at = NULL
        WHERE admin_id = $2 AND token_jti = $3`,
      [exchangeCodeHash, adminId, jti]
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

    // H8b: return the one-time exchange code, not the JWT.
    res.json({
      exchangeCode,
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
 * POST /admin/users/impersonate/exchange
 * Swaps a one-time exchange code for the impersonation JWT. Authenticated by
 * the admin's own Bearer token; code is single-use, 60s expiry, admin-bound.
 */
exports.exchangeImpersonationCode = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Exchange code required.' });
    const codeHash = crypto.createHash('sha256').update(String(code)).digest('hex');
    const { rows } = await db.query(
      `UPDATE user_impersonation_log
          SET exchange_code_used_at = NOW()
        WHERE exchange_code_hash = $1 AND admin_id = $2
          AND exchange_code_expires_at > NOW()
          AND exchange_code_used_at IS NULL AND ended_at IS NULL
        RETURNING token_jti, target_user_id`,
      [codeHash, adminId]
    );
    if (!rows.length) return res.status(410).json({ error: 'Exchange code invalid, expired, or already used.' });
    const { rows: trows } = await db.query(
      `SELECT id, first_name, last_name, email, role FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [rows[0].target_user_id]
    );
    if (!trows.length) return res.status(404).json({ error: 'User not found.' });
    const target = trows[0];
    const impersonationToken = jwt.sign(
      { id: target.id, email: target.email, role: target.role, impersonation: true, impersonated_by: adminId, jti: rows[0].token_jti },
      process.env.JWT_SECRET, { expiresIn: '30m', algorithm: 'HS256' }
    );
    res.json({ impersonationToken, userId: target.id });
  } catch (err) {
    logger.error('exchangeImpersonationCode error', { err });
    res.status(500).json({ error: 'Failed to exchange impersonation code.' });
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
    const adminId = req.user.id;

    // M23: only the admin who started the session can end it.
    await db.query(
      `UPDATE user_impersonation_log SET ended_at = NOW() WHERE token_jti = $1 AND admin_id = $2 AND ended_at IS NULL`,
      [jti, adminId]
    );

    // Revoke the JWT itself: impersonation tokens skip the standard token
    // blacklist in the auth middleware, so record the jti in the revocation
    // store. Fail closed: if revocation fails, return 500 so the caller
    // knows the session may still be active.
    try {
      await tokenRevocationService.revokeImpersonationSession(jti);
    } catch (revokeErr) {
      logger.error('endImpersonation: failed to revoke impersonation jti', { jti, error: revokeErr.message });
      return res.status(500).json({ error: 'Failed to revoke impersonation session. It may still be active.' });
    }

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
    const parsedLimit = parseInt(req.query.limit || '100', 10);
    const parsedOffset = parseInt(req.query.offset || '0', 10);
    const limit  = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 100;
    const offset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1_000_000) : 0;

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

    const { rows: existing } = await db.query('SELECT id, email, first_name, role FROM users WHERE id = $1', [userId]);
    if (!existing.length) return res.status(404).json({ error: 'User not found.' });
    if (['admin', 'super_admin'].includes(existing[0].role)) {
      return res.status(403).json({ error: 'Cannot suspend admin accounts.' });
    }

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

    const untilText = suspendedUntil
      ? ` Your suspension is set to lift on ${suspendedUntil.toISOString()} (UTC), unless an administrator changes it.`
      : ' This suspension has no automatic end date; an administrator must lift it.';
    await notifyUserAccountEvent(userId, {
      type: 'account_suspended',
      data: {
        untilText,
        reason: reason.trim(),
      },
    });

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

    await notifyUserAccountEvent(userId, {
      type: 'account_restricted',
      data: {
        reason: reason.trim(),
      },
      action_url: '/settings',
    });

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

    // In-app + email (transactional) for official warnings
    await notifyUserAccountEvent(userId, {
      type: 'admin_warning',
      data: {
        reason: reason.trim(),
      },
      action_url: '/support',
    });

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
       WHERE id::text = $1
       RETURNING id, email, first_name`,
      [String(userId)]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    try { await reinstateAfterPendingAdminDeletion(userId); } catch (e) {
      logger.warn('reactivateUser: reinstate failed', { userId, err: e.message });
    }

    await logUserAction({ adminId, targetUserId: userId, actionType: 'account_reactivated', notes: notes.trim() || null, ipAddress: req.ip });
    await logAdminAction({ adminId, action: 'user_reactivated', targetType: 'user', targetId: userId, description: notes.trim() || 'Account reactivated by admin', req });

    await notifyUserAccountEvent(userId, {
      type: 'account_restored',
      data: {
        notes: notes.trim(),
      },
      action_url: '/login',
    });

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

// Shared with the settings-change workflow (settingsChangeController.js) so
// change requests validate values through the exact same parse path as the
// direct updateSetting / updateFeatureFlag routes. Additive export only.
module.exports.parsePlatformSettingValue = parsePlatformSettingValue;
module.exports.parseStrictBoolean = parseStrictBoolean;
