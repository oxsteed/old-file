'use strict';

// OxSteed Media admin: flag queue + post moderation.

const pool = require('../db');
const logger = require('../utils/logger');

async function listFlags(req, res) {
  try {
    const status = req.query.status || 'open';
    const { rows } = await pool.query(
      `SELECT f.*, p.body AS post_body, a.display_name AS actor_name, a.handle AS actor_handle
         FROM media_post_flags f
         JOIN media_posts p ON p.id = f.post_id
         JOIN media_actors a ON a.id = p.actor_id
        WHERE f.status = $1
        ORDER BY f.created_at DESC LIMIT 50`,
      [status]
    );
    res.json({ flags: rows });
  } catch (err) {
    logger.error('mediaAdmin.listFlags error', { message: err.message });
    res.status(500).json({ error: 'Failed to load flags' });
  }
}

async function reviewFlag(req, res) {
  try {
    const { action, takedownReason } = req.body;
    // action: dismiss | remove | dmca
    if (!['dismiss', 'remove', 'dmca'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    const { rows } = await pool.query(
      `SELECT * FROM media_post_flags WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Flag not found' });
    const flag = rows[0];

    const newStatus = action === 'dismiss' ? 'dismissed' : action === 'dmca' ? 'dmca' : 'removed';
    await pool.query(
      `UPDATE media_post_flags
       SET status = $1, decided_by = $2, decided_at = NOW()
       WHERE id = $3`,
      [newStatus, req.user.id, flag.id]
    );

    if (action === 'remove' || action === 'dmca') {
      await pool.query(
        `UPDATE media_posts SET visibility = 'removed' WHERE id = $1`,
        [flag.post_id]
      );
    }

    // TODO: logAdminAction
    res.json({ ok: true, status: newStatus });
  } catch (err) {
    logger.error('mediaAdmin.reviewFlag error', { message: err.message });
    res.status(500).json({ error: 'Failed to review flag' });
  }
}

async function approvePost(req, res) {
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'An approval reason is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, processing_status, csam_status FROM media_posts
        WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [req.params.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Post not found' });
    }
    await client.query(
      `UPDATE media_posts
          SET visibility = 'public', processing_status = 'ready', csam_status = 'passed',
              admin_override_by = $2, admin_override_at = NOW(), admin_override_reason = $3
        WHERE id = $1`, [req.params.id, req.user.id, reason]
    );
    await client.query(
      `UPDATE media_post_assets
          SET processing_status = 'ready', csam_status = CASE WHEN asset_type = 'video' THEN 'passed' ELSE csam_status END
        WHERE post_id = $1`, [req.params.id]
    );
    await client.query(
      `UPDATE media_processing_jobs SET status = 'done', updated_at = NOW()
        WHERE post_id = $1 AND status IN ('pending', 'processing')`, [req.params.id]
    );
    await client.query('COMMIT');
    return res.json({ ok: true, approved: true, admin_override: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('mediaAdmin.approvePost error', { message: err.message });
    return res.status(500).json({ error: 'Failed to approve post' });
  } finally {
    client.release();
  }
}

module.exports = { listFlags, reviewFlag, approvePost };
