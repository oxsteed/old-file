'use strict';

/**
 * OxSteed Credit Stripe top-ups (fiat money IN).
 *
 * A customer creates a top-up intent (POST /api/oxsteed-credit/topups). The
 * controller runs the fiat compliance gate first; this service inserts a
 * `pending` oxsteed_credit_topups row idempotently, then creates the Stripe
 * PaymentIntent (deterministic Stripe idempotency key per top-up, so retries
 * converge on one Stripe object). The client confirms the intent with Stripe;
 * the verified webhook completes the flow by posting a balanced `load`
 * journal transaction (platform_treasury -> customer_wallet).
 *
 * Webhook handling is centralized in applyCreditTopupWebhookEvent, which the
 * Stripe webhook branches in controllers/webhookController.js call. Settlement
 * payout transfer events (fiat money OUT) are also routed here, but the
 * confirm/fail logic itself belongs to Builder B in
 * services/oxsteedCreditAdminService.js and is called exactly as contracted.
 */

const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');
const {
  MAX_TRANSACTION_CENTS,
  assertSupportedCreditCurrency,
  assertCreditRailEnabled,
  assertIssuanceCapacity,
  ensureAccount,
  postJournalTransaction,
} = require('./oxsteedCreditService');
const { recordIncident } = require('./incidentStore');
const { createLot } = require('./invest/creditLots');

const MIN_TOPUP_CENTS = 100;
const STRIPE_INTENT_IDEMPOTENCY_PREFIX = 'stripe-topup-intent:';
const JOURNAL_IDEMPOTENCY_PREFIX = 'credit-topup:';

function fail(message, code, status = 400) {
  throw new AppError(message, status, code);
}

function validateTopupAmount(amountCents) {
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    fail('Top-up amount must be a positive integer number of cents', 'credit_topup_amount_invalid');
  }
  if (amount < MIN_TOPUP_CENTS) {
    fail('Top-up amount is below the minimum', 'credit_topup_amount_too_small');
  }
  if (amount > MAX_TRANSACTION_CENTS) {
    fail('Top-up amount exceeds the maximum transaction size', 'credit_topup_amount_too_large', 402);
  }
  return amount;
}

function normalizeIdempotencyKey(value) {
  const key = typeof value === 'string' ? value.trim().slice(0, 160) : '';
  if (!key) {
    fail('Idempotency-Key is required for credit top-ups', 'credit_topup_idempotency_key_required');
  }
  return key;
}

// Null-guarded lazy Stripe client: never construct with an undefined key.
function defaultGetStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new AppError('Stripe is not configured for credit top-ups', 503, 'credit_stripe_unavailable');
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

async function getTopupById(topupId) {
  const { rows } = await pool.query(
    `SELECT * FROM oxsteed_credit_topups WHERE id = $1`,
    [topupId]
  );
  return rows[0] || null;
}

async function markTopupFailed(topupId) {
  await pool.query(
    `UPDATE oxsteed_credit_topups
        SET status = 'failed', updated_at = NOW()
      WHERE id = $1 AND status = 'pending'`,
    [topupId]
  );
}

async function failInvalidStripeIntent({ topup, intent, stripe }) {
  const providerId = typeof intent?.id === 'string' && intent.id.trim()
    ? intent.id.trim()
    : (typeof topup?.stripe_payment_intent_id === 'string' ? topup.stripe_payment_intent_id.trim() : '');
  if (providerId && typeof stripe?.paymentIntents?.cancel === 'function') {
    await stripe.paymentIntents.cancel(providerId).catch((cancelError) => logger.warn('[oxsteed-credit] Failed to cancel unusable top-up PaymentIntent', {
      topupId: String(topup.id),
      paymentIntentId: providerId,
      error: cancelError.message,
    }));
  }
  await markTopupFailed(topup.id);
  throw new AppError('Stripe payment initiation returned an unusable session', 502, 'credit_topup_stripe_failed');
}

// Phase 8: best-effort server-side cancellation of the Stripe PaymentIntent
// backing a pending top-up. A failed top-up is revivable via createTopup and
// the same Stripe object stays confirmable, so a late confirmation could
// still complete a row the sweeper marks failed; canceling closes that race.
// Returns one of 'none' (no intent), 'canceled', 'already_canceled',
// 'already_succeeded', or 'failed'. Stripe-side terminal states and
// connectivity problems are logged and swallowed so one bad intent never
// fails the sweep batch.
async function cancelTopupIntentBestEffort({ topup, getStripe }) {
  const intentId = topup.stripe_payment_intent_id;
  if (!intentId) return 'none';
  let stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    logger.warn('[oxsteed-credit] Top-up expiry could not reach Stripe (client unavailable)', {
      topupId: String(topup.id),
      error: err.message,
    });
    return 'failed';
  }
  try {
    const intent = await stripe.paymentIntents.retrieve(intentId);
    if (intent && intent.status === 'succeeded') return 'already_succeeded';
    if (intent && intent.status === 'canceled') return 'already_canceled';
    await stripe.paymentIntents.cancel(intentId);
    return 'canceled';
  } catch (err) {
    logger.warn('[oxsteed-credit] Top-up expiry could not cancel the Stripe PaymentIntent (best-effort)', {
      topupId: String(topup.id),
      paymentIntentId: intentId,
      error: err.message,
    });
    return 'failed';
  }
}

