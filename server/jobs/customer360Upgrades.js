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

const INSTANCE = `${require("os").hostname()}:${process.pid}`.slice(0, 120);

/**
 * Gap fill 8: record each run in customer360_worker_heartbeats so the admin
 * summary-health screen can tell running, late and failing tasks apart from
 * any instance. A heartbeat failure is logged and never stops the task loop.
 */
async function heartbeat(task, { startedAt, ok, error = null }) {
  try {
    const db = require("../db");
    await db.query(
      `INSERT INTO customer360_worker_heartbeats
         (task, every_ms, last_started_at, last_finished_at, last_ok_at, last_error_at, last_error_code, last_duration_ms,
          consecutive_failures, runs, failures, instance, updated_at)
       VALUES ($1, $2, $3, NOW(), CASE WHEN $4 THEN NOW() END, CASE WHEN $4 THEN NULL ELSE NOW() END, $5,
               GREATEST(0, (EXTRACT(EPOCH FROM NOW() - $3::timestamptz) * 1000)::int), CASE WHEN $4 THEN 0 ELSE 1 END, 1, CASE WHEN $4 THEN 0 ELSE 1 END, $6, NOW())
       ON CONFLICT (task) DO UPDATE SET
         every_ms = EXCLUDED.every_ms, last_started_at = EXCLUDED.last_started_at, last_finished_at = NOW(),
         last_ok_at = CASE WHEN $4 THEN NOW() ELSE customer360_worker_heartbeats.last_ok_at END,
         last_error_at = CASE WHEN $4 THEN customer360_worker_heartbeats.last_error_at ELSE NOW() END,
         last_error_code = CASE WHEN $4 THEN customer360_worker_heartbeats.last_error_code ELSE $5 END,
         last_duration_ms = EXCLUDED.last_duration_ms,
         consecutive_failures = CASE WHEN $4 THEN 0 ELSE customer360_worker_heartbeats.consecutive_failures + 1 END,
         runs = customer360_worker_heartbeats.runs + 1,
         failures = customer360_worker_heartbeats.failures + CASE WHEN $4 THEN 0 ELSE 1 END,
         instance = EXCLUDED.instance, updated_at = NOW()`,
      [task.name, task.everyMs, new Date(startedAt).toISOString(), ok, error ? String(error.code || error.name || "error").slice(0, 80) : null, INSTANCE]
    );
  } catch (err) {
    logger.warn("Customer 360 heartbeat not recorded", { task: task.name, code: err.code });
  }
}

async function tick(now = Date.now()) {
  const due = [];
  for (const task of TASKS) {
    if (task.running || now - task.lastAt < task.everyMs) continue;
    task.running = true;
    task.lastAt = now;
    due.push(task);
  }
  // Run due tasks concurrently instead of serially: a slow summary recompute
  // no longer starves anomaly scans, the lifecycle sweep, or queue SLA
  // behind it. Each task keeps its own overlap guard (running flag) and
  // its own error handling, so one failing task never blocks the rest.
  await Promise.all(due.map(async (task) => {
    const startedAt = Date.now();
    try {
      await task.run();
      await heartbeat(task, { startedAt, ok: true });
    } catch (error) {
      logger.warn("Customer 360 background task will retry", { task: task.name, code: error.code, message: error.message });
      await heartbeat(task, { startedAt, ok: false, error });
    } finally {
      task.running = false;
    }
  }));
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

module.exports = { startCustomer360Upgrades, registerTask, tick, heartbeat, TASKS };
