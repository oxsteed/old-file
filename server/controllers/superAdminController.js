const db                    = require('../db');
const { logAdminAction }    = require('../services/auditService');
const { issueRefund }       = require('../services/stripeService');
const { sendNotification }  = require('../services/notificationService');

// ═══════════════════════════════════════════════════════════════
// DASHBOARD OVERVIEW
// ═══════════════════════════════════════════════════════════════

exports.getDashboardStats = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        -- Users
        (SELECT COUNT(*) FROM users WHERE role NOT IN ('admin','super_admin'))
          AS total_users,
        (SELECT COUNT(*) FROM users
          WHERE role NOT IN ('admin','super_admin')
            AND created_at >= now() - interval '30 days')
          AS new_users_30d,
        (SELECT COUNT(*) FROM users WHERE role IN ('helper','helper_pro'))
          AS total_helpers,
        (SELECT COUNT(*) FROM users WHERE role = 'broker')
          AS total_brokers,

        -- Jobs
        (SELECT COUNT(*) FROM jobs)
          AS total_jobs,
        (SELECT COUNT(*) FROM jobs WHERE status = 'published')
          AS open_jobs,
        (SELECT COUNT(*) FROM jobs WHERE status = 'in_progress')
          AS active_jobs,
        (SELECT COUNT(*) FROM jobs WHERE status = 'completed')
          AS completed_jobs,
        (SELECT COUNT(*) FROM jobs
          WHERE created_at >= now() - interval '30 days')
          AS new_jobs_30d,

        -- Revenue
        (SELECT COALESCE(SUM(amount_cents),0) FROM platform_ledger
          WHERE source_type IN ('job_fee','subscription')
            AND amount_cents > 0)
          AS total_revenue_cents,
        (SELECT COALESCE(SUM(amount_cents),0) FROM platform_ledger
          WHERE source_type IN ('job_fee','subscription')
            AND amount_cents > 0
            AND created_at >= date_trunc('month', now()))
          AS revenue_mtd_cents,
        (SELECT COALESCE(SUM(amount_cents),0) FROM platform_ledger
          WHERE source_type = 'subscription'
            AND amount_cents > 0
            AND created_at >= date_trunc('month', now()))
          AS subscription_revenue_mtd_cents,

        -- Subscriptions
        (SELECT COUNT(*) FROM subscriptions WHERE status = 'active')
          AS active_subscriptions,

        -- Disputes
        (SELECT COUNT(*) FROM jobs WHERE dispute_status = 'open')
          AS open_disputes
    `);

    const stats = rows[0];

    // MRR calculation
    const { rows: mrrRows } = await db.query(`
      SELECT
        p.amount_cents,
        COUNT(s.id) AS count
      FROM subscriptions s
      JOIN plans p ON s.plan_id = p.id
      WHERE s.status = 'active'
      GROUP BY p.amount_cents
    `);

    const mrr = mrrRows.reduce(
      (sum, r) => sum + (parseInt(r.amount_cents) * parseInt(r.count)),
      0
    );

    res.json({ stats, mrr });
  } catch (err) {
    console.error('getDashboardStats error:', err);
    res.status(500).json({ error: 'Failed to load dashboard stats.' });
  }
};

// ─── Revenue Chart Data ───────────────────────────────────────────
exports.getRevenueChart = async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const intervalMap = {
      '7d':  { interval: '7 days',  trunc: 'day' },
      '30d': { interval: '30 days', trunc: 'day' },
      '90d': { interval: '90 days', trunc: 'week' },
      '1y':  { interval: '1 year',  trunc: 'month' }
    };
    const { interval, trunc } = intervalMap[period] || intervalMap['30d'];

    const { rows } = await db.query(`
      SELECT
        date_trunc($1, created_at) AS period,
        SUM(CASE WHEN source_type = 'job_fee'
          THEN amount_cents ELSE 0 END) AS job_fee_cents,
        SUM(CASE WHEN source_type = 'subscription'
          THEN amount_cents ELSE 0 END) AS subscription_cents,
        SUM(CASE WHEN amount_cents < 0
          THEN ABS(amount_cents) ELSE 0 END) AS refunds_cents,
        SUM(GREATEST(amount_cents, 0)) AS gross_cents
      FROM platform_ledger
      WHERE created_at >= now() - $2::interval
        AND source_type IN ('job_fee','subscription','refund')
      GROUP BY date_trunc($1, created_at)
      ORDER BY period ASC
    `, [trunc, interval]);

    res.json({ chart: rows, period });
  } catch (err) {
    console.error('getRevenueChart error:', err);
    res.status(500).json({ error: 'Failed to load revenue chart.' });
  }
};

// ═══════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════

exports.getUsers = async (req, res) => {
  try {
    const {
      search, role, status,
      plan, page = 1, limit = 25,
      sort = 'created_at', order = 'desc'
    } = req.query;

    const offset = (page - 1) * limit;
    const params = [];
    let paramIdx = 1;
    let conditions = [`u.role NOT IN ('admin','super_admin')`];

    if (search) {
      conditions.push(`(
        u.first_name ILIKE $${paramIdx}
        OR u.last_name ILIKE $${paramIdx}
        OR u.email ILIKE $${paramIdx}
      )`);
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (role) {
      conditions.push(`u.role = $${paramIdx++}`);
      params.push(role);
    }
    if (status === 'active') {
      conditions.push(`u.is_active = true`);
    } else if (status === 'banned') {
      conditions.push(`u.is_active = false`);
    }
    if (plan) {
      conditions.push(`p.slug = $${paramIdx++}`);
      params.push(plan);
    }

    const allowedSorts = ['created_at','last_login_at','first_name','email'];
    const safeSort = allowedSorts.includes(sort) ? sort : 'created_at';
    const safeOrder = order === 'asc' ? 'ASC' : 'DESC';

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const { rows: users } = await db.query(`
      SELECT
        u.id, u.first_name, u.last_name, u.email,
        u.role, u.is_active, u.phone,
        u.created_at, u.last_login_at,
        u.email_verified,
        u.subscription_status AS user_sub_status,
        p.slug AS plan_slug,
        p.name AS plan_name,
        s.status AS subscription_status,
        s.current_period_end,
        hp.avg_rating,
        hp.completed_jobs_count,
        hp.total_reviews,
        hp.is_background_checked,
        hp.is_identity_verified,
        hp.tier AS helper_tier,
        (SELECT COUNT(*) FROM jobs
          WHERE client_id = u.id) AS jobs_posted,
        (SELECT COUNT(*) FROM jobs
          WHERE assigned_helper_id = u.id
            AND status = 'completed') AS jobs_completed_as_helper
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
      LEFT JOIN plans p ON p.id = s.plan_id
      LEFT JOIN helper_profiles hp ON hp.user_id = u.id
      ${whereClause}
      ORDER BY u.${safeSort} ${safeOrder}
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, limit, offset]);

    const { rows: countRows } = await db.query(`
      SELECT COUNT(*) FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
      LEFT JOIN plans p ON p.id = s.plan_id
      ${whereClause}
    `, params);

    res.json({
      users,
      total: parseInt(countRows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(countRows[0].count / limit)
    });
  } catch (err) {
    console.error('getUsers error:', err);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
};

