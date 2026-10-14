'use strict';

/**
 * Statement investigation (workstream 4, extended): transaction drilldown,
 * related records, support linkage, statement-level reports, and correction
 * diffs for ALL statement products.
 *
 * Self-contained router. NOT mounted here; mount with e.g.
 *   app.use('/api', require('./routes/statementInvestigation'));
 * which exposes /api/statements/:documentId/entries... and
 * /api/statements/:product/documents/:documentId/{reports,corrections/...}.
 *
 * Products:
 *   oxsteed, restaurant            -> credit_statement_documents
 *   restaurant_settlement,
 *   helper_earnings, business       -> settlement_statement_documents
 *
 * Invariants (absolute):
 * - Filing a case or viewing a transaction never refunds, charges, lifts
 *   holds, changes journals, or decides disputes. Case creation delegates to
 *   the EXISTING case systems only: oxsteed_credit_disputes
 *   (openCreditDispute, which only inserts a dispute row plus an audit event)
 *   for OxSteed Credit, and linked support tickets
 *   (createLinkedSupportTicket) everywhere else. No new case system exists.
 * - Statement facts are historical and returned as recorded from the
 *   immutable document. Live statuses are labeled as current and kept
 *   separate from the historical statement.
 * - Related records resolve ONLY through explicit stored relationships
 *   (foreign keys / explicit reference_type+reference_id fields / the
 *   immutable source-history observations a statement was built from).
 *   Anything else is reported honestly as
 *   unavailable/unsupported/external; the router never infers relationships
 *   from name/amount/description.
 * - Record-level authorization on every read: the requester must own the
 *   statement document. Credit documents: document.customer_id = req.user.id.
 *   Settlement documents: product scope standing (helper self-service;
 *   restaurant/business owner or active manager). Unknown documents and
 *   documents owned by someone else are indistinguishable: 404 in both
 *   cases so ownership cannot be probed.
 * - PII minimization: references are masked (last 4), no PII in URLs, and
 *   case evidence carries a minimal summary, never document bodies.
 * - Statement-level reports and correction diffs are read-only
 *   observations: they never mutate money, journals, or issued documents.
 */

const express = require('express');
const crypto = require('crypto');

const router = express.Router();

const { authenticate, requireRole } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { creditMutationLimiter } = require('../middleware/rateLimiter');
const pool = require('../db');
const { hashDocument } = require('../services/creditStatementService');
const { openCreditDispute, formatDispute } = require('../services/oxsteedCreditService');
const { createLinkedSupportTicket } = require('../services/supportTicketLinkService');
const { withTransaction } = require('../utils/transaction');

// Statement parties across all five products: customers (credit products),
// helpers (helper_earnings), restaurant operators and business operators
// (merchant products). Admins investigate through admin tooling, not this
// self-service surface. Record-level ownership is enforced per document
// below; the role list only decides who may reach the router at all.
//
// This router is mounted at `/api` so its existing `/statements/...` URLs
// remain stable. Scope both guards to that route family; an unscoped router
// middleware would reject every later `/api` route for non-allow-listed callers.
const STATEMENT_ROLES = Object.freeze(['customer', 'helper', 'helper_pro', 'broker']);
router.use('/statements', authenticate, requireRole(...STATEMENT_ROLES));
router.use('/statements', (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const POSITIVE_INT_RE = /^[1-9]\d*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CREDIT_PRODUCTS = new Set(['oxsteed', 'restaurant']);
const SETTLEMENT_PRODUCTS = new Set(['restaurant_settlement', 'helper_earnings', 'business']);
const ALL_PRODUCTS = new Set([...CREDIT_PRODUCTS, ...SETTLEMENT_PRODUCTS]);

// Statement case support per product (CASE_SUPPORT extension).
// - oxsteed: entries map 1:1 onto oxsteed_credit_transactions, so the
//   existing credit dispute system fits (openCreditDispute).
// - restaurant: restaurant wallet ledger entries have no transaction row and
//   no existing case API accepts ledger-entry disputes, so entries link to
//   support tickets (deterministic client_request_id dedupe).
// - restaurant_settlement: sub-bank journal entries map onto
//   oxsteed_credit_transactions, but that journal is merchant money with no
//   customer-dispute semantics; merchant entry questions go to support.
// - helper_earnings / business: movements are immutable source-history
//   observations with no dispute API at all; support tickets are the case
//   channel. No new case system is invented for any product.
const CASE_SUPPORT = Object.freeze({
  oxsteed: 'credit_disputes',
  restaurant: 'support_tickets',
  restaurant_settlement: 'support_tickets',
  helper_earnings: 'support_tickets',
  business: 'support_tickets',
});

const CASE_REASONS = Object.freeze({
  unrecognized: { reasonCode: 'unrecognized_transaction', disputeType: null },
  duplicate: { reasonCode: 'duplicate_transaction', disputeType: 'duplicate_charge' },
  incorrect_amount: { reasonCode: 'incorrect_amount', disputeType: 'incorrect_amount' },
  other: { reasonCode: 'statement_entry_issue', disputeType: null },
});

const REPORT_TYPES = Object.freeze(new Set([
  'missing_transaction',
  'wrong_opening_balance',
  'incomplete_period',
  'other_statement_problem',
]));

const REFUND_REFERENCE_TYPES = new Set(['oxsteed_credit_purchase', 'food_order_refund']);
const FEE_REFERENCE_TYPES = new Set(['customer_transfer_fee']);
const ORDER_REFERENCE_TYPES = new Set(['food_order', 'food_order_refund']);

// Case subjects keep each product's own terminology.
const SETTLEMENT_CASE_SUBJECTS = Object.freeze({
  restaurant_settlement: 'Restaurant settlement statement entry review',
  helper_earnings: 'Helper earnings statement entry review',
  business: 'Business statement entry review',
});

function maskReference(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length <= 4) return '••••';
  return `••••${text.slice(-4)}`;
}

function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, maxLength);
}

