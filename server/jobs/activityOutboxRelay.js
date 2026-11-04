"use strict";
const { withFencedJobLock } = require("./jobLockingService");
const gate = require("../growth/gate");
const queue = require("../growth/queue");
async function run() {
  if (process.env.GROWTH_TRACKING_HARD_OFF !== "false")
    return { skipped: true };
  const pending = await require('../db').query("SELECT 1 FROM activity_outbox LIMIT 1");
  if (!pending.rows.length) return { skipped: true };
  return withFencedJobLock(
    "growth-outbox",
    (fence) =>
      fence.fencedTransaction(async (conn) => {
        const { rows } = await conn.query(
          "SELECT * FROM activity_outbox ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED",
        );
        // Cost audit 2026-11-04 item 14: the relay used to build a fresh
        // gate context per row (several queries per row) inside one long
        // transaction. Build the contexts once for the batch instead and
        // decide per row in memory. Contexts are keyed by
        // (user, trusted-signals): one batched contexts() call covers
        // every user whose rows all carry the same signals, and only
        // users with divergent rows get one extra call per signal set,
        // so per-row signal semantics are exactly preserved.
        const signalsByUser = new Map();
        for (const row of rows) {
          const key = JSON.stringify(row.trusted_signals ?? null);
          if (!signalsByUser.has(row.user_id)) signalsByUser.set(row.user_id, new Map());
          signalsByUser.get(row.user_id).set(key, row.trusted_signals);
        }
        const ctxByKey = new Map();
        const singleSignalUsers = [...signalsByUser].filter(([, sets]) => sets.size === 1);
        if (singleSignalUsers.length) {
          const signals = new Map(singleSignalUsers.map(([id, sets]) => [id, [...sets.values()][0]]));
          const ctxs = await gate.contexts(singleSignalUsers.map(([id]) => id), { db: conn, trustedSignals: signals });
          for (const [id, ctx] of ctxs) ctxByKey.set(`${id}\0${[...signalsByUser.get(id).keys()][0]}`, ctx);
        }
        for (const [id, sets] of signalsByUser) {
          if (sets.size === 1) continue;
          for (const [key, signals] of sets) {
            const ctxs = await gate.contexts([id], { db: conn, trustedSignals: new Map([[id, signals]]) });
            ctxByKey.set(`${id}\0${key}`, ctxs.get(id));
          }
        }
        for (const row of rows) {
          fence.assertActive();
          const ctx = ctxByKey.get(`${row.user_id}\0${JSON.stringify(row.trusted_signals ?? null)}`);
          const permission = await gate.allow(ctx, "activity");
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
