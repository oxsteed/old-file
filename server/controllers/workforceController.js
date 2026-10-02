'use strict';

/**
 * M1 — Workforce Identity, Delegation, Access Lifecycle controller.
 *
 * Routes (all behind requireAdmin + requirePermission('manage_admin_accounts')
 * in server/routes/workforce.js):
 *   GET  /staff               — staff roster aggregate
 *   GET  /delegations         — delegation grants, computed effective status
 *   POST /delegations         — create a delegation grant (fail closed)
 *   POST /delegations/:id/revoke — revoke (grantor or super_admin only)
 *   GET  /lifecycle           — grant-lifecycle audit timeline
 *
 * Delegations are bounded authority: runtime permission middleware verifies
 * the active delegation, its expiry, and the grantor's current global grant
 * before authorizing a request.
 */

const db = require('../db');
const { logAdminAction } = require('../services/auditService');
const logger = require('../utils/logger');
const { PERMISSION_SCOPES } = require('./adminPermissionController');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SCOPES = 20;
const MAX_DELEGATION_DAYS = 30;
const MAX_REASON_LEN = 500;

const EFFECTIVE_STATUS_SQL = `
  CASE
    WHEN d.status = 'active' AND d.expires_at <= NOW() THEN 'expired'
    ELSE d.status
  END AS effective_status
`;

function effectiveStatus(row) {
  if (!row) return null;
  if (row.status === 'active' && row.expires_at && new Date(row.expires_at) <= new Date()) {
    return 'expired';
  }
  return row.status;
}

// ── GET /staff ───────────────────────────────────────────────────────────────

/**
 * Roster of admin/super_admin accounts with identity signals:
 * 2FA (TOTP) status from users.totp_enabled, active passkey count from
 * admin_passkeys (migration 410), and active grant scopes from
 * admin_permission_grants (migration 049).
 */
