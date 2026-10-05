'use strict';

/**
 * statementAdmin — self-contained Express router for statement operations.
 *
 * Mounting (reported, not done here): server/index.js
 *   const statementAdminRoutes = require('./routes/statementAdmin');
 *   app.use('/api/admin/statements', statementAdminRoutes);
 *
 * Grant model (narrowest fit per endpoint, least privilege):
 *   view_financials   — all reads: runs, run detail, failures, amendments
 *                        queue, alerts, audit viewer.
 *   manage_operations — run pause/resume, safe job retry, artifact reconcile,
 *                        amendment proposal creation. (Never manage_financials:
 *                        these controls cannot move money, replay
 *                        captures/payouts, or bypass reconciliation; issuing
 *                        manage_financials here would grant journal/treasury
 *                        powers the job does not need.)
 *   manage_financials — amendment approve/reject and approved-amendment
 *                        retry-publish only. This is the existing financial
 *                        approval grant, used here purely as an approval tier
 *                        for statement corrections; the endpoints decide a
 *                        proposal or complete its publication, they never move
 *                        money.
 *
 * Non-negotiables enforced here:
 *  - Admin controls can never delete issued evidence (credit_statement_documents
 *    carries an immutability trigger), bypass reconciliation, or replay
 *    financial captures/payouts. Retry only re-queues a failed/dead_letter job.
 *  - Scopes never mix: every list/detail query is filtered to the statement
 *    scope (product/account/currency) by construction.
 *  - Money amounts are integer minor units everywhere (BIGINT).
 *  - Audit events record actor/action/target/UTC time/outcome/reason/
 *    correlation via the existing admin_audit_log chain (logAdminAction,
 *    transactional and fail-closed). Document bodies and signed links are
 *    never written to audit rows, lists, logs, or error responses.
 */

const crypto = require('crypto');
const { Readable } = require('stream');
const router = require('express').Router();
const pool = require('../db');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { parsePagination } = require('../utils/boundedPagination');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const statementJobService = require('../services/statementJobService');
const statementAmendmentService = require('../services/statementAmendmentService');
const { logAdminAction } = require('../services/auditService');
const { logSecurityEvent, extractRequestDetails } = require('../services/auditLoggerService');
const storage = require('../utils/storage');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCTS = ['oxsteed', 'restaurant'];
const CURRENCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FAILURE_TYPES = ['generation', 'storage', 'reconciliation', 'notification'];

// ── Alert thresholds (documented, served in the /ops/alerts meta) ──────────
const ALERT_THRESHOLDS = Object.freeze({
  agedQueueHours: 6,
  staleLeaseCount: 1,
  deliveryBacklogAttempts: 5,
  reconciliationLookbackHours: 24,
  reconcileBatchDefault: 50,
  reconcileBatchMax: 200,
});

const RUN_LIST_DEFINITIONS = Object.freeze({
  expected: 'Jobs discovered for this issuance run (per-account work items).',
  issued: 'Jobs completed end-to-end: snapshot, artifact published, notified.',
  failed: 'Jobs currently failed or parked in dead_letter awaiting operators.',
  oldestQueueAgeSec: 'Age in seconds of the oldest job still waiting (pending or failed).',
  activeLeases: 'Jobs currently held by a worker under a live lease.',
  staleLeases: 'Jobs leased past their lease expiry; eligible for reclaim by another worker.',
});

function fail(code, message, statusCode = 400) {
  throw new AppError(message, statusCode, code);
}

function checkUuid(value, name) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    fail('statement_admin_invalid_id', `Invalid ${name}; expected a UUID`, 400);
  }
  return value;
}

function checkProduct(value) {
  if (value == null) return null;
  if (!PRODUCTS.includes(value)) fail('statement_admin_invalid_filter', 'Unknown product filter', 400);
  return value;
}

function checkCurrency(value) {
  if (value == null) return null;
  const code = String(value).toUpperCase();
  if (!CURRENCY_RE.test(code)) fail('statement_admin_invalid_filter', 'Invalid currency filter', 400);
  return code;
}

function checkDate(value, name) {
  if (value == null) return null;
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    fail('statement_admin_invalid_filter', `Invalid ${name}; expected YYYY-MM-DD`, 400);
  }
  return value;
}

function asOfMeta(extra = {}) {
  return {
    asOf: new Date().toISOString(),
    ...extra,
  };
}

/**
 * Recommended operator action for a failed job, derived server-side from the
 * job state and last error so clients never invent remediation steps.
 */
function recommendedAction(job) {
  if (job.state === 'dead_letter') return 'operator_review';
  const err = String(job.last_error || '').toLowerCase();
  if (err.includes('storage') || err.includes('bucket') || err.includes('object')) return 'check_storage_config';
  if (err.includes('lease') || err.includes('fencing')) return 'check_worker_health';
  if (job.next_retry_at && new Date(job.next_retry_at).getTime() < Date.now()) return 'awaiting_retry';
  return 'retry_when_ready';
}

function shapeJobFailure(row) {
  return {
    jobId: row.id,
    accountId: Number(row.account_id),
    product: row.product,
    currencyCode: row.currency_code,
    state: row.state,
    attempts: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    leaseOwner: row.lease_owner || null,
    correlationId: row.issuance_key,
    lastError: row.last_error || null,
    nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    recommendedAction: recommendedAction(row),
  };
}

