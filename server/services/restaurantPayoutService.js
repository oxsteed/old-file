'use strict';

/**
 * restaurantPayoutService.js — restaurant wallet-earnings payouts.
 *
 * Card revenue settles directly to the restaurant's Stripe Connect account
 * (destination charges), so OxSteed never holds it. This service moves the
 * wallet/credit slice: balances that accumulated as OxSteed's liability in
 * restaurant_sub_bank(restaurant_id, currency).
 *
 * Lifecycle: requested -> approved -> processing -> completed
 *                         \-> reversed (provider reversal)
 * The journal intent and the provider outbox row are committed before any
 * Stripe call. A worker owns the external call and webhooks are the authority
 * for completed/reversed provider state. This is intentionally asynchronous:
 * a database rollback can no longer hide an already-created transfer.
 */

const { AppError } = require('../middleware/errorHandler');
const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const {
  ensureAccount,
  postJournalTransaction,
  assertSupportedCreditCurrency,
} = require('./oxsteedCreditService');
const { ensureRestaurantSubBankAccount } = require('./oxsteedCreditSubBankService');
const { sendNotification } = require('./notificationService');

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

const MIN_PAYOUT_CENTS = (() => {
  const parsed = Number.parseInt(process.env.RESTAURANT_PAYOUT_MIN_CENTS || '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1000; // $10 default
})();

const MAX_TRANSFER_ATTEMPTS = 12;
const TRANSFER_LEASE_SECONDS = 300;

function processorEnabled() {
  return process.env.PAYOUT_PROCESSOR_ENABLED === 'true' && !!stripe;
}

function payoutIdempotencyKey(payoutId) {
  return `restaurant-payout:${payoutId}`;
}

function payoutTransferIdempotencyKey(payoutId) {
  return `restaurant-payout-transfer:${payoutId}`;
}

function payoutReversalIdempotencyKey(payoutId) {
  return `restaurant-payout-reversal:${payoutId}`;
}

function transferPayload(payout) {
  return {
    amount: Number(payout.amount_cents),
    currency: String(payout.currency_code).toLowerCase(),
    destination: payout.stripe_account_id,
    description: `OxSteed wallet earnings payout - ${payout.restaurant_id}`,
    metadata: {
      restaurant_payout_id: String(payout.id),
      restaurant_id: String(payout.restaurant_id),
    },
  };
}

function providerTransferMatchesPayout(transfer, payout) {
  if (!transfer) return false;
  const amountMatches = transfer.amount == null || Number(transfer.amount) === Number(payout.amount_cents);
  const currencyMatches = !transfer.currency || String(transfer.currency).toUpperCase() === String(payout.currency_code).toUpperCase();
  const destination = typeof transfer.destination === 'string'
    ? transfer.destination
    : transfer.destination?.id;
  const destinationMatches = !destination || destination === payout.stripe_account_id;
  return amountMatches && currencyMatches && destinationMatches;
}

/**
 * Read the payoutable wallet-earnings balance for a restaurant + currency:
 * the restaurant_sub_bank account balance on the central journal.
 */
async function getPayoutableBalance(client, restaurantId, currencyCode) {
  const currency = assertSupportedCreditCurrency(currencyCode);
  const account = await ensureRestaurantSubBankAccount(client, {
    restaurantId,
    currencyCode: currency,
  });
  return {
    currencyCode: currency,
    balanceCents: Number(account.balance_cents || 0),
    accountId: account.id,
  };
}

async function requireRestaurantOwnership(client, userId, restaurantId) {
  const { rows } = await client.query(
    `SELECT fr.id, fr.display_name, fr.currency_code,
            -- Audit fix: single Connect source of truth. The UI onboards
            -- into restaurant_connect_accounts; prefer it over the legacy
            -- businesses.stripe_account_id.
            COALESCE(rca.stripe_account_id, b.stripe_account_id) AS stripe_account_id,
            COALESCE(rca.payouts_enabled, b.stripe_payouts_enabled, FALSE) AS stripe_payouts_enabled
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
       LEFT JOIN restaurant_connect_accounts rca ON rca.restaurant_id = fr.id
      WHERE fr.id = $1
        AND b.user_id = $2
        AND fr.status = 'active'
        AND b.is_active = TRUE
        AND b.deleted_at IS NULL`,
    [restaurantId, userId]
  );
  const row = rows[0];
  if (!row) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  return row;
}

/**
 * Restaurant requests a payout of wallet earnings.
 */
async function requestPayout({ restaurantId, userId, amountCents, currencyCode, idempotencyKey }) {
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError('Invalid payout amount', 400, 'validation_failed');
  }
  if (amount < MIN_PAYOUT_CENTS) {
    throw new AppError(
      `Minimum payout is ${MIN_PAYOUT_CENTS / 100}`,
      400,
      'payout_below_minimum'
    );
  }
  const key = String(idempotencyKey || '').trim().slice(0, 120);
  if (!key) throw new AppError('Idempotency key is required', 400, 'validation_failed');

  return withTransaction(pool, async (client) => {
    const restaurant = await requireRestaurantOwnership(client, userId, restaurantId);
    const currency = assertSupportedCreditCurrency(currencyCode || restaurant.currency_code);
    if (!restaurant.stripe_account_id) {
      throw new AppError('Connect a Stripe payout account first', 400, 'payout_account_not_connected');
    }

    const { balanceCents } = await getPayoutableBalance(client, restaurantId, currency);
    if (amount > balanceCents) {
      throw new AppError('Payout exceeds available balance', 400, 'payout_exceeds_balance');
    }

    const { rows } = await client.query(
      `INSERT INTO restaurant_payouts
         (restaurant_id, currency_code, amount_cents, stripe_account_id,
          idempotency_key, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (restaurant_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [restaurantId, currency, amount, restaurant.stripe_account_id, key, userId]
    );
    let payout = rows[0];
    if (!payout) {
      const { rows: existing } = await client.query(
        `SELECT * FROM restaurant_payouts WHERE restaurant_id = $1 AND idempotency_key = $2`,
        [restaurantId, key]
      );
      payout = existing[0];
      if (!payout) throw new AppError('Payout could not be created', 500, 'payout_create_failed');
    }
    logger.info('[RestaurantPayout] requested', {
      payoutId: payout.id,
      restaurantId,
      amountCents: amount,
      currency,
    });
    return payout;
  }, 'restaurant_payout_request');
}

async function listPayouts(client, { restaurantId, userId, status, limit = 50 }) {
  await requireRestaurantOwnership(client, userId, restaurantId);
  const conditions = ['restaurant_id = $1'];
  const values = [restaurantId];
  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }
  const { rows } = await client.query(
    `SELECT * FROM restaurant_payouts
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${values.length + 1}`,
    [...values, Math.min(200, Math.max(1, Number(limit) || 50))]
  );
  return rows;
}

async function approvePayout({ payoutId, adminUserId, reviewNote }) {
  if (!processorEnabled()) {
    throw new AppError('Payout processing is not enabled', 503, 'payout_processor_disabled');
  }

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM restaurant_payouts WHERE id = $1 FOR UPDATE`,
      [payoutId]
    );
    const payout = rows[0];
    if (!payout) throw new AppError('Payout not found', 404, 'payout_not_found');
    if (payout.status !== 'requested') {
      throw new AppError(`Payout is ${payout.status}, cannot approve`, 409, 'payout_invalid_status');
    }

    // Re-validate the balance at execution time: earnings may have moved
    // since the request (refunds, new orders).
    const { balanceCents } = await getPayoutableBalance(
      client,
      payout.restaurant_id,
      payout.currency_code
    );
    if (payout.amount_cents > balanceCents) {
      await client.query(
        `UPDATE restaurant_payouts
            SET status = 'failed', failure_reason = 'insufficient balance at execution',
                reviewed_by = $2, reviewed_at = NOW(), review_note = $3,
                funds_settled = FALSE, updated_at = NOW()
          WHERE id = $1`,
        [payout.id, adminUserId, reviewNote || null]
      );
      throw new AppError('Insufficient balance at execution', 409, 'payout_insufficient_balance');
    }

    // Commit the liability movement before asking Stripe to move money. The
    // outbox row is in the same transaction, so a worker can safely retry the
    // provider call after a crash without creating an unjournaled transfer.
    const subBank = await ensureRestaurantSubBankAccount(client, {
      restaurantId: payout.restaurant_id,
      currencyCode: payout.currency_code,
    });
    const treasury = await ensureAccount(client, {
      accountType: 'platform_treasury',
      currencyCode: payout.currency_code,
    });
    const journal = await postJournalTransaction(client, {
      transactionType: 'sub_bank_payout',
      debitAccountId: subBank.id,
      creditAccountId: treasury.id,
      amountCents: payout.amount_cents,
      currencyCode: payout.currency_code,
      idempotencyKey: payoutIdempotencyKey(payout.id),
      referenceType: 'restaurant_payout',
      referenceId: String(payout.id),
      reason: `Wallet earnings payout to restaurant ${payout.restaurant_id}`,
      metadata: {
        payout_id: String(payout.id),
        stripe_account_id: payout.stripe_account_id,
        provider_state: 'pending',
      },
    });

    await client.query(
      `UPDATE restaurant_payouts
          SET status = 'approved', reviewed_by = $2, reviewed_at = NOW(),
              review_note = $3, ledger_transaction_id = $4,
              failure_reason = NULL, updated_at = NOW()
        WHERE id = $1`,
      [payout.id, adminUserId, reviewNote || null, journal.transaction.id]
    );
    await client.query(
      `INSERT INTO restaurant_payout_outbox (payout_id, available_at)
       VALUES ($1, NOW())
       ON CONFLICT (payout_id) DO UPDATE
         SET status = CASE WHEN restaurant_payout_outbox.status = 'attention' THEN 'pending' ELSE restaurant_payout_outbox.status END,
             available_at = LEAST(restaurant_payout_outbox.available_at, NOW()),
             updated_at = NOW()`,
      [payout.id]
    );

    logger.info('[RestaurantPayout] approved and queued', {
      payoutId: payout.id,
      restaurantId: payout.restaurant_id,
      journalTransactionId: journal.transaction.id,
    });

    const { rows: done } = await client.query(
      `SELECT * FROM restaurant_payouts WHERE id = $1`,
      [payout.id]
    );
    return done[0];
  }, 'restaurant_payout_approve');
}

