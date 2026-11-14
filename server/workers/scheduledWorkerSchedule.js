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
    ['cancellationStatsRefresh', () => require('../services/cancellationStatsRefresh').refresh(), 60 * 60 * 1000, {}],
    ['incidentNotificationDispatch', options => require('../jobs/incidentNotificationDispatch').dispatchPendingIncidentNotifications(options), 60 * 1000, { limit: 50 }],
    ['safetySOSEscalation', options => require('../services/safetySOSService').escalateUnacknowledgedSOS(options), 60 * 1000, { limit: 50 }],
    ['ccpaErasure', options => require('../services/ccpaErasureService').processErasureJobs(options), 60 * 1000, { limit: 10 }],
    ['restaurantGiftCardDelivery', (options) => require('../services/restaurantGiftCardDelivery').processGiftCardDelivery(options), 60 * 1000, { limit: 20 }],
    // F-08: expire offline-card leases, attach payments once their offline
    // ticket is accepted, and chase unreported store-and-forward intents.
    ['restaurantTerminalOfflineSweep', options => require('../services/restaurantTerminalOfflineLeases').sweep(options), 5 * 60 * 1000, { limit: 200 }],
    ['restaurantAccountingDelivery', options => require('../services/restaurantAccountingDelivery').processExports(options), 60 * 1000, { limit: 5 }],
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
    // Domain 8 #29: restaurant_daily_rollups rows outlive their
    // 15-minute TTL forever (one row per distinct date range queried).
    // Nightly prune with a 1-hour grace so in-flight reads stay safe;
    // each run is fenced, logged and bounded by LIMIT like the other
    // sweeps. No migration: the expiry index already exists.
    ['pruneExpiredRollups',
      (options) => require('../services/restaurantRollupCache').pruneExpiredRollups(require('../db'), options),
      24 * 60 * 60 * 1000, { limit: 1000 }],
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

// Background-jobs audit #47 + Oct 30 item 30(b): the fleet had no
// heartbeat and no skipped-streak signal. The only heartbeat table is
// credit-scoped (oxsteed_credit_worker_heartbeats), and this fix adds
// NO migration. Instead the runner keeps per-worker run state in
// memory: last outcome, last run / success timestamps, consecutive
// skips and failures, and which incidents this process raised so they
// can be resolved when the worker recovers.
//
// LIMITS (honest, by design): state resets on process restart and is
// per-process, so in a multi-replica deployment each replica sees only
// its own ticks; a worker that is skipped in every replica still raises
// one deduped incident per worker (the incident_log upsert collapses
// repeats on the open dedupe key), so the cross-replica signal is the
// incident, not this map. If cross-replica heartbeat visibility is ever
// required, persist this state in a fleet_worker_heartbeats table
// mirroring oxsteed_credit_worker_heartbeats (job_name PK, last_run_at,
// last_success_at, last_error, consecutive_failures, updated_at) and
// have a watchdog read it the way oxsteedCreditWorkerWatchdog does;
// until then this map plus the incidents below is the fleet signal.
// getFleetWorkerHeartbeats() exposes the snapshot for an admin/debug
// endpoint or a future watchdog to read without a migration.
const SKIPPED_STREAK_ALERT_THRESHOLD = 3;
const fleetWorkerState = new Map();

function getFleetWorkerState(name, intervalMs) {
  let state = fleetWorkerState.get(name);
  if (!state) {
    state = {
      worker: name,
      intervalMs: intervalMs ?? null,
      consecutiveSkips: 0,
      consecutiveFailures: 0,
      lastRunAt: null,
      lastSuccessAt: null,
      lastOutcome: null,
      streakIncidentOpen: false,
      fenceIncidentOpen: false,
      lockErrorIncidentOpen: false,
    };
    fleetWorkerState.set(name, state);
  }
  if (intervalMs != null) state.intervalMs = intervalMs;
  return state;
}

function getFleetWorkerHeartbeat(name) {
  const state = fleetWorkerState.get(name);
  return state ? { ...state } : null;
}

function getFleetWorkerHeartbeats() {
  return [...fleetWorkerState.values()].map((state) => ({ ...state }));
}

// Test/observability support: drop all in-memory fleet state.
function resetFleetWorkerState() {
  fleetWorkerState.clear();
}

function skippedStreakDedupeKey(name) {
  return `scheduled-worker:${name}:skipped-streak`;
}

function fencedDedupeKey(name) {
  return `scheduled-worker:${name}:fenced`;
}