function parseProduct(value) {
  const product = String(value || '');
  if (!ALL_PRODUCTS.has(product)) {
    throw new AppError('Unknown statement product', 400, 'statement_invalid_product');
  }
  return product;
}

function notFound() {
  // Tampered, malformed, or unauthorized ids are indistinguishable from
  // missing ones: 404 with no indication of what exists.
  throw new AppError('Statement not found', 404, 'statement_not_found');
}

// Finance standing for a merchant scope: business owner (or the restaurant's
// recorded owner) or an ACTIVE manager. Representatives, pending, and
// revoked members are denied. Checked at request time so removed members
// lose access immediately. Mirrors settlementStatementArchive's standing
// rule; 404 (never 403) so scope existence cannot be probed.
async function assertMerchantFinanceStanding(queryable, userId, { restaurantId, businessId }) {
  let businessIdEff = businessId;
  let restaurantOwnerId = null;
  if (restaurantId !== null && restaurantId !== undefined) {
    const { rows: [r] } = await queryable.query(
      'SELECT fr.business_id, fr.owner_user_id FROM food_restaurants fr WHERE fr.id = $1',
      [restaurantId]);
    if (!r) notFound();
    businessIdEff = Number(r.business_id);
    restaurantOwnerId = String(r.owner_user_id);
  }
  const { rows } = await queryable.query(
    `SELECT b.user_id AS business_owner_id,
            CASE
              WHEN b.user_id = $2 THEN 'owner'
              ELSE (SELECT bm.role FROM business_members bm
                     WHERE bm.business_id = b.id AND bm.member_id = $2
                       AND bm.status = 'active' LIMIT 1)
            END AS effective_role
       FROM businesses b WHERE b.id = $1`,
    [businessIdEff, userId]);
  const row = rows[0];
  const isOwner = row && (String(row.business_owner_id) === String(userId) || String(restaurantOwnerId) === String(userId));
  const role = isOwner ? 'owner' : row?.effective_role;
  if (!row || (role !== 'owner' && role !== 'manager')) notFound();
  return { businessId: businessIdEff, role };
}

async function assertSettlementStanding(queryable, userId, product, scope) {
  if (product === 'helper_earnings') {
    // Self-service only.
    if (String(scope.helperId).toLowerCase() !== String(userId).toLowerCase()) notFound();
    return { role: 'self' };
  }
  if (product === 'restaurant_settlement') {
    return assertMerchantFinanceStanding(queryable, userId, { restaurantId: scope.restaurantId });
  }
  return assertMerchantFinanceStanding(queryable, userId, { businessId: scope.businessId });
}

function verifyDocumentIntegrity(row) {
  const document = row.document;
  if (!document || typeof document !== 'object'
    || document.contentHash !== row.content_hash
    || hashDocument(document) !== row.content_hash) {
    throw new AppError('Statement verification failed', 409, 'statement_integrity_failed');
  }
  return document;
}

// Per-product document resolver: product -> archive table + scope + owner
// check. `product` may be null for the legacy entry URLs, which resolve the
// product from the stored document row.
async function loadDocument(product, documentId, userId) {
  if (product !== null && product !== undefined) parseProduct(product);
  if (!UUID_RE.test(String(documentId || ''))) notFound();
  const id = String(documentId).toLowerCase();

  if (product === null || product === undefined || CREDIT_PRODUCTS.has(product)) {
    const { rows } = await pool.query(
      `SELECT id, customer_id, product, account_id, currency_code, period_from, period_to,
              generated_at, document, content_hash
         FROM credit_statement_documents
        WHERE id = $1`,
      [id]
    );
    const row = rows[0];
    if (row && (product === null || product === undefined || row.product === product)) {
      // Unknown documents and documents owned by someone else are
      // indistinguishable: 404 in both cases so ownership cannot be probed.
      if (String(row.customer_id) !== String(userId)) notFound();
      const document = verifyDocumentIntegrity(row);
      return {
        product: row.product, accountId: row.account_id, scope: null,
        scopeId: String(row.account_id), document,
      };
    }
    if (product !== null && product !== undefined) notFound();
  }

  if (product === null || product === undefined || SETTLEMENT_PRODUCTS.has(product)) {
    const { rows } = await pool.query(
      `SELECT id, product, scope_restaurant_id, scope_business_id, scope_helper_user_id,
              currency_code, period_from, period_to, generated_at, document, content_hash
         FROM settlement_statement_documents
        WHERE id = $1`,
      [id]
    );
    const row = rows[0];
    if (row && (product === null || product === undefined || row.product === product)) {
      const scope = {
        restaurantId: row.scope_restaurant_id === null ? null : Number(row.scope_restaurant_id),
        businessId: row.scope_business_id === null ? null : Number(row.scope_business_id),
        helperId: row.scope_helper_user_id === null ? null : String(row.scope_helper_user_id),
      };
      await assertSettlementStanding(pool, userId, row.product, scope);
      const document = verifyDocumentIntegrity(row);
      const scopeId = row.product === 'restaurant_settlement' ? String(scope.restaurantId)
        : row.product === 'helper_earnings' ? String(scope.helperId)
          : String(scope.businessId);
      return { product: row.product, accountId: null, scope, scopeId, document };
    }
  }
  notFound();
}

// Raw entry rows per product, in document order.
function productEntries(product, document) {
  if (product === 'helper_earnings') {
    return Array.isArray(document.movements) ? document.movements : [];
  }
  if (product === 'business') {
    return Array.isArray(document.receivables?.movements) ? document.receivables.movements : [];
  }
  return Array.isArray(document.transactions) ? document.transactions : [];
}

