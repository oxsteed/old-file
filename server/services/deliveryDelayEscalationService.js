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
        AND COALESCE(snap.eta_at, j.estimated_arrival_at, j.delivery_window_end) IS NOT NULL
        AND COALESCE(snap.eta_at, j.estimated_arrival_at, j.delivery_window_end) <= $2::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM delivery_issues i
           WHERE i.delivery_job_id = j.id AND i.code = 'delay' AND i.status = 'open'
             AND i.metadata->>'autoDetected' = 'true'
        )
      ORDER BY COALESCE(snap.eta_at, j.estimated_arrival_at, j.delivery_window_end) ASC
      LIMIT $3`,
    [ACTIVE_STATUSES, thresholdIso, BATCH_SIZE],
  );
  let escalated = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const etaAt = new Date(job.snapshot_eta_at || job.estimated_arrival_at || job.delivery_window_end);
      const minutesLate = Math.max(0, Math.floor((nowMs - etaAt.getTime()) / 60000));
      const metadata = {
        autoDetected: true,
        etaAt: etaAt.toISOString(),
        minutesLate,
        episodeStartedAt: nowIso,
      };
      const { rowCount } = await db.query(
        `INSERT INTO delivery_issues (delivery_job_id, code, description, reported_by_user_id, metadata)
           SELECT $1, 'delay', $2, NULL, $3::jsonb
            WHERE NOT EXISTS (
              SELECT 1 FROM delivery_issues i
               WHERE i.delivery_job_id = $1 AND i.code = 'delay' AND i.status = 'open'
                 AND i.metadata->>'autoDetected' = 'true'
            )`,
        [job.id, `Delivery ${job.reference} is ${minutesLate} minutes past its estimated arrival and has been escalated to dispatch.`, JSON.stringify(metadata)],
      );
      if (!rowCount) continue;
      await db.query(
        'UPDATE delivery_jobs SET delay_escalated_at = $2, updated_at = NOW() WHERE id = $1',
        [job.id, nowIso],
      );
      const { recordActivity } = require('./localDeliveryIntegrity');
      await recordActivity(db, job.id, null, 'delivery_delay_escalated', { etaAt: etaAt.toISOString(), minutesLate }, true);
      escalated += 1;
    } catch (err) {
      failed += 1;
    }
  }
  return { escalated, failed, examined: jobs.length };
}

module.exports = { sweepDelayedDeliveries, DELAY_THRESHOLD_MINUTES };
