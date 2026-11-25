// server/services/deliveryOfferDigestService.js
// Group 9 partials Wave 2 Batch M (456, G9-A9, D-538): the new-offer
// digest. The inbox is pull-only, so a job released to the marketplace
// can expire unclaimed without any driver ever seeing it. This sweep
// sends one periodic digest per eligible driver instead of fanning out
// per release to every driver (the Nov 13 cost finding #1 failure mode:
// a per-release fan-out to all admitted drivers).
//
// Caps, all deliberate:
//   * only offers released in the last 24h and still live (deadline in
//     the future, not yet expired);
//   * only drivers who are approved, active AND available, whose stored
//     service area is set and covers the job (areaCovers);
//   * at most 25 drivers per job, 10 jobs per driver per digest, 200
//     notifications per run, 500 candidate profiles per run.
// One `delivery_offer_digest_sent` activity row per job per release
// marks the job digested; a release re-offers with a fresh
// marketplace_released_at, so it is digested again. A failed send
// leaves the job unmarked, so the next run retries it; the idempotency
// key hashes the exact job set, so a retry of the same digest is deduped
// while a later digest with more jobs still sends.
'use strict';

const crypto = require('crypto');
const { areaCovers, hasServiceArea } = require('./localDeliveryDispatchService');
const { recordActivity } = require('./localDeliveryIntegrity');

const DIGEST_WINDOW_HOURS = 24;
const MAX_JOBS_PER_RUN = 200;
const MAX_CANDIDATE_PROFILES = 500;
const MAX_DRIVERS_PER_JOB = 25;
const MAX_JOBS_PER_DRIVER = 10;
const MAX_NOTIFICATIONS_PER_RUN = 200;

async function sweepDeliveryOfferDigest(db, { now = new Date(), send = null } = {}) {
  const sender = send || require('./notificationService').sendNotification;
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowIso = nowDate.toISOString();
  const windowStart = new Date(nowDate.getTime() - DIGEST_WINDOW_HOURS * 3600 * 1000).toISOString();

  const { rows: jobs } = await db.query(
    `SELECT id, reference, origin_state, origin_city, origin_postal_code, origin_lat, origin_lng,
            destination_state, destination_city, destination_postal_code, destination_lat, destination_lng,
            marketplace_released_at, offer_expires_at
       FROM delivery_jobs
      WHERE status = 'posted'
        AND dispatch_state = 'marketplace_posted'
        AND fulfillment_source = 'marketplace'
        AND marketplace_released_at >= $1::timestamptz
        AND marketplace_released_at <= $2::timestamptz
        AND offer_expired_at IS NULL
        AND offer_expires_at > $2::timestamptz
      ORDER BY marketplace_released_at ASC
      LIMIT $3`,
    [windowStart, nowIso, MAX_JOBS_PER_RUN],
  );

  // Skip jobs already digested for this exact release.
  let pending = jobs;
  if (jobs.length) {
    const { rows: digested } = await db.query(
      `SELECT delivery_job_id, payload FROM delivery_activity
        WHERE delivery_job_id = ANY($1::bigint[]) AND event_type = 'delivery_offer_digest_sent'`,
      [jobs.map((job) => job.id)],
    );
    const digestedRelease = new Map();
    for (const row of digested) {
      if (row.payload?.releasedAt) digestedRelease.set(String(row.delivery_job_id), row.payload.releasedAt);
    }
    pending = jobs.filter((job) => {
      const releasedAt = job.marketplace_released_at ? new Date(job.marketplace_released_at).toISOString() : null;
      return !releasedAt || digestedRelease.get(String(job.id)) !== releasedAt;
    });
  }
  if (!pending.length) return { examined: jobs.length, pending: 0, notified: 0, failed: 0, jobs: 0 };

  const { rows: profiles } = await db.query(
    `SELECT user_id, service_area FROM delivery_driver_profiles
      WHERE approved = TRUE AND active = TRUE AND available = TRUE
      ORDER BY updated_at DESC LIMIT $1`,
    [MAX_CANDIDATE_PROFILES],
  );
  // A legacy profile may still carry its service area as a bare JSON
  // string; hasServiceArea parses those, but areaCovers rejects
  // non-objects, so parse once here and drop what does not parse.
  const candidates = profiles
    .map((profile) => {
      let area = profile.service_area;
      if (typeof area === 'string') {
        try { area = JSON.parse(area); } catch (_) { return null; }
      }
      return { userId: String(profile.user_id), area };
    })
    .filter((candidate) => candidate && hasServiceArea(candidate.area));
  if (!candidates.length) return { examined: jobs.length, pending: pending.length, notified: 0, failed: 0, jobs: 0 };

  // Group live offers per eligible driver, earliest release first.
  const perDriver = new Map();
  for (const job of pending) {
    const drivers = candidates.filter((candidate) => areaCovers(candidate.area, job)).slice(0, MAX_DRIVERS_PER_JOB);
    for (const candidate of drivers) {
      const list = perDriver.get(candidate.userId) || [];
      if (list.length < MAX_JOBS_PER_DRIVER) list.push(job);
      perDriver.set(candidate.userId, list);
    }
  }

  let notified = 0;
  let failed = 0;
  // Only a job that reached at least one driver in a successful send is
  // marked digested. A job no driver covers, or that only sat past a
  // driver's 10-job cap, stays pending and is retried on the next run
  // while its release window is open; marking it would silently drop
  // it from every later digest.
  const notifiedJobIds = new Set();
  const jobFailed = new Set();
  for (const [driverId, driverJobs] of perDriver) {
    if (notified + failed >= MAX_NOTIFICATIONS_PER_RUN) break;
    // The idempotency key hashes the exact job set, so a retry of the
    // same digest is deduped while a later digest that adds jobs (a new
    // release joined the window) gets a fresh key and still sends.
    const digestKey = crypto.createHash('sha256')
      .update(driverJobs.map((job) => String(job.id)).sort().join(','))
      .digest('hex').slice(0, 16);
    const result = await sender({
      userId: driverId,
      type: 'delivery_offer_digest',
      data: {
        params: { count: driverJobs.length },
        deliveryJobIds: driverJobs.map((job) => String(job.id)),
        references: driverJobs.map((job) => job.reference),
      },
      action_url: '/delivery',
      idempotencyKey: `delivery-offer-digest:${driverId}:${digestKey}`,
    });
    // Read the send result: a failed insert or a suppressed channel
    // returns success false while the caller keeps going, so the job
    // must stay unmarked for the next run instead of being lost.
    if (result?.success) {
      notified += 1;
      for (const job of driverJobs) notifiedJobIds.add(String(job.id));
    } else {
      failed += 1;
      for (const job of driverJobs) jobFailed.add(String(job.id));
    }
  }

  // Mark only the jobs every driver send succeeded for; a job with any
  // failed send, or that reached no driver at all, is retried on the
  // next run.
  let marked = 0;
  for (const job of pending) {
    if (!notifiedJobIds.has(String(job.id)) || jobFailed.has(String(job.id))) continue;
    const releasedAt = job.marketplace_released_at ? new Date(job.marketplace_released_at).toISOString() : null;
    await recordActivity(db, job.id, null, 'delivery_offer_digest_sent', { releasedAt }, false);
    marked += 1;
  }
  return { examined: jobs.length, pending: pending.length, notified, failed, jobs: marked };
}

module.exports = {
  sweepDeliveryOfferDigest,
  DIGEST_WINDOW_HOURS,
  MAX_DRIVERS_PER_JOB,
  MAX_JOBS_PER_DRIVER,
  MAX_NOTIFICATIONS_PER_RUN,
};
