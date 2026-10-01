// server/services/profileVisibilityApprovals.js
// Workstream B: two-person approval workflow for high-risk (bulk) and
// scheduled profile-visibility actions.
//
// Flow: requestApproval -> (second admin) reviewApproval -> approved
// -> verifyApprovalForAction (bind approval to the exact payload that was
//    reviewed) -> consumeApproval (once the action executes).
//
// Fingerprint: sha256 over canonical JSON of {actionType, normalized payload}
// so the approval cannot be replayed against a different payload.

'use strict';

const crypto = require('crypto');
const db = require('../db');
const logger = require('../utils/logger');
const { logAdminAction } = require('./auditService');

const ACTION_TYPES = ['single', 'bulk', 'scheduled'];
const DECISIONS = ['approved', 'rejected'];
const EXECUTABLE_TYPES = ['bulk', 'scheduled'];

function approvalError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// Recursively sort object keys so semantically identical payloads hash the
// same regardless of key order. Arrays keep their order (order is significant).
function normalizeForHash(value) {
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = normalizeForHash(value[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return value;
}

function computeFingerprint(actionType, payload) {
  const canonical = JSON.stringify({ actionType, payload: normalizeForHash(payload) });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// Lazily resolved; workstream A may export an applySingleVisibility helper
// from profileVisibilityController.js. If it does not exist we fall back to
// the inline UPDATE + audit below, which mirrors setProfileVisibility.
let visibilityControllerCache = null;
let visibilityControllerResolved = false;
function getVisibilityController() {
  if (visibilityControllerResolved) return visibilityControllerCache;
  visibilityControllerResolved = true;
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    visibilityControllerCache = require('../controllers/profileVisibilityController');
  } catch (err) {
    logger.warn('profileVisibilityApprovals: visibility controller unavailable, using inline apply', {
      error: err.message,
    });
    visibilityControllerCache = null;
  }
  return visibilityControllerCache;
}

const TABLE_BY_TYPE = {
  helper: { table: 'helper_profiles', idCol: 'user_id', targetType: 'helper_profile' },
  business: { table: 'businesses', idCol: 'id', targetType: 'business' },
  restaurant: { table: 'food_restaurants', idCol: 'id', targetType: 'restaurant' },
};

const REASONS = ['incomplete_profile', 'non_compliance', 'admin_decision', 'other'];

async function applySingleInline(profileType, profileId, isVisible, { reason, note, actorId }) {
  const spec = TABLE_BY_TYPE[profileType];
  if (!spec) throw approvalError(400, 'invalid_profile_type', `Unknown profile_type: ${profileType}`);
  if (typeof isVisible !== 'boolean') throw approvalError(400, 'invalid_is_visible', 'is_visible must be a boolean.');
  const hide = !isVisible;
  const reasonCode = hide ? (reason || 'admin_decision') : null;
  if (reasonCode && !REASONS.includes(reasonCode)) {
    throw approvalError(400, 'invalid_reason', `reason must be one of: ${REASONS.join(', ')}.`);
  }
  const { rows } = await db.query(
    `UPDATE ${spec.table}
        SET is_hidden_by_admin = $1,
            hidden_reason      = $2,
            hidden_at          = CASE WHEN $1 THEN NOW() ELSE NULL END,
            hidden_by          = CASE WHEN $1 THEN $3 ELSE NULL END,
            updated_at         = NOW()
      WHERE ${spec.idCol} = $4
      RETURNING is_hidden_by_admin`,
    [hide, reasonCode, actorId, profileId]
  );
  if (!rows.length) throw approvalError(404, 'profile_not_found', `Profile not found: ${profileType}/${profileId}`);
  try {
    await logAdminAction({
      adminId: actorId,
      action: hide ? 'profile_visibility_hidden' : 'profile_visibility_restored',
      targetType: spec.targetType,
      targetId: String(profileId),
      before: { is_hidden_by_admin: !hide },
      after: { is_hidden_by_admin: hide, hidden_reason: reasonCode, via: 'approval' },
      description: [reasonCode, note].filter(Boolean).join(' - ') || null,
    });
  } catch (e) { /* audit logging must not block the moderation action */ }
  return { profileType, profileId, isVisible };
}

async function applySingleVisibility(profileType, profileId, isVisible, opts) {
  const ctrl = getVisibilityController();
  if (ctrl && typeof ctrl.applySingleVisibility === 'function') {
    return ctrl.applySingleVisibility(profileType, profileId, isVisible, opts);
  }
  return applySingleInline(profileType, profileId, isVisible, opts);
}

// Expected shape for a bulk approval payload:
//   { items: [ { profile_type, profile_id, is_visible, reason?, note? } ] }
// The items are re-validated and applied one by one; each failure is
// collected so a single bad item cannot abort the rest (partial failure).
async function executeBulkAction(payload, requestedBy, actorId) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const results = [];
  for (const item of items) {
    try {
      const applied = await applySingleVisibility(
        String(item.profile_type || '').toLowerCase(),
        String(item.profile_id || ''),
        item.is_visible === true,
        { reason: item.reason, note: item.note, actorId: actorId || requestedBy }
      );
      results.push({ ...applied, success: true });
    } catch (err) {
      logger.warn('profileVisibilityApprovals: bulk item failed', {
        item,
        error: err.message,
      });
      results.push({
        profile_type: item?.profile_type,
        profile_id: item?.profile_id,
        success: false,
        error: err.message,
      });
    }
  }
  return results;
}

// Expected shape for a scheduled approval payload:
//   { profile_type, profile_id, is_visible, scheduled_at (ISO), reason?, note? }
// Inserts into the workstream-A scheduled-actions table; the scheduled
// worker (workstream A) executes it at the due time. The insert is
// defensive: if migration 617 has not applied yet the approval stays
// 'approved' (not lost) and the insert error is re-raised for the caller.
async function executeScheduledAction(payload, approval, actorId) {
  const { rows } = await db.query(
    `INSERT INTO profile_visibility_scheduled_actions
       (profile_type, profile_id, is_visible, scheduled_at, reason, note, approval_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      String(payload.profile_type || '').toLowerCase(),
      String(payload.profile_id || ''),
      payload.is_visible === true,
      payload.scheduled_at,
      payload.reason || null,
      payload.note || null,
      approval.id,
      actorId,
    ]
  );
  return { scheduledActionId: rows[0].id };
}

/**
 * Create an approval request, idempotently.
 * If idempotencyKey was seen before, returns the existing row (no new row).
 */
async function requestApproval({ actionType, payload, requestedBy, idempotencyKey }) {
  if (!ACTION_TYPES.includes(actionType)) {
    throw approvalError(400, 'invalid_action_type', `action_type must be one of: ${ACTION_TYPES.join(', ')}.`);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw approvalError(400, 'invalid_payload', 'payload must be a JSON object.');
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    throw approvalError(400, 'idempotency_key_required', 'idempotency_key is required.');
  }
  const fingerprint = computeFingerprint(actionType, payload);
  const key = idempotencyKey.trim().slice(0, 255);

  const { rows } = await db.query(
    `INSERT INTO profile_visibility_approvals
       (action_type, payload, fingerprint, idempotency_key, requested_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [actionType, JSON.stringify(payload), fingerprint, key, requestedBy]
  );
  if (rows.length) return { approval: rows[0], created: true };

  const existing = await db.query(
    'SELECT * FROM profile_visibility_approvals WHERE idempotency_key = $1',
    [key]
  );
  return { approval: existing.rows[0] || null, created: false };
}

/**
 * Verify an approval for a concrete action attempt.
 * Returns the approval row only when it is approved AND the fingerprint of
 * the normalized action payload matches the one that was reviewed.
 */
async function verifyApprovalForAction({ approvalId, actionType, payload }) {
  if (!approvalId) return null;
  const { rows } = await db.query(
    'SELECT * FROM profile_visibility_approvals WHERE id = $1',
    [approvalId]
  );
  const approval = rows[0];
  if (!approval || approval.status !== 'approved') return null;
  if (approval.action_type !== actionType) return null;
  return computeFingerprint(actionType, payload) === approval.fingerprint ? approval : null;
}

/**
 * Consume an approval exactly once. Only an 'approved' approval can be
 * consumed; the row moves to 'consumed' with consumed_at.
 */
async function consumeApproval(approvalId) {
  const { rows } = await db.query(
    `UPDATE profile_visibility_approvals
        SET status = 'consumed', consumed_at = NOW()
      WHERE id = $1 AND status = 'approved'
      RETURNING *`,
    [approvalId]
  );
  return rows[0] || null;
}

/**
 * Review (approve/reject) a pending approval request.
 * Separation of duties: the requesting admin cannot review their own
 * request (mirrors the settings-change 403 rule).
 *
 * Approving a 'bulk' approval executes the items immediately; approving a
 * 'scheduled' approval persists the scheduled action for the worker.
 */
async function reviewApproval({ approvalId, reviewerId, decision, note }) {
  if (!DECISIONS.includes(decision)) {
    throw approvalError(400, 'invalid_decision', `decision must be one of: ${DECISIONS.join(', ')}.`);
  }
  const { rows } = await db.query(
    'SELECT * FROM profile_visibility_approvals WHERE id = $1 FOR UPDATE',
    [approvalId]
  );
  const approval = rows[0];
  if (!approval) throw approvalError(404, 'approval_not_found', 'Approval request not found.');
  if (approval.requested_by === reviewerId) {
    throw approvalError(
      403,
      'separation_of_duties',
      'The admin who requested an approval cannot review it (separation of duties).'
    );
  }
  if (approval.status !== 'pending') {
    throw approvalError(
      409,
      'approval_not_pending',
      `Approval cannot be reviewed from status "${approval.status}".`
    );
  }

  const status = decision === 'approved' ? 'approved' : 'rejected';
  const { rows: updated } = await db.query(
    `UPDATE profile_visibility_approvals
        SET status = $2, reviewed_by = $3, reviewed_at = NOW(), review_note = $4
      WHERE id = $1
      RETURNING *`,
    [approvalId, status, reviewerId, note ? String(note).slice(0, 2000) : null]
  );
  const reviewed = updated[0];

  try {
    await logAdminAction({
      adminId: reviewerId,
      action: status === 'approved'
        ? 'profile_visibility_approval_approved'
        : 'profile_visibility_approval_rejected',
      targetType: 'profile_visibility_approval',
      targetId: approvalId,
      before: { status: 'pending', action_type: approval.action_type },
      after: { status, reviewed_by: reviewerId },
      description: note ? String(note).slice(0, 500) : null,
    });
  } catch (e) { /* audit logging must not block the review */ }

  let execution = null;
  if (status === 'approved' && EXECUTABLE_TYPES.includes(approval.action_type)) {
    try {
      if (approval.action_type === 'bulk') {
        execution = { results: await executeBulkAction(approval.payload, approval.requested_by, reviewerId) };
      } else if (approval.action_type === 'scheduled') {
        execution = await executeScheduledAction(approval.payload, approval, reviewerId);
      }
    } catch (err) {
      logger.error('profileVisibilityApprovals: execution after approval failed', {
        approvalId,
        actionType: approval.action_type,
        error: err.message,
      });
      throw approvalError(500, 'execution_failed', `Approval recorded but execution failed: ${err.message}`);
    }
  }

  return { approval: reviewed, execution };
}

module.exports = {
  ACTION_TYPES,
  computeFingerprint,
  requestApproval,
  verifyApprovalForAction,
  consumeApproval,
  reviewApproval,
};
