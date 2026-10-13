'use strict';

/**
 * Customer re-authorization after an approved change order raises the job
 * price above what is held for it (see jobChangeOrderFinance).
 *
 * Flags on jobs.metadata (set by the change order, cleared here):
 *   paymentAdjustmentRequired = 'reauthorization_required'
 *       The card is authorized for less than the new price. The customer
 *       authorizes a replacement manual-capture PaymentIntent for the full
 *       new amount on the helper's connected account (direct charge, same as
 *       POST /payments/intent). Stripe runs SCA/3DS in the browser
 *       (confirmCardPayment). Once Stripe reports requires_capture, the
 *       payment row moves onto the new intent and the old one is canceled,
 *       so only one authorization is ever captured.
 *   paymentAdjustmentRequired = 'intent_reprice_required'
 *       The original intent was never confirmed; its amount is updated in
 *       place and the customer finishes the normal payment step.
 *   creditAdjustmentRequired = true
 *       OxSteed Credit escrow collateral could not be re-placed at the new
 *       price (insufficient Credit). The customer adds Credit and retries.
 *
 * While a flag is set, completion and capture are refused
 * (payment_reauthorization_required). Attempts expire after
 * JOB_PAYMENT_REAUTH_TTL_HOURS (default 24); a decline keeps the attempt
 * open so the customer can retry with another card until it expires.
 *
 * Lock order: jobs → payments → job_payment_reauthorizations (→ credit holds).
 * Stripe idempotency keys are derived from (job, attempt).
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { calculateTier3Fees } = require('../utils/feeCalculator');
const { enqueueJobEvent, EVENT_TYPES } = require('./jobEventOutbox');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const CARD_FLAGS = new Set(['reauthorization_required', 'intent_reprice_required']);
const CONFIRMABLE = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);
const MAX_PAYMENT_CENTS = 5_000_000;

function ttlHours() {
  const value = Number(process.env.JOB_PAYMENT_REAUTH_TTL_HOURS || 24);
  return Number.isFinite(value) && value >= 1 && value <= 144 ? value : 24;
}

function cents(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } }
  return value;
}

function authorizedCentsOf(payment) {
  const meta = parseJson(payment.metadata);
  return cents(meta.authorized_amount_cents) ?? Math.round(Number(payment.amount) * 100);
}

/** What the customer still has to fund, or null when nothing is required. */
function requirementFrom(job, payment) {
  const meta = parseJson(job?.metadata);
  const card = CARD_FLAGS.has(meta.paymentAdjustmentRequired) ? meta.paymentAdjustmentRequired : null;
  const credit = meta.creditAdjustmentRequired === true;
  if (!card && !credit) return null;
  const out = { card, credit, change_order_id: meta.paymentAdjustmentChangeOrderId || meta.creditAdjustmentChangeOrderId || null };
  if (card && payment) {
    const authorized = authorizedCentsOf(payment);
    const increase = cents(payment.pending_increase_cents) || 0;
    out.authorized_cents = authorized;
    out.increase_cents = increase;
    out.target_cents = card === 'intent_reprice_required'
      ? cents(payment.capture_amount_cents) ?? authorized + increase
      : authorized + increase;
  }
  if (credit) out.credit_amount_cents = cents(meta.creditAdjustmentAmountCents) ?? cents(job.job_value_cents);
  return out;
}

async function lockJob(client, jobId) {
  const { rows } = await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId]);
  if (!rows[0]) throw new AppError('Job not found', 404, 'job_not_found');
  return rows[0];
}

