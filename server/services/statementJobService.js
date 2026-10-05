'use strict';

/**
 * statementJobService — durable job infrastructure for statement operations.
 *
 * Coordinates automatic monthly issuance, archive publication, and background
 * exports. Jobs are scope-preserving snapshots of existing ledgers only:
 * statements never initiate money movement, scopes never mix
 * (product/tenant/account/currency), and issued originals stay append-only.
 *
 * Concurrency model (DB-native, no external lock service):
 * - claimNextAccountJob atomically leases one job with SELECT FOR UPDATE
 *   SKIP LOCKED; two workers can never hold the same job.
 * - Every claim bumps fencing_token; renewLease/completeJobStage/failJob
 *   only succeed when the worker presents the current lease_owner AND
 *   fencing_token, so a stale worker can never mutate a reclaimed job.
 * - Jobs stranded in intermediate pipeline states (snapshotted/artifact_ready/
 *   notified) past their lease are reclaimed back to 'leased'; the issuance
 *   pipeline re-drives idempotently, so no duplicate evidence is produced.
 * - Retries use bounded exponential backoff (base 60s, cap 6h, jitter);
 *   jobs that exhaust max_attempts move to dead_letter for operator review.
 */

const crypto = require('crypto');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

const PRODUCTS = ['oxsteed', 'restaurant', 'restaurant_settlement', 'helper_earnings', 'business'];
// Products whose account scope is a UUID (helper user id) rather than a
// BIGINT (wallet/restaurant/business id).
const UUID_SCOPED_PRODUCTS = new Set(['helper_earnings']);
const RUN_CLAIMABLE_STATES = ['discovering', 'running'];
const BACKOFF_BASE_MS = 60 * 1000;
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_RE = /^[A-Z]{3}$/;

// Intermediate pipeline states whose worker died: the lease still expires on
// the wall clock (completeJobStage only clears it at 'complete'), so a job
// stranded in 'snapshotted'/'artifact_ready'/'notified' past its lease is
// safe to reclaim. The issuance pipeline re-drives idempotently (frozen
// snapshots, verified artifacts, and document inserts all converge), so a
// reclaimed job resumes without duplicating evidence.

// Forward-only stage progression for a leased job.
const ALLOWED_TRANSITIONS = {
  leased: ['snapshotted'],
  snapshotted: ['artifact_ready'],
  artifact_ready: ['notified'],
  notified: ['complete'],
};
const PATCHABLE_JOB_FIELDS = ['last_error'];

function fail(code, message, statusCode = 400) {
  throw new AppError(message, statusCode, code);
}

function checkDate(value, name) {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    fail('statement_job_invalid_period', `Invalid ${name}; expected YYYY-MM-DD`, 400);
  }
  return value;
}

function checkProduct(product) {
  if (!PRODUCTS.includes(product)) fail('statement_job_invalid_product', 'Unknown statement product', 400);
  return product;
}

/** Bounded exponential backoff with equal jitter. Pure and unit-testable. */
function computeBackoffMs(attemptCount) {
  const grown = BACKOFF_BASE_MS * 2 ** Math.max(0, Number(attemptCount) - 1);
  const bounded = Math.min(BACKOFF_CAP_MS, grown);
  return Math.floor(bounded / 2 + Math.random() * (bounded / 2));
}

function issuanceKeyFor({ product, accountId, currencyCode, periodFrom, periodTo, customerId }) {
  return `stmt:v1:${product}:${accountId}:${currencyCode}:${periodFrom}:${periodTo}:${customerId}`;
}

async function createRun({ product, periodFrom, periodTo }) {
  checkProduct(product);
  const from = checkDate(periodFrom, 'periodFrom');
  const to = checkDate(periodTo, 'periodTo');
  if (to < from) fail('statement_job_invalid_period', 'periodTo must be on or after periodFrom', 400);
  const { rows } = await pool.query(
    `INSERT INTO statement_issuance_runs (id, product, period_from, period_to, state)
     VALUES ($1, $2, $3, $4, 'discovering') RETURNING *`,
    [crypto.randomUUID(), product, from, to]
  );
  return rows[0];
}

