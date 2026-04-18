// Payment processing queue
// Decouples payment processing from API requests to prevent blocking
// Uses Bull with Redis backend (or in-memory fallback)

const Queue = require('bull');
const logger = require('../utils/logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const queueConfig = {
  redis: REDIS_URL,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
};

// Create queues
const paymentCaptureQueue = new Queue('payment-capture', queueConfig);
const stripeWebhookQueue = new Queue('stripe-webhook', queueConfig);
const notificationQueue = new Queue('notifications', queueConfig);

// Event handlers for all queues
const setupQueueHandlers = (queue, queueName) => {
  queue.on('error', (err) => {
    logger.error(`Queue error (${queueName})`, { queue: queueName, error: err.message });
  });

  queue.on('failed', (job, err) => {
    logger.warn(`Job failed (${queueName})`, {
      queue: queueName,
      jobId: job.id,
      attemptsMade: job.attemptsMade,
      error: err.message,
    });
  });

  queue.on('completed', (job) => {
    logger.info(`Job completed (${queueName})`, {
      queue: queueName,
      jobId: job.id,
      processedOn: job.processedOn,
    });
  });
};

setupQueueHandlers(paymentCaptureQueue, 'payment-capture');
setupQueueHandlers(stripeWebhookQueue, 'stripe-webhook');
setupQueueHandlers(notificationQueue, 'notifications');

// Export queue instances
module.exports = {
  paymentCaptureQueue,
  stripeWebhookQueue,
  notificationQueue,

  // Helper to add a payment capture job
  queuePaymentCapture: async (paymentId, jobId, amount) => {
    try {
      const job = await paymentCaptureQueue.add(
        { paymentId, jobId, amount },
        { jobId: `capture-${paymentId}` }
      );
      logger.info('Payment capture queued', { paymentId, jobId: job.id });
      return job;
    } catch (err) {
      logger.error('Failed to queue payment capture', { paymentId, error: err.message });
      throw err;
    }
  },

  // Helper to add a webhook job
  queueStripeWebhook: async (eventType, eventData) => {
    try {
      const job = await stripeWebhookQueue.add(
        { eventType, eventData },
        { jobId: `webhook-${eventData.id}` }
      );
      logger.info('Stripe webhook queued', { eventType, jobId: job.id });
      return job;
    } catch (err) {
      logger.error('Failed to queue webhook', { eventType, error: err.message });
      throw err;
    }
  },

  // Helper to add a notification job
  queueNotification: async (userId, type, data) => {
    try {
      const job = await notificationQueue.add(
        { userId, type, data },
        { jobId: `notif-${userId}-${Date.now()}` }
      );
      logger.info('Notification queued', { userId, type, jobId: job.id });
      return job;
    } catch (err) {
      logger.error('Failed to queue notification', { userId, type, error: err.message });
      throw err;
    }
  },

  // Graceful shutdown
  closeQueues: async () => {
    try {
      await Promise.all([
        paymentCaptureQueue.close(),
        stripeWebhookQueue.close(),
        notificationQueue.close(),
      ]);
      logger.info('All queues closed gracefully');
    } catch (err) {
      logger.error('Error closing queues', err);
    }
  },
};
