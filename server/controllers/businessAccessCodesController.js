'use strict';

/**
 * Reusable per-business access codes ("Vortex codes").
 *
 * Distinct from server/controllers/businessMembersController flow which
 * uses single-use business_invite_tokens emailed to a specific person.
 * Access codes are short, rotatable, shareable, and tied to a role; the
 * redeemer presents them in the Vortex page and an active business_members
 * row is created (status defaults to 'pending' so the owner can approve,
 * or 'active' immediately if requires_approval=false on the code).
 *
 * All write endpoints require manager+ on the business.
 */

const crypto = require('crypto');
const pool = require('../db');
const { sendError } = require('../utils/apiError');
const { logBusinessAction } = require('../services/businessAuditLog');
const { sendNotification } = require('../services/notificationService');
const permissionsService = require('../services/permissionsService');

const VALID_ROLES = ['manager', 'representative', 'employee', 'support_agent'];

// Friendly, unambiguous alphabet (no I/O/0/1 to reduce read errors).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length = 10) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    // crypto.randomInt is uniform over [0, 32) with no modulo bias, and stays
    // correct if the alphabet length ever stops dividing 256 evenly.
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  // VRTX-XXXXX-XXXXX style for readability when length is 10
  if (length === 10) {
    return `VRTX-${out.slice(0, 5)}-${out.slice(5, 10)}`;
  }
  return out;
}

/**
 * GET /api/businesses/:businessId/access-codes
 * Manager+ only (enforced by route mount).
 */
