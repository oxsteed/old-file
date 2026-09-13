'use strict';

const crypto = require('crypto');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');

const CREDIT_CURRENCY = 'USD';
const DEFAULT_SUPPORTED_CREDIT_CURRENCIES = [
  'USD', 'CAD', 'MXN', 'DOP', 'HTG', 'EUR', 'GBP',
  'AED', 'SAR', 'EGP', 'MAD', 'NGN', 'BRL',
];
// Credit amounts are stored as integer minor units. Keep the enabled set
// explicit so a future zero- or three-decimal currency cannot be enabled by
// configuration before the ledger and UI support it end to end.
const CREDIT_CURRENCY_MINOR_UNITS = Object.freeze(Object.fromEntries(
  DEFAULT_SUPPORTED_CREDIT_CURRENCIES.map((currency) => [currency, 2])
));
const configuredCreditCurrencies = String(process.env.OXSTEED_CREDIT_SUPPORTED_CURRENCIES || '')
  .split(',')
  .map((value) => value.trim().toUpperCase())
  .filter((value) => /^[A-Z]{3}$/.test(value));
const unsupportedConfiguredCreditCurrencies = configuredCreditCurrencies.filter((currency) => !Object.prototype.hasOwnProperty.call(CREDIT_CURRENCY_MINOR_UNITS, currency));
if (unsupportedConfiguredCreditCurrencies.length) {
  console.warn('OxSteed Credit omitted currencies without verified two-decimal minor-unit support', {
    currencies: unsupportedConfiguredCreditCurrencies,
  });
}
const SUPPORTED_CREDIT_CURRENCIES = new Set([
  CREDIT_CURRENCY,
  ...(configuredCreditCurrencies.length
    ? configuredCreditCurrencies.filter((currency) => CREDIT_CURRENCY_MINOR_UNITS[currency] === 2)
    : DEFAULT_SUPPORTED_CREDIT_CURRENCIES),
]);
const SUPPORTED_CREDIT_CURRENCY_META = Object.freeze([...SUPPORTED_CREDIT_CURRENCIES].sort().reduce((metadata, currency) => {
  metadata[currency] = { code: currency, minorUnits: CREDIT_CURRENCY_MINOR_UNITS[currency] };
  return metadata;
}, {}));
const MAX_PAGE_SIZE = 100;
const MAX_TRANSACTION_CENTS = positiveEnv('OXSTEED_CREDIT_MAX_TRANSACTION_CENTS', 250000);
const MAX_CUSTOMER_BALANCE_CENTS = positiveEnv('OXSTEED_CREDIT_MAX_CUSTOMER_BALANCE_CENTS', 1000000);
const MAX_TOTAL_ISSUANCE_CENTS = positiveEnv('OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS', 5000000);
const MAX_DAILY_CUSTOMER_ISSUANCE_CENTS = positiveEnv('OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_ISSUANCE_CENTS', MAX_CUSTOMER_BALANCE_CENTS);
const DEFAULT_HOLD_TTL_MINUTES = positiveEnv('OXSTEED_CREDIT_HOLD_TTL_MINUTES', 30);
const MAX_HOLD_TTL_MINUTES = Math.max(DEFAULT_HOLD_TTL_MINUTES, positiveEnv('OXSTEED_CREDIT_MAX_HOLD_TTL_MINUTES', 1440));
const DEFAULT_STATEMENT_DAYS = 90;
const MAX_STATEMENT_DAYS = 366;
const MAX_STATEMENT_EXPORT_ROWS = 5000;
const LEDGER_HASH_ALGORITHM = 'hmac_sha256_v1';
const CUSTOMER_TRANSFERS_ENABLED = String(process.env.OXSTEED_CREDIT_ALLOW_CUSTOMER_TRANSFERS || '').toLowerCase() === 'true';

function positiveEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function normalizeCurrency(value) {
  return (normalizeString(value, 8) || CREDIT_CURRENCY).toUpperCase();
}

function assertSupportedCreditCurrency(value) {
  const currency = normalizeCurrency(value);
  if (!/^[A-Z]{3}$/.test(currency) || !SUPPORTED_CREDIT_CURRENCIES.has(currency) || SUPPORTED_CREDIT_CURRENCY_META[currency]?.minorUnits !== 2) {
    throw new AppError('This OxSteed Credit currency is not enabled', 400, 'credit_currency_not_supported', {
      currencyCode: currency,
      supportedCurrencies: [...SUPPORTED_CREDIT_CURRENCIES].sort(),
    });
  }
  return currency;
}

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseAmountCents(value, fieldName = 'amountCents') {
  const amount = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      [fieldName]: 'Must be a positive integer number of cents',
    });
  }
  if (amount > MAX_TRANSACTION_CENTS) {
    throw new AppError('Credit transaction limit exceeded', 400, 'credit_transaction_limit_exceeded', {
      amountCents: String(amount),
      maxTransactionCents: String(MAX_TRANSACTION_CENTS),
    });
  }
  return amount;
}

function parsePageSize(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return 25;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function parseOffset(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 1000000);
}

function parseStatementPageSize(value, maxRows = 100) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return Math.min(100, maxRows);
  return Math.min(parsed, maxRows);
}

function statementDate(value, fieldName, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(`Invalid ${fieldName}`, 400, `credit_statement_${fieldName}_invalid`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AppError(`Invalid ${fieldName}`, 400, `credit_statement_${fieldName}_invalid`);
  }
  return value;
}

function statementPeriod(from, to) {
  const today = new Date();
  const defaultTo = today.toISOString().slice(0, 10);
  const defaultFromDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (DEFAULT_STATEMENT_DAYS - 1)));
  const defaultFrom = defaultFromDate.toISOString().slice(0, 10);
  const periodEnd = statementDate(to, 'to', defaultTo);
  const periodStart = statementDate(from, 'from', defaultFrom);
  const startTime = new Date(`${periodStart}T00:00:00.000Z`).getTime();
  const endTime = new Date(`${periodEnd}T00:00:00.000Z`).getTime();
  const dayCount = Math.floor((endTime - startTime) / 86400000) + 1;
  if (dayCount <= 0 || dayCount > MAX_STATEMENT_DAYS) {
    throw new AppError(`Statement period must be between 1 and ${MAX_STATEMENT_DAYS} days`, 400, 'credit_statement_period_invalid');
  }
  return { from: periodStart, to: periodEnd };
}

function resolveHoldExpiry(expiresAt) {
  const now = new Date();
  const requestedExpiry = expiresAt ? new Date(expiresAt) : new Date(now.getTime() + DEFAULT_HOLD_TTL_MINUTES * 60000);
  if (Number.isNaN(requestedExpiry.getTime()) || requestedExpiry <= now) {
    throw new AppError('Hold expiry must be in the future', 400, 'credit_hold_expiry_invalid');
  }
  if (requestedExpiry.getTime() > now.getTime() + MAX_HOLD_TTL_MINUTES * 60000) {
    throw new AppError(`Hold expiry cannot be more than ${MAX_HOLD_TTL_MINUTES} minutes from now`, 400, 'credit_hold_expiry_too_long');
  }
  return requestedExpiry;
}

function getLedgerSecret() {
  const dedicatedSecret = process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET;
  if (process.env.NODE_ENV === 'production' && !dedicatedSecret) {
    throw new Error('OXSTEED_CREDIT_LEDGER_HMAC_SECRET is required in production');
  }
  const secret = dedicatedSecret || process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('Missing or weak OxSteed Credit ledger HMAC secret');
  return secret;
}

async function isCreditRailEnabled(client) {
  try {
    const { rows } = await client.query(
      `SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled' LIMIT 1`
    );
    return rows[0]?.is_enabled === true;
  } catch (error) {
    throw new AppError('OxSteed Credit is temporarily unavailable', 503, 'credit_rail_status_unavailable');
  }
}

