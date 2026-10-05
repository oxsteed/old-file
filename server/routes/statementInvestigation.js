'use strict';

/**
 * Statement investigation (workstream 4): transaction drilldown, related
 * records, and support linkage for issued credit statement documents.
 *
 * Self-contained router. NOT mounted here; mount with e.g.
 *   app.use('/api', require('./routes/statementInvestigation'));
 * which exposes /api/statements/:documentId/entries...
 *
 * Invariants:
 * - Filing a case or viewing a transaction never refunds, charges, lifts
 *   holds, changes journals, or decides disputes. Case creation delegates to
 *   the EXISTING oxsteed_credit_disputes system (openCreditDispute), which
 *   only inserts a dispute row plus an audit event.
 * - Statement facts are historical and returned as recorded from the
 *   immutable document. Live statuses are labeled as current and kept
 *   separate from the historical statement.
 * - Related records resolve ONLY through explicit stored relationships
 *   (foreign keys / explicit reference_type+reference_id fields). Anything
 *   else is reported honestly as unavailable/unsupported/external; the
 *   router never infers relationships from name/amount/description.
 * - Record-level authorization on every read: the requester must own the
 *   statement document (document.customer_id = req.user.id).
 * - PII minimization: references are masked (last 4), no PII in URLs, and
 *   case evidence carries a minimal summary, never document bodies.
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

router.use(authenticate, requireRole('customer'));
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const POSITIVE_INT_RE = /^[1-9]\d*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Statement case support per product. OxSteed Credit entries map 1:1 onto
// oxsteed_credit_transactions, so the existing credit dispute system fits.
// Restaurant wallet ledger entries have no transaction row and no existing
// case API accepts ledger-entry disputes, so they are read-only here.
const CASE_SUPPORT = Object.freeze({ oxsteed: 'credit_disputes', restaurant: 'support_tickets' });

const CASE_REASONS = Object.freeze({
  unrecognized: { reasonCode: 'unrecognized_transaction', disputeType: null },
  duplicate: { reasonCode: 'duplicate_transaction', disputeType: 'duplicate_charge' },
  incorrect_amount: { reasonCode: 'incorrect_amount', disputeType: 'incorrect_amount' },
  other: { reasonCode: 'statement_entry_issue', disputeType: null },
});

const REFUND_REFERENCE_TYPES = new Set(['oxsteed_credit_purchase', 'food_order_refund']);
const FEE_REFERENCE_TYPES = new Set(['customer_transfer_fee']);
const ORDER_REFERENCE_TYPES = new Set(['food_order', 'food_order_refund']);

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

async function loadDocument(documentId, customerId) {
  if (!UUID_RE.test(String(documentId || ''))) {
    throw new AppError('Statement not found', 404, 'statement_not_found');
  }
  const { rows } = await pool.query(
    `SELECT id, customer_id, product, account_id, currency_code, period_from, period_to,
            generated_at, document, content_hash
       FROM credit_statement_documents
      WHERE id = $1`,
    [documentId]
  );
  const row = rows[0];
  // Unknown documents and documents owned by someone else are
  // indistinguishable: 404 in both cases so ownership cannot be probed.
  if (!row || String(row.customer_id) !== String(customerId)) {
    throw new AppError('Statement not found', 404, 'statement_not_found');
  }
  const document = row.document;
  if (!document || typeof document !== 'object'
    || document.contentHash !== row.content_hash
    || hashDocument(document) !== row.content_hash) {
    throw new AppError('Statement verification failed', 409, 'statement_integrity_failed');
  }
  return { accountId: row.account_id, document };
}

function findEntry(document, entryId) {
  const wanted = String(entryId || '');
  const transactions = Array.isArray(document.transactions) ? document.transactions : [];
  const entry = transactions.find((tx) => String(tx?.id) === wanted);
  if (!entry) throw new AppError('Statement entry not found', 404, 'statement_entry_not_found');
  return entry;
}

function entryAmountCents(entry) {
  const debit = Number(entry.debitCents || 0);
  const credit = Number(entry.creditCents || 0);
  return debit > 0 ? debit : credit;
}

// Immutable journal identity for a snapshot entry. The journal tables are
// append-only, so this identity can only ever resolve to the same row.
async function journalIdentity(document, entry, accountId) {
  if (document.product === 'oxsteed') {
    const { rows } = await pool.query(
      `SELECT e.id AS journal_entry_id, t.status AS live_status,
              t.reference_type, t.reference_id
         FROM oxsteed_credit_transaction_entries e
         JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
        WHERE e.transaction_id = $1 AND e.account_id = $2`,
      [entry.id, accountId]
    );
    const journal = rows[0] || null;
    return {
      journalId: String(entry.id),
      journalEntryId: journal ? String(journal.journal_entry_id) : null,
      liveStatus: journal ? journal.live_status : null,
      referenceType: journal ? journal.reference_type : null,
      referenceId: journal ? journal.reference_id : null,
    };
  }
  if (!POSITIVE_INT_RE.test(String(entry.id))) {
    throw new AppError('Statement entry not found', 404, 'statement_entry_not_found');
  }
  const { rows } = await pool.query(
    `SELECT id AS journal_entry_id, reference_type, reference_id
       FROM food_customer_wallet_ledger
      WHERE id = $1 AND account_id = $2`,
    [entry.id, accountId]
  );
  const journal = rows[0] || null;
  return {
    journalId: String(entry.id),
    journalEntryId: journal ? String(journal.journal_entry_id) : String(entry.id),
    liveStatus: journal ? 'posted' : null,
    referenceType: journal ? journal.reference_type : null,
    referenceId: journal ? journal.reference_id : null,
  };
}

function entryView(document, entry, journal) {
  const maskedReference = maskReference(journal.referenceId);
  return {
    entryId: String(entry.id),
    journalId: journal.journalId,
    journalEntryId: journal.journalEntryId,
    postedAt: entry.date,
    type: entry.type,
    description: entry.description,
    debitCents: Number(entry.debitCents || 0),
    creditCents: Number(entry.creditCents || 0),
    balanceAfterCents: Number(entry.balanceAfterCents || 0),
    currencyCode: document.currencyCode,
    maskedReference,
    feeReference: journal.referenceType && FEE_REFERENCE_TYPES.has(journal.referenceType) ? maskedReference : null,
    refundReference: journal.referenceType && REFUND_REFERENCE_TYPES.has(journal.referenceType) ? maskedReference : null,
    status: journal.liveStatus,
    // Historical facts come from the immutable statement; a live transaction
    // status is current information, labeled as such.
    statusAsOf: document.product === 'oxsteed' ? 'live' : 'historical',
    caseSupport: CASE_SUPPORT[document.product],
  };
}

// Resolve a related record through explicit stored relationships only.
// Returns linked | unavailable (record deleted) | unsupported (no explicit
// relationship) | external (payment provider reference, masked).
async function resolveRelated({ document, journal, customerId, accountId }) {
  const { referenceType, referenceId } = journal;
  if (!referenceType || !referenceId) return { status: 'unsupported' };
  const bareId = POSITIVE_INT_RE.test(String(referenceId)) ? String(referenceId) : null;

  if (ORDER_REFERENCE_TYPES.has(referenceType) && bareId) {
    const params = [bareId, customerId];
    let sql = `SELECT o.id, o.status, o.payment_status, o.total_cents, o.currency_code,
                      o.created_at, r.display_name AS restaurant_name
                 FROM food_orders o
                 LEFT JOIN food_restaurants r ON r.id = o.restaurant_id
                WHERE o.id = $1 AND o.customer_id = $2`;
    if (document.product === 'restaurant') {
      const { rows: [account] } = await pool.query(
        'SELECT restaurant_id FROM food_customer_wallet_accounts WHERE id = $1', [accountId]
      );
      if (!account) return { status: 'unsupported' };
      params.push(account.restaurant_id);
      sql += ' AND o.restaurant_id = $3';
    }
    const { rows } = await pool.query(sql, params);
    const order = rows[0];
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

  if (document.product === 'oxsteed' && referenceType === 'oxsteed_credit_purchase' && UUID_RE.test(String(referenceId))) {
    const { rows } = await pool.query(
      `SELECT t.id, t.transaction_type, t.status, t.amount_cents, t.currency_code, t.posted_at
         FROM oxsteed_credit_transactions t
        WHERE t.id = $1 AND (t.debit_account_id = $2 OR t.credit_account_id = $2)`,
      [referenceId, accountId]
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

  if (document.product === 'oxsteed' && referenceType === 'stripe_topup') {
    return {
      status: 'external',
      kind: 'payment',
      label: 'Card payment reference',
      maskedReference: maskReference(referenceId),
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

async function listEntryCases(customerId, entryId) {
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
    [entryId, customerId]
  );
  return rows.map((row) => caseView(formatDispute(row)));
}

function restaurantCaseRequestId(customerId, accountId, entryId) {
  const bytes = crypto.createHash('sha256').update(`statement-support:v1:${customerId}:${accountId}:${entryId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function supportCaseView(row) {
  return {
    caseId: row.id, status: row.status, reasonCode: row.metadata?.reasonCode || 'statement_entry_issue',
    openedAt: row.created_at, updatedAt: row.updated_at || row.created_at,
    statement: row.metadata?.statement || null,
    detailUrl: `/support/my-tickets/${row.id}`,
  };
}

async function listRestaurantEntryCases(customerId, accountId, entryId) {
  const { rows } = await pool.query(
    `SELECT id, status, created_at, updated_at, metadata FROM support_tickets
     WHERE user_id = $1 AND client_request_id = $2 ORDER BY created_at DESC, id DESC`,
    [customerId, restaurantCaseRequestId(customerId, accountId, entryId)]);
  return rows.map(supportCaseView);
}

async function openRestaurantEntryCase({ customerId, accountId, document, entry, journal, reason, reasonKey, customerText }) {
  return withTransaction(pool, async client => {
    // Recheck the current wallet owner and exact journal scope inside the case
    // transaction. Deleted related orders do not prevent a clarification case.
    const { rows: [wallet] } = await client.query(
      `SELECT a.restaurant_id FROM food_customer_wallet_accounts a
       JOIN food_customer_wallet_ledger e ON e.account_id = a.id
       WHERE a.id = $1 AND a.customer_id = $2 AND a.currency_code = $3 AND e.id = $4`,
      [accountId, customerId, document.currencyCode, entry.id]);
    if (!wallet || journal.liveStatus !== 'posted') throw new AppError('Statement entry not found', 404, 'statement_entry_not_found');
    const statement = {
      ...documentContext(document), entryId: String(entry.id), journalEntryId: String(entry.id),
      accountId: String(accountId), restaurantId: String(wallet.restaurant_id), contentHash: document.contentHash,
      periodFrom: document.period?.from || null, periodTo: document.period?.to || null,
    };
    const { rows: [user] } = await client.query('SELECT first_name, last_name, email FROM users WHERE id = $1', [customerId]);
    const ticket = await createLinkedSupportTicket(client, {
      userId: customerId, name: [user?.first_name, user?.last_name].filter(Boolean).join(' '), email: user?.email,
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

router.get('/statements/:documentId/entries', async (req, res, next) => {
  try {
    const { accountId, document } = await loadDocument(req.params.documentId, req.user.id);
    const { page, pageSize } = parsePagination(req.query);
    const transactions = Array.isArray(document.transactions) ? document.transactions : [];
    const total = transactions.length;
    const slice = transactions.slice((page - 1) * pageSize, page * pageSize);
    const entries = [];
    for (const entry of slice) {
      const journal = await journalIdentity(document, entry, accountId);
      entries.push(entryView(document, entry, journal));
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
    const { accountId, document } = await loadDocument(req.params.documentId, req.user.id);
    const entry = findEntry(document, req.params.entryId);
    const journal = await journalIdentity(document, entry, accountId);
    const statement = entryView(document, entry, journal);
    const related = await resolveRelated({ document, journal, customerId: req.user.id, accountId });
    const checkedAt = new Date().toISOString();
    const live = document.product === 'oxsteed'
      ? {
        status: journal.liveStatus,
        checkedAt,
        note: 'Current transaction status, checked just now. It is not part of the historical statement.',
      }
      : {
        status: 'posted',
        checkedAt,
        note: 'Wallet ledger entries are append-only. This status is the historical record.',
      };
    const cases = document.product === 'oxsteed' ? await listEntryCases(req.user.id, statement.entryId)
      : await listRestaurantEntryCases(req.user.id, accountId, statement.entryId);
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
    const { accountId, document } = await loadDocument(req.params.documentId, req.user.id);
    const entry = findEntry(document, req.params.entryId);
    if (document.product === 'oxsteed' && !UUID_RE.test(String(entry.id))) {
      throw new AppError('Statement entry cannot be reported', 409, 'statement_case_unsupported');
    }
    const reasonKey = String(req.body?.reason || 'unrecognized');
    const reason = CASE_REASONS[reasonKey];
    if (!reason) throw new AppError('Unsupported report reason', 400, 'statement_case_reason_invalid');
    const customerText = sanitizeText(req.body?.description, 1000);

    const journal = await journalIdentity(document, entry, accountId);
    if (document.product === 'restaurant') {
      const result = await openRestaurantEntryCase({ customerId: req.user.id, accountId, document, entry, journal, reason, reasonKey, customerText });
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
      transactionId: entry.id,
      reasonCode: reason.reasonCode,
      description,
      actorUserId: req.user.id,
      idempotencyKey,
      requestIp: req.ip || null,
      disputeType: reason.disputeType,
      statement: {
        documentId: String(document.id),
        revision: Number(document.version || 1),
        entryId: String(entry.id),
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
    const { accountId, document } = await loadDocument(req.params.documentId, req.user.id);
    const entry = findEntry(document, req.params.entryId);
    if (document.product !== 'oxsteed') {
      const cases = await listRestaurantEntryCases(req.user.id, accountId, String(entry.id));
      return res.json({ ...documentContext(document), entryId: String(entry.id), caseSupport: 'support_tickets', cases });
    }
    const cases = await listEntryCases(req.user.id, String(entry.id));
    res.json({ ...documentContext(document), entryId: String(entry.id), caseSupport: 'credit_disputes', cases });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
