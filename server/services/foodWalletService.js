'use strict';

const crypto = require('crypto');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { recordException } = require('./reconciliationExceptions');

const MAX_WALLET_ENTRY_CENTS = Math.max(1, Number.parseInt(process.env.FOOD_WALLET_MAX_ENTRY_CENTS || '250000', 10));
const MAX_WALLET_BALANCE_CENTS = Math.max(MAX_WALLET_ENTRY_CENTS, Number.parseInt(process.env.FOOD_WALLET_MAX_BALANCE_CENTS || '1000000', 10));
const LEGACY_WALLET_HASH_ALGORITHM = 'sha256_v0';
const CURRENT_WALLET_HASH_ALGORITHM = 'hmac_sha256_v1';

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function normalizeCurrency(value) {
  const raw = normalizeString(value, 3);
  return raw ? raw.toUpperCase() : 'USD';
}

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function getWalletLedgerSecret() {
  const secret = process.env.FOOD_WALLET_LEDGER_HMAC_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('Missing FOOD_WALLET_LEDGER_HMAC_SECRET or JWT_SECRET for wallet ledger hashing');
  }
  return secret;
}

function buildWalletHashPayload({
  accountId,
  restaurantId,
  customerId,
  entryType,
  amountCents,
  balanceAfterCents,
  currencyCode,
  sequence,
  previousEntryHash,
  referenceType,
  referenceId,
  correlationId,
  createdByUserId,
  actorType,
  metadata,
}) {
  return {
    accountId,
    restaurantId,
    customerId,
    entryType,
    amountCents,
    balanceAfterCents,
    currencyCode,
    sequence,
    previousEntryHash,
    referenceType,
    referenceId,
    correlationId,
    createdByUserId,
    actorType,
    metadata,
  };
}

function computeWalletEntryHash(payload, algorithm = CURRENT_WALLET_HASH_ALGORITHM) {
  const data = stableStringify(buildWalletHashPayload(payload));
  switch (algorithm) {
    case LEGACY_WALLET_HASH_ALGORITHM:
      return crypto.createHash('sha256').update(data).digest('hex');
    case CURRENT_WALLET_HASH_ALGORITHM:
      return crypto.createHmac('sha256', getWalletLedgerSecret()).update(data).digest('hex');
    default:
      throw new Error(`Unsupported wallet hash algorithm: ${algorithm}`);
  }
}

function toWalletAmount(amountCents) {
  return Number(amountCents || 0) / 100;
}

function formatLedgerRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    entryType: row.entry_type,
    amountCents: Number(row.amount_cents || 0),
    amount: toWalletAmount(row.amount_cents),
    balanceAfterCents: Number(row.balance_after_cents || 0),
    balanceAfter: toWalletAmount(row.balance_after_cents),
    currencyCode: row.currency_code,
    description: row.description || null,
    referenceType: row.reference_type || null,
    referenceId: row.reference_id || null,
    createdAt: row.created_at,
    postedAt: row.posted_at || row.created_at,
    sequence: row.entry_sequence === null || row.entry_sequence === undefined ? null : Number(row.entry_sequence),
    correlationId: row.correlation_id || null,
    actorType: row.actor_type || null,
    hashAlgorithm: row.hash_algorithm || null,
    entryHash: row.entry_hash || null,
    previousEntryHash: row.previous_entry_hash || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  };
}

function assertLedgerReplayMatches(existingEntry, {
  entryType,
  amountCents,
  currencyCode,
  referenceType,
  referenceId,
}) {
  const mismatches = {};
  if (existingEntry.entry_type !== entryType) {
    mismatches.entryType = {
      existing: existingEntry.entry_type,
      requested: entryType,
    };
  }
  if (Number(existingEntry.amount_cents || 0) !== Number(amountCents || 0)) {
    mismatches.amountCents = {
      existing: Number(existingEntry.amount_cents || 0),
      requested: Number(amountCents || 0),
    };
  }
  if (normalizeCurrency(existingEntry.currency_code) !== normalizeCurrency(currencyCode)) {
    mismatches.currencyCode = {
      existing: normalizeCurrency(existingEntry.currency_code),
      requested: normalizeCurrency(currencyCode),
    };
  }
  if ((existingEntry.reference_type || null) !== (referenceType || null)) {
    mismatches.referenceType = {
      existing: existingEntry.reference_type || null,
      requested: referenceType || null,
    };
  }
  if ((existingEntry.reference_id || null) !== (referenceId || null)) {
    mismatches.referenceId = {
      existing: existingEntry.reference_id || null,
      requested: referenceId || null,
    };
  }

  if (Object.keys(mismatches).length) {
    throw new AppError('Wallet ledger idempotency conflict', 409, 'wallet_ledger_idempotency_conflict', {
      ledgerEntryId: String(existingEntry.id),
      mismatches,
    });
  }
}

