'use strict';

// settlementStatementArchive — self-contained Express router for the
// workstream-8 settlement statement products (restaurant_settlement,
// helper_earnings, business).
//
// It is NOT mounted here; the coordinator mounts it (see the report for the
// exact mount line, suggested: app.use('/api/settlement-statements', router)).
//
// Access control (server-side, every read/download/action):
// - helper_earnings: self-service only. The scope helper id must equal
//   req.user.id. Nobody else (not team members, not business managers) can
//   read another helper's earnings.
// - restaurant_settlement: the restaurant's business owner
//   (businesses.user_id or food_restaurants.owner_user_id) or an ACTIVE
//   business_members row with role 'manager'. Representatives are denied:
//   migration 062 gives them no financial-data access. Revoked/pending
//   members are denied (membership is checked at request time, never
//   cached), so removed members lose access immediately.
// - business: the business owner or an ACTIVE manager of that business.
// - Parent/franchise/cross-entity: there is no ledger-level parent/child
//   linkage between business entities, so there is no consolidation view.
//   Default is no cross-entity visibility.
// - Unknown/unauthorized scopes return 404 (never 403) so document and scope
//   existence cannot be enumerated.
//
// Safety rules:
// - Issued originals are append-only (migration 688 immutability trigger);
//   this router has no write path except on-demand issuance, which converges
//   on the archived original for monthly periods.
// - Only archived monthly originals and freshly reconciled interim builds
//   are served; content hashes are verified on every archived read.
// - No PII in URLs, object keys, or download filenames. Filenames carry
//   product, period, and currency only.
// - Responses carry private, no-store headers.

const express = require('express');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { authenticate } = require('../middleware/auth');
const { creditExportLimiter } = require('../middleware/rateLimiter');
const statements = require('../services/settlementStatementService');
const { hashDocument } = statements;

const copy = require('../locales/statement-copy.json');

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCTS = new Set(['restaurant_settlement', 'helper_earnings', 'business']);
const LANGUAGES = ['en', 'es', 'fr', 'ht', 'ar'];
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PER_PAGE = 100;
const DEFAULT_PER_PAGE = 20;

router.use(authenticate);
router.use(noStoreArchiveResponse);

function noStoreArchiveResponse(_req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
}

function notFound() {
  // Tampered, malformed, or unauthorized ids are indistinguishable from
  // missing ones: 404 with no indication of what exists.
  throw new AppError('Statement document not found', 404, 'statement_document_not_found');
}

function documentIdOr404(value) {
  if (!UUID_PATTERN.test(String(value || ''))) notFound();
  return String(value).toLowerCase();
}

function parseProduct(value) {
  const product = String(value || '');
  if (!PRODUCTS.has(product)) {
    throw new AppError('Unknown statement product', 400, 'statement_invalid_product');
  }
  return product;
}

function parseScopeId(product, value) {
  const text = String(value || '');
  if (product === 'helper_earnings') {
    if (!UUID_PATTERN.test(text)) throw new AppError('Invalid statement account', 400, 'statement_invalid_account');
    return text.toLowerCase();
  }
  if (!/^[1-9]\d*$/.test(text)) throw new AppError('Invalid statement account', 400, 'statement_invalid_account');
  return Number(text);
}

function parseCurrency(value, fallback = 'USD') {
  const currency = String(value || fallback).toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) throw new AppError('Invalid currency', 400, 'statement_invalid_account');
  return currency;
}

function parseDateParam(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  if (!DATE_PATTERN.test(String(value))) throw new AppError(`Invalid ${name}`, 400, 'statement_invalid_period');
  return String(value);
}

function labelsFor(language) {
  const lang = LANGUAGES.includes(language) ? language : 'en';
  return { ...copy.en, ...copy[lang] };
}

async function resolveLanguage(userId) {
  try {
    const { rows: [row] } = await pool.query('SELECT preferred_language FROM users WHERE id = $1', [userId]);
    const lang = String(row?.preferred_language || 'en').split(/[-_]/)[0].toLowerCase();
    return LANGUAGES.includes(lang) ? lang : 'en';
  } catch {
    return 'en';
  }
}

