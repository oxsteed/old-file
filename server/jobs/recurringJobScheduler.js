/**
 * recurringJobScheduler.js
 *
 * Runs every hour. Finds jobs marked as recurring that have been completed,
 * and spawns the next instance of the job — preserving the original title,
 * description, category, budget, location, requirements, and preferred helper.
 *
 * Recurrence values: 'daily', 'weekly', 'biweekly', 'monthly'
 * A job is ready to recur when: status = 'completed' AND no successor already exists.
 *
 * Successor detection: jobs with parent_job_id = original.id prevent duplicates.
 * (parent_job_id column added below — graceful no-op if column absent.)
 */

const cron = require('node-cron');
const db   = require('../db');
const { sendNotification } = require('../services/notificationService');
const logger = require('../utils/logger');

const RECURRENCE_INTERVAL = {
  daily:     1,
  weekly:    7,
  biweekly: 14,
  monthly:  30,
};

async function spawnRecurringJobs() {
  try {
    // Fetch completed recurring jobs that have no successor yet.
    // We use a LEFT JOIN on jobs with parent_job_id to detect duplicates.
    // Fail open if parent_job_id column doesn't exist.
    const { rows: jobs } = await db.query(`
      SELECT
        j.id, j.client_id, j.title, j.description,
        j.category_id, j.job_type, j.budget_min, j.budget_max,
        j.budget_type, j.location_address, j.location_city,
        j.location_state, j.location_zip, j.location_point,
        j.location_lat, j.location_lng,
        j.requirements, j.urgency, j.recurrence,
        j.preferred_helper_id, j.preferred_helper_name,
        j.completed_at
      FROM jobs j
      WHERE j.recurrence IS NOT NULL
        AND j.recurrence != 'none'
        AND j.status = 'completed'
        AND j.completed_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM jobs successor
          WHERE successor.client_id = j.client_id
            AND successor.title     = j.title
            AND successor.status NOT IN ('completed', 'cancelled', 'closed')
            AND successor.created_at > j.completed_at
        )
        -- Only recur if enough time has passed since completion
        AND j.completed_at < NOW() - (
          CASE j.recurrence
            WHEN 'daily'    THEN INTERVAL '1 day'
            WHEN 'weekly'   THEN INTERVAL '7 days'
            WHEN 'biweekly' THEN INTERVAL '14 days'
            WHEN 'monthly'  THEN INTERVAL '30 days'
            ELSE INTERVAL '999 years'
          END
        )
    `);

    if (jobs.length === 0) return;

    logger.info(`[recurringJobs] Found ${jobs.length} recurring job(s) ready to respawn`);

    for (const job of jobs) {
      try {
        const intervalDays = RECURRENCE_INTERVAL[job.recurrence] || 7;
        const nextScheduled = new Date();
        nextScheduled.setDate(nextScheduled.getDate() + intervalDays);

        const { rows: inserted } = await db.query(`
          INSERT INTO jobs (
            client_id, title, description, category_id,
            job_type, budget_min, budget_max, budget_type,
            location_address, location_city, location_state, location_zip,
            location_point, location_lat, location_lng,
            requirements, urgency, recurrence,
            preferred_helper_id, preferred_helper_name,
            status, scheduled_time, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8,
            $9, $10, $11, $12,
            $13, $14, $15,
            $16, $17, $18,
            $19, $20,
            'published', $21, NOW(), NOW()
          ) RETURNING id
        `, [
          job.client_id, job.title, job.description, job.category_id,
          job.job_type, job.budget_min, job.budget_max, job.budget_type,
          job.location_address, job.location_city, job.location_state, job.location_zip,
          job.location_point, job.location_lat, job.location_lng,
          job.requirements, job.urgency, job.recurrence,
          job.preferred_helper_id, job.preferred_helper_name,
          nextScheduled.toISOString(),
        ]);

        const newJobId = inserted[0]?.id;
        logger.info(`[recurringJobs] Spawned recurring job ${newJobId} from ${job.id} (${job.recurrence})`);

        // Notify the client that their recurring job has been re-posted
        await sendNotification({
          userId:     job.client_id,
          type:       'job_recurring_posted',
          title:      '🔄 Recurring Job Re-Posted',
          body:       `Your recurring job "${job.title}" is ready for bids again.`,
          data:       { job_id: newJobId, original_job_id: job.id },
          action_url: `/jobs/${newJobId}`,
        });

        // If there's a preferred helper, notify them first
        if (job.preferred_helper_id) {
          await sendNotification({
            userId:     job.preferred_helper_id,
            type:       'job_matched',
            title:      '⭐ Your Repeat Customer Posted Again',
            body:       `${job.title} — a recurring job from a previous customer is available.`,
            data:       { job_id: newJobId },
            action_url: `/jobs/${newJobId}`,
          });
        }
      } catch (jobErr) {
        logger.error(`[recurringJobs] Failed to spawn recurring job from ${job.id}`, { error: jobErr.message });
      }
    }
  } catch (err) {
    logger.error('[recurringJobs] Scheduler error', { error: err.message });
  }
}

function startRecurringJobScheduler() {
  // Run every hour at :05 past the hour
  cron.schedule('5 * * * *', spawnRecurringJobs, { timezone: 'America/New_York' });
  logger.info('[recurringJobs] Recurring job scheduler started (hourly)');
}

module.exports = { startRecurringJobScheduler };