// Phase 8: scheduled expiry of pending top-ups past their expires_at.
// Fails closed when the rail is disabled, like every other money-adjacent
// path. Each row expires under its own savepoint so one bad row never
// poisons the batch. Stripe cancellation is best-effort: when it reports
// the intent already succeeded, the row still expires but a critical
// incident pages the money discrepancy (the webhook completion guard
// refuses late completion, so the customer is never double-credited and
// the incident gives ops the trail to make it right).
async function expireCreditTopups({ limit = 500, getStripe = defaultGetStripe, actorUserId = null } = {}) {
  await assertCreditRailEnabled(pool);
  const batchSize = Math.max(1, Math.min(Number.parseInt(String(limit), 10) || 500, 500));
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT *
         FROM oxsteed_credit_topups
        WHERE status = 'pending' AND expires_at <= NOW()
        ORDER BY expires_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [batchSize]
    );
    const expired = [];
    const failed = [];
    for (const topup of rows) {
      await client.query('SAVEPOINT credit_expire_topup');
      try {
        const stripeCancelOutcome = await cancelTopupIntentBestEffort({ topup, getStripe });
        if (stripeCancelOutcome === 'already_succeeded') {
          try {
            await recordIncident({
              type: 'oxsteed_credit_topup_paid_but_expired',
              severity: 'critical',
              message: 'Stripe payment succeeded for an expired credit top-up',
              dedupeKey: `credit-topup-paid-expired:${topup.id}`,
              details: {
                topupId: String(topup.id),
                paymentIntentId: topup.stripe_payment_intent_id,
                customerId: String(topup.customer_id),
                amountCents: String(topup.amount_cents),
                currencyCode: topup.currency_code,
              },
            });
          } catch (incidentErr) {
            logger.error('[oxsteed-credit] Failed to record paid-but-expired top-up incident', {
              topupId: String(topup.id),
              error: incidentErr.message,
            });
          }
        }
        const { rows: updatedRows } = await client.query(
          `UPDATE oxsteed_credit_topups
              SET status = 'failed', updated_at = NOW()
            WHERE id = $1 AND status = 'pending'
            RETURNING *`,
          [topup.id]
        );
        if (!updatedRows[0]) {
          await client.query('RELEASE SAVEPOINT credit_expire_topup');
          continue;
        }
        await client.query(
          `INSERT INTO oxsteed_credit_audit_events
             (action_type, actor_user_id, customer_id, resource_type, resource_id, reason, after_state)
           VALUES ('credit.topup.expired', $1, $2, 'credit_topup', $3, 'Scheduled top-up expiry', $4::jsonb)`,
          [
            actorUserId || null,
            topup.customer_id,
            String(topup.id),
            JSON.stringify({
              stripeCancelOutcome,
              amountCents: Number(topup.amount_cents),
              currencyCode: topup.currency_code,
            }),
          ]
        );
        await client.query('RELEASE SAVEPOINT credit_expire_topup');
        expired.push({ id: String(updatedRows[0].id), stripeCancelOutcome });
      } catch (topupError) {
        await client.query('ROLLBACK TO SAVEPOINT credit_expire_topup');
        logger.warn('[oxsteed-credit] Scheduled top-up expiry failed for a single top-up; continuing with the batch', {
          topupId: String(topup.id),
          error: topupError.message,
        });
        failed.push({ topupId: String(topup.id), error: topupError.message, code: topupError.code || null });
      }
    }
    return { expired, count: expired.length, failed, failedCount: failed.length };
  }, 'credit_expire_topups');
}

// Ensure the Stripe PaymentIntent exists for a pending row. Safe to call from
// concurrent retries: the deterministic Stripe idempotency key makes every
// attempt converge on the same Stripe object, and the UPDATE only fills in a
// missing intent id.
async function ensureStripeIntent({ topup, amount, currency, getStripe, fundedBy = null }) {
  const stripe = getStripe();
  if (topup.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(topup.stripe_payment_intent_id);
    if (typeof existing?.id !== 'string' || !existing.id.trim()
      || typeof existing?.client_secret !== 'string' || !existing.client_secret.trim()) {
      return failInvalidStripeIntent({ topup, intent: existing, stripe });
    }
    return existing.client_secret.trim();
  }
  let intent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount,
        currency: currency.toLowerCase(),
        // G-22: funding metadata only on business-funded top-ups; the
        // self-service call stays byte-identical to before.
        metadata: fundedBy
          ? {
            oxsteed_credit_topup_id: String(topup.id),
            funded_by_business_id: String(fundedBy.businessId),
            funded_by_user_id: String(fundedBy.userId),
          }
          : { oxsteed_credit_topup_id: String(topup.id) },
      },
      { idempotencyKey: `${STRIPE_INTENT_IDEMPOTENCY_PREFIX}${topup.id}` }
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error('[oxsteed-credit] Stripe PaymentIntent creation failed for top-up', {
      topupId: String(topup.id),
      error: err.message,
    });
    await markTopupFailed(topup.id);
    throw new AppError('Stripe payment initiation failed', 502, 'credit_topup_stripe_failed');
  }
  if (typeof intent?.id !== 'string' || !intent.id.trim()
    || typeof intent?.client_secret !== 'string' || !intent.client_secret.trim()) {
    return failInvalidStripeIntent({ topup, intent, stripe });
  }
  await pool.query(
    `UPDATE oxsteed_credit_topups
        SET stripe_payment_intent_id = $2, updated_at = NOW()
      WHERE id = $1 AND stripe_payment_intent_id IS NULL`,
    [topup.id, intent.id.trim()]
  );
  return intent.client_secret.trim();
}

