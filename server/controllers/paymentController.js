const pool = require('../db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const {
  calculateTier3Fees
} = require('../utils/feeCalculator');
const {
  validate,
  rules
} = require('../utils/validate');
const logger = require('../utils/logger');
const {
  withTransaction,
  withPaymentTransaction
} = require('../utils/transaction');
const {
  captureAuthorizedPayment
} = require('../services/paymentCaptureService');
const {
  processPaymentRefund
} = require('../services/paymentRefundService');
const {
  AppError
} = require('../middleware/errorHandler');
const {
  logAdminAction
} = require('../services/auditService');

/** When true, capture is queued to Redis (requires worker). Default false = capture in-request so funds release without a separate process. */
function isAsyncPaymentCapture() {
  return String(process.env.PAYMENT_CAPTURE_ASYNC || '').toLowerCase() === 'true';
}
function getAppBaseUrl() {
  return process.env.APP_URL || process.env.CLIENT_URL || 'https://oxsteed.com';
}
function resolveAppBaseUrl() {
  const candidates = [process.env.APP_URL, process.env.CLIENT_URL, 'https://oxsteed.com'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:')) continue;
      return url.origin;
    } catch (_) {
      // Do not use untrusted request Origin, Referer or Host for Stripe redirects.
    }
  }
  return 'https://oxsteed.com';
}
async function refreshConnectAccountStatus(userId, accountRow) {
  if (!accountRow) return null;
  const unavailable = {
    ...accountRow,
    status_verified: false,
    status_unavailable: true,
    last_known_charges_enabled: !!accountRow.charges_enabled,
    last_known_payouts_enabled: !!accountRow.payouts_enabled,
    charges_enabled: false,
    payouts_enabled: false
  };
  if (!process.env.STRIPE_SECRET_KEY || !accountRow.stripe_account_id) {
    return unavailable;
  }
  try {
    const account = await stripe.accounts.retrieve(accountRow.stripe_account_id);
    const chargesEnabled = !!account.charges_enabled;
    const payoutsEnabled = !!account.payouts_enabled;
    const onboardingComplete = !!account.details_submitted || chargesEnabled || payoutsEnabled;
    const accountStatus = chargesEnabled ? 'active' : Array.isArray(account.requirements?.currently_due) && account.requirements.currently_due.length ? 'restricted' : 'pending';
    if (accountRow.charges_enabled !== chargesEnabled || accountRow.payouts_enabled !== payoutsEnabled || accountRow.onboarding_complete !== onboardingComplete) {
      await pool.query(`UPDATE connect_accounts
            SET charges_enabled = $2,
                payouts_enabled = $3,
                onboarding_complete = $4,
                updated_at = NOW()
          WHERE user_id = $1 AND stripe_account_id = $5`, [userId, chargesEnabled, payoutsEnabled, onboardingComplete, accountRow.stripe_account_id]);
    }
    const { syncHelperProfileStripeFromConnect } = require('../services/stripeConnectSoTService');
    await syncHelperProfileStripeFromConnect(pool, userId, {
      stripeAccountId: accountRow.stripe_account_id,
      chargesEnabled,
      payoutsEnabled,
      onboardingComplete,
    });
    return {
      ...accountRow,
      status_verified: true,
      charges_enabled: chargesEnabled,
      payouts_enabled: payoutsEnabled,
      onboarding_complete: onboardingComplete,
      account_status: accountStatus,
      details_submitted: !!account.details_submitted,
      requirements: account.requirements || null,
      country: account.country || accountRow.country || null,
      default_currency: account.default_currency || accountRow.default_currency || null
    };
  } catch (err) {
    logger.warn('Failed to refresh Stripe Connect account status', {
      userId,
      accountId: accountRow.stripe_account_id,
      error: err.message
    });
    return unavailable;
  }
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

/**
 * Stripe only allows pre-registered redirect hosts, so the onboarding return
 * URL must stay on our own origin. Accept an optional caller-supplied
 * `return_path` (e.g. '/qr-payments') and fall back to the helper dashboard
 * for anything that is not a plain same-origin path.
 */
function sanitizeOnboardingReturnPath(value) {
  if (typeof value !== 'string') return '/helper-dashboard';
  const clean = value.trim().split('?')[0].split('#')[0];
  if (!clean.startsWith('/') || clean.startsWith('//') || clean.includes('\\') || /[\r\n]/.test(clean)) {
    return '/helper-dashboard';
  }
  return clean || '/helper-dashboard';
}

exports.createConnectAccount = async (req, res, next) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new AppError('Stripe is not configured on the server.', 503, 'stripe_not_configured');
    }
    const returnPath = sanitizeOnboardingReturnPath(req.body && req.body.return_path);
    const appBase = resolveAppBaseUrl(req);
    const refreshUrl = `${appBase}${returnPath}?refresh=true`;
    const returnUrl = `${appBase}${returnPath}?onboarding=complete`;
    const existing = await pool.query('SELECT * FROM connect_accounts WHERE user_id = $1', [req.user.id]);
    if (existing.rows[0]) {
      const freshExisting = await refreshConnectAccountStatus(req.user.id, existing.rows[0]);
      if (freshExisting.status_verified === false) {
        throw new AppError('Stripe account status is temporarily unavailable. Please retry.', 503, 'connect_status_unavailable');
      }
      const requirements = freshExisting.requirements || {};
      if (!freshExisting.onboarding_complete || !freshExisting.charges_enabled || !freshExisting.payouts_enabled || requirements.currently_due?.length || requirements.past_due?.length) {
        const link = await stripe.accountLinks.create({
          account: freshExisting.stripe_account_id,
          refresh_url: refreshUrl,
          return_url: returnUrl,
          type: 'account_onboarding'
        });
        return res.json({
          url: link.url,
          onboarding_url: link.url,
          account_id: freshExisting.stripe_account_id
        });
      }
      return res.json({
        message: 'Account already set up',
        account: freshExisting
      });
    }
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: req.user.email,
      capabilities: {
        card_payments: {
          requested: true
        },
        transfers: {
          requested: true
        }
      },
      metadata: {
        oxsteed_user_id: String(req.user.id)
      }
    }, {
      idempotencyKey: `oxsteed-connect-account:${req.user.id}`
    });
    const {
      rows: persisted
    } = await pool.query(`INSERT INTO connect_accounts (user_id, stripe_account_id) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET stripe_account_id = connect_accounts.stripe_account_id
       RETURNING stripe_account_id`, [req.user.id, account.id]);
    const accountId = persisted[0]?.stripe_account_id;
    if (!accountId) throw new AppError('Payment account could not be saved. Please retry.', 503, 'connect_account_persistence_failed');
    const { syncHelperProfileStripeFromConnect } = require('../services/stripeConnectSoTService');
    await syncHelperProfileStripeFromConnect(pool, req.user.id, {
      stripeAccountId: accountId,
      chargesEnabled: false,
      payoutsEnabled: false,
      onboardingComplete: false,
    });
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding'
    });
    res.json({
      url: link.url,
      onboarding_url: link.url,
      account_id: accountId
    });
  } catch (err) {
    logger.error('Create connect account error', {
      userId: req.user?.id,
      error: err.message
    });
    next(err instanceof AppError ? err : new AppError('Failed to create payment account', 502, 'connect_account_create_failed'));
  }
};

// Get Connect account status
exports.getConnectStatus = async (req, res, next) => {
  try {
    const result = await pool.query('SELECT user_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_complete FROM connect_accounts WHERE user_id = $1', [req.user.id]);
    if (!result.rows[0]) return res.json({
      connected: false
    });
    const refreshed = await refreshConnectAccountStatus(req.user.id, result.rows[0]);
    res.json({
      connected: true,
      ...refreshed,
      stripe_connect_ready: !!refreshed.charges_enabled,
      stripe_connect_payouts_ready: !!refreshed.payouts_enabled,
      stripe_connect_onboarded: !!refreshed.onboarding_complete
    });
  } catch (err) {
    logger.error('Get connect status error', {
      userId: req.user?.id,
      error: err.message
    });
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
    const {
      job_id
    } = req.body;
    const errs = validate(req.body, {
      job_id: [rules.required]
    });
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
    const freshConnect = await refreshConnectAccountStatus(job.rows[0].assigned_helper_id, connect.rows[0] || null);
    if (!freshConnect || !freshConnect.charges_enabled) {
      throw new AppError('This helper is not ready for protected payment capture yet. Use the direct payment and proof flow instead.', 400, 'helper_account_not_ready');
    }
    const rawJobValueCents = Math.round(job.rows[0].job_value * 100);

    // ── Apply referral credits (reduces amount charged to customer) ──────────
    // H13: the credit balance read, the Stripe intent, the payments row, and
    // the credit_applied ledger write all happen inside one transaction under
    // a per-user advisory lock, so concurrent payments cannot spend the same
    // credit twice. The DISCOUNTED amount is carried into the intent, the
    // payments row, and capture (previously the row stored the full job value
    // while Stripe only authorized the discounted amount, so capture asked
    // for more than authorized whenever credits were applied).
    const intentResult = await withTransaction(pool, async client => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`payment-credit:${req.user.id}`]);

      // Query spendable credit balance: referral_credit + dispute_credit + promo_credit
      // minus any previously applied credits.
      const creditResult = await client.query(`SELECT COALESCE(SUM(
           CASE WHEN type IN ('referral_credit', 'dispute_credit', 'promo_credit') THEN amount_cents
                WHEN type = 'credit_applied' THEN -amount_cents
                ELSE 0
           END
         ), 0) AS balance_cents
         FROM platform_ledger
         WHERE user_id = $1`, [req.user.id]);
      const availableCreditCents = Math.max(0, parseInt(creditResult.rows?.[0]?.balance_cents || '0', 10));
      // Cap credit at job value — can't go below $0.50 (Stripe minimum)
      const appliedCreditCents = Math.min(availableCreditCents, Math.max(0, rawJobValueCents - 50));
      const jobValueCents = rawJobValueCents - appliedCreditCents;
      const fees = calculateTier3Fees(jobValueCents);

      // Check for existing payment to prevent duplicates (idempotency).
      // We must return the actual `client_secret` from Stripe — not the PaymentIntent
      // ID — because the frontend uses it to confirm the card on the client.
      const existingPayment = await client.query('SELECT id, stripe_payment_intent_id, stripe_account_id FROM payments WHERE job_id = $1 AND status IN ($2, $3)', [job_id, 'authorized', 'pending']);
      if (existingPayment.rows[0]) {
        try {
          const existingPi = await stripe.paymentIntents.retrieve(existingPayment.rows[0].stripe_payment_intent_id, {
            stripeAccount: existingPayment.rows[0].stripe_account_id
          });
          // Only reuse PIs that are still in a confirmable state. Anything past
          // `requires_capture` (or terminal) means the customer already paid;
          // returning that secret would let them re-pay an authorized intent.
          const reusableStatuses = ['requires_payment_method', 'requires_confirmation', 'requires_action'];
          if (reusableStatuses.includes(existingPi.status)) {
            return {
              replay: true,
              statusCode: 200,
              body: {
                client_secret: existingPi.client_secret,
                payment_intent_id: existingPi.id,
                message: 'Existing payment intent returned'
              }
            };
          }
          // PI is already authorized/captured/cancelled — surface state to client
          return {
            replay: true,
            statusCode: 409,
            body: {
              error: `Payment already ${existingPi.status}. Refresh the page to see current state.`,
              code: 'payment_already_exists',
              payment_intent_id: existingPi.id,
              status: existingPi.status
            }
          };
        } catch (retrieveErr) {
          logger.error('Failed to retrieve existing PaymentIntent during idempotency check', {
            jobId: job_id,
            paymentIntentId: existingPayment.rows[0].stripe_payment_intent_id,
            error: retrieveErr.message
          });
          throw new AppError('We could not verify the existing payment attempt. Please try again shortly.', 503, 'payment_verification_unavailable');
        }
      }

      // A new attempt gets a new idempotency key, while concurrent requests that
      // observed the same count still collapse into one Stripe request.
      const attemptResult = await client.query('SELECT COUNT(*)::int AS attempt_count FROM payments WHERE job_id = $1', [job_id]);
      const paymentAttempt = Number(attemptResult.rows[0]?.attempt_count || 0) + 1;
      const paymentIdempotencyKey = `job-payment:${job_id}:${paymentAttempt}`;

      // Direct charge on helper's connected account
      // Retries and concurrent browser requests for one job must resolve to the
      // same Stripe intent rather than creating multiple authorizations.
      const paymentIntent = await stripe.paymentIntents.create({
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
          platform_fee_cents: fees.platform_fee_cents.toString()
        }
      }, {
        stripeAccount: freshConnect.stripe_account_id,
        idempotencyKey: paymentIdempotencyKey
      });
      let insertRows;
      try {
        ({
          rows: insertRows
        } = await client.query(`INSERT INTO payments
            (job_id, payer_id, payee_id, stripe_payment_intent_id,
             amount, platform_fee, status, payment_hold_status, stripe_account_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'pending', $7, $8::jsonb)
           RETURNING id`, [job_id, req.user.id, job.rows[0].assigned_helper_id, paymentIntent.id, jobValueCents / 100, fees.platform_fee_cents / 100, freshConnect.stripe_account_id, JSON.stringify({
          discounted_amount_cents: jobValueCents,
          raw_job_value_cents: rawJobValueCents,
          appliedCreditCents: appliedCreditCents
        })]));
        // Audit fix: payment starts as 'pending', not 'authorized'. The
        // webhook (payment_intent.amount_capturable_updated) marks it
        // authorized only after Stripe confirms funds are held.
      } catch (insertErr) {
        // A concurrent request may have inserted the same idempotent Stripe
        // intent first. Return it rather than retrying the external charge.
        if (insertErr.code !== '23505') throw insertErr;
        const existingIntent = await client.query(`SELECT id FROM payments
            WHERE stripe_payment_intent_id = $1
            LIMIT 1`, [paymentIntent.id]);
        if (!existingIntent.rows[0]) throw insertErr;
        return {
          replay: true,
          statusCode: 200,
          body: {
            client_secret: paymentIntent.client_secret,
            payment_intent_id: paymentIntent.id,
            message: 'Existing payment intent returned'
          }
        };
      }
      if (insertRows.length === 0) {
        throw new AppError('Failed to save payment intent to database', 500, 'payment_save_failed');
      }

      // Tier-3 escrow opt-in, deterministic: mark the job's transaction_mode
      // so completion detects escrow via the enum instead of fragile label
      // substring matching (see isTier3EscrowJob in jobController). Same
      // transaction as the payments row — the flag and the intent commit or
      // roll back together.
      await client.query(
        `UPDATE jobs SET transaction_mode = 'guided_protected', updated_at = NOW() WHERE id = $1`,
        [job_id]
      );

      // Audit fix: referral credit is NOT deducted here. It's recorded in the
      // payment metadata and deducted only when Stripe confirms the payment
      // (in the webhook). Deducting now would spend credit on a payment that
      // might fail.
      return {
        replay: false,
        paymentIntent,
        appliedCreditCents,
        jobValueCents
      };
    }, 'payment_create_intent');
    if (intentResult.replay) {
      return res.status(intentResult.statusCode).json(intentResult.body);
    }
    const {
      paymentIntent,
      appliedCreditCents
    } = intentResult;
    res.json({
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      applied_credit_cents: appliedCreditCents,
      applied_credit_dollars: (appliedCreditCents / 100).toFixed(2)
    });
  } catch (err) {
    next(err);
  }
};
exports.requestInstantPayout = async (req, res, next) => {
  try {
    const accountResult = await pool.query('SELECT * FROM connect_accounts WHERE user_id = $1', [req.user.id]);
    const account = accountResult.rows[0];
    const refreshedAccount = await refreshConnectAccountStatus(req.user.id, account || null);
    if (!refreshedAccount) {
      throw new AppError('Connect account not found. Complete payout setup first.', 404, 'connect_account_not_found');
    }
    if (!refreshedAccount.payouts_enabled) {
      throw new AppError('Payouts are not enabled yet. Finish Stripe onboarding before requesting instant payout.', 400, 'payouts_not_enabled');
    }
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(202).json({
        status: 'pending',
        message: 'Payout account is ready. Stripe is not configured in this environment, so no payout was created.'
      });
    }
    const balance = await stripe.balance.retrieve({
      stripeAccount: refreshedAccount.stripe_account_id
    });
    const available = (balance.available || []).find(b => String(b.currency).toLowerCase() === 'usd');
    // Audit fix: cap instant payouts at $500 per request. Draining the full
    // available balance in one call is risky if the account is compromised.
    const INSTANT_PAYOUT_MAX_CENTS = 50000;
    const amount = Math.min(available?.amount || 0, INSTANT_PAYOUT_MAX_CENTS);
    if (amount <= 0) {
      return res.status(200).json({
        status: 'no_available_balance',
        message: 'No instant payout balance is available yet.'
      });
    }
    const payout = await stripe.payouts.create({
      amount,
      currency: 'usd',
      method: 'instant'
    }, {
      stripeAccount: refreshedAccount.stripe_account_id,
      // H1: Stripe idempotency key per user-day. A retried request (double
      // tap, network retry) on the same day returns the original payout
      // object from Stripe instead of paying the user twice.
      idempotencyKey: `instant-payout:${req.user.id}:${new Date().toISOString().slice(0, 10)}`
    });
    // H7: audit the money movement. Fail closed (throwOnError) so a dropped
    // audit row never goes unnoticed.
    await logAdminAction({
      adminId: req.user.id,
      action: 'request_instant_payout',
      targetType: 'stripe_payout',
      targetId: payout.id,
      after: {
        amount_cents: amount,
        currency: 'usd',
        method: 'instant',
        stripe_account_id: refreshedAccount.stripe_account_id,
        stripe_status: payout.status || null
      },
      throwOnError: true
    }).catch(auditErr => {
      logger.error('Instant payout audit write failed', {
        userId: req.user?.id,
        error: auditErr.message
      });
      throw new AppError('Payout was created but could not be audited; contact support', 500, 'payout_audit_failed');
    });
    res.json({
      status: payout.status || 'created',
      payout_id: payout.id,
      amount_cents: amount,
      message: 'Instant payout requested'
    });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    logger.error('Instant payout request failed', {
      userId: req.user?.id,
      error: err.message
    });
    next(new AppError('Failed to request instant payout', 502, 'instant_payout_failed'));
  }
};
exports.disconnectConnectAccount = async (req, res, next) => {
  try {
    const accountResult = await pool.query('SELECT * FROM connect_accounts WHERE user_id = $1', [req.user.id]);
    const account = accountResult.rows[0];
    if (!account) return res.json({
      success: true,
      message: 'No connected payout account found.'
    });
    if (process.env.STRIPE_SECRET_KEY && account.stripe_account_id) {
      try {
        await stripe.accounts.del(account.stripe_account_id);
      } catch (stripeErr) {
        logger.warn('Stripe account disconnect failed; removing local link', {
          userId: req.user.id,
          accountId: account.stripe_account_id,
          error: stripeErr.message
        });
      }
    }
    await pool.query('DELETE FROM connect_accounts WHERE user_id = $1', [req.user.id]);
    res.json({
      success: true,
      message: 'Payout account disconnected.'
    });
  } catch (err) {
    logger.error('Disconnect connect account failed', {
      userId: req.user?.id,
      error: err.message
    });
    next(new AppError('Failed to disconnect payout account', 500, 'connect_disconnect_failed'));
  }
};

