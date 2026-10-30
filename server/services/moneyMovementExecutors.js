'use strict';

/**
 * Dual-approval executors for the five money rails (ADM-016).
 *
 * Each executor re-runs the rail's money movement after the second admin
 * approves. Executors are idempotent: they replay the same idempotency keys
 * the maker used, so a crash between execution and the decision commit (or
 * a retried approval) cannot double-move money. Requires inside executor
 * bodies are lazy so this module never creates a load-time require cycle.
 */

const { registerMoneyMovementExecutor } = require('./dualApprovalService');
const { logAdminAction } = require('./auditService');
const logger = require('../utils/logger');

let registered = false;

function registerMoneyMovementExecutors() {
  if (registered) return;
  registered = true;

  registerMoneyMovementExecutor('food_refund', async ({ payload, client }) => {
    const { executeFoodOrderRefund } = require('../controllers/adminFoodOrdersController');
    return executeFoodOrderRefund(client, {
      req: { user: { id: payload.makerAdminId }, ip: null }, orderId: payload.orderId,
      requestedAmount: payload.amountCents, reason: payload.reason, skipDualApproval: true,
      expectedRefundedCents: payload.expectedRefundedCents,
    });
  });

  registerMoneyMovementExecutor('agent_food_refund', async ({ payload, client }) => {
    const { executeAgentFoodRefund, notifyAgentFoodRefund } = require('../controllers/agentFoodRefundActions');
    const result = await executeAgentFoodRefund(client, {
      req: { user: { id: payload.makerAdminId }, ip: null }, orderId: payload.orderId,
      reason: payload.reason, skipDualApproval: true, expectedAmountCents: payload.expectedAmountCents,
      requestIdempotencyKey: `agent-food-refund:${payload.orderId}`,
    });
    const summary = { orderId: payload.orderId, refunded: true, alreadyRefunded: result.replayed };
    Object.defineProperty(summary, 'afterCommit', { value: () => notifyAgentFoodRefund(result, payload.orderId) });
    return summary;
  });

  // ── job_refund: manual job refunds (superAdminController.issueManualRefund)
  registerMoneyMovementExecutor('job_refund', async ({ payload, approverId }) => {
    const { processPaymentRefund } = require('./paymentRefundService');
    const result = await processPaymentRefund({
      paymentId: payload.paymentId,
      requestedAmountCents: payload.amountCents,
      fullRefund: payload.fullRefund === true,
      reason: payload.reason,
      actorUserId: payload.makerAdminId,
      requestId: payload.requestId,
      skipDualApproval: true,
    });
    const refundCents = Number(result.attempt?.amount_cents);
    try {
      await logAdminAction({
        adminId: approverId,
        action: 'manual_refund_issued',
        targetType: 'payment',
        targetId: String(payload.paymentId),
        description:
          `Dual-approved manual refund for job ${payload.jobId}: ${payload.reason} ` +
          `(requested by ${payload.makerAdminId}, approved by ${approverId})`,
        before: { status: 'pending_approval' },
        after: {
          refund_cents: refundCents,
          stripe_refund_id: result.attempt?.stripe_refund_id || null,
          request_id: payload.requestId,
          requested_by: payload.makerAdminId,
          approved_by: approverId,
        },
      });
    } catch (e) {
      logger.error('job_refund executor audit write failed AFTER refund issued', {
        paymentId: payload.paymentId,
        approverId,
        error: e.message,
      });
    }
    return {
      refundId: result.attempt?.stripe_refund_id || null,
      refundCents,
      paymentId: payload.paymentId,
      requestId: payload.requestId,
    };
  });

  // ── marketplace_refund: admin marketplace order refunds
  registerMoneyMovementExecutor('marketplace_refund', async ({ payload, approverId }) => {
    const { processMarketplaceRefund } = require('./marketplaceRefundService');
    const result = await processMarketplaceRefund({
      orderId: payload.orderId,
      requestedAmountCents: payload.requestedAmountCents,
      fullRefund: payload.fullRefund === true,
      reason: payload.reason,
      actorUserId: payload.makerAdminId,
      requestId: payload.requestId,
      skipDualApproval: true,
    });
    try {
      await logAdminAction({
        adminId: approverId,
        action: 'marketplace_refund_issued',
        targetType: 'marketplace_order',
        targetId: String(payload.orderId),
        description:
          `Dual-approved marketplace refund for order ${payload.orderId}: ${payload.reason} ` +
          `(requested by ${payload.makerAdminId}, approved by ${approverId})`,
        before: { status: 'pending_approval' },
        after: {
          refund_cents: Number(result.refund?.amount_cents),
          stripe_refund_id: result.refund?.provider_refund_id || null,
          requested_by: payload.makerAdminId,
          approved_by: approverId,
        },
      });
    } catch (e) {
      logger.error('marketplace_refund executor audit write failed AFTER refund issued', {
        orderId: payload.orderId,
        approverId,
        error: e.message,
      });
    }
    return {
      refundId: result.refund?.provider_refund_id || null,
      refundCents: Number(result.refund?.amount_cents),
      orderId: payload.orderId,
    };
  });

  // ── dispute_refund: dispute resolutions that refund the customer
  registerMoneyMovementExecutor('dispute_refund', async ({ payload, approverId }) => {
    const disputeAdminController = require('../controllers/disputeAdminController');
    const outcome = await disputeAdminController.executeDisputeResolution({
      disputeId: payload.disputeId,
      resolution: payload.resolution,
      refundCents: payload.refundCents,
      notes: payload.notes,
      adminId: payload.makerAdminId,
      paymentId: payload.paymentId,
      skipDualApproval: true,
    });
    if (outcome.dualApproval || outcome.reconciliationPending) {
      throw new Error('Dispute refund executor did not complete the resolution.');
    }
    try {
      await logAdminAction({
        adminId: approverId,
        action: 'dispute_refund_dual_approved',
        targetType: 'dispute',
        targetId: String(payload.disputeId),
        description:
          `Dual-approved dispute ${payload.disputeId} resolution (${payload.resolution}) ` +
          `with ${payload.refundCents}c refund (requested by ${payload.makerAdminId}, approved by ${approverId})`,
        before: { status: 'pending_approval' },
        after: { status: 'resolved', resolution: payload.resolution, approved_by: approverId },
      });
    } catch (e) {
      logger.error('dispute_refund executor audit write failed', {
        disputeId: payload.disputeId,
        approverId,
        error: e.message,
      });
    }
    return {
      disputeId: payload.disputeId,
      resolution: payload.resolution,
      refundCents: payload.refundCents,
    };
  });

  // ── restaurant_payout: restaurant wallet-earnings payouts
  registerMoneyMovementExecutor('restaurant_payout', async ({ payload, approverId }) => {
    const payoutService = require('./restaurantPayoutService');
    const payout = await payoutService.approvePayout({
      payoutId: payload.payoutId,
      adminUserId: approverId,
      reviewNote: payload.reviewNote || null,
    });
    try {
      await logAdminAction({
        adminId: approverId,
        action: 'restaurant_payout_dual_approved',
        targetType: 'restaurant_payout',
        targetId: String(payload.payoutId),
        description:
          `Dual-approved restaurant payout ${payload.payoutId} ` +
          `(requested by ${payload.makerAdminId}, approved by ${approverId})`,
        before: { status: 'pending_approval' },
        after: { status: payout?.status || 'approved', approved_by: approverId },
      });
    } catch (e) {
      logger.error('restaurant_payout executor audit write failed', {
        payoutId: payload.payoutId,
        approverId,
        error: e.message,
      });
    }
    return { payoutId: payload.payoutId, status: payout?.status || 'approved' };
  });

  // ── affiliate_payout: affiliate Stripe Connect transfers
  registerMoneyMovementExecutor('affiliate_payout', async ({ approval, payload, approverId }) => {
    const affiliatePayoutsController = require('../controllers/affiliatePayoutsController');
    const updated = await affiliatePayoutsController.runAffiliatePayout({
      payoutId: payload.payoutId,
      adminId: approverId,
      req: null,
      skipDualApproval: true,
      // Pentest fix (TOCTOU): bind the execution to the amount the maker
      // queued. Approvals queued before expectedAmountCents existed fall
      // back to the amount stored on the approval row itself.
      expectedAmountCents: payload.expectedAmountCents != null
        ? Number(payload.expectedAmountCents)
        : (approval?.amount_cents != null ? Number(approval.amount_cents) : null),
    });
    return {
      payoutId: payload.payoutId,
      status: updated?.status || 'completed',
      transferId: updated?.payout_reference || null,
    };
  });

  // ── restaurant_topup_clawback: chargeback debit of a succeeded top-up.
  // The service debit is idempotent per top-up (the
  // restaurant-topup-clawback idempotency key), so a retried executor
  // after a crash cannot double-debit.
  registerMoneyMovementExecutor('restaurant_topup_clawback', async ({ payload, approverId }) => {
    const topupService = require('./restaurantTopupService');
    const result = await topupService.clawbackTopup({
      topupId: payload.topupId,
      adminId: approverId,
      reason: payload.reason || 'Chargeback clawback (dual-approved)',
    });
    return {
      topupId: payload.topupId,
      status: 'clawed_back',
      clawback: result || null,
    };
  });

  logger.info('[dualApproval] money movement executors registered');
}

module.exports = { registerMoneyMovementExecutors };