// ─── Get single user detail ───────────────────────────────────────
exports.getUserDetail = async (req, res) => {
  try {
    const { userId } = req.params;

    const { rows: userRows } = await db.query(`
      SELECT
        u.*,
        p.slug AS plan_slug, p.name AS plan_name,
        s.status AS sub_status,
        s.stripe_subscription_id,
        s.current_period_start,
        s.current_period_end,
        s.cancel_at_period_end,
        hp.bio_short, hp.bio_long,
        hp.avg_rating, hp.total_reviews,
        hp.completed_jobs_count,
        hp.is_background_checked,
        hp.is_identity_verified,
        hp.tier AS helper_tier,
        hp.hourly_rate_min, hp.hourly_rate_max,
        hp.service_city, hp.service_state,
        hp.stripe_account_id,
        hp.stripe_charges_enabled,
        hp.stripe_payouts_enabled
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
      LEFT JOIN plans p ON p.id = s.plan_id
      LEFT JOIN helper_profiles hp ON hp.user_id = u.id
      WHERE u.id = $1
    `, [userId]);

    if (!userRows.length) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Recent jobs
    const { rows: recentJobs } = await db.query(`
      SELECT id, title, status, job_value, created_at
      FROM jobs
      WHERE client_id = $1 OR assigned_helper_id = $1
      ORDER BY created_at DESC LIMIT 10
    `, [userId]);

    // Recent reviews
    const { rows: recentReviews } = await db.query(`
      SELECT r.rating, r.comment, r.created_at,
        u.first_name || ' ' || u.last_name AS reviewer_name
      FROM reviews r
      JOIN users u ON r.reviewer_id = u.id
      WHERE r.reviewee_id = $1
      ORDER BY r.created_at DESC LIMIT 5
    `, [userId]);

    res.json({
      user: userRows[0],
      recentJobs,
      recentReviews
    });
  } catch (err) {
    console.error('getUserDetail error:', err);
    res.status(500).json({ error: 'Failed to fetch user detail.' });
  }
};