// Capture payment after job completion (on helper's connected account)
exports.capturePayment = async (req, res, next) => {
  try {
    const {
      job_id
    } = req.body;

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
      const payment = await client.query('SELECT * FROM payments WHERE job_id = $1 AND status IN ($2, $3) FOR UPDATE', [job_id, 'authorized', 'captured']);
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

      // A retry after the first request committed is a successful replay, not
      // a missing payment. Return the authoritative terminal state without
      // calling Stripe a second time.
      if (paymentData.status === 'captured') {
        await client.query('COMMIT');
        return res.status(200).json({
          status: 'captured',
          message: 'Payment was already captured',
          payment_id: paymentData.id,
          charge_id: paymentData.stripe_charge_id || null,
          job_id,
          idempotent: true
        });
      }

      // Release lock early (we'll keep transaction for atomicity)
      await client.query('COMMIT');
      if (isAsyncPaymentCapture()) {
        const {
          queuePaymentCapture
        } = require('../services/paymentQueue');
        await queuePaymentCapture(paymentData.id, job_id, paymentData.amount);
        return res.status(202).json({
          status: 'processing',
          message: 'Payment capture queued',
          payment_id: paymentData.id,
          job_id
        });
      }

      // Default: capture synchronously so production works without a separate worker process.
      try {
        const result = await captureAuthorizedPayment({
          paymentId: paymentData.id,
          jobId: job_id,
          amount: paymentData.amount
        });
        return res.status(200).json({
          status: 'captured',
          message: 'Payment captured',
          payment_id: result.paymentId,
          charge_id: result.chargeId,
          job_id
        });
      } catch (capErr) {
        logger.error('Synchronous payment capture failed', {
          jobId: job_id,
          paymentId: paymentData.id,
          error: capErr.message
        });
        throw new AppError(capErr.message || 'Could not capture payment. Please try again or contact support.', 502, 'payment_capture_failed');
      }
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

// Refund payment (on helper's connected account - admin only).
// The provider operation is reserved and settled through the durable refund
// service so retries cannot duplicate a partial refund or lose a timeout.
exports.refundPayment = async (req, res, next) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new AppError('Admin access required', 403, 'forbidden');
    }
    const {
      payment_id,
      reason,
      amount,
      reverse_application_fee
    } = req.body;
    const hasRequestedAmount = amount !== undefined && amount !== null && String(amount).trim() !== '';
    if (!Number.isFinite(Number(amount)) && hasRequestedAmount) {
      throw new AppError('Refund amount must be a valid number.', 400, 'invalid_refund_amount');
    }
    if (reason !== undefined && reason !== null && String(reason).length > 1000) {
      throw new AppError('Refund reason is too long.', 400, 'invalid_refund_reason');
    }
    const result = await processPaymentRefund({
      paymentId: payment_id,
      requestedAmountCents: hasRequestedAmount ? Math.round(Number(amount) * 100) : null,
      reason,
      reverseApplicationFee: !!reverse_application_fee,
      actorUserId: req.user.id,
      requestId: req.get('Idempotency-Key') || req.body?.idempotencyKey
    });
    const responseStatus = result.attempt.status === 'succeeded' ? 200 : 202;
    return res.status(responseStatus).json({
      message: result.attempt.status === 'succeeded' ? 'Refund processed' : 'Refund is being reconciled',
      refund_id: result.attempt.stripe_refund_id || null,
      refund_status: result.attempt.status,
      refund_amount_cents: Number(result.attempt.amount_cents),
      cumulative_refunded_amount: Number(result.payment.refunded_amount || 0),
      idempotent: !!result.replay
    });
  } catch (err) {
    // If we already created an AppError above, propagate it as-is so the
    // status/code reach the client. Only wrap unexpected errors.
    if (err instanceof AppError) return next(err);
    logger.error('Refund payment error', {
      paymentId: req.body?.payment_id,
      adminId: req.user?.id,
      error: err.message
    });
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
    logger.error('Get job payment error', {
      jobId: req.params?.job_id,
      userId: req.user?.id,
      error: err.message
    });
    next(new AppError('Failed to fetch payment', 500, 'fetch_payment_failed'));
  }
};

