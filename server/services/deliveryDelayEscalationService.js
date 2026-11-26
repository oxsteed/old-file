// server/services/deliveryDelayEscalationService.js
// Group 9 Slice E (item 485): automated delay detection and escalation
// for assigned/in-transit jobs.
//
// A job is late when its ETA passed more than DELAY_THRESHOLD_MINUTES
// ago (30 minutes, D-80). The ETA is the latest live ETA snapshot when
// one exists, else the job's stored estimated_arrival_at, else the
// delivery window end. The ETA service's 15-minute staleness
// (getCurrentEta: no fresh snapshot or location point) is a different
// signal — no recent location — and is NOT the trigger here; lateness
// past the ETA is.
//
// Escalation, per job, is three things:
//   1. an open delivery_issues row (code 'delay', metadata.autoDetected)
//      — the exception record dispatch resolves via resolveIssue;
//   2. a delivery_delay_escalated activity event — the notification
//      catalog fans it out to the customer and the driver; dispatch has
//      no push channel, so the board flag is its signal;
//   3. the delivery_jobs.delay_escalated_at stamp — the dispatch-board
//      flag (internalQueue surfaces stamped jobs while still active).
//
// Group 9 partials Wave 2 Batch P (485, G9-B9, D-557): a second
// trigger — pickup no-show. An 'assigned' job whose pickup window
// end passes with no pickup escalates at once, with the same three
// signals and metadata.trigger 'pickup_no_show'. No 30-minute grace:
// the pickup window end is itself the deadline the driver accepted,
// and waiting for delivery-window-end + 30 min is the gap this
// fixes. The ETA trigger below is unchanged for picked-up and
// in-transit jobs, and still catches an assigned job at
// delivery-window-end + 30 min when it has no pickup window at all;
// the open-issue guard means a job escalates once per episode
// whichever trigger fires first.
//
// Once per job per delay episode: a re-run skips any job with an open
// auto-detected delay issue. Resolving that issue closes the episode,
// so a job that is still late afterwards escalates again on the next
// run — that is a new episode, after a human looked at it.
//
// The sweep deliberately never sets dispatch_state='exception':
// updateStatus 409s every non-cancel status change while the job is in
// exception, so flagging a late in-transit job that way would strand
// the driver mid-route and block delivery until dispatch resolves it.
// The driver keeps working; dispatch sees the flag and the issue.
//
// No support ticket is opened for an auto-detected delay (a ticket per
// late job would spam support); the issue row is the record, and a
// manual delay report through the normal intake still opens one.
// The geofence `notified` column is untouched: geofence observations
// are arrival/departure suggestions, unrelated to lateness.
'use strict';

const { ACTIVE_STATUSES } = require('./deliveryJobStopsService');

const DELAY_THRESHOLD_MINUTES = 30;
const BATCH_SIZE = 500;

async function sweepDelayedDeliveries(db, { now = new Date() } = {}) {
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const nowIso = new Date(nowMs).toISOString();
  const thresholdIso = new Date(nowMs - DELAY_THRESHOLD_MINUTES * 60000).toISOString();
  const { rows: jobs } = await db.query(
    `SELECT j.*, snap.eta_at AS snapshot_eta_at
       FROM delivery_jobs j
       LEFT JOIN LATERAL (
         SELECT eta_at FROM delivery_eta_snapshots
          WHERE delivery_job_id = j.id AND eta_at IS NOT NULL
          ORDER BY created_at DESC, id DESC LIMIT 1
       ) snap ON TRUE
      WHERE j.status = ANY($1::local_delivery_status[])
        AND (j.helper_user_id IS NOT NULL OR j.internal_driver_user_id IS NOT NULL)
        AND (
          (COALESCE(snap.eta_at, j.estimated_arrival_at, j.delivery_window_end) IS NOT NULL
           AND COALESCE(snap.eta_at, j.estimated_arrival_at, j.delivery_window_end) <= $2::timestamptz)
          OR (j.status = 'assigned' AND j.picked_up_at IS NULL AND j.pickup_window_end IS NOT NULL
              AND j.pickup_window_end <= $4::timestamptz)
        )
        AND NOT EXISTS (
          SELECT 1 FROM delivery_issues i
           WHERE i.delivery_job_id = j.id AND i.code = 'delay' AND i.status = 'open'
             AND i.metadata->>'autoDetected' = 'true'
        )
      ORDER BY COALESCE(snap.eta_at, j.estimated_arrival_at, j.delivery_window_end) ASC
      LIMIT $3`,
    [ACTIVE_STATUSES, thresholdIso, BATCH_SIZE, nowIso],
  );
  let escalated = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      // Pickup no-show takes precedence when both clocks have passed:
      // the missed pickup is the more specific, earlier signal.
      const pickupNoShow = job.status === 'assigned' && !job.picked_up_at && job.pickup_window_end
        && new Date(job.pickup_window_end).getTime() <= nowMs;
      const etaAt = pickupNoShow
        ? new Date(job.pickup_window_end)
        : new Date(job.snapshot_eta_at || job.estimated_arrival_at || job.delivery_window_end);
      const minutesLate = Math.max(0, Math.floor((nowMs - etaAt.getTime()) / 60000));
      const metadata = {
        autoDetected: true,
        trigger: pickupNoShow ? 'pickup_no_show' : 'eta',
        etaAt: etaAt.toISOString(),
        minutesLate,
        episodeStartedAt: nowIso,
      };
      const description = pickupNoShow
        ? `Delivery ${job.reference} missed its pickup window ${minutesLate} minutes ago and has been escalated to dispatch.`
        : `Delivery ${job.reference} is ${minutesLate} minutes past its estimated arrival and has been escalated to dispatch.`;
      const { rowCount } = await db.query(
        `INSERT INTO delivery_issues (delivery_job_id, code, description, reported_by_user_id, metadata)
           SELECT $1, 'delay', $2, NULL, $3::jsonb
            WHERE NOT EXISTS (
              SELECT 1 FROM delivery_issues i
               WHERE i.delivery_job_id = $1 AND i.code = 'delay' AND i.status = 'open'
                 AND i.metadata->>'autoDetected' = 'true'
            )`,
        [job.id, description, JSON.stringify(metadata)],
      );
      if (!rowCount) continue;
      await db.query(
        'UPDATE delivery_jobs SET delay_escalated_at = $2, updated_at = NOW() WHERE id = $1',
        [job.id, nowIso],
      );
      const { recordActivity } = require('./localDeliveryIntegrity');
      await recordActivity(db, job.id, null, 'delivery_delay_escalated', { etaAt: etaAt.toISOString(), minutesLate, trigger: metadata.trigger }, true);
      escalated += 1;
    } catch (err) {
      failed += 1;
    }
  }
  return { escalated, failed, examined: jobs.length };
}

module.exports = { sweepDelayedDeliveries, DELAY_THRESHOLD_MINUTES };
