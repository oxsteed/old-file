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
const { withTransaction } = require('../utils/transaction');
const {
  ensureAccount,
  postJournalTransaction,
  isCreditRailEnabled,
  assertCreditRailNotFrozen,
  assertSupportedCreditCurrency,
} = require('./oxsteedCreditService');

const SUB_BANK_ACCOUNT_TYPE = 'restaurant_sub_bank';

const SUB_BANK_LOAD = 'sub_bank_load';
const SUB_BANK_REDEMPTION = 'sub_bank_redemption';
const SUB_BANK_REFUND = 'sub_bank_refund';
const SUB_BANK_OPENING_BALANCE = 'sub_bank_opening_balance';
const SUB_BANK_CONVERSION = 'sub_bank_conversion';
// Phase 2 restaurant credit refunds: exact reversal of a sub_bank_load.
// The restaurant's customer-credit liability falls and the issuance funding
// returns to the platform treasury (the restaurant already paid the customer
// back directly, so no partner_payable is created).
const SUB_BANK_LOAD_REVERSAL = 'sub_bank_load_reversal';

// Food-wallet reference types that issue new restaurant credit.
// 'restaurant_conversion_in' is the Phase 6 OxSteed -> restaurant
// conversion: it posts as a sub_bank_load funded from the customer's
// OxSteed wallet (metadata fundingSource='oxsteed_credit').
const LOAD_REFERENCE_TYPES = new Set(['merchant_load', 'merchant_load_request', 'restaurant_conversion_in']);
// Food-wallet reference types that spend restaurant credit (redemption/capture).
const REDEMPTION_REFERENCE_TYPES = new Set(['food_order', 'wallet_hold', 'wallet_payment_session']);
// Same-restaurant customer transfers: aggregate unchanged, no central posting.
const TRANSFER_REFERENCE_TYPES = new Set(['wallet_transfer_in', 'wallet_transfer_out']);
// Phase 6: restaurant -> OxSteed conversions dual-post here as a real
// central leg (restaurant_sub_bank -> customer_wallet). The converted
// amount travels in metadata (conversionConvertedAmountCents) because the
// wallet debit is the pre-rate source amount.
const CONVERSION_OUT_REFERENCE_TYPES = new Set(['restaurant_conversion_out']);
// Phase 2 restaurant credit refunds: wallet debits that return issued credit
// to the customer. These reverse the original sub_bank_load issuance rather
// than posting a redemption (no partner_payable: the restaurant paid the
// customer back directly, the platform owes the restaurant nothing).
const LOAD_REVERSAL_REFERENCE_TYPES = new Set(['credit_refund']);

/**
 * Map a food-wallet ledger entry to its central-journal action.
 * Returns 'load' | 'redemption' | 'refund' | 'conversion_out' | 'load_reversal' | 'skip_transfer'.
 * Throws for any money-moving entry without a defined posting rule (fail closed).
 */