async function lockOpenPayment(client, jobId) {
  const { rows } = await client.query(
    `SELECT * FROM payments WHERE job_id = $1 AND status IN ('pending', 'authorized')
      ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [jobId]
  );
  return rows[0] || null;
}

function assertCustomer(job, user) {
  if (!user || String(job.client_id) !== String(user.id)) {
    throw new AppError('Only the customer can authorize this payment', 403, 'forbidden');
  }
}

function clearCardFlagSql() {
  return `UPDATE jobs
             SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'paymentAdjustmentRequired' - 'paymentAdjustmentChangeOrderId')
                            || jsonb_build_object('paymentReauthorizedAt', NOW()),
                 updated_at = NOW()
           WHERE id = $1`;
}

async function cancelIntentQuietly(intentId, stripeAccount, idempotencyKey) {
  if (!intentId || !stripeAccount || typeof stripe.paymentIntents.cancel !== 'function') return false;
  try {
    await stripe.paymentIntents.cancel(intentId, {}, { stripeAccount, idempotencyKey });
    return true;
  } catch (err) {
    // Already canceled/captured or not cancelable: nothing else to release.
    logger.warn('job_payment_reauth.cancel_intent_failed', { intentId, error: err.message });
    return false;
  }
}

function view(attempt, extra = {}) {
  if (!attempt) return null;
  return {
    id: String(attempt.id),
    method: attempt.method,
    kind: attempt.kind,
    status: attempt.status,
    amount_cents: cents(attempt.amount_cents),
    expires_at: attempt.expires_at,
    failure_code: attempt.failure_code || null,
    ...extra,
  };
}

async function getReauthorizationState(jobId, user) {
  const { rows: jobRows } = await pool.query(
    'SELECT id, client_id, assigned_helper_id, status, metadata, job_value_cents FROM jobs WHERE id = $1',
    [jobId]
  );
  const job = jobRows[0];
  if (!job) throw new AppError('Job not found', 404, 'job_not_found');
  const isCustomer = String(job.client_id) === String(user?.id);
  const isHelper = job.assigned_helper_id && String(job.assigned_helper_id) === String(user?.id);
  const isAdmin = ['admin', 'super_admin'].includes(user?.role);
  if (!isCustomer && !isHelper && !isAdmin) throw new AppError('Job not found', 404, 'job_not_found');
  const { rows: payRows } = await pool.query(
    `SELECT id, amount, status, metadata, capture_amount_cents, pending_increase_cents
       FROM payments WHERE job_id = $1 AND status IN ('pending', 'authorized') ORDER BY id DESC LIMIT 1`,
    [jobId]
  );
  const requirement = requirementFrom(job, payRows[0]);
  const { rows: attempts } = await pool.query(
    `SELECT * FROM job_payment_reauthorizations WHERE job_id = $1 ORDER BY attempt DESC LIMIT 1`,
    [jobId]
  );
  const latest = attempts[0] || null;
  return {
    required: Boolean(requirement),
    requirement: requirement && (isCustomer || isAdmin) ? requirement : requirement ? { card: requirement.card, credit: requirement.credit } : null,
    can_authorize: Boolean(requirement) && isCustomer,
    latest_attempt: latest && (isCustomer || isAdmin) ? view(latest) : latest ? { status: latest.status } : null,
  };
}

async function nextAttemptNumber(client, jobId) {
  const { rows } = await client.query(
    'SELECT COALESCE(MAX(attempt), 0)::int + 1 AS n FROM job_payment_reauthorizations WHERE job_id = $1',
    [jobId]
  );
  return rows[0]?.n || 1;
}

/**
 * Start (or resume) the card step. Returns what the browser needs to confirm
 * the intent with Stripe Elements, or { status: 'authorized' | 'repriced' }
 * when nothing is left to confirm.
 */
async function startCardReauthorization({ jobId, user }) {
  const outcome = await withTransaction(pool, async (client) => {
    const job = await lockJob(client, jobId);
    assertCustomer(job, user);
    const payment = await lockOpenPayment(client, jobId);
    const requirement = requirementFrom(job, payment);
    if (!requirement?.card) throw new AppError('No payment authorization is needed for this job', 409, 'payment_reauthorization_not_required');
    if (!payment) throw new AppError('No open payment for this job', 409, 'payment_not_found');
    const target = requirement.target_cents;
    if (!Number.isInteger(target) || target < 50 || target > MAX_PAYMENT_CENTS) {
      throw new AppError('The new amount cannot be authorized online. Contact support.', 409, 'payment_reauthorization_amount_invalid');
    }
    const fees = calculateTier3Fees(target);

    if (requirement.card === 'intent_reprice_required') {
      const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id, { stripeAccount: payment.stripe_account_id });
      if (!CONFIRMABLE.has(intent.status)) {
        // Authorized in Stripe before the webhook arrived: treat as a replacement.
        await client.query(
          `UPDATE jobs SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"paymentAdjustmentRequired":"reauthorization_required"}'::jsonb WHERE id = $1`,
          [jobId]
        );
        await client.query(
          `UPDATE payments SET status = 'authorized', capture_amount_cents = $2, pending_increase_cents = GREATEST(0, $3 - $2), updated_at = NOW() WHERE id = $1`,
          [payment.id, cents(intent.amount), target]
        );
        return { retry: true };
      }
      const attempt = await nextAttemptNumber(client, jobId);
      await stripe.paymentIntents.update(payment.stripe_payment_intent_id,
        { amount: target, application_fee_amount: fees.application_fee_cents },
        { stripeAccount: payment.stripe_account_id, idempotencyKey: `job-payment-reprice:${jobId}:${attempt}` });
      const meta = { ...parseJson(payment.metadata), authorized_amount_cents: target, discounted_amount_cents: target };
      await client.query(
        `UPDATE payments SET amount = $2, platform_fee = $3, capture_amount_cents = $4, pending_increase_cents = 0,
                metadata = $5::jsonb, updated_at = NOW() WHERE id = $1`,
        [payment.id, target / 100, fees.platform_fee_cents / 100, target, JSON.stringify(meta)]
      );
      const { rows } = await client.query(
        `INSERT INTO job_payment_reauthorizations
           (job_id, payment_id, change_order_id, requested_by, method, kind, status, attempt, amount_cents,
            previous_authorized_cents, stripe_payment_intent_id, stripe_account_id, expires_at, completed_at)
         VALUES ($1, $2, $3, $4, 'card', 'reprice', 'authorized', $5, $6, $7, NULL, $8, NOW(), NOW())
         RETURNING *`,
        [jobId, payment.id, requirement.change_order_id, user.id, attempt, target, requirement.authorized_cents, payment.stripe_account_id]
      );
      await client.query(clearCardFlagSql(), [jobId]);
      await enqueueJobEvent(client, {
        jobId, eventType: EVENT_TYPES.PAYMENT_REAUTHORIZED, coalesce: false,
        payload: { attempt_id: String(rows[0].id), customer_id: job.client_id, helper_id: job.assigned_helper_id, amount_cents: target, kind: 'reprice' },
      });
      return { result: { status: 'repriced', attempt: view(rows[0]) } };
    }

    // Replacement authorization. Reuse the open attempt when it still matches.
    const { rows: openRows } = await client.query(
      `SELECT * FROM job_payment_reauthorizations WHERE job_id = $1 AND status = 'pending' FOR UPDATE`,
      [jobId]
    );
    const open = openRows[0];
    if (open) {
      const fresh = new Date(open.expires_at) > new Date();
      if (fresh && cents(open.amount_cents) === target && String(open.payment_id) === String(payment.id)) {
        const intent = await stripe.paymentIntents.retrieve(open.stripe_payment_intent_id, { stripeAccount: open.stripe_account_id });
        if (CONFIRMABLE.has(intent.status)) {
          return { result: { status: 'requires_confirmation', attempt: view(open), client_secret: intent.client_secret, payment_intent_id: intent.id, stripe_account_id: open.stripe_account_id } };
        }
        if (intent.status === 'requires_capture') {
          const finalized = await finalizeAuthorizedInTransaction(client, open, intent, { job, payment });
          return { result: { status: 'authorized', attempt: view(finalized.attempt) }, cancelAfter: finalized.cancelAfter };
        }
      }
      await client.query(
        `UPDATE job_payment_reauthorizations SET status = $2, failure_code = $3, updated_at = NOW() WHERE id = $1`,
        [open.id, fresh ? 'canceled' : 'expired', fresh ? 'superseded' : 'expired']
      );
      await cancelIntentQuietly(open.stripe_payment_intent_id, open.stripe_account_id, `job-payment-reauth-cancel:${open.id}`);
    }

    const attempt = await nextAttemptNumber(client, jobId);
    const intent = await stripe.paymentIntents.create({
      amount: target,
      currency: 'usd',
      payment_method_types: ['card'],
      capture_method: 'manual',
      application_fee_amount: fees.application_fee_cents,
      metadata: {
        job_id: String(jobId),
        client_id: String(job.client_id),
        helper_id: String(job.assigned_helper_id || payment.payee_id || ''),
        tier: 'tier3',
        platform_fee_cents: String(fees.platform_fee_cents),
        job_reauthorization: 'true',
        reauthorization_attempt: String(attempt),
        replaces_payment_intent_id: String(payment.stripe_payment_intent_id || ''),
      },
    }, { stripeAccount: payment.stripe_account_id, idempotencyKey: `job-payment-reauth:${jobId}:${attempt}` });
    const { rows } = await client.query(
      `INSERT INTO job_payment_reauthorizations
         (job_id, payment_id, change_order_id, requested_by, method, kind, status, attempt, amount_cents,
          previous_authorized_cents, stripe_payment_intent_id, stripe_account_id, previous_payment_intent_id, expires_at)
       VALUES ($1, $2, $3, $4, 'card', 'replacement', 'pending', $5, $6, $7, $8, $9, $10,
               NOW() + ($11::numeric * INTERVAL '1 hour'))
       RETURNING *`,
      [jobId, payment.id, requirement.change_order_id, user.id, attempt, target, requirement.authorized_cents,
        intent.id, payment.stripe_account_id, payment.stripe_payment_intent_id, ttlHours()]
    );
    return { result: { status: 'requires_confirmation', attempt: view(rows[0]), client_secret: intent.client_secret, payment_intent_id: intent.id, stripe_account_id: payment.stripe_account_id } };
  }, 'job_payment_reauth_start');

  if (outcome.retry) return startCardReauthorization({ jobId, user });
  if (outcome.cancelAfter) await runCancelAfter(outcome.cancelAfter);
  return { ...outcome.result, publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null };
}

