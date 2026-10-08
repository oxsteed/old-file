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
      `SELECT p.id, p.visibility, p.processing_status, p.csam_status,
              u.identity_verified, a.actor_type,
              CASE
                WHEN a.actor_type = 'helper' THEN EXISTS (
                  SELECT 1 FROM helper_profiles hp
                  JOIN users hu ON hu.id = hp.user_id
                  WHERE hp.user_id = a.owner_user_id
                    AND hu.identity_verified = TRUE
                    AND hu.is_active = TRUE AND hu.is_banned = FALSE
                    AND hu.deleted_at IS NULL
                )
                WHEN a.actor_type = 'business' THEN EXISTS (
                  SELECT 1 FROM businesses b
                  WHERE b.user_id = a.owner_user_id
                    AND b.deleted_at IS NULL AND b.is_active = TRUE
                    AND b.is_business_verified = TRUE
                )
                WHEN a.actor_type = 'restaurant' THEN EXISTS (
                  SELECT 1 FROM food_restaurants r
                  WHERE r.owner_user_id = a.owner_user_id
                    AND r.status <> 'suspended' AND r.is_verified = TRUE
                )
                ELSE FALSE
              END AS current_actor_verified
         FROM media_posts p
         JOIN media_actors a ON a.id = p.actor_id
         JOIN users u ON u.id = a.owner_user_id
        WHERE p.id = $1 AND p.deleted_at IS NULL
          AND u.is_active = TRUE AND u.is_banned = FALSE AND u.deleted_at IS NULL
        FOR UPDATE OF p`, [req.params.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Post not found' });
    }
    const post = rows[0];
    if (post.current_actor_verified === false) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'The current helper, business, or restaurant verification is required before approval.',
        code: 'media_not_verified_poster',
      });
    }
    const { rows: assets } = await client.query(
      `SELECT asset_type, processing_status, csam_status, renditions
         FROM media_post_assets WHERE post_id = $1 FOR UPDATE`, [req.params.id]
    );
    const videos = assets.filter((asset) => asset.asset_type === 'video');
    const certified = String(process.env.MEDIA_CSAM_CERTIFIED).toLowerCase() === 'true';
    const videoReady = videos.every((asset) => asset.csam_status === 'passed'
      && Array.isArray(asset.renditions) && asset.renditions.length > 0);
    if (post.visibility === 'removed' || post.processing_status !== 'ready'
        || post.csam_status !== 'passed'
        || assets.some((asset) => asset.processing_status !== 'ready'
          || !['passed', 'not_required'].includes(asset.csam_status))
        || (videos.length > 0 && (!certified || !post.identity_verified || !videoReady))) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Required safety checks and processing must finish before this post can be approved.',
        code: 'media_safety_pending',
      });
    }
    await client.query(
      `UPDATE media_posts
          SET visibility = 'public',
              admin_override_by = $2, admin_override_at = NOW(), admin_override_reason = $3
        WHERE id = $1`, [req.params.id, req.user.id, reason]
    );
    await auditService.logAdminAction({
      adminId: req.user.id,
      action: 'media_post_admin_approved',
      targetType: 'media_post',
      targetId: req.params.id,
      description: 'Administrator approved a safety-cleared OxSteed Media post for publication.',
      before: rows[0],
      after: { visibility: 'public', processing_status: 'ready', csam_status: 'passed', reason },
      client,
      throwOnError: true,
    });
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
