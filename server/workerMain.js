#!/usr/bin/env node
/**
 * Payment Worker Process
 * Run separately from main API server: node workerMain.js
 * Processes queued jobs (payment capture, webhooks, notifications)
 * Handles retries with exponential backoff
 */

const logger = require('./utils/logger');
const {
  paymentCaptureQueue,
  stripeWebhookQueue,
  notificationQueue,
  closeQueues,
} = require('./services/paymentQueue');
const {
  processPaymentCapture,
  processStripeWebhook,
  processNotification,
} = require('./workers/paymentWorker');

// Graceful shutdown handler
const shutdown = async (signal) => {
  logger.info(`Received ${signal}, shutting down worker gracefully...`);
  try {
    await closeQueues();
    logger.info('All queues closed');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Register job processors
const registerProcessors = async () => {
  try {
    // Payment capture processor (concurrency: 2 to avoid overwhelming payments API)
    await paymentCaptureQueue.process(2, processPaymentCapture);
    logger.info('Payment capture processor registered');

    // Stripe webhook processor (concurrency: 3)
    await stripeWebhookQueue.process(3, processStripeWebhook);
    logger.info('Stripe webhook processor registered');

    // Notification processor (concurrency: 5)
    await notificationQueue.process(5, processNotification);
    logger.info('Notification processor registered');

    logger.info('✅ Payment worker ready and listening for jobs');
  } catch (err) {
    logger.error('Failed to register job processors', err);
    process.exit(1);
  }
};

// Start worker
registerProcessors().catch((err) => {
  logger.error('Failed to start worker', err);
  process.exit(1);
});
