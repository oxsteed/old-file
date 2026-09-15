'use strict';

const crypto = require('crypto');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const {
  assertSupportedCreditCurrency,
  ensureAccount,
  postJournalTransaction,
  formatTransaction,
  assertCreditRailEnabled,
  MAX_TRANSACTION_CENTS,
  MAX_CUSTOMER_BALANCE_CENTS,
} = require('./oxsteedCreditService');

const DEFAULT_QUOTE_TTL_MINUTES = 15;
const MAX_QUOTE_TTL_MINUTES = 1440;
const MAX_DAILY_CONVERSION_CENTS = positiveEnv('OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_CONVERSION_CENTS', MAX_CUSTOMER_BALANCE_CENTS);
const MAX_DAILY_CONVERSION_COUNT = positiveEnv('OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_CONVERSION_COUNT', 20);

function positiveEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function parsePositiveInt(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(`Invalid ${fieldName}`, 400, `invalid_${fieldName}`);
  return parsed;
}

function parseAmount(value, fieldName, allowZero = false) {
  const amount = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isSafeInteger(amount) || (allowZero ? amount < 0 : amount <= 0) || amount > MAX_TRANSACTION_CENTS) {
    throw new AppError('Conversion amount is invalid', 400, 'credit_conversion_amount_invalid', {
      [fieldName]: `Must be an integer between ${allowZero ? 0 : 1} and ${MAX_TRANSACTION_CENTS}`,
    });
  }
  return amount;
}

function parsePositiveDecimalInteger(value, fieldName) {
  const normalized = normalizeString(String(value ?? ''), 40);
  if (!normalized || !/^\d{1,38}$/.test(normalized) || BigInt(normalized) <= 0n) {
    throw new AppError(`${fieldName} must be a positive integer`, 400, 'credit_conversion_rate_invalid');
  }
  return normalized;
}

function roundHalfUp(numerator, denominator) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

function calculateQuotedTargetAmount({ sourceAmountMinorUnits, rateNumerator, rateDenominator, roundingMode = 'half_up' }) {
  if (roundingMode !== 'half_up') throw new AppError('Unsupported currency quote rounding mode', 400, 'credit_conversion_rounding_invalid');
  const source = BigInt(parseAmount(sourceAmountMinorUnits, 'sourceAmountMinorUnits'));
  const numerator = BigInt(parsePositiveDecimalInteger(rateNumerator, 'rateNumerator'));
  const denominator = BigInt(parsePositiveDecimalInteger(rateDenominator, 'rateDenominator'));
  const target = roundHalfUp(source * numerator, denominator);
  if (target <= 0n || target > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError('Currency quote target amount is outside the supported range', 400, 'credit_conversion_target_amount_invalid');
  }
  return Number(target);
}

function resolveQuoteExpiry(expiresAt) {
  const now = new Date();
  const parsed = expiresAt ? new Date(expiresAt) : new Date(now.getTime() + DEFAULT_QUOTE_TTL_MINUTES * 60000);
  if (Number.isNaN(parsed.getTime()) || parsed <= now) {
    throw new AppError('Currency quote expiry must be in the future', 400, 'credit_conversion_quote_expiry_invalid');
  }
  if (parsed.getTime() > now.getTime() + MAX_QUOTE_TTL_MINUTES * 60000) {
    throw new AppError(`Currency quote expiry cannot be more than ${MAX_QUOTE_TTL_MINUTES} minutes from now`, 400, 'credit_conversion_quote_expiry_too_long');
  }
  return parsed;
}

function requireActor(actorUserId, message = 'An identified administrator is required') {
  const actor = normalizeString(actorUserId, 160);
  if (!actor) throw new AppError(message, 403, 'credit_conversion_actor_required');
  return actor;
}

function requireIdempotencyKey(value) {
  const key = normalizeString(value, 160);
  if (!key) throw new AppError('Idempotency-Key is required for currency conversions', 400, 'credit_idempotency_key_required');
  return key;
}

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableJson(value[key]);
      return result;
    }, {});
  }
  return value;
}

