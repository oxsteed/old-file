'use strict';

// Interval workers shared by workerMain.js (dedicated worker process) and the
// API's BackgroundWorkers (when no dedicated worker is deployed). Each run is
// wrapped in a fenced job lock, so several replicas never run the same pass.
const logger = require('../utils/logger');
const { withFencedJobLock } = require('../jobs/jobLockingService');
const incidentStore = require('../services/incidentStore');

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
  const { processLearnVideoReviewAlerts } = require('../services/learnVideoReviewAlerts');
  const { expireVortexTokens } = require('./vortexTokenWorkers');
  const { renewSubscriptionCredit } = require('./subscriptionCreditWorkers');
  const { expireTimedEnforcements } = require('../controllers/enforcementController');
  const { pollIssuanceCycle } = require('../jobs/statementIssuanceScheduler');
  const { processEmailDigest } = require('../jobs/emailDigestBatch');
  const { cleanupExpiredChallenges } = require('./passkeyWorkers');
  const { processRevocationGracePeriods } = require('../services/restaurantCreditRevocationService');

  return [
    ...require('../growth/workerSchedule').entries(),
    ['incidentNotificationDispatch', options => require('../jobs/incidentNotificationDispatch').dispatchPendingIncidentNotifications(options), 60 * 1000, { limit: 50 }],
    ['safetySOSEscalation', options => require('../services/safetySOSService').escalateUnacknowledgedSOS(options), 60 * 1000, { limit: 50 }],
    ['ccpaErasure', options => require('../services/ccpaErasureService').processErasureJobs(options), 60 * 1000, { limit: 10 }],
    ['restaurantGiftCardDelivery', (options) => require('../services/restaurantGiftCardDelivery').processGiftCardDelivery(options), 60 * 1000, { limit: 20 }],
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
    ['learnVideoReviewAlerts', processLearnVideoReviewAlerts, 60 * 1000, { limit: 100 }],
    ['publishDueGuideVideos', (options) => publishDueGuideVideos(undefined, options), 5 * 60 * 1000, { limit: 100 }],
    // Monthly statement issuance; always drains the statement.ready outbox.
    ['statementIssuanceCycle',
      (options) => pollIssuanceCycle({ workerId: options.workerId, maxJobsPerProduct: options.maxJobsPerProduct }),
      5 * 60 * 1000, { workerId: 'worker-main', maxJobsPerProduct: 50 }],
    // Expire unused legacy Vortex invite tokens past their expires_at, hourly.
    ['expireVortexTokens', expireVortexTokens, 60 * 60 * 1000, { limit: 500 }],
    // Renew OxSteed Credit subscriptions past period end, daily.
    // No-op unless SUBSCRIPTIONS_CREDIT_ENABLED=true.
    ['renewSubscriptionCredit', renewSubscriptionCredit, 24 * 60 * 60 * 1000, { limit: 100 }],
    // Lift timed suspensions/restrictions even when the user is idle.
    ['expireTimedEnforcements', expireTimedEnforcements, 5 * 60 * 1000, { limit: 500 }],
    // Review P3-914: delete replaced uploads after their grace period.
    // Runs by default; set STORAGE_CLEANUP_ENABLED=false to pause.
    ['storageDeletionQueue', (options) => require('../services/storageCleanupService').processStorageDeletionQueue(options),
      15 * 60 * 1000, { limit: 100 }],
    // Review P3-6-F03: orphan-scanning sweeper. Finds profile-media objects no
    // DB row references (e.g. replaced before the deletion queue existed) and
    // enqueues them with a 7-day grace period. Deletion still goes through the
    // drain above, which re-verifies references right before deleting. Weekly;
    // paused when STORAGE_CLEANUP_ENABLED=false.
    ['storageOrphanSweep', (options) => require('../services/storageCleanupService').sweepOrphanedProfileMedia(options),
      7 * 24 * 60 * 60 * 1000, { limit: 500 }],
    // Bound passkey challenge tables even when no new challenge is saved.
    ['cleanupExpiredPasskeyChallenges', cleanupExpiredChallenges, 15 * 60 * 1000, { limit: 1000 }],
    // Deliver queued notification digests through the shared email provider.
    ['emailDigestDaily', () => processEmailDigest('daily'), 24 * 60 * 60 * 1000, {}],
    ['emailDigestWeekly', () => {
      if (new Date().getUTCDay() !== 1) return Promise.resolve({ skipped: true, reason: 'not_monday' });
      return processEmailDigest('weekly');
    }, 24 * 60 * 60 * 1000, {}],
    // Phase 6 (restaurant credit protection): migrate remaining customer
    // balances to OxSteed Credit once a revoked restaurant's 30-day grace
    // period ends. Hourly; each run is fenced and the worker is idempotent.
    ['processRevocationGracePeriods', processRevocationGracePeriods, 60 * 60 * 1000, { limit: 100 }],
    // Logistics funding gates: campaigns past their deposit/minimum-demand
    // deadline with insufficient funding raise staff review exceptions
    // (logistics_review_exceptions). Never auto-advances or refunds;
    // idempotent per (campaign, exception type). Every 15 minutes.
    ['logisticsPaymentAttemptSweep', () => require('../services/logisticsPaymentService').sweepStuckAttempts(),15*60*1000,{}],
    ['logisticsFundingDeadlineSweep',
      (options) => require('../services/logisticsTransitionGuards').sweepFundingDeadlines(require('../db'), options),
      15 * 60 * 1000, { limit: 200 }],
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
      // Background-jobs audit (finding J1): a failing fleet worker was
      // invisible (one log line, no heartbeat). Record an incident so a
      // persistently failing worker surfaces; the dedupe key collapses
      // repeats into occurrence_count instead of spamming rows.
      // recordIncident never throws, so the scheduler stays drain-safe.
      incidentStore.recordIncident({
        type: 'scheduled_worker_failed',
        severity: 'critical',
        message: `Scheduled worker failed: ${name}`,
        dedupeKey: `scheduled-worker:${name}:failed`,
        details: { worker: name, error: String(err?.message || err).slice(0, 2000) },
      });
      return { failed: true, error: err.message };
    });
}

