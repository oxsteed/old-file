const db = require('../db');

// GET /api/admin/dashboard - Admin dashboard stats
exports.getDashboardStats = async (req, res) => {
  try {
    const [users, jobs, revenue, moderation, disputes] = await Promise.all([
      db.query(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(*) FILTER (WHERE role IN ('helper', 'both')) as total_helpers,
          COUNT(*) FILTER (WHERE role IN ('customer', 'both')) as total_customers,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as new_users_30d,
          COUNT(*) FILTER (WHERE subscription_status = 'active') as active_subscribers,
          COUNT(*) FILTER (WHERE tier = 'tier2basic') as basic_tier,
          COUNT(*) FILTER (WHERE tier = 'tier2pro') as pro_tier,
          COUNT(*) FILTER (WHERE deactivated_at IS NOT NULL) as deactivated
        FROM users WHERE admin_role IS NULL
      `),
      db.query(`
        SELECT 
          COUNT(*) as total_jobs,
          COUNT(*) FILTER (WHERE status = 'published') as active_jobs,
          COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
          COUNT(*) FILTER (WHERE status = 'disputed') as disputed_jobs,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as new_jobs_30d,
          COALESCE(AVG(final_price) FILTER (WHERE status = 'completed'), 0) as avg_job_value
        FROM jobs
      `),
      db.query(`
        SELECT 
          COALESCE(SUM(amount_cents) FILTER (WHERE amount_cents > 0), 0) / 100.0 as total_revenue,
          COALESCE(SUM(amount_cents) FILTER (WHERE source_type = 'subscription'), 0) / 100.0 as subscription_revenue,
          COALESCE(SUM(amount_cents) FILTER (WHERE source_type = 'job_fee'), 0) / 100.0 as job_fee_revenue
        FROM platform_ledger
        WHERE created_at > NOW() - INTERVAL '30 days'
      `),
      db.query(`SELECT COUNT(*) FILTER (WHERE status = 'pending') as pending FROM moderation_queue`),
      db.query(`SELECT COUNT(*) FILTER (WHERE status = 'open') as open_disputes FROM disputes`)
    ]);

    res.json({
      users: users.rows[0],
      jobs: jobs.rows[0],
      revenue: revenue.rows[0],
      moderation: moderation.rows[0],
      disputes: disputes.rows[0]
    });
  } catch (err) {
    console.error('getDashboardStats error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats.' });
  }
};

// GET /api/admin/users - List all users with filters
exports.getUsers = async (req, res) => {
  try {
    const { role, tier, status, search, page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let query = `SELECT id, first_name, last_name, email, role, tier, 
      subscription_status, community_score, jobs_completed, 
      identity_verified, background_check_status, deactivated_at, created_at
      FROM users WHERE admin_role IS NULL`;
    const params = [];
    let paramIdx = 1;

    if (role) { query += ` AND role = $${paramIdx++}`; params.push(role); }
    if (tier) { query += ` AND tier = $${paramIdx++}`; params.push(tier); }
    if (status === 'active') { query += ` AND deactivated_at IS NULL`; }
    if (status === 'deactivated') { query += ` AND deactivated_at IS NOT NULL`; }
    if (search) {
      query += ` AND (first_name ILIKE $${paramIdx} OR last_name ILIKE $${paramIdx} OR email ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(parseInt(limit), offset);

    const { rows } = await db.query(query, params);
    const countResult = await db.query(`SELECT COUNT(*) FROM users WHERE admin_role IS NULL`);

    res.json({ users: rows, total: parseInt(countResult.rows[0].count), page: parseInt(page) });
  } catch (err) {
    console.error('getUsers error:', err);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
};

// PUT /api/admin/users/:id/deactivate
exports.deactivateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    await db.query(
      `UPDATE users SET deactivated_at = NOW(), deactivation_reason = $1 WHERE id = $2`,
      [reason, id]
    );
    await logAdminAction(req.user.id, 'deactivate_user', 'user', id, { reason }, req.ip);
    res.json({ message: 'User deactivated.' });
  } catch (err) {
    console.error('deactivateUser error:', err);
    res.status(500).json({ error: 'Failed to deactivate user.' });
  }
};

// PUT /api/admin/users/:id/reactivate
exports.reactivateUser = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      `UPDATE users SET deactivated_at = NULL, deactivation_reason = NULL WHERE id = $1`,
      [id]
    );
    await logAdminAction(req.user.id, 'reactivate_user', 'user', id, {}, req.ip);
    res.json({ message: 'User reactivated.' });
  } catch (err) {
    console.error('reactivateUser error:', err);
    res.status(500).json({ error: 'Failed to reactivate user.' });
  }
};

