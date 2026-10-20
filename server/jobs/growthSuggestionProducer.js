"use strict";
// Nightly suggestion production (spec 12). Runs on the hourly worker tick
// but claims one run per day in growth_suggestion_runs; the actual work is
// growth/recommend/produce.js. Default-off with the rest of the engine:
// the worker schedule only registers it when the tracking hard-off switch
// is explicitly false, and produce() itself re-checks the rollout gate.
const { withFencedJobLock } = require("./jobLockingService");

async function run() {
  if (process.env.GROWTH_TRACKING_HARD_OFF !== "false")
    return { skipped: true };
  return withFencedJobLock(
    "growth-suggestions",
    async (fence) => {
      const day = new Date().toISOString().slice(0, 10);
      const {
        rows: [existing],
      } = await fence.db.query(
        "SELECT id,status,started_at FROM growth_suggestion_runs WHERE day=$1",
        [day],
      );
      if (existing?.status === "complete") return { skipped: true };
      if (
        existing &&
        Date.now() - new Date(existing.started_at).getTime() < 2 * 3600 * 1000
      )
        return { skipped: true };
      const {
        rows: [runRow],
      } = existing
        ? await fence.db.query(
            "UPDATE growth_suggestion_runs SET status='running',started_at=NOW() WHERE id=$1 RETURNING id",
            [existing.id],
          )
        : await fence.db.query(
            "INSERT INTO growth_suggestion_runs(day,status) VALUES($1,'running') RETURNING id",
            [day],
          );
      const summary = await require("../growth/recommend/produce").produce(
        fence.db,
      );
      await fence.db.query(
        "UPDATE growth_suggestion_runs SET status='complete',completed_at=NOW(),counts=$2 WHERE id=$1",
        [runRow.id, summary],
      );
      return summary;
    },
    3600,
  );
}
module.exports = { run };
