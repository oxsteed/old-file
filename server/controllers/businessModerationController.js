const db     = require('../db');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');

// ─── Businesses ───────────────────────────────────────────────────────────────

exports.listBusinesses = async (req, res) => {
  try {
    const { search = '', status = '', activity = '', sort = 'created_desc', page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = []; let p = 1; const conds = [];

    if (search) {
      conds.push(`(b.business_name ILIKE $${p} OR u.email ILIKE $${p} OR u.first_name || ' ' || u.last_name ILIKE $${p})`);
      params.push(`%${search}%`); p++;
    }
    if (status === 'active')   conds.push('b.is_active = TRUE');
    if (status === 'inactive') conds.push('b.is_active = FALSE');

    // Always exclude deleted businesses from the list
    conds.push('b.deleted_at IS NULL');
    const wc = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    // Determine sort order
    let orderBy = 'b.created_at DESC';
    if (sort === 'name') orderBy = 'b.business_name ASC';
    if (sort === 'created_asc') orderBy = 'b.created_at ASC';
    if (sort === 'created_desc') orderBy = 'b.created_at DESC';
    if (sort === 'jobs') orderBy = 'COALESCE(job_count, 0) DESC';
    if (sort === 'activity') orderBy = 'b.updated_at DESC';

    const { rows } = await db.query(`
      SELECT b.id, b.business_name, b.business_type, b.is_active, b.is_primary,
             b.address_city, b.address_state, b.address_street, b.address_zip,
             b.description, b.website, b.phone, b.admin_notes,
             b.created_at, b.updated_at,
             NULL::text AS category,
             u.id AS owner_id,
             u.first_name || ' ' || u.last_name AS owner_name,
             u.email AS owner_email,
             COUNT(DISTINCT bm.id)::int AS member_count,
             (SELECT COUNT(*)::int FROM jobs WHERE assigned_helper_id = u.id AND deleted_at IS NULL) AS job_count,
             0::bigint AS total_earnings_cents
        FROM businesses b
        JOIN users u ON b.user_id = u.id
        LEFT JOIN business_members bm ON bm.business_id = b.id AND bm.status = 'active'
        ${wc}
       GROUP BY b.id, b.business_name, b.business_type, b.is_active, b.is_primary,
                b.address_city, b.address_state, b.address_street, b.address_zip,
                b.description, b.website, b.phone, b.admin_notes,
                b.created_at, b.updated_at,
                u.id, u.first_name, u.last_name, u.email
       ORDER BY ${orderBy}
       LIMIT $${p} OFFSET $${p + 1}
    `, [...params, parseInt(limit), offset]);

    // Get stats
    const { rows: statsRows } = await db.query(`
      SELECT
        COUNT(*)::int as total,
        SUM(CASE WHEN b.is_active = TRUE THEN 1 ELSE 0 END)::int as active,
        SUM(CASE WHEN b.is_active = FALSE THEN 1 ELSE 0 END)::int as inactive,
        SUM(CASE WHEN DATE_TRUNC('month', b.created_at) = DATE_TRUNC('month', NOW()) THEN 1 ELSE 0 END)::int as "newThisMonth",
        SUM(CASE WHEN (SELECT COUNT(*) FROM jobs WHERE assigned_helper_id = u.id AND deleted_at IS NULL) = 0 THEN 1 ELSE 0 END)::int as dormant
      FROM businesses b
      JOIN users u ON b.user_id = u.id
      ${wc}
    `, params);

    const stats = statsRows[0] || { total: 0, active: 0, inactive: 0, newThisMonth: 0, dormant: 0 };

    res.json({ businesses: rows, total: stats.total, stats });
  } catch (err) {
    logger.error('listBusinesses error', { err });
    res.status(500).json({ error: 'Failed to fetch businesses.' });
  }
};

exports.toggleBusiness = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const { rows } = await db.query(
      'SELECT id, business_name, is_active FROM businesses WHERE id = $1', [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Business not found.' });
    const newActive = !rows[0].is_active;
    const oldActive = rows[0].is_active;

    // Update with safeguard to prevent race conditions - only update if current state matches
    const updateResult = await db.query(
      'UPDATE businesses SET is_active = $1, updated_at = NOW() WHERE id = $2 AND is_active = $3 RETURNING id',
      [newActive, id, oldActive]
    );

    if (!updateResult.rows.length) {
      return res.status(409).json({ error: 'Business state changed during update. Please try again.' });
    }

    try {
      await logAdminAction({
        adminId: req.user.id,
        action: newActive ? 'business_reactivated' : 'business_deactivated',
        targetType: 'business', targetId: String(id),
        before: { is_active: rows[0].is_active }, after: { is_active: newActive },
        description: reason || null, req,
      });
    } catch (e) {}
    res.json({ message: `Business ${newActive ? 'reactivated' : 'deactivated'}.`, is_active: newActive });
  } catch (err) {
    logger.error('toggleBusiness error', { err, businessId: req.params?.id, adminId: req.user?.id });
    res.status(500).json({ error: 'Failed to update business.' });
  }
};

// ─── Tool Rentals ─────────────────────────────────────────────────────────────

exports.listToolRentals = async (req, res) => {
  try {
    const { search = '', available = '', page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = []; let p = 1; const conds = [];

    if (search) {
      conds.push(`(tr.name ILIKE $${p} OR tr.category ILIKE $${p} OR u.email ILIKE $${p})`);
      params.push(`%${search}%`); p++;
    }
    if (available === 'true' || available === 'available')  conds.push('tr.is_available = TRUE');
    if (available === 'false' || available === 'hidden') conds.push('tr.is_available = FALSE');
    const wc = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows } = await db.query(`
      SELECT tr.id, tr.name, tr.category, tr.is_available, tr.daily_rate,
             tr.location_city, tr.location_state, tr.condition, tr.created_at,
             u.id AS owner_id,
             u.first_name || ' ' || u.last_name AS owner_name,
             u.email AS owner_email
        FROM tool_rentals tr
        JOIN users u ON tr.user_id = u.id
        ${wc}
       ORDER BY tr.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}
    `, [...params, parseInt(limit), offset]);

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM tool_rentals tr JOIN users u ON tr.user_id = u.id ${wc}`, params
    );
    res.json({ tools: rows, total: parseInt(countRows[0].count) });
  } catch (err) {
    logger.error('listToolRentals error', { err });
    res.status(500).json({ error: 'Failed to fetch tool rentals.' });
  }
};

exports.toggleToolRental = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const { rows } = await db.query(
      'SELECT id, name, is_available FROM tool_rentals WHERE id = $1', [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Tool rental not found.' });
    const newAvailable = !rows[0].is_available;
    const oldAvailable = rows[0].is_available;

    // Update with safeguard to prevent race conditions
    const updateResult = await db.query(
      'UPDATE tool_rentals SET is_available = $1, updated_at = NOW() WHERE id = $2 AND is_available = $3 RETURNING id',
      [newAvailable, id, oldAvailable]
    );

    if (!updateResult.rows.length) {
      return res.status(409).json({ error: 'Tool rental state changed during update. Please try again.' });
    }

    try {
      await logAdminAction({
        adminId: req.user.id,
        action: newAvailable ? 'tool_rental_enabled' : 'tool_rental_disabled',
        targetType: 'tool_rental', targetId: String(id),
        before: { is_available: rows[0].is_available }, after: { is_available: newAvailable },
        description: reason || null, req,
      });
    } catch (e) {}
    res.json({ message: `Tool rental ${newAvailable ? 'enabled' : 'hidden'}.`, is_available: newAvailable });
  } catch (err) {
    logger.error('toggleToolRental error', { err, toolId: req.params?.id, adminId: req.user?.id });
    res.status(500).json({ error: 'Failed to update tool rental.' });
  }
};

// ─── Planned Needs ────────────────────────────────────────────────────────────

exports.listPlannedNeeds = async (req, res) => {
  try {
    const { search = '', status = '', page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = []; let p = 1; const conds = [];

    if (search) {
      conds.push(`(pn.title ILIKE $${p} OR u.email ILIKE $${p})`);
      params.push(`%${search}%`); p++;
    }
    if (status) { conds.push(`pn.status = $${p++}`); params.push(status); }
    const wc = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows } = await db.query(`
      SELECT pn.id, pn.title, pn.category, pn.status, pn.due_date,
             pn.estimated_cost, pn.lead_time_days, pn.published_job_id,
             pn.recurrence_type, pn.created_at,
             u.id AS owner_id,
             u.first_name || ' ' || u.last_name AS owner_name,
             u.email AS owner_email
        FROM planned_needs pn
        JOIN users u ON pn.user_id = u.id
        ${wc}
       ORDER BY pn.due_date ASC NULLS LAST, pn.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}
    `, [...params, parseInt(limit), offset]);

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM planned_needs pn JOIN users u ON pn.user_id = u.id ${wc}`, params
    );
    res.json({ needs: rows, total: parseInt(countRows[0].count) });
  } catch (err) {
    logger.error('listPlannedNeeds error', { err });
    res.status(500).json({ error: 'Failed to fetch planned needs.' });
  }
};

