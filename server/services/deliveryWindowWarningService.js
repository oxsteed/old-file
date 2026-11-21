// server/services/deliveryWindowWarningService.js
// Group 9 Slice C (item 463): proactive time-window warnings for the
// assigned driver.
//
// Windows were stored and displayed, and rescheduling validated them,
// but nothing warned the driver when a window was closing or had passed
// without the stop completing. This sweep runs every 15 minutes over
// active assigned jobs: for each pending stop it sends the driver one
// in-app notification when the window is closing (within
// WINDOW_CLOSING_MINUTES, D-69) and one more if the window passes
// uncompleted. Each warning is stamped on the stop row, so a re-run
// never repeats it and a failed send retries on the next run (its stamp
// is still NULL). Warn-only: the sweep never cancels, reschedules, or
// otherwise changes a job or a stop.
'use strict';

const { loadJobStops, ensureJobStops, computeWindowWarnings, ACTIVE_STATUSES } = require('./deliveryJobStopsService');

const BATCH_SIZE = 500;

async function sweepDeliveryWindowWarnings(db, { now = new Date(), send = null } = {}) {
  const sender = send || require('./notificationService').sendNotification;
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const { rows: jobs } = await db.query(
    `SELECT * FROM delivery_jobs
      WHERE status = ANY($1::local_delivery_status[])
        AND (helper_user_id IS NOT NULL OR internal_driver_user_id IS NOT NULL)
      ORDER BY updated_at ASC
      LIMIT $2`,
    [ACTIVE_STATUSES, BATCH_SIZE],
  );
  let closing = 0;
  let expired = 0;
  let failed = 0;
  for (const job of jobs) {
    const driverId = job.helper_user_id || job.internal_driver_user_id;
    try {
      // Jobs created before the stops migration (or inserted directly)
      // have no stop rows: materialize their two legacy stops first so
      // the warning stamps have a row to land on.
      await ensureJobStops(db, job);
      const stops = await loadJobStops(db, job);
      const warnings = computeWindowWarnings(stops, new Date(nowMs));
      for (const warning of warnings) {
        const stampColumn = warning.kind === 'closing'
          ? 'window_closing_notice_sent_at'
          : 'window_expired_notice_sent_at';
        const { rows: pending } = await db.query(
          `SELECT id, stop_type, stop_order, window_end, address, city, state
             FROM delivery_job_stops
            WHERE id = $1 AND ${stampColumn} IS NULL`,
          [warning.stopId],
        );
        if (!pending[0]) continue;
        const stop = pending[0];
        const when = warning.kind === 'closing'
          ? `closes in ${warning.minutesUntilEnd} minute${warning.minutesUntilEnd === 1 ? '' : 's'}`
          : `passed ${warning.minutesOverdue} minute${warning.minutesOverdue === 1 ? '' : 's'} ago`;
        const stopLabel = stop.stop_type === 'pickup' ? 'Pickup' : 'Drop-off';
        const place = [stop.address, stop.city, stop.state].filter(Boolean).join(', ');
        await sender({
          userId: driverId,
          type: 'delivery_window_warning',
          title: warning.kind === 'closing'
            ? `Delivery window closing: ${job.reference}`
            : `Delivery window passed: ${job.reference}`,
          body: warning.kind === 'closing'
            ? `${stopLabel} stop ${stop.stop_order} of delivery ${job.reference} ${when}${place ? ` (${place})` : ''}. The stop is not complete yet.`
            : `${stopLabel} stop ${stop.stop_order} of delivery ${job.reference} ${when} and the stop is not complete yet. No change was made to the job.`,
          data: { deliveryJobId: job.id, reference: job.reference, stopId: stop.id, kind: warning.kind },
          action_url: `/delivery/jobs/${job.id}`,
        });
        const { rowCount } = await db.query(
          `UPDATE delivery_job_stops SET ${stampColumn} = NOW(), updated_at = NOW()
            WHERE id = $1 AND ${stampColumn} IS NULL`,
          [stop.id],
        );
        if (rowCount) {
          if (warning.kind === 'closing') closing += 1;
          else expired += 1;
        }
      }
    } catch (err) {
      failed += 1;
    }
  }
  return { closing, expired, failed, examined: jobs.length };
}

module.exports = { sweepDeliveryWindowWarnings };
