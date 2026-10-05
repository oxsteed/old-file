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
const { renderStatementPdfInWorker } = require('./creditStatementExport');
const defaultStorage = require('../utils/storage');
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
// id (the snapshot service resolves the customer wallet from it), matching
// the issuance-key convention both readers already enforce.

const OXSTEED_ACCOUNTS_SQL = `
  SELECT id, customer_id, currency_code, status, created_at
  FROM oxsteed_credit_accounts
  WHERE account_type = 'customer_wallet'
    AND ($1::bigint IS NULL OR id > $1::bigint)
  ORDER BY id ASC
  LIMIT $2`;

const RESTAURANT_ACCOUNTS_SQL = `
  SELECT id, restaurant_id, customer_id, currency_code, status, created_at
  FROM food_customer_wallet_accounts
  WHERE ($1::bigint IS NULL OR id > $1::bigint)
  ORDER BY id ASC
  LIMIT $2`;

/**
 * Bounded, cursor-based account scan. Returns { eligible, skipped, nextCursor }.
 * eligible entries are { customerId, product, accountId, currencyCode } ready
 * for discoverAccountJobs; skipped entries carry the same fields plus a stable
 * machine-readable reason recorded on the job row.
 */
async function discoverEligibleAccounts({ product, periodFrom, periodTo, batchSize = policy.DISCOVERY_BATCH_SIZE, cursor = null }) {
  if (!policy.PRODUCTS.includes(product)) {
    throw new AppError('Unknown statement product', 400, 'statement_invalid_product');
  }
  if (!DATE_RE.test(String(periodFrom)) || !DATE_RE.test(String(periodTo)) || periodTo < periodFrom) {
    throw new AppError('Invalid discovery period', 400, 'statement_invalid_period');
  }
  const limit = Math.max(1, Math.min(Math.trunc(Number(batchSize)) || policy.DISCOVERY_BATCH_SIZE, 1000));
  let cursorId = null;
  if (cursor !== null && cursor !== undefined && String(cursor) !== '') {
    if (!/^[1-9]\d*$/.test(String(cursor))) throw new AppError('Invalid discovery cursor', 400, 'statement_invalid_cursor');
    cursorId = String(cursor);
  }
  const { rows } = await pool.query(
    product === 'oxsteed' ? OXSTEED_ACCOUNTS_SQL : RESTAURANT_ACCOUNTS_SQL,
    [cursorId, limit]);
  const eligible = [];
  const skipped = [];
  for (const row of rows) {
    const accountId = product === 'oxsteed' ? row.id : row.restaurant_id;
    const spec = {
      customerId: String(row.customer_id),
      product,
      accountId: String(accountId),
      currencyCode: String(row.currency_code || '').toUpperCase(),
    };
    const decision = policy.evaluateAccountEligibility(row, { product, periodFrom, periodTo });
    if (decision.eligible) eligible.push(spec);
    else skipped.push({ ...spec, reason: decision.reason });
  }
  const nextCursor = rows.length === limit ? String(rows[rows.length - 1].id) : null;
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
      accountId: entry.accountId,
      currencyCode: entry.currencyCode,
      periodFrom: from,
      periodTo: to,
      customerId: entry.customerId,
    });
    const base = index * 9;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, 'dead_letter', $${base + 8}, $${base + 9}, transaction_timestamp())`);
    params.push(
      crypto.randomUUID(), runId, entry.customerId, entry.product, entry.accountId,
      entry.currencyCode, key, `skip:${entry.reason}`, 8,
    );
  });
  // Column order: id, run_id, customer_id, product, account_id, currency_code,
  // issuance_key, state, last_error, max_attempts, updated_at
  const { rowCount } = await pool.query(
    `INSERT INTO statement_account_jobs
       (id, run_id, customer_id, product, account_id, currency_code, issuance_key,
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
async function insertDocumentAndQueueEvent({ scope, document, artifact, job }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO credit_statement_documents
         (id, customer_id, product, account_id, currency_code, period_from, period_to,
          generated_at, document, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (customer_id, product, account_id, currency_code, period_from, period_to)
       DO NOTHING`,
      [document.id, scope.customerId, scope.product, scope.accountId, scope.currency,
        scope.periodFrom, scope.periodTo, document.generatedAt,
        JSON.stringify(document), document.contentHash]);
    const { rows: [row] } = await client.query(
      `SELECT id FROM credit_statement_documents
       WHERE customer_id = $1 AND product = $2 AND account_id = $3 AND currency_code = $4
         AND period_from = $5 AND period_to = $6`,
      [scope.customerId, scope.product, scope.accountId, scope.currency, scope.periodFrom, scope.periodTo]);
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
          accountId: scope.accountId,
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
    accountId: String(job.account_id),
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

  // (a) Freeze the snapshot. Idempotent per issuance key: a re-drive after a
  // crash returns the already-frozen snapshot, never resnapshots, and never
  // resnapshots a completed original (the archived monthly document wins).
  let snapshot;
  try {
    snapshot = await snapshots.freezeSnapshot({
      issuanceKey: scope.issuanceKey,
      product: scope.product,
      accountId: scope.accountId,
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
    document = await statements.getStatement(scope.customerId, {
      product: scope.product,
      currencyCode: scope.currency,
      ...(scope.product === 'restaurant' ? { restaurantId: Number(scope.accountId) } : {}),
      from: scope.periodFrom,
      to: scope.periodTo,
    });
    language = await resolveStatementLanguage(scope.customerId);
    pdfBytes = await renderStatementPdfInWorker(document, { language });
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
    await hooks.afterPublish?.();
    await jobs.completeJobStage(job.id, workerId, fencingToken, 'artifact_ready');
  } catch (error) {
    await failStage(error);
  }

  // (d) Immutable document row + statement.ready outbox event, atomically.
  let documentId;
  try {
    await hooks.beforeDocument?.();
    documentId = await insertDocumentAndQueueEvent({ scope, document, artifact, job });
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
}

// --- statement.ready outbox processing ---------------------------------------
// Sends the localized in-app "statement ready" notification plus a generic
// authenticated-link email. Only fires when the artifact is ready/verified:
// an event is never honored for a missing or unverifiable artifact.
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
    // Authenticated product pages; both require login. No tokens, no PII,
    // no amounts in the link or the message.
    action_url: payload.product === 'restaurant' ? '/wallet' : '/oxsteed-credit',
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
        logger.warn('statement outbox: unexpected event type; marking processed', {
          eventType: event.event_type,
        });
        await jobs.markOutboxProcessed(event.id);
        processed += 1;
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
  processStatementReadyOutbox,
  composeStatementReadyPayload,
  latestClosedMonthPeriod,
  issuanceGraceElapsed,
  isRetryableError,
  NON_RETRYABLE_CODES,
};
