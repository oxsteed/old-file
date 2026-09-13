'use strict';

const db = require('../db');
const logger = require('../utils/logger');

function safeResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return {};
  return Object.fromEntries(Object.entries(result).filter(([, value]) => (
    value === null || ['string', 'number', 'boolean'].includes(typeof value)
  )));
}

async function recordOxsteedCreditWorkerRun({ jobName, result = {}, error = null } = {}) {
  const normalizedJobName = String(jobName || '').trim().slice(0, 120);
  if (!normalizedJobName) return { persisted: false, reason: 'job_name_required' };

  const succeeded = !error;
  try {
    await db.query(
      `INSERT INTO oxsteed_credit_worker_heartbeats
         (job_name, last_run_at, last_success_at, last_error, last_result,
          run_count, consecutive_failures, updated_at)
       VALUES ($1, NOW(), CASE WHEN $2::boolean THEN NOW() ELSE NULL END,
               $3, $4::jsonb, 1, CASE WHEN $2::boolean THEN 0 ELSE 1 END, NOW())
       ON CONFLICT (job_name) DO UPDATE SET
         last_run_at = NOW(),
         last_success_at = CASE WHEN $2::boolean THEN NOW() ELSE oxsteed_credit_worker_heartbeats.last_success_at END,
         last_error = $3,
         last_result = $4::jsonb,
         run_count = oxsteed_credit_worker_heartbeats.run_count + 1,
         consecutive_failures = CASE WHEN $2::boolean THEN 0 ELSE oxsteed_credit_worker_heartbeats.consecutive_failures + 1 END,
         updated_at = NOW()`,
      [
        normalizedJobName,
        succeeded,
        error ? String(error.message || error).slice(0, 2000) : null,
        JSON.stringify(succeeded ? safeResult(result) : {}),
      ],
    );
    return { persisted: true };
  } catch (heartbeatError) {
    // Worker telemetry must never turn a successful Credit job into a failure.
    logger.warn('OxSteed Credit worker heartbeat could not be persisted', {
      jobName: normalizedJobName,
      error: heartbeatError.message,
    });
    return { persisted: false, reason: heartbeatError.message };
  }
}

module.exports = { recordOxsteedCreditWorkerRun, safeResult };
