'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const auditService = require('../services/auditService');
const { sendMediaError } = require('../utils/mediaError');

const REVIEW_STATUSES = new Set(['in_review', 'needs_changes', 'approved', 'rejected']);

async function listVerificationRequests(req, res) {
  const status = String(req.query.status || '').trim();
  const values = [];
  const where = status ? 'WHERE r.status = $1' : '';
  if (status) values.push(status);
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.requester_user_id, r.entity_type, r.entity_id, r.status,
              r.details, r.reviewer_note, r.submitted_at, r.reviewed_at, r.updated_at,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS requester_name,
              u.email AS requester_email,
              CASE WHEN r.entity_type = 'business' THEN b.business_name ELSE fr.display_name END AS entity_name,
              CASE WHEN r.entity_type = 'business' THEN b.is_business_verified ELSE fr.is_verified END AS entity_verified
         FROM media_verification_requests r
         JOIN users u ON u.id = r.requester_user_id
         LEFT JOIN businesses b ON r.entity_type = 'business' AND b.id::text = r.entity_id
         LEFT JOIN food_restaurants fr ON r.entity_type = 'restaurant' AND fr.id::text = r.entity_id
        ${where}
        ORDER BY r.submitted_at DESC
        LIMIT 200`,
      values
    );
    return res.json({ requests: rows });
  } catch (err) {
    logger.error('mediaVerificationAdmin.list error', { message: err.message });
    return sendMediaError(res, err, 'Failed to load verification requests.');
  }
}

async function reviewVerificationRequest(req, res) {
  const status = String(req.body?.status || '').trim().toLowerCase();
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 4000) : '';
  if (!REVIEW_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Choose a valid verification decision.', code: 'media_verification_invalid_review' });
  }
  if ((status === 'needs_changes' || status === 'rejected') && note.length < 3) {
    return res.status(400).json({ error: 'Add a note explaining what the requester should do next.', code: 'media_verification_note_required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM media_verification_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    const request = rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Verification request not found.' });
    }
    if (['approved', 'rejected', 'withdrawn'].includes(request.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This verification request has already been decided.', code: 'media_verification_already_decided' });
    }

    let entity;
    if (request.entity_type === 'business') {
      const result = await client.query(
        `SELECT id::text, business_name AS display_name, COALESCE(is_business_verified, FALSE) AS is_verified
           FROM businesses
          WHERE id::text = $1 AND user_id = $2 AND COALESCE(deleted_at IS NULL, TRUE)
          FOR UPDATE`,
        [request.entity_id, request.requester_user_id]
      );
      entity = result.rows[0];
    } else if (request.entity_type === 'restaurant') {
      const result = await client.query(
        `SELECT id::text, display_name, COALESCE(is_verified, FALSE) AS is_verified
           FROM food_restaurants
          WHERE id::text = $1 AND owner_user_id = $2 AND status <> 'suspended'
          FOR UPDATE`,
        [request.entity_id, request.requester_user_id]
      );
      entity = result.rows[0];
    }
    if (!entity) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'The linked entity is no longer available for verification.', code: 'media_verification_entity_unavailable' });
    }
    if (status === 'approved' && entity.is_verified) {
      await client.query(
        `UPDATE media_verification_requests
            SET status = 'approved', reviewed_by = $2, reviewer_note = $3, reviewed_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [request.id, req.user.id, note || null]
      );
    } else {
      if (status === 'approved') {
        const table = request.entity_type === 'business' ? 'businesses' : 'food_restaurants';
        const flag = request.entity_type === 'business' ? 'is_business_verified' : 'is_verified';
        await client.query(
          `UPDATE ${table} SET ${flag} = TRUE, updated_at = NOW() WHERE id::text = $1`,
          [request.entity_id]
        );
      }
      await client.query(
        `UPDATE media_verification_requests
            SET status = $2, reviewed_by = $3, reviewer_note = $4,
                reviewed_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [request.id, status, req.user.id, note || null]
      );
    }
    const after = { status, entity_type: request.entity_type, entity_id: request.entity_id, note: note || null };
    await auditService.logAdminAction({
      adminId: req.user.id,
      action: `media_verification_${status}`,
      targetType: request.entity_type,
      targetId: request.entity_id,
      targetKey: request.id,
      description: `Media ${request.entity_type} verification request marked ${status}.`,
      before: { status: request.status, verified: entity.is_verified },
      after,
      req,
      client,
      throwOnError: true,
    });
    await client.query('COMMIT');
    return res.json({ ok: true, status, request_id: request.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('mediaVerificationAdmin.review error', { message: err.message, requestId: req.params.id });
    return sendMediaError(res, err, 'Could not review verification request.');
  } finally {
    client.release();
  }
}

module.exports = { listVerificationRequests, reviewVerificationRequest };