async function lockCreditRail(client) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1))`,
    ['oxsteed-credit-rail-control']
  );
}

async function assertCreditRailEnabled(client) {
  await lockCreditRail(client);
  if (!(await isCreditRailEnabled(client))) {
    throw new AppError('OxSteed Credit is temporarily suspended', 503, 'credit_rail_suspended');
  }
}

function formatCreditRailStatus(row) {
  if (!row) return null;
  return {
    key: row.key,
    enabled: row.is_enabled === true,
    status: row.is_enabled === true ? 'enabled' : 'suspended',
    description: row.description || null,
    updatedBy: row.updated_by || null,
    updatedAt: row.updated_at || null,
  };
}

async function getCreditRailStatus() {
  try {
    const { rows } = await pool.query(
      `SELECT key, is_enabled, description, updated_by, updated_at
         FROM feature_flags
        WHERE key = 'oxsteed_credit_enabled'
        LIMIT 1`
    );
    if (!rows[0]) throw new Error('OxSteed Credit feature flag is missing');
    return formatCreditRailStatus(rows[0]);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('OxSteed Credit is temporarily unavailable', 503, 'credit_rail_status_unavailable');
  }
}

async function setCreditRailStatus({ enabled, actorUserId, reason, correlationId }) {
  if (typeof enabled !== 'boolean') {
    throw new AppError('Rail enabled must be a boolean', 400, 'credit_rail_enabled_invalid');
  }
  const normalizedReason = normalizeString(reason, 1000);
  if (!normalizedReason) {
    throw new AppError('A reason is required when changing the OxSteed Credit rail status', 400, 'credit_rail_status_reason_required');
  }
  return withTransaction(pool, async (client) => {
    // Share the lock with every posting path so suspension waits for any
    // in-flight movement, then prevents new movements before they begin.
    await lockCreditRail(client);
    const { rows } = await client.query(
      `SELECT key, is_enabled, description, updated_by, updated_at
         FROM feature_flags
        WHERE key = 'oxsteed_credit_enabled'
        FOR UPDATE`
    );
    const current = rows[0];
    if (!current) throw new AppError('OxSteed Credit control is not configured', 503, 'credit_rail_status_unavailable');
    if (current.is_enabled === enabled) {
      return { rail: formatCreditRailStatus(current), changed: false, replayed: true };
    }
    const { rows: updatedRows } = await client.query(
      `UPDATE feature_flags
          SET is_enabled = $1, updated_by = $2, updated_at = NOW()
        WHERE key = 'oxsteed_credit_enabled'
        RETURNING key, is_enabled, description, updated_by, updated_at`,
      [enabled, actorUserId || null]
    );
    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, resource_type, resource_id, reason,
          correlation_id, before_state, after_state, metadata)
       VALUES ($1, $2, 'credit_rail', 'oxsteed_credit_enabled', $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
      [
        enabled ? 'credit.rail.enabled' : 'credit.rail.suspended',
        actorUserId || null,
        normalizedReason,
        normalizeString(correlationId, 160),
        JSON.stringify({ enabled: current.is_enabled === true }),
        JSON.stringify({ enabled }),
        JSON.stringify({ emergencyControl: true }),
      ]
    );
    return { rail: formatCreditRailStatus(updatedRows[0]), changed: true, replayed: false };
  }, 'credit_set_rail_status');
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function computeEntryHash(payload) {
  return crypto.createHmac('sha256', getLedgerSecret())
    .update(stableStringify(payload))
    .digest('hex');
}

function formatAccount(row) {
  if (!row) return null;
  const balanceCents = Number(row.balance_cents || 0);
  const reservedCents = Number(row.reserved_cents || 0);
  return {
    accountId: String(row.id),
    accountType: row.account_type,
    customerId: row.customer_id || null,
    partnerId: row.partner_id === null || row.partner_id === undefined ? null : String(row.partner_id),
    currencyCode: normalizeCurrency(row.currency_code),
    balanceCents,
    reservedCents,
    availableBalanceCents: Math.max(0, balanceCents - reservedCents),
    status: row.status,
    ledgerVersion: Number(row.ledger_version || 0),
    lastEntryHash: row.last_entry_hash || null,
    lastPostedAt: row.last_posted_at || null,
    updatedAt: row.updated_at || null,
  };
}

function formatTransaction(row, entryRows = []) {
  if (!row) return null;
  return {
    id: String(row.id),
    transactionType: row.transaction_type,
    status: row.status,
    debitAccountId: String(row.debit_account_id),
    creditAccountId: String(row.credit_account_id),
    amountCents: Number(row.amount_cents || 0),
    currencyCode: normalizeCurrency(row.currency_code),
    partnerId: row.partner_id === null || row.partner_id === undefined ? null : String(row.partner_id),
    agreementId: row.agreement_id || null,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id || null,
    referenceType: row.reference_type || null,
    referenceId: row.reference_id || null,
    description: row.description || null,
    actorType: row.actor_type || 'system',
    metadata: normalizeMetadata(row.metadata),
    postedAt: row.posted_at || null,
    createdAt: row.created_at || null,
    replayed: false,
    entries: entryRows.map((entry) => ({
      id: String(entry.id),
      accountId: String(entry.account_id),
      side: entry.entry_side,
      amountCents: Number(entry.amount_cents || 0),
      balanceAfterCents: Number(entry.balance_after_cents || 0),
      sequence: Number(entry.sequence),
      previousEntryHash: entry.previous_entry_hash || null,
      entryHash: entry.entry_hash,
      createdAt: entry.created_at || null,
    })),
  };
}

function assertIdempotencyReplayMatches(existing, requested) {
  const mismatches = {};
  for (const field of ['transaction_type', 'debit_account_id', 'credit_account_id', 'amount_cents', 'currency_code', 'partner_id', 'agreement_id', 'reference_type', 'reference_id']) {
    const actual = existing[field] === null || existing[field] === undefined ? null : String(existing[field]).toUpperCase();
    const expectedValue = requested[field] === null || requested[field] === undefined ? null : String(requested[field]).toUpperCase();
    if (actual !== expectedValue) mismatches[field] = { existing: existing[field], requested: requested[field] };
  }
  if (Object.keys(mismatches).length) {
    throw new AppError('Credit idempotency key was already used for a different transaction', 409, 'credit_idempotency_conflict', { mismatches });
  }
}

function assertHoldIdempotencyReplayMatches(existing, requested) {
  const mismatches = {};
  for (const field of ['amount_cents', 'partner_id', 'agreement_id', 'currency_code', 'purpose', 'reference_type', 'reference_id']) {
    const actual = existing[field] === null || existing[field] === undefined ? null : String(existing[field]).toUpperCase();
    const expectedValue = requested[field] === null || requested[field] === undefined ? null : String(requested[field]).toUpperCase();
    if (actual !== expectedValue) mismatches[field] = { existing: existing[field], requested: requested[field] };
  }
  if (Object.keys(mismatches).length) {
    throw new AppError('Credit hold idempotency key was already used for a different hold', 409, 'credit_hold_idempotency_conflict', { mismatches });
  }
}

async function findExistingCreditHoldForReplay(client, { customerId, partnerId, idempotencyKey }) {
  const { rows } = await client.query(
    `SELECT *
       FROM oxsteed_credit_holds
      WHERE idempotency_key = $1
      FOR UPDATE`,
    [idempotencyKey]
  );
  if (!rows.length) return null;
  const existing = rows.find((row) => String(row.customer_id) === String(customerId)
    && String(row.partner_id) === String(partnerId));
  if (!existing || rows.some((row) => String(row.customer_id) !== String(customerId)
    || String(row.partner_id) !== String(partnerId))) {
    throw new AppError('Credit idempotency key was already used for a different hold', 409, 'credit_hold_idempotency_conflict');
  }
  return existing;
}

async function ensureAccount(client, { accountType, customerId = null, partnerId = null, currencyCode = CREDIT_CURRENCY }) {
  const currency = assertSupportedCreditCurrency(currencyCode);
  if (!['customer_wallet', 'partner_payable', 'platform_treasury', 'platform_revenue'].includes(accountType)) {
    throw new AppError('Unsupported credit account type', 400, 'credit_account_type_invalid');
  }

  const insertQuery = accountType === 'customer_wallet'
    ? `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, partner_id, currency_code)
         SELECT $1, $2, $3, $4
          WHERE EXISTS (
            SELECT 1 FROM users
             WHERE id = $2 AND role = 'customer'
          )
         ON CONFLICT DO NOTHING`
    : `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, partner_id, currency_code)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`;
  await client.query(insertQuery, [accountType, customerId, partnerId, currency]);

  const scopedOwnershipFilter = accountType === 'customer_wallet'
    ? 'a.customer_id = $2 AND a.partner_id IS NULL'
    : accountType === 'partner_payable'
      ? 'a.partner_id = $2 AND a.customer_id IS NULL'
      : 'a.customer_id IS NULL AND a.partner_id IS NULL';
  const ownerValue = accountType === 'customer_wallet' ? customerId : accountType === 'partner_payable' ? partnerId : accountType;
  const ownerJoin = accountType === 'customer_wallet'
    ? `JOIN users owner ON owner.id = a.customer_id AND owner.role = 'customer'`
    : '';
  const { rows } = await client.query(
    `SELECT a.* FROM oxsteed_credit_accounts a
      ${ownerJoin}
      WHERE a.account_type = $1 AND ${scopedOwnershipFilter} AND a.currency_code = $3
      FOR UPDATE`,
    [accountType, ownerValue, currency]
  );
  if (!rows[0]) {
    if (accountType === 'customer_wallet') {
      throw new AppError('OxSteed Credit is only available to customer accounts', 404, 'credit_customer_not_found');
    }
    throw new AppError('Credit account could not be created', 500, 'credit_account_create_failed');
  }
  return rows[0];
}

async function findCustomerAccount(client, customerId, currencyCode = CREDIT_CURRENCY, forUpdate = false) {
  const currency = assertSupportedCreditCurrency(currencyCode);
  const { rows } = await client.query(
    `SELECT a.*
       FROM oxsteed_credit_accounts a
       JOIN users owner ON owner.id = a.customer_id AND owner.role = 'customer'
      WHERE a.account_type = 'customer_wallet' AND a.customer_id = $1 AND a.currency_code = $2
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [customerId, currency]
  );
  return rows[0] || null;
}

async function loadAccountEntries(client, transactionId) {
  const { rows } = await client.query(
    `SELECT id, account_id, entry_side, amount_cents, balance_after_cents, sequence,
            previous_entry_hash, entry_hash, created_at
       FROM oxsteed_credit_transaction_entries
      WHERE transaction_id = $1
      ORDER BY id ASC`,
    [transactionId]
  );
  return rows;
}

async function getExistingTransaction(client, idempotencyKey) {
  if (!idempotencyKey) return null;
  const { rows } = await client.query(
    `SELECT * FROM oxsteed_credit_transactions WHERE idempotency_key = $1 FOR UPDATE`,
    [idempotencyKey]
  );
  return rows[0] || null;
}

async function findExistingPurchaseForReplay(client, { customerId, partnerId, idempotencyKey }) {
  const { rows } = await client.query(
    `SELECT t.*,
            debit_account.customer_id AS debit_account_customer_id,
            credit_account.partner_id AS credit_account_partner_id
       FROM oxsteed_credit_transactions t
       JOIN oxsteed_credit_accounts debit_account ON debit_account.id = t.debit_account_id
       JOIN oxsteed_credit_accounts credit_account ON credit_account.id = t.credit_account_id
      WHERE t.idempotency_key = $1
      FOR UPDATE`,
    [idempotencyKey]
  );
  const existing = rows[0];
  if (!existing) return null;
  if (existing.transaction_type !== 'purchase'
    || String(existing.debit_account_customer_id) !== String(customerId)
    || String(existing.partner_id) !== String(partnerId)
    || String(existing.credit_account_partner_id) !== String(partnerId)) {
    throw new AppError('Credit idempotency key was already used for a different purchase', 409, 'credit_idempotency_conflict');
  }
  return existing;
}

async function findExistingTransferForReplay(client, { senderCustomerId, recipientCustomerId, idempotencyKey }) {
  const { rows } = await client.query(
    `SELECT t.*, debit_account.customer_id AS sender_customer_id,
            credit_account.customer_id AS recipient_customer_id
       FROM oxsteed_credit_transactions t
       JOIN oxsteed_credit_accounts debit_account ON debit_account.id = t.debit_account_id
       JOIN oxsteed_credit_accounts credit_account ON credit_account.id = t.credit_account_id
      WHERE t.idempotency_key = $1
      FOR UPDATE`,
    [idempotencyKey]
  );
  if (!rows.length) return null;
  const existing = rows[0];
  if (existing.transaction_type !== 'transfer'
    || String(existing.sender_customer_id) !== String(senderCustomerId)
    || String(existing.recipient_customer_id) !== String(recipientCustomerId)) {
    throw new AppError('Credit idempotency key was already used for a different transfer', 409, 'credit_idempotency_conflict');
  }
  return existing;
}

