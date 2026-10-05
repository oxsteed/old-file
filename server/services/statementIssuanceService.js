'use strict';

/**
 * statementIssuanceService — orchestrates one statement account-job end to end.
 *
 * Pipeline for a leased job (each stage committed with fencing via
 * statementJobService.completeJobStage; any stage failure goes to failJob):
 *   (a) freeze the ledger snapshot (idempotent per issuance key; a re-drive
 *       after a crash returns the already-frozen snapshot and never
 *       resnapshots, and never resnapshots a completed original);
 *   (b) render the archived monthly document to PDF in an isolated worker
 *       thread under the 60s export deadline (creditStatementExport pattern);
 *   (c) publish the original artifact (verify-before-ready; fails closed
 *       without STATEMENT_ARTIFACT_BUCKET);
 *   (d) insert the immutable credit_statement_documents row (migration 682)
 *       in the SAME transaction as the `statement.ready` outbox event, so a
 *       notification can never exist without its committed document; the
 *       append is guarded so a re-drive after a crash in this window queues
 *       exactly one event per job;
 *   (e) mark the job complete.
 *
 * Invariants: statements never move money; product/account/currency scopes
 * never mix; integer minor units only; authoritative timestamps preserved;
 * holds are informational only (monthly statements carry none); issued
 * originals are append-only; no PII in outbox aggregate ids, payloads, keys,
 * or filenames.
 */

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const crypto = require('crypto');
const jobs = require('./statementJobService');
const snapshots = require('./statementSnapshotService');
const artifacts = require('./statementArtifactService');
const statements = require('./creditStatementService');
const settlementStatements = require('./settlementStatementService');
const { renderStatementPdfInWorker } = require('./creditStatementExport');
const policy = require('./statementIssuancePolicy');

const SUPPORTED_LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Error codes that can never succeed on retry: the job's inputs or the ledger
// evidence are permanently bad, so the job goes straight to dead_letter with
// a clear reason instead of burning the attempt budget. Everything else
// (timeouts, storage hiccups, unconfigured bucket, DB blips) is retryable
// with the job service's bounded exponential backoff.
const NON_RETRYABLE_CODES = new Set([
  'statement_integrity_failed', // reconciliation mismatch: opening + credits - debits != closing
  'statement_snapshot_integrity_failed',
  'statement_snapshot_scope_mismatch',
  'statement_snapshot_invalid_key',
  'statement_before_account',
  'statement_account_not_found',
  'statement_invalid_period',
  'statement_invalid_product',
  'statement_invalid_account',
  'statement_artifact_verification_failed',
  'statement_artifact_invalid_input',
  'statement_export_too_large',
  'statement_unsupported_glyph',
]);

function messageOf(error) {
  return String((error && error.message) || 'unknown error').slice(0, 2000);
}

function isRetryableError(error) {
  const code = error && error.code;
  if (code && NON_RETRYABLE_CODES.has(String(code))) return false;
  return true;
}

function formatDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value || '').slice(0, 10);
  if (!DATE_RE.test(text)) throw new AppError('Invalid run period', 500, 'statement_run_invalid_period');
  return text;
}

/**
 * The latest fully-closed UTC calendar month. Pure and unit-testable:
 * 2024-03-15 -> { from: '2024-02-01', to: '2024-02-29' } (leap year),
 * 2025-01-10 -> { from: '2024-12-01', to: '2024-12-31' } (year rollover).
 */
function latestClosedMonthPeriod(now = new Date()) {
  const cursor = new Date(now);
  if (Number.isNaN(cursor.getTime())) throw new AppError('Invalid reference date', 400, 'statement_invalid_period');
  const firstOfPrevious = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1));
  const lastOfPrevious = new Date(Date.UTC(
    firstOfPrevious.getUTCFullYear(), firstOfPrevious.getUTCMonth() + 1, 0));
  return {
    from: firstOfPrevious.toISOString().slice(0, 10),
    to: lastOfPrevious.toISOString().slice(0, 10),
  };
}

