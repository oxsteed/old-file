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
  deadLetterJob,
  completeJob,
  promoteDueRetries,
  isJobCompleted,
  renewJobLease,
  getVisibilityTimeoutMs,
  closeQueue,
} = require('./services/paymentQueue');
const {
  processPaymentCapture,
  processStripeWebhook,
  processNotification,
} = require('./workers/paymentWorker');
const { pollTranslationJobs } = require('./modules/jobs/translationJobWorker');
const { pollIssuanceCycle } = require('./jobs/statementIssuanceScheduler');
const {
  normalizeLocations,
  refreshEtas,
  evaluateGeofences,
  retryProviderWebhooks,
  reconcileCursors,
  detectStaleTrackers,
  cleanupTrackingLinks,
  enforceRetention,
} = require('./workers/deliveryTrackingWorkers');
const { clearStaleAvailableNow } = require('./workers/availabilityWorkers');
const { publishDueGuideVideos } = require('./controllers/learnController');
const { expireVortexTokens } = require('./workers/vortexTokenWorkers');

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
let pollInterval = null;
let translationInterval = null;
let trackingIntervals = [];
let stopping = false;
let shutdownPromise = null;

const jobLeaseRenewalIntervalMs = () => {
  const visibilityTimeout = typeof getVisibilityTimeoutMs === 'function'
    ? getVisibilityTimeoutMs()
    : 15 * 60 * 1000;
  return Math.max(1000, Math.min(Math.floor(Number(visibilityTimeout) / 3), 60 * 1000));
};

const startJobLeaseRenewal = (queueKey, job) => {
  if (!job?.__queuePayload || typeof renewJobLease !== 'function') return null;
  const timer = setInterval(() => {
    renewJobLease(queueKey, job)
      .catch((error) => logger.warn('Payment queue lease renewal failed', {
        queueKey,
        jobId: job.id,
        error: error.message,
      }));
  }, jobLeaseRenewalIntervalMs());
  timer.unref?.();
  return timer;
};

/**
 * Process a single job
 * @param {string} queueKey - Queue name
 * @param {object} job - Job object
 */
const processJob = async (queueKey, job) => {
  const processor = processors[queueKey];
  if (!processor) {
    logger.error('No processor for queue', { queueKey });
    try {
      await deadLetterJob(queueKey, job, new Error(`No processor configured for queue ${queueKey}`));
    } catch (err) {
      // Leave the claim recoverable if dead-letter preservation is unavailable.
      logger.error('Failed to preserve unprocessable job in dead-letter queue', {
        queueKey,
        jobId: job?.id,
        error: err.message,
      });
    }
    return;
  }

  let leaseTimer = null;
  try {
    if (await isJobCompleted(job.id)) {
      logger.info('Skipping already completed job', { queueKey, jobId: job.id });
      // The duplicate was still claimed from the queue; acknowledge it so the
      // stale payload cannot be reclaimed and retried forever.
      await completeJob(queueKey, job);
      return;
    }
    leaseTimer = startJobLeaseRenewal(queueKey, job);
    const result = await processor(job);
    await completeJob(queueKey, job);
    logger.info('Job processed successfully', { queueKey, jobId: job.id, result });
  } catch (err) {
    logger.error('Job processing failed', { queueKey, jobId: job.id, error: err.message });

    // Attempt retry
    const requeued = await retryJob(queueKey, job);
    if (!requeued) {
      try {
        await deadLetterJob(queueKey, job, err);
      } catch (deadLetterError) {
        logger.error('Failed to preserve job in dead-letter queue', {
          queueKey,
          jobId: job.id,
          error: deadLetterError.message,
        });
      }
    }
  } finally {
    if (leaseTimer) clearInterval(leaseTimer);
  }
};

/**
 * Poll and process jobs from a queue
 * @param {string} queueKey - Queue name
 */
