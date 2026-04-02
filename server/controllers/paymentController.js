const pool = require('../db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { calculateTier3Fees } = require('../utils/feeCalculator');

/**
 * Payment Controller — Stripe Connect Direct Charges
 *
 * All Tier 3 payments are direct charges on the helper's connected Stripe account.
 * The helper is the merchant of record. OxSteed collects revenue via application_fee.
 * Card processing fees and chargebacks hit the helper's connected account.
 * OxSteed may choose to reverse its application fee in disputes but is not obligated.
 */

// Create Connect account for helper (onboarding)
exports.createConnectAccount = async (req, res) => {
  try {
    const existing = await pool.query('SELECT * FROM connect_accounts WHERE user_id = $1', [req.user.id]);
    if (existing.rows[0]) {
      // Return onboarding link if not complete
      if (!existing.rows[0].onboarding_complete) {
        const link = await stripe.accountLinks.create({
          account: existing.rows[0].stripe_account_id,
          refresh_url: `${process.env.CLIENT_URL}/helper-dashboard?refresh=true`,
          return_url: `${process.env.CLIENT_URL}/helper-dashboard?onboarding=complete`,
          type: 'account_onboarding',
        });
        return res.json({ url: link.url, account_id: existing.rows[0].stripe_account_id });
      }
      return res.json({ message: 'Account already set up', account: existing.rows[0] });
    }

    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: req.user.email,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    });

    await pool.query(
      'INSERT INTO connect_accounts (user_id, stripe_account_id) VALUES ($1, $2)',
      [req.user.id, account.id]
    );

    const link = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${process.env.CLIENT_URL}/helper-dashboard?refresh=true`,
      return_url: `${process.env.CLIENT_URL}/helper-dashboard?onboarding=complete`,
      type: 'account_onboarding',
    });
    res.json({ url: link.url, account_id: account.id });
  } catch (err) {
    console.error('Create connect account error:', err);
    res.status(500).json({ error: 'Failed to create payment account' });
  }
};

// Get Connect account status
exports.getConnectStatus = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM connect_accounts WHERE user_id = $1', [req.user.id]);
    if (!result.rows[0]) return res.json({ connected: false });
    res.json({ connected: true, ...result.rows[0] });
  } catch (err) {
    console.error('Get connect status error:', err);
    res.status(500).json({ error: 'Failed to get account status' });
  }
};

/**
 * Create a direct charge PaymentIntent on the helper's connected Stripe account.
 *
 * Flow:
 *   1. Customer selects a helper for a Tier 3 job.
 *   2. OxSteed creates a PaymentIntent as a DIRECT CHARGE on the helper's account
 *      using `stripe_account` (not `transfer_data.destination`).
 *   3. `application_fee_amount` = base platform fee + tier3 surcharge (+ broker fee).
 *   4. `capture_method: 'manual'` — authorize now, capture after job completion.
 *   5. Stripe processing fees are deducted from the helper's charge.
 *   6. On capture, Stripe pays the helper and sends OxSteed its application_fee.
 */
exports.createPaymentIntent = async (req, res) => {
  try {
    const { job_id } = req.body;

    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].client_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    if (!job.rows[0].job_value) return res.status(400).json({ error: 'No agreed price set' });

    // Get helper's connected Stripe account
    const connect = await pool.query('SELECT * FROM connect_accounts WHERE user_id = $1', [job.rows[0].assigned_helper_id]);
    if (!connect.rows[0] || !connect.rows[0].charges_enabled) {
      return res.status(400).json({ error: 'Helper payment account not ready' });
    }

    const jobValueCents = Math.round(job.rows[0].job_value * 100);
    const isBrokerMediated = !!job.rows[0].broker_helper_id;

    // Calculate fees using the single source of truth
    const fees = calculateTier3Fees(jobValueCents, isBrokerMediated);

    // Create DIRECT CHARGE on the helper's connected account
    // Helper is merchant of record. Card fees + chargebacks are on their account.
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: jobValueCents,
        currency: 'usd',
        payment_method_types: ['card'],
        capture_method: 'manual',
        application_fee_amount: fees.application_fee_cents,
        metadata: {
          job_id: job_id.toString(),
          client_id: req.user.id.toString(),
          helper_id: job.rows[0].assigned_helper_id.toString(),
          tier: 'tier3',
          base_platform_fee_cents: fees.base_platform_fee_cents.toString(),
          tier3_surcharge_cents: fees.tier3_surcharge_cents.toString(),
          broker_fee_cents: fees.broker_fee_cents.toString(),
        },
      },
      { stripeAccount: connect.rows[0].stripe_account_id }
    );

    // Store payment record
    await pool.query(
      `INSERT INTO payments
        (job_id, payer_id, payee_id, stripe_payment_intent_id,
         amount, application_fee, base_platform_fee, tier3_surcharge,
         broker_fee, status, payment_hold_status, stripe_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'authorized', 'held', $10)`,
      [
        job_id,
        req.user.id,
        job.rows[0].assigned_helper_id,
        paymentIntent.id,
        job.rows[0].job_value,
        fees.application_fee_cents / 100,
        fees.base_platform_fee_cents / 100,
        fees.tier3_surcharge_cents / 100,
        fees.broker_fee_cents / 100,
        connect.rows[0].stripe_account_id,
      ]
    );

    res.json({ client_secret: paymentIntent.client_secret, payment_intent_id: paymentIntent.id });
  } catch (err) {
    console.error('Create payment intent error:', err);
    res.status(500).json({ error: 'Failed to create payment' });
  }
};

/**
 * Capture payment after job completion.
 * Since this is a direct charge, capture happens on the helper's connected account.
 * Stripe deducts processing fees from the helper and sends OxSteed the application_fee.
 */
exports.capturePayment = async (req, res) => {
  try {
    const { job_id } = req.body;

    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
    if (!job.rows[0] || job.rows[0].status !== 'completed') {
      return res.status(400).json({ error: 'Job must be completed first' });
    }

    const payment = await pool.query('SELECT * FROM payments WHERE job_id = $1 AND status = $2', [job_id, 'authorized']);
    if (!payment.rows[0]) return res.status(404).json({ error: 'No authorized payment found' });

    // Capture on the helper's connected account
    await stripe.paymentIntents.capture(
      payment.rows[0].stripe_payment_intent_id,
      {},
      { stripeAccount: payment.rows[0].stripe_account_id }
    );

    await pool.query(
      `UPDATE payments SET status = 'captured', payment_hold_status = 'released',
       captured_at = NOW(), released_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [payment.rows[0].id]
    );

    res.json({ message: 'Payment captured — funds released to helper' });
  } catch (err) {
    console.error('Capture payment error:', err);
    res.status(500).json({ error: 'Failed to capture payment' });
  }
};

