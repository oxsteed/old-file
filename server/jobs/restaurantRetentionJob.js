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
const { notifyErasureSubject } = require('../services/restaurantErasureNotifications');
const { enqueueStorageDeletion, resolveKey } = require('../services/storageCleanupService');

const JOB_NAME = 'restaurant-retention-sweep';
const CRON_EXPRESSION = '0 30 3 * * 0'; // weekly, Sunday 03:30 server time

// Domain 9 (2026-11-13) item 4: the sweep used to claim every due row
// with no LIMIT and no lock, so a bulk offboarding or a long-unrun
// weekly run processed thousands of people serially under one 900s
// fence lease; a lease loss mid-run abandoned the rest to next Sunday.
// Each part now takes at most this many rows per run (the next weekly
// run picks up the rest), claimed FOR UPDATE SKIP LOCKED so a
// concurrent sweep cannot double-process the same row. Same 200-row
// claim shape as the no-show sweeper.
const RETENTION_SWEEP_BATCH_LIMIT = 200;

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
// insert. Returns { inserted: true/false, id: <row id or null> }.
// The id lets the caller notify the subject about the row it created
// (money-flows W3); the losing sweep must not notify, since the
// winning sweep notifies for the same completed row.
async function recordAutoCompletedErasure(db, { businessId, userId, outcome } = {}) {
  const { rows } = await db.query(
    `INSERT INTO restaurant_erasure_requests
       (business_id, user_id, requested_by, status, reason, completed_at, outcome)
     VALUES ($1, $2, NULL, 'completed', 'retention_expired_auto', NOW(), $3::jsonb)
     ON CONFLICT (business_id, user_id) WHERE status = 'completed' DO NOTHING
     RETURNING id`,
    [businessId, userId, JSON.stringify(outcome || {})]
  );
  return { inserted: rows.length > 0, id: rows.length > 0 ? rows[0].id : null };
}

async function sweep(db = pool) {
  const result = { completedRequests: 0, autoAnonymized: 0, skipped: 0, errors: [], hitBatchLimit: false };
  // 1. Approved erasure requests past retention.
  // Domain 9 item 4: LIMIT + FOR UPDATE SKIP LOCKED claim (see the
  // constant above). The latest retain_until rides along in the
  // select now; the old per-request SELECT was an N+1 on top of the
  // unbounded scan.
  const { rows: dueRequests } = await db.query(
    `SELECT er.*,
            (SELECT o.retain_until
               FROM staff_offboarding_records o
              WHERE o.business_id = er.business_id AND o.user_id = er.user_id
              ORDER BY o.created_at DESC, o.id DESC LIMIT 1) AS retain_until
       FROM restaurant_erasure_requests er
      WHERE er.status = 'approved'
        AND EXISTS (
          SELECT 1 FROM staff_offboarding_records o
           WHERE o.business_id = er.business_id AND o.user_id = er.user_id
             AND o.retain_until < CURRENT_DATE
        )
      ORDER BY er.requested_at
      LIMIT $1
      FOR UPDATE OF er SKIP LOCKED`,
    [RETENTION_SWEEP_BATCH_LIMIT]
  );
  for (const request of dueRequests) {
    try {
      const outcome = await anonymizePerson(db, {
        businessId: Number(request.business_id),
        userId: request.user_id,
        retainUntil: request.retain_until || null,
      });
      if (outcome.skipped) { result.skipped += 1; continue; }
      await db.query(
        `UPDATE restaurant_erasure_requests
            SET status = 'completed', completed_at = NOW(), outcome = $2::jsonb, updated_at = NOW()
          WHERE id = $1`,
        [request.id, JSON.stringify(outcome)]
      );
      // Money-flows W3: tell the subject the sweep completed their erasure.
      await notifyErasureSubject(db, {
        userId: request.user_id,
        businessId: Number(request.business_id),
        restaurantId: request.restaurant_id == null ? null : undefined,
        requestId: request.id,
        status: 'completed',
      });
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
  // Domain 9 item 4: LIMIT + FOR UPDATE SKIP LOCKED claim, same as
  // part 1. PostgreSQL forbids FOR UPDATE with DISTINCT, so the
  // old DISTINCT ON (latest record per person) is expressed as "no
  // newer offboarding record exists", with a (created_at, id)
  // tiebreak so the latest record is picked deterministically; the
  // pick is the same latest record DISTINCT ON returned, only the
  // tie is now decided by id instead of arbitrarily.
  const { rows: dueStaff } = await db.query(
    `SELECT o.business_id, o.user_id, o.retain_until
       FROM staff_offboarding_records o
      WHERE o.retain_until < CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM staff_offboarding_records o2
           WHERE o2.business_id = o.business_id AND o2.user_id = o.user_id
             AND (o2.created_at > o.created_at
                  OR (o2.created_at = o.created_at AND o2.id > o.id))
        )
        AND NOT EXISTS (
          SELECT 1 FROM restaurant_erasure_requests er
           WHERE er.business_id = o.business_id AND er.user_id = o.user_id
             AND er.status = 'completed'
        )
      ORDER BY o.business_id, o.user_id
      LIMIT $1
      FOR UPDATE OF o SKIP LOCKED`,
    [RETENTION_SWEEP_BATCH_LIMIT]
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
      const { inserted, id: completedId } = await recordAutoCompletedErasure(db, {
        businessId: Number(person.business_id),
        userId: person.user_id,
        outcome,
      });
      if (!inserted) continue;
      // Money-flows W3: tell the subject the sweep erased their data.
      // Only the winning sweep notifies; the loser already has its
      // subject notified by the sweep that completed the person.
      await notifyErasureSubject(db, {
        userId: person.user_id,
        businessId: Number(person.business_id),
        restaurantId: null,
        requestId: completedId,
        status: 'completed',
      });
      result.autoAnonymized += 1;
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
  // A full batch means more due rows remain for the next weekly run;
  // the log line carries it so a backlog is visible, not silent.
  result.hitBatchLimit =
    dueRequests.length >= RETENTION_SWEEP_BATCH_LIMIT || dueStaff.length >= RETENTION_SWEEP_BATCH_LIMIT;
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
  RETENTION_SWEEP_BATCH_LIMIT,
};
