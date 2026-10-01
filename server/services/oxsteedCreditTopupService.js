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
const {
  MAX_TRANSACTION_CENTS,
  assertSupportedCreditCurrency,
  assertCreditRailEnabled,
  assertIssuanceCapacity,
  ensureAccount,
  postJournalTransaction,
} = require('./oxsteedCreditService');
const { recordIncident } = require('./incidentStore');

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
async function ensureStripeIntent({ topup, amount, currency, getStripe }) {
  const stripe = getStripe();
  if (topup.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(topup.stripe_payment_intent_id);
    return existing.client_secret || null;
  }
  let intent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount,
        currency: currency.toLowerCase(),
        metadata: { oxsteed_credit_topup_id: String(topup.id) },
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
  await pool.query(
    `UPDATE oxsteed_credit_topups
        SET stripe_payment_intent_id = $2, updated_at = NOW()
      WHERE id = $1 AND stripe_payment_intent_id IS NULL`,
    [topup.id, intent.id]
  );
  return intent.client_secret || null;
}

async function createTopup({ customerId, amountCents, currencyCode, idempotencyKey, getStripe = defaultGetStripe }) {
  if (!customerId) fail('Customer is required for a credit top-up', 'credit_topup_customer_required');
  const amount = validateTopupAmount(amountCents);
  const currency = assertSupportedCreditCurrency(currencyCode);
  const normalizedKey = normalizeIdempotencyKey(idempotencyKey);

  // The controller runs the fiat compliance gate first; the service still
  // asserts the rail kill switch itself before any persistent side effect.
  const { row: insertedOrExisting, created } = await withTransaction(pool, async (client) => {
    await assertCreditRailEnabled(client);
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_topups
         (customer_id, amount_cents, currency_code, status, idempotency_key, expires_at)
       VALUES ($1, $2, $3, 'pending', $4, NOW() + INTERVAL '30 minutes')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [customerId, amount, currency, normalizedKey]
    );
    if (rows[0]) return { row: rows[0], created: true };
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

  const clientSecret = await ensureStripeIntent({ topup, amount, currency, getStripe });
  const canonical = (await getTopupById(topup.id)) || topup;
  return { topup: canonical, clientSecret, replayed: !created };
}

async function getCustomerTopup({ customerId, topupId }) {
  if (!customerId || !topupId) return null;
  const { rows } = await pool.query(
    `SELECT * FROM oxsteed_credit_topups WHERE id = $1 AND customer_id = $2`,
    [topupId, customerId]
  );
  return rows[0] || null;
}

// Webhook: the PaymentIntent succeeded. Credit the customer wallet with one
// balanced `load` journal transaction. Runs in a single DB transaction;
// journal-post failure parks the top-up as requires_attention, records a
// critical incident after commit, and rethrows so Stripe redelivers and the
// journal post is retried (the deterministic journal idempotency key makes
// the retry safe).
async function completeCreditTopupFromWebhook({ paymentIntentId }) {
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

    // Webhook-driven completion of an already-initiated external event:
    // keep the rail-enabled gate but bypass the operator freeze, so
    // in-flight money that Stripe already moved keeps resolving. Blocking
    // this path would manufacture the missing-in-ledger condition the
    // external reconciliation exists to catch.
    await assertCreditRailEnabled(client, { bypassFreeze: true });
    const amount = Number(topup.amount_cents);
    const currency = assertSupportedCreditCurrency(topup.currency_code);
    await assertIssuanceCapacity(client, amount, currency, topup.customer_id);
    const wallet = await ensureAccount(client, {
      accountType: 'customer_wallet', customerId: topup.customer_id, currencyCode: currency,
    });
    const treasury = await ensureAccount(client, {
      accountType: 'platform_treasury', currencyCode: currency,
    });

    try {
      const { transaction } = await postJournalTransaction(client, {
        transactionType: 'load',
        debitAccountId: treasury.id,
        creditAccountId: wallet.id,
        customerId: topup.customer_id,
        amountCents: amount,
        currencyCode: currency,
        idempotencyKey: `${JOURNAL_IDEMPOTENCY_PREFIX}${topup.id}`,
        actorType: 'system',
        reason: 'Stripe top-up',
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
      return { outcome: 'completed', topupId, transactionId: transaction.id };
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
      await completeCreditTopupFromWebhook({ paymentIntentId: object.id });
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
  getTopupById,
  getCustomerTopup,
  completeCreditTopupFromWebhook,
  failCreditTopupFromWebhook,
  applyCreditTopupWebhookEvent,
  expireCreditTopups,
};
