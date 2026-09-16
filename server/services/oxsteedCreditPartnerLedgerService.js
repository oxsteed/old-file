'use strict';

const crypto = require('crypto');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const {
  assertSupportedCreditCurrency,
  ensureAccount,
  postJournalTransaction,
  formatAccount,
  assertCreditRailEnabled,
} = require('./oxsteedCreditService');

const PARTNER_LEDGER_STATUSES = new Set(['active', 'suspended', 'closed']);
const FUNDING_DIRECTIONS = new Set(['fund', 'release']);

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function parsePositiveInt(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(`Invalid ${fieldName}`, 400, `invalid_${fieldName}`);
  }
  return parsed;
}

function parseAmountCents(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError('Amount must be a positive integer number of cents', 400, 'credit_amount_invalid');
  }
  return amount;
}

function requireActor(actorUserId) {
  if (!normalizeString(actorUserId, 160)) {
    throw new AppError('An identified administrator is required for partner funding', 400, 'credit_partner_funding_actor_required');
  }
  return actorUserId;
}

function requireReason(reason) {
  const normalized = normalizeString(reason, 1000);
  if (!normalized) throw new AppError('A reason is required for partner funding', 400, 'credit_partner_funding_reason_required');
  return normalized;
}

function formatPartnerLedger(row) {
  return {
    id: String(row.ledger_id || row.id),
    partnerId: String(row.partner_id),
    restaurantId: row.restaurant_id === null || row.restaurant_id === undefined ? null : String(row.restaurant_id),
    restaurantName: row.restaurant_name || null,
    ledgerCode: row.ledger_code,
    currencyCode: row.currency_code,
    status: row.ledger_status || row.status,
    payableAccount: row.payable_account_id ? formatAccount({
      id: row.payable_account_id,
      account_type: 'partner_payable',
      partner_id: row.partner_id,
      currency_code: row.currency_code,
      balance_cents: row.payable_balance_cents,
      reserved_cents: row.payable_reserved_cents,
      status: row.payable_status,
      ledger_version: row.payable_ledger_version,
      last_entry_hash: row.payable_last_entry_hash,
      last_posted_at: row.payable_last_posted_at,
    }) : null,
    reserveAccount: row.reserve_account_id ? formatAccount({
      id: row.reserve_account_id,
      account_type: 'partner_reserve',
      partner_id: row.partner_id,
      currency_code: row.currency_code,
      balance_cents: row.reserve_balance_cents,
      reserved_cents: row.reserve_reserved_cents,
      status: row.reserve_status,
      ledger_version: row.reserve_ledger_version,
      last_entry_hash: row.reserve_last_entry_hash,
      last_posted_at: row.reserve_last_posted_at,
    }) : null,
    totalFundedCents: Number(row.total_funded_cents || 0),
    totalReleasedCents: Number(row.total_released_cents || 0),
    createdAt: row.ledger_created_at || row.created_at || null,
    updatedAt: row.ledger_updated_at || row.updated_at || null,
  };
}

function formatFundingRecord(row) {
  return {
    id: String(row.id),
    partnerLedgerId: String(row.partner_ledger_id),
    partnerId: String(row.partner_id),
    reserveAccountId: String(row.reserve_account_id),
    transactionId: String(row.transaction_id),
    direction: row.direction,
    amountCents: Number(row.amount_cents),
    currencyCode: row.currency_code,
    externalReference: row.external_reference,
    idempotencyKey: row.idempotency_key,
    reason: row.reason,
    actorUserId: row.actor_user_id || null,
    correlationId: row.correlation_id || null,
    metadata: row.metadata || {},
    createdAt: row.created_at || null,
  };
}

