// server/jobs/acceptedJobExpiryJob.js
// Daily cron: auto-cancel jobs that remain in 'accepted' status for 7+ days without moving to 'in_progress'
// Prevents helpers from accepting and never starting work; prevents customers from having jobs stuck in limbo

const pool = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('../services/notificationService');

const CRON_EXPRESSION = '0 2 * * *'; // 02:00 UTC daily
const EXPIRY_DAYS = 7; // Jobs accepted 7+ days ago auto-cancel

async function runAcceptedJobExpiryJob() {
  logger.info('Accepted job expiry job started');
  let expired = 0;
  let notificationErrors = 0;

  try {
    // Find all jobs in 'accepted' status that were accepted 7+ days ago
    const { rows: staleJobs } = await pool.query(
      `SELECT
         j.id,
         j.client_id,
         j.assigned_helper_id,
         j.title,
         j.accepted_at,
         u_helper.first_name AS helper_first_name,
         u_helper.last_name AS helper_last_name,
         u_client.first_name AS client_first_name,
         u_client.last_name AS client_last_name
       FROM jobs j
       JOIN users u_helper ON j.assigned_helper_id = u_helper.id
       JOIN users u_client ON j.client_id = u_client.id
       WHERE j.status = $1
         AND j.accepted_at IS NOT NULL
         AND j.accepted_at <= NOW() - INTERVAL '${EXPIRY_DAYS} days'
       ORDER BY j.accepted_at ASC`,
      ['accepted']
    );

    logger.info('Found stale accepted jobs', { count: staleJobs.length });

    // Auto-cancel each job
    for (const job of staleJobs) {
      try {
        await pool.query(
          `UPDATE jobs
           SET status = $1, updated_at = NOW()
           WHERE id = $2`,
          ['cancelled', job.id]
        );

        // Log the auto-cancellation for audit trail
        await pool.query(
          `INSERT INTO cancellation_audit_log (
            user_id, job_id, role, reason, fee_percentage, cancelled_by, cancelled_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            job.client_id,
            job.id,
            'system_auto_cancel',
            'Job auto-cancelled after 7 days in accepted status without progress',
            0, // No fees for system auto-cancel
            null // system auto-cancel, not a user action
          ]
        );

        // Notify helper
        try {
          const helperName = `${job.helper_first_name} ${job.helper_last_name}`;
          await sendNotification({
            userId: job.assigned_helper_id,
            type: 'job_auto_cancelled',
            title: 'Job Auto-Cancelled',
            body: `"${job.title}" was automatically cancelled because it remained unstarted for 7 days after acceptance.`,
            data: { jobId: job.id },
            action_url: `/jobs/${job.id}`
          });
        } catch (notifErr) {
          logger.warn('Failed to notify helper of auto-cancellation', {
            jobId: job.id,
            helperId: job.assigned_helper_id,
            error: notifErr.message
          });
          notificationErrors++;
        }

        // Notify customer
        try {
          await sendNotification({
            userId: job.client_id,
            type: 'job_auto_cancelled',
            title: 'Job Auto-Cancelled',
            body: `Your job "${job.title}" was automatically cancelled because the accepted helper did not start the work within 7 days.`,
            data: { jobId: job.id },
            action_url: `/jobs/${job.id}`
          });
        } catch (notifErr) {
          logger.warn('Failed to notify customer of auto-cancellation', {
            jobId: job.id,
            customerId: job.client_id,
            error: notifErr.message
          });
          notificationErrors++;
        }

        expired++;
        logger.info('Auto-cancelled stale job', {
          jobId: job.id,
          title: job.title,
          acceptedDays: EXPIRY_DAYS
        });
      } catch (jobErr) {
        logger.error('Failed to auto-cancel job', {
          jobId: job.id,
          error: jobErr.message
        });
      }
    }

    logger.info('Accepted job expiry job completed', {
      cancelled: expired,
      notificationErrors
    });

    return { cancelled: expired, notificationErrors };
  } catch (err) {
    logger.error('Accepted job expiry job failed', { error: err.message });
    throw err;
  }
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
  EXPIRY_DAYS
};
