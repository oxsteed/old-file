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
const AppError = require('../utils/appError');
const { logAdminAction } = require('../services/auditService');
const { sanitizeApproval } = require('../utils/dualApprovalHttp');
const logger = require('../utils/logger');

async function list(req, res, next) {
  try {
    const page = await listPendingMoneyMovementApprovals({ limit: req.query.limit, offset: req.query.offset });
    res.json({ ...page, approvals: page.approvals.map(sanitizeApproval) });
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

    // The checker re-authenticates at the moment money moves. Auth audit
    // item 6: bind to the approval's amount (the same figure the issue
    // endpoint binds when the client sends approvalId).
    //
    // Domain 6 finding 4 (2026-11-17): this pre-read used to log "skipping
    // amount binding" and verify unbound when the approval row could not be
    // loaded. That was fail-open, not harmless: decideMoneyMovementApproval
    // performs NO amount check of its own (it trusts the caller's verify —
    // see dualApprovalService.js), so a transient pre-read error let a
    // challenge issued for a different amount (the issue endpoint mints a
    // 1-cent challenge when the approval cannot be loaded) execute the
    // full approval amount. The in-code comment that used to sit here
    // claimed the decide call "fails as before"; that holds only when the
    // row is genuinely missing (decide 404s), and even then only after the
    // challenge has been consumed. So: a failed pre-read fails closed with
    // 503 before any verification, and a missing row 404s before any
    // verification (the same error decide would throw, without burning the
    // challenge). A found row always carries a positive amount
    // (requestMoneyMovementApproval enforces it), so binding never skips.
    let moneyApprovalExpectedAmount;
    let approvalRow;
    try {
      approvalRow = await getMoneyMovementApproval(req.params.id);
    } catch (loadError) {
      logger.warn('moneyApproval.approve stepup pre-read failed, failing closed', { approvalId: req.params.id, error: loadError.message });
      throw new AppError('Could not read the approval amount for step-up binding; retry the approval', 503, 'credit_stepup_amount_preread_failed');
    }
    if (!approvalRow) {
      throw new AppError('Approval request not found', 404, 'money_movement_not_found');
    }
    const n = Number(approvalRow.amount_cents);
    if (!Number.isSafeInteger(n) || n <= 0) {
      logger.warn('moneyApproval.approve stepup pre-read found no bindable amount, failing closed', { approvalId: req.params.id });
      throw new AppError('Could not read the approval amount for step-up binding; retry the approval', 503, 'credit_stepup_amount_preread_failed');
    }
    moneyApprovalExpectedAmount = n;
    await verifyStepupChallenge({
      challengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
      actorUserId: approverId,
      actionType: 'money_movement_approve',
      code: req.body?.stepupCode || req.body?.stepup_code,
      expectedAmountCents: moneyApprovalExpectedAmount,
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
