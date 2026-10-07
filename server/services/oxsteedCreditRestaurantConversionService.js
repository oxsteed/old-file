'use strict';

/**
 * OxSteed Credit <-> restaurant credit conversions (Phase 6, gap 5).
 *
 * Two directions, both atomic (food-wallet ledger + central journal in one
 * DB transaction):
 *
 *   to_restaurant   (OxSteed -> restaurant): the customer's restaurant food
 *     wallet is credited, and the central journal posts a `sub_bank_load`
 *     debiting the customer's OxSteed wallet and crediting the restaurant's
 *     sub-bank (the fundingSource='oxsteed_credit' dual-posting path from
 *     Phase 1). This direction already existed; this service exposes it as
 *     a first-class conversion with a recorded rate.
 *
 *   from_restaurant (restaurant -> OxSteed): the food wallet is debited
 *     (fails closed on insufficient funds) and the central journal posts a
 *     `sub_bank_conversion` (restaurant_sub_bank -> customer_wallet).
 *
 * Rate: OXSTEED_CREDIT_RESTAURANT_CONVERSION_RATE, default 1 (1:1).
 * Same-currency only; the rate must be <= 1 so conversions can never create
 * value. When the rate is below 1, the residual posts as a `conversion_fee`
 * leg (customer_wallet -> platform_revenue) so every cent is accounted for.
 *
 * Compliance: rail kill switch (rolls back the wallet write too), sanctions
 * screening of the customer, step-up challenge for large amounts. Recorded
 * in oxsteed_credit_restaurant_conversions with a caller idempotency key.
 */

const crypto = require('crypto');
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const {
  MAX_TRANSACTION_CENTS,
  assertSupportedCreditCurrency,
  assertCreditRailEnabled,
  ensureAccount,
  postJournalTransaction,
} = require('./oxsteedCreditService');
const { debitFoodWallet, creditFoodWallet } = require('./foodWalletService');
const { assertRestaurantConversionToOxsteedEnabled } = require('./oxsteedCreditRestaurantConversionPolicyService');
const { postFoodWalletDualEntry } = require('./oxsteedCreditSubBankService');
const { insertAudit } = require('./oxsteedCreditAdminService');

function fail(message, code, status = 400) {
  throw new AppError(message, status, code);
}

function getConversionRate() {
  const raw = Number.parseFloat(process.env.OXSTEED_CREDIT_RESTAURANT_CONVERSION_RATE || '1');
  if (!Number.isFinite(raw) || raw <= 0 || raw > 1) {
    throw new AppError('Restaurant conversion rate is misconfigured', 503, 'credit_conversion_rate_unavailable');
  }
  return raw;
}

function normalizeIdempotencyKey(value) {
  const key = typeof value === 'string' ? value.trim().slice(0, 160) : '';
  if (!key) {
    fail('Idempotency-Key is required for restaurant credit conversions', 'credit_conversion_idempotency_key_required');
  }
  return key;
}

function formatConversion(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    restaurantId: Number(row.restaurant_id),
    direction: row.direction,
    sourceAmountCents: Number(row.source_amount_cents),
    convertedAmountCents: Number(row.converted_amount_cents),
    feeCents: Number(row.fee_cents),
    currencyCode: row.currency_code,
    rate: String(row.rate),
    status: row.status,
    walletLedgerEntryId: row.wallet_ledger_entry_id ? String(row.wallet_ledger_entry_id) : null,
    journalTransactionId: row.journal_transaction_id || null,
    journalFeeTransactionId: row.journal_fee_transaction_id || null,
    createdAt: row.created_at,
  };
}

async function findExistingConversion(client, idempotencyKey) {
  const { rows } = await client.query(
    `SELECT * FROM oxsteed_credit_restaurant_conversions WHERE idempotency_key = $1`,
    [idempotencyKey]
  );
  return rows[0] || null;
}

// Validates a replayed conversion against the current request params.
// Returns { conversion, replayed: true } on match, or throws 409 on mismatch.
function checkConversionReplay(existing, { amount, currency, direction, restaurantId }) {
  if (Number(existing.source_amount_cents) !== amount
    || String(existing.currency_code) !== currency
    || existing.direction !== direction
    || Number(existing.restaurant_id) !== restaurantId) {
    fail('Conversion idempotency key was already used with different parameters', 'credit_conversion_idempotency_conflict', 409);
  }
  return { conversion: formatConversion(existing), replayed: true };
}

