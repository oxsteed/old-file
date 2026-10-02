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
const { withTransaction } = require('../utils/transaction');
const { logAdminAction } = require('./auditService');

const POLICY_CACHE = new Map(); // mode -> { policy, ts }
const POLICY_TTL_MS = 60 * 1000;

// Policy actions are an enforcement inventory, not arbitrary labels. Adding a
// new gated action requires installing the corresponding server middleware or
// domain check and registering it here first.
const POLICY_ACTIONS = Object.freeze({
  consultant: new Set(['accept_paying_booking']),
});
const POLICY_FIELD_TYPES = new Set(['text', 'textarea', 'number', 'url', 'email', 'date', 'select']);

function policyValidationError(message, details = {}) {
  const err = new Error(message);
  err.code = 'policy_validation_failed';
  err.details = details;
  return err;
}

function validateApplicationSchema(schema) {
  if (schema === undefined) return;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw policyValidationError('application_schema must be an object.');
  }
  if (schema.fields === undefined) return;
  if (!Array.isArray(schema.fields) || schema.fields.length > 50) {
    throw policyValidationError('application_schema.fields must be an array with at most 50 fields.');
  }
  const names = new Set();
  for (const [index, field] of schema.fields.entries()) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      throw policyValidationError(`application_schema.fields[${index}] must be an object.`);
    }
    const name = String(field.name || '').trim();
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(name) || names.has(name)) {
      throw policyValidationError(`application_schema.fields[${index}].name is invalid or duplicated.`);
    }
    names.add(name);
    if (!POLICY_FIELD_TYPES.has(field.type)) {
      throw policyValidationError(`application_schema.fields[${index}].type is unsupported.`);
    }
    if (typeof field.label !== 'string' || !field.label.trim() || field.label.length > 200) {
      throw policyValidationError(`application_schema.fields[${index}].label is required.`);
    }
    if (field.required !== undefined && typeof field.required !== 'boolean') {
      throw policyValidationError(`application_schema.fields[${index}].required must be boolean.`);
    }
    if (field.type === 'select' && (!Array.isArray(field.options) || field.options.length === 0 || field.options.length > 100)) {
      throw policyValidationError(`application_schema.fields[${index}].options are required for select fields.`);
    }
    if (field.options !== undefined && (!Array.isArray(field.options) || field.options.some((option) => typeof option !== 'string' || !option.trim()))) {
      throw policyValidationError(`application_schema.fields[${index}].options must contain non-empty strings.`);
    }
    if (field.minLength !== undefined && (!Number.isInteger(field.minLength) || field.minLength < 0)) {
      throw policyValidationError(`application_schema.fields[${index}].minLength is invalid.`);
    }
    if (field.maxLength !== undefined && (!Number.isInteger(field.maxLength) || field.maxLength < 0)) {
      throw policyValidationError(`application_schema.fields[${index}].maxLength is invalid.`);
    }
    if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) {
      throw policyValidationError(`application_schema.fields[${index}] has an invalid length range.`);
    }
    for (const bound of ['min', 'max']) {
      if (field[bound] !== undefined && (typeof field[bound] !== 'number' || !Number.isFinite(field[bound]))) {
        throw policyValidationError(`application_schema.fields[${index}].${bound} is invalid.`);
      }
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      throw policyValidationError(`application_schema.fields[${index}] has an invalid numeric range.`);
    }
  }
}

function validatePolicyPatch({ mode, requires_approval, auto_approve, gated_actions, application_schema }) {
  if (requires_approval !== undefined && typeof requires_approval !== 'boolean') {
    throw policyValidationError('requires_approval must be boolean.');
  }
  if (auto_approve !== undefined && typeof auto_approve !== 'boolean') {
    throw policyValidationError('auto_approve must be boolean.');
  }
  if (gated_actions !== undefined) {
    if (!Array.isArray(gated_actions)) throw policyValidationError('gated_actions must be an array.');
    const actions = POLICY_ACTIONS[mode] || new Set();
    const normalized = gated_actions.map((action) => String(action || '').trim()).filter(Boolean);
    if (normalized.length !== gated_actions.length || new Set(normalized).size !== normalized.length) {
      throw policyValidationError('gated_actions must contain unique non-empty action codes.');
    }
    const unsupported = normalized.filter((action) => !actions.has(action));
    if (unsupported.length) {
      throw policyValidationError(`Unsupported policy action: ${unsupported.join(', ')}`, { unsupported_actions: unsupported });
    }
  }
  validateApplicationSchema(application_schema);
}

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

