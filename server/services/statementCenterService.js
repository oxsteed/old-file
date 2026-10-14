'use strict';

/**
 * statementCenterService — read-only aggregation behind GET /api/statements/center.
 *
 * For the signed-in user, reports per-product statement readiness across the
 * five statement products (oxsteedCredit, restaurantCredit, restaurantSettlement,
 * helperEarnings, business). Every entry carries:
 *   hasAccount      — the user holds at least one in-scope account/identity
 *   setupState      — 'ready' | 'setup_needed' | 'unavailable'
 *   latestPeriod    — 'YYYY-MM' of the newest issued statement, or null
 *   statementStatus — 'ready' | 'preparing' | 'none' (best across scopes)
 *   summary         — product-correct terminology; every amount is
 *                     { currency, amountCents } or null. Missing data is an
 *                     explicit null ('unavailable' in the UI), never a
 *                     reassuring zero. Unlike currencies are never combined.
 *   scopes          — per (account, currency) detail driving the preview modal
 *
 * Summary terminology per product (mirrors the statement services):
 * - OxSteed Credit / Restaurant Credit: current balance, last-period
 *   debits/credits (creditStatementService document fields).
 * - Restaurant Settlement: outstanding / invoiced / collected / adjusted,
 *   mapped from the settlement document: outstanding is the reconciled
 *   sub-bank journal closing balance; invoiced is gross order proceeds in the
 *   period; collected is verified (completed) payouts in the period;
 *   adjusted is not tracked separately by this product and stays null.
 * - Helper Earnings: payable / earned / settled (closingPayableCents,
 *   postedEarningsCents, settledPayoutsCents).
 * - Business: outstanding / invoiced / collected / adjusted
 *   (receivables.closingOutstandingCents, .invoicedCents,
 *   .collectedOrAdjustedCents; adjusted is folded into collected by the
 *   service, so the separate adjusted slot stays null).
 *
 * Read-only: no writes, no statement issuance, no money movement. A product
 * that fails to load degrades to setupState 'unavailable' with loadError:true
 * rather than failing the whole response.
 */

const pool = require('../db');
const logger = require('../utils/logger');

const PREPARING_JOB_STATES = ['pending', 'leased', 'snapshotted', 'artifact_ready'];
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function amount(currency, amountCents) {
  const code = String(currency || '').toUpperCase();
  if (!CURRENCY_PATTERN.test(code)) return null;
  const cents = Number(amountCents);
  if (!Number.isSafeInteger(cents)) return null;
  return { currency: code, amountCents: cents };
}

function periodMonth(periodTo) {
  // '2026-09-30' (or a Date) -> '2026-09'. Null-safe.
  if (!periodTo) return null;
  const text = periodTo instanceof Date ? periodTo.toISOString().slice(0, 10) : String(periodTo).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(text);
  return match ? `${match[1]}-${match[2]}` : null;
}

function docNumber(document, path) {
  // Walk a JSONB document object along a dotted path; return a safe number or null.
  let node = document;
  for (const key of path.split('.')) {
    if (!node || typeof node !== 'object') return null;
    node = node[key];
  }
  const value = Number(node);
  return Number.isSafeInteger(value) ? value : null;
}

function aggregateStatus(scopes) {
  if (scopes.some((scope) => scope.statementStatus === 'ready')) return 'ready';
  if (scopes.some((scope) => scope.statementStatus === 'preparing')) return 'preparing';
  return 'none';
}

function aggregatePeriod(scopes) {
  const periods = scopes.map((scope) => scope.latestPeriod).filter(Boolean).sort();
  return periods.length ? periods[periods.length - 1] : null;
}

function failedProduct() {
  return {
    hasAccount: false,
    setupState: 'unavailable',
    latestPeriod: null,
    statementStatus: 'none',
    summary: null,
    scopes: [],
    loadError: true,
  };
}

// ── Shared lookups ────────────────────────────────────────────────────────────

