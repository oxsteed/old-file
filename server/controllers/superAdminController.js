const db = require('../db');
const { logAdminAction } = require('../services/auditService');
const { issueRefund } = require('../services/stripeService');
const { sendNotification } = require('../services/notificationService');
const logger = require('../utils/logger');

// Helper: check if a table exists
async function tableExists(name) {
  try {
    const { rows } = await db.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
      [name]
    );
    return rows.length > 0;
  } catch { return false; }
}

// DASHBOARD OVERVIEW
exports.getDashboardStats = async (req, res) => {
  try {
    const hasJobs = await tableExists('jobs');
    const hasSubs = await tableExists('subscriptions');
    const hasLedger = await tableExists('platform_ledger');
    const { rows } = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role NOT IN ('admin','super_admin')) AS total_users,
        (SELECT COUNT(*) FROM users WHERE role NOT IN ('admin','super_admin') AND created_at >= now() - interval '30 days') AS new_users_30d,
        (SELECT COUNT(*) FROM users WHERE role IN ('helper','helper_pro')) AS total_helpers,
        (SELECT COUNT(*) FROM users WHERE role = 'broker') AS total_brokers,
        ${hasJobs ? "(SELECT COUNT(*) FROM jobs) AS total_jobs," : "0 AS total_jobs,"}
        ${hasJobs ? "(SELECT COUNT(*) FROM jobs WHERE status = 'published') AS open_jobs," : "0 AS open_jobs,"}
        ${hasJobs ? "(SELECT COUNT(*) FROM jobs WHERE status = 'in_progress') AS active_jobs," : "0 AS active_jobs,"}
        ${hasJobs ? "(SELECT COUNT(*) FROM jobs WHERE status = 'completed') AS completed_jobs," : "0 AS completed_jobs,"}
        ${hasJobs ? "(SELECT COUNT(*) FROM jobs WHERE created_at >= now() - interval '30 days') AS new_jobs_30d," : "0 AS new_jobs_30d,"}
        ${hasLedger ? "(SELECT COALESCE(SUM(amount_cents),0) FROM platform_ledger WHERE source_type IN ('job_fee','subscription') AND amount_cents > 0) AS total_revenue_cents," : "0 AS total_revenue_cents,"}
        ${hasLedger ? "(SELECT COALESCE(SUM(amount_cents),0) FROM platform_ledger WHERE source_type IN ('job_fee','subscription') AND amount_cents > 0 AND created_at >= date_trunc('month', now())) AS revenue_mtd_cents," : "0 AS revenue_mtd_cents,"}
        ${hasLedger ? "(SELECT COALESCE(SUM(amount_cents),0) FROM platform_ledger WHERE source_type = 'subscription' AND amount_cents > 0 AND created_at >= date_trunc('month', now())) AS subscription_revenue_mtd_cents," : "0 AS subscription_revenue_mtd_cents,"}
        ${hasSubs ? "(SELECT COUNT(*) FROM subscriptions WHERE status = 'active') AS active_subscriptions," : "0 AS active_subscriptions,"}
        ${hasJobs ? "(SELECT COUNT(*) FROM jobs WHERE dispute_status = 'open') AS open_disputes" : "0 AS open_disputes"}
    `);
    res.json({ stats: rows[0], mrr: 0 });
  } catch (err) {
    console.error('getDashboardStats error:', err);
    res.status(500).json({ error: 'Failed to load dashboard stats.' });
  }
};

exports.getRevenueChart = async (req, res) => {
  try {
    const hasLedger = await tableExists('platform_ledger');
    if (!hasLedger) return res.json({ chart: [], period: req.query.period || '30d' });
    const { period = '30d' } = req.query;
    const intervalMap = { '7d': { interval: '7 days', trunc: 'day' }, '30d': { interval: '30 days', trunc: 'day' }, '90d': { interval: '90 days', trunc: 'week' }, '1y': { interval: '1 year', trunc: 'month' } };
    const { interval, trunc } = intervalMap[period] || intervalMap['30d'];
    const { rows } = await db.query(`SELECT date_trunc($1, created_at) AS period, SUM(GREATEST(amount_cents,0)) AS gross_cents FROM platform_ledger WHERE created_at >= now() - $2::interval GROUP BY 1 ORDER BY 1 ASC`, [trunc, interval]);
    res.json({ chart: rows, period });
  } catch (err) {
    console.error('getRevenueChart error:', err);
    res.status(500).json({ error: 'Failed to load revenue chart.' });
  }
};

// USER MANAGEMENT
exports.getUsers = async (req, res) => {
  try {
    const { search, role, status, plan, page = 1, limit = 25, sort = 'created_at', order = 'desc' } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let paramIdx = 1;
    let conditions = [`u.role NOT IN ('admin','super_admin')`];
    if (search) { conditions.push(`(u.first_name ILIKE $${paramIdx} OR u.last_name ILIKE $${paramIdx} OR u.email ILIKE $${paramIdx})`); params.push(`%${search}%`); paramIdx++; }
    if (role) { conditions.push(`u.role = $${paramIdx++}`); params.push(role); }
    if (status === 'active') conditions.push(`u.is_active = true`);
    else if (status === 'banned') conditions.push(`u.is_active = false`);
    const allowedSorts = ['created_at','first_name','email'];
    const safeSort = allowedSorts.includes(sort) ? sort : 'created_at';
    const safeOrder = order === 'asc' ? 'ASC' : 'DESC';
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    // Check which optional tables exist
    const [hasSubs, hasHP, hasJobs] = await Promise.all([
      tableExists('subscriptions'),
      tableExists('helper_profiles'),
      tableExists('jobs')
    ]);
    const hasPlan = hasSubs && await tableExists('plans');
    if (plan && hasPlan) { conditions.push(`p.slug = $${paramIdx++}`); params.push(plan); }
    const wc = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const selectCols = [
      'u.id, u.first_name, u.last_name, u.email, u.role, u.is_active, u.phone, u.created_at, u.email_verified, u.subscription_status AS user_sub_status'
    ];
    const joins = [];
    if (hasSubs) { joins.push('LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = \'active\''); selectCols.push('s.status AS subscription_status, s.current_period_end'); }
    else { selectCols.push('NULL AS subscription_status, NULL AS current_period_end'); }
    if (hasPlan) { joins.push('LEFT JOIN plans p ON p.id = s.plan_id'); selectCols.push('p.slug AS plan_slug, p.name AS plan_name'); }
    else { selectCols.push('NULL AS plan_slug, NULL AS plan_name'); }
    if (hasHP) { joins.push('LEFT JOIN helper_profiles hp ON hp.user_id = u.id'); selectCols.push('hp.avg_rating, hp.completed_jobs_count, hp.total_reviews, hp.is_background_checked, hp.is_identity_verified, hp.tier AS helper_tier'); }
    else { selectCols.push('NULL AS avg_rating, NULL AS completed_jobs_count, NULL AS total_reviews, NULL AS is_background_checked, NULL AS is_identity_verified, NULL AS helper_tier'); }
    if (hasJobs) { selectCols.push("(SELECT COUNT(*) FROM jobs WHERE client_id = u.id) AS jobs_posted"); selectCols.push("(SELECT COUNT(*) FROM jobs WHERE assigned_helper_id = u.id AND status = 'completed') AS jobs_completed_as_helper"); }
    else { selectCols.push('0 AS jobs_posted, 0 AS jobs_completed_as_helper'); }
    const { rows: users } = await db.query(`
      SELECT ${selectCols.join(', ')}
      FROM users u
      ${joins.join(' ')}
      ${wc}
      ORDER BY u.${safeSort} ${safeOrder}
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, limit, offset]);
    const countJoins = hasSubs ? 'LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = \'active\'' : '';
    const countJoins2 = hasPlan ? 'LEFT JOIN plans p ON p.id = s.plan_id' : '';
    const { rows: countRows } = await db.query(`
      SELECT COUNT(*) FROM users u ${countJoins} ${countJoins2} ${wc}
    `, params);
    res.json({ users, total: parseInt(countRows[0].count), page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(countRows[0].count / limit) });
  } catch (err) {
    console.error('getUsers error:', err);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
};

