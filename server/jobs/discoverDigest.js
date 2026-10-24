const cron = require('node-cron');
const { withFencedJobLock } = require('./jobLockingService');
const logger = require('../utils/logger');
const { runDiscoverDigestTick } = require('../controllers/discoverController');

/** Daily digests after 9am Eastern; bounded catch-up batches drain during the day. */
function startDiscoverDigestJob() {
  cron.schedule('*/10 9-23 * * *', async () => {
    try {
      await withFencedJobLock('discover-digest', (fence) => runDiscoverDigestTick({ fence, limit: 100 }));
    } catch (err) {
      logger.error('[discoverDigest] job failed', { err: err.message });
    }
  }, { timezone: 'America/New_York' });
}

module.exports = { startDiscoverDigestJob };