/**
 * Refund payment.
 * For direct charges, the refund is processed on the helper's connected account.
 * The helper bears the refund cost as merchant of record.
 * OxSteed may optionally reverse some/all of its application fee.
 */
exports.refundPayment = async (req, res) => {
  try {
    const { payment_id, reason, amount, reverse_application_fee } = req.body;

    const payment = await pool.query('SELECT * FROM payments WHERE id = $1', [payment_id]);
    if (!payment.rows[0]) return res.status(404).json({ error: 'Payment not found' });

    const refundParams = {
      payment_intent: payment.rows[0].stripe_payment_intent_id,
    };
    if (amount) refundParams.amount = Math.round(amount * 100);
    // Optionally reverse OxSteed's application fee (admin decision per dispute)
    if (reverse_application_fee) {
      refundParams.reverse_transfer = false; // no transfer to reverse in direct charges
      refundParams.refund_application_fee = true;
    }

    const refund = await stripe.refunds.create(
      refundParams,
      { stripeAccount: payment.rows[0].stripe_account_id }
    );

    await pool.query(
      `UPDATE payments SET status = 'refunded', payment_hold_status = 'refunded',
       refunded_at = NOW(), refund_amount = $1, refund_reason = $2, updated_at = NOW() WHERE id = $3`,
      [amount || payment.rows[0].amount, reason, payment_id]
    );

    res.json({ message: 'Refund processed', refund_id: refund.id });
  } catch (err) {
    console.error('Refund payment error:', err);
    res.status(500).json({ error: 'Failed to process refund' });
  }
};

// Get payment for a job
exports.getJobPayment = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM payments WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1', [req.params.job_id]);
    if (!result.rows[0]) return res.json(null);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get job payment error:', err);
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
};

// Get my payments
exports.getMyPayments = async (req, res) => {
  try {
    const { role = 'payer' } = req.query;
    const field = role === 'payee' ? 'payee_id' : 'payer_id';
    const result = await pool.query(
      `SELECT p.*, j.title as job_title FROM payments p JOIN jobs j ON p.job_id = j.id WHERE p.${field} = $1 ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get my payments error:', err);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
};
