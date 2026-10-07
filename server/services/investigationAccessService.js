'use strict';

/**
 * E13 — Controlled investigation access.
 *
 * Purpose-limited, approver-tied read access for investigations. Flow:
 *
 *   1. An admin requests access: purpose + explicit scope (user ids,
 *      max 25) + expiry (max 72h) + a named approver. Self-approval is
 *      rejected; the approver must be a super-admin or hold the
 *      manage_users grant.
 *   2. The grant starts 'pending'. Only the named approver (or any
 *      super-admin, never the requester) can activate it.
 *   3. Elevated reads check for an active, unexpired, unrevoked grant
 *      covering the target user. Every allowed read is written to the
 *      admin audit log with purpose + approver (fail closed otherwise).
 */

const db = require('../db');
const logger = require('../utils/logger');
const { logAdminAction } = require('./auditService');

const MAX_SCOPE_USERS = 25;
const MAX_TTL_MS = 72 * 3600 * 1000; // 72 hours
const MIN_PURPOSE_LENGTH = 10;

// One Truth P1 (item 12.2): grant scope types. 'user_investigation' is the
// original per-user investigation grant; 'fraud_analyst' marks a delegated
// trust/fraud analyst grant requested through One Truth. Both ride the same
// purpose + approver + expiry + scoped-ids machinery.
const GRANT_SCOPES = ['user_investigation', 'fraud_analyst'];
const DEFAULT_GRANT_SCOPE = 'user_investigation';

function validateGrantScope(grantScope) {
  const scope = grantScope || DEFAULT_GRANT_SCOPE;
  if (!GRANT_SCOPES.includes(scope)) {
    throw new InvestigationAccessError(
      `Unknown grant scope: ${scope}. Expected one of: ${GRANT_SCOPES.join(', ')}.`,
      'invalid_grant_scope'
    );
  }
  return scope;
}

class InvestigationAccessError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'InvestigationAccessError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function isSuperAdmin(adminId) {
  const { rows } = await db.query(`SELECT role FROM users WHERE id = $1`, [adminId]);
  return rows.length > 0 && rows[0].role === 'super_admin';
}

async function hasGlobalGrant(adminId, permission) {
  const { rows } = await db.query(
    `SELECT 1 FROM admin_permission_grants
      WHERE grantee_id = $1
        AND permissions ? $2
        AND region_id IS NULL
        AND expires_at > NOW()
        AND revoked_at IS NULL
      LIMIT 1`,
    [adminId, permission]
  );
  return rows.length > 0;
}

async function assertApproverAuthorized(approverId) {
  if (await isSuperAdmin(approverId)) return;
  if (await hasGlobalGrant(approverId, 'manage_users')) return;
  throw new InvestigationAccessError(
    'Approver must be a super-admin or hold the manage_users grant.',
    'approver_not_authorized',
    403
  );
}

function validateScopeUserIds(scopeUserIds) {
  if (!Array.isArray(scopeUserIds) || scopeUserIds.length === 0) {
    throw new InvestigationAccessError('Scope must name at least one user.', 'scope_required');
  }
  if (scopeUserIds.length > MAX_SCOPE_USERS) {
    throw new InvestigationAccessError(
      `Scope is limited to ${MAX_SCOPE_USERS} users per grant.`,
      'scope_too_broad'
    );
  }
}

function validateExpiry(expiresAt) {
  const expires = expiresAt ? new Date(expiresAt) : new Date(Date.now() + MAX_TTL_MS);
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) {
    throw new InvestigationAccessError('Expiry must be a future timestamp.', 'invalid_expiry');
  }
  if (expires.getTime() - Date.now() > MAX_TTL_MS) {
    throw new InvestigationAccessError(
      'Investigation access is limited to 72 hours per grant; request a new one afterwards.',
      'expiry_too_far'
    );
  }
  return expires;
}

/**
 * Request investigation access. Creates a PENDING grant; a separate
 * approval step activates it.
 */
async function requestInvestigationAccess({
  requesterId,
  approverId,
  purpose,
  scopeUserIds,
  investigationRef,
  expiresAt,
  grantScope,
}) {
  if (!requesterId || !approverId) {
    throw new InvestigationAccessError('Requester and approver are required.', 'missing_parties');
  }
  if (requesterId === approverId) {
    throw new InvestigationAccessError(
      'Self-approval is not allowed: the approver must be a different admin.',
      'self_approval_rejected',
      403
    );
  }
  const cleanPurpose = String(purpose || '').trim();
  if (cleanPurpose.length < MIN_PURPOSE_LENGTH) {
    throw new InvestigationAccessError(
      `A purpose of at least ${MIN_PURPOSE_LENGTH} characters is required.`,
      'purpose_required'
    );
  }
  validateScopeUserIds(scopeUserIds);
  const expires = validateExpiry(expiresAt);
  const scope = validateGrantScope(grantScope);
  await assertApproverAuthorized(approverId);

  const { rows } = await db.query(
    `INSERT INTO investigation_access_grants
       (investigation_ref, requester_admin_id, approver_admin_id, purpose,
        scope_user_ids, status, expires_at, grant_scope)
     VALUES ($1, $2, $3, $4, $5::uuid[], 'pending', $6, $7)
     RETURNING *`,
    [String(investigationRef || '').slice(0, 160) || 'unspecified', requesterId, approverId, cleanPurpose, scopeUserIds, expires.toISOString(), scope]
  );
  const grant = rows[0];

  await logAdminAction({
    adminId: requesterId,
    action: 'investigation_access_requested',
    targetType: 'investigation_access_grant',
    targetKey: String(grant.id),
    description: `Requested investigation access: ${cleanPurpose.slice(0, 200)}`,
    after: { approver_admin_id: approverId, scope_user_ids: scopeUserIds, expires_at: expires.toISOString(), grant_scope: scope },
  });

  logger.info('Investigation access requested', { grantId: grant.id, requesterId, approverId });
  return grant;
}

