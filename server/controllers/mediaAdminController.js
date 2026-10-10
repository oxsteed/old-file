'use strict';
const mediaSafety = require('../services/mediaSafetyPolicy');
const { verifiedActorSql } = require('../services/mediaPublisherPolicy');

// OxSteed Media admin: flag queue + post moderation.

const pool = require('../db');
const logger = require('../utils/logger');
const auditService = require('../services/auditService');
const { listCreditDisputes } = require('../services/oxsteedCreditService');
const { resolveDisputeWithCompensation } = require('../services/oxsteedCreditDisputeService');
const { sendMediaError } = require('../utils/mediaError');
const { recordCloudflareMatchTakedown } = require('../services/mediaCloudflareTakedown');

const MEDIA_PAYMENT_REFERENCE_TYPES = Object.freeze([
  'media_creator_tip',
  'media_creator_gig',
  'media_creator_sponsorship',
  'media_post_boost',
]);

function mediaPaymentKind(referenceType) {
  return referenceType === 'media_creator_tip' ? 'tip'
    : referenceType === 'media_creator_gig' ? 'gig'
    : referenceType === 'media_creator_sponsorship' ? 'sponsorship'
      : referenceType === 'media_post_boost' ? 'boost' : null;
}

async function assertMediaCreatorDispute(disputeId) {
  const { rows } = await pool.query(
    `SELECT d.id, t.reference_type
       FROM oxsteed_credit_disputes d
       JOIN oxsteed_credit_transactions t ON t.id = d.transaction_id
      WHERE d.id = $1 AND t.reference_type = ANY($2::text[])`,
    [disputeId, MEDIA_PAYMENT_REFERENCE_TYPES]
  );
  if (!rows[0]) {
    const error = new Error('Media creator dispute not found');
    error.status = 404;
    error.code = 'media_creator_dispute_not_found';
    throw error;
  }
  return rows[0];
}

async function listCreatorDisputes(req, res, next) {
  try {
    const result = await listCreditDisputes({
      referenceTypes: MEDIA_PAYMENT_REFERENCE_TYPES,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
      includePagination: true,
    });
    res.json({
      ...result,
      disputes: result.disputes.map((dispute) => ({
        ...dispute,
        mediaKind: mediaPaymentKind(dispute.referenceType),
      })),
    });
  } catch (err) { next(err); }
}

async function reviewCreatorDispute(req, res, next) {
  try {
    await assertMediaCreatorDispute(req.params.disputeId);
    const result = await resolveDisputeWithCompensation({
      disputeId: req.params.disputeId,
      adminId: req.user.id,
      decision: 'in_review',
      reason: req.body?.reason || req.body?.resolution,
      requestIp: req.ip || null,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
    });
    res.json(result);
  } catch (err) { next(err); }
}

async function resolveCreatorDispute(req, res, next) {
  try {
    await assertMediaCreatorDispute(req.params.disputeId);
    const decision = req.body?.status === 'resolved' ? 'resolved_merchant' : req.body?.status || req.body?.decision;
    const result = await resolveDisputeWithCompensation({
      disputeId: req.params.disputeId,
      adminId: req.user.id,
      decision,
      reason: req.body?.reason || req.body?.resolution,
      compensationCents: req.body?.compensationCents ?? req.body?.compensation_cents ?? 0,
      requestIp: req.ip || null,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
    });
    res.json(result);
  } catch (err) { next(err); }
}