async function discoverAccountJobs(runId, accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    fail('statement_job_invalid_accounts', 'accounts must be a non-empty array', 400);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [run] } = await client.query(
      'SELECT * FROM statement_issuance_runs WHERE id = $1 FOR UPDATE', [runId]);
    if (!run) fail('statement_job_run_not_found', 'Statement issuance run not found', 404);
    const seen = new Set();
    const tuples = [];
    for (const account of accounts) {
      const customerId = String(account.customerId || '');
      const product = account.product ? checkProduct(account.product) : run.product;
      if (product !== run.product) {
        fail('statement_job_scope_mismatch', 'Job product must match the run product', 400);
      }
      if (!UUID_RE.test(customerId)) fail('statement_job_invalid_accounts', 'customerId must be a UUID', 400);
      // Exactly one account scope shape: BIGINT accountId (wallets,
      // restaurants, businesses) or UUID accountUuid (helper users). The
      // shape must match the product's scope kind so scopes never mix.
      const rawAccountId = account.accountId === undefined || account.accountId === null
        ? null : String(account.accountId);
      const rawAccountUuid = account.accountUuid === undefined || account.accountUuid === null
        ? null : String(account.accountUuid).toLowerCase();
      const uuidScoped = UUID_SCOPED_PRODUCTS.has(product);
      if (uuidScoped && (!rawAccountUuid || !UUID_RE.test(rawAccountUuid))) {
        fail('statement_job_invalid_accounts', 'accountUuid must be a UUID for this product', 400);
      }
      if (!uuidScoped && !/^[1-9]\d*$/.test(String(rawAccountId || ''))) {
        fail('statement_job_invalid_accounts', 'accountId must be a positive integer', 400);
      }
      if (rawAccountId !== null && rawAccountUuid !== null) {
        fail('statement_job_invalid_accounts', 'exactly one of accountId/accountUuid must be set', 400);
      }
      const scopeId = uuidScoped ? rawAccountUuid : rawAccountId;
      const currencyCode = String(account.currencyCode || '').toUpperCase();
      if (!CURRENCY_RE.test(currencyCode)) {
        fail('statement_job_invalid_accounts', 'currencyCode must be a 3-letter ISO code', 400);
      }
      const maxAttempts = account.maxAttempts === undefined ? 8
        : Math.trunc(Number(account.maxAttempts));
      if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 32) {
        fail('statement_job_invalid_accounts', 'maxAttempts must be an integer between 1 and 32', 400);
      }
      const key = issuanceKeyFor({
        product,
        accountId: scopeId,
        currencyCode,
        periodFrom: run.period_from instanceof Date
          ? run.period_from.toISOString().slice(0, 10) : String(run.period_from),
        periodTo: run.period_to instanceof Date
          ? run.period_to.toISOString().slice(0, 10) : String(run.period_to),
        customerId,
      });
      if (seen.has(key)) continue; // dedupe within the batch itself
      seen.add(key);
      tuples.push([crypto.randomUUID(), runId, customerId, product,
        uuidScoped ? null : scopeId, uuidScoped ? scopeId : null, currencyCode, key, maxAttempts]);
    }
    let inserted = 0;
    if (tuples.length > 0) {
      const values = [];
      const params = [];
      tuples.forEach((tuple, index) => {
        const base = index * tuple.length;
        values.push(`(${tuple.map((_, j) => `$${base + j + 1}`).join(', ')})`);
        params.push(...tuple);
      });
      const result = await client.query(
        `INSERT INTO statement_account_jobs
           (id, run_id, customer_id, product, account_id, account_uuid, currency_code, issuance_key, max_attempts)
         VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`, params);
      inserted = result.rowCount;
      await client.query(
        `UPDATE statement_issuance_runs
         SET discovered_count = discovered_count + $2, updated_at = transaction_timestamp()
         WHERE id = $1`, [runId, inserted]);
    }
    await client.query('COMMIT');
    return inserted;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Atomically lease the next claimable job. Exactly one worker wins per job:
 * the candidate row is locked with FOR UPDATE SKIP LOCKED inside the UPDATE.
 * Eligible: pending jobs, expired leases, and failed jobs whose backoff has
 * elapsed (attempt budget remaining). Runs that are paused/complete/failed
 * yield nothing. Expired leases whose attempt budget is exhausted are moved
 * to dead_letter instead of being re-leased.
 */
