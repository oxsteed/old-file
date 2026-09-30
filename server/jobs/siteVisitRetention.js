'use strict';

/**
 * siteVisitRetention.js
 *
 * Prunes site_visits rows older than the retention window (default 90 days,
 * configurable via SITE_VISIT_RETENTION_DAYS). Visitor history is
 * privacy-sensitive: raw IPs are never stored (only salted hashes), and rows
 * age out automatically. Runs daily at 3 AM UTC.
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const { pruneOldVisits } = require('../services/siteVisitService');

const RETENTION_DAYS = Math.max(1, parseInt(process.env.SITE_VISIT_RETENTION_DAYS, 10) || 90);

const startSiteVisitRetentionJob = () => {
  cron.schedule('0 3 * * *', async () => {
    try {
      const deleted = await pruneOldVisits(RETENTION_DAYS);
      if (deleted > 0) {
        logger.info('Site visit retention prune completed', { deleted, retentionDays: RETENTION_DAYS });
      }
    } catch (err) {
      logger.error('Site visit retention prune failed', { error: err.message });
    }
  });
};

module.exports = { startSiteVisitRetentionJob, RETENTION_DAYS };
