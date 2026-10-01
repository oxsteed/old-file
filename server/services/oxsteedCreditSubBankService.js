'use strict';

/**
 * Restaurant sub-bank accounts on the OxSteed Credit central journal.
 *
 * Phase 1 of the central-bank model: every restaurant gets one
 * `restaurant_sub_bank` account per currency on the central double-entry
 * journal. The semantic invariant is:
 *
 *   restaurant_sub_bank(restaurant_id, currency).balance_cents
 *     === SUM(food_customer_wallet_accounts.balance_cents)
 *         WHERE restaurant_id AND currency_code
 *
 * i.e. the sub-bank balance always equals the aggregate outstanding customer
 * food-wallet balances at that restaurant. Outstanding restaurant credit is a
 * non-negative liability, so the balance>=0 floor (migration 517) applies to
 * sub-bank accounts: they are deliberately NOT in the exemption list.
 *
 * Dual-posting: every food-wallet money mutation is mirrored as a balanced
 * central-journal pair in the SAME database transaction via
 * postFoodWalletDualEntry(), called from applyWalletLedgerEntry() in
 * foodWalletService.js. Because both writes share the caller's transaction,
 * a failed central posting rolls back the wallet write (fail closed).
 *
 * Kill switch: when the OxSteed Credit rail is disabled
 * (feature flag `oxsteed_credit_enabled`, migration 422), dual-posting throws
 * 503 `credit_rail_suspended` and the food-wallet write is blocked with it.
 * This is intentional: allowing wallet writes without their central postings
 * would silently break the aggregate invariant. Deploying this code therefore
 * requires enabling the credit rail, or all restaurant-credit money mutations
 * will fail closed.
 *
 * Same-restaurant customer transfers move value between two wallets at one
 * restaurant, so the aggregate (and the sub-bank balance) is unchanged and no
 * central posting is made. There is no food-wallet expiry/forfeiture path, so
 * no breakage posting exists.
 */

const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const {
  ensureAccount,
  postJournalTransaction,
  assertCreditRailEnabled,
  assertSupportedCreditCurrency,
} = require('./oxsteedCreditService');

const SUB_BANK_ACCOUNT_TYPE = 'restaurant_sub_bank';

const SUB_BANK_LOAD = 'sub_bank_load';
const SUB_BANK_REDEMPTION = 'sub_bank_redemption';
const SUB_BANK_REFUND = 'sub_bank_refund';
const SUB_BANK_OPENING_BALANCE = 'sub_bank_opening_balance';

// Food-wallet reference types that issue new restaurant credit.
const LOAD_REFERENCE_TYPES = new Set(['merchant_load', 'merchant_load_request']);
// Food-wallet reference types that spend restaurant credit (redemption/capture).
const REDEMPTION_REFERENCE_TYPES = new Set(['food_order', 'wallet_hold', 'wallet_payment_session']);
// Same-restaurant customer transfers: aggregate unchanged, no central posting.
const TRANSFER_REFERENCE_TYPES = new Set(['wallet_transfer_in', 'wallet_transfer_out']);

/**
 * Map a food-wallet ledger entry to its central-journal action.
 * Returns 'load' | 'redemption' | 'refund' | 'skip_transfer'.
 * Throws for any money-moving entry without a defined posting rule (fail closed).
 */
function resolveDualPostingAction(entryType, referenceType) {
  if (TRANSFER_REFERENCE_TYPES.has(referenceType)) return 'skip_transfer';
  if (entryType === 'credit' && LOAD_REFERENCE_TYPES.has(referenceType)) return 'load';
  if (entryType === 'debit' && REDEMPTION_REFERENCE_TYPES.has(referenceType)) return 'redemption';
  if (entryType === 'refund') return 'refund';
  throw new AppError('Food-wallet entry has no central-bank posting rule', 500, 'food_wallet_dual_posting_unmapped', {
    entryType: String(entryType),
    referenceType: String(referenceType),
  });
}

function parseRestaurantId(restaurantId) {
  const normalized = Number(restaurantId);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new AppError('A valid restaurant id is required for sub-bank posting', 400, 'sub_bank_restaurant_invalid');
  }
  return normalized;
}

/**
 * Idempotent get-or-create of the credit-partner row for a restaurant.
 * Partner rows are normally admin-registered; dual-posting auto-provisions a
 * `pending` row on first food-wallet activity so redemption/refund postings
 * always have a partner_payable account to clear against. A later admin
 * registration replays against the existing row (registerPartner is
 * idempotent on restaurant_id).
 */