async function createTopup({ customerId, amountCents, currencyCode, idempotencyKey, getStripe = defaultGetStripe, fundedBy = null, retriedFromTopupId = null }) {
  if (!customerId) fail('Customer is required for a credit top-up', 'credit_topup_customer_required');
  const amount = validateTopupAmount(amountCents);
  const currency = assertSupportedCreditCurrency(currencyCode);
  // G-22: business-funded top-ups live in their own idempotency namespace
  // so a self-service key can never replay (or collide with) one, and the
  // funding columns record who paid. Self-service callers pass no fundedBy
  // and behave exactly as before.
  const rawKey = fundedBy
    ? `business-funded:${fundedBy.businessId}:${idempotencyKey}`
    : idempotencyKey;
  const normalizedKey = normalizeIdempotencyKey(rawKey);

  // The controller runs the fiat compliance gate first; the service still
  // asserts the rail kill switch itself before any persistent side effect.
  const { row: insertedOrExisting, created } = await withTransaction(pool, async (client) => {
    await assertCreditRailEnabled(client);
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_topups
         (customer_id, amount_cents, currency_code, status, idempotency_key, expires_at,
          funded_by_user_id, funded_by_business_id, funding_reason, retried_from_topup_id)
       VALUES ($1, $2, $3, 'pending', $4, NOW() + INTERVAL '30 minutes', $5, $6, $7, $8)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [customerId, amount, currency, normalizedKey,
        fundedBy ? fundedBy.userId : null,
        fundedBy ? fundedBy.businessId : null,
        fundedBy ? String(fundedBy.reason || '').slice(0, 500) : null,
        retriedFromTopupId || null]
    );
    if (rows[0]) {
      if (fundedBy) {
        // Explicit authorization record: who funded whom, from which
        // business, and why. Written in the same transaction as the row.
        await client.query(
          `INSERT INTO oxsteed_credit_audit_events
             (action_type, actor_user_id, customer_id, resource_type, resource_id, reason, after_state)
           VALUES ('credit.topup.business_funded', $1, $2, 'credit_topup', $3, $4, $5::jsonb)`,
          [
            fundedBy.userId,
            customerId,
            String(rows[0].id),
            String(fundedBy.reason || '').slice(0, 500),
            JSON.stringify({
              amountCents: amount,
              currencyCode: currency,
              businessId: String(fundedBy.businessId),
              fundedByUserId: String(fundedBy.userId),
            }),
          ]
        );
      }
      return { row: rows[0], created: true };
    }
    const { rows: existingRows } = await client.query(
      `SELECT * FROM oxsteed_credit_topups WHERE idempotency_key = $1`,
      [normalizedKey]
    );
    return { row: existingRows[0] || null, created: false };
  }, 'credit_topup_create');

  if (!insertedOrExisting) {
    fail('Credit top-up could not be created', 'credit_topup_create_failed', 500);
  }
  let topup = insertedOrExisting;

  // Fingerprint check: a reused idempotency key must carry identical semantics.
  if (Number(topup.amount_cents) !== amount || String(topup.currency_code) !== currency) {
    fail('Credit top-up idempotency key was already used with different parameters', 'credit_topup_idempotency_conflict', 409);
  }
  if (fundedBy && String(topup.funded_by_business_id || '') !== String(fundedBy.businessId)) {
    fail('Credit top-up idempotency key was already used for a different funding business', 'credit_topup_idempotency_conflict', 409);
  }

  if (topup.status === 'completed') {
    return { topup, clientSecret: null, replayed: true };
  }

  // A failed top-up is revivable: the customer is explicitly retrying, and the
  // same Stripe object (if any) stays confirmable with a new payment method.
  if (topup.status === 'failed') {
    const { rows: revivedRows } = await pool.query(
      `UPDATE oxsteed_credit_topups
          SET status = 'pending', updated_at = NOW()
        WHERE id = $1 AND status = 'failed'
        RETURNING *`,
      [topup.id]
    );
    if (revivedRows[0]) topup = revivedRows[0];
  }

  const clientSecret = await ensureStripeIntent({ topup, amount, currency, getStripe, fundedBy });
  const canonical = (await getTopupById(topup.id)) || topup;
  return { topup: canonical, clientSecret, replayed: !created };
}

