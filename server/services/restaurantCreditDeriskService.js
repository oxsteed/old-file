'use strict';

/**
 * Phase 5: restaurant credit trial cap + FIFO derisking.
 *
 * Trial-tier restaurants (those WITHOUT a Phase 4 pre-purchase reserve row)
 * may carry at most cap_cents of outstanding customer credit (default $100,
 * via FOOD_CREDIT_TRIAL_CAP_CENTS). When outstanding exposure reaches the
 * cap, new customer credit requests are blocked with 409
 * restaurant_credit_at_capacity. To unlock, the restaurant derisks its
 * oldest balances first (FIFO) by migrating them to OxSteed Credit.
 *
 * Enforcement split with Phase 4 (no double-enforcement):
 *  - Restaurant HAS a restaurant_credit_reserves row -> the reserve system
 *    governs issuance; the trial cap is skipped entirely.
 *  - Restaurant has NO reserve row -> the trial cap applies.
 *
 * Outstanding exposure is maintained by the delta trigger installed in
 * migration 862 (restaurant_credit_exposure.outstanding_cents =
 * SUM(food_customer_wallet_accounts.balance_cents)); enforcement reads it
 * with a single primary-key lookup.
 *
 * Money-safety contract (fail closed):
 *  - deriskOldest migrates one customer per database transaction. Inside
 *    the transaction the customer is FIRST made whole in OxSteed Credit
 *    (platform treasury funds the grant via adjustCustomerCreditInTransaction
 *    with actorType 'system'), THEN the restaurant wallet balance is zeroed
 *    through the append-only wallet ledger, and finally the durable
 *    restaurant_credit_derisks row is written. Any failure rolls the whole
 *    customer back: the customer keeps restaurant credit or receives
 *    OxSteed Credit, never neither, and balances are never left partially
 *    moved.
 *  - Held (reserved_cents) funds are never derisked: they back in-flight
 *    order holds and stay in the restaurant wallet.
 *  - Non-USD wallet balances are skipped with credit_derisk_currency_unsupported
 *    (OxSteed Credit is USD-only; FX conversion is a documented follow-up),
 *    leaving those balances untouched.
 *  - One customer's failure never aborts the run: it is recorded in
 *    `skipped` and derisking continues with the next-oldest balance.
 */

const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const logger = require('../utils/logger');
const pool = require('../db');
const { getReserveBalance } = require('./restaurantCreditReserveService');
const { debitFoodWallet } = require('./foodWalletService');
const { adjustCustomerCreditInTransaction } = require('./oxsteedCreditService');

// OxSteed Credit platform balances are USD-only (CREDIT_CURRENCY in
// oxsteedCreditService). Restaurant wallets in other currencies cannot be
// migrated 1:1; those customers are skipped and reported for an FX follow-up.
const PLATFORM_CREDIT_CURRENCY = 'USD';
const DEFAULT_TRIAL_CAP_CENTS = 10000; // $100
const FIFO_QUEUE_LIMIT = 10000;

function fail(message, code, status = 400, details) {
  throw new AppError(message, status, code, details);
}

function parseRestaurantId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Trial cap in cents, configurable via FOOD_CREDIT_TRIAL_CAP_CENTS
 * (default $100). Falls back to the default on missing/invalid values so a
 * misconfigured env can never disable or zero the cap.
 */
function getTrialCapCents() {
  const raw = Number.parseInt(process.env.FOOD_CREDIT_TRIAL_CAP_CENTS || '', 10);
  if (Number.isSafeInteger(raw) && raw > 0) return raw;
  return DEFAULT_TRIAL_CAP_CENTS;
}

async function ensureExposureRow(restaurantId) {
  const capCents = getTrialCapCents();
  await pool.query(
    `INSERT INTO restaurant_credit_exposure (restaurant_id, cap_cents)
     VALUES ($1, $2)
     ON CONFLICT (restaurant_id) DO NOTHING`,
    [restaurantId, capCents]
  );
  const { rows } = await pool.query(
    `SELECT restaurant_id, outstanding_cents, cap_cents, updated_at
       FROM restaurant_credit_exposure
      WHERE restaurant_id = $1`,
    [restaurantId]
  );
  return rows[0] || null;
}

/**
 * Current trial-cap state for a restaurant.
 *
 * Returns { restaurant_id, outstanding_cents, cap_cents, trial_cap_applies,
 * at_capacity }. Restaurants WITH a Phase 4 reserve row are exempt:
 * trial_cap_applies is false and at_capacity is always false (the reserve
 * system governs them; no double-enforcement).
 */