exports.getUserDetail = async (req, res) => {
  try {
    const { userId } = req.params;
    const hasHP   = await tableExists('helper_profiles');
    const hasSubs = await tableExists('subscriptions');
    const hasPlan = hasSubs && await tableExists('plans');
    const hasCA   = await tableExists('connect_accounts');
    const cols = ['u.*'];
    const joins = [];
    if (hasSubs) { joins.push("LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'"); cols.push('s.status AS sub_status, s.stripe_subscription_id, s.current_period_start, s.current_period_end, s.cancel_at_period_end'); }
    if (hasPlan) { joins.push('LEFT JOIN plans p ON p.id = s.plan_id'); cols.push('p.slug AS plan_slug, p.name AS plan_name'); }
    if (hasHP)   { joins.push('LEFT JOIN helper_profiles hp ON hp.user_id = u.id'); cols.push('hp.bio_short, hp.bio_long, hp.avg_rating, hp.total_reviews, hp.completed_jobs_count, hp.is_background_checked, hp.is_identity_verified, hp.tier AS helper_tier, hp.hourly_rate_min, hp.hourly_rate_max, hp.service_city, hp.service_state, hp.stripe_account_id AS hp_stripe_account_id, hp.stripe_charges_enabled AS hp_charges_enabled, hp.stripe_payouts_enabled AS hp_payouts_enabled'); }
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
      avatar_url:          raw.profile_photo_url || null,
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

exports.toggleUserBan = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;
    const { rows: before } = await db.query('SELECT is_active, role FROM users WHERE id = $1', [userId]);
    if (!before.length) return res.status(404).json({ error: 'User not found.' });
    if (['admin','super_admin'].includes(before[0].role)) return res.status(403).json({ error: 'Cannot ban admin accounts.' });
    const newStatus = !before[0].is_active;
    await db.query('UPDATE users SET is_active = $1 WHERE id = $2', [newStatus, userId]);
    try { await logAdminAction({ adminId, action: newStatus ? 'user_unbanned' : 'user_banned', targetType: 'user', targetId: userId, description: reason || null, before: { is_active: before[0].is_active }, after: { is_active: newStatus }, req }); } catch(e) {}
    try { await sendNotification({ userId, type: newStatus ? 'account_restored' : 'account_banned', title: newStatus ? 'Account restored' : 'Account suspended', body: newStatus ? 'Your account has been restored.' : `Your account has been suspended. Reason: ${reason || 'Policy violation'}` }); } catch(e) {}
    res.json({ message: `User ${newStatus ? 'unbanned' : 'banned'} successfully.`, is_active: newStatus });
  } catch (err) { console.error('toggleUserBan error:', err); res.status(500).json({ error: 'Failed to update user status.' }); }
};