async function creditRailEnabled() {
  try {
    const { rows } = await pool.query(
      `SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled' LIMIT 1`);
    return rows[0] ? rows[0].is_enabled === true : false;
  } catch {
    // Fail closed on the setup prompt: without the flag we cannot claim the
    // product is set up-able.
    return false;
  }
}

async function latestCreditDocuments(userId, product) {
  // Newest issued document per currency for this customer/product.
  const { rows } = await pool.query(
    `SELECT id, currency_code, period_from, period_to, document
       FROM credit_statement_documents
      WHERE customer_id = $1 AND product = $2
      ORDER BY period_to DESC, currency_code ASC`,
    [userId, product]);
  const byCurrency = new Map();
  for (const row of rows) {
    if (!byCurrency.has(row.currency_code)) byCurrency.set(row.currency_code, row);
  }
  return byCurrency;
}

async function creditPreparing(userId, product) {
  const { rows } = await pool.query(
    `SELECT 1 FROM statement_account_jobs
      WHERE customer_id = $1 AND product = $2 AND state = ANY($3::varchar[])
      LIMIT 1`,
    [userId, product, PREPARING_JOB_STATES]);
  return rows.length > 0;
}

// ── Product builders ─────────────────────────────────────────────────────────

async function buildOxsteedCredit(userId) {
  const { rows: accounts } = await pool.query(
    `SELECT id, currency_code, balance_cents, status
       FROM oxsteed_credit_accounts
      WHERE account_type = 'customer_wallet' AND customer_id = $1
      ORDER BY currency_code ASC`,
    [userId]);
  const active = accounts.filter((account) => account.status === 'active');
  const hasAccount = active.length > 0;
  const setupState = hasAccount ? 'ready' : (await creditRailEnabled() ? 'setup_needed' : 'unavailable');

  const documents = await latestCreditDocuments(userId, 'oxsteed');
  const preparing = hasAccount && documents.size === 0 ? await creditPreparing(userId, 'oxsteed') : false;

  const scopes = active.map((account) => {
    const document = documents.get(account.currency_code);
    const status = document ? 'ready' : (preparing ? 'preparing' : 'none');
    return {
      scopeKey: `oxsteed:${account.currency_code}`,
      label: 'OxSteed Credit',
      currency: account.currency_code,
      latestPeriod: document ? periodMonth(document.period_to) : null,
      latestDocumentId: document ? String(document.id) : null,
      statementStatus: status,
      summary: {
        balance: amount(account.currency_code, account.balance_cents),
        lastPeriodCredits: document ? amount(account.currency_code, docNumber(document.document, 'totalCreditsCents')) : null,
        lastPeriodDebits: document ? amount(account.currency_code, docNumber(document.document, 'totalDebitsCents')) : null,
      },
    };
  });

  const latestDoc = [...documents.values()][0] || null;
  return {
    hasAccount,
    setupState,
    latestPeriod: aggregatePeriod(scopes),
    statementStatus: aggregateStatus(scopes),
    // Single scope: surface its summary at the product level. Multiple
    // scopes: the UI iterates scopes so unlike currencies are never combined.
    summary: scopes.length === 1 ? scopes[0].summary : null,
    scopes,
  };
}

