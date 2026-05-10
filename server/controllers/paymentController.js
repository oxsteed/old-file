const pool = require('../db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { calculateTier3Fees } = require('../utils/feeCalculator');
const { validate, rules } = require('../utils/validate');
const logger = require('../utils/logger');
const { withPaymentTransaction } = require('../utils/transaction');
const { captureAuthorizedPayment } = require('../services/paymentCaptureService');
const { AppError } = require('../middleware/errorHandler');

/** When true, capture is queued to Redis (requires worker). Default false = capture in-request so funds release without a separate process. */
function isAsyncPaymentCapture() {
  return String(process.env.PAYMENT_CAPTURE_ASYNC || '').toLowerCase() === 'true';
}

/**
 * Payment Controller - Stripe Connect Direct Charges
 *
 * All Tier 3 payments are direct charges on the helper's connected Stripe account.
 * The helper is the merchant of record. OxSteed collects revenue via application_fee.
 * OxSteed's total platform fee is 7.1% (or $5 min) of the job value.
 * Card processing fees and chargebacks hit the helper's connected account.
 * OxSteed may choose to reverse its application fee in disputes but is not obligated.
 */

// Create Connect account for helper (onboarding)
exports.createConnectAccount = async (req, res, next) => {
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
    logger.error('Create connect account error', { userId: req.user?.id, error: err.message });
    next(new AppError('Failed to create payment account', 502, 'connect_account_create_failed'));
  }
};

// Get Connect account status
exports.getConnectStatus = async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT charges_enabled, payouts_enabled, onboarding_complete FROM connect_accounts WHERE user_id = $1',
      [req.user.id]
    );
    if (!result.rows[0]) return res.json({ connected: false });
    res.json({ connected: true, ...result.rows[0] });
  } catch (err) {
    logger.error('Get connect status error', { userId: req.user?.id, error: err.message });
    next(new AppError('Failed to get account status', 500, 'connect_status_failed'));
  }
};

/**
 * Create a direct charge PaymentIntent on the helper's connected Stripe account.
 *
 * Flow:
 *   1. Customer selects a helper for a Tier 3 job.
 *   2. OxSteed creates a PaymentIntent as a DIRECT CHARGE on the helper's account.
 *   3. application_fee_amount = 7.1% of job value (or $5 min).
 *   4. capture_method: 'manual' - authorize now, capture after job completion.
 *   5. Stripe processing fees are deducted from the helper's charge.
 *   6. On capture, helper gets paid and OxSteed receives its application_fee.
 */