async function listPolicyRevisions(mode, { limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
  const safeOffset = Math.min(Math.max(Number.parseInt(offset, 10) || 0, 0), 1_000_000);
  const { rows } = await pool.query(
    `SELECT id, mode, policy_updated_at, requires_approval, auto_approve,
            gated_actions, application_schema, changed_by_user_id, change_reason, created_at
       FROM mode_platform_policy_revisions
      WHERE mode = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [mode, safeLimit, safeOffset],
  );
  return rows;
}

// Report the enforcement inventory against the persisted configuration. This
// is intentionally derived from the server-side action registry so the admin
// console cannot claim coverage for a label that no route actually enforces.
async function listPolicyCoverage() {
  const { rows } = await pool.query(
    'SELECT mode, requires_approval, auto_approve, gated_actions, updated_at FROM mode_platform_approval_policies ORDER BY mode',
  );
  const persisted = new Map(rows.map((policy) => [policy.mode, policy]));
  const modes = new Set([...Object.keys(POLICY_ACTIONS), ...persisted.keys()]);
  return [...modes].sort().map((mode) => {
    const policy = persisted.get(mode) || null;
    const registeredActions = [...(POLICY_ACTIONS[mode] || new Set())].sort();
    const configuredActions = Array.isArray(policy?.gated_actions) ? policy.gated_actions : [];
    const coveredActions = configuredActions.filter((action) => registeredActions.includes(action)).sort();
    const unknownActions = configuredActions.filter((action) => !registeredActions.includes(action)).sort();
    const missingActions = registeredActions.filter((action) => !coveredActions.includes(action));
    return {
      mode,
      policy_exists: Boolean(policy),
      requires_approval: Boolean(policy?.requires_approval),
      auto_approve: Boolean(policy?.auto_approve),
      updated_at: policy?.updated_at || null,
      registered_actions: registeredActions,
      covered_actions: coveredActions,
      missing_actions: missingActions,
      unknown_actions: unknownActions,
      complete: Boolean(policy) && missingActions.length === 0 && unknownActions.length === 0,
    };
  });
}

async function rollbackPolicy({ mode, revisionId, expected_updated_at, change_reason, updated_by_user_id, req }) {
  if (!mode) throw Object.assign(new Error('mode_required'), { code: 'mode_required' });
  if (!expected_updated_at) throw Object.assign(new Error('policy_version_required'), { code: 'policy_version_required' });
  if (!change_reason || String(change_reason).trim().length < 3) {
    throw Object.assign(new Error('change_reason_required'), { code: 'change_reason_required' });
  }
  const parsedRevisionId = Number.parseInt(revisionId, 10);
  if (!Number.isSafeInteger(parsedRevisionId) || parsedRevisionId < 1) {
    throw Object.assign(new Error('revision_required'), { code: 'revision_required' });
  }
  const updated = await withTransaction(pool, async (client) => {
    const { rows: revisions } = await client.query(
      `SELECT mode, requires_approval, auto_approve, gated_actions, application_schema
         FROM mode_platform_policy_revisions
        WHERE id = $1 AND mode = $2`,
      [parsedRevisionId, mode],
    );
    if (!revisions.length) throw Object.assign(new Error('revision_not_found'), { code: 'revision_not_found' });
    const revision = revisions[0];
    validatePolicyPatch(revision);
    const { rows: currentRows } = await client.query(
      'SELECT * FROM mode_platform_approval_policies WHERE mode = $1 FOR UPDATE',
      [mode],
    );
    if (!currentRows.length) throw Object.assign(new Error('policy_not_found'), { code: 'policy_not_found' });
    if (String(currentRows[0].updated_at) !== String(expected_updated_at)) {
      throw Object.assign(new Error('policy_version_conflict'), { code: 'policy_version_conflict' });
    }
    const { rows } = await client.query(
      `UPDATE mode_platform_approval_policies
          SET requires_approval = $2,
              auto_approve = $3,
              gated_actions = $4,
              application_schema = $5::jsonb,
              updated_by_user_id = $6
        WHERE mode = $1 AND updated_at = $7
        RETURNING *`,
      [mode, revision.requires_approval, revision.auto_approve, revision.gated_actions || [], JSON.stringify(revision.application_schema || {}), updated_by_user_id || null, expected_updated_at],
    );
    if (!rows.length) throw Object.assign(new Error('policy_version_conflict'), { code: 'policy_version_conflict' });
    const policy = rows[0];
    await client.query(
      `INSERT INTO mode_platform_policy_revisions
         (mode, policy_updated_at, requires_approval, auto_approve, gated_actions, application_schema, changed_by_user_id, change_reason)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       ON CONFLICT (mode, policy_updated_at) DO NOTHING`,
      [mode, policy.updated_at, policy.requires_approval, policy.auto_approve, policy.gated_actions || [], JSON.stringify(policy.application_schema || {}), updated_by_user_id || null, String(change_reason).trim().slice(0, 1000)],
    );
    await logAdminAction({
      adminId: updated_by_user_id,
      action: 'mode_platform_policy_rolled_back',
      targetType: 'mode_platform_approval_policy',
      targetKey: `mode_policy:${mode}`,
      description: `Rolled back ${mode} policy to revision ${parsedRevisionId}`,
      after: { mode, revision_id: parsedRevisionId, policy_updated_at: policy.updated_at },
      req,
      client,
    });
    return policy;
  }, 'mode_policy_rollback');
  invalidatePolicy(mode);
  return updated;
}

async function updatePolicy({ mode, requires_approval, auto_approve, gated_actions, application_schema, updated_by_user_id, expected_updated_at, change_reason }) {
  if (!mode) {
    const err = new Error('mode_required');
    err.code = 'mode_required';
    throw err;
  }
  if (!expected_updated_at) {
    const err = new Error('expected_updated_at is required for policy updates');
    err.code = 'policy_version_required';
    throw err;
  }
  validatePolicyPatch({ mode, requires_approval, auto_approve, gated_actions, application_schema });
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
  values.push(mode, expected_updated_at);
  const updated = await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `UPDATE mode_platform_approval_policies SET ${fields.join(', ')} WHERE mode = $${i} AND updated_at = $${i + 1} RETURNING *`,
      values,
    );
    if (!rows.length) {
      const current = await client.query(
        'SELECT 1 FROM mode_platform_approval_policies WHERE mode = $1',
        [mode],
      );
      const err = new Error(current.rows.length ? 'policy_version_conflict' : 'policy_not_found');
      err.code = current.rows.length ? 'policy_version_conflict' : 'policy_not_found';
      throw err;
    }
    const policy = rows[0];
    await client.query(
      `INSERT INTO mode_platform_policy_revisions
         (mode, policy_updated_at, requires_approval, auto_approve, gated_actions, application_schema, changed_by_user_id, change_reason)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       ON CONFLICT (mode, policy_updated_at) DO NOTHING`,
      [
        policy.mode,
        policy.updated_at,
        policy.requires_approval,
        policy.auto_approve,
        policy.gated_actions || [],
        JSON.stringify(policy.application_schema || {}),
        updated_by_user_id || null,
        change_reason ? String(change_reason).trim().slice(0, 1000) : null,
      ],
    );
    return policy;
  }, 'mode_policy_update');
  invalidatePolicy(mode);
  return updated || null;
}

/**
 * Get the approval status for a (user, mode) pair. Returns `not_requested`
 * if no row exists.
 */
async function getApproval(userId, mode) {
  if (!userId || !mode) return null;
  const { rows } = await pool.query(
    `SELECT id, user_id, mode, status, application_data, policy_updated_at, requested_at, reviewed_at,
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
  if (
    approval?.status === 'approved'
    && approval.policy_updated_at
    && String(approval.policy_updated_at) === String(policy.updated_at)
  ) return { allowed: true };
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
    `INSERT INTO mode_platform_approvals (user_id, mode, status, application_data, policy_updated_at, requested_at, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6)
     ON CONFLICT (user_id, mode) DO UPDATE
       SET status = EXCLUDED.status,
           application_data = EXCLUDED.application_data,
           policy_updated_at = EXCLUDED.policy_updated_at,
           requested_at = NOW(),
           reviewed_at = EXCLUDED.reviewed_at,
           reviewer_user_id = NULL,
           approval_notes = NULL,
           rejection_reason = NULL
     RETURNING *`,
    [userId, mode, finalStatus, JSON.stringify(applicationData || {}), policy.updated_at, reviewedAt],
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
  if (decision === 'reject' && !String(rejectionReason || '').trim()) {
    const err = new Error('rejection_reason_required');
    err.code = 'rejection_reason_required';
    throw err;
  }
  const status = decision === 'approve' ? 'approved' : (decision === 'revoke' ? 'revoked' : 'rejected');
  const expectedStatus = decision === 'revoke' ? 'approved' : 'requested';
  const { rows } = await pool.query(
    `UPDATE mode_platform_approvals
        SET status = $2,
            reviewed_at = NOW(),
            reviewer_user_id = $3,
            approval_notes = $4,
            rejection_reason = $5
      WHERE id = $1 AND status = $6
      RETURNING *`,
    [
      approvalId,
      status,
      reviewerId,
      decision === 'approve' || decision === 'revoke' ? (notes || null) : null,
      decision === 'reject' ? (rejectionReason || null) : null,
      expectedStatus,
    ],
  );
  if (rows.length === 0) {
    const err = new Error('approval_state_conflict');
    err.code = 'approval_state_conflict';
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
    `SELECT id, user_id, mode, status, application_data, policy_updated_at, requested_at, reviewed_at,
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
  listPolicyRevisions,
  listPolicyCoverage,
  rollbackPolicy,
  updatePolicy,
  getApproval,
  canPerformAction,
  requestApproval,
  decideApproval,
  listPendingApprovals,
  listApprovalsForUser,
  invalidatePolicy,
};