function resolveDualPostingAction(entryType, referenceType) {
  if (TRANSFER_REFERENCE_TYPES.has(referenceType)) return 'skip_transfer';
  if (entryType === 'debit' && CONVERSION_OUT_REFERENCE_TYPES.has(referenceType)) return 'conversion_out';
  if (entryType === 'credit' && LOAD_REFERENCE_TYPES.has(referenceType)) return 'load';
  if (entryType === 'debit' && REDEMPTION_REFERENCE_TYPES.has(referenceType)) return 'redemption';
  if (entryType === 'debit' && LOAD_REVERSAL_REFERENCE_TYPES.has(referenceType)) return 'load_reversal';
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
 * Queue a dual-posting for replay when the credit rail is re-enabled.
 * Called with the caller's transaction client, so the marker is atomic
 * with the food-wallet ledger write: both commit or both roll back.
 * Idempotent on the deterministic dual-posting key: a retry of the same
 * wallet entry can never queue twice.
 */
async function insertDualPostingBackfill(client, {
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
  const idempotencyKey = dualPostingIdempotencyKey(ledgerEntryId);
  await client.query(
    `INSERT INTO credit_dual_posting_backfill
       (idempotency_key, ledger_entry_id, restaurant_id, customer_id, currency_code,
        amount_cents, entry_type, reference_type, reference_id,
        actor_type, actor_user_id, created_by_user_id, correlation_id, request_ip, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      idempotencyKey,
      String(ledgerEntryId),
      String(restaurantId),
      customerId == null ? null : String(customerId),
      currencyCode,
      Math.round(Number(amountCents || 0)),
      entryType,
      referenceType,
      referenceId == null ? null : String(referenceId),
      actorType,
      actorUserId,
      createdByUserId,
      correlationId,
      requestIp,
      JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}),
    ]
  );
  return idempotencyKey;
}
/**
 * Dual-post one food-wallet ledger entry to the central journal.
 *
 * Must be called with the caller's transaction client, AFTER the wallet
 * ledger row is written and BEFORE commit, so both writes are atomic.
 * Returns { posted, skipped?, backfilled?, transaction? }.
 *
 * Rail kill switch (migration 422, reworked migration 655): when the rail
 * is disabled the wallet write FAILS OPEN — the marker is queued in
 * credit_dual_posting_backfill in the same transaction and replayed when
 * the rail is re-enabled. A frozen rail still fails closed.
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

  // Rail kill switch: fail OPEN with backfill when disabled. The caller runs
  // in the same transaction, so the wallet write and the backfill marker
  // commit atomically. A frozen rail still fails closed.
  if (!(await isCreditRailEnabled(client))) {
    await insertDualPostingBackfill(client, {
      ledgerEntryId,
      restaurantId,
      customerId,
      currencyCode,
      amountCents,
      entryType,
      referenceType,
      referenceId,
      actorType,
      actorUserId,
      createdByUserId,
      correlationId,
      requestIp,
      metadata,
    });
    logger.info('[SubBank] rail disabled: wallet write proceeds, dual-post queued for backfill', {
      ledgerEntryId: String(ledgerEntryId),
    });
    return { posted: false, backfilled: true, reason: 'credit_rail_suspended' };
  }
  await assertCreditRailNotFrozen(client);

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
  } else if (action === 'conversion_out') {
    // Phase 6: restaurant -> OxSteed conversion. The food wallet was
    // debited the pre-rate source amount; the central leg moves the
    // post-rate converted amount from the restaurant's sub-bank to the
    // customer's OxSteed wallet. partner_id is NULL: conversions are
    // customer-scoped, not partner-scoped.
    const convertedAmount = Math.round(Number(postingMetadata.conversionConvertedAmountCents || 0));
    if (!Number.isSafeInteger(convertedAmount) || convertedAmount <= 0) {
      throw new AppError('Conversion dual-posting requires a positive converted amount', 500, 'sub_bank_conversion_amount_invalid');
    }
    const wallet = await ensureAccount(client, {
      accountType: 'customer_wallet',
      customerId,
      currencyCode: currency,
    });
    spec = {
      ...shared,
      partnerId: null,
      amountCents: convertedAmount,
      transactionType: SUB_BANK_CONVERSION,
      debitAccountId: subBank.id,
      creditAccountId: wallet.id,
      description: `Restaurant credit conversion dual-posting (wallet ledger entry ${ledgerEntryId})`,
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
  } else if (action === 'load_reversal') {
    // Restaurant credit refunded to the customer: the restaurant's
    // customer-credit liability falls and the issuance funding returns to
    // the platform treasury (exact reversal of the sub_bank_load posting).
    spec = {
      ...shared,
      transactionType: SUB_BANK_LOAD_REVERSAL,
      debitAccountId: subBank.id,
      creditAccountId: treasury.id,
      description: `Restaurant credit refund dual-posting (wallet ledger entry ${ledgerEntryId})`,
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

const MAX_BACKFILL_ATTEMPTS = 5;

/**
 * Replay queued dual-postings once the credit rail is re-enabled.
 *
 * Drains pending credit_dual_posting_backfill rows through
 * postFoodWalletDualEntry, which resolves to the same deterministic
 * idempotency key, so replays can never double-post. Rows that fail are
 * retried up to MAX_BACKFILL_ATTEMPTS, then parked as 'failed' for
 * operator review. No-op while the rail is disabled.
 */
async function replayDualPostingBackfill(pool, { limit = 100 } = {}) {
  if (!(await isCreditRailEnabled(pool))) {
    return { replayed: 0, failed: 0, skipped: 'rail_disabled' };
  }
  // Review P1-249: a frozen rail would fail every row and burn all retry
  // attempts during one sweep. Skip the sweep until the freeze clears.
  try {
    await assertCreditRailNotFrozen(pool);
  } catch (err) {
    if (err && err.code === 'credit_rail_frozen') return { replayed: 0, failed: 0, parked: 0, skipped: 'rail_frozen' };
    throw err;
  }
  const bound = Math.min(500, Math.max(1, Number(limit) || 100));
  let replayed = 0;
  let deferred = 0;
  let failed = 0;
  let parked = 0;
  await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT *
         FROM credit_dual_posting_backfill
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [bound]
    );
    for (const row of rows) {
      // Review P1-255: a refund must not post before its redemption has
      // been replayed, or the sub-bank is credited without ever having
      // been debited. Leave it pending (no attempt burned) until then.
      const originalDebitEntryId = row.metadata && row.metadata.originalDebitEntryId;
      if (row.entry_type === 'refund' && originalDebitEntryId !== undefined && originalDebitEntryId !== null && String(originalDebitEntryId) !== '') {
        const { rows: originals } = await client.query(
          `SELECT status FROM credit_dual_posting_backfill
            WHERE ledger_entry_id::text = $1::text AND status <> 'processed'
            LIMIT 1`,
          [String(originalDebitEntryId)]
        );
        if (originals.length) {
          deferred += 1;
          continue;
        }
      }
      try {
        await postFoodWalletDualEntry(client, {
          ledgerEntryId: row.ledger_entry_id,
          restaurantId: row.restaurant_id,
          customerId: row.customer_id,
          currencyCode: row.currency_code,
          amountCents: Number(row.amount_cents),
          entryType: row.entry_type,
          referenceType: row.reference_type,
          referenceId: row.reference_id,
          actorType: row.actor_type,
          actorUserId: row.actor_user_id,
          createdByUserId: row.created_by_user_id,
          correlationId: row.correlation_id,
          requestIp: row.request_ip,
          metadata: row.metadata || {},
        });
        await client.query(
          `UPDATE credit_dual_posting_backfill
              SET status = 'processed', processed_at = NOW(), attempts = attempts + 1
            WHERE id = $1`,
          [row.id]
        );
        replayed += 1;
      } catch (err) {
        const message = String((err && err.message) || err).slice(0, 2000);
        const attempts = Number(row.attempts || 0) + 1;
        const nextStatus = attempts >= MAX_BACKFILL_ATTEMPTS ? 'failed' : 'pending';
        await client.query(
          `UPDATE credit_dual_posting_backfill
              SET status = $2, attempts = $3, last_error = $4
            WHERE id = $1`,
          [row.id, nextStatus, attempts, message]
        );
        if (nextStatus === 'failed') parked += 1; else failed += 1;
        logger.error('[SubBank] dual-posting backfill replay failed', {
          backfillId: row.id,
          ledgerEntryId: row.ledger_entry_id,
          attempts,
          nextStatus,
          message,
        });
      }
    }
  }, 'dual-posting-backfill-replay');
  if (replayed) logger.info('[SubBank] dual-posting backfill replayed', { replayed, failed, parked, deferred });
  return { replayed, failed, parked, deferred };
}

/** Review P1-249: operator view of rows parked as 'failed'. */
async function listParkedDualPostingBackfill(pool, { limit = 100 } = {}) {
  const bound = Math.min(500, Math.max(1, Number(limit) || 100));
  const { rows } = await pool.query(
    `SELECT id, ledger_entry_id, restaurant_id, entry_type, reference_type, amount_cents,
            currency_code, attempts, last_error, created_at
       FROM credit_dual_posting_backfill
      WHERE status = 'failed'
      ORDER BY created_at ASC
      LIMIT $1`,
    [bound]
  );
  return rows;
}

/** Review P1-249: put parked rows back in the queue with fresh attempts. */
async function requeueParkedDualPostingBackfill(pool, { ids = null } = {}) {
  const params = [];
  let filter = '';
  if (Array.isArray(ids) && ids.length) {
    params.push(ids.map(String));
    filter = ` AND id::text = ANY($1::text[])`;
  }
  const { rowCount } = await pool.query(
    `UPDATE credit_dual_posting_backfill
        SET status = 'pending', attempts = 0
      WHERE status = 'failed'${filter}`,
    params
  );
  return { requeued: rowCount || 0 };
}

module.exports = {
  SUB_BANK_ACCOUNT_TYPE,
  SUB_BANK_LOAD,
  SUB_BANK_REDEMPTION,
  SUB_BANK_REFUND,
  SUB_BANK_OPENING_BALANCE,
  SUB_BANK_LOAD_REVERSAL,
  resolveDualPostingAction,
  ensureRestaurantPartner,
  ensureRestaurantSubBankAccount,
  dualPostingIdempotencyKey,
  postFoodWalletDualEntry,
  replayDualPostingBackfill,
  listParkedDualPostingBackfill,
  requeueParkedDualPostingBackfill,
  insertDualPostingBackfill,
  getRestaurantWalletOutstanding,
};
