/**
 * Shared Tier-3 payment capture: Stripe PaymentIntent.capture + DB update.
 * Used by the API (synchronous path) and optional worker (async path).
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const Stripe = require('stripe');

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
 * @param {{ paymentId: number|string, jobId?: number|string, amount: number }} params
 * @returns {Promise<{ success: boolean, paymentId: any, chargeId?: string|null }>}
 */
async function captureAuthorizedPayment({ paymentId, jobId, amount }) {
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
    const settled = await withTransaction(pool, (client) => settlePlatformHold(client, { ...payment, amount: amount ?? payment.amount }));
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
 */
async function captureAuthorizedPaymentWithClient(client, paymentRow) {
  if (!paymentRow || paymentRow.status !== 'authorized') {
    throw new Error('Invalid payment row for capture');
  }
  assertNoPendingIncrease(paymentRow);
  const model = chargeModel.modelOf(paymentRow);
  if (!paymentRow.stripe_payment_intent_id || (model === 'direct' && !paymentRow.stripe_account_id)) {
    throw new Error('Payment missing Stripe identifiers');
  }
  if (model === 'platform_hold') return settlePlatformHold(client, paymentRow);

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

  logger.info('Payment captured (in job transaction)', {
    paymentId: paymentRow.id,
    chargeId: captured.charges?.data?.[0]?.id,
  });

  return { paymentId: paymentRow.id, chargeId: captured.charges?.data?.[0]?.id || null };
}

/**
 * platform_hold payments were charged up front and the money sits on the
 * platform. Completion pays the helper with a Transfer (net of the platform
 * fee) tied to the original charge, and refunds anything a change order
 * removed. Idempotent per payment row.
 */
async function settlePlatformHold(client, paymentRow) {
  if (!paymentRow.destination_account_id) throw new Error('Platform-held payment has no helper account');
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

module.exports = { settlePlatformHold, captureAuthorizedPayment, captureAuthorizedPaymentWithClient, captureCents, assertNoPendingIncrease };
