'use strict';

/**
 * statementAmendmentService — Phase 4 (workstream 3): reviewed corrections
 * to issued statements.
 *
 * Model (see migration 687):
 *   - An amendment PROPOSAL names one issued original
 *     (credit_statement_documents row), a type, and a reason. `clerical`
 *     proposals correct presentation only and reference no ledger
 *     transactions; `accounting` proposals reference posted compensating
 *     transactions that were created through the authoritative money flows
 *     (e.g. the credit adjustment flow with its own approvals).
 *   - On APPROVAL the service re-derives the period from the ledger,
 *     re-validates everything the proposal pinned (original hash, ledger
 *     fingerprint, revision base, referenced transactions), renders the
 *     amended document, publishes it as a labeled rendition artifact
 *     (`amended-vN`), inserts ONE immutable version row, and queues a
 *     `statement.amended` outbox event so the owner is notified exactly once.
 *
 * Non-negotiables enforced here:
 *   - Statements never move money. This service performs no ledger writes
 *     and invents no adjustments: an accounting amendment only REFERENCES
 *     compensating transaction ids, and the amended statement is re-derived
 *     from the ledger after those post. Re-derivation uses
 *     creditStatementService.getStatement with { rederive: true }.
 *   - Issued originals are append-only. Corrections insert new version rows;
 *     the original (and every published version) is frozen by a DB trigger.
 *   - Integer minor units everywhere; every version asserts
 *     opening + credits - debits = closing (the statement builders throw
 *     statement_integrity_failed otherwise).
 *   - For a restated accounting amendment the ONLY ledger delta vs the
 *     original may be the referenced corrections: every new transaction in
 *     the re-derived period must be a referenced id, and the totals must tie
 *     out to the references exactly. This is what prevents double counting.
 *   - Continuity: a revised closing must chain into the next issued period's
 *     opening. A mismatch blocks approval finalization with
 *     statement_amendment_continuity_blocked (409) unless the proposal
 *     declared restate_forward, in which case the break is recorded and
 *     disclosed on the version; the next period's issued row is never edited.
 *   - Idempotent publication: UNIQUE(proposal_id) on the versions table plus
 *     an early "already published" check make finalize and retry-publish safe
 *     to re-run; a storage failure leaves the proposal approved-but-
 *     unpublished with attempts recorded in
 *     statement_amendment_publication_attempts.
 *   - No PII in outbox payloads, keys, or filenames. Server-side auth lives
 *     in the route layer.
 *
 * Presentation vocabulary (documented for operators and the archive):
 *   - restated: the period is re-derived including the corrections.
 *     Backdated corrections (effective date before the original issuance)
 *     are explicitly dated and disclosed in the version envelope.
 *   - later_period: the correction's accounting effect lands in a later
 *     period where the compensating transactions actually posted. This
 *     period's balances are unchanged; the adjustment is disclosed with the
 *     referenced transactions and their dates so it is never double counted.
 */

const crypto = require('crypto');
const pool = require('../db');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const statements = require('./creditStatementService');
const settlementStatements = require('./settlementStatementService');
const sourceHistory = require('./settlementFinancialHistory');
const snapshots = require('./statementSnapshotService');
const artifacts = require('./statementArtifactService');
const jobs = require('./statementJobService');
const { renderStatementPdfInWorker } = require('./creditStatementExport');
const defaultStorage = require('../utils/statementStorage');

// Products whose statements archive into settlement_statement_documents
// (migration 688). Amendments to them produce versions linked to that
// archive (migration 690); scopes never mix with credit_statement_documents.
const SETTLEMENT_PRODUCTS = new Set(['restaurant_settlement', 'helper_earnings', 'business']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INT_RE = /^[1-9]\d*$/;
const AMENDMENT_TYPES = new Set(['clerical', 'accounting']);
const PRESENTATIONS = new Set(['restated', 'later_period']);
const LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar']);
const CORE_MONEY_KEYS = ['openingBalanceCents', 'totalCreditsCents', 'totalDebitsCents', 'closingBalanceCents'];
const HELPER_MONEY_KEYS = ['openingMinor', 'postedMinor', 'settledMinor', 'removedMinor', 'closingMinor'];
const BUSINESS_MONEY_KEYS = ['openingMinor', 'invoicedMinor', 'collectedOrAdjustedMinor', 'cancelledMinor', 'closingMinor'];
// Accounting amendments need posted compensating transactions to reference.
// helper_earnings and business records are activity snapshots, not
// append-only ledgers (see the settlement inventory), so accounting
// amendments fail closed for them; clerical amendments are fully supported.

function fail(code, message, statusCode = 400) {
  throw new AppError(message, statusCode, code);
}

function checkUuid(value, name) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    fail('statement_amendment_invalid_id', `Invalid ${name}; expected a UUID`, 400);
  }
  return value.toLowerCase();
}

function isoDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function assertMinorInteger(value, name) {
  if (!Number.isSafeInteger(value)) {
    fail('statement_amendment_integrity_failed', `Statement ${name} is not an integer minor-unit amount`, 409);
  }
  return value;
}

// The money-relevant core of a statement document, per product kind. The
// fingerprint pins the ledger-derived source data a proposal was built
// against so approval re-validates it instead of trusting it.
//
// Kinds:
// - 'journal': oxsteed, restaurant (credit) and restaurant_settlement. The
//   classic journal core: opening + credits - debits = closing over the
//   period's transactions.
// - 'helper': helper_earnings. opening + posted - settled - removed = closing
//   over the period's earning/settlement/removal rows.
// - 'business': business. opening + invoiced - collectedOrAdjusted -
//   cancelled = closing over the period's invoices.
// Every kind uses openingMinor/closingMinor as the canonical opening/closing
// slots so continuity and the version envelope stay generic.
function coreOf(document) {
  const source = document && typeof document === 'object' ? document : {};
  const product = source.product;
  if (product === 'helper_earnings') {
    return {
      kind: 'helper',
      openingMinor: source.openingPayableCents,
      postedMinor: source.postedEarningsCents,
      settledMinor: source.settledPayoutsCents,
      removedMinor: source.statusRemovalsCents,
      closingMinor: source.closingPayableCents,
      rowCount: Number(source.earningsCount || 0) + Number(source.settledCount || 0) + Number(source.removedCount || 0),
      movements: Array.isArray(source.movements) ? source.movements : null,
      rows: [
        ...(Array.isArray(source.earnings) ? source.earnings : []).map((e) => ({
          id: `earned:${e.sourceHistoryId || e.jobId}`, date: e.recordedAt || e.completedAt, amountCents: e.helperPayoutCents, kind: e.kind,
        })),
        ...(Array.isArray(source.settled) ? source.settled : []).map((e) => ({
          id: `settled:${e.sourceHistoryId || e.jobId}`, date: e.recordedAt || e.paidAt, amountCents: e.helperPayoutCents,
        })),
        ...(Array.isArray(source.removed) ? source.removed : []).map((e) => ({
          id: `removed:${e.sourceHistoryId || e.jobId}`, date: e.recordedAt || e.removedAt || e.completedAt, amountCents: e.helperPayoutCents,
        })),
      ],
    };
  }
  if (product === 'business') {
    const receivables = source.receivables && typeof source.receivables === 'object' ? source.receivables : {};
    return {
      kind: 'business',
      openingMinor: receivables.openingOutstandingCents,
      invoicedMinor: receivables.invoicedCents,
      collectedOrAdjustedMinor: receivables.collectedOrAdjustedCents,
      cancelledMinor: receivables.cancelledCents,
      closingMinor: receivables.closingOutstandingCents,
      rowCount: Number(receivables.invoiceCount || 0),
      movements: Array.isArray(receivables.movements) ? receivables.movements : null,
      payables: source.payables || null,
      rows: (Array.isArray(receivables.invoices) ? receivables.invoices : []).map((inv) => ({
        id: String(inv.id),
        status: inv.status,
        issueDate: inv.issueDate,
        totalCents: inv.totalCents,
        paidCents: inv.paidCents,
        outstandingCents: inv.outstandingCents,
      })),
    };
  }
  const transactions = Array.isArray(source.transactions) ? source.transactions : [];
  return {
    kind: 'journal',
    openingBalanceCents: source.openingBalanceCents,
    totalCreditsCents: source.totalCreditsCents,
    totalDebitsCents: source.totalDebitsCents,
    closingBalanceCents: source.closingBalanceCents,
    // Canonical slots shared across kinds for continuity and envelopes.
    openingMinor: source.openingBalanceCents,
    closingMinor: source.closingBalanceCents,
    transactionCount: source.transactionCount,
    transactions: transactions.map((row) => ({
      id: String(row.id),
      date: row.date,
      debitCents: row.debitCents,
      creditCents: row.creditCents,
      balanceAfterCents: row.balanceAfterCents,
    })),
  };
}

function ledgerFingerprint(document) {
  return statements.hashDocument(coreOf(document));
}

function assertCoreMoneyIntegers(core, label) {
  const keys = core.kind === 'helper' ? HELPER_MONEY_KEYS
    : core.kind === 'business' ? BUSINESS_MONEY_KEYS : CORE_MONEY_KEYS;
  for (const key of keys) assertMinorInteger(core[key], `${label} ${key}`);
  const count = core.kind === 'journal' ? core.transactionCount : core.rowCount;
  if (!Number.isSafeInteger(count)) {
    fail('statement_amendment_integrity_failed', `Statement ${label} row count is not an integer`, 409);
  }
}