// Group 13 Slice 4j (699): the unified approval record. Both doors read
// the same top-up row; the funder and business display names ride a LEFT
// JOIN here so the recipient's read carries the same funder and approval
// info as the funder-side record — no second record, no duplicated row.
// A self-service top-up has no funder, so both names come back NULL.
const TOPUP_WITH_FUNDING_COLUMNS = `t.*,
  NULLIF(TRIM(BOTH ' ' FROM COALESCE(fu.first_name, '') || ' ' || COALESCE(fu.last_name, '')), '') AS funded_by_name,
  b.business_name AS funded_by_business_name`;
const TOPUP_WITH_FUNDING_JOINS = `oxsteed_credit_topups t
  LEFT JOIN users fu ON fu.id = t.funded_by_user_id
  LEFT JOIN businesses b ON b.id = t.funded_by_business_id`;

// G-22: business-funded top-up reads. The funder (owner/manager) reads the
// top-ups their business funded; the recipient reads their own via
// getCustomerTopup as before. Settlement still credits topup.customer_id.
async function getBusinessTopup({ businessId, topupId }) {
  if (!businessId || !topupId) return null;
  const { rows } = await pool.query(
    `SELECT ${TOPUP_WITH_FUNDING_COLUMNS} FROM ${TOPUP_WITH_FUNDING_JOINS} WHERE t.id = $1 AND t.funded_by_business_id = $2`,
    [topupId, businessId]
  );
  return rows[0] || null;
}

