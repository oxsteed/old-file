'use strict';

/**
 * E13 — Controlled investigation access endpoints.
 *
 *   POST /admin/investigations/access                 request a grant
 *   POST /admin/investigations/access/:id/approve     approver activates
 *   POST /admin/investigations/access/:id/revoke      revoke early
 *   GET  /admin/investigations/users/:userId/profile  the gated elevated read
 *
 * Every read through the investigation endpoint is checked against an
 * active grant and written to the admin audit log with purpose + approver.
 * No grant (and not super-admin) -> 403, fail closed.
 */

const db = require('../db');
const logger = require('../utils/logger');
const {
  InvestigationAccessError,
  requestInvestigationAccess,
  approveInvestigationAccess,
  revokeInvestigationAccess,
  checkInvestigationAccess,
  listInvestigationAccessGrants,
  logInvestigationRead,
} = require('../services/investigationAccessService');

function sendAccessError(res, err) {
  if (err instanceof InvestigationAccessError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  throw err;
}

exports.requestAccess = async (req, res, next) => {
  try {
    const grant = await requestInvestigationAccess({
      requesterId: req.user.id,
      approverId: req.body?.approver_id || req.body?.approverId,
      purpose: req.body?.purpose,
      scopeUserIds: req.body?.scope_user_ids || req.body?.scopeUserIds,
      investigationRef: req.body?.investigation_ref || req.body?.investigationRef,
      expiresAt: req.body?.expires_at || req.body?.expiresAt,
    });
    return res.status(201).json({ grant });
  } catch (err) {
    if (err instanceof InvestigationAccessError) return sendAccessError(res, err);
    return next(err);
  }
};

exports.approveAccess = async (req, res, next) => {
  try {
    const grant = await approveInvestigationAccess({
      grantId: req.params.id,
      approverId: req.user.id,
    });
    return res.json({ grant });
  } catch (err) {
    if (err instanceof InvestigationAccessError) return sendAccessError(res, err);
    return next(err);
  }
};

exports.revokeAccess = async (req, res, next) => {
  try {
    const grant = await revokeInvestigationAccess({
      grantId: req.params.id,
      revokedBy: req.user.id,
      reason: req.body?.reason,
    });
    return res.json({ grant });
  } catch (err) {
    if (err instanceof InvestigationAccessError) return sendAccessError(res, err);
    return next(err);
  }
};

/**
 * GET /admin/investigations/access?status=&requester_id=
 *
 * List investigation access grants for the governance UI. Bounded at 100,
 * newest first; optional status/requester filters. Read-only; grant
 * semantics are enforced by the service.
 */
exports.listAccess = async (req, res, next) => {
  try {
    const grants = await listInvestigationAccessGrants({
      requesterId: req.query.requester_id || req.query.requesterId || null,
      status: req.query.status || null,
    });
    return res.json({ grants });
  } catch (err) {
    if (err instanceof InvestigationAccessError) return sendAccessError(res, err);
    return next(err);
  }
};

// Explicit investigation-read column list. NEVER SELECT * here: no secrets,
// no password hashes, no OTP material.
const INVESTIGATION_COLUMNS = [
  'u.id', 'u.first_name', 'u.last_name', 'u.email', 'u.role', 'u.is_active',
  'u.phone', 'u.created_at', 'u.last_login_at',
  'u.city', 'u.state', 'u.zip_code', 'u.country',
  'u.email_verified', 'u.is_verified', 'u.identity_verified',
  'u.background_check_status', 'u.didit_status', 'u.didit_verified_at',
  'u.membership_tier', 'u.subscription_status', 'u.onboarding_status',
];

/**
 * GET /admin/investigations/users/:userId/profile
 *
 * The controlled elevated read. Super-admins pass by role (still logged);
 * other admins need an active, unexpired, unrevoked grant covering the
 * target user. Every served read is audit-logged with purpose + approver.
 */
exports.readInvestigationProfile = async (req, res, next) => {
  try {
    const { userId } = req.params;
    let grant = null;

    if (!req.isSuper) {
      const check = await checkInvestigationAccess(req.user.id, userId);
      if (!check.granted) {
        return res.status(403).json({
          error: 'Investigation access required: request a purpose-limited grant approved by an authorized approver.',
          code: 'investigation_access_required',
        });
      }
      grant = check.grant;
    }

    const { rows } = await db.query(
      `SELECT ${INVESTIGATION_COLUMNS.join(', ')}
         FROM users u
        WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    // E13: every elevated read is logged with purpose + approver.
    await logInvestigationRead({
      readerAdminId: req.user.id,
      targetUserId: userId,
      grant,
      endpoint: 'investigation_profile',
      req,
    });

    return res.json({ user: rows[0], grant: grant ? { id: grant.id, purpose: grant.purpose, expires_at: grant.expires_at } : null });
  } catch (err) {
    logger.error('readInvestigationProfile error', { err: err.message });
    return next(err);
  }
};