/** True once the post-month-end grace period has fully elapsed. */
function issuanceGraceElapsed(periodTo, now = new Date(), graceHours = policy.ISSUANCE_GRACE_HOURS) {
  if (!DATE_RE.test(String(periodTo))) return false;
  const monthEnd = Date.parse(`${periodTo}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (!Number.isFinite(monthEnd) || !Number.isFinite(nowMs)) return false;
  return nowMs >= monthEnd + Number(graceHours) * 60 * 60 * 1000;
}

async function resolveStatementLanguage(customerId) {
  try {
    const { rows: [row] } = await pool.query(
      'SELECT preferred_language FROM users WHERE id = $1', [customerId]);
    const lang = String(row?.preferred_language || 'en').split(/[-_]/)[0].toLowerCase();
    return SUPPORTED_LANGUAGES.has(lang) ? lang : 'en';
  } catch {
    return 'en';
  }
}

// --- Account discovery ------------------------------------------------------
// One job per (product, account, currency). For product 'oxsteed' the job's
// account_id is the customer wallet id; for 'restaurant' it is the restaurant
// id (the snapshot service resolves the customer wallet from it); for
// 'restaurant_settlement' it is the restaurant id (the snapshot service
// resolves the sub-bank account); for 'helper_earnings' the job's
// account_uuid is the helper user id; for 'business' the job's account_id is
// the business id. These conventions match the issuance-key format the
// snapshot and artifact services parse, so discovery, freezing, and
// publication can never disagree on a scope.

const OXSTEED_ACCOUNTS_SQL = `
  SELECT id AS account_id, NULL::uuid AS account_uuid,
         customer_id, currency_code, status, created_at,
         id::text AS cursor_a, NULL::text AS cursor_b
  FROM oxsteed_credit_accounts
  WHERE account_type = 'customer_wallet'
    AND ($1::bigint IS NULL OR id > $1::bigint)
  ORDER BY id ASC
  LIMIT $2`;

const RESTAURANT_ACCOUNTS_SQL = `
  SELECT id AS account_id, NULL::uuid AS account_uuid,
         customer_id, currency_code, status, created_at,
         id::text AS cursor_a, NULL::text AS cursor_b
  FROM food_customer_wallet_accounts
  WHERE ($1::bigint IS NULL OR id > $1::bigint)
  ORDER BY id ASC
  LIMIT $2`;

// Restaurants with sub-bank accounts. The job scope is the restaurant id;
// the cursor is the sub-bank account id (one row per (restaurant, currency)).
// customer_id is the business owner: the statement recipient. status is the
// restaurant lifecycle status (active/suspended/draft/paused).
const RESTAURANT_SETTLEMENT_ACCOUNTS_SQL = `
  SELECT a.restaurant_id AS account_id, NULL::uuid AS account_uuid,
         b.user_id AS customer_id, a.currency_code,
         fr.status AS status, a.created_at,
         a.id::text AS cursor_a, NULL::text AS cursor_b
  FROM oxsteed_credit_accounts a
  JOIN food_restaurants fr ON fr.id = a.restaurant_id
  LEFT JOIN businesses b ON b.id = fr.business_id
  WHERE a.account_type = 'restaurant_sub_bank'
    AND ($1::bigint IS NULL OR a.id > $1::bigint)
  ORDER BY a.id ASC
  LIMIT $2`;

// Helpers with earnings activity: one row per (helper, currency) seen on
// jobs. Zero-activity carryover is honored because any helper with
// historical jobs (and a payable position) is discovered, even when the
// period itself has no new completions. Helpers with no jobs at all get no
// statement: there is no account to carry over.
const HELPER_EARNINGS_ACCOUNTS_SQL = `
  SELECT NULL::bigint AS account_id, j.assigned_helper_id AS account_uuid,
         j.assigned_helper_id AS customer_id, j.currency_code,
         CASE WHEN u.is_active THEN 'active' ELSE 'suspended' END AS status,
         u.created_at,
         j.assigned_helper_id::text AS cursor_a, j.currency_code AS cursor_b
  FROM (SELECT DISTINCT assigned_helper_id, currency_code FROM jobs
        WHERE assigned_helper_id IS NOT NULL) j
  JOIN users u ON u.id = j.assigned_helper_id
  WHERE ($1::text IS NULL OR (j.assigned_helper_id::text, j.currency_code) > ($1::text, $2::text))
  ORDER BY j.assigned_helper_id::text ASC, j.currency_code ASC
  LIMIT $3`;

// Businesses with financial activity: one row per (business, currency) where
// the currency appears on the business's invoices, partner settlements, or
// restaurants. status normalizes the business lifecycle for the shared
// eligibility policy (deleted -> closed).
const BUSINESS_ACCOUNTS_SQL = `
  SELECT b.id AS account_id, NULL::uuid AS account_uuid,
         b.user_id AS customer_id, c.currency_code,
         CASE WHEN b.deleted_at IS NOT NULL THEN 'closed'
              WHEN NOT b.is_active THEN 'suspended'
              ELSE 'active' END AS status,
         b.created_at,
         b.id::text AS cursor_a, c.currency_code AS cursor_b
  FROM businesses b
  JOIN LATERAL (
    SELECT DISTINCT currency_code FROM (
      SELECT currency_code FROM business_invoices WHERE business_id = b.id
      UNION
      SELECT s.currency_code FROM oxsteed_credit_settlements s
        JOIN oxsteed_credit_partners p ON p.id = s.partner_id
       WHERE p.business_id = b.id
      UNION
      SELECT r.currency_code FROM food_restaurants r WHERE r.business_id = b.id
    ) currencies
  ) c ON true
  WHERE ($1::bigint IS NULL OR (b.id, c.currency_code) > ($1::bigint, $2::text))
  ORDER BY b.id ASC, c.currency_code ASC
  LIMIT $3`;

// Single-cursor products pass [cursorA, limit]; composite products pass
// [cursorA, cursorB, limit]. Every placeholder in the SQL text must be bound:
// PostgreSQL cannot infer the type of an unreferenced $n, so a shared
// [cursorA, cursorB, limit] tuple breaks the single-cursor queries on the
// first page (cursorB is null there).
const singleCursorParams = (cursorA, _cursorB, limit) => [cursorA, limit];
const compositeCursorParams = (cursorA, cursorB, limit) => [cursorA, cursorB, limit];
const DISCOVERY_SQL = {
  oxsteed: { text: OXSTEED_ACCOUNTS_SQL, params: singleCursorParams },
  restaurant: { text: RESTAURANT_ACCOUNTS_SQL, params: singleCursorParams },
  restaurant_settlement: { text: RESTAURANT_SETTLEMENT_ACCOUNTS_SQL, params: singleCursorParams },
  helper_earnings: { text: HELPER_EARNINGS_ACCOUNTS_SQL, params: compositeCursorParams },
  business: { text: BUSINESS_ACCOUNTS_SQL, params: compositeCursorParams },
};

// Products whose cursor is a composite "<scope>:<currency>" pair.
const COMPOSITE_CURSOR_PRODUCTS = new Set(['helper_earnings', 'business']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseDiscoveryCursor(product, cursor) {
  if (cursor === null || cursor === undefined || String(cursor) === '') {
    return { cursorA: null, cursorB: null };
  }
  const text = String(cursor);
  if (!COMPOSITE_CURSOR_PRODUCTS.has(product)) {
    if (!/^[1-9]\d*$/.test(text)) throw new AppError('Invalid discovery cursor', 400, 'statement_invalid_cursor');
    return { cursorA: text, cursorB: null };
  }
  const separator = text.lastIndexOf(':');
  if (separator <= 0) throw new AppError('Invalid discovery cursor', 400, 'statement_invalid_cursor');
  const cursorA = text.slice(0, separator);
  const cursorB = text.slice(separator + 1).toUpperCase();
  if (product === 'helper_earnings' && !UUID_RE.test(cursorA)) {
    throw new AppError('Invalid discovery cursor', 400, 'statement_invalid_cursor');
  }
  if (product === 'business' && !/^[1-9]\d*$/.test(cursorA)) {
    throw new AppError('Invalid discovery cursor', 400, 'statement_invalid_cursor');
  }
  if (!/^[A-Z]{3}$/.test(cursorB)) throw new AppError('Invalid discovery cursor', 400, 'statement_invalid_cursor');
  return { cursorA, cursorB };
}

function formatDiscoveryCursor(product, row) {
  if (!COMPOSITE_CURSOR_PRODUCTS.has(product)) return row.cursor_a;
  return `${row.cursor_a}:${row.cursor_b}`;
}

/**
 * Bounded, cursor-based account scan. Returns { eligible, skipped, nextCursor }.
 * eligible entries are { customerId, product, accountId?, accountUuid?,
 * currencyCode } ready for discoverAccountJobs; skipped entries carry the same
 * fields plus a stable machine-readable reason recorded on the job row.
 */
async function discoverEligibleAccounts({ product, periodFrom, periodTo, batchSize = policy.DISCOVERY_BATCH_SIZE, cursor = null }) {
  if (!policy.PRODUCTS.includes(product)) {
    throw new AppError('Unknown statement product', 400, 'statement_invalid_product');
  }
  if (!DATE_RE.test(String(periodFrom)) || !DATE_RE.test(String(periodTo)) || periodTo < periodFrom) {
    throw new AppError('Invalid discovery period', 400, 'statement_invalid_period');
  }
  const limit = Math.max(1, Math.min(Math.trunc(Number(batchSize)) || policy.DISCOVERY_BATCH_SIZE, 1000));
  const { cursorA, cursorB } = parseDiscoveryCursor(product, cursor);
  const entry = DISCOVERY_SQL[product];
  const { rows } = await pool.query(entry.text, entry.params(cursorA, cursorB, limit));
  const eligible = [];
  const skipped = [];
  for (const row of rows) {
    const spec = {
      customerId: String(row.customer_id),
      product,
      currencyCode: String(row.currency_code || '').toUpperCase(),
    };
    if (row.account_uuid) spec.accountUuid = String(row.account_uuid).toLowerCase();
    else spec.accountId = String(row.account_id);
    const decision = policy.evaluateAccountEligibility(row, { product, periodFrom, periodTo });
    if (decision.eligible) eligible.push(spec);
    else skipped.push({ ...spec, reason: decision.reason });
  }
  const nextCursor = rows.length === limit ? formatDiscoveryCursor(product, rows[rows.length - 1]) : null;
  return { eligible, skipped, nextCursor };
}

async function loadRunPeriod(runId) {
  const { rows: [run] } = await pool.query(
    'SELECT period_from, period_to FROM statement_issuance_runs WHERE id = $1', [runId]);
  if (!run) throw new AppError('Statement issuance run not found', 404, 'statement_job_run_not_found');
  return { from: formatDate(run.period_from), to: formatDate(run.period_to) };
}

/**
 * Record policy skips as job rows so no account is ever skipped silently.
 * Skips land in dead_letter with last_error 'skip:<reason>': they are never
 * claimed, they stay visible to operators, and getRunStats surfaces them.
 * ON CONFLICT DO NOTHING keeps re-scans idempotent; an already-issued job
 * for the same key always wins over a skip.
 */
async function recordSkippedJobs(runId, skipped) {
  if (!Array.isArray(skipped) || skipped.length === 0) return 0;
  const { from, to } = await loadRunPeriod(runId);
  const values = [];
  const params = [];
  skipped.forEach((entry, index) => {
    const key = jobs.issuanceKeyFor({
      product: entry.product,
      accountId: entry.accountUuid || entry.accountId,
      currencyCode: entry.currencyCode,
      periodFrom: from,
      periodTo: to,
      customerId: entry.customerId,
    });
    const base = index * 10;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, 'dead_letter', $${base + 9}, $${base + 10}, transaction_timestamp())`);
    params.push(
      crypto.randomUUID(), runId, entry.customerId, entry.product,
      entry.accountUuid ? null : (entry.accountId || null),
      entry.accountUuid || null,
      entry.currencyCode, key, `skip:${entry.reason}`, 8,
    );
  });
  // Column order: id, run_id, customer_id, product, account_id, account_uuid,
  // currency_code, issuance_key, state, last_error, max_attempts, updated_at
  const { rowCount } = await pool.query(
    `INSERT INTO statement_account_jobs
       (id, run_id, customer_id, product, account_id, account_uuid, currency_code, issuance_key,
        state, last_error, max_attempts, updated_at)
     VALUES ${values.join(', ')}
     ON CONFLICT (issuance_key) DO NOTHING`,
    params);
  return rowCount;
}