async function listBusinessTopups({ businessId, limit = 20, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT ${TOPUP_WITH_FUNDING_COLUMNS} FROM ${TOPUP_WITH_FUNDING_JOINS}
      WHERE t.funded_by_business_id = $1
      ORDER BY t.created_at DESC
      LIMIT $2 OFFSET $3`,
    [businessId, Math.min(Math.max(Number(limit) || 20, 1), 100), Math.max(Number(offset) || 0, 0)]
  );
  return rows;
}

// Group 13 Slice 4b (657): the customer's own top-ups, newest first,
// optionally filtered to one status. The credit page lists pending top-ups
// from this read; it reuses the existing top-up rows and formatTopup — no
// second top-up system. A customer sees only rows whose customer_id is
// their own (self-service and business-funded top-ups alike: settlement
// credits topup.customer_id either way).
async function listCustomerTopups({ customerId, status = null, limit = 20, offset = 0 }) {
  if (!customerId) return [];
  const values = [customerId];
  let where = 't.customer_id = $1';
  if (status) {
    values.push(status);
    where += ` AND t.status = $${values.length}`;
  }
  values.push(Math.min(Math.max(Number(limit) || 20, 1), 100), Math.max(Number(offset) || 0, 0));
  const { rows } = await pool.query(
    `SELECT ${TOPUP_WITH_FUNDING_COLUMNS} FROM ${TOPUP_WITH_FUNDING_JOINS}
      WHERE ${where}
      ORDER BY t.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return rows;
}

async function getCustomerTopup({ customerId, topupId }) {
  if (!customerId || !topupId) return null;
  const { rows } = await pool.query(
    `SELECT ${TOPUP_WITH_FUNDING_COLUMNS} FROM ${TOPUP_WITH_FUNDING_JOINS} WHERE t.id = $1 AND t.customer_id = $2`,
    [topupId, customerId]
  );
  return rows[0] || null;
}

// Group 13 Slice 4f (680, D-376/D-377/D-378/D-379): retry a failed top-up
// from its own record.
//
// The retry is a NEW top-up row created through the existing `createTopup`
// path with the same amount/currency (and, for a business-funded top-up,
// the same funder, business, and reason) and a fresh idempotency key, so
// the rail gate, the compliance gate, the step-up, and the Stripe intent
// flow all apply unchanged — no new money executor, no gate bypassed.
// The failed original is never mutated: it stays `failed` and visible,
// linked to its retry by `retried_from_topup_id` (migration
// 20261124161215), so the record view can show the retry link.
//
// Only `failed` can be retried. `requires_attention` means money may
// already have moved at Stripe while the journal post failed, so a retry
// could double-charge; that record needs human review, not a new attempt.
// `pending`/`completed` are not retryable either.
//
// One retry per failed record (partial unique index on
// `retried_from_topup_id`): a repeat retry replays the existing child
// instead of starting a second attempt. A child that itself fails is
// retried from the child, forming a chain — never by reviving the child
// in place, and never by re-posting the original.
async function getTopupRetryChild({ topupId }) {
  if (!topupId) return null;
  const { rows } = await pool.query(
    `SELECT * FROM oxsteed_credit_topups WHERE retried_from_topup_id = $1`,
    [topupId]
  );
  return rows[0] || null;
}

function stripBusinessKeyPrefix(storedKey, businessId) {
  const prefix = `business-funded:${businessId}:`;
  return String(storedKey || '').startsWith(prefix)
    ? String(storedKey).slice(prefix.length)
    : String(storedKey || '');
}

// Replays an existing retry child through the normal create path so a
// pending child hands back its Stripe client secret (the intent is
// retrieved, never re-created). A terminal child (completed, failed,
// requires_attention) is returned as-is: a failed child is retried from
// the child, not revived, and a requires_attention child must not move
// money again.
async function replayRetryChild({ child, fundedBy = null, getStripe }) {
  if (!child) return null;
  if (child.status !== 'pending') {
    return { topup: child, clientSecret: null, replayed: true };
  }
  const idempotencyKey = fundedBy
    ? stripBusinessKeyPrefix(child.idempotency_key, fundedBy.businessId)
    : child.idempotency_key;
  return createTopup({
    customerId: child.customer_id,
    amountCents: Number(child.amount_cents),
    currencyCode: child.currency_code,
    idempotencyKey,
    getStripe,
    fundedBy,
  });
}

async function recordRetryAudit({ actorUserId, customerId, topup, original }) {
  await pool.query(
    `INSERT INTO oxsteed_credit_audit_events
       (action_type, actor_user_id, customer_id, resource_type, resource_id, reason, after_state)
     VALUES ('credit.topup.retried', $1, $2, 'credit_topup', $3, $4, $5::jsonb)`,
    [
      actorUserId,
      customerId,
      String(topup.id),
      `Retry of failed top-up ${original.id}`,
      JSON.stringify({
        retriedFromTopupId: String(original.id),
        amountCents: Number(topup.amount_cents),
        currencyCode: topup.currency_code,
      }),
    ]
  );
}

async function retryTopup({ customerId, topupId, idempotencyKey, getStripe = defaultGetStripe }) {
  const original = await getCustomerTopup({ customerId, topupId });
  if (!original) {
    fail('Credit top-up not found', 'credit_topup_not_found', 404);
  }
  // A business-funded top-up is retried by its funder through the business
  // path, with the same funder/business/reason. The recipient retrying it
  // as self-service would silently change who pays.
  if (original.funded_by_business_id) {
    fail('A business-funded top-up can only be retried by the business that funded it', 'credit_topup_retry_funder_required', 403);
  }
  if (original.status !== 'failed') {
    fail('Only a failed top-up can be retried', 'credit_topup_state_invalid', 409);
  }
  const existingChild = await getTopupRetryChild({ topupId: original.id });
  if (existingChild) {
    return replayRetryChild({ child: existingChild, getStripe });
  }
  try {
    const result = await createTopup({
      customerId,
      amountCents: Number(original.amount_cents),
      currencyCode: original.currency_code,
      idempotencyKey,
      getStripe,
      retriedFromTopupId: original.id,
    });
    if (!result.replayed) {
      await recordRetryAudit({ actorUserId: customerId, customerId, topup: result.topup, original });
    }
    return result;
  } catch (err) {
    // A concurrent retry won the one-child race: replay its child instead
    // of failing the second caller or starting a second attempt.
    if (err && err.code === '23505'
      && err.constraint === 'idx_oxsteed_credit_topups_retried_from_unique') {
      const child = await getTopupRetryChild({ topupId: original.id });
      if (child) return replayRetryChild({ child, getStripe });
    }
    throw err;
  }
}

async function retryBusinessTopup({ businessId, funderId, topupId, idempotencyKey, getStripe = defaultGetStripe }) {
  const original = await getBusinessTopup({ businessId, topupId });
  if (!original) {
    fail('Credit top-up not found', 'credit_topup_not_found', 404);
  }
  if (original.status !== 'failed') {
    fail('Only a failed top-up can be retried', 'credit_topup_state_invalid', 409);
  }
  const fundedBy = {
    userId: funderId,
    businessId,
    reason: original.funding_reason || '',
  };
  const existingChild = await getTopupRetryChild({ topupId: original.id });
  if (existingChild) {
    return replayRetryChild({ child: existingChild, fundedBy, getStripe });
  }
  try {
    const result = await createTopup({
      customerId: original.customer_id,
      amountCents: Number(original.amount_cents),
      currencyCode: original.currency_code,
      idempotencyKey,
      getStripe,
      fundedBy,
      retriedFromTopupId: original.id,
    });
    if (!result.replayed) {
      await recordRetryAudit({
        actorUserId: funderId,
        customerId: original.customer_id,
        topup: result.topup,
        original,
      });
    }
    return result;
  } catch (err) {
    if (err && err.code === '23505'
      && err.constraint === 'idx_oxsteed_credit_topups_retried_from_unique') {
      const child = await getTopupRetryChild({ topupId: original.id });
      if (child) return replayRetryChild({ child, fundedBy, getStripe });
    }
    throw err;
  }
}

// R-3: resolve the actor for top-up settlement journal posts.
// Migration 487's trigger rejects load/adjustment posts unless the
// actor is an admin with a user id and a real reason. A Stripe webhook
// has no human admin, so settlement posted as actorType 'system' and
// fails on any database where 487 is applied: Stripe-paid top-ups
// then never credit and the customer wallet stays empty.
// When OXSTEED_CREDIT_SERVICE_ADMIN_ID names an existing admin user,
// settlement posts as that admin with reason 'stripe top-up
// settlement'. When it is unset, or names no admin user, the current
// behavior is preserved exactly (system actor + a loud log), because
// deployments where 487 is not applied still complete top-ups through
// the system actor today. Emile must set the value in Coolify to the
// id of a dedicated service-admin user (role admin) for any deployment
// where 487 is applied. Whether 487 is applied in production is
// UNVERIFIED (Emile's domain).
async function resolveTopupSettlementActor(client) {
  const serviceAdminId = String(process.env.OXSTEED_CREDIT_SERVICE_ADMIN_ID || '').trim();
  if (!serviceAdminId) {
    logger.warn('[credit-topup] OXSTEED_CREDIT_SERVICE_ADMIN_ID is not set; top-up settlement posts as actorType system and will fail on databases with migration 487 applied. Set it in Coolify to a dedicated service-admin user id.');
    return { actorType: 'system', actorUserId: null, reason: 'Stripe top-up' };
  }
  const { rows } = await client.query(
    `SELECT id, role FROM users WHERE id = $1 AND is_active = TRUE`,
    [serviceAdminId]
  );
  const admin = rows[0];
  // Migration 477 binds the admin actor label to an active user with
  // role admin or super_admin; anything else is not attributable.
  if (!admin || !['admin', 'super_admin'].includes(admin.role)) {
    logger.error('[credit-topup] OXSTEED_CREDIT_SERVICE_ADMIN_ID does not name an admin user; falling back to the system actor (top-up settlement will fail on databases with migration 487 applied).');
    return { actorType: 'system', actorUserId: null, reason: 'Stripe top-up' };
  }
  return { actorType: 'admin', actorUserId: admin.id, reason: 'stripe top-up settlement' };
}

// Webhook: the PaymentIntent succeeded. Credit the customer wallet with one
// balanced `load` journal transaction. Runs in a single DB transaction.
// KNOWN DEFECT (pre-existing, needs Emile's call; see the counsel brief
// and investCreditLots.db.test.js): when the journal post fails, the
// parking UPDATE below runs inside the already-aborted transaction, so
// the call throws `current transaction is aborted` instead of parking
// the top-up as requires_attention, the top-up stays `pending`, and no
// incident is recorded. Stripe redelivery retries the same failure.
// Do NOT read the catch block below as a working parking path: it only
// executes when the journal post fails without aborting the transaction.
async function completeCreditTopupFromWebhook({ paymentIntentId, providerEvidence = null }) {
  let journalError = null;
  let topupId = null;
  const result = await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_topups WHERE stripe_payment_intent_id = $1 FOR UPDATE`,
      [paymentIntentId]
    );
    const topup = rows[0];
    if (!topup) return { outcome: 'ignored' };
    topupId = topup.id;
    if (topup.status === 'completed') return { outcome: 'duplicate', topupId };
    if (topup.status !== 'pending' && topup.status !== 'requires_attention') {
      return { outcome: 'ignored', reason: `status_${topup.status}`, topupId };
    }

    // Phase 8 expiry guard: an expired pending top-up cannot complete. The
    // sweeper cancels the Stripe PaymentIntent server-side, but a succeeded
    // event already in flight (or a cancel that failed) could still arrive
    // late; without this guard it would credit a row the sweeper already
    // failed, and a revived row would credit twice. requires_attention rows
    // keep their retry path: money already moved at Stripe for those, so
    // blocking them would manufacture the missing-in-ledger condition the
    // external reconciliation exists to catch.
    if (topup.status === 'pending' && topup.expires_at && new Date(topup.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE oxsteed_credit_topups
            SET status = 'failed', updated_at = NOW()
          WHERE id = $1 AND status = 'pending'`,
        [topup.id]
      );
      await client.query(
        `INSERT INTO oxsteed_credit_audit_events
           (action_type, actor_user_id, customer_id, resource_type, resource_id, reason, after_state)
         VALUES ('credit.topup.expired_at_webhook', NULL, $1, 'credit_topup', $2, 'Expired top-up completion blocked', $3::jsonb)`,
        [topup.customer_id, String(topup.id), JSON.stringify({ paymentIntentId, expiredAt: topup.expires_at })]
      );
      return { outcome: 'expired', topupId };
    }

    const amount = Number(topup.amount_cents);
    const currency = assertSupportedCreditCurrency(topup.currency_code);
    if (providerEvidence) {
      const providerAmount = Number(providerEvidence.amountCents);
      const providerCurrency = typeof providerEvidence.currency === 'string'
        ? providerEvidence.currency.toLowerCase()
        : '';
      if (!Number.isSafeInteger(providerAmount)
          || providerAmount !== amount
          || providerCurrency !== currency.toLowerCase()) {
        throw new AppError(
          'Stripe Credit top-up does not match the local top-up record',
          409,
          'credit_topup_verification_failed',
        );
      }
    }

    // Webhook-driven completion of an already-initiated external event:
    // keep the rail-enabled gate but bypass the operator freeze, so
    // in-flight money that Stripe already moved keeps resolving. Blocking
    // this path would manufacture the missing-in-ledger condition the
    // external reconciliation exists to catch.
    await assertCreditRailEnabled(client, { bypassFreeze: true });
    await assertIssuanceCapacity(client, amount, currency, topup.customer_id);
    const wallet = await ensureAccount(client, {
      accountType: 'customer_wallet', customerId: topup.customer_id, currencyCode: currency,
    });
    const treasury = await ensureAccount(client, {
      accountType: 'platform_treasury', currencyCode: currency,
    });

    try {
      // R-3: resolve the settlement actor before posting (see
      // resolveTopupSettlementActor above).
      const settlementActor = await resolveTopupSettlementActor(client);
      const { transaction } = await postJournalTransaction(client, {
        transactionType: 'load',
        debitAccountId: treasury.id,
        creditAccountId: wallet.id,
        customerId: topup.customer_id,
        amountCents: amount,
        currencyCode: currency,
        idempotencyKey: `${JOURNAL_IDEMPOTENCY_PREFIX}${topup.id}`,
        actorType: settlementActor.actorType,
        actorUserId: settlementActor.actorUserId,
        reason: settlementActor.reason,
        description: 'Stripe top-up',
        referenceType: 'stripe_topup',
        referenceId: paymentIntentId,
        metadata: { source: 'stripe_topup', stripePaymentIntentId: paymentIntentId },
        bindIdempotencySemantics: true,
      });
      await client.query(
        `UPDATE oxsteed_credit_topups
            SET status = 'completed', account_id = $2, journal_transaction_id = $3, updated_at = NOW()
          WHERE id = $1`,
        [topup.id, wallet.id, transaction.id]
      );
      // OxSteed Invest lot tagging: a completed top-up is provably
      // purchased settled value, so it gets a `purchased` lot in the
      // same transaction as the journal post. The catch below intends
      // to park the top-up as requires_attention when the journal post
      // or the tagging fails, but that parking UPDATE runs inside the
      // already-aborted transaction (see the function header): on a
      // journal-post failure the call throws instead of parking and
      // the top-up stays `pending`. createLot is idempotent on the
      // top-up id, so a retry that does reach the tag cannot double-tag.
      await createLot(client, {
        accountId: wallet.id,
        customerId: topup.customer_id,
        currencyCode: currency,
        source: 'purchased',
        amountCents: amount,
        settledAt: new Date().toISOString(),
        originatingTransactionId: transaction.id,
        topupId: topup.id,
        referenceType: 'stripe_topup',
        referenceId: paymentIntentId,
      });
      return {
        outcome: 'completed',
        topupId,
        transactionId: transaction.id,
        customerId: topup.customer_id,
        amountCents: amount,
        currencyCode: currency,
      };
    } catch (err) {
      await client.query(
        `UPDATE oxsteed_credit_topups
            SET status = 'requires_attention', updated_at = NOW()
          WHERE id = $1`,
        [topup.id]
      );
      journalError = err;
      return { outcome: 'requires_attention', topupId };
    }
  }, 'credit_topup_complete');

  if (result.outcome === 'requires_attention' && journalError) {
    try {
      await recordIncident({
        type: 'oxsteed_credit_topup_uncredited',
        severity: 'critical',
        message: 'Stripe payment received but credit not posted',
        dedupeKey: `credit-topup-uncredited:${topupId || paymentIntentId}`,
        details: { topupId: String(topupId || ''), paymentIntentId, error: journalError.message },
      });
    } catch (incidentErr) {
      logger.error('[oxsteed-credit] Failed to record top-up uncredited incident', {
        error: incidentErr.message,
      });
    }
    throw journalError;
  }
  if (result.outcome === 'expired') {
    // A succeeded event for an expired top-up means money may have moved at
    // Stripe with no credit issued. Blocking the completion is deliberate
    // (no rethrow: Stripe retrying would not change the outcome); the
    // incident pages the discrepancy for human review. The dedupe key is
    // shared with the sweeper's paid-but-expired incident.
    try {
      await recordIncident({
        type: 'oxsteed_credit_topup_expired_webhook',
        severity: 'critical',
        message: 'Late Stripe top-up completion was blocked because the top-up had expired',
        dedupeKey: `credit-topup-paid-expired:${result.topupId}`,
        details: { topupId: String(result.topupId), paymentIntentId },
      });
    } catch (incidentErr) {
      logger.error('[oxsteed-credit] Failed to record expired top-up webhook incident', {
        error: incidentErr.message,
      });
    }
  }
  if (result.outcome === 'completed') {
    // Live balance nudge (D-445): post-commit only; best-effort, and never
    // fails a completed top-up. No amounts in the payload.
    try {
      const socketService = require('./socketService');
      if (typeof socketService.broadcastCreditBalance === 'function') {
        socketService.broadcastCreditBalance(result.customerId, {
          kind: 'topup', currencyCode: result.currencyCode, transactionId: result.transactionId,
        });
      }
    } catch {
      // A failed nudge must never fail a completed top-up.
    }
  }
  return result;
}