async function assertIssuanceCapacity(client, amountCents, currencyCode = CREDIT_CURRENCY, customerId = null) {
  const currency = assertSupportedCreditCurrency(currencyCode);
  // The cap is global, so serialize the outstanding-balance check across all
  // customers before approving a new positive-value movement.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`oxsteed-credit:issuance-limit:${currency}`]);
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(balance_cents), 0) AS total_cents
       FROM oxsteed_credit_accounts
      WHERE account_type = 'customer_wallet' AND currency_code = $1`,
    [currency]
  );
  if (Number(rows[0]?.total_cents || 0) + amountCents > MAX_TOTAL_ISSUANCE_CENTS) {
    throw new AppError('OxSteed Credit issuance limit reached', 409, 'credit_total_issuance_limit');
  }
  if (customerId) {
    const { rows: dailyRows } = await client.query(
      `SELECT COALESCE(SUM(t.amount_cents), 0) AS total_cents
         FROM oxsteed_credit_transactions t
         JOIN oxsteed_credit_accounts debit_account ON debit_account.id = t.debit_account_id
         JOIN oxsteed_credit_accounts customer_account ON customer_account.id = t.credit_account_id
        WHERE t.status = 'posted'
          AND t.transaction_type IN ('load', 'adjustment')
          AND t.created_at >= CURRENT_DATE
          AND t.currency_code = $1
          AND debit_account.account_type = 'platform_treasury'
          AND customer_account.account_type = 'customer_wallet'
          AND customer_account.customer_id = $2`,
      [currency, customerId]
    );
    const dailyIssuedCents = Number(dailyRows[0]?.total_cents || 0);
    if (dailyIssuedCents + amountCents > MAX_DAILY_CUSTOMER_ISSUANCE_CENTS) {
      throw new AppError('Daily OxSteed Credit issuance limit reached for this customer', 409, 'credit_daily_issuance_limit', {
        issuedTodayCents: String(dailyIssuedCents),
        requestedCents: String(amountCents),
        maxDailyIssuanceCents: String(MAX_DAILY_CUSTOMER_ISSUANCE_CENTS),
      });
    }
  }
}

async function postJournalTransaction(client, input) {
  const amountCents = parseAmountCents(input.amountCents);
  const idempotencyKey = normalizeString(input.idempotencyKey, 160);
  if (!idempotencyKey) throw new AppError('Idempotency-Key is required for credit transactions', 400, 'credit_idempotency_key_required');
  if (!['load', 'purchase', 'refund', 'transfer', 'adjustment', 'settlement', 'fee', 'expiration', 'chargeback'].includes(input.transactionType)) {
    throw new AppError('Unsupported credit transaction type', 400, 'credit_transaction_type_invalid');
  }

  const requested = {
    transaction_type: input.transactionType,
    debit_account_id: String(input.debitAccountId),
    credit_account_id: String(input.creditAccountId),
    amount_cents: String(amountCents),
    currency_code: assertSupportedCreditCurrency(input.currencyCode),
    partner_id: input.partnerId === null || input.partnerId === undefined ? null : String(input.partnerId),
    agreement_id: input.agreementId || null,
    reference_type: normalizeString(input.referenceType, 80),
    reference_id: normalizeString(input.referenceId, 160),
  };
  const existing = input.existingTransaction || await getExistingTransaction(client, idempotencyKey);
  if (existing) {
    assertIdempotencyReplayMatches(existing, { ...requested, ...Object.fromEntries(Object.entries(requested).map(([key, value]) => [key, value])) });
    return { transaction: { ...formatTransaction(existing, await loadAccountEntries(client, existing.id)), replayed: true }, replayed: true };
  }

  const accountIds = [Number(input.debitAccountId), Number(input.creditAccountId)].sort((a, b) => a - b);
  const { rows: lockedAccounts } = await client.query(
    `SELECT * FROM oxsteed_credit_accounts
      WHERE id = ANY($1::bigint[])
      ORDER BY id ASC
      FOR UPDATE`,
    [accountIds]
  );
  if (lockedAccounts.length !== 2) throw new AppError('Credit account not found', 404, 'credit_account_not_found');
  const debitAccount = lockedAccounts.find((account) => String(account.id) === String(input.debitAccountId));
  const creditAccount = lockedAccounts.find((account) => String(account.id) === String(input.creditAccountId));
  if (!debitAccount || !creditAccount || debitAccount.id === creditAccount.id) {
    throw new AppError('Invalid credit account movement', 400, 'credit_account_movement_invalid');
  }
  if (normalizeCurrency(debitAccount.currency_code) !== requested.currency_code || normalizeCurrency(creditAccount.currency_code) !== requested.currency_code) {
    throw new AppError('Credit currency mismatch', 409, 'credit_currency_mismatch');
  }
  if (debitAccount.status !== 'active' || creditAccount.status !== 'active') {
    throw new AppError('Credit account is not active', 409, 'credit_account_inactive');
  }

  const availableDebit = Number(debitAccount.balance_cents || 0) - Number(debitAccount.reserved_cents || 0);
  const debitMayGoNegative = ['partner_payable', 'platform_treasury', 'platform_revenue'].includes(debitAccount.account_type);
  if (!debitMayGoNegative && amountCents > availableDebit) {
    throw new AppError('Insufficient available OxSteed Credit', 409, 'credit_insufficient_funds', {
      availableBalanceCents: String(Math.max(0, availableDebit)),
      requestedCents: String(amountCents),
    });
  }

  const nextDebitBalance = Number(debitAccount.balance_cents || 0) - amountCents;
  const nextCreditBalance = Number(creditAccount.balance_cents || 0) + amountCents;
  if (creditAccount.account_type === 'customer_wallet' && nextCreditBalance > MAX_CUSTOMER_BALANCE_CENTS) {
    throw new AppError('Customer credit balance limit exceeded', 409, 'credit_balance_limit_exceeded', {
      maxBalanceCents: String(MAX_CUSTOMER_BALANCE_CENTS),
    });
  }

  const { rows: transactionRows } = await client.query(
    `INSERT INTO oxsteed_credit_transactions
       (transaction_type, status, debit_account_id, credit_account_id, amount_cents, currency_code,
        partner_id, agreement_id, idempotency_key, correlation_id, reference_type, reference_id,
        description, actor_type, actor_user_id, metadata, posted_at)
     VALUES ($1, 'posted', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, NOW())
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [
      input.transactionType,
      debitAccount.id,
      creditAccount.id,
      amountCents,
      requested.currency_code,
      input.partnerId || null,
      input.agreementId || null,
      idempotencyKey,
      normalizeString(input.correlationId, 160),
      requested.reference_type,
      requested.reference_id,
      normalizeString(input.description, 255),
      normalizeString(input.actorType, 32) || 'system',
      input.actorUserId || null,
      JSON.stringify(normalizeMetadata(input.metadata)),
    ]
  );
  // A concurrent retry can lose the insert race after the first request
  // commits. Re-read the winner and return it as a normal idempotent replay.
  if (!transactionRows[0]) {
    const existingAfterConflict = await getExistingTransaction(client, idempotencyKey);
    if (!existingAfterConflict) {
      throw new AppError('Credit transaction could not be confirmed after an idempotent retry', 409, 'credit_idempotency_retry_required');
    }
    assertIdempotencyReplayMatches(existingAfterConflict, requested);
    return { transaction: { ...formatTransaction(existingAfterConflict, await loadAccountEntries(client, existingAfterConflict.id)), replayed: true }, replayed: true };
  }
  const transaction = transactionRows[0];
  const accountUpdates = [
    { account: debitAccount, nextBalance: nextDebitBalance, side: 'debit' },
    { account: creditAccount, nextBalance: nextCreditBalance, side: 'credit' },
  ];
  const entryRows = [];
  for (const update of accountUpdates) {
    const sequence = Number(update.account.ledger_version || 0) + 1;
    const previousEntryHash = update.account.last_entry_hash || null;
    const entryHash = computeEntryHash({
      transactionId: transaction.id,
      transactionType: input.transactionType,
      accountId: update.account.id,
      entrySide: update.side,
      amountCents,
      balanceAfterCents: update.nextBalance,
      currencyCode: requested.currency_code,
      sequence,
      previousEntryHash,
      metadata: normalizeMetadata(input.metadata),
    });
    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_accounts
          SET balance_cents = $1, ledger_version = $2, last_entry_hash = $3,
              last_posted_at = NOW(), updated_at = NOW()
        WHERE id = $4
        RETURNING *`,
      [update.nextBalance, sequence, entryHash, update.account.id]
    );
    const updatedAccount = updatedRows[0];
    const { rows: insertedEntries } = await client.query(
      `INSERT INTO oxsteed_credit_transaction_entries
         (transaction_id, account_id, entry_side, amount_cents, balance_after_cents, sequence,
          previous_entry_hash, entry_hash, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING *`,
      [transaction.id, update.account.id, update.side, amountCents, update.nextBalance, sequence, previousEntryHash, entryHash, JSON.stringify(normalizeMetadata(input.metadata))]
    );
    entryRows.push(insertedEntries[0]);
    update.updatedAccount = updatedAccount;
  }

  await client.query(
    `INSERT INTO oxsteed_credit_audit_events
       (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id,
        reason, correlation_id, after_state, metadata)
     VALUES ($1, $2, $3, $4, 'credit_transaction', $5, $6, $7, $8::jsonb, $9::jsonb)`,
    [
      `credit.${input.transactionType}.posted`,
      input.actorUserId || null,
      input.customerId || (creditAccount.account_type === 'customer_wallet' ? creditAccount.customer_id : debitAccount.customer_id) || null,
      input.partnerId || null,
      String(transaction.id),
      normalizeString(input.reason, 500),
      normalizeString(input.correlationId, 160),
      JSON.stringify({ transactionId: transaction.id, amountCents, debitAccountId: debitAccount.id, creditAccountId: creditAccount.id }),
      JSON.stringify(normalizeMetadata(input.metadata)),
    ]
  );

  return { transaction: formatTransaction(transaction, entryRows), replayed: false };
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeString(String(item), 120)?.toLowerCase()).filter(Boolean);
}

// Keep partner-wide and customer-allowlisted access on one predicate. A
// non-active customer record deliberately overrides partner-wide access so a
// suspension or revocation cannot be bypassed by a second query path.
const CUSTOMER_SPEND_ACCESS_SQL = `
  ((a.requires_customer_entitlement = FALSE AND e.id IS NULL) OR (e.id IS NOT NULL AND e.status = 'active'
    AND (e.starts_at IS NULL OR e.starts_at <= NOW())
    AND (e.ends_at IS NULL OR e.ends_at > NOW())))`;

function matchesGeography(geography, input) {
  const rules = normalizeMetadata(geography);
  const checks = [
    ['cities', input.city],
    ['states', input.state],
    ['postalCodes', input.postalCode],
    ['countries', input.country],
  ];
  return checks.every(([key, value]) => {
    const allowed = normalizeList(rules[key]);
    if (!allowed.length) return true;
    return allowed.includes(normalizeString(value, 120)?.toLowerCase());
  });
}

function formatGeography(geography) {
  const rules = normalizeMetadata(geography);
  return ['cities', 'states', 'postalCodes', 'countries'].reduce((result, key) => {
    const values = Array.isArray(rules[key])
      ? rules[key]
        .filter((value) => typeof value === 'string' || typeof value === 'number')
        .map((value) => normalizeString(String(value), 120))
        .filter(Boolean)
        .slice(0, 100)
      : [];
    if (values.length) result[key] = values;
    return result;
  }, {});
}

async function findSpendAgreement(client, { customerId, partnerId, agreementId = null, orderType, category, categories, menuItemId, menuItemIds, city, state, postalCode, country, amountCents, excludeHoldId = null, strict = true }) {
  const { rows } = await client.query(
    `SELECT a.*, p.restaurant_id, p.status AS partner_status, p.settlement_currency_code,
            fr.display_name AS restaurant_name, fr.status AS restaurant_status,
            fr.address_city, fr.address_state, fr.address_zip, fr.address_country,
            fr.currency_code AS restaurant_currency_code,
            e.id AS entitlement_id, e.status AS entitlement_status,
            e.starts_at AS entitlement_starts_at, e.ends_at AS entitlement_ends_at,
            e.max_transaction_cents AS entitlement_max_transaction_cents,
            e.daily_limit_cents AS entitlement_daily_limit_cents
       FROM oxsteed_credit_partner_agreements a
       JOIN oxsteed_credit_partners p ON p.id = a.partner_id
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
       LEFT JOIN oxsteed_credit_customer_entitlements e
         ON e.agreement_id = a.id AND e.customer_id = $1
      WHERE p.id = $2
        AND EXISTS (SELECT 1 FROM users customer WHERE customer.id = $1 AND customer.role = 'customer')
        AND p.status = 'active'
        AND fr.status = 'active'
        AND a.status = 'active'
        AND ($3::uuid IS NULL OR a.id = $3::uuid)
        AND a.starts_at <= NOW()
        AND (a.ends_at IS NULL OR a.ends_at > NOW())
        AND ${CUSTOMER_SPEND_ACCESS_SQL}
      ORDER BY a.version DESC
      LIMIT 1`,
    [customerId, partnerId, agreementId]
  );
  const agreement = rows[0];
  if (!agreement) {
    if (strict) throw new AppError('This restaurant is not currently eligible for OxSteed Credit', 403, 'credit_partner_not_eligible');
    return null;
  }
  const settlementCurrency = assertSupportedCreditCurrency(agreement.settlement_currency_code);
  if (agreement.restaurant_currency_code && normalizeCurrency(agreement.restaurant_currency_code) !== settlementCurrency) {
    throw new AppError('The partner settlement currency does not match the restaurant currency', 409, 'credit_partner_currency_mismatch');
  }
  const normalizedOrderType = normalizeString(orderType, 40)?.toLowerCase();
  const allowedOrderTypes = normalizeList(agreement.allowed_order_types);
  const allowedCategories = normalizeList(agreement.allowed_categories);
  const allowedMenuItems = (agreement.allowed_menu_item_ids || []).map((value) => String(value));
  if (normalizedOrderType && allowedOrderTypes.length && !allowedOrderTypes.includes(normalizedOrderType)) {
    throw new AppError('This order type is not covered by the OxSteed Credit agreement', 403, 'credit_order_type_not_eligible');
  }
  const requestedCategories = (Array.isArray(categories) && categories.length ? categories : [category])
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  if (allowedCategories.length && requestedCategories.some((value) => !allowedCategories.includes(value))) {
    throw new AppError('This menu category is not covered by the OxSteed Credit agreement', 403, 'credit_category_not_eligible');
  }
  const requestedMenuItems = (Array.isArray(menuItemIds) && menuItemIds.length ? menuItemIds : [menuItemId]).filter(Boolean).map(String);
  if (allowedMenuItems.length && requestedMenuItems.some((itemId) => !allowedMenuItems.includes(itemId))) {
    throw new AppError('This menu item is not covered by the OxSteed Credit agreement', 403, 'credit_menu_item_not_eligible');
  }
  if (!matchesGeography(agreement.geography, { city, state, postalCode, country })) {
    throw new AppError('This location is not covered by the OxSteed Credit agreement', 403, 'credit_location_not_eligible');
  }

  const effectiveTransactionLimit = [agreement.max_transaction_cents, agreement.entitlement_max_transaction_cents]
    .filter((value) => value !== null && value !== undefined)
    .map(Number)
    .reduce((min, value) => Math.min(min, value), Number.MAX_SAFE_INTEGER);
  if (amountCents && effectiveTransactionLimit < Number.MAX_SAFE_INTEGER && amountCents > effectiveTransactionLimit) {
    throw new AppError('Credit transaction exceeds this restaurant agreement limit', 409, 'credit_agreement_transaction_limit', {
      maxTransactionCents: String(effectiveTransactionLimit),
    });
  }

  const dailyLimit = [agreement.daily_customer_limit_cents, agreement.entitlement_daily_limit_cents]
    .filter((value) => value !== null && value !== undefined)
    .map(Number)
    .reduce((min, value) => Math.min(min, value), Number.MAX_SAFE_INTEGER);
  const lifetimeLimit = agreement.lifetime_customer_limit_cents === null || agreement.lifetime_customer_limit_cents === undefined
    ? Number.MAX_SAFE_INTEGER
    : Number(agreement.lifetime_customer_limit_cents);
  if (amountCents && (dailyLimit < Number.MAX_SAFE_INTEGER || lifetimeLimit < Number.MAX_SAFE_INTEGER)) {
    const { rows: usageRows } = await client.query(
      `WITH purchase_usage AS (
         SELECT
           COALESCE(SUM(t.amount_cents) FILTER (WHERE t.created_at >= date_trunc('day', NOW())), 0) AS daily_purchase_cents,
           COALESCE(SUM(t.amount_cents), 0) AS lifetime_purchase_cents
           FROM oxsteed_credit_transactions t
           JOIN oxsteed_credit_accounts ca ON ca.id = t.debit_account_id
          WHERE t.transaction_type = 'purchase'
            AND t.status = 'posted'
            AND t.partner_id = $1
            AND t.agreement_id = $2
            AND ca.customer_id = $3
       ), active_hold_usage AS (
         SELECT COALESCE(SUM(h.amount_cents), 0) AS active_hold_cents
           FROM oxsteed_credit_holds h
          WHERE h.customer_id = $3
            AND h.partner_id = $1
            AND h.agreement_id = $2
            AND h.status = 'active'
            AND ($4::uuid IS NULL OR h.id <> $4::uuid)
       )
       SELECT purchase_usage.daily_purchase_cents + active_hold_usage.active_hold_cents AS daily_cents,
              purchase_usage.lifetime_purchase_cents + active_hold_usage.active_hold_cents AS lifetime_cents
         FROM purchase_usage CROSS JOIN active_hold_usage`,
      [partnerId, agreement.id, customerId, excludeHoldId]
    );
    const dailyCents = Number(usageRows[0]?.daily_cents || 0);
    const lifetimeCents = Number(usageRows[0]?.lifetime_cents || 0);
    if (dailyLimit < Number.MAX_SAFE_INTEGER && dailyCents + amountCents > dailyLimit) {
      throw new AppError('Daily OxSteed Credit limit reached for this restaurant', 409, 'credit_daily_limit_reached');
    }
    if (lifetimeLimit < Number.MAX_SAFE_INTEGER && lifetimeCents + amountCents > lifetimeLimit) {
      throw new AppError('Lifetime OxSteed Credit limit reached for this restaurant', 409, 'credit_lifetime_limit_reached');
    }
  }
  return agreement;
}

async function listEligiblePartners({ customerId, currencyCode = CREDIT_CURRENCY, city, state, postalCode, country, orderType } = {}) {
  const currency = assertSupportedCreditCurrency(currencyCode);
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (p.id)
            p.id AS partner_id, p.restaurant_id, p.settlement_currency_code,
            fr.display_name AS restaurant_name, fr.logo_url, fr.address_city, fr.address_state,
            fr.currency_code AS restaurant_currency_code,
            a.id AS agreement_id, a.version, a.customer_terms, a.allowed_order_types,
            a.allowed_categories, a.geography, a.requires_customer_entitlement,
            CASE
              WHEN a.max_transaction_cents IS NULL THEN e.max_transaction_cents
              WHEN e.max_transaction_cents IS NULL THEN a.max_transaction_cents
              ELSE LEAST(a.max_transaction_cents, e.max_transaction_cents)
            END AS effective_max_transaction_cents,
            CASE
              WHEN a.daily_customer_limit_cents IS NULL THEN e.daily_limit_cents
              WHEN e.daily_limit_cents IS NULL THEN a.daily_customer_limit_cents
              ELSE LEAST(a.daily_customer_limit_cents, e.daily_limit_cents)
            END AS effective_daily_customer_limit_cents,
            a.lifetime_customer_limit_cents,
            e.id AS entitlement_id, e.max_transaction_cents AS entitlement_max_transaction_cents,
            e.daily_limit_cents AS entitlement_daily_limit_cents
       FROM oxsteed_credit_partners p
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
       JOIN oxsteed_credit_partner_agreements a ON a.partner_id = p.id
       LEFT JOIN oxsteed_credit_customer_entitlements e
         ON e.agreement_id = a.id AND e.customer_id = $1
      WHERE p.status = 'active' AND fr.status = 'active'
        AND EXISTS (
          SELECT 1 FROM users customer
           WHERE customer.id = $1 AND customer.role = 'customer'
        )
        AND EXISTS (
          SELECT 1 FROM feature_flags ff
           WHERE ff.key = 'oxsteed_credit_enabled' AND ff.is_enabled = TRUE
        )
        AND EXISTS (
          SELECT 1 FROM oxsteed_credit_accounts ca
           WHERE ca.account_type = 'customer_wallet'
             AND ca.customer_id = $1
             AND ca.currency_code = $2
             AND ca.status = 'active'
        )
        AND p.settlement_currency_code = $2
        AND (fr.currency_code IS NULL OR UPPER(fr.currency_code) = UPPER(p.settlement_currency_code))
        AND a.status = 'active' AND a.starts_at <= NOW()
        AND (a.ends_at IS NULL OR a.ends_at > NOW())
        AND ${CUSTOMER_SPEND_ACCESS_SQL}
        AND ($3::text IS NULL OR cardinality(a.allowed_order_types) = 0 OR $3 = ANY(a.allowed_order_types))
      ORDER BY p.id, a.version DESC`,
    [customerId, currency, normalizeString(orderType, 40)?.toLowerCase() || null]
  );
  const hasLocationInput = [city, state, postalCode, country].some((value) => normalizeString(value, 120));
  return rows.filter((row) => (!row.restaurant_currency_code || normalizeCurrency(row.restaurant_currency_code) === currency)
    && (!hasLocationInput || matchesGeography(row.geography, { city, state, postalCode, country }))).map((row) => ({
    partnerId: String(row.partner_id),
    restaurantId: String(row.restaurant_id),
    restaurantName: row.restaurant_name,
    logoUrl: row.logo_url || null,
    city: row.address_city || null,
    state: row.address_state || null,
    currencyCode: normalizeCurrency(row.settlement_currency_code),
    agreementId: row.agreement_id,
    agreementVersion: Number(row.version),
    requiresCustomerEntitlement: row.requires_customer_entitlement === true,
    customerTerms: row.customer_terms || null,
    allowedOrderTypes: row.allowed_order_types || [],
    allowedCategories: row.allowed_categories || [],
    geography: formatGeography(row.geography),
    maxTransactionCents: row.effective_max_transaction_cents === null ? null : Number(row.effective_max_transaction_cents),
    dailyCustomerLimitCents: row.effective_daily_customer_limit_cents === null ? null : Number(row.effective_daily_customer_limit_cents),
    lifetimeCustomerLimitCents: row.lifetime_customer_limit_cents === null ? null : Number(row.lifetime_customer_limit_cents),
    hasCustomerEntitlement: Boolean(row.entitlement_id),
  }));
}

