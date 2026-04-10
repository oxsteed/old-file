const cron                 = require('node-cron');
const logger = require('../utils/logger');
const db                   = require('../db');
const { sendNotification } = require('../services/notificationService');

/**
 * Every Monday at 8am Eastern
 * Send each active helper their weekly earnings + job summary
 */
let weeklyJob = null;

const startWeeklySummaryJob = () => {
  weeklyJob = cron.schedule('0 8 * * 1', async () => {
    logger.info('[Cron] Running weekly summary emails...');
    try {
      const { rows: helpers } = await db.query(`
        SELECT
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
          AND (u.role = 'helper' OR u.role = 'both' OR u.role = 'broker')
      `);

      let sent = 0;
      for (const helper of helpers) {
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
      }

      logger.info(`[Cron] Weekly summaries sent: ${sent}`);
    } catch (err) {
      logger.error('[Cron] Weekly summary error:', err);
    }
  }, { timezone: 'America/New_York' });
};

module.exports = { startWeeklySummaryJob, get weeklyJob() { return weeklyJob; } };
