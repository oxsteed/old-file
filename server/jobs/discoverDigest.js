const cron = require('node-cron');
const logger = require('../utils/logger');
const { runDiscoverDigestTick } = require('../controllers/discoverController');

/** Daily 9am Eastern - email when saved Discover searches have new public matches */
function startDiscoverDigestJob() {
  cron.schedule('0 9 * * *', async () => {
    try {
      await runDiscoverDigestTick();
    } catch (err) {
      logger.error('[discoverDigest] job failed', { err: err.message });
    }
  }, { timezone: 'America/New_York' });
}

module.exports = { startDiscoverDigestJob };
