'use strict';

/**
 * OxSteed Logistics — dual-admin refund controller (Phase 3).
 *
 * Replaces the removed PATCH /refund-cases/:id endpoint, which let anyone
 * with operations access establish a "processed" refund merely by editing
 * `status` or pasting a `stripe_refund_id`. The only way a refund moves now
 * is propose -> approve (different admin, fresh auth) -> execute.
 *
 * Legacy reads stay compatible: GET /refund-cases and GET /refunds list the
 * same rows; new columns are additive.
 */

const crypto = require('crypto');
const { authenticator } = require('@otplib/v12-adapter');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { decrypt, hashIP } = require('../utils/encryption');
const { adminTotpEnabled } = require('../middleware/adminAuth');
const refundService = require('../services/logisticsRefundService');
const { createDefaultDeps, _internal } = require('../services/logisticsRefundPorts');
const { logLogisticsAction } = require('../services/logisticsAuditService');

function deps() {
  // Pass the pool itself so withTransaction can hold a dedicated connection.
  return createDefaultDeps(pool);
}

async function logAction(caseId, action, actorUserId, meta) {
  try {
    await logLogisticsAction('refund_case', caseId, action, { actorUserId, ...meta });
  } catch (_) { /* audit must not break the money path */ }
}

function serialize(kase) {
  if (!kase) return kase;
  return {
    ...kase,
    amount_cents: kase.amount_cents != null ? Number(kase.amount_cents) : null,
  };
}

// ─── Step-up: POST /refunds/stepup/verify ────────────────────
// Verifies the admin's TOTP code and records a fresh-auth event valid for
// FRESH_AUTH_TTL_MINUTES. The UI calls this before approve.

exports.verifyStepUp = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { code, purpose = 'logistics_refund_approve' } = req.body || {};
    if (!code || typeof code !== 'string') {
      return next(new AppError('A TOTP code is required.', 400, 'validation_failed'));
    }
    if (!(await adminTotpEnabled(userId))) {
      return next(new AppError('TOTP must be enabled to approve refunds.', 403, 'stepup_totp_not_enabled'));
    }
    const { rows } = await pool.query('SELECT totp_secret FROM users WHERE id = $1', [userId]);
    if (!rows[0]?.totp_secret) {
      return next(new AppError('TOTP is not configured for this account.', 403, 'stepup_totp_not_configured'));
    }
    authenticator.options = { window: 1 };
    const verified = authenticator.verify({
      secret: decrypt(rows[0].totp_secret),
      token: code.trim(),
    });
    if (!verified) {
      return next(new AppError('Invalid verification code.', 400, 'validation_failed'));
    }
    const authHash = _internal.authHashFor(userId);
    const ipHash = hashIP(req.ip || req.headers['x-forwarded-for'] || 'unknown');
    await pool.query(
      `INSERT INTO logistics_fresh_auth_events (user_id, method, purpose, ip_hash, auth_hash)
       VALUES ($1, 'totp', $2, $3, $4)`,
      [userId, String(purpose).slice(0, 80), ipHash, authHash]
    );
    res.json({ success: true, data: { fresh: true, ttlMinutes: refundService.FRESH_AUTH_TTL_MINUTES } });
  } catch (err) { next(err); }
};

// ─── POST /refunds/propose ───────────────────────────────────

exports.proposeRefund = async (req, res, next) => {
  try {
    const { payment_attempt_id, amount_cents, reason, refund_method } = req.body || {};
    const kase = await refundService.proposeRefund(deps(), {
      proposerUserId: req.user.id,
      paymentAttemptId: payment_attempt_id,
      amountCents: amount_cents,
      reason,
      refundMethod: refund_method,
    });
    await logAction(kase.id, 'refund_proposed', req.user.id, { reference: kase.reference });
    res.status(201).json({ success: true, data: serialize(kase) });
  } catch (err) { next(err); }
};

// ─── POST /refunds/:id/approve ───────────────────────────────
// requireFreshAuth middleware guarantees req.freshAuth here.

exports.approveRefund = async (req, res, next) => {
  try {
    const kase = await refundService.approveRefund(deps(), {
      caseId: req.params.id,
      approverUserId: req.user.id,
      freshAuthEvent: req.freshAuth,
      reason: req.body?.reason,
    });
    await logAction(kase.id, 'refund_approved', req.user.id, { freshAuthRef: req.freshAuth?.authHash });
    res.json({ success: true, data: serialize(kase) });
  } catch (err) { next(err); }
};

// ─── POST /refunds/:id/reject ────────────────────────────────

exports.rejectRefund = async (req, res, next) => {
  try {
    const kase = await refundService.rejectRefund(deps(), {
      caseId: req.params.id,
      actorUserId: req.user.id,
      reason: req.body?.reason,
    });
    await logAction(kase.id, 'refund_rejected', req.user.id, {});
    res.json({ success: true, data: serialize(kase) });
  } catch (err) { next(err); }
};

// ─── POST /refunds/:id/execute ───────────────────────────────

exports.executeRefund = async (req, res, next) => {
  try {
    const { case: kase, replayed, inProgress, failed, code } = await refundService.executeRefund(deps(), {
      caseId: req.params.id,
      actorUserId: req.user.id,
    });
    await logAction(kase.id, failed ? 'refund_execute_failed' : 'refund_executed', req.user.id, { replayed: !!replayed, code });
    res.json({ success: !failed, data: serialize(kase), replayed: !!replayed, inProgress: !!inProgress, failed: !!failed, code });
  } catch (err) { next(err); }
};

// ─── Reads (backward-compatible) ────────────────────────────

exports.listRefunds = async (req, res, next) => {
  try {
    const data = await refundService.listRefundCases(deps(), {
      status: req.query.status,
      limit: req.query.limit,
    });
    res.json({ success: true, data: data.map(serialize) });
  } catch (err) { next(err); }
};

exports.getRefund = async (req, res, next) => {
  try {
    const data = await refundService.getRefundCase(deps(), req.params.id);
    res.json({ success: true, data: serialize(data) });
  } catch (err) { next(err); }
};

exports.listDecisions = async (req, res, next) => {
  try {
    const data = await refundService.listRefundDecisions(deps(), req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

// Legacy alias: GET /refund-cases keeps working with the same shape.
exports.listRefundCases = exports.listRefunds;