function lockErrorDedupeKey(name) {
  return `scheduled-worker:${name}:lock-error`;
}

async function resolveFleetWorkerIncidents(name, dedupeKeys, resolutionNotes) {
  if (!dedupeKeys.length) return [];
  // resolveOpenIncidentsByDedupeKeys never throws; a failed resolve is
  // logged inside incidentStore and the worker run is unaffected.
  return incidentStore.resolveOpenIncidentsByDedupeKeys(dedupeKeys, resolutionNotes);
}

function runScheduledWorkerOnce([name, workerFn, intervalMs, options], { log = logger } = {}) {
  // Fleet fence delivery: withFencedJobLock hands its handler the fence,
  // and the runner forwards it inside the worker's options so a fleet
  // worker can route writes through fence.db. Workers that ignore it keep
  // their previous behavior; existing options pass through unchanged.
  //
  // Fence adoption (background-jobs audit #39, Nov 8 2026): the
  // money-adjacent five accept options.fence and route writes via
  // fence.db (terminal offline sweep, accounting delivery, gift-card
  // delivery, revocation grace periods, SOS escalation). The remaining
  // fleet workers do not take the fence yet: their backstop is
  // per-service idempotency (SKIP LOCKED claims, idempotent upserts,
  // deduped outbox rows), not the fence. Threading the fence into the
  // next worker means accepting options.fence and routing its writes
  // through fence.db (transactions via fence.fencedTransaction).
  //
  // throwOnLockError (30(d)): a lock-store failure throws a
  // JobLockAcquisitionError instead of reading as contention, so the
  // catch below can log and count it distinctly. The handler never runs
  // on this path: fail closed.
  return withFencedJobLock(`scheduled-worker:${name}`, (fence) => workerFn({ ...options, fence }), lockTtlSeconds(intervalMs), { throwOnLockError: true })
    .then(async (summary) => {
      const state = getFleetWorkerState(name, intervalMs);
      state.lastRunAt = new Date().toISOString();
      // 30(d), non-throwing shape: a lock-acquisition error surfaced as a
      // summary (e.g. a future caller without throwOnLockError). It is
      // not contention and must not count toward the skip streak.
      if (summary?.lockError) {
        state.lastOutcome = 'lock-error';
        state.lockErrorIncidentOpen = true;
        log.error('Scheduled worker lock acquisition failed', {
          worker: name,
          error: summary?.error || 'lock store error',
        });
        await incidentStore.recordIncident({
          type: 'scheduled_worker_lock_error',
          severity: 'critical',
          message: `Scheduled worker ${name} could not acquire its lock`,
          dedupeKey: lockErrorDedupeKey(name),
          details: { worker: name, error: String(summary?.error || 'lock store error').slice(0, 2000) },
        });
        return summary;
      }
      if (summary?.skipped && summary?.lockSkipped) {
        // #47: a lock-skipped run used to produce no runner log line at
        // all. Log it with the streak, and raise one deduped incident
        // once the streak reaches the threshold; the incident_log upsert
        // refreshes the same open incident on later ticks instead of
        // spamming one row per tick. Only lock skips count: a worker
        // that returns { skipped: true } itself (disabled flag, idle
        // outbox, already-complete day) ran fine and must not trip the
        // streak — it falls through to the ran path below.
        state.lastOutcome = 'skipped';
        state.consecutiveSkips += 1;
        state.consecutiveFailures = 0;
        log.warn?.('Scheduled worker skipped (lock held by another instance)', {
          worker: name,
          consecutiveSkips: state.consecutiveSkips,
          intervalMs,
        });
        if (state.consecutiveSkips >= SKIPPED_STREAK_ALERT_THRESHOLD) {
          state.streakIncidentOpen = true;
          await incidentStore.recordIncident({
            type: 'scheduled_worker_skipped_streak',
            severity: 'warning',
            message: `Scheduled worker ${name} skipped ${state.consecutiveSkips} consecutive runs; another instance may hold a stale lock`,
            dedupeKey: skippedStreakDedupeKey(name),
            details: {
              worker: name,
              consecutiveSkips: state.consecutiveSkips,
              intervalMs,
            },
          });
        }
        return summary;
      }
      // The worker ran. A fenced run is not a success (half its pass was
      // abandoned; withFencedJobLock already recorded the fenced
      // incident), and it still breaks a skip streak: the lock was
      // acquired, so the worker is no longer being skipped.
      const wasFenced = summary?.fenced === true;
      state.lastOutcome = wasFenced ? 'fenced' : 'completed';
      state.consecutiveFailures = 0;
      if (!wasFenced) state.lastSuccessAt = state.lastRunAt;
      if (wasFenced) {
        state.fenceIncidentOpen = true;
        log.warn?.('Scheduled worker fenced after lease loss', { worker: name });
      } else {
        log.info('Scheduled worker completed', { worker: name, summary });
      }
      const toResolve = [];
      if (state.consecutiveSkips > 0) {
        state.consecutiveSkips = 0;
        if (state.streakIncidentOpen) {
          toResolve.push(skippedStreakDedupeKey(name));
          state.streakIncidentOpen = false;
        }
      }
      if (!wasFenced) {
        // Recovery: a clean run resolves the fence / lock-error
        // incidents this process raised. Only the keys we raised are
        // resolved, so a healthy run costs no incident write.
        if (state.fenceIncidentOpen) {
          toResolve.push(fencedDedupeKey(name));
          state.fenceIncidentOpen = false;
        }
        if (state.lockErrorIncidentOpen) {
          toResolve.push(lockErrorDedupeKey(name));
          state.lockErrorIncidentOpen = false;
        }
      }
      if (toResolve.length) {
        await resolveFleetWorkerIncidents(
          name,
          toResolve,
          `Scheduled worker ${name} ran again; the skipped/fenced/lock-error condition cleared.`,
        );
      }
      return summary;
    })
    .catch(async (err) => {
      const state = getFleetWorkerState(name, intervalMs);
      state.lastRunAt = new Date().toISOString();
      state.consecutiveSkips = 0;
      state.consecutiveFailures += 1;
      // 30(d): a lock-acquisition error is neither contention nor a
      // worker failure. Log and count it distinctly; the handler never
      // ran, so there is nothing to retry inside this tick.
      if (err?.code === 'LOCK_ACQUISITION_ERROR' || err?.name === 'JobLockAcquisitionError') {
        state.lastOutcome = 'lock-error';
        state.lockErrorIncidentOpen = true;
        log.error('Scheduled worker lock acquisition failed', { worker: name, error: err.message });
        await incidentStore.recordIncident({
          type: 'scheduled_worker_lock_error',
          severity: 'critical',
          message: `Scheduled worker ${name} could not acquire its lock`,
          dedupeKey: lockErrorDedupeKey(name),
          details: { worker: name, error: String(err?.message || err).slice(0, 2000) },
        });
        return { lockError: true, error: err.message };
      }
      state.lastOutcome = 'failed';
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
  const unsubscribes = [];
  let stopped = false;
  let stopPromise = null;
  for (const entry of schedule) {
    const [name, , intervalMs, options] = entry;
    const trigger = () => {
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
    };
    const timer = setInterval(trigger, intervalMs);
    timer.unref?.();
    timers.push(timer);
    // Cost audit 2026-11-04 item 7: an entry with a notifyChannel also
    // wakes on Postgres NOTIFY (transactional, so only committed rows
    // wake it); the interval above remains as a slow safety sweep. The
    // inFlight guard makes a notify that lands mid-run a no-op.
    if (options?.notifyChannel) {
      try {
        unsubscribes.push(require('../utils/notifyWakeup').subscribe(options.notifyChannel, trigger));
      } catch (error) {
        log.warn('Scheduled worker notify wakeup unavailable, interval only', { worker: name, message: error.message });
      }
    }
  }
  log.info('Scheduled workers running in the API process', { workers: schedule.map(([n]) => n) });
  return {
    stop() {
      if (stopPromise) return stopPromise;
      stopped = true;
      for (const t of timers) clearInterval(t);
      timers.length = 0;
      for (const unsub of unsubscribes) {
        try {
          unsub();
        } catch (_) { /* unsubscribe is best-effort on shutdown */ }
      }
      unsubscribes.length = 0;
      // Stop accepting new ticks, then let already-claimed work commit or
      // fail before the API tears down its database, Redis and ClickHouse
      // clients. This mirrors the dedicated worker's drain contract.
      stopPromise = Promise.allSettled([...inFlight.values()]).then(() => undefined);
      return stopPromise;
    },
    get size() { return timers.length; },
  };
}

module.exports = {
  SCHEDULED_WORKERS,
  startScheduledWorkers,
  runScheduledWorkerOnce,
  lockTtlSeconds,
  SKIPPED_STREAK_ALERT_THRESHOLD,
  getFleetWorkerHeartbeat,
  getFleetWorkerHeartbeats,
  resetFleetWorkerState,
};