async function buildRestaurantCredit(userId) {
  const { rows: wallets } = await pool.query(
    `SELECT w.id, w.restaurant_id, w.currency_code, w.balance_cents, w.status,
            fr.display_name AS restaurant_name
       FROM food_customer_wallet_accounts w
       JOIN food_restaurants fr ON fr.id = w.restaurant_id
      WHERE w.customer_id = $1
      ORDER BY fr.display_name ASC, w.currency_code ASC`,
    [userId]);
  const active = wallets.filter((wallet) => wallet.status === 'active');
  const hasAccount = active.length > 0;
  // Any signed-in customer can fund a restaurant wallet; no rail flag gates it.
  const setupState = hasAccount ? 'ready' : 'setup_needed';

  const documents = await latestCreditDocuments(userId, 'restaurant');
  const preparing = hasAccount && documents.size === 0 ? await creditPreparing(userId, 'restaurant') : false;

  const scopes = active.map((wallet) => {
    // Restaurant wallets are unique per (restaurant, customer); match the
    // newest document by currency, preferring the wallet's restaurant when
    // the document carries a restaurant scope.
    const document = [...documents.values()].find((doc) =>
      doc.currency_code === wallet.currency_code
      && (docNumber(doc.document, 'restaurantId') == null
        || String(doc.document.restaurantId) === String(wallet.restaurant_id)))
      || documents.get(wallet.currency_code) || null;
    const status = document ? 'ready' : (preparing ? 'preparing' : 'none');
    return {
      scopeKey: `restaurant:${wallet.restaurant_id}:${wallet.currency_code}`,
      label: String(wallet.restaurant_name || 'Restaurant Credit'),
      currency: wallet.currency_code,
      restaurantId: String(wallet.restaurant_id),
      latestPeriod: document ? periodMonth(document.period_to) : null,
      latestDocumentId: document ? String(document.id) : null,
      statementStatus: status,
      summary: {
        balance: amount(wallet.currency_code, wallet.balance_cents),
        lastPeriodCredits: document ? amount(wallet.currency_code, docNumber(document.document, 'totalCreditsCents')) : null,
        lastPeriodDebits: document ? amount(wallet.currency_code, docNumber(document.document, 'totalDebitsCents')) : null,
      },
    };
  });

  return {
    hasAccount,
    setupState,
    latestPeriod: aggregatePeriod(scopes),
    statementStatus: aggregateStatus(scopes),
    // Single scope: surface its summary at the product level. Multiple
    // scopes: the UI iterates scopes so unlike currencies are never combined.
    summary: scopes.length === 1 ? scopes[0].summary : null,
    scopes,
  };
}

