'use strict';

// Unified statement search, period trends, and saved views (statements
// capabilities, Group B).
//
// Self-contained service. The router lives in ../routes/statementSearch.js;
// the recommended mount is documented there.
//
// Design notes:
// - Search spans all five statement products but every row is fetched through
//   the same record-level authorization the products already enforce:
//   credit products join the customer's own accounts (customer_id = user);
//   helper_earnings matches scope_helper_user_id = user; restaurant_settlement
//   and business resolve the scopes where the user is the owner (or the
//   restaurant's recorded owner) or an ACTIVE manager, mirroring
//   settlementStatementArchive.js. Unknown or foreign scopes answer with
//   nothing; ownership can never be probed through empty results.
// - Money code: amounts stay integer minor units end to end; currencies are
//   never summed across. exactMinor() refuses unsafe values.
// - Amount queries accept formatted ("$25.00", "25.00") and raw ("2500")
//   input; both interpretations are matched when the input is ambiguous.

const crypto = require('crypto');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

const PRODUCTS = ['oxsteed', 'restaurant', 'restaurant_settlement', 'helper_earnings', 'business'];
const CREDIT_PRODUCTS = new Set(['oxsteed', 'restaurant']);
const SETTLEMENT_PRODUCTS = new Set(['restaurant_settlement', 'helper_earnings', 'business']);

const PRODUCT_LABELS = {
  oxsteed: 'OxSteed Credit',
  restaurant: 'Restaurant Credit',
  restaurant_settlement: 'Restaurant Settlement',
  helper_earnings: 'Helper Earnings',
  business: 'Business',
};

