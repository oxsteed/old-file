'use strict';

const crypto = require('crypto');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { assertSupportedCreditCurrency, computeEntryHash, ensureAccount, listCreditDisputes, postJournalTransaction } = require('./oxsteedCreditService');

const PARTNER_STATUSES = new Set(['pending', 'active', 'suspended', 'terminated']);
const AGREEMENT_STATUSES = new Set(['draft', 'pending_approval', 'active', 'suspended', 'expired', 'terminated']);
const ENTITLEMENT_STATUSES = new Set(['active', 'suspended', 'revoked', 'expired']);
const CREDIT_TRANSACTION_TYPES = new Set(['load', 'purchase', 'refund', 'transfer', 'adjustment', 'settlement', 'fee', 'expiration', 'chargeback']);
const CREDIT_TRANSACTION_STATUSES = new Set(['pending', 'posted', 'reversed', 'voided']);
const MAX_AGREEMENT_LIMIT_CENTS = Number.isSafeInteger(Number.parseInt(process.env.OXSTEED_CREDIT_MAX_AGREEMENT_LIMIT_CENTS || '', 10))
  ? Number.parseInt(process.env.OXSTEED_CREDIT_MAX_AGREEMENT_LIMIT_CENTS, 10)
  : 5000000;
const MAX_BULK_ENTITLEMENTS = 50;

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function settlementRequestHash({ partnerId, agreementId, currencyCode, periodStart, periodEnd, paymentReference, reason, metadata }) {
  return crypto.createHash('sha256').update(stableStringify({
    partnerId: String(partnerId),
    agreementId: String(agreementId),
    currencyCode: String(currencyCode || '').toUpperCase(),
    periodStart: periodStart?.toISOString() || null,
    periodEnd: periodEnd?.toISOString() || null,
    paymentReference: normalizeString(paymentReference, 160),
    reason: normalizeString(reason, 1000),
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
  })).digest('hex');
}

function requireAuditReason(value) {
  const reason = normalizeString(value, 1000);
  if (!reason) throw new AppError('An audit reason is required for this change', 400, 'credit_audit_reason_required');
  return reason;
}

function assertEntitlementAgreementCanBeActive(agreement) {
  if (agreement.status !== 'active'
    || agreement.partner_status !== 'active'
    || agreement.restaurant_status !== 'active') {
    throw new AppError('Customer access requires an active Credit agreement, partner, and restaurant', 409, 'credit_entitlement_agreement_not_active', {
      agreementId: String(agreement.id),
    });
  }
  if (agreement.ends_at && new Date(agreement.ends_at) <= new Date()) {
    throw new AppError('Customer access cannot be active after the Credit agreement ends', 409, 'credit_entitlement_agreement_expired', {
      agreementId: String(agreement.id),
    });
  }
}

function normalizeArray(value, maxItems = 100, itemMax = 120) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeString(String(item), itemMax)).filter(Boolean))].slice(0, maxItems);
}

function normalizePositiveIntArray(value, maxItems = 100) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    const parsed = Number(item);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        allowedMenuItemIds: 'Every menu item ID must be a positive integer',
      });
    }
    result.push(parsed);
  }
  return [...new Set(result)].slice(0, maxItems);
}

function parsePositiveInt(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(`Invalid ${fieldName}`, 400, `invalid_${fieldName}`);
  return parsed;
}

function parseDate(value, fieldName, required = false) {
  if (!value) {
    if (required) throw new AppError('Validation failed', 400, 'validation_failed', { [fieldName]: 'A date is required' });
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError('Validation failed', 400, 'validation_failed', { [fieldName]: 'Must be a valid ISO date' });
  return date;
}

function parseLimit(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError('Validation failed', 400, 'validation_failed', { [fieldName]: 'Must be a positive integer number of cents' });
  if (parsed > MAX_AGREEMENT_LIMIT_CENTS) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      [fieldName]: `Cannot exceed ${MAX_AGREEMENT_LIMIT_CENTS} cents`,
    });
  }
  return parsed;
}

function agreementRequestHash({ partnerId, startsAt, endsAt, customerTerms, allowedOrderTypes, allowedCategories, allowedMenuItemIds, geography, maxTransactionCents, dailyCustomerLimitCents, lifetimeCustomerLimitCents, requiresCustomerEntitlement, metadata }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    partnerId,
    startsAt: startsAt?.toISOString() || null,
    endsAt: endsAt?.toISOString() || null,
    customerTerms,
    allowedOrderTypes,
    allowedCategories,
    allowedMenuItemIds,
    geography,
    maxTransactionCents,
    dailyCustomerLimitCents,
    lifetimeCustomerLimitCents,
    requiresCustomerEntitlement,
    metadata,
  })).digest('hex');
}