async function buildRestaurantSettlement(userId) {
  // Same finance-standing shape as the settlement archive
  // (assertMerchantFinanceStanding): the restaurant's recorded owner, the
  // business owner (businesses.user_id; owners are never stored in
  // business_members), or an active manager member.
  const { rows: restaurants } = await pool.query(
    `SELECT DISTINCT fr.id, fr.display_name
       FROM food_restaurants fr
       LEFT JOIN businesses b ON b.id = fr.business_id
       LEFT JOIN business_members bm
         ON bm.business_id = fr.business_id AND bm.member_id = $1 AND bm.status = 'active'
      WHERE fr.owner_user_id = $1 OR b.user_id = $1 OR bm.role = 'manager'
      ORDER BY fr.display_name ASC`,
    [userId]);
  const hasAccount = restaurants.length > 0;
  const setupState = hasAccount ? 'ready' : 'unavailable';

  const restaurantIds = restaurants.map((row) => Number(row.id));
  const balances = new Map();
  if (restaurantIds.length) {
    const { rows } = await pool.query(
      `SELECT restaurant_id, currency_code, balance_cents
         FROM oxsteed_credit_accounts
        WHERE account_type = 'restaurant_sub_bank' AND restaurant_id = ANY($1::bigint[])`,
      [restaurantIds]);
    for (const row of rows) {
      const key = `${row.restaurant_id}:${row.currency_code}`;
      balances.set(key, row);
    }
  }

  const documents = new Map();
  if (restaurantIds.length) {
    const { rows } = await pool.query(
      `SELECT scope_restaurant_id, currency_code, period_to, document, id
         FROM settlement_statement_documents
        WHERE product = 'restaurant_settlement' AND scope_restaurant_id = ANY($1::bigint[])
        ORDER BY period_to DESC`,
      [restaurantIds]);
    for (const row of rows) {
      const key = `${row.scope_restaurant_id}:${row.currency_code}`;
      if (!documents.has(key)) documents.set(key, row);
    }
  }

  const scopes = [];
  for (const restaurant of restaurants) {
    const currencies = new Set([
      ...[...balances.keys()].filter((key) => key.startsWith(`${restaurant.id}:`)).map((key) => key.split(':')[1]),
      ...[...documents.keys()].filter((key) => key.startsWith(`${restaurant.id}:`)).map((key) => key.split(':')[1]),
    ]);
    if (!currencies.size) {
      scopes.push({
        scopeKey: `restaurant_settlement:${restaurant.id}`,
        label: String(restaurant.display_name || 'Restaurant'),
        currency: null,
        restaurantId: String(restaurant.id),
        latestPeriod: null,
        latestDocumentId: null,
        statementStatus: 'none',
        summary: { outstanding: null, invoiced: null, collected: null, adjusted: null },
      });
      continue;
    }
    for (const currency of [...currencies].sort()) {
      const key = `${restaurant.id}:${currency}`;
      const document = documents.get(key) || null;
      const balance = balances.get(key) || null;
      const doc = document?.document || null;
      const orders = Array.isArray(doc?.orders) ? doc.orders : [];
      const payouts = Array.isArray(doc?.payouts) ? doc.payouts : [];
      const invoicedCents = orders.reduce((total, order) => {
        const value = Number(order.totalCents);
        return Number.isSafeInteger(value) && value >= 0 ? total + value : total;
      }, 0);
      const collectedCents = payouts
        .filter((payout) => payout.outcome === 'verified')
        .reduce((total, payout) => {
          const value = Number(payout.amountCents);
          return Number.isSafeInteger(value) && value >= 0 ? total + value : total;
        }, 0);
      scopes.push({
        scopeKey: `restaurant_settlement:${restaurant.id}:${currency}`,
        label: String(restaurant.display_name || 'Restaurant'),
        currency,
        restaurantId: String(restaurant.id),
        latestPeriod: document ? periodMonth(document.period_to) : null,
        latestDocumentId: document ? String(document.id) : null,
        statementStatus: document ? 'ready' : 'none',
        summary: {
          // Journal closing balance: settlement funds outstanding to the restaurant.
          outstanding: amount(currency, doc ? docNumber(doc, 'closingBalanceCents') : (balance ? balance.balance_cents : null)),
          invoiced: doc ? amount(currency, invoicedCents) : null,
          collected: doc ? amount(currency, collectedCents) : null,
          adjusted: null,
        },
      });
    }
  }

  return {
    hasAccount,
    setupState,
    latestPeriod: aggregatePeriod(scopes),
    statementStatus: aggregateStatus(scopes),
    summary: scopes.length === 1 ? scopes[0].summary : null,
    scopes,
  };
}

async function buildHelperEarnings(userId) {
  const { rows: [helper] } = await pool.query(
    `SELECT 1 FROM users WHERE id = $1 AND role = 'helper'
      UNION
     SELECT 1 FROM helper_profiles WHERE user_id = $1
     LIMIT 1`,
    [userId]);
  const hasAccount = Boolean(helper);
  const setupState = hasAccount ? 'ready' : 'unavailable';

  const documents = new Map();
  if (hasAccount) {
    const { rows } = await pool.query(
      `SELECT currency_code, period_to, document, id
         FROM settlement_statement_documents
        WHERE product = 'helper_earnings' AND scope_helper_user_id = $1
        ORDER BY period_to DESC`,
      [userId]);
    for (const row of rows) {
      if (!documents.has(row.currency_code)) documents.set(row.currency_code, row);
    }
  }

  const scopes = [...documents.entries()].map(([currency, document]) => {
    const doc = document.document || {};
    return {
      scopeKey: `helper_earnings:${currency}`,
      label: 'Helper earnings',
      currency,
      latestPeriod: periodMonth(document.period_to),
      latestDocumentId: String(document.id),
      statementStatus: 'ready',
      summary: {
        payable: amount(currency, docNumber(doc, 'closingPayableCents')),
        earned: amount(currency, docNumber(doc, 'postedEarningsCents')),
        settled: amount(currency, docNumber(doc, 'settledPayoutsCents')),
      },
    };
  });
  if (hasAccount && !scopes.length) {
    scopes.push({
      scopeKey: 'helper_earnings:pending',
      label: 'Helper earnings',
      currency: null,
      latestPeriod: null,
      latestDocumentId: null,
      statementStatus: 'none',
      summary: { payable: null, earned: null, settled: null },
    });
  }

  return {
    hasAccount,
    setupState,
    latestPeriod: aggregatePeriod(scopes),
    statementStatus: aggregateStatus(scopes),
    summary: scopes.length === 1 && documents.size ? scopes[0].summary : null,
    scopes,
  };
}

