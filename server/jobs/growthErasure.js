"use strict";
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
