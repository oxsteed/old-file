// server/services/deliveryOfferExpiryService.js
// Group 9 Slice B (item 457): response deadline for marketplace offers.
//
// A job posted to the marketplace carries offer_expires_at (set by
// releaseMarketplace, default 24h, D-61). This sweep expires unclaimed
// offers whose deadline has passed: it stamps offer_expired_at and
// notifies the customer (shipper) once (offer_expiry_notice_sent_at).
// Expiry never deletes, cancels, or reassigns the job: it stays posted
// with the expired marker, still visible in the driver's open feed and
// on the dispatch board, until dispatch re-offers it. The claim path
// checks the deadline directly, so a job is unclaimable the moment the
// deadline passes even before this sweep runs. The sweep is safe to
// re-run: stamped rows are skipped, and a failed notice is retried on
// the next run because its stamp is still NULL.
'use strict';

const BATCH_SIZE = 500;

async function sweepExpiredDeliveryOffers(db, { now = new Date(), send = null } = {}) {
  const sender = send || require('./notificationService').sendNotification;
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
  // Unstamped expired offers, plus stamped offers whose customer notice
  // never went out (a failed send leaves the notice stamp NULL).
  const { rows } = await db.query(
    `SELECT id, reference, customer_user_id, offer_expires_at, offer_expired_at
       FROM delivery_jobs
      WHERE status = 'posted'
        AND dispatch_state = 'marketplace_posted'
        AND fulfillment_source = 'marketplace'
        AND (
          (offer_expires_at IS NOT NULL AND offer_expires_at <= $1::timestamptz AND offer_expired_at IS NULL)
          OR (offer_expired_at IS NOT NULL AND offer_expiry_notice_sent_at IS NULL)
        )
      ORDER BY offer_expires_at ASC NULLS LAST
      LIMIT $2`,
    [nowIso, BATCH_SIZE],
  );
  let expired = 0;
  let notified = 0;
  let failed = 0;
  for (const job of rows) {
    const client = db;
    try {
      if (!job.offer_expired_at) {
        const { rowCount } = await client.query(
          `UPDATE delivery_jobs SET offer_expired_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND offer_expired_at IS NULL`,
          [job.id],
        );
        if (!rowCount) continue;
        expired += 1;
        // The timeline keeps the audit trail; the event worker retires
        // this type without fan-out (it is not in the delivery
        // notification catalog), so the customer hears about it exactly
        // once, from the notice below.
        const { recordActivity } = require('./localDeliveryIntegrity');
        await recordActivity(client, job.id, null, 'delivery_offer_expired', { offerExpiresAt: job.offer_expires_at }, true);
      }
      await sender({
        userId: job.customer_user_id,
        type: 'delivery_offer_expired',
        title: 'Delivery offer expired',
        body: `No driver claimed your delivery ${job.reference} before the offer deadline. It is back with dispatch and can be re-offered.`,
        data: { deliveryJobId: job.id, reference: job.reference },
        action_url: `/delivery/jobs/${job.id}`,
      });
      const { rowCount } = await client.query(
        `UPDATE delivery_jobs SET offer_expiry_notice_sent_at = NOW()
          WHERE id = $1 AND offer_expiry_notice_sent_at IS NULL`,
        [job.id],
      );
      if (rowCount) notified += 1;
    } catch (err) {
      failed += 1;
    }
  }
  return { expired, notified, failed, examined: rows.length };
}

// Group 9 partials Wave 2 Batch P (482, G9-B4, D-554): the claim
// timeout. A marketplace claim whose pickup window passes with no
// pickup must not sit forever: the claim is expired, the job goes
// back to the marketplace with a fresh offer deadline, and the
// driver is told the claim expired. The customer already hears
// about the no-show sooner, from the pickup-no-show escalation in
// the delay sweep (D-557), so this notice goes to the driver only.
//
// Scope: marketplace claims only (helper_user_id, dispatch_state
// 'assigned'). An internal assignment is ops-managed and ops can
// already reassign it from the board; expiring it automatically
// would pull work out from under dispatch with no human in the
// loop. Jobs with an open issue or return are skipped: the claim
// must not be yanked while recovery is working on the job.
async function sweepExpiredDeliveryClaims(db, { now = new Date(), send = null } = {}) {
  const sender = send || require('./notificationService').sendNotification;
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
  const { rows } = await db.query(
    `SELECT id, reference, helper_user_id, offer_deadline_hours, pickup_window_end
       FROM delivery_jobs
      WHERE status = 'assigned'
        AND dispatch_state = 'assigned'
        AND helper_user_id IS NOT NULL
        AND picked_up_at IS NULL
        AND pickup_window_end IS NOT NULL
        AND pickup_window_end <= $1::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM delivery_issues i
           WHERE i.delivery_job_id = delivery_jobs.id AND i.status = 'open'
        )
        AND NOT EXISTS (
          SELECT 1 FROM delivery_returns r
           WHERE r.delivery_job_id = delivery_jobs.id AND r.status IN ('requested','approved','in_transit')
        )
      ORDER BY pickup_window_end ASC
      LIMIT $2`,
    [nowIso, BATCH_SIZE],
  );
  let expired = 0;
  let notified = 0;
  let failed = 0;
  for (const job of rows) {
    try {
      const hours = Number(job.offer_deadline_hours) || 24;
      const { rowCount } = await db.query(
        `UPDATE delivery_jobs SET fulfillment_source = 'marketplace', dispatch_state = 'marketplace_posted', status = 'posted',
           helper_user_id = NULL, internal_driver_user_id = NULL, vehicle_id = NULL, assigned_by_user_id = NULL,
           assigned_at = NULL, internal_assigned_at = NULL,
           marketplace_released_at = NOW(), marketplace_release_reason = 'Claim expired: pickup window passed with no pickup',
           offer_expires_at = NOW() + ($2::int * INTERVAL '1 hour'), offer_deadline_hours = $2,
           offer_expired_at = NULL, offer_expiry_notice_sent_at = NULL,
           updated_at = NOW()
         WHERE id = $1 AND status = 'assigned' AND helper_user_id IS NOT NULL AND picked_up_at IS NULL`,
        [job.id, hours],
      );
      if (!rowCount) continue;
      expired += 1;
      await db.query(
        "INSERT INTO delivery_dispatch_attempts (delivery_job_id, source, action, reason, actor_user_id) VALUES ($1,'marketplace','claim_expired','Pickup window passed with no pickup',$2)",
        [job.id, job.helper_user_id],
      );
      const { recordActivity } = require('./localDeliveryIntegrity');
      await recordActivity(db, job.id, null, 'delivery_claim_expired', { pickupWindowEnd: job.pickup_window_end }, true);
      await sender({
        userId: job.helper_user_id,
        type: 'delivery_claim_expired',
        title: 'Delivery claim expired',
        body: `Your claim on delivery ${job.reference} expired because the pickup window passed with no pickup. The delivery is back on the marketplace.`,
        data: { deliveryJobId: job.id, reference: job.reference },
        action_url: `/delivery/jobs/${job.id}`,
      });
      notified += 1;
    } catch (err) {
      failed += 1;
    }
  }
  return { expired, notified, failed, examined: rows.length };
}

module.exports = { sweepExpiredDeliveryOffers, sweepExpiredDeliveryClaims };
