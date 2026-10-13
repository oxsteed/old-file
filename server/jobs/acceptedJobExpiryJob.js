// server/jobs/acceptedJobExpiryJob.js
// Review P1-131: daily sweep for jobs accepted but never started.
//  - day WARNING_DAYS: both parties are warned once (in-app/push/email).
//  - day EXPIRY_DAYS: the job is cancelled through the shared cancellation
//    core as a 'system' actor (no fee, audited in cancellation_audit_log).
//  - a job with a live payment hold is never auto-cancelled; it is raised as
//    a reconciliation exception for an operator to release the hold first.
// Failures are counted and returned; the run throws if every attempt failed.

const pool = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('../services/notificationService');
const { cancelJobTransaction, finalizeJobCancellation } = require('../services/jobCancellationService');
const { withFencedJobLock } = require('./jobLockingService');

const JOB_NAME = 'accepted-job-expiry';
const CRON_EXPRESSION = '0 * * * *'; // hourly; each job is acted on once
const EXPIRY_DAYS = 7;
const WARNING_DAYS = 5;
const BATCH_SIZE = 200;

async function notifyBoth(job, type, data) {
  let failures = 0;
  for (const userId of [job.client_id, job.assigned_helper_id].filter(Boolean)) {
    try {
      await sendNotification({
        userId,
        type,
        data: { job_id: job.id, title: job.title || '', ...data },
        action_url: `/jobs/${job.id}`,
        idempotencyKey: `${type}:${job.id}:${userId}`,
      });
    } catch (err) {
      failures += 1;
      logger.warn('Accepted job expiry notification failed', { jobId: job.id, type, error: err.message });
    }
  }
  return failures;
}

async function sweep(db) {
  const result = { warned: 0, cancelled: 0, held: 0, failed: 0, notificationErrors: 0 };

  const { rows: warnJobs } = await db.query(
    `UPDATE jobs SET expiry_warning_sent_at = NOW()
      WHERE id IN (
        SELECT id FROM jobs
         WHERE status = 'accepted' AND accepted_at IS NOT NULL
           AND started_at IS NULL AND expiry_warning_sent_at IS NULL
           AND accepted_at <= NOW() - make_interval(days => $1)
           AND accepted_at >  NOW() - make_interval(days => $2)
         LIMIT $3)
      RETURNING id, title, client_id, assigned_helper_id`,
    [WARNING_DAYS, EXPIRY_DAYS, BATCH_SIZE]
  );
  for (const job of warnJobs) {
    result.notificationErrors += await notifyBoth(job, 'job_auto_cancel_warning', { days: EXPIRY_DAYS - WARNING_DAYS });
    result.warned += 1;
  }

  const { rows: staleJobs } = await db.query(
    `SELECT id, title, client_id, assigned_helper_id, accepted_at
       FROM jobs
      WHERE status = 'accepted' AND accepted_at IS NOT NULL AND started_at IS NULL
        AND accepted_at <= NOW() - make_interval(days => $1)
      ORDER BY accepted_at
      LIMIT $2`,
    [EXPIRY_DAYS, BATCH_SIZE]
  );

  for (const job of staleJobs) {
    try {
      const cancelled = await cancelJobTransaction({
        jobId: job.id,
        actorId: null,
        actorKind: 'system',
        reason: `Auto-cancelled: work did not start within ${EXPIRY_DAYS} days of acceptance`,
      });
      await finalizeJobCancellation(cancelled);
      result.notificationErrors += await notifyBoth(job, 'job_auto_cancelled', { days: EXPIRY_DAYS });
      result.cancelled += 1;
    } catch (err) {
      if (err.code === 'pending_payments') {
        result.held += 1;
        const { recordException } = require('../services/reconciliationExceptions');
        await recordException({
          domain: 'payment_refund',
          referenceId: `stale_accepted_job:${job.id}`,
          severity: 'warning',
          summary: `Job ${job.id} has been accepted for ${EXPIRY_DAYS}+ days without starting and holds a live payment. Release or refund it, then cancel.`,
          details: { job_id: job.id, accepted_at: job.accepted_at },
        });
      } else if (err.code === 'state_conflict') {
        // Started, completed or cancelled concurrently: nothing to do.
      } else {
        result.failed += 1;
        logger.error('Failed to auto-cancel stale accepted job', { jobId: job.id, error: err.message });
      }
    }
  }

  if (result.failed > 0 && result.failed === staleJobs.length) {
    throw new Error(`Accepted job expiry failed for all ${result.failed} due job(s)`);
  }
  return result;
}

async function runAcceptedJobExpiryJob(db = pool) {
  let result = { locked: false };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    result = { locked: true, ...(await sweep(db)) };
  }, 900, { throwOnError: true });
  logger.info('Accepted job expiry run finished', result);
  return result;
}

function startAcceptedJobExpiryJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runAcceptedJobExpiryJob();
    } catch (err) {
      logger.error('Accepted job expiry cron error', { error: err.message });
    }
  });
  logger.info('Accepted job expiry job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startAcceptedJobExpiryJob,
  runAcceptedJobExpiryJob,
  cronExpression: CRON_EXPRESSION,
  EXPIRY_DAYS,
  WARNING_DAYS,
};
