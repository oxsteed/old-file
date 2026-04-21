const pool = require('../db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { calculateTier3Fees } = require('../utils/feeCalculator');
const { validate, rules } = require('../utils/validate');
const logger = require('../utils/logger');
const { withPaymentTransaction } = require('../utils/transaction');
const { captureAuthorizedPayment } = require('../services/paymentCaptureService');

/** When true, capture is queued to Redis (requires worker). Default false = capture in-request so funds release without a separate process. */
function isAsyncPaymentCapture() {
  return String(process.env.PAYMENT_CAPTURE_ASYNC || '').toLowerCase() === 'true';
}

/**
 * Payment Controller — Stripe Connect Direct Charges
 *
 * All Tier 3 payments are direct charges on the helper's connected Stripe account.
 * The helper is the merchant of record. OxSteed collects revenue via application_fee.
 * OxSteed's total platform fee is 7.1% (or $5 min) of the job value.
 * Card processing fees and chargebacks hit the helper's connected account.
 * OxSteed may choose to reverse its application fee in disputes but is not obligated.
 */

// Create Connect account for helper (onboarding)
exports.createConnectAccount = async (req, res) => {
  try {
    const existing = await pool.query('SELECT * FROM connect_accounts WHERE user_id = $1', [req.user.id]);
    if (existing.rows[0]) {
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
    logger.error('Create connect account error', { err });
    res.status(500).json({ error: 'Failed to create payment account' });
  }
};

// Get Connect account status
exports.getConnectStatus = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT charges_enabled, payouts_enabled, onboarding_complete FROM connect_accounts WHERE user_id = $1',
      [req.user.id]
    );
    if (!result.rows[0]) return res.json({ connected: false });
    res.json({ connected: true, ...result.rows[0] });
  } catch (err) {
    logger.error('Get connect status error', { err });
    res.status(500).json({ error: 'Failed to get account status' });
  }
};

/**
 * Create a direct charge PaymentIntent on the helper's connected Stripe account.
 *
 * Flow:
 *   1. Customer selects a helper for a Tier 3 job.
 *   2. OxSteed creates a PaymentIntent as a DIRECT CHARGE on the helper's account.
 *   3. application_fee_amount = 7.1% of job value (or $5 min).
 *   4. capture_method: 'manual' — authorize now, capture after job completion.
 *   5. Stripe processing fees are deducted from the helper's charge.
 *   6. On capture, helper gets paid and OxSteed receives its application_fee.
 */
exports.createPaymentIntent = async (req, res) => {
  try {
    const { job_id } = req.body;

    const errs = validate(req.body, { job_id: [rules.required, rules.integer] });
    if (errs) return res.status(400).json({ error: 'validation_failed', fields: errs });

    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].client_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    if (!job.rows[0].job_value) return res.status(400).json({ error: 'No agreed price set' });

    const connect = await pool.query('SELECT * FROM connect_accounts WHERE user_id = $1', [job.rows[0].assigned_helper_id]);
    if (!connect.rows[0] || !connect.rows[0].charges_enabled) {
      return res.status(400).json({ error: 'Helper payment account not ready' });
    }

    const jobValueCents = Math.round(job.rows[0].job_value * 100);
    const fees = calculateTier3Fees(jobValueCents);

    // Direct charge on helper's connected account
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
          platform_fee_cents: fees.platform_fee_cents.toString(),
        },
      },
      { stripeAccount: connect.rows[0].stripe_account_id }
    );

    await pool.query(
      `INSERT INTO payments
        (job_id, payer_id, payee_id, stripe_payment_intent_id,
         amount, platform_fee, status, payment_hold_status, stripe_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'authorized', 'held', $7)`,
      [
        job_id,
        req.user.id,
        job.rows[0].assigned_helper_id,
        paymentIntent.id,
        job.rows[0].job_value,
        fees.platform_fee_cents / 100,
        connect.rows[0].stripe_account_id,
      ]
    );

    res.json({ client_secret: paymentIntent.client_secret, payment_intent_id: paymentIntent.id });
  } catch (err) {
    logger.error('Create payment intent error', { err });
    res.status(500).json({ error: 'Failed to create payment' });
  }
};