// Normalize a raw entry into the investigation entry shape. Movement entries
// (helper/business) have no stored `id`; their stable identity is
// `history:<sourceHistoryId>`, matching the export normalization.
function normalizeEntry(product, raw) {
  if (product === 'helper_earnings' || product === 'business') {
    const posted = Number(raw.postedEarningsCents ?? raw.invoicedCents ?? 0);
    const settled = Number(raw.settledPayoutsCents ?? raw.collectedOrAdjustedCents ?? 0);
    const removed = Number(raw.statusRemovalsCents ?? raw.cancelledCents ?? 0);
    const credit = (posted > 0 ? posted : 0) + (settled < 0 ? -settled : 0);
    const debit = removed + (settled > 0 ? settled : 0) + (posted < 0 ? -posted : 0);
    return {
      id: `history:${raw.sourceHistoryId}`,
      date: raw.recordedAt,
      type: credit > 0 ? 'credit' : 'debit',
      description: product === 'helper_earnings' ? 'Helper earnings activity' : 'Business receivables activity',
      debitCents: debit,
      creditCents: credit,
      balanceAfterCents: Number(raw.payableAfterCents ?? raw.outstandingAfterCents ?? 0),
      raw,
    };
  }
  return {
    id: String(raw.id),
    date: raw.date,
    type: raw.type,
    description: raw.description,
    debitCents: Number(raw.debitCents || 0),
    creditCents: Number(raw.creditCents || 0),
    balanceAfterCents: Number(raw.balanceAfterCents || 0),
    raw,
  };
}

function findEntry(product, document, entryId) {
  const wanted = String(entryId || '');
  const entry = productEntries(product, document)
    .map((raw) => normalizeEntry(product, raw))
    .find((normalized) => normalized.id === wanted);
  if (!entry) throw new AppError('Statement entry not found', 404, 'statement_entry_not_found');
  return entry;
}

function entryAmountCents(entry) {
  const debit = Number(entry.debitCents || 0);
  const credit = Number(entry.creditCents || 0);
  return debit > 0 ? debit : credit;
}

// The restaurant's sub-bank journal account backs restaurant_settlement
// documents. Resolved per request (never cached) so a moved scope fails
// closed instead of resolving against a stale account.
async function resolveSubBankAccountId(queryable, restaurantId, currencyCode) {
  const { rows: [sub] } = await queryable.query(
    `SELECT id FROM oxsteed_credit_accounts
      WHERE account_type = 'restaurant_sub_bank' AND restaurant_id = $1 AND currency_code = $2`,
    [restaurantId, currencyCode]);
  if (!sub) notFound();
  return sub.id;
}

// Immutable journal identity for a snapshot entry. Journal tables and the
// source-history observations are append-only, so an identity can only ever
// resolve to the same row.
async function journalIdentity(queryable, product, document, entry, scope) {
  if (product === 'oxsteed') {
    const { rows } = await queryable.query(
      `SELECT e.id AS journal_entry_id, t.status AS live_status,
              t.reference_type, t.reference_id
         FROM oxsteed_credit_transaction_entries e
         JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
        WHERE e.transaction_id = $1 AND e.account_id = $2`,
      [entry.raw.id, scope]
    );
    const journal = rows[0] || null;
    return {
      journalId: String(entry.raw.id),
      journalEntryId: journal ? String(journal.journal_entry_id) : null,
      liveStatus: journal ? journal.live_status : null,
      statusAsOf: 'live',
      referenceType: journal ? journal.reference_type : null,
      referenceId: journal ? journal.reference_id : null,
      sourceLabel: null,
    };
  }
  if (product === 'restaurant_settlement') {
    const subBankAccountId = await resolveSubBankAccountId(queryable, scope.restaurantId, document.currencyCode);
    const { rows } = await queryable.query(
      `SELECT e.id AS journal_entry_id, t.status AS live_status,
              t.reference_type, t.reference_id
         FROM oxsteed_credit_transaction_entries e
         JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
        WHERE e.transaction_id = $1 AND e.account_id = $2`,
      [entry.raw.id, subBankAccountId]
    );
    const journal = rows[0] || null;
    return {
      journalId: String(entry.raw.id),
      journalEntryId: journal ? String(journal.journal_entry_id) : null,
      liveStatus: journal ? journal.live_status : null,
      statusAsOf: 'live',
      referenceType: journal ? journal.reference_type : null,
      referenceId: journal ? journal.reference_id : null,
      sourceLabel: null,
      subBankAccountId,
    };
  }
  if (product === 'helper_earnings' || product === 'business') {
    const historyId = String(entry.raw.sourceHistoryId || '');
    if (!POSITIVE_INT_RE.test(historyId)) {
      throw new AppError('Statement entry not found', 404, 'statement_entry_not_found');
    }
    const scopeText = product === 'helper_earnings' ? String(scope.helperId) : String(scope.businessId);
    const { rows } = await queryable.query(
      `SELECT id, source_kind, source_id, scope_id, currency_code, operation, recorded_at,
              settlement_source_projection(source_kind, source) AS snapshot
         FROM settlement_source_history
        WHERE id = $1 AND scope_id = $2 AND currency_code = $3`,
      [historyId, scopeText, document.currencyCode]
    );
    const observation = rows[0] || null;
    const snapshot = observation?.snapshot || {};
    return {
      journalId: entry.id,
      journalEntryId: observation ? String(observation.id) : entry.id,
      liveStatus: null,
      statusAsOf: 'historical',
      referenceType: observation ? observation.source_kind : null,
      referenceId: observation ? observation.source_id : null,
      sourceLabel: observation
        ? (product === 'helper_earnings'
          ? (snapshot.title ? String(snapshot.title).slice(0, 140) : null)
          : (snapshot.invoice_number ? `Invoice ${String(snapshot.invoice_number).slice(0, 60)}` : null))
        : null,
      observation: observation ? {
        id: String(observation.id),
        sourceKind: observation.source_kind,
        sourceId: String(observation.source_id),
        recordedAt: new Date(observation.recorded_at).toISOString(),
        operation: observation.operation,
        snapshot,
      } : null,
    };
  }
  // restaurant (customer food-wallet) product.
  if (!POSITIVE_INT_RE.test(String(entry.raw.id))) {
    throw new AppError('Statement entry not found', 404, 'statement_entry_not_found');
  }
  const { rows } = await queryable.query(
    `SELECT id AS journal_entry_id, reference_type, reference_id
       FROM food_customer_wallet_ledger
      WHERE id = $1 AND account_id = $2`,
    [entry.raw.id, scope]
  );
  const journal = rows[0] || null;
  return {
    journalId: String(entry.raw.id),
    journalEntryId: journal ? String(journal.journal_entry_id) : String(entry.raw.id),
    liveStatus: journal ? 'posted' : null,
    statusAsOf: 'historical',
    referenceType: journal ? journal.reference_type : null,
    referenceId: journal ? journal.reference_id : null,
    sourceLabel: null,
  };
}

