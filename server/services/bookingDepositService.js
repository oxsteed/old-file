'use strict';

/**
 * Booking-request deposits (review P3-962).
 *
 * The native booking flow can collect a deposit or the full amount through a
 * PaymentIntent (metadata.source = 'mobile_booking'). This service closes
 * every way that money could be stranded:
 *  - the Stripe webhook settles the booking even if the client never calls
 *    confirm (succeeded -> paid, failed -> failed);
 *  - a terminal booking (declined, expired, cancelled, or accepted_cancelled
 *    without a delivered appointment) refunds a paid deposit and cancels an
 *    unpaid intent; and
 *  - a sweeper retries anything the inline paths could not finish.
 * Refunds are idempotency-keyed per booking, so retries never double-refund.
 */

const db = require('../db');
const logger = require('../utils/logger');
const { notifyRefundIssued } = require('./refundNotification');
const promoRedemption = require('./promoRedemptionService');
const { recordException } = require('./reconciliationExceptions');

const TERMINAL_STATUSES = ['declined', 'expired', 'cancelled', 'accepted_cancelled'];

// A terminal booking whose deposit settlement keeps failing is retried by
// the sweeper up to this many attempts. Past the cap it must surface to
// operators instead of stalling invisibly: the booking is flagged with a
// reconciliation exception (domain payment_refund) that ops triage, and the
// sweeper stops spending Stripe calls on it. settleTerminalBooking itself
// stays callable, so an operator can still re-drive a flagged booking.
const MAX_REFUND_ATTEMPTS = 20;