function formatPartner(row) {
  return {
    partnerId: String(row.partner_id || row.id),
    restaurantId: String(row.restaurant_id),
    restaurantName: row.restaurant_name || null,
    businessId: row.business_id === null || row.business_id === undefined ? null : String(row.business_id),
    status: row.status,
    requiresCustomerEntitlement: row.requires_customer_entitlement === true,
    settlementCurrencyCode: row.settlement_currency_code,
    agreementCount: Number(row.agreement_count || 0),
    activeAgreementCount: Number(row.active_agreement_count || 0),
    notes: row.notes || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function formatAgreement(row) {
  return {
    id: row.id,
    partnerId: String(row.partner_id),
    restaurantId: row.restaurant_id === null || row.restaurant_id === undefined ? null : String(row.restaurant_id),
    restaurantName: row.restaurant_name || null,
    settlementCurrencyCode: row.settlement_currency_code || null,
    version: Number(row.version),
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at || null,
    customerTerms: row.customer_terms || null,
    allowedOrderTypes: row.allowed_order_types || [],
    allowedCategories: row.allowed_categories || [],
    allowedMenuItemIds: (row.allowed_menu_item_ids || []).map(String),
    geography: row.geography || {},
    maxTransactionCents: row.max_transaction_cents === null ? null : Number(row.max_transaction_cents),
    dailyCustomerLimitCents: row.daily_customer_limit_cents === null ? null : Number(row.daily_customer_limit_cents),
    lifetimeCustomerLimitCents: row.lifetime_customer_limit_cents === null ? null : Number(row.lifetime_customer_limit_cents),
    metadata: row.metadata || {},
    createdBy: row.created_by || null,
    approvedBy: row.approved_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatEntitlement(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
    customerEmail: row.email || null,
    agreementId: row.agreement_id,
    partnerId: row.partner_id === null || row.partner_id === undefined ? null : String(row.partner_id),
    restaurantId: row.restaurant_id === null || row.restaurant_id === undefined ? null : String(row.restaurant_id),
    restaurantName: row.restaurant_name || null,
    agreementVersion: row.agreement_version === null || row.agreement_version === undefined ? null : Number(row.agreement_version),
    agreementStatus: row.agreement_status || null,
    currencyCode: row.settlement_currency_code || null,
    status: row.status,
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    maxTransactionCents: row.max_transaction_cents === null ? null : Number(row.max_transaction_cents),
    dailyLimitCents: row.daily_limit_cents === null ? null : Number(row.daily_limit_cents),
    reason: row.reason || null,
    metadata: row.metadata || {},
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function snapshotEntitlement(row) {
  return {
    status: row.status || null,
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    maxTransactionCents: row.max_transaction_cents === null || row.max_transaction_cents === undefined ? null : Number(row.max_transaction_cents),
    dailyLimitCents: row.daily_limit_cents === null || row.daily_limit_cents === undefined ? null : Number(row.daily_limit_cents),
    metadata: row.metadata || {},
    reason: row.reason || null,
    createdBy: row.created_by || null,
  };
}

function formatSettlement(row) {
  return {
    id: row.id,
    partnerId: String(row.partner_id),
    agreementId: row.agreement_id,
    restaurantId: row.restaurant_id === null || row.restaurant_id === undefined ? null : String(row.restaurant_id),
    restaurantName: row.restaurant_name || null,
    currencyCode: row.currency_code,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    grossCents: Number(row.gross_cents || 0),
    refundCents: Number(row.refund_cents || 0),
    feeCents: Number(row.fee_cents || 0),
    netCents: Number(row.net_cents || 0),
    status: row.status,
    paymentReference: row.payment_reference || null,
    creationReason: row.creation_reason || null,
    creationRequestHash: row.creation_request_hash || null,
    createdBy: row.created_by || null,
    approvedBy: row.approved_by || null,
    paidAt: row.paid_at || null,
    metadata: row.metadata || {},
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function formatReconciliationRun(row) {
  return {
    id: String(row.id),
    currencyCode: row.currency_code,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    accountBalanceCents: Number(row.account_balance_cents || 0),
    journalBalanceCents: Number(row.journal_balance_cents || 0),
    differenceCents: Number(row.difference_cents || 0),
    accountCount: Number(row.account_count || 0),
    entryCount: Number(row.entry_count || 0),
    errorMessage: row.error_message || null,
    completedBy: row.completed_by || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    metadata: row.metadata || {},
  };
}

async function verifyCreditLedgerHashes(client, currency) {
  const stateByAccount = new Map();
  let invalidEntryHashes = 0;
  let invalidHashChains = 0;
  let lastAccountId = 0;
  let lastSequence = 0;
  let lastEntryId = 0;
  const batchSize = 5000;

  while (true) {
    const { rows } = await client.query(
      `SELECT e.id, e.transaction_id, e.account_id, e.entry_side,
              e.amount_cents, e.balance_after_cents, e.sequence,
              e.previous_entry_hash, e.entry_hash, e.metadata,
              t.transaction_type, t.currency_code
         FROM oxsteed_credit_transaction_entries e
         JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
        WHERE t.status = 'posted'
          AND t.currency_code = $1
          AND (e.account_id, e.sequence, e.id) > ($2, $3, $4)
        ORDER BY e.account_id ASC, e.sequence ASC, e.id ASC
        LIMIT $5`,
      [currency, lastAccountId, lastSequence, lastEntryId, batchSize]
    );
    for (const entry of rows) {
      const accountId = String(entry.account_id);
      const previous = stateByAccount.get(accountId) || { sequence: 0, hash: null };
      const sequence = Number(entry.sequence);
      const previousHash = entry.previous_entry_hash || null;
      if (sequence !== previous.sequence + 1 || previousHash !== previous.hash) invalidHashChains += 1;
      const expectedHash = computeEntryHash({
        transactionId: String(entry.transaction_id),
        transactionType: entry.transaction_type,
        accountId: Number(entry.account_id),
        entrySide: entry.entry_side,
        amountCents: Number(entry.amount_cents),
        balanceAfterCents: Number(entry.balance_after_cents),
        currencyCode: String(entry.currency_code || 'USD').toUpperCase(),
        sequence,
        previousEntryHash: previousHash,
        metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
      });
      if (!entry.entry_hash || entry.entry_hash !== expectedHash) invalidEntryHashes += 1;
      stateByAccount.set(accountId, { sequence, hash: entry.entry_hash || null });
    }
    if (rows.length < batchSize) break;
    const last = rows[rows.length - 1];
    lastAccountId = Number(last.account_id);
    lastSequence = Number(last.sequence);
    lastEntryId = Number(last.id);
  }

  const { rows: accounts } = await client.query(
    `SELECT id, ledger_version, last_entry_hash
       FROM oxsteed_credit_accounts
      WHERE currency_code = $1`,
    [currency]
  );
  let invalidAccountHashHeads = 0;
  for (const account of accounts) {
    const last = stateByAccount.get(String(account.id)) || { sequence: 0, hash: null };
    if (Number(account.ledger_version || 0) !== last.sequence || (account.last_entry_hash || null) !== last.hash) {
      invalidAccountHashHeads += 1;
    }
  }
  return { invalidEntryHashes, invalidHashChains, invalidAccountHashHeads };
}

async function listReconciliationRuns({ currencyCode, status, limit = 50, offset = 0 } = {}) {
  const params = [];
  const filters = [];
  if (currencyCode) {
    const currency = assertSupportedCreditCurrency(currencyCode);
    params.push(currency);
    filters.push(`currency_code = $${params.length}`);
  }
  if (status) {
    const normalizedStatus = normalizeString(status, 20);
    if (!['running', 'balanced', 'difference', 'failed'].includes(normalizedStatus)) {
      throw new AppError('Invalid reconciliation status', 400, 'invalid_credit_reconciliation_status');
    }
    params.push(normalizedStatus);
    filters.push(`status = $${params.length}`);
  }
  const parsedLimit = Number.parseInt(String(limit), 10);
  const safeLimit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 250) : 50;
  const parsedOffset = Number.parseInt(String(offset), 10);
  const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1000000) : 0;
  params.push(safeLimit + 1);
  const limitParam = params.length;
  params.push(safeOffset);
  const offsetParam = params.length;
  const { rows } = await pool.query(
    `SELECT id, currency_code, period_start, period_end, status,
            account_balance_cents, journal_balance_cents, difference_cents,
            account_count, entry_count, error_message, completed_by,
            started_at, completed_at, metadata
       FROM oxsteed_credit_reconciliation_runs
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY started_at DESC, id DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  const hasMore = rows.length > safeLimit;
  return {
    runs: rows.slice(0, safeLimit).map(formatReconciliationRun),
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      hasMore,
      nextOffset: hasMore ? safeOffset + safeLimit : null,
    },
  };
}

function assertSettlementIdempotencyReplayMatches(existing, { partnerId, agreementId, currencyCode, periodStart, periodEnd, paymentReference, reason, metadata, requestHash }) {
  const mismatches = {};
  if (String(existing.partner_id) !== String(partnerId)) mismatches.partnerId = { existing: existing.partner_id, requested: partnerId };
  if (String(existing.agreement_id) !== String(agreementId)) mismatches.agreementId = { existing: existing.agreement_id, requested: agreementId };
  if (String(existing.currency_code || '').toUpperCase() !== String(currencyCode || '').toUpperCase()) mismatches.currencyCode = { existing: existing.currency_code, requested: currencyCode };
  if (new Date(existing.period_start).getTime() !== new Date(periodStart).getTime()) mismatches.periodStart = { existing: existing.period_start, requested: periodStart };
  if (new Date(existing.period_end).getTime() !== new Date(periodEnd).getTime()) mismatches.periodEnd = { existing: existing.period_end, requested: periodEnd };
  if (existing.creation_request_hash) {
    if (existing.creation_request_hash !== requestHash) {
      mismatches.request = { existing: existing.creation_request_hash, requested: requestHash };
    }
  } else {
    const normalizedPaymentReference = normalizeString(paymentReference, 160);
    if (normalizedPaymentReference && normalizedPaymentReference !== normalizeString(existing.payment_reference, 160)) {
      mismatches.paymentReference = { existing: existing.payment_reference || null, requested: normalizedPaymentReference };
    }
    const normalizedReason = normalizeString(reason, 1000);
    if (normalizedReason && existing.creation_reason && normalizedReason !== normalizeString(existing.creation_reason, 1000)) {
      mismatches.reason = { existing: normalizeString(existing.creation_reason, 1000), requested: normalizedReason };
    }
    const normalizedMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
    if (Object.keys(normalizedMetadata).length > 0
      && stableStringify(existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}) !== stableStringify(normalizedMetadata)) {
      mismatches.metadata = { existing: stableStringify(existing.metadata || {}), requested: stableStringify(normalizedMetadata) };
    }
  }
  if (Object.keys(mismatches).length) {
    throw new AppError('Settlement idempotency key was already used for a different settlement', 409, 'credit_settlement_idempotency_conflict', { mismatches });
  }
}

async function insertAudit(client, { actionType, actorUserId, customerId = null, partnerId = null, resourceType, resourceId, reason, correlationId = null, beforeState = null, afterState = null, metadata = {} }) {
  const normalizedCorrelationId = normalizeString(correlationId, 160);
  if (normalizedCorrelationId) {
    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id,
          reason, correlation_id, before_state, after_state, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)`,
      [actionType, actorUserId || null, customerId, partnerId, resourceType, String(resourceId), normalizeString(reason, 1000), normalizedCorrelationId, JSON.stringify(beforeState), JSON.stringify(afterState), JSON.stringify(metadata)]
    );
    return;
  }
  await client.query(
    `INSERT INTO oxsteed_credit_audit_events
       (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id,
        reason, before_state, after_state, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)`,
    [actionType, actorUserId || null, customerId, partnerId, resourceType, String(resourceId), normalizeString(reason, 1000), JSON.stringify(beforeState), JSON.stringify(afterState), JSON.stringify(metadata)]
  );
}

function formatCreditAuditEvent(row) {
  return {
    id: String(row.id),
    actionType: row.action_type,
    actorUserId: row.actor_user_id || null,
    customerId: row.customer_id || null,
    partnerId: row.partner_id === null || row.partner_id === undefined ? null : String(row.partner_id),
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    reason: row.reason || null,
    correlationId: row.correlation_id || null,
    previousEventHash: row.previous_event_hash || null,
    eventHash: row.event_hash || null,
    beforeState: row.before_state || null,
    afterState: row.after_state || null,
    metadata: row.metadata || {},
    createdAt: row.created_at || null,
  };
}

async function listCreditAuditEvents({ actionType, resourceType, resourceId, customerId, partnerId, limit = 100, offset = 0, includePagination = false } = {}) {
  const params = [];
  const filters = [];
  const normalizedAction = normalizeString(actionType, 80);
  const normalizedResource = normalizeString(resourceType, 80);
  if (normalizedAction) {
    params.push(normalizedAction);
    filters.push(`action_type = $${params.length}`);
  }
  if (normalizedResource) {
    params.push(normalizedResource);
    filters.push(`resource_type = $${params.length}`);
  }
  const normalizedResourceId = normalizeString(resourceId, 160);
  if (normalizedResourceId) {
    params.push(normalizedResourceId);
    filters.push(`resource_id = $${params.length}`);
  }
  if (customerId) {
    params.push(customerId);
    filters.push(`customer_id = $${params.length}`);
  }
  if (partnerId) {
    params.push(partnerId);
    filters.push(`partner_id = $${params.length}`);
  }
  const parsedLimit = Number.parseInt(String(limit), 10);
  const safeLimit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 250) : 100;
  const parsedOffset = Number.parseInt(String(offset), 10);
  const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1000000) : 0;
  params.push(includePagination ? safeLimit + 1 : safeLimit);
  const limitParam = params.length;
  params.push(safeOffset);
  const offsetParam = params.length;
  const { rows } = await pool.query(
    `SELECT id, action_type, actor_user_id, customer_id, partner_id,
            resource_type, resource_id, reason, correlation_id,
            previous_event_hash, event_hash, before_state, after_state, metadata, created_at
       FROM oxsteed_credit_audit_events
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  const hasMore = includePagination && rows.length > safeLimit;
  const auditEvents = rows.slice(0, safeLimit).map(formatCreditAuditEvent);
  if (!includePagination) return auditEvents;
  return {
    auditEvents,
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      hasMore,
      nextOffset: hasMore ? safeOffset + safeLimit : null,
    },
  };
}

function formatAdminCreditAccountReference(row, prefix) {
  const accountId = row[`${prefix}_account_id`];
  return {
    accountId: accountId === null || accountId === undefined ? null : String(accountId),
    accountType: row[`${prefix}_account_type`] || null,
    customerId: row[`${prefix}_customer_id`] || null,
    customerEmail: row[`${prefix}_customer_email`] || null,
    partnerId: row[`${prefix}_partner_id`] === null || row[`${prefix}_partner_id`] === undefined ? null : String(row[`${prefix}_partner_id`]),
  };
}

function formatAdminCreditEntry(row) {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    accountType: row.account_type || null,
    customerId: row.customer_id || null,
    partnerId: row.partner_id === null || row.partner_id === undefined ? null : String(row.partner_id),
    side: row.entry_side,
    amountCents: Number(row.amount_cents || 0),
    balanceAfterCents: Number(row.balance_after_cents || 0),
    sequence: Number(row.sequence || 0),
    previousEntryHash: row.previous_entry_hash || null,
    entryHash: row.entry_hash || null,
    metadata: row.metadata || {},
    createdAt: row.created_at || null,
  };
}

async function getAdminCreditTransaction(transactionId) {
  const { rows } = await pool.query(
    `SELECT t.id, t.transaction_type, t.status, t.amount_cents, t.currency_code,
            t.partner_id, t.agreement_id, t.reference_type, t.reference_id,
            t.idempotency_key, t.correlation_id, t.description, t.reason, t.actor_type,
            t.actor_user_id, t.metadata, t.posted_at, t.reversed_at,
            t.created_at, t.updated_at,
            da.id AS debit_account_id, da.account_type AS debit_account_type,
            da.customer_id AS debit_customer_id, da.partner_id AS debit_partner_id,
            dcu.email AS debit_customer_email,
            ca.id AS credit_account_id, ca.account_type AS credit_account_type,
            ca.customer_id AS credit_customer_id, ca.partner_id AS credit_partner_id,
            ccu.email AS credit_customer_email,
            fr.display_name AS restaurant_name
       FROM oxsteed_credit_transactions t
       JOIN oxsteed_credit_accounts da ON da.id = t.debit_account_id
       JOIN oxsteed_credit_accounts ca ON ca.id = t.credit_account_id
       LEFT JOIN users dcu ON dcu.id = da.customer_id
       LEFT JOIN users ccu ON ccu.id = ca.customer_id
       LEFT JOIN oxsteed_credit_partners p ON p.id = t.partner_id
       LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
      WHERE t.id = $1
      LIMIT 1`,
    [transactionId]
  );
  if (!rows[0]) throw new AppError('Credit transaction not found', 404, 'credit_transaction_not_found');
  const [entryResult, auditEvents] = await Promise.all([
    pool.query(
      `SELECT e.id, e.account_id, e.entry_side, e.amount_cents,
              e.balance_after_cents, e.sequence, e.previous_entry_hash,
              e.entry_hash, e.metadata, e.created_at,
              a.account_type, a.customer_id, a.partner_id
         FROM oxsteed_credit_transaction_entries e
         JOIN oxsteed_credit_accounts a ON a.id = e.account_id
        WHERE e.transaction_id = $1
        ORDER BY e.id ASC`,
      [transactionId]
    ),
    listCreditAuditEvents({ resourceType: 'credit_transaction', resourceId: transactionId, limit: 100, offset: 0 }),
  ]);
  const row = rows[0];
  return {
    transaction: {
      ...formatAdminCreditTransaction(row),
      idempotencyKey: row.idempotency_key || null,
      correlationId: row.correlation_id || null,
      reversedAt: row.reversed_at || null,
      updatedAt: row.updated_at || null,
      debitAccount: formatAdminCreditAccountReference(row, 'debit'),
      creditAccount: formatAdminCreditAccountReference(row, 'credit'),
      entries: entryResult.rows.map(formatAdminCreditEntry),
      auditEvents,
    },
  };
}

function formatCustomerCreditAccount(row) {
  return {
    accountId: String(row.account_id),
    customerId: String(row.customer_id),
    email: row.email || null,
    name: [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
    isActive: row.is_active === true,
    isBanned: row.is_banned === true,
    currencyCode: row.currency_code,
    balanceCents: Number(row.balance_cents || 0),
    reservedCents: Number(row.reserved_cents || 0),
    availableBalanceCents: Math.max(0, Number(row.balance_cents || 0) - Number(row.reserved_cents || 0)),
    status: row.status,
    ledgerVersion: Number(row.ledger_version || 0),
    lastPostedAt: row.last_posted_at || null,
    updatedAt: row.updated_at || null,
  };
}

function formatAdminCreditTransaction(row) {
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
    currencyCode: row.currency_code,
    direction: row.direction || null,
    debitCustomerId: row.debit_customer_id || null,
    creditCustomerId: row.credit_customer_id || null,
    partnerId: row.partner_id === null || row.partner_id === undefined ? null : String(row.partner_id),
    restaurantName: row.restaurant_name || null,
    agreementId: row.agreement_id || null,
    referenceType,
    referenceId,
    orderId,
    reason: row.reason || null,
    description: row.description || null,
    actorType: row.actor_type || null,
    actorUserId: row.actor_user_id || null,
    metadata: row.metadata || {},
    postedAt: row.posted_at || null,
    createdAt: row.created_at || null,
  };
}

async function listAdminCreditTransactions({ partnerId, transactionType, status, currencyCode, limit = 50, offset = 0, includePagination = false } = {}) {
  const params = [];
  const filters = [];
  if (partnerId !== undefined && partnerId !== null && partnerId !== '') {
    params.push(parsePositiveInt(partnerId, 'partnerId'));
    filters.push(`t.partner_id = $${params.length}`);
  }
  if (transactionType) {
    const normalizedType = normalizeString(transactionType, 32);
    if (!CREDIT_TRANSACTION_TYPES.has(normalizedType)) throw new AppError('Invalid Credit transaction type', 400, 'invalid_credit_transaction_type');
    params.push(normalizedType);
    filters.push(`t.transaction_type = $${params.length}`);
  }
  if (status) {
    const normalizedStatus = normalizeString(status, 20);
    if (!CREDIT_TRANSACTION_STATUSES.has(normalizedStatus)) throw new AppError('Invalid Credit transaction status', 400, 'invalid_credit_transaction_status');
    params.push(normalizedStatus);
    filters.push(`t.status = $${params.length}`);
  }
  if (currencyCode) {
    const currency = assertSupportedCreditCurrency(currencyCode);
    params.push(currency);
    filters.push(`t.currency_code = $${params.length}`);
  }
  const parsedLimit = Number.parseInt(String(limit), 10);
  const safeLimit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 250) : 50;
  const parsedOffset = Number.parseInt(String(offset), 10);
  const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1000000) : 0;
  params.push(includePagination ? safeLimit + 1 : safeLimit);
  const limitParam = params.length;
  params.push(safeOffset);
  const offsetParam = params.length;
  const { rows } = await pool.query(
    `SELECT t.id, t.transaction_type, t.status, t.amount_cents, t.currency_code,
            t.partner_id, t.agreement_id, t.reference_type, t.reference_id,
            t.description, t.reason, t.actor_type, t.actor_user_id, t.metadata,
            t.posted_at, t.created_at,
            da.customer_id AS debit_customer_id,
            ca.customer_id AS credit_customer_id,
            fr.display_name AS restaurant_name
       FROM oxsteed_credit_transactions t
       JOIN oxsteed_credit_accounts da ON da.id = t.debit_account_id
       JOIN oxsteed_credit_accounts ca ON ca.id = t.credit_account_id
       LEFT JOIN oxsteed_credit_partners p ON p.id = t.partner_id
       LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY COALESCE(t.posted_at, t.created_at) DESC, t.id DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  const hasMore = includePagination && rows.length > safeLimit;
  const transactions = rows.slice(0, safeLimit).map(formatAdminCreditTransaction);
  if (!includePagination) return transactions;
  return {
    transactions,
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      hasMore,
      nextOffset: hasMore ? safeOffset + safeLimit : null,
    },
  };
}

function formatAdminCreditHold(row) {
  return {
    id: String(row.id),
    customerId: row.customer_id || null,
    partnerId: row.partner_id === null || row.partner_id === undefined ? null : String(row.partner_id),
    restaurantId: row.restaurant_id === null || row.restaurant_id === undefined ? null : String(row.restaurant_id),
    restaurantName: row.restaurant_name || null,
    agreementId: row.agreement_id || null,
    amountCents: Number(row.amount_cents || 0),
    currencyCode: row.currency_code,
    status: row.status,
    purpose: row.purpose || null,
    referenceType: row.reference_type || null,
    referenceId: row.reference_id || null,
    capturedTransactionId: row.captured_transaction_id || null,
    captureActorType: row.capture_actor_type || null,
    capturedBy: row.captured_by || null,
    captureReason: row.capture_reason || null,
    releaseActorType: row.release_actor_type || null,
    releasedBy: row.released_by || null,
    releaseReason: row.release_reason || null,
    actorEvidenceLegacy: row.actor_evidence_legacy === true,
    expiresAt: row.expires_at || null,
    capturedAt: row.captured_at || null,
    releasedAt: row.released_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function getAdminCustomerCreditAccount({ customerId, currencyCode = 'USD', transactionLimit = 50, holdLimit = 50 } = {}) {
  const currency = assertSupportedCreditCurrency(currencyCode);
  const parsedTransactionLimit = Number.parseInt(String(transactionLimit), 10);
  const parsedHoldLimit = Number.parseInt(String(holdLimit), 10);
  const safeTransactionLimit = Number.isSafeInteger(parsedTransactionLimit) && parsedTransactionLimit > 0 ? Math.min(parsedTransactionLimit, 100) : 50;
  const safeHoldLimit = Number.isSafeInteger(parsedHoldLimit) && parsedHoldLimit > 0 ? Math.min(parsedHoldLimit, 100) : 50;

  const { rows: accountRows } = await pool.query(
    `SELECT a.id AS account_id, a.customer_id, a.currency_code, a.balance_cents,
            a.reserved_cents, a.status, a.ledger_version, a.last_posted_at, a.updated_at,
            u.email, u.first_name, u.last_name, u.is_active, u.is_banned
       FROM oxsteed_credit_accounts a
       JOIN users u ON u.id = a.customer_id AND u.role = 'customer'
      WHERE a.account_type = 'customer_wallet'
        AND a.customer_id = $1
        AND a.currency_code = $2
      LIMIT 1`,
    [customerId, currency]
  );
  const account = accountRows[0];
  if (!account) throw new AppError('Customer credit account not found', 404, 'credit_account_not_found');

  const [transactionResult, holdResult, entitlementResult, auditResult, disputeResult] = await Promise.all([
    pool.query(
      `SELECT t.id, t.transaction_type, t.status, t.amount_cents, t.currency_code,
              t.partner_id, t.agreement_id, t.reference_type, t.reference_id,
              t.description, t.reason, t.actor_type, t.actor_user_id, t.metadata,
              t.posted_at, t.created_at,
              CASE WHEN t.debit_account_id = a.id THEN 'debit' ELSE 'credit' END AS direction,
              fr.display_name AS restaurant_name
         FROM oxsteed_credit_transactions t
         JOIN oxsteed_credit_accounts a ON a.id = $1
         LEFT JOIN food_restaurants fr ON fr.id = (
           SELECT p.restaurant_id
             FROM oxsteed_credit_partners p
            WHERE p.id = t.partner_id
         )
        WHERE (t.debit_account_id = a.id OR t.credit_account_id = a.id)
          AND t.currency_code = $2
        ORDER BY COALESCE(t.posted_at, t.created_at) DESC, t.id DESC
        LIMIT $3`,
      [account.id, currency, safeTransactionLimit]
    ),
    pool.query(
      `SELECT h.id, h.customer_id, h.partner_id, h.agreement_id, h.amount_cents,
              h.currency_code, h.status, h.purpose, h.reference_type, h.reference_id,
              h.captured_transaction_id, h.capture_actor_type, h.captured_by, h.capture_reason,
              h.release_actor_type, h.released_by, h.release_reason,
              h.actor_evidence_legacy,
              h.expires_at, h.captured_at, h.released_at,
              h.created_at, h.updated_at, p.restaurant_id,
              fr.display_name AS restaurant_name
         FROM oxsteed_credit_holds h
         JOIN oxsteed_credit_partners p ON p.id = h.partner_id
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE h.account_id = $1
          AND h.customer_id = $2
          AND h.currency_code = $3
        ORDER BY h.created_at DESC, h.id DESC
        LIMIT $4`,
      [account.id, customerId, currency, safeHoldLimit]
    ),
    listEntitlements({ customerId, limit: 250, offset: 0 }),
    listCreditAuditEvents({ customerId, limit: 100, offset: 0 }),
    listCreditDisputes({ customerId, limit: 100 }),
  ]);

  return {
    account: formatCustomerCreditAccount(account),
    transactions: transactionResult.rows.map(formatAdminCreditTransaction),
    holds: holdResult.rows.map(formatAdminCreditHold),
    entitlements: entitlementResult.entitlements,
    auditEvents: auditResult,
    disputes: disputeResult,
    limits: { transaction: safeTransactionLimit, holds: safeHoldLimit },
  };
}

async function listAdminCustomerCreditAccounts({ search, currencyCode, status, limit = 100, offset = 0 } = {}) {
  const params = [];
  const filters = ["a.account_type = 'customer_wallet'", "u.role = 'customer'"];
  const normalizedSearch = normalizeString(search, 120);
  const normalizedCurrency = currencyCode ? assertSupportedCreditCurrency(currencyCode) : null;
  const normalizedStatus = normalizeString(status, 20);
  if (normalizedSearch) {
    params.push(`%${normalizedSearch}%`);
    filters.push(`(u.email ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length} OR CAST(a.customer_id AS TEXT) ILIKE $${params.length} OR a.currency_code ILIKE $${params.length} OR a.status ILIKE $${params.length})`);
  }
  if (normalizedCurrency) {
    params.push(normalizedCurrency);
    filters.push(`a.currency_code = $${params.length}`);
  }
  if (normalizedStatus) {
    if (!['active', 'suspended', 'closed'].includes(normalizedStatus)) throw new AppError('Invalid customer account status', 400, 'invalid_credit_account_status');
    params.push(normalizedStatus);
    filters.push(`a.status = $${params.length}`);
  }
  const parsedLimit = Number.parseInt(String(limit), 10);
  const safeLimit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 250) : 100;
  const parsedOffset = Number.parseInt(String(offset), 10);
  const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1000000) : 0;
  const filterParams = [...params];
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM oxsteed_credit_accounts a
       JOIN users u ON u.id = a.customer_id
      WHERE ${filters.join(' AND ')}`,
    filterParams
  );
  const total = Number(countRows[0]?.total || 0);
  params.push(safeLimit);
  const limitParam = params.length;
  params.push(safeOffset);
  const offsetParam = params.length;
  const { rows } = await pool.query(
    `SELECT a.id AS account_id, a.customer_id, a.currency_code, a.balance_cents,
            a.reserved_cents, a.status, a.ledger_version, a.last_posted_at, a.updated_at,
            u.email, u.first_name, u.last_name, u.is_active, u.is_banned
       FROM oxsteed_credit_accounts a
       JOIN users u ON u.id = a.customer_id
      WHERE ${filters.join(' AND ')}
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  return {
    accounts: rows.map(formatCustomerCreditAccount),
    total,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: safeOffset + rows.length < total,
  };
}

async function listPartners({ search, status, limit = 200, offset = 0, includePagination = false } = {}) {
  const params = [];
  const filters = [];
  const normalizedSearch = normalizeString(search, 120);
  if (normalizedSearch) {
    params.push(`%${normalizedSearch}%`);
    filters.push(`(fr.display_name ILIKE $${params.length} OR CAST(fr.id AS TEXT) ILIKE $${params.length})`);
  }
  if (status) {
    if (!PARTNER_STATUSES.has(status)) throw new AppError('Invalid partner status', 400, 'invalid_partner_status');
    params.push(status);
    filters.push(`p.status = $${params.length}`);
  }
  const parsedLimit = Number.parseInt(String(limit), 10);
  const safeLimit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 250) : 200;
  const parsedOffset = Number.parseInt(String(offset), 10);
  const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1000000) : 0;
  const filterParams = [...params];
  let total = null;
  if (includePagination) {
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total
         FROM oxsteed_credit_partners p
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}`,
      filterParams
    );
    total = Number(countRows[0]?.total || 0);
  }
  params.push(includePagination ? safeLimit + 1 : safeLimit);
  const limitParam = params.length;
  params.push(safeOffset);
  const offsetParam = params.length;
  const { rows } = await pool.query(
    `SELECT p.*, fr.display_name AS restaurant_name,
            COUNT(a.id)::int AS agreement_count,
            COUNT(a.id) FILTER (WHERE a.status = 'active' AND a.starts_at <= NOW()
              AND (a.ends_at IS NULL OR a.ends_at > NOW()))::int AS active_agreement_count
       FROM oxsteed_credit_partners p
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
       LEFT JOIN oxsteed_credit_partner_agreements a ON a.partner_id = p.id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      GROUP BY p.id, fr.display_name
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  const hasMore = includePagination && rows.length > safeLimit;
  const partners = rows.slice(0, safeLimit).map(formatPartner);
  if (!includePagination) return partners;
  return {
    partners,
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      total,
      hasMore,
      nextOffset: hasMore ? safeOffset + safeLimit : null,
    },
  };
}