// Capture payment after job completion (on helper's connected account)
exports.capturePayment = async (req, res) => {
  try {
    const { job_id } = req.body;

    // ── Validation (outside transaction) ──────────────────────────────────
    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
    if (!job.rows[0] || job.rows[0].status !== 'completed') {
      return res.status(400).json({ error: 'Job must be completed first' });
    }
    if (job.rows[0].client_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const payment = await pool.query('SELECT * FROM payments WHERE job_id = $1 AND status = $2', [job_id, 'authorized']);
    if (!payment.rows[0]) return res.status(404).json({ error: 'No authorized payment found' });

    // ── CHECK FOR OPEN DISPUTES ──────────────────────────────────────────
    const dispute = await pool.query('SELECT id FROM disputes WHERE job_id = $1 AND status IN ($2, $3)', [job_id, 'open', 'in_progress']);
    if (dispute.rows[0]) {
      return res.status(409).json({ error: 'Cannot capture payment while dispute is open. Dispute must be resolved first.' });
    }

    const paymentData = payment.rows[0];

    if (isAsyncPaymentCapture()) {
      const { queuePaymentCapture } = require('../services/paymentQueue');
      await queuePaymentCapture(paymentData.id, job_id, paymentData.amount);
      return res.status(202).json({
        status: 'processing',
        message: 'Payment capture queued',
        payment_id: paymentData.id,
        job_id,
      });
    }

    // Default: capture synchronously so production works without a separate worker process.
    try {
      const result = await captureAuthorizedPayment({
        paymentId: paymentData.id,
        jobId: job_id,
        amount: paymentData.amount,
      });
      return res.status(200).json({
        status: 'captured',
        message: 'Payment captured',
        payment_id: result.paymentId,
        charge_id: result.chargeId,
        job_id,
      });
    } catch (capErr) {
      logger.error('Synchronous payment capture failed', {
        jobId: job_id,
        paymentId: paymentData.id,
        error: capErr.message,
      });
      return res.status(502).json({
        error: 'payment_capture_failed',
        message: capErr.message || 'Could not capture payment. Please try again or contact support.',
      });
    }
  } catch (err) {
    logger.error('Capture payment error', { err });
    res.status(500).json({ error: 'Failed to capture payment' });
  }
};

// Refund payment (on helper's connected account — admin only)
// ATOMIC: Stripe refund + DB update happen together
exports.refundPayment = async (req, res) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { payment_id, reason, amount, reverse_application_fee } = req.body;

    // ── Validation (outside transaction) ──────────────────────────────────
    const payment = await pool.query('SELECT * FROM payments WHERE id = $1', [payment_id]);
    if (!payment.rows[0]) return res.status(404).json({ error: 'Payment not found' });

    const paymentData = payment.rows[0];
    const refundAmount = amount || paymentData.amount;

    // ── CHECK FOR OPEN DISPUTES ──────────────────────────────────────────
    // Refunds can only happen after disputes are resolved
    const dispute = await pool.query('SELECT id FROM disputes WHERE job_id = $1 AND status IN ($2, $3)', [paymentData.job_id, 'open', 'in_progress']);
    if (dispute.rows[0]) {
      return res.status(409).json({ error: 'Cannot refund payment while dispute is open. Dispute must be resolved first.' });
    }

    // ── Stripe refund (outside transaction for idempotency) ──────────────
    const refundParams = {
      payment_intent: paymentData.stripe_payment_intent_id,
    };
    if (amount) refundParams.amount = Math.round(amount * 100);
    if (reverse_application_fee) {
      refundParams.refund_application_fee = true;
    }

    let refundId;
    try {
      const refund = await stripe.refunds.create(
        refundParams,
        { stripeAccount: paymentData.stripe_account_id }
      );
      refundId = refund.id;
    } catch (stripeErr) {
      logger.error('Stripe refund failed', { paymentId: paymentData.id, error: stripeErr.message });
      return res.status(402).json({ error: 'Refund failed with payment processor' });
    }

    // ── Database update (ATOMIC TRANSACTION) ─────────────────────────────
    await withPaymentTransaction(pool, async (client) => {
      await client.query(
        `UPDATE payments SET status = 'refunded', payment_hold_status = 'refunded',
         refunded_at = NOW(), refund_amount = $1, refund_reason = $2, stripe_refund_id = $3,
         updated_at = NOW() WHERE id = $4`,
        [refundAmount, reason, refundId, payment_id]
      );

      // Audit log for refund (admin action)
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, changes, timestamp)
         VALUES ($1, 'refund_payment', 'payment', $2, $3, NOW())`,
        [req.user.id, payment_id, JSON.stringify({ amount: refundAmount, reason, stripe_refund_id: refundId })]
      );

      // Log to platform ledger (financial audit trail)
      await client.query(
        `INSERT INTO platform_ledger (user_id, type, amount_cents, description, metadata)
         VALUES (NULL, 'payment_refunded', $1, $2, $3)`,
        [
          Math.round(refundAmount * -100),  // negative for refund
          `Payment #${paymentData.id} refunded by admin ${req.user.id}: ${reason || 'No reason'}`,
          JSON.stringify({
            payment_id: paymentData.id,
            job_id: paymentData.job_id,
            refund_id: refundId,
            refund_amount: refundAmount,
            reason: reason || null,
            admin_id: req.user.id,
            reverse_fee: reverse_application_fee || false
          })
        ]
      );
    }, 'refund_payment');

    res.json({ message: 'Refund processed', refund_id: refundId });
  } catch (err) {
    logger.error('Refund payment error', { err });
    res.status(500).json({ error: 'Failed to process refund' });
  }
};

// Get payment for a job — only payer or payee may view
exports.getJobPayment = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM payments WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1', [req.params.job_id]);
    if (!result.rows[0]) return res.json(null);
    const p = result.rows[0];
    if (p.payer_id !== req.user.id && p.payee_id !== req.user.id && !['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    res.json(p);
  } catch (err) {
    logger.error('Get job payment error', { err });
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
};

// Get my payments
exports.getMyPayments = async (req, res) => {
  try {
    const { role = 'payer' } = req.query;
    let result;
    if (role === 'payee') {
      result = await pool.query(
        `SELECT p.*, j.title as job_title FROM payments p JOIN jobs j ON p.job_id = j.id WHERE p.payee_id = $1 ORDER BY p.created_at DESC`,
        [req.user.id]
      );
    } else {
      result = await pool.query(
        `SELECT p.*, j.title as job_title FROM payments p JOIN jobs j ON p.job_id = j.id WHERE p.payer_id = $1 ORDER BY p.created_at DESC`,
        [req.user.id]
      );
    }
    res.json(result.rows);
  } catch (err) {
    logger.error('Get my payments error', { err });
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
};