// GET /api/admin/moderation - Get moderation queue
exports.getModerationQueue = async (req, res) => {
  try {
    const { status = 'pending', type, page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let query = `SELECT mq.*, 
      u.first_name || ' ' || u.last_name as reporter_name
      FROM moderation_queue mq
      LEFT JOIN users u ON mq.reported_by = u.id
      WHERE mq.status = $1`;
    const params = [status];
    let paramIdx = 2;

    if (type) { query += ` AND mq.type = $${paramIdx++}`; params.push(type); }
    query += ` ORDER BY 
      CASE mq.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      mq.created_at ASC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(parseInt(limit), offset);

    const { rows } = await db.query(query, params);
    res.json({ items: rows, page: parseInt(page) });
  } catch (err) {
    console.error('getModerationQueue error:', err);
    res.status(500).json({ error: 'Failed to fetch moderation queue.' });
  }
};

// PUT /api/admin/moderation/:id/resolve
exports.resolveModerationItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution, action } = req.body;

    await db.query(
      `UPDATE moderation_queue SET status = 'resolved', resolution = $1, 
       resolved_by = $2, resolved_at = NOW(), updated_at = NOW() WHERE id = $3`,
      [resolution, req.user.id, id]
    );

    // If action is to remove the flagged review
    if (action === 'remove_review') {
      const item = await db.query(`SELECT target_id FROM moderation_queue WHERE id = $1`, [id]);
      if (item.rows[0]) {
        await db.query(
          `UPDATE reviews SET removed = TRUE, remove_reason = $1, removed_by = $2 WHERE id = $3`,
          [resolution, req.user.id, item.rows[0].target_id]
        );
      }
    }

    await logAdminAction(req.user.id, 'resolve_moderation', 'moderation', id, { resolution, action }, req.ip);
    res.json({ message: 'Moderation item resolved.' });
  } catch (err) {
    console.error('resolveModerationItem error:', err);
    res.status(500).json({ error: 'Failed to resolve moderation item.' });
  }
};

// PUT /api/admin/moderation/:id/dismiss
exports.dismissModerationItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    await db.query(
      `UPDATE moderation_queue SET status = 'dismissed', resolution = $1,
       resolved_by = $2, resolved_at = NOW(), updated_at = NOW() WHERE id = $3`,
      [reason || 'Dismissed by admin', req.user.id, id]
    );
    await logAdminAction(req.user.id, 'dismiss_moderation', 'moderation', id, { reason }, req.ip);
    res.json({ message: 'Moderation item dismissed.' });
  } catch (err) {
    console.error('dismissModerationItem error:', err);
    res.status(500).json({ error: 'Failed to dismiss item.' });
  }
};

// GET /api/admin/markets - List all markets
exports.getMarkets = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.*, 
        (SELECT COUNT(*) FROM users WHERE market_id = m.id AND deactivated_at IS NULL) as user_count,
        (SELECT COUNT(*) FROM jobs j JOIN users u ON j.client_id = u.id WHERE u.market_id = m.id) as job_count
      FROM markets m ORDER BY m.name ASC`
    );
    res.json({ markets: rows });
  } catch (err) {
    console.error('getMarkets error:', err);
    res.status(500).json({ error: 'Failed to fetch markets.' });
  }
};

// POST /api/admin/markets - Create new market
exports.createMarket = async (req, res) => {
  try {
    const { name, state, zipcodes, active } = req.body;
    const { rows } = await db.query(
      `INSERT INTO markets (name, state, zipcodes, active, launched_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN NOW() ELSE NULL END) RETURNING *`,
      [name, state, zipcodes, active !== false]
    );
    await logAdminAction(req.user.id, 'create_market', 'market', rows[0].id, { name, state }, req.ip);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createMarket error:', err);
    res.status(500).json({ error: 'Failed to create market.' });
  }
};

// GET /api/admin/activity-log
exports.getActivityLog = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { rows } = await db.query(
      `SELECT al.*, u.first_name || ' ' || u.last_name as admin_name
       FROM admin_activity_log al
       JOIN users u ON al.admin_id = u.id
       ORDER BY al.created_at DESC LIMIT $1 OFFSET $2`,
      [parseInt(limit), offset]
    );
    res.json({ logs: rows, page: parseInt(page) });
  } catch (err) {
    console.error('getActivityLog error:', err);
    res.status(500).json({ error: 'Failed to fetch activity log.' });
  }
};

// GET /api/admin/settings
exports.getPlatformSettings = async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM platform_settings ORDER BY key ASC`);
    res.json({ settings: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
};

// PUT /api/admin/settings/:key
exports.updatePlatformSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const { rows } = await db.query(
      `UPDATE platform_settings SET value = $1, updated_by = $2, updated_at = NOW()
       WHERE key = $3 RETURNING *`,
      [value, req.user.id, key]
    );
    if (!rows.length) return res.status(404).json({ error: 'Setting not found.' });
    await logAdminAction(req.user.id, 'update_setting', 'setting', 0, { key, value }, req.ip);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update setting.' });
  }
};

// Helper: Log admin action
async function logAdminAction(adminId, action, targetType, targetId, details, ipAddress) {
  try {
    await db.query(
      `INSERT INTO admin_activity_log (admin_id, action, target_type, target_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [adminId, action, targetType, targetId, JSON.stringify(details), ipAddress]
    );
  } catch (err) {
    console.error('Failed to log admin action:', err);
  }
}
