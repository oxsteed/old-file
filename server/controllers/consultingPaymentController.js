const db = require('../db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const logger = require('../utils/logger');
const { processExternalRefund } = require('../services/externalRefundService');

// Get available consulting packages (public, for marketing pages)
exports.getPackages = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, service_tier, package_name, description, base_price, duration_hours,
              includes_deliverables, max_revisions
       FROM consulting_packages
       WHERE COALESCE(is_active, TRUE) = TRUE
       ORDER BY base_price ASC`
    );

    res.json(rows);
  } catch (err) {
    logger.error('Failed to get packages', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch packages' });
  }
};

// Create payment intent for consulting session.
// Caller must be authenticated and own the session being paid for.
exports.createPaymentIntent = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId, packageId } = req.body;

    if (!sessionId || !packageId) {
      return res.status(400).json({ error: 'Session and package ID required' });
    }

    // Get session details - uses cs.user_id (the canonical column on consulting_sessions)
    const { rows: sessionRows } = await db.query(
      `SELECT cs.id, cs.user_id, cs.email, cs.first_name, cs.last_name,
              cs.service_tier, css.id as scheduled_id
       FROM consulting_sessions cs
       LEFT JOIN consulting_sessions_scheduled css ON cs.id = css.session_id
       WHERE cs.id = $1`,
      [sessionId]
    );

    if (sessionRows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionRows[0];

    // Authorization: only the session owner (or an admin) can initiate payment.
    const isOwner = session.user_id && session.user_id === req.user.id;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized for this session' });
    }

    if (!session.scheduled_id) {
      return res.status(400).json({ error: 'Session must be scheduled before payment' });
    }

    // Idempotency: don't create a second processing payment for the same session.
    const { rows: existingProcessing } = await db.query(
      `SELECT id, stripe_payment_intent_id FROM consulting_payments
       WHERE session_scheduled_id = $1 AND status IN ('pending', 'processing')`,
      [session.scheduled_id]
    );
    if (existingProcessing.length > 0) {
      return res.status(409).json({
        error: 'Payment already in progress for this session',
        paymentId: existingProcessing[0].id,
      });
    }

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

    // Create Stripe payment intent.
    // The idempotency key is deterministic per (scheduled session, package), so a
    // retried or double-submitted request replays the same PaymentIntent on
    // Stripe's side instead of creating a duplicate charge.
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: pkg.base_price,
        currency: 'usd',
        metadata: {
          sessionId: String(session.id),
          sessionScheduledId: String(session.scheduled_id),
          packageId: String(pkg.id),
          userId: String(req.user.id),
        },
      },
      { idempotencyKey: `consulting:${session.scheduled_id}:${pkg.id}` }
    );

    // Store payment in DB. The INSERT is the atomic guard: a partial unique
    // index on (session_scheduled_id) WHERE status IN ('pending','processing')
    // (migration 622) serializes concurrent requests here, so the early SELECT
    // above is only a fast-path UX check.
    const { rows: paymentRows } = await db.query(
      `INSERT INTO consulting_payments (session_scheduled_id, amount_cents, service_tier, status, stripe_payment_intent_id)
       VALUES ($1, $2, $3, 'processing', $4)
       ON CONFLICT (session_scheduled_id) WHERE status IN ('pending', 'processing') DO NOTHING
       RETURNING id, session_scheduled_id, amount_cents, service_tier, status, created_at`,
      [session.scheduled_id, pkg.base_price, pkg.service_tier, paymentIntent.id]
    );

    if (paymentRows.length === 0) {
      // Lost the race: a concurrent request created the processing payment
      // between our fast-path SELECT and this INSERT. Re-read the live row so
      // the client gets the same 409 shape as the fast-path guard.
      const { rows: raced } = await db.query(
        `SELECT id, stripe_payment_intent_id FROM consulting_payments
         WHERE session_scheduled_id = $1 AND status IN ('pending', 'processing')`,
        [session.scheduled_id]
      );
      return res.status(409).json({
        error: 'Payment already in progress for this session',
        paymentId: raced[0] ? raced[0].id : null,
      });
    }

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

// Confirm payment (called after Stripe completes).
// Idempotent: only transitions a payment from 'processing' to 'completed'.
exports.confirmPayment = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { paymentId, stripePaymentIntentId } = req.body;

    if (!paymentId || !stripePaymentIntentId) {
      return res.status(400).json({ error: 'Payment ID and Stripe PI ID required' });
    }

    // Authorization: verify the payment belongs to a session the user owns (or admin).
    const { rows: ownership } = await db.query(
      `SELECT cs.user_id, cp.amount_cents
       FROM consulting_payments cp
       JOIN consulting_sessions_scheduled css ON cp.session_scheduled_id = css.id
       JOIN consulting_sessions cs ON css.session_id = cs.id
       WHERE cp.id = $1 AND cp.stripe_payment_intent_id = $2`,
      [paymentId, stripePaymentIntentId]
    );

    if (ownership.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    if (ownership[0].user_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized for this payment' });
    }

    // Verify with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed' });
    }
    const expectedAmountCents = Number(ownership[0].amount_cents);
    const paidAmountCents = Number(paymentIntent.amount_received ?? paymentIntent.amount);
    const paidCurrency = String(paymentIntent.currency || '').toLowerCase();
    if (!Number.isInteger(expectedAmountCents) || expectedAmountCents <= 0
      || paidAmountCents !== expectedAmountCents || paidCurrency !== 'usd') {
      logger.warn('Consulting payment amount or currency mismatch', {
        paymentId,
        stripePaymentIntentId,
        expectedAmountCents,
        paidAmountCents,
        paidCurrency,
      });
      return res.status(409).json({ error: 'Payment amount or currency does not match this consulting payment.' });
    }

    // Conditional UPDATE: only transition processing → completed.
    // If row was already 'completed', no rows are returned (no-op idempotency).
    const { rows } = await db.query(
      `UPDATE consulting_payments
       SET status = 'completed', updated_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'processing')
       RETURNING id, session_scheduled_id, amount_cents, service_tier, status, created_at, updated_at`,
      [paymentId]
    );

    if (rows.length === 0) {
      // Already completed - return current state idempotently.
      const { rows: current } = await db.query(
        `SELECT id, session_scheduled_id, amount_cents, service_tier, status, created_at, updated_at
         FROM consulting_payments WHERE id = $1`,
        [paymentId]
      );
      return res.json(current[0] || { id: paymentId, status: 'unknown' });
    }

    logger.info('Consulting payment completed', {
      paymentId,
      stripePaymentIntentId,
      sessionScheduledId: rows[0].session_scheduled_id,
    });

    res.json(rows[0]);
  } catch (err) {
    logger.error('Failed to confirm payment', { error: err.message });
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
};

// Get payment status - restricted to payment owner or admin.
exports.getPaymentStatus = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { paymentId } = req.params;

    const { rows } = await db.query(
      `SELECT cp.id, cp.session_scheduled_id, cp.amount_cents, cp.service_tier,
              cp.status, cp.created_at, cs.user_id
       FROM consulting_payments cp
       JOIN consulting_sessions_scheduled css ON cp.session_scheduled_id = css.id
       JOIN consulting_sessions cs ON css.session_id = cs.id
       WHERE cp.id = $1`,
      [paymentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    if (rows[0].user_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized for this payment' });
    }

    // Strip user_id from response - internal field, not for client.
    const { user_id: _omit, ...paymentResponse } = rows[0];
    res.json(paymentResponse);
  } catch (err) {
    logger.error('Failed to get payment status', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
};

// Refund payment - admin only.
exports.refundPayment = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required to issue refunds' });
    }

    const { paymentId, reason } = req.body;
    if (!paymentId) {
      return res.status(400).json({ error: 'Payment ID required' });
    }

    const { rows: paymentRows } = await db.query(
      `SELECT id, status, amount_cents, stripe_payment_intent_id FROM consulting_payments WHERE id = $1`,
      [paymentId]
    );
    if (paymentRows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    const payment = paymentRows[0];

    if (payment.status === 'refunded') {
      return res.status(409).json({ error: 'Payment already refunded' });
    }
    if (payment.status !== 'completed') {
      return res.status(400).json({ error: 'Only completed payments can be refunded' });
    }
    if (!payment.stripe_payment_intent_id) {
      return res.status(400).json({ error: 'No Stripe payment to refund' });
    }

    // Provider call is durable and reconcilable. The consulting payment status
    // changes only after the provider confirms the exact refund.
    const refundResult = await processExternalRefund({
      rail: 'consulting',
      referenceId: payment.id,
      paymentIntentId: payment.stripe_payment_intent_id,
      amountCents: Number(payment.amount_cents),
      currency: 'USD',
      reason: reason || 'requested_by_customer',
      actorUserId: req.user.id,
      requestId: `consulting-payment-refund-${payment.id}`,
      metadata: { payment_id: payment.id },
    });
    if (refundResult.attempt.status !== 'succeeded') {
      return res.status(202).json({
        id: paymentId,
        status: 'refund_pending',
        refundStatus: refundResult.attempt.status,
        refundAttemptId: refundResult.attempt.id,
      });
    }

    // Conditional UPDATE: only refund if still 'completed' (prevents concurrent refund races).
    const { rows } = await db.query(
      `UPDATE consulting_payments
       SET status = 'refunded', refund_reason = $1, refunded_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND status = 'completed'
       RETURNING id, status, refund_reason, refunded_at`,
      [reason || null, paymentId]
    );

    if (rows.length === 0) {
      // Another concurrent refund won - but Stripe call already succeeded.
      // Stripe itself enforces idempotency on the refund; surface as no-op success.
      return res.json({ id: paymentId, status: 'refunded', note: 'concurrent refund detected' });
    }

    logger.info('Consulting payment refunded', { paymentId, adminId: req.user.id, reason });
    res.json(rows[0]);
  } catch (err) {
    logger.error('Failed to refund payment', { error: err.message });
    res.status(500).json({ error: 'Failed to refund payment' });
  }
};