async function claimNextTransferOutbox() {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT o.*, p.restaurant_id, p.currency_code, p.amount_cents,
              p.stripe_account_id, p.stripe_transfer_id, p.ledger_transaction_id,
              p.status AS payout_status
         FROM restaurant_payout_outbox o
         JOIN restaurant_payouts p ON p.id = o.payout_id
        WHERE (
          o.status = 'pending' AND o.available_at <= NOW()
        ) OR (
          o.status = 'processing' AND o.locked_at <= NOW() - ($1::int * INTERVAL '1 second')
        )
        ORDER BY o.available_at ASC, o.created_at ASC
        FOR UPDATE OF o SKIP LOCKED
        LIMIT 1`,
      [TRANSFER_LEASE_SECONDS]
    );
    const item = rows[0];
    if (!item) return null;
    const leaseToken = require('crypto').randomUUID();
    const { rows: claimed } = await client.query(
      `UPDATE restaurant_payout_outbox
          SET status = 'processing', attempts = attempts + 1,
              locked_at = NOW(), lease_token = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [item.id, leaseToken]
    );
    return claimed[0] ? { ...item, ...claimed[0] } : null;
  }, 'restaurant_payout_outbox_claim');
}

async function updateTransferOutbox(payoutId, leaseToken, update) {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `UPDATE restaurant_payout_outbox
          SET status = $3, available_at = COALESCE($4, available_at),
              locked_at = NULL, lease_token = NULL, last_error = $5,
              updated_at = NOW()
        WHERE payout_id = $1 AND lease_token = $2
        RETURNING *`,
      [payoutId, leaseToken, update.status, update.availableAt || null, update.error || null]
    );
    return rows[0] || null;
  }, 'restaurant_payout_outbox_update');
}

