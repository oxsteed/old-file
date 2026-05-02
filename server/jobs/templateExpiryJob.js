// server/jobs/templateExpiryJob.js
// Daily cron: expire timed template access grants, revert profiles to Default.

const pool   = require('../db');
const logger = require('../utils/logger');

const CRON_EXPRESSION = '0 3 * * *'; // 03:00 UTC daily

async function runTemplateExpiryJob() {
  logger.info('Template expiry job started');
  let expired = 0;
  let reverted = 0;

  try {
    // 1. Find all access records that have passed expiry_date but are still active
    const { rows: expiredRows } = await pool.query(
      `UPDATE template_access
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'active'
         AND expiry_date IS NOT NULL
         AND expiry_date <= NOW()
       RETURNING id, user_id, template_slug`
    );

    expired = expiredRows.length;
    logger.info('Template access records expired', { count: expired });

    // 2. For each expired record: revert businesses/helpers using that template to 'default'
    for (const row of expiredRows) {
      // Check if user still has any active access for this slug (e.g. lifetime purchase)
      const stillHasAccess = await pool.query(
        `SELECT id FROM template_access
         WHERE user_id = $1 AND template_slug = $2 AND status = 'active'
           AND (expiry_date IS NULL OR expiry_date > NOW())
         LIMIT 1`,
        [row.user_id, row.template_slug]
      );
      if (stillHasAccess.rows.length > 0) continue; // another access record covers them

      const bizResult = await pool.query(
        `UPDATE businesses SET active_template = 'default', updated_at = NOW()
         WHERE owner_id = $1 AND active_template = $2`,
        [row.user_id, row.template_slug]
      );
      const helperResult = await pool.query(
        `UPDATE helper_profiles SET active_template = 'default', updated_at = NOW()
         WHERE user_id = $1 AND active_template = $2`,
        [row.user_id, row.template_slug]
      );
      reverted += (bizResult.rowCount || 0) + (helperResult.rowCount || 0);
    }

    logger.info('Template expiry job completed', { expired, reverted });
    return { expired, reverted };
  } catch (err) {
    logger.error('Template expiry job failed', { error: err.message });
    throw err;
  }
}

function startTemplateExpiryJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runTemplateExpiryJob();
    } catch (err) {
      logger.error('Template expiry cron error', { error: err.message });
    }
  });
  logger.info('Template expiry job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = { startTemplateExpiryJob, runTemplateExpiryJob, cronExpression: CRON_EXPRESSION };