/**
 * If a skipped account became eligible again (e.g. reactivated) before the
 * run closed, flip its recorded skip back to pending so the claim loop can
 * pick it up. Only touches rows this pipeline marked as skips.
 */
async function reviveEligibleSkips(runId, eligible) {
  if (!Array.isArray(eligible) || eligible.length === 0) return 0;
  const { from, to } = await loadRunPeriod(runId);
  const keys = eligible.map((entry) => jobs.issuanceKeyFor({
    product: entry.product,
    accountId: entry.accountId,
    currencyCode: entry.currencyCode,
    periodFrom: from,
    periodTo: to,
    customerId: entry.customerId,
  }));
  const { rowCount } = await pool.query(
    `UPDATE statement_account_jobs
     SET state = 'pending', last_error = NULL, next_retry_at = NULL,
         updated_at = transaction_timestamp()
     WHERE run_id = $1 AND issuance_key = ANY($2)
       AND state = 'dead_letter' AND last_error LIKE 'skip:%'`,
    [runId, keys]);
  return rowCount;
}

// --- Stage (d): document row + outbox event, one transaction -----------------
// The outbox event must never exist without its committed document row, and
// the document row must never duplicate: the UNIQUE
// (customer_id, product, account_id, currency_code, period_from, period_to)
// constraint plus ON CONFLICT DO NOTHING makes concurrent issuers converge on
// exactly one original per account-period.
async function assertVerifiedArtifact(client, artifact, scope) {
  const { rows: [row] } = await client.query(
    `SELECT a.state, a.kind, a.storage_bucket, a.sha256, a.byte_length, s.issuance_key
     FROM statement_artifacts a JOIN statement_snapshots s ON s.id = a.snapshot_id
     WHERE a.id = $1 AND a.snapshot_id = $2 FOR SHARE OF a`,
    [artifact?.id || null, artifact?.snapshotId || null]);
  if (!row || row.state !== 'ready' || row.kind !== 'original' || !row.storage_bucket
      || row.issuance_key !== scope.issuanceKey || row.sha256 !== artifact.sha256
      || Number(row.byte_length) !== artifact.byteLength) {
    throw new AppError('Statement original is not verified for this issuance', 409, 'statement_artifact_not_ready');
  }
}

