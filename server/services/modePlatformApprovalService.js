// server/services/modePlatformApprovalService.js
//
// Platform-approval gate for mode actions. Mode switch itself is always
// instant (handled by modeRole.js); this service governs specific actions
// inside a mode that require OxSteed sign-off — e.g., a consultant
// accepting a paying client.
//
// One concept, three operations:
//   * `canPerformAction(userId, mode, action)`  → boolean + status
//   * `requestApproval(userId, mode, payload)`  → 'auto_approved' | 'pending'
//   * `decideApproval(reviewerId, approvalId, decision, notes)` → updated row
//
// Both the user-facing flow (request) and the admin flow (decide) live here.
// The controller is a thin HTTP wrapper.

'use strict';

const pool = require('../db');
const logger = require('../utils/logger');

const POLICY_CACHE = new Map(); // mode -> { policy, ts }
const POLICY_TTL_MS = 60 * 1000;

function cachePolicy(mode, policy) {
  POLICY_CACHE.set(mode, { policy, ts: Date.now() });
}
function readCachedPolicy(mode) {
  const entry = POLICY_CACHE.get(mode);
  if (!entry) return null;
  if (Date.now() - entry.ts > POLICY_TTL_MS) {
    POLICY_CACHE.delete(mode);
    return null;
  }
  return entry.policy;
}
function invalidatePolicy(mode) {
  if (mode) POLICY_CACHE.delete(mode);
  else POLICY_CACHE.clear();
}

/**
 * Fetch the policy for a mode. Returns null if no row exists (treat as "no
 * gate"). Callers should always check `policy?.requires_approval` before
 * gating.
 */
async function getPolicy(mode) {
  if (!mode) return null;
  const cached = readCachedPolicy(mode);
  if (cached) return cached;
  const { rows } = await pool.query(
    'SELECT mode, requires_approval, auto_approve, gated_actions, application_schema, updated_at FROM mode_platform_approval_policies WHERE mode = $1',
    [mode],
  );
  const policy = rows[0] || null;
  if (policy) cachePolicy(mode, policy);
  return policy;
}

async function listPolicies() {
  const { rows } = await pool.query(
    'SELECT mode, requires_approval, auto_approve, gated_actions, application_schema, updated_at, updated_by_user_id FROM mode_platform_approval_policies ORDER BY mode',
  );
  return rows;
}

async function updatePolicy({ mode, requires_approval, auto_approve, gated_actions, application_schema, updated_by_user_id }) {
  if (!mode) {
    const err = new Error('mode_required');
    err.code = 'mode_required';
    throw err;
  }
  const fields = [];
  const values = [];
  let i = 1;
  function set(col, val) {
    if (val === undefined) return;
    fields.push(`${col} = $${i++}`);
    values.push(val);
  }
  set('requires_approval', requires_approval);
  set('auto_approve', auto_approve);
  set('gated_actions', gated_actions);
  set('application_schema', application_schema === undefined ? undefined : JSON.stringify(application_schema));
  set('updated_by_user_id', updated_by_user_id || null);
  if (fields.length === 0) {
    // Nothing to update — just return current.
    return getPolicy(mode);
  }
  values.push(mode);
  const { rows } = await pool.query(
    `UPDATE mode_platform_approval_policies SET ${fields.join(', ')} WHERE mode = $${i} RETURNING *`,
    values,
  );
  invalidatePolicy(mode);
  return rows[0] || null;
}

/**
 * Get the approval status for a (user, mode) pair. Returns `not_requested`
 * if no row exists.
 */
async function getApproval(userId, mode) {
  if (!userId || !mode) return null;
  const { rows } = await pool.query(
    `SELECT id, user_id, mode, status, application_data, requested_at, reviewed_at,
            reviewer_user_id, approval_notes, rejection_reason, created_at, updated_at
       FROM mode_platform_approvals
      WHERE user_id = $1 AND mode = $2`,
    [userId, mode],
  );
  if (rows.length === 0) {
    return { user_id: userId, mode, status: 'not_requested' };
  }
  return rows[0];
}

/**
 * Does the user have approval to perform this action in this mode?
 *
 * Returns an object:
 *   { allowed: true }                            ← gate doesn't apply
 *   { allowed: false, reason: 'platform_approval_required', current_status, policy }
 *
 * If no policy exists, or the policy doesn't gate this action, the action
 * is allowed (fail-open is the safe default — we don't want a missing
 * policy row to lock every consultant out).
 */
async function canPerformAction(userId, mode, action) {
  const policy = await getPolicy(mode);
  if (!policy) return { allowed: true };
  if (!policy.requires_approval) return { allowed: true };
  const gated = Array.isArray(policy.gated_actions) ? policy.gated_actions : [];
  if (gated.length > 0 && !gated.includes(action)) return { allowed: true };
  const approval = await getApproval(userId, mode);
  if (approval?.status === 'approved') return { allowed: true };
  return {
    allowed: false,
    reason: 'platform_approval_required',
    current_status: approval?.status || 'not_requested',
    policy: {
      mode: policy.mode,
      auto_approve: policy.auto_approve,
      gated_actions: gated,
      application_schema: policy.application_schema,
    },
  };
}

/**
 * Validate the submitted payload against the policy's application_schema.
 * Returns { ok: boolean, errors: { fieldName: msg } }.
 */
