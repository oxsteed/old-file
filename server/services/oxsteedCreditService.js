'use strict';

const crypto = require('crypto');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');

const CREDIT_CURRENCY = 'USD';
const MAX_PAGE_SIZE = 100;
const MAX_TRANSACTION_CENTS = positiveEnv('OXSTEED_CREDIT_MAX_TRANSACTION_CENTS', 250000);
const MAX_CUSTOMER_BALANCE_CENTS = positiveEnv('OXSTEED_CREDIT_MAX_CUSTOMER_BALANCE_CENTS', 1000000);
const MAX_TOTAL_ISSUANCE_CENTS = positiveEnv('OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS', 5000000);
const DEFAULT_HOLD_TTL_MINUTES = positiveEnv('OXSTEED_CREDIT_HOLD_TTL_MINUTES', 30);
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
  return (normalizeString(value, 3) || CREDIT_CURRENCY).toUpperCase();
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

function getLedgerSecret() {
  const secret = process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('Missing OxSteed Credit ledger HMAC secret');
  return secret;
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

async function ensureAccount(client, { accountType, customerId = null, partnerId = null, currencyCode = CREDIT_CURRENCY }) {
  const currency = normalizeCurrency(currencyCode);
  if (!['customer_wallet', 'partner_payable', 'platform_treasury', 'platform_revenue'].includes(accountType)) {
    throw new AppError('Unsupported credit account type', 400, 'credit_account_type_invalid');
  }

  await client.query(
    `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, partner_id, currency_code)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [accountType, customerId, partnerId, currency]
  );

  const ownershipFilter = accountType === 'customer_wallet'
    ? 'customer_id = $2 AND partner_id IS NULL'
    : accountType === 'partner_payable'
      ? 'partner_id = $2 AND customer_id IS NULL'
      : 'customer_id IS NULL AND partner_id IS NULL';
  const ownerValue = accountType === 'customer_wallet' ? customerId : accountType === 'partner_payable' ? partnerId : accountType;
  const { rows } = await client.query(
    `SELECT * FROM oxsteed_credit_accounts
      WHERE account_type = $1 AND ${ownershipFilter} AND currency_code = $3
      FOR UPDATE`,
    [accountType, ownerValue, currency]
  );
  if (!rows[0]) throw new AppError('Credit account could not be created', 500, 'credit_account_create_failed');
  return rows[0];
}

async function findCustomerAccount(client, customerId, currencyCode = CREDIT_CURRENCY, forUpdate = false) {
  const { rows } = await client.query(
    `SELECT * FROM oxsteed_credit_accounts
      WHERE account_type = 'customer_wallet' AND customer_id = $1 AND currency_code = $2
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [customerId, normalizeCurrency(currencyCode)]
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
    currency_code: normalizeCurrency(input.currencyCode),
    partner_id: input.partnerId === null || input.partnerId === undefined ? null : String(input.partnerId),
    agreement_id: input.agreementId || null,
    reference_type: normalizeString(input.referenceType, 80),
    reference_id: normalizeString(input.referenceId, 160),
  };
  const existing = await getExistingTransaction(client, idempotencyKey);
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

async function findSpendAgreement(client, { customerId, partnerId, agreementId = null, orderType, category, categories, menuItemId, menuItemIds, city, state, postalCode, country, amountCents, strict = true }) {
  const { rows } = await client.query(
    `SELECT a.*, p.restaurant_id, p.status AS partner_status, p.settlement_currency_code,
            fr.display_name AS restaurant_name, fr.status AS restaurant_status,
            fr.address_city, fr.address_state, fr.address_zip, fr.address_country,
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
        AND p.status = 'active'
        AND fr.status = 'active'
        AND a.status = 'active'
        AND ($3::uuid IS NULL OR a.id = $3::uuid)
        AND a.starts_at <= NOW()
        AND (a.ends_at IS NULL OR a.ends_at > NOW())
        AND (e.id IS NULL OR (e.status = 'active'
          AND (e.starts_at IS NULL OR e.starts_at <= NOW())
          AND (e.ends_at IS NULL OR e.ends_at > NOW())))
      ORDER BY a.version DESC
      LIMIT 1`,
    [customerId, partnerId, agreementId]
  );
  const agreement = rows[0];
  if (!agreement) {
    if (strict) throw new AppError('This restaurant is not currently eligible for OxSteed Credit', 403, 'credit_partner_not_eligible');
    return null;
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
      `SELECT
         COALESCE(SUM(t.amount_cents) FILTER (WHERE t.created_at >= date_trunc('day', NOW())), 0) AS daily_cents,
         COALESCE(SUM(t.amount_cents), 0) AS lifetime_cents
       FROM oxsteed_credit_transactions t
       JOIN oxsteed_credit_accounts ca ON ca.id = t.debit_account_id
      WHERE t.transaction_type = 'purchase'
        AND t.status = 'posted'
        AND t.partner_id = $1
        AND t.agreement_id = $2
        AND ca.customer_id = $3`,
      [partnerId, agreement.id, customerId]
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
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (p.id)
            p.id AS partner_id, p.restaurant_id, p.settlement_currency_code,
            fr.display_name AS restaurant_name, fr.logo_url, fr.address_city, fr.address_state,
            a.id AS agreement_id, a.version, a.customer_terms, a.allowed_order_types,
            a.allowed_categories, a.geography, a.max_transaction_cents,
            a.daily_customer_limit_cents, e.id AS entitlement_id
       FROM oxsteed_credit_partners p
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
       JOIN oxsteed_credit_partner_agreements a ON a.partner_id = p.id
       LEFT JOIN oxsteed_credit_customer_entitlements e
         ON e.agreement_id = a.id AND e.customer_id = $1
      WHERE p.status = 'active' AND fr.status = 'active'
        AND p.settlement_currency_code = $2
        AND a.status = 'active' AND a.starts_at <= NOW()
        AND (a.ends_at IS NULL OR a.ends_at > NOW())
        AND (e.id IS NULL OR (e.status = 'active'
          AND (e.starts_at IS NULL OR e.starts_at <= NOW())
          AND (e.ends_at IS NULL OR e.ends_at > NOW())))
        AND ($3::text IS NULL OR cardinality(a.allowed_order_types) = 0 OR $3 = ANY(a.allowed_order_types))
      ORDER BY p.id, a.version DESC`,
    [customerId, normalizeCurrency(currencyCode), normalizeString(orderType, 40)?.toLowerCase() || null]
  );
  return rows.filter((row) => matchesGeography(row.geography, { city, state, postalCode, country })).map((row) => ({
    partnerId: String(row.partner_id),
    restaurantId: String(row.restaurant_id),
    restaurantName: row.restaurant_name,
    logoUrl: row.logo_url || null,
    city: row.address_city || null,
    state: row.address_state || null,
    currencyCode: normalizeCurrency(row.settlement_currency_code),
    agreementId: row.agreement_id,
    agreementVersion: Number(row.version),
    customerTerms: row.customer_terms || null,
    allowedOrderTypes: row.allowed_order_types || [],
    allowedCategories: row.allowed_categories || [],
    maxTransactionCents: row.max_transaction_cents === null ? null : Number(row.max_transaction_cents),
    dailyCustomerLimitCents: row.daily_customer_limit_cents === null ? null : Number(row.daily_customer_limit_cents),
    hasCustomerEntitlement: Boolean(row.entitlement_id),
  }));
}

async function getCustomerCreditAccount(customerId, currencyCode = CREDIT_CURRENCY) {
  return withTransaction(pool, async (client) => {
    const account = await ensureAccount(client, { accountType: 'customer_wallet', customerId, currencyCode });
    return formatAccount(account);
  }, 'credit_get_customer_account');
}

async function loadCustomerCredit({ customerId, amountCents, idempotencyKey, actorUserId, reason, referenceType = 'admin_load', referenceId, correlationId, metadata = {} }) {
  const amount = parseAmountCents(amountCents);
  if (!normalizeString(idempotencyKey, 160)) throw new AppError('Idempotency-Key is required for credit transactions', 400, 'credit_idempotency_key_required');
  return withTransaction(pool, async (client) => {
    const customerAccount = await ensureAccount(client, { accountType: 'customer_wallet', customerId });
    const treasuryAccount = await ensureAccount(client, { accountType: 'platform_treasury' });
    if (!(await getExistingTransaction(client, normalizeString(idempotencyKey, 160)))) {
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(balance_cents), 0) AS total_cents
           FROM oxsteed_credit_accounts
          WHERE account_type = 'customer_wallet' AND currency_code = $1`,
        [CREDIT_CURRENCY]
      );
      if (Number(rows[0]?.total_cents || 0) + amount > MAX_TOTAL_ISSUANCE_CENTS) {
        throw new AppError('OxSteed Credit issuance limit reached', 409, 'credit_total_issuance_limit');
      }
    }
    return postJournalTransaction(client, {
      transactionType: 'load',
      debitAccountId: treasuryAccount.id,
      creditAccountId: customerAccount.id,
      customerId,
      amountCents: amount,
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

async function purchaseWithCreditInTransaction(client, { customerId, partnerId, agreementId = null, amountCents, idempotencyKey, actorUserId, orderType, category, categories, menuItemId, menuItemIds, city, state, postalCode, country, referenceType = 'food_order', referenceId, correlationId, description, actorType, metadata = {} }) {
  const amount = parseAmountCents(amountCents);
  if (!normalizeString(idempotencyKey, 160)) throw new AppError('Idempotency-Key is required for credit transactions', 400, 'credit_idempotency_key_required');
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`oxsteed-credit:${customerId}:${partnerId}`]);
  const agreement = await findSpendAgreement(client, { customerId, partnerId, agreementId, orderType, category, categories, menuItemId, menuItemIds, city, state, postalCode, country, amountCents: amount });
  const customerAccount = await ensureAccount(client, { accountType: 'customer_wallet', customerId });
  const partnerAccount = await ensureAccount(client, { accountType: 'partner_payable', partnerId, currencyCode: agreement.settlement_currency_code });
  return postJournalTransaction(client, {
    transactionType: 'purchase',
    debitAccountId: customerAccount.id,
    creditAccountId: partnerAccount.id,
    partnerId,
    agreementId: agreement.id,
    customerId,
    amountCents: amount,
    idempotencyKey,
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

async function transferCredit({ senderCustomerId, recipientCustomerId, amountCents, idempotencyKey, actorUserId, referenceType = 'customer_transfer', referenceId, correlationId, description, metadata = {} }) {
  if (!CUSTOMER_TRANSFERS_ENABLED) throw new AppError('Customer-to-customer OxSteed Credit transfers are disabled', 403, 'credit_transfers_disabled');
  if (senderCustomerId === recipientCustomerId) throw new AppError('Cannot transfer credit to the same customer', 400, 'credit_transfer_same_customer');
  const amount = parseAmountCents(amountCents);
  if (!normalizeString(idempotencyKey, 160)) throw new AppError('Idempotency-Key is required for credit transactions', 400, 'credit_idempotency_key_required');
  return withTransaction(pool, async (client) => {
    const { rows: recipientRows } = await client.query(
      `SELECT id FROM users WHERE id = $1 AND is_active = TRUE LIMIT 1`,
      [recipientCustomerId]
    );
    if (!recipientRows[0]) throw new AppError('Recipient customer was not found', 404, 'credit_recipient_not_found');
    const sender = await ensureAccount(client, { accountType: 'customer_wallet', customerId: senderCustomerId });
    const recipient = await ensureAccount(client, { accountType: 'customer_wallet', customerId: recipientCustomerId });
    return postJournalTransaction(client, {
      transactionType: 'transfer',
      debitAccountId: sender.id,
      creditAccountId: recipient.id,
      customerId: senderCustomerId,
      amountCents: amount,
      idempotencyKey,
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

async function adjustCustomerCredit({ customerId, amountCents, direction = 'credit', idempotencyKey, actorUserId, reason, referenceType = 'admin_adjustment', referenceId, correlationId, metadata = {} }) {
  const amount = parseAmountCents(amountCents);
  if (!normalizeString(idempotencyKey, 160)) throw new AppError('Idempotency-Key is required for credit adjustments', 400, 'credit_idempotency_key_required');
  if (!['credit', 'debit'].includes(direction)) throw new AppError('Adjustment direction must be credit or debit', 400, 'credit_adjustment_direction_invalid');
  if (!normalizeString(reason, 2)) throw new AppError('A reason is required for credit adjustments', 400, 'credit_adjustment_reason_required');
  return withTransaction(pool, async (client) => {
    const customerAccount = await ensureAccount(client, { accountType: 'customer_wallet', customerId });
    const treasuryAccount = await ensureAccount(client, { accountType: 'platform_treasury' });
    return postJournalTransaction(client, {
      transactionType: 'adjustment',
      debitAccountId: direction === 'credit' ? treasuryAccount.id : customerAccount.id,
      creditAccountId: direction === 'credit' ? customerAccount.id : treasuryAccount.id,
      customerId,
      amountCents: amount,
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

async function updateCustomerCreditAccountStatus({ customerId, status, actorUserId, reason }) {
  const normalizedStatus = normalizeString(status, 20);
  if (!['active', 'suspended', 'closed'].includes(normalizedStatus)) throw new AppError('Invalid credit account status', 400, 'credit_account_status_invalid');
  if (!normalizeString(reason, 2)) throw new AppError('A reason is required when changing a credit account status', 400, 'credit_account_status_reason_required');
  return withTransaction(pool, async (client) => {
    const account = await ensureAccount(client, { accountType: 'customer_wallet', customerId });
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

async function createCreditHold({ customerId, partnerId, amountCents, idempotencyKey, actorUserId, orderType, category, menuItemId, city, state, postalCode, country, purpose, referenceType, referenceId, correlationId, expiresAt, metadata = {} }) {
  const amount = parseAmountCents(amountCents);
  if (!normalizeString(idempotencyKey, 160)) throw new AppError('Idempotency-Key is required for credit holds', 400, 'credit_idempotency_key_required');
  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`oxsteed-credit:${customerId}:${partnerId}`]);
    const agreement = await findSpendAgreement(client, { customerId, partnerId, orderType, category, menuItemId, city, state, postalCode, country, amountCents: amount });
    const account = await ensureAccount(client, { accountType: 'customer_wallet', customerId });
    const requestedExpiry = expiresAt ? new Date(expiresAt) : new Date(Date.now() + DEFAULT_HOLD_TTL_MINUTES * 60000);
    if (Number.isNaN(requestedExpiry.getTime()) || requestedExpiry <= new Date()) throw new AppError('Hold expiry must be in the future', 400, 'credit_hold_expiry_invalid');
    const { rows: existingRows } = await client.query(
      `SELECT * FROM oxsteed_credit_holds WHERE account_id = $1 AND idempotency_key = $2 FOR UPDATE`,
      [account.id, normalizeString(idempotencyKey, 160)]
    );
    if (existingRows[0]) {
      if (Number(existingRows[0].amount_cents) !== amount || String(existingRows[0].partner_id) !== String(partnerId)) {
        throw new AppError('Credit hold idempotency conflict', 409, 'credit_hold_idempotency_conflict');
      }
      return { hold: formatHold(existingRows[0]), replayed: true };
    }
    const available = Number(account.balance_cents || 0) - Number(account.reserved_cents || 0);
    if (amount > available) throw new AppError('Insufficient available OxSteed Credit', 409, 'credit_insufficient_funds');
    const { rows: holdRows } = await client.query(
      `INSERT INTO oxsteed_credit_holds
         (account_id, customer_id, partner_id, agreement_id, amount_cents, currency_code, purpose,
          reference_type, reference_id, idempotency_key, correlation_id, created_by, metadata, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
       RETURNING *`,
      [account.id, customerId, partnerId, agreement.id, amount, CREDIT_CURRENCY, normalizeString(purpose, 100), normalizeString(referenceType, 80), normalizeString(referenceId, 160), normalizeString(idempotencyKey, 160), normalizeString(correlationId, 160), actorUserId || null, JSON.stringify(normalizeMetadata(metadata)), requestedExpiry]
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

async function captureCreditHold({ holdId, amountCents, idempotencyKey, actorUserId, actorType = 'admin', orderType, category, categories, menuItemId, menuItemIds, city, state, postalCode, country, referenceType, referenceId, correlationId, description, reason, metadata = {} }) {
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

async function listCustomerCreditTransactions(customerId, { limit = 25, offset = 0 } = {}) {
  const pageSize = parsePageSize(limit);
  const pageOffset = parseOffset(offset);
  const { rows } = await pool.query(
    `SELECT t.*, CASE WHEN t.debit_account_id = a.id THEN 'debit' ELSE 'credit' END AS direction,
            CASE WHEN t.debit_account_id = a.id THEN pa.partner_id ELSE da.partner_id END AS related_partner_id
       FROM oxsteed_credit_transactions t
       JOIN oxsteed_credit_accounts a ON (a.id = t.debit_account_id OR a.id = t.credit_account_id)
       LEFT JOIN oxsteed_credit_accounts da ON da.id = t.debit_account_id
       LEFT JOIN oxsteed_credit_accounts pa ON pa.id = t.credit_account_id
      WHERE a.account_type = 'customer_wallet' AND a.customer_id = $1
      ORDER BY t.created_at DESC
      LIMIT $2 OFFSET $3`,
    [customerId, pageSize, pageOffset]
  );
  return rows.map((row) => ({ ...formatTransaction(row), direction: row.direction, relatedPartnerId: row.related_partner_id ? String(row.related_partner_id) : null }));
}

function formatDispute(row) {
  return {
    id: String(row.id),
    transactionId: String(row.transaction_id),
    customerId: row.customer_id,
    partnerId: row.partner_id === null || row.partner_id === undefined ? null : String(row.partner_id),
    restaurantName: row.restaurant_name || null,
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
         JOIN oxsteed_credit_accounts a ON a.id = t.debit_account_id
        WHERE t.id = $1 AND a.account_type = 'customer_wallet' AND a.customer_id = $2
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
       RETURNING *`,
      [transaction.id, customerId, transaction.partner_id || null, normalizedReason, normalizedDescription, actorUserId || customerId]
    );
    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id, reason, after_state)
       VALUES ('credit.dispute.opened', $1, $2, $3, 'credit_dispute', $4, $5, $6::jsonb)`,
      [actorUserId || customerId, customerId, transaction.partner_id || null, rows[0].id, normalizedReason, JSON.stringify({ transactionId: transaction.id, status: 'open' })]
    );
    return { dispute: formatDispute(rows[0]), replayed: false };
  }, 'credit_open_dispute');
}

async function listCreditDisputes({ customerId, status, limit = 100 } = {}) {
  const params = [];
  const filters = [];
  if (customerId) {
    params.push(customerId);
    filters.push(`d.customer_id = $${params.length}`);
  }
  if (status) {
    params.push(normalizeString(status, 20));
    filters.push(`d.status = $${params.length}`);
  }
  params.push(Math.max(1, Math.min(Number.parseInt(String(limit), 10) || 100, 250)));
  const { rows } = await pool.query(
    `SELECT d.*, fr.display_name AS restaurant_name
       FROM oxsteed_credit_disputes d
       LEFT JOIN oxsteed_credit_partners p ON p.id = d.partner_id
       LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY d.opened_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows.map(formatDispute);
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
  MAX_TRANSACTION_CENTS,
  MAX_CUSTOMER_BALANCE_CENTS,
  MAX_TOTAL_ISSUANCE_CENTS,
  CUSTOMER_TRANSFERS_ENABLED,
  computeEntryHash,
  ensureAccount,
  findSpendAgreement,
  formatAccount,
  formatHold,
  formatTransaction,
  getCustomerCreditAccount,
  listEligiblePartners,
  listCustomerCreditTransactions,
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
