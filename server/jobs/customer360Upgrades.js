"use strict";
/**
 * Background work for the Customer 360 upgrades. Every task is safe to run
 * on several instances at once (SKIP LOCKED / idempotent upserts), so no
 * global lock is needed. CUSTOMER360_UPGRADES_ENABLED=false stops the loop
 * without deleting data; source triggers keep filling the event inbox.
 */
const logger = require("../utils/logger");
const events = require("../services/customer360Events");

const TASKS = [];
function registerTask(name, everyMs, run) {
  TASKS.push({ name, everyMs, run, lastAt: 0, running: false });
}

// Upgrade 1: drain the event outbox, then advance the one-time backfill.
registerTask("events-drain", 10_000, async () => {
  for (let i = 0; i < 10; i += 1) {
    const { moved } = await events.drainInbox({ limit: 500 });
    if (moved < 500) break;
  }
});
registerTask("events-backfill", 30_000, async () => {
  for (const source of Object.keys(events.BACKFILL)) {
    const result = await events.backfillSource(source, { batch: 1000 });
    if (!result.done) return; // one batch per tick keeps load bounded
  }
});

async function tick(now = Date.now()) {
  for (const task of TASKS) {
    if (task.running || now - task.lastAt < task.everyMs) continue;
    task.running = true;
    task.lastAt = now;
    try {
      await task.run();
    } catch (error) {
      logger.warn("Customer 360 background task will retry", { task: task.name, code: error.code, message: error.message });
    } finally {
      task.running = false;
    }
  }
}

function startCustomer360Upgrades() {
  if (process.env.CUSTOMER360_UPGRADES_ENABLED === "false") return { stop() {} };
  let stopped = false;
  let running = null;
  const timer = setInterval(() => {
    if (stopped || running) return;
    running = tick().finally(() => { running = null; });
  }, 5_000);
  timer.unref?.();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      return running;
    },
  };
}

module.exports = { startCustomer360Upgrades, registerTask, tick, TASKS };