// Get my payments (paginated)
exports.getMyPayments = async (req, res, next) => {
  try {
    const {
      role = 'payer'
    } = req.query;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const filterCol = role === 'payee' ? 'payee_id' : 'payer_id';
    const result = await pool.query(`SELECT p.*, j.title as job_title
         FROM payments p
         JOIN jobs j ON p.job_id = j.id
        WHERE p.${filterCol} = $1
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3`, [req.user.id, limit, offset]);
    const {
      rows: countRows
    } = await pool.query(`SELECT COUNT(*) FROM payments WHERE ${filterCol} = $1`, [req.user.id]);
    res.json({
      payments: result.rows,
      total: parseInt(countRows?.[0]?.count ?? '0', 10),
      limit,
      offset
    });
  } catch (err) {
    logger.error('Get my payments error', {
      userId: req.user?.id,
      role: req.query?.role,
      error: err.message
    });
    next(new AppError('Failed to fetch payments', 500, 'fetch_payments_failed'));
  }
};
exports.getInvestorSummary = async (_req, res) => {
  const safeCount = async sql => {
    try {
      const {
        rows
      } = await pool.query(sql);
      return parseInt(rows?.[0]?.count || rows?.[0]?.total || '0', 10) || 0;
    } catch {
      return 0;
    }
  };
  const [helpersFunded, activeOpportunities, revenueShareCents] = await Promise.all([safeCount(`SELECT COUNT(DISTINCT payee_id) AS count FROM payments WHERE status IN ('authorized','captured','released')`), safeCount(`SELECT COUNT(*) AS count FROM jobs WHERE status IN ('published','open','in_progress')`), safeCount(`SELECT COALESCE(SUM(platform_fee * 100), 0)::bigint AS total FROM payments WHERE status IN ('captured','released')`)]);
  res.json({
    total_invested_cents: revenueShareCents,
    helpers_funded: helpersFunded,
    revenue_share_cents: revenueShareCents,
    active_opportunities: activeOpportunities
  });
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwb29sIiwicmVxdWlyZSIsInN0cmlwZSIsInByb2Nlc3MiLCJlbnYiLCJTVFJJUEVfU0VDUkVUX0tFWSIsImNhbGN1bGF0ZVRpZXIzRmVlcyIsInZhbGlkYXRlIiwicnVsZXMiLCJsb2dnZXIiLCJ3aXRoVHJhbnNhY3Rpb24iLCJ3aXRoUGF5bWVudFRyYW5zYWN0aW9uIiwiY2FwdHVyZUF1dGhvcml6ZWRQYXltZW50IiwicHJvY2Vzc1BheW1lbnRSZWZ1bmQiLCJBcHBFcnJvciIsImxvZ0FkbWluQWN0aW9uIiwiaXNBc3luY1BheW1lbnRDYXB0dXJlIiwiU3RyaW5nIiwiUEFZTUVOVF9DQVBUVVJFX0FTWU5DIiwidG9Mb3dlckNhc2UiLCJnZXRBcHBCYXNlVXJsIiwiQVBQX1VSTCIsIkNMSUVOVF9VUkwiLCJyZXNvbHZlQXBwQmFzZVVybCIsImNhbmRpZGF0ZXMiLCJjYW5kaWRhdGUiLCJ1cmwiLCJVUkwiLCJwcm90b2NvbCIsIk5PREVfRU5WIiwib3JpZ2luIiwiXyIsInJlZnJlc2hDb25uZWN0QWNjb3VudFN0YXR1cyIsInVzZXJJZCIsImFjY291bnRSb3ciLCJ1bmF2YWlsYWJsZSIsInN0YXR1c192ZXJpZmllZCIsInN0YXR1c191bmF2YWlsYWJsZSIsImxhc3Rfa25vd25fY2hhcmdlc19lbmFibGVkIiwiY2hhcmdlc19lbmFibGVkIiwibGFzdF9rbm93bl9wYXlvdXRzX2VuYWJsZWQiLCJwYXlvdXRzX2VuYWJsZWQiLCJzdHJpcGVfYWNjb3VudF9pZCIsImFjY291bnQiLCJhY2NvdW50cyIsInJldHJpZXZlIiwiY2hhcmdlc0VuYWJsZWQiLCJwYXlvdXRzRW5hYmxlZCIsIm9uYm9hcmRpbmdDb21wbGV0ZSIsImRldGFpbHNfc3VibWl0dGVkIiwiYWNjb3VudFN0YXR1cyIsIkFycmF5IiwiaXNBcnJheSIsInJlcXVpcmVtZW50cyIsImN1cnJlbnRseV9kdWUiLCJsZW5ndGgiLCJvbmJvYXJkaW5nX2NvbXBsZXRlIiwicXVlcnkiLCJhY2NvdW50X3N0YXR1cyIsImNvdW50cnkiLCJkZWZhdWx0X2N1cnJlbmN5IiwiZXJyIiwid2FybiIsImFjY291bnRJZCIsImVycm9yIiwibWVzc2FnZSIsImV4cG9ydHMiLCJjcmVhdGVDb25uZWN0QWNjb3VudCIsInJlcSIsInJlcyIsIm5leHQiLCJleGlzdGluZyIsInVzZXIiLCJpZCIsInJvd3MiLCJmcmVzaEV4aXN0aW5nIiwicGFzdF9kdWUiLCJsaW5rIiwiYWNjb3VudExpbmtzIiwiY3JlYXRlIiwicmVmcmVzaF91cmwiLCJyZXR1cm5fdXJsIiwidHlwZSIsImpzb24iLCJvbmJvYXJkaW5nX3VybCIsImFjY291bnRfaWQiLCJlbWFpbCIsImNhcGFiaWxpdGllcyIsImNhcmRfcGF5bWVudHMiLCJyZXF1ZXN0ZWQiLCJ0cmFuc2ZlcnMiLCJtZXRhZGF0YSIsIm94c3RlZWRfdXNlcl9pZCIsImlkZW1wb3RlbmN5S2V5IiwicGVyc2lzdGVkIiwiZ2V0Q29ubmVjdFN0YXR1cyIsInJlc3VsdCIsImNvbm5lY3RlZCIsInJlZnJlc2hlZCIsInN0cmlwZV9jb25uZWN0X3JlYWR5Iiwic3RyaXBlX2Nvbm5lY3RfcGF5b3V0c19yZWFkeSIsInN0cmlwZV9jb25uZWN0X29uYm9hcmRlZCIsImNyZWF0ZVBheW1lbnRJbnRlbnQiLCJqb2JfaWQiLCJib2R5IiwiZXJycyIsInJlcXVpcmVkIiwiam9iIiwiY2xpZW50X2lkIiwiam9iX3ZhbHVlIiwiTUFYX1BBWU1FTlRfQU1PVU5UIiwiY29ubmVjdCIsImFzc2lnbmVkX2hlbHBlcl9pZCIsImZyZXNoQ29ubmVjdCIsInJhd0pvYlZhbHVlQ2VudHMiLCJNYXRoIiwicm91bmQiLCJjb25zb2xlIiwibG9nIiwiaW50ZW50UmVzdWx0IiwiY2xpZW50IiwiY3JlZGl0UmVzdWx0IiwiYXZhaWxhYmxlQ3JlZGl0Q2VudHMiLCJtYXgiLCJwYXJzZUludCIsImJhbGFuY2VfY2VudHMiLCJhcHBsaWVkQ3JlZGl0Q2VudHMiLCJtaW4iLCJqb2JWYWx1ZUNlbnRzIiwiZmVlcyIsImV4aXN0aW5nUGF5bWVudCIsImV4aXN0aW5nUGkiLCJwYXltZW50SW50ZW50cyIsInN0cmlwZV9wYXltZW50X2ludGVudF9pZCIsInN0cmlwZUFjY291bnQiLCJyZXVzYWJsZVN0YXR1c2VzIiwiaW5jbHVkZXMiLCJzdGF0dXMiLCJyZXBsYXkiLCJzdGF0dXNDb2RlIiwiY2xpZW50X3NlY3JldCIsInBheW1lbnRfaW50ZW50X2lkIiwiY29kZSIsInJldHJpZXZlRXJyIiwiam9iSWQiLCJwYXltZW50SW50ZW50SWQiLCJhdHRlbXB0UmVzdWx0IiwicGF5bWVudEF0dGVtcHQiLCJOdW1iZXIiLCJhdHRlbXB0X2NvdW50IiwicGF5bWVudElkZW1wb3RlbmN5S2V5IiwicGF5bWVudEludGVudCIsImFtb3VudCIsImN1cnJlbmN5IiwicGF5bWVudF9tZXRob2RfdHlwZXMiLCJjYXB0dXJlX21ldGhvZCIsImFwcGxpY2F0aW9uX2ZlZV9hbW91bnQiLCJhcHBsaWNhdGlvbl9mZWVfY2VudHMiLCJ0b1N0cmluZyIsImhlbHBlcl9pZCIsInRpZXIiLCJwbGF0Zm9ybV9mZWVfY2VudHMiLCJpbnNlcnRSb3dzIiwiSlNPTiIsInN0cmluZ2lmeSIsImRpc2NvdW50ZWRfYW1vdW50X2NlbnRzIiwicmF3X2pvYl92YWx1ZV9jZW50cyIsImFwcGxpZWRfY3JlZGl0X2NlbnRzIiwiaW5zZXJ0RXJyIiwiZXhpc3RpbmdJbnRlbnQiLCJwYXltZW50X2lkIiwiaW5mbyIsImFwcGxpZWRfY3JlZGl0X2RvbGxhcnMiLCJ0b0ZpeGVkIiwicmVxdWVzdEluc3RhbnRQYXlvdXQiLCJhY2NvdW50UmVzdWx0IiwicmVmcmVzaGVkQWNjb3VudCIsImJhbGFuY2UiLCJhdmFpbGFibGUiLCJmaW5kIiwiYiIsInBheW91dCIsInBheW91dHMiLCJtZXRob2QiLCJEYXRlIiwidG9JU09TdHJpbmciLCJzbGljZSIsImFkbWluSWQiLCJhY3Rpb24iLCJ0YXJnZXRUeXBlIiwidGFyZ2V0SWQiLCJhZnRlciIsImFtb3VudF9jZW50cyIsInN0cmlwZV9zdGF0dXMiLCJ0aHJvd09uRXJyb3IiLCJjYXRjaCIsImF1ZGl0RXJyIiwicGF5b3V0X2lkIiwiZGlzY29ubmVjdENvbm5lY3RBY2NvdW50Iiwic3VjY2VzcyIsImRlbCIsInN0cmlwZUVyciIsImNhcHR1cmVQYXltZW50IiwicGF5bWVudCIsImRpc3B1dGUiLCJwYXltZW50RGF0YSIsImNoYXJnZV9pZCIsInN0cmlwZV9jaGFyZ2VfaWQiLCJpZGVtcG90ZW50IiwicXVldWVQYXltZW50Q2FwdHVyZSIsInBheW1lbnRJZCIsImNoYXJnZUlkIiwiY2FwRXJyIiwicmVsZWFzZSIsInJlZnVuZFBheW1lbnQiLCJyb2xlIiwicmVhc29uIiwicmV2ZXJzZV9hcHBsaWNhdGlvbl9mZWUiLCJoYXNSZXF1ZXN0ZWRBbW91bnQiLCJ1bmRlZmluZWQiLCJ0cmltIiwiaXNGaW5pdGUiLCJyZXF1ZXN0ZWRBbW91bnRDZW50cyIsInJldmVyc2VBcHBsaWNhdGlvbkZlZSIsImFjdG9yVXNlcklkIiwicmVxdWVzdElkIiwiZ2V0IiwicmVzcG9uc2VTdGF0dXMiLCJhdHRlbXB0IiwicmVmdW5kX2lkIiwic3RyaXBlX3JlZnVuZF9pZCIsInJlZnVuZF9zdGF0dXMiLCJyZWZ1bmRfYW1vdW50X2NlbnRzIiwiY3VtdWxhdGl2ZV9yZWZ1bmRlZF9hbW91bnQiLCJyZWZ1bmRlZF9hbW91bnQiLCJnZXRKb2JQYXltZW50IiwicGFyYW1zIiwicCIsInBheWVyX2lkIiwicGF5ZWVfaWQiLCJnZXRNeVBheW1lbnRzIiwibGltaXQiLCJvZmZzZXQiLCJmaWx0ZXJDb2wiLCJjb3VudFJvd3MiLCJwYXltZW50cyIsInRvdGFsIiwiY291bnQiLCJnZXRJbnZlc3RvclN1bW1hcnkiLCJfcmVxIiwic2FmZUNvdW50Iiwic3FsIiwiaGVscGVyc0Z1bmRlZCIsImFjdGl2ZU9wcG9ydHVuaXRpZXMiLCJyZXZlbnVlU2hhcmVDZW50cyIsIlByb21pc2UiLCJhbGwiLCJ0b3RhbF9pbnZlc3RlZF9jZW50cyIsImhlbHBlcnNfZnVuZGVkIiwicmV2ZW51ZV9zaGFyZV9jZW50cyIsImFjdGl2ZV9vcHBvcnR1bml0aWVzIl0sInNvdXJjZXMiOlsicGF5bWVudENvbnRyb2xsZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiY29uc3QgcG9vbCA9IHJlcXVpcmUoJy4uL2RiJyk7XG5jb25zdCBzdHJpcGUgPSByZXF1aXJlKCdzdHJpcGUnKShwcm9jZXNzLmVudi5TVFJJUEVfU0VDUkVUX0tFWSk7XG5jb25zdCB7IGNhbGN1bGF0ZVRpZXIzRmVlcyB9ID0gcmVxdWlyZSgnLi4vdXRpbHMvZmVlQ2FsY3VsYXRvcicpO1xuY29uc3QgeyB2YWxpZGF0ZSwgcnVsZXMgfSA9IHJlcXVpcmUoJy4uL3V0aWxzL3ZhbGlkYXRlJyk7XG5jb25zdCBsb2dnZXIgPSByZXF1aXJlKCcuLi91dGlscy9sb2dnZXInKTtcbmNvbnN0IHsgd2l0aFRyYW5zYWN0aW9uLCB3aXRoUGF5bWVudFRyYW5zYWN0aW9uIH0gPSByZXF1aXJlKCcuLi91dGlscy90cmFuc2FjdGlvbicpO1xuY29uc3QgeyBjYXB0dXJlQXV0aG9yaXplZFBheW1lbnQgfSA9IHJlcXVpcmUoJy4uL3NlcnZpY2VzL3BheW1lbnRDYXB0dXJlU2VydmljZScpO1xuY29uc3QgeyBwcm9jZXNzUGF5bWVudFJlZnVuZCB9ID0gcmVxdWlyZSgnLi4vc2VydmljZXMvcGF5bWVudFJlZnVuZFNlcnZpY2UnKTtcbmNvbnN0IHsgQXBwRXJyb3IgfSA9IHJlcXVpcmUoJy4uL21pZGRsZXdhcmUvZXJyb3JIYW5kbGVyJyk7XG5jb25zdCB7IGxvZ0FkbWluQWN0aW9uIH0gPSByZXF1aXJlKCcuLi9zZXJ2aWNlcy9hdWRpdFNlcnZpY2UnKTtcblxuLyoqIFdoZW4gdHJ1ZSwgY2FwdHVyZSBpcyBxdWV1ZWQgdG8gUmVkaXMgKHJlcXVpcmVzIHdvcmtlcikuIERlZmF1bHQgZmFsc2UgPSBjYXB0dXJlIGluLXJlcXVlc3Qgc28gZnVuZHMgcmVsZWFzZSB3aXRob3V0IGEgc2VwYXJhdGUgcHJvY2Vzcy4gKi9cbmZ1bmN0aW9uIGlzQXN5bmNQYXltZW50Q2FwdHVyZSgpIHtcbiAgcmV0dXJuIFN0cmluZyhwcm9jZXNzLmVudi5QQVlNRU5UX0NBUFRVUkVfQVNZTkMgfHwgJycpLnRvTG93ZXJDYXNlKCkgPT09ICd0cnVlJztcbn1cblxuZnVuY3Rpb24gZ2V0QXBwQmFzZVVybCgpIHtcbiAgcmV0dXJuIHByb2Nlc3MuZW52LkFQUF9VUkwgfHwgcHJvY2Vzcy5lbnYuQ0xJRU5UX1VSTCB8fCAnaHR0cHM6Ly9veHN0ZWVkLmNvbSc7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVBcHBCYXNlVXJsKCkge1xuICBjb25zdCBjYW5kaWRhdGVzID0gW1xuICAgIHByb2Nlc3MuZW52LkFQUF9VUkwsXG4gICAgcHJvY2Vzcy5lbnYuQ0xJRU5UX1VSTCxcbiAgICAnaHR0cHM6Ly9veHN0ZWVkLmNvbScsXG4gIF07XG5cbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgY2FuZGlkYXRlcykge1xuICAgIGlmICghY2FuZGlkYXRlKSBjb250aW51ZTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChjYW5kaWRhdGUpO1xuICAgICAgaWYgKHVybC5wcm90b2NvbCAhPT0gJ2h0dHBzOicgJiYgIShwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nICYmIHVybC5wcm90b2NvbCA9PT0gJ2h0dHA6JykpIGNvbnRpbnVlO1xuICAgICAgcmV0dXJuIHVybC5vcmlnaW47XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgLy8gRG8gbm90IHVzZSB1bnRydXN0ZWQgcmVxdWVzdCBPcmlnaW4sIFJlZmVyZXIgb3IgSG9zdCBmb3IgU3RyaXBlIHJlZGlyZWN0cy5cbiAgICB9XG4gIH1cblxuICByZXR1cm4gJ2h0dHBzOi8vb3hzdGVlZC5jb20nO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZWZyZXNoQ29ubmVjdEFjY291bnRTdGF0dXModXNlcklkLCBhY2NvdW50Um93KSB7XG4gIGlmICghYWNjb3VudFJvdykgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgdW5hdmFpbGFibGUgPSB7XG4gICAgLi4uYWNjb3VudFJvdyxcbiAgICBzdGF0dXNfdmVyaWZpZWQ6IGZhbHNlLFxuICAgIHN0YXR1c191bmF2YWlsYWJsZTogdHJ1ZSxcbiAgICBsYXN0X2tub3duX2NoYXJnZXNfZW5hYmxlZDogISFhY2NvdW50Um93LmNoYXJnZXNfZW5hYmxlZCxcbiAgICBsYXN0X2tub3duX3BheW91dHNfZW5hYmxlZDogISFhY2NvdW50Um93LnBheW91dHNfZW5hYmxlZCxcbiAgICBjaGFyZ2VzX2VuYWJsZWQ6IGZhbHNlLFxuICAgIHBheW91dHNfZW5hYmxlZDogZmFsc2UsXG4gIH07XG5cbiAgaWYgKCFwcm9jZXNzLmVudi5TVFJJUEVfU0VDUkVUX0tFWSB8fCAhYWNjb3VudFJvdy5zdHJpcGVfYWNjb3VudF9pZCkge1xuICAgIHJldHVybiB1bmF2YWlsYWJsZTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgYWNjb3VudCA9IGF3YWl0IHN0cmlwZS5hY2NvdW50cy5yZXRyaWV2ZShhY2NvdW50Um93LnN0cmlwZV9hY2NvdW50X2lkKTtcbiAgICBjb25zdCBjaGFyZ2VzRW5hYmxlZCA9ICEhYWNjb3VudC5jaGFyZ2VzX2VuYWJsZWQ7XG4gICAgY29uc3QgcGF5b3V0c0VuYWJsZWQgPSAhIWFjY291bnQucGF5b3V0c19lbmFibGVkO1xuICAgIGNvbnN0IG9uYm9hcmRpbmdDb21wbGV0ZSA9ICEhYWNjb3VudC5kZXRhaWxzX3N1Ym1pdHRlZCB8fCBjaGFyZ2VzRW5hYmxlZCB8fCBwYXlvdXRzRW5hYmxlZDtcbiAgICBjb25zdCBhY2NvdW50U3RhdHVzID0gY2hhcmdlc0VuYWJsZWRcbiAgICAgID8gJ2FjdGl2ZSdcbiAgICAgIDogKEFycmF5LmlzQXJyYXkoYWNjb3VudC5yZXF1aXJlbWVudHM/LmN1cnJlbnRseV9kdWUpICYmIGFjY291bnQucmVxdWlyZW1lbnRzLmN1cnJlbnRseV9kdWUubGVuZ3RoXG4gICAgICAgID8gJ3Jlc3RyaWN0ZWQnXG4gICAgICAgIDogJ3BlbmRpbmcnKTtcblxuICAgIGlmIChcbiAgICAgIGFjY291bnRSb3cuY2hhcmdlc19lbmFibGVkICE9PSBjaGFyZ2VzRW5hYmxlZCB8fFxuICAgICAgYWNjb3VudFJvdy5wYXlvdXRzX2VuYWJsZWQgIT09IHBheW91dHNFbmFibGVkIHx8XG4gICAgICBhY2NvdW50Um93Lm9uYm9hcmRpbmdfY29tcGxldGUgIT09IG9uYm9hcmRpbmdDb21wbGV0ZVxuICAgICkge1xuICAgICAgYXdhaXQgcG9vbC5xdWVyeShcbiAgICAgICAgYFVQREFURSBjb25uZWN0X2FjY291bnRzXG4gICAgICAgICAgICBTRVQgY2hhcmdlc19lbmFibGVkID0gJDIsXG4gICAgICAgICAgICAgICAgcGF5b3V0c19lbmFibGVkID0gJDMsXG4gICAgICAgICAgICAgICAgb25ib2FyZGluZ19jb21wbGV0ZSA9ICQ0LFxuICAgICAgICAgICAgICAgIHVwZGF0ZWRfYXQgPSBOT1coKVxuICAgICAgICAgIFdIRVJFIHVzZXJfaWQgPSAkMSBBTkQgc3RyaXBlX2FjY291bnRfaWQgPSAkNWAsXG4gICAgICAgIFt1c2VySWQsIGNoYXJnZXNFbmFibGVkLCBwYXlvdXRzRW5hYmxlZCwgb25ib2FyZGluZ0NvbXBsZXRlLCBhY2NvdW50Um93LnN0cmlwZV9hY2NvdW50X2lkXVxuICAgICAgKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uYWNjb3VudFJvdyxcbiAgICAgIHN0YXR1c192ZXJpZmllZDogdHJ1ZSxcbiAgICAgIGNoYXJnZXNfZW5hYmxlZDogY2hhcmdlc0VuYWJsZWQsXG4gICAgICBwYXlvdXRzX2VuYWJsZWQ6IHBheW91dHNFbmFibGVkLFxuICAgICAgb25ib2FyZGluZ19jb21wbGV0ZTogb25ib2FyZGluZ0NvbXBsZXRlLFxuICAgICAgYWNjb3VudF9zdGF0dXM6IGFjY291bnRTdGF0dXMsXG4gICAgICBkZXRhaWxzX3N1Ym1pdHRlZDogISFhY2NvdW50LmRldGFpbHNfc3VibWl0dGVkLFxuICAgICAgcmVxdWlyZW1lbnRzOiBhY2NvdW50LnJlcXVpcmVtZW50cyB8fCBudWxsLFxuICAgICAgY291bnRyeTogYWNjb3VudC5jb3VudHJ5IHx8IGFjY291bnRSb3cuY291bnRyeSB8fCBudWxsLFxuICAgICAgZGVmYXVsdF9jdXJyZW5jeTogYWNjb3VudC5kZWZhdWx0X2N1cnJlbmN5IHx8IGFjY291bnRSb3cuZGVmYXVsdF9jdXJyZW5jeSB8fCBudWxsLFxuICAgIH07XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdGYWlsZWQgdG8gcmVmcmVzaCBTdHJpcGUgQ29ubmVjdCBhY2NvdW50IHN0YXR1cycsIHtcbiAgICAgIHVzZXJJZCxcbiAgICAgIGFjY291bnRJZDogYWNjb3VudFJvdy5zdHJpcGVfYWNjb3VudF9pZCxcbiAgICAgIGVycm9yOiBlcnIubWVzc2FnZSxcbiAgICB9KTtcbiAgICByZXR1cm4gdW5hdmFpbGFibGU7XG4gIH1cbn1cblxuLyoqXG4gKiBQYXltZW50IENvbnRyb2xsZXIgLSBTdHJpcGUgQ29ubmVjdCBEaXJlY3QgQ2hhcmdlc1xuICpcbiAqIEFsbCBUaWVyIDMgcGF5bWVudHMgYXJlIGRpcmVjdCBjaGFyZ2VzIG9uIHRoZSBoZWxwZXIncyBjb25uZWN0ZWQgU3RyaXBlIGFjY291bnQuXG4gKiBUaGUgaGVscGVyIGlzIHRoZSBtZXJjaGFudCBvZiByZWNvcmQuIE94U3RlZWQgY29sbGVjdHMgcmV2ZW51ZSB2aWEgYXBwbGljYXRpb25fZmVlLlxuICogT3hTdGVlZCdzIHRvdGFsIHBsYXRmb3JtIGZlZSBpcyA3LjElIChvciAkNSBtaW4pIG9mIHRoZSBqb2IgdmFsdWUuXG4gKiBDYXJkIHByb2Nlc3NpbmcgZmVlcyBhbmQgY2hhcmdlYmFja3MgaGl0IHRoZSBoZWxwZXIncyBjb25uZWN0ZWQgYWNjb3VudC5cbiAqIE94U3RlZWQgbWF5IGNob29zZSB0byByZXZlcnNlIGl0cyBhcHBsaWNhdGlvbiBmZWUgaW4gZGlzcHV0ZXMgYnV0IGlzIG5vdCBvYmxpZ2F0ZWQuXG4gKi9cblxuLy8gQ3JlYXRlIENvbm5lY3QgYWNjb3VudCBmb3IgaGVscGVyIChvbmJvYXJkaW5nKVxuZXhwb3J0cy5jcmVhdGVDb25uZWN0QWNjb3VudCA9IGFzeW5jIChyZXEsIHJlcywgbmV4dCkgPT4ge1xuICB0cnkge1xuICAgIGlmICghcHJvY2Vzcy5lbnYuU1RSSVBFX1NFQ1JFVF9LRVkpIHtcbiAgICAgIHRocm93IG5ldyBBcHBFcnJvcignU3RyaXBlIGlzIG5vdCBjb25maWd1cmVkIG9uIHRoZSBzZXJ2ZXIuJywgNTAzLCAnc3RyaXBlX25vdF9jb25maWd1cmVkJyk7XG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBwb29sLnF1ZXJ5KCdTRUxFQ1QgKiBGUk9NIGNvbm5lY3RfYWNjb3VudHMgV0hFUkUgdXNlcl9pZCA9ICQxJywgW3JlcS51c2VyLmlkXSk7XG4gICAgaWYgKGV4aXN0aW5nLnJvd3NbMF0pIHtcbiAgICAgIGNvbnN0IGZyZXNoRXhpc3RpbmcgPSBhd2FpdCByZWZyZXNoQ29ubmVjdEFjY291bnRTdGF0dXMocmVxLnVzZXIuaWQsIGV4aXN0aW5nLnJvd3NbMF0pO1xuICAgICAgaWYgKGZyZXNoRXhpc3Rpbmcuc3RhdHVzX3ZlcmlmaWVkID09PSBmYWxzZSkge1xuICAgICAgICB0aHJvdyBuZXcgQXBwRXJyb3IoJ1N0cmlwZSBhY2NvdW50IHN0YXR1cyBpcyB0ZW1wb3JhcmlseSB1bmF2YWlsYWJsZS4gUGxlYXNlIHJldHJ5LicsIDUwMywgJ2Nvbm5lY3Rfc3RhdHVzX3VuYXZhaWxhYmxlJyk7XG4gICAgICB9XG4gICAgICBjb25zdCByZXF1aXJlbWVudHMgPSBmcmVzaEV4aXN0aW5nLnJlcXVpcmVtZW50cyB8fCB7fTtcbiAgICAgIGlmICghZnJlc2hFeGlzdGluZy5vbmJvYXJkaW5nX2NvbXBsZXRlIHx8ICFmcmVzaEV4aXN0aW5nLmNoYXJnZXNfZW5hYmxlZCB8fCAhZnJlc2hFeGlzdGluZy5wYXlvdXRzX2VuYWJsZWRcbiAgICAgICAgICB8fCByZXF1aXJlbWVudHMuY3VycmVudGx5X2R1ZT8ubGVuZ3RoIHx8IHJlcXVpcmVtZW50cy5wYXN0X2R1ZT8ubGVuZ3RoKSB7XG4gICAgICAgIGNvbnN0IGxpbmsgPSBhd2FpdCBzdHJpcGUuYWNjb3VudExpbmtzLmNyZWF0ZSh7XG4gICAgICAgICAgYWNjb3VudDogZnJlc2hFeGlzdGluZy5zdHJpcGVfYWNjb3VudF9pZCxcbiAgICAgICAgICByZWZyZXNoX3VybDogYCR7cmVzb2x2ZUFwcEJhc2VVcmwocmVxKX0vaGVscGVyLWRhc2hib2FyZD9yZWZyZXNoPXRydWVgLFxuICAgICAgICAgIHJldHVybl91cmw6IGAke3Jlc29sdmVBcHBCYXNlVXJsKHJlcSl9L2hlbHBlci1kYXNoYm9hcmQ/b25ib2FyZGluZz1jb21wbGV0ZWAsXG4gICAgICAgICAgdHlwZTogJ2FjY291bnRfb25ib2FyZGluZycsXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVzLmpzb24oeyB1cmw6IGxpbmsudXJsLCBvbmJvYXJkaW5nX3VybDogbGluay51cmwsIGFjY291bnRfaWQ6IGZyZXNoRXhpc3Rpbmcuc3RyaXBlX2FjY291bnRfaWQgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzLmpzb24oeyBtZXNzYWdlOiAnQWNjb3VudCBhbHJlYWR5IHNldCB1cCcsIGFjY291bnQ6IGZyZXNoRXhpc3RpbmcgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgYWNjb3VudCA9IGF3YWl0IHN0cmlwZS5hY2NvdW50cy5jcmVhdGUoe1xuICAgICAgdHlwZTogJ2V4cHJlc3MnLFxuICAgICAgY291bnRyeTogJ1VTJyxcbiAgICAgIGVtYWlsOiByZXEudXNlci5lbWFpbCxcbiAgICAgIGNhcGFiaWxpdGllczogeyBjYXJkX3BheW1lbnRzOiB7IHJlcXVlc3RlZDogdHJ1ZSB9LCB0cmFuc2ZlcnM6IHsgcmVxdWVzdGVkOiB0cnVlIH0gfSxcbiAgICAgIG1ldGFkYXRhOiB7IG94c3RlZWRfdXNlcl9pZDogU3RyaW5nKHJlcS51c2VyLmlkKSB9LFxuICAgIH0sIHsgaWRlbXBvdGVuY3lLZXk6IGBveHN0ZWVkLWNvbm5lY3QtYWNjb3VudDoke3JlcS51c2VyLmlkfWAgfSk7XG5cbiAgICBjb25zdCB7IHJvd3M6IHBlcnNpc3RlZCB9ID0gYXdhaXQgcG9vbC5xdWVyeShcbiAgICAgIGBJTlNFUlQgSU5UTyBjb25uZWN0X2FjY291bnRzICh1c2VyX2lkLCBzdHJpcGVfYWNjb3VudF9pZCkgVkFMVUVTICgkMSwgJDIpXG4gICAgICAgT04gQ09ORkxJQ1QgKHVzZXJfaWQpIERPIFVQREFURSBTRVQgc3RyaXBlX2FjY291bnRfaWQgPSBjb25uZWN0X2FjY291bnRzLnN0cmlwZV9hY2NvdW50X2lkXG4gICAgICAgUkVUVVJOSU5HIHN0cmlwZV9hY2NvdW50X2lkYCxcbiAgICAgIFtyZXEudXNlci5pZCwgYWNjb3VudC5pZF1cbiAgICApO1xuICAgIGNvbnN0IGFjY291bnRJZCA9IHBlcnNpc3RlZFswXT8uc3RyaXBlX2FjY291bnRfaWQ7XG4gICAgaWYgKCFhY2NvdW50SWQpIHRocm93IG5ldyBBcHBFcnJvcignUGF5bWVudCBhY2NvdW50IGNvdWxkIG5vdCBiZSBzYXZlZC4gUGxlYXNlIHJldHJ5LicsIDUwMywgJ2Nvbm5lY3RfYWNjb3VudF9wZXJzaXN0ZW5jZV9mYWlsZWQnKTtcblxuICAgIGNvbnN0IGxpbmsgPSBhd2FpdCBzdHJpcGUuYWNjb3VudExpbmtzLmNyZWF0ZSh7XG4gICAgICBhY2NvdW50OiBhY2NvdW50SWQsXG4gICAgICByZWZyZXNoX3VybDogYCR7cmVzb2x2ZUFwcEJhc2VVcmwocmVxKX0vaGVscGVyLWRhc2hib2FyZD9yZWZyZXNoPXRydWVgLFxuICAgICAgcmV0dXJuX3VybDogYCR7cmVzb2x2ZUFwcEJhc2VVcmwocmVxKX0vaGVscGVyLWRhc2hib2FyZD9vbmJvYXJkaW5nPWNvbXBsZXRlYCxcbiAgICAgIHR5cGU6ICdhY2NvdW50X29uYm9hcmRpbmcnLFxuICAgIH0pO1xuICAgIHJlcy5qc29uKHsgdXJsOiBsaW5rLnVybCwgb25ib2FyZGluZ191cmw6IGxpbmsudXJsLCBhY2NvdW50X2lkOiBhY2NvdW50SWQgfSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci5lcnJvcignQ3JlYXRlIGNvbm5lY3QgYWNjb3VudCBlcnJvcicsIHsgdXNlcklkOiByZXEudXNlcj8uaWQsIGVycm9yOiBlcnIubWVzc2FnZSB9KTtcbiAgICBuZXh0KGVyciBpbnN0YW5jZW9mIEFwcEVycm9yID8gZXJyIDogbmV3IEFwcEVycm9yKCdGYWlsZWQgdG8gY3JlYXRlIHBheW1lbnQgYWNjb3VudCcsIDUwMiwgJ2Nvbm5lY3RfYWNjb3VudF9jcmVhdGVfZmFpbGVkJykpO1xuICB9XG59O1xuXG4vLyBHZXQgQ29ubmVjdCBhY2NvdW50IHN0YXR1c1xuZXhwb3J0cy5nZXRDb25uZWN0U3RhdHVzID0gYXN5bmMgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gIHRyeSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcG9vbC5xdWVyeShcbiAgICAgICdTRUxFQ1QgdXNlcl9pZCwgc3RyaXBlX2FjY291bnRfaWQsIGNoYXJnZXNfZW5hYmxlZCwgcGF5b3V0c19lbmFibGVkLCBvbmJvYXJkaW5nX2NvbXBsZXRlIEZST00gY29ubmVjdF9hY2NvdW50cyBXSEVSRSB1c2VyX2lkID0gJDEnLFxuICAgICAgW3JlcS51c2VyLmlkXVxuICAgICk7XG4gICAgaWYgKCFyZXN1bHQucm93c1swXSkgcmV0dXJuIHJlcy5qc29uKHsgY29ubmVjdGVkOiBmYWxzZSB9KTtcbiAgICBjb25zdCByZWZyZXNoZWQgPSBhd2FpdCByZWZyZXNoQ29ubmVjdEFjY291bnRTdGF0dXMocmVxLnVzZXIuaWQsIHJlc3VsdC5yb3dzWzBdKTtcbiAgICByZXMuanNvbih7XG4gICAgICBjb25uZWN0ZWQ6IHRydWUsXG4gICAgICAuLi5yZWZyZXNoZWQsXG4gICAgICBzdHJpcGVfY29ubmVjdF9yZWFkeTogISFyZWZyZXNoZWQuY2hhcmdlc19lbmFibGVkLFxuICAgICAgc3RyaXBlX2Nvbm5lY3RfcGF5b3V0c19yZWFkeTogISFyZWZyZXNoZWQucGF5b3V0c19lbmFibGVkLFxuICAgICAgc3RyaXBlX2Nvbm5lY3Rfb25ib2FyZGVkOiAhIXJlZnJlc2hlZC5vbmJvYXJkaW5nX2NvbXBsZXRlLFxuICAgIH0pO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIuZXJyb3IoJ0dldCBjb25uZWN0IHN0YXR1cyBlcnJvcicsIHsgdXNlcklkOiByZXEudXNlcj8uaWQsIGVycm9yOiBlcnIubWVzc2FnZSB9KTtcbiAgICBuZXh0KG5ldyBBcHBFcnJvcignRmFpbGVkIHRvIGdldCBhY2NvdW50IHN0YXR1cycsIDUwMCwgJ2Nvbm5lY3Rfc3RhdHVzX2ZhaWxlZCcpKTtcbiAgfVxufTtcblxuLyoqXG4gKiBDcmVhdGUgYSBkaXJlY3QgY2hhcmdlIFBheW1lbnRJbnRlbnQgb24gdGhlIGhlbHBlcidzIGNvbm5lY3RlZCBTdHJpcGUgYWNjb3VudC5cbiAqXG4gKiBGbG93OlxuICogICAxLiBDdXN0b21lciBzZWxlY3RzIGEgaGVscGVyIGZvciBhIFRpZXIgMyBqb2IuXG4gKiAgIDIuIE94U3RlZWQgY3JlYXRlcyBhIFBheW1lbnRJbnRlbnQgYXMgYSBESVJFQ1QgQ0hBUkdFIG9uIHRoZSBoZWxwZXIncyBhY2NvdW50LlxuICogICAzLiBhcHBsaWNhdGlvbl9mZWVfYW1vdW50ID0gNy4xJSBvZiBqb2IgdmFsdWUgKG9yICQ1IG1pbikuXG4gKiAgIDQuIGNhcHR1cmVfbWV0aG9kOiAnbWFudWFsJyAtIGF1dGhvcml6ZSBub3csIGNhcHR1cmUgYWZ0ZXIgam9iIGNvbXBsZXRpb24uXG4gKiAgIDUuIFN0cmlwZSBwcm9jZXNzaW5nIGZlZXMgYXJlIGRlZHVjdGVkIGZyb20gdGhlIGhlbHBlcidzIGNoYXJnZS5cbiAqICAgNi4gT24gY2FwdHVyZSwgaGVscGVyIGdldHMgcGFpZCBhbmQgT3hTdGVlZCByZWNlaXZlcyBpdHMgYXBwbGljYXRpb25fZmVlLlxuICovXG5leHBvcnRzLmNyZWF0ZVBheW1lbnRJbnRlbnQgPSBhc3luYyAocmVxLCByZXMsIG5leHQpID0+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCB7IGpvYl9pZCB9ID0gcmVxLmJvZHk7XG5cbiAgICBjb25zdCBlcnJzID0gdmFsaWRhdGUocmVxLmJvZHksIHsgam9iX2lkOiBbcnVsZXMucmVxdWlyZWRdIH0pO1xuICAgIGlmIChlcnJzKSB7XG4gICAgICB0aHJvdyBuZXcgQXBwRXJyb3IoJ1ZhbGlkYXRpb24gZmFpbGVkJywgNDAwLCAndmFsaWRhdGlvbl9mYWlsZWQnLCBlcnJzKTtcbiAgICB9XG5cbiAgICBjb25zdCBqb2IgPSBhd2FpdCBwb29sLnF1ZXJ5KCdTRUxFQ1QgKiBGUk9NIGpvYnMgV0hFUkUgaWQgPSAkMScsIFtqb2JfaWRdKTtcbiAgICBpZiAoIWpvYi5yb3dzWzBdKSB7XG4gICAgICB0aHJvdyBuZXcgQXBwRXJyb3IoJ0pvYiBub3QgZm91bmQnLCA0MDQsICdqb2Jfbm90X2ZvdW5kJyk7XG4gICAgfVxuICAgIGlmIChqb2Iucm93c1swXS5jbGllbnRfaWQgIT09IHJlcS51c2VyLmlkKSB7XG4gICAgICB0aHJvdyBuZXcgQXBwRXJyb3IoJ05vdCBhdXRob3JpemVkIHRvIGNyZWF0ZSBwYXltZW50IGZvciB0aGlzIGpvYicsIDQwMywgJ2ZvcmJpZGRlbicpO1xuICAgIH1cbiAgICBpZiAoIWpvYi5yb3dzWzBdLmpvYl92YWx1ZSkge1xuICAgICAgdGhyb3cgbmV3IEFwcEVycm9yKCdObyBhZ3JlZWQgcHJpY2Ugc2V0IGZvciB0aGlzIGpvYicsIDQwMCwgJ21pc3Npbmdfam9iX3ZhbHVlJyk7XG4gICAgfVxuXG4gICAgLy8gU0VDVVJJVFk6IFByZXZlbnQgYWNjaWRlbnRhbCBvciBtYWxpY2lvdXMgcGF5bWVudHMgb2YgYWJzdXJkbHkgbGFyZ2UgYW1vdW50c1xuICAgIC8vIE1heCBzaW5nbGUgcGF5bWVudDogJDUwLDAwMCAoY2FuIGJlIG92ZXJyaWRkZW4gb25seSBieSBzdXBlcl9hZG1pbiBpZiBuZWVkZWQpXG4gICAgY29uc3QgTUFYX1BBWU1FTlRfQU1PVU5UID0gNTAwMDA7XG4gICAgaWYgKGpvYi5yb3dzWzBdLmpvYl92YWx1ZSA+IE1BWF9QQVlNRU5UX0FNT1VOVCkge1xuICAgICAgdGhyb3cgbmV3IEFwcEVycm9yKGBQYXltZW50IGFtb3VudCBleGNlZWRzIG1heGltdW0gYWxsb3dlZCAoJCR7TUFYX1BBWU1FTlRfQU1PVU5UfSlgLCA0MDAsICdwYXltZW50X2Ftb3VudF90b29fbGFyZ2UnLCB7XG4gICAgICAgIGpvYl92YWx1ZTogYE1heGltdW0gcGF5bWVudCBpcyAkJHtNQVhfUEFZTUVOVF9BTU9VTlR9LiBDb250YWN0IHN1cHBvcnQgZm9yIGV4Y2VwdGlvbnMuYFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgY29ubmVjdCA9IGF3YWl0IHBvb2wucXVlcnkoJ1NFTEVDVCAqIEZST00gY29ubmVjdF9hY2NvdW50cyBXSEVSRSB1c2VyX2lkID0gJDEnLCBbam9iLnJvd3NbMF0uYXNzaWduZWRfaGVscGVyX2lkXSk7XG4gICAgY29uc3QgZnJlc2hDb25uZWN0ID0gYXdhaXQgcmVmcmVzaENvbm5lY3RBY2NvdW50U3RhdHVzKGpvYi5yb3dzWzBdLmFzc2lnbmVkX2hlbHBlcl9pZCwgY29ubmVjdC5yb3dzWzBdIHx8IG51bGwpO1xuICAgIGlmICghZnJlc2hDb25uZWN0IHx8ICFmcmVzaENvbm5lY3QuY2hhcmdlc19lbmFibGVkKSB7XG4gICAgICB0aHJvdyBuZXcgQXBwRXJyb3IoXG4gICAgICAgICdUaGlzIGhlbHBlciBpcyBub3QgcmVhZHkgZm9yIHByb3RlY3RlZCBwYXltZW50IGNhcHR1cmUgeWV0LiBVc2UgdGhlIGRpcmVjdCBwYXltZW50IGFuZCBwcm9vZiBmbG93IGluc3RlYWQuJyxcbiAgICAgICAgNDAwLFxuICAgICAgICAnaGVscGVyX2FjY291bnRfbm90X3JlYWR5J1xuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCByYXdKb2JWYWx1ZUNlbnRzID0gTWF0aC5yb3VuZChqb2Iucm93c1swXS5qb2JfdmFsdWUgKiAxMDApO1xuXG4gICAgLy8g4pSA4pSAIEFwcGx5IHJlZmVycmFsIGNyZWRpdHMgKHJlZHVjZXMgYW1vdW50IGNoYXJnZWQgdG8gY3VzdG9tZXIpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIEgxMzogdGhlIGNyZWRpdCBiYWxhbmNlIHJlYWQsIHRoZSBTdHJpcGUgaW50ZW50LCB0aGUgcGF5bWVudHMgcm93LCBhbmRcbiAgICAvLyB0aGUgY3JlZGl0X2FwcGxpZWQgbGVkZ2VyIHdyaXRlIGFsbCBoYXBwZW4gaW5zaWRlIG9uZSB0cmFuc2FjdGlvbiB1bmRlclxuICAgIC8vIGEgcGVyLXVzZXIgYWR2aXNvcnkgbG9jaywgc28gY29uY3VycmVudCBwYXltZW50cyBjYW5ub3Qgc3BlbmQgdGhlIHNhbWVcbiAgICAvLyBjcmVkaXQgdHdpY2UuIFRoZSBESVNDT1VOVEVEIGFtb3VudCBpcyBjYXJyaWVkIGludG8gdGhlIGludGVudCwgdGhlXG4gICAgLy8gcGF5bWVudHMgcm93LCBhbmQgY2FwdHVyZSAocHJldmlvdXNseSB0aGUgcm93IHN0b3JlZCB0aGUgZnVsbCBqb2IgdmFsdWVcbiAgICAvLyB3aGlsZSBTdHJpcGUgb25seSBhdXRob3JpemVkIHRoZSBkaXNjb3VudGVkIGFtb3VudCwgc28gY2FwdHVyZSBhc2tlZFxuICAgIC8vIGZvciBtb3JlIHRoYW4gYXV0aG9yaXplZCB3aGVuZXZlciBjcmVkaXRzIHdlcmUgYXBwbGllZCkuXG4gICAgY29uc29sZS5sb2coXCJJTlRFTlRfV0lUSF9UWFwiKTtcbiAgICBjb25zdCBpbnRlbnRSZXN1bHQgPSBhd2FpdCB3aXRoVHJhbnNhY3Rpb24ocG9vbCwgYXN5bmMgKGNsaWVudCkgPT4ge1xuICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KFxuICAgICAgICBgU0VMRUNUIHBnX2Fkdmlzb3J5X3hhY3RfbG9jayhoYXNodGV4dGV4dGVuZGVkKCQxLCAwKSlgLFxuICAgICAgICBbYHBheW1lbnQtY3JlZGl0OiR7cmVxLnVzZXIuaWR9YF1cbiAgICAgICk7XG5cbiAgICAgIC8vIFF1ZXJ5IHNwZW5kYWJsZSBjcmVkaXQgYmFsYW5jZTogcmVmZXJyYWxfY3JlZGl0ICsgZGlzcHV0ZV9jcmVkaXQgKyBwcm9tb19jcmVkaXRcbiAgICAgIC8vIG1pbnVzIGFueSBwcmV2aW91c2x5IGFwcGxpZWQgY3JlZGl0cy5cbiAgICAgIGNvbnN0IGNyZWRpdFJlc3VsdCA9IGF3YWl0IGNsaWVudC5xdWVyeShcbiAgICAgICAgYFNFTEVDVCBDT0FMRVNDRShTVU0oXG4gICAgICAgICAgIENBU0UgV0hFTiB0eXBlIElOICgncmVmZXJyYWxfY3JlZGl0JywgJ2Rpc3B1dGVfY3JlZGl0JywgJ3Byb21vX2NyZWRpdCcpIFRIRU4gYW1vdW50X2NlbnRzXG4gICAgICAgICAgICAgICAgV0hFTiB0eXBlID0gJ2NyZWRpdF9hcHBsaWVkJyBUSEVOIC1hbW91bnRfY2VudHNcbiAgICAgICAgICAgICAgICBFTFNFIDBcbiAgICAgICAgICAgRU5EXG4gICAgICAgICApLCAwKSBBUyBiYWxhbmNlX2NlbnRzXG4gICAgICAgICBGUk9NIHBsYXRmb3JtX2xlZGdlclxuICAgICAgICAgV0hFUkUgdXNlcl9pZCA9ICQxYCxcbiAgICAgICAgW3JlcS51c2VyLmlkXVxuICAgICAgKTtcbiAgICAgIGNvbnN0IGF2YWlsYWJsZUNyZWRpdENlbnRzID0gTWF0aC5tYXgoMCwgcGFyc2VJbnQoY3JlZGl0UmVzdWx0LnJvd3M/LlswXT8uYmFsYW5jZV9jZW50cyB8fCAnMCcsIDEwKSk7XG4gICAgICAvLyBDYXAgY3JlZGl0IGF0IGpvYiB2YWx1ZSDigJQgY2FuJ3QgZ28gYmVsb3cgJDAuNTAgKFN0cmlwZSBtaW5pbXVtKVxuICAgICAgY29uc3QgYXBwbGllZENyZWRpdENlbnRzID0gTWF0aC5taW4oYXZhaWxhYmxlQ3JlZGl0Q2VudHMsIE1hdGgubWF4KDAsIHJhd0pvYlZhbHVlQ2VudHMgLSA1MCkpO1xuICAgICAgY29uc3Qgam9iVmFsdWVDZW50cyA9IHJhd0pvYlZhbHVlQ2VudHMgLSBhcHBsaWVkQ3JlZGl0Q2VudHM7XG5cbiAgICAgIGNvbnN0IGZlZXMgPSBjYWxjdWxhdGVUaWVyM0ZlZXMoam9iVmFsdWVDZW50cyk7XG5cbiAgICAgIC8vIENoZWNrIGZvciBleGlzdGluZyBwYXltZW50IHRvIHByZXZlbnQgZHVwbGljYXRlcyAoaWRlbXBvdGVuY3kpLlxuICAgICAgLy8gV2UgbXVzdCByZXR1cm4gdGhlIGFjdHVhbCBgY2xpZW50X3NlY3JldGAgZnJvbSBTdHJpcGUg4oCUIG5vdCB0aGUgUGF5bWVudEludGVudFxuICAgICAgLy8gSUQg4oCUIGJlY2F1c2UgdGhlIGZyb250ZW5kIHVzZXMgaXQgdG8gY29uZmlybSB0aGUgY2FyZCBvbiB0aGUgY2xpZW50LlxuICAgICAgY29uc3QgZXhpc3RpbmdQYXltZW50ID0gYXdhaXQgY2xpZW50LnF1ZXJ5KFxuICAgICAgICAnU0VMRUNUIGlkLCBzdHJpcGVfcGF5bWVudF9pbnRlbnRfaWQsIHN0cmlwZV9hY2NvdW50X2lkIEZST00gcGF5bWVudHMgV0hFUkUgam9iX2lkID0gJDEgQU5EIHN0YXR1cyBJTiAoJDIsICQzKScsXG4gICAgICAgIFtqb2JfaWQsICdhdXRob3JpemVkJywgJ3BlbmRpbmcnXVxuICAgICAgKTtcbiAgICAgIGlmIChleGlzdGluZ1BheW1lbnQucm93c1swXSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nUGkgPSBhd2FpdCBzdHJpcGUucGF5bWVudEludGVudHMucmV0cmlldmUoXG4gICAgICAgICAgICBleGlzdGluZ1BheW1lbnQucm93c1swXS5zdHJpcGVfcGF5bWVudF9pbnRlbnRfaWQsXG4gICAgICAgICAgICB7IHN0cmlwZUFjY291bnQ6IGV4aXN0aW5nUGF5bWVudC5yb3dzWzBdLnN0cmlwZV9hY2NvdW50X2lkIH1cbiAgICAgICAgICApO1xuICAgICAgICAgIC8vIE9ubHkgcmV1c2UgUElzIHRoYXQgYXJlIHN0aWxsIGluIGEgY29uZmlybWFibGUgc3RhdGUuIEFueXRoaW5nIHBhc3RcbiAgICAgICAgICAvLyBgcmVxdWlyZXNfY2FwdHVyZWAgKG9yIHRlcm1pbmFsKSBtZWFucyB0aGUgY3VzdG9tZXIgYWxyZWFkeSBwYWlkO1xuICAgICAgICAgIC8vIHJldHVybmluZyB0aGF0IHNlY3JldCB3b3VsZCBsZXQgdGhlbSByZS1wYXkgYW4gYXV0aG9yaXplZCBpbnRlbnQuXG4gICAgICAgICAgY29uc3QgcmV1c2FibGVTdGF0dXNlcyA9IFsncmVxdWlyZXNfcGF5bWVudF9tZXRob2QnLCAncmVxdWlyZXNfY29uZmlybWF0aW9uJywgJ3JlcXVpcmVzX2FjdGlvbiddO1xuICAgICAgICAgIGlmIChyZXVzYWJsZVN0YXR1c2VzLmluY2x1ZGVzKGV4aXN0aW5nUGkuc3RhdHVzKSkge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgcmVwbGF5OiB0cnVlLFxuICAgICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICAgIGJvZHk6IHtcbiAgICAgICAgICAgICAgICBjbGllbnRfc2VjcmV0OiBleGlzdGluZ1BpLmNsaWVudF9zZWNyZXQsXG4gICAgICAgICAgICAgICAgcGF5bWVudF9pbnRlbnRfaWQ6IGV4aXN0aW5nUGkuaWQsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogJ0V4aXN0aW5nIHBheW1lbnQgaW50ZW50IHJldHVybmVkJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIFBJIGlzIGFscmVhZHkgYXV0aG9yaXplZC9jYXB0dXJlZC9jYW5jZWxsZWQg4oCUIHN1cmZhY2Ugc3RhdGUgdG8gY2xpZW50XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHJlcGxheTogdHJ1ZSxcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDQwOSxcbiAgICAgICAgICAgIGJvZHk6IHtcbiAgICAgICAgICAgICAgZXJyb3I6IGBQYXltZW50IGFscmVhZHkgJHtleGlzdGluZ1BpLnN0YXR1c30uIFJlZnJlc2ggdGhlIHBhZ2UgdG8gc2VlIGN1cnJlbnQgc3RhdGUuYCxcbiAgICAgICAgICAgICAgY29kZTogJ3BheW1lbnRfYWxyZWFkeV9leGlzdHMnLFxuICAgICAgICAgICAgICBwYXltZW50X2ludGVudF9pZDogZXhpc3RpbmdQaS5pZCxcbiAgICAgICAgICAgICAgc3RhdHVzOiBleGlzdGluZ1BpLnN0YXR1cyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfTtcbiAgICAgICAgfSBjYXRjaCAocmV0cmlldmVFcnIpIHtcbiAgICAgICAgICBsb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byByZXRyaWV2ZSBleGlzdGluZyBQYXltZW50SW50ZW50IGR1cmluZyBpZGVtcG90ZW5jeSBjaGVjaycsIHtcbiAgICAgICAgICAgIGpvYklkOiBqb2JfaWQsIHBheW1lbnRJbnRlbnRJZDogZXhpc3RpbmdQYXltZW50LnJvd3NbMF0uc3RyaXBlX3BheW1lbnRfaW50ZW50X2lkLCBlcnJvcjogcmV0cmlldmVFcnIubWVzc2FnZSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICB0aHJvdyBuZXcgQXBwRXJyb3IoXG4gICAgICAgICAgICAnV2UgY291bGQgbm90IHZlcmlmeSB0aGUgZXhpc3RpbmcgcGF5bWVudCBhdHRlbXB0LiBQbGVhc2UgdHJ5IGFnYWluIHNob3J0bHkuJyxcbiAgICAgICAgICAgIDUwMyxcbiAgICAgICAgICAgICdwYXltZW50X3ZlcmlmaWNhdGlvbl91bmF2YWlsYWJsZSdcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIEEgbmV3IGF0dGVtcHQgZ2V0cyBhIG5ldyBpZGVtcG90ZW5jeSBrZXksIHdoaWxlIGNvbmN1cnJlbnQgcmVxdWVzdHMgdGhhdFxuICAgICAgLy8gb2JzZXJ2ZWQgdGhlIHNhbWUgY291bnQgc3RpbGwgY29sbGFwc2UgaW50byBvbmUgU3RyaXBlIHJlcXVlc3QuXG4gICAgICBjb25zdCBhdHRlbXB0UmVzdWx0ID0gYXdhaXQgY2xpZW50LnF1ZXJ5KFxuICAgICAgICAnU0VMRUNUIENPVU5UKCopOjppbnQgQVMgYXR0ZW1wdF9jb3VudCBGUk9NIHBheW1lbnRzIFdIRVJFIGpvYl9pZCA9ICQxJyxcbiAgICAgICAgW2pvYl9pZF1cbiAgICAgICk7XG4gICAgICBjb25zdCBwYXltZW50QXR0ZW1wdCA9IE51bWJlcihhdHRlbXB0UmVzdWx0LnJvd3NbMF0/LmF0dGVtcHRfY291bnQgfHwgMCkgKyAxO1xuICAgICAgY29uc3QgcGF5bWVudElkZW1wb3RlbmN5S2V5ID0gYGpvYi1wYXltZW50OiR7am9iX2lkfToke3BheW1lbnRBdHRlbXB0fWA7XG5cbiAgICAgIC8vIERpcmVjdCBjaGFyZ2Ugb24gaGVscGVyJ3MgY29ubmVjdGVkIGFjY291bnRcbiAgICAgIC8vIFJldHJpZXMgYW5kIGNvbmN1cnJlbnQgYnJvd3NlciByZXF1ZXN0cyBmb3Igb25lIGpvYiBtdXN0IHJlc29sdmUgdG8gdGhlXG4gICAgICAvLyBzYW1lIFN0cmlwZSBpbnRlbnQgcmF0aGVyIHRoYW4gY3JlYXRpbmcgbXVsdGlwbGUgYXV0aG9yaXphdGlvbnMuXG4gICAgICBjb25zdCBwYXltZW50SW50ZW50ID0gYXdhaXQgc3RyaXBlLnBheW1lbnRJbnRlbnRzLmNyZWF0ZShcbiAgICAgICAge1xuICAgICAgICAgIGFtb3VudDogam9iVmFsdWVDZW50cyxcbiAgICAgICAgICBjdXJyZW5jeTogJ3VzZCcsXG4gICAgICAgICAgcGF5bWVudF9tZXRob2RfdHlwZXM6IFsnY2FyZCddLFxuICAgICAgICAgIGNhcHR1cmVfbWV0aG9kOiAnbWFudWFsJyxcbiAgICAgICAgICBhcHBsaWNhdGlvbl9mZWVfYW1vdW50OiBmZWVzLmFwcGxpY2F0aW9uX2ZlZV9jZW50cyxcbiAgICAgICAgICBtZXRhZGF0YToge1xuICAgICAgICAgICAgam9iX2lkOiBqb2JfaWQudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIGNsaWVudF9pZDogcmVxLnVzZXIuaWQudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIGhlbHBlcl9pZDogam9iLnJvd3NbMF0uYXNzaWduZWRfaGVscGVyX2lkLnRvU3RyaW5nKCksXG4gICAgICAgICAgICB0aWVyOiAndGllcjMnLFxuICAgICAgICAgICAgcGxhdGZvcm1fZmVlX2NlbnRzOiBmZWVzLnBsYXRmb3JtX2ZlZV9jZW50cy50b1N0cmluZygpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBzdHJpcGVBY2NvdW50OiBmcmVzaENvbm5lY3Quc3RyaXBlX2FjY291bnRfaWQsXG4gICAgICAgICAgaWRlbXBvdGVuY3lLZXk6IHBheW1lbnRJZGVtcG90ZW5jeUtleSxcbiAgICAgICAgfVxuICAgICAgKTtcblxuICAgICAgbGV0IGluc2VydFJvd3M7XG4gICAgICB0cnkge1xuICAgICAgICAoeyByb3dzOiBpbnNlcnRSb3dzIH0gPSBhd2FpdCBjbGllbnQucXVlcnkoXG4gICAgICAgICAgYElOU0VSVCBJTlRPIHBheW1lbnRzXG4gICAgICAgICAgICAoam9iX2lkLCBwYXllcl9pZCwgcGF5ZWVfaWQsIHN0cmlwZV9wYXltZW50X2ludGVudF9pZCxcbiAgICAgICAgICAgICBhbW91bnQsIHBsYXRmb3JtX2ZlZSwgc3RhdHVzLCBwYXltZW50X2hvbGRfc3RhdHVzLCBzdHJpcGVfYWNjb3VudF9pZCwgbWV0YWRhdGEpXG4gICAgICAgICAgIFZBTFVFUyAoJDEsICQyLCAkMywgJDQsICQ1LCAkNiwgJ2F1dGhvcml6ZWQnLCAnaGVsZCcsICQ3LCAkODo6anNvbmIpXG4gICAgICAgICAgIFJFVFVSTklORyBpZGAsXG4gICAgICAgICAgW1xuICAgICAgICAgICAgam9iX2lkLFxuICAgICAgICAgICAgcmVxLnVzZXIuaWQsXG4gICAgICAgICAgICBqb2Iucm93c1swXS5hc3NpZ25lZF9oZWxwZXJfaWQsXG4gICAgICAgICAgICBwYXltZW50SW50ZW50LmlkLFxuICAgICAgICAgICAgam9iVmFsdWVDZW50cyAvIDEwMCxcbiAgICAgICAgICAgIGZlZXMucGxhdGZvcm1fZmVlX2NlbnRzIC8gMTAwLFxuICAgICAgICAgICAgZnJlc2hDb25uZWN0LnN0cmlwZV9hY2NvdW50X2lkLFxuICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICBkaXNjb3VudGVkX2Ftb3VudF9jZW50czogam9iVmFsdWVDZW50cyxcbiAgICAgICAgICAgICAgcmF3X2pvYl92YWx1ZV9jZW50czogcmF3Sm9iVmFsdWVDZW50cyxcbiAgICAgICAgICAgICAgYXBwbGllZF9jcmVkaXRfY2VudHM6IGFwcGxpZWRDcmVkaXRDZW50cyxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIF1cbiAgICAgICAgKSk7XG4gICAgICB9IGNhdGNoIChpbnNlcnRFcnIpIHtcbiAgICAgICAgLy8gQSBjb25jdXJyZW50IHJlcXVlc3QgbWF5IGhhdmUgaW5zZXJ0ZWQgdGhlIHNhbWUgaWRlbXBvdGVudCBTdHJpcGVcbiAgICAgICAgLy8gaW50ZW50IGZpcnN0LiBSZXR1cm4gaXQgcmF0aGVyIHRoYW4gcmV0cnlpbmcgdGhlIGV4dGVybmFsIGNoYXJnZS5cbiAgICAgICAgaWYgKGluc2VydEVyci5jb2RlICE9PSAnMjM1MDUnKSB0aHJvdyBpbnNlcnRFcnI7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nSW50ZW50ID0gYXdhaXQgY2xpZW50LnF1ZXJ5KFxuICAgICAgICAgIGBTRUxFQ1QgaWQgRlJPTSBwYXltZW50c1xuICAgICAgICAgICAgV0hFUkUgc3RyaXBlX3BheW1lbnRfaW50ZW50X2lkID0gJDFcbiAgICAgICAgICAgIExJTUlUIDFgLFxuICAgICAgICAgIFtwYXltZW50SW50ZW50LmlkXVxuICAgICAgICApO1xuICAgICAgICBpZiAoIWV4aXN0aW5nSW50ZW50LnJvd3NbMF0pIHRocm93IGluc2VydEVycjtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICByZXBsYXk6IHRydWUsXG4gICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgICAgIGJvZHk6IHtcbiAgICAgICAgICAgIGNsaWVudF9zZWNyZXQ6IHBheW1lbnRJbnRlbnQuY2xpZW50X3NlY3JldCxcbiAgICAgICAgICAgIHBheW1lbnRfaW50ZW50X2lkOiBwYXltZW50SW50ZW50LmlkLFxuICAgICAgICAgICAgbWVzc2FnZTogJ0V4aXN0aW5nIHBheW1lbnQgaW50ZW50IHJldHVybmVkJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICBpZiAoaW5zZXJ0Um93cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEFwcEVycm9yKCdGYWlsZWQgdG8gc2F2ZSBwYXltZW50IGludGVudCB0byBkYXRhYmFzZScsIDUwMCwgJ3BheW1lbnRfc2F2ZV9mYWlsZWQnKTtcbiAgICAgIH1cblxuICAgICAgLy8gUmVjb3JkIHRoZSBjcmVkaXQgZGVkdWN0aW9uIHNvIGl0IGNhbid0IGJlIGRvdWJsZS1zcGVudFxuICAgICAgaWYgKGFwcGxpZWRDcmVkaXRDZW50cyA+IDApIHtcbiAgICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KFxuICAgICAgICAgIGBJTlNFUlQgSU5UTyBwbGF0Zm9ybV9sZWRnZXIgKHVzZXJfaWQsIHR5cGUsIGFtb3VudF9jZW50cywgZGVzY3JpcHRpb24sIG1ldGFkYXRhKVxuICAgICAgICAgICBWQUxVRVMgKCQxLCAnY3JlZGl0X2FwcGxpZWQnLCAkMiwgJ1JlZmVycmFsIGNyZWRpdCBhcHBsaWVkIHRvIGpvYiBwYXltZW50JywgJDMpYCxcbiAgICAgICAgICBbcmVxLnVzZXIuaWQsIGFwcGxpZWRDcmVkaXRDZW50cywgSlNPTi5zdHJpbmdpZnkoeyBqb2JfaWQsIHBheW1lbnRfaWQ6IGluc2VydFJvd3NbMF0uaWQgfSldXG4gICAgICAgICk7XG4gICAgICAgIGxvZ2dlci5pbmZvKGBBcHBsaWVkICR7YXBwbGllZENyZWRpdENlbnRzfcKiIGNyZWRpdCBmb3IgdXNlciAke3JlcS51c2VyLmlkfSBvbiBqb2IgJHtqb2JfaWR9YCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHJlcGxheTogZmFsc2UsXG4gICAgICAgIHBheW1lbnRJbnRlbnQsXG4gICAgICAgIGFwcGxpZWRDcmVkaXRDZW50cyxcbiAgICAgICAgam9iVmFsdWVDZW50cyxcbiAgICAgIH07XG4gICAgfSwgJ3BheW1lbnRfY3JlYXRlX2ludGVudCcpO1xuXG4gICAgaWYgKGludGVudFJlc3VsdC5yZXBsYXkpIHtcbiAgICAgIHJldHVybiByZXMuc3RhdHVzKGludGVudFJlc3VsdC5zdGF0dXNDb2RlKS5qc29uKGludGVudFJlc3VsdC5ib2R5KTtcbiAgICB9XG5cbiAgICBjb25zdCB7IHBheW1lbnRJbnRlbnQsIGFwcGxpZWRDcmVkaXRDZW50cyB9ID0gaW50ZW50UmVzdWx0O1xuXG4gICAgcmVzLmpzb24oe1xuICAgICAgY2xpZW50X3NlY3JldDogcGF5bWVudEludGVudC5jbGllbnRfc2VjcmV0LFxuICAgICAgcGF5bWVudF9pbnRlbnRfaWQ6IHBheW1lbnRJbnRlbnQuaWQsXG4gICAgICBhcHBsaWVkX2NyZWRpdF9jZW50czogYXBwbGllZENyZWRpdENlbnRzLFxuICAgICAgYXBwbGllZF9jcmVkaXRfZG9sbGFyczogKGFwcGxpZWRDcmVkaXRDZW50cyAvIDEwMCkudG9GaXhlZCgyKSxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbmV4dChlcnIpO1xuICB9XG59O1xuXG5leHBvcnRzLnJlcXVlc3RJbnN0YW50UGF5b3V0ID0gYXN5bmMgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gIHRyeSB7XG4gICAgY29uc3QgYWNjb3VudFJlc3VsdCA9IGF3YWl0IHBvb2wucXVlcnkoXG4gICAgICAnU0VMRUNUICogRlJPTSBjb25uZWN0X2FjY291bnRzIFdIRVJFIHVzZXJfaWQgPSAkMScsXG4gICAgICBbcmVxLnVzZXIuaWRdXG4gICAgKTtcbiAgICBjb25zdCBhY2NvdW50ID0gYWNjb3VudFJlc3VsdC5yb3dzWzBdO1xuICAgIGNvbnN0IHJlZnJlc2hlZEFjY291bnQgPSBhd2FpdCByZWZyZXNoQ29ubmVjdEFjY291bnRTdGF0dXMocmVxLnVzZXIuaWQsIGFjY291bnQgfHwgbnVsbCk7XG4gICAgaWYgKCFyZWZyZXNoZWRBY2NvdW50KSB7XG4gICAgICB0aHJvdyBuZXcgQXBwRXJyb3IoJ0Nvbm5lY3QgYWNjb3VudCBub3QgZm91bmQuIENvbXBsZXRlIHBheW91dCBzZXR1cCBmaXJzdC4nLCA0MDQsICdjb25uZWN0X2FjY291bnRfbm90X2ZvdW5kJyk7XG4gICAgfVxuICAgIGlmICghcmVmcmVzaGVkQWNjb3VudC5wYXlvdXRzX2VuYWJsZWQpIHtcbiAgICAgIHRocm93IG5ldyBBcHBFcnJvcignUGF5b3V0cyBhcmUgbm90IGVuYWJsZWQgeWV0LiBGaW5pc2ggU3RyaXBlIG9uYm9hcmRpbmcgYmVmb3JlIHJlcXVlc3RpbmcgaW5zdGFudCBwYXlvdXQuJywgNDAwLCAncGF5b3V0c19ub3RfZW5hYmxlZCcpO1xuICAgIH1cblxuICAgIGlmICghcHJvY2Vzcy5lbnYuU1RSSVBFX1NFQ1JFVF9LRVkpIHtcbiAgICAgIHJldHVybiByZXMuc3RhdHVzKDIwMikuanNvbih7XG4gICAgICAgIHN0YXR1czogJ3BlbmRpbmcnLFxuICAgICAgICBtZXNzYWdlOiAnUGF5b3V0IGFjY291bnQgaXMgcmVhZHkuIFN0cmlwZSBpcyBub3QgY29uZmlndXJlZCBpbiB0aGlzIGVudmlyb25tZW50LCBzbyBubyBwYXlvdXQgd2FzIGNyZWF0ZWQuJyxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGJhbGFuY2UgPSBhd2FpdCBzdHJpcGUuYmFsYW5jZS5yZXRyaWV2ZSh7IHN0cmlwZUFjY291bnQ6IHJlZnJlc2hlZEFjY291bnQuc3RyaXBlX2FjY291bnRfaWQgfSk7XG4gICAgY29uc3QgYXZhaWxhYmxlID0gKGJhbGFuY2UuYXZhaWxhYmxlIHx8IFtdKS5maW5kKChiKSA9PiBTdHJpbmcoYi5jdXJyZW5jeSkudG9Mb3dlckNhc2UoKSA9PT0gJ3VzZCcpO1xuICAgIGNvbnN0IGFtb3VudCA9IGF2YWlsYWJsZT8uYW1vdW50IHx8IDA7XG4gICAgaWYgKGFtb3VudCA8PSAwKSB7XG4gICAgICByZXR1cm4gcmVzLnN0YXR1cygyMDApLmpzb24oe1xuICAgICAgICBzdGF0dXM6ICdub19hdmFpbGFibGVfYmFsYW5jZScsXG4gICAgICAgIG1lc3NhZ2U6ICdObyBpbnN0YW50IHBheW91dCBiYWxhbmNlIGlzIGF2YWlsYWJsZSB5ZXQuJyxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHBheW91dCA9IGF3YWl0IHN0cmlwZS5wYXlvdXRzLmNyZWF0ZShcbiAgICAgIHsgYW1vdW50LCBjdXJyZW5jeTogJ3VzZCcsIG1ldGhvZDogJ2luc3RhbnQnIH0sXG4gICAgICB7XG4gICAgICAgIHN0cmlwZUFjY291bnQ6IHJlZnJlc2hlZEFjY291bnQuc3RyaXBlX2FjY291bnRfaWQsXG4gICAgICAgIC8vIEgxOiBTdHJpcGUgaWRlbXBvdGVuY3kga2V5IHBlciB1c2VyLWRheS4gQSByZXRyaWVkIHJlcXVlc3QgKGRvdWJsZVxuICAgICAgICAvLyB0YXAsIG5ldHdvcmsgcmV0cnkpIG9uIHRoZSBzYW1lIGRheSByZXR1cm5zIHRoZSBvcmlnaW5hbCBwYXlvdXRcbiAgICAgICAgLy8gb2JqZWN0IGZyb20gU3RyaXBlIGluc3RlYWQgb2YgcGF5aW5nIHRoZSB1c2VyIHR3aWNlLlxuICAgICAgICBpZGVtcG90ZW5jeUtleTogYGluc3RhbnQtcGF5b3V0OiR7cmVxLnVzZXIuaWR9OiR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKX1gLFxuICAgICAgfVxuICAgICk7XG4gICAgLy8gSDc6IGF1ZGl0IHRoZSBtb25leSBtb3ZlbWVudC4gRmFpbCBjbG9zZWQgKHRocm93T25FcnJvcikgc28gYSBkcm9wcGVkXG4gICAgLy8gYXVkaXQgcm93IG5ldmVyIGdvZXMgdW5ub3RpY2VkLlxuICAgIGF3YWl0IGxvZ0FkbWluQWN0aW9uKHtcbiAgICAgIGFkbWluSWQ6IHJlcS51c2VyLmlkLFxuICAgICAgYWN0aW9uOiAncmVxdWVzdF9pbnN0YW50X3BheW91dCcsXG4gICAgICB0YXJnZXRUeXBlOiAnc3RyaXBlX3BheW91dCcsXG4gICAgICB0YXJnZXRJZDogcGF5b3V0LmlkLFxuICAgICAgYWZ0ZXI6IHtcbiAgICAgICAgYW1vdW50X2NlbnRzOiBhbW91bnQsXG4gICAgICAgIGN1cnJlbmN5OiAndXNkJyxcbiAgICAgICAgbWV0aG9kOiAnaW5zdGFudCcsXG4gICAgICAgIHN0cmlwZV9hY2NvdW50X2lkOiByZWZyZXNoZWRBY2NvdW50LnN0cmlwZV9hY2NvdW50X2lkLFxuICAgICAgICBzdHJpcGVfc3RhdHVzOiBwYXlvdXQuc3RhdHVzIHx8IG51bGwsXG4gICAgICB9LFxuICAgICAgdGhyb3dPbkVycm9yOiB0cnVlLFxuICAgIH0pLmNhdGNoKChhdWRpdEVycikgPT4ge1xuICAgICAgbG9nZ2VyLmVycm9yKCdJbnN0YW50IHBheW91dCBhdWRpdCB3cml0ZSBmYWlsZWQnLCB7IHVzZXJJZDogcmVxLnVzZXI/LmlkLCBlcnJvcjogYXVkaXRFcnIubWVzc2FnZSB9KTtcbiAgICAgIHRocm93IG5ldyBBcHBFcnJvcignUGF5b3V0IHdhcyBjcmVhdGVkIGJ1dCBjb3VsZCBub3QgYmUgYXVkaXRlZDsgY29udGFjdCBzdXBwb3J0JywgNTAwLCAncGF5b3V0X2F1ZGl0X2ZhaWxlZCcpO1xuICAgIH0pO1xuICAgIHJlcy5qc29uKHtcbiAgICAgIHN0YXR1czogcGF5b3V0LnN0YXR1cyB8fCAnY3JlYXRlZCcsXG4gICAgICBwYXlvdXRfaWQ6IHBheW91dC5pZCxcbiAgICAgIGFtb3VudF9jZW50czogYW1vdW50LFxuICAgICAgbWVzc2FnZTogJ0luc3RhbnQgcGF5b3V0IHJlcXVlc3RlZCcsXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBBcHBFcnJvcikgcmV0dXJuIG5leHQoZXJyKTtcbiAgICBsb2dnZXIuZXJyb3IoJ0luc3RhbnQgcGF5b3V0IHJlcXVlc3QgZmFpbGVkJywgeyB1c2VySWQ6IHJlcS51c2VyPy5pZCwgZXJyb3I6IGVyci5tZXNzYWdlIH0pO1xuICAgIG5leHQobmV3IEFwcEVycm9yKCdGYWlsZWQgdG8gcmVxdWVzdCBpbnN0YW50IHBheW91dCcsIDUwMiwgJ2luc3RhbnRfcGF5b3V0X2ZhaWxlZCcpKTtcbiAgfVxufTtcblxuZXhwb3J0cy5kaXNjb25uZWN0Q29ubmVjdEFjY291bnQgPSBhc3luYyAocmVxLCByZXMsIG5leHQpID0+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBhY2NvdW50UmVzdWx0ID0gYXdhaXQgcG9vbC5xdWVyeShcbiAgICAgICdTRUxFQ1QgKiBGUk9NIGNvbm5lY3RfYWNjb3VudHMgV0hFUkUgdXNlcl9pZCA9ICQxJyxcbiAgICAgIFtyZXEudXNlci5pZF1cbiAgICApO1xuICAgIGNvbnN0IGFjY291bnQgPSBhY2NvdW50UmVzdWx0LnJvd3NbMF07XG4gICAgaWYgKCFhY2NvdW50KSByZXR1cm4gcmVzLmpzb24oeyBzdWNjZXNzOiB0cnVlLCBtZXNzYWdlOiAnTm8gY29ubmVjdGVkIHBheW91dCBhY2NvdW50IGZvdW5kLicgfSk7XG5cbiAgICBpZiAocHJvY2Vzcy5lbnYuU1RSSVBFX1NFQ1JFVF9LRVkgJiYgYWNjb3VudC5zdHJpcGVfYWNjb3VudF9pZCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgc3RyaXBlLmFjY291bnRzLmRlbChhY2NvdW50LnN0cmlwZV9hY2NvdW50X2lkKTtcbiAgICAgIH0gY2F0Y2ggKHN0cmlwZUVycikge1xuICAgICAgICBsb2dnZXIud2FybignU3RyaXBlIGFjY291bnQgZGlzY29ubmVjdCBmYWlsZWQ7IHJlbW92aW5nIGxvY2FsIGxpbmsnLCB7XG4gICAgICAgICAgdXNlcklkOiByZXEudXNlci5pZCxcbiAgICAgICAgICBhY2NvdW50SWQ6IGFjY291bnQuc3RyaXBlX2FjY291bnRfaWQsXG4gICAgICAgICAgZXJyb3I6IHN0cmlwZUVyci5tZXNzYWdlLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBwb29sLnF1ZXJ5KCdERUxFVEUgRlJPTSBjb25uZWN0X2FjY291bnRzIFdIRVJFIHVzZXJfaWQgPSAkMScsIFtyZXEudXNlci5pZF0pO1xuICAgIHJlcy5qc29uKHsgc3VjY2VzczogdHJ1ZSwgbWVzc2FnZTogJ1BheW91dCBhY2NvdW50IGRpc2Nvbm5lY3RlZC4nIH0pO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIuZXJyb3IoJ0Rpc2Nvbm5lY3QgY29ubmVjdCBhY2NvdW50IGZhaWxlZCcsIHsgdXNlcklkOiByZXEudXNlcj8uaWQsIGVycm9yOiBlcnIubWVzc2FnZSB9KTtcbiAgICBuZXh0KG5ldyBBcHBFcnJvcignRmFpbGVkIHRvIGRpc2Nvbm5lY3QgcGF5b3V0IGFjY291bnQnLCA1MDAsICdjb25uZWN0X2Rpc2Nvbm5lY3RfZmFpbGVkJykpO1xuICB9XG59O1xuXG4vLyBDYXB0dXJlIHBheW1lbnQgYWZ0ZXIgam9iIGNvbXBsZXRpb24gKG9uIGhlbHBlcidzIGNvbm5lY3RlZCBhY2NvdW50KVxuZXhwb3J0cy5jYXB0dXJlUGF5bWVudCA9IGFzeW5jIChyZXEsIHJlcywgbmV4dCkgPT4ge1xuICB0cnkge1xuICAgIGNvbnN0IHsgam9iX2lkIH0gPSByZXEuYm9keTtcblxuICAgIC8vIOKUgOKUgCBWYWxpZGF0aW9uIChvdXRzaWRlIHRyYW5zYWN0aW9uKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCBqb2IgPSBhd2FpdCBwb29sLnF1ZXJ5KCdTRUxFQ1QgKiBGUk9NIGpvYnMgV0hFUkUgaWQgPSAkMScsIFtqb2JfaWRdKTtcbiAgICBpZiAoIWpvYi5yb3dzWzBdIHx8IGpvYi5yb3dzWzBdLnN0YXR1cyAhPT0gJ2NvbXBsZXRlZCcpIHtcbiAgICAgIHRocm93IG5ldyBBcHBFcnJvcignSm9iIG11c3QgYmUgY29tcGxldGVkIGJlZm9yZSBjYXB0dXJpbmcgcGF5bWVudCcsIDQwMCwgJ2pvYl9ub3RfY29tcGxldGVkJyk7XG4gICAgfVxuICAgIGlmIChqb2Iucm93c1swXS5jbGllbnRfaWQgIT09IHJlcS51c2VyLmlkKSB7XG4gICAgICB0aHJvdyBuZXcgQXBwRXJyb3IoJ05vdCBhdXRob3JpemVkIHRvIGNhcHR1cmUgcGF5bWVudCBmb3IgdGhpcyBqb2InLCA0MDMsICdmb3JiaWRkZW4nKTtcbiAgICB9XG5cbiAgICAvLyBBVFRBQ0sgIzIgRklYOiBVc2UgcGVzc2ltaXN0aWMgbG9ja2luZyB0byBwcmV2ZW50IGNvbmN1cnJlbnQgY2FwdHVyZSBhdHRlbXB0c1xuICAgIC8vIFNFTEVDVCAuLi4gRk9SIFVQREFURSBsb2NrcyB0aGUgcm93IHNvIG9ubHkgb25lIHJlcXVlc3QgY2FuIHByb2NlZWQgYXQgYSB0aW1lXG4gICAgY29uc3QgY2xpZW50ID0gYXdhaXQgcG9vbC5jb25uZWN0KCk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNsaWVudC5xdWVyeSgnQkVHSU4gSVNPTEFUSU9OIExFVkVMIFNFUklBTElaQUJMRScpO1xuXG4gICAgICBjb25zdCBwYXltZW50ID0gYXdhaXQgY2xpZW50LnF1ZXJ5KFxuICAgICAgICAnU0VMRUNUICogRlJPTSBwYXltZW50cyBXSEVSRSBqb2JfaWQgPSAkMSBBTkQgc3RhdHVzIElOICgkMiwgJDMpIEZPUiBVUERBVEUnLFxuICAgICAgICBbam9iX2lkLCAnYXV0aG9yaXplZCcsICdjYXB0dXJlZCddXG4gICAgICApO1xuXG4gICAgICBpZiAoIXBheW1lbnQucm93c1swXSkge1xuICAgICAgICBhd2FpdCBjbGllbnQucXVlcnkoJ1JPTExCQUNLJyk7XG4gICAgICAgIHRocm93IG5ldyBBcHBFcnJvcignTm8gYXV0aG9yaXplZCBwYXltZW50IGZvdW5kIGZvciB0aGlzIGpvYicsIDQwNCwgJ3BheW1lbnRfbm90X2ZvdW5kJyk7XG4gICAgICB9XG5cbiAgICAgIC8vIOKUgOKUgCBDSEVDSyBGT1IgT1BFTiBESVNQVVRFUyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIGNvbnN0IGRpc3B1dGUgPSBhd2FpdCBjbGllbnQucXVlcnkoJ1NFTEVDVCBpZCBGUk9NIGRpc3B1dGVzIFdIRVJFIGpvYl9pZCA9ICQxIEFORCBzdGF0dXMgSU4gKCQyLCAkMyknLCBbam9iX2lkLCAnb3BlbicsICdpbl9wcm9ncmVzcyddKTtcbiAgICAgIGlmIChkaXNwdXRlLnJvd3NbMF0pIHtcbiAgICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KCdST0xMQkFDSycpO1xuICAgICAgICB0aHJvdyBuZXcgQXBwRXJyb3IoJ0Nhbm5vdCBjYXB0dXJlIHBheW1lbnQgd2hpbGUgYSBkaXNwdXRlIGlzIG9wZW4uIERpc3B1dGUgbXVzdCBiZSByZXNvbHZlZCBmaXJzdC4nLCA0MDksICdkaXNwdXRlX29wZW4nKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGF5bWVudERhdGEgPSBwYXltZW50LnJvd3NbMF07XG5cbiAgICAgIC8vIEEgcmV0cnkgYWZ0ZXIgdGhlIGZpcnN0IHJlcXVlc3QgY29tbWl0dGVkIGlzIGEgc3VjY2Vzc2Z1bCByZXBsYXksIG5vdFxuICAgICAgLy8gYSBtaXNzaW5nIHBheW1lbnQuIFJldHVybiB0aGUgYXV0aG9yaXRhdGl2ZSB0ZXJtaW5hbCBzdGF0ZSB3aXRob3V0XG4gICAgICAvLyBjYWxsaW5nIFN0cmlwZSBhIHNlY29uZCB0aW1lLlxuICAgICAgaWYgKHBheW1lbnREYXRhLnN0YXR1cyA9PT0gJ2NhcHR1cmVkJykge1xuICAgICAgICBhd2FpdCBjbGllbnQucXVlcnkoJ0NPTU1JVCcpO1xuICAgICAgICByZXR1cm4gcmVzLnN0YXR1cygyMDApLmpzb24oe1xuICAgICAgICAgIHN0YXR1czogJ2NhcHR1cmVkJyxcbiAgICAgICAgICBtZXNzYWdlOiAnUGF5bWVudCB3YXMgYWxyZWFkeSBjYXB0dXJlZCcsXG4gICAgICAgICAgcGF5bWVudF9pZDogcGF5bWVudERhdGEuaWQsXG4gICAgICAgICAgY2hhcmdlX2lkOiBwYXltZW50RGF0YS5zdHJpcGVfY2hhcmdlX2lkIHx8IG51bGwsXG4gICAgICAgICAgam9iX2lkLFxuICAgICAgICAgIGlkZW1wb3RlbnQ6IHRydWUsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBSZWxlYXNlIGxvY2sgZWFybHkgKHdlJ2xsIGtlZXAgdHJhbnNhY3Rpb24gZm9yIGF0b21pY2l0eSlcbiAgICAgIGF3YWl0IGNsaWVudC5xdWVyeSgnQ09NTUlUJyk7XG5cbiAgICAgIGlmIChpc0FzeW5jUGF5bWVudENhcHR1cmUoKSkge1xuICAgICAgICBjb25zdCB7IHF1ZXVlUGF5bWVudENhcHR1cmUgfSA9IHJlcXVpcmUoJy4uL3NlcnZpY2VzL3BheW1lbnRRdWV1ZScpO1xuICAgICAgICBhd2FpdCBxdWV1ZVBheW1lbnRDYXB0dXJlKHBheW1lbnREYXRhLmlkLCBqb2JfaWQsIHBheW1lbnREYXRhLmFtb3VudCk7XG4gICAgICAgIHJldHVybiByZXMuc3RhdHVzKDIwMikuanNvbih7XG4gICAgICAgICAgc3RhdHVzOiAncHJvY2Vzc2luZycsXG4gICAgICAgICAgbWVzc2FnZTogJ1BheW1lbnQgY2FwdHVyZSBxdWV1ZWQnLFxuICAgICAgICAgIHBheW1lbnRfaWQ6IHBheW1lbnREYXRhLmlkLFxuICAgICAgICAgIGpvYl9pZCxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIERlZmF1bHQ6IGNhcHR1cmUgc3luY2hyb25vdXNseSBzbyBwcm9kdWN0aW9uIHdvcmtzIHdpdGhvdXQgYSBzZXBhcmF0ZSB3b3JrZXIgcHJvY2Vzcy5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNhcHR1cmVBdXRob3JpemVkUGF5bWVudCh7XG4gICAgICAgICAgcGF5bWVudElkOiBwYXltZW50RGF0YS5pZCxcbiAgICAgICAgICBqb2JJZDogam9iX2lkLFxuICAgICAgICAgIGFtb3VudDogcGF5bWVudERhdGEuYW1vdW50LFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoMjAwKS5qc29uKHtcbiAgICAgICAgICBzdGF0dXM6ICdjYXB0dXJlZCcsXG4gICAgICAgICAgbWVzc2FnZTogJ1BheW1lbnQgY2FwdHVyZWQnLFxuICAgICAgICAgIHBheW1lbnRfaWQ6IHJlc3VsdC5wYXltZW50SWQsXG4gICAgICAgICAgY2hhcmdlX2lkOiByZXN1bHQuY2hhcmdlSWQsXG4gICAgICAgICAgam9iX2lkLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGNhcEVycikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoJ1N5bmNocm9ub3VzIHBheW1lbnQgY2FwdHVyZSBmYWlsZWQnLCB7XG4gICAgICAgICAgam9iSWQ6IGpvYl9pZCxcbiAgICAgICAgICBwYXltZW50SWQ6IHBheW1lbnREYXRhLmlkLFxuICAgICAgICAgIGVycm9yOiBjYXBFcnIubWVzc2FnZSxcbiAgICAgICAgfSk7XG4gICAgICAgIHRocm93IG5ldyBBcHBFcnJvcihcbiAgICAgICAgICBjYXBFcnIubWVzc2FnZSB8fCAnQ291bGQgbm90IGNhcHR1cmUgcGF5bWVudC4gUGxlYXNlIHRyeSBhZ2FpbiBvciBjb250YWN0IHN1cHBvcnQuJyxcbiAgICAgICAgICA1MDIsXG4gICAgICAgICAgJ3BheW1lbnRfY2FwdHVyZV9mYWlsZWQnXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGNsaWVudC5yZWxlYXNlKCk7XG4gICAgfVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBuZXh0KGVycik7XG4gIH1cbn07XG5cbi8vIFJlZnVuZCBwYXltZW50IChvbiBoZWxwZXIncyBjb25uZWN0ZWQgYWNjb3VudCAtIGFkbWluIG9ubHkpLlxuLy8gVGhlIHByb3ZpZGVyIG9wZXJhdGlvbiBpcyByZXNlcnZlZCBhbmQgc2V0dGxlZCB0aHJvdWdoIHRoZSBkdXJhYmxlIHJlZnVuZFxuLy8gc2VydmljZSBzbyByZXRyaWVzIGNhbm5vdCBkdXBsaWNhdGUgYSBwYXJ0aWFsIHJlZnVuZCBvciBsb3NlIGEgdGltZW91dC5cbmV4cG9ydHMucmVmdW5kUGF5bWVudCA9IGFzeW5jIChyZXEsIHJlcywgbmV4dCkgPT4ge1xuICB0cnkge1xuICAgIGlmICghWydhZG1pbicsICdzdXBlcl9hZG1pbiddLmluY2x1ZGVzKHJlcS51c2VyLnJvbGUpKSB7XG4gICAgICB0aHJvdyBuZXcgQXBwRXJyb3IoJ0FkbWluIGFjY2VzcyByZXF1aXJlZCcsIDQwMywgJ2ZvcmJpZGRlbicpO1xuICAgIH1cblxuICAgIGNvbnN0IHsgcGF5bWVudF9pZCwgcmVhc29uLCBhbW91bnQsIHJldmVyc2VfYXBwbGljYXRpb25fZmVlIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCBoYXNSZXF1ZXN0ZWRBbW91bnQgPSBhbW91bnQgIT09IHVuZGVmaW5lZCAmJiBhbW91bnQgIT09IG51bGwgJiYgU3RyaW5nKGFtb3VudCkudHJpbSgpICE9PSAnJztcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShOdW1iZXIoYW1vdW50KSkgJiYgaGFzUmVxdWVzdGVkQW1vdW50KSB7XG4gICAgICB0aHJvdyBuZXcgQXBwRXJyb3IoJ1JlZnVuZCBhbW91bnQgbXVzdCBiZSBhIHZhbGlkIG51bWJlci4nLCA0MDAsICdpbnZhbGlkX3JlZnVuZF9hbW91bnQnKTtcbiAgICB9XG4gICAgaWYgKHJlYXNvbiAhPT0gdW5kZWZpbmVkICYmIHJlYXNvbiAhPT0gbnVsbCAmJiBTdHJpbmcocmVhc29uKS5sZW5ndGggPiAxMDAwKSB7XG4gICAgICB0aHJvdyBuZXcgQXBwRXJyb3IoJ1JlZnVuZCByZWFzb24gaXMgdG9vIGxvbmcuJywgNDAwLCAnaW52YWxpZF9yZWZ1bmRfcmVhc29uJyk7XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHByb2Nlc3NQYXltZW50UmVmdW5kKHtcbiAgICAgIHBheW1lbnRJZDogcGF5bWVudF9pZCxcbiAgICAgIHJlcXVlc3RlZEFtb3VudENlbnRzOiBoYXNSZXF1ZXN0ZWRBbW91bnQgPyBNYXRoLnJvdW5kKE51bWJlcihhbW91bnQpICogMTAwKSA6IG51bGwsXG4gICAgICByZWFzb24sXG4gICAgICByZXZlcnNlQXBwbGljYXRpb25GZWU6ICEhcmV2ZXJzZV9hcHBsaWNhdGlvbl9mZWUsXG4gICAgICBhY3RvclVzZXJJZDogcmVxLnVzZXIuaWQsXG4gICAgICByZXF1ZXN0SWQ6IHJlcS5nZXQoJ0lkZW1wb3RlbmN5LUtleScpIHx8IHJlcS5ib2R5Py5pZGVtcG90ZW5jeUtleSxcbiAgICB9KTtcbiAgICBjb25zdCByZXNwb25zZVN0YXR1cyA9IHJlc3VsdC5hdHRlbXB0LnN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgPyAyMDAgOiAyMDI7XG4gICAgcmV0dXJuIHJlcy5zdGF0dXMocmVzcG9uc2VTdGF0dXMpLmpzb24oe1xuICAgICAgbWVzc2FnZTogcmVzdWx0LmF0dGVtcHQuc3RhdHVzID09PSAnc3VjY2VlZGVkJyA/ICdSZWZ1bmQgcHJvY2Vzc2VkJyA6ICdSZWZ1bmQgaXMgYmVpbmcgcmVjb25jaWxlZCcsXG4gICAgICByZWZ1bmRfaWQ6IHJlc3VsdC5hdHRlbXB0LnN0cmlwZV9yZWZ1bmRfaWQgfHwgbnVsbCxcbiAgICAgIHJlZnVuZF9zdGF0dXM6IHJlc3VsdC5hdHRlbXB0LnN0YXR1cyxcbiAgICAgIHJlZnVuZF9hbW91bnRfY2VudHM6IE51bWJlcihyZXN1bHQuYXR0ZW1wdC5hbW91bnRfY2VudHMpLFxuICAgICAgY3VtdWxhdGl2ZV9yZWZ1bmRlZF9hbW91bnQ6IE51bWJlcihyZXN1bHQucGF5bWVudC5yZWZ1bmRlZF9hbW91bnQgfHwgMCksXG4gICAgICBpZGVtcG90ZW50OiAhIXJlc3VsdC5yZXBsYXksXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIC8vIElmIHdlIGFscmVhZHkgY3JlYXRlZCBhbiBBcHBFcnJvciBhYm92ZSwgcHJvcGFnYXRlIGl0IGFzLWlzIHNvIHRoZVxuICAgIC8vIHN0YXR1cy9jb2RlIHJlYWNoIHRoZSBjbGllbnQuIE9ubHkgd3JhcCB1bmV4cGVjdGVkIGVycm9ycy5cbiAgICBpZiAoZXJyIGluc3RhbmNlb2YgQXBwRXJyb3IpIHJldHVybiBuZXh0KGVycik7XG4gICAgbG9nZ2VyLmVycm9yKCdSZWZ1bmQgcGF5bWVudCBlcnJvcicsIHsgcGF5bWVudElkOiByZXEuYm9keT8ucGF5bWVudF9pZCwgYWRtaW5JZDogcmVxLnVzZXI/LmlkLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XG4gICAgbmV4dChuZXcgQXBwRXJyb3IoJ0ZhaWxlZCB0byBwcm9jZXNzIHJlZnVuZCcsIDUwMCwgJ3JlZnVuZF9mYWlsZWQnKSk7XG4gIH1cbn07XG5cbi8vIEdldCBwYXltZW50IGZvciBhIGpvYiAtIG9ubHkgcGF5ZXIgb3IgcGF5ZWUgbWF5IHZpZXdcbmV4cG9ydHMuZ2V0Sm9iUGF5bWVudCA9IGFzeW5jIChyZXEsIHJlcywgbmV4dCkgPT4ge1xuICB0cnkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHBvb2wucXVlcnkoJ1NFTEVDVCAqIEZST00gcGF5bWVudHMgV0hFUkUgam9iX2lkID0gJDEgT1JERVIgQlkgY3JlYXRlZF9hdCBERVNDIExJTUlUIDEnLCBbcmVxLnBhcmFtcy5qb2JfaWRdKTtcbiAgICBpZiAoIXJlc3VsdC5yb3dzWzBdKSByZXR1cm4gcmVzLmpzb24obnVsbCk7XG4gICAgY29uc3QgcCA9IHJlc3VsdC5yb3dzWzBdO1xuICAgIGlmIChwLnBheWVyX2lkICE9PSByZXEudXNlci5pZCAmJiBwLnBheWVlX2lkICE9PSByZXEudXNlci5pZCAmJiAhWydhZG1pbicsICdzdXBlcl9hZG1pbiddLmluY2x1ZGVzKHJlcS51c2VyLnJvbGUpKSB7XG4gICAgICB0aHJvdyBuZXcgQXBwRXJyb3IoJ05vdCBhdXRob3JpemVkJywgNDAzLCAnZm9yYmlkZGVuJyk7XG4gICAgfVxuICAgIHJlcy5qc29uKHApO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBpZiAoZXJyIGluc3RhbmNlb2YgQXBwRXJyb3IpIHJldHVybiBuZXh0KGVycik7XG4gICAgbG9nZ2VyLmVycm9yKCdHZXQgam9iIHBheW1lbnQgZXJyb3InLCB7IGpvYklkOiByZXEucGFyYW1zPy5qb2JfaWQsIHVzZXJJZDogcmVxLnVzZXI/LmlkLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XG4gICAgbmV4dChuZXcgQXBwRXJyb3IoJ0ZhaWxlZCB0byBmZXRjaCBwYXltZW50JywgNTAwLCAnZmV0Y2hfcGF5bWVudF9mYWlsZWQnKSk7XG4gIH1cbn07XG5cbi8vIEdldCBteSBwYXltZW50cyAocGFnaW5hdGVkKVxuZXhwb3J0cy5nZXRNeVBheW1lbnRzID0gYXN5bmMgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gIHRyeSB7XG4gICAgY29uc3QgeyByb2xlID0gJ3BheWVyJyB9ID0gcmVxLnF1ZXJ5O1xuICAgIGNvbnN0IGxpbWl0ICA9IE1hdGgubWluKDEwMCwgTWF0aC5tYXgoMSwgcGFyc2VJbnQocmVxLnF1ZXJ5LmxpbWl0LCAxMCkgIHx8IDIwKSk7XG4gICAgY29uc3Qgb2Zmc2V0ID0gTWF0aC5tYXgoMCwgcGFyc2VJbnQocmVxLnF1ZXJ5Lm9mZnNldCwgMTApIHx8IDApO1xuICAgIGNvbnN0IGZpbHRlckNvbCA9IHJvbGUgPT09ICdwYXllZScgPyAncGF5ZWVfaWQnIDogJ3BheWVyX2lkJztcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwb29sLnF1ZXJ5KFxuICAgICAgYFNFTEVDVCBwLiosIGoudGl0bGUgYXMgam9iX3RpdGxlXG4gICAgICAgICBGUk9NIHBheW1lbnRzIHBcbiAgICAgICAgIEpPSU4gam9icyBqIE9OIHAuam9iX2lkID0gai5pZFxuICAgICAgICBXSEVSRSBwLiR7ZmlsdGVyQ29sfSA9ICQxXG4gICAgICAgIE9SREVSIEJZIHAuY3JlYXRlZF9hdCBERVNDXG4gICAgICAgIExJTUlUICQyIE9GRlNFVCAkM2AsXG4gICAgICBbcmVxLnVzZXIuaWQsIGxpbWl0LCBvZmZzZXRdXG4gICAgKTtcbiAgICBjb25zdCB7IHJvd3M6IGNvdW50Um93cyB9ID0gYXdhaXQgcG9vbC5xdWVyeShcbiAgICAgIGBTRUxFQ1QgQ09VTlQoKikgRlJPTSBwYXltZW50cyBXSEVSRSAke2ZpbHRlckNvbH0gPSAkMWAsXG4gICAgICBbcmVxLnVzZXIuaWRdXG4gICAgKTtcbiAgICByZXMuanNvbih7XG4gICAgICBwYXltZW50czogcmVzdWx0LnJvd3MsXG4gICAgICB0b3RhbDogcGFyc2VJbnQoY291bnRSb3dzPy5bMF0/LmNvdW50ID8/ICcwJywgMTApLFxuICAgICAgbGltaXQsXG4gICAgICBvZmZzZXQsXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci5lcnJvcignR2V0IG15IHBheW1lbnRzIGVycm9yJywgeyB1c2VySWQ6IHJlcS51c2VyPy5pZCwgcm9sZTogcmVxLnF1ZXJ5Py5yb2xlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XG4gICAgbmV4dChuZXcgQXBwRXJyb3IoJ0ZhaWxlZCB0byBmZXRjaCBwYXltZW50cycsIDUwMCwgJ2ZldGNoX3BheW1lbnRzX2ZhaWxlZCcpKTtcbiAgfVxufTtcblxuZXhwb3J0cy5nZXRJbnZlc3RvclN1bW1hcnkgPSBhc3luYyAoX3JlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHNhZmVDb3VudCA9IGFzeW5jIChzcWwpID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgeyByb3dzIH0gPSBhd2FpdCBwb29sLnF1ZXJ5KHNxbCk7XG4gICAgICByZXR1cm4gcGFyc2VJbnQocm93cz8uWzBdPy5jb3VudCB8fCByb3dzPy5bMF0/LnRvdGFsIHx8ICcwJywgMTApIHx8IDA7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gMDtcbiAgICB9XG4gIH07XG5cbiAgY29uc3QgW2hlbHBlcnNGdW5kZWQsIGFjdGl2ZU9wcG9ydHVuaXRpZXMsIHJldmVudWVTaGFyZUNlbnRzXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICBzYWZlQ291bnQoYFNFTEVDVCBDT1VOVChESVNUSU5DVCBwYXllZV9pZCkgQVMgY291bnQgRlJPTSBwYXltZW50cyBXSEVSRSBzdGF0dXMgSU4gKCdhdXRob3JpemVkJywnY2FwdHVyZWQnLCdyZWxlYXNlZCcpYCksXG4gICAgc2FmZUNvdW50KGBTRUxFQ1QgQ09VTlQoKikgQVMgY291bnQgRlJPTSBqb2JzIFdIRVJFIHN0YXR1cyBJTiAoJ3B1Ymxpc2hlZCcsJ29wZW4nLCdpbl9wcm9ncmVzcycpYCksXG4gICAgc2FmZUNvdW50KGBTRUxFQ1QgQ09BTEVTQ0UoU1VNKHBsYXRmb3JtX2ZlZSAqIDEwMCksIDApOjpiaWdpbnQgQVMgdG90YWwgRlJPTSBwYXltZW50cyBXSEVSRSBzdGF0dXMgSU4gKCdjYXB0dXJlZCcsJ3JlbGVhc2VkJylgKSxcbiAgXSk7XG5cbiAgcmVzLmpzb24oe1xuICAgIHRvdGFsX2ludmVzdGVkX2NlbnRzOiByZXZlbnVlU2hhcmVDZW50cyxcbiAgICBoZWxwZXJzX2Z1bmRlZDogaGVscGVyc0Z1bmRlZCxcbiAgICByZXZlbnVlX3NoYXJlX2NlbnRzOiByZXZlbnVlU2hhcmVDZW50cyxcbiAgICBhY3RpdmVfb3Bwb3J0dW5pdGllczogYWN0aXZlT3Bwb3J0dW5pdGllcyxcbiAgfSk7XG59O1xuIl0sIm1hcHBpbmdzIjoiQUFBQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8sQ0FBQyxPQUFPLENBQUM7QUFDN0IsTUFBTUMsTUFBTSxHQUFHRCxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUNFLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDQyxpQkFBaUIsQ0FBQztBQUMvRCxNQUFNO0VBQUVDO0FBQW1CLENBQUMsR0FBR0wsT0FBTyxDQUFDLHdCQUF3QixDQUFDO0FBQ2hFLE1BQU07RUFBRU0sUUFBUTtFQUFFQztBQUFNLENBQUMsR0FBR1AsT0FBTyxDQUFDLG1CQUFt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LFFBQVEsRUFBRXJKLE1BQU0sQ0FBQ3RCLElBQUk7TUFDckI0SyxLQUFLLEVBQUUxSCxRQUFRLENBQUN3SCxTQUFTLEdBQUcsQ0FBQyxDQUFDLEVBQUVHLEtBQUssSUFBSSxHQUFHLEVBQUUsRUFBRSxDQUFDO01BQ2pETixLQUFLO01BQ0xDO0lBQ0YsQ0FBQyxDQUFDO0VBQ0osQ0FBQyxDQUFDLE9BQU9yTCxHQUFHLEVBQUU7SUFDWnBELE1BQU0sQ0FBQ3VELEtBQUssQ0FBQyx1QkFBdUIsRUFBRTtNQUFFL0IsTUFBTSxFQUFFbUMsR0FBRyxDQUFDSSxJQUFJLEVBQUVDLEVBQUU7TUFBRThJLElBQUksRUFBRW5KLEdBQUcsQ0FBQ1gsS0FBSyxFQUFFOEosSUFBSTtNQUFFdkosS0FBSyxFQUFFSCxHQUFHLENBQUNJO0lBQVEsQ0FBQyxDQUFDO0lBQzFHSyxJQUFJLENBQUMsSUFBSXhELFFBQVEsQ0FBQywwQkFBMEIsRUFBRSxHQUFHLEVBQUUsdUJBQXVCLENBQUMsQ0FBQztFQUM5RTtBQUNGLENBQUM7QUFFRG9ELE9BQU8sQ0FBQ3NMLGtCQUFrQixHQUFHLE9BQU9DLElBQUksRUFBRXBMLEdBQUcsS0FBSztFQUNoRCxNQUFNcUwsU0FBUyxHQUFHLE1BQU9DLEdBQUcsSUFBSztJQUMvQixJQUFJO01BQ0YsTUFBTTtRQUFFakw7TUFBSyxDQUFDLEdBQUcsTUFBTTFFLElBQUksQ0FBQ3lELEtBQUssQ0FBQ2tNLEdBQUcsQ0FBQztNQUN0QyxPQUFPL0gsUUFBUSxDQUFDbEQsSUFBSSxHQUFHLENBQUMsQ0FBQyxFQUFFNkssS0FBSyxJQUFJN0ssSUFBSSxHQUFHLENBQUMsQ0FBQyxFQUFFNEssS0FBSyxJQUFJLEdBQUcsRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDO0lBQ3ZFLENBQUMsQ0FBQyxNQUFNO01BQ04sT0FBTyxDQUFDO0lBQ1Y7RUFDRixDQUFDO0VBRUQsTUFBTSxDQUFDTSxhQUFhLEVBQUVDLG1CQUFtQixFQUFFQyxpQkFBaUIsQ0FBQyxHQUFHLE1BQU1DLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLENBQ2hGTixTQUFTLENBQUMsNkdBQTZHLENBQUMsRUFDeEhBLFNBQVMsQ0FBQyx1RkFBdUYsQ0FBQyxFQUNsR0EsU0FBUyxDQUFDLG9IQUFvSCxDQUFDLENBQ2hJLENBQUM7RUFFRnJMLEdBQUcsQ0FBQ2MsSUFBSSxDQUFDO0lBQ1A4SyxvQkFBb0IsRUFBRUgsaUJBQWlCO0lBQ3ZDSSxjQUFjLEVBQUVOLGFBQWE7SUFDN0JPLG1CQUFtQixFQUFFTCxpQkFBaUI7SUFDdENNLG9CQUFvQixFQUFFUDtFQUN4QixDQUFDLENBQUM7QUFDSixDQUFDIiwiaWdub3JlTGlzdCI6W119