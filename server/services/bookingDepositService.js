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
const { AppError } = require('../middleware/errorHandler');
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
  // Group 3 (D-40): a sponsor's own intent settles the sponsorship row,
  // never the booking's payment state. Same source, separate ledger.
  if (pi.metadata?.sponsorship_charge_id) {
    return applySponsorshipPaymentWebhook(eventType, pi, 'booking_sponsorship_charges', pi.metadata.sponsorship_charge_id);
  }
  if (pi.metadata?.sponsorship_id) {
    return applySponsorshipPaymentWebhook(eventType, pi, 'booking_sponsorships', pi.metadata.sponsorship_id);
  }
  if (eventType === 'payment_intent.succeeded') {
    const { rows: [candidate] } = await db.query(
      `SELECT id, payment_status, payment_amount_cents, stripe_payment_intent_id
         FROM booking_requests
        WHERE id = $1 AND stripe_payment_intent_id = $2
        FOR UPDATE`,
      [bookingId, pi.id]
    );
    if (!candidate) return true;
    const providerAmount = Number(pi.amount_received ?? pi.amount);
    const expectedAmount = Number(candidate.payment_amount_cents);
    const providerCurrency = typeof pi.currency === 'string' ? pi.currency.toLowerCase() : '';
    if (!Number.isSafeInteger(providerAmount)
        || providerAmount <= 0
        || !Number.isSafeInteger(expectedAmount)
        || expectedAmount <= 0
        || providerAmount !== expectedAmount
        || providerCurrency !== 'usd') {
      throw new AppError(
        'Stripe booking payment does not match the stored booking amount or currency',
        409,
        'booking_payment_verification_failed',
      );
    }
    const { rows: [booking] } = await db.query(
      `UPDATE booking_requests
          SET payment_status = 'paid',
              payment_amount_cents = GREATEST(payment_amount_cents, $2),
              paid_at = COALESCE(paid_at, NOW()),
              updated_at = NOW()
        WHERE id = $1 AND stripe_payment_intent_id = $3
          AND payment_status IN ('requires_payment', 'processing', 'failed')
        RETURNING id, status`,
      [bookingId, providerAmount, pi.id]
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
  // G3-9: a completed business appointment is delivery evidence too,
  // exactly like the sweeper's delivered condition.
  if (booking.business_appointment_id) {
    const { rows } = await runner.query('SELECT status FROM business_appointments WHERE id = $1', [booking.business_appointment_id]);
    if (rows[0]?.status === 'completed') return true;
  }
  if (!booking.appointment_id) return false;
  const { rows } = await runner.query('SELECT status FROM appointments WHERE id = $1', [booking.appointment_id]);
  return rows[0]?.status === 'completed';
}

// ─── Group 3 sponsorship payments (D-40) ─────────────────────────────────
// A sponsor pays with their own card through a per-sponsorship (or
// per-charge) PaymentIntent. The webhook settles that row only; the
// booking's payment_status is untouched. Refunds return each payer's money
// to their own intent, idempotency-keyed per row.

async function findPaidSponsorshipPayments(bookingId) {
  const entries = [];
  const { rows: sponsorships } = await db.query(
    `SELECT * FROM booking_sponsorships WHERE booking_id = $1 AND status = 'paid'`,
    [bookingId]
  );
  for (const row of sponsorships) entries.push({ table: 'booking_sponsorships', row });
  const { rows: charges } = await db.query(
    `SELECT * FROM booking_sponsorship_charges WHERE booking_id = $1 AND status = 'paid'`,
    [bookingId]
  );
  for (const row of charges) entries.push({ table: 'booking_sponsorship_charges', row });
  return entries;
}

async function refundOneSponsorshipPayment(stripe, entry, bookingId, reason) {
  const { table, row } = entry;
  if (!row.stripe_payment_intent_id) return false;
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: row.stripe_payment_intent_id, metadata: { booking_request_id: String(bookingId), reason } },
      { idempotencyKey: `booking-${table}:${row.id}:refund` }
    );
    if (!refund || typeof refund.id !== 'string' || !refund.id.trim()) {
      throw new Error('Stripe sponsorship refund did not return a refund id');
    }
    const providerAmount = Number(refund.amount);
    const providerCurrency = typeof refund.currency === 'string' ? refund.currency.toLowerCase() : '';
    const providerPaymentIntentId = typeof refund.payment_intent === 'string'
      ? refund.payment_intent
      : refund.payment_intent?.id || null;
    if (!Number.isSafeInteger(providerAmount)
        || providerAmount !== Number(row.amount_cents)
        || providerCurrency !== 'usd'
        || providerPaymentIntentId !== row.stripe_payment_intent_id) {
      throw new Error('Stripe sponsorship refund did not match the stored payment');
    }
    await db.query(
      `UPDATE ${table}
          SET status = 'refunded', refunded_at = COALESCE(refunded_at, NOW()),
              stripe_refund_id = $2, updated_at = NOW()
        WHERE id = $1 AND status = 'paid'`,
      [row.id, refund.id || null]
    );
    logger.info('Booking sponsorship payment refunded', { bookingId, table, rowId: row.id, refundId: refund.id, reason });
    return true;
  } catch (err) {
    logger.error('Booking sponsorship refund failed', { bookingId, table, rowId: row.id, error: err.message });
    await recordException({
      domain: 'payment_refund',
      referenceId: String(bookingId),
      severity: 'critical',
      summary: `Sponsorship refund failed for booking ${bookingId} (${table} ${row.id})`,
      details: { bookingId: String(bookingId), table, rowId: String(row.id), lastError: String(err.message || '').slice(0, 500) },
    });
    return false;
  }
}