function formatCurrencyQuote(row) {
  return {
    id: String(row.id),
    sourceCurrencyCode: row.source_currency_code,
    targetCurrencyCode: row.target_currency_code,
    sourceAmountMinorUnits: Number(row.source_amount_minor_units),
    targetAmountMinorUnits: Number(row.target_amount_minor_units),
    feeAmountMinorUnits: Number(row.fee_amount_minor_units || 0),
    rateNumerator: String(row.rate_numerator),
    rateDenominator: String(row.rate_denominator),
    roundingMode: row.rounding_mode,
    provider: row.provider,
    providerQuoteReference: row.provider_quote_reference,
    status: row.status,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at || null,
    reason: row.reason,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

function formatCurrencyConversion(row, transactions = {}) {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    quoteId: String(row.quote_id),
    sourceCurrencyCode: row.source_currency_code,
    targetCurrencyCode: row.target_currency_code,
    sourceAmountMinorUnits: Number(row.source_amount_minor_units),
    targetAmountMinorUnits: Number(row.target_amount_minor_units),
    feeAmountMinorUnits: Number(row.fee_amount_minor_units || 0),
    debitTransactionId: String(row.debit_transaction_id),
    feeTransactionId: row.fee_transaction_id ? String(row.fee_transaction_id) : null,
    creditTransactionId: String(row.credit_transaction_id),
    status: row.status,
    correlationId: row.correlation_id || null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    transactions,
  };
}

function assertQuoteReplayMatches(existing, requested) {
  const mismatches = {};
  for (const field of ['quote_id', 'customer_id', 'source_amount_minor_units']) {
    if (String(existing[field]) !== String(requested[field])) mismatches[field] = { existing: existing[field], requested: requested[field] };
  }
  if (Object.keys(mismatches).length) {
    throw new AppError('Conversion idempotency key was already used for different data', 409, 'credit_conversion_idempotency_conflict', { mismatches });
  }
}

function assertCurrencyQuoteReplayMatches(existing, requested) {
  const mismatches = {};
  const fields = [
    ['source_currency_code', requested.sourceCurrencyCode],
    ['target_currency_code', requested.targetCurrencyCode],
    ['source_amount_minor_units', requested.sourceAmountMinorUnits],
    ['target_amount_minor_units', requested.targetAmountMinorUnits],
    ['fee_amount_minor_units', requested.feeAmountMinorUnits],
    ['rate_numerator', requested.rateNumerator],
    ['rate_denominator', requested.rateDenominator],
    ['rounding_mode', requested.roundingMode],
    ['provider', requested.provider],
    ['provider_quote_reference', requested.providerQuoteReference],
    ['reason', requested.reason],
  ];
  for (const [field, requestedValue] of fields) {
    if (String(existing[field]) !== String(requestedValue)) {
      mismatches[field] = { existing: existing[field], requested: requestedValue };
    }
  }
  if (JSON.stringify(stableJson(existing.metadata || {})) !== JSON.stringify(stableJson(requested.metadata || {}))) {
    mismatches.metadata = { existing: existing.metadata || {}, requested: requested.metadata || {} };
  }
  if (requested.expiresAt
    && new Date(existing.expires_at).getTime() !== requested.expiresAt.getTime()) {
    mismatches.expires_at = { existing: existing.expires_at, requested: requested.expiresAt.toISOString() };
  }
  if (Object.keys(mismatches).length) {
    throw new AppError('Quote idempotency key was already used for different data', 409, 'credit_conversion_quote_idempotency_conflict', { mismatches });
  }
}

async function createCurrencyQuote({
  sourceCurrencyCode,
  targetCurrencyCode,
  sourceAmountMinorUnits,
  targetAmountMinorUnits,
  feeAmountMinorUnits = 0,
  rateNumerator,
  rateDenominator,
  roundingMode = 'half_up',
  provider,
  providerQuoteReference,
  expiresAt,
  idempotencyKey,
  actorUserId,
  reason,
  correlationId,
  metadata = {},
}) {
  const sourceCurrency = assertSupportedCreditCurrency(sourceCurrencyCode);
  const targetCurrency = assertSupportedCreditCurrency(targetCurrencyCode);
  if (sourceCurrency === targetCurrency) throw new AppError('Currency quote currencies must be different', 400, 'credit_conversion_currency_same');
  const sourceAmount = parseAmount(sourceAmountMinorUnits, 'sourceAmountMinorUnits');
  const feeAmount = parseAmount(feeAmountMinorUnits, 'feeAmountMinorUnits', true);
  if (sourceAmount + feeAmount > MAX_TRANSACTION_CENTS) throw new AppError('Conversion source amount plus fee exceeds the transaction limit', 400, 'credit_conversion_transaction_limit');
  const numerator = parsePositiveDecimalInteger(rateNumerator, 'rateNumerator');
  const denominator = parsePositiveDecimalInteger(rateDenominator, 'rateDenominator');
  const targetAmount = parseAmount(targetAmountMinorUnits, 'targetAmountMinorUnits');
  if (calculateQuotedTargetAmount({ sourceAmountMinorUnits: sourceAmount, rateNumerator: numerator, rateDenominator: denominator, roundingMode }) !== targetAmount) {
    throw new AppError('Currency quote target amount does not match its exact rate and rounding mode', 400, 'credit_conversion_quote_math_invalid');
  }
  const providerName = normalizeString(provider, 80);
  const providerReference = normalizeString(providerQuoteReference, 160);
  const normalizedReason = normalizeString(reason, 1000);
  if (!providerName || !providerReference) throw new AppError('A rate provider and provider quote reference are required', 400, 'credit_conversion_provider_reference_required');
  if (!normalizedReason) throw new AppError('A reason is required for currency quotes', 400, 'credit_conversion_reason_required');
  const actor = requireActor(actorUserId);
  const key = requireIdempotencyKey(idempotencyKey);
  const expiry = resolveQuoteExpiry(expiresAt);

  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`oxsteed-credit-quote:${key}`]);
    const { rows: existingRows } = await client.query(
      `SELECT * FROM oxsteed_credit_currency_quotes WHERE idempotency_key = $1 FOR UPDATE`,
      [key]
    );
    if (existingRows[0]) {
      const existing = existingRows[0];
      assertCurrencyQuoteReplayMatches(existing, {
        sourceCurrencyCode: sourceCurrency,
        targetCurrencyCode: targetCurrency,
        sourceAmountMinorUnits: sourceAmount,
        targetAmountMinorUnits: targetAmount,
        feeAmountMinorUnits: feeAmount,
        rateNumerator: numerator,
        rateDenominator: denominator,
        roundingMode,
        provider: providerName,
        providerQuoteReference: providerReference,
        reason: normalizedReason,
        metadata: normalizeMetadata(metadata),
        expiresAt: expiresAt ? expiry : null,
      });
      return { quote: formatCurrencyQuote(existing), replayed: true };
    }
    await assertCreditRailEnabled(client);
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_currency_quotes
        (source_currency_code, target_currency_code, source_amount_minor_units,
         target_amount_minor_units, fee_amount_minor_units, rate_numerator,
         rate_denominator, rounding_mode, provider, provider_quote_reference,
         expires_at, created_by, reason, metadata, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)
       RETURNING *`,
      [sourceCurrency, targetCurrency, sourceAmount, targetAmount, feeAmount, numerator, denominator, roundingMode, providerName, providerReference, expiry, actor, normalizedReason, JSON.stringify(normalizeMetadata(metadata)), key]
    );
    return { quote: formatCurrencyQuote(rows[0]), replayed: false };
  }, 'credit_create_currency_quote');
}

async function getCurrencyQuote({ quoteId }) {
  const normalizedQuoteId = parsePositiveInt(quoteId, 'quoteId');
  const { rows } = await pool.query(`SELECT * FROM oxsteed_credit_currency_quotes WHERE id = $1`, [normalizedQuoteId]);
  if (!rows[0]) throw new AppError('Currency quote not found', 404, 'credit_conversion_quote_not_found');
  return { quote: formatCurrencyQuote(rows[0]) };
}

async function assertDailyConversionCapacity(client, { customerId, currencyCode, sourceAmount }) {
  const { rows } = await client.query(
    `WITH lock AS (
       SELECT pg_advisory_xact_lock(hashtext($3)) AS acquired
     )
     SELECT COUNT(*) AS conversion_count,
            COALESCE(SUM(source_amount_minor_units), 0) AS conversion_cents
       FROM oxsteed_credit_currency_conversions
      CROSS JOIN lock
      WHERE customer_id = $1
        AND source_currency_code = $2
        AND created_at >= date_trunc('day', NOW())`,
    [customerId, currencyCode, `oxsteed-credit-conversion-limit:${customerId}:${currencyCode}`]
  );
  const count = Number(rows[0]?.conversion_count || 0);
  const amount = Number(rows[0]?.conversion_cents || 0);
  if (count >= MAX_DAILY_CONVERSION_COUNT || amount + sourceAmount > MAX_DAILY_CONVERSION_CENTS) {
    throw new AppError('Daily OxSteed Credit conversion limit reached', 409, 'credit_daily_conversion_limit', {
      conversionsToday: String(count),
      convertedTodayMinorUnits: String(amount),
      maxDailyConversionCount: String(MAX_DAILY_CONVERSION_COUNT),
      maxDailyConversionMinorUnits: String(MAX_DAILY_CONVERSION_CENTS),
    });
  }
}

async function loadConversionTransactions(client, conversion) {
  const ids = [conversion.debit_transaction_id, conversion.fee_transaction_id, conversion.credit_transaction_id].filter(Boolean);
  const { rows } = await client.query(
    `SELECT * FROM oxsteed_credit_transactions WHERE id = ANY($1::uuid[]) ORDER BY created_at ASC`,
    [ids]
  );
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  return {
    debit: byId.has(String(conversion.debit_transaction_id)) ? formatTransaction(byId.get(String(conversion.debit_transaction_id))) : null,
    fee: conversion.fee_transaction_id && byId.has(String(conversion.fee_transaction_id)) ? formatTransaction(byId.get(String(conversion.fee_transaction_id))) : null,
    credit: byId.has(String(conversion.credit_transaction_id)) ? formatTransaction(byId.get(String(conversion.credit_transaction_id))) : null,
  };
}

async function convertCustomerCredit({ customerId, quoteId, sourceAmountMinorUnits, idempotencyKey, actorUserId, correlationId, requestIp, metadata = {} }) {
  const actor = normalizeString(actorUserId, 160);
  if (!actor || String(actor) !== String(customerId)) throw new AppError('The Credit conversion actor must be the customer converting the balance', 403, 'credit_conversion_actor_required');
  const normalizedCustomerId = String(customerId);
  const normalizedQuoteId = parsePositiveInt(quoteId, 'quoteId');
  const sourceAmount = parseAmount(sourceAmountMinorUnits, 'sourceAmountMinorUnits');
  const key = requireIdempotencyKey(idempotencyKey);

  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`oxsteed-credit-conversion:${normalizedCustomerId}:${key}`]);
    const { rows: existingRows } = await client.query(
      `SELECT * FROM oxsteed_credit_currency_conversions WHERE idempotency_key = $1 FOR UPDATE`,
      [key]
    );
    if (existingRows[0]) {
      const existing = existingRows[0];
      assertQuoteReplayMatches(existing, { quote_id: normalizedQuoteId, customer_id: normalizedCustomerId, source_amount_minor_units: sourceAmount });
      return { conversion: formatCurrencyConversion(existing, await loadConversionTransactions(client, existing)), replayed: true };
    }

    await assertCreditRailEnabled(client);
    const { rows: quoteRows } = await client.query(
      `SELECT * FROM oxsteed_credit_currency_quotes WHERE id = $1 FOR UPDATE`,
      [normalizedQuoteId]
    );
    const quote = quoteRows[0];
    if (!quote) throw new AppError('Currency quote not found', 404, 'credit_conversion_quote_not_found');
    if (quote.status !== 'open') throw new AppError('Currency quote is no longer available', 409, 'credit_conversion_quote_unavailable');
    if (new Date(quote.expires_at) <= new Date()) {
      await client.query(`UPDATE oxsteed_credit_currency_quotes SET status = 'expired', updated_at = NOW() WHERE id = $1`, [normalizedQuoteId]);
      throw new AppError('Currency quote has expired', 409, 'credit_conversion_quote_expired');
    }
    if (Number(quote.source_amount_minor_units) !== sourceAmount) throw new AppError('Conversion amount does not match the currency quote', 409, 'credit_conversion_quote_amount_mismatch');

    const feeAmount = Number(quote.fee_amount_minor_units || 0);
    if (sourceAmount + feeAmount > MAX_TRANSACTION_CENTS) throw new AppError('Conversion source amount plus fee exceeds the transaction limit', 409, 'credit_conversion_transaction_limit');
    await assertDailyConversionCapacity(client, { customerId: normalizedCustomerId, currencyCode: quote.source_currency_code, sourceAmount });
    const sourceWallet = await ensureAccount(client, { accountType: 'customer_wallet', customerId: normalizedCustomerId, currencyCode: quote.source_currency_code });
    const sourceTreasury = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: quote.source_currency_code });
    const targetTreasury = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: quote.target_currency_code });
    const targetWallet = await ensureAccount(client, { accountType: 'customer_wallet', customerId: normalizedCustomerId, currencyCode: quote.target_currency_code });
    const conversionId = crypto.randomUUID();
    const common = {
      customerId: normalizedCustomerId,
      actorType: 'user',
      actorUserId: actor,
      referenceType: 'currency_conversion',
      referenceId: conversionId,
      correlationId,
      requestIp,
      description: `OxSteed Credit currency conversion ${quote.source_currency_code} to ${quote.target_currency_code}`,
      metadata: { ...normalizeMetadata(metadata), quoteId: String(quote.id), provider: quote.provider, providerQuoteReference: quote.provider_quote_reference },
    };
    const debitResult = await postJournalTransaction(client, {
      ...common,
      transactionType: 'conversion_debit',
      debitAccountId: sourceWallet.id,
      creditAccountId: sourceTreasury.id,
      amountCents: sourceAmount,
      currencyCode: quote.source_currency_code,
      idempotencyKey: `oxsteed-conversion:${conversionId}:debit`,
    });
    let feeResult = null;
    if (feeAmount > 0) {
      feeResult = await postJournalTransaction(client, {
        ...common,
        transactionType: 'conversion_fee',
        debitAccountId: sourceWallet.id,
        creditAccountId: (await ensureAccount(client, { accountType: 'platform_revenue', currencyCode: quote.source_currency_code })).id,
        amountCents: feeAmount,
        currencyCode: quote.source_currency_code,
        idempotencyKey: `oxsteed-conversion:${conversionId}:fee`,
      });
    }
    const creditResult = await postJournalTransaction(client, {
      ...common,
      actorType: 'system',
      actorUserId: null,
      transactionType: 'conversion_credit',
      debitAccountId: targetTreasury.id,
      creditAccountId: targetWallet.id,
      amountCents: Number(quote.target_amount_minor_units),
      currencyCode: quote.target_currency_code,
      idempotencyKey: `oxsteed-conversion:${conversionId}:credit`,
    });
    const { rows: conversionRows } = await client.query(
      `INSERT INTO oxsteed_credit_currency_conversions
        (id, customer_id, quote_id, source_currency_code, target_currency_code,
         source_amount_minor_units, target_amount_minor_units, fee_amount_minor_units,
         debit_transaction_id, fee_transaction_id, credit_transaction_id,
         idempotency_key, actor_user_id, correlation_id, request_ip, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
       RETURNING *`,
      [conversionId, normalizedCustomerId, quote.id, quote.source_currency_code, quote.target_currency_code, sourceAmount, quote.target_amount_minor_units, feeAmount, debitResult.transaction.id, feeResult?.transaction.id || null, creditResult.transaction.id, key, actor, correlationId || null, requestIp || null, JSON.stringify(normalizeMetadata(metadata))]
    );
    await client.query(`UPDATE oxsteed_credit_currency_quotes SET status = 'consumed', consumed_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'open'`, [quote.id]);
    return {
      conversion: formatCurrencyConversion(conversionRows[0], {
        debit: debitResult.transaction,
        fee: feeResult?.transaction || null,
        credit: creditResult.transaction,
      }),
      replayed: false,
    };
  }, 'credit_convert_currency');
}

module.exports = {
  DEFAULT_QUOTE_TTL_MINUTES,
  MAX_QUOTE_TTL_MINUTES,
  MAX_DAILY_CONVERSION_CENTS,
  MAX_DAILY_CONVERSION_COUNT,
  calculateQuotedTargetAmount,
  formatCurrencyQuote,
  formatCurrencyConversion,
  assertDailyConversionCapacity,
  createCurrencyQuote,
  getCurrencyQuote,
  convertCustomerCredit,
};
