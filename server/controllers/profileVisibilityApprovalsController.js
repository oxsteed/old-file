// server/controllers/profileVisibilityApprovalsController.js
// Workstream B: HTTP surface for the two-person approval workflow.
//
// All routes in server/routes/admin.js sit behind requireAdmin +
// requirePermission('manage_profile_visibility'):
//   POST /api/admin/profile-visibility/approvals/request
//   POST /api/admin/profile-visibility/approvals/:id/review
//   GET  /api/admin/profile-visibility/approvals

'use strict';

const logger = require('../utils/logger');
const {
  requestApproval,
  reviewApproval,
} = require('../services/profileVisibilityApprovals');
const db = require('../db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── POST /approvals/request ───────────────────────────────────────────────
// Body: { action_type: 'single'|'bulk'|'scheduled', payload: object,
//         idempotency_key: string }
// 409 with the existing record when the idempotency key was already seen.
exports.requestApprovalCtrl = async (req, res) => {
  try {
    const { action_type, payload, idempotency_key } = req.body || {};
    const { approval, created } = await requestApproval({
      actionType: action_type,
      payload,
      requestedBy: req.user.id,
      idempotencyKey: idempotency_key,
    });
    if (!created) {
      return res.status(409).json({
        error: 'An approval request with this idempotency key already exists.',
        approval,
      });
    }
    return res.status(201).json({ approval });
  } catch (err) {
    logger.error('profileVisibilityApprovals request error', { err, adminId: req.user?.id });
    if (Number.isInteger(err.statusCode)) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    return res.status(500).json({ error: 'Could not create approval request.' });
  }
};

// ─── POST /approvals/:id/review ────────────────────────────────────────────
// Body: { decision: 'approved'|'rejected', note?: string }
// The requesting admin cannot review their own request (403 separation of
// duties, enforced in the service).
exports.reviewApprovalCtrl = async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid approval id.' });
    const { decision, note } = req.body || {};
    const result = await reviewApproval({
      approvalId: id,
      reviewerId: req.user.id,
      decision,
      note,
    });
    return res.json(result);
  } catch (err) {
    logger.error('profileVisibilityApprovals review error', { err, adminId: req.user?.id });
    if (Number.isInteger(err.statusCode)) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    return res.status(500).json({ error: 'Could not review approval request.' });
  }
};

// ─── GET /:type/:id/notifications ─────────────────────────────────────────
// Owner-notification delivery status for one profile (read-only projection
// over profile_visibility_owner_notifications, newest first).
exports.listOwnerNotifications = async (req, res) => {
  try {
    const profileType = String(req.params.type || '').toLowerCase();
    const profileId = String(req.params.id || '').trim();
    if (!['helper', 'business', 'restaurant'].includes(profileType) || !profileId) {
      return res.status(400).json({ error: 'Invalid profile reference.' });
    }
    const { rows } = await db.query(
      `SELECT id, profile_type, profile_id, action, status, attempts,
              last_error, sent_at, created_at
         FROM profile_visibility_owner_notifications
        WHERE profile_type = $1 AND profile_id = $2
        ORDER BY created_at DESC
        LIMIT 50`,
      [profileType, profileId]
    );
    return res.json({ notifications: rows });
  } catch (err) {
    logger.error('profileVisibilityApprovals notifications error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not load notification status.' });
  }
};

// ─── GET /approvals ────────────────────────────────────────────────────────
// Query: ?status=pending (default) — bounded list of approval requests.
exports.listApprovals = async (req, res) => {
  try {
    const status = String(req.query.status || 'pending').toLowerCase();
    if (!['pending', 'approved', 'rejected', 'consumed', 'expired'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter.' });
    }
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const { rows } = await db.query(
      `SELECT a.*, u.email AS requested_by_email
         FROM profile_visibility_approvals a
         LEFT JOIN users u ON u.id = a.requested_by
        WHERE a.status = $1
        ORDER BY a.created_at DESC
        LIMIT $2`,
      [status, limit]
    );
    return res.json({ approvals: rows });
  } catch (err) {
    logger.error('profileVisibilityApprovals list error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not list approval requests.' });
  }
};
