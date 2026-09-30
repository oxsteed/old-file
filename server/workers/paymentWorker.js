// Payment processing worker
// Runs independently to process queued jobs from Redis
// Decoupled from API request-response cycle

const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { captureAuthorizedPayment } = require('../services/paymentCaptureService');
const { sendNotification } = require('../services/notificationService');
const localDeliveryPayments = require('../services/localDeliveryPaymentService');
const { applyChargeRefund } = require('../services/paymentRefundStateService');
const { stripeObjectId } = require('../utils/stripePayload');

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
    const deliveryResult = await localDeliveryPayments.handleStripeEvent({
      type: eventType,
      data: { object: eventData },
      account: job.data.account,
    });
    if (deliveryResult.handled) return deliveryResult;
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

function requirePaymentUpdate(result, reference) {
  if (Number(result?.rowCount || 0) !== 1) {
    throw new Error(`No local payment matched Stripe webhook ${reference}`);
  }
}

const handlePaymentIntentSucceeded = async (intent) => {
  await withTransaction(pool, async (client) => {
    const result = await client.query(
       `UPDATE payments
       SET status = $1, stripe_charge_id = $2, updated_at = now()
       WHERE stripe_payment_intent_id = $3`,
      ['succeeded', stripeObjectId(intent.latest_charge) || intent.charges?.data?.[0]?.id || null, intent.id]
    );
    requirePaymentUpdate(result, intent.id);
  });
  logger.info('Webhook: payment_intent.succeeded processed', { intentId: intent.id });
  return { handled: true };
};

const handlePaymentIntentFailed = async (intent) => {
  await withTransaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE payments
       SET status = $1, error_message = $2, updated_at = now()
       WHERE stripe_payment_intent_id = $3`,
      ['failed', intent.last_payment_error?.message || 'Payment failed', intent.id]
    );
    requirePaymentUpdate(result, intent.id);
  });
  logger.warn('Webhook: payment_intent.payment_failed processed', { intentId: intent.id });
  return { handled: true };
};

const handleChargeRefunded = async (charge) => {
  await withTransaction(pool, async (client) => {
    const result = await applyChargeRefund(client, charge);
    requirePaymentUpdate(result, charge.id);
  });
  logger.info('Webhook: charge.refunded processed', { chargeId: charge.id });
  return { handled: true };
};

/**
 * Process notification job
 * @param {object} job - Job object with { userId, type, data }
 */
const processNotification = async (job) => {
  const {
    userId,
    type,
    title,
    body,
    data = {},
    action_url: actionUrl = null,
    pushToken = null,
  } = job.data || {};
  logger.info('Processing notification', { userId, type });

  try {
    const result = await sendNotification({
      userId,
      type,
      title: title || type || 'OxSteed notification',
      body: body || '',
      data,
      action_url: actionUrl,
      pushToken,
    });
    if (!result?.success) {
      throw new Error(result?.error || result?.reason || 'Notification delivery failed');
    }

    logger.info('Notification sent', { userId, type, notificationId: result.notificationId || null });
    return { success: true, userId, type, notificationId: result.notificationId || null };
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