// Re-checks for an existing conversion AFTER acquiring the advisory lock.
// The pre-lock check is only a fast path: a concurrent request with the same
// key can pass it, then serialize on the lock. Without this re-check both
// requests would proceed to move money before the INSERT hits the UNIQUE
// constraint (and the money legs run before the INSERT, so ON CONFLICT alone
// cannot prevent the double spend).
async function recheckConversionAfterLock(client, normalizedKey, params) {
  const locked = await findExistingConversion(client, normalizedKey);
  if (locked) return checkConversionReplay(locked, params);
  return null;
}

async function convertRestaurantToOxsteed({
  customerId, restaurantId, amountCents, currencyCode = 'USD',
  idempotencyKey, actorUserId = null, requestIp = null, correlationId = null,
}) {
  if (!customerId) fail('Customer is required', 'credit_conversion_customer_required');
  const restaurantIdNum = Number(restaurantId);
  if (!Number.isSafeInteger(restaurantIdNum) || restaurantIdNum <= 0) {
    fail('Restaurant is required', 'credit_conversion_restaurant_required');
  }
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    fail('Conversion amount must be a positive integer number of cents', 'credit_conversion_amount_invalid');
  }
  if (amount > MAX_TRANSACTION_CENTS) {
    fail('Conversion amount exceeds the maximum transaction size', 'credit_conversion_amount_too_large', 402);
  }
  const currency = assertSupportedCreditCurrency(currencyCode);
  const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
  const rate = getConversionRate();
  const convertedAmount = Math.round(amount * rate);
  if (convertedAmount <= 0) {
    fail('Conversion rate yields a zero amount', 'credit_conversion_amount_invalid');
  }
  const feeCents = amount - convertedAmount;

  return withTransaction(pool, async (client) => {
    await assertCreditRailEnabled(client);

    const existing = await findExistingConversion(client, normalizedKey);
    if (existing) {
      return checkConversionReplay(existing, { amount, currency, direction: 'from_restaurant', restaurantId: restaurantIdNum });
    }

    // Emile's requirement: OxSteed controls which restaurants' credit may
    // be converted INTO OxSteed Credit. The gate sits after the idempotency
    // replay (an already-executed conversion keeps returning its stored
    // result) but before sanctions screening and the wallet debit, so a
    // non-enabled restaurant moves no money at all. Missing policy row =
    // deny (403 credit_conversion_restaurant_not_enabled).
    await assertRestaurantConversionToOxsteedEnabled(client, restaurantIdNum);

    // Sanctions screening on the customer receiving OxSteed credit.
    const { assertSanctionsClear } = require('./sanctionsScreeningService');
    await assertSanctionsClear(client, {
      subjectType: 'customer',
      subjectId: customerId,
      context: { operation: 'restaurant_conversion', direction: 'from_restaurant' },
    });

    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `oxsteed-credit-restaurant-conversion:${restaurantIdNum}:${customerId}:${normalizedKey}`,
    ]);

    const lockedReplay = await recheckConversionAfterLock(client, normalizedKey, { amount, currency, direction: 'from_restaurant', restaurantId: restaurantIdNum });
    if (lockedReplay) return lockedReplay;

    const conversionId = crypto.randomUUID();

    // Leg 1: debit the restaurant food wallet. Fails closed on insufficient
    // funds (wallet_insufficient_funds / wallet_insufficient_available_funds).
    // The wallet write triggers the generic dual-posting funnel, which posts
    // the central `sub_bank_conversion` leg (restaurant_sub_bank ->
    // customer_wallet, post-rate amount) in the SAME transaction. A disabled
    // rail fails closed there and rolls back the wallet debit too.
    const { entry: walletEntry } = await debitFoodWallet(client, {
      restaurantId: restaurantIdNum,
      customerId,
      currencyCode: currency,
      amountCents: amount,
      description: 'Restaurant credit converted to OxSteed Credit',
      referenceType: 'restaurant_conversion_out',
      referenceId: conversionId,
      idempotencyKey: `restaurant-conversion:${conversionId}:wallet-debit`,
      createdByUserId: actorUserId || customerId,
      correlationId: correlationId || `restaurant-conversion:${conversionId}`,
      actorType: 'customer',
      metadata: {
        conversionId,
        direction: 'from_restaurant',
        rate: String(rate),
        conversionConvertedAmountCents: convertedAmount,
      },
    });

    // Leg 2: the dual-posting funnel posted the central conversion leg with
    // key `food-wallet-ledger:<entryId>:central`. Look it up for the record.
    const { rows: journalRows } = await client.query(
      `SELECT id FROM oxsteed_credit_transactions WHERE idempotency_key = $1`,
      [`food-wallet-ledger:${walletEntry.id}:central`]
    );
    const centralTransactionId = journalRows[0]?.id || null;

    // Leg 3 (optional): the rate residual is a spread the platform keeps.
    // It is debited from the sub-bank (the liability extinguished by the
    // wallet debit), NOT from the customer's OxSteed wallet, so the customer
    // always nets exactly the converted amount.
    let feeTransactionId = null;
    if (feeCents > 0) {
      const subBank = await ensureAccount(client, { accountType: 'restaurant_sub_bank', restaurantId: restaurantIdNum, currencyCode: currency });
      const revenue = await ensureAccount(client, { accountType: 'platform_revenue', currencyCode: currency });
      const { transaction: feeTx } = await postJournalTransaction(client, {
        transactionType: 'conversion_fee',
        debitAccountId: subBank.id,
        creditAccountId: revenue.id,
        customerId,
        amountCents: feeCents,
        currencyCode: currency,
        idempotencyKey: `restaurant-conversion:${conversionId}:fee`,
        actorType: 'user',
        actorUserId: actorUserId || customerId,
        reason: 'Restaurant conversion rate residual',
        description: 'Restaurant conversion rate residual',
        referenceType: 'restaurant_conversion_fee',
        referenceId: conversionId,
        metadata: { source: 'restaurant_conversion', rate: String(rate) },
        bindIdempotencySemantics: true,
        correlationId,
        requestIp,
      });
      feeTransactionId = feeTx.id;
    }

    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_restaurant_conversions
         (id, customer_id, restaurant_id, direction, source_amount_cents,
          converted_amount_cents, fee_cents, currency_code, rate, status,
          wallet_ledger_entry_id, journal_transaction_id, journal_fee_transaction_id,
          idempotency_key, actor_user_id)
       VALUES ($1,$2,$3,'from_restaurant',$4,$5,$6,$7,$8,'completed',$9,$10,$11,$12,$13)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [conversionId, customerId, restaurantIdNum, amount, convertedAmount, feeCents,
       currency, String(rate), walletEntry.id, centralTransactionId, feeTransactionId,
       normalizedKey, actorUserId || customerId]
    );
    // Defense in depth: the advisory lock + post-lock re-check should have
    // caught this. If the INSERT lost the race (e.g. same key from a
    // different customer/restaurant, which keys a different advisory lock),
    // the money legs above already ran, so fail loudly rather than silently
    // returning the other conversion's record.
    if (!rows[0]) {
      const raced = await findExistingConversion(client, normalizedKey);
      if (!raced) fail('Conversion idempotency conflict', 'credit_conversion_idempotency_conflict', 409);
      return checkConversionReplay(raced, { amount, currency, direction: 'from_restaurant', restaurantId: restaurantIdNum });
    }

    await insertAudit(client, {
      actionType: 'credit.restaurant_conversion.completed',
      actorUserId: actorUserId || customerId,
      customerId,
      resourceType: 'restaurant_conversion',
      resourceId: conversionId,
      reason: 'Restaurant credit converted to OxSteed Credit',
      correlationId,
      requestIp,
      afterState: {
        direction: 'from_restaurant', restaurantId: restaurantIdNum,
        sourceAmountCents: amount, convertedAmountCents: convertedAmount,
        feeCents, rate: String(rate),
      },
    });

    return { conversion: formatConversion(rows[0]), replayed: false };
  }, 'credit_restaurant_conversion_from');
}