// The product's money equation over a core. Builders already enforce these;
// this is belt and braces before publishing a version.
function equationHolds(core) {
  if (core.kind === 'helper') {
    return BigInt(core.openingMinor) + BigInt(core.postedMinor)
      - BigInt(core.settledMinor) - BigInt(core.removedMinor) === BigInt(core.closingMinor);
  }
  if (core.kind === 'business') {
    return BigInt(core.openingMinor) + BigInt(core.invoicedMinor)
      - BigInt(core.collectedOrAdjustedMinor) - BigInt(core.cancelledMinor) === BigInt(core.closingMinor);
  }
  return BigInt(core.openingBalanceCents) + BigInt(core.totalCreditsCents)
    - BigInt(core.totalDebitsCents) === BigInt(core.closingBalanceCents);
}

// Totals groups for the version envelope, per product kind. openingMinor and
// closingMinor are the canonical slots; middle keys are product-specific.
function totalsOf(core) {
  if (core.kind === 'helper') {
    return {
      openingMinor: core.openingMinor,
      postedMinor: core.postedMinor,
      settledMinor: core.settledMinor,
      removedMinor: core.removedMinor,
      closingMinor: core.closingMinor,
      rowCount: core.rowCount,
    };
  }
  if (core.kind === 'business') {
    return {
      openingMinor: core.openingMinor,
      invoicedMinor: core.invoicedMinor,
      collectedOrAdjustedMinor: core.collectedOrAdjustedMinor,
      cancelledMinor: core.cancelledMinor,
      closingMinor: core.closingMinor,
      rowCount: core.rowCount,
    };
  }
  return {
    openingMinor: core.openingBalanceCents,
    creditsMinor: core.totalCreditsCents,
    debitsMinor: core.totalDebitsCents,
    closingMinor: core.closingBalanceCents,
    transactionCount: core.transactionCount,
  };
}

async function loadOriginalDocument(clientOrPool, documentId) {
  const { rows: [credit] } = await clientOrPool.query(
    `SELECT id, customer_id, product, account_id, currency_code,
            period_from, period_to, generated_at, document, content_hash
     FROM credit_statement_documents WHERE id = $1`,
    [documentId]);
  if (credit) {
    if (credit.document?.contentHash !== credit.content_hash || statements.hashDocument(credit.document) !== credit.content_hash) {
      fail('statement_amendment_integrity_failed', 'Original statement verification failed', 409);
    }
    return {
      kind: 'credit',
      id: credit.id,
      product: credit.product,
      customerId: String(credit.customer_id),
      accountId: Number(credit.account_id),
      accountUuid: null,
      currency_code: credit.currency_code,
      period_from: credit.period_from,
      period_to: credit.period_to,
      generated_at: credit.generated_at,
      document: credit.document,
      content_hash: credit.content_hash,
    };
  }
  const { rows: [settlement] } = await clientOrPool.query(
    `SELECT id, product, scope_restaurant_id, scope_business_id, scope_helper_user_id,
            currency_code, period_from, period_to, generated_at, document, content_hash
     FROM settlement_statement_documents WHERE id = $1`,
    [documentId]);
  if (!settlement) {
    fail('statement_amendment_document_not_found', 'Original statement document not found', 404);
  }
  if (settlement.document?.contentHash !== settlement.content_hash || statements.hashDocument(settlement.document) !== settlement.content_hash) {
    fail('statement_amendment_integrity_failed', 'Original statement verification failed', 409);
  }
  return {
    kind: 'settlement',
    id: settlement.id,
    product: settlement.product,
    customerId: await resolveSettlementRecipient(clientOrPool, settlement),
    accountId: settlement.scope_restaurant_id !== null && settlement.scope_restaurant_id !== undefined
      ? Number(settlement.scope_restaurant_id)
      : settlement.scope_business_id !== null && settlement.scope_business_id !== undefined
        ? Number(settlement.scope_business_id) : null,
    accountUuid: settlement.scope_helper_user_id ? String(settlement.scope_helper_user_id).toLowerCase() : null,
    currency_code: settlement.currency_code,
    period_from: settlement.period_from,
    period_to: settlement.period_to,
    generated_at: settlement.generated_at,
    document: settlement.document,
    content_hash: settlement.content_hash,
  };
}

// The notification recipient (and re-derivation requester) for a settlement
// original: the helper for helper_earnings, otherwise the business owner.
// Mirrors the finance-standing rule in routes/settlementStatementArchive.js.
async function resolveSettlementRecipient(clientOrPool, settlement) {
  if (settlement.product === 'helper_earnings') {
    return String(settlement.scope_helper_user_id).toLowerCase();
  }
  if (settlement.product === 'business') {
    const { rows: [business] } = await clientOrPool.query(
      'SELECT user_id FROM businesses WHERE id = $1', [settlement.scope_business_id]);
    if (!business) fail('statement_amendment_account_not_found', 'Statement business not found', 404);
    return String(business.user_id);
  }
  const { rows: [row] } = await clientOrPool.query(
    `SELECT b.user_id FROM food_restaurants fr
     JOIN businesses b ON b.id = fr.business_id
     WHERE fr.id = $1`,
    [settlement.scope_restaurant_id]);
  if (!row) fail('statement_amendment_account_not_found', 'Statement restaurant business not found', 404);
  return String(row.user_id);
}

// The baseline a new amendment builds on: the latest published version's
// envelope when the chain already exists, otherwise the issued original.
// Delta and equality checks always run against the baseline so ordered
// chains (v1, v2, ...) compose instead of each re-diffing the original.
async function loadBaseline(clientOrPool, original) {
  const scopeColumn = original.kind === 'credit' ? 'original_document_id' : 'settlement_original_document_id';
  const { rows: [latest] } = await clientOrPool.query(
    `SELECT id, document, content_hash, revision_number
     FROM statement_amendment_versions
     WHERE ${scopeColumn} = $1
     ORDER BY revision_number DESC LIMIT 1`,
    [original.id]);
  if (!latest) {
    return { kind: 'original', versionId: null, doc: original.document, contentHash: original.content_hash, revision: 1 };
  }
  return {
    kind: 'amendment',
    versionId: latest.id,
    doc: latest.document,
    contentHash: latest.content_hash,
    revision: Number(latest.revision_number) + 1,
  };
}

async function resolveWalletRestaurantId(clientOrPool, walletAccountId) {
  const { rows: [wallet] } = await clientOrPool.query(
    'SELECT restaurant_id FROM food_customer_wallet_accounts WHERE id = $1', [walletAccountId]);
  if (!wallet) fail('statement_amendment_account_not_found', 'Statement wallet account not found', 404);
  return Number(wallet.restaurant_id);
}

// Re-derive the period from the CURRENT records, bypassing the archived
// original (rederive mode). Credit products re-derive from the ledger via
// creditStatementService; settlement products re-derive from their own
// sources via settlementStatementService. Throws statement_integrity_failed
// when the derivation does not reconcile.
async function rederiveStatement(original) {
  const options = {
    currencyCode: original.currency_code,
    from: isoDate(original.period_from),
    to: isoDate(original.period_to),
    rederive: true,
  };
  if (original.kind === 'settlement') {
    options.product = original.product;
    if (original.product === 'restaurant_settlement') options.restaurantId = original.accountId;
    else if (original.product === 'business') options.businessId = original.accountId;
    else options.helperId = original.accountUuid;
    return settlementStatements.getStatement(original.customerId, options);
  }
  options.product = original.product;
  if (original.product === 'restaurant') {
    options.restaurantId = await resolveWalletRestaurantId(pool, original.accountId);
  }
  return statements.getStatement(original.customerId, options);
}

// Validate one compensating reference against the authoritative ledger.
// Returns { id, amountCents, direction, postedAt, kind } with direction
// relative to the statement's account. Never invents or moves money: the
// transaction must already exist and be posted.
async function fetchCompensatingRef(clientOrPool, product, accountId, currencyCode, ref) {
  if (product === 'helper_earnings' || product === 'business') {
    return fetchSettlementCompensatingRef(clientOrPool, product, accountId, currencyCode, ref);
  }
  if (product === 'oxsteed' || product === 'restaurant_settlement') {
    let journalAccountId = String(accountId);
    if (product === 'restaurant_settlement') {
      // The statement scope is the restaurant; compensating transactions
      // reference the restaurant's sub-bank journal account in the
      // statement's currency. Same journal, same direction rules as oxsteed.
      const { rows: [sub] } = await clientOrPool.query(
        `SELECT id FROM oxsteed_credit_accounts
         WHERE account_type = 'restaurant_sub_bank' AND restaurant_id = $1 AND currency_code = $2`,
        [String(accountId), currencyCode]);
      if (!sub) fail('statement_amendment_account_not_found', 'Statement sub-bank account not found', 404);
      journalAccountId = String(sub.id);
    }
    return fetchJournalCompensatingRef(clientOrPool, journalAccountId, currencyCode, ref);
  }
  const accountText = String(accountId);
  if (!POSITIVE_INT_RE.test(String(ref))) {
    fail('statement_amendment_invalid_ref', 'Compensating ledger reference must be a ledger entry id', 400);
  }
  const { rows: [entry] } = await clientOrPool.query(
    `SELECT id, amount_cents, currency_code, entry_type, account_id, created_at
     FROM food_customer_wallet_ledger WHERE id = $1`,
    [String(ref)]);
  if (!entry) fail('statement_amendment_transaction_not_found', 'Referenced compensating ledger entry does not exist', 404);
  if (String(entry.account_id) !== accountText || entry.currency_code !== currencyCode) {
    fail('statement_amendment_transaction_scope_mismatch', 'Referenced ledger entry does not belong to the statement account', 409);
  }
  return {
    id: String(entry.id),
    amountCents: assertMinorInteger(Number(entry.amount_cents), 'reference amount'),
    direction: entry.entry_type === 'debit' ? 'debit' : 'credit',
    postedAt: new Date(entry.created_at).toISOString(),
    effectiveDate: isoDate(entry.created_at),
    kind: entry.entry_type,
  };
}

