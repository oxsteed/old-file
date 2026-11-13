'use strict';

// Phase 7 (gap 21): weekly retention sweep for former restaurant staff.
// Runs Sundays at 03:30 server time. Two parts, each isolated so one
// failing person never blocks the rest:
//
//   1. Approved erasure requests whose retention deadline has passed
//      are completed (anonymize + outcome recorded on the request).
//   2. Former staff with an offboarding record whose retain_until has
//      passed — and no completed erasure yet — are anonymized
//      automatically and a completed erasure row is recorded as the
//      audit trail (reason 'retention_expired_auto').
//
// Anonymization never deletes history: time entries, pay runs,
// schedule versions and audit rows stay; only personal content is
// cleared (see restaurantRetentionService.anonymizeFormerStaff). A
// person whose retention has NOT expired is skipped, never forced.

const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock, LeaseLostError } = require('./jobLockingService');
const { anonymizeFormerStaff, scrubBusinessAuditLogNames } = require('../services/restaurantRetentionService');
const { enqueueStorageDeletion, resolveKey } = require('../services/storageCleanupService');

const JOB_NAME = 'restaurant-retention-sweep';
const CRON_EXPRESSION = '0 30 3 * * 0'; // weekly, Sunday 03:30 server time

async function anonymizePerson(db, { businessId, userId, retainUntil }) {
  const { rows: restaurants } = await db.query(
    'SELECT id FROM food_restaurants WHERE business_id = $1 ORDER BY id',
    [businessId]
  );
  const totals = { documents_deleted: 0, time_entry_notes_cleared: 0, labor_profile_removed: 0, history_rows_retained: 0, storage_keys_enqueued: 0, audit_names_scrubbed: 0 };
  for (const restaurant of restaurants) {
    const outcome = await anonymizeFormerStaff(db, {
      businessId, restaurantId: Number(restaurant.id), userId, retainUntil,
      // Money flows W7: the audit-log scrub is business-scoped, so
      // it runs once below, after the restaurant loop, instead of
      // once per restaurant inside anonymizeFormerStaff.
      skipAuditScrub: true,
    });
    if (outcome.skipped) return { skipped: true, retain_until: outcome.retain_until };
    totals.documents_deleted += outcome.documents_deleted;
    totals.time_entry_notes_cleared += outcome.time_entry_notes_cleared;
    totals.labor_profile_removed += outcome.labor_profile_removed;
    totals.history_rows_retained = Math.max(totals.history_rows_retained, outcome.history_rows_retained);
    // Background-jobs audit #40: enqueue this restaurant's keys NOW,
    // before moving to the next restaurant. The old code accumulated
    // keys across restaurants and enqueued only after the loop, so a
    // throw in a later restaurant discarded already-anonymized
    // restaurants' keys; the retry then found no docs (already
    // soft-deleted) and completed the erasure with the files still in
    // storage. The enqueue runs on the same handle as the sweep (the
    // fence's handle in the job path), and a failed enqueue for a
    // resolvable key fails the erasure instead of completing it: the
    // retry re-derives the key from the soft-deleted row.
    for (const key of outcome.storageKeysToDelete || []) {
      if (!resolveKey(key)) continue; // data: URLs and empty keys name no object
      const queued = await enqueueStorageDeletion(key, 'staff_erasure', { client: db });
      if (!queued) {
        throw new Error(`Failed to queue storage deletion for a staff document in restaurant ${restaurant.id}`);
      }
      totals.storage_keys_enqueued += 1;
    }
  }
  // Money flows W7: one audit-log pass per business per person. The
  // audit log carries business_id, not restaurant_id, so scrubbing
  // it inside the per-restaurant loop above scanned the whole
  // business log once per restaurant. The scrub runs here, once,
  // after every restaurant is anonymized — and only then, so a
  // person whose erasure is skipped or throws keeps their audit
  // names until the erasure actually completes.
  const { rows: [person] } = await db.query(
    'SELECT first_name, last_name FROM users WHERE id = $1',
    [userId]
  );
  const firstName = String(person?.first_name || '').trim();
  const lastName = String(person?.last_name || '').trim();
  totals.audit_names_scrubbed = await scrubBusinessAuditLogNames(db, {
    businessId, firstName, lastName, fullName: `${firstName} ${lastName}`.trim(),
  });
  return { skipped: false, ...totals };
}

// Money flows W10: record the sweep's auto-completed erasure row.
// The partial unique index idx_erasure_requests_completed_dedupe
// (business_id, user_id) WHERE status = 'completed' is the dedupe:
// two overlapping sweeps can both pass the NOT EXISTS check, and the
// loser must dedupe instead of inserting a second completed row (or
// erroring on 23505). ON CONFLICT DO NOTHING against the partial
// index returns no row for the loser; the caller counts only a real
// insert. Returns { inserted: true/false }.
async function recordAutoCompletedErasure(db, { businessId, userId, outcome } = {}) {
  const { rows } = await db.query(
    `INSERT INTO restaurant_erasure_requests
       (business_id, user_id, requested_by, status, reason, completed_at, outcome)
     VALUES ($1, $2, NULL, 'completed', 'retention_expired_auto', NOW(), $3::jsonb)
     ON CONFLICT (business_id, user_id) WHERE status = 'completed' DO NOTHING
     RETURNING id`,
    [businessId, userId, JSON.stringify(outcome || {})]
  );
  return { inserted: rows.length > 0 };
}