exports.createPaymentIntent = async (req, res, next) => {
  try {
    const { job_id } = req.body;

    const errs = validate(req.body, { job_id: [rules.required, rules.integer] });
    if (errs) {
      throw new AppError('Validation failed', 400, 'validation_failed', errs);
    }

    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
    if (!job.rows[0]) {
      throw new AppError('Job not found', 404, 'job_not_found');
    }
    if (job.rows[0].client_id !== req.user.id) {
      throw new AppError('Not authorized to create payment for this job', 403, 'forbidden');
    }
    if (!job.rows[0].job_value) {
      throw new AppError('No agreed price set for this job', 400, 'missing_job_value');
    }

    // SECURITY: Prevent accidental or malicious payments of absurdly large amounts
    // Max single payment: $50,000 (can be overridden only by super_admin if needed)
    const MAX_PAYMENT_AMOUNT = 50000;
    if (job.rows[0].job_value > MAX_PAYMENT_AMOUNT) {
      throw new AppError(`Payment amount exceeds maximum allowed ($${MAX_PAYMENT_AMOUNT})`, 400, 'payment_amount_too_large', {
        job_value: `Maximum payment is $${MAX_PAYMENT_AMOUNT}. Contact support for exceptions.`
      });
    }

    const connect = await pool.query('SELECT * FROM connect_accounts WHERE user_id = $1', [job.rows[0].assigned_helper_id]);
    if (!connect.rows[0] || !connect.rows[0].charges_enabled) {
      throw new AppError('Helper payment account is not ready. Please ask the helper to complete their payment setup.', 400, 'helper_account_not_ready');
    }

    const jobValueCents = Math.round(job.rows[0].job_value * 100);
    const fees = calculateTier3Fees(jobValueCents);

    // Check for existing payment to prevent duplicates (idempotency).
    // We must return the actual `client_secret` from Stripe — not the PaymentIntent
    // ID — because the frontend uses it to confirm the card on the client.
    const existingPayment = await pool.query(
      'SELECT id, stripe_payment_intent_id, stripe_account_id FROM payments WHERE job_id = $1 AND status IN ($2, $3)',
      [job_id, 'authorized', 'pending']
    );
    if (existingPayment.rows[0]) {
      try {
        const existingPi = await stripe.paymentIntents.retrieve(
          existingPayment.rows[0].stripe_payment_intent_id,
          { stripeAccount: existingPayment.rows[0].stripe_account_id }
        );
        // Only reuse PIs that are still in a confirmable state. Anything past
        // `requires_capture` (or terminal) means the customer already paid;
        // returning that secret would let them re-pay an authorized intent.
        const reusableStatuses = ['requires_payment_method', 'requires_confirmation', 'requires_action'];
        if (reusableStatuses.includes(existingPi.status)) {
          return res.json({
            client_secret: existingPi.client_secret,
            payment_intent_id: existingPi.id,
            message: 'Existing payment intent returned',
          });
        }
        // PI is already authorized/captured/cancelled — surface state to client
        return res.status(409).json({
          error: `Payment already ${existingPi.status}. Refresh the page to see current state.`,
          code: 'payment_already_exists',
          payment_intent_id: existingPi.id,
          status: existingPi.status,
        });
      } catch (retrieveErr) {
        logger.warn('Failed to retrieve existing PaymentIntent during idempotency check; creating a new one', {
          jobId: job_id, paymentIntentId: existingPayment.rows[0].stripe_payment_intent_id, error: retrieveErr.message,
        });
        // Fall through and create a new PI — orphan rows can be cleaned up by a job
      }
    }

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

    const { rows: insertRows } = await pool.query(
      `INSERT INTO payments
        (job_id, payer_id, payee_id, stripe_payment_intent_id,
         amount, platform_fee, status, payment_hold_status, stripe_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'authorized', 'held', $7)
       RETURNING id`,
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

    if (insertRows.length === 0) {
      throw new AppError('Failed to save payment intent to database', 500, 'payment_save_failed');
    }

    res.json({ client_secret: paymentIntent.client_secret, payment_intent_id: paymentIntent.id });
  } catch (err) {
    next(err);
  }
};

// Capture payment after job completion (on helper's connected account)
exports.capturePayment = async (req, res, next) => {
  try {
    const { job_id } = req.body;

    // ── Validation (outside transaction) ──────────────────────────────────
    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
    if (!job.rows[0] || job.rows[0].status !== 'completed') {
      throw new AppError('Job must be completed before capturing payment', 400, 'job_not_completed');
    }
    if (job.rows[0].client_id !== req.user.id) {
      throw new AppError('Not authorized to capture payment for this job', 403, 'forbidden');
    }

    // ATTACK #2 FIX: Use pessimistic locking to prevent concurrent capture attempts
    // SELECT ... FOR UPDATE locks the row so only one request can proceed at a time
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      const payment = await client.query(
        'SELECT * FROM payments WHERE job_id = $1 AND status = $2 FOR UPDATE',
        [job_id, 'authorized']
      );

      if (!payment.rows[0]) {
        await client.query('ROLLBACK');
        throw new AppError('No authorized payment found for this job', 404, 'payment_not_found');
      }

      // ── CHECK FOR OPEN DISPUTES ──────────────────────────────────────────
      const dispute = await client.query('SELECT id FROM disputes WHERE job_id = $1 AND status IN ($2, $3)', [job_id, 'open', 'in_progress']);
      if (dispute.rows[0]) {
        await client.query('ROLLBACK');
        throw new AppError('Cannot capture payment while a dispute is open. Dispute must be resolved first.', 409, 'dispute_open');
      }

      const paymentData = payment.rows[0];

      // Release lock early (we'll keep transaction for atomicity)
      await client.query('COMMIT');

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
        throw new AppError(
          capErr.message || 'Could not capture payment. Please try again or contact support.',
          502,
          'payment_capture_failed'
        );
      }
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

// Refund payment (on helper's connected account - admin only)
// ATOMIC: Stripe refund + DB update happen together
exports.refundPayment = async (req, res, next) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new AppError('Admin access required', 403, 'forbidden');
    }

    const { payment_id, reason, amount, reverse_application_fee } = req.body;

    // ── Validation (outside transaction) ──────────────────────────────────
    const payment = await pool.query('SELECT * FROM payments WHERE id = $1', [payment_id]);
    if (!payment.rows[0]) {
      throw new AppError('Payment not found', 404, 'payment_not_found');
    }

    const paymentData = payment.rows[0];
    const refundAmount = amount || paymentData.amount;

    // ── VALIDATE PAYMENT STATUS ──────────────────────────────────────────
    // Only authorized and captured payments can be refunded
    if (!['authorized', 'captured'].includes(paymentData.status)) {
      throw new AppError(
        `Payment cannot be refunded in '${paymentData.status}' status. Only authorized and captured payments can be refunded.`,
        400,
        'invalid_payment_state'
      );
    }

    // ── CHECK FOR OPEN DISPUTES ──────────────────────────────────────────
    // Refunds can only happen after disputes are resolved
    const dispute = await pool.query('SELECT id FROM disputes WHERE job_id = $1 AND status IN ($2, $3)', [paymentData.job_id, 'open', 'in_progress']);
    if (dispute.rows[0]) {
      throw new AppError('Cannot refund payment while dispute is open. Dispute must be resolved first.', 409, 'dispute_open');
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
      const refundAmountCents = Math.round(refundAmount * 100);
      const refund = await stripe.refunds.create(
        refundParams,
        {
          stripeAccount: paymentData.stripe_account_id,
          idempotencyKey: `payment-refund-${paymentData.id}-${refundAmountCents}`
        }
      );
      refundId = refund.id;
    } catch (stripeErr) {
      logger.error('Stripe refund failed', { paymentId: paymentData.id, error: stripeErr.message });
      throw new AppError('Refund failed with payment processor. Please try again or contact support.', 502, 'stripe_error');
    }

    // ── Database update (ATOMIC TRANSACTION) ─────────────────────────────
    await withPaymentTransaction(pool, async (client) => {
      const { rows: updateRows } = await client.query(
        `UPDATE payments SET status = 'refunded', payment_hold_status = 'refunded',
         refunded_at = NOW(), refund_amount = $1, refund_reason = $2, stripe_refund_id = $3,
         updated_at = NOW() WHERE id = $4 AND status IN ('authorized', 'captured') RETURNING id`,
        [refundAmount, reason, refundId, payment_id]
      );
      if (updateRows.length === 0) {
        throw new Error('Payment status changed during refund processing');
      }

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
    // If we already created an AppError above, propagate it as-is so the
    // status/code reach the client. Only wrap unexpected errors.
    if (err instanceof AppError) return next(err);
    logger.error('Refund payment error', { paymentId: req.body?.payment_id, adminId: req.user?.id, error: err.message });
    next(new AppError('Failed to process refund', 500, 'refund_failed'));
  }
};

// Get payment for a job - only payer or payee may view
exports.getJobPayment = async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM payments WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1', [req.params.job_id]);
    if (!result.rows[0]) return res.json(null);
    const p = result.rows[0];
    if (p.payer_id !== req.user.id && p.payee_id !== req.user.id && !['admin', 'super_admin'].includes(req.user.role)) {
      throw new AppError('Not authorized', 403, 'forbidden');
    }
    res.json(p);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    logger.error('Get job payment error', { jobId: req.params?.job_id, userId: req.user?.id, error: err.message });
    next(new AppError('Failed to fetch payment', 500, 'fetch_payment_failed'));
  }
};

// Get my payments (paginated)
exports.getMyPayments = async (req, res, next) => {
  try {
    const { role = 'payer' } = req.query;
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10)  || 20));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const filterCol = role === 'payee' ? 'payee_id' : 'payer_id';
    const result = await pool.query(
      `SELECT p.*, j.title as job_title
         FROM payments p
         JOIN jobs j ON p.job_id = j.id
        WHERE p.${filterCol} = $1
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM payments WHERE ${filterCol} = $1`,
      [req.user.id]
    );
    res.json({
      payments: result.rows,
      total: parseInt(countRows[0].count, 10),
      limit,
      offset,
    });
  } catch (err) {
    logger.error('Get my payments error', { userId: req.user?.id, role: req.query?.role, error: err.message });
    next(new AppError('Failed to fetch payments', 500, 'fetch_payments_failed'));
  }
};