async function registerPartner({ restaurantId, businessId = null, settlementCurrencyCode = 'USD', notes, reason, actorUserId, correlationId }) {
  const normalizedRestaurantId = parsePositiveInt(restaurantId, 'restaurantId');
  return withTransaction(pool, async (client) => {
    const { rows: restaurantRows } = await client.query(`SELECT id, business_id, display_name FROM food_restaurants WHERE id = $1 FOR SHARE`, [normalizedRestaurantId]);
    if (!restaurantRows[0]) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const { rows: existingRows } = await client.query(`SELECT p.*, fr.display_name AS restaurant_name FROM oxsteed_credit_partners p JOIN food_restaurants fr ON fr.id = p.restaurant_id WHERE p.restaurant_id = $1 FOR UPDATE`, [normalizedRestaurantId]);
    if (existingRows[0]) return { partner: formatPartner(existingRows[0]), replayed: true };
    const normalizedReason = requireAuditReason(reason);
    const currency = normalizeString(settlementCurrencyCode, 8)?.toUpperCase() || 'USD';
    if (!/^[A-Z]{3}$/.test(currency)) throw new AppError('Invalid settlement currency', 400, 'invalid_settlement_currency');
    assertSupportedCreditCurrency(currency);
    const resolvedBusinessId = businessId || restaurantRows[0].business_id || null;
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, settlement_currency_code, notes, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *, $6::text AS restaurant_name, 0::int AS agreement_count, 0::int AS active_agreement_count`,
      [normalizedRestaurantId, resolvedBusinessId, currency, normalizeString(notes, 2000), actorUserId || null, restaurantRows[0].display_name]
    );
    await insertAudit(client, { actionType: 'credit.partner.created', actorUserId, partnerId: rows[0].id, resourceType: 'credit_partner', resourceId: rows[0].id, reason: normalizedReason, correlationId, afterState: rows[0] });
    return { partner: formatPartner(rows[0]), replayed: false };
  }, 'credit_admin_register_partner');
}

const PARTNER_TRANSITIONS = {
  pending: new Set(['active', 'suspended', 'terminated']),
  active: new Set(['suspended', 'terminated']),
  suspended: new Set(['active', 'terminated']),
  terminated: new Set(),
};

async function transitionPartner({ partnerId, targetStatus, reason, actorUserId, correlationId }) {
  const normalizedPartnerId = parsePositiveInt(partnerId, 'partnerId');
  const normalizedTarget = normalizeString(targetStatus, 24);
  if (!PARTNER_STATUSES.has(normalizedTarget)) throw new AppError('Invalid partner status', 400, 'invalid_partner_status');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT p.*, fr.display_name AS restaurant_name, fr.status AS restaurant_status
         FROM oxsteed_credit_partners p
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE p.id = $1
        FOR UPDATE`,
      [normalizedPartnerId]
    );
    const partner = rows[0];
    if (!partner) throw new AppError('Credit partner not found', 404, 'credit_partner_not_found');
    if (partner.status === normalizedTarget) return { partner: formatPartner(partner), replayed: true };
    if (!PARTNER_TRANSITIONS[partner.status]?.has(normalizedTarget)) {
      throw new AppError(`Cannot move partner from '${partner.status}' to '${normalizedTarget}'`, 409, 'credit_partner_transition_invalid');
    }
    if (normalizedTarget === 'active' && partner.restaurant_status !== 'active') {
      throw new AppError('The restaurant must be active before its credit partner can be activated', 409, 'credit_restaurant_not_active');
    }
    const normalizedReason = requireAuditReason(reason);
    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_partners
          SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [normalizedTarget, normalizedPartnerId]
    );
    await insertAudit(client, {
      actionType: 'credit.partner.transitioned',
      actorUserId,
      partnerId: normalizedPartnerId,
      resourceType: 'credit_partner',
      resourceId: normalizedPartnerId,
      reason: normalizedReason,
      correlationId,
      beforeState: { status: partner.status },
      afterState: { status: normalizedTarget },
    });
    return {
      partner: formatPartner({ ...updatedRows[0], restaurant_name: partner.restaurant_name }),
      replayed: false,
    };
  }, 'credit_admin_transition_partner');
}

