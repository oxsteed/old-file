'use strict';

const db = require('../db');
const { logAdminAction } = require('../services/auditService');
const logger = require('../utils/logger');

async function tableExists(name) {
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1`,
      [name]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

exports.listBusinesses = async (req, res) => {
  try {
    if (!(await tableExists('businesses'))) {
      return res.json({ businesses: [], total: 0 });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const active = req.query.active;

    const params = [];
    let i = 1;
    const cond = [];
    if (search) {
      const esc = search.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      cond.push(`(
        b.business_name ILIKE $${i} ESCAPE '\\'
        OR COALESCE(b.description, '') ILIKE $${i} ESCAPE '\\'
        OR u.email ILIKE $${i} ESCAPE '\\'
        OR (u.first_name || ' ' || u.last_name) ILIKE $${i} ESCAPE '\\'
      )`);
      params.push(`%${esc}%`);
      i++;
    }
    if (active === 'true') cond.push('b.is_active = TRUE');
    if (active === 'false') cond.push('b.is_active = FALSE');
    const wc = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const { rows } = await db.query(
      `SELECT b.id, b.user_id, b.business_name, b.is_active, b.is_primary,
              b.address_city, b.address_state, b.created_at,
              u.email AS owner_email,
              u.first_name || ' ' || u.last_name AS owner_name
         FROM businesses b
         JOIN users u ON u.id = b.user_id
         ${wc}
         ORDER BY b.created_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    );
    const { rows: c } = await db.query(
      `SELECT COUNT(*)::int AS n FROM businesses b
         JOIN users u ON u.id = b.user_id ${wc}`,
      params
    );
    res.json({ businesses: rows, total: c[0]?.n || 0, page, limit });
  } catch (err) {
    logger.error('listBusinesses admin error', { err });
    res.status(500).json({ error: 'Failed to list businesses.' });
  }
};

exports.toggleBusiness = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { is_active, reason } = req.body;
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid business id.' });
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active boolean required.' });
    }
    const { rows } = await db.query(
      `SELECT id, business_name, is_active FROM businesses WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Business not found.' });
    const before = rows[0];
    await db.query(
      `UPDATE businesses SET is_active = $1, updated_at = NOW() WHERE id = $2`,
      [is_active, id]
    );
    try {
      await logAdminAction({
        adminId: req.user.id,
        action: is_active ? 'business_activated' : 'business_deactivated',
        targetType: 'business',
        targetId: String(id),
        description: reason || null,
        before: { is_active: before.is_active },
        after: { is_active },
        req,
      });
    } catch (e) { /* ignore */ }
    res.json({ message: 'Business updated.', id, is_active });
  } catch (err) {
    logger.error('toggleBusiness admin error', { err });
    res.status(500).json({ error: 'Failed to update business.' });
  }
};

exports.listToolRentals = async (req, res) => {
  try {
    if (!(await tableExists('tool_rentals'))) {
      return res.json({ tools: [], total: 0 });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const available = req.query.available;

    const params = [];
    let i = 1;
    const cond = [];
    if (search) {
      const esc = search.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      cond.push(`(
        t.name ILIKE $${i} ESCAPE '\\'
        OR COALESCE(t.description, '') ILIKE $${i} ESCAPE '\\'
        OR u.email ILIKE $${i} ESCAPE '\\'
      )`);
      params.push(`%${esc}%`);
      i++;
    }
    if (available === 'true') cond.push('t.is_available = TRUE');
    if (available === 'false') cond.push('t.is_available = FALSE');
    const wc = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const { rows } = await db.query(
      `SELECT t.id, t.user_id, t.name, t.category, t.daily_rate, t.is_available,
              t.location_city, t.location_state, t.created_at,
              u.email AS owner_email,
              u.first_name || ' ' || u.last_name AS owner_name
         FROM tool_rentals t
         JOIN users u ON u.id = t.user_id
         ${wc}
         ORDER BY t.created_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    );
    const { rows: c } = await db.query(
      `SELECT COUNT(*)::int AS n FROM tool_rentals t
         JOIN users u ON u.id = t.user_id ${wc}`,
      params
    );
    res.json({ tools: rows, total: c[0]?.n || 0, page, limit });
  } catch (err) {
    logger.error('listToolRentals admin error', { err });
    res.status(500).json({ error: 'Failed to list tool rentals.' });
  }
};