async function ensureRestaurantPartner(client, restaurantId) {
  const normalizedRestaurantId = parseRestaurantId(restaurantId);
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`oxsteed-credit:restaurant-partner:${normalizedRestaurantId}`]);
  const { rows: existingRows } = await client.query(
    `SELECT p.* FROM oxsteed_credit_partners p WHERE p.restaurant_id = $1 FOR UPDATE`,
    [normalizedRestaurantId]
  );
  if (existingRows[0]) return existingRows[0];

  const { rows: restaurantRows } = await client.query(
    `SELECT id, business_id FROM food_restaurants WHERE id = $1`,
    [normalizedRestaurantId]
  );
  if (!restaurantRows[0]) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  const { rows: insertedRows } = await client.query(
    `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, settlement_currency_code, status, notes)
     VALUES ($1, $2, 'USD', 'pending', 'Auto-provisioned for restaurant sub-bank dual-posting')
     ON CONFLICT (restaurant_id) DO NOTHING
     RETURNING *`,
    [normalizedRestaurantId, restaurantRows[0].business_id || null]
  );
  if (insertedRows[0]) {
    logger.info('Auto-provisioned OxSteed Credit partner row for restaurant sub-bank', {
      restaurantId: normalizedRestaurantId,
      partnerId: insertedRows[0].id,
    });
    return insertedRows[0];
  }
  const { rows: racedRows } = await client.query(
    `SELECT p.* FROM oxsteed_credit_partners p WHERE p.restaurant_id = $1 FOR UPDATE`,
    [normalizedRestaurantId]
  );
  if (!racedRows[0]) {
    throw new AppError('Credit partner could not be provisioned for restaurant', 500, 'sub_bank_partner_provision_failed');
  }
  return racedRows[0];
}

/**
 * Idempotent get-or-create of the restaurant sub-bank account.
 */
async function ensureRestaurantSubBankAccount(client, { restaurantId, currencyCode }) {
  return ensureAccount(client, {
    accountType: SUB_BANK_ACCOUNT_TYPE,
    restaurantId: parseRestaurantId(restaurantId),
    currencyCode,
  });
}

/**
 * Deterministic idempotency key for a dual-posted food-wallet ledger entry.
 * Replays of the same wallet entry resolve to the same central transaction,
 * so retries can never double-post.
 */
function dualPostingIdempotencyKey(ledgerEntryId) {
  return `food-wallet-ledger:${ledgerEntryId}:central`;
}

async function findCentralTransactionByIdempotencyKey(client, idempotencyKey) {
  const { rows } = await client.query(
    `SELECT id, status, transaction_type FROM oxsteed_credit_transactions WHERE idempotency_key = $1 LIMIT 1`,
    [idempotencyKey]
  );
  return rows[0] || null;
}

/**
 * Dual-post one food-wallet ledger entry to the central journal.
 *
 * Must be called with the caller's transaction client, AFTER the wallet
 * ledger row is written and BEFORE commit, so both writes are atomic.
 * Returns { posted, skipped?, replayed?, transaction? }.
 */