async function auditStatement(req, { action, targetType, targetId, targetKey, reason, outcome, correlationId }) {
  const { ipAddress, userAgent } = extractRequestDetails(req);
  const description = reason ? String(reason).slice(0, 2000) : null;
  await logAdminAction({
    adminId: req.user.id,
    action,
    targetType,
    targetId: targetId || null,
    targetKey: targetKey || null,
    description,
    after: {
      outcome: outcome || 'success',
      reason: reason ? String(reason).slice(0, 500) : null,
      correlationId: correlationId || null,
      idempotencyKey: req.get('Idempotency-Key') || null,
    },
    req,
    throwOnError: true,
  });
  await logSecurityEvent(action, {
    userId: req.user.id,
    resourceType: targetType,
    resourceId: targetKey || targetId,
    details: { outcome: outcome || 'success', correlationId: correlationId || null },
    ipAddress,
    userAgent,
    status: outcome === 'denied' ? 'denied' : (outcome === 'failure' ? 'failure' : 'success'),
  });
}

// ───────────────────────────────────────────────────────────────────────────
// GET /ops/runs — bounded paginated issuance runs with queue health.
// ───────────────────────────────────────────────────────────────────────────
router.get('/ops/runs', requireAdmin, requirePermission('view_financials'), async (req, res, next) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const product = checkProduct(req.query.product || null);
    const state = req.query.state ? String(req.query.state) : null;
    const conditions = [];
    const values = [];
    let p = 1;
    if (product) { conditions.push(`r.product = $${p++}`); values.push(product); }
    if (state) { conditions.push(`r.state = $${p++}`); values.push(state); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `WITH job_health AS (
         SELECT run_id,
                COUNT(*) FILTER (WHERE state = 'leased' AND lease_expires_at > transaction_timestamp())::int AS active_leases,
                COUNT(*) FILTER (WHERE state = 'leased' AND lease_expires_at <= transaction_timestamp())::int AS stale_leases,
                COALESCE(EXTRACT(EPOCH FROM (
                  transaction_timestamp() - MIN(created_at) FILTER (WHERE state IN ('pending', 'failed'))
                ))::int, 0) AS oldest_queue_age_sec
         FROM statement_account_jobs
         GROUP BY run_id
       )
       SELECT r.id, r.product, r.period_from, r.period_to, r.state,
              r.discovered_count, r.issued_count, r.failed_count,
              COALESCE(h.active_leases, 0) AS active_leases,
              COALESCE(h.stale_leases, 0) AS stale_leases,
              COALESCE(h.oldest_queue_age_sec, 0) AS oldest_queue_age_sec,
              r.created_at, r.updated_at, r.completed_at
       FROM statement_issuance_runs r
       LEFT JOIN job_health h ON h.run_id = r.id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${p++} OFFSET $${p++}`,
      [...values, limit, offset]
    );
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM statement_issuance_runs r ${where}`, values);

    res.json({
      items: rows.map((r) => ({
        runId: r.id,
        product: r.product,
        period: {
          from: r.period_from instanceof Date ? r.period_from.toISOString().slice(0, 10) : String(r.period_from),
          to: r.period_to instanceof Date ? r.period_to.toISOString().slice(0, 10) : String(r.period_to),
        },
        state: r.state,
        expected: Number(r.discovered_count),
        issued: Number(r.issued_count),
        failed: Number(r.failed_count),
        activeLeases: Number(r.active_leases),
        staleLeases: Number(r.stale_leases),
        oldestQueueAgeSec: Number(r.oldest_queue_age_sec),
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
        completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
      })),
      total: countRes.rows[0]?.total || 0,
      meta: asOfMeta({
        definitions: RUN_LIST_DEFINITIONS,
        note: 'Counts are counters on the run row plus live per-state job aggregates. issued is never inferred from artifacts alone.',
        sourceTimestamps: { runsReadAt: new Date().toISOString() },
      }),
    });
  } catch (error) {
    next(error);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// GET /ops/runs/:id — run detail with per-state counts and failures.
// ───────────────────────────────────────────────────────────────────────────
router.get('/ops/runs/:id', requireAdmin, requirePermission('view_financials'), async (req, res, next) => {
  try {
    const runId = checkUuid(req.params.id, 'run id');
    const { rows: [run] } = await pool.query(
      'SELECT * FROM statement_issuance_runs WHERE id = $1', [runId]);
    if (!run) fail('statement_run_not_found', 'Statement issuance run not found', 404);

    const { rows: stateCounts } = await pool.query(
      `SELECT state, COUNT(*)::int AS count FROM statement_account_jobs
       WHERE run_id = $1 GROUP BY state ORDER BY state`, [runId]);
    const stats = await statementJobService.getRunStats(runId);
    const { rows: failures } = await pool.query(
      `SELECT id, account_id, product, currency_code, state, attempt_count,
              max_attempts, lease_owner, issuance_key, last_error,
              next_retry_at, created_at, updated_at
       FROM statement_account_jobs
       WHERE run_id = $1 AND state IN ('failed', 'dead_letter')
       ORDER BY updated_at DESC LIMIT 200`, [runId]);

    res.json({
      run: {
        runId: run.id,
        product: run.product,
        period: {
          from: run.period_from instanceof Date ? run.period_from.toISOString().slice(0, 10) : String(run.period_from),
          to: run.period_to instanceof Date ? run.period_to.toISOString().slice(0, 10) : String(run.period_to),
        },
        state: run.state,
        createdAt: new Date(run.created_at).toISOString(),
        updatedAt: new Date(run.updated_at).toISOString(),
        completedAt: run.completed_at ? new Date(run.completed_at).toISOString() : null,
      },
      stateCounts: stateCounts.reduce((acc, row) => ({ ...acc, [row.state]: row.count }), {}),
      stats: {
        expected: stats.expected,
        issued: stats.issued,
        failed: stats.failed,
        deadLetter: stats.deadLetter,
        oldestQueueAgeSec: stats.oldestQueueAgeSec,
        activeLeases: stats.activeLeases,
      },
      failures: failures.map(shapeJobFailure),
      meta: asOfMeta({ definitions: RUN_LIST_DEFINITIONS }),
    });
  } catch (error) {
    next(error);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /ops/runs/:id/pause and /resume — operator controls (idempotent-ish:
// state-gated, so a replayed request is a safe no-op or a 409).
// ───────────────────────────────────────────────────────────────────────────
router.post('/ops/runs/:id/pause', requireAdmin, requirePermission('manage_operations'), async (req, res, next) => {
  try {
    const runId = checkUuid(req.params.id, 'run id');
    const reason = req.body && typeof req.body.reason === 'string' ? req.body.reason.slice(0, 500) : null;
    if (!reason) fail('statement_admin_reason_required', 'A reason is required to pause an issuance run', 400);
    const run = await statementJobService.pauseRun(runId);
    await auditStatement(req, {
      action: 'statement.run.pause', targetType: 'statement_run', targetId: runId,
      targetKey: runId, reason, outcome: 'success', correlationId: runId,
    });
    res.json({ runId: run.id, state: run.state, updatedAt: new Date(run.updated_at).toISOString() });
  } catch (error) {
    next(error);
  }
});

router.post('/ops/runs/:id/resume', requireAdmin, requirePermission('manage_operations'), async (req, res, next) => {
  try {
    const runId = checkUuid(req.params.id, 'run id');
    const reason = req.body && typeof req.body.reason === 'string' ? req.body.reason.slice(0, 500) : null;
    if (!reason) fail('statement_admin_reason_required', 'A reason is required to resume an issuance run', 400);
    const run = await statementJobService.resumeRun(runId);
    await auditStatement(req, {
      action: 'statement.run.resume', targetType: 'statement_run', targetId: runId,
      targetKey: runId, reason, outcome: 'success', correlationId: runId,
    });
    res.json({ runId: run.id, state: run.state, updatedAt: new Date(run.updated_at).toISOString() });
  } catch (error) {
    next(error);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /ops/jobs/:id/retry — safe re-queue. Re-queues a failed/dead_letter
// job WITHOUT touching issued evidence: no document is created, modified, or
// deleted here; the worker pipeline re-runs the normal idempotent stages.
// ───────────────────────────────────────────────────────────────────────────
router.post('/ops/jobs/:id/retry', requireAdmin, requirePermission('manage_operations'), async (req, res, next) => {
  try {
    const jobId = checkUuid(req.params.id, 'job id');
    const reason = req.body && typeof req.body.reason === 'string' ? req.body.reason.slice(0, 500) : null;
    if (!reason) fail('statement_admin_reason_required', 'A reason is required to retry a statement job', 400);

    const client = await pool.connect();
    let job;
    try {
      await client.query('BEGIN');
      const { rows: [current] } = await client.query(
        'SELECT * FROM statement_account_jobs WHERE id = $1 FOR UPDATE', [jobId]);
      if (!current) fail('statement_job_not_found', 'Statement account job not found', 404);
      if (!['failed', 'dead_letter'].includes(current.state)) {
        fail('statement_job_not_retryable',
          `Job is ${current.state}; only failed or dead_letter jobs can be re-queued`, 409);
      }
      // Re-queue only: the lease is cleared, the error history is preserved in
      // last_error, and issued documents (credit_statement_documents) are never
      // written by this path. Attempt budget is NOT reset: a job that already
      // exhausted its budget must be re-proposed, not silently resurrected.
      const { rows: [updated] } = await client.query(
        `UPDATE statement_account_jobs
         SET state = 'pending',
             lease_owner = NULL,
             lease_expires_at = NULL,
             next_retry_at = NULL,
             updated_at = transaction_timestamp()
         WHERE id = $1 RETURNING *`, [jobId]);
      job = updated;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await auditStatement(req, {
      action: 'statement.job.retry', targetType: 'statement_job', targetId: jobId,
      targetKey: job.issuance_key, reason, outcome: 'success', correlationId: job.run_id,
    });
    res.json({
      jobId: job.id, state: job.state, runId: job.run_id,
      correlationId: job.issuance_key,
      updatedAt: new Date(job.updated_at).toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /ops/artifacts/reconcile — re-verify artifact checksums against object
// storage. Read-only w.r.t. evidence: it records a verification attempt per
// artifact and reports missing/corrupt/unverifiable, but never marks an
// artifact ready and never rewrites bytes.
// ───────────────────────────────────────────────────────────────────────────
async function readBackAndHash(key, expectedLength) {
  let stream = null;
  try {
    stream = await storage.getObjectStream(key);
  } catch (error) {
    logger.warn('statement admin reconcile read-back failed', { error: error.message });
    return null;
  }
  if (!stream) return null;
  const readable = stream instanceof Readable ? stream : Readable.from(stream);
  const hash = crypto.createHash('sha256');
  let length = 0;
  for await (const chunk of readable) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > expectedLength + 1024 * 1024) {
      fail('statement_artifact_verification_failed', 'Stored object exceeds the recorded length', 502);
    }
    hash.update(buffer);
  }
  return { bytes: length, hash: hash.digest('hex') };
}

router.post('/ops/artifacts/reconcile', requireAdmin, requirePermission('manage_operations'), async (req, res, next) => {
  try {
    const bucket = String(process.env.STATEMENT_ARTIFACT_BUCKET || '').trim();
    if (!bucket) {
      fail('statement_storage_unconfigured',
        'Statement artifact storage is not configured; reconcile refuses to run without a namespace', 503);
    }
    const limitRaw = req.body && req.body.limit !== undefined ? req.body.limit : ALERT_THRESHOLDS.reconcileBatchDefault;
    const limit = Math.max(1, Math.min(ALERT_THRESHOLDS.reconcileBatchMax, Math.trunc(Number(limitRaw)) || ALERT_THRESHOLDS.reconcileBatchDefault));
    const { rows: artifacts } = await pool.query(
      `SELECT id, object_key, byte_length, sha256, state
       FROM statement_artifacts
       WHERE state = 'ready'
       ORDER BY created_at ASC
       LIMIT $1`, [limit]);

    const results = [];
    let ok = 0; let missing = 0; let corrupt = 0;
    const client = await pool.connect();
    try {
      for (const artifact of artifacts) {
        const readBack = await readBackAndHash(artifact.object_key, Number(artifact.byte_length));
        let status;
        if (!readBack) { status = 'missing'; missing += 1; }
        else if (readBack.bytes !== Number(artifact.byte_length) || readBack.hash !== artifact.sha256) {
          status = 'corrupt'; corrupt += 1;
        } else { status = 'ok'; ok += 1; }
        const { rows: [seq] } = await client.query(
          `SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt
           FROM statement_publication_attempts WHERE artifact_id = $1`, [artifact.id]);
        const attempt = Number(seq && seq.attempt) || 1;
        await client.query(
          `INSERT INTO statement_publication_attempts
             (id, artifact_id, attempt, outcome, verified_bytes, verified_hash, error, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, transaction_timestamp())`,
          [crypto.randomUUID(), artifact.id, attempt,
            `reconciled_${status}`,
            readBack ? String(readBack.bytes) : null,
            readBack ? readBack.hash : null,
            status === 'ok' ? null : `Reconcile found artifact ${status}`,
          ]);
        results.push({
          artifactId: artifact.id,
          objectKey: artifact.object_key,
          status,
          recordedBytes: Number(artifact.byte_length),
          verifiedBytes: readBack ? readBack.bytes : null,
          hashMatches: readBack ? readBack.hash === artifact.sha256 : null,
        });
      }
    } finally {
      client.release();
    }

    await auditStatement(req, {
      action: 'statement.artifact.reconcile', targetType: 'statement_run', targetId: null,
      targetKey: null, reason: `Reconciled ${artifacts.length} artifacts: ${ok} ok, ${missing} missing, ${corrupt} corrupt`,
      outcome: (missing > 0 || corrupt > 0) ? 'failure' : 'success', correlationId: null,
    });
    res.json({
      checked: artifacts.length, ok, missing, corrupt,
      results,
      meta: asOfMeta({ note: 'Each result records a verification attempt in statement_publication_attempts. Corrupt artifacts stay ready until an operator intervenes; reconcile never alters evidence.' }),
    });
  } catch (error) {
    next(error);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// GET /ops/failures — generation/storage/reconciliation/notification failures.
// Filters: type, product, currency. region is accepted but not applicable: the
// statement job tables carry no region dimension (issuance is global), so a
// region filter is documented as a no-op rather than silently ignored.
// ───────────────────────────────────────────────────────────────────────────
router.get('/ops/failures', requireAdmin, requirePermission('view_financials'), async (req, res, next) => {
  try {
    const type = req.query.type ? String(req.query.type) : null;
    if (type && !FAILURE_TYPES.includes(type)) {
      fail('statement_admin_invalid_filter', 'Unknown failure type', 400);
    }
    const product = checkProduct(req.query.product || null);
    const currency = checkCurrency(req.query.currency || null);
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const items = [];

    if (!type || type === 'generation') {
      const conditions = ["j.state IN ('failed', 'dead_letter')"];
      const values = [];
      let p = 1;
      if (product) { conditions.push(`j.product = $${p++}`); values.push(product); }
      if (currency) { conditions.push(`j.currency_code = $${p++}`); values.push(currency); }
      const { rows } = await pool.query(
        `SELECT j.id, j.account_id, j.product, j.currency_code, j.state,
                j.attempt_count, j.max_attempts, j.lease_owner, j.issuance_key,
                j.last_error, j.next_retry_at, j.created_at, j.updated_at, j.run_id
         FROM statement_account_jobs j
         WHERE ${conditions.join(' AND ')}
         ORDER BY j.updated_at DESC LIMIT $${p++} OFFSET $${p++}`,
        [...values, limit, offset]);
      for (const row of rows) items.push({ type: 'generation', ...shapeJobFailure(row), runId: row.run_id });
    }

    if (!type || type === 'storage') {
      const conditions = ["a.outcome IN ('failed', 'upload_failed', 'verification_failed') OR a.error IS NOT NULL"];
      const values = [];
      let p = 1;
      const { rows } = await pool.query(
        `SELECT a.id, a.artifact_id, a.attempt, a.outcome, a.error,
                a.verified_bytes, a.created_at, art.object_key, art.state AS artifact_state
         FROM statement_publication_attempts a
         JOIN statement_artifacts art ON art.id = a.artifact_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY a.created_at DESC LIMIT $${p++} OFFSET $${p++}`,
        [limit, offset]);
      for (const row of rows) {
        items.push({
          type: 'storage',
          attemptId: row.id,
          artifactId: row.artifact_id,
          objectKey: row.object_key,
          artifactState: row.artifact_state,
          attempt: Number(row.attempt),
          outcome: row.outcome,
          error: row.error || null,
          createdAt: new Date(row.created_at).toISOString(),
        });
      }
    }

    if (!type || type === 'reconciliation') {
      const { rows } = await pool.query(
        `SELECT a.id, a.artifact_id, a.attempt, a.outcome, a.error,
                a.verified_bytes, a.verified_hash, a.created_at,
                art.object_key, art.sha256 AS recorded_hash
         FROM statement_publication_attempts a
         JOIN statement_artifacts art ON art.id = a.artifact_id
         WHERE a.outcome IN ('reconciled_missing', 'reconciled_mismatch', 'reconciled_corrupt')
         ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
      for (const row of rows) {
        items.push({
          type: 'reconciliation',
          attemptId: row.id,
          artifactId: row.artifact_id,
          objectKey: row.object_key,
          outcome: row.outcome,
          error: row.error || null,
          hashMatches: row.verified_hash ? row.verified_hash === row.recorded_hash : null,
          createdAt: new Date(row.created_at).toISOString(),
        });
      }
    }

    if (!type || type === 'notification') {
      const { rows } = await pool.query(
        `SELECT id, event_type, aggregate_type, aggregate_id, created_at,
                claimed_at, attempt_count
         FROM statement_outbox
         WHERE processed_at IS NULL
           AND event_type LIKE 'notify%'
           AND created_at < transaction_timestamp() - interval '1 hour'
         ORDER BY created_at ASC LIMIT $1 OFFSET $2`, [limit, offset]);
      for (const row of rows) {
        items.push({
          type: 'notification',
          eventId: row.id,
          eventType: row.event_type,
          correlationId: row.aggregate_id,
          ageSec: Math.floor((Date.now() - new Date(row.created_at).getTime()) / 1000),
          attempts: Number(row.attempt_count),
          claimed: Boolean(row.claimed_at),
          createdAt: new Date(row.created_at).toISOString(),
        });
      }
    }

    res.json({
      items,
      meta: asOfMeta({
        regionScoping: req.query.region
          ? 'Region filter is not applicable: statement issuance is global and the job tables carry no region dimension. The filter was accepted and ignored; nothing was silently scoped.'
          : 'Not filtered by region: statement issuance is global.',
        failureTypes: FAILURE_TYPES,
      }),
    });
  } catch (error) {
    next(error);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Amendments review queue (migration 686).
//
// Coordination note: the amendments worker that PROPOSES corrections has not
// landed. The documented expected proposal shape is { id, issuance_key,
// product, account_id, currency_code, period_from, period_to, document_id,
// reason, proposed_by, proposed_at }. This endpoint serves the review side:
// list proposals awaiting decision plus maker-checker approve/reject.
// ───────────────────────────────────────────────────────────────────────────
function shapeProposal(row) {
  return {
    proposalId: row.id,
    issuanceKey: row.issuance_key,
    product: row.product,
    accountId: Number(row.account_id),
    currencyCode: row.currency_code,
    period: {
      from: row.period_from instanceof Date ? row.period_from.toISOString().slice(0, 10) : String(row.period_from),
      to: row.period_to instanceof Date ? row.period_to.toISOString().slice(0, 10) : String(row.period_to),
    },
    documentId: row.document_id || null,
    amendmentType: row.amendment_type || 'clerical',
    presentation: row.presentation || 'restated',
    reason: row.reason,
    evidenceRefs: Array.isArray(row.evidence_refs) ? row.evidence_refs : [],
    compensatingTransactionRefs: Array.isArray(row.compensating_transaction_refs)
      ? row.compensating_transaction_refs : [],
    restateForward: Boolean(row.restate_forward),
    originalDocumentHash: row.original_document_hash || null,
    baseRevisionNumber: Number(row.base_revision_number || 0),
    status: row.status,
    proposedBy: row.proposed_by,
    proposedAt: new Date(row.proposed_at).toISOString(),
    decidedBy: row.decided_by || null,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    decisionReason: row.decision_reason || null,
  };
}

router.get('/ops/amendments', requireAdmin, requirePermission('view_financials'), async (req, res, next) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const status = req.query.status ? String(req.query.status) : 'proposed';
    if (!['proposed', 'approved', 'rejected'].includes(status)) {
      fail('statement_admin_invalid_filter', 'Unknown amendment status', 400);
    }
    const { rows } = await pool.query(
      `SELECT * FROM statement_amendment_proposals
       WHERE status = $1 ORDER BY proposed_at ASC LIMIT $2 OFFSET $3`,
      [status, limit, offset]);
    const { rows: [count] } = await pool.query(
      'SELECT COUNT(*)::int AS total FROM statement_amendment_proposals WHERE status = $1', [status]);
    res.json({
      items: rows.map(shapeProposal),
      total: count.total,
      meta: asOfMeta({
        coordination: 'Amendment proposals are created by the amendments worker (not landed). This endpoint serves the review side only; approving never edits the issued original.',
      }),
    });
  } catch (error) {
    next(error);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /ops/amendments — propose a correction against an issued original
// (Phase 4, workstream 3). manage_operations proposes; manage_financials
// decides (see approve/reject below): the maker can never be the checker.
// A clerical proposal corrects presentation only and references no ledger
// transactions; an accounting proposal must reference posted compensating
// transactions, which are validated against the authoritative ledger here
// and re-validated at approval. The proposal pins the source data (original
// hash, ledger fingerprint, revision base) so approval cannot go stale.
// ───────────────────────────────────────────────────────────────────────────
router.post('/ops/amendments', requireAdmin, requirePermission('manage_operations'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const proposal = await statementAmendmentService.proposeAmendment({
      adminId: req.user.id,
      documentId: body.documentId,
      amendmentType: body.amendmentType,
      presentation: body.presentation,
      reason: body.reason,
      evidenceRefs: body.evidenceRefs,
      compensatingTransactionRefs: body.compensatingTransactionRefs,
      restateForward: body.restateForward,
    });
    await auditStatement(req, {
      action: 'statement.amendment.propose', targetType: 'statement_amendment',
      targetId: proposal.proposalId, targetKey: proposal.issuanceKey,
      reason: body.reason, outcome: 'success', correlationId: proposal.issuanceKey,
    });
    res.status(201).json({ proposal });
  } catch (error) {
    next(error);
  }
});

async function decideAmendment(req, res, next, decision) {
  try {
    const proposalId = checkUuid(req.params.id, 'proposal id');
    const decisionReason = req.body && typeof req.body.reason === 'string' ? req.body.reason.slice(0, 2000) : null;
    if (decision === 'rejected' && !decisionReason) {
      fail('statement_admin_reason_required', 'A reason is required to reject an amendment proposal', 400);
    }
    const client = await pool.connect();
    let proposal;
    try {
      await client.query('BEGIN');
      const { rows: [current] } = await client.query(
        'SELECT * FROM statement_amendment_proposals WHERE id = $1 FOR UPDATE', [proposalId]);
      if (!current) fail('statement_amendment_not_found', 'Amendment proposal not found', 404);
      if (current.status !== 'proposed') {
        fail('statement_amendment_not_pending', `Proposal is already ${current.status}`, 409);
      }
      if (current.proposed_by === req.user.id) {
        fail('statement_amendment_self_approval',
          'Maker-checker: the admin who proposed an amendment cannot approve or reject it', 403);
      }
      const { rows: [updated] } = await client.query(
        `UPDATE statement_amendment_proposals
         SET status = $2, decided_by = $3, decision_reason = $4
         WHERE id = $1 RETURNING *`,
        [proposalId, decision, req.user.id, decisionReason]);
      proposal = updated;
      await logAdminAction({
        adminId: req.user.id,
        action: `statement.amendment.${decision}`,
        targetType: 'statement_amendment',
        targetId: proposalId,
        targetKey: proposal.issuance_key,
        description: decisionReason,
        after: { outcome: 'success', reason: decisionReason, correlationId: proposal.issuance_key },
        req,
        client,
        throwOnError: true,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const { ipAddress, userAgent } = extractRequestDetails(req);
    await logSecurityEvent(`statement.amendment.${decision}`, {
      userId: req.user.id,
      resourceType: 'statement_amendment',
      resourceId: proposalId,
      details: { outcome: 'success', correlationId: proposal.issuance_key },
      ipAddress, userAgent, status: 'success',
    });
    // Phase 4 (workstream 3): an approved amendment that names an issued
    // original finalizes into a new immutable amendment version (re-derived
    // document, labeled rendition artifact, owner notification). The approval
    // above is already committed: a publication failure leaves the proposal
    // approved-but-unpublished, and the retry path
    // (POST /ops/amendments/:id/retry-publish) converges on exactly one
    // version row. Rejections never publish anything.
    let publication = { status: decision === 'approved' ? 'no_document' : 'not_applicable', version: null };
    if (decision === 'approved' && proposal.document_id) {
      try {
        const result = await statementAmendmentService.finalizeApprovedProposal(proposal.id);
        publication = { status: result.status, version: result.version || null };
      } catch (error) {
        if (error && error.statusCode === 409) {
          // Validation blocked publication (continuity, stale or changed
          // source data): the approval stands; surface the block so the
          // operator can re-propose or restate forward.
          return res.status(409).json({
            code: error.code || 'statement_amendment_publication_blocked',
            error: error.message,
            fields: error.fields || undefined,
            proposal: shapeProposal(proposal),
            publication: { status: 'blocked', version: null },
          });
        }
        if (error && (error.statusCode === 502 || error.statusCode === 503)) {
          // Storage/infra failure: approved-but-unpublished; the retry path
          // never duplicates versions.
          return res.status(202).json({
            proposal: shapeProposal(proposal),
            publication: {
              status: 'pending', version: null, retry: `/ops/amendments/${proposal.id}/retry-publish`,
            },
          });
        }
        throw error;
      }
    }
    res.json({ proposal: shapeProposal(proposal), publication });
  } catch (error) {
    next(error);
  }
}

router.post('/ops/amendments/:id/approve', requireAdmin, requirePermission('manage_financials'),
  (req, res, next) => decideAmendment(req, res, next, 'approved'));
router.post('/ops/amendments/:id/reject', requireAdmin, requirePermission('manage_financials'),
  (req, res, next) => decideAmendment(req, res, next, 'rejected'));

// ───────────────────────────────────────────────────────────────────────────
// POST /ops/amendments/:id/retry-publish — complete publication for an
// approved-but-unpublished proposal (e.g. after a storage failure).
// Idempotent on the proposal id: a proposal that already published returns
// its version instead of duplicating it.
// ───────────────────────────────────────────────────────────────────────────
router.post('/ops/amendments/:id/retry-publish', requireAdmin, requirePermission('manage_financials'),
  async (req, res, next) => {
    try {
      const proposalId = checkUuid(req.params.id, 'proposal id');
      const result = await statementAmendmentService.retryPublication(proposalId);
      await auditStatement(req, {
        action: 'statement.amendment.retry_publish', targetType: 'statement_amendment',
        targetId: proposalId, targetKey: null,
        reason: req.body && typeof req.body.reason === 'string' ? req.body.reason.slice(0, 500) : null,
        outcome: 'success', correlationId: proposalId,
      });
      res.json({ publication: { status: result.status, version: result.version || null } });
    } catch (error) {
      next(error);
    }
  });

// ───────────────────────────────────────────────────────────────────────────
// GET /audit — bounded, paginated statement audit events from the existing
// admin_audit_log chain (hash-chained, update-immutable, delete-guarded).
// Never includes document bodies or signed links: the log only ever holds
// actor/action/target/time/outcome/reason/correlation.
// ───────────────────────────────────────────────────────────────────────────
router.get('/audit', requireAdmin, requirePermission('view_financials'), async (req, res, next) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 100, maxLimit: 500 });
    const action = req.query.action ? String(req.query.action).slice(0, 80) : null;
    const adminId = req.query.admin_id ? checkUuid(req.query.admin_id, 'admin id') : null;
    const from = checkDate(req.query.from || null, 'from');
    const to = checkDate(req.query.to || null, 'to');

    const conditions = ["l.action LIKE 'statement.%'"];
    const values = [];
    let p = 1;
    if (action) { conditions.push(`l.action = $${p++}`); values.push(action); }
    if (adminId) { conditions.push(`l.admin_id = $${p++}`); values.push(adminId); }
    if (from) { conditions.push(`l.created_at >= $${p++}`); values.push(`${from}T00:00:00Z`); }
    if (to) { conditions.push(`l.created_at <= $${p++}`); values.push(`${to}T23:59:59Z`); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const { rows } = await pool.query(
      `SELECT l.id, l.admin_id, l.action, l.target_type, l.target_id, l.target_key,
              l.description, l.after_state, l.created_at,
              u.first_name || ' ' || u.last_name AS actor_name, u.email AS actor_email
       FROM admin_audit_log l
       LEFT JOIN users u ON u.id = l.admin_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT $${p++} OFFSET $${p++}`, [...values, limit, offset]);
    const { rows: [count] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM admin_audit_log l ${where}`, values);

    res.json({
      items: rows.map((row) => {
        const after = row.after_state && typeof row.after_state === 'object' ? row.after_state : {};
        return {
          eventId: row.id,
          occurredAt: new Date(row.created_at).toISOString(),
          actorId: row.admin_id,
          actorName: row.actor_name && row.actor_name.trim() ? row.actor_name : null,
          actorEmail: row.actor_email || null,
          action: row.action,
          targetType: row.target_type || null,
          targetId: row.target_id || null,
          targetKey: row.target_key || null,
          correlationId: row.target_key || after.correlationId || null,
          outcome: after.outcome || 'success',
          reason: row.description || after.reason || null,
        };
      }),
      total: count.total,
      meta: asOfMeta({
        source: 'admin_audit_log (hash-chained, update-immutable, delete-guarded; migrations 406, 624)',
        note: 'Audit rows carry actor, action, target, UTC time, outcome, reason and correlation only. Document bodies and signed links are never recorded.',
      }),
    });
  } catch (error) {
    next(error);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// GET /ops/alerts — evaluates failed runs, missing monthly coverage,
// reconciliation failures, corrupt artifacts, lease failures, aged queue and
// repeated delivery failures. Operational context only: ids, counts and
// thresholds, never document contents or PII.
// ───────────────────────────────────────────────────────────────────────────
router.get('/ops/alerts', requireAdmin, requirePermission('view_financials'), async (req, res, next) => {
  try {
    const alerts = [];
    const now = new Date();

    // 1. Failed runs.
    const { rows: failedRuns } = await pool.query(
      `SELECT id, product, period_from, period_to, failed_count, updated_at
       FROM statement_issuance_runs WHERE state = 'failed' ORDER BY updated_at DESC LIMIT 20`);
    for (const run of failedRuns) {
      alerts.push({
        code: 'run_failed', severity: 'critical',
        product: run.product, runId: run.id,
        message: `Issuance run ${run.id} for ${run.product} failed`,
        observedAt: new Date(run.updated_at).toISOString(),
        context: { failedCount: Number(run.failed_count) },
      });
    }

    // 2. Missing monthly coverage: no completed run covering the last full month.
    const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    for (const product of PRODUCTS) {
      const { rows: [coverage] } = await pool.query(
        `SELECT COUNT(*)::int AS covered FROM statement_issuance_runs
         WHERE product = $1 AND state = 'complete' AND period_to >= $2`,
        [product, lastMonthEnd.toISOString().slice(0, 10)]);
      if (!coverage.covered) {
        alerts.push({
          code: 'missing_monthly_coverage', severity: 'warning', product,
          message: `No completed issuance run covers ${lastMonthEnd.toISOString().slice(0, 7)} for ${product}`,
          observedAt: now.toISOString(),
          context: { threshold: 'coverage of the previous calendar month' },
        });
      }
    }

    // 3. Reconciliation failures in the lookback window.
    const { rows: reconFails } = await pool.query(
      `SELECT a.id, a.artifact_id, a.outcome, a.created_at
       FROM statement_publication_attempts a
       WHERE a.outcome IN ('reconciled_missing', 'reconciled_mismatch', 'reconciled_corrupt')
         AND a.created_at > transaction_timestamp() - ($1 * interval '1 hour')
       ORDER BY a.created_at DESC LIMIT 20`,
      [ALERT_THRESHOLDS.reconciliationLookbackHours]);
    for (const row of reconFails) {
      alerts.push({
        code: 'reconciliation_failure', severity: 'critical',
        artifactId: row.artifact_id, attemptId: row.id,
        message: `Artifact ${row.artifact_id} failed reconciliation (${row.outcome})`,
        observedAt: new Date(row.created_at).toISOString(),
        context: { outcome: row.outcome },
      });
    }

    // 4. Corrupt artifacts currently marked ready.
    const { rows: corruptArtifacts } = await pool.query(
      `SELECT DISTINCT art.id FROM statement_artifacts art
       JOIN statement_publication_attempts a ON a.artifact_id = art.id
       WHERE art.state = 'ready'
         AND a.outcome IN ('reconciled_missing', 'reconciled_mismatch', 'reconciled_corrupt')
       LIMIT 20`);
    for (const row of corruptArtifacts) {
      alerts.push({
        code: 'corrupt_artifact', severity: 'critical',
        artifactId: row.id,
        message: `Artifact ${row.id} is marked ready but a reconciliation found it missing or corrupt`,
        observedAt: now.toISOString(),
        context: {},
      });
    }

    // 5. Stale leases.
    const { rows: [leases] } = await pool.query(
      `SELECT COUNT(*)::int AS stale FROM statement_account_jobs
       WHERE state = 'leased' AND lease_expires_at <= transaction_timestamp()`);
    if (leases.stale >= ALERT_THRESHOLDS.staleLeaseCount) {
      alerts.push({
        code: 'stale_leases', severity: 'warning',
        message: `${leases.stale} issuance job leases are past expiry`,
        observedAt: now.toISOString(),
        context: { staleCount: leases.stale, threshold: ALERT_THRESHOLDS.staleLeaseCount },
      });
    }

    // 6. Aged queue.
    const { rows: [queue] } = await pool.query(
      `SELECT COALESCE(EXTRACT(EPOCH FROM (
                 transaction_timestamp() - MIN(created_at) FILTER (WHERE state IN ('pending', 'failed'))
               ))::int, 0) AS oldest_sec
       FROM statement_account_jobs`);
    const oldestSec = Number(queue.oldest_sec || 0);
    if (oldestSec > ALERT_THRESHOLDS.agedQueueHours * 3600) {
      alerts.push({
        code: 'aged_queue', severity: 'warning',
        message: `Oldest queued issuance job is ${Math.round(oldestSec / 3600)}h old`,
        observedAt: now.toISOString(),
        context: { oldestQueueAgeSec: oldestSec, thresholdHours: ALERT_THRESHOLDS.agedQueueHours },
      });
    }

    // 7. Repeated delivery failures.
    const { rows: [backlog] } = await pool.query(
      `SELECT COUNT(*)::int AS stuck FROM statement_outbox
       WHERE processed_at IS NULL AND attempt_count >= $1`,
      [ALERT_THRESHOLDS.deliveryBacklogAttempts]);
    if (backlog.stuck > 0) {
      alerts.push({
        code: 'repeated_delivery_failures', severity: 'warning',
        message: `${backlog.stuck} outbox events failed ${ALERT_THRESHOLDS.deliveryBacklogAttempts}+ delivery attempts`,
        observedAt: now.toISOString(),
        context: { stuckCount: backlog.stuck, attemptThreshold: ALERT_THRESHOLDS.deliveryBacklogAttempts },
      });
    }

    res.json({
      alerts,
      evaluatedAt: new Date().toISOString(),
      meta: asOfMeta({
        thresholds: ALERT_THRESHOLDS,
        note: 'Alerts carry operational context only: run/artifact/job ids, counts and thresholds. No document contents, no customer PII.',
      }),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