/**
 * G3-10: a fully sponsored booking has no booker intent; once every
 * sponsor payment is refunded the booking itself must read refunded,
 * not paid. Called after terminal refunds from both the settlement
 * path and the webhook paid-after-terminal path.
 */
async function syncFullySponsoredRefundStatus(bookingId) {
  const { rows: [booking] } = await db.query('SELECT * FROM booking_requests WHERE id = $1', [bookingId]);
  if (!booking || booking.stripe_payment_intent_id || booking.payment_status !== 'paid') return;
  const remaining = await findPaidSponsorshipPayments(booking.id);
  if (remaining.length === 0) {
    await db.query(
      `UPDATE booking_requests SET payment_status = 'refunded', refunded_at = COALESCE(refunded_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND payment_status = 'paid'`,
      [booking.id]
    );
  }
}

/** Refund every paid sponsorship/charge on a terminal booking. Best-effort per row. */
async function refundSponsorshipPayments(booking, entries, reason) {
  if (!entries.length) return false;
  const stripe = stripeClient();
  let refunded = false;
  for (const entry of entries) {
    const ok = await refundOneSponsorshipPayment(stripe, entry, booking.id, reason);
    refunded = refunded || ok;
    if (ok) {
      try {
        // eslint-disable-next-line global-require
        const recipientSvc = require('./bookingRecipientService');
        const { rows: [fresh] } = await db.query(
          `SELECT * FROM booking_requests WHERE id = $1`, [booking.id]
        );
        const sponsorship = entry.table === 'booking_sponsorships'
          ? entry.row
          : (await db.query('SELECT * FROM booking_sponsorships WHERE id = $1', [entry.row.sponsorship_id])).rows[0];
        if (fresh && sponsorship) {
          await recipientSvc.notifyAccountParty({
            booking: fresh,
            userId: sponsorship.sponsor_user_id,
            type: 'booking_sponsor_update',
            body: `${fresh.service_name}: the sponsored payment was refunded to the original payment method`,
            data: { sponsorshipId: sponsorship.id },
            actionUrl: '/my-bookings',
            idempotencyKey: `booking-sponsor-refunded:${sponsorship.id}`,
          });
        }
      } catch (notifyErr) {
        logger.warn('Failed to notify sponsor of refund', { error: notifyErr.message });
      }
    }
  }
  return refunded;
}

/**
 * Settle one sponsorship (or charge) intent from the Stripe webhook.
 * Verifies the intent against the stored row exactly like the booker leg:
 * same intent id, same amount, USD. A payment that lands after the
 * booking already ended is refunded straight away. A sponsorship payment
 * that lands past its deadline, or that would push paid sponsorships
 * past gross (D-583), is refunded immediately and never marked paid.
 */