function formatWallet(accountRow, transactionRows = []) {
  const balanceCents = Number(accountRow.balance_cents || 0);
  const reservedCents = Number(accountRow.reserved_cents || 0);
  return {
    id: String(accountRow.restaurant_id),
    accountId: String(accountRow.id),
    restaurantId: String(accountRow.restaurant_id),
    restaurantName: accountRow.restaurant_name,
    restaurantLogoUrl: accountRow.restaurant_logo_url || null,
    currencyCode: accountRow.currency_code,
    balanceCents,
    balance: toWalletAmount(balanceCents),
    reservedCents,
    reserved: toWalletAmount(reservedCents),
    availableBalanceCents: Math.max(0, balanceCents - reservedCents),
    availableBalance: toWalletAmount(Math.max(0, balanceCents - reservedCents)),
    status: accountRow.status,
    updatedAt: accountRow.updated_at,
    ledgerVersion: Number(accountRow.ledger_version || 0),
    lastEntryHash: accountRow.last_entry_hash || null,
    transactions: transactionRows.map(formatLedgerRow),
  };
}

async function getOrCreateWalletAccount(client, {
  restaurantId,
  customerId,
  currencyCode = 'USD',
}) {
  await client.query(
    `INSERT INTO food_customer_wallet_accounts
       (restaurant_id, customer_id, currency_code)
     VALUES ($1, $2, $3)
     ON CONFLICT (restaurant_id, customer_id)
     DO NOTHING`,
    [restaurantId, customerId, normalizeCurrency(currencyCode)]
  );

  const { rows } = await client.query(
    `SELECT a.*
       FROM food_customer_wallet_accounts a
      WHERE a.restaurant_id = $1
        AND a.customer_id = $2
      FOR UPDATE`,
    [restaurantId, customerId]
  );

  if (!rows[0]) {
    throw new AppError('Wallet account not found', 404, 'wallet_not_found');
  }
  if (rows[0].status !== 'active') {
    throw new AppError('Wallet account is not active', 409, 'wallet_inactive', {
      status: rows[0].status,
    });
  }
  return rows[0];
}

async function findExistingLedgerEntry(client, {
  accountId,
  idempotencyKey,
  entryType,
  referenceType,
  referenceId,
}) {
  if (idempotencyKey) {
    const { rows } = await client.query(
      `SELECT *
         FROM food_customer_wallet_ledger
        WHERE account_id = $1
          AND idempotency_key = $2
        LIMIT 1`,
      [accountId, idempotencyKey]
    );
    if (rows[0]) return rows[0];
  }

  if (referenceType && referenceId) {
    const { rows } = await client.query(
      `SELECT *
         FROM food_customer_wallet_ledger
        WHERE account_id = $1
          AND entry_type = $2
          AND reference_type = $3
          AND reference_id = $4
        LIMIT 1`,
      [accountId, entryType, referenceType, referenceId]
    );
    if (rows[0]) return rows[0];
  }

  return null;
}