exports.cancelAutopublish = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const { rows } = await db.query('SELECT id, title, status FROM planned_needs WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Planned need not found.' });
    if (rows[0].status !== 'activating_soon') {
      return res.status(409).json({ error: `Cannot cancel auto-publish: status is '${rows[0].status}', must be 'activating_soon'.` });
    }

    // Update with safeguard to prevent race conditions.
    // T20-F01: cancelling auto-publish must durably pause the need, otherwise
    // the scheduler re-promotes it to activating_soon on the next run.
    const updateResult = await db.query(
      "UPDATE planned_needs SET status = 'planned', is_paused = TRUE, updated_at = NOW() WHERE id = $1 AND status = 'activating_soon' RETURNING id",
      [id]
    );

    if (!updateResult.rows.length) {
      return res.status(409).json({ error: 'Planned need status changed during update. Please try again.' });
    }

    try {
      await logAdminAction({
        adminId: req.user.id, action: 'planned_need_autopublish_cancelled',
        targetType: 'planned_need', targetId: String(id),
        before: { status: 'activating_soon' }, after: { status: 'planned' },
        description: reason || null, req,
      });
    } catch (e) {}
    res.json({ message: 'Auto-publish cancelled. Need reset to planned.' });
  } catch (err) {
    logger.error('cancelAutopublish error', { err, needId: req.params?.id, adminId: req.user?.id });
    res.status(500).json({ error: 'Failed to cancel auto-publish.' });
  }
};