exports.verifyUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { field } = req.body;
    const adminId = req.user.id;
    const allowed = ['is_identity_verified','is_background_checked'];
    if (!allowed.includes(field)) return res.status(400).json({ error: 'Invalid verification field.' });
    if (!(await tableExists('helper_profiles'))) return res.status(400).json({ error: 'Helper profiles table not yet created.' });
    await db.query(`UPDATE helper_profiles SET ${field} = $1, updated_at = now() WHERE user_id = $2`, [true, userId]);
    try { await logAdminAction({ adminId, action: 'user_verified', targetType: 'user', targetId: userId, description: `Admin set ${field} = true`, req }); } catch(e) {}
    res.json({ message: `User ${field} updated successfully.` });
  } catch (err) { console.error('verifyUser error:', err); res.status(500).json({ error: 'Failed to verify user.' }); }
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
    await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
    try { await logAdminAction({ adminId, action: 'user_role_changed', targetType: 'user', targetId: userId, before: { role: before[0]?.role }, after: { role }, req }); } catch(e) {}
    res.json({ message: `User role updated to ${role}.` });
  } catch (err) { console.error('updateUserRole error:', err); res.status(500).json({ error: 'Failed to update role.' }); }
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
    await db.query('UPDATE users SET first_name = $1, last_name = $2, updated_at = NOW() WHERE id = $3', [trimFirst, trimLast, userId]);
    try { await logAdminAction({ adminId, action: 'user_name_changed', targetType: 'user', targetId: userId, before: { first_name: before[0].first_name, last_name: before[0].last_name }, after: { first_name: trimFirst, last_name: trimLast }, req }); } catch(e) {}
    res.json({ message: 'User name updated successfully.' });
  } catch (err) { console.error('updateUserName error:', err); res.status(500).json({ error: 'Failed to update name.' }); }
};