// Finance standing for a merchant scope: business owner (or the restaurant's
// recorded owner) or an ACTIVE manager. Representatives, pending, and revoked
// members are denied. Checked at request time so removed members lose access
// immediately.
async function assertMerchantFinanceStanding(userId, { product, restaurantId, businessId }) {
  let businessIdEff = businessId;
  let restaurantOwnerId = null;
  if (product === 'restaurant_settlement') {
    const { rows: [r] } = await pool.query(
      `SELECT fr.business_id, fr.owner_user_id FROM food_restaurants fr WHERE fr.id = $1`,
      [restaurantId]);
    if (!r) notFound();
    businessIdEff = Number(r.business_id);
    restaurantOwnerId = String(r.owner_user_id);
  }
  const { rows } = await pool.query(
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

async function assertScopeStanding(userId, product, scopeId) {
  if (product === 'helper_earnings') {
    // Self-service only.
    if (String(scopeId).toLowerCase() !== String(userId).toLowerCase()) notFound();
    return { role: 'self' };
  }
  if (product === 'restaurant_settlement') {
    return assertMerchantFinanceStanding(userId, { product, restaurantId: scopeId });
  }
  return assertMerchantFinanceStanding(userId, { product, businessId: scopeId });
}

function scopeFilter(product, scopeId) {
  if (product === 'restaurant_settlement') return { column: 'scope_restaurant_id', value: scopeId };
  if (product === 'helper_earnings') return { column: 'scope_helper_user_id', value: scopeId };
  return { column: 'scope_business_id', value: scopeId };
}

// ── Issue (on-demand; monthly periods converge on the archived original) ──
router.get('/issue', creditExportLimiter, async (req, res, next) => {
  try {
    const product = parseProduct(req.query.product);
    const userId = req.user.id;
    let scopeId;
    if (product === 'helper_earnings') {
      scopeId = String(userId).toLowerCase();
      if (req.query.helperId && String(req.query.helperId).toLowerCase() !== scopeId) notFound();
    } else if (product === 'restaurant_settlement') {
      scopeId = parseScopeId(product, req.query.restaurantId);
    } else {
      scopeId = parseScopeId(product, req.query.businessId);
    }
    await assertScopeStanding(userId, product, scopeId);
    const options = {
      product,
      currencyCode: parseCurrency(req.query.currency),
      from: parseDateParam(req.query.from, 'from'),
      to: parseDateParam(req.query.to, 'to'),
    };
    if (product === 'restaurant_settlement') options.restaurantId = scopeId;
    else if (product === 'business') options.businessId = scopeId;
    else options.helperId = scopeId;
    const document = await statements.getStatement(userId, options);
    logger.info('settlement statement issued', {
      product, documentId: document.id, userId: String(userId),
    });
    res.json({ document });
  } catch (err) { next(err); }
});

// ── Archive listing (metadata only; document bodies stay out of lists) ────
router.get('/archive', async (req, res, next) => {
  try {
    const product = parseProduct(req.query.product);
    const userId = req.user.id;
    let scopeId;
    if (product === 'helper_earnings') scopeId = String(userId).toLowerCase();
    else if (product === 'restaurant_settlement') scopeId = parseScopeId(product, req.query.restaurantId);
    else scopeId = parseScopeId(product, req.query.businessId);
    await assertScopeStanding(userId, product, scopeId);
    const { column, value } = scopeFilter(product, scopeId);
    const currency = req.query.currency ? parseCurrency(req.query.currency) : null;
    const limit = Math.min(MAX_PER_PAGE, Math.max(1, Number.parseInt(req.query.limit, 10) || DEFAULT_PER_PAGE));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const params = [product, value];
    const filters = [`product = $1`, `${column} = $2`];
    if (currency) { params.push(currency); filters.push(`currency_code = $${params.length}`); }
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT id, product, currency_code, period_from, period_to, generated_at, content_hash
         FROM settlement_statement_documents
        WHERE ${filters.join(' AND ')}
        ORDER BY period_to DESC, period_from DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params);
    res.json({
      product,
      currencyCode: currency,
      statements: rows.map((row) => ({
        id: row.id,
        product: row.product,
        currencyCode: row.currency_code,
        periodFrom: row.period_from,
        periodTo: row.period_to,
        generatedAt: new Date(row.generated_at).toISOString(),
        contentHash: row.content_hash,
      })),
      pagination: { limit, offset },
    });
  } catch (err) { next(err); }
});

async function requireAuthorizedDocument(documentId, userId) {
  const { rows: [row] } = await pool.query(
    `SELECT id, product, scope_restaurant_id, scope_business_id, scope_helper_user_id,
            currency_code, period_from, period_to, generated_at, document, content_hash
       FROM settlement_statement_documents WHERE id = $1`,
    [documentId]);
  if (!row) notFound();
  const scopeId = row.scope_restaurant_id ?? row.scope_business_id ?? row.scope_helper_user_id;
  await assertScopeStanding(userId, row.product, scopeId);
  if (row.document?.contentHash !== row.content_hash || hashDocument(row.document) !== row.content_hash) {
    throw new AppError('Statement verification failed', 409, 'statement_integrity_failed');
  }
  return row;
}

// ── Archived original (JSON) ───────────────────────────────────────────────
// NOTE: the CSV route must stay above /archive/:id, otherwise :id swallows
// the ".csv" suffix and the export 404s.
router.get('/archive/:id.csv', creditExportLimiter, async (req, res, next) => {
  try {
    const row = await requireAuthorizedDocument(documentIdOr404(req.params.id), req.user.id);
    const labels = labelsFor(await resolveLanguage(req.user.id));
    const csv = documentToCsv(row.document, labels);
    logger.info('settlement statement csv exported', { documentId: row.id, userId: String(req.user.id) });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${csvFilename(row.document)}"`);
    res.send(csv);
  } catch (err) { next(err); }
});

router.get('/archive/:id', async (req, res, next) => {
  try {
    const row = await requireAuthorizedDocument(documentIdOr404(req.params.id), req.user.id);
    res.json({ document: row.document });
  } catch (err) { next(err); }
});

// ── Hash verification ──────────────────────────────────────────────────────
router.get('/archive/:id/verify', async (req, res, next) => {
  try {
    const row = await requireAuthorizedDocument(documentIdOr404(req.params.id), req.user.id);
    const recomputed = hashDocument(row.document);
    res.json({
      id: row.id,
      valid: recomputed === row.content_hash && row.document?.contentHash === row.content_hash,
      contentHash: row.content_hash,
    });
  } catch (err) { next(err); }
});

// ── CSV export (accessible, machine-readable rendition of the original) ────
function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvFilename(document) {
  // No PII: product, period, and currency identify the statement.
  const from = document.period?.from || 'unknown';
  const to = document.period?.to || 'unknown';
  return `settlement-statement-${document.product}-${from}-${to}.${document.currencyCode}.csv`;
}

function documentToCsv(document, labels) {
  const lines = [];
  const header = (text) => lines.push(csvCell(text));
  header(`${labels[document.product] || document.product} — ${document.accountLabel || ''}`);
  lines.push([csvCell('Period'), csvCell(`${document.period?.from} to ${document.period?.to} (UTC)`),
    csvCell('Currency'), csvCell(document.currencyCode),
    csvCell('Reference'), csvCell(document.accountReference || ''),
    csvCell('Generated'), csvCell(document.generatedAt || '')].join(','));
  lines.push([csvCell('Content SHA-256'), csvCell(document.contentHash || '')].join(','));
  lines.push('');

  const money = (cents) => (Number(cents) / 100).toFixed(2);
  if (document.product === 'restaurant_settlement') {
    lines.push([csvCell(labels.journalSection)].join(','));
    lines.push([csvCell('Date (UTC)'), csvCell('Type'), csvCell('Description'),
      csvCell('Debit'), csvCell('Credit'), csvCell('Balance'), csvCell('Reference')].join(','));
    for (const tx of document.transactions || []) {
      lines.push([csvCell(tx.date), csvCell(labels[tx.type] || tx.type), csvCell(tx.description),
        csvCell(tx.debitCents ? money(tx.debitCents) : ''),
        csvCell(tx.creditCents ? money(tx.creditCents) : ''),
        csvCell(money(tx.balanceAfterCents)),
        csvCell(tx.referenceId ? `${tx.referenceType}:${tx.referenceId}` : '')].join(','));
    }
    lines.push([csvCell('Opening'), '', '', '', '', csvCell(money(document.openingBalanceCents))].join(','));
    lines.push([csvCell('Closing'), '', '', '', '', csvCell(money(document.closingBalanceCents))].join(','));
    lines.push('');
    lines.push([csvCell(labels.payoutsSection)].join(','));
    lines.push([csvCell('Payout'), csvCell('Amount'), csvCell('Outcome'), csvCell('Status'),
      csvCell('Transfer ref'), csvCell('Journal posted'), csvCell('Created')].join(','));
    for (const p of document.payouts || []) {
      lines.push([csvCell(p.id), csvCell(money(p.amountCents)), csvCell(p.outcome), csvCell(p.status),
        csvCell(p.stripeTransferRef || ''), csvCell(p.journalLegPosted ? 'yes' : 'no'),
        csvCell(p.createdAt)].join(','));
    }
    lines.push('');
    lines.push([csvCell(labels.payoutHonestyNote)].join(','));
    lines.push([csvCell(labels.customerCreditNote)].join(','));
  } else if (document.product === 'helper_earnings') {
    lines.push([csvCell(labels.bucketsSection)].join(','));
    lines.push([csvCell('Bucket'), csvCell('Amount')].join(','));
    const buckets = document.buckets || {};
    lines.push([csvCell(labels.accrued), csvCell(money(buckets.accruedCents || 0))].join(','));
    lines.push([csvCell(labels.inTransit), csvCell(money(buckets.inTransitCents || 0))].join(','));
    lines.push([csvCell(labels.settledBucket), csvCell(money(buckets.settledAllTimeCents || 0))].join(','));
    lines.push([csvCell(labels.notOwedBucket), csvCell(money(buckets.notOwedCents || 0))].join(','));
    lines.push('');
    lines.push([csvCell(labels.earningsSection)].join(','));
    lines.push([csvCell('Job'), csvCell('Title'), csvCell('Completed'), csvCell('Status'),
      csvCell('Earned'), csvCell('Platform fee'), csvCell('Payment')].join(','));
    for (const e of document.earnings || []) {
      lines.push([csvCell(e.jobId), csvCell(e.title), csvCell(e.completedAt), csvCell(e.payoutStatus),
        csvCell(money(e.helperPayoutCents)),
        csvCell(e.platformFeeCents === null ? '' : money(e.platformFeeCents)),
        csvCell(e.payment ? e.payment.status : '')].join(','));
    }
    lines.push('');
    lines.push([csvCell(labels.settledSection)].join(','));
    lines.push([csvCell('Job'), csvCell('Title'), csvCell('Paid at'), csvCell('Amount')].join(','));
    for (const s of document.settled || []) {
      lines.push([csvCell(s.jobId), csvCell(s.title), csvCell(s.paidAt), csvCell(money(s.helperPayoutCents))].join(','));
    }
    lines.push([csvCell('Opening payable'), csvCell(money(document.openingPayableCents))].join(','));
    lines.push([csvCell('Closing payable'), csvCell(money(document.closingPayableCents))].join(','));
    lines.push('');
    lines.push([csvCell(labels.notTaxForm)].join(','));
    lines.push([csvCell(labels.helperSnapshotNote)].join(','));
  } else {
    lines.push([csvCell(labels.receivablesSection)].join(','));
    lines.push([csvCell('Invoice'), csvCell('Client'), csvCell('Status'), csvCell('Issued'),
      csvCell('Total'), csvCell('Paid'), csvCell('Outstanding')].join(','));
    for (const inv of document.receivables?.invoices || []) {
      lines.push([csvCell(inv.invoiceNumber), csvCell(inv.clientName), csvCell(inv.status),
        csvCell(inv.issueDate || ''), csvCell(money(inv.totalCents)), csvCell(money(inv.paidCents)),
        csvCell(money(inv.outstandingCents))].join(','));
    }
    const r = document.receivables || {};
    lines.push([csvCell('Opening outstanding'), csvCell(money(r.openingOutstandingCents || 0))].join(','));
    lines.push([csvCell('Closing outstanding'), csvCell(money(r.closingOutstandingCents || 0))].join(','));
    lines.push('');
    lines.push([csvCell(labels.payablesSection)].join(','));
    lines.push([csvCell('Date'), csvCell('Category'), csvCell('Description'), csvCell('Amount')].join(','));
    for (const e of document.payables?.expenses || []) {
      lines.push([csvCell(e.expenseDate), csvCell(e.category), csvCell(e.description), csvCell(money(e.amountCents))].join(','));
    }
    lines.push('');
    lines.push([csvCell(labels.businessLimitationNote)].join(','));
    lines.push([csvCell(labels.notTaxForm)].join(','));
  }
  lines.push([csvCell(labels.support || '')].join(','));
  return lines.join('\r\n');
}

module.exports = router;
// assertScopeStanding is a production authorization predicate: the
// rendition routes reuse it so settlement documents are authorized by the
// same rule as the settlement archive. testHooks keep the documented
// test-only surface.
module.exports.assertScopeStanding = assertScopeStanding;
// Test hooks: the authorization predicates, exported for behavior tests so
// access control is exercised without standing up the full HTTP stack.
module.exports.testHooks = { assertScopeStanding, parseProduct, parseScopeId };
