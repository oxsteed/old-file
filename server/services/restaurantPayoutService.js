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
 * Money moves exactly once: the payout row is locked FOR UPDATE during
 * execution, the Stripe Transfer and the journal posting share the payout's
 * deterministic idempotency key, and any failure marks the payout failed
 * with the reason recorded. Money code fails closed throughout.
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

function processorEnabled() {
  return process.env.PAYOUT_PROCESSOR_ENABLED === 'true' && !!stripe;
}

function payoutIdempotencyKey(payoutId) {
  return `restaurant-payout:${payoutId}`;
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
            b.stripe_account_id, b.stripe_payouts_enabled
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1
        AND b.owner_user_id = $2
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

/**
 * Execute the money movement for an approved payout. The caller must hold
 * the payout row lock (FOR UPDATE). Stripe Transfer + journal posting share
 * the payout idempotency key; any failure marks the payout failed.
 */
async function executePayout(client, payout) {
  if (!processorEnabled()) {
    throw new AppError('Payout processing is not enabled', 503, 'payout_processor_disabled');
  }

  await client.query(`UPDATE restaurant_payouts SET status = 'processing', updated_at = NOW() WHERE id = $1`, [payout.id]);

  const transferKey = payoutIdempotencyKey(payout.id);
  let transfer;
  try {
    transfer = await stripe.transfers.create(
      {
        amount: payout.amount_cents,
        currency: payout.currency_code.toLowerCase(),
        destination: payout.stripe_account_id,
        description: `OxSteed wallet earnings payout · ${payout.restaurant_id}`,
        metadata: {
          restaurant_payout_id: String(payout.id),
          restaurant_id: String(payout.restaurant_id),
        },
      },
      { idempotencyKey: `restaurant-payout-transfer:${payout.id}` }
    );
  } catch (err) {
    await client.query(
      `UPDATE restaurant_payouts SET status = 'failed', failure_reason = $2, updated_at = NOW() WHERE id = $1`,
      [payout.id, `stripe_transfer_failed: ${err.message}`.slice(0, 500)]
    );
    logger.error('[RestaurantPayout] Stripe transfer failed', {
      payoutId: payout.id,
      error: err.message,
    });
    throw new AppError('The payout transfer failed', 502, 'payout_transfer_failed');
  }

  // Journal: debit the restaurant's sub-bank (OxSteed's liability shrinks),
  // credit platform treasury (the cash left OxSteed via the transfer).
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
    idempotencyKey: transferKey,
    referenceType: 'restaurant_payout',
    referenceId: String(payout.id),
    reason: `Wallet earnings payout to restaurant ${payout.restaurant_id}`,
    metadata: {
      stripe_transfer_id: transfer.id,
      stripe_account_id: payout.stripe_account_id,
    },
  });

  await client.query(
    `UPDATE restaurant_payouts
        SET status = 'completed',
            stripe_transfer_id = $2,
            ledger_transaction_id = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [payout.id, transfer.id, journal.transaction.id]
  );

  return { transfer, journal };
}

async function approvePayout({ payoutId, adminUserId, reviewNote }) {
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
                reviewed_by = $2, reviewed_at = NOW(), review_note = $3, updated_at = NOW()
          WHERE id = $1`,
        [payout.id, adminUserId, reviewNote || null]
      );
      throw new AppError('Insufficient balance at execution', 409, 'payout_insufficient_balance');
    }

    await client.query(
      `UPDATE restaurant_payouts
          SET status = 'approved', reviewed_by = $2, reviewed_at = NOW(),
              review_note = $3, updated_at = NOW()
        WHERE id = $1`,
      [payout.id, adminUserId, reviewNote || null]
    );

    const { transfer } = await executePayout(client, { ...payout, status: 'approved' });

    logger.info('[RestaurantPayout] completed', {
      payoutId: payout.id,
      restaurantId: payout.restaurant_id,
      transferId: transfer.id,
    });

    // Notify the restaurant owner (best-effort; never fails the payout).
    try {
      const { rows: ownerRows } = await client.query(
        `SELECT b.owner_user_id FROM food_restaurants fr
          JOIN businesses b ON b.id = fr.business_id
         WHERE fr.id = $1`,
        [payout.restaurant_id]
      );
      const ownerId = ownerRows[0]?.owner_user_id;
      if (ownerId) {
        await sendNotification({
          userId: ownerId,
          type: 'payout_released',
          data: {
            payout_id: String(payout.id),
            restaurant_id: String(payout.restaurant_id),
            amount_cents: payout.amount_cents,
            currency_code: payout.currency_code,
          },
          action_url: '/food/merchant',
          idempotencyKey: `payout-released:${payout.id}`,
        });
        await sendNotification({
          userId: ownerId,
          type: 'payout_deposited',
          data: {
            payout_id: String(payout.id),
            restaurant_id: String(payout.restaurant_id),
            amount_cents: payout.amount_cents,
            currency_code: payout.currency_code,
            stripe_transfer_id: transfer.id,
          },
          action_url: '/food/merchant',
          idempotencyKey: `payout-deposited:${payout.id}`,
        });
      }
    } catch (notifErr) {
      logger.warn('[RestaurantPayout] notification failed (non-blocking)', {
        payoutId: payout.id,
        error: notifErr.message,
      });
    }

    const { rows: done } = await client.query(
      `SELECT * FROM restaurant_payouts WHERE id = $1`,
      [payout.id]
    );
    return done[0];
  }, 'restaurant_payout_approve');
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
  rejectPayout,
  listAdminQueue,
};