const pollQueue = async (queueKey) => {
  if (stopping) return;
  const maxConcurrency = concurrency[queueKey] || 1;

  if (activeJobs.get(queueKey) >= maxConcurrency) {
    return; // Hit concurrency limit, skip this queue
  }

  try {
    await promoteDueRetries(queueKey);
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
 * Schedule a delivery tracking worker on a fixed interval, following the same
 * setInterval pattern as the translation worker. A per-worker in-flight guard
 * prevents overlapping runs when a pass takes longer than its interval.
 */
const trackingInFlight = new Set();

const scheduleTrackingWorker = (name, workerFn, intervalMs, options) => {
  const timer = setInterval(() => {
    if (stopping || trackingInFlight.has(name)) return;
    trackingInFlight.add(name);
    Promise.resolve()
      .then(() => workerFn(options))
      .then((summary) => logger.info('Tracking worker completed', { worker: name, summary }))
      .catch((err) => logger.error('Tracking worker failed', { worker: name, error: err.message }))
      .finally(() => trackingInFlight.delete(name));
  }, intervalMs);
  timer.unref?.();
  trackingIntervals.push(timer);
};

const TRACKING_WORKER_SCHEDULE = [
  // [name, workerFn, intervalMs, options]
  ['normalizeLocations', normalizeLocations, 2 * 60 * 1000, { limit: 200 }],
  ['refreshEtas', refreshEtas, 60 * 1000, { limit: 100 }],
  ['evaluateGeofences', evaluateGeofences, 2 * 60 * 1000, { limit: 100 }],
  ['retryProviderWebhooks', retryProviderWebhooks, 5 * 60 * 1000, { limit: 25 }],
  ['reconcileCursors', reconcileCursors, 5 * 60 * 1000, { limit: 100 }],
  ['detectStaleTrackers', detectStaleTrackers, 5 * 60 * 1000, { limit: 200 }],
  ['cleanupTrackingLinks', cleanupTrackingLinks, 5 * 60 * 1000, { limit: 200 }],
  ['enforceRetention', enforceRetention, 60 * 60 * 1000, { limit: 5000 }],
  // Clear stale "available now" readiness flags (12h TTL), every 15 minutes.
  ['clearStaleAvailableNow', clearStaleAvailableNow, 15 * 60 * 1000, { limit: 500 }],
  // Publish Learn guide video submissions pending 24h without an admin
  // block (Emile's decision 2026-10-01), every 5 minutes.
  ['publishDueGuideVideos', publishDueGuideVideos, 5 * 60 * 1000, { limit: 100 }],
  // Monthly statement issuance: discovers eligible accounts for the latest
  // closed UTC month and issues originals in bounded batches; always drains
  // the statement.ready outbox so notifications never stall. Every 5 minutes.
  ['statementIssuanceCycle',
    (options) => pollIssuanceCycle({ workerId: options.workerId, maxJobsPerProduct: options.maxJobsPerProduct }),
    5 * 60 * 1000, { workerId: 'worker-main', maxJobsPerProduct: 50 }],
  // Expire unused legacy Vortex invite tokens past their expires_at, hourly.
  ['expireVortexTokens', expireVortexTokens, 60 * 60 * 1000, { limit: 500 }],
];

/**
 * Main worker loop
 * Polls all queues in round-robin fashion
 */
const runWorker = async () => {
  if (pollInterval || translationInterval || trackingIntervals.length > 0) return;
  stopping = false;
  const queueList = Object.values(QUEUES);
  let queueIndex = 0;

  pollInterval = setInterval(() => {
    if (stopping) return;
    const queueKey = queueList[queueIndex];
    pollQueue(queueKey);
    queueIndex = (queueIndex + 1) % queueList.length;
  }, 500); // Poll every 500ms (adjustable)

  translationInterval = setInterval(() => {
    if (stopping) return;
    pollTranslationJobs().catch((err) => {
      logger.error('Translation worker loop failed', { error: err.message });
    });
  }, 1500);

  for (const [name, workerFn, intervalMs, options] of TRACKING_WORKER_SCHEDULE) {
    scheduleTrackingWorker(name, workerFn, intervalMs, options);
  }

  logger.info('✅ Worker started, polling payment queues, translation jobs, and delivery tracking workers');
};

// Graceful shutdown handler
const shutdown = async (signal) => {
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (translationInterval) {
    clearInterval(translationInterval);
    translationInterval = null;
  }
  for (const timer of trackingIntervals) {
    clearInterval(timer);
  }
  trackingIntervals = [];
  trackingInFlight.clear();

  shutdownPromise = (async () => {
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
  })();
  return shutdownPromise;
};

if (require.main === module) {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start worker
  runWorker().catch((err) => {
    logger.error('Failed to start worker', err);
    process.exit(1);
  });
}

module.exports = {
  processJob,
  pollQueue,
  runWorker,
  shutdown,
  TRACKING_WORKER_SCHEDULE,
};