async function getCreditExposure(restaurantId) {
  const parsedRestaurantId = parseRestaurantId(restaurantId);
  if (!parsedRestaurantId) fail('Restaurant not found', 'restaurant_not_found', 404);
  const reserve = await getReserveBalance(parsedRestaurantId);
  const trialCapApplies = !reserve;
  const row = await ensureExposureRow(parsedRestaurantId);
  const outstandingCents = Number(row?.outstanding_cents || 0);
  const capCents = Number(row?.cap_cents || getTrialCapCents());
  return {
    restaurant_id: parsedRestaurantId,
    outstanding_cents: outstandingCents,
    cap_cents: capCents,
    trial_cap_applies: trialCapApplies,
    at_capacity: trialCapApplies && outstandingCents >= capCents,
  };
}

/**
 * Trial-cap gate for the customer credit-request path.
 *
 * Reserve restaurants return { enforced: false } (Phase 4 governs them).
 * Trial-tier restaurants at or over the cap throw 409
 * restaurant_credit_at_capacity. Replays of already-created requests must
 * call this only on the create path, never on idempotency replays.
 */
async function assertTrialCapAllows(restaurantId) {
  const exposure = await getCreditExposure(restaurantId);
  if (!exposure.trial_cap_applies) return { enforced: false };
  if (exposure.at_capacity) {
    fail('This restaurant is at capacity for credit requests right now', 'restaurant_credit_at_capacity', 409, {
      outstandingCents: exposure.outstanding_cents,
      capCents: exposure.cap_cents,
    });
  }
  return { enforced: true, exposure };
}

/**
 * FIFO derisk queue: customer wallet balances for the restaurant, oldest
 * first. The FIFO key is the wallet account's created_at (the account is
 * created on first wallet activity, so it orders customers by oldest
 * relationship first). Only active accounts with a positive balance are
 * listed; suspended/closed accounts are left for manual review.
 */
async function getFifoQueue(restaurantId, { limit = 10 } = {}) {
  const parsedRestaurantId = parseRestaurantId(restaurantId);
  if (!parsedRestaurantId) fail('Restaurant not found', 'restaurant_not_found', 404);
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 10, 1), FIFO_QUEUE_LIMIT);
  const { rows } = await pool.query(
    `SELECT a.customer_id,
            a.balance_cents,
            a.reserved_cents,
            a.currency_code,
            a.created_at AS oldest_activity_at,
            u.email AS customer_email,
            NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS customer_name
       FROM food_customer_wallet_accounts a
       JOIN users u ON u.id = a.customer_id
      WHERE a.restaurant_id = $1
        AND a.balance_cents > 0
        AND a.status = 'active'
      ORDER BY a.created_at ASC, a.id ASC
      LIMIT $2`,
    [parsedRestaurantId, safeLimit]
  );
  return rows.map((row) => ({
    customer_id: row.customer_id,
    balance_cents: Number(row.balance_cents || 0),
    reserved_cents: Number(row.reserved_cents || 0),
    currency_code: row.currency_code,
    oldest_activity_at: row.oldest_activity_at,
    customer_email: row.customer_email,
    customer_name: row.customer_name,
  }));
}

/**
 * Migrate a single customer's deriskable balance inside the caller's
 * transaction. See the module header for the money-safety contract.
 */