// JOB MANAGEMENT
exports.getJobs = async (req, res) => {
  try {
    if (!(await tableExists('jobs'))) return res.json({ jobs: [], total: 0, page: 1, limit: 25, pages: 0 });
    const { search, status, category_id, page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;
    const params = []; let paramIdx = 1; let conditions = [];
    if (search) { conditions.push(`(j.title ILIKE $${paramIdx} OR j.description ILIKE $${paramIdx})`); params.push(`%${search}%`); paramIdx++; }
    if (status) { conditions.push(`j.status = $${paramIdx++}`); params.push(status); }
    if (category_id) { conditions.push(`j.category_id = $${paramIdx++}`); params.push(category_id); }
    const wc = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(`SELECT j.id, j.title, j.status, j.budget_min, j.budget_max, j.job_value, j.is_broker_mediated, j.created_at, j.bid_count, j.location_city, j.location_state, j.category_name, u_c.first_name || ' ' || u_c.last_name AS client_name, u_c.email AS client_email, u_h.first_name || ' ' || u_h.last_name AS helper_name FROM jobs j JOIN users u_c ON j.client_id = u_c.id LEFT JOIN users u_h ON j.assigned_helper_id = u_h.id ${wc} ORDER BY j.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`, [...params, limit, offset]);
    const { rows: countRows } = await db.query(`SELECT COUNT(*) FROM jobs j ${wc}`, params);
    res.json({ jobs: rows, total: parseInt(countRows[0].count), page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(countRows[0].count / limit) });
  } catch (err) { console.error('getJobs error:', err); res.status(500).json({ error: 'Failed to fetch jobs.' }); }
};

exports.forceJobAction = async (req, res) => {
  try {
    if (!(await tableExists('jobs'))) return res.status(400).json({ error: 'Jobs table not available.' });
    const { jobId } = req.params;
    const { action, reason } = req.body;
    const adminId = req.user.id;
    const allowed = ['cancel','remove','flag','unflag'];
    if (!allowed.includes(action)) return res.status(400).json({ error: 'Invalid action.' });
    const { rows: jobRows } = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (!jobRows.length) return res.status(404).json({ error: 'Job not found.' });
    if (action === 'cancel' || action === 'remove') await db.query(`UPDATE jobs SET status = 'cancelled', updated_at = now() WHERE id = $1`, [jobId]);
    if (action === 'flag')   await db.query(`UPDATE jobs SET metadata = jsonb_set(COALESCE(metadata,'{}'), '{admin_flagged}', 'true',  true), updated_at = now() WHERE id = $1`, [jobId]);
    if (action === 'unflag') await db.query(`UPDATE jobs SET metadata = jsonb_set(COALESCE(metadata,'{}'), '{admin_flagged}', 'false', true), updated_at = now() WHERE id = $1`, [jobId]);
    try { await logAdminAction({ adminId, action: `job_${action}`, targetType: 'job', targetId: jobId, description: reason || null, req }); } catch(e) {}
    res.json({ message: `Job ${action} successful.` });
  } catch (err) { console.error('forceJobAction error:', err); res.status(500).json({ error: 'Failed to perform job action.' }); }
};

exports.deleteJob = async (req, res) => {
  try {
    if (!(await tableExists('jobs'))) return res.status(404).json({ error: 'Job not found.' });
    const { jobId } = req.params;
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason is required to delete a job.' });
    const { rows } = await db.query('SELECT id, title, client_id FROM jobs WHERE id = $1', [jobId]);
    if (!rows.length) return res.status(404).json({ error: 'Job not found.' });
    // Hard delete — cascades to bids, payments if FK'd with ON DELETE CASCADE; otherwise clean up first
    await db.query('DELETE FROM jobs WHERE id = $1', [jobId]);
    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'job_deleted',
        targetType: 'job',
        targetId: jobId,
        description: `[HARD DELETE] "${rows[0].title}" — ${reason.trim()}`,
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
    if (!(await tableExists('jobs'))) return res.status(404).json({ error: 'Job not found.' });
    const { jobId } = req.params;

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

    if (!jobRows.length) return res.status(404).json({ error: 'Job not found.' });
    const job = jobRows[0];

    let bids = [];
    if (await tableExists('bids')) {
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
    }

    let payment = null;
    if (await tableExists('payments')) {
      const r = await db.query(`
        SELECT id, status, amount, helper_payout, platform_fee,
               stripe_payment_intent_id, created_at
        FROM payments
        WHERE job_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [jobId]);
      payment = r.rows[0] || null;
    }

    res.json({ job, bids, payment });
  } catch (err) {
    logger.error('getJobDetail error', { err });
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

    const { rows } = await db.query(`
      INSERT INTO users (first_name, last_name, email, password_hash, role,
                         is_active, email_verified, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, true, true, NOW(), NOW())
      RETURNING id, first_name, last_name, email, role, is_active, email_verified, created_at
    `, [first_name.trim(), last_name.trim(), normalizedEmail, passwordHash, role]);

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
  } catch (err) { console.error('getFinancials error:', err); res.status(500).json({ error: 'Failed to fetch financials.' }); }
};

exports.issueManualRefund = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { reason, amount_cents } = req.body;
    if (!reason) return res.status(400).json({ error: 'Refund reason required.' });
    const refund = await issueRefund(jobId, reason, amount_cents || null);
    res.json({ message: `Refund issued successfully.`, refundId: refund.id });
  } catch (err) { console.error('issueManualRefund error:', err); res.status(500).json({ error: err.message || 'Refund failed.' }); }
};

exports.getPayouts = async (req, res) => {
  res.json({ payouts: [], page: 1, limit: 25, message: 'Payouts table pending migration.' });
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
  } catch (err) { console.error('getSettings error:', err); res.status(500).json({ error: 'Failed to fetch settings.' }); }
};

exports.updateSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const adminId = req.user.id;
    await db.query('UPDATE platform_settings SET value = $1, updated_by = $2, updated_at = now() WHERE key = $3', [String(value), adminId, key]);
    res.json({ message: `Setting "${key}" updated.` });
  } catch (err) { console.error('updateSetting error:', err); res.status(500).json({ error: 'Failed to update setting.' }); }
};

exports.updateFeatureFlag = async (req, res) => {
  try {
    const { key } = req.params;
    const { enabled } = req.body;
    const adminId = req.user.id;
    await db.query('UPDATE feature_flags SET is_enabled = $1, updated_by = $2, updated_at = now() WHERE key = $3', [Boolean(enabled), adminId, key]);
    res.json({ message: `Feature flag "${key}" set to ${enabled}.` });
  } catch (err) { console.error('updateFeatureFlag error:', err); res.status(500).json({ error: 'Failed to update feature flag.' }); }
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
  } catch (err) { console.error('getAuditLog error:', err); res.status(500).json({ error: 'Failed to fetch audit log.' }); }
};

// DATA EXPORT
exports.exportData = async (req, res) => {
  try {
    const { type } = req.params;
    const queries = {
      users: 'SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.is_active, u.created_at FROM users u WHERE u.role NOT IN (\'admin\',\'super_admin\') ORDER BY u.created_at DESC',
      jobs: await tableExists('jobs') ? 'SELECT j.id, j.title, j.status, j.created_at FROM jobs j ORDER BY j.created_at DESC' : null,
      revenue: await tableExists('platform_ledger') ? 'SELECT source_type, amount_cents, created_at FROM platform_ledger ORDER BY created_at DESC' : null
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
  } catch (err) { console.error('exportData error:', err); res.status(500).json({ error: 'Export failed.' }); }
};

// DELETE USER ACCOUNT
exports.deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;

    // Fetch user before deletion
    const { rows: userRows } = await db.query('SELECT id, first_name, last_name, email, role FROM users WHERE id = $1', [userId]);
    if (!userRows.length) return res.status(404).json({ error: 'User not found.' });
    const user = userRows[0];

    // Prevent deleting admin/super_admin accounts
    if (['admin', 'super_admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Cannot delete admin accounts.' });
    }

    // Delete related data in correct order to respect foreign keys
    const tablesToClean = [
      { table: 'reviews', conditions: ['reviewer_id = $1', 'reviewee_id = $1'] },
      { table: 'bids', condition: 'helper_id = $1' },
      { table: 'messages', conditions: ['sender_id = $1', 'receiver_id = $1'] },
      { table: 'notifications', condition: 'user_id = $1' },
      { table: 'subscriptions', condition: 'user_id = $1' },
      { table: 'helper_profiles', condition: 'user_id = $1' },
      { table: 'consent_records', condition: 'user_id = $1' },
      { table: 'user_2fa', condition: 'user_id = $1' },
      { table: 'refresh_tokens', condition: 'user_id = $1' },
      { table: 'jobs', conditions: ['client_id = $1', 'assigned_helper_id = $1'] },
      { table: 'platform_ledger', condition: 'user_id = $1' },
    ];

    for (const entry of tablesToClean) {
      if (!(await tableExists(entry.table))) continue;
      if (entry.conditions) {
        for (const cond of entry.conditions) {
          await db.query(`DELETE FROM ${entry.table} WHERE ${cond}`, [userId]);
        }
      } else if (entry.condition) {
        await db.query(`DELETE FROM ${entry.table} WHERE ${entry.condition}`, [userId]);
      }
    }

    // Delete the user
    await db.query('DELETE FROM users WHERE id = $1', [userId]);

    // Log the action
    try {
      await logAdminAction({
        adminId,
        action: 'user_deleted',
        targetType: 'user',
        targetId: userId,
        description: reason || `Deleted user ${user.email}`,
        before: { email: user.email, role: user.role, name: `${user.first_name} ${user.last_name}` },
        after: null,
        req
      });
    } catch(e) {}

    res.json({ message: `User ${user.email} deleted successfully.` });
  } catch (err) {
    console.error('deleteUser error:', err);
    res.status(500).json({ error: 'Failed to delete user.' });
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

// POST /admin/super/admin-accounts  — create a new admin account
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

// PUT /admin/super/admin-accounts/:id/status  — enable or disable an admin
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
    await db.query('UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2', [newStatus, id]);
    // Invalidate all sessions for this admin
    await db.query('UPDATE sessions SET is_valid = false WHERE user_id = $1', [id]);
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

// GET /admin/super/admin-activity/:adminId  — audit log filtered to one admin
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

// POST /admin/super/force-logout/:userId  — invalidate all sessions for any user
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

// POST /admin/super/users/:userId/message  — send a direct message to any user
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