async function getCustomerCreditAccount(customerId, currencyCode = CREDIT_CURRENCY) {
  const currency = assertSupportedCreditCurrency(currencyCode);
  return withTransaction(pool, async (client) => {
    const account = await ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode: currency });
    return formatAccount(account);
  }, 'credit_get_customer_account');
}

async function listCustomerCreditAccounts(customerId) {
  const { rows } = await pool.query(
    `SELECT a.*
       FROM oxsteed_credit_accounts a
       JOIN users owner ON owner.id = a.customer_id AND owner.role = 'customer'
      WHERE a.account_type = 'customer_wallet' AND a.customer_id = $1
      ORDER BY currency_code ASC`,
    [customerId]
  );
  return rows.map(formatAccount);
}

async function loadCustomerCredit({ customerId, amountCents, currencyCode = CREDIT_CURRENCY, idempotencyKey, actorUserId, reason, referenceType = 'admin_load', referenceId, correlationId, metadata = {} }) {
  const amount = parseAmountCents(amountCents);
  const currency = assertSupportedCreditCurrency(currencyCode);
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 160);
  if (!normalizedIdempotencyKey) throw new AppError('Idempotency-Key is required for credit transactions', 400, 'credit_idempotency_key_required');
  return withTransaction(pool, async (client) => {
    const { rows: existingRows } = await client.query(
      `SELECT t.*, customer_account.customer_id AS customer_account_customer_id
         FROM oxsteed_credit_transactions t
         JOIN oxsteed_credit_accounts customer_account ON customer_account.id = t.credit_account_id
        WHERE t.idempotency_key = $1
        FOR UPDATE`,
      [normalizedIdempotencyKey]
    );
    const existing = existingRows[0];
    if (existing) {
      if (String(existing.customer_account_customer_id) !== String(customerId)) {
        throw new AppError('Credit idempotency key was already used for a different transaction', 409, 'credit_idempotency_conflict');
      }
      return postJournalTransaction(client, {
        transactionType: 'load',
        debitAccountId: existing.debit_account_id,
        creditAccountId: existing.credit_account_id,
        customerId,
        amountCents: amount,
        currencyCode: currency,
        idempotencyKey: normalizedIdempotencyKey,
        actorType: 'admin',
        actorUserId,
        reason,
        referenceType,
        referenceId,
        correlationId,
        metadata,
        existingTransaction: existing,
      });
    }
    await assertCreditRailEnabled(client);
    const customerAccount = await ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode: currency });
    const treasuryAccount = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: currency });
    await assertIssuanceCapacity(client, amount, currency, customerId);
    return postJournalTransaction(client, {
      transactionType: 'load',
      debitAccountId: treasuryAccount.id,
      creditAccountId: customerAccount.id,
      customerId,
      amountCents: amount,
      currencyCode: currency,
      idempotencyKey,
      actorType: 'admin',
      actorUserId,
      reason,
      referenceType,
      referenceId,
      correlationId,
      metadata,
    });
  }, 'credit_load_customer');
}

