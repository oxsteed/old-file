const db     = require('../db');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');

// ─── Businesses ───────────────────────────────────────────────────────────────

exports.listBusinesses = async (req, res) => {
  try {
    const { search = '', status = '', page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = []; let p = 1; const conds = [];

    if (search) {
      conds.push(`(b.business_name ILIKE $${p} OR u.email ILIKE $${p} OR u.first_name || ' ' || u.last_name ILIKE $${p})`);
      params.push(`%${search}%`); p++;
    }
    if (status === 'active')   conds.push('b.is_active = TRUE');
    if (status === 'inactive') conds.push('b.is_active = FALSE');
    const wc = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows } = await db.query(`
      SELECT b.id, b.business_name, b.business_type, b.is_active, b.is_primary,
             b.address_city, b.address_state, b.created_at,
             u.id AS owner_id,
             u.first_name || ' ' || u.last_name AS owner_name,
             u.email AS owner_email,
             COUNT(DISTINCT bm.id)::int AS member_count
        FROM businesses b
        JOIN users u ON b.user_id = u.id
        LEFT JOIN business_members bm ON bm.business_id = b.id AND bm.status = 'active'
        ${wc}
       GROUP BY b.id, u.id, u.first_name, u.last_name, u.email
       ORDER BY b.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}
    `, [...params, parseInt(limit), offset]);

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM businesses b JOIN users u ON b.user_id = u.id ${wc}`, params
    );
    res.json({ businesses: rows, total: parseInt(countRows[0].count) });
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
    await db.query('UPDATE businesses SET is_active = $1, updated_at = NOW() WHERE id = $2', [newActive, id]);
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
    logger.error('toggleBusiness error', { err });
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
    await db.query('UPDATE tool_rentals SET is_available = $1, updated_at = NOW() WHERE id = $2', [newAvailable, id]);
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
    logger.error('toggleToolRental error', { err });
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
    await db.query("UPDATE planned_needs SET status = 'planned', updated_at = NOW() WHERE id = $1", [id]);
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
    logger.error('cancelAutopublish error', { err });
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
    await db.query(
      "UPDATE planned_needs SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1", [id]
    );
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
