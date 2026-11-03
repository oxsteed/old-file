"use strict";
/**
 * Background work for the Customer 360 upgrades. Every task is safe to run
 * on several instances at once (SKIP LOCKED / idempotent upserts), so no
 * global lock is needed. CUSTOMER360_UPGRADES_ENABLED=false stops the loop
 * without deleting data; source triggers keep filling the event inbox.
 */
const logger = require("../utils/logger");
const events = require("../services/customer360Events");
const health = require("../services/customer360Health");
const anomalies = require("../services/customer360Anomalies");
const links = require("../services/customer360Links");
const lifecycle = require("../services/customer360Lifecycle");
const summaries = require("../services/customer360Summaries");

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

// Upgrade 2: rescore customers with new events, then age out stale scores.
registerTask("health-events", 60_000, () => health.refreshFromEvents());
registerTask("health-stale", 600_000, () => health.refreshStale());

// Upgrade 4: anomaly detectors and snooze expiry (delivery is the alert worker).
registerTask("anomalies", 60_000, async () => {
  await anomalies.scanLogins();
  await anomalies.scanRefunds();
  await anomalies.scanPayouts();
  await anomalies.expireSnoozes();
});

// Upgrade 5: refresh keyed identity-signal digests (wraps around continuously).
registerTask("signals", 60_000, async () => {
  await links.sweep("users");
  await links.sweep("bank");
});

// Upgrade 7: lifecycle stages (events first, then a continuous full sweep)
// and the cohort aggregate table.
registerTask("lifecycle-events", 30_000, () => lifecycle.refreshFromEvents());
registerTask("lifecycle-sweep", 15_000, () => lifecycle.sweep());
registerTask("cohort-stats", 6 * 3600_000, () => lifecycle.rebuildCohortStats());

// Upgrade 10: feed queues follow their sources; SLA breaches are stamped once.
const queues = require("../services/customer360Queues");
registerTask("queue-feeds", 60_000, () => queues.syncFeeds());
registerTask("queue-sla", 60_000, () => queues.markBreaches());
// Upgrade 12: events flag summaries dirty; dirty rows recompute first, then the TTL sweep.
registerTask("summary-events", 15_000, async () => {
  for (let i = 0; i < 5; i += 1) {
    const { seen } = await summaries.markFromEvents({ batch: 10000 });
    if (seen < 10000) break;
  }
});
registerTask("summary-dirty", 15_000, () => summaries.computeDirty({ limit: 200 }));
registerTask("summary-stale", 60_000, () => summaries.sweepStale({ limit: 200 }));

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