async function purchaseWithCreditInTransaction(client, { customerId, partnerId, agreementId = null, amountCents, currencyCode = null, idempotencyKey, actorUserId, orderType, category, categories, menuItemId, menuItemIds, city, state, postalCode, country, excludeHoldId = null, referenceType = 'food_order', referenceId, correlationId, description, actorType, metadata = {} }) {
  const amount = parseAmountCents(amountCents);
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 160);
  if (!normalizedIdempotencyKey) throw new AppError('Idempotency-Key is required for credit transactions', 400, 'credit_idempotency_key_required');
  const existing = await findExistingPurchaseForReplay(client, { customerId, partnerId, idempotencyKey: normalizedIdempotencyKey });
  if (existing) {
    const settlementCurrency = assertSupportedCreditCurrency(existing.currency_code);
    if (currencyCode !== null && assertSupportedCreditCurrency(currencyCode) !== settlementCurrency) {
      throw new AppError('Credit currency does not match the committed purchase', 409, 'credit_currency_mismatch');
    }
    if (agreementId !== null && agreementId !== undefined && String(agreementId) !== String(existing.agreement_id)) {
      throw new AppError('Credit idempotency key was already used for a different purchase', 409, 'credit_idempotency_conflict');
    }
    const requestedReferenceType = normalizeString(referenceType, 80);
    if (requestedReferenceType && existing.reference_type && requestedReferenceType !== existing.reference_type) {
      throw new AppError('Credit idempotency key was already used for a different purchase', 409, 'credit_idempotency_conflict');
    }
    if (referenceId !== null && referenceId !== undefined && String(referenceId) !== String(existing.reference_id)) {
      throw new AppError('Credit idempotency key was already used for a different purchase', 409, 'credit_idempotency_conflict');
    }
    return postJournalTransaction(client, {
      transactionType: 'purchase',
      debitAccountId: existing.debit_account_id,
      creditAccountId: existing.credit_account_id,
      partnerId,
      agreementId: existing.agreement_id,
      customerId,
      amountCents: amount,
      currencyCode: settlementCurrency,
      idempotencyKey: normalizedIdempotencyKey,
      actorType: actorType || (actorUserId ? 'user' : 'system'),
      actorUserId,
      referenceType: existing.reference_type || referenceType,
      referenceId: existing.reference_id || referenceId,
      correlationId,
      description,
      metadata,
      existingTransaction: existing,
    });
  }
  await assertCreditRailEnabled(client);
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`oxsteed-credit:${customerId}:${partnerId}`]);
  const agreement = await findSpendAgreement(client, { customerId, partnerId, agreementId, orderType, category, categories, menuItemId, menuItemIds, city, state, postalCode, country, amountCents: amount, excludeHoldId });
  const settlementCurrency = assertSupportedCreditCurrency(agreement.settlement_currency_code);
  if (currencyCode !== null && assertSupportedCreditCurrency(currencyCode) !== settlementCurrency) {
    throw new AppError('Credit currency does not match the partner agreement', 409, 'credit_currency_mismatch');
  }
  const customerAccount = await ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode: settlementCurrency });
  const partnerAccount = await ensureAccount(client, { accountType: 'partner_payable', partnerId, currencyCode: settlementCurrency });
  return postJournalTransaction(client, {
    transactionType: 'purchase',
    debitAccountId: customerAccount.id,
    creditAccountId: partnerAccount.id,
    partnerId,
    agreementId: agreement.id,
    customerId,
    amountCents: amount,
    currencyCode: settlementCurrency,
    idempotencyKey: normalizedIdempotencyKey,
    actorType: actorType || (actorUserId ? 'user' : 'system'),
    actorUserId,
    referenceType,
    referenceId,
    correlationId,
    description,
    metadata: {
      ...normalizeMetadata(metadata),
      orderType: normalizeString(orderType, 40),
      categories: requestedCategoriesForMetadata(category, categories),
      menuItemIds: requestedMenuItemsForMetadata(menuItemId, menuItemIds),
    },
  });
}

function requestedCategoriesForMetadata(category, categories) {
  const values = Array.isArray(categories) && categories.length ? categories : [category];
  return [...new Set(values.filter(Boolean).map((value) => normalizeString(String(value), 120)?.toLowerCase()).filter(Boolean))];
}

function requestedMenuItemsForMetadata(menuItemId, menuItemIds) {
  const values = Array.isArray(menuItemIds) && menuItemIds.length ? menuItemIds : [menuItemId];
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

async function purchaseWithCredit(args) {
  return withTransaction(pool, (client) => purchaseWithCreditInTransaction(client, args), 'credit_purchase');
}

async function transferCredit({ senderCustomerId, recipientCustomerId, amountCents, currencyCode = CREDIT_CURRENCY, idempotencyKey, actorUserId, referenceType = 'customer_transfer', referenceId, correlationId, description, metadata = {} }) {
  if (!CUSTOMER_TRANSFERS_ENABLED) throw new AppError('Customer-to-customer OxSteed Credit transfers are disabled', 403, 'credit_transfers_disabled');
  if (senderCustomerId === recipientCustomerId) throw new AppError('Cannot transfer credit to the same customer', 400, 'credit_transfer_same_customer');
  const amount = parseAmountCents(amountCents);
  const currency = assertSupportedCreditCurrency(currencyCode);
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 160);
  if (!normalizedIdempotencyKey) throw new AppError('Idempotency-Key is required for credit transactions', 400, 'credit_idempotency_key_required');
  return withTransaction(pool, async (client) => {
    const existing = await findExistingTransferForReplay(client, {
      senderCustomerId,
      recipientCustomerId,
      idempotencyKey: normalizedIdempotencyKey,
    });
    if (existing) {
      return postJournalTransaction(client, {
        transactionType: 'transfer',
        debitAccountId: existing.debit_account_id,
        creditAccountId: existing.credit_account_id,
        customerId: senderCustomerId,
        amountCents: amount,
        currencyCode: currency,
        idempotencyKey: normalizedIdempotencyKey,
        actorType: 'user',
        actorUserId,
        referenceType,
        referenceId,
        correlationId,
        description,
        metadata: { ...normalizeMetadata(metadata), recipientCustomerId },
        existingTransaction: existing,
      });
    }
    await assertCreditRailEnabled(client);
    const customerLockKeys = [String(senderCustomerId), String(recipientCustomerId)].sort();
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`oxsteed-credit-transfer:${customerLockKeys.join(':')}`]);
    const { rows: recipientRows } = await client.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'customer' AND is_active = TRUE LIMIT 1`,
      [recipientCustomerId]
    );
    if (!recipientRows[0]) throw new AppError('Recipient customer was not found', 404, 'credit_recipient_not_found');
    const sender = await ensureAccount(client, { accountType: 'customer_wallet', customerId: senderCustomerId, currencyCode: currency });
    const recipient = await ensureAccount(client, { accountType: 'customer_wallet', customerId: recipientCustomerId, currencyCode: currency });
    return postJournalTransaction(client, {
      transactionType: 'transfer',
      debitAccountId: sender.id,
      creditAccountId: recipient.id,
      customerId: senderCustomerId,
      amountCents: amount,
      currencyCode: currency,
      idempotencyKey: normalizedIdempotencyKey,
      actorType: 'user',
      actorUserId,
      referenceType,
      referenceId,
      correlationId,
      description,
      metadata: { ...normalizeMetadata(metadata), recipientCustomerId },
    });
  }, 'credit_transfer');
}

async function adjustCustomerCredit({ customerId, amountCents, currencyCode = CREDIT_CURRENCY, direction = 'credit', idempotencyKey, actorUserId, reason, referenceType = 'admin_adjustment', referenceId, correlationId, metadata = {} }) {
  const amount = parseAmountCents(amountCents);
  const currency = assertSupportedCreditCurrency(currencyCode);
  if (!normalizeString(idempotencyKey, 160)) throw new AppError('Idempotency-Key is required for credit adjustments', 400, 'credit_idempotency_key_required');
  if (!['credit', 'debit'].includes(direction)) throw new AppError('Adjustment direction must be credit or debit', 400, 'credit_adjustment_direction_invalid');
  if (!normalizeString(reason, 2)) throw new AppError('A reason is required for credit adjustments', 400, 'credit_adjustment_reason_required');
  if (direction === 'credit' && !normalizeString(referenceId, 160)) throw new AppError('A funding reference is required for positive administrative credit adjustments', 400, 'credit_funding_reference_required');
  return withTransaction(pool, async (client) => {
    const customerAccount = await ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode: currency });
    const treasuryAccount = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: currency });
    const existing = await getExistingTransaction(client, normalizeString(idempotencyKey, 160));
    if (!existing && direction === 'credit') await assertIssuanceCapacity(client, amount, currency, customerId);
    return postJournalTransaction(client, {
      transactionType: 'adjustment',
      debitAccountId: direction === 'credit' ? treasuryAccount.id : customerAccount.id,
      creditAccountId: direction === 'credit' ? customerAccount.id : treasuryAccount.id,
      customerId,
      amountCents: amount,
      currencyCode: currency,
      idempotencyKey,
      actorType: 'admin',
      actorUserId,
      reason,
      referenceType,
      referenceId,
      correlationId,
      description: direction === 'credit' ? 'OxSteed Credit administrative grant' : 'OxSteed Credit administrative clawback',
      metadata: { ...normalizeMetadata(metadata), direction },
    });
  }, 'credit_adjust_customer');
}

async function updateCustomerCreditAccountStatus({ customerId, status, currencyCode = CREDIT_CURRENCY, actorUserId, reason }) {
  const normalizedStatus = normalizeString(status, 20);
  const currency = assertSupportedCreditCurrency(currencyCode);
  if (!['active', 'suspended', 'closed'].includes(normalizedStatus)) throw new AppError('Invalid credit account status', 400, 'credit_account_status_invalid');
  if (!normalizeString(reason, 2)) throw new AppError('A reason is required when changing a credit account status', 400, 'credit_account_status_reason_required');
  return withTransaction(pool, async (client) => {
    const account = await findCustomerAccount(client, customerId, currency, true);
    if (!account) throw new AppError('Customer credit account was not found', 404, 'credit_account_not_found');
    if (account.status === normalizedStatus) return { account: formatAccount(account), replayed: true };
    if (normalizedStatus === 'closed' && (Number(account.balance_cents || 0) !== 0 || Number(account.reserved_cents || 0) !== 0)) {
      throw new AppError('A credit account must have zero balance and no holds before it can be closed', 409, 'credit_account_close_not_allowed');
    }
    const { rows } = await client.query(`UPDATE oxsteed_credit_accounts SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`, [normalizedStatus, account.id]);
    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, resource_type, resource_id, reason, before_state, after_state)
       VALUES ('credit.customer_account.status_changed', $1, $2, 'credit_account', $3, $4, $5::jsonb, $6::jsonb)`,
      [actorUserId || null, customerId, String(account.id), normalizeString(reason, 1000), JSON.stringify({ status: account.status }), JSON.stringify({ status: normalizedStatus })]
    );
    return { account: formatAccount(rows[0]), replayed: false };
  }, 'credit_update_customer_status');
}

