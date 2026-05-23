const logger = require('../../utils/logger');
const { processNextBatchJob } = require('../translation/translationService');

let isRunning = false;

async function pollTranslationJobs() {
  if (isRunning) return null;
  isRunning = true;
  try {
    return await processNextBatchJob();
  } catch (err) {
    logger.error('Translation job worker poll failed', { err: err.message });
    return null;
  } finally {
    isRunning = false;
  }
}

module.exports = {
  pollTranslationJobs,
};