async function sweep(db = pool) {
  const result = { completedRequests: 0, autoAnonymized: 0, skipped: 0, errors: [] };
  // 1. Approved erasure requests past retention.
  const { rows: dueRequests } = await db.query(
    `SELECT er.* FROM restaurant_erasure_requests er
      WHERE er.status = 'approved'
        AND EXISTS (
          SELECT 1 FROM staff_offboarding_records o
           WHERE o.business_id = er.business_id AND o.user_id = er.user_id
             AND o.retain_until < CURRENT_DATE
        )
      ORDER BY er.requested_at`
  );
  for (const request of dueRequests) {
    try {
      const { rows: [offboarding] } = await db.query(
        `SELECT retain_until FROM staff_offboarding_records
          WHERE business_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [request.business_id, request.user_id]
      );
      const outcome = await anonymizePerson(db, {
        businessId: Number(request.business_id),
        userId: request.user_id,
        retainUntil: offboarding?.retain_until || null,
      });
      if (outcome.skipped) { result.skipped += 1; continue; }
      await db.query(
        `UPDATE restaurant_erasure_requests
            SET status = 'completed', completed_at = NOW(), outcome = $2::jsonb, updated_at = NOW()
          WHERE id = $1`,
        [request.id, JSON.stringify(outcome)]
      );
      result.completedRequests += 1;
    } catch (err) {
      // Money flows W4: a lost lease is not one failed person. The
      // fence's handle refuses further writes, so rethrow instead
      // of recording the loss as a per-person error and continuing:
      // withFencedJobLock converts the throw into { fenced: true }
      // and the remaining persons wait for the next weekly run.
      if (err instanceof LeaseLostError) throw err;
      result.errors.push({ request_id: Number(request.id), error: err.message });
      logger.error('Retention sweep erasure failed', { requestId: request.id, error: err.message });
    }
  }
  // 2. Offboarded staff past retention with no completed erasure yet.
  const { rows: dueStaff } = await db.query(
    `SELECT DISTINCT ON (o.business_id, o.user_id)
            o.business_id, o.user_id, o.retain_until
       FROM staff_offboarding_records o
      WHERE o.retain_until < CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM restaurant_erasure_requests er
           WHERE er.business_id = o.business_id AND er.user_id = o.user_id
             AND er.status = 'completed'
        )
      ORDER BY o.business_id, o.user_id, o.created_at DESC`
  );
  for (const person of dueStaff) {
    try {
      const outcome = await anonymizePerson(db, {
        businessId: Number(person.business_id),
        userId: person.user_id,
        retainUntil: person.retain_until,
      });
      if (outcome.skipped) { result.skipped += 1; continue; }
      // Money flows W10: the insert dedupes on the completed-rows
      // index. A concurrent sweep that completed this person first
      // makes this insert a no-op (inserted:false); the person is
      // anonymized either way, so count only a real insert and
      // record no error.
      const { inserted } = await recordAutoCompletedErasure(db, {
        businessId: Number(person.business_id),
        userId: person.user_id,
        outcome,
      });
      if (inserted) result.autoAnonymized += 1;
    } catch (err) {
      // Money flows W4: see the part-1 catch above. Without the
      // rethrow a lease lost in this pass was swallowed per person
      // and the sweep returned normally (no { fenced: true }, no
      // incident), while the remaining persons were never processed.
      if (err instanceof LeaseLostError) throw err;
      result.errors.push({ user_id: person.user_id, error: err.message });
      logger.error('Retention sweep auto-anonymize failed', { userId: person.user_id, error: err.message });
    }
  }
  return result;
}

async function runRestaurantRetentionJob(db = pool) {
  let result = { locked: false };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    // Background-jobs audit #43: the sweep runs on the fence's handle,
    // not the raw pool, so a worker that lost its lease cannot keep
    // anonymizing. anonymizePerson / anonymizeFormerStaff only ever
    // call db.query, so fence.db is a drop-in handle here.
    result = { locked: true, ...(await sweep(fence.db)) };
  }, 900, { throwOnError: true });
  logger.info('Restaurant retention sweep finished', result);
  return result;
}

function startRestaurantRetentionJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runRestaurantRetentionJob();
    } catch (err) {
      logger.error('Restaurant retention cron error', { error: err.message });
    }
  });
  logger.info('Restaurant retention job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startRestaurantRetentionJob,
  runRestaurantRetentionJob,
  recordAutoCompletedErasure,
  anonymizePerson,
  sweep,
  cronExpression: CRON_EXPRESSION,
};