// Webhook: the PaymentIntent failed or was canceled. Only pending top-ups are
// marked failed; completed/requires_attention rows keep their state.
async function failCreditTopupFromWebhook({ paymentIntentId }) {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT id, status FROM oxsteed_credit_topups WHERE stripe_payment_intent_id = $1 FOR UPDATE`,
      [paymentIntentId]
    );
    const topup = rows[0];
    if (!topup) return { outcome: 'ignored' };
    if (topup.status !== 'pending') {
      return { outcome: 'ignored', reason: `status_${topup.status}` };
    }
    await client.query(
      `UPDATE oxsteed_credit_topups
          SET status = 'failed', updated_at = NOW()
        WHERE id = $1`,
      [topup.id]
    );
    return { outcome: 'failed' };
  }, 'credit_topup_fail');
}

// Central webhook entry point for OxSteed Credit Stripe events. Returns true
// when the event is ours and was handled, false when it is not ours (the
// caller falls through to the other Stripe flows). The upstream
// beginWebhookEvent receipt dedupe makes same-event-id replays no-ops before
// this is reached.
async function applyCreditTopupWebhookEvent({ type, object }) {
  const metadata = object?.metadata || {};
  switch (type) {
    case 'payment_intent.succeeded': {
      if (!metadata.oxsteed_credit_topup_id) return false;
      const result = await completeCreditTopupFromWebhook({
        paymentIntentId: object.id,
        providerEvidence: {
          amountCents: object.amount_received ?? object.amount,
          currency: object.currency,
        },
      });
      if (result.outcome === 'completed' && result.customerId) {
        try {
          await sendNotification({
            userId: result.customerId,
            type: 'payment_receipt',
            data: {
              credit_topup_id: String(result.topupId),
              payment_intent_id: object.id,
              amount: (result.amountCents / 100).toFixed(2),
              currency: result.currencyCode,
            },
            action_url: '/oxsteed-credit',
            idempotencyKey: `credit-topup-receipt:${result.topupId}`,
          });
        } catch (err) {
          logger.warn('[oxsteed-credit] Failed to send top-up receipt notification', {
            topupId: String(result.topupId),
            error: err.message,
          });
        }
      }
      return true;
    }
    case 'payment_intent.payment_failed':
    case 'payment_intent.canceled': {
      if (!metadata.oxsteed_credit_topup_id) return false;
      await failCreditTopupFromWebhook({ paymentIntentId: object.id });
      return true;
    }
    case 'transfer.created':
    case 'transfer.updated': {
      // Builder B's contract: confirm payout status from the Stripe transfer.
      if (metadata.oxsteed_credit_settlement_id) {
        try {
          await require('./oxsteedCreditAdminService').confirmSettlementPayoutFromTransfer(object.id);
        } catch (err) {
          logger.error('[oxsteed-credit] Settlement payout confirmation failed; leaving for Stripe retry', {
            transferId: object.id,
            error: err.message,
          });
          throw err;
        }
        return true;
      }
      // Phase 6: customer withdrawal payouts confirm the same way.
      if (metadata.oxsteed_credit_withdrawal_id) {
        try {
          await require('./oxsteedCreditWithdrawalService').confirmWithdrawalFromTransfer(object.id);
        } catch (err) {
          logger.error('[oxsteed-credit] Withdrawal payout confirmation failed; leaving for Stripe retry', {
            transferId: object.id,
            error: err.message,
          });
          throw err;
        }
        return true;
      }
      return false;
    }
    case 'transfer.reversed': {
      if (metadata.oxsteed_credit_settlement_id) {
        try {
          await require('./oxsteedCreditAdminService').failSettlementPayoutFromTransfer(object.id, 'transfer_reversed');
        } catch (err) {
          logger.error('[oxsteed-credit] Settlement payout failure recording failed; leaving for Stripe retry', {
            transferId: object.id,
            error: err.message,
          });
          throw err;
        }
        return true;
      }
      // Phase 6: a reversed withdrawal transfer fails the withdrawal and
      // posts a compensating reversal of the lock leg (append-only).
      if (metadata.oxsteed_credit_withdrawal_id) {
        try {
          await require('./oxsteedCreditWithdrawalService').failWithdrawalFromTransfer(object.id, 'transfer_reversed');
        } catch (err) {
          logger.error('[oxsteed-credit] Withdrawal payout failure recording failed; leaving for Stripe retry', {
            transferId: object.id,
            error: err.message,
          });
          throw err;
        }
        return true;
      }
      return false;
    }
    default:
      return false;
  }
}

module.exports = {
  MIN_TOPUP_CENTS,
  createTopup,
  retryTopup,
  retryBusinessTopup,
  getTopupRetryChild,
  getTopupById,
  getCustomerTopup,
  getBusinessTopup,
  listBusinessTopups,
  listCustomerTopups,
  completeCreditTopupFromWebhook,
  failCreditTopupFromWebhook,
  applyCreditTopupWebhookEvent,
  expireCreditTopups,
};