async function assertIssuanceFence(client, job) {
  const { rows: [current] } = await client.query('SELECT * FROM statement_account_jobs WHERE id=$1 FOR UPDATE', [job.id]);
  if (!current || current.lease_owner !== job.lease_owner
      || String(current.fencing_token) !== String(job.fencing_token)
      || !['artifact_ready','notified'].includes(current.state)) {
    throw new AppError('Statement issuance lease is stale', 409, 'statement_lease_stale');
  }
}

async function insertDocumentAndQueueEvent({ scope, document, artifact, job }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertIssuanceFence(client, job);
    await assertVerifiedArtifact(client, artifact, scope);
    await client.query(
      `INSERT INTO credit_statement_documents
         (id, customer_id, product, account_id, currency_code, period_from, period_to,
          generated_at, document, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (customer_id, product, account_id, currency_code, period_from, period_to)
       DO NOTHING`,
      [document.id, scope.customerId, scope.product, scope.scopeAccountId, scope.currency,
        scope.periodFrom, scope.periodTo, document.generatedAt,
        JSON.stringify(document), document.contentHash]);
    const { rows: [row] } = await client.query(
      `SELECT id FROM credit_statement_documents
       WHERE customer_id = $1 AND product = $2 AND account_id = $3 AND currency_code = $4
         AND period_from = $5 AND period_to = $6`,
      [scope.customerId, scope.product, scope.scopeAccountId, scope.currency, scope.periodFrom, scope.periodTo]);
    if (!row) {
      throw new AppError('Statement document row could not be resolved', 500, 'statement_document_missing');
    }
    // Idempotent on re-drive: a crash between COMMIT and completeJobStage
    // ('notified') would otherwise emit a duplicate statement.ready event and
    // a duplicate customer notification. Exactly one ready-event per job.
    const { rows: [existingEvent] } = await client.query(
      `SELECT id FROM statement_outbox
       WHERE event_type = 'statement.ready' AND aggregate_id = $1
       LIMIT 1`,
      [job.id]);
    if (!existingEvent) {
      await jobs.outboxAppend(client, {
        eventType: 'statement.ready',
        aggregateType: 'statement_account_job',
        aggregateId: job.id,
        payload: {
          issuanceKey: scope.issuanceKey,
          runId: job.run_id,
          documentId: row.id,
          snapshotId: artifact.snapshotId,
          artifactId: artifact.id,
          product: scope.product,
          accountId: scope.scopeAccountId,
          currencyCode: scope.currency,
          periodFrom: scope.periodFrom,
          periodTo: scope.periodTo,
          language: artifact.language,
        },
      });
    }
    await client.query('COMMIT');
    return row.id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// --- Stage (d) for settlement products: document row + outbox event ---------
// Settlement statements archive into settlement_statement_documents
// (migration 688), never credit_statement_documents: customer stored value
// and merchant/helper/business money stay structurally separate. The
// append is guarded by the product's partial unique index plus
// ON CONFLICT DO NOTHING, so concurrent issuers converge on exactly one
// original per (product, scope, currency, period), and the outbox event is
// queued in the same transaction as the document row.
function settlementScopeColumn(product) {
  if (product === 'restaurant_settlement') return 'scope_restaurant_id';
  if (product === 'helper_earnings') return 'scope_helper_user_id';
  return 'scope_business_id';
}

function settlementConflictTarget(product) {
  if (product === 'restaurant_settlement') {
    return `(scope_restaurant_id, currency_code, period_from, period_to) WHERE product = 'restaurant_settlement'`;
  }
  if (product === 'helper_earnings') {
    return `(scope_helper_user_id, currency_code, period_from, period_to) WHERE product = 'helper_earnings'`;
  }
  return `(scope_business_id, currency_code, period_from, period_to) WHERE product = 'business'`;
}

async function insertSettlementDocumentAndQueueEvent({ scope, document, artifact, job }) {
  const scopeColumn = settlementScopeColumn(scope.product);
  const scopeValue = scope.product === 'helper_earnings' ? scope.scopeAccountId : Number(scope.scopeAccountId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertIssuanceFence(client, job);
    await assertVerifiedArtifact(client, artifact, scope);
    await client.query(
      `INSERT INTO settlement_statement_documents
         (id, product, ${scopeColumn}, currency_code, period_from, period_to,
          generated_at, generated_by, document, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT ${settlementConflictTarget(scope.product)}
       DO NOTHING`,
      [document.id, scope.product, scopeValue, scope.currency,
        scope.periodFrom, scope.periodTo, document.generatedAt, scope.customerId,
        JSON.stringify(document), document.contentHash]);
    const { rows: [row] } = await client.query(
      `SELECT id FROM settlement_statement_documents
       WHERE product = $1 AND ${scopeColumn} = $2 AND currency_code = $3
         AND period_from = $4 AND period_to = $5`,
      [scope.product, scopeValue, scope.currency, scope.periodFrom, scope.periodTo]);
    if (!row) {
      throw new AppError('Statement document row could not be resolved', 500, 'statement_document_missing');
    }
    // Idempotent on re-drive: exactly one statement.ready event per job.
    const { rows: [existingEvent] } = await client.query(
      `SELECT id FROM statement_outbox
       WHERE event_type = 'statement.ready' AND aggregate_id = $1
       LIMIT 1`,
      [job.id]);
    if (!existingEvent) {
      await jobs.outboxAppend(client, {
        eventType: 'statement.ready',
        aggregateType: 'statement_account_job',
        aggregateId: job.id,
        payload: {
          issuanceKey: scope.issuanceKey,
          runId: job.run_id,
          documentId: row.id,
          snapshotId: artifact.snapshotId,
          artifactId: artifact.id,
          product: scope.product,
          accountId: scope.scopeAccountId,
          currencyCode: scope.currency,
          periodFrom: scope.periodFrom,
          periodTo: scope.periodTo,
          language: artifact.language,
        },
      });
    }
    await client.query('COMMIT');
    return row.id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// --- The per-job pipeline ----------------------------------------------------
function assertLeasedTo(job, workerId) {
  if (!job || job.state !== 'leased' || job.lease_owner !== workerId) {
    throw new AppError('Statement job is not leased to this worker', 409, 'statement_lease_stale');
  }
}

/**
 * Build the archived monthly document for one leased job. Settlement
 * products route to settlementStatementService (computation); credit
 * products keep their existing path. Scopes never mix.
 */
async function buildJobDocument(scope) {
  if (!policy.SETTLEMENT_PRODUCTS.has(scope.product)) {
    return statements.getStatement(scope.customerId, {
      product: scope.product,
      currencyCode: scope.currency,
      ...(scope.product === 'restaurant' ? { restaurantId: Number(scope.scopeAccountId) } : {}),
      from: scope.periodFrom,
      to: scope.periodTo,
    });
  }
  const options = {
    product: scope.product,
    currencyCode: scope.currency,
    from: scope.periodFrom,
    to: scope.periodTo,
  };
  if (scope.product === 'restaurant_settlement') options.restaurantId = Number(scope.scopeAccountId);
  else if (scope.product === 'business') options.businessId = Number(scope.scopeAccountId);
  else options.helperId = scope.scopeAccountId;
  return settlementStatements.getStatement(scope.customerId, options);
}

/**
 * Issue one account statement end to end. The caller must hold the job's
 * lease (claimed via claimNextAccountJob). `hooks` is a test seam only:
 * { afterSnapshot, afterRender, afterPublish, beforeDocument, afterDocument }.
 * afterDocument fires after the document-row + outbox transaction commits but
 * before the job is marked notified, so tests can simulate a crash in that
 * window and prove the re-drive queues no duplicate statement.ready event.
 */
async function issueAccountStatement({ job, workerId, storage, hooks = {} }) {
  assertLeasedTo(job, workerId);
  const fencingToken = job.fencing_token;
  let periodFrom;
  let periodTo;
  try {
    ({ from: periodFrom, to: periodTo } = await loadRunPeriod(job.run_id));
  } catch (error) {
    // The run is gone: the job can never be issued. Dead-letter it instead of
    // leaving it on an expired lease.
    await jobs.failJob(job.id, workerId, fencingToken, messageOf(error), false);
    throw error;
  }
  const scope = {
    issuanceKey: job.issuance_key,
    product: job.product,
    // Exactly one scope shape per job row (migration 691): UUID for
    // helper_earnings, BIGINT otherwise. The issuance key, snapshot, and
    // artifact readers all parse the same convention.
    scopeAccountId: job.account_uuid ? String(job.account_uuid) : String(job.account_id),
    currency: String(job.currency_code).toUpperCase(),
    periodFrom,
    periodTo,
    customerId: job.customer_id,
  };

  const failStage = async (error) => {
    // A stale lease means another worker owns the job now: never failJob on
    // a job we no longer hold; its side effects are idempotent and the new
    // holder will re-drive them safely.
    if (error && error.code === 'statement_lease_stale') throw error;
    await jobs.failJob(job.id, workerId, fencingToken, messageOf(error), isRetryableError(error));
    throw error;
  };

  // Keep ownership through rendering/publication, not just the snapshot stage.
  // A lost heartbeat aborts the renderer; final commits still check the fence.
  const controller = new AbortController();
  let heartbeatTask = null;
  const heartbeat = setInterval(() => {
    if (heartbeatTask) return;
    heartbeatTask = jobs.renewLease(job.id, workerId, fencingToken, 120)
      .catch(() => { controller.abort(); })
      .finally(() => { heartbeatTask = null; });
  }, 30000);
  heartbeat.unref?.();
  try {

  // (a) Freeze the snapshot. Idempotent per issuance key: a re-drive after a
  // crash returns the already-frozen snapshot, never resnapshots, and never
  // resnapshots a completed original (the archived monthly document wins).
  let snapshot;
  try {
    snapshot = await snapshots.freezeSnapshot({
      issuanceKey: scope.issuanceKey,
      product: scope.product,
      accountId: scope.scopeAccountId,
      currency: scope.currency,
      periodFrom: scope.periodFrom,
      periodTo: scope.periodTo,
      customerId: scope.customerId,
    });
    await hooks.afterSnapshot?.();
    await jobs.completeJobStage(job.id, workerId, fencingToken, 'snapshotted');
  } catch (error) {
    await failStage(error);
  }

  // (b) Render the archived monthly document to PDF in an isolated worker
  // thread under the 60s export deadline.
  //
  // Note on leases: the claim lease only guards the 'leased' window (stage a,
  // which is bounded by the snapshot's own statement timeout). After the
  // stage-(a) transition the job leaves 'leased', so renewLease can no longer
  // apply — and it does not need to: completeJobStage/failJob fence on
  // (lease_owner, fencing_token), never on wall-clock expiry. A job stranded
  // in an intermediate state past its lease is reclaimed back to 'leased' by
  // the claim query; the fencing token bump makes a stale worker's stage
  // call fail closed here, and the pipeline re-drives idempotently.
  let document;
  let pdfBytes;
  let language;
  try {
    // Settlement products compute via settlementStatementService; the worker
    // renders them through the settlement tagged-PDF renderer (dispatched on
    // the document's own product).
    document = await snapshots.getFrozenDocument(snapshot.id);
    const preferredLanguage = await resolveStatementLanguage(scope.customerId);
    const { rows: [languageRow] } = await pool.query(
      `UPDATE statement_account_jobs SET issuance_language=COALESCE(issuance_language,$4)
       WHERE id=$1 AND lease_owner=$2 AND fencing_token=$3 RETURNING issuance_language`,
      [job.id, workerId, fencingToken, preferredLanguage]);
    if (!languageRow) throw new AppError('Statement issuance lease is stale', 409, 'statement_lease_stale');
    language = languageRow.issuance_language;
    pdfBytes = await renderStatementPdfInWorker(document, { language, signal: controller.signal });
    await hooks.afterRender?.();
  } catch (error) {
    await failStage(error);
  }

  // (c) Publish the original artifact (verify-before-ready; fails closed
  // without STATEMENT_ARTIFACT_BUCKET). Idempotent per snapshot/kind/language.
  let artifact;
  try {
    artifact = await artifacts.publishOriginal({
      snapshotId: snapshot.id,
      language,
      pdfBytes,
      ...(storage ? { storage } : {}),
    });
    if (!artifact || artifact.state !== 'ready') {
      throw new AppError('Statement artifact is not ready', 409, 'statement_artifact_not_ready');
    }
    await hooks.afterPublish?.();
    await jobs.completeJobStage(job.id, workerId, fencingToken, 'artifact_ready');
  } catch (error) {
    await failStage(error);
  }

  // (d) Immutable document row + statement.ready outbox event, atomically.
  // Settlement products archive into settlement_statement_documents;
  // credit products keep credit_statement_documents. Scopes never mix.
  let documentId;
  try {
    await hooks.beforeDocument?.();
    documentId = policy.SETTLEMENT_PRODUCTS.has(scope.product)
      ? await insertSettlementDocumentAndQueueEvent({ scope, document, artifact, job })
      : await insertDocumentAndQueueEvent({ scope, document, artifact, job });
    await hooks.afterDocument?.();
    await jobs.completeJobStage(job.id, workerId, fencingToken, 'notified');
  } catch (error) {
    await failStage(error);
  }

  // (e) Mark the job complete.
  try {
    await jobs.completeJobStage(job.id, workerId, fencingToken, 'complete');
  } catch (error) {
    await failStage(error);
  }

  logger.info('statement issued', {
    issuanceKey: scope.issuanceKey,
    jobId: job.id,
    documentId,
    artifactId: artifact.id,
  });
  return { jobId: job.id, issuanceKey: scope.issuanceKey, documentId, artifactId: artifact.id };
  } finally {
    clearInterval(heartbeat);
    if (heartbeatTask) await heartbeatTask;
  }
}

// --- statement.ready outbox processing ---------------------------------------
// Sends the localized in-app "statement ready" notification plus a generic
// authenticated-link email. Only fires when the artifact is ready/verified:
// an event is never honored for a missing or unverifiable artifact.
// Authenticated landing pages per product. All require login; no tokens, no
// PII, no amounts in the link or the message. Settlement products land in the
// recipient's authenticated workspace (the coordinator wires dedicated
// statement pages; these are the closest existing authenticated surfaces).
const PRODUCT_ACTION_URLS = {
  oxsteed: '/oxsteed-credit/statements/archive',
  restaurant: '/restaurant-credit/statements/archive',
  restaurant_settlement: '/restaurant-settlement/statements',
  helper_earnings: '/helper-earnings/statements',
  business: '/business/statements',
};

function composeStatementReadyPayload({ job, payload }) {
  return {
    userId: job.customer_id,
    type: 'statement_ready',
    data: {
      statementDocumentId: payload.documentId,
      issuanceKey: payload.issuanceKey,
      product: payload.product,
      periodFrom: payload.periodFrom,
      periodTo: payload.periodTo,
    },
    action_url: PRODUCT_ACTION_URLS[payload.product] || '/dashboard',
    idempotencyKey: `statement-ready:${payload.issuanceKey}`,
  };
}

async function processStatementReadyOutbox({ workerId, limit = policy.OUTBOX_BATCH_SIZE } = {}) {
  // Required lazily: notificationService never imports this module, but the
  // lazy require keeps the dependency direction one-way and test-friendly.
  const { sendNotification } = require('./notificationService');
  const events = await jobs.claimOutboxEvents(limit, workerId);
  let processed = 0;
  let released = 0;
  for (const event of events) {
    try {
      if (event.event_type !== 'statement.ready') {
        // A foreign event (e.g. statement.amended) belongs to its own drain:
        // release it for redelivery instead of consuming it here.
        logger.warn('statement outbox: foreign event type; releasing for its own drain', {
          eventType: event.event_type,
        });
        await jobs.outboxFailed(event.id);
        released += 1;
        continue;
      }
      const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
      const { rows: [job] } = await pool.query(
        'SELECT customer_id, issuance_key FROM statement_account_jobs WHERE id = $1',
        [event.aggregate_id]);
      if (!job) {
        logger.warn('statement.ready for an unknown job; marking processed', {
          aggregateId: event.aggregate_id,
        });
        await jobs.markOutboxProcessed(event.id);
        processed += 1;
        continue;
      }
      const { rows: [artifact] } = await pool.query(
        'SELECT state FROM statement_artifacts WHERE id = $1', [payload.artifactId]);
      if (!artifact || artifact.state !== 'ready') {
        // The event is only queued after a verified publish, so this is
        // transient: release for redelivery rather than notifying early.
        await jobs.outboxFailed(event.id);
        released += 1;
        continue;
      }
      const notification = composeStatementReadyPayload({ job, payload });
      const result = await sendNotification(notification);
      if (result && result.success === true) {
        await jobs.markOutboxProcessed(event.id);
        processed += 1;
      } else if (result && result.reason === 'user_not_found') {
        // Terminal: the recipient is gone; the statement itself stays archived.
        await jobs.markOutboxProcessed(event.id);
        processed += 1;
      } else {
        await jobs.outboxFailed(event.id);
        released += 1;
      }
    } catch (error) {
      logger.warn('statement.ready processing failed; releasing for redelivery', {
        eventId: event.id,
        error: messageOf(error),
      });
      try {
        await jobs.outboxFailed(event.id);
      } catch {
        // The event stays claimed; a later cycle reclaims it via the claim
        // path once the claim ages out.
      }
      released += 1;
    }
  }
  return { claimed: events.length, processed, released };
}

module.exports = {
  issueAccountStatement,
  discoverEligibleAccounts,
  recordSkippedJobs,
  reviveEligibleSkips,
  insertDocumentAndQueueEvent,
  insertSettlementDocumentAndQueueEvent,
  processStatementReadyOutbox,
  composeStatementReadyPayload,
  PRODUCT_ACTION_URLS,
  latestClosedMonthPeriod,
  issuanceGraceElapsed,
  isRetryableError,
  NON_RETRYABLE_CODES,
};
