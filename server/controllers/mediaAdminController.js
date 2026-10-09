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

const MEDIA_PAYMENT_REFERENCE_TYPES = Object.freeze([
  'media_creator_tip',
  'media_creator_sponsorship',
  'media_post_boost',
]);

function mediaPaymentKind(referenceType) {
  return referenceType === 'media_creator_tip' ? 'tip'
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
        `UPDATE media_posts SET visibility = 'removed' WHERE id = $1 RETURNING id, visibility`,
        [flag.post_id]
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

async function approvePost(req, res) {
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'An approval reason is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT p.id, p.visibility, p.processing_status, p.csam_status,
              u.is_verified, a.actor_type,
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

module.exports = {
  listFlags,
  listPendingPosts,
  reviewFlag,
  approvePost,
  listCreatorDisputes,
  reviewCreatorDispute,
  resolveCreatorDispute,
};