const TERMINAL = ['cancelled', 'completed', 'regenerated'];

exports.forceCancel = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const { rows } = await db.query(
      'SELECT id, title, status, published_job_id FROM planned_needs WHERE id = $1', [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Planned need not found.' });
    if (TERMINAL.includes(rows[0].status)) {
      return res.status(409).json({ error: `Cannot cancel: already '${rows[0].status}'.` });
    }

    // Update with safeguard to prevent race conditions
    const updateResult = await db.query(
      "UPDATE planned_needs SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1 AND status NOT IN ('cancelled', 'completed', 'regenerated') RETURNING id",
      [id]
    );

    if (!updateResult.rows.length) {
      return res.status(409).json({ error: 'Planned need status changed during update. Please try again.' });
    }
    try {
      await logAdminAction({
        adminId: req.user.id, action: 'planned_need_force_cancelled',
        targetType: 'planned_need', targetId: String(id),
        before: { status: rows[0].status }, after: { status: 'cancelled' },
        description: reason || null, req,
      });
    } catch (e) {}
    res.json({ message: 'Planned need force-cancelled.', published_job_id: rows[0].published_job_id });
  } catch (err) {
    logger.error('forceCancel error', { err });
    res.status(500).json({ error: 'Failed to cancel planned need.' });
  }
};

// ─── Business Actions ──────────────────────────────────────────────────────────

