#!/usr/bin/env node
/**
 * Payment Worker Process
 * Run separately from main API server: node workerMain.js
 * Polls Redis queues and processes jobs (payment capture, webhooks, notifications)
 * Handles retries with exponential backoff
 */

const logger = require('./utils/logger');
const {
  QUEUES,
  getNextJob,
  retryJob,
  completeJob,
  closeQueue,
} = require('./services/paymentQueue');
const {
  processPaymentCapture,
  processStripeWebhook,
  processNotification,
} = require('./workers/paymentWorker');
const { pollTranslationJobs } = require('./modules/jobs/translationJobWorker');

// Map queue to processor function
const processors = {
  [QUEUES.PAYMENT_CAPTURE]: processPaymentCapture,
  [QUEUES.STRIPE_WEBHOOK]: processStripeWebhook,
  [QUEUES.NOTIFICATIONS]: processNotification,
};

// Concurrency limits per queue
const concurrency = {
  [QUEUES.PAYMENT_CAPTURE]: 2,      // Avoid overwhelming Stripe API
  [QUEUES.STRIPE_WEBHOOK]: 3,       // Process webhooks quickly
  [QUEUES.NOTIFICATIONS]: 5,        // Notifications can be parallel
};

// Track active jobs per queue
const activeJobs = new Map(Object.values(QUEUES).map(q => [q, 0]));

/**
 * Process a single job
 * @param {string} queueKey - Queue name
 * @param {object} job - Job object
 */
const processJob = async (queueKey, job) => {
  const processor = processors[queueKey];
  if (!processor) {
    logger.error('No processor for queue', { queueKey });
    return;
  }

  try {
    const result = await processor(job);
    await completeJob(queueKey, job.id);
    logger.info('Job processed successfully', { queueKey, jobId: job.id, result });
  } catch (err) {
    logger.error('Job processing failed', { queueKey, jobId: job.id, error: err.message });

    // Attempt retry
    const requeued = await retryJob(queueKey, job);
    if (!requeued) {
      logger.error('Job discarded (max retries exceeded)', { queueKey, jobId: job.id });
    }
  }
};

/**
 * Poll and process jobs from a queue
 * @param {string} queueKey - Queue name
 */
const pollQueue = async (queueKey) => {
  const maxConcurrency = concurrency[queueKey] || 1;

  if (activeJobs.get(queueKey) >= maxConcurrency) {
    return; // Hit concurrency limit, skip this queue
  }

  try {
    const job = await getNextJob(queueKey);
    if (!job) return; // Queue is empty

    activeJobs.set(queueKey, activeJobs.get(queueKey) + 1);

    // Process job asynchronously (don't wait)
    processJob(queueKey, job)
      .catch((err) => logger.error('Uncaught job processing error', { queueKey, error: err.message }))
      .finally(() => {
        activeJobs.set(queueKey, activeJobs.get(queueKey) - 1);
      });
  } catch (err) {
    logger.error('Failed to poll queue', { queueKey, error: err.message });
  }
};

/**
 * Main worker loop
 * Polls all queues in round-robin fashion
 */
const runWorker = async () => {
  const queueList = Object.values(QUEUES);
  let queueIndex = 0;

  setInterval(() => {
    const queueKey = queueList[queueIndex];
    pollQueue(queueKey);
    queueIndex = (queueIndex + 1) % queueList.length;
  }, 500); // Poll every 500ms (adjustable)

  setInterval(() => {
    pollTranslationJobs().catch((err) => {
      logger.error('Translation worker loop failed', { error: err.message });
    });
  }, 1500);

  logger.info('✅ Worker started, polling payment queues and translation jobs');
};

// Graceful shutdown handler
const shutdown = async (signal) => {
  logger.info(`Received ${signal}, shutting down worker gracefully...`);
  try {
    // Wait for active jobs to complete (with timeout)
    const timeout = setTimeout(() => {
      logger.warn('Shutdown timeout: forcing exit', { activeJobs: Array.from(activeJobs.entries()) });
      process.exit(0);
    }, 10000);

    // Wait for all active jobs to drain
    while (Array.from(activeJobs.values()).some(count => count > 0)) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    clearTimeout(timeout);
    await closeQueue();
    logger.info('Worker shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start worker
runWorker().catch((err) => {
  logger.error('Failed to start worker', err);
  process.exit(1);
});