async function convertOxsteedToRestaurant({
  customerId, restaurantId, amountCents, currencyCode = 'USD',
  idempotencyKey, actorUserId = null, requestIp = null, correlationId = null,
}) {
  if (!customerId) fail('Customer is required', 'credit_conversion_customer_required');
  const restaurantIdNum = Number(restaurantId);
  if (!Number.isSafeInteger(restaurantIdNum) || restaurantIdNum <= 0) {
    fail('Restaurant is required', 'credit_conversion_restaurant_required');
  }
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    fail('Conversion amount must be a positive integer number of cents', 'credit_conversion_amount_invalid');
  }
  if (amount > MAX_TRANSACTION_CENTS) {
    fail('Conversion amount exceeds the maximum transaction size', 'credit_conversion_amount_too_large', 402);
  }
  const currency = assertSupportedCreditCurrency(currencyCode);
  const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
  const rate = getConversionRate();
  const convertedAmount = Math.round(amount * rate);
  if (convertedAmount <= 0) {
    fail('Conversion rate yields a zero amount', 'credit_conversion_amount_invalid');
  }
  const feeCents = amount - convertedAmount;

  return withTransaction(pool, async (client) => {
    await assertCreditRailEnabled(client);

    const existing = await findExistingConversion(client, normalizedKey);
    if (existing) {
      return checkConversionReplay(existing, { amount, currency, direction: 'to_restaurant', restaurantId: restaurantIdNum });
    }

    // Converting OxSteed Credit into a restaurant wallet makes the credit
    // spendable at that restaurant, so it needs the same active-partner gate
    // as direct spend. Mirrors the food checkout oxsteed_credit charge path in
    // controllers/foodController.js: only an active partner row satisfies the
    // gate (pending rows fail closed), and nothing here auto-activates a
    // partner; that transition stays on the existing admin partner-status
    // action. Runs before any money moves.
    const { rows: partnerRows } = await client.query(
      `SELECT id
         FROM oxsteed_credit_partners
        WHERE restaurant_id = $1 AND status = 'active'
        LIMIT 1`,
      [restaurantIdNum]
    );
    if (!partnerRows[0]) {
      fail('This restaurant does not currently accept OxSteed Credit conversions', 'credit_conversion_restaurant_not_enabled', 403);
    }

    const { assertSanctionsClear } = require('./sanctionsScreeningService');
    await assertSanctionsClear(client, {
      subjectType: 'customer',
      subjectId: customerId,
      context: { operation: 'restaurant_conversion', direction: 'to_restaurant' },
    });

    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `oxsteed-credit-restaurant-conversion:${restaurantIdNum}:${customerId}:${normalizedKey}`,
    ]);

    const lockedReplay = await recheckConversionAfterLock(client, normalizedKey, { amount, currency, direction: 'to_restaurant', restaurantId: restaurantIdNum });
    if (lockedReplay) return lockedReplay;

    const conversionId = crypto.randomUUID();

    // Leg 1: credit the restaurant food wallet.
    const { entry: walletEntry } = await creditFoodWallet(client, {
      restaurantId: restaurantIdNum,
      customerId,
      currencyCode: currency,
      amountCents: convertedAmount,
      description: 'OxSteed Credit converted to restaurant credit',
      referenceType: 'restaurant_conversion_in',
      referenceId: conversionId,
      idempotencyKey: `restaurant-conversion:${conversionId}:wallet-credit`,
      createdByUserId: actorUserId || customerId,
      correlationId: correlationId || `restaurant-conversion:${conversionId}`,
      actorType: 'customer',
      metadata: { conversionId, direction: 'to_restaurant', rate: String(rate) },
    });

    // Leg 2: central journal via the Phase 1 dual-posting path, funded from
    // the customer's OxSteed wallet (customer_wallet -> restaurant_sub_bank).
    // postFoodWalletDualEntry re-checks the rail kill switch, so a disabled
    // rail rolls back the wallet credit above too.
    await postFoodWalletDualEntry(client, {
      ledgerEntryId: walletEntry.id,
      restaurantId: restaurantIdNum,
      customerId,
      currencyCode: currency,
      amountCents: convertedAmount,
      entryType: 'credit',
      referenceType: 'restaurant_conversion_in',
      referenceId: conversionId,
      actorType: 'user',
      actorUserId: actorUserId || customerId,
      createdByUserId: actorUserId || customerId,
      correlationId: correlationId || `restaurant-conversion:${conversionId}`,
      requestIp,
      metadata: { fundingSource: 'oxsteed_credit', fundingCustomerId: customerId, conversionId, rate: String(rate) },
    });

    // Leg 3 (optional): rate residual as an explicit fee leg.
    let feeTransactionId = null;
    if (feeCents > 0) {
      const wallet = await ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode: currency });
      const revenue = await ensureAccount(client, { accountType: 'platform_revenue', currencyCode: currency });
      const { transaction: feeTx } = await postJournalTransaction(client, {
        transactionType: 'conversion_fee',
        debitAccountId: wallet.id,
        creditAccountId: revenue.id,
        customerId,
        amountCents: feeCents,
        currencyCode: currency,
        idempotencyKey: `restaurant-conversion:${conversionId}:fee`,
        actorType: 'user',
        actorUserId: actorUserId || customerId,
        reason: 'Restaurant conversion rate residual',
        description: 'Restaurant conversion rate residual',
        referenceType: 'restaurant_conversion_fee',
        referenceId: conversionId,
        metadata: { source: 'restaurant_conversion', rate: String(rate) },
        bindIdempotencySemantics: true,
        correlationId,
        requestIp,
      });
      feeTransactionId = feeTx.id;
    }

    // The dual-posting journal transaction id for reference.
    const { rows: journalRows } = await client.query(
      `SELECT id FROM oxsteed_credit_transactions WHERE idempotency_key = $1`,
      [`food-wallet-ledger:${walletEntry.id}:central`]
    );

    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_restaurant_conversions
         (id, customer_id, restaurant_id, direction, source_amount_cents,
          converted_amount_cents, fee_cents, currency_code, rate, status,
          wallet_ledger_entry_id, journal_transaction_id, journal_fee_transaction_id,
          idempotency_key, actor_user_id)
       VALUES ($1,$2,$3,'to_restaurant',$4,$5,$6,$7,$8,'completed',$9,$10,$11,$12,$13)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [conversionId, customerId, restaurantIdNum, amount, convertedAmount, feeCents,
       currency, String(rate), walletEntry.id, journalRows[0]?.id || null, feeTransactionId,
       normalizedKey, actorUserId || customerId]
    );
    if (!rows[0]) {
      const raced = await findExistingConversion(client, normalizedKey);
      if (!raced) fail('Conversion idempotency conflict', 'credit_conversion_idempotency_conflict', 409);
      return checkConversionReplay(raced, { amount, currency, direction: 'to_restaurant', restaurantId: restaurantIdNum });
    }

    await insertAudit(client, {
      actionType: 'credit.restaurant_conversion.completed',
      actorUserId: actorUserId || customerId,
      customerId,
      resourceType: 'restaurant_conversion',
      resourceId: conversionId,
      reason: 'OxSteed Credit converted to restaurant credit',
      correlationId,
      requestIp,
      afterState: {
        direction: 'to_restaurant', restaurantId: restaurantIdNum,
        sourceAmountCents: amount, convertedAmountCents: convertedAmount,
        feeCents, rate: String(rate),
      },
    });

    return { conversion: formatConversion(rows[0]), replayed: false };
  }, 'credit_restaurant_conversion_to');
}

async function listRestaurantConversions({ customerId = null, restaurantId = null, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  if (customerId) { params.push(customerId); conditions.push(`customer_id = $${params.length}`); }
  if (restaurantId) { params.push(Number(restaurantId)); conditions.push(`restaurant_id = $${params.length}`); }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  params.push(Math.max(Number(offset) || 0, 0));
  const { rows } = await pool.query(
    `SELECT * FROM oxsteed_credit_restaurant_conversions
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map(formatConversion);
}

module.exports = {
  convertRestaurantToOxsteed,
  convertOxsteedToRestaurant,
  listRestaurantConversions,
  formatConversion,
  getConversionRate,
};