exports.toggleToolRental = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { is_available, reason } = req.body;
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id.' });
    if (typeof is_available !== 'boolean') {
      return res.status(400).json({ error: 'is_available boolean required.' });
    }
    const { rows } = await db.query(
      `SELECT id, name, is_available FROM tool_rentals WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Listing not found.' });
    const before = rows[0];
    await db.query(
      `UPDATE tool_rentals SET is_available = $1, updated_at = NOW() WHERE id = $2`,
      [is_available, id]
    );
    try {
      await logAdminAction({
        adminId: req.user.id,
        action: is_available ? 'tool_rental_enabled' : 'tool_rental_disabled',
        targetType: 'tool_rental',
        targetId: String(id),
        description: reason || null,
        before: { is_available: before.is_available },
        after: { is_available },
        req,
      });
    } catch (e) { /* ignore */ }
    res.json({ message: 'Tool listing updated.', id, is_available });
  } catch (err) {
    logger.error('toggleToolRental admin error', { err });
    res.status(500).json({ error: 'Failed to update listing.' });
  }
};

exports.listPlannedNeeds = async (req, res) => {
  try {
    if (!(await tableExists('planned_needs'))) {
      return res.json({ needs: [], total: 0 });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const status = (req.query.status || '').trim();
    const search = (req.query.search || '').trim();

    const params = [];
    let i = 1;
    const cond = [];
    if (status) {
      cond.push(`pn.status = $${i++}`);
      params.push(status);
    }
    if (search) {
      const esc = search.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      cond.push(`(pn.title ILIKE $${i} ESCAPE '\\' OR u.email ILIKE $${i} ESCAPE '\\')`);
      params.push(`%${esc}%`);
      i++;
    }
    const wc = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const { rows } = await db.query(
      `SELECT pn.*,
              u.email AS user_email,
              u.first_name || ' ' || u.last_name AS user_name
         FROM planned_needs pn
         JOIN users u ON u.id = pn.user_id
         ${wc}
         ORDER BY pn.due_date ASC, pn.id DESC
         LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    );
    const { rows: c } = await db.query(
      `SELECT COUNT(*)::int AS n FROM planned_needs pn
         JOIN users u ON u.id = pn.user_id ${wc}`,
      params
    );
    res.json({ needs: rows, total: c[0]?.n || 0, page, limit });
  } catch (err) {
    logger.error('listPlannedNeeds admin error', { err });
    res.status(500).json({ error: 'Failed to list planned needs.' });
  }
};

/** Pull back from activating_soon so scheduler will not auto-publish soon */
exports.cancelAutopublish = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body;
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id.' });

    const { rows } = await db.query(
      `SELECT id, status, published_job_id, title FROM planned_needs WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Need not found.' });
    const pn = rows[0];
    if (pn.published_job_id) {
      return res.status(400).json({
        error: 'Already linked to a published job; use force cancel or resolve the job first.',
      });
    }
    if (pn.status !== 'activating_soon') {
      return res.status(400).json({
        error: `cancelAutopublish only applies when status is activating_soon (current: ${pn.status}).`,
      });
    }
    await db.query(
      `UPDATE planned_needs
          SET status = 'funding', updated_at = NOW()
        WHERE id = $1`,
      [id]
    );
    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'planned_need_autopublish_cancelled',
        targetType: 'planned_need',
        targetId: String(id),
        description: reason || null,
        before: { status: pn.status },
        after: { status: 'funding' },
        req,
      });
    } catch (e) { /* ignore */ }
    res.json({ message: 'Auto-publish window cleared; status set to funding.', id });
  } catch (err) {
    logger.error('cancelAutopublish admin error', { err });
    res.status(500).json({ error: 'Failed to update planned need.' });
  }
};

exports.forceCancel = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body;
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id.' });
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'reason is required.' });
    }

    const { rows } = await db.query(
      `SELECT id, status, published_job_id, title FROM planned_needs WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Need not found.' });
    const pn = rows[0];
    if (['cancelled', 'completed', 'regenerated'].includes(pn.status)) {
      return res.status(400).json({ error: 'Need is already terminal.' });
    }

    await db.query(
      `UPDATE planned_needs
          SET status = 'cancelled',
              cancelled_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [id]
    );
    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'planned_need_force_cancelled',
        targetType: 'planned_need',
        targetId: String(id),
        description: String(reason).trim(),
        before: {
          status: pn.status,
          published_job_id: pn.published_job_id,
          title: pn.title,
        },
        after: { status: 'cancelled' },
        req,
      });
    } catch (e) { /* ignore */ }

    res.json({
      message: 'Planned need cancelled.',
      id,
      had_published_job: !!pn.published_job_id,
      warning: pn.published_job_id
        ? 'A published_job_id was set; the linked job was not auto-cancelled.'
        : null,
    });
  } catch (err) {
    logger.error('forceCancel planned need admin error', { err });
    res.status(500).json({ error: 'Failed to cancel planned need.' });
  }
};
