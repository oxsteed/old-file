'use strict';

/**
 * Admin controller for the dual-approval queue (ADM-016).
 *
 * Above-threshold money movements are queued as pending approvals instead of
 * executing. A DIFFERENT admin reviews the queue and approves (fresh
 * step-up challenge required — money moves on approval) or rejects.
 *
 * Endpoints (mounted under /admin in routes/admin.js):
 *   GET  /money-approvals                 list pending approvals
 *   POST /money-approvals/:id/approve     approve + execute (step-up required)
 *   POST /money-approvals/:id/reject      reject (terminal)
 *   POST /stepup-challenges/money-approval  issue a step-up challenge for approval
 */

const {
  listPendingMoneyMovementApprovals,
  getMoneyMovementApproval,
  decideMoneyMovementApproval,
} = require('../services/dualApprovalService');
const { issueStepupChallenge, verifyStepupChallenge } = require('../services/stepupChallengeService');
const { logAdminAction } = require('../services/auditService');
const { sanitizeApproval } = require('../utils/dualApprovalHttp');
const logger = require('../utils/logger');

async function list(req, res, next) {
  try {
    const approvals = await listPendingMoneyMovementApprovals({ limit: req.query.limit });
    res.json({ approvals: approvals.map(sanitizeApproval) });
  } catch (err) {
    next(err);
  }
}

async function issueApproveStepupChallenge(req, res, next) {
  try {
    const adminId = req.user?.id;
    if (!adminId) return res.status(401).json({ error: 'Unauthorized.' });
    const approval = await getMoneyMovementApproval(req.body?.approvalId || req.query?.approvalId);
    const { challenge, delivery } = await issueStepupChallenge({
      actorUserId: adminId,
      actorEmail: req.user?.email,
      actionType: 'money_movement_approve',
      amountCents: approval ? Number(approval.amount_cents) : 1,
      currencyCode: approval ? approval.currency_code : 'USD',
    });
    res.status(201).json({
      challenge: {
        id: challenge.id,
        actionType: challenge.actionType,
        amountCents: challenge.amountCents,
        currencyCode: challenge.currencyCode,
        expiresAt: challenge.expiresAt,
      },
      delivery,
    });
  } catch (err) {
    next(err);
  }
}

async function approve(req, res, next) {
  try {
    const approverId = req.user?.id;
    if (!approverId) return res.status(401).json({ error: 'Unauthorized.' });

    // The checker re-authenticates at the moment money moves.
    await verifyStepupChallenge({
      challengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
      actorUserId: approverId,
      actionType: 'money_movement_approve',
      code: req.body?.stepupCode || req.body?.stepup_code,
    });

    const { approval, result } = await decideMoneyMovementApproval({
      approvalId: req.params.id,
      approverId,
      decision: 'approve',
    });

    try {
      await logAdminAction({
        adminId: approverId,
        action: 'money_movement_approved',
        targetType: 'money_movement_approval',
        targetId: String(approval.id),
        description: `Dual-approved ${approval.movement_type} of ${approval.amount_cents} ${approval.currency_code} (requested by ${approval.requested_by})`,
        before: { status: 'pending' },
        after: { status: 'executed', decided_by: approverId },
        req,
      });
    } catch (e) {
      logger.error('money_movement_approved audit write failed AFTER execution', {
        approvalId: approval.id,
        approverId,
        error: e.message,
      });
    }

    return res.status(200).json({ approval: sanitizeApproval(approval), result: result || null });
  } catch (err) {
    next(err);
  }
}

async function reject(req, res, next) {
  try {
    const approverId = req.user?.id;
    if (!approverId) return res.status(401).json({ error: 'Unauthorized.' });
    const reason = req.body?.reason || req.body?.decision_reason || null;
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A rejection reason is required.', code: 'money_movement_reason_required' });
    }

    const { approval } = await decideMoneyMovementApproval({
      approvalId: req.params.id,
      approverId,
      decision: 'reject',
      reason: String(reason).trim(),
    });

    try {
      await logAdminAction({
        adminId: approverId,
        action: 'money_movement_rejected',
        targetType: 'money_movement_approval',
        targetId: String(approval.id),
        description: `Rejected ${approval.movement_type} of ${approval.amount_cents} ${approval.currency_code} (requested by ${approval.requested_by}): ${String(reason).trim().slice(0, 200)}`,
        before: { status: 'pending' },
        after: { status: 'rejected', decided_by: approverId },
        req,
      });
    } catch (e) {
      logger.error('money_movement_rejected audit write failed', {
        approvalId: approval.id,
        approverId,
        error: e.message,
      });
    }

    return res.status(200).json({ approval: sanitizeApproval(approval) });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, approve, reject, issueApproveStepupChallenge };
