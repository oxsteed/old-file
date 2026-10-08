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

module.exports = { listFlags, reviewFlag };