const ARCHIVE_ROOTS = {
  oxsteed: '/oxsteed-credit/statements',
  restaurant: '/restaurant-credit/statements',
  restaurant_settlement: '/restaurant-settlement/statements',
  helper_earnings: '/helper-earnings/statements',
  business: '/business/statements',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const RESTAURANT_ACCOUNT_RE = /^([1-9]\d*):([A-Z]{3})$/;
const SETTLEMENT_DOC_CAP = 20;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

function fail(code, message, status = 400) {
  throw new AppError(message, status, code);
}

function exactMinor(value) {
  // pg returns BIGINT as decimal text; refuse anything that is not a safe
  // integer instead of rounding it.
  if (!/^-?\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    fail('statement_integrity_failed', 'Statement amount cannot be represented safely', 409);
  }
  return Number(value);
}

function escapeLike(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// Amount queries accept formatted ("$25.00", "25.00") and raw ("2500") input.
// Returns integer minor-unit variants to match against amount_cents. A bare
// integer like "2500" matches both 2500 minor units AND $2,500.00 (250000
// minor units); a decimal input matches only its exact minor-unit value.
function parseAmountMinorVariants(query) {
  const cleaned = String(query || '').trim().replace(/[$,\s_'\u00a0]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return [];
  const negative = cleaned.startsWith('-');
  const digits = negative ? cleaned.slice(1) : cleaned;
  const [whole, frac = ''] = digits.split('.');
  if (!/^\d+$/.test(whole) || whole.length > 15) return [];
  const cents = BigInt(whole || '0') * 100n + BigInt((frac + '00').slice(0, 2));
  const variants = new Set([(negative ? -cents : cents).toString()]);
  if (!digits.includes('.') && whole.length > 2 && whole.length <= 15) {
    variants.add((negative ? '-' : '') + whole);
  }
  return [...variants].filter((variant) => Number.isSafeInteger(Number(variant)));
}

// Same entry-type mapping as creditStatementService.reconcileRows so search
// results label entries the way the statement table does.
function mapCreditEntryType(raw) {
  return raw === 'credit' ? 'load' : raw === 'debit' ? 'purchase' : String(raw || '');
}

function statementUrl(product, { currencyCode, restaurantId, documentId }) {
  if (product === 'oxsteed') return `/oxsteed-credit/statements?currencyCode=${encodeURIComponent(currencyCode)}`;
  if (product === 'restaurant') {
    return `/restaurant-credit/statements?currencyCode=${encodeURIComponent(currencyCode)}&restaurantId=${encodeURIComponent(String(restaurantId))}`;
  }
  return `${ARCHIVE_ROOTS[product]}${documentId ? `?document=${encodeURIComponent(documentId)}` : ''}`;
}

// ── Credit products: live-ledger search ────────────────────────────────────

async function searchOxsteedLedger(userId, { needle, amountVariants, cap }) {
  const conditions = [];
  const params = [userId];
  const like = `%${escapeLike(needle)}%`;
  params.push(like);
  conditions.push(`(t.description ILIKE $${params.length} ESCAPE '\\'
    OR CAST(t.id AS TEXT) ILIKE $${params.length} ESCAPE '\\'
    OR COALESCE(t.reference_type, '') ILIKE $${params.length} ESCAPE '\\'
    OR COALESCE(t.reference_id, '') ILIKE $${params.length} ESCAPE '\\'
    OR CAST(e.id AS TEXT) ILIKE $${params.length} ESCAPE '\\')`);
  if (amountVariants.length) {
    params.push(amountVariants);
    conditions.push(`e.amount_cents = ANY($${params.length}::bigint[])`);
  }
  params.push(cap);
  const { rows } = await pool.query(
    `SELECT e.id AS entry_id, t.id AS transaction_id,
            COALESCE(t.posted_at, t.created_at) AS posted_at,
            t.transaction_type AS tx_type, t.description,
            e.entry_side AS direction, e.amount_cents,
            t.currency_code, t.reference_type, t.reference_id,
            a.id AS account_id, a.currency_code AS account_currency
       FROM oxsteed_credit_transaction_entries e
       JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
       JOIN oxsteed_credit_accounts a ON a.id = e.account_id
      WHERE a.customer_id = $1 AND a.account_type = 'customer_wallet'
        AND t.status IN ('posted', 'reversed')
        AND (${conditions.join(' OR ')})
      ORDER BY posted_at DESC, e.id DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map((row) => {
    const amount = exactMinor(row.amount_cents);
    const credit = row.direction === 'credit';
    const currency = String(row.account_currency || row.currency_code || 'USD');
    return {
      product: 'oxsteed',
      productLabel: PRODUCT_LABELS.oxsteed,
      documentId: null,
      entryId: String(row.transaction_id),
      date: new Date(row.posted_at).toISOString(),
      description: String(row.description || ''),
      type: mapCreditEntryType(row.tx_type),
      direction: credit ? 'credit' : 'debit',
      debitCents: credit ? 0 : amount,
      creditCents: credit ? amount : 0,
      currencyCode: currency,
      accountLabel: `${PRODUCT_LABELS.oxsteed} \u00b7 ${currency}`,
      reference: row.reference_type || row.reference_id
        ? { type: row.reference_type || null, id: row.reference_id || null } : null,
      url: statementUrl('oxsteed', { currencyCode: currency }),
    };
  });
}

async function searchRestaurantLedger(userId, { needle, amountVariants, cap }) {
  const conditions = [];
  const params = [userId];
  const like = `%${escapeLike(needle)}%`;
  params.push(like);
  conditions.push(`(e.description ILIKE $${params.length} ESCAPE '\\'
    OR CAST(e.id AS TEXT) ILIKE $${params.length} ESCAPE '\\'
    OR COALESCE(e.reference_type, '') ILIKE $${params.length} ESCAPE '\\'
    OR COALESCE(e.reference_id, '') ILIKE $${params.length} ESCAPE '\\'
    OR e.entry_type ILIKE $${params.length} ESCAPE '\\')`);
  if (amountVariants.length) {
    params.push(amountVariants);
    conditions.push(`e.amount_cents = ANY($${params.length}::bigint[])`);
  }
  params.push(cap);
  const { rows } = await pool.query(
    `SELECT e.id AS entry_id, e.created_at AS posted_at,
            e.entry_type AS tx_type, e.description,
            CASE WHEN e.entry_type = 'debit' THEN 'debit' ELSE 'credit' END AS direction,
            e.amount_cents, e.currency_code, e.reference_type, e.reference_id,
            e.account_id, e.restaurant_id, a.currency_code AS account_currency
       FROM food_customer_wallet_ledger e
       JOIN food_customer_wallet_accounts a ON a.id = e.account_id
      WHERE a.customer_id = $1
        AND (${conditions.join(' OR ')})
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map((row) => {
    const amount = exactMinor(row.amount_cents);
    const credit = row.direction === 'credit';
    const currency = String(row.account_currency || row.currency_code || 'USD');
    return {
      product: 'restaurant',
      productLabel: PRODUCT_LABELS.restaurant,
      documentId: null,
      entryId: String(row.entry_id),
      date: new Date(row.posted_at).toISOString(),
      description: String(row.description || ''),
      type: mapCreditEntryType(row.tx_type),
      direction: credit ? 'credit' : 'debit',
      debitCents: credit ? 0 : amount,
      creditCents: credit ? amount : 0,
      currencyCode: currency,
      accountLabel: `${PRODUCT_LABELS.restaurant} \u00b7 ${currency}`,
      reference: row.reference_type || row.reference_id
        ? { type: row.reference_type || null, id: row.reference_id || null } : null,
      url: statementUrl('restaurant', { currencyCode: currency, restaurantId: row.restaurant_id }),
    };
  });
}

// ── Settlement products: archived-document search ──────────────────────────

// Scopes where the user may read settlement statements: the business owner,
// the restaurant's recorded owner, or an ACTIVE manager. Representatives,
// pending, and revoked members are denied. Mirrors the finance standing rule
// in routes/settlementStatementArchive.js.
async function merchantFinanceScopes(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT fr.id AS restaurant_id, fr.business_id AS business_id
       FROM food_restaurants fr
       LEFT JOIN businesses b ON b.id = fr.business_id
      WHERE fr.owner_user_id = $1
         OR b.user_id = $1
         OR EXISTS (SELECT 1 FROM business_members bm
                     WHERE bm.business_id = COALESCE(fr.business_id, b.id)
                       AND bm.member_id = $1
                       AND bm.status = 'active' AND bm.role = 'manager')`,
    [userId],
  );
  const restaurantIds = [];
  const businessIds = [];
  for (const row of rows) {
    if (row.restaurant_id != null) restaurantIds.push(Number(row.restaurant_id));
    if (row.business_id != null && !businessIds.includes(Number(row.business_id))) {
      businessIds.push(Number(row.business_id));
    }
  }
  return { restaurantIds, businessIds };
}

async function fetchSettlementDocuments(product, scopeColumn, scopeValues) {
  if (!scopeValues.length) return [];
  const cast = scopeColumn === 'scope_helper_user_id' ? 'uuid[]' : 'bigint[]';
  const { rows } = await pool.query(
    `SELECT id, product, currency_code, period_from, period_to, document
       FROM settlement_statement_documents
      WHERE product = $1 AND ${scopeColumn} = ANY($2::${cast})
      ORDER BY period_to DESC, generated_at DESC
      LIMIT ${SETTLEMENT_DOC_CAP}`,
    [product, scopeValues],
  );
  return rows;
}

function extractSettlementEntries(product, document) {
  if (!document || typeof document !== 'object') return [];
  if (product === 'restaurant_settlement') {
    return (Array.isArray(document.transactions) ? document.transactions : []).map((tx) => {
      const credit = BigInt(String(tx.creditCents ?? '0'));
      const debit = BigInt(String(tx.debitCents ?? '0'));
      return {
        entryId: String(tx.id ?? ''),
        date: tx.date ? new Date(tx.date).toISOString() : null,
        description: String(tx.description || 'Restaurant settlement activity'),
        type: String(tx.type || (credit > 0n ? 'credit' : 'debit')),
        direction: credit > 0n ? 'credit' : 'debit',
        debitCents: debit.toString(),
        creditCents: credit.toString(),
        referenceType: tx.referenceType || null,
        referenceId: tx.referenceId || null,
      };
    });
  }
  if (product === 'helper_earnings') {
    return (Array.isArray(document.movements) ? document.movements : []).map((movement) => {
      const posted = BigInt(String(movement.postedEarningsCents ?? '0'));
      const settled = BigInt(String(movement.settledPayoutsCents ?? '0'));
      const removed = BigInt(String(movement.statusRemovalsCents ?? '0'));
      const credit = (posted > 0n ? posted : 0n) + (settled < 0n ? -settled : 0n);
      const debit = removed + (settled > 0n ? settled : 0n);
      return {
        entryId: String(movement.sourceHistoryId ?? movement.sourceId ?? ''),
        date: movement.recordedAt ? new Date(movement.recordedAt).toISOString() : null,
        description: 'Helper earnings activity',
        type: credit > 0n ? 'credit' : 'debit',
        direction: credit > 0n ? 'credit' : 'debit',
        debitCents: debit.toString(),
        creditCents: credit.toString(),
        referenceType: 'helper_history',
        referenceId: movement.sourceId != null ? String(movement.sourceId) : null,
      };
    });
  }
  const receivables = document.receivables || {};
  return (Array.isArray(receivables.movements) ? receivables.movements : []).map((movement) => {
    const issued = BigInt(String(movement.invoicedCents ?? '0'));
    const collected = BigInt(String(movement.collectedOrAdjustedCents ?? '0'));
    const cancelled = BigInt(String(movement.cancelledCents ?? '0'));
    const credit = (issued > 0n ? issued : 0n) + (collected < 0n ? -collected : 0n);
    const debit = (issued < 0n ? -issued : 0n) + (collected > 0n ? collected : 0n) + cancelled;
    return {
      entryId: String(movement.sourceHistoryId ?? movement.sourceId ?? ''),
      date: movement.recordedAt ? new Date(movement.recordedAt).toISOString() : null,
      description: 'Business receivables activity',
      type: credit > 0n ? 'credit' : 'debit',
      direction: credit > 0n ? 'credit' : 'debit',
      debitCents: debit.toString(),
      creditCents: credit.toString(),
      referenceType: 'business_history',
      referenceId: movement.sourceId != null ? String(movement.sourceId) : null,
    };
  });
}

function settlementEntryMatches(entry, needle, amountVariants) {
  const haystack = [entry.description, entry.entryId, entry.referenceId, entry.referenceType, entry.type]
    .filter(Boolean).join(' ').toLowerCase();
  if (needle && haystack.includes(needle)) return true;
  if (amountVariants.length) {
    const amounts = [entry.debitCents, entry.creditCents].filter((value) => BigInt(value) > 0n).map(String);
    if (amounts.some((amount) => amountVariants.includes(amount))) return true;
  }
  return false;
}

async function searchSettlementDocuments(userId, product, { needle, amountVariants, cap }) {
  let scopeColumn;
  let scopeValues;
  if (product === 'helper_earnings') {
    scopeColumn = 'scope_helper_user_id';
    scopeValues = [userId];
  } else {
    const scopes = await merchantFinanceScopes(userId);
    if (product === 'restaurant_settlement') {
      scopeColumn = 'scope_restaurant_id';
      scopeValues = scopes.restaurantIds;
    } else {
      scopeColumn = 'scope_business_id';
      scopeValues = scopes.businessIds;
    }
  }
  const documents = await fetchSettlementDocuments(product, scopeColumn, scopeValues);
  const results = [];
  for (const row of documents) {
    const currency = String(row.currency_code || 'USD');
    const entries = extractSettlementEntries(product, row.document);
    for (const entry of entries) {
      if (!settlementEntryMatches(entry, needle, amountVariants)) continue;
      const debit = exactMinor(entry.debitCents);
      const credit = exactMinor(entry.creditCents);
      results.push({
        product,
        productLabel: PRODUCT_LABELS[product],
        documentId: String(row.id),
        entryId: entry.entryId,
        date: entry.date,
        description: entry.description,
        type: entry.type,
        direction: entry.direction,
        debitCents: debit,
        creditCents: credit,
        currencyCode: currency,
        accountLabel: `${PRODUCT_LABELS[product]} \u00b7 ${currency}`,
        reference: entry.referenceType || entry.referenceId
          ? { type: entry.referenceType, id: entry.referenceId } : null,
        url: statementUrl(product, { documentId: String(row.id) }),
      });
      if (results.length >= cap) break;
    }
    if (results.length >= cap) break;
  }
  results.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return { results: results.slice(0, cap), truncated: results.length >= cap };
}

async function searchStatements(userId, { q, product, limit = DEFAULT_LIMIT, offset = 0 } = {}) {
  const query = String(q || '').trim().slice(0, 100);
  const parsedLimit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(limit, 10) || DEFAULT_LIMIT));
  const parsedOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
  if (product && !PRODUCTS.includes(product)) {
    fail('statement_invalid_product', 'Unknown statement product', 400);
  }
  if (!query) {
    return { query: '', limit: parsedLimit, offset: parsedOffset, total: 0, groups: [] };
  }
  const products = product ? [product] : PRODUCTS;
  const needle = query.toLowerCase();
  const amountVariants = parseAmountMinorVariants(query);
  const perProductCap = parsedLimit + parsedOffset;
  const groups = [];
  for (const current of products) {
    let results;
    let truncated = false;
    if (current === 'oxsteed') {
      results = await searchOxsteedLedger(userId, { needle, amountVariants, cap: perProductCap });
    } else if (current === 'restaurant') {
      results = await searchRestaurantLedger(userId, { needle, amountVariants, cap: perProductCap });
    } else {
      ({ results, truncated } = await searchSettlementDocuments(userId, current, { needle, amountVariants, cap: perProductCap }));
    }
    groups.push({
      product: current,
      productLabel: PRODUCT_LABELS[current],
      archiveUrl: ARCHIVE_ROOTS[current],
      total: results.length,
      truncated: truncated || results.length >= perProductCap,
      results: results.slice(parsedOffset, parsedOffset + parsedLimit),
    });
  }
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  return { query, limit: parsedLimit, offset: parsedOffset, total, groups };
}

// ── Period trends (credit products) ────────────────────────────────────────

// Resolves the :accountId path segment to an account the user owns. Accepts
// the numeric account id, the OxSteed currency code ("USD"), or the
// restaurant wallet key ("<restaurantId>:USD") used by the statement page.
async function resolveTrendAccount(userId, product, accountId) {
  const raw = String(accountId || '').trim();
  if (product === 'oxsteed') {
    let row;
    if (/^[1-9]\d*$/.test(raw)) {
      ({ rows: [row] } = await pool.query(
        `SELECT id, currency_code FROM oxsteed_credit_accounts
          WHERE id = $1 AND customer_id = $2 AND account_type = 'customer_wallet'`, [raw, userId]));
    } else if (CURRENCY_RE.test(raw)) {
      ({ rows: [row] } = await pool.query(
        `SELECT id, currency_code FROM oxsteed_credit_accounts
          WHERE customer_id = $1 AND account_type = 'customer_wallet' AND currency_code = $2`, [userId, raw]));
    }
    if (!row) fail('statement_account_not_found', 'Statement account not found', 404);
    return { id: row.id, currencyCode: row.currency_code, label: `${PRODUCT_LABELS.oxsteed} \u00b7 ${row.currency_code}` };
  }
  let row;
  const keyed = RESTAURANT_ACCOUNT_RE.exec(raw);
  if (/^[1-9]\d*$/.test(raw)) {
    ({ rows: [row] } = await pool.query(
      `SELECT a.id, a.currency_code, a.restaurant_id FROM food_customer_wallet_accounts a
        WHERE a.id = $1 AND a.customer_id = $2`, [raw, userId]));
  } else if (keyed) {
    ({ rows: [row] } = await pool.query(
      `SELECT a.id, a.currency_code, a.restaurant_id FROM food_customer_wallet_accounts a
        WHERE a.customer_id = $1 AND a.restaurant_id = $2 AND a.currency_code = $3`,
      [userId, keyed[1], keyed[2]]));
  }
  if (!row) fail('statement_account_not_found', 'Statement account not found', 404);
  return {
    id: row.id,
    currencyCode: row.currency_code,
    restaurantId: row.restaurant_id,
    label: `${PRODUCT_LABELS.restaurant} \u00b7 ${row.currency_code}`,
  };
}

function resolveTrendPeriods(period) {
  let year;
  let month;
  if (period === undefined || period === null || period === '') {
    const now = new Date();
    year = now.getUTCFullYear();
    month = now.getUTCMonth() + 1;
  } else {
    if (!PERIOD_RE.test(String(period))) fail('statement_invalid_period', 'Invalid trend period; use YYYY-MM', 400);
    [year, month] = String(period).split('-').map(Number);
  }
  const currentFrom = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const currentTo = `${nextMonth.year}-${String(nextMonth.month).padStart(2, '0')}-01`;
  const previousMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const previousFrom = `${previousMonth.year}-${String(previousMonth.month).padStart(2, '0')}-01`;
  return {
    current: { from: currentFrom, to: currentTo },
    previous: { from: previousFrom, to: currentFrom },
  };
}

async function fetchTrendRows(product, account, period) {
  const params = [account.id, account.currencyCode, `${period.from}T00:00:00.000Z`, `${period.to}T00:00:00.000Z`];
  if (product === 'oxsteed') {
    const { rows } = await pool.query(
      `SELECT t.transaction_type AS tx_type, e.entry_side AS direction, e.amount_cents
         FROM oxsteed_credit_transaction_entries e
         JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
        WHERE e.account_id = $1 AND t.currency_code = $2
          AND t.status IN ('posted', 'reversed')
          AND COALESCE(t.posted_at, t.created_at) >= $3::timestamptz
          AND COALESCE(t.posted_at, t.created_at) < $4::timestamptz`,
      params,
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT e.entry_type AS tx_type,
            CASE WHEN e.entry_type = 'debit' THEN 'debit' ELSE 'credit' END AS direction,
            e.amount_cents
       FROM food_customer_wallet_ledger e
      WHERE e.account_id = $1 AND e.currency_code = $2
        AND e.created_at >= $3::timestamptz
        AND e.created_at < $4::timestamptz`,
    params,
  );
  return rows;
}

function aggregateTrendRows(rows) {
  const byType = new Map();
  let credits = 0n;
  let debits = 0n;
  let count = 0;
  for (const row of rows) {
    const amount = BigInt(exactMinor(row.amount_cents));
    const type = mapCreditEntryType(row.tx_type);
    const slot = byType.get(type) || { credits: 0n, debits: 0n, count: 0 };
    if (row.direction === 'credit') { credits += amount; slot.credits += amount; }
    else { debits += amount; slot.debits += amount; }
    slot.count += 1;
    count += 1;
    byType.set(type, slot);
  }
  return { byType, credits, debits, count };
}

async function getStatementTrends(userId, { product, accountId, period } = {}) {
  if (!CREDIT_PRODUCTS.has(product)) {
    fail('statement_trends_unsupported_product',
      'Period trends are available for OxSteed Credit and Restaurant Credit statements', 400);
  }
  const account = await resolveTrendAccount(userId, product, accountId);
  const periods = resolveTrendPeriods(period);
  const [currentRows, previousRows] = await Promise.all([
    fetchTrendRows(product, account, periods.current),
    fetchTrendRows(product, account, periods.previous),
  ]);
  const current = aggregateTrendRows(currentRows);
  const previous = aggregateTrendRows(previousRows);
  const currency = account.currencyCode;
  const net = (agg) => agg.credits - agg.debits;
  const currentNet = net(current);
  const previousNet = net(previous);
  const toTotals = (agg) => ({
    currencyCode: currency,
    creditsCents: exactMinor(agg.credits),
    debitsCents: exactMinor(agg.debits),
    netCents: exactMinor(net(agg)),
    transactionCount: agg.count,
  });

  const types = new Set([...current.byType.keys(), ...previous.byType.keys()]);
  const drivers = [...types].map((type) => {
    const slot = current.byType.get(type) || { credits: 0n, debits: 0n, count: 0 };
    const prev = previous.byType.get(type) || { credits: 0n, debits: 0n, count: 0 };
    const currentTypeNet = slot.credits - slot.debits;
    const previousTypeNet = prev.credits - prev.debits;
    const delta = currentTypeNet - previousTypeNet;
    return {
      type,
      currencyCode: currency,
      currentNetCents: exactMinor(currentTypeNet),
      previousNetCents: exactMinor(previousTypeNet),
      deltaCents: exactMinor(delta),
      magnitudeCents: exactMinor(delta < 0n ? -delta : delta),
      currentCount: slot.count,
    };
  }).sort((a, b) => b.magnitudeCents - a.magnitudeCents).slice(0, 5)
    .map(({ magnitudeCents, ...driver }) => driver);

  const breakdown = [...current.byType.entries()]
    .map(([type, slot]) => ({
      type,
      currencyCode: currency,
      creditsCents: exactMinor(slot.credits),
      debitsCents: exactMinor(slot.debits),
      netCents: exactMinor(slot.credits - slot.debits),
      transactionCount: slot.count,
    }))
    .sort((a, b) => Math.abs(b.netCents) - Math.abs(a.netCents));

  return {
    product,
    account: { id: String(account.id), label: account.label, currencyCode: currency },
    current: { period: periods.current, totals: toTotals(current) },
    previous: { period: periods.previous, totals: toTotals(previous) },
    change: {
      currencyCode: currency,
      creditsDeltaCents: exactMinor(current.credits - previous.credits),
      debitsDeltaCents: exactMinor(current.debits - previous.debits),
      netDeltaCents: exactMinor(currentNet - previousNet),
      countDelta: current.count - previous.count,
    },
    drivers,
    breakdown,
  };
}

// ── Saved views ────────────────────────────────────────────────────────────

function sanitizeViewObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('statement_saved_view_invalid', `Saved view ${field} must be an object`, 400);
  }
  const clean = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(key)) {
      fail('statement_saved_view_invalid', `Saved view ${field} has an invalid key`, 400);
    }
    if (entry !== null && !['string', 'number', 'boolean'].includes(typeof entry)) {
      fail('statement_saved_view_invalid', `Saved view ${field} values must be scalars`, 400);
    }
    if (typeof entry === 'string' && entry.length > 200) {
      fail('statement_saved_view_invalid', `Saved view ${field} value is too long`, 400);
    }
    clean[key] = entry;
  }
  return clean;
}

