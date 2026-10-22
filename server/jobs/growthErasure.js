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
async function run() {
  if (!process.env.GROWTH_CLICKHOUSE_URL && !process.env.GROWTH_REDIS_URL)
    return { skipped: true };
  return withFencedJobLock(
    "growth-erasure",
    async (fence) => {
      const { rows } = await fence.db.query(
        "SELECT * FROM growth_erasure_queue WHERE status<>'complete' AND requested_at<=NOW()-interval '5 minutes' ORDER BY id LIMIT 1000",
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
      for (const table of ["activity_events", "subject_activity_daily"]) {
        const result = await store.query({
          query: `SELECT count() AS remaining FROM growth.${table} FINAL WHERE subject_key IN {subjects:Array(String)}
        ${table === "activity_events" ? " OR device_key IN {devices:Array(String)}" : ""}`,
          query_params: { subjects, devices },
          format: "JSONEachRow",
        });
        if (Number((await result.json())[0].remaining) !== 0)
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
module.exports = { run };