async function applySponsorshipPaymentWebhook(eventType, pi, table, rowId) {
  const { rows: [row] } = await db.query(
    `SELECT * FROM ${table} WHERE id = $1 AND stripe_payment_intent_id = $2 FOR UPDATE`,
    [rowId, pi.id]
  );
  // G3-26: an unmatched sponsorship intent is a reconciliation exception
  // for operators, not a silent ack — a payment with no row is money
  // with nowhere to settle.
  if (!row) {
    await recordException({
      domain: 'webhook_receipt',
      referenceId: String(pi.id),
      severity: 'warning',
      summary: `Sponsorship webhook matched no ${table} row for intent ${pi.id}`,
      details: { table, rowId: String(rowId), intentId: String(pi.id), eventType },
    });
    return true;
  }
  if (eventType === 'payment_intent.succeeded') {
    const providerAmount = Number(pi.amount_received ?? pi.amount);
    const expectedAmount = Number(row.amount_cents);
    const providerCurrency = typeof pi.currency === 'string' ? pi.currency.toLowerCase() : '';
    if (!Number.isSafeInteger(providerAmount)
        || providerAmount <= 0
        || !Number.isSafeInteger(expectedAmount)
        || expectedAmount <= 0
        || providerAmount !== expectedAmount
        || providerCurrency !== 'usd') {
      throw new AppError(
        'Stripe sponsorship payment does not match the stored sponsorship amount or currency',
        409,
        'sponsorship_payment_verification_failed',
      );
    }
    const { rows: [booking] } = await db.query(
      'SELECT * FROM booking_requests WHERE id = $1', [row.booking_id]
    );
    // D-583 (sponsorships only; charges have no deadline and sit on top
    // of the total): a late or over-gross payment is refunded at once
    // and never marked paid.
    if (booking && table === 'booking_sponsorships') {
      const pastDeadline = row.payment_deadline_at && new Date(row.payment_deadline_at) <= new Date();
      if (pastDeadline) {
        // Refund first; the row closes only once the money is back. A
        // failed refund throws so Stripe redelivers the webhook and the
        // refund is retried (the exception is already recorded).
        const refunded = await refundOneSponsorshipPayment(stripeClient(), { table, row }, booking.id, 'sponsorship_paid_after_deadline');
        if (!refunded) {
          throw new AppError('Sponsorship refund failed; retry the webhook', 502, 'sponsorship_refund_failed');
        }
        await db.query(
          `UPDATE booking_sponsorships SET status = 'expired', updated_at = NOW()
            WHERE id = $1 AND status IN ('invited', 'accepted')`,
          [row.id]
        );
        return true;
      }
      // eslint-disable-next-line global-require
      const recipientSvc = require('./bookingRecipientService');
      const paidSoFar = await recipientSvc.paidSponsorshipCents(booking.id);
      const gross = Number(booking.gross_amount_cents || 0) > 0
        ? Number(booking.gross_amount_cents)
        : (Number(booking.payment_amount_cents || 0) > 0 ? Number(booking.payment_amount_cents) : 5000000);
      if (paidSoFar + expectedAmount > gross) {
        const refunded = await refundOneSponsorshipPayment(stripeClient(), { table, row }, booking.id, 'sponsorship_over_gross');
        if (!refunded) {
          throw new AppError('Sponsorship refund failed; retry the webhook', 502, 'sponsorship_refund_failed');
        }
        await db.query(
          `UPDATE booking_sponsorships SET status = 'voided', updated_at = NOW()
            WHERE id = $1 AND status IN ('invited', 'accepted')`,
          [row.id]
        );
        return true;
      }
    }
    const { rows: [paid] } = await db.query(
      `UPDATE ${table}
          SET status = 'paid', paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND status = 'accepted' RETURNING *`,
      [row.id]
    );
    if (!paid) return true;
    if (booking && TERMINAL_STATUSES.includes(booking.status)) {
      await refundOneSponsorshipPayment(stripeClient(), { table, row: paid }, booking.id, 'paid_after_terminal');
      await syncFullySponsoredRefundStatus(booking.id);
      return true;
    }
    if (booking) {
      try {
        // eslint-disable-next-line global-require
        const recipientSvc = require('./bookingRecipientService');
        const sponsorship = table === 'booking_sponsorships'
          ? paid
          : (await db.query('SELECT * FROM booking_sponsorships WHERE id = $1', [paid.sponsorship_id])).rows[0];
        if (sponsorship) {
          await recipientSvc.notifyAccountParty({
            booking,
            userId: booking.customer_id,
            type: 'booking_sponsor_update',
            body: `${booking.service_name}: the sponsor paid the sponsored amount`,
            data: { sponsorshipId: sponsorship.id },
            actionUrl: '/my-bookings',
            idempotencyKey: `booking-sponsor-paid:${sponsorship.id}`,
          });
          await recipientSvc.notifyAccountParty({
            booking,
            userId: sponsorship.sponsor_user_id,
            type: 'booking_sponsor_update',
            body: `${booking.service_name}: your sponsored payment was received`,
            data: { sponsorshipId: sponsorship.id },
            actionUrl: '/my-bookings',
            idempotencyKey: `booking-sponsor-paid:${sponsorship.id}:sponsor`,
          });
        }
      } catch (notifyErr) {
        logger.warn('Failed to notify sponsorship payment', { error: notifyErr.message });
      }
    }
    return true;
  }
  // Failed/canceled/processing: the sponsorship stays 'accepted' so the
  // sponsor can retry with a fresh intent; nothing is settled here.
  return true;
}

