/**
 * Shared Tier-3 payment capture: Stripe PaymentIntent.capture + DB update.
 * Used by the API (synchronous path) and optional worker (async path).
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const Stripe = require('stripe');
const { logAdminAction } = require('./auditService');

// P3-11-F13: escrow captures move real money but had no audit trail. The
// capture can be triggered by the job completer (API), the payer (manual
// capture endpoint) or the payment worker (system); when no human actor is
// available the sentinel system user (migration 812) is recorded.
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Fail-closed audit of a Tier-3 escrow capture. Called with the caller's
 * transaction client so the audit row and the capture commit or roll back
 * together; a dropped audit row rolls the capture back.
 */
async function auditPaymentCapture(client, { payment, actorUserId, chargeId = null, transferId = null, jobId = null }) {
  await logAdminAction({
    client,
    adminId: actorUserId || SYSTEM_ACTOR_ID,
    action: 'tier3_escrow_captured',
    targetType: 'payment',
    targetId: String(payment.id),
    description: `Tier-3 escrow captured for payment ${payment.id} (${payment.amount} ${payment.currency || 'usd'})`,
    before: { status: 'authorized' },
    after: {
      status: 'captured',
      amount: payment.amount,
      currency: payment.currency || 'usd',
      job_id: jobId != null ? String(jobId) : null,
      charge_id: chargeId,
      transfer_id: transferId,
      charge_model: payment.charge_model || null,
    },
  });
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const chargeModel = require('./stripeChargeModel');
const { currencyExponent } = require('../validation/money');

/**
 * Approved change orders can lower what may be captured
 * (payments.capture_amount_cents). Never capture more than either the row's
 * amount or that ceiling.
 */
/**
 * A change order raised the price above the authorization and the customer
 * has not re-authorized yet: capturing now would under-pay the helper and
 * close the job at the old price.
 */
function assertNoPendingIncrease(payment) {
  if (Number(payment?.pending_increase_cents || 0) > 0) {
    const { AppError } = require('../middleware/errorHandler');
    throw new AppError(
      'The customer must authorize the new price from the approved change order before payment can be captured.',
      409,
      'payment_reauthorization_required'
    );
  }
}

function captureCents(amount, captureAmountCents, currency = 'USD') {
  const fromAmount = Math.round(Number(amount) * (10 ** currencyExponent(currency)));
  const ceiling = captureAmountCents === null || captureAmountCents === undefined ? null : Number(captureAmountCents);
  return Number.isFinite(ceiling) && ceiling > 0 ? Math.min(fromAmount, Math.round(ceiling)) : fromAmount;
}

/**
 * @param {{ paymentId: number|string, jobId?: number|string, amount: number, actorUserId?: string }} params
 * @returns {Promise<{ success: boolean, paymentId: any, chargeId?: string|null }>}
 */
async function captureAuthorizedPayment({ paymentId, jobId, amount, actorUserId = null }) {
  const paymentResult = await pool.query(
    `SELECT id, stripe_payment_intent_id, stripe_account_id, status, capture_amount_cents, pending_increase_cents,
            charge_model, destination_account_id, currency, amount, platform_fee, metadata
       FROM payments WHERE id = $1`,
    [paymentId],
  );

  if (paymentResult.rows.length === 0) {
    throw new Error(`Payment not found: ${paymentId}`);
  }

  const payment = paymentResult.rows[0];
  if (payment.status !== 'authorized') {
    throw new Error(`Payment ${paymentId} is not in authorized state (current: ${payment.status})`);
  }
  assertNoPendingIncrease(payment);
  if (!payment.stripe_payment_intent_id) {
    throw new Error(`No PaymentIntent for payment ${paymentId}`);
  }
  const model = chargeModel.modelOf(payment);
  if (model === 'direct' && !payment.stripe_account_id) {
    throw new Error(`No Stripe account for payment ${paymentId}`);
  }
  if (model === 'platform_hold') {
    const settled = await withTransaction(pool, async (client) => {
      const result = await settlePlatformHold(client, { ...payment, amount: amount ?? payment.amount });
      await auditPaymentCapture(client, {
        payment,
        actorUserId,
        chargeId: result.chargeId,
        transferId: result.transferId,
        jobId,
      });
      return result;
    });
    return { success: true, paymentId, chargeId: settled.chargeId };
  }

  const captured = await stripe.paymentIntents.capture(
    payment.stripe_payment_intent_id,
    { amount_to_capture: captureCents(amount, payment.capture_amount_cents, payment.currency) },
    chargeModel.requestOptions(payment, {
      // Capture retries must address the same Stripe operation. The payment
      // row is the durable business identity, so this key remains stable
      // across HTTP retries and worker restarts.
      idempotencyKey: `payment-capture:${payment.id}`,
    }),
  );

  await withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE payments
       SET status = $1, stripe_charge_id = $2, updated_at = now()
       WHERE id = $3 AND status = 'authorized'`,
      ['captured', captured.charges?.data?.[0]?.id || null, paymentId],
    );
    await auditPaymentCapture(client, {
      payment,
      actorUserId,
      chargeId: captured.charges?.data?.[0]?.id || null,
      jobId,
    });
  });

  logger.info('Payment captured', {
    paymentId,
    jobId,
    chargeId: captured.charges?.data?.[0]?.id,
    amount: captured.amount_received != null ? captured.amount_received / 100 : amount,
  });

  return {
    success: true,
    paymentId,
    chargeId: captured.charges?.data?.[0]?.id || null,
  };
}

/**
 * Capture using an existing transaction client (row must be `authorized`).
 * Used when completing a job so escrow capture rolls back with the job if Stripe fails.
 *
 * @param {import('pg').PoolClient} client
 * @param {{ id: any, amount: number, stripe_payment_intent_id: string, stripe_account_id: string }} paymentRow
 * @param {{ actorUserId?: string }} [options]
 */
async function captureAuthorizedPaymentWithClient(client, paymentRow, { actorUserId = null } = {}) {
  if (!paymentRow || paymentRow.status !== 'authorized') {
    throw new Error('Invalid payment row for capture');
  }
  assertNoPendingIncrease(paymentRow);
  const model = chargeModel.modelOf(paymentRow);
  if (!paymentRow.stripe_payment_intent_id || (model === 'direct' && !paymentRow.stripe_account_id)) {
    throw new Error('Payment missing Stripe identifiers');
  }
  let chargeId = null;
  let transferId = null;
  if (model === 'platform_hold') {
    const settled = await settlePlatformHold(client, paymentRow);
    chargeId = settled.chargeId;
    transferId = settled.transferId;
  } else {
    // Audit fix: verify with Stripe that the PaymentIntent is actually in
    // requires_capture state before capturing. Don't trust the DB status alone.
    const pi = await stripe.paymentIntents.retrieve(
      paymentRow.stripe_payment_intent_id,
      chargeModel.requestOptions(paymentRow)
    );
    if (pi.status !== 'requires_capture') {
      throw new Error(`PaymentIntent ${pi.id} is ${pi.status}, not requires_capture. Cannot capture.`);
    }

    const captured = await stripe.paymentIntents.capture(
      paymentRow.stripe_payment_intent_id,
      { amount_to_capture: captureCents(paymentRow.amount, paymentRow.capture_amount_cents, paymentRow.currency) },
      chargeModel.requestOptions(paymentRow, { idempotencyKey: `payment-capture:${paymentRow.id}` }),
    );

    await client.query(
      `UPDATE payments
       SET status = $1, stripe_charge_id = $2, updated_at = now()
       WHERE id = $3 AND status = 'authorized'`,
      ['captured', captured.charges?.data?.[0]?.id || null, paymentRow.id],
    );
    chargeId = captured.charges?.data?.[0]?.id || null;

    logger.info('Payment captured (in job transaction)', {
      paymentId: paymentRow.id,
      chargeId,
    });
  }

  // P3-11-F13: audit the escrow capture inside the caller's transaction so
  // the capture and its audit row commit or roll back together.
  await auditPaymentCapture(client, {
    payment: paymentRow,
    actorUserId,
    chargeId,
    transferId,
  });

  return { paymentId: paymentRow.id, chargeId };
}

/**
 * Review P3-791: the payment row reaches `authorized` only through the Connect
 * webhook. When that webhook is missing or late, ask Stripe directly: if the
 * job's latest open PaymentIntent is in requires_capture, mark the row
 * authorized (inside the caller's transaction) and return it. Returns null
 * when there is nothing to reconcile.
 */
async function reconcileJobAuthorizationFromStripe(client, jobId) {
  const { rows } = await client.query(
    `SELECT id, amount, stripe_payment_intent_id, stripe_account_id, status
       FROM payments
      WHERE job_id = $1
        AND status IN ('pending', 'requires_payment_method', 'requires_confirmation', 'requires_action', 'processing')
        AND stripe_payment_intent_id IS NOT NULL
        AND stripe_account_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [jobId],
  );
  const row = rows[0];
  if (!row) return null;
  const pi = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id, { stripeAccount: row.stripe_account_id });
  if (pi.status !== 'requires_capture') return null;
  const updated = await client.query(
    `UPDATE payments SET status = 'authorized', updated_at = now()
      WHERE id = $1 AND status = $2
      RETURNING id, amount, stripe_payment_intent_id, stripe_account_id, status, capture_amount_cents, pending_increase_cents,
                charge_model, destination_account_id, currency, metadata`,
    [row.id, row.status],
  );
  if (!updated.rows[0]) return null;
  logger.warn('Payment authorization reconciled from Stripe (Connect webhook missing or late)', {
    paymentId: row.id, jobId, paymentIntentId: row.stripe_payment_intent_id,
  });
  return updated.rows[0];
}
/**
 * platform_hold payments were charged up front and the money sits on the
 * platform. Completion pays the helper with a Transfer (net of the platform
 * fee) tied to the original charge, and refunds anything a change order
 * removed. Idempotent per payment row.
 */
