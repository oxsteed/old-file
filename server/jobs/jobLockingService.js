// VULN #23 FIX: Prevent concurrent cron job execution
// E03: lease-loss fencing — a worker that loses its lease must refuse
// further writes so a stale worker cannot corrupt state after a handoff.

const pool = require('../db');
const logger = require('../utils/logger');
const incidentStore = require('../services/incidentStore');
const { withDbBudget, DbBudgetExhaustedError } = require('../utils/dbBudgets');
const os = require('os');

/**
 * Thrown when a worker tries to write after its job lease was lost.
 * Handlers should let this propagate: withFencedJobLock converts it into
 * a { fenced: true } outcome instead of a crash.
 */
class LeaseLostError extends Error {
  constructor(jobName) {
    super(`Job lease lost for "${jobName}": refusing further writes`);
    this.name = 'LeaseLostError';
    this.code = 'LEASE_LOST';
    this.jobName = jobName;
  }
}

/**
 * Thrown when the lock store itself fails while acquiring a job lock
 * (background-jobs audit, Oct 30 item 30(d)).
 *
 * A lock-acquisition error is NOT contention: the lock state is unknown,
 * so the caller must fail closed (never run the handler) and must log /
 * count it distinctly from "another instance holds the lock". The message
 * embeds the underlying store error so existing substring checks keep
 * matching.
 */
class JobLockAcquisitionError extends Error {
  constructor(jobName, cause) {
    super(`Job lock acquisition failed for "${jobName}": ${cause?.message || cause}`);
    this.name = 'JobLockAcquisitionError';
    this.code = 'LOCK_ACQUISITION_ERROR';
    this.jobName = jobName;
    this.cause = cause;
  }
}

const LEASE_VERIFY_SQL =
  'SELECT 1 FROM cron_job_locks WHERE lock_id = $1 AND lock_value = $2 AND expires_at > NOW()';

function lockIdFor(jobName) {
  return `job_lock:${jobName}`;
}

/**
 * Create the fence handed to a fenced job handler.
 *
 * Enforcement layers:
 *  - fence.assertActive() / fence.isActive(): in-memory lease flag, flipped
 *    the moment the renewal loop observes a lost lease.
 *  - fence.db.query(): every query through the fenced handle checks the flag
 *    first, so a stale worker's writes never reach the database.
 *  - fence.fencedTransaction(work): re-verifies the lease row INSIDE the
 *    write transaction (BEGIN; verify; work; COMMIT), closing the
 *    check-then-write race. Rolls back and throws LeaseLostError when the
 *    lease is gone.
 */
function createFence(jobName, lockValue) {
  let leaseLost = false;

  const fence = {
    get lockValue() {
      return lockValue;
    },
    isActive() {
      return !leaseLost;
    },
    // Synchronous on purpose: a guard must never be silently skipped by a
    // missing `await`.
    assertActive() {
      if (leaseLost) throw new LeaseLostError(jobName);
    },
    // Called by the renewal loop when the lease is observed lost. Also
    // exposed for tests.
    _onLeaseLost() {
      if (leaseLost) return;
      leaseLost = true;
      logger.error('FENCED: job lost its lease; refusing further writes', { jobName });
    },
    db: {
      query: async (text, params) => {
        fence.assertActive();
        return pool.query(text, params);
      },
      tx: (work) => fence.fencedTransaction(work),
    },
    fencedQuery: async (text, params) => fence.db.query(text, params),
    async fencedTransaction(work) {
      fence.assertActive();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(LEASE_VERIFY_SQL, [lockIdFor(jobName), lockValue]);
        if (rows.length === 0) {
          fence._onLeaseLost();
          throw new LeaseLostError(jobName);
        }
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          logger.warn('fencedTransaction rollback failed', { jobName, error: rollbackErr.message });
        }
        throw err;
      } finally {
        try {
          client.release();
        } catch (releaseErr) {
          logger.warn('fencedTransaction client release failed', { jobName, error: releaseErr.message });
        }
      }
    },
  };

  return fence;
}

/**
 * Distributed lock for cron jobs
 * Ensures only one instance of a scheduled job runs at a time
 *
 * Tri-state acquisition outcome (background-jobs audit, Oct 30 item
 * 30(d), STILL LIVE at 51ccc1453): acquireJobLock used to return null
 * both when the lock was held (contention) and when the DB query threw,
 * so a DB outage read as contention and a skipped run was invisible.
 *   - { outcome: 'acquired', lockValue } — this worker holds the lease.
 *   - { outcome: 'contended', lockValue: null } — another instance holds
 *     a live lease; skipping is the correct, quiet outcome.
 *   - { outcome: 'error', lockValue: null, error } — the lock store
 *     itself failed. The lease state is UNKNOWN: the caller must fail
 *     closed (never treat this as a free lock) and must surface it
 *     distinctly from contention.
 */