async function getGrant(grantId) {
  const { rows } = await db.query(`SELECT * FROM investigation_access_grants WHERE id = $1`, [grantId]);
  return rows[0] || null;
}

/**
 * Activate a pending grant. Only the named approver (or any super-admin)
 * may do this; the requester can never approve their own request.
 */
async function approveInvestigationAccess({ grantId, approverId }) {
  const grant = await getGrant(grantId);
  if (!grant) throw new InvestigationAccessError('Grant not found.', 'grant_not_found', 404);
  if (grant.status !== 'pending') {
    throw new InvestigationAccessError(`Grant is ${grant.status}, not pending.`, 'grant_not_pending', 409);
  }
  if (String(grant.requester_admin_id) === String(approverId)) {
    throw new InvestigationAccessError(
      'Self-approval is not allowed: the approver must be a different admin.',
      'self_approval_rejected',
      403
    );
  }
  const isNamedApprover = String(grant.approver_admin_id) === String(approverId);
  const superApprover = await isSuperAdmin(approverId);
  if (!isNamedApprover && !superApprover) {
    throw new InvestigationAccessError(
      'Only the named approver (or a super-admin) can activate this grant.',
      'approver_mismatch',
      403
    );
  }

  const { rows } = await db.query(
    `UPDATE investigation_access_grants
        SET status = 'active', decided_at = NOW(), decided_by = $2
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [grantId, approverId]
  );
  if (!rows.length) {
    throw new InvestigationAccessError('Grant is no longer pending.', 'grant_not_pending', 409);
  }

  await logAdminAction({
    adminId: approverId,
    action: 'investigation_access_approved',
    targetType: 'investigation_access_grant',
    targetKey: String(grantId),
    description: `Approved investigation access for ${grant.requester_admin_id}: ${String(grant.purpose).slice(0, 200)}`,
    after: { status: 'active', expires_at: grant.expires_at },
  });

  logger.info('Investigation access approved', { grantId, approverId });
  return rows[0];
}

/**
 * Revoke a grant early. The approver, a super-admin, or the requester
 * themselves may revoke.
 */
async function revokeInvestigationAccess({ grantId, revokedBy, reason }) {
  const grant = await getGrant(grantId);
  if (!grant) throw new InvestigationAccessError('Grant not found.', 'grant_not_found', 404);

  const allowed =
    String(grant.approver_admin_id) === String(revokedBy) ||
    String(grant.requester_admin_id) === String(revokedBy) ||
    (await isSuperAdmin(revokedBy));
  if (!allowed) {
    throw new InvestigationAccessError('Not authorized to revoke this grant.', 'revoke_forbidden', 403);
  }

  const { rows } = await db.query(
    `UPDATE investigation_access_grants
        SET status = 'revoked', revoked_at = NOW(), revoked_by = $2, revoke_reason = $3
      WHERE id = $1
      RETURNING *`,
    [grantId, revokedBy, String(reason || '').slice(0, 500) || null]
  );

  await logAdminAction({
    adminId: revokedBy,
    action: 'investigation_access_revoked',
    targetType: 'investigation_access_grant',
    targetKey: String(grantId),
    description: `Revoked investigation access grant #${grantId}${reason ? `: ${String(reason).slice(0, 200)}` : ''}`,
  });

  return rows[0];
}

/**
 * Check whether an admin currently holds an active, unexpired, unrevoked
 * grant covering targetUserId. Returns { granted, grant? }. Pass
 * { scopes } to restrict to specific grant scope types (e.g. only
 * fraud_analyst delegations); by default any scope type is accepted.
 */
async function checkInvestigationAccess(adminId, targetUserId, { scopes = null } = {}) {
  const scopeFilter = Array.isArray(scopes) && scopes.length
    ? `AND grant_scope = ANY($3)`
    : '';
  const params = scopeFilter ? [adminId, targetUserId, scopes] : [adminId, targetUserId];
  const { rows } = await db.query(
    `SELECT *
       FROM investigation_access_grants
      WHERE requester_admin_id = $1
        AND status = 'active'
        AND revoked_at IS NULL
        AND expires_at > NOW()
        AND $2 = ANY (scope_user_ids)
        ${scopeFilter}
      ORDER BY expires_at DESC
      LIMIT 1`,
    params
  );
  if (!rows.length) return { granted: false };
  return { granted: true, grant: rows[0] };
}