async function applyWalletLedgerEntry(client, {
  restaurantId,
  customerId,
  currencyCode = 'USD',
  entryType,
  amountCents,
  description,
  referenceType,
  referenceId,
  idempotencyKey,
  createdByUserId = null,
  correlationId = null,
  actorType = 'system',
  metadata = {},
}) {
  const normalizedAmount = Math.round(Number(amountCents || 0));
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      amountCents: 'Amount must be a positive number of cents',
    });
  }
  if (normalizedAmount > MAX_WALLET_ENTRY_CENTS) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      amountCents: `Amount exceeds maximum per-entry limit of ${MAX_WALLET_ENTRY_CENTS} cents`,
    });
  }

  if (!['credit', 'debit', 'refund', 'adjustment'].includes(entryType)) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      entryType: 'Unsupported wallet entry type',
    });
  }

  const account = await getOrCreateWalletAccount(client, {
    restaurantId,
    customerId,
    currencyCode,
  });
  const normalizedCurrency = normalizeCurrency(currencyCode);
  if (account.currency_code && normalizeCurrency(account.currency_code) !== normalizedCurrency) {
    throw new AppError('Wallet currency mismatch', 409, 'wallet_currency_mismatch', {
      expectedCurrencyCode: normalizeCurrency(account.currency_code),
      receivedCurrencyCode: normalizedCurrency,
    });
  }

  const existingEntry = await findExistingLedgerEntry(client, {
    accountId: account.id,
    idempotencyKey,
    entryType,
    referenceType,
    referenceId,
  });

  if (existingEntry) {
    assertLedgerReplayMatches(existingEntry, {
      entryType,
      amountCents: normalizedAmount,
      currencyCode: normalizedCurrency,
      referenceType: normalizeString(referenceType, 60),
      referenceId: normalizeString(referenceId, 120),
    });
    return {
      account,
      entry: existingEntry,
      replayed: true,
    };
  }

  const direction = entryType === 'debit' ? -1 : 1;
  const reservedCents = Number(account.reserved_cents || 0);
  const availableBalanceCents = Number(account.balance_cents || 0) - reservedCents;
  if (entryType === 'debit' && reservedCents > 0 && normalizedAmount > availableBalanceCents) {
    throw new AppError(
      'Insufficient available restaurant wallet balance',
      409,
      'wallet_insufficient_available_funds',
      {
        balanceCents: String(account.balance_cents || 0),
        reservedCents: String(reservedCents),
        availableBalanceCents: String(Math.max(0, availableBalanceCents)),
        requestedCents: String(normalizedAmount),
      }
    );
  }
  const nextBalance = Number(account.balance_cents || 0) + direction * normalizedAmount;
  if (nextBalance < 0) {
    throw new AppError(
      'Insufficient restaurant wallet balance',
      409,
      'wallet_insufficient_funds',
      {
        balanceCents: String(account.balance_cents || 0),
        requestedCents: String(normalizedAmount),
      }
    );
  }
  if (nextBalance > MAX_WALLET_BALANCE_CENTS) {
    throw new AppError('Wallet balance limit exceeded', 409, 'wallet_balance_limit_exceeded', {
      balanceCents: String(account.balance_cents || 0),
      requestedCents: String(normalizedAmount),
      maxBalanceCents: String(MAX_WALLET_BALANCE_CENTS),
    });
  }

  const nextSequence = Number(account.ledger_version || 0) + 1;
  const previousEntryHash = normalizeString(account.last_entry_hash, 128);
  const normalizedCorrelationId = normalizeString(correlationId, 120);
  const normalizedActorType = normalizeString(actorType, 40) || 'system';
  const normalizedDescription = normalizeString(description, 255);
  const normalizedReferenceType = normalizeString(referenceType, 60);
  const normalizedReferenceId = normalizeString(referenceId, 120);
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 120);
  const normalizedMetadata = normalizeMetadata(metadata);
  const entryHash = computeWalletEntryHash({
    accountId: account.id,
    restaurantId,
    customerId,
    entryType,
    amountCents: normalizedAmount,
    balanceAfterCents: nextBalance,
    currencyCode: normalizedCurrency,
    sequence: nextSequence,
    previousEntryHash,
    referenceType: normalizedReferenceType,
    referenceId: normalizedReferenceId,
    correlationId: normalizedCorrelationId,
    createdByUserId,
    actorType: normalizedActorType,
    metadata: normalizedMetadata,
  }, CURRENT_WALLET_HASH_ALGORITHM);

  const { rows: updatedRows } = await client.query(
    `UPDATE food_customer_wallet_accounts
        SET balance_cents = $1,
            currency_code = $2,
            ledger_version = $3,
            last_entry_hash = $4,
            last_posted_at = NOW(),
            updated_at = NOW()
      WHERE id = $5
      RETURNING *`,
    [nextBalance, normalizedCurrency, nextSequence, entryHash, account.id]
  );
  const updatedAccount = updatedRows[0];

  const { rows: ledgerRows } = await client.query(
    `INSERT INTO food_customer_wallet_ledger
       (account_id, restaurant_id, customer_id, entry_type, amount_cents, balance_after_cents,
        currency_code, description, reference_type, reference_id, idempotency_key,
        created_by_user_id, metadata, entry_sequence, previous_entry_hash, entry_hash,
        correlation_id, actor_type, hash_algorithm)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18, $19)
     RETURNING *`,
    [
      updatedAccount.id,
      restaurantId,
      customerId,
      entryType,
      normalizedAmount,
      nextBalance,
      normalizedCurrency,
      normalizedDescription,
      normalizedReferenceType,
      normalizedReferenceId,
      normalizedIdempotencyKey,
      createdByUserId,
      JSON.stringify(normalizedMetadata),
      nextSequence,
      previousEntryHash,
      entryHash,
      normalizedCorrelationId,
      normalizedActorType,
      CURRENT_WALLET_HASH_ALGORITHM,
    ]
  );

  return {
    account: updatedAccount,
    entry: ledgerRows[0],
    replayed: false,
  };
}