// ─── Ban / Unban user ─────────────────────────────────────────────
exports.toggleUserBan = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;

    const { rows: before } = await db.query(
      `SELECT is_active, role FROM users WHERE id = $1`,
      [userId]
    );
    if (!before.length) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (['admin','super_admin'].includes(before[0].role)) {
      return res.status(403).json({ error: 'Cannot ban admin accounts.' });
    }

    const newStatus = !before[0].is_active;
    await db.query(
      `UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2`,
      [newStatus, userId]
    );

    await logAdminAction({
      adminId,
      action: newStatus ? 'user_unbanned' : 'user_banned',
      targetType: 'user',
      targetId: userId,
      description: reason || null,
      before: { is_active: before[0].is_active },
      after: { is_active: newStatus },
      req
    });

    await sendNotification({
      userId,
      type: newStatus ? 'account_restored' : 'account_banned',
      title: newStatus ? 'Account restored' : 'Account suspended',
      body: newStatus
        ? 'Your account has been restored. Welcome back.'
        : `Your account has been suspended. Reason: ${reason || 'Policy violation'}`,
    });

    res.json({
      message: `User ${newStatus ? 'unbanned' : 'banned'} successfully.`,
      is_active: newStatus
    });
  } catch (err) {
    console.error('toggleUserBan error:', err);
    res.status(500).json({ error: 'Failed to update user status.' });
  }
};

// ─── Verify user (ID / background check override) ────────────────
exports.verifyUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { field } = req.body;
    const adminId = req.user.id;

    const allowed = ['is_identity_verified','is_background_checked'];
    if (!allowed.includes(field)) {
      return res.status(400).json({ error: 'Invalid verification field.' });
    }

    const value = true;
    await db.query(`
      UPDATE helper_profiles
      SET ${field} = $1, updated_at = now()
      WHERE user_id = $2
    `, [value, userId]);

    await logAdminAction({
      adminId,
      action: 'user_verified',
      targetType: 'user',
      targetId: userId,
      description: `Admin set ${field} = ${value}`,
      req
    });

    res.json({ message: `User ${field} updated successfully.` });
  } catch (err) {
    console.error('verifyUser error:', err);
    res.status(500).json({ error: 'Failed to verify user.' });
  }
};

// ─── Promote user role ────────────────────────────────────────────
exports.updateUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    const adminId = req.user.id;

    const allowed = ['customer','helper','helper_pro','broker','admin'];
    if (!allowed.includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }

    if (role === 'admin' && !req.isSuper) {
      return res.status(403).json({ error: 'Super Admin required to promote to admin.' });
    }

    const { rows: before } = await db.query(
      `SELECT role FROM users WHERE id = $1`, [userId]
    );
    await db.query(
      `UPDATE users SET role = $1, updated_at = now() WHERE id = $2`,
      [role, userId]
    );

    await logAdminAction({
      adminId,
      action: 'user_role_changed',
      targetType: 'user',
      targetId: userId,
      before: { role: before[0]?.role },
      after: { role },
      req
    });

    res.json({ message: `User role updated to ${role}.` });
  } catch (err) {
    console.error('updateUserRole error:', err);
    res.status(500).json({ error: 'Failed to update role.' });
  }
};

// ═══════════════════════════════════════════════════════════════
// JOB MANAGEMENT
// ═══════════════════════════════════════════════════════════════