function entryView(product, document, entry, journal) {
  const maskedReference = maskReference(journal.referenceId);
  return {
    entryId: entry.id,
    journalId: journal.journalId,
    journalEntryId: journal.journalEntryId,
    postedAt: entry.date,
    type: entry.type,
    description: journal.sourceLabel || entry.description,
    debitCents: Number(entry.debitCents || 0),
    creditCents: Number(entry.creditCents || 0),
    balanceAfterCents: Number(entry.balanceAfterCents || 0),
    currencyCode: document.currencyCode,
    maskedReference,
    feeReference: journal.referenceType && FEE_REFERENCE_TYPES.has(journal.referenceType) ? maskedReference : null,
    refundReference: journal.referenceType && REFUND_REFERENCE_TYPES.has(journal.referenceType) ? maskedReference : null,
    status: journal.liveStatus,
    // Historical facts come from the immutable statement; a live journal
    // status is current information, labeled as such.
    statusAsOf: journal.statusAsOf,
    caseSupport: CASE_SUPPORT[product],
  };
}

// Resolve a related record through explicit stored relationships only.
// Returns linked | unavailable (record deleted) | unsupported (no explicit
// relationship) | external (payment provider reference, masked).
async function resolveRelated({ product, document, journal, userId, scope }) {
  const { referenceType, referenceId } = journal;
  if (!referenceType || !referenceId) return { status: 'unsupported' };
  const bareId = POSITIVE_INT_RE.test(String(referenceId)) ? String(referenceId) : null;

  if (ORDER_REFERENCE_TYPES.has(referenceType) && bareId) {
    let order = null;
    if (product === 'restaurant') {
      const { rows: [account] } = await pool.query(
        'SELECT restaurant_id FROM food_customer_wallet_accounts WHERE id = $1', [scope]
      );
      if (!account) return { status: 'unsupported' };
      const { rows } = await pool.query(
        `SELECT o.id, o.status, o.payment_status, o.total_cents, o.currency_code,
                o.created_at, r.display_name AS restaurant_name
           FROM food_orders o
           LEFT JOIN food_restaurants r ON r.id = o.restaurant_id
          WHERE o.id = $1 AND o.customer_id = $2 AND o.restaurant_id = $3`,
        [bareId, userId, account.restaurant_id]);
      order = rows[0];
    } else if (product === 'restaurant_settlement') {
      // Merchant-scoped: the order belongs to the statement's restaurant.
      // No customer_id filter; the caller already passed merchant standing.
      const { rows } = await pool.query(
        `SELECT o.id, o.status, o.payment_status, o.total_cents, o.currency_code,
                o.created_at, r.display_name AS restaurant_name
           FROM food_orders o
           LEFT JOIN food_restaurants r ON r.id = o.restaurant_id
          WHERE o.id = $1 AND o.restaurant_id = $2`,
        [bareId, scope.restaurantId]);
      order = rows[0];
    } else {
      return { status: 'unsupported' };
    }
    if (!order) return { status: 'unavailable' };
    return {
      status: 'linked',
      kind: 'order',
      id: String(order.id),
      label: 'Food order',
      detailUrl: `/food/orders/${order.id}`,
      statusLive: order.status,
      statusLiveAsOf: 'live',
      paymentStatus: order.payment_status,
      totalCents: Number(order.total_cents),
      currencyCode: order.currency_code,
      restaurantName: order.restaurant_name || null,
      createdAt: order.created_at,
    };
  }

  if ((product === 'oxsteed' || product === 'restaurant_settlement')
      && referenceType === 'oxsteed_credit_purchase' && UUID_RE.test(String(referenceId))) {
    const journalAccountId = product === 'oxsteed' ? scope : journal.subBankAccountId;
    const { rows } = await pool.query(
      `SELECT t.id, t.transaction_type, t.status, t.amount_cents, t.currency_code, t.posted_at
         FROM oxsteed_credit_transactions t
        WHERE t.id = $1 AND (t.debit_account_id = $2 OR t.credit_account_id = $2)`,
      [referenceId, journalAccountId]
    );
    const purchase = rows[0];
    if (!purchase) return { status: 'unavailable' };
    return {
      status: 'linked',
      kind: 'transaction',
      id: String(purchase.id),
      label: 'Related credit transaction',
      statusLive: purchase.status,
      statusLiveAsOf: 'live',
      transactionType: purchase.transaction_type,
      amountCents: Number(purchase.amount_cents),
      currencyCode: purchase.currency_code,
      postedAt: purchase.posted_at,
    };
  }

  if ((product === 'oxsteed' || product === 'restaurant_settlement') && referenceType === 'stripe_topup') {
    return {
      status: 'external',
      kind: 'payment',
      label: 'Card payment reference',
      maskedReference: maskReference(referenceId),
    };
  }

  if ((product === 'helper_earnings' || product === 'business') && journal.observation) {
    // The statement was built from this immutable observation; the
    // observation is the explicit stored relationship. It is historical
    // evidence, never a live lookup.
    const observation = journal.observation;
    return {
      status: 'linked',
      kind: 'source_observation',
      id: observation.id,
      label: product === 'helper_earnings' ? 'Earnings source observation' : 'Receivables source observation',
      sourceKind: observation.sourceKind,
      sourceId: observation.sourceId,
      recordedAt: observation.recordedAt,
      operation: observation.operation,
      snapshot: observation.snapshot,
      statusLiveAsOf: 'historical',
      note: 'Immutable source evidence captured when the underlying record changed. Figures here are the statement inputs, not current values.',
    };
  }

  return { status: 'unsupported' };
}

