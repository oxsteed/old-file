// Payment processing worker
// Runs independently to process queued payment capture jobs
// Decoupled from API request-response cycle

const pool = require('../db');
const logger = require('../utils/logger');
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Database transaction utility
const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Process payment capture job
const processPaymentCapture = async (job) => {
  const { paymentId, jobId, amount } = job.data;
  logger.info('Processing payment capture', { paymentId, jobId, amount });

  try {
    // Fetch payment record to get intent ID
    const paymentResult = await pool.query(
      'SELECT id, stripe_payment_intent_id, status FROM payments WHERE id = $1',
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    const payment = paymentResult.rows[0];
    if (!payment.stripe_payment_intent_id) {
      throw new Error(`No PaymentIntent for payment ${paymentId}`);
    }

    // Capture via Stripe
    const captured = await stripe.paymentIntents.capture(
      payment.stripe_payment_intent_id,
      { amount_to_capture: Math.round(amount * 100) }
    );

    // Update payment status in transaction
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE payments
         SET status = $1, stripe_charge_id = $2, updated_at = now()
         WHERE id = $3`,
        ['captured', captured.charges.data[0]?.id || null, paymentId]
      );

      logger.info('Payment captured', {
        paymentId,
        chargeId: captured.charges.data[0]?.id,
        amount: captured.amount_received / 100,
      });
    });

    return { success: true, paymentId, chargeId: captured.charges.data[0]?.id };
  } catch (error) {
    logger.error('Payment capture failed', {
      paymentId,
      jobId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

// Process Stripe webhook job
const processStripeWebhook = async (job) => {
  const { eventType, eventData } = job.data;
  logger.info('Processing Stripe webhook', { eventType, eventId: eventData.id });

  try {
    // Route to appropriate handler
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

// Webhook handlers
const handlePaymentIntentSucceeded = async (intent) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE payments
       SET status = $1, stripe_charge_id = $2, updated_at = now()
       WHERE stripe_payment_intent_id = $3`,
      ['succeeded', intent.charges.data[0]?.id, intent.id]
    );

    await client.query('COMMIT');
    logger.info('Webhook: payment_intent.succeeded processed', { intentId: intent.id });
    return { handled: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const handlePaymentIntentFailed = async (intent) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE payments
       SET status = $1, error_message = $2, updated_at = now()
       WHERE stripe_payment_intent_id = $3`,
      ['failed', intent.last_payment_error?.message || 'Payment failed', intent.id]
    );

    await client.query('COMMIT');
    logger.warn('Webhook: payment_intent.payment_failed processed', { intentId: intent.id });
    return { handled: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const handleChargeRefunded = async (charge) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE payments
       SET status = $1, refunded_amount = $2, updated_at = now()
       WHERE stripe_charge_id = $3`,
      ['refunded', charge.amount_refunded / 100, charge.id]
    );

    await client.query('COMMIT');
    logger.info('Webhook: charge.refunded processed', { chargeId: charge.id });
    return { handled: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Process notification job
const processNotification = async (job) => {
  const { userId, type, data } = job.data;
  logger.info('Processing notification', { userId, type });

  try {
    // Update notification status in DB
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