async function creditFoodWallet(client, args) {
  return applyWalletLedgerEntry(client, { ...args, entryType: 'credit' });
}

async function debitFoodWallet(client, args) {
  return applyWalletLedgerEntry(client, { ...args, entryType: 'debit' });
}

async function refundFoodWallet(client, args) {
  return applyWalletLedgerEntry(client, { ...args, entryType: 'refund' });
}

async function refundWalletDebitForReference(client, {
  restaurantId,
  customerId,
  currencyCode = 'USD',
  orderReferenceId,
  description,
  createdByUserId = null,
  correlationId = null,
  actorType = 'system',
  metadata = {},
}) {
  const account = await getOrCreateWalletAccount(client, {
    restaurantId,
    customerId,
    currencyCode,
  });
  const { rows: debitRows } = await client.query(
    `SELECT *
       FROM food_customer_wallet_ledger
      WHERE account_id = $1
        AND entry_type = 'debit'
        AND reference_type = 'food_order'
        AND reference_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [account.id, normalizeString(orderReferenceId, 120)]
  );
  // C6 fallback: debits captured from a QR/hold payment session before the
  // capture reference override landed carry reference_type='wallet_hold' (the
  // hold's own reference was 'wallet_payment_session'). Match those by the
  // orderId the capture call wrote into metadata.
  let debitEntry = debitRows[0];
  if (!debitEntry) {
    const { rows: legacyRows } = await client.query(
      `SELECT *
         FROM food_customer_wallet_ledger
        WHERE account_id = $1
          AND entry_type = 'debit'
          AND reference_type IN ('wallet_hold', 'wallet_payment_session')
          AND metadata->>'orderId' = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [account.id, normalizeString(orderReferenceId, 120)]
    );
    debitEntry = legacyRows[0] || null;
  }
  if (!debitEntry) {
    // Never silently drop a refund: surface it to the reconciliation workspace.
    await recordException({
      domain: 'payment_refund',
      referenceId: `food-order:${normalizeString(orderReferenceId, 120)}`,
      severity: 'warning',
      summary: 'Wallet debit not found for cancelled/refunded food order',
      details: { restaurantId, customerId, currencyCode, orderReferenceId },
    });
    return { refunded: false, reason: 'debit_not_found' };
  }

  const refundReferenceId = normalizeString(orderReferenceId, 120);
  const { rows: existingRefundRows } = await client.query(
    `SELECT *
       FROM food_customer_wallet_ledger
      WHERE account_id = $1
        AND entry_type = 'refund'
        AND reference_type = 'food_order_refund'
        AND reference_id = $2
      LIMIT 1`,
    [account.id, refundReferenceId]
  );
  if (existingRefundRows[0]) {
    return { refunded: false, reason: 'already_refunded', entry: existingRefundRows[0] };
  }

  const result = await refundFoodWallet(client, {
    restaurantId,
    customerId,
    currencyCode: normalizeCurrency(currencyCode || debitEntry.currency_code),
    amountCents: Number(debitEntry.amount_cents || 0),
    description,
    referenceType: 'food_order_refund',
    referenceId: refundReferenceId,
    idempotencyKey: normalizeString(correlationId, 120) || `food-order-refund:${refundReferenceId}`,
    createdByUserId,
    correlationId,
    actorType,
    metadata: {
      ...normalizeMetadata(metadata),
      originalDebitEntryId: String(debitEntry.id),
      originalReferenceType: debitEntry.reference_type,
      originalReferenceId: debitEntry.reference_id,
    },
  });

  return {
    refunded: true,
    entry: result.entry,
    account: result.account,
  };
}