function stripeClient() {
  // eslint-disable-next-line global-require
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

function isBookingIntent(pi) {
  return Boolean(pi?.metadata?.booking_request_id) && pi?.metadata?.source === 'mobile_booking';
}

/** Webhook: settle a booking's payment state from its PaymentIntent. */
async function applyBookingIntentWebhook(eventType, pi) {
  if (!isBookingIntent(pi)) return false;
  const bookingId = String(pi.metadata.booking_request_id);
  if (eventType === 'payment_intent.succeeded') {
    const { rows: [booking] } = await db.query(
      `UPDATE booking_requests
          SET payment_status = 'paid',
              payment_amount_cents = GREATEST(payment_amount_cents, $2),
              paid_at = COALESCE(paid_at, NOW()),
              updated_at = NOW()
        WHERE id = $1 AND stripe_payment_intent_id = $3
          AND payment_status IN ('requires_payment', 'processing', 'failed')
        RETURNING id, status`,
      [bookingId, Number(pi.amount_received || pi.amount || 0), pi.id]
    );
    if (booking) await promoRedemption.markRedeemed(db, { surface: 'booking', providerReference: pi.id });
    // Paid after the booking already ended: refund straight away.
    if (booking && TERMINAL_STATUSES.includes(booking.status)) {
      await settleTerminalBooking(booking.id, 'paid_after_terminal');
    }
    return true;
  }
  if (eventType === 'payment_intent.payment_failed' || eventType === 'payment_intent.canceled') {
    await db.query(
      `UPDATE booking_requests
          SET payment_status = 'failed', updated_at = NOW()
        WHERE id = $1 AND stripe_payment_intent_id = $2
          AND payment_status IN ('requires_payment', 'processing')`,
      [bookingId, pi.id]
    );
    // A canceled intent can never complete: release its promo. A failed one
    // can still be retried by the customer, so its reservation stays.
    if (eventType === 'payment_intent.canceled') {
      await promoRedemption.reversePromo(db, { surface: 'booking', providerReference: pi.id, reason: 'intent_canceled' });
    }
    return true;
  }
  if (eventType === 'payment_intent.processing') {
    await db.query(
      `UPDATE booking_requests SET payment_status = 'processing', updated_at = NOW()
        WHERE id = $1 AND stripe_payment_intent_id = $2 AND payment_status = 'requires_payment'`,
      [bookingId, pi.id]
    );
    return true;
  }
  return false;
}

async function deliveredAppointment(runner, booking) {
  if (!booking.appointment_id) return false;
  const { rows } = await runner.query('SELECT status FROM appointments WHERE id = $1', [booking.appointment_id]);
  return rows[0]?.status === 'completed';
}

/**
 * Refund (or void) the payment of a booking that has ended. Safe to call
 * from any terminal path and repeatedly. Returns a short outcome string.
 */
async function settleTerminalBooking(bookingId, reason = 'booking_ended') {
  const { rows: [booking] } = await db.query('SELECT * FROM booking_requests WHERE id = $1', [bookingId]);
  if (!booking) return 'not_found';
  if (!TERMINAL_STATUSES.includes(booking.status)) return 'not_terminal';
  if (!booking.stripe_payment_intent_id) return 'no_payment';
  if (!['paid', 'requires_payment', 'processing'].includes(booking.payment_status)) return 'nothing_to_settle';
  // A booking flagged accepted_cancelled after the service was delivered is
  // not a cancellation of the work: keep the payment.
  if (booking.status === 'accepted_cancelled' && await deliveredAppointment(db, booking)) return 'service_delivered';

  const stripe = stripeClient();
  try {
    if (booking.payment_status === 'paid') {
      const refund = await stripe.refunds.create(
        { payment_intent: booking.stripe_payment_intent_id, metadata: { booking_request_id: String(booking.id), reason } },
        { idempotencyKey: `booking-deposit:${booking.id}:refund` }
      );
      await db.query(
        `UPDATE booking_requests
            SET payment_status = 'refunded', refunded_at = COALESCE(refunded_at, NOW()),
                stripe_refund_id = $2, refund_attempts = refund_attempts + 1,
                refund_last_error = NULL, updated_at = NOW()
          WHERE id = $1 AND payment_status = 'paid'`,
        [booking.id, refund.id || null]
      );
      await promoRedemption.reversePromo(db, { surface: 'booking', referenceId: booking.id, reason: 'booking_refunded' });
      logger.info('Booking deposit refunded', { bookingId: booking.id, refundId: refund.id, reason });
      // P3-3-F07: the customer learns their deposit refund was issued
      // (in-app + email). Best-effort; the refund is settled.
      if (booking.customer_id) {
        notifyRefundIssued({
          userId: booking.customer_id,
          idempotencyKey: `booking-deposit:${booking.id}:refund:issued`,
          amountCents: Number(refund.amount || 0),
          currency: String(refund.currency || 'usd').toUpperCase(),
          surface: 'booking_deposit',
          referenceId: booking.id,
          refundId: refund.id || null,
          actionUrl: '/my-bookings',
        }).catch((err) => logger.warn('[bookingDeposit] refund notification failed', {
          bookingId: booking.id,
          error: err.message,
        }));
      }
      return 'refunded';
    }
    // Not yet paid: void the intent so it can never complete later.
    let intent = null;
    try {
      intent = await stripe.paymentIntents.cancel(booking.stripe_payment_intent_id);
    } catch (err) {
      intent = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id);
      if (intent?.status === 'succeeded') {
        await db.query(
          `UPDATE booking_requests SET payment_status = 'paid', paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
            WHERE id = $1`,
          [booking.id]
        );
        return settleTerminalBooking(booking.id, reason);
      }
      if (intent?.status !== 'canceled') throw err;
    }
    await db.query(
      `UPDATE booking_requests SET payment_status = 'failed', refund_last_error = NULL, updated_at = NOW()
        WHERE id = $1 AND payment_status IN ('requires_payment', 'processing')`,
      [booking.id]
    );
    await promoRedemption.reversePromo(db, { surface: 'booking', referenceId: booking.id, reason: 'booking_voided' });
    return 'voided';
  } catch (err) {
    const { rows: [updated] } = await db.query(
      `UPDATE booking_requests SET refund_attempts = refund_attempts + 1, refund_last_error = LEFT($2, 1000), updated_at = NOW()
        WHERE id = $1
        RETURNING refund_attempts`,
      [booking.id, String(err.message || 'refund failed')]
    );
    logger.error('Booking deposit settlement failed', { bookingId: booking.id, error: err.message });
    const attempts = Number(updated?.refund_attempts ?? 0);
    if (attempts >= MAX_REFUND_ATTEMPTS) {
      await raiseSettlementExhaustedException(booking, attempts, err.message);
    }
    throw err;
  }
}

