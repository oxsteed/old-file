const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');

/**
 * Issue a refund for a payment intent
 */
exports.issueRefund = async (paymentIntentId, amount = null) => {
  const refundData = { payment_intent: paymentIntentId };
  if (amount) refundData.amount = amount;
  return stripe.refunds.create(refundData);
};

/**
 * Release escrow - transfer funds to helper's connected account
 */
exports.releaseEscrow = async (jobId) => {
  const { rows } = await db.query(
    `SELECT j.final_price, j.payment_intent_id,
            ca.stripe_account_id
     FROM jobs j
     JOIN connect_accounts ca ON ca.user_id = j.assigned_helper_id
     WHERE j.id = $1`,
    [jobId]
  );
  if (!rows.length) throw new Error('Job or connect account not found');
  const { final_price, payment_intent_id, stripe_account_id } = rows[0];
  const platformFee = Math.round(final_price * 0.15 * 100);
  const transferAmount = Math.round(final_price * 100) - platformFee;
  return stripe.transfers.create({
    amount: transferAmount,
    currency: 'usd',
    destination: stripe_account_id,
    source_transaction: payment_intent_id
  });
};
