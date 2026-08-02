'use strict';

const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');
const {
  creditFoodWallet,
  debitFoodWallet,
  getOrCreateWalletAccount,
  formatLedgerRow,
} = require('./foodWalletService');

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function normalizeCurrency(value) {
  return (normalizeString(value, 3) || 'USD').toUpperCase();
}

function normalizeAmount(amountCents) {
  const amount = Math.round(Number(amountCents || 0));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      amountCents: 'Amount must be a positive number of cents',
    });
  }
  return amount;
}

function formatHold(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    restaurantId: String(row.restaurant_id),
    accountId: String(row.account_id),
    customerId: row.customer_id,
    amountCents: Number(row.amount_cents || 0),
    currencyCode: row.currency_code,
    status: row.status,
    purpose: row.purpose || null,
    referenceType: row.reference_type || null,
    referenceId: row.reference_id || null,
    correlationId: row.correlation_id || null,
    capturedLedgerEntryId: row.captured_ledger_entry_id ? String(row.captured_ledger_entry_id) : null,
    metadata: row.metadata || {},
    expiresAt: row.expires_at,
    capturedAt: row.captured_at || null,
    releasedAt: row.released_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatTransfer(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    restaurantId: String(row.restaurant_id),
    senderCustomerId: row.sender_customer_id,
    recipientCustomerId: row.recipient_customer_id,
    senderAccountId: String(row.sender_account_id),
    recipientAccountId: String(row.recipient_account_id),
    amountCents: Number(row.amount_cents || 0),
    currencyCode: row.currency_code,
    status: row.status,
    memo: row.memo || null,
    correlationId: row.correlation_id || null,
    debitLedgerEntryId: row.debit_ledger_entry_id ? String(row.debit_ledger_entry_id) : null,
    creditLedgerEntryId: row.credit_ledger_entry_id ? String(row.credit_ledger_entry_id) : null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    reversedAt: row.reversed_at || null,
  };
}

async function expireWalletHoldsForAccount(client, accountId) {
  const { rows } = await client.query(
    `SELECT *
       FROM food_customer_wallet_holds
      WHERE account_id = $1
        AND status = 'active'
        AND expires_at <= NOW()
      FOR UPDATE`,
    [accountId]
  );
  if (!rows.length) return 0;

  const releasedCents = rows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
  await client.query(
    `UPDATE food_customer_wallet_holds
        SET status = 'expired',
            released_at = NOW(),
            updated_at = NOW()
      WHERE id = ANY($1::uuid[])`,
    [rows.map((row) => row.id)]
  );
  await client.query(
    `UPDATE food_customer_wallet_accounts
        SET reserved_cents = GREATEST(0, reserved_cents - $1),
            updated_at = NOW()
      WHERE id = $2`,
    [releasedCents, accountId]
  );
  return releasedCents;
}

