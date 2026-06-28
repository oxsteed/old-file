'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

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

function toWalletAmount(amountCents) {
  return Number(amountCents || 0) / 100;
}

function formatLedgerRow(row) {
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
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  };
}

function formatWallet(accountRow, transactionRows = []) {
  return {
    id: String(accountRow.restaurant_id),
    accountId: String(accountRow.id),
    restaurantId: String(accountRow.restaurant_id),
    restaurantName: accountRow.restaurant_name,
    restaurantLogoUrl: accountRow.restaurant_logo_url || null,
    currencyCode: accountRow.currency_code,
    balanceCents: Number(accountRow.balance_cents || 0),
    balance: toWalletAmount(accountRow.balance_cents),
    status: accountRow.status,
    updatedAt: accountRow.updated_at,
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

  if (referenceType && referenceId && entryType === 'debit') {
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
  metadata = {},
}) {
  const normalizedAmount = Math.round(Number(amountCents || 0));
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      amountCents: 'Amount must be a positive number of cents',
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

  const existingEntry = await findExistingLedgerEntry(client, {
    accountId: account.id,
    idempotencyKey,
    entryType,
    referenceType,
    referenceId,
  });

  if (existingEntry) {
    return {
      account,
      entry: existingEntry,
      replayed: true,
    };
  }

  const direction = entryType === 'debit' ? -1 : 1;
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

  const { rows: updatedRows } = await client.query(
    `UPDATE food_customer_wallet_accounts
        SET balance_cents = $1,
            currency_code = $2,
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [nextBalance, normalizeCurrency(currencyCode), account.id]
  );
  const updatedAccount = updatedRows[0];

  const { rows: ledgerRows } = await client.query(
    `INSERT INTO food_customer_wallet_ledger
       (account_id, restaurant_id, customer_id, entry_type, amount_cents, balance_after_cents,
        currency_code, description, reference_type, reference_id, idempotency_key,
        created_by_user_id, metadata)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
     RETURNING *`,
    [
      updatedAccount.id,
      restaurantId,
      customerId,
      entryType,
      normalizedAmount,
      nextBalance,
      normalizeCurrency(currencyCode),
      normalizeString(description, 255),
      normalizeString(referenceType, 60),
      normalizeString(referenceId, 120),
      normalizeString(idempotencyKey, 120),
      createdByUserId,
      JSON.stringify(normalizeMetadata(metadata)),
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

async function loadWalletAccountsForUser(userId, {
  restaurantId = null,
  transactionLimit = 10,
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
        AND a.status <> 'closed'
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

module.exports = {
  creditFoodWallet,
  debitFoodWallet,
  formatWallet,
  formatLedgerRow,
  loadWalletAccountsForUser,
};