/**
 * Flag a deposit settlement that exhausted its attempts, for operator
 * review. Never throws: recordException dedupes on open rows and swallows
 * its own failures, so flagging can never break a settlement path.
 */
async function raiseSettlementExhaustedException(booking, attempts, lastError) {
  await recordException({
    domain: 'payment_refund',
    referenceId: String(booking.id),
    severity: 'critical',
    summary: `Booking deposit settlement exhausted ${MAX_REFUND_ATTEMPTS} attempts for booking ${booking.id}`,
    details: {
      bookingId: booking.id,
      bookingStatus: booking.status,
      paymentStatus: booking.payment_status,
      refundAttempts: attempts,
      lastError: String(lastError || '').slice(0, 500),
    },
  });
  logger.error('Booking deposit settlement exhausted; flagged for operator review', {
    bookingId: booking.id, refundAttempts: attempts, error: String(lastError || '').slice(0, 500),
  });
}

/** Fire-and-forget variant for terminal transitions; the sweeper retries. */
function settleTerminalBookingSoon(bookingId, reason) {
  if (!bookingId) return;
  setImmediate(() => {
    settleTerminalBooking(bookingId, reason).catch(() => {});
  });
}

async function findUnsettledTerminalBookings(limit = 50) {
  const { rows } = await db.query(
    `SELECT id FROM booking_requests
      WHERE status = ANY($1::text[])
        AND payment_status IN ('paid', 'requires_payment', 'processing')
        AND stripe_payment_intent_id IS NOT NULL
        AND refund_attempts < $2
      ORDER BY updated_at ASC
      LIMIT $3`,
    [TERMINAL_STATUSES, MAX_REFUND_ATTEMPTS, Math.min(200, Math.max(1, Number(limit) || 50))]
  );
  return rows.map((r) => r.id);
}

/**
 * Terminal bookings that already hit the attempt cap. The sweeper must not
 * retry these (that is what the cap is for); it flags them instead.
 */
async function findExhaustedTerminalBookings(limit = 50) {
  const { rows } = await db.query(
    `SELECT id FROM booking_requests
      WHERE status = ANY($1::text[])
        AND payment_status IN ('paid', 'requires_payment', 'processing')
        AND stripe_payment_intent_id IS NOT NULL
        AND refund_attempts >= $2
      ORDER BY updated_at ASC
      LIMIT $3`,
    [TERMINAL_STATUSES, MAX_REFUND_ATTEMPTS, Math.min(200, Math.max(1, Number(limit) || 50))]
  );
  return rows.map((r) => r.id);
}

/**
 * Flag a capped booking for operator review without touching Stripe.
 * Covers bookings that stalled before the exhaustion hook existed: the
 * sweeper surfaces them on its next pass instead of retrying them forever.
 * Returns 'flagged', or why the booking does not qualify.
 */
async function flagExhaustedTerminalBooking(bookingId) {
  const { rows: [booking] } = await db.query('SELECT * FROM booking_requests WHERE id = $1', [bookingId]);
  if (!booking) return 'not_found';
  if (!TERMINAL_STATUSES.includes(booking.status)) return 'not_terminal';
  if (!['paid', 'requires_payment', 'processing'].includes(booking.payment_status)) return 'nothing_to_settle';
  if (Number(booking.refund_attempts || 0) < MAX_REFUND_ATTEMPTS) return 'not_exhausted';
  await raiseSettlementExhaustedException(booking, Number(booking.refund_attempts), booking.refund_last_error);
  return 'flagged';
}

module.exports = {
  TERMINAL_STATUSES,
  MAX_REFUND_ATTEMPTS,
  isBookingIntent,
  applyBookingIntentWebhook,
  settleTerminalBooking,
  settleTerminalBookingSoon,
  findUnsettledTerminalBookings,
  findExhaustedTerminalBookings,
  flagExhaustedTerminalBooking,
};
