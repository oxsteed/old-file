const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');
const { calculatePlatformFee } = require('./feeService');

/**
 * Issue a refund for a payment intent.
 * Supports full or partial refund.
 */
exports.issueRefund = async (paymentIntentId, amount = null) => {
  try {
    const refundData = { payment_intent: paymentIntentId };
    if (amount) refundData.amount = amount;
    const refund = await stripe.refunds.create(refundData);
    console.log(`[Stripe] Refund issued: ${refund.id} for intent ${paymentIntentId}`);
    return refund;
  } catch (err) {
    console.error(`[Stripe] issueRefund failed for intent ${paymentIntentId}:`, err.message);
    throw err;
  }
};

/**
 * Release escrow - transfer funds to helper's connected account.
 * Platform fee is calculated dynamically via feeService (not hardcoded).
 */
exports.releaseEscrow = async (jobId) => {
  try {
    const { rows } = await db.query(
      `SELECT j.final_price, j.payment_intent_id,
              j.assigned_helper_id, j.plan_slug,
              ca.stripe_account_id
       FROM jobs j
       JOIN connect_accounts ca ON ca.user_id = j.assigned_helper_id
       WHERE j.id = $1`,
      [jobId]
    );
    if (!rows.length) throw new Error(`Job ${jobId} or connect account not found`);

    const { final_price, payment_intent_id, stripe_account_id, plan_slug } = rows[0];

    // Use live fee rate from feeService — not hardcoded
    const platformFeeDecimal = calculatePlatformFee(1, false, plan_slug || 'starter');
    const platformFee = Math.round(final_price * platformFeeDecimal * 100);
    const transferAmount = Math.round(final_price * 100) - platformFee;

    if (transferAmount <= 0) {
      throw new Error(`Transfer amount is ${transferAmount} cents — cannot transfer`);
    }

    const transfer = await stripe.transfers.create({
      amount: transferAmount,
      currency: 'usd',
      destination: stripe_account_id,
      source_transaction: payment_intent_id,
    });

    console.log(`[Stripe] Escrow released for job ${jobId}: transfer ${transfer.id}, amount ${transferAmount} cents`);
    return transfer;
  } catch (err) {
    console.error(`[Stripe] releaseEscrow failed for job ${jobId}:`, err.message);
    throw err;
  }
};