async function acquireJobLockState(jobName, ttlSeconds = 300) {
  const lockId = `job_lock:${jobName}`;
  const lockValue = `${os.hostname()}-${process.pid}-${Date.now()}`;

  try {
    // Try to acquire lock atomically
    const { rows } = await pool.query(
      `INSERT INTO cron_job_locks (lock_id, lock_value, acquired_at, expires_at)
       VALUES ($1, $2, NOW(), NOW() + INTERVAL '1 second' * $3)
       ON CONFLICT (lock_id) DO UPDATE
          SET lock_value = EXCLUDED.lock_value,
              acquired_at = EXCLUDED.acquired_at,
              expires_at = EXCLUDED.expires_at
        WHERE cron_job_locks.expires_at <= NOW()
       RETURNING lock_id`,
      [lockId, lockValue, ttlSeconds]
    );

    if (rows.length > 0) {
      logger.info(`Acquired lock: ${jobName}`);
      return { outcome: 'acquired', lockValue };
    }

    logger.warn(`Failed to acquire lock: ${jobName} (already running)`);
    return { outcome: 'contended', lockValue: null };
  } catch (err) {
    logger.error('Lock acquisition error', { jobName, error: err.message });
    return { outcome: 'error', lockValue: null, error: err };
  }
}

async function acquireJobLock(jobName, ttlSeconds = 300, { throwOnError = false } = {}) {
  const state = await acquireJobLockState(jobName, ttlSeconds);
  if (state.outcome === 'acquired') return state.lockValue;
  if (state.outcome === 'error' && throwOnError) {
    throw new JobLockAcquisitionError(jobName, state.error);
  }
  // Contention, or an acquisition error without throwOnError: fail closed
  // with no lock in both cases. Callers that need the distinction should
  // use acquireJobLockState (or throwOnError) instead of reading null.
  return null;
}

async function releaseJobLock(jobName, lockValue) {
  try {
    await pool.query(
      `DELETE FROM cron_job_locks WHERE lock_id = $1 AND lock_value = $2`,
      [lockIdFor(jobName), lockValue]
    );
    logger.info(`Released lock: ${jobName}`);
  } catch (err) {
    logger.warn('Lock release failed', { jobName, error: err.message });
  }
}

/**
 * Renewal outcome, distinguished so callers never confuse a transient
 * database error with a lost lease (background-jobs audit, Oct 30
 * item 6, STILL LIVE at 51ccc1453):
 *   - 'refreshed': the row still belongs to this worker and now expires
 *     ttlSeconds from now.
 *   - 'expired': the row is gone, belongs to another worker, or already
 *     expired: the lease is genuinely lost.
 *   - 'error': the renewal query itself threw (transient DB blip). The
 *     lease state is UNKNOWN: fencing here would abort a healthy run,
 *     and deleting the lock row would let a replica acquire the lock
 *     while this run keeps writing. The caller must keep the timer
 *     running and retry; if the database stays down the lease expires
 *     on its own and a later renewal reports 'expired'.
 */
async function refreshJobLockState(jobName, lockValue, ttlSeconds = 300) {
  if (!lockValue) return 'expired';
  try {
    const { rows } = await pool.query(
      `UPDATE cron_job_locks
          SET expires_at = NOW() + INTERVAL '1 second' * $3
        WHERE lock_id = $1 AND lock_value = $2 AND expires_at > NOW()
        RETURNING lock_id`,
      [`job_lock:${jobName}`, lockValue, ttlSeconds]
    );
    return rows.length > 0 ? 'refreshed' : 'expired';
  } catch (err) {
    logger.warn('Lock renewal failed', { jobName, error: err.message });
    return 'error';
  }
}

async function refreshJobLock(jobName, lockValue, ttlSeconds = 300) {
  return (await refreshJobLockState(jobName, lockValue, ttlSeconds)) === 'refreshed';
}

/**
 * Fenced wrapper for cron jobs with automatic locking and lease-loss fencing.
 *
 * The handler receives a `fence`. Use `fence.db.query(...)` for the job's
 * writes (or `fence.assertActive()` checkpoints before write phases) and
 * `fence.fencedTransaction(work)` for money-critical sections so the lease
 * is re-verified inside the write transaction.
 *
 * Outcomes: { skipped: true, lockSkipped: true } when another instance
 * holds the lock (the lockSkipped marker distinguishes a lock skip from
 * a worker that returns { skipped: true } itself, e.g. a disabled flag
 * or an idle outbox — the runner must only count lock skips toward a
 * skipped streak), { skipped: true, lockError: true } when the lock
 * store itself failed (30(d): fail closed, handler never runs, and the
 * outcome is distinct from contention), { fenced: true } when the
 * handler aborted after lease loss, otherwise the handler's return
 * value (or { completed: true }).
 */
