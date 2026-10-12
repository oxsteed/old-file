'use strict';

// Interval workers shared by workerMain.js (dedicated worker process) and the
// API's BackgroundWorkers (when no dedicated worker is deployed). Each run is
// wrapped in a fenced job lock, so several replicas never run the same pass.
const logger = require('../utils/logger');
const { withFencedJobLock } = require('../jobs/jobLockingService');

function buildSchedule() {
  const {
    normalizeLocations,
    refreshEtas,
    evaluateGeofences,
    retryProviderWebhooks,
    reconcileCursors,
    detectStaleTrackers,
    cleanupTrackingLinks,
    enforceRetention,
  } = require('./deliveryTrackingWorkers');
  const { clearStaleAvailableNow } = require('./availabilityWorkers');
  const { publishDueGuideVideos } = require('../controllers/learnController');
  const { expireVortexTokens } = require('./vortexTokenWorkers');
  const { renewSubscriptionCredit } = require('./subscriptionCreditWorkers');
  const { pollIssuanceCycle } = require('../jobs/statementIssuanceScheduler');

  return [
    // [name, workerFn, intervalMs, options]
    ['normalizeLocations', normalizeLocations, 2 * 60 * 1000, { limit: 200 }],
    ['refreshEtas', refreshEtas, 60 * 1000, { limit: 100 }],
    ['evaluateGeofences', evaluateGeofences, 2 * 60 * 1000, { limit: 100 }],
    ['retryProviderWebhooks', retryProviderWebhooks, 5 * 60 * 1000, { limit: 25 }],
    ['reconcileCursors', reconcileCursors, 5 * 60 * 1000, { limit: 100 }],
    ['detectStaleTrackers', detectStaleTrackers, 5 * 60 * 1000, { limit: 200 }],
    ['cleanupTrackingLinks', cleanupTrackingLinks, 5 * 60 * 1000, { limit: 200 }],
    ['enforceRetention', enforceRetention, 60 * 60 * 1000, { limit: 5000 }],
    // Clear stale "available now" readiness flags (12h TTL), every 15 minutes.
    ['clearStaleAvailableNow', clearStaleAvailableNow, 15 * 60 * 1000, { limit: 500 }],
    // Publish Learn guide video submissions pending 24h without an admin
    // block (Emile's decision 2026-10-01), every 5 minutes.
    ['publishDueGuideVideos', publishDueGuideVideos, 5 * 60 * 1000, { limit: 100 }],
    // Monthly statement issuance; always drains the statement.ready outbox.
    ['statementIssuanceCycle',
      (options) => pollIssuanceCycle({ workerId: options.workerId, maxJobsPerProduct: options.maxJobsPerProduct }),
      5 * 60 * 1000, { workerId: 'worker-main', maxJobsPerProduct: 50 }],
    // Expire unused legacy Vortex invite tokens past their expires_at, hourly.
    ['expireVortexTokens', expireVortexTokens, 60 * 60 * 1000, { limit: 500 }],
    // Renew OxSteed Credit subscriptions past period end, daily.
    // No-op unless SUBSCRIPTIONS_CREDIT_ENABLED=true.
    ['renewSubscriptionCredit', renewSubscriptionCredit, 24 * 60 * 60 * 1000, { limit: 100 }],
  ];
}

const SCHEDULED_WORKERS = buildSchedule();

function lockTtlSeconds(intervalMs) {
  return Math.max(60, Math.min(Math.ceil(intervalMs / 1000), 30 * 60));
}

function runScheduledWorkerOnce([name, workerFn, intervalMs, options], { log = logger } = {}) {
  return withFencedJobLock(`scheduled-worker:${name}`, () => workerFn(options), lockTtlSeconds(intervalMs))
    .then((summary) => {
      if (!summary?.skipped) log.info('Scheduled worker completed', { worker: name, summary });
      return summary;
    })
    .catch((err) => {
      log.error('Scheduled worker failed', { worker: name, error: err.message });
      return { failed: true, error: err.message };
    });
}

// In-process runner for the API. Returns a handle with stop() so
// BackgroundWorkers can shut it down.
function startScheduledWorkers({ log = logger, schedule = SCHEDULED_WORKERS } = {}) {
  const inFlight = new Set();
  const timers = [];
  let stopped = false;
  for (const entry of schedule) {
    const [name, , intervalMs] = entry;
    const timer = setInterval(() => {
      if (stopped || inFlight.has(name)) return;
      inFlight.add(name);
      runScheduledWorkerOnce(entry, { log }).finally(() => inFlight.delete(name));
    }, intervalMs);
    timer.unref?.();
    timers.push(timer);
  }
  log.info('Scheduled workers running in the API process', { workers: schedule.map(([n]) => n) });
  return {
    stop() {
      stopped = true;
      for (const t of timers) clearInterval(t);
      timers.length = 0;
    },
    get size() { return timers.length; },
  };
}

module.exports = { SCHEDULED_WORKERS, startScheduledWorkers, runScheduledWorkerOnce, lockTtlSeconds };
