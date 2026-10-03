'use strict';

/**
 * Agent food-order refunds.
 *
 * POST /agent/food-orders/:id/refund (grant-gated: issue_refunds)
 *
 * Support-console refund for a single food order. The money behavior depends
 * on the order's canonical payment method (food_orders.metadata.paymentMode):
 *
 * - restaurant_credit: re-credits the customer's restaurant wallet via
 *   refundWalletDebitForReference (the exact inverse of the placement debit).
 *   Rail convention: the wallet write fails OPEN when the credit rail is
 *   disabled (the central-journal mirror is queued in
 *   credit_dual_posting_backfill in the same transaction and replayed when
 *   the rail is re-enabled), and fails CLOSED on a frozen rail. Inherited
 *   from the existing wallet path; this endpoint adds no new rail policy.
 * - oxsteed_credit: re-credits via refundCreditForReferenceInTransaction, the
 *   standard credit posting path. Rail convention: credit refunds settle an
 *   existing customer obligation, so they post directly to the journal
 *   WITHOUT the rail-enabled gate, exactly like the kitchen order-status
 *   refund path (foodController.updateOrderStatus) and the chat credit
 *   refunds. A disabled rail must not strand customer money; new
 *   money-initiation paths stay rail-gated elsewhere.
 * - direct_payment / pay_at_restaurant: NOTHING is returned automatically.
 *   The order is marked refunded with a "manual settlement required"
 *   operator note. No silent partials, no fake money movement.
 * - pay_now (card): rejected. Card refunds ride the existing kitchen
 *   Stripe-refund path; the agent console does not issue them.
 *
 * Fail-closed: the order row is updated only AFTER the re-credit succeeds,
 * inside the same transaction. If the re-credit cannot complete, the whole
 * transaction rolls back and the order is NOT marked refunded.
 *
 * Idempotency: the order row is locked (FOR UPDATE) and its status/payment
 * state is checked first, so a repeated call returns a clean non-error
 * without double-crediting. The underlying services are also idempotent:
 * the wallet refund is deduped by ledger lookup, and the OxSteed credit
 * refund reuses the kitchen path's journal idempotency key
 * (food-order:<id>:oxsteed-credit-refund), so a kitchen refund and an agent
 * refund for the same order can never double-credit.
 *
 * Audit: every attempt that mutates the order writes an admin_audit_log row
 * via logAdminAction with the transaction client, so the mutation and its
 * audit row commit or roll back together (fail-closed audit).
 *
 * No migration: refund metadata is stamped into food_orders.metadata
 * (JSONB), which already carries paymentMode. Migration 660 is unused and
 * intentionally not consumed.
 */

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const logger = require('../utils/logger');
const { refundWalletDebitForReference } = require('../services/foodWalletService');
const { refundCreditForReferenceInTransaction } = require('../services/oxsteedCreditService');
const { recordWalletCreditRefundForOrder } = require('../services/restaurantPosPaymentLedgerService');
const { logAdminAction } = require('../services/auditService');

// Canonical payment modes, mirroring FOOD_PAYMENT_MODE_ALIASES in
// foodController.js (including legacy aliases found on older order rows).
const PAYMENT_MODE_ALIASES = {
  pay_at_counter: 'pay_at_restaurant',
  pay_at_restaurant: 'pay_at_restaurant',
  wallet_credit: 'restaurant_credit',
  restaurant_credit: 'restaurant_credit',
  oxsteed_credit: 'oxsteed_credit',
  oxsteedCredit: 'oxsteed_credit',
  credit: 'oxsteed_credit',
  pay_now: 'pay_now',
  direct: 'direct_payment',
  direct_payment: 'direct_payment',
  off_platform: 'direct_payment',
};

// Target order status per current status, mirroring ORDER_TRANSITIONS in
// foodController.js (refunded is only reachable from completed/cancelled).
const REFUND_TARGET_STATUS = {
  received: 'cancelled',
  accepted: 'cancelled',
  preparing: 'cancelled',
  ready: 'cancelled',
  completed: 'refunded',
  cancelled: 'refunded',
};

