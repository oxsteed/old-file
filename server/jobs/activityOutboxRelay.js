"use strict";
const { withFencedJobLock } = require("./jobLockingService");
const gate = require("../growth/gate");
const queue = require("../growth/queue");
async function run() {
  if (process.env.GROWTH_TRACKING_HARD_OFF !== "false")
    return { skipped: true };
  return withFencedJobLock(
    "growth-outbox",
    (fence) =>
      fence.fencedTransaction(async (conn) => {
        const { rows } = await conn.query(
          "SELECT * FROM activity_outbox ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED",
        );
        for (const row of rows) {
          fence.assertActive();
          const permission = await gate.allow({
            userId: row.user_id,
            trustedSignals: row.trusted_signals,
            db: conn,
          });
          if (permission.allowed)
            await queue.enqueue(
              [
                {
                  userId: row.user_id,
                  domain: true,
                  trustedSignals: permission.context.trustedSignals,
                  event: {
                    event_id: row.event_id,
                    name: row.event_name,
                    schema_ver: 1,
                    occurred_at: new Date(row.occurred_at).toISOString(),
                    props: row.props,
                  },
                  surface: "server",
                  locale: permission.context.user.preferred_language || "en",
                  app_version: "server",
                  session: "",
                },
              ],
              { domain: true },
            );
          // Denied subjects are purged; a queue failure rolls back every deletion.
          await conn.query("DELETE FROM activity_outbox WHERE id=$1", [row.id]);
        }
        return rows.length;
      }),
    120,
  );
}
module.exports = { run };
