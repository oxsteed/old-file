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

const TERMINAL_STATUSES = ['declined', 'expired', 'cancelled', 'accepted_cancelled'];

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
    return 'voided';
  } catch (err) {
    await db.query(
      `UPDATE booking_requests SET refund_attempts = refund_attempts + 1, refund_last_error = LEFT($2, 1000), updated_at = NOW()
        WHERE id = $1`,
      [booking.id, String(err.message || 'refund failed')]
    );
    logger.error('Booking deposit settlement failed', { bookingId: booking.id, error: err.message });
    throw err;
  }
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
        AND refund_attempts < 20
      ORDER BY updated_at ASC
      LIMIT $2`,
    [TERMINAL_STATUSES, Math.min(200, Math.max(1, Number(limit) || 50))]
  );
  return rows.map((r) => r.id);
}

module.exports = {
  TERMINAL_STATUSES,
  isBookingIntent,
  applyBookingIntentWebhook,
  settleTerminalBooking,
  settleTerminalBookingSoon,
  findUnsettledTerminalBookings,
};