async function listFlags(req, res) {
  try {
    const status = req.query.status || 'open';
    const { rows } = await pool.query(
      `SELECT f.*, p.body AS post_body, p.visibility, p.moderation_state, p.moderation_reason,
              a.display_name AS actor_name, a.handle AS actor_handle,
              COALESCE((SELECT json_agg(json_build_object(
                'id', pa.id, 'asset_type', pa.asset_type,
                'processing_status', pa.processing_status, 'csam_status', pa.csam_status,
                'delivery_revoked_at', pa.delivery_revoked_at
              ) ORDER BY pa.sort_order) FROM media_post_assets pa WHERE pa.post_id = p.id), '[]'::json) AS assets
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
    sendMediaError(res, err, 'Failed to load flags');
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
    sendMediaError(res, err, 'Failed to load pending posts');
  }
}

async function reviewFlag(req, res) {
  const client = await pool.connect();
  try {
    const { action, takedownReason } = req.body;
    // action: dismiss | remove | dmca
    if (!['dismiss', 'remove', 'dmca'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM media_post_flags WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Flag not found' });
    }
    const flag = rows[0];

    const newStatus = action === 'dismiss' ? 'dismissed' : action === 'dmca' ? 'dmca' : 'removed';
    const { rows: updatedFlags } = await client.query(
      `UPDATE media_post_flags
       SET status = $1, decided_by = $2, decided_at = NOW()
       WHERE id = $3 AND status = $4
       RETURNING *`,
      [newStatus, req.user.id, flag.id, flag.status]
    );
    if (!updatedFlags[0]) {
      const error = new Error('The moderation decision could not be saved.');
      error.status = 503;
      error.code = 'media_flag_transition_failed';
      error.isOperational = true;
      throw error;
    }

    if (action === 'remove' || action === 'dmca') {
      const { rows: updatedPosts } = await client.query(
        `WITH updated_post AS (
          UPDATE media_posts
             SET visibility = 'removed', moderation_state = $2,
                 moderation_reason = $3, moderation_updated_by = $4,
                 moderation_updated_at = NOW()
           WHERE id = $1
           RETURNING id, visibility, moderation_state
        ), revoked_assets AS (
          UPDATE media_post_assets asset
             SET delivery_revoked_at = COALESCE(asset.delivery_revoked_at, NOW()),
                 delivery_revoke_reason = COALESCE(asset.delivery_revoke_reason, $2)
            FROM updated_post
           WHERE asset.post_id = updated_post.id
           RETURNING asset.id, asset.post_id, asset.storage_key, asset.thumbnail_key, asset.renditions
        ), queued_cleanup AS (
          INSERT INTO media_asset_cleanup_jobs (asset_id, post_id, storage_keys, reason)
          SELECT id, post_id,
                 to_jsonb(ARRAY[storage_key, thumbnail_key]::text[])
                   || COALESCE((SELECT jsonb_agg(rendition->>'storage_key')
                                  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(renditions) = 'array'
                                    THEN renditions ELSE '[]'::jsonb END) rendition), '[]'::jsonb),
                 $2
            FROM revoked_assets
          ON CONFLICT (asset_id, reason) DO NOTHING
          RETURNING 1
        )
        SELECT id, visibility, moderation_state FROM updated_post`,
        [flag.post_id, action === 'dmca' ? 'dmca_removed' : 'admin_removed', takedownReason || action, req.user.id]
      );
      if (!updatedPosts[0]) {
        const error = new Error('The flagged post could not be removed.');
        error.status = 503;
        error.code = 'media_flag_post_transition_failed';
        error.isOperational = true;
        throw error;
      }
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
      client,
      throwOnError: true,
    });
    await client.query('COMMIT');
    res.json({ ok: true, status: newStatus });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('mediaAdmin.reviewFlag error', { message: err.message });
    sendMediaError(res, err, 'Failed to review flag');
  } finally {
    client.release();
  }
}

async function getFlagEvidence(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.body, p.visibility, p.moderation_state, p.moderation_reason,
              p.processing_status, p.csam_status, p.created_at,
              json_build_object('id', a.id, 'handle', a.handle,
                'display_name', a.display_name, 'actor_type', a.actor_type) AS actor,
              COALESCE((SELECT json_agg(json_build_object(
                'id', pa.id, 'asset_type', pa.asset_type, 'provider', pa.provider,
                'processing_status', pa.processing_status, 'csam_status', pa.csam_status,
                'published_without_csam', pa.published_without_csam,
                'delivery_revoked_at', pa.delivery_revoked_at,
                'storage_key', pa.storage_key, 'thumbnail_key', pa.thumbnail_key,
                'renditions', pa.renditions
              ) ORDER BY pa.sort_order) FROM media_post_assets pa WHERE pa.post_id = p.id), '[]'::json) AS assets,
              COALESCE((SELECT json_agg(f ORDER BY f.created_at DESC)
                  FROM media_post_flags f WHERE f.post_id = p.id), '[]'::json) AS flags
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE p.id = $1`, [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Post not found' });
    return res.json({ evidence: rows[0] });
  } catch (err) {
    logger.error('mediaAdmin.getFlagEvidence error', { message: err.message });
    return sendMediaError(res, err, 'Failed to load moderation evidence');
  }
}

async function restorePost(req, res) {
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'A moderation restore reason is required', code: 'media_restore_reason_required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT p.*, a.actor_type, ${verifiedActorSql('a')} AS current_actor_verified
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE p.id = $1 AND p.deleted_at IS NULL FOR UPDATE OF p`, [req.params.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Post not found' });
    }
    const post = rows[0];
    if (['dmca_removed', 'safety_blocked'].includes(post.moderation_state)
        || post.csam_status === 'flagged' || post.processing_status === 'blocked') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This post is protected by a safety or DMCA block and cannot be restored.', code: 'media_restore_safety_blocked' });
    }
    const { rows: assets } = await client.query(
      `SELECT * FROM media_post_assets WHERE post_id = $1 FOR UPDATE`, [req.params.id]
    );
    if (post.current_actor_verified !== true || post.processing_status !== 'ready'
        || !mediaSafety.postVerdictAllowed(post.csam_status)
        || assets.some((asset) => !mediaSafety.assetReady(asset))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Current verification and safety checks must pass before restore.', code: 'media_restore_safety_pending' });
    }
    await client.query(
      `UPDATE media_posts
          SET visibility = 'public', moderation_state = 'clear', moderation_reason = $2,
              moderation_updated_by = $3, moderation_updated_at = NOW(),
              admin_override_by = $3, admin_override_at = NOW(), admin_override_reason = $2
        WHERE id = $1`, [req.params.id, reason, req.user.id]
    );
    await client.query(
      `UPDATE media_post_assets
          SET delivery_revoked_at = NULL, delivery_revoke_reason = NULL
        WHERE post_id = $1 AND delivery_revoke_reason = 'admin_removed'`, [req.params.id]
    );
    await client.query(
      `UPDATE media_asset_cleanup_jobs SET status = 'done', updated_at = NOW()
        WHERE post_id = $1 AND status IN ('pending','failed') AND reason = 'admin_removed'`, [req.params.id]
    );
    await auditService.logAdminAction({
      adminId: req.user.id, action: 'media_post_restored', targetType: 'media_post', targetId: req.params.id,
      description: 'Administrator restored a Media post after current safety checks.',
      before: { visibility: post.visibility, moderation_state: post.moderation_state },
      after: { visibility: 'public', moderation_state: 'clear', reason }, client, throwOnError: true,
    });
    await client.query('COMMIT');
    return res.json({ ok: true, restored: true, moderation_state: 'clear' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('mediaAdmin.restorePost error', { message: err.message });
    return sendMediaError(res, err, 'Failed to restore post');
  } finally {
    client.release();
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
              u.is_verified AS is_verified, a.actor_type,
              ${verifiedActorSql('a')} AS current_actor_verified
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
    // Treat an unavailable or malformed verification result as unverified.
    // Approval must never rely on a nullable/partial actor row.
    if (post.current_actor_verified !== true) {
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
    if (post.visibility === 'removed' || post.processing_status !== 'ready'
        || !mediaSafety.postVerdictAllowed(post.csam_status)
        || assets.some((asset) => !mediaSafety.assetReady(asset))
        || (videos.length > 0 && !post.is_verified)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Required safety checks and processing must finish before this post can be approved.',
        code: 'media_safety_pending',
      });
    }
    const { rows: approvedRows } = await client.query(
      `UPDATE media_posts
          SET visibility = 'public',
              admin_override_by = $2, admin_override_at = NOW(), admin_override_reason = $3
        WHERE id = $1 AND visibility <> 'removed' AND deleted_at IS NULL
        RETURNING id, visibility, admin_override_by`, [req.params.id, req.user.id, reason]
    );
    if (!approvedRows[0]) {
      throw Object.assign(new Error('The post could not be approved in its current state.'), {
        status: 409,
        code: 'media_approval_transition_failed',
        isOperational: true,
      });
    }
    await auditService.logAdminAction({
      adminId: req.user.id,
      action: 'media_post_admin_approved',
      targetType: 'media_post',
      targetId: req.params.id,
      description: 'Administrator approved a safety-cleared OxSteed Media post for publication.',
      before: rows[0],
      after: { visibility: 'public', processing_status: 'ready', csam_status: post.csam_status, safety_mode: mediaSafety.mode(), reason },
      client,
      throwOnError: true,
    });
    await client.query('COMMIT');
    return res.json({ ok: true, approved: true, admin_override: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('mediaAdmin.approvePost error', { message: err.message });
    return sendMediaError(res, err, 'Failed to approve post');
  } finally {
    client.release();
  }
}

async function takedownByPublicUrl(req, res) {
  try {
    const publicUrl = typeof req.body?.public_url === 'string' ? req.body.public_url.trim()
      : typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!publicUrl) {
      return res.status(400).json({ error: 'A public media URL is required.', code: 'media_csam_url_required' });
    }
    const result = await recordCloudflareMatchTakedown({
      publicUrl,
      adminId: req.user.id,
      note: note || `Manual Cloudflare CSAM match takedown by admin ${req.user.id}`,
    });
    return res.json(result);
  } catch (err) {
    logger.error('mediaAdmin.takedownByPublicUrl error', { message: err.message });
    return sendMediaError(res, err, 'Failed to quarantine media from URL');
  }
}

module.exports = {
  listFlags,
  getFlagEvidence,
  listPendingPosts,
  reviewFlag,
  restorePost,
  approvePost,
  takedownByPublicUrl,
  listCreatorDisputes,
  reviewCreatorDispute,
  resolveCreatorDispute,
};