async function processNextTransfer() {
  if (!processorEnabled()) return { skipped: true, reason: 'processor_disabled' };
  const outbox = await claimNextTransferOutbox();
  if (!outbox) return { processed: false };

  const payout = outbox;
  if (!['approved', 'processing'].includes(payout.payout_status)) {
    await updateTransferOutbox(payout.payout_id, outbox.lease_token, { status: 'completed' });
    return { processed: true, skipped: true, payoutId: payout.payout_id };
  }
  // An outbox row without the journal intent is not safe to send. This can
  // only be a legacy or manually-corrupted record; preserve it for an
  // operator instead of recreating the old Stripe-before-ledger failure.
  if (!payout.ledger_transaction_id) {
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE restaurant_payout_outbox
            SET status = 'attention', locked_at = NULL, lease_token = NULL,
                last_error = $2, updated_at = NOW()
          WHERE payout_id = $1 AND lease_token = $3`,
        [payout.payout_id, 'missing payout journal intent; manual reconciliation required', outbox.lease_token]
      );
    }, 'restaurant_payout_outbox_missing_journal');
    logger.error('[RestaurantPayout] refusing transfer without journal intent', { payoutId: payout.payout_id });
    return { processed: true, payoutId: payout.payout_id, attention: true, reason: 'missing_journal_intent' };
  }

  // Double-pay guard: check the funds_settled flag before creating a transfer.
  // This is independent of the Stripe idempotency key (which expires after
  // 24h). If funds already left our account, do not create another transfer.
  let settledCheck = { rows: [] };
  try {
    const result = await pool.query(
      `SELECT funds_settled FROM restaurant_payouts WHERE id = $1`,
      [payout.payout_id]
    );
    if (result && result.rows) settledCheck = result;
  } catch {
    // If the check fails, do not block the transfer; the idempotency key
    // is the fallback guard.
  }
  if (settledCheck.rows[0]?.funds_settled === true) {
    logger.warn('[RestaurantPayout] skipping transfer: funds already settled', {
      payoutId: payout.payout_id,
    });
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE restaurant_payout_outbox
            SET status = 'completed', locked_at = NULL, lease_token = NULL,
                last_error = NULL, updated_at = NOW()
          WHERE payout_id = $1 AND lease_token = $2`,
        [payout.payout_id, outbox.lease_token]
      );
    }, 'restaurant_payout_already_settled');
    return { processed: true, payoutId: payout.payout_id, skipped: true, reason: 'already_settled' };
  }

  try {
    const transfer = await stripe.transfers.create(
      transferPayload({ ...payout, id: payout.payout_id }),
      { idempotencyKey: payoutTransferIdempotencyKey(payout.payout_id) }
    );
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE restaurant_payouts
            SET status = 'processing', stripe_transfer_id = COALESCE(stripe_transfer_id, $2),
                provider_status = 'created', stripe_transfer_created_at = COALESCE(stripe_transfer_created_at, NOW()),
                transfer_attempts = $3, last_transfer_attempt_at = NOW(),
                next_transfer_attempt_at = NULL, failure_reason = NULL, updated_at = NOW()
          WHERE id = $1 AND status IN ('approved', 'processing')`,
        [payout.payout_id, transfer.id, Number(outbox.attempts) || 1]
      );
      await client.query(
        `UPDATE restaurant_payout_outbox
            SET status = 'completed', locked_at = NULL, lease_token = NULL,
                last_error = NULL, updated_at = NOW()
          WHERE payout_id = $1 AND lease_token = $2`,
        [payout.payout_id, outbox.lease_token]
      );
    }, 'restaurant_payout_transfer_created');
    logger.info('[RestaurantPayout] Stripe transfer created; awaiting webhook', {
      payoutId: payout.payout_id,
      transferId: transfer.id,
    });
    return { processed: true, payoutId: payout.payout_id, transferId: transfer.id, awaitingWebhook: true };
  } catch (error) {
    const attempts = Number(outbox.attempts) || 1;
    const attention = attempts >= MAX_TRANSFER_ATTEMPTS;
    const backoffSeconds = Math.min(3600, 30 * (2 ** Math.min(attempts - 1, 7)));
    const availableAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE restaurant_payouts
            SET status = 'processing', transfer_attempts = $2,
                last_transfer_attempt_at = NOW(), next_transfer_attempt_at = $3,
                failure_reason = $4, updated_at = NOW()
          WHERE id = $1 AND status IN ('approved', 'processing')`,
        [payout.payout_id, attempts, availableAt,
          `stripe_transfer_attempt_failed: ${String(error.message || error).slice(0, 500)}`]
      );
      await client.query(
        `UPDATE restaurant_payout_outbox
            SET status = $3, available_at = $4, locked_at = NULL, lease_token = NULL,
                last_error = $5, updated_at = NOW()
          WHERE payout_id = $1 AND lease_token = $2`,
        [payout.payout_id, outbox.lease_token, attention ? 'attention' : 'pending', availableAt,
          String(error.message || error).slice(0, 1000)]
      );
    }, 'restaurant_payout_transfer_retry');
    logger.error('[RestaurantPayout] Stripe transfer attempt failed', {
      payoutId: payout.payout_id,
      attempts,
      attention,
      error: error.message,
    });
    return { processed: true, payoutId: payout.payout_id, attention, error: error.message };
  }
}