// References name actual immutable observations captured from the existing
// financial writers by migration 694. Their posting date is recorded_at;
// mutable paid_at/issue_date/completed_at remain disclosures, never clocks.
async function fetchSettlementCompensatingRef(client, product, accountId, currencyCode, ref) {
  if (!POSITIVE_INT_RE.test(String(ref))) fail('statement_amendment_invalid_ref', 'A source history reference must be an observation id', 400);
  const kind = product === 'business' ? 'business_invoice' : 'helper_job';
  const { rows: [observation] } = await client.query(
    `SELECT * FROM settlement_source_history WHERE id = $1`, [ref]);
  if (!observation) fail('statement_amendment_transaction_not_found', 'Source observation not found', 404);
  if (observation.source_kind !== kind || String(observation.scope_id) !== String(accountId)
      || observation.currency_code !== currencyCode) {
    fail('statement_amendment_transaction_scope_mismatch', 'Source observation does not belong to this statement scope and currency', 409);
  }
  if (observation.operation !== 'update') fail('statement_amendment_invalid_ref', 'A correction must reference a recorded source update', 409);
  const { rows } = await client.query(
    `SELECT * FROM settlement_source_history WHERE source_kind = $1 AND source_id = $2
     AND id <= $3 ORDER BY id`, [kind, observation.source_id, observation.id]);
  const postedAt = new Date(observation.recorded_at).toISOString();
  const day = postedAt.slice(0, 10);
  const options = { currency: currencyCode, period: { from: day, to: day }, now: new Date(Date.parse(postedAt) + 1).toISOString() };
  const projected = product === 'business'
    ? sourceHistory.projectBusiness(rows, { ...options, businessId: accountId })
    : sourceHistory.projectHelper(rows, { ...options, helperId: accountId });
  const movement = projected.movements.find(row => String(row.sourceHistoryId) === String(observation.id));
  if (!movement) fail('statement_amendment_invalid_ref', 'Source update has no accounting movement to disclose', 409);
  const deltas = product === 'business' ? {
    invoicedMinor: movement.invoicedCents, collectedOrAdjustedMinor: movement.collectedOrAdjustedCents, cancelledMinor: movement.cancelledCents,
  } : { postedMinor: movement.postedEarningsCents, settledMinor: movement.settledPayoutsCents, removedMinor: movement.statusRemovalsCents };
  const net = product === 'business'
    ? BigInt(deltas.invoicedMinor) - BigInt(deltas.collectedOrAdjustedMinor) - BigInt(deltas.cancelledMinor)
    : BigInt(deltas.postedMinor) - BigInt(deltas.settledMinor) - BigInt(deltas.removedMinor);
  return { id: String(observation.id), sourceId: observation.source_id, kind, postedAt, effectiveDate: day,
    sourceEffectiveDate: product === 'business' ? observation.source.paid_at || observation.source.issue_date : observation.source.paid_at || observation.source.completed_at,
    amountCents: assertMinorInteger(Number(net < 0n ? -net : net), 'source movement'),
    direction: net < 0n ? 'debit' : 'credit', deltas, movement };
}

// Validate one compensating journal transaction against the OxSteed Credit
// double-entry journal. Returns { id, amountCents, direction, postedAt,
// effectiveDate, kind } with direction relative to the journal account.
// Never invents or moves money: the transaction must already exist and be
// posted.
async function fetchJournalCompensatingRef(clientOrPool, journalAccountId, currencyCode, ref) {
  const accountText = String(journalAccountId);
  if (!UUID_RE.test(String(ref))) {
    fail('statement_amendment_invalid_ref', 'Compensating transaction reference must be a UUID', 400);
  }
  const { rows: [tx] } = await clientOrPool.query(
    `SELECT id, amount_cents, currency_code, status,
            debit_account_id, credit_account_id, posted_at, created_at, transaction_type
     FROM oxsteed_credit_transactions WHERE id = $1`,
    [String(ref).toLowerCase()]);
  if (!tx) fail('statement_amendment_transaction_not_found', 'Referenced compensating transaction does not exist', 404);
  if (tx.status !== 'posted') {
    fail('statement_amendment_transaction_unposted', 'Referenced compensating transaction is not posted', 409);
  }
  if (tx.currency_code !== currencyCode) {
    fail('statement_amendment_transaction_scope_mismatch', 'Referenced transaction currency does not match the statement', 409);
  }
  const debitsAccount = String(tx.debit_account_id) === accountText;
  const creditsAccount = String(tx.credit_account_id) === accountText;
  if (debitsAccount === creditsAccount) {
    fail('statement_amendment_transaction_scope_mismatch', 'Referenced transaction does not touch the statement account exactly once', 409);
  }
  // The effective date decides whether the correction restates this period
  // (in-period) or its opening (pre-period): the ledger's own
  // COALESCE(posted_at, created_at) rule.
  const effectiveAt = tx.posted_at || tx.created_at;
  return {
    id: tx.id,
    amountCents: assertMinorInteger(Number(tx.amount_cents), 'reference amount'),
    direction: creditsAccount ? 'credit' : 'debit',
    postedAt: tx.posted_at ? new Date(tx.posted_at).toISOString() : null,
    effectiveDate: effectiveAt ? isoDate(effectiveAt) : null,
    kind: tx.transaction_type,
  };
}

// For a restated accounting amendment, the ONLY ledger delta versus the
// baseline (the latest version, or the original for v1) may be the
// referenced corrections: every new transaction in the re-derived period
// must be a referenced id, and the totals must tie out to the references
// with integer math. Anything else is an unreferenced change and the
// proposal is rejected.
// Partition references by effective date relative to the amended period:
// in-period refs correct this period; pre-period refs restate its opening.
// A ref effective after the period is rejected under restated presentation
// (that is later-period presentation).
function partitionRefs(refDetails, periodFrom, periodTo) {
  const inPeriod = [];
  const prePeriod = [];
  for (const ref of refDetails) {
    if (!ref.effectiveDate) {
      fail('statement_amendment_integrity_failed', 'A referenced correction has no effective date', 409);
    }
    if (ref.effectiveDate < periodFrom) prePeriod.push(ref);
    else if (ref.effectiveDate <= periodTo) inPeriod.push(ref);
    else {
      fail('statement_amendment_ref_outside_period',
        'The referenced corrections did not post within this period; use later-period presentation or reference in-period corrections', 409);
    }
  }
  return { inPeriod, prePeriod };
}

function assertRestatedDelta({ baselineCore, rederivedCore, refDetails, periodFrom, periodTo }) {
  if (baselineCore.kind !== 'journal' || rederivedCore.kind !== 'journal') {
    return assertSettlementRestatedDelta({ baselineCore, rederivedCore, refDetails, periodFrom, periodTo });
  }
  // Journal-kind products only: helper_earnings and business have no
  // append-only ledger, so accounting amendments fail closed for them
  // earlier and never reach this assertion.
  if (baselineCore.kind !== 'journal' || rederivedCore.kind !== 'journal') {
    fail('statement_amendment_integrity_failed', 'Restated accounting amendments apply only to journal-kind statements', 409);
  }
  assertCoreMoneyIntegers(baselineCore, 'baseline');
  assertCoreMoneyIntegers(rederivedCore, 're-derived');
  // Partition references by effective date: in-period refs correct this
  // period; pre-period refs restate its opening (a prior period's correction
  // landing here). A ref effective after the period with restated
  // presentation is rejected: that is later-period presentation.
  const { inPeriod, prePeriod } = partitionRefs(refDetails, periodFrom, periodTo);
  const signed = (ref) => (ref.direction === 'credit' ? BigInt(ref.amountCents) : -BigInt(ref.amountCents));
  const preNet = prePeriod.reduce((sum, ref) => sum + signed(ref), 0n);
  const openingDelta = BigInt(rederivedCore.openingBalanceCents) - BigInt(baselineCore.openingBalanceCents);
  if (openingDelta !== preNet) {
    fail('statement_amendment_unreferenced_changes',
      'The period opening balance changed for reasons outside the referenced pre-period corrections; re-propose with complete references', 409);
  }
  const baselineIds = new Set(baselineCore.transactions.map((row) => row.id));
  const rederivedIds = new Set(rederivedCore.transactions.map((row) => row.id));
  const newIds = rederivedCore.transactions.map((row) => row.id).filter((id) => !baselineIds.has(id));
  const missingIds = baselineCore.transactions.map((row) => row.id).filter((id) => !rederivedIds.has(id));
  if (missingIds.length > 0) {
    fail('statement_amendment_source_changed',
      'Ledger entries from the issued statement are no longer derivable; the source data changed', 409);
  }
  const inRefIds = new Set(inPeriod.map((ref) => String(ref.id)));
  const unreferenced = newIds.filter((id) => !inRefIds.has(id));
  const notInLedger = [...inRefIds].filter((id) => !rederivedIds.has(id));
  if (notInLedger.length > 0 && unreferenced.length === 0) {
    fail('statement_amendment_ref_outside_period',
      'The referenced corrections did not post within this period; use later-period presentation or reference in-period corrections', 409);
  }
  if (unreferenced.length > 0 || notInLedger.length > 0) {
    fail('statement_amendment_unreferenced_changes',
      'The re-derived period contains changes beyond the referenced compensating transactions; re-propose with complete references', 409);
  }
  let inCredits = 0n;
  let inDebits = 0n;
  for (const ref of inPeriod) {
    if (ref.direction === 'credit') inCredits += BigInt(ref.amountCents);
    else inDebits += BigInt(ref.amountCents);
  }
  const deltaCredits = BigInt(rederivedCore.totalCreditsCents) - BigInt(baselineCore.totalCreditsCents);
  const deltaDebits = BigInt(rederivedCore.totalDebitsCents) - BigInt(baselineCore.totalDebitsCents);
  const deltaClosing = BigInt(rederivedCore.closingBalanceCents) - BigInt(baselineCore.closingBalanceCents);
  if (deltaCredits !== inCredits || deltaDebits !== inDebits
      || deltaClosing !== (preNet + inCredits - inDebits)) {
    fail('statement_amendment_integrity_failed',
      'Re-derived totals do not reconcile to the referenced compensating transactions', 409);
  }
  return { inPeriod, prePeriod, preNet };
}