async function buildBusiness(userId) {
  // Business owner (businesses.user_id) or an active manager member — the
  // same standing the settlement archive requires.
  const { rows: businesses } = await pool.query(
    `SELECT DISTINCT b.id, b.business_name AS name
       FROM businesses b
       LEFT JOIN business_members bm
         ON bm.business_id = b.id AND bm.member_id = $1 AND bm.status = 'active'
      WHERE b.user_id = $1 OR bm.role = 'manager'
      ORDER BY b.business_name ASC`,
    [userId]);
  const hasAccount = businesses.length > 0;
  const setupState = hasAccount ? 'ready' : 'unavailable';

  const businessIds = businesses.map((row) => Number(row.id));
  const documents = new Map();
  if (businessIds.length) {
    const { rows } = await pool.query(
      `SELECT scope_business_id, currency_code, period_to, document, id
         FROM settlement_statement_documents
        WHERE product = 'business' AND scope_business_id = ANY($1::bigint[])
        ORDER BY period_to DESC`,
      [businessIds]);
    for (const row of rows) {
      const key = `${row.scope_business_id}:${row.currency_code}`;
      if (!documents.has(key)) documents.set(key, row);
    }
  }

  const scopes = [];
  for (const business of businesses) {
    const currencies = [...documents.keys()]
      .filter((key) => key.startsWith(`${business.id}:`))
      .map((key) => key.split(':')[1])
      .sort();
    if (!currencies.length) {
      scopes.push({
        scopeKey: `business:${business.id}`,
        label: String(business.name || 'Business'),
        currency: null,
        businessId: String(business.id),
        latestPeriod: null,
        latestDocumentId: null,
        statementStatus: 'none',
        summary: { outstanding: null, invoiced: null, collected: null, adjusted: null },
      });
      continue;
    }
    for (const currency of currencies) {
      const document = documents.get(`${business.id}:${currency}`);
      const receivables = document.document?.receivables || {};
      scopes.push({
        scopeKey: `business:${business.id}:${currency}`,
        label: String(business.name || 'Business'),
        currency,
        businessId: String(business.id),
        latestPeriod: periodMonth(document.period_to),
        latestDocumentId: String(document.id),
        statementStatus: 'ready',
        summary: {
          outstanding: amount(currency, docNumber(receivables, 'closingOutstandingCents')),
          invoiced: amount(currency, docNumber(receivables, 'invoicedCents')),
          collected: amount(currency, docNumber(receivables, 'collectedOrAdjustedCents')),
          // The service folds adjustments into collectedOrAdjustedCents; no
          // separate adjusted figure exists, so this stays explicitly null.
          adjusted: null,
        },
      });
    }
  }

  return {
    hasAccount,
    setupState,
    latestPeriod: aggregatePeriod(scopes),
    statementStatus: aggregateStatus(scopes),
    summary: scopes.length === 1 && documents.size ? scopes[0].summary : null,
    scopes,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function getStatementCenter(userId) {
  const products = {};
  const builders = {
    oxsteedCredit: buildOxsteedCredit,
    restaurantCredit: buildRestaurantCredit,
    restaurantSettlement: buildRestaurantSettlement,
    helperEarnings: buildHelperEarnings,
    business: buildBusiness,
  };
  for (const [key, builder] of Object.entries(builders)) {
    try {
      products[key] = await builder(userId);
    } catch (error) {
      logger.warn('statement center product failed', { product: key, error: error.message });
      products[key] = failedProduct();
    }
  }
  return { generatedAt: new Date().toISOString(), products };
}

module.exports = { getStatementCenter };
