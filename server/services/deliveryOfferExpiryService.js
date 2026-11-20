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

module.exports = { sweepExpiredDeliveryOffers };
