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
};