async function listAgreements({ partnerId, status, search, limit = 250, offset = 0, includePagination = false } = {}) {
  const params = [];
  const filters = [];
  if (partnerId !== undefined && partnerId !== null && partnerId !== '') {
    params.push(parsePositiveInt(partnerId, 'partnerId'));
    filters.push(`a.partner_id = $${params.length}`);
  }
  if (status) {
    const normalizedStatus = normalizeString(status, 24);
    if (!AGREEMENT_STATUSES.has(normalizedStatus)) throw new AppError('Invalid agreement status', 400, 'invalid_agreement_status');
    params.push(normalizedStatus);
    filters.push(`a.status = $${params.length}`);
  }
  const normalizedSearch = normalizeString(search, 120);
  if (normalizedSearch) {
    params.push(`%${normalizedSearch}%`);
    filters.push(`(fr.display_name ILIKE $${params.length} OR CAST(a.partner_id AS TEXT) ILIKE $${params.length} OR CAST(p.restaurant_id AS TEXT) ILIKE $${params.length})`);
  }
  const parsedLimit = Number.parseInt(String(limit), 10);
  const safeLimit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 250) : 250;
  const parsedOffset = Number.parseInt(String(offset), 10);
  const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1000000) : 0;
  const filterParams = [...params];
  let total = null;
  if (includePagination) {
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total
         FROM oxsteed_credit_partner_agreements a
         JOIN oxsteed_credit_partners p ON p.id = a.partner_id
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}`,
      filterParams
    );
    total = Number(countRows[0]?.total || 0);
  }
  params.push(includePagination ? safeLimit + 1 : safeLimit);
  const limitParam = params.length;
  params.push(safeOffset);
  const offsetParam = params.length;
  const { rows } = await pool.query(
    `SELECT a.*, p.restaurant_id, p.settlement_currency_code, fr.display_name AS restaurant_name
       FROM oxsteed_credit_partner_agreements a
       JOIN oxsteed_credit_partners p ON p.id = a.partner_id
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY a.updated_at DESC, a.version DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  const hasMore = includePagination && rows.length > safeLimit;
  const agreements = rows.slice(0, safeLimit).map(formatAgreement);
  if (!includePagination) return agreements;
  return {
    agreements,
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      total,
      hasMore,
      nextOffset: hasMore ? safeOffset + safeLimit : null,
    },
  };
}

async function listEntitlements({ search, customerId, agreementId, status, limit = 100, offset = 0 } = {}) {
  const params = [];
  const filters = [];
  const normalizedSearch = normalizeString(search, 120);
  if (normalizedSearch) {
    params.push(`%${normalizedSearch}%`);
    filters.push(`(u.email ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length} OR CAST(e.customer_id AS TEXT) ILIKE $${params.length} OR fr.display_name ILIKE $${params.length})`);
  }
  if (customerId) {
    params.push(customerId);
    filters.push(`e.customer_id = $${params.length}`);
  }
  if (agreementId) {
    params.push(agreementId);
    filters.push(`e.agreement_id = $${params.length}`);
  }
  if (status) {
    const normalizedStatus = normalizeString(status, 20);
    if (!ENTITLEMENT_STATUSES.has(normalizedStatus)) throw new AppError('Invalid customer entitlement status', 400, 'invalid_credit_entitlement_status');
    params.push(normalizedStatus);
    filters.push(`e.status = $${params.length}`);
  }
  const parsedLimit = Number.parseInt(String(limit), 10);
  const safeLimit = Math.max(1, Math.min(Number.isSafeInteger(parsedLimit) ? parsedLimit : 100, 250));
  const parsedOffset = Number.parseInt(String(offset), 10);
  const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1000000) : 0;
  params.push(safeLimit);
  const limitParam = params.length;
  params.push(safeOffset);
  const offsetParam = params.length;
  const { rows } = await pool.query(
    `SELECT e.*, u.email, u.first_name, u.last_name,
            a.partner_id, a.version AS agreement_version, a.status AS agreement_status,
            p.restaurant_id, p.settlement_currency_code,
            fr.display_name AS restaurant_name,
            COUNT(*) OVER()::int AS total_count
       FROM oxsteed_credit_customer_entitlements e
       JOIN users u ON u.id = e.customer_id AND u.role = 'customer'
       JOIN oxsteed_credit_partner_agreements a ON a.id = e.agreement_id
       JOIN oxsteed_credit_partners p ON p.id = a.partner_id
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY e.updated_at DESC, e.id DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  const total = Number(rows[0]?.total_count || 0);
  return { entitlements: rows.map(formatEntitlement), total, limit: safeLimit, offset: safeOffset, hasMore: safeOffset + rows.length < total };
}

async function listSettlements({ partnerId, status, currencyCode, limit = 100, offset = 0, includePagination = false } = {}) {
  const params = [];
  const filters = [];
  if (partnerId !== undefined && partnerId !== null && partnerId !== '') {
    params.push(parsePositiveInt(partnerId, 'partnerId'));
    filters.push(`s.partner_id = $${params.length}`);
  }
  if (status) {
    const normalizedStatus = normalizeString(status, 20);
    if (!['pending', 'approved', 'paid', 'disputed', 'voided'].includes(normalizedStatus)) throw new AppError('Invalid settlement status', 400, 'invalid_credit_settlement_status');
    params.push(normalizedStatus);
    filters.push(`s.status = $${params.length}`);
  }
  if (currencyCode) {
    params.push(assertSupportedCreditCurrency(currencyCode));
    filters.push(`s.currency_code = $${params.length}`);
  }
  const safeLimit = Math.max(1, Math.min(Number.parseInt(String(limit), 10) || 100, 250));
  const parsedOffset = Number.parseInt(String(offset), 10);
  const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1000000) : 0;
  params.push(includePagination ? safeLimit + 1 : safeLimit);
  const limitParam = params.length;
  params.push(safeOffset);
  const offsetParam = params.length;
  const { rows } = await pool.query(
    `SELECT s.*, p.restaurant_id, fr.display_name AS restaurant_name
       FROM oxsteed_credit_settlements s
       JOIN oxsteed_credit_partners p ON p.id = s.partner_id
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY s.period_end DESC, s.created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  const hasMore = includePagination && rows.length > safeLimit;
  const settlements = rows.slice(0, safeLimit).map(formatSettlement);
  if (!includePagination) return settlements;
  return {
    settlements,
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      hasMore,
      nextOffset: hasMore ? safeOffset + safeLimit : null,
    },
  };
}

