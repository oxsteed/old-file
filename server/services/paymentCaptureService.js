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
    { stripeAccount: payment.stripe_account_id },
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

module.exports = { captureAuthorizedPayment };
