'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { sendMediaError } = require('../utils/mediaError');

const ENTITY_TYPES = new Set(['business', 'restaurant']);
const ACTIVE_STATUSES = ['submitted', 'in_review'];

function cleanDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const notes = typeof value.notes === 'string' ? value.notes.trim().slice(0, 4000) : '';
  return notes ? { notes } : {};
}

async function getCenter(req, res) {
  try {
    const userId = req.user.id;
    const [userResult, businessResult, restaurantResult] = await Promise.all([
      pool.query(
        `SELECT COALESCE(is_verified, FALSE) AS is_verified,
                COALESCE(didit_status, 'pending') AS didit_status,
                didit_verified_at
           FROM users WHERE id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT b.id::text, b.business_name, COALESCE(b.is_business_verified, FALSE) AS is_verified,
                req.id AS request_id, req.status AS request_status, req.details AS request_details,
                req.reviewer_note, req.submitted_at, req.reviewed_at
           FROM businesses b
           LEFT JOIN LATERAL (
             SELECT r.*
               FROM media_verification_requests r
              WHERE r.requester_user_id = $1
                AND r.entity_type = 'business'
                AND r.entity_id = b.id::text
              ORDER BY r.updated_at DESC
              LIMIT 1
           ) req ON TRUE
          WHERE b.user_id = $1 AND COALESCE(b.deleted_at IS NULL, TRUE)
          ORDER BY b.is_primary DESC, b.created_at ASC`,
        [userId]
      ),
      pool.query(
        `SELECT r.id::text, r.display_name, COALESCE(r.is_verified, FALSE) AS is_verified,
                req.id AS request_id, req.status AS request_status, req.details AS request_details,
                req.reviewer_note, req.submitted_at, req.reviewed_at
           FROM food_restaurants r
           LEFT JOIN LATERAL (
             SELECT vr.*
               FROM media_verification_requests vr
              WHERE vr.requester_user_id = $1
                AND vr.entity_type = 'restaurant'
                AND vr.entity_id = r.id::text
              ORDER BY vr.updated_at DESC
              LIMIT 1
           ) req ON TRUE
          WHERE r.owner_user_id = $1 AND r.status <> 'suspended'
          ORDER BY r.created_at ASC`,
        [userId]
      ),
    ]);

    return res.json({
      helper: userResult.rows[0] || { is_verified: false, didit_status: 'pending', didit_verified_at: null },
      businesses: businessResult.rows,
      restaurants: restaurantResult.rows,
    });
  } catch (err) {
    logger.error('mediaVerification.getCenter error', { message: err.message, userId: req.user?.id });
    return sendMediaError(res, err, 'Failed to load verification status.', { fallbackCode: 'media_verification_load_failed' });
  }
}

async function loadOwnedEntity(client, userId, entityType, entityId) {
  if (entityType === 'business') {
    const { rows } = await client.query(
      `SELECT id::text, business_name AS display_name, COALESCE(is_business_verified, FALSE) AS is_verified
         FROM businesses
        WHERE id::text = $1 AND user_id = $2 AND COALESCE(deleted_at IS NULL, TRUE)`,
      [String(entityId), userId]
    );
    return rows[0] ? { ...rows[0], entity_type: entityType } : null;
  }
  const { rows } = await client.query(
    `SELECT id::text, display_name, COALESCE(is_verified, FALSE) AS is_verified
       FROM food_restaurants
      WHERE id::text = $1 AND owner_user_id = $2 AND status <> 'suspended'`,
    [String(entityId), userId]
  );
  return rows[0] ? { ...rows[0], entity_type: entityType } : null;
}

async function createRequest(req, res) {
  const entityType = String(req.body?.entity_type || '').trim().toLowerCase();
  const entityId = String(req.body?.entity_id || '').trim();
  if (!ENTITY_TYPES.has(entityType) || !entityId || entityId.length > 80) {
    return res.status(400).json({ error: 'Choose a valid business or restaurant.', code: 'media_verification_invalid_entity' });
  }

  const details = cleanDetails(req.body?.details);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entity = await loadOwnedEntity(client, req.user.id, entityType, entityId);
    if (!entity) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'That entity is not available in your account.', code: 'media_verification_entity_not_found' });
    }
    if (entity.is_verified) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This entity is already verified.', code: 'media_verification_already_approved' });
    }

    const existing = await client.query(
      `SELECT * FROM media_verification_requests
        WHERE requester_user_id = $1 AND entity_type = $2 AND entity_id = $3
        ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
      [req.user.id, entityType, entityId]
    );
    let request;
    if (existing.rows[0] && ACTIVE_STATUSES.includes(existing.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A verification request is already in review.', code: 'media_verification_request_exists', request: existing.rows[0] });
    }
    if (existing.rows[0] && existing.rows[0].status === 'needs_changes') {
      const updated = await client.query(
        `UPDATE media_verification_requests
            SET status = 'submitted', details = $4::jsonb, reviewer_note = NULL,
                reviewed_by = NULL, reviewed_at = NULL, submitted_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND requester_user_id = $2 AND entity_type = $3
          RETURNING *`,
        [existing.rows[0].id, req.user.id, entityType, JSON.stringify(details)]
      );
      request = updated.rows[0];
    } else {
      const inserted = await client.query(
        `INSERT INTO media_verification_requests
          (requester_user_id, entity_type, entity_id, details)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING *`,
        [req.user.id, entityType, entityId, JSON.stringify(details)]
      );
      request = inserted.rows[0];
    }
    await client.query('COMMIT');
    return res.status(201).json({ request });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('mediaVerification.createRequest error', { message: err.message, userId: req.user?.id });
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A verification request is already in review.', code: 'media_verification_request_exists' });
    }
    return sendMediaError(res, err, 'Could not submit verification request.', { fallbackCode: 'media_verification_submit_failed' });
  } finally {
    client.release();
  }
}

module.exports = { getCenter, createRequest };
