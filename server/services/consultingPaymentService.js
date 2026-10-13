'use strict';

// Review P3-1067 / P3-1069 / P3-1070: one place that turns a Stripe
// PaymentIntent (or an admin-recorded off-platform payment) into a completed
// consulting_payments row, and one predicate bookings use to check payment.
const db = require('../db');
const logger = require('../utils/logger');

// Verifies amount/currency against the stored row and moves it to completed.
// Returns { status: 'completed' | 'already' | 'not_found' | 'mismatch' | 'not_succeeded', row }.
async function completeConsultingPaymentFromIntent(pi, { paymentId = null, client = db } = {}) {
  if (!pi?.id) return { status: 'not_found' };
  const { rows: found } = await client.query(
    `SELECT id, amount_cents, status FROM consulting_payments
     WHERE stripe_payment_intent_id = $1 ${paymentId ? 'AND id = $2' : ''}`,
    paymentId ? [pi.id, paymentId] : [pi.id],
  );
  const row = found[0];
  if (!row) return { status: 'not_found' };
  if (pi.status !== 'succeeded') return { status: 'not_succeeded', row };
  const expected = Number(row.amount_cents);
  const paid = Number(pi.amount_received ?? pi.amount);
  const currency = String(pi.currency || '').toLowerCase();
  if (!Number.isInteger(expected) || expected <= 0 || paid !== expected || currency !== 'usd') {
    logger.warn('Consulting payment amount or currency mismatch', { paymentId: row.id, pi: pi.id, expected, paid, currency });
    return { status: 'mismatch', row };
  }
  const { rows } = await client.query(
    `UPDATE consulting_payments
     SET status = 'completed', payment_method = COALESCE(payment_method, 'stripe'), updated_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'processing')
     RETURNING id, session_scheduled_id, amount_cents, service_tier, status, created_at, updated_at`,
    [row.id],
  );
  if (rows.length) return { status: 'completed', row: rows[0] };
  const { rows: current } = await client.query(
    `SELECT id, session_scheduled_id, amount_cents, service_tier, status, created_at, updated_at
     FROM consulting_payments WHERE id = $1`, [row.id],
  );
  return { status: 'already', row: current[0] || row };
}

// Stripe webhook entry point. Returns true when the event was ours.
async function applyConsultingPurchaseEvent(type, pi) {
  const purchaseId = Number(pi.metadata.consulting_purchase_id);
  if (type === 'payment_intent.succeeded') {
    const paid = Number(pi.amount_received ?? pi.amount);
    const { rows } = await db.query(
      `UPDATE consulting_purchases SET status = 'completed', updated_at = NOW()
       WHERE id = $1 AND payment_intent_id = $2 AND status = 'pending'
         AND total_cost_cents = $3 AND $4 = 'usd'
       RETURNING id`,
      [purchaseId, pi.id, paid, String(pi.currency || '').toLowerCase()],
    );
    if (!rows.length) logger.warn('Consulting purchase not completed by webhook', { purchaseId, pi: pi.id, paid });
  } else if (type === 'payment_intent.canceled') {
    await db.query(
      `UPDATE consulting_purchases SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND payment_intent_id = $2 AND status = 'pending'`,
      [purchaseId, pi.id],
    );
  }
  return true;
}

async function applyConsultingPaymentWebhookEvent({ type, object: pi }) {
  if (!pi?.id) return false;
  if (pi.metadata?.consulting_purchase_id) return applyConsultingPurchaseEvent(type, pi);
  const marked = pi.metadata?.consulting_payment === 'true' || Boolean(pi.metadata?.sessionScheduledId && pi.metadata?.packageId);
  if (!marked) return false;
  if (type === 'payment_intent.succeeded') {
    const result = await completeConsultingPaymentFromIntent(pi);
    return result.status !== 'not_found';
  }
  // A failed attempt can be retried on the same intent; only cancellation
  // ends the payment.
  if (type === 'payment_intent.canceled') {
    await db.query(
      `UPDATE consulting_payments SET status = 'failed', updated_at = NOW()
       WHERE stripe_payment_intent_id = $1 AND status IN ('pending', 'processing')`,
      [pi.id],
    );
    return true;
  }
  return false;
}

async function isScheduledSessionPaid(sessionScheduledId, client = db) {
  const { rows } = await client.query(
    `SELECT 1 FROM consulting_payments
     WHERE session_scheduled_id = $1 AND status = 'completed' LIMIT 1`,
    [sessionScheduledId],
  );
  return rows.length > 0;
}

module.exports = { completeConsultingPaymentFromIntent, applyConsultingPaymentWebhookEvent, isScheduledSessionPaid };