async function createSettlement({ partnerId, agreementId, periodStart, periodEnd, idempotencyKey, actorUserId, paymentReference, reason, metadata, correlationId }) {
  const normalizedPartnerId = parsePositiveInt(partnerId, 'partnerId');
  const starts = parseDate(periodStart, 'periodStart', true);
  const ends = parseDate(periodEnd, 'periodEnd', true);
  if (ends <= starts) throw new AppError('Settlement period end must be after its start', 400, 'credit_settlement_dates_invalid');
  if (ends > new Date()) throw new AppError('Settlement period cannot end in the future', 400, 'credit_settlement_period_future');
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 160);
  if (!normalizedIdempotencyKey) throw new AppError('Idempotency-Key is required for settlements', 400, 'credit_idempotency_key_required');
  const normalizedPaymentReference = normalizeString(paymentReference, 160);
  const normalizedReason = normalizeString(reason, 1000);
  const normalizedMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  return withTransaction(pool, async (client) => {
    const { rows: agreementRows } = await client.query(
      `SELECT a.*, p.status AS partner_status, p.restaurant_id, p.settlement_currency_code,
              fr.display_name AS restaurant_name
         FROM oxsteed_credit_partner_agreements a
         JOIN oxsteed_credit_partners p ON p.id = a.partner_id
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE a.id = $1 AND a.partner_id = $2
        FOR SHARE`,
      [agreementId, normalizedPartnerId]
    );
    const agreement = agreementRows[0];
    if (!agreement) throw new AppError('Credit agreement not found for settlement', 404, 'credit_agreement_not_found');
    const requestHash = settlementRequestHash({
      partnerId: normalizedPartnerId,
      agreementId,
      currencyCode: agreement.settlement_currency_code,
      periodStart: starts,
      periodEnd: ends,
      paymentReference: normalizedPaymentReference,
      reason: normalizedReason,
      metadata: normalizedMetadata,
    });
    // Serialize settlement periods for one agreement so concurrent admins cannot
    // both pass the overlap check before either transaction inserts a row.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [`oxsteed-credit-settlement:${normalizedPartnerId}:${agreementId}`]
    );
    const { rows: existingRows } = await client.query(`SELECT s.*, p.restaurant_id, fr.display_name AS restaurant_name FROM oxsteed_credit_settlements s JOIN oxsteed_credit_partners p ON p.id = s.partner_id JOIN food_restaurants fr ON fr.id = p.restaurant_id WHERE s.idempotency_key = $1 FOR UPDATE`, [normalizedIdempotencyKey]);
    if (existingRows[0]) {
      assertSettlementIdempotencyReplayMatches(existingRows[0], {
        partnerId: normalizedPartnerId,
        agreementId,
        currencyCode: agreement.settlement_currency_code,
        periodStart: starts,
        periodEnd: ends,
        paymentReference: normalizedPaymentReference,
        reason: normalizedReason,
        metadata: normalizedMetadata,
        requestHash,
      });
      return { settlement: formatSettlement(existingRows[0]), replayed: true };
    }
    const requiredReason = requireAuditReason(normalizedReason);
    if (agreement.partner_status === 'terminated') throw new AppError('Terminated credit partners cannot be settled', 409, 'credit_partner_terminated');
    if (!['active', 'suspended', 'expired'].includes(agreement.status)) {
      throw new AppError('This agreement is not eligible for settlement', 409, 'credit_agreement_not_settlementable');
    }
    if (starts < new Date(agreement.starts_at)
      || (agreement.ends_at && ends > new Date(agreement.ends_at))) {
      throw new AppError('Settlement period must fall within the agreement dates', 409, 'credit_settlement_period_outside_agreement');
    }
    const { rows: overlapRows } = await client.query(
      `SELECT id, status
         FROM oxsteed_credit_settlements
        WHERE partner_id = $1 AND agreement_id = $2 AND status <> 'voided'
          AND period_start < $4 AND period_end > $3
        LIMIT 1
        FOR SHARE`,
      [normalizedPartnerId, agreementId, starts, ends]
    );
    if (overlapRows[0]) throw new AppError('Settlement period overlaps an existing non-voided settlement', 409, 'credit_settlement_period_overlap', { settlementId: String(overlapRows[0].id), status: overlapRows[0].status });
    const { rows: totals } = await client.query(
      `SELECT
         COALESCE(SUM(t.amount_cents) FILTER (WHERE t.transaction_type = 'purchase'), 0) AS gross_cents,
         COALESCE(SUM(t.amount_cents) FILTER (WHERE t.transaction_type = 'refund'), 0) AS refund_cents,
         COALESCE(SUM(t.amount_cents) FILTER (WHERE t.transaction_type = 'fee'), 0) AS fee_cents
       FROM oxsteed_credit_transactions t
       WHERE t.partner_id = $1 AND t.agreement_id = $2 AND t.status = 'posted'
         AND COALESCE(t.posted_at, t.created_at) >= $3
         AND COALESCE(t.posted_at, t.created_at) < $4
         AND t.currency_code = $5`,
      [normalizedPartnerId, agreementId, starts, ends, agreement.settlement_currency_code]
    );
    const grossCents = Number(totals[0]?.gross_cents || 0);
    const refundCents = Number(totals[0]?.refund_cents || 0);
    const feeCents = Number(totals[0]?.fee_cents || 0);
    const netCents = Math.max(0, grossCents - refundCents - feeCents);
    if (!actorUserId) {
      throw new AppError('An identified administrator is required to create a Credit settlement', 400, 'credit_settlement_creator_required');
    }
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_settlements
         (partner_id, agreement_id, currency_code, period_start, period_end,
          gross_cents, refund_cents, fee_cents, net_cents, payment_reference,
          idempotency_key, metadata, creation_reason, creation_request_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [normalizedPartnerId, agreementId, agreement.settlement_currency_code, starts, ends, grossCents, refundCents, feeCents, netCents, normalizedPaymentReference, normalizedIdempotencyKey, JSON.stringify(normalizedMetadata), requiredReason, requestHash, actorUserId || null]
    );
    if (!rows[0]) {
      const { rows: conflictRows } = await client.query(
        `SELECT s.*, p.restaurant_id, fr.display_name AS restaurant_name
           FROM oxsteed_credit_settlements s
           JOIN oxsteed_credit_partners p ON p.id = s.partner_id
           JOIN food_restaurants fr ON fr.id = p.restaurant_id
          WHERE s.idempotency_key = $1
          FOR UPDATE`,
        [normalizedIdempotencyKey]
      );
      if (!conflictRows[0]) throw new AppError('Settlement could not be confirmed after an idempotent retry', 409, 'credit_settlement_retry_required');
      assertSettlementIdempotencyReplayMatches(conflictRows[0], {
        partnerId: normalizedPartnerId,
        agreementId,
        currencyCode: agreement.settlement_currency_code,
        periodStart: starts,
        periodEnd: ends,
        paymentReference: normalizedPaymentReference,
        reason: requiredReason,
        metadata: normalizedMetadata,
        requestHash,
      });
      return { settlement: formatSettlement(conflictRows[0]), replayed: true };
    }
    await insertAudit(client, { actionType: 'credit.settlement.created', actorUserId, partnerId: normalizedPartnerId, resourceType: 'credit_settlement', resourceId: rows[0].id, reason: requiredReason, correlationId, afterState: rows[0] });
    return { settlement: formatSettlement({ ...rows[0], restaurant_id: agreement.restaurant_id, restaurant_name: agreement.restaurant_name }), replayed: false };
  }, 'credit_admin_create_settlement');
}

const SETTLEMENT_TRANSITIONS = {
  pending: new Set(['approved', 'disputed', 'voided']),
  approved: new Set(['paid', 'disputed', 'voided']),
  paid: new Set(['disputed']),
  disputed: new Set(['approved', 'voided']),
  voided: new Set(),
};

async function transitionSettlement({ settlementId, targetStatus, actorUserId, reason, paymentReference, correlationId }) {
  const normalizedTarget = normalizeString(targetStatus, 20);
  if (!['pending', 'approved', 'paid', 'disputed', 'voided'].includes(normalizedTarget)) throw new AppError('Invalid settlement status', 400, 'invalid_credit_settlement_status');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT s.*, p.restaurant_id, p.status AS partner_status, p.settlement_currency_code,
              fr.display_name AS restaurant_name
         FROM oxsteed_credit_settlements s
         JOIN oxsteed_credit_partners p ON p.id = s.partner_id
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE s.id = $1
        FOR UPDATE`,
      [settlementId]
    );
    const settlement = rows[0];
    if (!settlement) throw new AppError('Credit settlement not found', 404, 'credit_settlement_not_found');
    const requestedPaymentReference = normalizeString(paymentReference, 160);
    if (settlement.status === normalizedTarget) {
      if (normalizedTarget === 'paid'
        && requestedPaymentReference
        && settlement.payment_reference
        && requestedPaymentReference !== settlement.payment_reference) {
        throw new AppError('A paid Credit settlement cannot change its payment reference', 409, 'credit_settlement_payment_reference_conflict');
      }
      return { settlement: formatSettlement(settlement), replayed: true };
    }
    if (!SETTLEMENT_TRANSITIONS[settlement.status]?.has(normalizedTarget)) throw new AppError(`Cannot move settlement from '${settlement.status}' to '${normalizedTarget}'`, 409, 'credit_settlement_transition_invalid');
    if (normalizedTarget === 'approved' && !actorUserId) {
      throw new AppError('An identified admin is required to approve a settlement', 400, 'credit_settlement_approver_required');
    }
    if (normalizedTarget === 'paid') {
      if (settlement.partner_status !== 'active') throw new AppError('Partner must be active before settlement is paid', 409, 'credit_partner_not_active');
      const resolvedPaymentReference = requestedPaymentReference || settlement.payment_reference || null;
      if (settlement.payment_reference
        && resolvedPaymentReference
        && resolvedPaymentReference !== settlement.payment_reference) {
        throw new AppError('A Credit settlement payment reference cannot change after it is recorded', 409, 'credit_settlement_payment_reference_conflict');
      }
      if (Number(settlement.net_cents || 0) > 0 && !resolvedPaymentReference) {
        throw new AppError('A payment reference is required before a settlement can be marked paid', 400, 'credit_settlement_payment_reference_required');
      }
      if (!settlement.approved_by) {
        throw new AppError('Settlement approval evidence is required before payment', 409, 'credit_settlement_approval_required');
      }
      if (Number(settlement.net_cents || 0) === 0) {
        const normalizedReason = requireAuditReason(reason);
        const { rows: zeroPaidRows } = await client.query(
          `UPDATE oxsteed_credit_settlements
              SET status = 'paid', payment_reference = COALESCE($1, payment_reference), paid_at = NOW(), updated_at = NOW()
            WHERE id = $2
            RETURNING *`,
          [resolvedPaymentReference, settlement.id]
        );
        await insertAudit(client, { actionType: 'credit.settlement.paid', actorUserId, partnerId: settlement.partner_id, resourceType: 'credit_settlement', resourceId: settlement.id, reason: normalizedReason, correlationId, beforeState: { status: settlement.status }, afterState: { status: 'paid', amountCents: 0 } });
        return { settlement: formatSettlement({ ...zeroPaidRows[0], restaurant_id: settlement.restaurant_id, restaurant_name: settlement.restaurant_name }), replayed: false };
      }
      const partnerAccount = await ensureAccount(client, { accountType: 'partner_payable', partnerId: settlement.partner_id, currencyCode: settlement.currency_code });
      if (Number(partnerAccount.balance_cents || 0) < Number(settlement.net_cents || 0)) {
        throw new AppError('Partner payable balance is lower than this settlement', 409, 'credit_settlement_balance_insufficient', {
          payableCents: String(partnerAccount.balance_cents || 0),
          settlementCents: String(settlement.net_cents || 0),
        });
      }
      const normalizedReason = requireAuditReason(reason);
      const treasuryAccount = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: settlement.currency_code });
      const payment = await postJournalTransaction(client, {
        transactionType: 'settlement',
        debitAccountId: partnerAccount.id,
        creditAccountId: treasuryAccount.id,
        amountCents: Number(settlement.net_cents),
        currencyCode: settlement.currency_code,
        partnerId: settlement.partner_id,
        agreementId: settlement.agreement_id,
        idempotencyKey: `credit-settlement:${settlement.id}`,
        actorType: 'admin',
        actorUserId,
        referenceType: 'credit_settlement',
        referenceId: String(settlement.id),
        reason: normalizedReason,
        description: 'OxSteed Credit partner settlement',
        metadata: { paymentReference: resolvedPaymentReference },
      });
      if (payment.replayed) {
        const committedPaymentReference = normalizeString(payment.transaction?.metadata?.paymentReference, 160);
        if (committedPaymentReference !== resolvedPaymentReference) {
          throw new AppError('Credit settlement payment evidence does not match its journal entry', 409, 'credit_settlement_payment_reference_conflict');
        }
      }
      const { rows: paidRows } = await client.query(
        `UPDATE oxsteed_credit_settlements
            SET status = 'paid', payment_reference = COALESCE($1, payment_reference), paid_at = NOW(), updated_at = NOW()
          WHERE id = $2
          RETURNING *`,
        [resolvedPaymentReference, settlement.id]
      );
      await insertAudit(client, { actionType: 'credit.settlement.paid', actorUserId, partnerId: settlement.partner_id, resourceType: 'credit_settlement', resourceId: settlement.id, reason: normalizedReason, correlationId, beforeState: { status: settlement.status }, afterState: { status: 'paid', transactionId: payment.transaction.id } });
      return { settlement: formatSettlement({ ...paidRows[0], restaurant_id: settlement.restaurant_id, restaurant_name: settlement.restaurant_name }), transaction: payment.transaction, replayed: false };
    }
    const normalizedReason = requireAuditReason(reason);
    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_settlements
          SET status = $1,
              approved_by = CASE WHEN $1 = 'approved' THEN $2 ELSE approved_by END,
              payment_reference = COALESCE($3, payment_reference), updated_at = NOW()
        WHERE id = $4
        RETURNING *`,
      [normalizedTarget, actorUserId || null, normalizeString(paymentReference, 160), settlement.id]
    );
    await insertAudit(client, { actionType: 'credit.settlement.transitioned', actorUserId, partnerId: settlement.partner_id, resourceType: 'credit_settlement', resourceId: settlement.id, reason: normalizedReason, correlationId, beforeState: { status: settlement.status }, afterState: { status: normalizedTarget } });
    return { settlement: formatSettlement({ ...updatedRows[0], restaurant_id: settlement.restaurant_id, restaurant_name: settlement.restaurant_name }), replayed: false };
  }, 'credit_admin_transition_settlement');
}

