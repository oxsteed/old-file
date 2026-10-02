// VULN #23 FIX: Prevent concurrent cron job execution
// E03: lease-loss fencing — a worker that loses its lease must refuse
// further writes so a stale worker cannot corrupt state after a handoff.

const pool = require('../db');
const logger = require('../utils/logger');
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
 */
async function acquireJobLock(jobName, ttlSeconds = 300, { throwOnError = false } = {}) {
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
      return lockValue;
    }

    logger.warn(`Failed to acquire lock: ${jobName} (already running)`);
    return null;
  } catch (err) {
    logger.error('Lock acquisition failed', { jobName, error: err.message });
    if (throwOnError) throw err;
    return null;
  }
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

async function refreshJobLock(jobName, lockValue, ttlSeconds = 300) {
  if (!lockValue) return false;
  try {
    const { rows } = await pool.query(
      `UPDATE cron_job_locks
          SET expires_at = NOW() + INTERVAL '1 second' * $3
        WHERE lock_id = $1 AND lock_value = $2 AND expires_at > NOW()
        RETURNING lock_id`,
      [`job_lock:${jobName}`, lockValue, ttlSeconds]
    );
    return rows.length > 0;
  } catch (err) {
    logger.warn('Lock renewal failed', { jobName, error: err.message });
    return false;
  }
}

/**
 * Fenced wrapper for cron jobs with automatic locking and lease-loss fencing.
 *
 * The handler receives a `fence`. Use `fence.db.query(...)` for the job's
 * writes (or `fence.assertActive()` checkpoints before write phases) and
 * `fence.fencedTransaction(work)` for money-critical sections so the lease
 * is re-verified inside the write transaction.
 *
 * Outcomes: { skipped: true } when another instance holds the lock,
 * { fenced: true } when the handler aborted after lease loss, otherwise the
 * handler's return value (or { completed: true }).
 */
async function withFencedJobLock(jobName, handler, ttlSeconds = 300, { throwOnLockError = false, throwOnError = false } = {}) {
  const lockValue = await acquireJobLock(jobName, ttlSeconds, {
    throwOnError: throwOnLockError || throwOnError,
  });

  if (!lockValue) {
    logger.warn(`Skipping ${jobName} - another instance already running`);
    return { skipped: true };
  }

  const fence = createFence(jobName, lockValue);

  const renewalIntervalMs = Math.max(1000, Math.floor(Number(ttlSeconds) * 1000 / 3));
  const renewalTimer = setInterval(() => {
    refreshJobLock(jobName, lockValue, ttlSeconds).then((refreshed) => {
      if (!refreshed) {
        // E03: the lease is gone (expired or taken over). Fence immediately
        // so no further writes go out, stop renewing, and best-effort
        // release our stale row.
        fence._onLeaseLost();
        clearInterval(renewalTimer);
        releaseJobLock(jobName, lockValue).catch(() => {});
      }
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
  createFence,
  acquireJobLock,
  refreshJobLock,
  releaseJobLock,
  withJobLock,
  withFencedJobLock,
};