function assertSettlementRestatedDelta({ baselineCore, rederivedCore, refDetails, periodFrom, periodTo }) {
  if (baselineCore.kind !== rederivedCore.kind || !baselineCore.movements || !rederivedCore.movements) {
    fail('statement_source_history_unavailable', 'Both statement versions require complete immutable source history', 409);
  }
  assertCoreMoneyIntegers(baselineCore, 'baseline'); assertCoreMoneyIntegers(rederivedCore, 're-derived');
  if (!equationHolds(baselineCore) || !equationHolds(rederivedCore)) fail('statement_amendment_integrity_failed', 'Statement source totals do not reconcile', 409);
  const { inPeriod, prePeriod } = partitionRefs(refDetails, periodFrom, periodTo);
  const signature = row => statements.hashDocument({ value: row });
  const baseline = new Map(baselineCore.movements.map(row => [String(row.sourceHistoryId), signature(row)]));
  const derived = new Map(rederivedCore.movements.map(row => [String(row.sourceHistoryId), signature(row)]));
  if (baseline.size !== baselineCore.movements.length || derived.size !== rederivedCore.movements.length) fail('statement_amendment_integrity_failed', 'Duplicate source movement', 409);
  for (const [id, hash] of baseline) {
    if (derived.get(id) !== hash) fail('statement_amendment_source_changed', 'An original source movement changed or disappeared', 409);
  }
  const added = [...derived.keys()].filter(id => !baseline.has(id));
  const refs = new Map(inPeriod.map(ref => [String(ref.id), ref]));
  if (added.length !== refs.size || added.some(id => !refs.has(id))) fail('statement_amendment_unreferenced_changes', 'Every new source movement must be an exact referenced correction', 409);
  for (const id of added) {
    if (derived.get(id) !== signature(refs.get(id).movement)) fail('statement_amendment_integrity_failed', 'Referenced source movement differs from statement evidence', 409);
  }
  if (baselineCore.kind === 'business' && signature(baselineCore.payables) !== signature(rederivedCore.payables)) {
    fail('statement_amendment_unreferenced_changes', 'Expense changes require their own authoritative correction evidence', 409);
  }
  const signed = ref => (ref.direction === 'credit' ? BigInt(ref.amountCents) : -BigInt(ref.amountCents));
  const preNet = prePeriod.reduce((sum, ref) => sum + signed(ref), 0n);
  if (BigInt(rederivedCore.openingMinor) - BigInt(baselineCore.openingMinor) !== preNet) fail('statement_amendment_unreferenced_changes', 'Opening change is not explained by referenced source corrections', 409);
  const keys = baselineCore.kind === 'business' ? ['invoicedMinor', 'collectedOrAdjustedMinor', 'cancelledMinor'] : ['postedMinor', 'settledMinor', 'removedMinor'];
  for (const key of keys) {
    const delta = inPeriod.reduce((sum, ref) => sum + BigInt(ref.deltas[key]), 0n);
    if (BigInt(rederivedCore[key]) - BigInt(baselineCore[key]) !== delta) fail('statement_amendment_integrity_failed', 'Revised totals do not match referenced source corrections', 409);
  }
  return { inPeriod, prePeriod, preNet };
}

function issuanceKeyForOriginal(original, restaurantIdOrNull) {
  // The issuance key's account part is the product's scope id: the wallet
  // account id for oxsteed, the restaurant id for restaurant and
  // restaurant_settlement, the business id for business, the helper user id
  // for helper_earnings. Matches the snapshot service's key parsing exactly.
  let accountPart;
  if (original.kind === 'settlement') {
    accountPart = original.accountUuid || String(original.accountId);
  } else {
    accountPart = original.product === 'restaurant' && restaurantIdOrNull
      ? String(restaurantIdOrNull)
      : String(original.accountId);
  }
  return jobs.issuanceKeyFor({
    product: original.product,
    accountId: accountPart,
    currencyCode: original.currency_code,
    periodFrom: isoDate(original.period_from),
    periodTo: isoDate(original.period_to),
    customerId: original.customerId,
  });
}

async function countVersions(clientOrPool, original) {
  const scopeColumn = original.kind === 'credit' ? 'original_document_id' : 'settlement_original_document_id';
  const { rows: [{ n }] } = await clientOrPool.query(
    `SELECT COUNT(*)::int AS n FROM statement_amendment_versions WHERE ${scopeColumn} = $1`,
    [original.id]);
  return n;
}

async function recordPublicationAttempt(clientOrPool, proposalId, outcome, versionId, error) {
  const { rows: [seq] } = await clientOrPool.query(
    `SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt
     FROM statement_amendment_publication_attempts WHERE proposal_id = $1`,
    [proposalId]);
  const attempt = Number(seq && seq.attempt) || 1;
  await clientOrPool.query(
    `INSERT INTO statement_amendment_publication_attempts
       (id, proposal_id, attempt, outcome, version_id, error, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, transaction_timestamp())`,
    [crypto.randomUUID(), proposalId, attempt, outcome, versionId || null,
      error ? String((error && error.message) || error).slice(0, 2000) : null]);
}

