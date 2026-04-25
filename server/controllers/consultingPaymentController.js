const db = require('../db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const logger = require('../utils/logger');

// Get available consulting packages
exports.getPackages = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, service_tier, package_name, description, base_price, duration_hours, includes_deliverables, max_revisions
       FROM consulting_packages
       ORDER BY base_price ASC`
    );

    res.json(rows);
  } catch (err) {
    logger.error('Failed to get packages', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch packages' });
  }
};

// Create payment intent for consulting session
exports.createPaymentIntent = async (req, res) => {
  try {
    const { sessionId, packageId } = req.body;

    if (!sessionId || !packageId) {
      return res.status(400).json({ error: 'Session and package ID required' });
    }

    // Get session details
    const { rows: sessionRows } = await db.query(
      `SELECT cs.id, cs.customer_id, cs.email, cs.first_name, cs.last_name,
              cs.service_tier, css.id as scheduled_id
       FROM consulting_sessions cs
       LEFT JOIN consulting_sessions_scheduled css ON cs.id = css.session_id
       WHERE css.id = $1`,
      [sessionId]
    );

    if (sessionRows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionRows[0];

    // Get package details
    const { rows: packageRows } = await db.query(
      `SELECT id, service_tier, package_name, base_price
       FROM consulting_packages
       WHERE id = $1`,
      [packageId]
    );

    if (packageRows.length === 0) {
      return res.status(404).json({ error: 'Package not found' });
    }

    const pkg = packageRows[0];

    // Create Stripe payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: pkg.base_price,
      currency: 'usd',
      metadata: {
        sessionId: session.id,
        sessionScheduledId: session.scheduled_id,
        packageId: pkg.id,
      },
    });

    // Store payment in DB
    const { rows: paymentRows } = await db.query(
      `INSERT INTO consulting_payments (session_scheduled_id, amount_cents, service_tier, status, stripe_payment_intent_id)
       VALUES ($1, $2, $3, 'processing', $4)
       RETURNING *`,
      [session.scheduled_id, pkg.base_price, pkg.service_tier, paymentIntent.id]
    );

    res.json({
      clientSecret: paymentIntent.client_secret,
      payment: paymentRows[0],
      package: pkg,
    });
  } catch (err) {
    logger.error('Failed to create payment intent', { error: err.message });
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
};

// Confirm payment (called after Stripe completes)
exports.confirmPayment = async (req, res) => {
  try {
    const { paymentId, stripePaymentIntentId } = req.body;

    if (!paymentId || !stripePaymentIntentId) {
      return res.status(400).json({ error: 'Payment ID and Stripe PI ID required' });
    }

    // Verify with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    // Update payment status
    const { rows } = await db.query(
      `UPDATE consulting_payments
       SET status = 'completed', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [paymentId]
    );

    logger.info('Consulting payment completed', { paymentId, stripePaymentIntentId });
    res.json(rows[0]);
  } catch (err) {
    logger.error('Failed to confirm payment', { error: err.message });
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
};

// Get payment status
exports.getPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const { rows } = await db.query(
      `SELECT id, session_scheduled_id, amount_cents, service_tier, status, created_at
       FROM consulting_payments
       WHERE id = $1`,
      [paymentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    logger.error('Failed to get payment status', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
};

// Refund payment
exports.refundPayment = async (req, res) => {
  try {
    const { paymentId, reason } = req.body;

    if (!paymentId) {
      return res.status(400).json({ error: 'Payment ID required' });
    }

    const { rows: paymentRows } = await db.query(
      `SELECT * FROM consulting_payments WHERE id = $1`,
      [paymentId]
    );

    if (paymentRows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentRows[0];

    if (!payment.stripe_payment_intent_id) {
      return res.status(400).json({ error: 'No Stripe payment to refund' });
    }

    // Create refund via Stripe
    await stripe.refunds.create({
      payment_intent: payment.stripe_payment_intent_id,
      reason: reason || 'requested_by_customer',
    });

    // Update payment status
    const { rows } = await db.query(
      `UPDATE consulting_payments
       SET status = 'refunded', refund_reason = $1, refunded_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [reason || null, paymentId]
    );

    logger.info('Consulting payment refunded', { paymentId, reason });
    res.json(rows[0]);
  } catch (err) {
    logger.error('Failed to refund payment', { error: err.message });
    res.status(500).json({ error: 'Failed to refund payment' });
  }
};