async function createCreditHold({ customerId, partnerId, amountCents, currencyCode = null, idempotencyKey, actorUserId, orderType, category, menuItemId, city, state, postalCode, country, purpose, referenceType, referenceId, correlationId, expiresAt, metadata = {} }) {
  const amount = parseAmountCents(amountCents);
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 160);
  if (!normalizedIdempotencyKey) throw new AppError('Idempotency-Key is required for credit holds', 400, 'credit_idempotency_key_required');
  const requestedExpiry = resolveHoldExpiry(expiresAt);
  return withTransaction(pool, async (client) => {
    const existing = await findExistingCreditHoldForReplay(client, { customerId, partnerId, idempotencyKey: normalizedIdempotencyKey });
    if (existing) {
      const settlementCurrency = assertSupportedCreditCurrency(existing.currency_code);
      if (currencyCode !== null && assertSupportedCreditCurrency(currencyCode) !== settlementCurrency) {
        throw new AppError('Credit currency does not match the committed hold', 409, 'credit_currency_mismatch');
      }
      assertHoldIdempotencyReplayMatches(existing, {
        amount_cents: amount,
        partner_id: partnerId,
        agreement_id: existing.agreement_id,
        currency_code: settlementCurrency,
        purpose: normalizeString(purpose, 100),
        reference_type: normalizeString(referenceType, 80),
        reference_id: normalizeString(referenceId, 160),
      });
      return { hold: formatHold(existing), replayed: true };
    }
    await assertCreditRailEnabled(client);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`oxsteed-credit:${customerId}:${partnerId}`]);
    const agreement = await findSpendAgreement(client, { customerId, partnerId, orderType, category, menuItemId, city, state, postalCode, country, amountCents: amount });
    const settlementCurrency = assertSupportedCreditCurrency(agreement.settlement_currency_code);
    if (currencyCode !== null && assertSupportedCreditCurrency(currencyCode) !== settlementCurrency) {
      throw new AppError('Credit currency does not match the partner agreement', 409, 'credit_currency_mismatch');
    }
    const account = await ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode: settlementCurrency });
    const { rows: existingRows } = await client.query(
      `SELECT * FROM oxsteed_credit_holds WHERE account_id = $1 AND idempotency_key = $2 FOR UPDATE`,
      [account.id, normalizedIdempotencyKey]
    );
    if (existingRows[0]) {
      assertHoldIdempotencyReplayMatches(existingRows[0], {
        amount_cents: amount,
        partner_id: partnerId,
        agreement_id: agreement.id,
        currency_code: settlementCurrency,
        purpose: normalizeString(purpose, 100),
        reference_type: normalizeString(referenceType, 80),
        reference_id: normalizeString(referenceId, 160),
      });
      return { hold: formatHold(existingRows[0]), replayed: true };
    }
    if (account.status !== 'active') {
      throw new AppError('Credit account is not active', 409, 'credit_account_inactive');
    }
    const available = Number(account.balance_cents || 0) - Number(account.reserved_cents || 0);
    if (amount > available) throw new AppError('Insufficient available OxSteed Credit', 409, 'credit_insufficient_funds');
    const { rows: holdRows } = await client.query(
      `INSERT INTO oxsteed_credit_holds
         (account_id, customer_id, partner_id, agreement_id, amount_cents, currency_code, purpose,
          reference_type, reference_id, idempotency_key, correlation_id, created_by, metadata, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
       RETURNING *`,
      [account.id, customerId, partnerId, agreement.id, amount, settlementCurrency, normalizeString(purpose, 100), normalizeString(referenceType, 80), normalizeString(referenceId, 160), normalizedIdempotencyKey, normalizeString(correlationId, 160), actorUserId || null, JSON.stringify(normalizeMetadata(metadata)), requestedExpiry]
    );
    await client.query(
      `UPDATE oxsteed_credit_accounts SET reserved_cents = reserved_cents + $1, updated_at = NOW() WHERE id = $2`,
      [amount, account.id]
    );
    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id, reason, correlation_id, after_state)
       VALUES ('credit.hold.created', $1, $2, $3, 'credit_hold', $4, $5, $6, $7::jsonb)`,
      [actorUserId || null, customerId, partnerId, String(holdRows[0].id), normalizeString(purpose, 100), normalizeString(correlationId, 160), JSON.stringify({ amountCents: amount, expiresAt: requestedExpiry.toISOString() })]
    );
    return { hold: formatHold(holdRows[0]), replayed: false };
  }, 'credit_create_hold');
}

function formatHold(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    customerId: row.customer_id,
    partnerId: String(row.partner_id),
    agreementId: row.agreement_id,
    amountCents: Number(row.amount_cents),
    currencyCode: normalizeCurrency(row.currency_code),
    status: row.status,
    purpose: row.purpose || null,
    referenceType: row.reference_type || null,
    referenceId: row.reference_id || null,
    idempotencyKey: row.idempotency_key,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    capturedAt: row.captured_at || null,
    releasedAt: row.released_at || null,
  };
}

async function releaseCreditHold({ customerId, holdId, actorUserId, reason, correlationId }) {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(`SELECT * FROM oxsteed_credit_holds WHERE id = $1 AND customer_id = $2 FOR UPDATE`, [holdId, customerId]);
    const hold = rows[0];
    if (!hold) throw new AppError('Credit hold not found', 404, 'credit_hold_not_found');
    if (hold.status === 'released' || hold.status === 'expired') return { hold: formatHold(hold), replayed: true };
    if (hold.status !== 'active') throw new AppError('Credit hold cannot be released', 409, 'credit_hold_state_invalid');
    await client.query(`UPDATE oxsteed_credit_accounts SET reserved_cents = GREATEST(0, reserved_cents - $1), updated_at = NOW() WHERE id = $2`, [hold.amount_cents, hold.account_id]);
    const { rows: updatedRows } = await client.query(`UPDATE oxsteed_credit_holds SET status = 'released', released_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`, [hold.id]);
    await client.query(`INSERT INTO oxsteed_credit_audit_events (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id, reason, correlation_id) VALUES ('credit.hold.released', $1, $2, $3, 'credit_hold', $4, $5, $6)`, [actorUserId || null, customerId, hold.partner_id, String(hold.id), normalizeString(reason, 500), normalizeString(correlationId, 160)]);
    return { hold: formatHold(updatedRows[0]), replayed: false };
  }, 'credit_release_hold');
}

async function captureCreditHold({ holdId, amountCents, currencyCode = null, idempotencyKey, actorUserId, actorType = 'admin', orderType, category, categories, menuItemId, menuItemIds, city, state, postalCode, country, referenceType, referenceId, correlationId, description, reason, metadata = {} }) {
  if (!normalizeString(idempotencyKey, 160)) throw new AppError('Idempotency-Key is required for credit hold capture', 400, 'credit_idempotency_key_required');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT h.*, a.currency_code AS account_currency_code
         FROM oxsteed_credit_holds h
         JOIN oxsteed_credit_accounts a ON a.id = h.account_id
        WHERE h.id = $1
        FOR UPDATE`,
      [holdId]
    );
    const hold = rows[0];
    if (!hold) throw new AppError('Credit hold not found', 404, 'credit_hold_not_found');
    if (currencyCode !== null && assertSupportedCreditCurrency(currencyCode) !== assertSupportedCreditCurrency(hold.currency_code)) {
      throw new AppError('Credit currency does not match the hold', 409, 'credit_currency_mismatch');
    }
    const captureKey = normalizeString(idempotencyKey, 160);
    if (hold.capture_idempotency_key && hold.capture_idempotency_key !== captureKey) {
      throw new AppError('Credit hold capture already used a different idempotency key', 409, 'credit_hold_capture_idempotency_conflict');
    }
    if (hold.status === 'captured') {
      const existing = hold.captured_transaction_id
        ? await getExistingTransactionById(client, hold.captured_transaction_id)
        : null;
      if (!existing) throw new AppError('Captured credit hold is missing its purchase transaction', 500, 'credit_hold_capture_incomplete');
      return { hold: formatHold(hold), transaction: { ...formatTransaction(existing, await loadAccountEntries(client, existing.id)), replayed: true }, replayed: true };
    }
    if (hold.status !== 'active') throw new AppError('Credit hold cannot be captured', 409, 'credit_hold_state_invalid');
    if (new Date(hold.expires_at) <= new Date()) {
      await client.query(`UPDATE oxsteed_credit_accounts SET reserved_cents = GREATEST(0, reserved_cents - $1), updated_at = NOW() WHERE id = $2`, [hold.amount_cents, hold.account_id]);
      const { rows: expiredRows } = await client.query(
        `UPDATE oxsteed_credit_holds
            SET status = 'expired', released_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'active'
          RETURNING *`,
        [hold.id]
      );
      await client.query(
        `INSERT INTO oxsteed_credit_audit_events
           (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id, reason, correlation_id, after_state)
         VALUES ('credit.hold.expired', $1, $2, $3, 'credit_hold', $4, $5, $6, $7::jsonb)`,
        [actorUserId || null, hold.customer_id, hold.partner_id, String(hold.id), normalizeString(reason, 500) || 'Hold expired before capture', normalizeString(correlationId, 160), JSON.stringify({ amountCents: Number(hold.amount_cents) })]
      );
      return { hold: formatHold(expiredRows[0] || { ...hold, status: 'expired' }), expired: true, replayed: false };
    }
    const requestedAmount = amountCents === undefined || amountCents === null ? Number(hold.amount_cents) : parseAmountCents(amountCents);
    if (requestedAmount !== Number(hold.amount_cents)) throw new AppError('Credit hold capture amount must match the reserved amount', 409, 'credit_hold_amount_mismatch');
    const { rows: accountRows } = await client.query(`SELECT * FROM oxsteed_credit_accounts WHERE id = $1 FOR UPDATE`, [hold.account_id]);
    const account = accountRows[0];
    if (!account || Number(account.reserved_cents || 0) < requestedAmount) throw new AppError('Credit hold reservation is inconsistent', 409, 'credit_hold_reservation_invalid');
    await client.query(`UPDATE oxsteed_credit_accounts SET reserved_cents = reserved_cents - $1, updated_at = NOW() WHERE id = $2`, [requestedAmount, hold.account_id]);
    const transactionResult = await purchaseWithCreditInTransaction(client, {
      customerId: hold.customer_id,
      partnerId: hold.partner_id,
      agreementId: hold.agreement_id,
      amountCents: requestedAmount,
      currencyCode: hold.currency_code,
      idempotencyKey: captureKey,
      actorUserId,
      actorType,
      orderType,
      category,
      categories,
      menuItemId,
      menuItemIds,
      city,
      state,
      postalCode,
      country,
      excludeHoldId: hold.id,
      referenceType: referenceType || hold.reference_type || 'credit_hold',
      referenceId: referenceId || hold.reference_id || String(hold.id),
      correlationId,
      description: description || hold.purpose || 'OxSteed Credit hold capture',
      reason,
      metadata: { ...normalizeMetadata(hold.metadata), ...normalizeMetadata(metadata), capturedHoldId: String(hold.id) },
    });
    const { rows: capturedRows } = await client.query(
      `UPDATE oxsteed_credit_holds
          SET status = 'captured', capture_idempotency_key = $1, captured_transaction_id = $2,
              captured_at = NOW(), updated_at = NOW()
        WHERE id = $3 AND status = 'active'
        RETURNING *`,
      [captureKey, transactionResult.transaction.id, hold.id]
    );
    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id, reason, correlation_id, after_state)
       VALUES ('credit.hold.captured', $1, $2, $3, 'credit_hold', $4, $5, $6, $7::jsonb)`,
      [actorUserId || null, hold.customer_id, hold.partner_id, String(hold.id), normalizeString(reason, 500), normalizeString(correlationId, 160), JSON.stringify({ amountCents: requestedAmount, transactionId: transactionResult.transaction.id })]
    );
    return { hold: formatHold(capturedRows[0]), transaction: transactionResult.transaction, replayed: false };
  }, 'credit_capture_hold');
}

async function getExistingTransactionById(client, transactionId) {
  const { rows } = await client.query(`SELECT * FROM oxsteed_credit_transactions WHERE id = $1 FOR UPDATE`, [transactionId]);
  return rows[0] || null;
}

async function expireCreditHolds({ limit = 100, actorUserId = null } = {}) {
  const batchSize = Math.max(1, Math.min(Number.parseInt(String(limit), 10) || 100, 500));
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT h.*
         FROM oxsteed_credit_holds h
        WHERE h.status = 'active' AND h.expires_at <= NOW()
        ORDER BY h.expires_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [batchSize]
    );
    const expired = [];
    for (const hold of rows) {
      await client.query(`UPDATE oxsteed_credit_accounts SET reserved_cents = GREATEST(0, reserved_cents - $1), updated_at = NOW() WHERE id = $2`, [hold.amount_cents, hold.account_id]);
      const { rows: updatedRows } = await client.query(
        `UPDATE oxsteed_credit_holds SET status = 'expired', released_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'active' RETURNING *`,
        [hold.id]
      );
      if (!updatedRows[0]) continue;
      await client.query(
        `INSERT INTO oxsteed_credit_audit_events
           (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id, reason, after_state)
         VALUES ('credit.hold.expired', $1, $2, $3, 'credit_hold', $4, 'Scheduled hold expiry', $5::jsonb)`,
        [actorUserId, hold.customer_id, hold.partner_id, String(hold.id), JSON.stringify({ amountCents: Number(hold.amount_cents) })]
      );
      expired.push(formatHold(updatedRows[0]));
    }
    return { expired, count: expired.length };
  }, 'credit_expire_holds');
}

async function refundCreditInTransaction(client, { purchaseTransactionId, amountCents, idempotencyKey, actorUserId, actorType = 'admin', reason, correlationId, metadata = {} }) {
  const amount = parseAmountCents(amountCents);
  if (!normalizeString(idempotencyKey, 160)) throw new AppError('Idempotency-Key is required for credit transactions', 400, 'credit_idempotency_key_required');
    const { rows: purchaseRows } = await client.query(
      `SELECT t.*, ca.customer_id
         FROM oxsteed_credit_transactions t
         JOIN oxsteed_credit_accounts ca ON ca.id = t.debit_account_id
        WHERE t.id = $1 AND t.transaction_type = 'purchase' AND t.status = 'posted'
        FOR UPDATE`,
      [purchaseTransactionId]
    );
    const purchase = purchaseRows[0];
    if (!purchase) throw new AppError('Original credit purchase not found', 404, 'credit_purchase_not_found');
    const existing = await getExistingTransaction(client, normalizeString(idempotencyKey, 160));
    if (existing) {
      return postJournalTransaction(client, {
        transactionType: 'refund',
        debitAccountId: purchase.credit_account_id,
        creditAccountId: purchase.debit_account_id,
        partnerId: purchase.partner_id,
        agreementId: purchase.agreement_id,
        customerId: purchase.customer_id,
        amountCents: amount,
        currencyCode: purchase.currency_code,
        idempotencyKey,
        actorType,
        actorUserId,
        referenceType: 'oxsteed_credit_purchase',
        referenceId: String(purchase.id),
        correlationId,
        description: 'OxSteed Credit refund',
        metadata,
      });
    }
    const { rows: refundRows } = await client.query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS refunded_cents
         FROM oxsteed_credit_transactions
        WHERE transaction_type = 'refund' AND status = 'posted'
          AND reference_type = 'oxsteed_credit_purchase' AND reference_id = $1`,
      [String(purchase.id)]
    );
    const refunded = Number(refundRows[0]?.refunded_cents || 0);
    if (refunded + amount > Number(purchase.amount_cents)) throw new AppError('Refund exceeds the original credit purchase', 409, 'credit_refund_exceeds_purchase');
    return postJournalTransaction(client, {
      transactionType: 'refund',
      debitAccountId: purchase.credit_account_id,
      creditAccountId: purchase.debit_account_id,
      partnerId: purchase.partner_id,
      agreementId: purchase.agreement_id,
      customerId: purchase.customer_id,
      amountCents: amount,
      currencyCode: purchase.currency_code,
      idempotencyKey,
      actorType,
      actorUserId,
      reason,
      referenceType: 'oxsteed_credit_purchase',
      referenceId: String(purchase.id),
      correlationId,
      description: 'OxSteed Credit refund',
      metadata,
    });
}