async function deriskOneCustomer(client, { restaurantId, customerId, amountCents, batchId, operatorId }) {
  const { rows: [account] } = await client.query(
    `SELECT *
       FROM food_customer_wallet_accounts
      WHERE restaurant_id = $1 AND customer_id = $2
      FOR UPDATE`,
    [restaurantId, customerId]
  );
  if (!account) fail('Wallet account not found', 'wallet_not_found', 404);
  const balance = Number(account.balance_cents || 0);
  const reserved = Number(account.reserved_cents || 0);
  // Held funds back in-flight order holds: never derisk them.
  const amount = Math.min(Math.max(0, balance - reserved), Math.round(Number(amountCents)));
  if (amount <= 0) return { customerId, amountCents: 0 };
  const currency = String(account.currency_code || PLATFORM_CREDIT_CURRENCY).toUpperCase();
  if (currency !== PLATFORM_CREDIT_CURRENCY) {
    fail(
      `Cannot derisk ${currency} balances to OxSteed Credit yet`,
      'credit_derisk_currency_unsupported',
      409,
      { currencyCode: currency }
    );
  }

  // 1. Make the customer whole in OxSteed Credit first (platform treasury
  //    funds the grant). actorType 'system' attributes the movement to the
  //    derisk run; the operator is recorded in metadata and the derisk row.
  await adjustCustomerCreditInTransaction(client, {
    customerId,
    amountCents: amount,
    currencyCode: PLATFORM_CREDIT_CURRENCY,
    direction: 'credit',
    idempotencyKey: `credit-derisk:${batchId}:${customerId}`,
    actorType: 'system',
    actorUserId: null,
    reason: `Restaurant credit FIFO derisk (restaurant ${restaurantId}, batch ${batchId})`,
    referenceType: 'credit_derisk',
    referenceId: batchId,
    metadata: {
      restaurantId: String(restaurantId),
      batchId,
      deriskOperatorId: operatorId || null,
    },
  });

  // 2. Zero the restaurant wallet balance through the append-only ledger
  //    (dual-posts the liability decrease to the central journal).
  const walletResult = await debitFoodWallet(client, {
    restaurantId,
    customerId,
    currencyCode: currency,
    amountCents: amount,
    description: `FIFO derisk to OxSteed Credit (batch ${batchId})`,
    referenceType: 'credit_derisk',
    referenceId: batchId,
    idempotencyKey: `credit-derisk-wallet:${batchId}:${customerId}`,
    createdByUserId: operatorId || null,
    actorType: 'restaurant_staff',
    metadata: {
      batchId,
      deriskOperatorId: operatorId || null,
      platformCreditGranted: true,
    },
  });

  // 3. Durable per-customer derisk record.
  await client.query(
    `INSERT INTO restaurant_credit_derisks
       (restaurant_id, customer_id, amount_cents, currency_code, operator_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [restaurantId, customerId, amount, currency, operatorId || null]
  );

  return { customerId, amountCents: amount, walletAccountId: walletResult.account?.id || null };
}

/**
 * FIFO derisking: migrate oldest customer balances to OxSteed Credit until
 * targetCents is covered (or balances run out). One transaction per
 * customer; a single customer's failure is recorded in `skipped` and the
 * run continues with the next-oldest balance (fail closed per customer).
 *
 * Returns { batch_id, derisked_cents, migrations: [{ customer_id,
 * amount_cents }], skipped: [{ customer_id, code, message }] }.
 */
async function deriskOldest({ restaurantId, targetCents, operatorId }) {
  const parsedRestaurantId = parseRestaurantId(restaurantId);
  if (!parsedRestaurantId) fail('Restaurant not found', 'restaurant_not_found', 404);
  const target = Math.round(Number(targetCents));
  if (!Number.isSafeInteger(target) || target <= 0) {
    fail('Derisk target must be a positive amount', 'credit_derisk_target_invalid');
  }

  const batchId = crypto.randomUUID();
  const queue = await getFifoQueue(parsedRestaurantId, { limit: FIFO_QUEUE_LIMIT });
  let remaining = target;
  let deriskedCents = 0;
  const migrations = [];
  const skipped = [];

  for (const entry of queue) {
    if (remaining <= 0) break;
    const wanted = Math.min(Number(entry.balance_cents || 0), remaining);
    if (wanted <= 0) continue;
    try {
      const migrated = await withTransaction(
        pool,
        (client) => deriskOneCustomer(client, {
          restaurantId: parsedRestaurantId,
          customerId: entry.customer_id,
          amountCents: wanted,
          batchId,
          operatorId,
        }),
        'credit_derisk_customer'
      );
      if (migrated.amountCents > 0) {
        migrations.push({
          customer_id: migrated.customerId,
          amount_cents: migrated.amountCents,
          wallet_account_id: migrated.walletAccountId,
        });
        deriskedCents += migrated.amountCents;
        remaining -= migrated.amountCents;
      }
    } catch (err) {
      logger.warn('[credit-derisk] customer derisk failed; balance unchanged, continuing FIFO run', {
        restaurantId: String(parsedRestaurantId),
        batchId,
        customerId: String(entry.customer_id),
        code: err.code || 'credit_derisk_failed',
        error: err.message,
      });
      skipped.push({
        customer_id: entry.customer_id,
        code: err.code || 'credit_derisk_failed',
        message: err.message,
      });
    }
  }

  return { batch_id: batchId, derisked_cents: deriskedCents, migrations, skipped };
}

module.exports = {
  DEFAULT_TRIAL_CAP_CENTS,
  PLATFORM_CREDIT_CURRENCY,
  getTrialCapCents,
  getCreditExposure,
  assertTrialCapAllows,
  getFifoQueue,
  deriskOldest,
};