exports.getStaff = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        u.id,
        TRIM(u.first_name || ' ' || u.last_name) AS name,
        u.email,
        u.role,
        u.is_active,
        u.last_login_at,
        CASE WHEN COALESCE(u.totp_enabled, false) THEN 'totp' ELSE 'none' END AS two_factor_status,
        (SELECT COUNT(*)
           FROM admin_passkeys p
          WHERE p.user_id = u.id AND p.revoked_at IS NULL) AS passkey_count,
        (SELECT COALESCE(
           json_agg(DISTINCT perm ORDER BY perm),
           '[]'::json
         )
           FROM admin_permission_grants g,
                jsonb_array_elements_text(g.permissions) AS perm
          WHERE g.grantee_id = u.id
            AND g.revoked_at IS NULL
            AND g.expires_at > NOW()) AS grant_scopes
      FROM users u
      WHERE u.role IN ('admin', 'super_admin')
      ORDER BY
        CASE WHEN u.role = 'super_admin' THEN 0 ELSE 1 END,
        u.created_at ASC
      LIMIT 200
    `);
    res.json({ staff: rows });
  } catch (err) {
    logger.error('workforce.getStaff error', { err });
    res.status(500).json({ error: 'Failed to load staff roster.' });
  }
};

// ── GET /delegations ─────────────────────────────────────────────────────────

const DELEGATION_STATUSES = ['active', 'revoked', 'expired'];

exports.listDelegations = async (req, res) => {
  try {
    const { status } = req.query;
    if (status !== undefined && !DELEGATION_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter. Use active, revoked, or expired.' });
    }

    const params = [];
    let where = '';
    if (status) {
      // Filter on the computed effective status.
      where = `WHERE (${EFFECTIVE_STATUS_SQL.replace('AS effective_status', '')}) = $1`;
      params.push(status);
    }

    const { rows } = await db.query(`
      SELECT
        d.id,
        d.grantor_admin_id,
        d.grantee_admin_id,
        TRIM(gr.first_name || ' ' || gr.last_name) AS grantor_name,
        TRIM(gu.first_name || ' ' || gu.last_name) AS grantee_name,
        gu.email AS grantee_email,
        d.scopes,
        d.reason,
        d.status,
        d.expires_at,
        d.created_at,
        d.revoked_at,
        d.revoked_by,
        d.revoke_reason,
        ${EFFECTIVE_STATUS_SQL}
      FROM delegation_grants d
      JOIN users gr ON gr.id = d.grantor_admin_id
      JOIN users gu ON gu.id = d.grantee_admin_id
      ${where}
      ORDER BY d.created_at DESC
      LIMIT 100
    `, params);

    res.json({
      delegations: rows.map((row) => ({
        ...row,
        // Recomputed in JS so the field is always present even if the SQL
        // projection changes; matches the CASE expression above.
        effective_status: effectiveStatus(row),
      })),
    });
  } catch (err) {
    logger.error('workforce.listDelegations error', { err });
    res.status(500).json({ error: 'Failed to load delegations.' });
  }
};

// ── POST /delegations ────────────────────────────────────────────────────────

function validateDelegationInput(body) {
  const { grantee_id, scopes, expires_at, reason } = body || {};

  if (!grantee_id || typeof grantee_id !== 'string' || !UUID_RE.test(grantee_id.trim())) {
    return 'A valid grantee_id is required.';
  }
  if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > MAX_SCOPES) {
    return `scopes must be an array of 1 to ${MAX_SCOPES} entries.`;
  }
  for (const s of scopes) {
    if (typeof s !== 'string' || s.trim().length === 0 || s.length > 120) {
      return 'Every scope must be a non-empty string (max 120 chars).';
    }
  }
  const expiry = new Date(expires_at);
  if (Number.isNaN(expiry.getTime())) {
    return 'expires_at must be a valid date.';
  }
  const now = Date.now();
  if (expiry.getTime() <= now) {
    return 'expires_at must be in the future.';
  }
  if (expiry.getTime() - now > MAX_DELEGATION_DAYS * 24 * 3600_000) {
    return `expires_at must be no more than ${MAX_DELEGATION_DAYS} days out.`;
  }
  if (reason != null && (typeof reason !== 'string' || reason.length > MAX_REASON_LEN)) {
    return `reason must be a string of at most ${MAX_REASON_LEN} characters.`;
  }
  return null;
}

exports.createDelegation = async (req, res) => {
  try {
    const grantorId = req.user?.id;
    if (!grantorId) return res.status(401).json({ error: 'Unauthorized.' });

    const validationError = validateDelegationInput(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const granteeId = req.body.grantee_id.trim();
    const scopes = [...new Set(req.body.scopes.map((s) => s.trim()))];
    const expiresAt = new Date(req.body.expires_at);
    const reason = req.body.reason ? req.body.reason.trim() : null;

    if (granteeId === grantorId) {
      return res.status(400).json({ error: 'Self-grant is not allowed: grantor and grantee must differ.' });
    }

    // Grantee must be an active admin or super_admin. Fail closed.
    const { rows: grantees } = await db.query(`
      SELECT u.id, u.role, u.is_active
      FROM users u
      WHERE u.id = $1
    `, [granteeId]);

    if (!grantees.length) {
      return res.status(404).json({ error: 'Grantee admin not found.' });
    }
    const grantee = grantees[0];
    if (!['admin', 'super_admin'].includes(grantee.role) || !grantee.is_active) {
      return res.status(400).json({ error: 'Grantee must be an active admin or super_admin.' });
    }

    const validScopes = new Set(Object.keys(PERMISSION_SCOPES || {}));
    const unknownScopes = scopes.filter((scope) => !validScopes.has(scope));
    if (unknownScopes.length) {
      return res.status(400).json({ error: `Unknown delegation scope(s): ${unknownScopes.join(', ')}` });
    }

    // A regular admin may delegate only permissions they currently hold as a
    // global grant. Super-admins are implicitly authoritative for all scopes.
    if (req.user.role !== 'super_admin') {
      const { rows: authorityRows } = await db.query(`
        SELECT DISTINCT jsonb_array_elements_text(permissions) AS permission
          FROM admin_permission_grants
         WHERE grantee_id = $1
           AND region_id IS NULL
           AND revoked_at IS NULL
           AND expires_at > NOW()
      `, [grantorId]);
      const held = new Set(authorityRows.map((row) => row.permission));
      const missing = scopes.filter((scope) => !held.has(scope));
      if (missing.length) {
        return res.status(403).json({ error: `Cannot delegate permissions you do not hold globally: ${missing.join(', ')}` });
      }
    }

    const { rows } = await db.query(`
      INSERT INTO delegation_grants (
        grantor_admin_id, grantee_admin_id, scopes, reason,
        status, expires_at, created_by
      )
      VALUES ($1, $2, $3, $4, 'active', $5, $6)
      RETURNING
        id, grantor_admin_id, grantee_admin_id, scopes, reason,
        status, expires_at, created_at, created_by, revoked_at, revoked_by, revoke_reason
    `, [grantorId, granteeId, scopes, reason, expiresAt.toISOString(), grantorId]);

    const delegation = rows[0];

    // Audit the grant; fail closed if the audit write fails.
    await logAdminAction({
      adminId: grantorId,
      action: 'delegation_grant_created',
      targetType: 'delegation',
      targetKey: `delegation:${delegation.id}`,
      description: `Delegated [${scopes.join(', ')}] to ${granteeId} until ${expiresAt.toISOString()}${reason ? `: ${reason}` : ''}`,
      after: { delegation_id: delegation.id, grantee_id: granteeId, scopes, expires_at: expiresAt.toISOString() },
      req,
      throwOnError: true,
    });

    res.status(201).json({
      delegation: { ...delegation, effective_status: effectiveStatus(delegation) },
    });
  } catch (err) {
    logger.error('workforce.createDelegation error', { err });
    res.status(500).json({ error: 'Failed to create delegation.' });
  }
};

// ── POST /delegations/:id/revoke ─────────────────────────────────────────────

exports.revokeDelegation = async (req, res) => {
  try {
    const callerId = req.user?.id;
    if (!callerId) return res.status(401).json({ error: 'Unauthorized.' });

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid delegation id.' });
    }

    const { rows } = await db.query(`
      SELECT
        d.id, d.grantor_admin_id, d.grantee_admin_id, d.scopes, d.reason,
        d.status, d.expires_at, d.created_at, d.created_by,
        d.revoked_at, d.revoked_by, d.revoke_reason
      FROM delegation_grants d
      WHERE d.id = $1
    `, [id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Delegation not found.' });
    }
    const grant = rows[0];

    const status = effectiveStatus(grant);
    if (status !== 'active') {
      return res.status(409).json({ error: `Delegation is already ${status}; it cannot be revoked.` });
    }

    const isSuper = req.isSuper === true || req.user.role === 'super_admin';
    if (grant.grantor_admin_id !== callerId && !isSuper) {
      return res.status(403).json({ error: 'Only the grantor or a super_admin may revoke this delegation.' });
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, MAX_REASON_LEN) : null;

    const { rows: updated } = await db.query(`
      UPDATE delegation_grants
      SET status = 'revoked', revoked_at = NOW(), revoked_by = $2, revoke_reason = $3
      WHERE id = $1 AND status = 'active'
      RETURNING
        id, grantor_admin_id, grantee_admin_id, scopes, reason,
        status, expires_at, created_at, created_by, revoked_at, revoked_by, revoke_reason
    `, [id, callerId, reason]);

    if (!updated.length) {
      // Lost a race with another revoke/expiry; report terminal state.
      return res.status(409).json({ error: 'Delegation is no longer active.' });
    }

    await logAdminAction({
      adminId: callerId,
      action: 'delegation_grant_revoked',
      targetType: 'delegation',
      targetKey: `delegation:${id}`,
      description: `Revoked delegation to ${grant.grantee_admin_id}${reason ? `: ${reason}` : ''}`,
      before: { status: 'active' },
      after: { status: 'revoked', revoked_by: callerId },
      req,
      throwOnError: true,
    });

    res.json({ delegation: updated[0] });
  } catch (err) {
    logger.error('workforce.revokeDelegation error', { err });
    res.status(500).json({ error: 'Failed to revoke delegation.' });
  }
};

// ── GET /lifecycle ───────────────────────────────────────────────────────────

const LIFECYCLE_ACTIONS = [
  // Delegation grants (this workspace)
  'delegation_grant_created',
  'delegation_grant_revoked',
  // Permission grants (extended, not duplicated)
  'permission_grant_create',
  'permission_grant_revoke',
  // Admin account status changes
  'admin_account_created',
  'admin_account_enabled',
  'admin_account_disabled',
  'force_logout',
];

exports.getLifecycle = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        a.id,
        a.admin_id AS actor_id,
        TRIM(u.first_name || ' ' || u.last_name) AS actor_name,
        a.action,
        a.target_type,
        a.target_id,
        a.target_key,
        a.description,
        a.created_at
      FROM admin_audit_log a
      LEFT JOIN users u ON u.id = a.admin_id
      WHERE a.action = ANY($1)
      ORDER BY a.created_at DESC
      LIMIT 100
    `, [LIFECYCLE_ACTIONS]);

    res.json({
      events: rows.map((r) => ({
        id: r.id,
        actor_id: r.actor_id,
        actor_name: r.actor_name || 'System',
        action: r.action,
        target_type: r.target_type,
        target_id: r.target_id,
        target_key: r.target_key,
        description: r.description,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    logger.error('workforce.getLifecycle error', { err });
    res.status(500).json({ error: 'Failed to load lifecycle events.' });
  }
};