function validateAgainstSchema(applicationData, schema) {
  const errors = {};
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  for (const f of fields) {
    const v = applicationData?.[f.name];
    const present = v !== undefined && v !== null && String(v).trim() !== '';
    if (f.required && !present) {
      errors[f.name] = 'required';
      continue;
    }
    if (!present) continue;
    if (f.minLength && String(v).length < f.minLength) {
      errors[f.name] = `min_length:${f.minLength}`;
    }
    if (f.maxLength && String(v).length > f.maxLength) {
      errors[f.name] = `max_length:${f.maxLength}`;
    }
    if (f.type === 'number') {
      const n = Number(v);
      if (Number.isNaN(n)) errors[f.name] = 'not_a_number';
      else if (f.min !== undefined && n < f.min) errors[f.name] = `min:${f.min}`;
      else if (f.max !== undefined && n > f.max) errors[f.name] = `max:${f.max}`;
    }
    if (f.type === 'url') {
      try {
        // eslint-disable-next-line no-new
        new URL(String(v));
      } catch {
        errors[f.name] = 'invalid_url';
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Submit (or resubmit after rejection) an approval request. Returns the
 * updated approval row plus a `resolution` field describing what happened:
 *   'auto_approved'   — policy auto-approves, status is now 'approved'
 *   'pending'         — waiting for admin
 *   'validation_failed' — schema validation rejected the submission
 */
async function requestApproval({ userId, mode, applicationData }) {
  const policy = await getPolicy(mode);
  if (!policy) {
    const err = new Error('policy_not_found');
    err.code = 'policy_not_found';
    throw err;
  }
  if (!policy.requires_approval) {
    // Gate isn't active for this mode — nothing to do.
    return { resolution: 'not_required', approval: await getApproval(userId, mode) };
  }
  const validation = validateAgainstSchema(applicationData, policy.application_schema);
  if (!validation.ok) {
    return { resolution: 'validation_failed', errors: validation.errors };
  }

  const finalStatus = policy.auto_approve ? 'approved' : 'requested';
  const reviewedAt = policy.auto_approve ? new Date() : null;

  // Upsert — re-applying after a rejection bumps the same row.
  const { rows } = await pool.query(
    `INSERT INTO mode_platform_approvals (user_id, mode, status, application_data, requested_at, reviewed_at)
     VALUES ($1, $2, $3, $4, NOW(), $5)
     ON CONFLICT (user_id, mode) DO UPDATE
       SET status = EXCLUDED.status,
           application_data = EXCLUDED.application_data,
           requested_at = NOW(),
           reviewed_at = EXCLUDED.reviewed_at,
           reviewer_user_id = NULL,
           approval_notes = NULL,
           rejection_reason = NULL
     RETURNING *`,
    [userId, mode, finalStatus, JSON.stringify(applicationData || {}), reviewedAt],
  );

  logger.info('Mode platform approval requested', {
    userId, mode, status: finalStatus, autoApproved: policy.auto_approve,
  });

  return {
    resolution: policy.auto_approve ? 'auto_approved' : 'pending',
    approval: rows[0],
  };
}

/**
 * Admin decision. `decision` is 'approve' or 'reject'.
 */
async function decideApproval({ reviewerId, approvalId, decision, notes, rejectionReason }) {
  if (!['approve', 'reject', 'revoke'].includes(decision)) {
    const err = new Error('invalid_decision');
    err.code = 'invalid_decision';
    throw err;
  }
  const status = decision === 'approve' ? 'approved' : (decision === 'revoke' ? 'revoked' : 'rejected');
  const { rows } = await pool.query(
    `UPDATE mode_platform_approvals
        SET status = $2,
            reviewed_at = NOW(),
            reviewer_user_id = $3,
            approval_notes = $4,
            rejection_reason = $5
      WHERE id = $1
      RETURNING *`,
    [
      approvalId,
      status,
      reviewerId,
      decision === 'approve' || decision === 'revoke' ? (notes || null) : null,
      decision === 'reject' ? (rejectionReason || null) : null,
    ],
  );
  if (rows.length === 0) {
    const err = new Error('approval_not_found');
    err.code = 'approval_not_found';
    throw err;
  }
  logger.info('Mode platform approval decided', {
    reviewerId, approvalId, decision, mode: rows[0].mode, userId: rows[0].user_id,
  });
  return rows[0];
}

async function listPendingApprovals({ mode, limit = 100, offset = 0 } = {}) {
  const params = [];
  let where = `status = 'requested'`;
  if (mode) {
    params.push(mode);
    where += ` AND mode = $${params.length}`;
  }
  params.push(Math.min(Math.max(limit, 1), 500));
  params.push(Math.max(offset, 0));
  const { rows } = await pool.query(
    `SELECT a.id, a.user_id, a.mode, a.status, a.application_data, a.requested_at,
            a.reviewed_at, a.reviewer_user_id, a.approval_notes, a.rejection_reason,
            u.first_name, u.last_name, u.email
       FROM mode_platform_approvals a
       JOIN users u ON u.id = a.user_id
      WHERE ${where}
      ORDER BY a.requested_at ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

async function listApprovalsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT id, user_id, mode, status, application_data, requested_at, reviewed_at,
            reviewer_user_id, approval_notes, rejection_reason
       FROM mode_platform_approvals
      WHERE user_id = $1
      ORDER BY mode`,
    [userId],
  );
  return rows;
}

module.exports = {
  getPolicy,
  listPolicies,
  updatePolicy,
  getApproval,
  canPerformAction,
  requestApproval,
  decideApproval,
  listPendingApprovals,
  listApprovalsForUser,
  invalidatePolicy,
};