async function notifyPayoutOwner(payout, type, extra = {}) {
  try {
    const { rows } = await pool.query(
      `SELECT b.user_id FROM food_restaurants fr
        JOIN businesses b ON b.id = fr.business_id
       WHERE fr.id = $1`,
      [payout.restaurant_id]
    );
    const ownerId = rows[0]?.user_id;
    if (!ownerId) return;
    await sendNotification({
      userId: ownerId,
      type,
      data: {
        payout_id: String(payout.id),
        restaurant_id: String(payout.restaurant_id),
        amount_cents: payout.amount_cents,
        currency_code: payout.currency_code,
        ...extra,
      },
      action_url: '/food/merchant',
      idempotencyKey: `restaurant-payout:${type}:${payout.id}`,
    });
  } catch (error) {
    logger.warn('[RestaurantPayout] notification failed', { payoutId: payout.id, type, error: error.message });
  }
}

async function applyTransferWebhookEvent({ eventType, transfer }) {
  const payoutId = transfer?.metadata?.restaurant_payout_id;
  if (!payoutId || !transfer?.id) return { handled: false };

  let result = null;
  await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM restaurant_payouts WHERE id = $1 OR stripe_transfer_id = $2 FOR UPDATE`,
      [payoutId, transfer.id]
    );
    const payout = rows[0];
    if (!payout) return;
    if (!providerTransferMatchesPayout(transfer, payout)) {
      throw new AppError('Stripe payout transfer does not match the approved payout', 409, 'payout_transfer_mismatch');
    }

    if (eventType === 'transfer.reversed') {
      let reversalId = payout.reversal_ledger_transaction_id;
      if (!reversalId) {
        const subBank = await ensureRestaurantSubBankAccount(client, {
          restaurantId: payout.restaurant_id,
          currencyCode: payout.currency_code,
        });
        const treasury = await ensureAccount(client, {
          accountType: 'platform_treasury',
          currencyCode: payout.currency_code,
        });
        const reversal = await postJournalTransaction(client, {
          transactionType: 'sub_bank_payout_reversal',
          debitAccountId: treasury.id,
          creditAccountId: subBank.id,
          amountCents: payout.amount_cents,
          currencyCode: payout.currency_code,
          idempotencyKey: payoutReversalIdempotencyKey(payout.id),
          referenceType: 'restaurant_payout_reversal',
          referenceId: String(payout.id),
          reason: `Stripe reversed restaurant payout ${payout.id}`,
          metadata: { payout_id: String(payout.id), stripe_transfer_id: transfer.id },
        });
        reversalId = reversal.transaction.id;
      }
      await client.query(
        `UPDATE restaurant_payouts
            SET status = 'reversed', stripe_transfer_id = COALESCE(stripe_transfer_id, $2),
                provider_status = 'reversed', provider_event_at = NOW(),
                reversal_ledger_transaction_id = $3, completed_at = COALESCE(completed_at, NOW()),
                failure_reason = 'Stripe reversed the payout transfer', updated_at = NOW()
          WHERE id = $1`,
        [payout.id, transfer.id, reversalId]
      );
      await client.query(
        `UPDATE restaurant_payout_outbox SET status = 'completed', locked_at = NULL, lease_token = NULL, updated_at = NOW()
          WHERE payout_id = $1`, [payout.id]
      );
      result = { payout, status: 'reversed', transferId: transfer.id };
      return;
    }

    const transitioned = payout.status !== 'completed';
    // funds_settled is set ONLY here: Stripe has confirmed the transfer.
    // No other code path sets this flag.
    await client.query(
      `UPDATE restaurant_payouts
          SET status = 'completed', stripe_transfer_id = COALESCE(stripe_transfer_id, $2),
              provider_status = $3, provider_event_at = NOW(),
              completed_at = COALESCE(completed_at, NOW()), failure_reason = NULL,
              funds_settled = TRUE, updated_at = NOW()
        WHERE id = $1`,
      [payout.id, transfer.id, eventType]
    );
    await client.query(
      `UPDATE restaurant_payout_outbox SET status = 'completed', locked_at = NULL, lease_token = NULL, updated_at = NOW()
        WHERE payout_id = $1`, [payout.id]
    );
    result = { payout, status: 'completed', transferId: transfer.id, transitioned };
  }, 'restaurant_payout_transfer_webhook');

  if (result?.status === 'completed' && result.transitioned) {
    await notifyPayoutOwner(result.payout, 'payout_deposited', { stripe_transfer_id: result.transferId });
  } else if (result?.status === 'reversed') {
    await notifyPayoutOwner(result.payout, 'payout_reversed', { stripe_transfer_id: result.transferId });
  }
  return result || { handled: true };
}

async function reconcilePayouts({ limit = 50 } = {}) {
  if (!processorEnabled()) return { skipped: true, reason: 'processor_disabled' };
  const boundedLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const { rows } = await pool.query(
    `SELECT * FROM restaurant_payouts
      WHERE status IN ('approved', 'processing')
        AND updated_at < NOW() - INTERVAL '30 seconds'
      ORDER BY updated_at ASC LIMIT $1`, [boundedLimit]
  );
  const summary = { inspected: rows.length, confirmed: 0, requeued: 0, attention: 0, failed: 0 };
  for (const payout of rows) {
    try {
      if (!payout.ledger_transaction_id) {
        // Do not guess whether a pre-outbox payout already moved money. A
        // legacy row without a durable journal reference needs an operator
        // decision, even when it happens to contain a provider transfer ID.
        summary.attention += 1;
        logger.error('[RestaurantPayout] legacy payout requires manual reconciliation', {
          payoutId: payout.id,
          status: payout.status,
          stripeTransferId: payout.stripe_transfer_id || null,
        });
      } else if (payout.stripe_transfer_id) {
        const transfer = await stripe.transfers.retrieve(payout.stripe_transfer_id);
        await applyTransferWebhookEvent({
          eventType: transfer.reversed ? 'transfer.reversed' : 'transfer.updated',
          transfer,
        });
        summary.confirmed += 1;
      } else {
        await pool.query(
          `INSERT INTO restaurant_payout_outbox (payout_id, available_at)
           VALUES ($1, NOW()) ON CONFLICT (payout_id) DO UPDATE
           SET status = CASE WHEN restaurant_payout_outbox.status = 'attention' THEN 'pending' ELSE restaurant_payout_outbox.status END,
               available_at = NOW(), updated_at = NOW()`, [payout.id]
        );
        summary.requeued += 1;
      }
    } catch (error) {
      summary.failed += 1;
      logger.warn('[RestaurantPayout] reconciliation failed', { payoutId: payout.id, error: error.message });
    }
  }
  return summary;
}

async function rejectPayout({ payoutId, adminUserId, reviewNote }) {
  const { rows } = await withTransaction(pool, async (client) => {
    const locked = await client.query(
      `SELECT * FROM restaurant_payouts WHERE id = $1 FOR UPDATE`,
      [payoutId]
    );
    const payout = locked.rows[0];
    if (!payout) throw new AppError('Payout not found', 404, 'payout_not_found');
    if (payout.status !== 'requested') {
      throw new AppError(`Payout is ${payout.status}, cannot reject`, 409, 'payout_invalid_status');
    }
    return client.query(
      `UPDATE restaurant_payouts
          SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(),
              review_note = $3, updated_at = NOW()
        WHERE id = $1
       RETURNING *`,
      [payoutId, adminUserId, reviewNote || null]
    );
  }, 'restaurant_payout_reject');
  return rows[0];
}

async function listAdminQueue(client, { status = 'requested', limit = 100 }) {
  const { rows } = await client.query(
    `SELECT p.*, fr.display_name AS restaurant_name
       FROM restaurant_payouts p
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
      WHERE p.status = $1
      ORDER BY p.created_at ASC
      LIMIT $2`,
    [status, Math.min(500, Math.max(1, Number(limit) || 100))]
  );
  return rows;
}

module.exports = {
  MIN_PAYOUT_CENTS,
  processorEnabled,
  getPayoutableBalance,
  requestPayout,
  listPayouts,
  approvePayout,
  processNextTransfer,
  applyTransferWebhookEvent,
  reconcilePayouts,
  rejectPayout,
  listAdminQueue,
};