// In-process runner for the API. Returns a handle with stop() so
// BackgroundWorkers can shut it down.
function startScheduledWorkers({ log = logger, schedule = SCHEDULED_WORKERS } = {}) {
  const inFlight = new Map();
  const timers = [];
  let stopped = false;
  let stopPromise = null;
  for (const entry of schedule) {
    const [name, , intervalMs] = entry;
    const timer = setInterval(() => {
      if (stopped || inFlight.has(name)) return;
      const run = Promise.resolve()
        .then(() => runScheduledWorkerOnce(entry, { log }))
        // runScheduledWorkerOnce normally contains the worker error boundary;
        // keep the scheduler drain-safe if a mocked or future implementation
        // rejects before reaching that boundary.
        .catch((error) => {
          log.error('Scheduled worker failed', { worker: name, error: error.message });
          return { failed: true, error: error.message };
        })
        .finally(() => {
          if (inFlight.get(name) === run) inFlight.delete(name);
        });
      inFlight.set(name, run);
    }, intervalMs);
    timer.unref?.();
    timers.push(timer);
  }
  log.info('Scheduled workers running in the API process', { workers: schedule.map(([n]) => n) });
  return {
    stop() {
      if (stopPromise) return stopPromise;
      stopped = true;
      for (const t of timers) clearInterval(t);
      timers.length = 0;
      // Stop accepting new ticks, then let already-claimed work commit or
      // fail before the API tears down its database, Redis and ClickHouse
      // clients. This mirrors the dedicated worker's drain contract.
      stopPromise = Promise.allSettled([...inFlight.values()]).then(() => undefined);
      return stopPromise;
    },
    get size() { return timers.length; },
  };
}

module.exports = { SCHEDULED_WORKERS, startScheduledWorkers, runScheduledWorkerOnce, lockTtlSeconds };
