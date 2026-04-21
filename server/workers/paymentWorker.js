// Payment processing worker
// Runs independently to process queued jobs from Redis
// Decoupled from API request-response cycle

const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { captureAuthorizedPayment } = require('../services/paymentCaptureService');

/**
 * Process payment capture job
 * @param {object} job - Job object with { paymentId, jobId, amount }
 */
const processPaymentCapture = async (job) => {
  const { paymentId, jobId, amount } = job.data;
  logger.info('Processing payment capture (worker)', { paymentId, jobId, amount });
  return captureAuthorizedPayment({ paymentId, jobId, amount });
};

/**
 * Process Stripe webhook job
 * @param {object} job - Job object with { eventType, eventData }
 */
const processStripeWebhook = async (job) => {
  const { eventType, eventData } = job.data;
  logger.info('Processing Stripe webhook', { eventType, eventId: eventData.id });

  try {
    switch (eventType) {
      case 'payment_intent.succeeded':
        return await handlePaymentIntentSucceeded(eventData);
      case 'payment_intent.payment_failed':
        return await handlePaymentIntentFailed(eventData);
      case 'charge.refunded':
        return await handleChargeRefunded(eventData);
      default:
        logger.warn('Unhandled webhook event type', { eventType });
        return { handled: false };
    }
  } catch (error) {
    logger.error('Webhook processing failed', {
      eventType,
      eventId: eventData.id,
      error: error.message,
    });
    throw error;
  }
};

const handlePaymentIntentSucceeded = async (intent) => {
  await withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE payments
       SET status = $1, stripe_charge_id = $2, updated_at = now()
       WHERE stripe_payment_intent_id = $3`,
      ['succeeded', intent.charges.data[0]?.id, intent.id]
    );
  });
  logger.info('Webhook: payment_intent.succeeded processed', { intentId: intent.id });
  return { handled: true };
};

const handlePaymentIntentFailed = async (intent) => {
  await withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE payments
       SET status = $1, error_message = $2, updated_at = now()
       WHERE stripe_payment_intent_id = $3`,
      ['failed', intent.last_payment_error?.message || 'Payment failed', intent.id]
    );
  });
  logger.warn('Webhook: payment_intent.payment_failed processed', { intentId: intent.id });
  return { handled: true };
};

const handleChargeRefunded = async (charge) => {
  await withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE payments
       SET status = $1, refunded_amount = $2, updated_at = now()
       WHERE stripe_charge_id = $3`,
      ['refunded', charge.amount_refunded / 100, charge.id]
    );
  });
  logger.info('Webhook: charge.refunded processed', { chargeId: charge.id });
  return { handled: true };
};

/**
 * Process notification job
 * @param {object} job - Job object with { userId, type, data }
 */
const processNotification = async (job) => {
  const { userId, type } = job.data;
  logger.info('Processing notification', { userId, type });

  try {
    await pool.query(
      `UPDATE notifications
       SET is_sent = true, sent_at = now()
       WHERE user_id = $1 AND type = $2 AND is_sent = false
       LIMIT 1`,
      [userId, type]
    );

    logger.info('Notification sent', { userId, type });
    return { success: true, userId, type };
  } catch (error) {
    logger.error('Notification processing failed', {
      userId,
      type,
      error: error.message,
    });
    throw error;
  }
};

// Export job processors
module.exports = {
  processPaymentCapture,
  processStripeWebhook,
  processNotification,
};