exports.getBusinessDetail = async (req, res) => {
  try {
    const { id } = req.params;

    // Get business with owner details
    const { rows: bizRows } = await db.query(`
      SELECT b.id, b.business_name, b.business_type, b.is_active, b.is_primary,
             b.address_city, b.address_state, b.address_street, b.address_zip,
             b.description, b.website, b.phone,
             b.created_at, b.updated_at, b.admin_notes,
             NULL::text AS category,
             u.id AS owner_id, u.first_name || ' ' || u.last_name AS owner_name,
             u.email AS owner_email,
             COALESCE(u.phone_number, u.phone) AS owner_phone,
             COUNT(DISTINCT bm.id)::int AS member_count,
             (SELECT COUNT(*)::int FROM jobs WHERE assigned_helper_id = u.id AND deleted_at IS NULL) AS job_count
        FROM businesses b
        JOIN users u ON b.user_id = u.id
        LEFT JOIN business_members bm ON bm.business_id = b.id AND bm.status = 'active'
       WHERE b.id = $1
       GROUP BY b.id, b.business_name, b.business_type, b.is_active, b.is_primary,
                b.address_city, b.address_state, b.address_street, b.address_zip,
                b.description, b.website, b.phone, b.created_at, b.updated_at, b.admin_notes,
                u.id, u.first_name, u.last_name, u.email, u.phone_number, u.phone
    `, [id]);

    if (!bizRows.length) return res.status(404).json({ error: 'Business not found.' });

    const business = bizRows[0];

    // Get recent jobs assigned to this business owner
    const { rows: jobs } = await db.query(`
      SELECT id, title, status, created_at
        FROM jobs
       WHERE assigned_helper_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 10
    `, [business.owner_id]);

    res.json({ business: { ...business, recent_jobs: jobs } });
  } catch (err) {
    logger.error('getBusinessDetail error', { err, businessId: req.params?.id });
    res.status(500).json({ error: 'Failed to fetch business details.' });
  }
};

exports.flagBusiness = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Reason is required.' });
    }

    const { rows } = await db.query(
      'SELECT id, business_name FROM businesses WHERE id = $1', [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Business not found.' });

    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'business_flagged_for_review',
        targetType: 'business',
        targetId: String(id),
        description: reason,
        req,
      });
    } catch (e) {}

    res.json({ message: 'Business flagged for review.' });
  } catch (err) {
    logger.error('flagBusiness error', { err, businessId: req.params?.id, adminId: req.user?.id });
    res.status(500).json({ error: 'Failed to flag business.' });
  }
};

exports.updateAdminNotes = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    if (notes && notes.length > 2000) {
      return res.status(400).json({ error: 'Notes cannot exceed 2000 characters.' });
    }

    const { rows } = await db.query(
      'SELECT id, admin_notes FROM businesses WHERE id = $1', [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Business not found.' });

    const oldNotes = rows[0].admin_notes || null;
    const newNotes = notes && notes.trim() ? notes.trim() : null;

    // Update with safeguard
    const updateResult = await db.query(
      'UPDATE businesses SET admin_notes = $1, updated_at = NOW() WHERE id = $2 RETURNING id',
      [newNotes, id]
    );

    if (!updateResult.rows.length) {
      return res.status(409).json({ error: 'Business was deleted during update. Please try again.' });
    }

    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'business_admin_notes_updated',
        targetType: 'business',
        targetId: String(id),
        before: { admin_notes: oldNotes },
        after: { admin_notes: newNotes },
        req,
      });
    } catch (e) {}

    res.json({ message: 'Admin notes updated.', admin_notes: newNotes });
  } catch (err) {
    logger.error('updateAdminNotes error', { err, businessId: req.params?.id, adminId: req.user?.id });
    res.status(500).json({ error: 'Failed to update admin notes.' });
  }
};

exports.deleteBusiness = async (req, res) => {
  try {
    const { id } = req.params;
    const { confirmed, reason } = req.body;

    if (!confirmed) {
      return res.status(400).json({ error: 'Deletion must be confirmed.' });
    }

    const { rows } = await db.query(
      'SELECT id, business_name, is_active FROM businesses WHERE id = $1', [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Business not found.' });

    // Soft delete - mark as inactive and set deleted_at
    const deleteResult = await db.query(
      'UPDATE businesses SET is_active = FALSE, deleted_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );

    if (!deleteResult.rows.length) {
      return res.status(409).json({ error: 'Business was already deleted.' });
    }

    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'business_deleted',
        targetType: 'business',
        targetId: String(id),
        before: { is_active: rows[0].is_active },
        after: { is_active: false, deleted_at: new Date().toISOString() },
        details: reason ? { reason: String(reason).slice(0, 500) } : undefined,
        req,
      });
    } catch (e) {}

    res.json({ message: 'Business deleted (soft delete applied).' });
  } catch (err) {
    logger.error('deleteBusiness error', { err, businessId: req.params?.id, adminId: req.user?.id });
    res.status(500).json({ error: 'Failed to delete business.' });
  }
};