async function reconcileCreditLedger({ currencyCode = 'USD', periodStart, periodEnd, actorUserId, reason, correlationId }) {
  const currency = assertSupportedCreditCurrency(currencyCode);
  const starts = parseDate(periodStart, 'periodStart', true);
  const ends = parseDate(periodEnd, 'periodEnd', true);
  if (ends <= starts) throw new AppError('Reconciliation period end must be after its start', 400, 'credit_reconciliation_dates_invalid');
  const normalizedReason = actorUserId ? requireAuditReason(reason) : normalizeString(reason, 1000) || 'Automated reconciliation';
  return withTransaction(pool, async (client) => {
    const reconciliationScope = 'all_time_ledger';
    const { rows: resultRows } = await client.query(
      `WITH derived AS (
         SELECT account_id,
                COALESCE(SUM(CASE WHEN entry_side = 'credit' THEN amount_cents ELSE -amount_cents END), 0) AS journal_cents,
                COUNT(*)::int AS entries
           FROM oxsteed_credit_transaction_entries
           JOIN oxsteed_credit_transactions t ON t.id = oxsteed_credit_transaction_entries.transaction_id
          WHERE t.status = 'posted' AND t.currency_code = $1
          GROUP BY account_id
       ), checks AS (
         SELECT a.id,
                a.balance_cents,
                COALESCE(d.journal_cents, 0) AS journal_cents,
                COALESCE(d.entries, 0) AS entries,
                ABS(a.balance_cents - COALESCE(d.journal_cents, 0)) AS difference
           FROM oxsteed_credit_accounts a
           LEFT JOIN derived d ON d.account_id = a.id
          WHERE a.currency_code = $1
       )
       SELECT COALESCE(SUM(balance_cents), 0) AS account_balance_cents,
              COALESCE(SUM(journal_cents), 0) AS journal_balance_cents,
              COALESCE(SUM(difference), 0) AS difference_cents,
              COUNT(*)::int AS account_count,
              COALESCE(SUM(entries), 0)::int AS entry_count
         FROM checks`,
      [currency]
    );
    const result = resultRows[0] || {};
    const differenceCents = Number(result.difference_cents || 0);
    const hashIntegrity = await verifyCreditLedgerHashes(client, currency);
    const hashesValid = Object.values(hashIntegrity).every((count) => count === 0);
    const status = !hashesValid ? 'failed' : differenceCents === 0 ? 'balanced' : 'difference';
    const integrityMetadata = { scope: reconciliationScope, requestedPeriodStart: starts.toISOString(), requestedPeriodEnd: ends.toISOString(), hashIntegrity };
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_reconciliation_runs
         (currency_code, period_start, period_end, status, account_balance_cents,
          journal_balance_cents, difference_cents, account_count, entry_count,
          completed_by, completed_at, error_message, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12::jsonb)
       RETURNING *`,
      [currency, starts, ends, status, Number(result.account_balance_cents || 0), Number(result.journal_balance_cents || 0), differenceCents, Number(result.account_count || 0), Number(result.entry_count || 0), actorUserId || null, hashesValid ? null : 'Credit ledger hash integrity check failed', JSON.stringify(integrityMetadata)]
    );
    await insertAudit(client, { actionType: `credit.reconciliation.${status}`, actorUserId, resourceType: 'credit_reconciliation_run', resourceId: rows[0].id, reason: normalizedReason, correlationId, afterState: rows[0] });
    return {
      run: {
        id: rows[0].id,
        currencyCode: rows[0].currency_code,
        periodStart: rows[0].period_start,
        periodEnd: rows[0].period_end,
        status: rows[0].status,
        accountBalanceCents: Number(rows[0].account_balance_cents),
        journalBalanceCents: Number(rows[0].journal_balance_cents),
        differenceCents: Number(rows[0].difference_cents),
        accountCount: Number(rows[0].account_count),
        entryCount: Number(rows[0].entry_count),
        scope: reconciliationScope,
        integrity: hashIntegrity,
        completedAt: rows[0].completed_at,
      },
    };
  }, 'credit_admin_reconcile');
}

async function createAgreement({ partnerId, startsAt, endsAt, customerTerms, allowedOrderTypes, allowedCategories, allowedMenuItemIds, geography, maxTransactionCents, dailyCustomerLimitCents, lifetimeCustomerLimitCents, requiresCustomerEntitlement = false, metadata, reason, idempotencyKey, actorUserId, correlationId }) {
  const normalizedPartnerId = parsePositiveInt(partnerId, 'partnerId');
  const starts = parseDate(startsAt, 'startsAt', true);
  const ends = parseDate(endsAt, 'endsAt');
  if (ends && ends <= starts) throw new AppError('Agreement end must be after its start', 400, 'credit_agreement_dates_invalid');
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 160);
  if (!normalizedIdempotencyKey) throw new AppError('Idempotency-Key is required for agreement creation', 400, 'credit_idempotency_key_required');
  const normalizedCustomerTerms = normalizeString(customerTerms, 5000);
  const normalizedAllowedOrderTypes = normalizeArray(allowedOrderTypes, 20, 40);
  const normalizedAllowedCategories = normalizeArray(allowedCategories, 100, 120);
  const normalizedAllowedMenuItemIds = normalizePositiveIntArray(allowedMenuItemIds, 500);
  const normalizedGeography = geography && typeof geography === 'object' && !Array.isArray(geography) ? geography : {};
  const normalizedMaxTransactionCents = parseLimit(maxTransactionCents, 'maxTransactionCents');
  const normalizedDailyCustomerLimitCents = parseLimit(dailyCustomerLimitCents, 'dailyCustomerLimitCents');
  const normalizedLifetimeCustomerLimitCents = parseLimit(lifetimeCustomerLimitCents, 'lifetimeCustomerLimitCents');
  const normalizedRequiresCustomerEntitlement = requiresCustomerEntitlement === true;
  const normalizedMetadata = metadata && typeof metadata === 'object' ? metadata : {};
  const requestHash = agreementRequestHash({
    partnerId: normalizedPartnerId,
    startsAt: starts,
    endsAt: ends,
    customerTerms: normalizedCustomerTerms,
    allowedOrderTypes: normalizedAllowedOrderTypes,
    allowedCategories: normalizedAllowedCategories,
    allowedMenuItemIds: normalizedAllowedMenuItemIds,
    geography: normalizedGeography,
    maxTransactionCents: normalizedMaxTransactionCents,
    dailyCustomerLimitCents: normalizedDailyCustomerLimitCents,
    lifetimeCustomerLimitCents: normalizedLifetimeCustomerLimitCents,
    requiresCustomerEntitlement: normalizedRequiresCustomerEntitlement,
    metadata: normalizedMetadata,
  });
  return withTransaction(pool, async (client) => {
    const { rows: existingRows } = await client.query(
      `SELECT a.*, p.restaurant_id, p.settlement_currency_code, fr.display_name AS restaurant_name
         FROM oxsteed_credit_partner_agreements a
         JOIN oxsteed_credit_partners p ON p.id = a.partner_id
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE a.creation_idempotency_key = $1
        FOR UPDATE`,
      [normalizedIdempotencyKey]
    );
    if (existingRows[0]) {
      if (existingRows[0].creation_request_hash !== requestHash) {
        throw new AppError('Agreement idempotency key was already used for different agreement details', 409, 'credit_agreement_idempotency_conflict');
      }
      return { agreement: formatAgreement(existingRows[0]), replayed: true };
    }
    const { rows: partnerRows } = await client.query(`SELECT * FROM oxsteed_credit_partners WHERE id = $1 FOR UPDATE`, [normalizedPartnerId]);
    if (!partnerRows[0]) throw new AppError('Credit partner not found', 404, 'credit_partner_not_found');
    if (partnerRows[0].status === 'terminated') throw new AppError('Terminated credit partners cannot receive new agreements', 409, 'credit_partner_terminated');
    const normalizedReason = requireAuditReason(reason);
    const { rows: versionRows } = await client.query(`SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM oxsteed_credit_partner_agreements WHERE partner_id = $1`, [normalizedPartnerId]);
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_partner_agreements
         (partner_id, version, starts_at, ends_at, customer_terms, allowed_order_types,
         allowed_categories, allowed_menu_item_ids, geography, max_transaction_cents,
          daily_customer_limit_cents, lifetime_customer_limit_cents, metadata,
          requires_customer_entitlement, creation_idempotency_key, creation_request_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7::text[], $8::bigint[], $9::jsonb, $10, $11, $12, $13::jsonb, $14, $15, $16, $17)
       RETURNING *`,
      [normalizedPartnerId, Number(versionRows[0].next_version), starts, ends, normalizedCustomerTerms, normalizedAllowedOrderTypes, normalizedAllowedCategories, normalizedAllowedMenuItemIds, JSON.stringify(normalizedGeography), normalizedMaxTransactionCents, normalizedDailyCustomerLimitCents, normalizedLifetimeCustomerLimitCents, JSON.stringify(normalizedMetadata), normalizedRequiresCustomerEntitlement, normalizedIdempotencyKey, requestHash, actorUserId || null]
    );
    await insertAudit(client, { actionType: 'credit.agreement.created', actorUserId, partnerId: normalizedPartnerId, resourceType: 'credit_agreement', resourceId: rows[0].id, reason: normalizedReason, correlationId, afterState: rows[0] });
    return { agreement: formatAgreement({ ...rows[0], partner_id: normalizedPartnerId }), replayed: false };
  }, 'credit_admin_create_agreement');
}

const ALLOWED_TRANSITIONS = {
  draft: new Set(['pending_approval', 'terminated']),
  pending_approval: new Set(['draft', 'active', 'terminated']),
  active: new Set(['suspended', 'expired', 'terminated']),
  suspended: new Set(['active', 'terminated']),
  expired: new Set(['terminated']),
  terminated: new Set(),
};

