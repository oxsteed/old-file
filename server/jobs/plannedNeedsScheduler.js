const cron = require('node-cron');
const db   = require('../db');

/**
 * Planned Needs Scheduler — runs daily at 6 AM Eastern.
 *
 * Two passes per run:
 *
 *  Pass 1 — Mark "activating_soon"
 *    Needs that reach (due_date - lead_time_days - 1) today get a heads-up status
 *    so the UI can surface the warning before the publish fires tomorrow.
 *
 *  Pass 2 — Auto-publish
 *    Needs where (due_date - lead_time_days) <= today are published as live job posts.
 *    A minimal job record is inserted; the published_job_id FK is stored on the need.
 */
const startPlannedNeedsScheduler = () => {
  // Daily at 6:00 AM Eastern
  cron.schedule('0 6 * * *', async () => {
    console.log('[Cron] Running planned needs scheduler...');

    try {
      // ── Pass 1: activating_soon ───────────────────────────────────────
      // One day before the activation date (i.e. lead_time_days + 1 days before due)
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
      // Activation date has arrived: (due_date - lead_time_days) <= today
      const { rows: toPublish } = await db.query(`
        SELECT
          pn.id, pn.user_id, pn.title, pn.description, pn.category,
          pn.estimated_cost, pn.due_date, pn.lead_time_days,
          u.location_city, u.location_state, u.location_zip
        FROM planned_needs pn
        JOIN users u ON u.id = pn.user_id
        WHERE pn.status IN ('planned', 'funding', 'activating_soon')
          AND (pn.due_date - pn.lead_time_days) <= CURRENT_DATE
      `);

      console.log(`[Cron] ${toPublish.length} need(s) ready to auto-publish`);

      for (const need of toPublish) {
        try {
          const categoryName = categoryToJobName(need.category);

          // Build budget fields from estimated_cost (allow ±20% range)
          const cost    = parseFloat(need.estimated_cost || 0);
          const budgetType = cost > 0 ? 'fixed' : 'open';
          const budgetMin  = cost > 0 ? Math.round(cost * 0.8 * 100) / 100 : null;
          const budgetMax  = cost > 0 ? cost : null;

          const description = need.description
            || `Auto-scheduled: ${need.title}. Posted automatically from your Planned Needs.`;

          // Insert the job
          const { rows: jobRows } = await db.query(`
            INSERT INTO jobs
              (client_id, title, description, category_name, status,
               budget_type, budget_min, budget_max,
               location_city, location_state, location_zip,
               scheduled_date, expires_at, metadata)
            VALUES ($1,$2,$3,$4,'published',$5,$6,$7,$8,$9,$10,$11,
                    NOW() + INTERVAL '30 days',
                    jsonb_build_object('source','planned_need','planned_need_id',$12))
            RETURNING id
          `, [
            need.user_id, need.title, description, categoryName,
            budgetType, budgetMin, budgetMax,
            need.location_city || null, need.location_state || null, need.location_zip || null,
            need.due_date, need.id,
          ]);

          const jobId = jobRows[0].id;

          // Update the planned need
          await db.query(`
            UPDATE planned_needs
            SET status = 'published',
                published_job_id = $2,
                published_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
          `, [need.id, jobId]);

          console.log(`[Cron] Published need ${need.id} → job ${jobId} (${need.title})`);
        } catch (innerErr) {
          console.error(`[Cron] Failed to publish need ${need.id}:`, innerErr);
          // Continue to next need — don't abort the whole run
        }
      }

      console.log('[Cron] Planned needs scheduler complete.');
    } catch (err) {
      console.error('[Cron] Planned needs scheduler error:', err);
    }
  }, { timezone: 'America/New_York' });
};

/** Map planned need category → job category_name */
function categoryToJobName(category) {
  const map = {
    car_care:      'Auto Repair',
    personal_care: 'General Labor',
    other:         'Other / Specify in Description',
  };
  return map[category] || 'Other / Specify in Description';
}

module.exports = { startPlannedNeedsScheduler };
