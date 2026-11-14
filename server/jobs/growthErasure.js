"use strict";
/**
 * Growth erasure worker: completes the Postgres-side erasure queued by
 * growth/rights.js erase() by deleting the subject's rows from the
 * ClickHouse activity tables.
 *
 * ERASURE CONTRACT — known residual (D16, privacy retention policy,
 * Emile 2026-10-22): the growth.activity_hourly table materializes
 * uniqState(toString(subject_key)) per hour. An HLL sketch cannot support
 * individual-subject deletion, so an erased subject's key remains
 * irreversibly merged into the hourly sketch until its TTL expires. The
 * sketch is not invertible back to the key, but "erasure is complete" does
 * NOT mean the sketch is unmerged. The residual is bounded by the sketch
 * TTL (90 days since C006, down from 13 months), matching the raw
 * activity_events retention. Completion below means physical removal from
 * activity_events and subject_activity_daily (synchronous mutations on all
 * replicas, verified to zero rows), plus the documented sketch residual.
 */
const { withFencedJobLock } = require("./jobLockingService");

// Verification failures used to rethrow hourly forever with no bound and
// no incident. After this many failed verifications a batch is parked:
// the rows leave the worker's selection (status 'parked' is not selected
// below) and a high incident names them, so an operator inspects them
// instead of the queue retrying without end.
function verificationCap(env = process.env) {
  const raw = parseInt(env.GROWTH_ERASURE_MAX_VERIFICATION_ATTEMPTS, 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 3;
}

async function run() {
  if (!process.env.GROWTH_CLICKHOUSE_URL) {
    // Preserve requests even after configuration is removed. Never discard an
    // erasure merely because its historical event store is currently offline.
    // Parked rows are operator-held, not pending, so they stay out of this count.
    const { rows } = await require('../db').query("SELECT COUNT(*)::int AS pending FROM growth_erasure_queue WHERE status IN ('pending','masked')");
    const pending = Number(rows[0]?.pending || 0);
    if (pending) await require('../services/incidentStore').recordIncident({
      type: 'growth_erasure_unavailable', severity: 'high',
      message: 'Growth erasure is pending while ClickHouse is unconfigured',
      dedupeKey: 'growth:erasure:unconfigured', details: { pending },
    });
    return { skipped: true, reason: 'clickhouse_unconfigured', pending };
  }
  return withFencedJobLock(
    "growth-erasure",
    async (fence) => {
      const { rows } = await fence.db.query(
        "SELECT * FROM growth_erasure_queue WHERE status IN ('pending','masked') AND requested_at<=NOW()-interval '5 minutes' ORDER BY id LIMIT 1000",
      );
      if (!rows.length) return { completed: 0 };
      for (const row of rows)
        await require("../growth/queue").eraseSubject(row.subject_key);
      const store = require("../growth/clickhouse").getClient("rights");
      const subjects = [...new Set(rows.map((r) => r.subject_key))],
        devices = [...new Set(rows.flatMap((r) => r.device_keys))];
      // Synchronous mutations rewrite parts on all replicas: completion here
      // means physical removal, rather than merely a lightweight delete mask.
      // Note the documented residual: growth.activity_hourly keeps the
      // subject's key irreversibly merged in its HLL sketch until the
      // sketch TTL expires (see the contract comment at the top of this file).
      for (const table of ["activity_events", "subject_activity_daily"]) {
        fence.assertActive();
        await store.command({
          query: `ALTER TABLE growth.${table} ON CLUSTER growth DELETE WHERE
        subject_key IN {subjects:Array(String)}${table === "activity_events" ? " OR device_key IN {devices:Array(String)}" : ""}`,
          query_params: { subjects, devices },
          clickhouse_settings: {
            mutations_sync: "2",
            distributed_ddl_task_timeout: "60",
          },
        });
      }
      let verificationFailed = null;
      for (const table of ["activity_events", "subject_activity_daily"]) {
        const result = await store.query({
          query: `SELECT count() AS remaining FROM growth.${table} FINAL WHERE subject_key IN {subjects:Array(String)}
        ${table === "activity_events" ? " OR device_key IN {devices:Array(String)}" : ""}`,
          query_params: { subjects, devices },
          format: "JSONEachRow",
        });
        if (Number((await result.json())[0].remaining) !== 0) {
          verificationFailed = table;
          break;
        }
      }
      if (verificationFailed) {
        // Bookkeeping goes through the raw pool, not the fence transaction:
        // below the cap this run still rethrows (the fence rolls back),
        // and the attempt count must survive that rollback to bound retries.
        const pool = require('../db');
        const { rows: bumped } = await pool.query(
          `UPDATE growth_erasure_queue SET verification_attempts = verification_attempts + 1,
            verification = jsonb_build_object('method', 'synchronous_mutation_all_replicas',
              'error', 'growth_erasure_verification_failed', 'table', $2)
            WHERE id = ANY($1::bigint[]) RETURNING id, verification_attempts`,
          [rows.map((r) => r.id), verificationFailed],
        );
        const attempts = Math.max(...bumped.map((r) => Number(r.verification_attempts || 0)), 0);
        if (attempts >= verificationCap()) {
          await pool.query(
            `UPDATE growth_erasure_queue SET status = 'parked',
              verification = verification || '{"parked":true}'::jsonb WHERE id = ANY($1::bigint[])`,
            [rows.map((r) => r.id)],
          );
          // Same pattern as the unconfigured half above: a high incident
          // names the parked batch instead of log-only hourly retries.
          // Domain 8 #17: the details name the rows to reset (ids and
          // subject keys), so the operator review queue can act on the
          // batch without guessing from the queue.
          await require('../services/incidentStore').recordIncident({
            type: 'growth_erasure_verification_parked', severity: 'high',
            message: 'Growth erasure verification failed repeatedly; rows parked for operator review',
            dedupeKey: 'growth:erasure:verification-parked',
            details: {
              count: rows.length, table: verificationFailed, attempts,
              rowIds: rows.map((r) => Number(r.id)),
              subjectKeys: [...new Set(rows.map((r) => r.subject_key))],
            },
          });
          return { completed: 0, parked: rows.length, verificationAttempts: attempts };
        }
        throw new Error("growth_erasure_verification_failed");
      }
      fence.assertActive();
      await fence.db.query(
        `UPDATE growth_erasure_queue SET status='complete',masked_at=NOW(),completed_at=NOW(),
      verification='{"method":"synchronous_mutation_all_replicas","remaining":0}'::jsonb WHERE id=ANY($1::bigint[])`,
        [rows.map((r) => r.id)],
      );
      return { completed: rows.length };
    },
    300,
  );
}
module.exports = { run, verificationCap };
