const cron              = require('node-cron');
const logger = require('../utils/logger');
const db                = require('../db');
const { sendNotification } = require('../services/notificationService');

/**
 * Planned Needs Scheduler — runs daily at 6 AM Eastern.
 *
 * Pass 1 — Mark "activating_soon"
 *   Needs where activation day is tomorrow get a heads-up status.
 *
 * Pass 2 — Auto-publish
 *   Needs where (due_date − lead_time_days) <= today get a job post.
 *   • No preferred helper → job published immediately to all.
 *   • Preferred helper set → job created as 'published' with held_for_helper_id.
 *     Helper can bid immediately; after 72h hold expires, all helpers can bid.
 *
 * Pass 3 — 72-hour preferred-helper expiry
 *   Jobs whose hold_expires_at has passed: clear held_for_helper_id,
 *   notify customer.
 */
let plannedNeedsJob = null;

const startPlannedNeedsScheduler = () => {
  plannedNeedsJob = cron.schedule('0 6 * * *', async () => {
    logger.info('[Cron] Running planned needs scheduler...');

    try {
      // ── Pass 1: activating_soon ───────────────────────────────────────
      const { rowCount: soonCount } = await db.query(`
        UPDATE planned_needs
        SET status = 'activating_soon', updated_at = NOW()
        WHERE status IN ('planned', 'funding')
          AND (due_date - lead_time_days - 1) = CURRENT_DATE
      `);
      if (soonCount > 0) {
        logger.info(`[Cron] Marked ${soonCount} need(s) as activating_soon`);
      }

      // ── Pass 2: auto-publish ────────────────────────────────────────
      const { rows: toPublish } = await db.query(`
        SELECT
          pn.id, pn.user_id, pn.title, pn.description, pn.category,
          pn.estimated_cost, pn.due_date, pn.lead_time_days,
          pn.preferred_helper_id,
          u.location_city, u.location_state, u.location_zip,
          u.location_lat, u.location_lng,
          ph.first_name AS helper_first_name,
          ph.is_active  AS helper_is_active
        FROM planned_needs pn
        JOIN users u  ON u.id  = pn.user_id
        LEFT JOIN users ph ON ph.id = pn.preferred_helper_id
        WHERE pn.status IN ('planned', 'funding', 'activating_soon')
          AND (pn.due_date - pn.lead_time_days) <= CURRENT_DATE
      `);
      logger.info(`[Cron] ${toPublish.length} need(s) ready to auto-publish`);

      for (const need of toPublish) {
        try {
          const categoryName = categoryToJobName(need.category);
          const cost = parseFloat(need.estimated_cost || 0);
          const budgetMin = cost > 0 ? Math.round(cost * 0.8 * 100) / 100 : null;
          const budgetMax = cost > 0 ? cost : null;
          const description = need.description
            || `Auto-scheduled: ${need.title}. Posted automatically from Planned Needs.`;

          // Task 10: Skip inactive preferred helpers
          const hasPreferred = !!need.preferred_helper_id && need.helper_is_active !== false;

          // Task 1: ALL jobs are created as 'published' now.
          // If there's a preferred helper, we set held_for_helper_id + hold_expires_at.
          const { rows: jobRows } = await db.query(`
            INSERT INTO jobs
              (client_id, title, description, category_name, status,
               budget_min, budget_max,
               location_city, location_state, location_zip,
               scheduled_date, expires_at,
               planned_need_id,
               held_for_helper_id, held_at, hold_expires_at,
               metadata)
            VALUES ($1,$2,$3,$4,'published',
                    $5,$6,$7,$8,$9,$10,
                    NOW() + INTERVAL '30 days',
                    $11,
                    $12, CASE WHEN $12::uuid IS NOT NULL THEN NOW() ELSE NULL END,
                    CASE WHEN $12::uuid IS NOT NULL THEN NOW() + INTERVAL '72 hours' ELSE NULL END,
                    jsonb_build_object('source','planned_need','planned_need_id',$11))
            RETURNING id
          `, [
            need.user_id, need.title, description, categoryName,
            budgetMin, budgetMax,
            need.location_city || null, need.location_state || null, need.location_zip || null,
            need.due_date,
            need.id,
            hasPreferred ? need.preferred_helper_id : null,
          ]);
          const jobId = jobRows[0].id;

          if (hasPreferred) {
            await db.query(`
              UPDATE planned_needs
              SET status = 'published',
                  published_job_id = $2,
                  published_at     = NOW(),
                  preferred_helper_status = 'pending',
                  helper_notified_at      = NOW(),
                  updated_at       = NOW()
              WHERE id = $1
            `, [need.id, jobId]);

            await sendNotification({
              userId: need.preferred_helper_id,
              type:   'planned_need_request',
              title:  'A customer wants to hire you',
              body:   `${need.title} is scheduled and they'd like you to handle it. You can accept or decline within 72 hours.`,
              data:   { job_id: jobId, planned_need_id: need.id },
              action_url: `/jobs/${jobId}`,
            });
            logger.info(`[Cron] Published need ${need.id} -> job ${jobId} (held for helper ${need.preferred_helper_id})`);
          } else {
            // Broadcast immediately (no hold)
            await db.query(`
              UPDATE planned_needs
              SET status = 'published',
                  published_job_id = $2,
                  published_at     = NOW(),
                  updated_at       = NOW()
              WHERE id = $1
            `, [need.id, jobId]);
            logger.info(`[Cron] Published need ${need.id} -> job ${jobId} (${need.title})`);
          }
        } catch (innerErr) {
          logger.error(`[Cron] Failed to publish need ${need.id}:`, innerErr);
        }
      }

      // ── Pass 3: 72-hour preferred-helper expiry ─────────────────────
      // Now we check hold_expires_at on the jobs table directly
      const { rows: expiredJobs } = await db.query(`
        SELECT
          j.id AS job_id, j.held_for_helper_id, j.planned_need_id,
          pn.id AS pn_id, pn.user_id, pn.title,
          ph.first_name AS helper_first_name
        FROM jobs j
        LEFT JOIN planned_needs pn ON pn.id = j.planned_need_id
        LEFT JOIN users ph ON ph.id = j.held_for_helper_id
        WHERE j.held_for_helper_id IS NOT NULL
          AND j.hold_expires_at <= NOW()
      `);

      if (expiredJobs.length > 0) {
        logger.info(`[Cron] ${expiredJobs.length} preferred-helper hold(s) expired`);
      }

      for (const row of expiredJobs) {
        try {
          // Clear the hold — job stays published, now open to everyone
          await db.query(`
            UPDATE jobs
            SET held_for_helper_id = NULL,
                hold_expires_at   = NULL,
                updated_at        = NOW()
            WHERE id = $1
          `, [row.job_id]);

          // Update planned_needs status
          if (row.pn_id) {
            await db.query(`
              UPDATE planned_needs
              SET preferred_helper_status = 'expired', updated_at = NOW()
              WHERE id = $1
            `, [row.pn_id]);
          }

          const helperName = row.helper_first_name || 'Your preferred helper';
          if (row.user_id) {
            await sendNotification({
              userId:     row.user_id,
              type:       'planned_need_expired',
              title:      'Preferred helper didn\'t respond',
              body:       `${helperName} didn't confirm availability for "${row.title}" within 72 hours. The job is now open to all helpers nearby.`,
              data:       { job_id: row.job_id, planned_need_id: row.pn_id },
              action_url: `/jobs/${row.job_id}`,
            });
          }
          logger.info(`[Cron] Expired hold on job ${row.job_id}, now open to all`);
        } catch (innerErr) {
          logger.error(`[Cron] Failed to expire hold on job ${row.job_id}:`, innerErr);
        }
      }

      // Also clean up old planned_needs records still showing 'pending'
      await db.query(`
        UPDATE planned_needs
        SET preferred_helper_status = 'expired', updated_at = NOW()
        WHERE preferred_helper_status = 'pending'
          AND helper_notified_at <= NOW() - INTERVAL '72 hours'
      `);

      logger.info('[Cron] Planned needs scheduler complete.');
    } catch (err) {
      logger.error('[Cron] Planned needs scheduler error:', err);
    }
  }, { timezone: 'America/New_York' });
};

function categoryToJobName(category) {
  const map = {
    car_care:      'Auto Repair',
    personal_care: 'General Labor',
    other:         'Other / Specify in Description',
  };
  return map[category] || 'Other / Specify in Description';
}

module.exports = { startPlannedNeedsScheduler, get plannedNeedsJob() { return plannedNeedsJob; } };
