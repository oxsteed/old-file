const cron                 = require('node-cron');
const db                   = require('../db');
const { sendNotification } = require('../services/notificationService');

/**
 * Planned Needs Scheduler — runs daily at 6 AM Eastern.
 *
 *  Pass 1 — Mark "activating_soon"
 *    Needs where activation day is tomorrow get a heads-up status.
 *
 *  Pass 2 — Auto-publish
 *    Needs where (due_date − lead_time_days) <= today get a job post.
 *    • No preferred helper  → job published immediately to all.
 *    • Preferred helper set → job created as 'open' (held), helper notified.
 *
 *  Pass 3 — 72-hour preferred-helper expiry
 *    Needs whose preferred helper was notified 72+ hours ago and hasn't
 *    responded: job is broadcast to all helpers, customer is notified.
 */
const startPlannedNeedsScheduler = () => {
  cron.schedule('0 6 * * *', async () => {
    console.log('[Cron] Running planned needs scheduler...');

    try {
      // ── Pass 1: activating_soon ───────────────────────────────────────
      const { rowCount: soonCount } = await db.query(`
        UPDATE planned_needs
        SET status = 'activating_soon', updated_at = NOW()
        WHERE status IN ('planned', 'funding')
          AND (due_date - lead_time_days - 1) = CURRENT_DATE
      `);
      if (soonCount > 0) {
        console.log(`[Cron] Marked ${soonCount} need(s) as activating_soon`);
      }

      // ── Pass 2: auto-publish ──────────────────────────────────────────
      const { rows: toPublish } = await db.query(`
        SELECT
          pn.id, pn.user_id, pn.title, pn.description, pn.category,
          pn.estimated_cost, pn.due_date, pn.lead_time_days,
          pn.preferred_helper_id,
          u.location_city, u.location_state, u.location_zip,
          u.location_lat,  u.location_lng,
          ph.first_name AS helper_first_name
        FROM planned_needs pn
        JOIN users u ON u.id = pn.user_id
        LEFT JOIN users ph ON ph.id = pn.preferred_helper_id
        WHERE pn.status IN ('planned', 'funding', 'activating_soon')
          AND (pn.due_date - pn.lead_time_days) <= CURRENT_DATE
      `);

      console.log(`[Cron] ${toPublish.length} need(s) ready to auto-publish`);

      for (const need of toPublish) {
        try {
          const categoryName = categoryToJobName(need.category);
          const cost         = parseFloat(need.estimated_cost || 0);
          const budgetType   = cost > 0 ? 'fixed' : 'open';
          const budgetMin    = cost > 0 ? Math.round(cost * 0.8 * 100) / 100 : null;
          const budgetMax    = cost > 0 ? cost : null;
          const description  = need.description
            || `Auto-scheduled: ${need.title}. Posted automatically from Planned Needs.`;

          const hasPreferred = !!need.preferred_helper_id;

          // Jobs held for a preferred helper start as 'open' (not public).
          // Jobs with no preferred helper publish immediately.
          const jobStatus = hasPreferred ? 'open' : 'published';

          const { rows: jobRows } = await db.query(`
            INSERT INTO jobs
              (client_id, title, description, category_name, status,
               budget_type, budget_min, budget_max,
               location_city, location_state, location_zip,
               scheduled_date, expires_at, metadata)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                    NOW() + INTERVAL '30 days',
                    jsonb_build_object('source','planned_need','planned_need_id',$13))
            RETURNING id
          `, [
            need.user_id, need.title, description, categoryName, jobStatus,
            budgetType, budgetMin, budgetMax,
            need.location_city || null, need.location_state || null, need.location_zip || null,
            need.due_date, need.id,
          ]);

          const jobId = jobRows[0].id;

          if (hasPreferred) {
            // Hold: notify preferred helper, set 72h timer
            await db.query(`
              UPDATE planned_needs
              SET status                   = 'published',
                  published_job_id         = $2,
                  published_at             = NOW(),
                  preferred_helper_status  = 'pending',
                  helper_notified_at       = NOW(),
                  updated_at               = NOW()
              WHERE id = $1
            `, [need.id, jobId]);

            await sendNotification({
              userId:     need.preferred_helper_id,
              type:       'planned_need_request',
              title:      'A customer wants to hire you',
              body:       `${need.title} is scheduled and they'd like you to handle it. Confirm your availability within 72 hours.`,
              data:       { job_id: jobId, planned_need_id: need.id },
              action_url: `/jobs/${jobId}`,
            });

            console.log(`[Cron] Published need ${need.id} → job ${jobId} (held for helper ${need.preferred_helper_id})`);
          } else {
            // Broadcast immediately
            await db.query(`
              UPDATE planned_needs
              SET status           = 'published',
                  published_job_id = $2,
                  published_at     = NOW(),
                  updated_at       = NOW()
              WHERE id = $1
            `, [need.id, jobId]);

            console.log(`[Cron] Published need ${need.id} → job ${jobId} (${need.title})`);
          }
        } catch (innerErr) {
          console.error(`[Cron] Failed to publish need ${need.id}:`, innerErr);
        }
      }

      // ── Pass 3: 72-hour preferred-helper expiry ───────────────────────
      const { rows: expired } = await db.query(`
        SELECT
          pn.id, pn.user_id, pn.title, pn.published_job_id,
          pn.preferred_helper_id,
          ph.first_name AS helper_first_name
        FROM planned_needs pn
        LEFT JOIN users ph ON ph.id = pn.preferred_helper_id
        WHERE pn.preferred_helper_status = 'pending'
          AND pn.helper_notified_at <= NOW() - INTERVAL '72 hours'
      `);

      if (expired.length > 0) {
        console.log(`[Cron] ${expired.length} preferred-helper hold(s) expired`);
      }

      for (const need of expired) {
        try {
          // Broadcast the held job to all helpers (flip to 'published')
          if (need.published_job_id) {
            await db.query(
              "UPDATE jobs SET status = 'published', updated_at = NOW() WHERE id = $1",
              [need.published_job_id]
            );
          }

          await db.query(`
            UPDATE planned_needs
            SET preferred_helper_status = 'expired', updated_at = NOW()
            WHERE id = $1
          `, [need.id]);

          const helperName = need.helper_first_name || 'Your preferred helper';

          await sendNotification({
            userId:     need.user_id,
            type:       'planned_need_expired',
            title:      'Preferred helper didn\'t respond',
            body:       `${helperName} didn't confirm availability for "${need.title}" within 72 hours. The job is now open to all helpers nearby.`,
            data:       { job_id: need.published_job_id, planned_need_id: need.id },
            action_url: need.published_job_id ? `/jobs/${need.published_job_id}` : '/planned-needs',
          });

          console.log(`[Cron] Expired hold on need ${need.id}, job ${need.published_job_id} now public`);
        } catch (innerErr) {
          console.error(`[Cron] Failed to expire hold on need ${need.id}:`, innerErr);
        }
      }

      console.log('[Cron] Planned needs scheduler complete.');
    } catch (err) {
      console.error('[Cron] Planned needs scheduler error:', err);
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

module.exports = { startPlannedNeedsScheduler };
