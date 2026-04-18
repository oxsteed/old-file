const cron                 = require('node-cron');
const db                   = require('../db');
const { sendNotification } = require('../services/notificationService');
const { ROLES }            = require('../constants/roles');
const logger               = require('../utils/logger');

/**
 * Every Monday at 8am Eastern
 * Send each active helper their weekly earnings + job summary.
 * Each iteration is wrapped in its own try-catch so a single failure
 * does not abort the rest of the batch.
 */
const startWeeklySummaryJob = () => {
  cron.schedule('0 8 * * 1', async () => {
    logger.info('Weekly summary emails running');
    try {
      const { rows: helpers } = await db.query(
        `SELECT
          u.id, u.first_name, u.email,
          hp.earnings_mtd,
          hp.completed_jobs,
          (SELECT COUNT(*) FROM bids b
           JOIN jobs j ON b.job_id = j.id
           WHERE b.helper_id = u.id
             AND b.status = 'pending'
             AND j.status = 'published') AS active_bids,
          (SELECT COUNT(*) FROM jobs j
           WHERE j.client_id = u.id
             AND j.status = 'published') AS open_jobs_posted,
          np.email_weekly_summary
        FROM users u
        JOIN helper_profiles hp ON hp.user_id = u.id
        JOIN notification_preferences np ON np.user_id = u.id
        WHERE u.is_active = true
          AND np.email_weekly_summary = true
          AND u.role IN ($1, $2, $3)`,
        [ROLES.HELPER_FREE, ROLES.HELPER_PRO, ROLES.HELPER_BROKER]
      );

      let sent = 0;
      let failed = 0;

      for (const helper of helpers) {
        try {
          await sendNotification({
            userId: helper.id,
            type:   'weekly_summary',
            title:  `Your weekly OxSteed summary`,
            body:   `This week: $${parseFloat(helper.earnings_mtd || 0)
                      .toFixed(2)} earned MTD · ${helper.active_bids} active bids`,
            data: {
              earnings_mtd:       helper.earnings_mtd,
              completed_jobs:     helper.completed_jobs,
              active_bids:        helper.active_bids,
              open_jobs_posted:   helper.open_jobs_posted
            },
            action_url: '/dashboard'
          });
          sent++;
        } catch (helperErr) {
          failed++;
          logger.error('Weekly summary failed for helper', {
            helperId: helper.id,
            error: helperErr.message
          });
        }
      }

      logger.info('Weekly summaries complete', { sent, failed, total: helpers.length });
    } catch (err) {
      logger.error('Weekly summary job failed', { error: err.message });
    }
  }, { timezone: 'America/New_York' });
};

module.exports = { startWeeklySummaryJob };
