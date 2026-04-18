// Payment processing queue
// Decouples payment processing from API requests to prevent blocking
// Uses Redis (existing ioredis connection) for job storage and processing

const Redis = require('ioredis');
const logger = require('../utils/logger');

// Connect to Redis (uses existing REDIS_URL env var)
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  retryStrategy: (times) => Math.min(times * 50, 2000),
  enableReadyCheck: false,
  enableOfflineQueue: true,
});

redis.on('error', (err) => {
  logger.error('Queue Redis connection error', { error: err.message });
});

redis.on('connect', () => {
  logger.info('Queue Redis connection established');
});

const QUEUES = {
  PAYMENT_CAPTURE: 'queue:payment-capture',
  STRIPE_WEBHOOK: 'queue:stripe-webhook',
  NOTIFICATIONS: 'queue:notifications',
};

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Add a job to a queue (FIFO with retry support)
 * @param {string} queueKey - Queue name (QUEUES.*)
 * @param {object} jobData - Job payload
 * @param {string} jobId - Unique job identifier (for deduplication)
 * @returns {Promise<string>} Job ID
 */
const addJob = async (queueKey, jobData, jobId) => {
  try {
    const job = {
      id: jobId,
      data: jobData,
      attempts: 0,
      createdAt: Date.now(),
      status: 'pending',
    };

    await redis.lpush(queueKey, JSON.stringify(job));
    logger.info('Job queued', { queueKey, jobId });
    return jobId;
  } catch (err) {
    logger.error('Failed to queue job', { queueKey, jobId, error: err.message });
    throw err;
  }
};

/**
 * Retrieve next job from queue (for worker to process)
 * @param {string} queueKey - Queue name
 * @returns {Promise<object|null>} Job object or null if queue empty
 */
const getNextJob = async (queueKey) => {
  try {
    const jobStr = await redis.rpop(queueKey);
    if (!jobStr) return null;

    const job = JSON.parse(jobStr);
    logger.debug('Retrieved job from queue', { queueKey, jobId: job.id });
    return job;
  } catch (err) {
    logger.error('Failed to retrieve job from queue', { queueKey, error: err.message });
    return null;
  }
};

/**
 * Re-queue job if it failed (with exponential backoff)
 * @param {string} queueKey - Queue name
 * @param {object} job - Job object
 * @returns {Promise<boolean>} true if re-queued, false if max retries exceeded
 */
const retryJob = async (queueKey, job) => {
  try {
    if (job.attempts >= MAX_RETRIES) {
      logger.warn('Job max retries exceeded', { queueKey, jobId: job.id, attempts: job.attempts });
      return false;
    }

    job.attempts += 1;
    job.nextRetryAt = Date.now() + (RETRY_DELAY_MS * job.attempts);

    // Use ZSET for delayed retry (sorted by retry timestamp)
    const delayedQueueKey = `${queueKey}:delayed`;
    await redis.zadd(delayedQueueKey, job.nextRetryAt, JSON.stringify(job));
    logger.info('Job re-queued with delay', { queueKey, jobId: job.id, nextRetryMs: job.nextRetryAt - Date.now() });
    return true;
  } catch (err) {
    logger.error('Failed to re-queue job', { queueKey, jobId: job.id, error: err.message });
    return false;
  }
};

/**
 * Mark job as completed
 * @param {string} queueKey - Queue name
 * @param {string} jobId - Job ID
 */
const completeJob = async (queueKey, jobId) => {
  try {
    await redis.setex(`job:${jobId}:complete`, 86400, '1'); // Keep for 24h
    logger.info('Job completed', { queueKey, jobId });
  } catch (err) {
    logger.error('Failed to mark job complete', { jobId, error: err.message });
  }
};

// Export queue interface
module.exports = {
  // Queue names for workers
  QUEUES,

  // Job management
  addJob,
  getNextJob,
  retryJob,
  completeJob,

  // Convenience methods for specific job types
  queuePaymentCapture: async (paymentId, jobId, amount) => {
    return addJob(QUEUES.PAYMENT_CAPTURE, { paymentId, jobId, amount }, `capture-${paymentId}`);
  },

  queueStripeWebhook: async (eventType, eventData) => {
    return addJob(QUEUES.STRIPE_WEBHOOK, { eventType, eventData }, `webhook-${eventData.id}`);
  },

  queueNotification: async (userId, type, data) => {
    return addJob(QUEUES.NOTIFICATIONS, { userId, type, data }, `notif-${userId}-${Date.now()}`);
  },

  // Graceful shutdown
  closeQueue: async () => {
    try {
      await redis.quit();
      logger.info('Queue Redis connection closed gracefully');
    } catch (err) {
      logger.error('Error closing queue Redis', err);
    }
  },

  // Health check
  ping: async () => {
    try {
      await redis.ping();
      return true;
    } catch {
      return false;
    }
  },

  // Redis client access (for worker processes)
  redis,
};
