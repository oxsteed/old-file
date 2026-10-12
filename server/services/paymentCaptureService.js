/**
 * Shared Tier-3 payment capture: Stripe PaymentIntent.capture + DB update.
 * Used by the API (synchronous path) and optional worker (async path).
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * @param {{ paymentId: number|string, jobId?: number|string, amount: number }} params
 * @returns {Promise<{ success: boolean, paymentId: any, chargeId?: string|null }>}
 */
async function captureAuthorizedPayment({ paymentId, jobId, amount }) {
  const paymentResult = await pool.query(
    'SELECT id, stripe_payment_intent_id, stripe_account_id, status FROM payments WHERE id = $1',
    [paymentId],
  );

  if (paymentResult.rows.length === 0) {
    throw new Error(`Payment not found: ${paymentId}`);
  }

  const payment = paymentResult.rows[0];
  if (payment.status !== 'authorized') {
    throw new Error(`Payment ${paymentId} is not in authorized state (current: ${payment.status})`);
  }
  if (!payment.stripe_payment_intent_id) {
    throw new Error(`No PaymentIntent for payment ${paymentId}`);
  }
  if (!payment.stripe_account_id) {
    throw new Error(`No Stripe account for payment ${paymentId}`);
  }

  const captured = await stripe.paymentIntents.capture(
    payment.stripe_payment_intent_id,
    { amount_to_capture: Math.round(Number(amount) * 100) },
    {
      stripeAccount: payment.stripe_account_id,
      // Capture retries must address the same Stripe operation. The payment
      // row is the durable business identity, so this key remains stable
      // across HTTP retries and worker restarts.
      idempotencyKey: `payment-capture:${payment.id}`,
    },
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
  if (!paymentRow.stripe_payment_intent_id || !paymentRow.stripe_account_id) {
    throw new Error('Payment missing Stripe identifiers');
  }

  // Audit fix: verify with Stripe that the PaymentIntent is actually in
  // requires_capture state before capturing. Don't trust the DB status alone.
  const pi = await stripe.paymentIntents.retrieve(
    paymentRow.stripe_payment_intent_id,
    { stripeAccount: paymentRow.stripe_account_id }
  );
  if (pi.status !== 'requires_capture') {
    throw new Error(`PaymentIntent ${pi.id} is ${pi.status}, not requires_capture. Cannot capture.`);
  }

  const captured = await stripe.paymentIntents.capture(
    paymentRow.stripe_payment_intent_id,
    { amount_to_capture: Math.round(Number(paymentRow.amount) * 100) },
    {
      stripeAccount: paymentRow.stripe_account_id,
      idempotencyKey: `payment-capture:${paymentRow.id}`,
    },
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
      RETURNING id, amount, stripe_payment_intent_id, stripe_account_id, status`,
    [row.id, row.status],
  );
  if (!updated.rows[0]) return null;
  logger.warn('Payment authorization reconciled from Stripe (Connect webhook missing or late)', {
    paymentId: row.id, jobId, paymentIntentId: row.stripe_payment_intent_id,
  });
  return updated.rows[0];
}

module.exports = { captureAuthorizedPayment, captureAuthorizedPaymentWithClient, reconcileJobAuthorizationFromStripe };