async function settlePlatformHold(client, paymentRow) {
  if (!paymentRow.destination_account_id) throw new Error('Platform-held payment has no helper account');
  // Tier-3 platform-held payments are released with a Stripe Transfer. Keep
  // this gate at the release boundary as well as at intent creation: a helper
  // can lose payout eligibility while a job is in progress. Missing or stale
  // Connect state fails closed so funds remain on the platform for review.
  const { rows: payoutRows } = await client.query(
    `SELECT payouts_enabled
       FROM connect_accounts
      WHERE stripe_account_id = $1
      LIMIT 1`,
    [paymentRow.destination_account_id],
  );
  if (!payoutRows[0]?.payouts_enabled) {
    const { AppError } = require('../middleware/errorHandler');
    throw new AppError(
      'The helper payout account is not enabled. Payouts must be enabled before escrow can be released.',
      409,
      'helper_payouts_not_ready',
    );
  }
  const pi = await stripe.paymentIntents.retrieve(paymentRow.stripe_payment_intent_id);
  if (pi.status !== 'succeeded') {
    throw new Error(`PaymentIntent ${pi.id} is ${pi.status}, not succeeded. Cannot settle platform hold.`);
  }
  const charged = Number(pi.amount_received ?? pi.amount);
  const finalAmount = Math.min(charged, captureCents(paymentRow.amount, paymentRow.capture_amount_cents, paymentRow.currency));
  const meta = typeof paymentRow.metadata === 'string' ? JSON.parse(paymentRow.metadata || '{}') : (paymentRow.metadata || {});
  const feeRatio = charged > 0 ? Number(meta.platform_fee_cents ?? 0) / charged : 0;
  const fee = Math.min(finalAmount, Math.round(finalAmount * feeRatio));
  const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id || pi.charges?.data?.[0]?.id || null;
  if (finalAmount < charged) {
    await stripe.refunds.create(
      { payment_intent: pi.id, amount: charged - finalAmount, reason: 'requested_by_customer' },
      { idempotencyKey: `payment-hold-refund:${paymentRow.id}` },
    );
  }
  let transferId = null;
  if (finalAmount - fee > 0) {
    const transfer = await stripe.transfers.create({
      amount: finalAmount - fee,
      currency: String(pi.currency || paymentRow.currency || 'usd').toLowerCase(),
      destination: paymentRow.destination_account_id,
      ...(chargeId ? { source_transaction: chargeId } : {}),
      transfer_group: pi.transfer_group || undefined,
      metadata: { payment_id: String(paymentRow.id), job_id: String(pi.metadata?.job_id || '') },
    }, { idempotencyKey: `payment-hold-transfer:${paymentRow.id}` });
    transferId = transfer.id;
  }
  await client.query(
    `UPDATE payments
        SET status = 'captured', stripe_charge_id = COALESCE($2, stripe_charge_id), stripe_transfer_id = $3,
            payment_hold_status = 'released', captured_at = NOW(), released_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'authorized'`,
    [paymentRow.id, chargeId, transferId],
  );
  logger.info('Platform-held payment settled', { paymentId: paymentRow.id, transferId, finalAmount, fee });
  return { paymentId: paymentRow.id, chargeId, transferId };
}

module.exports = { settlePlatformHold, captureAuthorizedPayment, captureAuthorizedPaymentWithClient, captureCents, assertNoPendingIncrease, reconcileJobAuthorizationFromStripe };