async function ensurePartnerLedger(client, { partnerId, currencyCode, createdBy = null }) {
  const normalizedPartnerId = parsePositiveInt(partnerId, 'partnerId');
  const currency = assertSupportedCreditCurrency(currencyCode || 'USD');
  const { rows: partnerRows } = await client.query(
    `SELECT id, settlement_currency_code, status
       FROM oxsteed_credit_partners
      WHERE id = $1
      FOR UPDATE`,
    [normalizedPartnerId]
  );
  const partner = partnerRows[0];
  if (!partner) throw new AppError('Credit partner not found', 404, 'credit_partner_not_found');
  if (partner.settlement_currency_code !== currency) {
    throw new AppError('Partner ledger currency does not match its settlement currency', 409, 'credit_partner_currency_mismatch');
  }
  const payable = await ensureAccount(client, {
    accountType: 'partner_payable',
    partnerId: normalizedPartnerId,
    currencyCode: currency,
  });
  const reserve = await ensureAccount(client, {
    accountType: 'partner_reserve',
    partnerId: normalizedPartnerId,
    currencyCode: currency,
  });
  await client.query(
    `INSERT INTO oxsteed_credit_partner_ledgers
       (partner_id, ledger_code, currency_code, payable_account_id, reserve_account_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (partner_id) DO NOTHING`,
    [normalizedPartnerId, `restaurant-credit:${normalizedPartnerId}:${currency}`, currency, payable.id, reserve.id, createdBy || null]
  );
  const { rows: ledgerRows } = await client.query(
    `SELECT l.id AS ledger_id, l.partner_id, l.ledger_code, l.currency_code,
            l.status AS ledger_status, l.created_at AS ledger_created_at,
            l.updated_at AS ledger_updated_at,
            p.restaurant_id, fr.display_name AS restaurant_name,
            l.payable_account_id, payable.balance_cents AS payable_balance_cents,
            payable.reserved_cents AS payable_reserved_cents, payable.status AS payable_status,
            payable.ledger_version AS payable_ledger_version, payable.last_entry_hash AS payable_last_entry_hash,
            payable.last_posted_at AS payable_last_posted_at,
            l.reserve_account_id, reserve.balance_cents AS reserve_balance_cents,
            reserve.reserved_cents AS reserve_reserved_cents, reserve.status AS reserve_status,
            reserve.ledger_version AS reserve_ledger_version, reserve.last_entry_hash AS reserve_last_entry_hash,
            reserve.last_posted_at AS reserve_last_posted_at,
            COALESCE(SUM(f.amount_cents) FILTER (WHERE f.direction = 'fund'), 0) AS total_funded_cents,
            COALESCE(SUM(f.amount_cents) FILTER (WHERE f.direction = 'release'), 0) AS total_released_cents
       FROM oxsteed_credit_partner_ledgers l
       JOIN oxsteed_credit_partners p ON p.id = l.partner_id
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
       JOIN oxsteed_credit_accounts payable ON payable.id = l.payable_account_id
       JOIN oxsteed_credit_accounts reserve ON reserve.id = l.reserve_account_id
       LEFT JOIN oxsteed_credit_partner_funding_records f ON f.partner_ledger_id = l.id
      WHERE l.partner_id = $1
      GROUP BY l.id, p.restaurant_id, fr.display_name, payable.id, reserve.id`,
    [normalizedPartnerId]
  );
  if (!ledgerRows[0]) throw new AppError('Credit partner ledger could not be initialized', 500, 'credit_partner_ledger_create_failed');
  return ledgerRows[0];
}

async function getPartnerLedger({ partnerId, currencyCode = null } = {}) {
  return withTransaction(pool, async (client) => {
    const normalizedPartnerId = parsePositiveInt(partnerId, 'partnerId');
    const { rows: partnerRows } = await client.query(
      `SELECT settlement_currency_code FROM oxsteed_credit_partners WHERE id = $1`,
      [normalizedPartnerId]
    );
    const partner = partnerRows[0];
    if (!partner) throw new AppError('Credit partner not found', 404, 'credit_partner_not_found');
    const ledger = await ensurePartnerLedger(client, {
      partnerId: normalizedPartnerId,
      currencyCode: currencyCode || partner.settlement_currency_code,
    });
    return { ledger: formatPartnerLedger(ledger) };
  }, 'credit_get_partner_ledger');
}

async function listPartnerFundingRecords({ partnerId, limit = 100, offset = 0 } = {}) {
  const normalizedPartnerId = parsePositiveInt(partnerId, 'partnerId');
  const safeLimit = Math.max(1, Math.min(Number.parseInt(String(limit), 10) || 100, 250));
  const parsedOffset = Number.parseInt(String(offset), 10);
  const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1000000) : 0;
  const { rows } = await pool.query(
    `SELECT f.*
       FROM oxsteed_credit_partner_funding_records f
      WHERE f.partner_id = $1
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT $2 OFFSET $3`,
    [normalizedPartnerId, safeLimit + 1, safeOffset]
  );
  const hasMore = rows.length > safeLimit;
  return {
    records: rows.slice(0, safeLimit).map(formatFundingRecord),
    pagination: { limit: safeLimit, offset: safeOffset, hasMore, nextOffset: hasMore ? safeOffset + safeLimit : null },
  };
}

function assertFundingReplayMatches(existing, requested) {
  const mismatches = {};
  for (const field of ['partner_id', 'direction', 'amount_cents', 'currency_code', 'external_reference']) {
    if (String(existing[field]) !== String(requested[field])) mismatches[field] = { existing: existing[field], requested: requested[field] };
  }
  if (Object.keys(mismatches).length) {
    throw new AppError('Funding idempotency key was already used for different data', 409, 'credit_partner_funding_idempotency_conflict', { mismatches });
  }
}

