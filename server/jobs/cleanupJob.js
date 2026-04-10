// Session + expired data cleanup — runs daily at 3am ET
// OxSteed v2
const cron   = require('node-cron');
const db     = require('../db');
const logger = require('../utils/logger');

let cleanupJob = null;

const startCleanupJob = () => {
  cleanupJob = cron.schedule('0 3 * * *', async () => {
    logger.info('[Cron] Running daily cleanup...');
    try {
      // Remove expired / invalidated sessions older than 1 day
      const { rowCount: sessions } = await db.query(
        "DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '1 day'"
      );

      // Remove expired pending registrations (they expire in 1hr by default)
      const { rowCount: pendingRegs } = await db.query(
        "DELETE FROM pending_registrations WHERE expires_at < NOW() - INTERVAL '1 hour'"
      );

      logger.info('[Cron] Daily cleanup complete', { sessions, pendingRegs });
    } catch (err) {
      logger.error('[Cron] Daily cleanup error', { err });
    }
  }, { timezone: 'America/New_York' });
};

module.exports = { startCleanupJob, get cleanupJob() { return cleanupJob; } };