/**
 * Refund (or void) the payment of a booking that has ended. Safe to call
 * from any terminal path and repeatedly. Returns a short outcome string.
 */
async function settleTerminalBooking(bookingId, reason = 'booking_ended') {
  const { rows: [booking] } = await db.query('SELECT * FROM booking_requests WHERE id = $1', [bookingId]);
  if (!booking) return 'not_found';
  if (!TERMINAL_STATUSES.includes(booking.status)) return 'not_terminal';
  // Group 3 (D-40): a fully sponsored booking has no booker intent, but its
  // sponsor payments still need refunding. A booking with neither is
  // untouched, exactly as before.
  const sponsorPayments = await findPaidSponsorshipPayments(booking.id);
  if (!booking.stripe_payment_intent_id && sponsorPayments.length === 0) return 'no_payment';
  if (!['paid', 'requires_payment', 'processing'].includes(booking.payment_status) && sponsorPayments.length === 0) return 'nothing_to_settle';
  // A booking flagged accepted_cancelled after the service was delivered is
  // not a cancellation of the work: keep the payment.
  if (booking.status === 'accepted_cancelled' && await deliveredAppointment(db, booking)) return 'service_delivered';

  let bookerOutcome = null;
  if (booking.stripe_payment_intent_id
    && ['paid', 'requires_payment', 'processing'].includes(booking.payment_status)) {
    bookerOutcome = await settleBookerTerminalIntent(booking, reason);
  }
  const sponsorRefunded = await refundSponsorshipPayments(booking, sponsorPayments, reason);
  // G3-10: a fully sponsored booking has no booker intent; once every
  // sponsor payment is refunded the booking itself must read refunded,
  // not paid.
  if (!booking.stripe_payment_intent_id && sponsorPayments.length > 0) {
    await syncFullySponsoredRefundStatus(booking.id);
  }
  if (bookerOutcome) return bookerOutcome;
  return sponsorRefunded ? 'refunded' : 'nothing_to_settle';
}

/**
 * The booker's own intent leg of a terminal settlement, extracted
 * unchanged from settleTerminalBooking: Group 3 split the sponsor legs
 * out, the booker leg keeps its exact behavior, including throwing on
 * failure so the sweeper retries.
 */
async function settleBookerTerminalIntent(booking, reason) {
  const stripe = stripeClient();
  try {
    if (booking.payment_status === 'paid') {
      const refund = await stripe.refunds.create(
        { payment_intent: booking.stripe_payment_intent_id, metadata: { booking_request_id: String(booking.id), reason } },
        { idempotencyKey: `booking-deposit:${booking.id}:refund` }
      );
      // Do not mark the booking refunded unless the provider returned the
      // durable refund identity used by reconciliation and notifications.
      if (!refund || typeof refund.id !== 'string' || !refund.id.trim()) {
        throw new Error('Stripe booking refund did not return a refund id');
      }
      const expectedAmount = Number(booking.payment_amount_cents);
      const providerAmount = Number(refund.amount);
      const providerCurrency = typeof refund.currency === 'string' ? refund.currency.toLowerCase() : '';
      const providerPaymentIntentId = typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : refund.payment_intent?.id || null;
      if (!Number.isSafeInteger(expectedAmount)
          || expectedAmount <= 0
          || !Number.isSafeInteger(providerAmount)
          || providerAmount !== expectedAmount
          || providerCurrency !== 'usd'
          || providerPaymentIntentId !== booking.stripe_payment_intent_id) {
        throw new Error('Stripe booking refund did not match the stored payment');
      }
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
        AND (
          (stripe_payment_intent_id IS NOT NULL
           AND payment_status IN ('paid', 'requires_payment', 'processing')
           AND refund_attempts < $2)
          OR EXISTS (SELECT 1 FROM booking_sponsorships s WHERE s.booking_id = booking_requests.id AND s.status = 'paid')
          OR EXISTS (SELECT 1 FROM booking_sponsorship_charges c WHERE c.booking_id = booking_requests.id AND c.status = 'paid')
        )
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