function parsePositiveInt(value) {
  const n = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function normalizePaymentMode(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return PAYMENT_MODE_ALIASES[trimmed] || null;
}

function readPaymentMode(order) {
  const metadata = order.metadata && typeof order.metadata === 'object' ? order.metadata : {};
  return normalizePaymentMode(metadata.paymentMode || metadata.payment_mode);
}

async function refundFoodOrder(req, res, next) {
  try {
    const orderId = parsePositiveInt(req.params.id);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const requestIdempotencyKey = typeof req.get('Idempotency-Key') === 'string'
      ? req.get('Idempotency-Key').trim().slice(0, 160)
      : (typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim().slice(0, 160) : null);

    if (!orderId) throw new AppError('Invalid food order id', 400, 'invalid_order_id');
    if (!reason) {
      throw new AppError('A reason is required to refund a food order', 400, 'refund_reason_required');
    }
    if (reason.length > 1000) {
      throw new AppError('Refund reason is too long', 400, 'refund_reason_too_long');
    }

    const result = await withTransaction(pool, async (client) => {
      const { rows: [order] } = await client.query(
        'SELECT * FROM food_orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );
      if (!order) throw new AppError('Food order not found', 404, 'food_order_not_found');

      // Idempotency via state check: an already-refunded order returns a clean
      // non-error and never touches money again.
      if (order.status === 'refunded' || order.payment_status === 'refunded') {
        return {
          replayed: true,
          order,
          paymentMethod: readPaymentMode(order),
        };
      }

      const paymentMethod = readPaymentMode(order);
      if (!paymentMethod) {
        throw new AppError(
          'This order has no recorded payment method, so the refund cannot be routed',
          422,
          'refund_payment_mode_unknown'
        );
      }
      const targetStatus = REFUND_TARGET_STATUS[order.status];
      if (!targetStatus) {
        throw new AppError(
          `Orders in status '${order.status}' cannot be refunded from the agent console`,
          409,
          'refund_invalid_order_status'
        );
      }

      const totalCents = Math.max(0, Math.round(Number(order.total_cents || 0)));
      const currencyCode = typeof order.currency_code === 'string' && order.currency_code.trim()
        ? order.currency_code.trim().toUpperCase().slice(0, 3)
        : 'USD';
      const beforeState = {
        status: order.status,
        payment_status: order.payment_status,
        payment_method: paymentMethod,
        total_cents: totalCents,
        currency_code: currencyCode,
      };

      // money: { kind, ... } where kind is restaurant_credit | oxsteed_credit | manual.
      // Any throw below rolls the transaction back: the order is NEVER marked
      // refunded unless the re-credit actually landed.
      let money;
      if (paymentMethod === 'restaurant_credit') {
        if (!order.customer_id) {
          throw new AppError(
            'This restaurant-credit order has no customer wallet to re-credit; settle it manually',
            422,
            'refund_wallet_no_customer'
          );
        }
        const refundResult = await refundWalletDebitForReference(client, {
          restaurantId: order.restaurant_id,
          customerId: order.customer_id,
          currencyCode,
          orderReferenceId: String(order.id),
          description: `Agent refund for food order #${order.id}`,
          createdByUserId: req.user?.id || null,
          correlationId: `agent-food-refund:${order.id}`,
          actorType: 'admin',
          metadata: {
            orderId: order.id,
            agentRefund: true,
            reason: reason.slice(0, 500),
          },
        });
        if (!refundResult.refunded) {
          // Fail closed: refundWalletDebitForReference reports (rather than
          // throws) when the original debit is missing. Never mark the order
          // refunded when no money moved.
          throw new AppError(
            refundResult.reason === 'debit_not_found'
              ? 'No restaurant-credit debit was found for this order, so nothing was re-credited'
              : 'The restaurant-credit re-credit could not be completed',
            409,
            'refund_wallet_failed',
            { walletReason: refundResult.reason || null }
          );
        }
        const entry = refundResult.entry || {};
        const amountCents = Math.round(Number(entry.amount_cents || 0));
        const balanceAfterCents = entry.balance_after_cents == null ? null : Number(entry.balance_after_cents);
        // Keep the restaurant POS payment ledger consistent, mirroring the
        // kitchen refund path (same idempotency key, so the two paths dedupe).
        await recordWalletCreditRefundForOrder(client, {
          restaurantId: order.restaurant_id,
          orderId: order.id,
          amountCents,
          currencyCode,
          walletAccountId: refundResult.account?.id || entry.account_id || null,
          walletRefundLedgerEntryId: entry.id || null,
          walletOriginalLedgerEntryId: entry.metadata?.originalDebitEntryId || null,
          walletBalanceAfterCents: balanceAfterCents,
          idempotencyKey: `food-order:${order.id}:wallet-credit-refund`,
          createdByUserId: req.user?.id || null,
          metadata: { agentRefund: true, refundReason: reason.slice(0, 500) },
        });
        money = {
          kind: 'restaurant_credit',
          amountCents,
          currencyCode: entry.currency_code || currencyCode,
          ledgerEntryId: entry.id != null ? String(entry.id) : null,
          balanceAfterCents,
          balanceBeforeCents: balanceAfterCents != null ? balanceAfterCents - amountCents : null,
        };
      } else if (paymentMethod === 'oxsteed_credit') {
        if (!order.customer_id) {
          throw new AppError(
            'This OxSteed-credit order has no customer account to re-credit; settle it manually',
            422,
            'refund_credit_no_customer'
          );
        }
        if (totalCents <= 0) {
          throw new AppError(
            'This order has a zero total, so there is nothing to refund',
            422,
            'refund_zero_total'
          );
        }
        const refundResult = await refundCreditForReferenceInTransaction(client, {
          referenceType: 'food_order',
          referenceId: String(order.id),
          amountCents: totalCents,
          // Shared with the kitchen order-status refund path: if the kitchen
          // already refunded this order, the journal replays instead of
          // double-crediting.
          idempotencyKey: `food-order:${order.id}:oxsteed-credit-refund`,
          actorUserId: req.user?.id || null,
          actorType: 'admin',
          reason,
          correlationId: `agent-food-refund:${order.id}`,
          requestIp: req.ip || null,
          metadata: {
            orderId: order.id,
            agentRefund: true,
            restaurantId: order.restaurant_id,
          },
        });
        money = {
          kind: 'oxsteed_credit',
          amountCents: totalCents,
          currencyCode,
          transactionId: refundResult?.transaction?.id != null ? String(refundResult.transaction.id) : null,
          replayed: Boolean(refundResult?.replayed),
        };
      } else if (paymentMethod === 'pay_at_restaurant' || paymentMethod === 'direct_payment') {
        // No automatic money movement exists for these methods: the payment
        // happened (or will happen) outside the platform. Mark refunded and
        // leave settlement to the operator. Never a silent partial, never a
        // fake money movement.
        money = {
          kind: 'manual',
          amountCents: totalCents,
          currencyCode,
          manualSettlementRequired: true,
          operatorNote: paymentMethod === 'pay_at_restaurant'
            ? 'Marked refunded. Manual settlement required: this order was set to pay at the restaurant, so no money moved automatically. Settle with the customer and the restaurant out of band.'
            : 'Marked refunded. Manual settlement required: this order was paid directly (off platform), so no money moved automatically. Settle with the customer out of band.',
        };
      } else if (paymentMethod === 'pay_now') {
        throw new AppError(
          'Card (pay_now) food orders are refunded through the restaurant card-refund flow, not the agent console',
          422,
          'refund_pay_now_unsupported'
        );
      } else {
        throw new AppError(
          `Payment method '${paymentMethod}' is not supported for agent food refunds`,
          422,
          'refund_payment_mode_unsupported'
        );
      }

      const metadata = order.metadata && typeof order.metadata === 'object' ? { ...order.metadata } : {};
      metadata.agentRefund = {
        at: new Date().toISOString(),
        by: req.user?.id || null,
        reason: reason.slice(0, 500),
        paymentMethod,
        amountCents: money.amountCents,
        manualSettlementRequired: money.kind === 'manual',
        operatorNote: money.operatorNote || null,
        requestIdempotencyKey: requestIdempotencyKey || null,
      };

      const { rows: [updated] } = await client.query(
        `UPDATE food_orders
            SET status = $1,
                payment_status = $2,
                metadata = $3::jsonb,
                updated_at = NOW()
          WHERE id = $4
          RETURNING *`,
        [targetStatus, 'refunded', JSON.stringify(metadata), order.id]
      );

      const afterState = {
        status: updated.status,
        payment_status: updated.payment_status,
        payment_method: paymentMethod,
        total_cents: totalCents,
        currency_code: currencyCode,
        ...(money.balanceBeforeCents != null ? { wallet_balance_before_cents: money.balanceBeforeCents } : {}),
        ...(money.balanceAfterCents != null ? { wallet_balance_after_cents: money.balanceAfterCents } : {}),
      };

      // Fail-closed audit: passing the transaction client makes logAdminAction
      // throw on failure, so the mutation and its audit row commit or roll
      // back together.
      await logAdminAction({
        client,
        adminId: req.user?.id || null,
        action: 'agent_food_order_refund',
        targetType: 'food_order',
        targetId: String(order.id),
        description: `Agent refunded food order #${order.id} (${paymentMethod}, ${money.amountCents} ${currencyCode}): ${reason.slice(0, 200)}`,
        req,
        before: beforeState,
        after: afterState,
      });

      return { replayed: false, order: updated, paymentMethod, money, beforeState, afterState };
    }, 'agent_food_order_refund');

    if (result.replayed) {
      return res.json({
        success: true,
        data: {
          orderId,
          refunded: true,
          alreadyRefunded: true,
          orderStatus: result.order.status,
          paymentStatus: result.order.payment_status,
          paymentMethod: result.paymentMethod,
        },
      });
    }

    logger.info('Agent food order refund completed', {
      orderId,
      adminId: req.user?.id || null,
      paymentMethod: result.paymentMethod,
      amountCents: result.money.amountCents,
      manual: result.money.kind === 'manual',
    });

    return res.json({
      success: true,
      data: {
        orderId,
        refunded: true,
        alreadyRefunded: false,
        orderStatus: result.order.status,
        paymentStatus: result.order.payment_status,
        paymentMethod: result.paymentMethod,
        amountCents: result.money.amountCents,
        currencyCode: result.money.currencyCode,
        manualSettlementRequired: result.money.kind === 'manual',
        operatorNote: result.money.operatorNote || null,
        walletLedgerEntryId: result.money.ledgerEntryId || null,
        creditTransactionId: result.money.transactionId || null,
        reason,
      },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { refundFoodOrder };