async function transitionAgreement({ agreementId, targetStatus, reason, actorUserId, correlationId }) {
  const normalizedTarget = normalizeString(targetStatus, 24);
  if (!AGREEMENT_STATUSES.has(normalizedTarget)) throw new AppError('Invalid agreement status', 400, 'invalid_agreement_status');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT a.*, p.status AS partner_status, p.restaurant_id, fr.display_name AS restaurant_name
         FROM oxsteed_credit_partner_agreements a
         JOIN oxsteed_credit_partners p ON p.id = a.partner_id
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE a.id = $1
        FOR UPDATE`,
      [agreementId]
    );
    const agreement = rows[0];
    if (!agreement) throw new AppError('Credit agreement not found', 404, 'credit_agreement_not_found');
    if (agreement.status === normalizedTarget) return { agreement: formatAgreement(agreement), replayed: true };
    if (!ALLOWED_TRANSITIONS[agreement.status]?.has(normalizedTarget)) {
      throw new AppError(`Cannot move agreement from '${agreement.status}' to '${normalizedTarget}'`, 409, 'credit_agreement_transition_invalid');
    }
    if (normalizedTarget === 'active') {
      if (agreement.partner_status !== 'active') throw new AppError('Activate the credit partner before activating its agreement', 409, 'credit_partner_not_active');
      if (agreement.ends_at && new Date(agreement.ends_at) <= new Date()) throw new AppError('An expired agreement cannot be activated', 409, 'credit_agreement_expired');
      const { rows: activeAgreementRows } = await client.query(
        `SELECT id
           FROM oxsteed_credit_partner_agreements
          WHERE partner_id = $1 AND status = 'active' AND id <> $2
          FOR UPDATE`,
        [agreement.partner_id, agreement.id]
      );
      if (activeAgreementRows[0]) {
        throw new AppError('This partner already has an active agreement; suspend it before activating another version', 409, 'credit_active_agreement_conflict', {
          activeAgreementId: String(activeAgreementRows[0].id),
        });
      }
    }
    const normalizedReason = requireAuditReason(reason);
    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_partner_agreements
          SET status = $1,
              approved_by = CASE WHEN $1 = 'active' THEN $2 ELSE approved_by END,
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [normalizedTarget, actorUserId || null, agreementId]
    );
    await insertAudit(client, { actionType: 'credit.agreement.transitioned', actorUserId, partnerId: agreement.partner_id, resourceType: 'credit_agreement', resourceId: agreement.id, reason: normalizedReason, correlationId, beforeState: { status: agreement.status }, afterState: { status: normalizedTarget } });
    return { agreement: formatAgreement({ ...updatedRows[0], partner_id: agreement.partner_id, restaurant_id: agreement.restaurant_id, restaurant_name: agreement.restaurant_name }), replayed: false };
  }, 'credit_admin_transition_agreement');
}

async function upsertEntitlement({ agreementId, customerId, status = 'active', startsAt, endsAt, maxTransactionCents, dailyLimitCents, reason, metadata, actorUserId, idempotencyKey, correlationId }) {
  const normalizedStatus = normalizeString(status, 20) || 'active';
  if (!ENTITLEMENT_STATUSES.has(normalizedStatus)) throw new AppError('Invalid customer entitlement status', 400, 'invalid_credit_entitlement_status');
  const normalizedReason = requireAuditReason(reason);
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 160);
  if (!normalizedIdempotencyKey) throw new AppError('Idempotency-Key is required for customer access', 400, 'credit_idempotency_key_required');
  const starts = parseDate(startsAt, 'startsAt');
  const ends = parseDate(endsAt, 'endsAt');
  if (starts && ends && ends <= starts) throw new AppError('Entitlement end must be after its start', 400, 'credit_entitlement_dates_invalid');
  const maxTransaction = parseLimit(maxTransactionCents, 'maxTransactionCents');
  const dailyLimit = parseLimit(dailyLimitCents, 'dailyLimitCents');
  const normalizedMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  const requestHash = entitlementRequestHash({
    agreementId,
    customerId,
    status: normalizedStatus,
    startsAt: starts,
    endsAt: ends,
    maxTransactionCents: maxTransaction,
    dailyLimitCents: dailyLimit,
    reason: normalizedReason,
    metadata: normalizedMetadata,
  });
  return withTransaction(pool, async (client) => {
    const { rows: agreementRows } = await client.query(
      `SELECT a.*, p.status AS partner_status, fr.status AS restaurant_status
         FROM oxsteed_credit_partner_agreements a
         JOIN oxsteed_credit_partners p ON p.id = a.partner_id
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE a.id = $1
        FOR SHARE`,
      [agreementId]
    );
    if (!agreementRows[0]) throw new AppError('Credit agreement not found', 404, 'credit_agreement_not_found');
    if (normalizedStatus === 'active') assertEntitlementAgreementCanBeActive(agreementRows[0]);
    const { rows: userRows } = await client.query(`SELECT id FROM users WHERE id = $1 AND role = 'customer' AND is_active = TRUE`, [customerId]);
    if (!userRows[0]) throw new AppError('Customer not found', 404, 'customer_not_found');
    const serializedMetadata = JSON.stringify(normalizedMetadata);
    const values = [normalizedStatus, starts, ends, maxTransaction, dailyLimit, serializedMetadata, normalizedReason, actorUserId || null];
    const { rows: requestRows } = await client.query(
      `INSERT INTO oxsteed_credit_entitlement_requests
         (idempotency_key, request_hash, customer_id, agreement_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING idempotency_key, request_hash, response_payload`,
      [normalizedIdempotencyKey, requestHash, customerId, agreementId, actorUserId || null]
    );
    if (!requestRows[0]) {
      const { rows: existingRequestRows } = await client.query(
        `SELECT idempotency_key, request_hash, response_payload
           FROM oxsteed_credit_entitlement_requests
          WHERE idempotency_key = $1
          FOR UPDATE`,
        [normalizedIdempotencyKey]
      );
      const existingRequest = existingRequestRows[0];
      if (!existingRequest) throw new AppError('Customer access could not be confirmed after an idempotent retry', 409, 'credit_entitlement_retry_required');
      if (existingRequest.request_hash !== requestHash) {
        throw new AppError('Customer access idempotency key was already used for different details', 409, 'credit_entitlement_idempotency_conflict');
      }
      if (existingRequest.response_payload !== null && existingRequest.response_payload !== undefined) {
        if (!existingRequest.response_payload.entitlement) {
          throw new AppError('Customer access replay result is invalid; please retry with a new key', 409, 'credit_entitlement_retry_required');
        }
        return { entitlement: existingRequest.response_payload.entitlement, replayed: true };
      }
      const { rows: replayRows } = await client.query(
        `SELECT *
           FROM oxsteed_credit_customer_entitlements
          WHERE customer_id = $1 AND agreement_id = $2
          FOR SHARE`,
        [customerId, agreementId]
      );
      if (!replayRows[0]) throw new AppError('Customer access replay is incomplete; please retry with a new key', 409, 'credit_entitlement_retry_required');
      return { entitlement: formatEntitlement(replayRows[0]), replayed: true };
    }
    let beforeState = null;
    let rows;
    const { rows: existingRows } = await client.query(
      `SELECT *
         FROM oxsteed_credit_customer_entitlements
        WHERE customer_id = $1 AND agreement_id = $2
        FOR UPDATE`,
      [customerId, agreementId]
    );
    if (existingRows[0]) {
      beforeState = snapshotEntitlement(existingRows[0]);
      ({ rows } = await client.query(
        `UPDATE oxsteed_credit_customer_entitlements
            SET status = $1, starts_at = $2, ends_at = $3, max_transaction_cents = $4,
                daily_limit_cents = $5, metadata = $6::jsonb, reason = $7,
                created_by = $8, updated_at = NOW()
          WHERE id = $9
          RETURNING *`,
        [...values, existingRows[0].id]
      ));
    } else {
      ({ rows } = await client.query(
        `INSERT INTO oxsteed_credit_customer_entitlements
           (customer_id, agreement_id, status, starts_at, ends_at, max_transaction_cents,
            daily_limit_cents, metadata, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
         ON CONFLICT (customer_id, agreement_id) DO NOTHING
         RETURNING *`,
        [customerId, agreementId, ...values]
      ));
      if (!rows[0]) {
        const { rows: conflictedRows } = await client.query(
          `SELECT *
             FROM oxsteed_credit_customer_entitlements
            WHERE customer_id = $1 AND agreement_id = $2
            FOR UPDATE`,
          [customerId, agreementId]
        );
        if (!conflictedRows[0]) throw new AppError('Credit entitlement could not be saved', 409, 'credit_entitlement_conflict');
        beforeState = snapshotEntitlement(conflictedRows[0]);
        ({ rows } = await client.query(
          `UPDATE oxsteed_credit_customer_entitlements
              SET status = $1, starts_at = $2, ends_at = $3, max_transaction_cents = $4,
                  daily_limit_cents = $5, metadata = $6::jsonb, reason = $7,
                  created_by = $8, updated_at = NOW()
            WHERE id = $9
            RETURNING *`,
          [...values, conflictedRows[0].id]
        ));
      }
    }
    await insertAudit(client, { actionType: 'credit.entitlement.upserted', actorUserId, customerId, partnerId: agreementRows[0].partner_id, resourceType: 'credit_entitlement', resourceId: rows[0].id, reason: normalizedReason, correlationId, beforeState, afterState: snapshotEntitlement(rows[0]) });
    const result = { entitlement: formatEntitlement(rows[0]), replayed: false };
    const { rows: resultRows } = await client.query(
      `UPDATE oxsteed_credit_entitlement_requests
          SET response_payload = $1::jsonb
        WHERE idempotency_key = $2 AND response_payload IS NULL
        RETURNING idempotency_key`,
      [JSON.stringify(result), normalizedIdempotencyKey]
    );
    if (!resultRows[0]) throw new AppError('Customer access result could not be recorded for retry safety', 409, 'credit_entitlement_retry_required');
    return result;
  }, 'credit_admin_upsert_entitlement');
}

function normalizeBulkAgreementIds(agreementIds) {
  if (!Array.isArray(agreementIds) || agreementIds.length === 0) {
    throw new AppError('At least one credit agreement is required', 400, 'credit_entitlement_agreements_required');
  }
  const ids = [...new Set(agreementIds.map((value) => normalizeString(value, 80)).filter(Boolean))];
  if (ids.length > MAX_BULK_ENTITLEMENTS) {
    throw new AppError(`A bulk entitlement action cannot include more than ${MAX_BULK_ENTITLEMENTS} agreements`, 400, 'credit_entitlement_bulk_limit_exceeded', { maxAgreements: MAX_BULK_ENTITLEMENTS });
  }
  if (ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    throw new AppError('Every credit agreement ID must be a valid UUID', 400, 'credit_entitlement_agreement_invalid');
  }
  return ids;
}

function bulkEntitlementRequestHash({ agreementIds, customerId, status, startsAt, endsAt, maxTransactionCents, dailyLimitCents, reason, metadata }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    agreementIds: [...agreementIds].sort(),
    customerId,
    status,
    startsAt: startsAt?.toISOString() || null,
    endsAt: endsAt?.toISOString() || null,
    maxTransactionCents,
    dailyLimitCents,
    reason,
    metadata,
  })).digest('hex');
}

function entitlementRequestHash({ agreementId, customerId, status, startsAt, endsAt, maxTransactionCents, dailyLimitCents, reason, metadata }) {
  return crypto.createHash('sha256').update(stableStringify({
    agreementId: String(agreementId),
    customerId: String(customerId),
    status,
    startsAt: startsAt?.toISOString() || null,
    endsAt: endsAt?.toISOString() || null,
    maxTransactionCents,
    dailyLimitCents,
    reason,
    metadata,
  })).digest('hex');
}

function formatEntitlementWithAgreement(row, agreement) {
  return formatEntitlement({
    ...row,
    partner_id: agreement.partner_id,
    restaurant_id: agreement.restaurant_id,
    restaurant_name: agreement.restaurant_name,
    agreement_version: agreement.version,
    agreement_status: agreement.status,
    settlement_currency_code: agreement.settlement_currency_code,
  });
}

async function bulkUpsertEntitlements({ agreementIds, customerId, status = 'active', startsAt, endsAt, maxTransactionCents, dailyLimitCents, reason, metadata, actorUserId, idempotencyKey, correlationId }) {
  const normalizedAgreementIds = normalizeBulkAgreementIds(agreementIds);
  const normalizedStatus = normalizeString(status, 20) || 'active';
  if (!ENTITLEMENT_STATUSES.has(normalizedStatus)) throw new AppError('Invalid customer entitlement status', 400, 'invalid_credit_entitlement_status');
  const normalizedReason = requireAuditReason(reason);
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 160);
  if (!normalizedIdempotencyKey) throw new AppError('Idempotency-Key is required for bulk customer access', 400, 'credit_idempotency_key_required');
  const starts = parseDate(startsAt, 'startsAt');
  const ends = parseDate(endsAt, 'endsAt');
  if (starts && ends && ends <= starts) throw new AppError('Entitlement end must be after its start', 400, 'credit_entitlement_dates_invalid');
  const maxTransaction = parseLimit(maxTransactionCents, 'maxTransactionCents');
  const dailyLimit = parseLimit(dailyLimitCents, 'dailyLimitCents');
  const serializedMetadata = JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {});
  const values = [normalizedStatus, starts, ends, maxTransaction, dailyLimit, serializedMetadata, normalizedReason, actorUserId || null];
  const requestHash = bulkEntitlementRequestHash({
    agreementIds: normalizedAgreementIds,
    customerId,
    status: normalizedStatus,
    startsAt: starts,
    endsAt: ends,
    maxTransactionCents: maxTransaction,
    dailyLimitCents: dailyLimit,
    reason: normalizedReason,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  });

  return withTransaction(pool, async (client) => {
    const { rows: agreementRows } = await client.query(
      `SELECT a.*, p.restaurant_id, p.settlement_currency_code, fr.display_name AS restaurant_name,
              p.status AS partner_status, fr.status AS restaurant_status
         FROM oxsteed_credit_partner_agreements a
         JOIN oxsteed_credit_partners p ON p.id = a.partner_id
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE a.id = ANY($1::uuid[])
        ORDER BY a.id ASC
        FOR SHARE`,
      [normalizedAgreementIds]
    );
    const agreementById = new Map(agreementRows.map((agreement) => [String(agreement.id), agreement]));
    const missingAgreementIds = normalizedAgreementIds.filter((agreementId) => !agreementById.has(String(agreementId)));
    if (missingAgreementIds.length) {
      throw new AppError('One or more credit agreements were not found', 404, 'credit_agreement_not_found', { missingAgreementIds });
    }
    if (normalizedStatus === 'active') {
      agreementRows.forEach(assertEntitlementAgreementCanBeActive);
    }
    const { rows: userRows } = await client.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'customer' AND is_active = TRUE`,
      [customerId]
    );
    if (!userRows[0]) throw new AppError('Customer not found', 404, 'customer_not_found');
    const { rows: existingRows } = await client.query(
      `SELECT *
         FROM oxsteed_credit_customer_entitlements
        WHERE customer_id = $1 AND agreement_id = ANY($2::uuid[])
        FOR UPDATE`,
      [customerId, normalizedAgreementIds]
    );
    const existingByAgreementId = new Map(existingRows.map((entitlement) => [String(entitlement.agreement_id), entitlement]));

    const { rows: requestRows } = await client.query(
      `INSERT INTO oxsteed_credit_entitlement_bulk_requests
         (idempotency_key, request_hash, customer_id, agreement_ids, created_by)
       VALUES ($1, $2, $3, $4::uuid[], $5)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING idempotency_key, request_hash, response_payload`,
      [normalizedIdempotencyKey, requestHash, customerId, normalizedAgreementIds, actorUserId || null]
    );
    if (!requestRows[0]) {
      const { rows: existingRequestRows } = await client.query(
        `SELECT idempotency_key, request_hash, customer_id, agreement_ids, response_payload
           FROM oxsteed_credit_entitlement_bulk_requests
          WHERE idempotency_key = $1
          FOR UPDATE`,
        [normalizedIdempotencyKey]
      );
      const existingRequest = existingRequestRows[0];
      if (!existingRequest) throw new AppError('Bulk customer access could not be confirmed after an idempotent retry', 409, 'credit_entitlement_retry_required');
      if (existingRequest.request_hash !== requestHash) {
        throw new AppError('Bulk customer access idempotency key was already used for different details', 409, 'credit_entitlement_idempotency_conflict');
      }
      if (existingRequest.response_payload !== null && existingRequest.response_payload !== undefined) {
        if (!Array.isArray(existingRequest.response_payload.entitlements)) {
          throw new AppError('Bulk customer access replay result is invalid; please retry with a new key', 409, 'credit_entitlement_retry_required');
        }
        return { ...existingRequest.response_payload, replayed: true };
      }
      const replayEntitlements = normalizedAgreementIds.map((agreementId) => {
        const entitlement = existingByAgreementId.get(String(agreementId));
        const agreement = agreementById.get(String(agreementId));
        if (!entitlement || !agreement) throw new AppError('Bulk customer access replay is incomplete; please retry with a new key', 409, 'credit_entitlement_retry_required');
        return formatEntitlementWithAgreement(entitlement, agreement);
      });
      return { entitlements: replayEntitlements, count: replayEntitlements.length, replayed: true };
    }
    const entitlements = [];

    for (const agreementId of normalizedAgreementIds) {
      const agreement = agreementById.get(String(agreementId));
      const before = existingByAgreementId.get(String(agreementId));
      const { rows } = await client.query(
        `INSERT INTO oxsteed_credit_customer_entitlements
           (customer_id, agreement_id, status, starts_at, ends_at, max_transaction_cents,
            daily_limit_cents, metadata, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
         ON CONFLICT (customer_id, agreement_id) DO UPDATE
           SET status = EXCLUDED.status, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
               max_transaction_cents = EXCLUDED.max_transaction_cents,
               daily_limit_cents = EXCLUDED.daily_limit_cents, metadata = EXCLUDED.metadata,
               reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, updated_at = NOW()
         RETURNING *`,
        [customerId, agreement.id, ...values]
      );
      if (!rows[0]) throw new AppError('Credit entitlement could not be saved', 409, 'credit_entitlement_conflict');
      await insertAudit(client, {
        actionType: 'credit.entitlement.bulk_upserted',
        actorUserId,
        customerId,
        partnerId: agreement.partner_id,
        resourceType: 'credit_entitlement',
        resourceId: rows[0].id,
        reason: normalizedReason,
        correlationId,
        beforeState: before ? snapshotEntitlement(before) : null,
        afterState: snapshotEntitlement(rows[0]),
        metadata: { bulk: true, agreementCount: normalizedAgreementIds.length },
      });
      entitlements.push(formatEntitlementWithAgreement(rows[0], agreement));
    }
    const result = { entitlements, count: entitlements.length, replayed: false };
    const { rows: resultRows } = await client.query(
      `UPDATE oxsteed_credit_entitlement_bulk_requests
          SET response_payload = $1::jsonb
        WHERE idempotency_key = $2 AND response_payload IS NULL
        RETURNING idempotency_key`,
      [JSON.stringify(result), normalizedIdempotencyKey]
    );
    if (!resultRows[0]) throw new AppError('Bulk customer access result could not be recorded for retry safety', 409, 'credit_entitlement_retry_required');
    return result;
  }, 'credit_admin_bulk_upsert_entitlements');
}