async function refundCredit({ purchaseTransactionId, amountCents, idempotencyKey, actorUserId, reason, correlationId, metadata = {} }) {
  return withTransaction(pool, (client) => refundCreditInTransaction(client, {
    purchaseTransactionId,
    amountCents,
    idempotencyKey,
    actorUserId,
    reason,
    correlationId,
    metadata,
  }), 'credit_refund');
}

async function refundCreditForReferenceInTransaction(client, { referenceType, referenceId, amountCents, idempotencyKey, actorUserId, actorType = 'system', reason, correlationId, metadata = {} }) {
  const { rows } = await client.query(
    `SELECT id
       FROM oxsteed_credit_transactions
      WHERE transaction_type = 'purchase' AND status = 'posted'
        AND reference_type = $1 AND reference_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE`,
    [normalizeString(referenceType, 80), normalizeString(referenceId, 160)]
  );
  if (!rows[0]) throw new AppError('Original credit purchase not found for this reference', 404, 'credit_purchase_not_found');
  return refundCreditInTransaction(client, {
    purchaseTransactionId: rows[0].id,
    amountCents,
    idempotencyKey,
    actorUserId,
    actorType,
    reason,
    correlationId,
    metadata,
  });
}

async function listCustomerCreditTransactions(customerId, { limit = 25, offset = 0, currencyCode = CREDIT_CURRENCY } = {}) {
  const pageSize = parsePageSize(limit);
  const pageOffset = parseOffset(offset);
  const currency = assertSupportedCreditCurrency(currencyCode);
  const { rows } = await pool.query(
    `SELECT t.id, t.transaction_type, t.status, t.amount_cents, t.currency_code,
            t.reference_type, t.reference_id, t.description, t.posted_at, t.created_at,
            CASE WHEN t.debit_account_id = a.id THEN 'debit' ELSE 'credit' END AS direction,
            CASE WHEN t.debit_account_id = a.id THEN pa.partner_id ELSE da.partner_id END AS related_partner_id,
            fr.display_name AS restaurant_name
       FROM oxsteed_credit_transactions t
       JOIN oxsteed_credit_accounts a ON (a.id = t.debit_account_id OR a.id = t.credit_account_id)
       JOIN users owner ON owner.id = a.customer_id AND owner.role = 'customer'
       LEFT JOIN oxsteed_credit_accounts da ON da.id = t.debit_account_id
       LEFT JOIN oxsteed_credit_accounts pa ON pa.id = t.credit_account_id
       LEFT JOIN oxsteed_credit_partners p
         ON p.id = CASE WHEN t.debit_account_id = a.id THEN pa.partner_id ELSE da.partner_id END
       LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
      WHERE t.status = 'posted'
        AND a.account_type = 'customer_wallet' AND a.customer_id = $1
        AND a.currency_code = $4
        AND t.currency_code = $4
      ORDER BY t.created_at DESC
      LIMIT $2 OFFSET $3`,
    [customerId, pageSize, pageOffset, currency]
  );
  return rows.map(formatCustomerCreditTransaction);
}

function formatCustomerCreditTransaction(row) {
  const partnerId = row.related_partner_id === null || row.related_partner_id === undefined
    ? null
    : String(row.related_partner_id);
  const referenceType = row.reference_type || null;
  const referenceId = row.reference_id || null;
  const orderId = ['food_order', 'food_order_refund'].includes(referenceType)
    && /^\d+$/.test(String(referenceId || ''))
    ? String(referenceId)
    : null;
  return {
    id: String(row.id),
    transactionType: row.transaction_type,
    status: row.status,
    amountCents: Number(row.amount_cents || 0),
    currencyCode: normalizeCurrency(row.currency_code),
    direction: row.direction || null,
    partnerId,
    relatedPartnerId: partnerId,
    restaurantName: row.restaurant_name || null,
    description: row.description || null,
    referenceType,
    referenceId,
    orderId,
    postedAt: row.posted_at || row.created_at || null,
    createdAt: row.created_at || null,
  };
}

function formatCustomerStatementTransaction(row) {
  const transaction = formatCustomerCreditTransaction(row);
  delete transaction.relatedPartnerId;
  delete transaction.createdAt;
  return transaction;
}

async function getCustomerCreditStatement(customerId, { from, to, limit = 100, offset = 0, maxRows = 100, currencyCode = CREDIT_CURRENCY } = {}) {
  const period = statementPeriod(from, to);
  const pageSize = parseStatementPageSize(limit, Math.min(Number(maxRows) || 100, MAX_STATEMENT_EXPORT_ROWS));
  const pageOffset = parseOffset(offset);
  const currency = assertSupportedCreditCurrency(currencyCode);
  const { rows } = await pool.query(
    `WITH customer_account AS (
       SELECT a.id, a.currency_code
         FROM oxsteed_credit_accounts a
         JOIN users owner ON owner.id = a.customer_id AND owner.role = 'customer'
        WHERE a.account_type = 'customer_wallet' AND a.customer_id = $1 AND a.currency_code = $6
        LIMIT 1
     ), filtered_transactions AS (
       SELECT t.*, ca.id AS customer_account_id,
              CASE WHEN t.debit_account_id = ca.id THEN 'debit' ELSE 'credit' END AS direction,
              CASE WHEN t.debit_account_id = ca.id THEN credit_account.partner_id ELSE debit_account.partner_id END AS related_partner_id,
              fr.display_name AS restaurant_name
         FROM oxsteed_credit_transactions t
         JOIN customer_account ca ON (ca.id = t.debit_account_id OR ca.id = t.credit_account_id)
         LEFT JOIN oxsteed_credit_accounts debit_account ON debit_account.id = t.debit_account_id
         LEFT JOIN oxsteed_credit_accounts credit_account ON credit_account.id = t.credit_account_id
         LEFT JOIN oxsteed_credit_partners partner
           ON partner.id = CASE WHEN t.debit_account_id = ca.id THEN credit_account.partner_id ELSE debit_account.partner_id END
         LEFT JOIN food_restaurants fr ON fr.id = partner.restaurant_id
        WHERE t.status = 'posted'
          AND t.currency_code = $6
          AND COALESCE(t.posted_at, t.created_at) >= $2::date
          AND COALESCE(t.posted_at, t.created_at) < ($3::date + INTERVAL '1 day')
     ), period_transactions AS (
       SELECT * FROM filtered_transactions
        ORDER BY COALESCE(posted_at, created_at) DESC, id DESC
        LIMIT $4 OFFSET $5
     ), account_balances AS (
       SELECT ca.id,
              COALESCE((
                SELECT e.balance_after_cents
                  FROM oxsteed_credit_transaction_entries e
                  JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
                 WHERE e.account_id = ca.id AND t.status = 'posted' AND t.currency_code = $6
                   AND COALESCE(t.posted_at, t.created_at) < $2::date
                 ORDER BY COALESCE(t.posted_at, t.created_at) DESC, e.id DESC
                 LIMIT 1
              ), 0) AS opening_balance_cents,
              COALESCE((
                SELECT e.balance_after_cents
                  FROM oxsteed_credit_transaction_entries e
                  JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
                 WHERE e.account_id = ca.id AND t.status = 'posted' AND t.currency_code = $6
                   AND COALESCE(t.posted_at, t.created_at) < ($3::date + INTERVAL '1 day')
                 ORDER BY COALESCE(t.posted_at, t.created_at) DESC, e.id DESC
                 LIMIT 1
              ), 0) AS closing_balance_cents
         FROM customer_account ca
     ), totals AS (
       SELECT
         COUNT(*)::integer AS transaction_count,
         COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'credit'), 0) AS total_credits_cents,
         COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'debit'), 0) AS total_debits_cents
         FROM filtered_transactions
     )
     SELECT
       COALESCE((SELECT currency_code FROM customer_account), $6) AS currency_code,
       COALESCE((SELECT id FROM customer_account), NULL) AS account_id,
       (SELECT opening_balance_cents FROM account_balances) AS opening_balance_cents,
       (SELECT closing_balance_cents FROM account_balances) AS closing_balance_cents,
       (SELECT transaction_count FROM totals) AS transaction_count,
       (SELECT total_credits_cents FROM totals) AS total_credits_cents,
       (SELECT total_debits_cents FROM totals) AS total_debits_cents,
       COALESCE((SELECT json_agg(period_transactions ORDER BY COALESCE(posted_at, created_at) DESC, id DESC) FROM period_transactions), '[]'::json) AS transactions`,
    [customerId, period.from, period.to, pageSize, pageOffset, currency]
  );
  const row = rows[0] || {};
  const openingBalanceCents = Number(row.opening_balance_cents || 0);
  const closingBalanceCents = Number(row.closing_balance_cents || 0);
  const totalCreditsCents = Number(row.total_credits_cents || 0);
  const totalDebitsCents = Number(row.total_debits_cents || 0);
  const rawTransactions = Array.isArray(row.transactions) ? row.transactions : [];
  return {
    accountId: row.account_id === null || row.account_id === undefined ? null : String(row.account_id),
    currencyCode: normalizeCurrency(row.currency_code),
    period,
    openingBalanceCents,
    closingBalanceCents,
    totalCreditsCents,
    totalDebitsCents,
    netChangeCents: totalCreditsCents - totalDebitsCents,
    transactionCount: Number(row.transaction_count || 0),
    offset: pageOffset,
    limit: pageSize,
    hasMore: pageOffset + rawTransactions.length < Number(row.transaction_count || 0),
    transactions: rawTransactions.map(formatCustomerStatementTransaction),
  };
}

function csvCell(value) {
  const normalized = value === null || value === undefined ? '' : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
}