async function createWalletHold(client, {
  restaurantId,
  customerId,
  currencyCode,
  amountCents,
  expiresAt,
  purpose,
  referenceType,
  referenceId,
  idempotencyKey,
  correlationId,
  createdByUserId = null,
  metadata = {},
}) {
  const amount = normalizeAmount(amountCents);
  const currency = normalizeCurrency(currencyCode);
  const account = await getOrCreateWalletAccount(client, { restaurantId, customerId, currencyCode: currency });
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 120);

  if (normalizedIdempotencyKey) {
    const { rows } = await client.query(
      `SELECT * FROM food_customer_wallet_holds
        WHERE account_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [account.id, normalizedIdempotencyKey]
    );
    if (rows[0]) return { hold: rows[0], replayed: true };
  }

  await expireWalletHoldsForAccount(client, account.id);
  const { rows: accountRows } = await client.query(
    `UPDATE food_customer_wallet_accounts
        SET reserved_cents = reserved_cents + $1,
            updated_at = NOW()
      WHERE id = $2
        AND balance_cents - reserved_cents >= $1
      RETURNING *`,
    [amount, account.id]
  );
  if (!accountRows[0]) {
    throw new AppError('Insufficient available restaurant wallet balance', 409, 'wallet_insufficient_available_funds');
  }

  const expiration = new Date(expiresAt || Date.now() + 15 * 60 * 1000);
  if (Number.isNaN(expiration.getTime()) || expiration.getTime() <= Date.now()) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      expiresAt: 'Hold expiration must be in the future',
    });
  }

  const { rows } = await client.query(
    `INSERT INTO food_customer_wallet_holds
       (restaurant_id, account_id, customer_id, amount_cents, currency_code,
        purpose, reference_type, reference_id, idempotency_key, correlation_id,
        created_by_user_id, metadata, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
     RETURNING *`,
    [
      restaurantId,
      account.id,
      customerId,
      amount,
      currency,
      normalizeString(purpose, 80),
      normalizeString(referenceType, 60),
      normalizeString(referenceId, 120),
      normalizedIdempotencyKey,
      normalizeString(correlationId, 120),
      createdByUserId,
      JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}),
      expiration,
    ]
  );
  return { hold: rows[0], account: accountRows[0], replayed: false };
}

async function captureWalletHold(client, {
  holdId,
  restaurantId,
  customerId = null,
  createdByUserId = null,
  actorType = 'system',
  description,
  metadata = {},
}) {
  const { rows } = await client.query(
    `SELECT * FROM food_customer_wallet_holds
      WHERE id = $1
        AND restaurant_id = $2
        AND ($3::uuid IS NULL OR customer_id = $3::uuid)
      FOR UPDATE`,
    [holdId, restaurantId, customerId]
  );
  const hold = rows[0];
  if (!hold) throw new AppError('Wallet hold not found', 404, 'wallet_hold_not_found');
  if (hold.status === 'captured') return { hold, entry: null, replayed: true };
  if (hold.status !== 'active') {
    throw new AppError('Wallet hold is not active', 409, 'wallet_hold_not_active', { status: hold.status });
  }
  if (new Date(hold.expires_at).getTime() <= Date.now()) {
    await releaseWalletHold(client, { holdId, restaurantId, customerId, nextStatus: 'expired' });
    throw new AppError('Wallet hold expired', 409, 'wallet_hold_expired');
  }

  await client.query(
    `UPDATE food_customer_wallet_accounts
        SET reserved_cents = GREATEST(0, reserved_cents - $1), updated_at = NOW()
      WHERE id = $2`,
    [hold.amount_cents, hold.account_id]
  );
  const ledger = await debitFoodWallet(client, {
    restaurantId,
    customerId: hold.customer_id,
    currencyCode: hold.currency_code,
    amountCents: hold.amount_cents,
    description: description || 'Restaurant credit authorization captured',
    referenceType: hold.reference_type || 'wallet_hold',
    referenceId: hold.reference_id || String(hold.id),
    idempotencyKey: `wallet-hold-capture:${hold.id}`,
    createdByUserId,
    correlationId: hold.correlation_id || String(hold.id),
    actorType,
    metadata: { ...(hold.metadata || {}), ...metadata, walletHoldId: String(hold.id) },
  });
  const { rows: updatedRows } = await client.query(
    `UPDATE food_customer_wallet_holds
        SET status = 'captured', captured_at = NOW(), captured_ledger_entry_id = $1, updated_at = NOW()
      WHERE id = $2 RETURNING *`,
    [ledger.entry.id, hold.id]
  );
  return { hold: updatedRows[0], entry: ledger.entry, account: ledger.account, replayed: ledger.replayed };
}

async function releaseWalletHold(client, {
  holdId,
  restaurantId,
  customerId = null,
  nextStatus = 'released',
}) {
  const { rows } = await client.query(
    `SELECT * FROM food_customer_wallet_holds
      WHERE id = $1
        AND restaurant_id = $2
        AND ($3::uuid IS NULL OR customer_id = $3::uuid)
      FOR UPDATE`,
    [holdId, restaurantId, customerId]
  );
  const hold = rows[0];
  if (!hold) throw new AppError('Wallet hold not found', 404, 'wallet_hold_not_found');
  if (hold.status !== 'active') return { hold, changed: false };
  const status = nextStatus === 'expired' ? 'expired' : 'released';
  await client.query(
    `UPDATE food_customer_wallet_accounts
        SET reserved_cents = GREATEST(0, reserved_cents - $1), updated_at = NOW()
      WHERE id = $2`,
    [hold.amount_cents, hold.account_id]
  );
  const { rows: updatedRows } = await client.query(
    `UPDATE food_customer_wallet_holds
        SET status = $1, released_at = NOW(), updated_at = NOW()
      WHERE id = $2 RETURNING *`,
    [status, hold.id]
  );
  return { hold: updatedRows[0], changed: true };
}

async function transferWalletCredit(client, {
  restaurantId,
  senderCustomerId,
  recipientCustomerId,
  currencyCode,
  amountCents,
  memo,
  idempotencyKey,
  correlationId,
  metadata = {},
}) {
  if (!recipientCustomerId || senderCustomerId === recipientCustomerId) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      recipient: 'Recipient must be a different OxSteed customer',
    });
  }
  const amount = normalizeAmount(amountCents);
  const currency = normalizeCurrency(currencyCode);
  const key = normalizeString(idempotencyKey, 120);
  if (!key) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      idempotencyKey: 'A client idempotency key is required',
    });
  }

  const { rows: existingRows } = await client.query(
    `SELECT * FROM food_customer_wallet_transfers
      WHERE restaurant_id = $1 AND sender_customer_id = $2 AND idempotency_key = $3 LIMIT 1`,
    [restaurantId, senderCustomerId, key]
  );
  if (existingRows[0]) return { transfer: existingRows[0], replayed: true };

  await client.query(
    `INSERT INTO food_customer_wallet_accounts (restaurant_id, customer_id, currency_code)
     VALUES ($1,$2,$4),($1,$3,$4)
     ON CONFLICT (restaurant_id, customer_id) DO NOTHING`,
    [restaurantId, senderCustomerId, recipientCustomerId, currency]
  );
  const { rows: accounts } = await client.query(
    `SELECT * FROM food_customer_wallet_accounts
      WHERE restaurant_id = $1 AND customer_id = ANY($2::uuid[])
      ORDER BY id FOR UPDATE`,
    [restaurantId, [senderCustomerId, recipientCustomerId]]
  );
  const sender = accounts.find((row) => row.customer_id === senderCustomerId);
  const recipient = accounts.find((row) => row.customer_id === recipientCustomerId);
  if (!sender || !recipient) throw new AppError('Wallet account not found', 404, 'wallet_not_found');
  if (sender.status !== 'active' || recipient.status !== 'active') {
    throw new AppError('Both restaurant credit wallets must be active', 409, 'wallet_inactive');
  }
  if (normalizeCurrency(sender.currency_code) !== currency || normalizeCurrency(recipient.currency_code) !== currency) {
    throw new AppError('Wallet currency mismatch', 409, 'wallet_currency_mismatch');
  }

  const transferId = crypto.randomUUID();
  const correlation = normalizeString(correlationId, 120) || `wallet-transfer:${transferId}`;
  const debit = await debitFoodWallet(client, {
    restaurantId,
    customerId: senderCustomerId,
    currencyCode: currency,
    amountCents: amount,
    description: memo || 'Restaurant credit sent',
    referenceType: 'wallet_transfer_out',
    referenceId: transferId,
    idempotencyKey: `wallet-transfer:${transferId}:debit`,
    createdByUserId: senderCustomerId,
    correlationId: correlation,
    actorType: 'customer',
    metadata: { ...metadata, transferId, recipientCustomerId },
  });
  const credit = await creditFoodWallet(client, {
    restaurantId,
    customerId: recipientCustomerId,
    currencyCode: currency,
    amountCents: amount,
    description: memo || 'Restaurant credit received',
    referenceType: 'wallet_transfer_in',
    referenceId: transferId,
    idempotencyKey: `wallet-transfer:${transferId}:credit`,
    createdByUserId: senderCustomerId,
    correlationId: correlation,
    actorType: 'customer',
    metadata: { ...metadata, transferId, senderCustomerId },
  });
  const { rows } = await client.query(
    `INSERT INTO food_customer_wallet_transfers
       (id, restaurant_id, sender_customer_id, recipient_customer_id,
        sender_account_id, recipient_account_id, amount_cents, currency_code,
        memo, idempotency_key, correlation_id, debit_ledger_entry_id,
        credit_ledger_entry_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
     RETURNING *`,
    [
      transferId,
      restaurantId,
      senderCustomerId,
      recipientCustomerId,
      sender.id,
      recipient.id,
      amount,
      currency,
      normalizeString(memo, 255),
      key,
      correlation,
      debit.entry.id,
      credit.entry.id,
      JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}),
    ]
  );
  return {
    transfer: rows[0],
    senderEntry: debit.entry,
    recipientEntry: credit.entry,
    replayed: false,
  };
}

module.exports = {
  createWalletHold,
  captureWalletHold,
  releaseWalletHold,
  transferWalletCredit,
  expireWalletHoldsForAccount,
  formatHold,
  formatTransfer,
  formatLedgerRow,
};
