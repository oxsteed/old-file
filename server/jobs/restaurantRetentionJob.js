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
const { withFencedJobLock } = require('./jobLockingService');
const { anonymizeFormerStaff } = require('../services/restaurantRetentionService');
const { enqueueStorageDeletion, resolveKey } = require('../services/storageCleanupService');

const JOB_NAME = 'restaurant-retention-sweep';
const CRON_EXPRESSION = '0 30 3 * * 0'; // weekly, Sunday 03:30 server time

// Domain 8 #12: the sweep used to load the entire backlog with two
// unbounded SELECTs and process it one person at a time under a
// single 900s lease. Both due queries are now bounded to this many
// rows per batch and paged with a last-processed (keyset) cursor, so
// a large multi-restaurant backlog is worked through in batches
// instead of materialized fully. Rows that fail stay due but fall
// behind the cursor, so a failed row is retried next run, never
// re-selected forever in this one. MAX_SWEEP_BATCHES bounds a single
// run if the cursor ever stops advancing; the remainder waits for
// the next weekly run.
const SWEEP_BATCH_LIMIT = 200;
const MAX_SWEEP_BATCHES = 500;

async function anonymizePerson(db, { businessId, userId, retainUntil }) {
  const { rows: restaurants } = await db.query(
    'SELECT id FROM food_restaurants WHERE business_id = $1 ORDER BY id',
    [businessId]
  );
  const totals = { documents_deleted: 0, time_entry_notes_cleared: 0, labor_profile_removed: 0, history_rows_retained: 0, storage_keys_enqueued: 0 };
  for (const restaurant of restaurants) {
    const outcome = await anonymizeFormerStaff(db, {
      businessId, restaurantId: Number(restaurant.id), userId, retainUntil,
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
  return { skipped: false, ...totals };
}

async function sweep(db = pool, { batchLimit = SWEEP_BATCH_LIMIT } = {}) {
  const limit = Math.max(1, Math.min(Number(batchLimit) || SWEEP_BATCH_LIMIT, 1000));
  const result = { completedRequests: 0, autoAnonymized: 0, skipped: 0, errors: [], incidentId: null };
  // 1. Approved erasure requests past retention, in keyset-paged
  // batches ordered by (requested_at, id). A completed request
  // leaves the due set; a failed one stays due but falls behind the
  // cursor, so it is retried next run, never re-selected in this one.
  let requestCursor = null;
  for (let batch = 0; batch < MAX_SWEEP_BATCHES; batch += 1) {
    const cursorClause = requestCursor
      ? 'AND (er.requested_at, er.id) > ($1::timestamptz, $2::bigint)'
      : '';
    const cursorParams = requestCursor ? [requestCursor.requestedAt, requestCursor.id] : [];
    const { rows: dueRequests } = await db.query(
      `SELECT er.* FROM restaurant_erasure_requests er
        WHERE er.status = 'approved'
          AND EXISTS (
            SELECT 1 FROM staff_offboarding_records o
             WHERE o.business_id = er.business_id AND o.user_id = er.user_id
               AND o.retain_until < CURRENT_DATE
          )
          ${cursorClause}
        ORDER BY er.requested_at, er.id
        LIMIT $${cursorParams.length + 1}`,
      [...cursorParams, limit]
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
        result.errors.push({ request_id: Number(request.id), error: err.message });
        logger.error('Retention sweep erasure failed', { requestId: request.id, error: err.message });
      }
    }
    if (dueRequests.length < limit) break;
    requestCursor = {
      requestedAt: dueRequests[dueRequests.length - 1].requested_at,
      id: dueRequests[dueRequests.length - 1].id,
    };
    if (batch === MAX_SWEEP_BATCHES - 1) {
      logger.warn('Retention sweep hit the per-run batch cap; the remaining erasure requests wait for the next run', { batches: MAX_SWEEP_BATCHES });
    }
  }
  // 2. Offboarded staff past retention with no completed erasure yet,
  // in keyset-paged batches ordered by (business_id, user_id). An
  // auto-anonymized person leaves the due set (the completed erasure
  // row just inserted excludes them); a failed one falls behind the
  // cursor the same way as above.
  let staffCursor = null;
  for (let batch = 0; batch < MAX_SWEEP_BATCHES; batch += 1) {
    const cursorClause = staffCursor
      ? 'AND (o.business_id, o.user_id) > ($1::int, $2::uuid)'
      : '';
    const cursorParams = staffCursor ? [staffCursor.businessId, staffCursor.userId] : [];
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
          ${cursorClause}
        ORDER BY o.business_id, o.user_id, o.created_at DESC
        LIMIT $${cursorParams.length + 1}`,
      [...cursorParams, limit]
    );
    for (const person of dueStaff) {
      try {
        const outcome = await anonymizePerson(db, {
          businessId: Number(person.business_id),
          userId: person.user_id,
          retainUntil: person.retain_until,
        });
        if (outcome.skipped) { result.skipped += 1; continue; }
        await db.query(
          `INSERT INTO restaurant_erasure_requests
             (business_id, user_id, requested_by, status, reason, completed_at, outcome)
           VALUES ($1, $2, NULL, 'completed', 'retention_expired_auto', NOW(), $3::jsonb)`,
          [person.business_id, person.user_id, JSON.stringify(outcome)]
        );
        result.autoAnonymized += 1;
      } catch (err) {
        result.errors.push({ user_id: person.user_id, error: err.message });
        logger.error('Retention sweep auto-anonymize failed', { userId: person.user_id, error: err.message });
      }
    }
    if (dueStaff.length < limit) break;
    staffCursor = {
      businessId: dueStaff[dueStaff.length - 1].business_id,
      userId: dueStaff[dueStaff.length - 1].user_id,
    };
    if (batch === MAX_SWEEP_BATCHES - 1) {
      logger.warn('Retention sweep hit the per-run batch cap; the remaining offboarded staff wait for the next run', { batches: MAX_SWEEP_BATCHES });
    }
  }
  // Domain 8 #12: per-person failures used to surface only as log
  // lines. Raise one deduped incident per day naming the failures so
  // an operator sees them. Incident bookkeeping must never fail the
  // sweep itself.
  if (result.errors.length > 0) {
    try {
      const { recordIncident } = require('../services/incidentStore');
      const recorded = await recordIncident({
        type: 'restaurant_retention_sweep_errors',
        severity: 'high',
        message: `Restaurant retention sweep failed for ${result.errors.length} person(s); they stay due for the next run`,
        dedupeKey: `restaurant-retention-sweep-errors:${new Date().toISOString().slice(0, 10)}`,
        details: { errorCount: result.errors.length, errors: result.errors.slice(0, 5) },
      });
      result.incidentId = recorded?.incident?.id ?? null;
    } catch (incidentErr) {
      logger.error('Retention sweep incident could not be recorded', { error: incidentErr.message });
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
  sweep,
  cronExpression: CRON_EXPRESSION,
  SWEEP_BATCH_LIMIT,
  MAX_SWEEP_BATCHES,
};