async function postFoodWalletDualEntry(client, {
  ledgerEntryId,
  restaurantId,
  customerId,
  currencyCode,
  amountCents,
  entryType,
  referenceType,
  referenceId,
  actorType = 'system',
  actorUserId = null,
  createdByUserId = null,
  correlationId = null,
  requestIp = null,
  metadata = {},
}) {
  const action = resolveDualPostingAction(entryType, referenceType);
  if (action === 'skip_transfer') {
    return { posted: false, skipped: 'transfer_aggregate_unchanged' };
  }

  // Rail kill switch (migration 422): fail closed. The caller runs in the
  // same transaction, so this rolls back the food-wallet write too.
  await assertCreditRailEnabled(client);

  const normalizedRestaurantId = parseRestaurantId(restaurantId);
  const currency = assertSupportedCreditCurrency(currencyCode);
  const normalizedAmount = Math.round(Number(amountCents || 0));
  if (!Number.isSafeInteger(normalizedAmount) || normalizedAmount <= 0) {
    throw new AppError('Dual-posting amount must be a positive number of cents', 400, 'sub_bank_amount_invalid');
  }

  const partner = await ensureRestaurantPartner(client, normalizedRestaurantId);
  const subBank = await ensureRestaurantSubBankAccount(client, { restaurantId: normalizedRestaurantId, currencyCode: currency });
  const treasury = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: currency });

  const idempotencyKey = dualPostingIdempotencyKey(ledgerEntryId);
  const shared = {
    amountCents: normalizedAmount,
    currencyCode: currency,
    partnerId: partner.id,
    agreementId: null,
    idempotencyKey,
    referenceType: 'food_wallet_ledger',
    referenceId: String(ledgerEntryId),
    actorType,
    actorUserId: actorUserId || createdByUserId || null,
    customerId: customerId || null,
    correlationId,
    requestIp,
    reason: 'Restaurant credit dual-posting to the central journal',
    bindIdempotencySemantics: true,
  };
  const postingMetadata = {
    ...(metadata && typeof metadata === 'object' ? metadata : {}),
    foodWalletLedgerEntryId: ledgerEntryId,
    foodWalletEntryType: entryType,
    foodWalletReferenceType: referenceType,
    foodWalletReferenceId: referenceId == null ? null : String(referenceId),
    restaurantId: normalizedRestaurantId,
  };

  let spec;
  if (action === 'load') {
    // Issuance: the restaurant (sub-bank) now owes the customer value.
    // The debit leg is the funding source: the customer's OxSteed credit
    // wallet when the load is funded from it, otherwise platform_treasury
    // (the existing funding-reference pattern for issuance).
    let debitAccount = treasury;
    const fundingSource = postingMetadata.fundingSource || postingMetadata.fundedFrom;
    if (fundingSource === 'oxsteed_credit' && postingMetadata.fundingCustomerId) {
      debitAccount = await ensureAccount(client, {
        accountType: 'customer_wallet',
        customerId: postingMetadata.fundingCustomerId,
        currencyCode: currency,
      });
    }
    spec = {
      ...shared,
      transactionType: SUB_BANK_LOAD,
      debitAccountId: debitAccount.id,
      creditAccountId: subBank.id,
      description: `Restaurant credit issuance dual-posting (wallet ledger entry ${ledgerEntryId})`,
      metadata: postingMetadata,
    };
  } else if (action === 'redemption') {
    // Customer spend: sub-bank liability extinguished, platform now owes
    // the restaurant (partner_payable), settled later via the settlement flow.
    const payable = await ensureAccount(client, {
      accountType: 'partner_payable',
      partnerId: partner.id,
      currencyCode: currency,
    });
    spec = {
      ...shared,
      transactionType: SUB_BANK_REDEMPTION,
      debitAccountId: subBank.id,
      creditAccountId: payable.id,
      description: `Restaurant credit redemption dual-posting (wallet ledger entry ${ledgerEntryId})`,
      metadata: postingMetadata,
    };
  } else {
    // action === 'refund': exact reversal of the redemption posting.
    const payable = await ensureAccount(client, {
      accountType: 'partner_payable',
      partnerId: partner.id,
      currencyCode: currency,
    });
    const originalDebitEntryId = postingMetadata.originalDebitEntryId;
    let originalReference = null;
    if (originalDebitEntryId !== undefined && originalDebitEntryId !== null && String(originalDebitEntryId) !== '') {
      const original = await findCentralTransactionByIdempotencyKey(client, dualPostingIdempotencyKey(originalDebitEntryId));
      if (original && original.status === 'posted' && original.transaction_type === SUB_BANK_REDEMPTION) {
        originalReference = { referenceType: SUB_BANK_REDEMPTION, referenceId: String(original.id) };
      }
    }
    spec = {
      ...shared,
      transactionType: SUB_BANK_REFUND,
      debitAccountId: payable.id,
      creditAccountId: subBank.id,
      referenceType: originalReference ? originalReference.referenceType : shared.referenceType,
      referenceId: originalReference ? originalReference.referenceId : shared.referenceId,
      description: `Restaurant credit refund dual-posting (wallet ledger entry ${ledgerEntryId})`,
      metadata: postingMetadata,
    };
  }

  const { transaction, replayed } = await postJournalTransaction(client, spec);
  return { posted: true, transaction, replayed };
}

/**
 * Aggregate outstanding customer food-wallet balances per restaurant and
 * currency. Used by reconciliation and the one-time backfill.
 */
async function getRestaurantWalletOutstanding(client, { restaurantId = null, currencyCode = null } = {}) {
  const conditions = [];
  const values = [];
  if (restaurantId !== null && restaurantId !== undefined) {
    values.push(parseRestaurantId(restaurantId));
    conditions.push(`restaurant_id = $${values.length}`);
  }
  if (currencyCode !== null && currencyCode !== undefined) {
    values.push(String(currencyCode).toUpperCase());
    conditions.push(`currency_code = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await client.query(
    `SELECT restaurant_id,
            currency_code,
            COUNT(*)::int AS account_count,
            COALESCE(SUM(balance_cents), 0)::bigint AS total_balance_cents
       FROM food_customer_wallet_accounts
       ${where}
      GROUP BY restaurant_id, currency_code
      ORDER BY restaurant_id, currency_code`,
    values
  );
  return rows;
}

module.exports = {
  SUB_BANK_ACCOUNT_TYPE,
  SUB_BANK_LOAD,
  SUB_BANK_REDEMPTION,
  SUB_BANK_REFUND,
  SUB_BANK_OPENING_BALANCE,
  resolveDualPostingAction,
  ensureRestaurantPartner,
  ensureRestaurantSubBankAccount,
  dualPostingIdempotencyKey,
  postFoodWalletDualEntry,
  getRestaurantWalletOutstanding,
};
