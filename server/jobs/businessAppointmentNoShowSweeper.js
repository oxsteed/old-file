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
const { mapBounded } = require('../utils/boundedBatch');
const { sendNotification } = require('../services/notificationService');
const { withFencedJobLock } = require('./jobLockingService');

// Oct 30 item 29: the 15-minute interval used to fire with no in-process
// guard and no cross-replica lock. The phase-1/2/3 selects use
// FOR UPDATE SKIP LOCKED, but the surrounding multi-step sweep (select,
// per-row update, notify) was not fenced, so two replicas could still
// interleave phases. The running flag (same shape as customer360Alerts /
// metricThresholdAlerts) skips an overlapping tick in this process; the
// fenced lock (TTL matches the 15-minute cadence) skips a concurrent
// pass on another replica. The row-level SKIP LOCKED claims stay as
// defence in depth.
const JOB_NAME = 'business-appointment-no-show-sweeper';

const DEFAULT_NO_SHOW_GRACE_HOURS = 2;

// Cost audit 2026-11-13 item 15: the old per-appointment notify did one
// recipient lookup + up to two sendNotification calls per marked row
// (about 800 queries + 400 notifications per 15-min tick at the 200 cap).
// The batch form does one recipient lookup for all marked rows, then sends
// in bounded parallel batches. Notify stays best-effort: a failed send is
// logged and the sweep continues, exactly as before.
async function notifyNoShowMarkedBatch(marked) {
  if (!marked.length) return 0;
  let recipientsByAppointment;
  try {
    const { rows } = await db.query(
      `SELECT ba.id, ba.customer_id, b.user_id AS business_owner_id
         FROM business_appointments ba
         JOIN businesses b ON b.id = ba.business_id
        WHERE ba.id = ANY($1::bigint[])`,
      [marked.map((row) => row.id)]
    );
    recipientsByAppointment = new Map();
    for (const row of rows) {
      const list = recipientsByAppointment.get(String(row.id)) || [];
      for (const userId of [row.customer_id, row.business_owner_id]) {
        if (userId && !list.includes(String(userId))) list.push(String(userId));
      }
      recipientsByAppointment.set(String(row.id), list);
    }
  } catch (err) {
    for (const appointment of marked) {
      logger.warn('No-show notification failed', { appointmentId: appointment.id, error: err.message });
    }
    return 0;
  }
  const tasks = [];
  for (const appointment of marked) {
    for (const userId of recipientsByAppointment.get(String(appointment.id)) || []) {
      tasks.push({ appointment, userId });
    }
  }
  let notified = 0;
  await mapBounded(tasks, 5, async ({ appointment, userId }) => {
    try {
      await sendNotification({
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
      });
      notified++;
    } catch (err) {
      logger.warn('No-show notification failed', { appointmentId: appointment.id, error: err.message });
    }
  });
  return notified;
}

async function sweepNoShows() {
  let marked = 0;
  let autoCancelled = 0;
  let expiredPending = 0;

  // Phase 1: confirmed appointments past the grace window -> no_show.
  // Cost audit 2026-11-13 item 15: the old select + per-row UPDATE +
  // per-row notify ran about 800 queries + 400 notifications per 15-min
  // tick at the 200 cap. The claim CTE takes the same FOR UPDATE SKIP
  // LOCKED claim (oldest first, LIMIT 200) and the single set-based
  // UPDATE...RETURNING marks them all at once; the status guard stays so
  // a row that changed hands between claim and update is not touched.
  // The claiming CTE and the UPDATE run in one statement, so the claim
  // cannot leak to a concurrent worker the way a separate SELECT could.
  const { rows: markedRows } = await db.query(
    `WITH claimed AS (
       SELECT ba.id
         FROM business_appointments ba
         LEFT JOIN business_booking_rules r ON r.business_id = ba.business_id
        WHERE ba.status = 'confirmed'
          AND ba.end_time < NOW() - make_interval(hours => GREATEST(COALESCE(NULLIF(r.auto_cancel_no_show_hours, 0), $1), 0))
        ORDER BY ba.end_time ASC
        LIMIT 200
        FOR UPDATE OF ba SKIP LOCKED
     )
     UPDATE business_appointments
        SET status = 'no_show', no_show_marked_at = NOW(), updated_at = NOW()
       FROM claimed
      WHERE business_appointments.id = claimed.id
        AND business_appointments.status = 'confirmed'
      RETURNING business_appointments.id, business_appointments.business_id,
        business_appointments.no_show_marked_at`,
    [DEFAULT_NO_SHOW_GRACE_HOURS]
  );
  marked = markedRows.length;
  await notifyNoShowMarkedBatch(markedRows);

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
  let stopped = false;
  let running = null;
  const tick = () => {
    if (stopped || running) return;
    running = withFencedJobLock(JOB_NAME, async () => {
      await sweepNoShows();
    }, 900)
      .catch((err) => {
        logger.error('Business appointment no-show sweeper failed', { error: err.message });
      })
      .finally(() => {
        running = null;
      });
  };
  const interval = setInterval(tick, 15 * 60 * 1000);
  interval.unref?.();

  logger.info('Business appointment no-show sweeper started');
  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
      return running;
    },
  };
}

module.exports = { startBusinessAppointmentNoShowSweeper, sweepNoShows, JOB_NAME };