async function loadWalletAccountsForUser(userId, {
  restaurantId = null,
  transactionLimit = 10,
  includeInactive = false,
} = {}) {
  const params = [userId];
  let filter = '';
  if (restaurantId) {
    params.push(restaurantId);
    filter = `AND a.restaurant_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT a.*,
            fr.display_name AS restaurant_name,
            fr.logo_url AS restaurant_logo_url
       FROM food_customer_wallet_accounts a
      JOIN food_restaurants fr ON fr.id = a.restaurant_id
      WHERE a.customer_id = $1
        AND ${includeInactive ? `a.status <> 'closed'` : `a.status = 'active'`}
        ${filter}
      ORDER BY a.updated_at DESC`,
    params
  );

  const limit = Math.min(Math.max(Number(transactionLimit) || 10, 1), 50);
  const wallets = [];
  for (const row of rows) {
    const { rows: txRows } = await pool.query(
      `SELECT *
         FROM food_customer_wallet_ledger
        WHERE account_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [row.id, limit]
    );
    wallets.push(formatWallet(row, txRows));
  }
  return wallets;
}

async function verifyWalletIntegrityForCustomer(restaurantId, customerId) {
  const { rows: accountRows } = await pool.query(
    `SELECT a.*,
            fr.display_name AS restaurant_name,
            fr.logo_url AS restaurant_logo_url
       FROM food_customer_wallet_accounts a
       JOIN food_restaurants fr ON fr.id = a.restaurant_id
      WHERE a.restaurant_id = $1
        AND a.customer_id = $2
      LIMIT 1`,
    [restaurantId, customerId]
  );
  const account = accountRows[0];
  if (!account) {
    throw new AppError('Wallet account not found', 404, 'wallet_not_found');
  }

  const { rows: entryRows } = await pool.query(
    `SELECT *
       FROM food_customer_wallet_ledger
      WHERE account_id = $1
      ORDER BY entry_sequence ASC NULLS LAST, created_at ASC, id ASC`,
    [account.id]
  );
  const { rows: [holdSummary] } = await pool.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS reserved_cents,
            COUNT(*)::int AS active_hold_count
       FROM food_customer_wallet_holds
      WHERE account_id = $1
        AND status = 'active'`,
    [account.id]
  );

  const issues = [];
  let runningBalance = 0;
  let expectedPreviousHash = null;
  let expectedSequence = 1;

  for (const row of entryRows) {
    const rowSequence = row.entry_sequence === null || row.entry_sequence === undefined
      ? null
      : Number(row.entry_sequence);
    if (rowSequence !== expectedSequence) {
      issues.push({
        code: 'sequence_gap',
        entryId: String(row.id),
        expectedSequence,
        actualSequence: rowSequence,
      });
    }

    const previousEntryHash = row.previous_entry_hash || null;
    if (previousEntryHash !== expectedPreviousHash) {
      issues.push({
        code: 'previous_hash_mismatch',
        entryId: String(row.id),
        expectedPreviousHash,
        actualPreviousHash: previousEntryHash,
      });
    }

    const direction = row.entry_type === 'debit' ? -1 : 1;
    runningBalance += direction * Number(row.amount_cents || 0);
    if (runningBalance !== Number(row.balance_after_cents || 0)) {
      issues.push({
        code: 'balance_mismatch',
        entryId: String(row.id),
        expectedBalanceCents: runningBalance,
        actualBalanceCents: Number(row.balance_after_cents || 0),
      });
      runningBalance = Number(row.balance_after_cents || 0);
    }

    const hashAlgorithm = normalizeString(row.hash_algorithm, 40) || LEGACY_WALLET_HASH_ALGORITHM;
    let expectedHash = null;
    try {
      expectedHash = computeWalletEntryHash({
        accountId: row.account_id,
        restaurantId: row.restaurant_id,
        customerId: row.customer_id,
        entryType: row.entry_type,
        amountCents: Number(row.amount_cents || 0),
        balanceAfterCents: Number(row.balance_after_cents || 0),
        currencyCode: normalizeCurrency(row.currency_code),
        sequence: rowSequence,
        previousEntryHash,
        referenceType: row.reference_type || null,
        referenceId: row.reference_id || null,
        correlationId: row.correlation_id || null,
        createdByUserId: row.created_by_user_id || null,
        actorType: row.actor_type || 'system',
        metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
      }, hashAlgorithm);
    } catch (err) {
      issues.push({
        code: 'unsupported_hash_algorithm',
        entryId: String(row.id),
        hashAlgorithm,
        message: err.message,
      });
    }

    if (expectedHash && (row.entry_hash || null) !== expectedHash) {
      issues.push({
        code: 'entry_hash_mismatch',
        entryId: String(row.id),
        hashAlgorithm,
        expectedEntryHash: expectedHash,
        actualEntryHash: row.entry_hash || null,
      });
    } else if (!expectedHash) {
      issues.push({
        code: 'entry_hash_unverifiable',
        entryId: String(row.id),
        hashAlgorithm,
      });
    }

    expectedPreviousHash = row.entry_hash || expectedHash;
    expectedSequence += 1;
  }

  if (Number(account.balance_cents || 0) !== runningBalance) {
    issues.push({
      code: 'account_balance_mismatch',
      expectedBalanceCents: runningBalance,
      actualBalanceCents: Number(account.balance_cents || 0),
    });
  }
  const expectedReservedCents = Number(holdSummary?.reserved_cents || 0);
  const actualReservedCents = Number(account.reserved_cents || 0);
  if (actualReservedCents !== expectedReservedCents) {
    issues.push({
      code: 'reserved_balance_mismatch',
      expectedReservedCents,
      actualReservedCents,
      activeHoldCount: Number(holdSummary?.active_hold_count || 0),
    });
  }
  if (Number(account.ledger_version || 0) !== entryRows.length) {
    issues.push({
      code: 'ledger_version_mismatch',
      expectedLedgerVersion: entryRows.length,
      actualLedgerVersion: Number(account.ledger_version || 0),
    });
  }
  if ((account.last_entry_hash || null) !== expectedPreviousHash) {
    issues.push({
      code: 'account_last_hash_mismatch',
      expectedLastEntryHash: expectedPreviousHash,
      actualLastEntryHash: account.last_entry_hash || null,
    });
  }

  return {
    wallet: formatWallet(account, entryRows.slice().reverse()),
    valid: issues.length === 0,
    checkedAt: new Date().toISOString(),
    entryCount: entryRows.length,
    reservedCents: actualReservedCents,
    activeHoldCount: Number(holdSummary?.active_hold_count || 0),
    currentHashAlgorithm: CURRENT_WALLET_HASH_ALGORITHM,
    legacyHashAlgorithm: LEGACY_WALLET_HASH_ALGORITHM,
    issues,
  };
}

module.exports = {
  creditFoodWallet,
  debitFoodWallet,
  refundFoodWallet,
  refundWalletDebitForReference,
  verifyWalletIntegrityForCustomer,
  formatWallet,
  formatLedgerRow,
  loadWalletAccountsForUser,
  getOrCreateWalletAccount,
  computeWalletEntryHash,
  CURRENT_WALLET_HASH_ALGORITHM,
  LEGACY_WALLET_HASH_ALGORITHM,
};