async function claimNextAccountJob(workerId, leaseSeconds = 120) {
  if (!workerId || typeof workerId !== 'string') {
    fail('statement_job_invalid_worker', 'workerId is required', 400);
  }
  const lease = Math.trunc(Number(leaseSeconds));
  if (!Number.isSafeInteger(lease) || lease < 5 || lease > 3600) {
    fail('statement_job_invalid_worker', 'leaseSeconds must be between 5 and 3600', 400);
  }
  const { rows } = await pool.query(
    `WITH candidate AS (
       SELECT id, state AS prior_state,
              (state = 'leased' AND attempt_count >= max_attempts) AS exhausted,
              (state IN ('snapshotted', 'artifact_ready', 'notified')) AS reclaimed
       FROM statement_account_jobs
       WHERE run_id IN (SELECT id FROM statement_issuance_runs WHERE state = ANY($3))
         AND (state = 'pending'
           OR (state = 'leased' AND lease_expires_at < transaction_timestamp())
           OR (state IN ('snapshotted', 'artifact_ready', 'notified')
               AND lease_expires_at < transaction_timestamp())
           OR (state = 'failed' AND next_retry_at <= transaction_timestamp()
               AND attempt_count < max_attempts))
       ORDER BY created_at, id
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE statement_account_jobs AS job
     SET state = CASE WHEN candidate.exhausted THEN 'dead_letter' ELSE 'leased' END,
         lease_owner = CASE WHEN candidate.exhausted THEN job.lease_owner ELSE $1 END,
         lease_expires_at = CASE WHEN candidate.exhausted THEN job.lease_expires_at
                                 ELSE transaction_timestamp() + ($2 * interval '1 second') END,
         fencing_token = job.fencing_token + 1,
         attempt_count = job.attempt_count + 1,
         last_error = CASE WHEN candidate.exhausted
                           THEN 'Attempt budget exhausted while the lease was expired'
                           WHEN candidate.reclaimed
                           THEN 'Reclaimed after worker loss in state ' || candidate.prior_state
                           ELSE NULL END,
         updated_at = transaction_timestamp()
     FROM candidate
     WHERE job.id = candidate.id
     RETURNING job.*`,
    [workerId, lease, RUN_CLAIMABLE_STATES]
  );
  const job = rows[0] || null;
  if (job && job.state === 'dead_letter') {
    await pool.query(
      `UPDATE statement_issuance_runs
       SET failed_count = failed_count + 1, updated_at = transaction_timestamp()
       WHERE id = $1`, [job.run_id]);
  }
  return job;
}

async function loadJobForUpdate(client, jobId) {
  const { rows: [job] } = await client.query(
    'SELECT * FROM statement_account_jobs WHERE id = $1 FOR UPDATE', [jobId]);
  if (!job) fail('statement_job_not_found', 'Statement account job not found', 404);
  return job;
}

function checkFencing(job, workerId, fencingToken) {
  if (job.lease_owner !== workerId || String(job.fencing_token) !== String(fencingToken)) {
    fail('statement_lease_stale',
      'Lease is stale: the job was reclaimed by another worker or the token is outdated', 409);
  }
}

