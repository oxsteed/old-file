// VULN #23 FIX: Prevent concurrent cron job execution

const pool = require('../db');
const logger = require('../utils/logger');
const os = require('os');

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
      [`job_lock:${jobName}`, lockValue]
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
 * Wrapper for cron jobs with automatic locking
 */
async function withJobLock(jobName, handler, ttlSeconds = 300, { throwOnLockError = false } = {}) {
  const lockValue = await acquireJobLock(jobName, ttlSeconds, { throwOnError: throwOnLockError });

  if (!lockValue) {
    logger.warn(`Skipping ${jobName} - another instance already running`);
    return;
  }

  const renewalIntervalMs = Math.max(1000, Math.floor(Number(ttlSeconds) * 1000 / 3));
  const renewalTimer = setInterval(() => {
    refreshJobLock(jobName, lockValue, ttlSeconds).then((refreshed) => {
      if (!refreshed) logger.warn(`Lost ${jobName} lease before handler completed`);
    }).catch((err) => {
      logger.warn('Unexpected lock renewal failure', { jobName, error: err.message });
    });
  }, renewalIntervalMs);
  renewalTimer.unref?.();

  try {
    await handler();
  } catch (err) {
    logger.error(`Job ${jobName} failed`, { error: err.message });
    throw err;
  } finally {
    clearInterval(renewalTimer);
    await releaseJobLock(jobName, lockValue);
  }
}

module.exports = {
  acquireJobLock,
  refreshJobLock,
  releaseJobLock,
  withJobLock
};