/**
 * Inside the caller's transaction (job locked): move the payment onto the
 * newly authorized intent. Returns the old intent to cancel after commit.
 */
async function finalizeAuthorizedInTransaction(client, attempt, intent, { job, payment } = {}) {
  const lockedJob = job || await lockJob(client, attempt.job_id);
  const lockedPayment = payment || (await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [attempt.payment_id])).rows[0];
  const { rows: attemptRows } = await client.query('SELECT * FROM job_payment_reauthorizations WHERE id = $1 FOR UPDATE', [attempt.id]);
  const current = attemptRows[0];
  if (!current || current.status === 'authorized') return { attempt: current, cancelAfter: null };
  const capturable = cents(intent.amount_capturable) ?? cents(intent.amount);
  const usable = current.status === 'pending'
    && lockedPayment && String(lockedPayment.id) === String(current.payment_id)
    && lockedPayment.status === 'authorized'
    && capturable >= cents(current.amount_cents);
  if (!usable) {
    // The job moved on (captured, canceled, superseded): release this hold.
    await client.query(
      `UPDATE job_payment_reauthorizations SET status = 'canceled', failure_code = COALESCE(failure_code, 'not_applicable'), updated_at = NOW() WHERE id = $1`,
      [current.id]
    );
    return { attempt: { ...current, status: 'canceled' }, cancelAfter: { intentId: intent.id, account: current.stripe_account_id, attemptId: current.id, key: `job-payment-reauth-cancel:${current.id}` } };
  }
  const amount = cents(current.amount_cents);
  const fees = calculateTier3Fees(amount);
  const meta = parseJson(lockedPayment.metadata);
  const superseded = Array.isArray(meta.superseded_payment_intent_ids) ? meta.superseded_payment_intent_ids : [];
  const nextMeta = {
    ...meta,
    authorized_amount_cents: amount,
    discounted_amount_cents: amount,
    reauthorization_attempt_id: String(current.id),
    superseded_payment_intent_ids: [...superseded, lockedPayment.stripe_payment_intent_id].filter(Boolean),
  };
  await client.query(
    `UPDATE payments
        SET stripe_payment_intent_id = $2, amount = $3, platform_fee = $4, capture_amount_cents = $5,
            pending_increase_cents = 0, status = 'authorized', payment_hold_status = 'held',
            metadata = $6::jsonb, updated_at = NOW()
      WHERE id = $1`,
    [lockedPayment.id, intent.id, amount / 100, fees.platform_fee_cents / 100, amount, JSON.stringify(nextMeta)]
  );
  const { rows: updated } = await client.query(
    `UPDATE job_payment_reauthorizations
        SET status = 'authorized', completed_at = NOW(), failure_code = NULL, failure_message = NULL,
            previous_payment_intent_id = $2, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [current.id, lockedPayment.stripe_payment_intent_id]
  );
  await client.query(clearCardFlagSql(), [lockedJob.id]);
  await enqueueJobEvent(client, {
    jobId: lockedJob.id, eventType: EVENT_TYPES.PAYMENT_REAUTHORIZED, coalesce: false,
    payload: { attempt_id: String(current.id), customer_id: lockedJob.client_id, helper_id: lockedJob.assigned_helper_id, amount_cents: amount, kind: 'replacement' },
  });
  logger.info('job_payment_reauth.authorized', { jobId: lockedJob.id, attemptId: current.id, amount });
  return {
    attempt: updated[0],
    cancelAfter: { intentId: lockedPayment.stripe_payment_intent_id, account: lockedPayment.stripe_account_id, attemptId: current.id, key: `job-payment-reauth-release:${current.id}`, previous: true },
  };
}

async function runCancelAfter(cancelAfter) {
  if (!cancelAfter?.intentId) return;
  const ok = await cancelIntentQuietly(cancelAfter.intentId, cancelAfter.account, cancelAfter.key);
  if (ok && cancelAfter.previous) {
    await pool.query(
      'UPDATE job_payment_reauthorizations SET previous_intent_canceled_at = NOW(), updated_at = NOW() WHERE id = $1',
      [cancelAfter.attemptId]
    ).catch((err) => logger.warn('job_payment_reauth.mark_released_failed', { error: err.message }));
  }
}

async function recordDecline(attemptId, intent) {
  const error = intent?.last_payment_error || {};
  const { rows } = await pool.query(
    `UPDATE job_payment_reauthorizations
        SET failure_code = $2, failure_message = $3, updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [attemptId, String(error.decline_code || error.code || 'card_declined').slice(0, 80), error.message ? String(error.message).slice(0, 500) : null]
  );
  return rows[0] || null;
}