/** Extend an active lease; succeeds only for the current fencing token holder. */
async function renewLease(jobId, workerId, fencingToken, leaseSeconds = 120) {
  const lease = Math.trunc(Number(leaseSeconds));
  if (!Number.isSafeInteger(lease) || lease < 5 || lease > 3600) {
    fail('statement_job_invalid_worker', 'leaseSeconds must be between 5 and 3600', 400);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = await loadJobForUpdate(client, jobId);
    if (job.state !== 'leased') fail('statement_lease_stale', 'Job is not leased', 409);
    checkFencing(job, workerId, fencingToken);
    const { rows: [updated] } = await client.query(
      `UPDATE statement_account_jobs
       SET lease_expires_at = transaction_timestamp() + ($2 * interval '1 second'),
           updated_at = transaction_timestamp()
       WHERE id = $1 RETURNING *`,
      [jobId, lease]
    );
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Advance a leased job one stage forward; fencing-checked, transitions validated. */
async function completeJobStage(jobId, workerId, fencingToken, toState, patch = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = await loadJobForUpdate(client, jobId);
    checkFencing(job, workerId, fencingToken);
    const allowed = ALLOWED_TRANSITIONS[job.state] || [];
    if (!allowed.includes(toState)) {
      fail('statement_job_invalid_transition',
        `Cannot move job from ${job.state} to ${toState}`, 409);
    }
    const patchFields = {};
    for (const field of PATCHABLE_JOB_FIELDS) {
      if (patch[field] !== undefined) patchFields[field] = String(patch[field]).slice(0, 2000);
    }
    const { rows: [updated] } = await client.query(
      `UPDATE statement_account_jobs
       SET state = $2,
           last_error = COALESCE($3::text, last_error),
           lease_owner = CASE WHEN $4 THEN NULL::varchar ELSE lease_owner END,
           lease_expires_at = CASE WHEN $4 THEN NULL::timestamptz ELSE lease_expires_at END,
           updated_at = transaction_timestamp()
       WHERE id = $1 RETURNING *`,
      [jobId, toState, patchFields.last_error || null, toState === 'complete']
    );
    if (toState === 'complete') {
      await client.query(
        `UPDATE statement_issuance_runs
         SET issued_count = issued_count + 1, updated_at = transaction_timestamp()
         WHERE id = $1`, [job.run_id]);
    }
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Record a job failure with bounded exponential backoff. Non-retryable errors
 * or an exhausted attempt budget move the job to dead_letter for operators.
 */
async function failJob(jobId, workerId, fencingToken, error, retryable = true) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = await loadJobForUpdate(client, jobId);
    checkFencing(job, workerId, fencingToken);
    if (['complete', 'dead_letter'].includes(job.state)) {
      fail('statement_job_invalid_transition', `Job is already ${job.state}`, 409);
    }
    const exhausted = !retryable || job.attempt_count >= job.max_attempts;
    const toState = exhausted ? 'dead_letter' : 'failed';
    const nextRetryAt = exhausted
      ? null
      : new Date(Date.now() + computeBackoffMs(job.attempt_count)).toISOString();
    const { rows: [updated] } = await client.query(
      `UPDATE statement_account_jobs
       SET state = $2,
           last_error = $3,
           next_retry_at = $4,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = transaction_timestamp()
       WHERE id = $1 RETURNING *`,
      [jobId, toState, String(error || 'unknown error').slice(0, 2000), nextRetryAt]
    );
    await client.query(
      `UPDATE statement_issuance_runs
       SET failed_count = failed_count + 1, updated_at = transaction_timestamp()
       WHERE id = $1`, [job.run_id]);
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function pauseRun(runId) {
  const { rows: [run] } = await pool.query(
    `UPDATE statement_issuance_runs
     SET state = 'paused', updated_at = transaction_timestamp()
     WHERE id = $1 AND state = ANY($2) RETURNING *`,
    [runId, ['discovering', 'running']]
  );
  if (!run) fail('statement_run_state', 'Run not found or not pausable', 409);
  return run;
}

async function resumeRun(runId) {
  const { rows: [run] } = await pool.query(
    `UPDATE statement_issuance_runs
     SET state = 'running', updated_at = transaction_timestamp()
     WHERE id = $1 AND state = 'paused' RETURNING *`,
    [runId]
  );
  if (!run) fail('statement_run_state', 'Run not found or not paused', 409);
  return run;
}

/**
 * Append a domain event to the outbox inside the caller's transaction.
 * Takes a pg client (not the pool) so the event commits atomically with
 * the business write. aggregate_id must not carry PII.
 */
async function outboxAppend(clientOrPool, { eventType, aggregateType, aggregateId, payload }) {
  if (!eventType || typeof eventType !== 'string' || eventType.length > 80) {
    fail('statement_outbox_invalid', 'eventType is required (max 80 chars)', 400);
  }
  if (!aggregateType || typeof aggregateType !== 'string' || aggregateType.length > 40) {
    fail('statement_outbox_invalid', 'aggregateType is required (max 40 chars)', 400);
  }
  if (!aggregateId || typeof aggregateId !== 'string' || aggregateId.length > 200) {
    fail('statement_outbox_invalid', 'aggregateId is required (max 200 chars)', 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('statement_outbox_invalid', 'payload must be a JSON object', 400);
  }
  const { rows: [event] } = await clientOrPool.query(
    `INSERT INTO statement_outbox (id, event_type, aggregate_type, aggregate_id, payload)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [crypto.randomUUID(), eventType, aggregateType, aggregateId, JSON.stringify(payload)]
  );
  return event;
}

/** Atomically claim up to `limit` unprocessed outbox events, oldest first. */
async function claimOutboxEvents(limit = 50, workerId) {
  const count = Math.trunc(Number(limit));
  if (!Number.isSafeInteger(count) || count < 1 || count > 500) {
    fail('statement_outbox_invalid', 'limit must be between 1 and 500', 400);
  }
  const { rows } = await pool.query(
    `WITH candidate AS (
       SELECT id FROM statement_outbox
       WHERE processed_at IS NULL AND claimed_at IS NULL
       ORDER BY created_at, id
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE statement_outbox AS event
     SET claimed_at = transaction_timestamp(),
         claimed_by = $2,
         attempt_count = event.attempt_count + 1
     FROM candidate
     WHERE event.id = candidate.id
     RETURNING event.*`,
    [count, workerId || null]
  );
  return rows;
}

async function markOutboxProcessed(eventId) {
  const { rows: [event] } = await pool.query(
    `UPDATE statement_outbox
     SET processed_at = transaction_timestamp()
     WHERE id = $1 AND processed_at IS NULL RETURNING *`,
    [eventId]
  );
  if (!event) fail('statement_outbox_not_found', 'Outbox event not found or already processed', 404);
  return event;
}

/** Release a failed event back to the unclaimed pool for redelivery. */
async function outboxFailed(eventId) {
  const { rows: [event] } = await pool.query(
    `UPDATE statement_outbox
     SET claimed_at = NULL, claimed_by = NULL
     WHERE id = $1 AND processed_at IS NULL RETURNING *`,
    [eventId]
  );
  if (!event) fail('statement_outbox_not_found', 'Outbox event not found or already processed', 404);
  return event;
}

async function getRunStats(runId) {
  const { rows: [stats] } = await pool.query(
    `SELECT COUNT(*)::int AS expected,
            COUNT(*) FILTER (WHERE state = 'complete')::int AS issued,
            COUNT(*) FILTER (WHERE state = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE state = 'dead_letter')::int AS "deadLetter",
            COALESCE(EXTRACT(EPOCH FROM
              (transaction_timestamp() - MIN(created_at) FILTER (WHERE state IN ('pending', 'failed')))
            )::int, 0) AS "oldestQueueAgeSec",
            COUNT(*) FILTER (WHERE state = 'leased'
              AND lease_expires_at > transaction_timestamp())::int AS "activeLeases"
     FROM statement_account_jobs WHERE run_id = $1`,
    [runId]
  );
  return stats || {
    expected: 0, issued: 0, failed: 0, deadLetter: 0, oldestQueueAgeSec: 0, activeLeases: 0,
  };
}

module.exports = {
  createRun,
  discoverAccountJobs,
  claimNextAccountJob,
  renewLease,
  completeJobStage,
  failJob,
  pauseRun,
  resumeRun,
  outboxAppend,
  claimOutboxEvents,
  markOutboxProcessed,
  outboxFailed,
  getRunStats,
  computeBackoffMs,
  issuanceKeyFor,
  UUID_SCOPED_PRODUCTS,
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
};
