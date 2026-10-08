'use strict';

// OxSteed Media admin: flag queue + post moderation.

const pool = require('../db');
const logger = require('../utils/logger');
const auditService = require('../services/auditService');

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

async function listPendingPosts(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.body, p.processing_status, p.csam_status, p.visibility, p.created_at,
              a.display_name AS actor_name, a.handle AS actor_handle,
              COALESCE(json_agg(json_build_object(
                'id', pa.id, 'asset_type', pa.asset_type,
                'processing_status', pa.processing_status, 'csam_status', pa.csam_status
              ) ORDER BY pa.sort_order) FILTER (WHERE pa.id IS NOT NULL), '[]'::json) AS assets
         FROM media_posts p
         JOIN media_actors a ON a.id = p.actor_id
         LEFT JOIN media_post_assets pa ON pa.post_id = p.id
        WHERE p.deleted_at IS NULL
          AND p.visibility <> 'removed'
          AND p.processing_status IN ('quarantine', 'failed', 'blocked')
        GROUP BY p.id, a.display_name, a.handle
        ORDER BY p.created_at DESC
        LIMIT 100`
    );
    res.json({ posts: rows });
  } catch (err) {
    logger.error('mediaAdmin.listPendingPosts error', { message: err.message });
    res.status(500).json({ error: 'Failed to load pending posts' });
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

    await auditService.logAdminAction({
      adminId: req.user.id,
      action: `media_flag_${newStatus}`,
      targetType: 'media_post',
      targetId: flag.post_id,
      description: `Media flag reviewed as ${newStatus}.`,
      before: { flag_status: flag.status },
      after: { flag_status: newStatus },
      req,
    });
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
      `SELECT id, visibility, processing_status, csam_status FROM media_posts
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
    await auditService.logAdminAction({
      adminId: req.user.id,
      action: 'media_post_admin_approved',
      targetType: 'media_post',
      targetId: req.params.id,
      description: 'Administrator approved a quarantined OxSteed Media post for publication.',
      before: rows[0],
      after: { visibility: 'public', processing_status: 'ready', csam_status: 'passed', reason },
      client,
      throwOnError: true,
    });
    await client.query(
      `UPDATE media_post_assets
          SET processing_status = 'ready', csam_status = CASE WHEN asset_type = 'video' THEN 'passed' ELSE csam_status END
        WHERE post_id = $1`, [req.params.id]
    );
    await client.query(
      `UPDATE media_processing_jobs SET status = 'done', updated_at = NOW()
        WHERE post_id = $1 AND status IN ('pending', 'queued', 'processing', 'running')`, [req.params.id]
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

module.exports = { listFlags, listPendingPosts, reviewFlag, approvePost };