/** Called by the browser after confirmCardPayment resolves (webhooks also finalize). */
async function confirmCardReauthorization({ jobId, user, attemptId }) {
  const { rows } = await pool.query(
    `SELECT a.*, j.client_id FROM job_payment_reauthorizations a JOIN jobs j ON j.id = a.job_id
      WHERE a.id = $1 AND a.job_id = $2`,
    [attemptId, jobId]
  );
  const attempt = rows[0];
  if (!attempt) throw new AppError('Authorization attempt not found', 404, 'payment_reauthorization_not_found');
  assertCustomer({ client_id: attempt.client_id }, user);
  if (attempt.status !== 'pending') return { status: attempt.status, attempt: view(attempt) };
  if (attempt.method !== 'card' || !attempt.stripe_payment_intent_id) throw new AppError('Nothing to confirm', 409, 'payment_reauthorization_not_required');
  const intent = await stripe.paymentIntents.retrieve(attempt.stripe_payment_intent_id, { stripeAccount: attempt.stripe_account_id });
  if (intent.status === 'requires_capture') {
    const finalized = await withTransaction(pool, async (client) => {
      const job = await lockJob(client, jobId);
      return finalizeAuthorizedInTransaction(client, attempt, intent, { job });
    }, 'job_payment_reauth_confirm');
    await runCancelAfter(finalized.cancelAfter);
    return { status: finalized.attempt?.status || 'authorized', attempt: view(finalized.attempt) };
  }
  if (intent.status === 'requires_payment_method' && intent.last_payment_error) {
    const updated = await recordDecline(attempt.id, intent);
    return { status: 'declined', attempt: view(updated || attempt) };
  }
  if (intent.status === 'canceled') {
    await pool.query(`UPDATE job_payment_reauthorizations SET status = 'canceled', updated_at = NOW() WHERE id = $1 AND status = 'pending'`, [attempt.id]);
    return { status: 'canceled', attempt: view({ ...attempt, status: 'canceled' }) };
  }
  return { status: 'processing', attempt: view(attempt) };
}