exports.listAccessCodes = async (req, res, next) => {
  try {
    // Audit fix: never return the secret of a live code in a list view. Active
    // codes come back with code = NULL; the full code string is shown exactly
    // once, at creation / rotation time. Revoked codes are inert, so their
    // plaintext is kept for operator reference.
    const { rows } = await pool.query(
      `SELECT bac.id,
              CASE WHEN bac.is_active THEN NULL ELSE bac.code END AS code,
              bac.role, bac.label, bac.max_uses, bac.uses,
              bac.requires_approval, bac.expires_at, bac.is_active,
              bac.created_at, bac.rotated_at,
              u.first_name AS created_by_first_name,
              u.last_name  AS created_by_last_name
         FROM business_access_codes bac
         LEFT JOIN users u ON u.id = bac.created_by
        WHERE bac.business_id = $1
        ORDER BY bac.is_active DESC, bac.created_at DESC`,
      [req.business.id]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/businesses/:businessId/access-codes
 * Body: { role, label?, max_uses?, expires_in_days?, requires_approval? }
 */
exports.createAccessCode = async (req, res, next) => {
  try {
    const requestedRole = String(req.body.role || '').trim();
    if (!VALID_ROLES.includes(requestedRole)) {
      return sendError(res, 400, 'Invalid role for access code.', 'invalid_role', { allowed: VALID_ROLES });
    }

    // Privilege restriction (mirrors vortexController.generateToken): only the
    // real business owner (req.business.owner_id, set by requireBusinessAccess)
    // may issue manager-role codes. A manager passing role:'manager' is
    // silently capped to 'representative' - preventing privilege
    // self-replication.
    const isOwner = req.business.owner_id === req.user.id;
    const role = (!isOwner && requestedRole === 'manager') ? 'representative' : requestedRole;

    const label = req.body.label != null ? String(req.body.label).slice(0, 120) : null;
    const maxUses = req.body.max_uses != null ? Math.max(1, parseInt(req.body.max_uses, 10)) : null;
    const expiresInDays = req.body.expires_in_days != null ? Math.max(1, parseInt(req.body.expires_in_days, 10)) : null;
    const requiresApproval = req.body.requires_approval !== false; // default TRUE

    let expiresAt = null;
    if (expiresInDays) {
      expiresAt = new Date(Date.now() + expiresInDays * 24 * 3600 * 1000);
    }

    // Retry on the (tiny) chance of a code collision.
    let code = null;
    let inserted = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
      code = generateCode(10);
      try {
        const result = await pool.query(
          `INSERT INTO business_access_codes
             (business_id, code, role, label, max_uses, requires_approval, expires_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, code, role, label, max_uses, uses, requires_approval, expires_at, is_active, created_at`,
          [req.business.id, code, role, label, maxUses, requiresApproval, expiresAt, req.user.id]
        );
        inserted = result.rows[0];
      } catch (err) {
        if (err && err.code === '23505') continue; // duplicate code, retry
        throw err;
      }
    }
    if (!inserted) {
      return sendError(res, 500, 'Failed to generate a unique access code. Please retry.', 'code_collision');
    }

    await logBusinessAction(req, {
      action: 'business.access_code.created',
      target_type: 'business_access_code',
      target_id: inserted.id,
      after_state: { code: inserted.code, role: inserted.role, max_uses: maxUses, expires_at: expiresAt },
    });

    res.status(201).json({ data: inserted });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/businesses/:businessId/access-codes/:codeId/rotate
 * Issues a new code string for an existing code row (preserves role/limits).
 */
exports.rotateAccessCode = async (req, res, next) => {
  try {
    const codeId = parseInt(req.params.codeId, 10);
    if (!Number.isFinite(codeId)) {
      return sendError(res, 400, 'Invalid code id.', 'invalid_code_id');
    }

    const existing = await pool.query(
      'SELECT id, code FROM business_access_codes WHERE id = $1 AND business_id = $2',
      [codeId, req.business.id]
    );
    if (existing.rowCount === 0) {
      return sendError(res, 404, 'Access code not found.', 'access_code_not_found');
    }

    let updated = null;
    for (let attempt = 0; attempt < 5 && !updated; attempt += 1) {
      const next = generateCode(10);
      try {
        const r = await pool.query(
          `UPDATE business_access_codes
              SET code = $1,
                  rotated_at = NOW(),
                  updated_at = NOW(),
                  is_active = TRUE
            WHERE id = $2 AND business_id = $3
            RETURNING id, code, role, label, max_uses, uses, requires_approval, expires_at, is_active, created_at, rotated_at`,
          [next, codeId, req.business.id]
        );
        updated = r.rows[0];
      } catch (err) {
        if (err && err.code === '23505') continue;
        throw err;
      }
    }
    if (!updated) {
      return sendError(res, 500, 'Failed to rotate code.', 'rotate_failed');
    }

    await logBusinessAction(req, {
      action: 'business.access_code.rotated',
      target_type: 'business_access_code',
      target_id: updated.id,
      before_state: { code: existing.rows[0].code },
      after_state:  { code: updated.code },
    });
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/businesses/:businessId/access-codes/:codeId
 * Body: { is_active?, label?, expires_in_days?, max_uses?, requires_approval? }
 */
exports.updateAccessCode = async (req, res, next) => {
  try {
    const codeId = parseInt(req.params.codeId, 10);
    if (!Number.isFinite(codeId)) {
      return sendError(res, 400, 'Invalid code id.', 'invalid_code_id');
    }

    const sets = [];
    const params = [];
    let i = 1;

    if (req.body.is_active != null) {
      sets.push(`is_active = $${i++}`);
      params.push(!!req.body.is_active);
    }
    if (req.body.label !== undefined) {
      sets.push(`label = $${i++}`);
      params.push(req.body.label == null ? null : String(req.body.label).slice(0, 120));
    }
    if (req.body.max_uses !== undefined) {
      sets.push(`max_uses = $${i++}`);
      params.push(req.body.max_uses == null ? null : Math.max(1, parseInt(req.body.max_uses, 10)));
    }
    if (req.body.requires_approval !== undefined) {
      sets.push(`requires_approval = $${i++}`);
      params.push(!!req.body.requires_approval);
    }
    if (req.body.expires_in_days !== undefined) {
      const days = req.body.expires_in_days == null ? null : Math.max(1, parseInt(req.body.expires_in_days, 10));
      sets.push(`expires_at = $${i++}`);
      params.push(days == null ? null : new Date(Date.now() + days * 24 * 3600 * 1000));
    }

    if (sets.length === 0) {
      return sendError(res, 400, 'No fields to update.', 'no_fields');
    }
    sets.push('updated_at = NOW()');

    params.push(codeId, req.business.id);
    const { rows, rowCount } = await pool.query(
      `UPDATE business_access_codes
          SET ${sets.join(', ')}
        WHERE id = $${i++} AND business_id = $${i++}
        RETURNING id, code, role, label, max_uses, uses, requires_approval, expires_at, is_active, created_at, rotated_at`,
      params
    );
    if (rowCount === 0) {
      return sendError(res, 404, 'Access code not found.', 'access_code_not_found');
    }

    await logBusinessAction(req, {
      action: 'business.access_code.updated',
      target_type: 'business_access_code',
      target_id: rows[0].id,
      after_state: rows[0],
    });
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/businesses/:businessId/access-codes/:codeId
 * Soft-delete by setting is_active=FALSE.
 */
exports.revokeAccessCode = async (req, res, next) => {
  try {
    const codeId = parseInt(req.params.codeId, 10);
    if (!Number.isFinite(codeId)) {
      return sendError(res, 400, 'Invalid code id.', 'invalid_code_id');
    }
    const { rows, rowCount } = await pool.query(
      `UPDATE business_access_codes
          SET is_active = FALSE, updated_at = NOW()
        WHERE id = $1 AND business_id = $2 AND is_active = TRUE
        RETURNING id, code`,
      [codeId, req.business.id]
    );
    if (rowCount === 0) {
      return sendError(res, 404, 'Access code not found or already revoked.', 'access_code_not_found');
    }
    await logBusinessAction(req, {
      action: 'business.access_code.revoked',
      target_type: 'business_access_code',
      target_id: rows[0].id,
      before_state: { code: rows[0].code, is_active: true },
      after_state:  { is_active: false },
    });
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Redemption — called from the Vortex page when a user enters a code.
// Requires auth but no business context (the code IS the business context).
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/vortex/preview
 * Body: { code }
 * Returns business name + role to be granted, WITHOUT consuming the code.
 * Lets the UI show a confirmation screen before the user commits.
 *
 * Status-oracle hardening: every "this code does not work" outcome returns the
 * same 404 status and the same generic message, so an attacker cannot
 * distinguish invalid / revoked / expired / exhausted codes by probing. The
 * distinct reason is kept only in the machine-readable `code` field.
 */
const CODE_UNAVAILABLE = 'This code is not valid or is no longer available.';
exports.previewCode = async (req, res, next) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) {
      return sendError(res, 400, 'Code is required.', 'code_required');
    }
    const { rows } = await pool.query(
      `SELECT bac.id, bac.business_id, bac.role, bac.label, bac.max_uses, bac.uses,
              bac.requires_approval, bac.expires_at, bac.is_active,
              b.business_name
         FROM business_access_codes bac
         JOIN businesses b ON b.id = bac.business_id
        WHERE bac.code = $1
        LIMIT 1`,
      [code]
    );
    if (rows.length === 0 || !rows[0].is_active) {
      return sendError(res, 404, CODE_UNAVAILABLE, 'invalid_code');
    }
    const row = rows[0];
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return sendError(res, 404, CODE_UNAVAILABLE, 'code_expired');
    }
    if (row.max_uses != null && row.uses >= row.max_uses) {
      return sendError(res, 404, CODE_UNAVAILABLE, 'code_exhausted');
    }
    res.json({
      data: {
        business_id: row.business_id,
        business_name: row.business_name,
        role: row.role,
        label: row.label,
        requires_approval: row.requires_approval,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/vortex/redeem
 * Body: { code }
 * Consumes the code, creates / reuses a business_members row, returns the
 * business id + status so the client can route to the workspace.
 */
exports.redeemCode = async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!req.user || !req.user.id) {
      return sendError(res, 401, 'You must be signed in to redeem a code.', 'auth_required');
    }
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) {
      return sendError(res, 400, 'Code is required.', 'code_required');
    }

    await client.query('BEGIN');

    // Lock the code row to safely increment uses
    const codeRes = await client.query(
      `SELECT id, business_id, role, max_uses, uses, requires_approval, expires_at, is_active
         FROM business_access_codes
        WHERE code = $1
        FOR UPDATE`,
      [code]
    );
    if (codeRes.rowCount === 0 || !codeRes.rows[0].is_active) {
      await client.query('ROLLBACK');
      return sendError(res, 404, CODE_UNAVAILABLE, 'invalid_code');
    }
    const codeRow = codeRes.rows[0];

    if (codeRow.expires_at && new Date(codeRow.expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      return sendError(res, 404, CODE_UNAVAILABLE, 'code_expired');
    }
    if (codeRow.max_uses != null && codeRow.uses >= codeRow.max_uses) {
      await client.query('ROLLBACK');
      return sendError(res, 404, CODE_UNAVAILABLE, 'code_exhausted');
    }

    // Owner can't redeem their own code (they're already owner).
    // Also refuse codes whose business is not live (deactivated / soft-deleted).
    const bizRes = await client.query(
      'SELECT user_id, business_name FROM businesses WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL',
      [codeRow.business_id]
    );
    if (bizRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return sendError(res, 410, 'This business is no longer active.', 'business_inactive');
    }
    if (bizRes.rows[0].user_id === req.user.id) {
      await client.query('ROLLBACK');
      return sendError(res, 409, 'You already own this business.', 'already_owner');
    }

    const desiredStatus = codeRow.requires_approval ? 'pending' : 'active';
    const acceptedAt = codeRow.requires_approval ? null : new Date();

    // Existing membership? Re-use / reactivate.
    const existing = await client.query(
      `SELECT id, status, role
         FROM business_members
        WHERE business_id = $1 AND member_id = $2
        ORDER BY status = 'revoked', id DESC
        LIMIT 1`,
      [codeRow.business_id, req.user.id]
    );

    let membershipId = null;
    let membershipStatus = desiredStatus;
    // Only consume one of the code's limited uses when the redemption actually
    // changes something (new membership or reactivation). A no-op re-redeem by
    // someone who already holds a live membership must not burn max_uses.
    let consumeUse = false;
    // Tracks whether this redeem created or reactivated the membership, so we
    // only notify the owner when there is something new to look at.
    let isNewJoin = false;
    if (existing.rowCount > 0 && existing.rows[0].status !== 'revoked') {
      membershipId = existing.rows[0].id;
      membershipStatus = existing.rows[0].status;
    } else if (existing.rowCount > 0 && existing.rows[0].status === 'revoked') {
      const upd = await client.query(
        `UPDATE business_members
            SET status = $1,
                role = $2,
                accepted_at = $3,
                role_updated_at = NOW(),
                role_updated_by = $4
          WHERE id = $5
          RETURNING id`,
        [desiredStatus, codeRow.role, acceptedAt, bizRes.rows[0].user_id, existing.rows[0].id]
      );
      membershipId = upd.rows[0].id;
      consumeUse = true;
      isNewJoin = true;
    } else {
      const ins = await client.query(
        `INSERT INTO business_members
           (business_id, owner_id, member_id, role, invite_email, status, accepted_at, role_updated_at, role_updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $2)
         RETURNING id`,
        [
          codeRow.business_id,
          bizRes.rows[0].user_id,
          req.user.id,
          codeRow.role,
          req.user.email || `${req.user.id}@oxsteed.local`,
          desiredStatus,
          acceptedAt,
        ]
      );
      membershipId = ins.rows[0].id;
      consumeUse = true;
      isNewJoin = true;
    }

    if (consumeUse) {
      await client.query(
        'UPDATE business_access_codes SET uses = uses + 1, updated_at = NOW() WHERE id = $1',
        [codeRow.id]
      );
    }

    await client.query(
      `INSERT INTO business_access_code_redemptions (code_id, user_id, membership_id, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        codeRow.id,
        req.user.id,
        membershipId,
        (req.headers && req.headers['x-forwarded-for']) ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : (req.ip || null),
        req.headers && req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 500) : null,
      ]
    );

    // Update workspace context so next login lands on the new business
    await client.query(
      `INSERT INTO user_workspace_contexts (user_id, business_id, membership_id, last_selected_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, business_id) DO UPDATE
         SET membership_id = EXCLUDED.membership_id,
             last_selected_at = NOW()`,
      [req.user.id, codeRow.business_id, membershipId]
    );

    // Capture notification values before COMMIT so no DB read is needed later.
    const notifOwnerId = bizRes.rows[0].user_id;
    const notifBusinessName = bizRes.rows[0].business_name;
    const notifJoinerName = [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Someone';

    await client.query('COMMIT');

    // Fire-and-forget audit (post-commit)
    logBusinessAction(
      { user: req.user, business: { id: codeRow.business_id }, businessRole: codeRow.role, headers: req.headers, ip: req.ip },
      {
        action: 'business.member.code_redeemed',
        target_type: 'business_member',
        target_id: membershipId,
        metadata: { code_id: codeRow.id, role: codeRow.role, status: membershipStatus },
      }
    ).catch(() => {});

    // Fire-and-forget owner notification, only when the redeem actually created
    // or reactivated the membership (a no-op re-redeem must not re-notify).
    if (isNewJoin) {
      const payload = {
        userId: notifOwnerId,
        title: membershipStatus === 'pending' ? 'Approval needed' : 'New team member',
        type: membershipStatus === 'pending' ? 'vortex_approval_requested' : 'vortex_member_joined',
        body: membershipStatus === 'pending'
          ? `${notifJoinerName} wants to join "${notifBusinessName}" as ${codeRow.role} via access code.`
          : `${notifJoinerName} joined "${notifBusinessName}" as ${codeRow.role} via access code.`,
        data: {
          business_id: codeRow.business_id,
          membership_id: membershipId,
          member_id: req.user.id,
          role: codeRow.role,
        },
      };
      sendNotification(payload).catch(() => {});
    }

    // Invalidate any cached permissions for this user on this business
    permissionsService.invalidateCache(codeRow.business_id, req.user.id);

    res.status(200).json({
      data: {
        business_id: codeRow.business_id,
        business_name: bizRes.rows[0].business_name,
        membership_id: membershipId,
        role: codeRow.role,
        status: membershipStatus,
        requires_approval: codeRow.requires_approval,
      },
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

/**
 * POST /api/businesses/:businessId/memberships/:membershipId/approve
 * Owner/manager approves a pending membership created via code redemption.
 */
exports.approveMembership = async (req, res, next) => {
  try {
    const mid = parseInt(req.params.membershipId, 10);
    if (!Number.isFinite(mid)) {
      return sendError(res, 400, 'Invalid membership id.', 'invalid_membership_id');
    }
    const { rows, rowCount } = await pool.query(
      `UPDATE business_members
          SET status = 'active', accepted_at = COALESCE(accepted_at, NOW())
        WHERE id = $1 AND business_id = $2 AND status = 'pending'
        RETURNING id, member_id, role`,
      [mid, req.business.id]
    );
    if (rowCount === 0) {
      return sendError(res, 404, 'Membership not found or not pending.', 'membership_not_found');
    }
    permissionsService.invalidateCache(req.business.id, rows[0].member_id);
    await logBusinessAction(req, {
      action: 'business.member.approved',
      target_type: 'business_member',
      target_id: mid,
      after_state: { status: 'active', role: rows[0].role },
    });
    res.json({ data: rows[0] });

    // Fire-and-forget: notify the joiner they were approved.
    sendNotification({
      userId: rows[0].member_id,
      type: 'vortex_membership_approved',
      title: 'You were approved',
      body: `Your request to join "${req.business.business_name}" was approved.`,
      data: { business_id: req.business.id, membership_id: mid, role: rows[0].role },
    }).catch(() => {});
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/businesses/:businessId/memberships/:membershipId/deny
 * Deny a PENDING join request. Active members are NOT affected — use the
 * remove endpoint to kick an active member.
 */
exports.denyMembership = async (req, res, next) => {
  try {
    const mid = parseInt(req.params.membershipId, 10);
    if (!Number.isFinite(mid)) {
      return sendError(res, 400, 'Invalid membership id.', 'invalid_membership_id');
    }
    const { rows, rowCount } = await pool.query(
      `UPDATE business_members
          SET status = 'revoked'
        WHERE id = $1 AND business_id = $2 AND status = 'pending'
        RETURNING id, member_id`,
      [mid, req.business.id]
    );
    if (rowCount === 0) {
      return sendError(res, 404, 'Pending membership not found.', 'membership_not_found');
    }
    permissionsService.invalidateCache(req.business.id, rows[0].member_id);
    await logBusinessAction(req, {
      action: 'business.member.denied',
      target_type: 'business_member',
      target_id: mid,
      after_state: { status: 'revoked' },
    });
    res.json({ data: { ok: true } });

    // Fire-and-forget: notify the joiner they were not approved.
    sendNotification({
      userId: rows[0].member_id,
      type: 'vortex_membership_denied',
      title: 'Request denied',
      body: `Your request to join "${req.business.business_name}" was not approved.`,
      data: { business_id: req.business.id, membership_id: mid },
    }).catch(() => {});
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/businesses/:businessId/memberships/:membershipId/remove
 * Remove (kick) an ACTIVE member. Pending requests use the deny endpoint.
 * The owner cannot remove themselves.
 */
exports.removeMembership = async (req, res, next) => {
  try {
    const mid = parseInt(req.params.membershipId, 10);
    if (!Number.isFinite(mid)) {
      return sendError(res, 400, 'Invalid membership id.', 'invalid_membership_id');
    }
    const { rows, rowCount } = await pool.query(
      `SELECT id, member_id, role FROM business_members
        WHERE id = $1 AND business_id = $2 AND status = 'active'`,
      [mid, req.business.id]
    );
    if (rowCount === 0) {
      return sendError(res, 404, 'Active membership not found.', 'membership_not_found');
    }
    if (rows[0].member_id === req.user.id) {
      return sendError(res, 400, 'You cannot remove yourself.', 'cannot_remove_self');
    }
    await pool.query(
      `UPDATE business_members SET status = 'revoked' WHERE id = $1`,
      [mid]
    );
    permissionsService.invalidateCache(req.business.id, rows[0].member_id);
    await logBusinessAction(req, {
      action: 'business.member.removed',
      target_type: 'business_member',
      target_id: mid,
      after_state: { status: 'revoked', role: rows[0].role },
    });
    res.json({ data: { ok: true } });

    // Fire-and-forget: notify the removed member.
    sendNotification({
      userId: rows[0].member_id,
      type: 'vortex_membership_removed',
      title: 'Removed from team',
      body: `You were removed from the team of "${req.business.business_name}".`,
      data: { business_id: req.business.id, membership_id: mid },
    }).catch(() => {});
  } catch (err) {
    next(err);
  }
};
