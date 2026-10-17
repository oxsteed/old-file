'use strict';

/**
 * Customer 360 second-wave endpoints.
 *
 * Powers the "more ways to improve Customer 360" batch: duplicates,
 * linked entities, login/device history, health metrics vs platform,
 * watchlist, note pinning, case ownership, and cross-customer search.
 * All routes are registered behind requireAdmin + manage_users.
 */

const db = require('../db');
const logger = require('../utils/logger');
const { tableExists } = require('../utils/schemaProbe');

function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * GET /admin/users/:userId/duplicates
 * Other user accounts linked to this user via the entity graph's
 * duplicate_of relation (Didit duplicate detection).
 */
exports.getDuplicates = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isUuid(userId)) return res.status(400).json({ error: 'Invalid user id.' });
    if (!(await tableExists('entity_ids')) || !(await tableExists('entity_links'))) {
      return res.json({ duplicates: [] });
    }
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.created_at,
              u.didit_status, l.created_at AS linked_at,
              CASE WHEN l.subject_id = me.public_id THEN 'outgoing' ELSE 'incoming' END AS direction
       FROM entity_ids me
       JOIN entity_links l
         ON (l.subject_id = me.public_id OR l.object_id = me.public_id)
        AND l.relation = 'duplicate_of'
        AND l.valid_to IS NULL
       JOIN entity_ids other
         ON other.public_id = CASE WHEN l.subject_id = me.public_id THEN l.object_id ELSE l.subject_id END
        AND other.entity_type = 'person'
       JOIN users u ON u.id::TEXT = other.entity_key
       WHERE me.entity_type = 'person' AND me.entity_key = $1::TEXT
       ORDER BY l.created_at DESC`,
      [userId]
    );
    res.json({ duplicates: rows });
  } catch (err) {
    logger.error('customer360 getDuplicates error', { err });
    res.status(500).json({ error: 'Failed to fetch duplicates.' });
  }
};

/**
 * GET /admin/users/:userId/linked-entities
 * Businesses / restaurants this person owns or manages (entity graph).
 */
exports.getLinkedEntities = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isUuid(userId)) return res.status(400).json({ error: 'Invalid user id.' });
    if (!(await tableExists('entity_ids')) || !(await tableExists('entity_links'))) {
      return res.json({ entities: [] });
    }
    const hasBusinesses = await tableExists('businesses');
    const nameSelect = hasBusinesses
      ? `COALESCE(b.business_name, other.entity_key) AS name`
      : `other.entity_key AS name`;
    const businessJoin = hasBusinesses
      ? `LEFT JOIN businesses b ON other.entity_type = 'business' AND b.id::TEXT = other.entity_key`
      : ``;
    const { rows } = await db.query(
      `SELECT other.entity_type, other.entity_key, other.public_id,
              l.relation, l.share, l.created_at AS linked_at,
              ${nameSelect}
       FROM entity_ids me
       JOIN entity_links l
         ON l.subject_id = me.public_id
        AND l.relation IN ('owns', 'manages', 'represents')
        AND l.valid_to IS NULL
       JOIN entity_ids other ON other.public_id = l.object_id
       ${businessJoin}
       WHERE me.entity_type = 'person' AND me.entity_key = $1::TEXT
       ORDER BY l.created_at DESC`,
      [userId]
    );
    res.json({ entities: rows });
  } catch (err) {
    logger.error('customer360 getLinkedEntities error', { err });
    res.status(500).json({ error: 'Failed to fetch linked entities.' });
  }
};

/**
 * GET /admin/users/:userId/login-history
 * Recent logins with device/IP summary. Flags IPs shared with other
 * accounts (cheap fraud signal).
 */
exports.getLoginHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isUuid(userId)) return res.status(400).json({ error: 'Invalid user id.' });
    if (!(await tableExists('user_login_history'))) {
      return res.json({ logins: [], summary: null });
    }
    const { rows: logins } = await db.query(
      `SELECT h.id, host(h.ip_address) AS ip_address, h.user_agent,
              h.login_at, h.success, h.failure_reason, h.country_code,
              (SELECT COUNT(DISTINCT h2.user_id)
               FROM user_login_history h2
               WHERE h2.ip_address = h.ip_address AND h2.user_id <> $1::UUID) AS other_users_on_ip
       FROM user_login_history h
       WHERE h.user_id = $1::UUID
       ORDER BY h.login_at DESC
       LIMIT 100`,
      [userId]
    );
    const { rows: summaryRows } = await db.query(
      `SELECT COUNT(*)::INT AS total_logins,
              COUNT(DISTINCT ip_address)::INT AS distinct_ips,
              COUNT(DISTINCT user_agent)::INT AS distinct_devices,
              MAX(login_at) AS last_login_at,
              SUM(CASE WHEN success THEN 0 ELSE 1 END)::INT AS failed_attempts
       FROM user_login_history WHERE user_id = $1::UUID`,
      [userId]
    );
    res.json({ logins, summary: summaryRows[0] || null });
  } catch (err) {
    logger.error('customer360 getLoginHistory error', { err });
    res.status(500).json({ error: 'Failed to fetch login history.' });
  }
};

/**
 * GET /admin/users/:userId/health
 * Per-user marketplace health metrics plus platform baselines so an
 * admin can calibrate ("high dispute rate" vs actually high).
 */
exports.getHealth = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isUuid(userId)) return res.status(400).json({ error: 'Invalid user id.' });
    const out = { user: null, platform: null };
    if (await tableExists('jobs')) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::INT AS total_jobs,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::INT AS completed_jobs,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END)::INT AS cancelled_jobs,
                AVG(job_value)::FLOAT AS avg_job_value,
                COUNT(DISTINCT assigned_helper_id)::INT AS distinct_helpers,
                COUNT(DISTINCT client_id)::INT AS distinct_clients
         FROM jobs WHERE client_id = $1::UUID OR assigned_helper_id = $1::UUID`,
        [userId]
      );
      out.user = rows[0] || null;
      const { rows: plat } = await db.query(
        `SELECT COUNT(*)::INT AS total_jobs,
                AVG(CASE WHEN status = 'cancelled' THEN 1.0 ELSE 0.0 END)::FLOAT AS cancel_rate,
                AVG(job_value)::FLOAT AS avg_job_value
         FROM jobs`
      );
      out.platform = plat[0] || null;
    }
    if (await tableExists('disputes')) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::INT AS dispute_count,
                SUM(CASE WHEN status IN ('open', 'under_review') THEN 1 ELSE 0 END)::INT AS open_disputes
         FROM disputes WHERE opened_by = $1::UUID OR against_user = $1::UUID`,
        [userId]
      );
      out.user = { ...(out.user || {}), ...(rows[0] || {}) };
      const { rows: plat } = await db.query(
        `SELECT AVG(cnt)::FLOAT AS avg_disputes_per_user
         FROM (SELECT opened_by AS uid, COUNT(*) AS cnt FROM disputes GROUP BY opened_by) s`
      );
      out.platform = { ...(out.platform || {}), ...(plat[0] || {}) };
    }
    res.json(out);
  } catch (err) {
    logger.error('customer360 getHealth error', { err });
    res.status(500).json({ error: 'Failed to fetch health metrics.' });
  }
};

// ── Watchlist ──────────────────────────────────────────────────────────────

exports.getWatchStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isUuid(userId)) return res.status(400).json({ error: 'Invalid user id.' });
    if (!(await tableExists('admin_user_watchlist'))) return res.json({ watching: false });
    const { rows } = await db.query(
      `SELECT id, triggers, created_at FROM admin_user_watchlist
       WHERE admin_id = $1::UUID AND target_user_id = $2::UUID`,
      [req.user.id, userId]
    );
    res.json({ watching: rows.length > 0, watch: rows[0] || null });
  } catch (err) {
    logger.error('customer360 getWatchStatus error', { err });
    res.status(500).json({ error: 'Failed to fetch watch status.' });
  }
};

exports.addWatch = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isUuid(userId)) return res.status(400).json({ error: 'Invalid user id.' });
    const triggers = Array.isArray(req.body?.triggers) && req.body.triggers.length
      ? req.body.triggers.filter((t) => t === 'dispute')
      : ['dispute'];
    const { rows } = await db.query(
      `INSERT INTO admin_user_watchlist (admin_id, target_user_id, triggers)
       VALUES ($1::UUID, $2::UUID, $3)
       ON CONFLICT (admin_id, target_user_id)
       DO UPDATE SET triggers = EXCLUDED.triggers
       RETURNING id, triggers, created_at`,
      [req.user.id, userId, triggers]
    );
    res.json({ watching: true, watch: rows[0] });
  } catch (err) {
    logger.error('customer360 addWatch error', { err });
    res.status(500).json({ error: 'Failed to watch user.' });
  }
};

exports.removeWatch = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isUuid(userId)) return res.status(400).json({ error: 'Invalid user id.' });
    await db.query(
      `DELETE FROM admin_user_watchlist WHERE admin_id = $1::UUID AND target_user_id = $2::UUID`,
      [req.user.id, userId]
    );
    res.json({ watching: false });
  } catch (err) {
    logger.error('customer360 removeWatch error', { err });
    res.status(500).json({ error: 'Failed to unwatch user.' });
  }
};

/**
 * Notify watching admins when a dispute is opened involving a watched user.
 * Called from the dispute creation path (best-effort; never throws).
 */
exports.notifyWatchers = async ({ targetUserIds, disputeId, jobTitle }) => {
  try {
    if (!targetUserIds?.length) return;
    // Single query, no tableExists probe: if the watchlist table is missing
    // (pre-migration), this throws and we return silently.
    const { rows } = await db.query(
      `SELECT DISTINCT admin_id FROM admin_user_watchlist
       WHERE target_user_id = ANY($1::UUID[]) AND 'dispute' = ANY(triggers)`,
      [targetUserIds]
    );
    if (!rows.length) return;
    const { sendNotification } = require('../services/notificationService');
    await Promise.all(rows.map((r) =>
      sendNotification({
        userId: r.admin_id,
        type: 'watchlist_dispute',
        title: 'Watched user in a new dispute',
        body: jobTitle ? `Dispute opened on "${jobTitle}".` : 'A dispute was opened.',
        data: { dispute_id: String(disputeId), watched_user_ids: targetUserIds },
        action_url: `/disputes/${disputeId}`,
        idempotencyKey: `watchlist:dispute:${disputeId}:${r.admin_id}`,
      }).catch((e) => logger.warn('watchlist notify failed', { err: e.message }))
    ));
  } catch (err) {
    logger.warn('notifyWatchers failed', { err: err.message });
  }
};

// ── Note pinning / case owner ──────────────────────────────────────────────

exports.toggleNotePin = async (req, res) => {
  try {
    const { userId, noteId } = req.params;
    if (!isUuid(userId)) return res.status(400).json({ error: 'Invalid user id.' });
    const pinned = req.body?.pinned !== false;
    const { rows } = await db.query(
      `UPDATE admin_user_notes
       SET is_pinned = $1, pinned_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
           pinned_by = CASE WHEN $1 THEN $2::UUID ELSE NULL END,
           updated_at = NOW()
       WHERE id = $3 AND target_user_id = $4::UUID
       RETURNING id, is_pinned, pinned_at`,
      [pinned, req.user.id, noteId, userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Note not found.' });
    res.json({ note: rows[0] });
  } catch (err) {
    logger.error('customer360 toggleNotePin error', { err });
    res.status(500).json({ error: 'Failed to update note pin.' });
  }
};

exports.getCaseOwner = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isUuid(userId)) return res.status(400).json({ error: 'Invalid user id.' });
    if (!(await tableExists('admin_user_case_owner'))) return res.json({ owner: null });
    const { rows } = await db.query(
      `SELECT c.owner_admin_id, c.assigned_at,
              u.first_name || ' ' || u.last_name AS owner_name, u.email AS owner_email
       FROM admin_user_case_owner c
       JOIN users u ON u.id = c.owner_admin_id
       WHERE c.target_user_id = $1::UUID`,
      [userId]
    );
    res.json({ owner: rows[0] || null });
  } catch (err) {
    logger.error('customer360 getCaseOwner error', { err });
    res.status(500).json({ error: 'Failed to fetch case owner.' });
  }
};

exports.setCaseOwner = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isUuid(userId)) return res.status(400).json({ error: 'Invalid user id.' });
    const ownerId = req.body?.owner_admin_id || req.user.id;
    if (!isUuid(ownerId)) return res.status(400).json({ error: 'Invalid owner id.' });
    const { rows: target } = await db.query(
      `SELECT role FROM users WHERE id = $1::UUID`, [ownerId]
    );
    if (!target.length) return res.status(404).json({ error: 'Owner not found.' });
    if (!['admin', 'super_admin'].includes(target[0].role)) {
      return res.status(400).json({ error: 'Case owner must be an admin.' });
    }
    await db.query(
      `INSERT INTO admin_user_case_owner (target_user_id, owner_admin_id, assigned_by)
       VALUES ($1::UUID, $2::UUID, $3::UUID)
       ON CONFLICT (target_user_id)
       DO UPDATE SET owner_admin_id = EXCLUDED.owner_admin_id,
                     assigned_at = NOW(), assigned_by = EXCLUDED.assigned_by`,
      [userId, ownerId, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error('customer360 setCaseOwner error', { err });
    res.status(500).json({ error: 'Failed to set case owner.' });
  }
};

exports.clearCaseOwner = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isUuid(userId)) return res.status(400).json({ error: 'Invalid user id.' });
    await db.query(`DELETE FROM admin_user_case_owner WHERE target_user_id = $1::UUID`, [userId]);
    res.json({ ok: true });
  } catch (err) {
    logger.error('customer360 clearCaseOwner error', { err });
    res.status(500).json({ error: 'Failed to clear case owner.' });
  }
};

/**
 * GET /admin/users/:userId/related-search?q=
 * Cross-customer search: finds notes, disputes, and tickets mentioning
 * this user (by name/email) that belong to OTHER users' records.
 */
exports.relatedSearch = async (req, res) => {
  try {
    const { userId } = req.params;
    const q = String(req.query.q || '').trim();
    if (!isUuid(userId)) return res.status(400).json({ error: 'Invalid user id.' });
    if (q.length < 3) return res.status(400).json({ error: 'Search needs at least 3 characters.' });
    const like = `%${q}%`;
    const results = [];

    if (await tableExists('admin_user_notes')) {
      const { rows } = await db.query(
        `SELECT n.id, n.note_text, n.created_at, n.target_user_id,
                u.first_name || ' ' || u.last_name AS subject_name, u.email AS subject_email
         FROM admin_user_notes n
         JOIN users u ON u.id = n.target_user_id
         WHERE n.note_text ILIKE $1 AND n.target_user_id <> $2::UUID
         ORDER BY n.created_at DESC LIMIT 20`,
        [like, userId]
      );
      rows.forEach((r) => results.push({ kind: 'note', ...r }));
    }
    if (await tableExists('disputes')) {
      const { rows } = await db.query(
        `SELECT d.id, d.reason, d.description, d.status, d.opened_at AS created_at,
                d.opened_by AS target_user_id,
                u.first_name || ' ' || u.last_name AS subject_name, u.email AS subject_email
         FROM disputes d
         LEFT JOIN users u ON u.id = d.opened_by
         WHERE (d.description ILIKE $1 OR d.reason ILIKE $1)
           AND d.opened_by <> $2::UUID AND d.against_user <> $2::UUID
         ORDER BY d.opened_at DESC LIMIT 20`,
        [like, userId]
      );
      rows.forEach((r) => results.push({ kind: 'dispute', ...r }));
    }
    if (await tableExists('support_tickets')) {
      const { rows } = await db.query(
        `SELECT t.id, t.subject, t.status, t.created_at,
                t.user_id AS target_user_id,
                u.first_name || ' ' || u.last_name AS subject_name, u.email AS subject_email
         FROM support_tickets t
         LEFT JOIN users u ON u.id = t.user_id
         WHERE t.subject ILIKE $1
           AND t.user_id <> $2::UUID
         ORDER BY t.created_at DESC LIMIT 20`,
        [like, userId]
      );
      rows.forEach((r) => results.push({ kind: 'ticket', description: r.subject, ...r }));
    }
    results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ results: results.slice(0, 50), query: q });
  } catch (err) {
    logger.error('customer360 relatedSearch error', { err });
    res.status(500).json({ error: 'Failed to search related records.' });
  }
};