/**
 * Re-place OxSteed Credit escrow collateral at the new price after the
 * customer added Credit. Fail-closed: insufficient Credit rolls back.
 */
async function authorizeWithCredit({ jobId, user, isImpersonated = false }) {
  if (isImpersonated) throw new AppError('Impersonated sessions cannot spend OxSteed Credit', 403, 'impersonation_blocked');
  // Lazy require: jobChangeOrderFinance requires this module's callers.
  const { replaceCreditCollateral } = require('./jobChangeOrderFinance');
  return withTransaction(pool, async (client) => {
    const job = await lockJob(client, jobId);
    assertCustomer(job, user);
    const meta = parseJson(job.metadata);
    if (meta.creditAdjustmentRequired !== true) throw new AppError('No Credit authorization is needed for this job', 409, 'payment_reauthorization_not_required');
    const amount = cents(meta.creditAdjustmentAmountCents) ?? cents(job.job_value_cents);
    const attempt = await nextAttemptNumber(client, jobId);
    const { holdId } = await replaceCreditCollateral(client, {
      job, amountCents: amount, reason: `Credit re-authorization ${attempt}`,
      idempotencyKey: `credit-spend:jobs:job_escrow_collateral:${job.id}:reauth:${attempt}`,
      isImpersonated, metadata: { reauthorizationAttempt: String(attempt) },
    });
    await client.query(
      `UPDATE jobs
          SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'creditAdjustmentRequired' - 'creditAdjustmentAmountCents' - 'creditAdjustmentChangeOrderId')
                         || jsonb_build_object('creditReauthorizedAt', NOW()),
              updated_at = NOW()
        WHERE id = $1`,
      [job.id]
    );
    const { rows } = await client.query(
      `INSERT INTO job_payment_reauthorizations
         (job_id, change_order_id, requested_by, method, kind, status, attempt, amount_cents, credit_hold_id, expires_at, completed_at)
       VALUES ($1, $2, $3, 'credit', 'credit_hold', 'authorized', $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [job.id, meta.creditAdjustmentChangeOrderId || null, user.id, attempt, amount, holdId]
    );
    await enqueueJobEvent(client, {
      jobId: job.id, eventType: EVENT_TYPES.PAYMENT_REAUTHORIZED, coalesce: false,
      payload: { attempt_id: String(rows[0].id), customer_id: job.client_id, helper_id: job.assigned_helper_id, amount_cents: amount, kind: 'credit_hold' },
    });
    return { status: 'authorized', attempt: view(rows[0]) };
  }, 'job_payment_reauth_credit');
}

/**
 * Stripe webhook hook. Returns true when the event belonged to a
 * re-authorization intent and was handled here.
 */
async function applyReauthorizationWebhook(type, intent) {
  if (intent?.metadata?.job_reauthorization !== 'true' || !intent.id) return false;
  const { rows } = await pool.query('SELECT * FROM job_payment_reauthorizations WHERE stripe_payment_intent_id = $1', [intent.id]);
  const attempt = rows[0];
  if (!attempt) {
    logger.warn('job_payment_reauth.webhook_unknown_intent', { intentId: intent.id, type });
    return true;
  }
  if (type === 'payment_intent.amount_capturable_updated') {
    if (attempt.status === 'authorized') return true;
    const finalized = await withTransaction(pool, async (client) => {
      await lockJob(client, attempt.job_id);
      return finalizeAuthorizedInTransaction(client, attempt, intent);
    }, 'job_payment_reauth_webhook');
    await runCancelAfter(finalized.cancelAfter);
    return true;
  }
  if (type === 'payment_intent.payment_failed') {
    const updated = await recordDecline(attempt.id, intent);
    if (updated) {
      await withTransaction(pool, (client) => enqueueJobEvent(client, {
        jobId: attempt.job_id, eventType: EVENT_TYPES.PAYMENT_REAUTH_FAILED, coalesce: false,
        payload: { attempt_id: String(attempt.id), reason: 'declined', failure_code: updated.failure_code },
      }), 'job_payment_reauth_declined');
    }
    return true;
  }
  if (type === 'payment_intent.canceled') {
    if (attempt.status === 'pending') {
      await pool.query(`UPDATE job_payment_reauthorizations SET status = 'canceled', updated_at = NOW() WHERE id = $1 AND status = 'pending'`, [attempt.id]);
      return true;
    }
    // Once authorized the intent is the payment's intent; normal handling applies.
    return attempt.status !== 'authorized';
  }
  return false;
}

/**
 * Expire stale open attempts (and those of jobs that were cancelled or
 * closed meanwhile), release their card holds, and tell the customer.
 */
async function expireStaleReauthorizations(limit = 100) {
  const { rows } = await pool.query(
    `UPDATE job_payment_reauthorizations a
        SET status = 'expired', failure_code = COALESCE(failure_code, 'expired'), updated_at = NOW()
      WHERE a.id IN (
        SELECT id FROM job_payment_reauthorizations
         WHERE status = 'pending'
           AND (expires_at <= NOW()
                OR job_id IN (SELECT id FROM jobs WHERE status::text IN ('cancelled', 'completed', 'closed')))
         ORDER BY expires_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1)
      RETURNING a.*`,
    [Math.max(1, Math.min(Number(limit) || 100, 500))]
  );
  for (const attempt of rows) {
    await cancelIntentQuietly(attempt.stripe_payment_intent_id, attempt.stripe_account_id, `job-payment-reauth-cancel:${attempt.id}`);
    try {
      const { rows: jobRows } = await pool.query('SELECT status FROM jobs WHERE id = $1', [attempt.job_id]);
      if (!jobRows[0] || ['cancelled', 'completed', 'closed'].includes(String(jobRows[0].status))) continue;
      await withTransaction(pool, (client) => enqueueJobEvent(client, {
        jobId: attempt.job_id, eventType: EVENT_TYPES.PAYMENT_REAUTH_FAILED, coalesce: false,
        payload: { attempt_id: String(attempt.id), reason: 'expired' },
      }), 'job_payment_reauth_expired');
    } catch (err) {
      logger.warn('job_payment_reauth.expire_notify_failed', { attemptId: attempt.id, error: err.message });
    }
  }
  return rows.length;
}

/** Inside a change-order transaction: abandon open attempts that no longer apply. */
async function supersedeOpenAttempts(client, jobId, reason = 'superseded') {
  const { rows } = await client.query(
    `UPDATE job_payment_reauthorizations SET status = 'canceled', failure_code = $2, updated_at = NOW()
      WHERE job_id = $1 AND status = 'pending' RETURNING *`,
    [jobId, reason]
  );
  for (const attempt of rows) {
    await cancelIntentQuietly(attempt.stripe_payment_intent_id, attempt.stripe_account_id, `job-payment-reauth-cancel:${attempt.id}`);
  }
  return rows.length;
}

/** Throws when completion/capture must wait for the customer. */
function assertNoPendingAdjustment(job, payment) {
  const meta = parseJson(job?.metadata);
  if (CARD_FLAGS.has(meta.paymentAdjustmentRequired) || meta.creditAdjustmentRequired === true
      || (payment && (cents(payment.pending_increase_cents) || 0) > 0)) {
    throw new AppError(
      'The customer must authorize the new price from the approved change order before this job can be completed or paid out.',
      409,
      'payment_reauthorization_required'
    );
  }
}

module.exports = {
  getReauthorizationState,
  startCardReauthorization,
  confirmCardReauthorization,
  authorizeWithCredit,
  applyReauthorizationWebhook,
  expireStaleReauthorizations,
  supersedeOpenAttempts,
  assertNoPendingAdjustment,
  requirementFrom,
  finalizeAuthorizedInTransaction,
};