/**
 * One Truth P1 (item 11/12.2): list every active, unexpired, unrevoked
 * grant held by an admin. Powers the delegated-analyst path: list/stats
 * reads are scoped to the union of these grants' scope_user_ids and each
 * read is audit-logged with purpose + approver.
 */
async function listActiveGrants(adminId, { scopes = null } = {}) {
  const scopeFilter = Array.isArray(scopes) && scopes.length
    ? `AND grant_scope = ANY($2)`
    : '';
  const params = scopeFilter ? [adminId, scopes] : [adminId];
  const { rows } = await db.query(
    `SELECT *
       FROM investigation_access_grants
      WHERE requester_admin_id = $1
        AND status = 'active'
        AND revoked_at IS NULL
        AND expires_at > NOW()
        ${scopeFilter}
      ORDER BY expires_at DESC`,
    params
  );
  return rows;
}

/**
 * Write the audit row for an elevated investigation read: who read whom,
 * for what purpose, approved by whom. Called on every allowed read.
 */
async function logInvestigationRead({ readerAdminId, targetUserId, grant, endpoint, req }) {
  const approverLabel = grant
    ? `approved by ${grant.approver_admin_id}`
    : 'super_admin_duty';
  const purpose = grant ? grant.purpose : 'Super-admin duty review';
  await logAdminAction({
    adminId: readerAdminId,
    action: 'investigation_read',
    targetType: 'user',
    targetId: targetUserId,
    description:
      `Investigation read of user ${targetUserId} via ${endpoint} ` +
      `(${approverLabel}) for purpose: ${String(purpose).slice(0, 220)}` +
      (grant && grant.investigation_ref ? ` [ref: ${grant.investigation_ref}]` : ''),
    before: null,
    after: grant ? {
      grant_id: grant.id,
      purpose: grant.purpose,
      approver_admin_id: grant.approver_admin_id,
      investigation_ref: grant.investigation_ref,
      expires_at: grant.expires_at,
    } : { super_admin: true },
    req,
  });
}

/**
 * One Truth P1 (item 11): per-read audit entry for One Truth aggregate
 * reads (list / stats / suspects). Records who read, through which
 * endpoint, under which purpose(s) + approver(s), the scoped user ids, and
 * which sensitive fields the response carried. Super-admin reads are logged
 * with the super_admin_duty purpose, mirroring logInvestigationRead.
 */
async function logOneTruthRead({
  readerAdminId,
  grants,
  endpoint,
  resultCount,
  sensitiveFields = [],
  piiMasked = false,
  req,
}) {
  const grantList = Array.isArray(grants) ? grants : [];
  const purposes = grantList.map((g) => ({
    grant_id: g.id,
    grant_scope: g.grant_scope || DEFAULT_GRANT_SCOPE,
    purpose: g.purpose,
    approver_admin_id: g.approver_admin_id,
    investigation_ref: g.investigation_ref,
    expires_at: g.expires_at,
    scope_user_ids: g.scope_user_ids,
  }));
  await logAdminAction({
    adminId: readerAdminId,
    action: 'one_truth_investigation_read',
    targetType: 'one_truth',
    description:
      `One Truth read via ${endpoint}: ${resultCount} row(s)` +
      (purposes.length
        ? ` under ${purposes.length} grant(s): ` +
          purposes.map((p) => `${p.purpose} (approved by ${p.approver_admin_id})`).join('; ').slice(0, 400)
        : ' (super-admin duty review)'),
    before: null,
    after: {
      endpoint,
      result_count: resultCount,
      grants: purposes,
      sensitive_fields: sensitiveFields,
      pii_masked: piiMasked,
      super_admin: purposes.length === 0,
    },
    req,
  });
}

/**
 * List investigation access grants for the governance UI. Bounded at 100
 * rows; optional filters on requester and lifecycle status.
 */
const GRANT_STATUSES = new Set(['pending', 'active', 'revoked', 'expired']);

async function listInvestigationAccessGrants({ requesterId = null, status = null } = {}) {
  const conditions = [];
  const params = [];
  if (requesterId) {
    conditions.push(`requester_admin_id = $${params.length + 1}`);
    params.push(requesterId);
  }
  if (status) {
    if (!GRANT_STATUSES.has(status)) {
      throw new InvestigationAccessError(`Unknown grant status: ${status}`, 'invalid_status');
    }
    conditions.push(`status = $${params.length + 1}`);
    params.push(status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT * FROM investigation_access_grants
      ${where}
      ORDER BY created_at DESC
      LIMIT 100`,
    params
  );
  return rows;
}

module.exports = {
  InvestigationAccessError,
  MAX_SCOPE_USERS,
  MAX_TTL_MS,
  GRANT_SCOPES,
  DEFAULT_GRANT_SCOPE,
  requestInvestigationAccess,
  approveInvestigationAccess,
  revokeInvestigationAccess,
  checkInvestigationAccess,
  listActiveGrants,
  listInvestigationAccessGrants,
  logInvestigationRead,
  logOneTruthRead,
  isSuperAdmin,
};
