'use strict';

// Review P3-8-F03: no_show capacity semantics were split across four guards
// and no_show marking was fully manual, so stale confirmed appointments kept
// blocking capacity forever (no_show_marked_at was never written,
// auto_cancel_no_show_hours was never read). This sweeper unifies the
// lifecycle every 15 minutes:
//
//  1. Auto-mark no-show: confirmed appointments whose end_time passed more
//     than the grace window become no_show with no_show_marked_at set. The
//     grace is the business's auto_cancel_no_show_hours when set (> 0),
//     otherwise 2 hours.
//  2. Auto-cancel: no_show appointments older than auto_cancel_no_show_hours
//     (only when the business set it > 0) become cancelled by the system.
//     no_show is terminal in the manual transition table; the worker is the
//     only path that performs this system transition.
//  3. Expire stale pending: pending appointments whose window passed without
//     ever being confirmed are system-cancelled, but ONLY when nothing was
//     paid (payment_status <> 'paid'). Paid pendings are left for manual
//     handling: money code fails closed, and the worker never moves money.
//
// The worker never refunds, charges, or changes payment_status; it only moves
// the booking status so capacity guards (which all treat cancelled/no_show
// as non-blocking) release the slot consistently.

const db = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('../services/notificationService');

const DEFAULT_NO_SHOW_GRACE_HOURS = 2;

async function notifyNoShowMarked(appointment) {
  try {
    const { rows } = await db.query(
      `SELECT ba.customer_id, b.user_id AS business_owner_id
         FROM business_appointments ba
         JOIN businesses b ON b.id = ba.business_id
        WHERE ba.id = $1`,
      [appointment.id]
    );
    const recipientIds = [...new Set(
      rows.flatMap((row) => [row.customer_id, row.business_owner_id]).filter(Boolean).map(String)
    )];
    await Promise.allSettled(recipientIds.map((userId) => sendNotification({
      userId,
      type: 'appointment_no_show',
      title: 'Appointment marked as no-show',
      body: 'An appointment was marked as no-show because its scheduled time passed.',
      data: {
        appointment_id: String(appointment.id),
        business_id: String(appointment.business_id || ''),
      },
      action_url: `/businesses/${appointment.business_id}/calendar`,
      idempotencyKey: `business-appointment:${appointment.id}:no_show:${appointment.no_show_marked_at || 'auto'}`,
    })));
  } catch (err) {
    logger.warn('No-show notification failed', { appointmentId: appointment.id, error: err.message });
  }
}

async function sweepNoShows() {
  let marked = 0;
  let autoCancelled = 0;
  let expiredPending = 0;

  // Phase 1: confirmed appointments past the grace window -> no_show.
  // Lock rows (FOR UPDATE SKIP LOCKED) so concurrent workers cannot
  // double-process the same appointment.
  const { rows: stale } = await db.query(
    `SELECT ba.id, ba.business_id
       FROM business_appointments ba
       LEFT JOIN business_booking_rules r ON r.business_id = ba.business_id
      WHERE ba.status = 'confirmed'
        AND ba.end_time < NOW() - make_interval(hours => GREATEST(COALESCE(NULLIF(r.auto_cancel_no_show_hours, 0), $1), 0))
      ORDER BY ba.end_time ASC
      LIMIT 200
      FOR UPDATE OF ba SKIP LOCKED`,
    [DEFAULT_NO_SHOW_GRACE_HOURS]
  );
  for (const row of stale) {
    const { rows: updated } = await db.query(
      `UPDATE business_appointments
          SET status = 'no_show', no_show_marked_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'confirmed'
        RETURNING id, business_id, no_show_marked_at`,
      [row.id]
    );
    if (updated.length) {
      marked++;
      await notifyNoShowMarked(updated[0]);
    }
  }

  // Phase 2: no_show appointments older than the business's configured
  // auto-cancel window -> system-cancelled. Only when the business opted in
  // (auto_cancel_no_show_hours > 0). The fee is recorded as 0: the server
  // never auto-charges, and a system expiry must not invent a fee.
  const { rows: aged } = await db.query(
    `SELECT ba.id
       FROM business_appointments ba
       JOIN business_booking_rules r ON r.business_id = ba.business_id
      WHERE ba.status = 'no_show'
        AND ba.no_show_marked_at IS NOT NULL
        AND COALESCE(r.auto_cancel_no_show_hours, 0) > 0
        AND ba.no_show_marked_at < NOW() - make_interval(hours => r.auto_cancel_no_show_hours)
      ORDER BY ba.no_show_marked_at ASC
      LIMIT 200
      FOR UPDATE OF ba SKIP LOCKED`
  );
  for (const row of aged) {
    const { rowCount } = await db.query(
      `UPDATE business_appointments
          SET status = 'cancelled', cancelled_by = 'system',
              cancelled_at = NOW(),
              cancellation_reason = 'Auto-cancelled after no-show (business policy)',
              cancellation_fee_cents = 0, updated_at = NOW()
        WHERE id = $1 AND status = 'no_show'`,
      [row.id]
    );
    autoCancelled += rowCount || 0;
  }

  // Phase 3: stale pending appointments (never confirmed, window passed,
  // nothing paid) -> system-cancelled so they stop blocking capacity.
  // Paid pendings are deliberately left alone: cancelling them without a
  // human-reviewed refund would move money semantics by automation.
  const { rows: stalePending } = await db.query(
    `SELECT ba.id
       FROM business_appointments ba
       LEFT JOIN business_booking_rules r ON r.business_id = ba.business_id
      WHERE ba.status = 'pending'
        AND ba.payment_status <> 'paid'
        AND ba.end_time < NOW() - make_interval(hours => GREATEST(COALESCE(NULLIF(r.auto_cancel_no_show_hours, 0), $1), 0))
      ORDER BY ba.end_time ASC
      LIMIT 200
      FOR UPDATE OF ba SKIP LOCKED`,
    [DEFAULT_NO_SHOW_GRACE_HOURS]
  );
  for (const row of stalePending) {
    const { rowCount } = await db.query(
      `UPDATE business_appointments
          SET status = 'cancelled', cancelled_by = 'system',
              cancelled_at = NOW(),
              cancellation_reason = 'Expired: never confirmed and the scheduled time passed',
              cancellation_fee_cents = 0, updated_at = NOW()
        WHERE id = $1 AND status = 'pending' AND payment_status <> 'paid'`,
      [row.id]
    );
    expiredPending += rowCount || 0;
  }

  if (marked || autoCancelled || expiredPending) {
    logger.info('Business appointment no-show sweep complete', { marked, autoCancelled, expiredPending });
  }
  return { marked, autoCancelled, expiredPending };
}

// Run every 15 minutes to keep no-show / stale-pending capacity hygiene.
function startBusinessAppointmentNoShowSweeper() {
  const interval = setInterval(async () => {
    try {
      await sweepNoShows();
    } catch (err) {
      logger.error('Business appointment no-show sweeper failed', { error: err.message });
    }
  }, 15 * 60 * 1000);

  logger.info('Business appointment no-show sweeper started');
  return { stop: () => clearInterval(interval) };
}

module.exports = { startBusinessAppointmentNoShowSweeper, sweepNoShows };