async function recordPartnerFunding({ partnerId, currencyCode = null, amountCents, direction = 'fund', externalReference, idempotencyKey, actorUserId, reason, correlationId, requestIp, metadata = {} }) {
  const normalizedPartnerId = parsePositiveInt(partnerId, 'partnerId');
  const amount = parseAmountCents(amountCents);
  const normalizedDirection = normalizeString(direction, 20)?.toLowerCase();
  if (!FUNDING_DIRECTIONS.has(normalizedDirection)) throw new AppError('Funding direction must be fund or release', 400, 'credit_partner_funding_direction_invalid');
  const normalizedReference = normalizeString(externalReference, 160);
  if (!normalizedReference) throw new AppError('An external funding reference is required', 400, 'credit_partner_funding_reference_required');
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 160);
  if (!normalizedIdempotencyKey) throw new AppError('Idempotency-Key is required for partner funding', 400, 'credit_idempotency_key_required');
  const normalizedReason = requireReason(reason);
  requireActor(actorUserId);
  const normalizedMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};

  return withTransaction(pool, async (client) => {
    const { rows: existingRows } = await client.query(
      `SELECT * FROM oxsteed_credit_partner_funding_records WHERE idempotency_key = $1 FOR UPDATE`,
      [normalizedIdempotencyKey]
    );
    const currency = currencyCode ? assertSupportedCreditCurrency(currencyCode) : null;
    if (existingRows[0]) {
      assertFundingReplayMatches(existingRows[0], {
        partner_id: normalizedPartnerId,
        direction: normalizedDirection,
        amount_cents: amount,
        currency_code: currency || existingRows[0].currency_code,
        external_reference: normalizedReference,
      });
      return { record: formatFundingRecord(existingRows[0]), replayed: true };
    }
    await assertCreditRailEnabled(client);
    const ledger = await ensurePartnerLedger(client, {
      partnerId: normalizedPartnerId,
      currencyCode: currency || undefined,
      createdBy: actorUserId,
    });
    if (ledger.ledger_status !== 'active') throw new AppError('Partner ledger is not active', 409, 'credit_partner_ledger_inactive');
    const transactionType = normalizedDirection === 'fund' ? 'funding' : 'reserve_release';
    const treasury = await ensureAccount(client, {
      accountType: 'platform_treasury',
      currencyCode: ledger.currency_code,
    });
    const transaction = await postJournalTransaction(client, {
      transactionType,
      debitAccountId: normalizedDirection === 'fund' ? treasury.id : ledger.reserve_account_id,
      creditAccountId: normalizedDirection === 'fund' ? ledger.reserve_account_id : treasury.id,
      amountCents: amount,
      currencyCode: ledger.currency_code,
      partnerId: normalizedPartnerId,
      // Keep the internal transaction key within the schema limit even when a
      // caller supplies a long idempotency key for the funding record.
      idempotencyKey: `partner-funding:${crypto.createHash('sha256').update(normalizedIdempotencyKey).digest('hex')}`,
      actorType: 'admin',
      actorUserId,
      referenceType: 'partner_funding',
      referenceId: normalizedReference,
      correlationId,
      requestIp,
      reason: normalizedReason,
      description: normalizedDirection === 'fund' ? 'Restaurant Credit reserve funding' : 'Restaurant Credit reserve release',
      metadata: { ...normalizedMetadata, direction: normalizedDirection, externalReference: normalizedReference },
    });
    if (!transaction?.transaction?.id) {
      throw new AppError('Partner funding transaction could not be confirmed', 500, 'credit_partner_funding_transaction_failed');
    }
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_partner_funding_records
         (partner_ledger_id, partner_id, reserve_account_id, transaction_id, direction,
          amount_cents, currency_code, external_reference, idempotency_key, reason,
          actor_user_id, correlation_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       RETURNING *`,
      [ledger.ledger_id, normalizedPartnerId, ledger.reserve_account_id, transaction.transaction.id, normalizedDirection, amount, ledger.currency_code, normalizedReference, normalizedIdempotencyKey, normalizedReason, actorUserId, normalizeString(correlationId, 160), JSON.stringify(normalizedMetadata)]
    );
    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, partner_id, resource_type, resource_id, reason, correlation_id, request_ip, after_state, metadata)
       VALUES ($1, $2, $3, 'credit_partner_funding', $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
      [`credit.partner_ledger.${normalizedDirection}`, actorUserId, normalizedPartnerId, String(rows[0].id), normalizedReason, normalizeString(correlationId, 160), requestIp || null, JSON.stringify({ transactionId: transaction.transaction.id, amountCents: amount, currencyCode: ledger.currency_code }), JSON.stringify(normalizedMetadata)]
    );
    return { record: formatFundingRecord(rows[0]), transaction: transaction.transaction, replayed: false };
  }, 'credit_record_partner_funding');
}

module.exports = {
  PARTNER_LEDGER_STATUSES,
  FUNDING_DIRECTIONS,
  formatPartnerLedger,
  formatFundingRecord,
  ensurePartnerLedger,
  getPartnerLedger,
  listPartnerFundingRecords,
  recordPartnerFunding,
};
