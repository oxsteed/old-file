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
const snapshots = require('./statementSnapshotService');
const artifacts = require('./statementArtifactService');
const jobs = require('./statementJobService');
const { renderStatementPdfInWorker } = require('./creditStatementExport');
const defaultStorage = require('../utils/storage');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INT_RE = /^[1-9]\d*$/;
const AMENDMENT_TYPES = new Set(['clerical', 'accounting']);
const PRESENTATIONS = new Set(['restated', 'later_period']);
const LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar']);
const CORE_MONEY_KEYS = ['openingBalanceCents', 'totalCreditsCents', 'totalDebitsCents', 'closingBalanceCents'];

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

// The money-relevant core of a statement document. The fingerprint pins the
// ledger-derived source data a proposal was built against so approval
// re-validates it instead of trusting it.
function coreOf(document) {
  const source = document && typeof document === 'object' ? document : {};
  const transactions = Array.isArray(source.transactions) ? source.transactions : [];
  return {
    openingBalanceCents: source.openingBalanceCents,
    totalCreditsCents: source.totalCreditsCents,
    totalDebitsCents: source.totalDebitsCents,
    closingBalanceCents: source.closingBalanceCents,
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
  for (const key of CORE_MONEY_KEYS) assertMinorInteger(core[key], `${label} ${key}`);
  if (!Number.isSafeInteger(core.transactionCount)) {
    fail('statement_amendment_integrity_failed', `Statement ${label} transaction count is not an integer`, 409);
  }
}

async function loadOriginalDocument(clientOrPool, documentId) {
  const { rows: [row] } = await clientOrPool.query(
    `SELECT id, customer_id, product, account_id, currency_code,
            period_from, period_to, generated_at, document, content_hash
     FROM credit_statement_documents WHERE id = $1`,
    [documentId]);
  if (!row) fail('statement_amendment_document_not_found', 'Original statement document not found', 404);
  return row;
}

// The baseline a new amendment builds on: the latest published version's
// envelope when the chain already exists, otherwise the issued original.
// Delta and equality checks always run against the baseline so ordered
// chains (v1, v2, ...) compose instead of each re-diffing the original.
async function loadBaseline(clientOrPool, original) {
  const { rows: [latest] } = await clientOrPool.query(
    `SELECT id, document, content_hash, revision_number
     FROM statement_amendment_versions
     WHERE original_document_id = $1
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

// Re-derive the period from the CURRENT ledger, bypassing the archived
// original (creditStatementService rederive mode). Throws
// statement_integrity_failed when the derivation does not reconcile.
async function rederiveStatement(original) {
  const options = {
    product: original.product,
    currencyCode: original.currency_code,
    from: isoDate(original.period_from),
    to: isoDate(original.period_to),
    rederive: true,
  };
  if (original.product === 'restaurant') {
    options.restaurantId = await resolveWalletRestaurantId(pool, original.account_id);
  }
  return statements.getStatement(original.customer_id, options);
}

// Validate one compensating reference against the authoritative ledger.
// Returns { id, amountCents, direction, postedAt, kind } with direction
// relative to the statement's account. Never invents or moves money: the
// transaction must already exist and be posted.
async function fetchCompensatingRef(clientOrPool, product, accountId, currencyCode, ref) {
  const accountText = String(accountId);
  if (product === 'oxsteed') {
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

function issuanceKeyForOriginal(original, restaurantIdOrNull) {
  const accountPart = original.product === 'restaurant' && restaurantIdOrNull
    ? String(restaurantIdOrNull)
    : String(original.account_id);
  return jobs.issuanceKeyFor({
    product: original.product,
    accountId: accountPart,
    currencyCode: original.currency_code,
    periodFrom: isoDate(original.period_from),
    periodTo: isoDate(original.period_to),
    customerId: original.customer_id,
  });
}

async function countVersions(clientOrPool, originalDocumentId) {
  const { rows: [{ n }] } = await clientOrPool.query(
    'SELECT COUNT(*)::int AS n FROM statement_amendment_versions WHERE original_document_id = $1',
    [originalDocumentId]);
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
    originalDocumentId: row.original_document_id,
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
    nextPeriodDocumentId: row.next_period_document_id || null,
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
    accountId: Number(row.account_id),
    currencyCode: row.currency_code,
    period: {
      from: isoDate(row.period_from),
      to: isoDate(row.period_to),
    },
    documentId: row.document_id || null,
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

    // One live proposal per document: a second proposal waits (409) while a
    // proposed or an approved-but-unpublished proposal is in flight. An
    // approved proposal whose publication was BLOCKED (validation failed and
    // no version was published) does not wedge the queue: a new proposal may
    // supersede it, and the stale-approval check keeps publication safe.
    const { rows: [live] } = await client.query(
      `SELECT p.id, p.status FROM statement_amendment_proposals p
       WHERE p.document_id = $1
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
        client, original.product, original.account_id, original.currency_code, ref));
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
         WHERE p.document_id = $1 AND p.status <> 'rejected'
           AND NOT (p.status = 'approved'
                    AND NOT EXISTS (SELECT 1 FROM statement_amendment_versions v WHERE v.proposal_id = p.id)
                    AND EXISTS (SELECT 1 FROM statement_amendment_publication_attempts a
                                WHERE a.proposal_id = p.id AND a.outcome = 'blocked'))
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(p.compensating_transaction_refs) e
             WHERE e->>'id' = ANY($2::text[]))
         UNION ALL
         SELECT v.proposal_id AS holder FROM statement_amendment_versions v
         WHERE v.original_document_id = $1
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

    const baseRevision = await countVersions(client, documentId);
    const proposalId = crypto.randomUUID();
    const restaurantId = original.product === 'restaurant'
      ? await resolveWalletRestaurantId(client, original.account_id)
      : null;
    const refsJson = refDetails.map((ref) => ({
      id: String(ref.id),
      amountCents: ref.amountCents,
      direction: ref.direction,
      postedAt: ref.postedAt,
      effectiveDate: ref.effectiveDate,
      kind: ref.kind,
    }));
    const { rows: [proposal] } = await client.query(
      `INSERT INTO statement_amendment_proposals
         (id, issuance_key, product, account_id, currency_code, period_from, period_to,
          document_id, amendment_type, presentation, reason, evidence_refs,
          compensating_transaction_refs, restate_forward, original_document_hash,
          ledger_fingerprint, base_revision_number, proposed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [proposalId, issuanceKeyForOriginal(original, restaurantId), original.product,
        original.account_id, original.currency_code,
        isoDate(original.period_from), isoDate(original.period_to), documentId,
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
  const { rows: [artifact] } = await pool.query(
    `SELECT snapshot_id FROM statement_artifacts
     WHERE document_id = $1 AND kind = 'original'
     ORDER BY created_at ASC LIMIT 1`,
    [original.id]);
  if (artifact) return artifact.snapshot_id;
  let accountId = String(original.account_id);
  if (original.product === 'restaurant') {
    accountId = String(await resolveWalletRestaurantId(pool, original.account_id));
  }
  const issuanceKey = jobs.issuanceKeyFor({
    product: original.product,
    accountId,
    currencyCode: original.currency_code,
    periodFrom: isoDate(original.period_from),
    periodTo: isoDate(original.period_to),
    customerId: original.customer_id,
  });
  const snapshot = await snapshots.freezeSnapshot({
    issuanceKey,
    product: original.product,
    accountId,
    currency: original.currency_code,
    periodFrom: isoDate(original.period_from),
    periodTo: isoDate(original.period_to),
    customerId: original.customer_id,
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
  const { rows: [next] } = await pool.query(
    `SELECT id, period_from, period_to, document
     FROM credit_statement_documents
     WHERE customer_id = $1 AND product = $2 AND account_id = $3 AND currency_code = $4
       AND period_from > $5
     ORDER BY period_from ASC LIMIT 1`,
    [original.customer_id, original.product, original.account_id, original.currency_code,
      isoDate(original.period_to)]);
  if (!next) return { status: 'continuous', nextPeriod: null };
  const nextDocument = next.document && typeof next.document === 'object' ? next.document : {};
  // Effective opening: the next period's latest amendment restates it, else
  // the issued opening.
  const { rows: [nextVersion] } = await pool.query(
    `SELECT document FROM statement_amendment_versions
     WHERE original_document_id = $1
     ORDER BY revision_number DESC LIMIT 1`,
    [next.id]);
  const revisedOpening = nextVersion
    && nextVersion.document && typeof nextVersion.document === 'object'
    && nextVersion.document.totals && typeof nextVersion.document.totals === 'object'
    && nextVersion.document.totals.revised
    && Number.isSafeInteger(nextVersion.document.totals.revised.openingMinor)
    ? nextVersion.document.totals.revised.openingMinor
    : null;
  const issuedOpening = Number.isSafeInteger(nextDocument.openingBalanceCents)
    ? nextDocument.openingBalanceCents : null;
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
    if (!restateForward) {
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

// ── Amended document envelope ───────────────────────────────────────────────
// original / adjustment / revised totals are shown side by side; dates are
// disclosed; backdated corrections are flagged. The envelope is hashed with
// the shared hashDocument so the version row's content_hash is verifiable.
function buildAmendedDocument({ rederived, original, baseline, proposal, revisionNumber, refDetails, continuity, supersedesVersion }) {
  const baselineCore = coreOf(baseline.doc);
  const rederivedCore = coreOf(rederived);
  assertCoreMoneyIntegers(baselineCore, 'baseline');
  assertCoreMoneyIntegers(rederivedCore, 're-derived');
  // The re-derived statement must reconcile with itself: opening + credits -
  // debits = closing (the builders already enforce this; belt and braces).
  const equationHolds = (core) => (
    BigInt(core.openingBalanceCents) + BigInt(core.totalCreditsCents) - BigInt(core.totalDebitsCents)
    === BigInt(core.closingBalanceCents)
  );
  if (!equationHolds(rederivedCore)) {
    fail('statement_amendment_integrity_failed',
      'Re-derived statement does not reconcile: opening + credits - debits != closing', 409);
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
      original: {
        openingMinor: baselineCore.openingBalanceCents,
        creditsMinor: baselineCore.totalCreditsCents,
        debitsMinor: baselineCore.totalDebitsCents,
        closingMinor: baselineCore.closingBalanceCents,
        transactionCount: baselineCore.transactionCount,
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
      revised: {
        openingMinor: rederivedCore.openingBalanceCents,
        creditsMinor: rederivedCore.totalCreditsCents,
        debitsMinor: rederivedCore.totalDebitsCents,
        closingMinor: rederivedCore.closingBalanceCents,
        transactionCount: rederivedCore.transactionCount,
      },
    },
    continuity: {
      status: continuity.status,
      priorClosingMinor: baselineCore.closingBalanceCents,
      revisedClosingMinor: rederivedCore.closingBalanceCents,
      nextPeriodDocumentId: continuity.nextPeriod ? continuity.nextPeriod.id : null,
      nextPeriodPeriod: continuity.nextPeriod
        ? { from: continuity.nextPeriod.periodFrom, to: continuity.nextPeriod.periodTo } : null,
      nextPeriodIssuedOpeningMinor: continuity.nextPeriod ? continuity.nextPeriod.issuedOpeningMinor : null,
      nextPeriodEffectiveOpeningMinor: continuity.nextPeriod ? continuity.nextPeriod.effectiveOpeningMinor : null,
      nextPeriodRestatedByVersion: continuity.nextPeriod ? Boolean(continuity.nextPeriod.restatedByVersion) : null,
      restatedOpeningMinor: continuity.status === 'restated_forward' ? rederivedCore.closingBalanceCents : null,
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
      if (!row.document_id) {
        fail('statement_amendment_no_document', 'Proposal names no issued original; nothing to publish', 409);
      }
      proposal = row;
      original = await loadOriginalDocument(client, proposal.document_id);
      if (original.content_hash !== proposal.original_document_hash) {
        fail('statement_amendment_source_changed',
          'The issued original changed since the proposal was created; re-propose', 409);
      }
      const versionCount = await countVersions(client, proposal.document_id);
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
          client, proposal.product, proposal.account_id, proposal.currency_code, String(stored.id));
        if (live.amountCents !== Number(stored.amountCents)
            || live.direction !== stored.direction
            || live.effectiveDate !== stored.effectiveDate) {
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
    const continuity = await checkContinuity({
      original,
      revisedClosingMinor: rederivedCore.closingBalanceCents,
      baselineClosingMinor: baselineCore.closingBalanceCents,
      restateForward: proposal.restate_forward,
    });

    let supersedesVersion = null;
    if (revisionNumber > 1) {
      const { rows: [prev] } = await pool.query(
        `SELECT id, content_hash FROM statement_amendment_versions
         WHERE original_document_id = $1 AND revision_number = $2`,
        [proposal.document_id, revisionNumber - 1]);
      if (!prev) {
        fail('statement_amendment_stale',
          'The amendment chain changed; re-propose against the latest version', 409);
      }
      supersedesVersion = prev;
    }

    const envelope = buildAmendedDocument({
      rederived, original, baseline, proposal, revisionNumber, refDetails, continuity, supersedesVersion,
    });
    const language = await resolveStatementLanguage(original.customer_id);

    let artifact;
    const pdfBytes = await renderStatementPdfInWorker(envelope, { language });
    const snapshotId = await resolveAmendmentSnapshotId(original);
    artifact = await artifacts.publishRendition({ snapshotId, language, pdfBytes, label, storage });

    const versionId = crypto.randomUUID();
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      const { rows: [version] } = await writer.query(
        `INSERT INTO statement_amendment_versions
           (id, original_document_id, proposal_id, revision_number, amendment_type,
            presentation, document, content_hash, artifact_id, supersedes_version_id,
            prior_version_closing_minor, revised_closing_minor, continuity_status,
            next_period_document_id, next_period_issued_opening_minor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [versionId, proposal.document_id, proposalId, revisionNumber, proposal.amendment_type,
          proposal.presentation, JSON.stringify(envelope), envelope.contentHash, artifact.id,
          supersedesVersion ? supersedesVersion.id : null,
          baselineCore.closingBalanceCents, rederivedCore.closingBalanceCents,
          continuity.status,
          continuity.nextPeriod ? continuity.nextPeriod.id : null,
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
            originalDocumentId: proposal.document_id,
            revision: revisionNumber + 1,
            product: original.product,
            accountId: String(original.account_id),
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
    // no amounts in the link or the message.
    action_url: payload.product === 'restaurant' ? '/wallet' : '/oxsteed-credit',
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
      const { rows: [version] } = await pool.query(
        `SELECT v.artifact_id, d.customer_id
         FROM statement_amendment_versions v
         JOIN credit_statement_documents d ON d.id = v.original_document_id
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
      const { rows: [artifact] } = await pool.query(
        'SELECT state FROM statement_artifacts WHERE id = $1', [version.artifact_id]);
      if (!artifact || artifact.state !== 'ready') {
        // The event is only queued after a verified publish, so this is
        // transient: release for redelivery rather than notifying early.
        await jobs.outboxFailed(event.id);
        released += 1;
        continue;
      }
      const notification = composeStatementAmendedPayload({ customerId: version.customer_id, payload });
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
};
