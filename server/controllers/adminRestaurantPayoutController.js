'use strict';

// Admin controller for restaurant wallet-earnings payouts.
// Every mutation needs the explicit manage_financials grant (super-admin
// bypasses the grant but not the audit trail, keyed on admin identity).

const db = require('../db');
const payoutService = require('../services/restaurantPayoutService');
const { AppError } = require('../middleware/errorHandler');
// ADM-113: the approver must prove a fresh step-up challenge before a
// Stripe Transfer moves.
const { issueStepupChallenge, verifyStepupChallenge } = require('../services/stepupChallengeService');

exports.listQueue = async (req, res, next) => {
  try {
    const client = await db.connect();
    try {
      const payouts = await payoutService.listAdminQueue(client, {
        status: (req.query.status || 'requested').toString(),
        limit: req.query.limit,
      });
      res.json({ payouts });
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

exports.approve = async (req, res, next) => {
  try {
    // ADM-016: above-threshold payouts queue for a second admin instead of
    // moving money on this single approval. The amount is read first so
    // the gate can decide before approvePayout journals anything, and so
    // the step-up challenge can be bound to it (auth audit item 6).
    const { rows: amountRows } = await db.query(
      'SELECT amount_cents, currency_code FROM restaurant_payouts WHERE id = $1',
      [req.params.payoutId]
    );
    if (!amountRows.length) {
      throw new AppError('Payout not found', 404, 'payout_not_found');
    }
    // ADM-113: single-admin approval moves arbitrary sums via Stripe
    // Transfer; require a fresh step-up challenge, bound to this payout's
    // amount so a challenge issued for one payout cannot approve another.
    await verifyStepupChallenge({
      challengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
      actorUserId: req.user?.id || null,
      actionType: 'restaurant_payout_approve',
      code: req.body?.stepupCode || req.body?.stepup_code,
      ...(Number.isSafeInteger(Number(amountRows[0].amount_cents)) && Number(amountRows[0].amount_cents) > 0
        ? { expectedAmountCents: Number(amountRows[0].amount_cents) }
        : {}),
    });
    const { requestMoneyMovementApproval } = require('../services/dualApprovalService');
    const { sendMoneyMovementGateResult } = require('../utils/dualApprovalHttp');
    const reviewNote = req.body.reviewNote || req.body.review_note;
    const gate = await requestMoneyMovementApproval({
      movementType: 'restaurant_payout',
      referenceKey: `restaurant-payout:${req.params.payoutId}`,
      amountCents: Number(amountRows[0].amount_cents),
      currencyCode: amountRows[0].currency_code || 'USD',
      requestedBy: req.user.id,
      idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey || `restaurant-payout-approve-${req.params.payoutId}`,
      payload: {
        payoutId: req.params.payoutId,
        reviewNote: reviewNote || null,
        makerAdminId: req.user.id,
      },
    });
    if (gate.queued) {
      return sendMoneyMovementGateResult(res, gate);
    }
    const payout = await payoutService.approvePayout({
      payoutId: req.params.payoutId,
      adminUserId: req.user.id,
      reviewNote,
    });
    res.json({ payout });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/restaurant-payouts/stepup-challenges
 * Issue a step-up challenge for approving a payout. Scoped to the same
 * manage_financials gate as the approve endpoint because the super-admin
 * challenge route is not reachable by non-super-admin approvers.
 */
exports.issueApproveStepupChallenge = async (req, res, next) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) throw new AppError('Unauthorized.', 401, 'unauthorized');
    // Auth audit item 6: issue for the payout's real amount, not 1. The
    // body carries payoutId; a missing id or row fails closed so a
    // challenge can never be issued without a payout to bind it to.
    const payoutId = req.body?.payoutId || req.body?.payout_id;
    if (!payoutId) throw new AppError('Payout id is required.', 400, 'payout_id_required');
    const { rows: payoutRows } = await db.query(
      'SELECT amount_cents, currency_code FROM restaurant_payouts WHERE id = $1',
      [payoutId]
    );
    if (!payoutRows.length) throw new AppError('Payout not found', 404, 'payout_not_found');
    const issueAmount = Number(payoutRows[0].amount_cents);
    if (!Number.isSafeInteger(issueAmount) || issueAmount <= 0) {
      throw new AppError('Payout has no amount to bind the challenge to.', 409, 'payout_amount_invalid');
    }
    const { challenge, delivery } = await issueStepupChallenge({
      actorUserId: adminId,
      actorEmail: req.user?.email,
      actionType: 'restaurant_payout_approve',
      amountCents: issueAmount,
      currencyCode: payoutRows[0].currency_code || 'USD',
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
};

exports.reject = async (req, res, next) => {
  try {
    const payout = await payoutService.rejectPayout({
      payoutId: req.params.payoutId,
      adminUserId: req.user.id,
      reviewNote: req.body.reviewNote || req.body.review_note,
    });
    res.json({ payout });
  } catch (err) {
    next(err);
  }
};