function customerCreditStatementCsv(statement) {
  const headers = ['Date', 'Transaction ID', 'Type', 'Description', 'Restaurant', 'Order ID', 'Direction', 'Amount (cents)', 'Currency', 'Reference'];
  const lines = [headers.map(csvCell).join(',')];
  for (const transaction of statement.transactions) {
    lines.push([
      transaction.postedAt,
      transaction.id,
      transaction.transactionType,
      transaction.description,
      transaction.restaurantName,
      transaction.orderId,
      transaction.direction,
      transaction.amountCents,
      transaction.currencyCode,
      transaction.referenceType && transaction.referenceId ? `${transaction.referenceType}:${transaction.referenceId}` : '',
    ].map(csvCell).join(','));
  }
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

async function getCustomerCreditTransaction(customerId, transactionId, currencyCode = CREDIT_CURRENCY) {
  const currency = assertSupportedCreditCurrency(currencyCode);
  const { rows } = await pool.query(
    `SELECT t.id, t.transaction_type, t.status, t.amount_cents, t.currency_code,
            t.reference_type, t.reference_id, t.description, t.posted_at, t.created_at,
            CASE WHEN t.debit_account_id = a.id THEN 'debit' ELSE 'credit' END AS direction,
            CASE WHEN t.debit_account_id = a.id THEN ca.partner_id ELSE da.partner_id END AS related_partner_id,
            fr.display_name AS restaurant_name
       FROM oxsteed_credit_transactions t
       JOIN oxsteed_credit_accounts a ON (a.id = t.debit_account_id OR a.id = t.credit_account_id)
       JOIN users owner ON owner.id = a.customer_id AND owner.role = 'customer'
       LEFT JOIN oxsteed_credit_accounts da ON da.id = t.debit_account_id
       LEFT JOIN oxsteed_credit_accounts ca ON ca.id = t.credit_account_id
       LEFT JOIN oxsteed_credit_partners p ON p.id = CASE WHEN t.debit_account_id = a.id THEN ca.partner_id ELSE da.partner_id END
       LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
      WHERE t.id = $1 AND t.status = 'posted'
        AND a.account_type = 'customer_wallet' AND a.customer_id = $2
        AND a.currency_code = $3
        AND t.currency_code = $3
      LIMIT 1`,
    [transactionId, customerId, currency]
  );
  if (!rows[0]) throw new AppError('Credit transaction not found', 404, 'credit_transaction_not_found');
  return { transaction: formatCustomerCreditTransaction(rows[0]) };
}

function formatDispute(row) {
  return {
    id: String(row.id),
    transactionId: String(row.transaction_id),
    customerId: row.customer_id,
    partnerId: row.partner_id === null || row.partner_id === undefined ? null : String(row.partner_id),
    restaurantName: row.restaurant_name || null,
    amountCents: row.transaction_amount_cents === null || row.transaction_amount_cents === undefined ? null : Number(row.transaction_amount_cents),
    currencyCode: row.transaction_currency_code ? normalizeCurrency(row.transaction_currency_code) : null,
    transactionType: row.transaction_type || null,
    referenceType: row.transaction_reference_type || null,
    referenceId: row.transaction_reference_id || null,
    postedAt: row.transaction_posted_at || null,
    status: row.status,
    reasonCode: row.reason_code,
    description: row.description,
    resolution: row.resolution || null,
    openedBy: row.opened_by || null,
    resolvedBy: row.resolved_by || null,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at || null,
    updatedAt: row.updated_at,
  };
}

async function openCreditDispute({ customerId, transactionId, reasonCode, description, actorUserId }) {
  const normalizedReason = normalizeString(reasonCode, 60);
  const normalizedDescription = normalizeString(description, 4000);
  if (!normalizedReason || !normalizedDescription) throw new AppError('A dispute reason and description are required', 400, 'credit_dispute_details_required');
  return withTransaction(pool, async (client) => {
    const { rows: transactionRows } = await client.query(
      `SELECT t.id, t.partner_id
         FROM oxsteed_credit_transactions t
         JOIN oxsteed_credit_accounts a ON a.id = t.debit_account_id OR a.id = t.credit_account_id
         JOIN users owner ON owner.id = a.customer_id AND owner.role = 'customer'
        WHERE t.id = $1 AND t.status = 'posted'
          AND a.account_type = 'customer_wallet' AND a.customer_id = $2
          AND a.currency_code = t.currency_code
        FOR SHARE`,
      [transactionId, customerId]
    );
    const transaction = transactionRows[0];
    if (!transaction) throw new AppError('Credit transaction not found', 404, 'credit_transaction_not_found');
    const { rows: existingRows } = await client.query(
      `SELECT d.*, fr.display_name AS restaurant_name
         FROM oxsteed_credit_disputes d
         LEFT JOIN oxsteed_credit_partners p ON p.id = d.partner_id
         LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE d.transaction_id = $1 AND d.status IN ('open', 'in_review')
        FOR UPDATE`,
      [transaction.id]
    );
    if (existingRows[0]) return { dispute: formatDispute(existingRows[0]), replayed: true };
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_disputes
         (transaction_id, customer_id, partner_id, reason_code, description, opened_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (transaction_id) WHERE status IN ('open', 'in_review') DO NOTHING
       RETURNING *`,
      [transaction.id, customerId, transaction.partner_id || null, normalizedReason, normalizedDescription, actorUserId || customerId]
    );
    if (!rows[0]) {
      const { rows: concurrentRows } = await client.query(
        `SELECT d.*, fr.display_name AS restaurant_name
           FROM oxsteed_credit_disputes d
           LEFT JOIN oxsteed_credit_partners p ON p.id = d.partner_id
           LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
          WHERE d.transaction_id = $1 AND d.status IN ('open', 'in_review')
          FOR UPDATE`,
        [transaction.id]
      );
      if (!concurrentRows[0]) throw new AppError('Credit dispute could not be opened; please try again', 409, 'credit_dispute_conflict');
      return { dispute: formatDispute(concurrentRows[0]), replayed: true };
    }
    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id, reason, after_state)
       VALUES ('credit.dispute.opened', $1, $2, $3, 'credit_dispute', $4, $5, $6::jsonb)`,
      [actorUserId || customerId, customerId, transaction.partner_id || null, rows[0].id, normalizedReason, JSON.stringify({ transactionId: transaction.id, status: 'open' })]
    );
    return { dispute: formatDispute(rows[0]), replayed: false };
  }, 'credit_open_dispute');
}

const CREDIT_DISPUTE_STATUSES = new Set(['open', 'in_review', 'resolved', 'rejected']);

async function listCreditDisputes({ customerId, status, limit = 100, offset = 0, includePagination = false } = {}) {
  const params = [];
  const filters = [];
  if (customerId) {
    params.push(customerId);
    filters.push(`d.customer_id = $${params.length}`);
  }
  if (status) {
    const normalizedStatus = normalizeString(status, 20);
    if (!CREDIT_DISPUTE_STATUSES.has(normalizedStatus)) throw new AppError('Invalid credit dispute status', 400, 'credit_dispute_status_invalid');
    params.push(normalizedStatus);
    filters.push(`d.status = $${params.length}`);
  }
  const safeLimit = Math.max(1, Math.min(Number.parseInt(String(limit), 10) || 100, 250));
  const parsedOffset = Number.parseInt(String(offset), 10);
  const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1000000) : 0;
  params.push(includePagination ? safeLimit + 1 : safeLimit);
  const limitParam = params.length;
  params.push(safeOffset);
  const offsetParam = params.length;
  const { rows } = await pool.query(
    `SELECT d.*, fr.display_name AS restaurant_name,
            t.amount_cents AS transaction_amount_cents,
            t.currency_code AS transaction_currency_code,
            t.transaction_type,
            t.reference_type AS transaction_reference_type,
            t.reference_id AS transaction_reference_id,
            t.posted_at AS transaction_posted_at
       FROM oxsteed_credit_disputes d
       LEFT JOIN oxsteed_credit_partners p ON p.id = d.partner_id
       LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
       LEFT JOIN oxsteed_credit_transactions t ON t.id = d.transaction_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY d.opened_at DESC, d.id DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  const hasMore = includePagination && rows.length > safeLimit;
  const disputes = rows.slice(0, safeLimit).map(formatDispute);
  if (!includePagination) return disputes;
  return {
    disputes,
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      hasMore,
      nextOffset: hasMore ? safeOffset + safeLimit : null,
    },
  };
}

async function resolveCreditDispute({ disputeId, status, resolution, actorUserId }) {
  const normalizedStatus = normalizeString(status, 20);
  const normalizedResolution = normalizeString(resolution, 4000);
  if (!['in_review', 'resolved', 'rejected'].includes(normalizedStatus)) throw new AppError('Invalid dispute resolution status', 400, 'credit_dispute_status_invalid');
  if (['resolved', 'rejected'].includes(normalizedStatus) && !normalizedResolution) throw new AppError('A resolution note is required', 400, 'credit_dispute_resolution_required');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(`SELECT d.*, fr.display_name AS restaurant_name FROM oxsteed_credit_disputes d LEFT JOIN oxsteed_credit_partners p ON p.id = d.partner_id LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id WHERE d.id = $1 FOR UPDATE`, [disputeId]);
    const dispute = rows[0];
    if (!dispute) throw new AppError('Credit dispute not found', 404, 'credit_dispute_not_found');
    if (['resolved', 'rejected'].includes(dispute.status)) {
      if (dispute.status === normalizedStatus) return { dispute: formatDispute(dispute), replayed: true };
      throw new AppError('A closed credit dispute cannot be reopened', 409, 'credit_dispute_state_invalid');
    }
    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_disputes
          SET status = $1, resolution = COALESCE($2, resolution), resolved_by = CASE WHEN $1 IN ('resolved', 'rejected') THEN $3 ELSE resolved_by END, resolved_at = CASE WHEN $1 IN ('resolved', 'rejected') THEN NOW() ELSE resolved_at END, updated_at = NOW()
        WHERE id = $4
        RETURNING *`,
      [normalizedStatus, normalizedResolution, actorUserId || null, dispute.id]
    );
    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id, reason, before_state, after_state)
       VALUES ('credit.dispute.status_changed', $1, $2, $3, 'credit_dispute', $4, $5, $6::jsonb, $7::jsonb)`,
      [actorUserId || null, dispute.customer_id, dispute.partner_id || null, String(dispute.id), normalizedResolution || null, JSON.stringify({ status: dispute.status }), JSON.stringify({ status: normalizedStatus })]
    );
    return { dispute: formatDispute({ ...updatedRows[0], restaurant_name: dispute.restaurant_name }), replayed: false };
  }, 'credit_resolve_dispute');
}

module.exports = {
  CREDIT_CURRENCY,
  SUPPORTED_CREDIT_CURRENCIES: [...SUPPORTED_CREDIT_CURRENCIES].sort(),
  SUPPORTED_CREDIT_CURRENCY_META,
  assertSupportedCreditCurrency,
  MAX_TRANSACTION_CENTS,
  MAX_CUSTOMER_BALANCE_CENTS,
  MAX_TOTAL_ISSUANCE_CENTS,
  MAX_DAILY_CUSTOMER_ISSUANCE_CENTS,
  MAX_STATEMENT_EXPORT_ROWS,
  CUSTOMER_TRANSFERS_ENABLED,
  isCreditRailEnabled,
  assertCreditRailEnabled,
  getCreditRailStatus,
  setCreditRailStatus,
  computeEntryHash,
  ensureAccount,
  findSpendAgreement,
  formatAccount,
  formatHold,
  formatTransaction,
  getCustomerCreditAccount,
  listCustomerCreditAccounts,
  listEligiblePartners,
  findExistingTransferForReplay,
  listCustomerCreditTransactions,
  getCustomerCreditStatement,
  customerCreditStatementCsv,
  getCustomerCreditTransaction,
  loadCustomerCredit,
  postJournalTransaction,
  purchaseWithCreditInTransaction,
  purchaseWithCredit,
  transferCredit,
  adjustCustomerCredit,
  updateCustomerCreditAccountStatus,
  createCreditHold,
  captureCreditHold,
  releaseCreditHold,
  expireCreditHolds,
  refundCreditInTransaction,
  refundCreditForReferenceInTransaction,
  refundCredit,
  formatDispute,
  openCreditDispute,
  listCreditDisputes,
  resolveCreditDispute,
};