function shapeVersion(row) {
  if (!row) return null;
  return {
    versionId: row.id,
    originalDocumentId: row.settlement_original_document_id || row.original_document_id,
    proposalId: row.proposal_id,
    revisionNumber: Number(row.revision_number),
    revision: Number(row.revision_number) + 1,
    amendmentType: row.amendment_type,
    presentation: row.presentation,
    artifactId: row.artifact_id || null,
    supersedesVersionId: row.supersedes_version_id || null,
    priorClosingMinor: Number(row.prior_version_closing_minor),
    revisedClosingMinor: Number(row.revised_closing_minor),
    continuityStatus: row.continuity_status,
    nextPeriodDocumentId: row.settlement_next_period_document_id || row.next_period_document_id || null,
    nextPeriodIssuedOpeningMinor: row.next_period_issued_opening_minor == null
      ? null : Number(row.next_period_issued_opening_minor),
    contentHash: row.content_hash,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function shapeProposalForResponse(row) {
  return {
    proposalId: row.id,
    issuanceKey: row.issuance_key,
    product: row.product,
    // UUID-scoped products (helper_earnings) report the helper user id;
    // integer-scoped products report the numeric account id.
    accountId: row.account_uuid ? String(row.account_uuid).toLowerCase() : Number(row.account_id),
    currencyCode: row.currency_code,
    period: {
      from: isoDate(row.period_from),
      to: isoDate(row.period_to),
    },
    documentId: row.settlement_document_id || row.document_id || null,
    amendmentType: row.amendment_type,
    presentation: row.presentation,
    reason: row.reason,
    evidenceRefs: Array.isArray(row.evidence_refs) ? row.evidence_refs : [],
    compensatingTransactionRefs: Array.isArray(row.compensating_transaction_refs)
      ? row.compensating_transaction_refs : [],
    restateForward: Boolean(row.restate_forward),
    originalDocumentHash: row.original_document_hash || null,
    ledgerFingerprint: row.ledger_fingerprint || null,
    baseRevisionNumber: Number(row.base_revision_number || 0),
    status: row.status,
    proposedBy: row.proposed_by,
    proposedAt: new Date(row.proposed_at).toISOString(),
    decidedBy: row.decided_by || null,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    decisionReason: row.decision_reason || null,
  };
}

async function resolveStatementLanguage(customerId) {
  try {
    const { rows: [row] } = await pool.query(
      'SELECT preferred_language FROM users WHERE id = $1', [customerId]);
    const lang = String(row?.preferred_language || 'en').split(/[-_]/)[0].toLowerCase();
    return LANGUAGES.has(lang) ? lang : 'en';
  } catch {
    return 'en';
  }
}

// ── Proposal creation ───────────────────────────────────────────────────────
// Validates the correction scope against the ledger NOW and pins the source
// data (original hash, ledger fingerprint, revision base) so approval
// re-validates instead of trusting it.
async function proposeAmendment({
  adminId,
  documentId,
  amendmentType,
  presentation,
  reason,
  evidenceRefs = [],
  compensatingTransactionRefs = [],
  restateForward = false,
}) {
  checkUuid(adminId, 'admin id');
  checkUuid(documentId, 'document id');
  if (!AMENDMENT_TYPES.has(amendmentType)) {
    fail('statement_amendment_invalid_type', 'amendmentType must be clerical or accounting', 400);
  }
  const cleanReason = String(reason || '').trim();
  if (!cleanReason || cleanReason.length > 2000) {
    fail('statement_admin_reason_required', 'A reason of 1 to 2000 characters is required to propose a statement amendment', 400);
  }
  if (!Array.isArray(compensatingTransactionRefs)) {
    fail('statement_amendment_invalid_ref', 'compensatingTransactionRefs must be an array', 400);
  }
  const refs = compensatingTransactionRefs.map((ref) => String(ref).trim()).filter((ref) => ref !== '');
  if (new Set(refs).size !== refs.length) {
    fail('statement_amendment_duplicate_ref', 'Duplicate compensating transaction reference in the proposal', 400);
  }
  let effectivePresentation = 'restated';
  if (amendmentType === 'accounting') {
    if (refs.length === 0) {
      fail('statement_amendment_refs_required',
        'An accounting amendment must reference at least one posted compensating transaction', 400);
    }
    if (presentation !== undefined && presentation !== null) {
      if (!PRESENTATIONS.has(presentation)) {
        fail('statement_amendment_invalid_presentation', 'presentation must be restated or later_period', 400);
      }
      effectivePresentation = presentation;
    }
  } else {
    if (refs.length > 0) {
      fail('statement_amendment_refs_forbidden',
        'A clerical amendment corrects presentation only and must not reference ledger transactions', 400);
    }
    if (presentation !== undefined && presentation !== null && presentation !== 'restated') {
      fail('statement_amendment_invalid_presentation', 'A clerical amendment cannot use later-period presentation', 400);
    }
  }
  if (!Array.isArray(evidenceRefs)) {
    fail('statement_amendment_invalid_evidence', 'evidenceRefs must be an array', 400);
  }
  if (evidenceRefs.length > 50) {
    fail('statement_amendment_invalid_evidence', 'evidenceRefs accepts at most 50 entries', 400);
  }
  const cleanEvidence = evidenceRefs.map((entry) => {
    const text = String(entry).trim();
    if (!text || text.length > 500) {
      fail('statement_amendment_invalid_evidence', 'Each evidence ref must be 1 to 500 characters', 400);
    }
    return text;
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const original = await loadOriginalDocument(client, documentId);

    // Fail closed where the source cannot support an accounting amendment:
    // helper_earnings and business records are activity snapshots, not
    // append-only ledgers, so there are no posted compensating transactions
    // to reference. Clerical amendments are fully supported for them.

    // One live proposal per document: a second proposal waits (409) while a
    // proposed or an approved-but-unpublished proposal is in flight. An
    // approved proposal whose publication was BLOCKED (validation failed and
    // no version was published) does not wedge the queue: a new proposal may
    // supersede it, and the stale-approval check keeps publication safe.
    const { rows: [live] } = await client.query(
      `SELECT p.id, p.status FROM statement_amendment_proposals p
       WHERE (p.document_id = $1 OR p.settlement_document_id = $1)
         AND (p.status = 'proposed'
              OR (p.status = 'approved'
                  AND NOT EXISTS (SELECT 1 FROM statement_amendment_versions v WHERE v.proposal_id = p.id)
                  AND NOT EXISTS (SELECT 1 FROM statement_amendment_publication_attempts a
                                  WHERE a.proposal_id = p.id AND a.outcome = 'blocked')))
       LIMIT 1`,
      [documentId]);
    if (live) {
      fail('statement_amendment_concurrent_proposal',
        `Another amendment proposal for this statement is ${live.status}; wait for it to complete before proposing again`, 409);
    }

    // Every reference must exist, be posted, and touch the statement account.
    const refDetails = [];
    for (const ref of refs) {
      refDetails.push(await fetchCompensatingRef(
        client, original.product, original.accountUuid || original.accountId, original.currency_code, ref));
    }

    // Double-counting guard: a compensating transaction may be referenced by
    // at most one live proposal or published version per original statement.
    // Refs held only by an approved-but-blocked proposal (no version) are
    // releasable: the stale-approval check guarantees only one of the
    // competing proposals can ever publish.
    if (refDetails.length > 0) {
      const refIds = refDetails.map((ref) => String(ref.id));
      const { rows: [dup] } = await client.query(
        `SELECT p.id AS holder FROM statement_amendment_proposals p
         WHERE (p.document_id = $1 OR p.settlement_document_id = $1) AND p.status <> 'rejected'
           AND NOT (p.status = 'approved'
                    AND NOT EXISTS (SELECT 1 FROM statement_amendment_versions v WHERE v.proposal_id = p.id)
                    AND EXISTS (SELECT 1 FROM statement_amendment_publication_attempts a
                                WHERE a.proposal_id = p.id AND a.outcome = 'blocked'))
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(p.compensating_transaction_refs) e
             WHERE e->>'id' = ANY($2::text[]))
         UNION ALL
         SELECT v.proposal_id AS holder FROM statement_amendment_versions v
         WHERE (v.original_document_id = $1 OR v.settlement_original_document_id = $1)
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements(v.document->'totals'->'adjustment'->'compensatingTransactions') e
             WHERE e->>'id' = ANY($2::text[]))
         LIMIT 1`,
        [documentId, refIds]);
      if (dup) {
        fail('statement_amendment_duplicate_reference',
          'A referenced compensating transaction is already used by another amendment for this statement; each correction may be referenced once', 409);
      }
    }

    // Pin the source data: re-derive the period from the ledger now. Deltas
    // and equality checks run against the baseline (latest version or the
    // original) so chains compose.
    const rederived = await rederiveStatement(original);
    const baseline = await loadBaseline(client, original);
    const baselineCore = coreOf(baseline.doc);
    const rederivedCore = coreOf(rederived);
    assertCoreMoneyIntegers(baselineCore, 'baseline');
    assertCoreMoneyIntegers(rederivedCore, 're-derived');
    const baselineFp = ledgerFingerprint(baseline.doc);
    const rederivedFp = ledgerFingerprint(rederived);

    if (amendmentType === 'clerical') {
      if (rederivedFp !== baselineFp) {
        fail('statement_amendment_not_clerical',
          'The ledger for this period changed since the baseline version, so this is not a presentation-only correction; propose an accounting amendment instead', 409);
      }
    } else if (effectivePresentation === 'later_period') {
      if (refDetails.some(ref => !ref.effectiveDate || ref.effectiveDate <= isoDate(original.period_to))) {
        fail('statement_amendment_ref_outside_period', 'Later-period corrections must actually post after this statement period', 409);
      }
      if (rederivedFp !== baselineFp) {
        fail('statement_amendment_presentation_mismatch',
          'The referenced corrections changed this period, so later-period presentation does not apply; use restated presentation', 409);
      }
    } else {
      assertRestatedDelta({
        baselineCore, rederivedCore, refDetails,
        periodFrom: isoDate(original.period_from), periodTo: isoDate(original.period_to),
      });
    }

    const baseRevision = await countVersions(client, original);
    const proposalId = crypto.randomUUID();
    const restaurantId = original.product === 'restaurant'
      ? await resolveWalletRestaurantId(client, original.accountId)
      : null;
    const refsJson = refDetails.map((ref) => ({
      id: String(ref.id),
      amountCents: ref.amountCents,
      direction: ref.direction,
      postedAt: ref.postedAt,
      effectiveDate: ref.effectiveDate,
      kind: ref.kind,
      ...(ref.deltas ? { sourceId: ref.sourceId, sourceEffectiveDate: ref.sourceEffectiveDate, deltas: ref.deltas, movement: ref.movement } : {}),
    }));
    // accountId is stored as NULL for scope-uuid products; accountUuid holds
    // the helper user id. Settlement originals link via settlement_document_id.
    const scopeAccountUuid = original.accountUuid
      ? String(original.accountUuid).toLowerCase() : null;
    const { rows: [proposal] } = await client.query(
      `INSERT INTO statement_amendment_proposals
         (id, issuance_key, product, account_id, account_uuid, currency_code, period_from, period_to,
          document_id, settlement_document_id, amendment_type, presentation, reason, evidence_refs,
          compensating_transaction_refs, restate_forward, original_document_hash,
          ledger_fingerprint, base_revision_number, proposed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [proposalId, issuanceKeyForOriginal(original, restaurantId), original.product,
        original.accountUuid ? null : original.accountId, scopeAccountUuid, original.currency_code,
        isoDate(original.period_from), isoDate(original.period_to),
        original.kind === 'credit' ? documentId : null,
        original.kind === 'settlement' ? documentId : null,
        amendmentType, effectivePresentation, cleanReason,
        JSON.stringify(cleanEvidence), JSON.stringify(refsJson),
        Boolean(restateForward), original.content_hash, rederivedFp, baseRevision, adminId]);
    await client.query('COMMIT');
    return shapeProposalForResponse(proposal);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ── Snapshot provenance for the amended rendition ───────────────────────────
// The rendition shares the original artifact's snapshot when the original was
// pipeline-issued (the archive links renditions to documents through it).
// On-demand originals have no snapshot: freeze the amendment-time snapshot so
// the rendition always has honest provenance.
async function resolveAmendmentSnapshotId(original) {
  // The original's artifact row (688 originals link via settlement_document_id;
  // 682 originals via document_id). If no original artifact exists (e.g. the
  // original predates artifact publication), freeze a fresh snapshot using
  // the same issuance-key math as the issuance pipeline.
  const { rows: [artifact] } = await pool.query(
    `SELECT snapshot_id FROM statement_artifacts
     WHERE (document_id = $1 OR settlement_document_id = $1) AND kind = 'original'
     ORDER BY created_at ASC LIMIT 1`,
    [original.id]);
  if (artifact) return artifact.snapshot_id;
  let restaurantId = null;
  if (original.kind === 'credit' && original.product === 'restaurant') {
    restaurantId = await resolveWalletRestaurantId(pool, original.accountId);
  }
  const issuanceKey = issuanceKeyForOriginal(original, restaurantId);
  const parsed = snapshots.parseIssuanceKey(issuanceKey);
  const snapshot = await snapshots.freezeSnapshot({
    issuanceKey,
    product: parsed.product,
    accountId: parsed.accountId,
    currency: parsed.currency,
    periodFrom: parsed.periodFrom,
    periodTo: parsed.periodTo,
    customerId: parsed.customerId,
  });
  return snapshot.id;
}

// ── Continuity ──────────────────────────────────────────────────────────────
// The revised closing must chain into the next issued period's opening. The
// next period's EFFECTIVE opening is its latest amendment version's revised
// opening when it has been amended, otherwise its issued opening: restating
// forward period by period closes the chain honestly. A mismatch blocks with
// 409 unless the proposal declared restate_forward, in which case the break
// is recorded and disclosed; the next period's issued row is never edited.
async function checkContinuity({ original, revisedClosingMinor, baselineClosingMinor, restateForward }) {
  if (revisedClosingMinor === baselineClosingMinor) {
    return { status: 'continuous', nextPeriod: null };
  }
  // Settlement products live in the 688 archive; credit products in the 682
  // archive. accountUuid is the scope for helper_earnings, accountId for the
  // rest. Scopes never mix. The 688 archive has no customer_id: the scope
  // columns ARE the identity, so only the credit query filters on it.
  // Every placeholder is bound: PostgreSQL cannot infer the type of an
  // unreferenced $n.
  const archive = original.kind === 'settlement' ? 'settlement_statement_documents' : 'credit_statement_documents';
  const versionColumn = original.kind === 'settlement' ? 'settlement_original_document_id' : 'original_document_id';
  let where;
  let params;
  if (original.kind === 'settlement') {
    const scopeColumn = original.product === 'helper_earnings' ? 'scope_helper_user_id'
      : original.product === 'business' ? 'scope_business_id' : 'scope_restaurant_id';
    where = `product = $1 AND ${scopeColumn} = $2 AND currency_code = $3 AND period_from > $4`;
    params = [original.product, original.accountUuid || String(original.accountId),
      original.currency_code, isoDate(original.period_to)];
  } else {
    where = 'product = $1 AND customer_id = $2 AND account_id = $3 AND currency_code = $4 AND period_from > $5';
    params = [original.product, original.customerId, String(original.accountId),
      original.currency_code, isoDate(original.period_to)];
  }
  const { rows: [next] } = await pool.query(
    `SELECT id, period_from, period_to, document
     FROM ${archive}
     WHERE ${where}
     ORDER BY period_from ASC LIMIT 1`,
    params);
  if (!next) return { status: 'continuous', nextPeriod: null };
  const nextDocument = next.document && typeof next.document === 'object' ? next.document : {};
  // Effective opening: the next period's latest amendment restates it, else
  // the issued opening.
  const { rows: [nextVersion] } = await pool.query(
    `SELECT document FROM statement_amendment_versions
     WHERE ${versionColumn} = $1
     ORDER BY revision_number DESC LIMIT 1`,
    [next.id]);
  const revisedOpening = nextVersion
    && nextVersion.document && typeof nextVersion.document === 'object'
    && nextVersion.document.totals && typeof nextVersion.document.totals === 'object'
    && nextVersion.document.totals.revised
    && Number.isSafeInteger(nextVersion.document.totals.revised.openingMinor)
    ? nextVersion.document.totals.revised.openingMinor
    : null;
  const issuedOpening = extractIssuedOpening(original.product, nextDocument);
  const nextOpening = revisedOpening !== null ? revisedOpening : issuedOpening;
  if (nextOpening === null) {
    fail('statement_amendment_integrity_failed',
      'The next issued statement has no readable opening balance', 409);
  }
  const nextPeriod = {
    id: next.id,
    periodFrom: isoDate(next.period_from),
    periodTo: isoDate(next.period_to),
    issuedOpeningMinor: issuedOpening,
    effectiveOpeningMinor: nextOpening,
    restatedByVersion: revisedOpening !== null,
  };
  if (nextOpening !== revisedClosingMinor) {
    if (!restateForward || ['helper_earnings', 'business'].includes(original.product)) {
      const error = new AppError(
        'The corrected closing balance no longer matches the next issued statement\u2019s opening balance. '
        + 'Re-propose with restate-forward to disclose the break, or correct the next period as well.',
        409, 'statement_amendment_continuity_blocked');
      error.fields = {
        nextPeriodDocumentId: next.id,
        nextPeriodEffectiveOpeningMinor: nextOpening,
        revisedClosingMinor,
      };
      throw error;
    }
    return { status: 'restated_forward', nextPeriod };
  }
  return { status: 'continuous', nextPeriod };
}

async function assertPriorContinuity(original, baselineCore, revisedCore) {
  if (baselineCore.openingMinor === revisedCore.openingMinor) return;
  const settlement = original.kind === 'settlement';
  const scope = original.product === 'helper_earnings' ? 'scope_helper_user_id'
    : original.product === 'business' ? 'scope_business_id' : 'scope_restaurant_id';
  const { rows: [previous] } = await pool.query(settlement
    ? `SELECT d.id, d.document FROM settlement_statement_documents d WHERE product = $1
       AND ${scope} = $2 AND currency_code = $3 AND period_to < $4 ORDER BY period_to DESC, id DESC LIMIT 1`
    : `SELECT d.id, d.document FROM credit_statement_documents d WHERE product = $1
       AND account_id = $2 AND currency_code = $3 AND period_to < $4 AND customer_id = $5
       ORDER BY period_to DESC, id DESC LIMIT 1`,
  settlement ? [original.product, original.accountUuid || original.accountId, original.currency_code, isoDate(original.period_from)]
    : [original.product, original.accountId, original.currency_code, isoDate(original.period_from), original.customerId]);
  if (!previous) return;
  const { rows: [version] } = await pool.query(`SELECT document FROM statement_amendment_versions
    WHERE ${settlement ? 'settlement_original_document_id' : 'original_document_id'} = $1
    ORDER BY revision_number DESC LIMIT 1`, [previous.id]);
  const closing = coreOf(version?.document || previous.document).closingMinor;
  if (!Number.isSafeInteger(closing) || closing !== revisedCore.openingMinor) {
    fail('statement_amendment_continuity_blocked', 'The revised opening must exactly match the preceding issued period closing', 409);
  }
}

// The issued opening of a statement document, per product kind. Journal
// kinds carry openingBalanceCents; helper_earnings carries
// openingPayableCents; business carries
// receivables.openingOutstandingCents. The continuity check compares like
// with like, so every kind must read its own slot.
function extractIssuedOpening(product, document) {
  if (product === 'helper_earnings') {
    return Number.isSafeInteger(document.openingPayableCents) ? document.openingPayableCents : null;
  }
  if (product === 'business') {
    const receivables = document.receivables && typeof document.receivables === 'object' ? document.receivables : {};
    return Number.isSafeInteger(receivables.openingOutstandingCents) ? receivables.openingOutstandingCents : null;
  }
  return Number.isSafeInteger(document.openingBalanceCents) ? document.openingBalanceCents : null;
}


// ── Amended document envelope ───────────────────────────────────────────────
// original / adjustment / revised totals are shown side by side; dates are
// disclosed; backdated corrections are flagged. The envelope is hashed with
// the shared hashDocument so the version row's content_hash is verifiable.
function buildAmendedDocument({ rederived, original, baseline, proposal, revisionNumber, refDetails, continuity, supersedesVersion }) {
  const baselineCore = coreOf(baseline.doc);
  const rederivedCore = coreOf(rederived);
  assertCoreMoneyIntegers(baselineCore, 'baseline');
  assertCoreMoneyIntegers(rederivedCore, 're-derived');
  // The re-derived statement must reconcile with itself (the builders already
  // enforce this; belt and braces).
  if (!equationHolds(rederivedCore)) {
    fail('statement_amendment_integrity_failed',
      'Re-derived statement does not reconcile with itself', 409);
  }

  const issuedAtMs = new Date(original.generated_at).getTime();
  const periodFrom = isoDate(original.period_from);
  const periodTo = isoDate(original.period_to);
  let adjustmentCredits = 0n;
  let adjustmentDebits = 0n;
  let openingRestatement = 0n;
  const compensatingTransactions = refDetails.map((ref) => {
    // Where the correction lands: a pre-period ref restates the opening, an
    // in-period ref corrects the period, a post-period ref is presented in
    // the later period and does not move this period's balances.
    const affects = !ref.effectiveDate || ref.effectiveDate < periodFrom ? 'opening'
      : ref.effectiveDate <= periodTo ? 'period' : 'later_period';
    const signed = ref.direction === 'credit' ? BigInt(ref.amountCents) : -BigInt(ref.amountCents);
    if (affects === 'opening') openingRestatement += signed;
    else if (affects === 'period') {
      if (ref.direction === 'credit') adjustmentCredits += BigInt(ref.amountCents);
      else adjustmentDebits += BigInt(ref.amountCents);
    }
    return {
      id: String(ref.id),
      amountCents: ref.amountCents,
      direction: ref.direction,
      affects,
      postedAt: ref.postedAt,
      effectiveDate: ref.effectiveDate,
      backdated: ref.postedAt ? Date.parse(ref.postedAt) < issuedAtMs : false,
      kind: ref.kind,
      ...(ref.deltas ? { sourceId: ref.sourceId, sourceEffectiveDate: ref.sourceEffectiveDate, deltas: ref.deltas } : {}),
    };
  });

  const envelope = {
    ...rederived,
    id: crypto.randomUUID(),
    version: revisionNumber + 1,
    supersedes: revisionNumber === 1
      ? { kind: 'original', documentId: original.id, contentHash: original.content_hash, revision: 1 }
      : {
        kind: 'amendment',
        versionId: supersedesVersion.id,
        contentHash: supersedesVersion.content_hash,
        revision: revisionNumber,
      },
    amendment: {
      proposalId: proposal.id,
      type: proposal.amendment_type,
      presentation: proposal.presentation,
      reason: proposal.reason,
      evidenceRefs: Array.isArray(proposal.evidence_refs) ? proposal.evidence_refs : [],
      proposedBy: proposal.proposed_by,
      proposedAt: new Date(proposal.proposed_at).toISOString(),
      decidedBy: proposal.decided_by,
      decidedAt: proposal.decided_at ? new Date(proposal.decided_at).toISOString() : null,
      decisionReason: proposal.decision_reason || null,
      originalDocumentHash: proposal.original_document_hash,
      ledgerFingerprint: proposal.ledger_fingerprint,
    },
    totals: {
      // Per-product-kind totals groups (see totalsOf): openingMinor and
      // closingMinor are the canonical slots; the middle keys are
      // product-specific. The version chain diffs these groups.
      original: {
        ...totalsOf(baselineCore),
        contentHash: baseline.contentHash,
      },
      adjustment: {
        creditsMinor: Number(adjustmentCredits),
        debitsMinor: Number(adjustmentDebits),
        netMinor: Number(adjustmentCredits - adjustmentDebits),
        openingRestatementMinor: Number(openingRestatement),
        transactionCount: compensatingTransactions.length,
        compensatingTransactions,
      },
      revised: totalsOf(rederivedCore),
    },
    continuity: {
      status: continuity.status,
      priorClosingMinor: baselineCore.closingMinor,
      revisedClosingMinor: rederivedCore.closingMinor,
      nextPeriodDocumentId: continuity.nextPeriod ? continuity.nextPeriod.id : null,
      nextPeriodPeriod: continuity.nextPeriod
        ? { from: continuity.nextPeriod.periodFrom, to: continuity.nextPeriod.periodTo } : null,
      nextPeriodIssuedOpeningMinor: continuity.nextPeriod ? continuity.nextPeriod.issuedOpeningMinor : null,
      nextPeriodEffectiveOpeningMinor: continuity.nextPeriod ? continuity.nextPeriod.effectiveOpeningMinor : null,
      nextPeriodRestatedByVersion: continuity.nextPeriod ? Boolean(continuity.nextPeriod.restatedByVersion) : null,
      restatedOpeningMinor: continuity.status === 'restated_forward' ? rederivedCore.closingMinor : null,
      // Structured disclosure keys for clients to localize; the archive
      // surfaces these rather than free text.
      disclosures: continuity.status === 'restated_forward'
        ? ['statement.amendment.continuity.restated_forward']
        : ['statement.amendment.continuity.continuous'],
    },
  };
  envelope.contentHash = statements.hashDocument(envelope);
  return envelope;
}

// ── Approval finalization (idempotent on proposal id) ───────────────────────
// Called after decideAmendment marks the proposal approved. A storage failure
// leaves the proposal approved-but-unpublished; retry-publish re-runs this
// and converges on exactly one version row.
async function finalizeApprovedProposal(proposalId, { storage = defaultStorage } = {}) {
  checkUuid(proposalId, 'proposal id');

  // Idempotent fast path: a version already exists for this proposal.
  const { rows: [already] } = await pool.query(
    'SELECT * FROM statement_amendment_versions WHERE proposal_id = $1', [proposalId]);
  if (already) return { status: 'published', version: shapeVersion(already), duplicate: true };

  let proposal;
  let original;
  let originalDocumentId;
  let rederived;
  let refDetails;
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [row] } = await client.query(
        'SELECT * FROM statement_amendment_proposals WHERE id = $1 FOR UPDATE', [proposalId]);
      if (!row) fail('statement_amendment_not_found', 'Amendment proposal not found', 404);
      if (row.status !== 'approved') {
        fail('statement_amendment_not_approved',
          `Proposal is ${row.status}; only approved proposals can be published`, 409);
      }
      if (!row.decided_by || String(row.decided_by) === String(row.proposed_by)) {
        fail('statement_amendment_self_approval', 'An amendment requires an independent approver', 403);
      }
      if (!row.document_id && !row.settlement_document_id) {
        fail('statement_amendment_no_document', 'Proposal names no issued original; nothing to publish', 409);
      }
      originalDocumentId = row.settlement_document_id || row.document_id;
      proposal = row;
      original = await loadOriginalDocument(client, originalDocumentId);
      if (original.content_hash !== proposal.original_document_hash) {
        fail('statement_amendment_source_changed',
          'The issued original changed since the proposal was created; re-propose', 409);
      }
      const versionCount = await countVersions(client, original);
      if (versionCount !== Number(proposal.base_revision_number)) {
        fail('statement_amendment_stale',
          'Another amendment for this statement was published after this proposal was created; re-propose against the latest version', 409);
      }
      // Re-validate every referenced transaction: still posted, same amount.
      const storedRefs = Array.isArray(proposal.compensating_transaction_refs)
        ? proposal.compensating_transaction_refs : [];
      refDetails = [];
      for (const stored of storedRefs) {
        const live = await fetchCompensatingRef(
          client, proposal.product, proposal.account_uuid || proposal.account_id, proposal.currency_code, String(stored.id));
        if (live.amountCents !== Number(stored.amountCents)
            || live.direction !== stored.direction
            || live.effectiveDate !== stored.effectiveDate
            || (stored.deltas && statements.hashDocument({ movement: live.movement }) !== statements.hashDocument({ movement: stored.movement }))) {
          fail('statement_amendment_source_changed',
            'A referenced compensating transaction changed since the proposal was created; re-propose', 409);
        }
        refDetails.push(live);
      }
      // Re-derive and pin to the proposal-time fingerprint: changed source
      // data between proposal and approval blocks instead of publishing stale.
      rederived = await rederiveStatement(original);
      if (ledgerFingerprint(rederived) !== proposal.ledger_fingerprint) {
        fail('statement_amendment_source_changed',
          'The ledger for this period changed between proposal and approval; re-propose', 409);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const revisionNumber = Number(proposal.base_revision_number) + 1;
    const label = `amended-v${revisionNumber}`;
    const baseline = await loadBaseline(pool, original);
    const rederivedCore = coreOf(rederived);
    const baselineCore = coreOf(baseline.doc);
    await assertPriorContinuity(original, baselineCore, rederivedCore);
    const continuity = await checkContinuity({
      original,
      revisedClosingMinor: rederivedCore.closingMinor,
      baselineClosingMinor: baselineCore.closingMinor,
      restateForward: proposal.restate_forward,
    });

    let supersedesVersion = null;
    if (revisionNumber > 1) {
      const { rows: [prev] } = await pool.query(
        `SELECT id, content_hash FROM statement_amendment_versions
         WHERE (original_document_id = $1 OR settlement_original_document_id = $1)
           AND revision_number = $2`,
        [originalDocumentId, revisionNumber - 1]);
      if (!prev) {
        fail('statement_amendment_stale',
          'The amendment chain changed; re-propose against the latest version', 409);
      }
      supersedesVersion = prev;
    }

    const envelope = buildAmendedDocument({
      rederived, original, baseline, proposal, revisionNumber, refDetails, continuity, supersedesVersion,
    });
    const language = await resolveStatementLanguage(original.customerId);

    let artifact;
    const pdfBytes = await renderStatementPdfInWorker(envelope, { language });
    const snapshotId = await resolveAmendmentSnapshotId(original);
    artifact = await artifacts.publishRendition({
      snapshotId, language, pdfBytes, label, storage,
      settlementDocumentId: original.kind === 'settlement' ? originalDocumentId : null,
    });
    if (artifact?.state !== 'ready' || artifact.sha256 !== crypto.createHash('sha256').update(pdfBytes).digest('hex')) {
      fail('statement_artifact_not_ready', 'An amendment requires the exact verified ready artifact', 409);
    }

    const versionId = crypto.randomUUID();
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`statement-amendment:${originalDocumentId}`]);
      const { rows: [published] } = await writer.query('SELECT * FROM statement_amendment_versions WHERE proposal_id = $1', [proposalId]);
      if (published) {
        await writer.query('COMMIT');
        return { status: 'published', version: shapeVersion(published), duplicate: true };
      }
      if (await countVersions(writer, original) !== Number(proposal.base_revision_number)) {
        fail('statement_amendment_stale', 'The published version chain changed; re-propose', 409);
      }
      const { rows: [version] } = await writer.query(
        `INSERT INTO statement_amendment_versions
           (id, original_document_id, settlement_original_document_id, proposal_id, revision_number, amendment_type,
            presentation, document, content_hash, artifact_id, supersedes_version_id,
            prior_version_closing_minor, revised_closing_minor, continuity_status,
            next_period_document_id, settlement_next_period_document_id, next_period_issued_opening_minor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [versionId,
          original.kind === 'credit' ? originalDocumentId : null,
          original.kind === 'settlement' ? originalDocumentId : null,
          proposalId, revisionNumber, proposal.amendment_type,
          proposal.presentation, JSON.stringify(envelope), envelope.contentHash, artifact.id,
          supersedesVersion ? supersedesVersion.id : null,
          baselineCore.closingMinor, rederivedCore.closingMinor,
          continuity.status,
          original.kind === 'credit' && continuity.status === 'restated_forward' && continuity.nextPeriod ? continuity.nextPeriod.id : null,
          original.kind === 'settlement' && continuity.status === 'restated_forward' && continuity.nextPeriod ? continuity.nextPeriod.id : null,
          continuity.nextPeriod ? continuity.nextPeriod.issuedOpeningMinor : null]);
      await recordPublicationAttempt(writer, proposalId, 'published', versionId, null);
      // Exactly one owner notification per version: the event is queued in the
      // same transaction as the version row, and the drain below notifies once.
      const { rows: [existingEvent] } = await writer.query(
        `SELECT id FROM statement_outbox
         WHERE event_type = 'statement.amended' AND aggregate_id = $1 LIMIT 1`,
        [versionId]);
      if (!existingEvent) {
        await jobs.outboxAppend(writer, {
          eventType: 'statement.amended',
          aggregateType: 'statement_amendment_version',
          aggregateId: versionId,
          payload: {
            versionId,
            proposalId,
            originalDocumentId,
            revision: revisionNumber + 1,
            product: original.product,
            accountId: original.accountUuid || String(original.accountId),
            currencyCode: original.currency_code,
            periodFrom: isoDate(original.period_from),
            periodTo: isoDate(original.period_to),
            artifactId: artifact.id,
            language,
          },
        });
      }
      await writer.query('COMMIT');
      logger.info('statement amendment published', {
        proposalId, versionId, revisionNumber, continuity: continuity.status,
      });
      return { status: 'published', version: shapeVersion(version) };
    } catch (error) {
      await writer.query('ROLLBACK');
      if (error && error.code === '23505') {
        // A concurrent finalize won the race: return the winner, never a
        // duplicate version.
        const { rows: [winner] } = await pool.query(
          'SELECT * FROM statement_amendment_versions WHERE proposal_id = $1', [proposalId]);
        if (winner) return { status: 'published', version: shapeVersion(winner), duplicate: true };
        fail('statement_amendment_stale',
          'Another amendment for this statement was published concurrently; re-propose against the latest version', 409);
      }
      throw error;
    } finally {
      writer.release();
    }
  } catch (error) {
    // Durable trail for operators. Genuine validation blocks are recorded as
    // blocked: the proposal stays approved, a new proposal may supersede it,
    // and retry-publish stays available in case the block clears (e.g. the
    // next period is corrected). Storage/infra failures are recorded as
    // failed. State errors (proposal not found / not approved / no document)
    // are not publication attempts.
    const noRecordCodes = new Set([
      'statement_amendment_not_found',
      'statement_amendment_not_approved',
      'statement_amendment_no_document',
    ]);
    if (error && !noRecordCodes.has(error.code)) {
      const outcome = error instanceof AppError && (error.statusCode === 409 || error.statusCode === 404)
        ? 'blocked' : 'failed';
      try {
        await recordPublicationAttempt(pool, proposalId, outcome, null, error);
      } catch {
        // Never mask the original error with a bookkeeping failure.
      }
    }
    throw error;
  }
}

// Retry path: identical to finalize; idempotent on proposal id.
async function retryPublication(proposalId, options = {}) {
  return finalizeApprovedProposal(proposalId, options);
}

// ── statement.amended outbox drain ──────────────────────────────────────────
// Notifies the statement owner exactly once after publication. The
// notification row dedupes on delivery_key, and the event is marked processed
// only after a successful send.
function composeStatementAmendedPayload({ customerId, payload }) {
  return {
    userId: customerId,
    type: 'statement_amended',
    data: {
      statementVersionId: payload.versionId,
      proposalId: payload.proposalId,
      originalDocumentId: payload.originalDocumentId,
      revision: payload.revision,
      product: payload.product,
      periodFrom: payload.periodFrom,
      periodTo: payload.periodTo,
    },
    // Authenticated product pages; both require login. No tokens, no PII,
    // no amounts in the link or the message. Settlement owners see their
    // hub page; restaurant wallet owners keep the existing deep links.
    action_url: ({ restaurant: '/restaurant-credit/statements/archive', oxsteed: '/oxsteed-credit/statements/archive',
      restaurant_settlement: '/restaurant-settlement/statements', business: '/business/statements',
      helper_earnings: '/helper-earnings/statements' })[payload.product] || '/oxsteed-credit/statements/archive',
    idempotencyKey: `statement-amended:${payload.proposalId}`,
  };
}

async function processStatementAmendedOutbox({ workerId, limit = 50 } = {}) {
  // Lazy require: notificationService never imports this module.
  const { sendNotification } = require('./notificationService');
  const events = await jobs.claimOutboxEvents(limit, workerId);
  let processed = 0;
  let released = 0;
  for (const event of events) {
    try {
      if (event.event_type !== 'statement.amended') {
        // Foreign event (e.g. statement.ready): release it for its own drain
        // instead of consuming it here.
        await jobs.outboxFailed(event.id);
        released += 1;
        continue;
      }
      const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
      // Settlement originals live in the 688 archive; credit originals in the
      // 682 archive. The recipient is the settlement owner (helper, business
      // owner, or restaurant business owner) resolved from the scope.
      const { rows: [version] } = await pool.query(
        `SELECT v.artifact_id, v.settlement_original_document_id, d.customer_id
         FROM statement_amendment_versions v
         LEFT JOIN credit_statement_documents d ON d.id = v.original_document_id
         WHERE v.id = $1`,
        [event.aggregate_id]);
      if (!version) {
        logger.warn('statement.amended for an unknown version; marking processed', {
          aggregateId: event.aggregate_id,
        });
        await jobs.markOutboxProcessed(event.id);
        processed += 1;
        continue;
      }
      let recipientId = version.customer_id;
      if (version.settlement_original_document_id) {
        const { rows: [settlement] } = await pool.query(
          `SELECT product, scope_restaurant_id, scope_business_id, scope_helper_user_id
           FROM settlement_statement_documents WHERE id = $1`,
          [version.settlement_original_document_id]);
        recipientId = settlement ? await resolveSettlementRecipient(pool, settlement) : null;
      }
      if (!version) {
        logger.warn('statement.amended for an unknown version; marking processed', {
          aggregateId: event.aggregate_id,
        });
        await jobs.markOutboxProcessed(event.id);
        processed += 1;
        continue;
      }
      const { rows: [artifact] } = await pool.query(
        'SELECT state FROM statement_artifacts WHERE id = $1', [version.artifact_id]);
      if (!artifact || artifact.state !== 'ready') {
        // The event is only queued after a verified publish, so this is
        // transient: release for redelivery rather than notifying early.
        await jobs.outboxFailed(event.id);
        released += 1;
        continue;
      }
      const notification = composeStatementAmendedPayload({ customerId: recipientId, payload });
      const result = await sendNotification(notification);
      if (result && result.success === true) {
        await jobs.markOutboxProcessed(event.id);
        processed += 1;
      } else if (result && result.reason === 'user_not_found') {
        await jobs.markOutboxProcessed(event.id);
        processed += 1;
      } else {
        await jobs.outboxFailed(event.id);
        released += 1;
      }
    } catch (error) {
      logger.warn('statement.amended processing failed; releasing for redelivery', {
        eventId: event.id,
        error: String((error && error.message) || 'unknown error').slice(0, 500),
      });
      try {
        await jobs.outboxFailed(event.id);
      } catch {
        // The event stays claimed; a later cycle reclaims it once the claim ages out.
      }
      released += 1;
    }
  }
  return { claimed: events.length, processed, released };
}

module.exports = {
  proposeAmendment,
  finalizeApprovedProposal,
  retryPublication,
  processStatementAmendedOutbox,
  composeStatementAmendedPayload,
  coreOf,
  ledgerFingerprint,
  shapeVersion,
  shapeProposalForResponse,
  testHooks: { fetchSettlementCompensatingRef, assertSettlementRestatedDelta, assertPriorContinuity, checkContinuity },
};