exports.getJobs = async (req, res) => {
  try {
    const {
      search, status, category_id,
      page = 1, limit = 25
    } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let paramIdx = 1;
    let conditions = [];

    if (search) {
      conditions.push(`(j.title ILIKE $${paramIdx} OR j.description ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (status) {
      conditions.push(`j.status = $${paramIdx++}`);
      params.push(status);
    }
    if (category_id) {
      conditions.push(`j.category_id = $${paramIdx++}`);
      params.push(category_id);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const { rows } = await db.query(`
      SELECT
        j.id, j.title, j.status, j.budget_min, j.budget_max,
        j.job_value, j.is_broker_mediated, j.created_at,
        j.bid_count, j.location_city, j.location_state,
        j.category_name,
        u_client.first_name || ' ' || u_client.last_name AS client_name,
        u_client.email AS client_email,
        u_helper.first_name || ' ' || u_helper.last_name AS helper_name
      FROM jobs j
      JOIN users u_client ON j.client_id = u_client.id
      LEFT JOIN users u_helper ON j.assigned_helper_id = u_helper.id
      ${whereClause}
      ORDER BY j.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, limit, offset]);

    const { rows: countRows } = await db.query(`
      SELECT COUNT(*) FROM jobs j ${whereClause}
    `, params);

    res.json({
      jobs: rows,
      total: parseInt(countRows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(countRows[0].count / limit)
    });
  } catch (err) {
    console.error('getJobs error:', err);
    res.status(500).json({ error: 'Failed to fetch jobs.' });
  }
};

// ─── Force cancel a job ───────────────────────────────────────────
exports.forceJobAction = async (req, res) => {
  const dbClient = await db.connect();
  try {
    await dbClient.query('BEGIN');
    const { jobId } = req.params;
    const { action, reason } = req.body;
    const adminId = req.user.id;

    const allowed = ['cancel','remove','flag','unflag'];
    if (!allowed.includes(action)) {
      return res.status(400).json({ error: 'Invalid action.' });
    }

    const { rows: jobRows } = await dbClient.query(
      `SELECT * FROM jobs WHERE id = $1`, [jobId]
    );
    if (!jobRows.length) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    const job = jobRows[0];

    if (action === 'cancel' || action === 'remove') {
      await dbClient.query(`
        UPDATE jobs
        SET status = 'cancelled',
            updated_at = now()
        WHERE id = $1
      `, [jobId]);

      const notifications = [
        sendNotification({
          userId: job.client_id,
          type: 'job_admin_cancelled',
          title: 'Job cancelled by support',
          body: `Your job "${job.title}" was cancelled. Reason: ${reason || 'Policy violation'}`,
          data: { jobId }
        })
      ];
      if (job.assigned_helper_id) {
        notifications.push(
          sendNotification({
            userId: job.assigned_helper_id,
            type: 'job_admin_cancelled',
            title: 'Job cancelled by support',
            body: `The job "${job.title}" was cancelled by our team.`,
            data: { jobId }
          })
        );
      }
      await Promise.allSettled(notifications);
    }

    await dbClient.query('COMMIT');

    await logAdminAction({
      adminId,
      action: `job_${action}`,
      targetType: 'job',
      targetId: jobId,
      description: reason || null,
      before: { status: job.status },
      after: { status: action === 'cancel' ? 'cancelled' : job.status },
      req
    });

    res.json({ message: `Job ${action} successful.` });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    console.error('forceJobAction error:', err);
    res.status(500).json({ error: 'Failed to perform job action.' });
  } finally {
    dbClient.release();
  }
};

// ═══════════════════════════════════════════════════════════════
// FINANCIAL MANAGEMENT (Super Admin only)
// ═══════════════════════════════════════════════════════════════

exports.getFinancials = async (req, res) => {
  try {
    const { page = 1, limit = 25, type } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let paramIdx = 1;
    let condition = '';

    if (type) {
      condition = `WHERE source_type = $${paramIdx++}`;
      params.push(type);
    }

    const { rows } = await db.query(`
      SELECT
        pl.*,
        u.first_name || ' ' || u.last_name AS user_name,
        u.email AS user_email,
        j.title AS job_title
      FROM platform_ledger pl
      LEFT JOIN users u ON pl.user_id = u.id
      LEFT JOIN jobs j ON pl.job_id = j.id
      ${condition}
      ORDER BY pl.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, limit, offset]);

    const { rows: totals } = await db.query(`
      SELECT
        SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END)
          AS gross_revenue_cents,
        SUM(CASE WHEN amount_cents < 0 THEN ABS(amount_cents) ELSE 0 END)
          AS total_refunds_cents,
        SUM(amount_cents) AS net_revenue_cents,
        SUM(CASE WHEN source_type = 'subscription'
          THEN amount_cents ELSE 0 END)
          AS subscription_revenue_cents,
        SUM(CASE WHEN source_type = 'job_fee'
          THEN amount_cents ELSE 0 END)
          AS job_fee_revenue_cents
      FROM platform_ledger
    `);

    res.json({
      ledger: rows,
      totals: totals[0],
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (err) {
    console.error('getFinancials error:', err);
    res.status(500).json({ error: 'Failed to fetch financials.' });
  }
};

// ─── Issue manual refund ──────────────────────────────────────────
exports.issueManualRefund = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { reason, amount_cents } = req.body;
    const adminId = req.user.id;

    if (!reason) {
      return res.status(400).json({ error: 'Refund reason required.' });
    }

    const { rows: jobRows } = await db.query(
      `SELECT * FROM jobs WHERE id = $1`, [jobId]
    );
    if (!jobRows.length) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    const refund = await issueRefund(jobId, reason, amount_cents || null);

    await db.query(`
      UPDATE jobs SET status = 'cancelled', updated_at = now() WHERE id = $1
    `, [jobId]);

    await logAdminAction({
      adminId,
      action: 'manual_refund_issued',
      targetType: 'job',
      targetId: jobId,
      description: `Refund: ${reason}. Amount: $${(refund.amount / 100).toFixed(2)}`,
      req
    });

    res.json({
      message: `Refund of $${(refund.amount / 100).toFixed(2)} issued successfully.`,
      refundId: refund.id
    });
  } catch (err) {
    console.error('issueManualRefund error:', err);
    res.status(500).json({ error: err.message || 'Refund failed.' });
  }
};

// ─── Get all payouts (placeholder) ────────────────────────────────
exports.getPayouts = async (req, res) => {
  try {
    // Payouts table not yet created - return empty for now
    res.json({ payouts: [], page: 1, limit: 25, message: 'Payouts table pending migration.' });
  } catch (err) {
    console.error('getPayouts error:', err);
    res.status(500).json({ error: 'Failed to fetch payouts.' });
  }
};

// ═══════════════════════════════════════════════════════════════
// PLATFORM SETTINGS (Super Admin only)
// ═══════════════════════════════════════════════════════════════

exports.getSettings = async (req, res) => {
  try {
    // Check if platform_settings table exists, fall back gracefully
    let settings = [];
    try {
      const result = await db.query(
        `SELECT * FROM platform_settings ORDER BY key ASC`
      );
      settings = result.rows;
    } catch (e) {
      // Table may not exist yet
      settings = [];
    }

    const { rows: flags } = await db.query(
      `SELECT * FROM feature_flags ORDER BY key ASC`
    );

    res.json({ settings, flags });
  } catch (err) {
    console.error('getSettings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
};

exports.updateSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const adminId = req.user.id;

    const { rows: before } = await db.query(
      `SELECT value FROM platform_settings WHERE key = $1`, [key]
    );
    if (!before.length) {
      return res.status(404).json({ error: 'Setting not found.' });
    }

    await db.query(`
      UPDATE platform_settings
      SET value = $1, updated_by = $2, updated_at = now()
      WHERE key = $3
    `, [String(value), adminId, key]);

    await logAdminAction({
      adminId,
      action: 'setting_updated',
      targetType: 'setting',
      description: `Changed ${key}`,
      before: { [key]: before[0].value },
      after: { [key]: value },
      req
    });

    res.json({ message: `Setting "${key}" updated to "${value}".` });
  } catch (err) {
    console.error('updateSetting error:', err);
    res.status(500).json({ error: 'Failed to update setting.' });
  }
};

exports.updateFeatureFlag = async (req, res) => {
  try {
    const { key } = req.params;
    const { enabled } = req.body;
    const adminId = req.user.id;

    await db.query(`
      UPDATE feature_flags
      SET is_enabled = $1, updated_by = $2, updated_at = now()
      WHERE key = $3
    `, [Boolean(enabled), adminId, key]);

    await logAdminAction({
      adminId,
      action: 'feature_flag_toggled',
      targetType: 'setting',
      description: `${key} set to ${enabled}`,
      req
    });

    res.json({ message: `Feature flag "${key}" set to ${enabled}.` });
  } catch (err) {
    console.error('updateFeatureFlag error:', err);
    res.status(500).json({ error: 'Failed to update feature flag.' });
  }
};

// ─── Audit log ────────────────────────────────────────────────────
exports.getAuditLog = async (req, res) => {
  try {
    const { page = 1, limit = 50, admin_id, action, target_type } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let paramIdx = 1;
    const conditions = [];

    if (admin_id) {
      conditions.push(`a.admin_id = $${paramIdx++}`);
      params.push(admin_id);
    }
    if (action) {
      conditions.push(`a.action ILIKE $${paramIdx++}`);
      params.push(`%${action}%`);
    }
    if (target_type) {
      conditions.push(`a.target_type = $${paramIdx++}`);
      params.push(target_type);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const { rows } = await db.query(`
      SELECT
        a.*,
        u.first_name || ' ' || u.last_name AS admin_name,
        u.email AS admin_email
      FROM admin_audit_log a
      LEFT JOIN users u ON a.admin_id = u.id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, limit, offset]);

    res.json({ log: rows, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('getAuditLog error:', err);
    res.status(500).json({ error: 'Failed to fetch audit log.' });
  }
};

// ─── Data export ──────────────────────────────────────────────────
exports.exportData = async (req, res) => {
  try {
    const { type } = req.params;
    const adminId = req.user.id;

    const queries = {
      users: `
        SELECT u.id, u.first_name, u.last_name, u.email, u.role,
          u.is_active, u.created_at, p.slug AS plan,
          s.status AS subscription_status,
          hp.avg_rating, hp.completed_jobs_count
        FROM users u
        LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
        LEFT JOIN plans p ON p.id = s.plan_id
        LEFT JOIN helper_profiles hp ON hp.user_id = u.id
        WHERE u.role NOT IN ('admin','super_admin')
        ORDER BY u.created_at DESC
      `,
      jobs: `
        SELECT j.id, j.title, j.status, j.job_type,
          j.budget_min, j.budget_max, j.job_value,
          j.is_broker_mediated, j.location_city, j.location_state,
          j.bid_count, j.created_at, j.completed_at,
          j.category_name,
          u_c.email AS client_email,
          u_h.email AS helper_email
        FROM jobs j
        JOIN users u_c ON j.client_id = u_c.id
        LEFT JOIN users u_h ON j.assigned_helper_id = u_h.id
        ORDER BY j.created_at DESC
      `,
      revenue: `
        SELECT pl.source_type, pl.amount_cents, pl.currency,
          pl.description, pl.created_at,
          u.email AS user_email
        FROM platform_ledger pl
        LEFT JOIN users u ON pl.user_id = u.id
        ORDER BY pl.created_at DESC
      `
    };

    if (!queries[type]) {
      return res.status(400).json({ error: 'Invalid export type. Use: users, jobs, revenue' });
    }

    const { rows } = await db.query(queries[type]);

    await logAdminAction({
      adminId,
      action: 'data_exported',
      targetType: 'setting',
      description: `Exported ${type} data - ${rows.length} records`,
      req
    });

    if (!rows.length) {
      return res.json({ data: [], csv: '' });
    }

    const headers = Object.keys(rows[0]).join(',');
    const csvRows = rows.map(row =>
      Object.values(row).map(val => {
        if (val === null || val === undefined) return '';
        const str = String(val).replace(/"/g, '""');
        return str.includes(',') || str.includes('\n') ? `"${str}"` : str;
      }).join(',')
    );
    const csv = [headers, ...csvRows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="oxsteed_${type}_${new Date().toISOString().split('T')[0]}.csv"`
    );
    res.send(csv);
  } catch (err) {
    console.error('exportData error:', err);
    res.status(500).json({ error: 'Export failed.' });
  }
};