async function expireCreditEntitlements({ limit = 500, now = new Date(), actorUserId = null } = {}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(effectiveNow.getTime())) throw new TypeError('Invalid entitlement expiry clock');
  const parsedLimit = Number.parseInt(String(limit), 10);
  const batchSize = Math.max(1, Math.min(Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 500, 500));

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT e.*, a.partner_id
         FROM oxsteed_credit_customer_entitlements e
         JOIN oxsteed_credit_partner_agreements a ON a.id = e.agreement_id
        WHERE e.status IN ('active', 'suspended')
          AND e.ends_at IS NOT NULL
          AND e.ends_at <= $1
        ORDER BY e.ends_at ASC, e.id ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [effectiveNow, batchSize]
    );
    const expired = [];
    for (const entitlement of rows) {
      const { rows: updatedRows } = await client.query(
        `UPDATE oxsteed_credit_customer_entitlements
            SET status = 'expired', updated_at = NOW()
          WHERE id = $1
            AND status IN ('active', 'suspended')
            AND ends_at IS NOT NULL
            AND ends_at <= $2
          RETURNING *`,
        [entitlement.id, effectiveNow]
      );
      if (!updatedRows[0]) continue;
      await insertAudit(client, {
        actionType: 'credit.entitlement.expired',
        actorUserId,
        customerId: entitlement.customer_id,
        partnerId: entitlement.partner_id,
        resourceType: 'credit_entitlement',
        resourceId: entitlement.id,
        reason: 'Entitlement validity window ended',
        beforeState: { status: entitlement.status, endsAt: entitlement.ends_at },
        afterState: { status: 'expired', endsAt: entitlement.ends_at },
      });
      expired.push(formatEntitlement({ ...updatedRows[0], partner_id: entitlement.partner_id }));
    }
    return { expired, count: expired.length };
  }, 'credit_expire_entitlements');
}

async function expireCreditAgreements({ limit = 250, now = new Date(), actorUserId = null } = {}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(effectiveNow.getTime())) throw new TypeError('Invalid agreement expiry clock');
  const parsedLimit = Number.parseInt(String(limit), 10);
  const batchSize = Math.max(1, Math.min(Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 250, 250));

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT a.*, p.restaurant_id, p.settlement_currency_code,
              fr.display_name AS restaurant_name
         FROM oxsteed_credit_partner_agreements a
         JOIN oxsteed_credit_partners p ON p.id = a.partner_id
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE a.status IN ('active', 'suspended')
          AND a.ends_at IS NOT NULL
          AND a.ends_at <= $1
        ORDER BY a.ends_at ASC, a.id ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [effectiveNow, batchSize]
    );
    const expired = [];
    for (const agreement of rows) {
      const { rows: updatedRows } = await client.query(
        `UPDATE oxsteed_credit_partner_agreements
            SET status = 'expired', updated_at = NOW()
          WHERE id = $1
            AND status IN ('active', 'suspended')
            AND ends_at IS NOT NULL
            AND ends_at <= $2
          RETURNING *`,
        [agreement.id, effectiveNow]
      );
      if (!updatedRows[0]) continue;
      await insertAudit(client, {
        actionType: 'credit.agreement.expired',
        actorUserId,
        partnerId: agreement.partner_id,
        resourceType: 'credit_agreement',
        resourceId: agreement.id,
        reason: 'Agreement validity window ended',
        beforeState: { status: agreement.status, endsAt: agreement.ends_at },
        afterState: { status: 'expired', endsAt: agreement.ends_at },
      });
      expired.push(formatAgreement({
        ...updatedRows[0],
        restaurant_id: agreement.restaurant_id,
        settlement_currency_code: agreement.settlement_currency_code,
        restaurant_name: agreement.restaurant_name,
      }));
    }
    return { expired, count: expired.length };
  }, 'credit_expire_agreements');
}

module.exports = {
  listPartners,
  listAdminCustomerCreditAccounts,
  getAdminCustomerCreditAccount,
  listAdminCreditTransactions,
  getAdminCreditTransaction,
  registerPartner,
  transitionPartner,
  listAgreements,
  listEntitlements,
  expireCreditEntitlements,
  expireCreditAgreements,
  listSettlements,
  listReconciliationRuns,
  createSettlement,
  transitionSettlement,
  reconcileCreditLedger,
  verifyCreditLedgerHashes,
  createAgreement,
  transitionAgreement,
  upsertEntitlement,
  bulkUpsertEntitlements,
  listCreditAuditEvents,
  formatAgreement,
  formatPartner,
  PARTNER_STATUSES,
  AGREEMENT_STATUSES,
  ENTITLEMENT_STATUSES,
  formatEntitlement,
  formatSettlement,
  formatReconciliationRun,
  CREDIT_TRANSACTION_TYPES,
  CREDIT_TRANSACTION_STATUSES,
  MAX_BULK_ENTITLEMENTS,
};