function documentContext(document) {
  return {
    documentId: String(document.id),
    revision: Number(document.version || 1),
    product: document.product,
    currencyCode: document.currencyCode,
    period: { from: document.period?.from || null, to: document.period?.to || null },
    generatedAt: document.generatedAt || null,
  };
}

function parsePagination(query) {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize || '25'), 10) || 25));
  return { page, pageSize };
}

function buildEvidenceSummary({ document, entry, maskedReference, reasonLabel, customerText }) {
  const amount = entryAmountCents(entry);
  const parts = [
    `Statement investigation ${document.id} rev ${Number(document.version || 1)}: entry ${entry.id} (${entry.type}, ${amount} ${document.currencyCode} minor units, posted ${entry.date}, period ${document.period?.from} to ${document.period?.to}).`,
    `Reference: ${maskedReference || 'none'}.`,
    `Customer report (${reasonLabel}): ${customerText || 'No additional details provided.'}`,
  ];
  return parts.join(' ');
}

const REASON_LABELS = Object.freeze({
  unrecognized: "I don't recognize this",
  duplicate: 'Duplicate charge',
  incorrect_amount: 'Incorrect amount',
  other: 'Something else',
});

// Minimal, PII-free projection of a credit dispute for the case owner.
function caseView(dispute) {
  return {
    caseId: dispute.id,
    status: dispute.status,
    reasonCode: dispute.reasonCode,
    disputeType: dispute.disputeType,
    openedAt: dispute.openedAt,
    updatedAt: dispute.updatedAt,
    slaDueAt: dispute.slaDueAt,
    resolution: dispute.resolution,
    statement: dispute.statement,
  };
}