function presentSavedView(row) {
  return {
    id: String(row.id),
    name: row.name,
    product: row.product,
    filters: row.filters || {},
    sort: row.sort || {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

async function listSavedViews(userId, product) {
  const params = [userId];
  let where = 'WHERE user_id = $1';
  if (product !== undefined && product !== null && product !== '') {
    if (!PRODUCTS.includes(product)) fail('statement_invalid_product', 'Unknown statement product', 400);
    params.push(product);
    where += ` AND product = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT id, name, product, filters, sort, created_at
       FROM statement_saved_views ${where}
      ORDER BY created_at DESC`,
    params,
  );
  return rows.map(presentSavedView);
}

async function createSavedView(userId, { name, product, filters, sort } = {}) {
  const cleanName = String(name || '').trim().slice(0, 80);
  if (!cleanName) fail('statement_saved_view_invalid', 'Saved view name is required', 400);
  if (!PRODUCTS.includes(product)) fail('statement_invalid_product', 'Unknown statement product', 400);
  const cleanFilters = sanitizeViewObject(filters || {}, 'filters');
  const cleanSort = sanitizeViewObject(sort || {}, 'sort');
  const id = crypto.randomUUID();
  try {
    const { rows: [row] } = await pool.query(
      `INSERT INTO statement_saved_views (id, user_id, name, product, filters, sort)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       RETURNING id, name, product, filters, sort, created_at`,
      [id, userId, cleanName, product, JSON.stringify(cleanFilters), JSON.stringify(cleanSort)],
    );
    return presentSavedView(row);
  } catch (err) {
    if (err.code === '23505') {
      fail('statement_saved_view_exists', 'You already have a saved view with this name', 409);
    }
    throw err;
  }
}

async function deleteSavedView(userId, id) {
  if (!UUID_RE.test(String(id || ''))) {
    fail('statement_saved_view_not_found', 'Saved view not found', 404);
  }
  const { rowCount } = await pool.query(
    'DELETE FROM statement_saved_views WHERE id = $1 AND user_id = $2', [id, userId]);
  // Owner-only: foreign ids are indistinguishable from unknown ids (404) so
  // ownership cannot be probed.
  if (!rowCount) fail('statement_saved_view_not_found', 'Saved view not found', 404);
  return { deleted: true, id: String(id) };
}

module.exports = {
  PRODUCTS,
  PRODUCT_LABELS,
  ARCHIVE_ROOTS,
  searchStatements,
  getStatementTrends,
  listSavedViews,
  createSavedView,
  deleteSavedView,
  parseAmountMinorVariants,
  mapCreditEntryType,
};