async function withFencedJobLock(jobName, handler, ttlSeconds = 300, { throwOnLockError = false, throwOnError = false } = {}) {
  const acquisition = await acquireJobLockState(jobName, ttlSeconds);

  if (acquisition.outcome === 'error') {
    if (throwOnLockError || throwOnError) {
      throw new JobLockAcquisitionError(jobName, acquisition.error);
    }
    // Fail closed without a lock, and say so: a lock-store failure is
    // not contention, and returning a bare { skipped: true } hid DB
    // outages as "another instance already running" (30(d)).
    logger.warn(`Skipping ${jobName} - lock acquisition failed`, {
      jobName,
      error: acquisition.error.message,
    });
    return { skipped: true, lockError: true };
  }

  if (acquisition.outcome !== 'acquired') {
    logger.warn(`Skipping ${jobName} - another instance already running`);
    return { skipped: true, lockSkipped: true };
  }

  const lockValue = acquisition.lockValue;

  const fence = createFence(jobName, lockValue);

  const renewalIntervalMs = Math.max(1000, Math.floor(Number(ttlSeconds) * 1000 / 3));
  const renewalTimer = setInterval(() => {
    refreshJobLockState(jobName, lockValue, ttlSeconds).then((state) => {
      if (state === 'refreshed') return;
      if (state === 'error') {
        // Oct 30 item 6: a renewal ERROR is not a lost lease. Do not
        // fence and do not delete the lock row: the run keeps its lease
        // (or the lease expires on its own) and the next tick retries.
        // Fencing here turned a transient DB blip into exactly the
        // concurrent double-write the fence exists to prevent.
        logger.warn('Lock renewal error; keeping lease and retrying next tick', { jobName });
        return;
      }
      // E03: the lease is gone (expired or taken over). Fence immediately
      // so no further writes go out, stop renewing, and best-effort
      // release our stale row.
      fence._onLeaseLost();
      clearInterval(renewalTimer);
      releaseJobLock(jobName, lockValue).catch(() => {});
    }).catch((err) => {
      logger.warn('Unexpected lock renewal failure', { jobName, error: err.message });
    });
  }, renewalIntervalMs);
  renewalTimer.unref?.();

  try {
    // E04: every worker runs under the 'jobs' workload budget. When the
    // budget is exhausted the run fails closed (DbBudgetExhaustedError)
    // instead of piling onto the shared pool behind the web tier.
    const result = await withDbBudget('jobs', () => handler(fence));
    return result === undefined ? { completed: true } : result;
  } catch (err) {
    if (err instanceof LeaseLostError) {
      logger.warn(`Job ${jobName} fenced after lease loss; remaining work aborted`, { jobName });
      // Background-jobs audit #47: a fenced abort used to be warn-only,
      // so a worker abandoning half its pass was invisible. Record a
      // deduped incident (one open row per job; repeats refresh
      // occurrence_count / last_seen_at instead of spamming rows) so the
      // abort surfaces on the operator incident list. recordIncident
      // never throws, so the fenced outcome is unaffected if the
      // incident write itself fails.
      await incidentStore.recordIncident({
        type: 'scheduled_worker_fenced',
        severity: 'warning',
        message: `Job ${jobName} aborted after losing its lease; remaining work was not completed`,
        dedupeKey: `${jobName}:fenced`,
        details: { jobName },
      });
      return { fenced: true };
    }
    if (err instanceof DbBudgetExhaustedError) {
      logger.error(`Job ${jobName} refused: DB workload budget exhausted`, {
        jobName,
        workload: err.workload,
      });
    } else {
      logger.error(`Job ${jobName} failed`, { error: err.message });
    }
    throw err;
  } finally {
    clearInterval(renewalTimer);
    await releaseJobLock(jobName, lockValue);
  }
}

/**
 * Legacy wrapper for cron jobs with automatic locking.
 *
 * Kept for backward compatibility: same signature as before, now built on
 * the fenced core so lease loss is detected (and fenced) for every job.
 * Handlers that accept the fence argument get write enforcement; handlers
 * that ignore it keep their previous behavior.
 */
async function withJobLock(jobName, handler, ttlSeconds = 300, { throwOnLockError = false, throwOnError = false } = {}) {
  return withFencedJobLock(jobName, handler, ttlSeconds, { throwOnLockError, throwOnError });
}

module.exports = {
  LeaseLostError,
  JobLockAcquisitionError,
  createFence,
  acquireJobLock,
  acquireJobLockState,
  refreshJobLock,
  refreshJobLockState,
  releaseJobLock,
  withJobLock,
  withFencedJobLock,
};