async function listEntryCases(userId, entryId) {
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
      WHERE d.transaction_id = $1 AND d.customer_id = $2
      ORDER BY d.opened_at DESC, d.id DESC`,
    [entryId, userId]
  );
  return rows.map((row) => caseView(formatDispute(row)));
}

function deterministicRequestId(seed) {
  const bytes = crypto.createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function restaurantCaseRequestId(customerId, accountId, entryId) {
  return deterministicRequestId(`statement-support:v1:${customerId}:${accountId}:${entryId}`);
}

function settlementCaseRequestId(product, userId, documentId, entryId) {
  return deterministicRequestId(`statement-support:v2:${product}:${userId}:${documentId}:${entryId}`);
}

function supportCaseView(row) {
  return {
    caseId: row.id, status: row.status, reasonCode: row.metadata?.reasonCode || 'statement_entry_issue',
    openedAt: row.created_at, updatedAt: row.updated_at || row.created_at,
    statement: row.metadata?.statement || null,
    detailUrl: `/support/my-tickets/${row.id}`,
  };
}

async function listSupportEntryCases(userId, clientRequestId) {
  const { rows } = await pool.query(
    `SELECT id, status, created_at, updated_at, metadata FROM support_tickets
     WHERE user_id = $1 AND client_request_id = $2 ORDER BY created_at DESC, id DESC`,
    [userId, clientRequestId]);
  return rows.map(supportCaseView);
}

async function userDisplayName(client, userId) {
  const { rows: [user] } = await client.query('SELECT first_name, last_name, email FROM users WHERE id = $1', [userId]);
  return { name: [user?.first_name, user?.last_name].filter(Boolean).join(' '), email: user?.email };
}

async function openRestaurantEntryCase({ customerId, accountId, document, entry, journal, reason, reasonKey, customerText }) {
  return withTransaction(pool, async client => {
    // Recheck the current wallet owner and exact journal scope inside the case
    // transaction. Deleted related orders do not prevent a clarification case.
    const { rows: [wallet] } = await client.query(
      `SELECT a.restaurant_id FROM food_customer_wallet_accounts a
       JOIN food_customer_wallet_ledger e ON e.account_id = a.id
       WHERE a.id = $1 AND a.customer_id = $2 AND a.currency_code = $3 AND e.id = $4`,
      [accountId, customerId, document.currencyCode, entry.raw.id]);
    if (!wallet || journal.liveStatus !== 'posted') throw new AppError('Statement entry not found', 404, 'statement_entry_not_found');
    const statement = {
      ...documentContext(document), entryId: entry.id, journalEntryId: String(entry.raw.id),
      accountId: String(accountId), restaurantId: String(wallet.restaurant_id), contentHash: document.contentHash,
      periodFrom: document.period?.from || null, periodTo: document.period?.to || null,
    };
    const { name, email } = await userDisplayName(client, customerId);
    const ticket = await createLinkedSupportTicket(client, {
      userId: customerId, name, email,
      subject: 'Restaurant Credit statement entry review', category: 'payment', source: 'direct',
      metadata: { source: 'statement_investigation', reasonCode: reason.reasonCode, statement },
      initialMessage: buildEvidenceSummary({ document, entry, maskedReference: maskReference(journal.referenceId), reasonLabel: REASON_LABELS[reasonKey], customerText }),
      clientRequestId: restaurantCaseRequestId(customerId, accountId, entry.id),
    });
    const { rows: [stored] } = await client.query(
      'SELECT id, status, created_at, updated_at, metadata FROM support_tickets WHERE id = $1 AND user_id = $2', [ticket.id, customerId]);
    if (!stored) throw new AppError('Support case not found', 404, 'statement_case_not_found');
    return { ...supportCaseView(stored), replayed: Boolean(ticket.replayed) };
  });
}

async function openSettlementEntryCase({ product, userId, scope, document, entry, journal, reason, reasonKey, customerText }) {
  return withTransaction(pool, async client => {
    // Recheck scope standing and the journal/observation identity inside the
    // case transaction, mirroring the restaurant product's recheck.
    await assertSettlementStanding(client, userId, product, scope);
    const rechecked = await journalIdentity(client, product, document, entry, scope);
    const journalGone = product === 'restaurant_settlement'
      ? !rechecked.journalEntryId
      : !rechecked.observation;
    if (journalGone) throw new AppError('Statement entry not found', 404, 'statement_entry_not_found');
    const statement = {
      ...documentContext(document), entryId: entry.id, journalEntryId: rechecked.journalEntryId,
      scopeId: scope === null ? null : String(
        product === 'restaurant_settlement' ? scope.restaurantId
          : product === 'helper_earnings' ? scope.helperId : scope.businessId),
      contentHash: document.contentHash,
      periodFrom: document.period?.from || null, periodTo: document.period?.to || null,
    };
    const { name, email } = await userDisplayName(client, userId);
    const ticket = await createLinkedSupportTicket(client, {
      userId, name, email,
      subject: SETTLEMENT_CASE_SUBJECTS[product], category: 'payment', source: 'direct',
      metadata: { source: 'statement_investigation', product, reasonCode: reason.reasonCode, statement },
      initialMessage: buildEvidenceSummary({ document, entry, maskedReference: maskReference(rechecked.referenceId), reasonLabel: REASON_LABELS[reasonKey], customerText }),
      clientRequestId: settlementCaseRequestId(product, userId, document.id, entry.id),
    });
    const { rows: [stored] } = await client.query(
      'SELECT id, status, created_at, updated_at, metadata FROM support_tickets WHERE id = $1 AND user_id = $2', [ticket.id, userId]);
    if (!stored) throw new AppError('Support case not found', 404, 'statement_case_not_found');
    return { ...supportCaseView(stored), replayed: Boolean(ticket.replayed) };
  });
}

function liveBlock(product, journal) {
  const checkedAt = new Date().toISOString();
  if (product === 'oxsteed' || product === 'restaurant_settlement') {
    return {
      status: journal.liveStatus,
      checkedAt,
      note: 'Current transaction status, checked just now. It is not part of the historical statement.',
    };
  }
  if (product === 'restaurant') {
    return {
      status: 'posted',
      checkedAt,
      note: 'Wallet ledger entries are append-only. This status is the historical record.',
    };
  }
  return {
    status: null,
    checkedAt,
    note: 'Source observations are append-only. This movement is the historical record; figures are statement inputs, not current values.',
  };
}

function entryCasesForProduct(product, userId, { accountId, scope, document, entryId }) {
  if (product === 'oxsteed') return listEntryCases(userId, entryId);
  if (product === 'restaurant') {
    return listSupportEntryCases(userId, restaurantCaseRequestId(userId, accountId, entryId));
  }
  return listSupportEntryCases(userId, settlementCaseRequestId(product, userId, document.id, entryId));
}

function reportView(row) {
  return {
    reportId: row.id,
    reportType: row.report_type,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Correction diff ─────────────────────────────────────────────────────────
// Compare an issued original against one published correction version.
// Both documents are integrity-verified before comparison; the diff is a
// read-only structural comparison that never touches money or journals.

function getPath(document, dotted) {
  return dotted.split('.').reduce((node, part) => (node === null || node === undefined ? node : node[part]), document);
}

function diffValue(value) {
  if (typeof value === 'bigint') return Number(value);
  return value === undefined ? null : value;
}

// Rows keyed by stable entry identity, with the compared fields per product.
function diffRowSet(product, document) {
  const rows = new Map();
  if (product === 'helper_earnings' || product === 'business') {
    const movements = product === 'helper_earnings'
      ? (Array.isArray(document.movements) ? document.movements : [])
      : (Array.isArray(document.receivables?.movements) ? document.receivables.movements : []);
    for (const movement of movements) {
      const key = `history:${movement.sourceHistoryId}`;
      const fields = product === 'helper_earnings'
        ? {
          recordedAt: movement.recordedAt,
          postedEarningsCents: diffValue(movement.postedEarningsCents),
          settledPayoutsCents: diffValue(movement.settledPayoutsCents),
          statusRemovalsCents: diffValue(movement.statusRemovalsCents),
          payableAfterCents: diffValue(movement.payableAfterCents),
        }
        : {
          recordedAt: movement.recordedAt,
          invoicedCents: diffValue(movement.invoicedCents),
          collectedOrAdjustedCents: diffValue(movement.collectedOrAdjustedCents),
          cancelledCents: diffValue(movement.cancelledCents),
          outstandingAfterCents: diffValue(movement.outstandingAfterCents),
        };
      rows.set(key, {
        entryId: key,
        description: product === 'helper_earnings' ? 'Helper earnings activity' : 'Business receivables activity',
        fields,
      });
    }
    return rows;
  }
  const transactions = Array.isArray(document.transactions) ? document.transactions : [];
  for (const tx of transactions) {
    const key = String(tx.id);
    rows.set(key, {
      entryId: key,
      description: String(tx.description || ''),
      fields: {
        date: tx.date,
        type: tx.type,
        description: String(tx.description || ''),
        debitCents: diffValue(tx.debitCents),
        creditCents: diffValue(tx.creditCents),
        balanceAfterCents: diffValue(tx.balanceAfterCents),
      },
    });
  }
  return rows;
}

const DIFF_SUMMARY_FIELDS = Object.freeze({
  oxsteed: ['openingBalanceCents', 'totalCreditsCents', 'totalDebitsCents', 'closingBalanceCents'],
  restaurant: ['openingBalanceCents', 'totalCreditsCents', 'totalDebitsCents', 'closingBalanceCents'],
  restaurant_settlement: ['openingBalanceCents', 'totalCreditsCents', 'totalDebitsCents', 'closingBalanceCents'],
  helper_earnings: ['openingPayableCents', 'postedEarningsCents', 'settledPayoutsCents', 'statusRemovalsCents', 'closingPayableCents'],
  business: ['receivables.openingOutstandingCents', 'receivables.closingOutstandingCents'],
});

function diffDocuments(product, original, corrected) {
  const originalRows = diffRowSet(product, original);
  const correctedRows = diffRowSet(product, corrected);
  const rowDiffs = [];
  for (const [key, originalRow] of originalRows) {
    const correctedRow = correctedRows.get(key);
    if (!correctedRow) {
      rowDiffs.push({ change: 'removed', entryId: originalRow.entryId, description: originalRow.description, changes: [] });
      continue;
    }
    const changes = [];
    for (const field of Object.keys(originalRow.fields)) {
      const oldValue = diffValue(originalRow.fields[field]);
      const newValue = diffValue(correctedRow.fields[field]);
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({ field, oldValue, newValue });
      }
    }
    if (changes.length > 0) {
      rowDiffs.push({
        change: 'modified',
        entryId: originalRow.entryId,
        description: correctedRow.description || originalRow.description,
        changes,
      });
    }
  }
  for (const [key, correctedRow] of correctedRows) {
    if (!originalRows.has(key)) {
      rowDiffs.push({ change: 'added', entryId: correctedRow.entryId, description: correctedRow.description, changes: [] });
    }
  }
  const summaryChanges = [];
  for (const field of DIFF_SUMMARY_FIELDS[product] || []) {
    const oldValue = diffValue(getPath(original, field));
    const newValue = diffValue(getPath(corrected, field));
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      summaryChanges.push({ field, oldValue, newValue });
    }
  }
  const counts = {
    added: rowDiffs.filter((row) => row.change === 'added').length,
    removed: rowDiffs.filter((row) => row.change === 'removed').length,
    modified: rowDiffs.filter((row) => row.change === 'modified').length,
  };
  return { counts, summaryChanges, rows: rowDiffs };
}

// ── Routes ────────────────────────────────────────────────────────────────

router.get('/statements/:documentId/entries', async (req, res, next) => {
  try {
    const { product, accountId, scope, document } = await loadDocument(null, req.params.documentId, req.user.id);
    const { page, pageSize } = parsePagination(req.query);
    const raws = productEntries(product, document);
    const total = raws.length;
    const slice = raws.slice((page - 1) * pageSize, page * pageSize);
    const scopeForJournal = product === 'oxsteed' || product === 'restaurant' ? accountId : scope;
    const entries = [];
    for (const raw of slice) {
      const entry = normalizeEntry(product, raw);
      const journal = await journalIdentity(pool, product, document, entry, scopeForJournal);
      entries.push(entryView(product, document, entry, journal));
    }
    res.json({
      ...documentContext(document),
      pagination: { page, pageSize, total },
      entries,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/statements/:documentId/entries/:entryId', async (req, res, next) => {
  try {
    const { product, accountId, scope, document } = await loadDocument(null, req.params.documentId, req.user.id);
    const entry = findEntry(product, document, req.params.entryId);
    const scopeForJournal = product === 'oxsteed' || product === 'restaurant' ? accountId : scope;
    const journal = await journalIdentity(pool, product, document, entry, scopeForJournal);
    const statement = entryView(product, document, entry, journal);
    const related = await resolveRelated({ product, document, journal, userId: req.user.id, scope: scopeForJournal });
    const live = liveBlock(product, journal);
    const cases = await entryCasesForProduct(product, req.user.id, { accountId, scope, document, entryId: statement.entryId });
    res.json({
      ...documentContext(document),
      statement,
      live,
      related,
      cases,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/statements/:documentId/entries/:entryId/cases', creditMutationLimiter, async (req, res, next) => {
  try {
    const { product, accountId, scope, document } = await loadDocument(null, req.params.documentId, req.user.id);
    const entry = findEntry(product, document, req.params.entryId);
    if ((product === 'oxsteed' || product === 'restaurant_settlement') && !UUID_RE.test(String(entry.raw.id))) {
      throw new AppError('Statement entry cannot be reported', 409, 'statement_case_unsupported');
    }
    const reasonKey = String(req.body?.reason || 'unrecognized');
    const reason = CASE_REASONS[reasonKey];
    if (!reason) throw new AppError('Unsupported report reason', 400, 'statement_case_reason_invalid');
    const customerText = sanitizeText(req.body?.description, 1000);

    const scopeForJournal = product === 'oxsteed' || product === 'restaurant' ? accountId : scope;
    const journal = await journalIdentity(pool, product, document, entry, scopeForJournal);
    if (product === 'restaurant') {
      const result = await openRestaurantEntryCase({ customerId: req.user.id, accountId, document, entry, journal, reason, reasonKey, customerText });
      return res.status(result.replayed ? 200 : 201).json(result);
    }
    if (SETTLEMENT_PRODUCTS.has(product)) {
      const result = await openSettlementEntryCase({ product, userId: req.user.id, scope, document, entry, journal, reason, reasonKey, customerText });
      return res.status(result.replayed ? 200 : 201).json(result);
    }
    if (journal.liveStatus !== 'posted') {
      throw new AppError(
        'This transaction is no longer posted, so it cannot be reported. Its current status is shown in the drilldown.',
        409,
        'statement_entry_not_disputable'
      );
    }

    const maskedReference = maskReference(journal.referenceId);
    const description = buildEvidenceSummary({
      document,
      entry,
      maskedReference,
      reasonLabel: REASON_LABELS[reasonKey],
      customerText,
    });
    // Deterministic per statement entry: retries reuse the same dispute
    // instead of opening duplicates. The existing dispute system also keeps
    // at most one open dispute per transaction.
    const idempotencyKey = `stmt-investigation:${document.id}:${entry.id}`.slice(0, 160);
    const result = await openCreditDispute({
      customerId: req.user.id,
      transactionId: entry.raw.id,
      reasonCode: reason.reasonCode,
      description,
      actorUserId: req.user.id,
      idempotencyKey,
      requestIp: req.ip || null,
      disputeType: reason.disputeType,
      statement: {
        documentId: String(document.id),
        revision: Number(document.version || 1),
        entryId: entry.id,
        product: document.product,
        accountId: accountId === null || accountId === undefined ? null : String(accountId),
        periodFrom: document.period?.from || null,
        periodTo: document.period?.to || null,
      },
    });
    const dispute = result.dispute;
    res.status(result.replayed ? 200 : 201).json({
      caseId: dispute.id,
      status: dispute.status,
      reasonCode: dispute.reasonCode,
      slaDueAt: dispute.slaDueAt,
      replayed: Boolean(result.replayed),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/statements/:documentId/entries/:entryId/cases', async (req, res, next) => {
  try {
    const { product, accountId, scope, document } = await loadDocument(null, req.params.documentId, req.user.id);
    const entry = findEntry(product, document, req.params.entryId);
    const cases = await entryCasesForProduct(product, req.user.id, { accountId, scope, document, entryId: entry.id });
    res.json({ ...documentContext(document), entryId: entry.id, caseSupport: CASE_SUPPORT[product], cases });
  } catch (error) {
    next(error);
  }
});

// ── Statement-level reports (capability 8) ────────────────────────────────
// Report a problem with a WHOLE statement without selecting an entry.
// Reports are read-only observations; they never mutate money, journals, or
// issued documents.

router.post('/statements/:product/documents/:documentId/reports', creditMutationLimiter, async (req, res, next) => {
  try {
    const product = parseProduct(req.params.product);
    const { document } = await loadDocument(product, req.params.documentId, req.user.id);
    const reportType = String(req.body?.reportType || req.body?.report_type || '');
    if (!REPORT_TYPES.has(reportType)) {
      throw new AppError('Unsupported report type', 400, 'statement_report_type_invalid');
    }
    // Validate the raw description length explicitly: silently truncating a
    // user's report could lose the point they were making. The 2000-char
    // table CHECK stays as the fails-closed backstop.
    const rawDescription = req.body?.description;
    if (typeof rawDescription !== 'string' || !rawDescription.trim()) {
      throw new AppError('A description is required', 400, 'statement_report_description_required');
    }
    if (rawDescription.length > 2000) {
      throw new AppError('The description is too long', 400, 'statement_report_description_too_long');
    }
    const description = sanitizeText(rawDescription, 2000);
    if (!description) {
      throw new AppError('A description is required', 400, 'statement_report_description_required');
    }
    const { rows: [row] } = await pool.query(
      `INSERT INTO statement_reports (user_id, product, document_id, report_type, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, report_type, description, status, created_at, updated_at`,
      [req.user.id, product, document.id, reportType, description]
    );
    res.status(201).json({ ...documentContext(document), report: reportView(row) });
  } catch (error) {
    next(error);
  }
});

router.get('/statements/:product/documents/:documentId/reports', async (req, res, next) => {
  try {
    const product = parseProduct(req.params.product);
    const { document } = await loadDocument(product, req.params.documentId, req.user.id);
    const { rows } = await pool.query(
      `SELECT id, report_type, description, status, created_at, updated_at
         FROM statement_reports
        WHERE user_id = $1 AND product = $2 AND document_id = $3
        ORDER BY created_at DESC, id DESC`,
      [req.user.id, product, document.id]
    );
    res.json({ ...documentContext(document), reports: rows.map(reportView) });
  } catch (error) {
    next(error);
  }
});

// ── Correction diff (capability 10) ──────────────────────────────────────
// Structured row-level diff between an issued original and one published
// correction version. Read-only; both documents are integrity-verified.

router.get('/statements/:product/documents/:documentId/corrections/:correctionId/diff', async (req, res, next) => {
  try {
    const product = parseProduct(req.params.product);
    const { document } = await loadDocument(product, req.params.documentId, req.user.id);
    if (!UUID_RE.test(String(req.params.correctionId || ''))) {
      throw new AppError('Correction not found', 404, 'statement_correction_not_found');
    }
    const correctionId = String(req.params.correctionId).toLowerCase();
    const scopeColumn = CREDIT_PRODUCTS.has(product) ? 'original_document_id' : 'settlement_original_document_id';
    const { rows: [version] } = await pool.query(
      `SELECT id, revision_number, amendment_type, presentation, document, content_hash, created_at
         FROM statement_amendment_versions
        WHERE id = $1 AND ${scopeColumn} = $2`,
      [correctionId, document.id]
    );
    // Unknown corrections and corrections on someone else's document are
    // indistinguishable: 404 in both cases.
    if (!version) {
      throw new AppError('Correction not found', 404, 'statement_correction_not_found');
    }
    const corrected = version.document;
    if (!corrected || typeof corrected !== 'object'
      || corrected.contentHash !== version.content_hash
      || hashDocument(corrected) !== version.content_hash) {
      throw new AppError('Correction verification failed', 409, 'statement_integrity_failed');
    }
    const diff = diffDocuments(product, document, corrected);
    res.json({
      ...documentContext(document),
      correction: {
        correctionId: version.id,
        revisionNumber: Number(version.revision_number),
        amendmentType: version.amendment_type,
        presentation: version.presentation,
        createdAt: version.created_at,
      },
      diff,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
