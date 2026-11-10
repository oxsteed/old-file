'use strict';

// Background-jobs audit, Oct 30 item 18 (Group 4): every inline cron in
// server/bootstrap/backgroundWorkers.js must run under a distinct fenced
// job lock instead of a bare cron.schedule call, so a second API replica
// (or a slow tick overlapping the next one) cannot run the same sweep
// concurrently. The scheduler and the lock are both stubbed here; the
// test drives the real registration wiring and invokes each captured
// cron callback, asserting withFencedJobLock is called once per tick
// with that cron's distinct lock name and cadence-matched TTL.
//
// The translation poll cron is deliberately NOT covered: item 28 owns
// its gating (dedicatedWorkerProcess) and its claim is already atomic,
// so it must keep bypassing the fenced path. A test below pins that.
//
// NOTE: the audit counted 11 inline crons (8 original + 3 new). The
// file actually holds 14 non-translation inline crons: the audit's 11
// plus the support-message cleanup, guest-chat retention, and support
// conversation retention crons, which are the same bare-cron class in
// the same file. All 14 are fenced here.

jest.mock('node-cron', () => {
  const scheduled = [];
  const tasksById = new Map();
  let nextId = 0;
  const schedule = jest.fn((expression, callback, options) => {
    const task = { stop: jest.fn(), destroy: jest.fn(), getStatus: jest.fn(() => 'scheduled') };
    scheduled.push({ expression, callback, options, task });
    tasksById.set(`task-${nextId}`, task);
    nextId += 1;
    return task;
  });
  return {
    schedule,
    getTasks: jest.fn(() => tasksById),
    getTask: jest.fn((id) => tasksById.get(id)),
    validate: jest.fn(() => true),
    __scheduled: scheduled,
    __tasksById: tasksById,
  };
});

jest.mock('../jobs/jobLockingService', () => ({
  LeaseLostError: class LeaseLostError extends Error {},
  withFencedJobLock: jest.fn(async () => ({ completed: true })),
  withJobLock: jest.fn(async () => ({ completed: true })),
  acquireJobLock: jest.fn(),
  releaseJobLock: jest.fn(),
  refreshJobLock: jest.fn(),
  refreshJobLockState: jest.fn(),
  createFence: jest.fn(),
}));

jest.mock('../analytics/promotionLinkAnalytics', () => ({
  prunePromotionLinkEvents: jest.fn().mockResolvedValue({ pruned: 0 }),
  clearExpiredAccountLinks: jest.fn().mockResolvedValue({ cleared: 0 }),
}));

jest.mock('../services/localDeliveryEventWorker', () => ({
  startLocalDeliveryEventWorker: jest.fn(),
}));

const cron = require('node-cron');
const { withFencedJobLock } = require('../jobs/jobLockingService');
const promotionLinkAnalytics = require('../analytics/promotionLinkAnalytics');
const { BackgroundWorkers } = require('../bootstrap/backgroundWorkers');

// expression, lock name, TTL. TTLs are cadence-matched: 60s for the
// sub-minute sweeps, 300s (default) for the 15-minute/daily sweeps,
// 900s for the slow retention cleanups. The two cronExpression entries
// resolve to '0 2 * * *' (support messages) and '25 2 * * *' (guest chat).
const EXPECTED_CRONS = [
  { expression: '0 17 3 * * *', jobName: 'promotion-link-prune', ttlSeconds: 300, timezone: 'UTC' },
  { expression: '0 41 * * * *', jobName: 'promotion-account-link-expiry', ttlSeconds: 300, timezone: 'UTC' },
  { expression: '*/10 * * * * *', jobName: 'support-waiting', ttlSeconds: 60 },
  { expression: '25 * * * * *', jobName: 'support-sla-monitor', ttlSeconds: 60 },
  { expression: '35 * * * * *', jobName: 'support-email-outbox', ttlSeconds: 60 },
  { expression: '40 * * * * *', jobName: 'support-channel-delivery-recovery', ttlSeconds: 60 },
  { expression: '45 * * * * *', jobName: 'support-follow-up-reminders', ttlSeconds: 60 },
  { expression: '50 * * * * *', jobName: 'restaurant-inventory-reservation-release', ttlSeconds: 60 },
  { expression: '15 * * * * *', jobName: 'restaurant-wallet-operation-cleanup', ttlSeconds: 60 },
  { expression: '*/15 * * * *', jobName: 'booking-maintenance-sweep', ttlSeconds: 300 },
  { expression: '0 2 * * *', jobName: 'support-message-cleanup', ttlSeconds: 900 },
  { expression: '25 2 * * *', jobName: 'guest-chat-retention-cleanup', ttlSeconds: 900 },
  { expression: '15 2 * * *', jobName: 'support-conversation-retention-cleanup', ttlSeconds: 900 },
  { expression: '5 3 * * *', jobName: 'business-invoice-payment-reminders', ttlSeconds: 300 },
];

function startWorkers() {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const workers = new BackgroundWorkers({ log });
  workers.start();
  return { workers, log };
}

// The fenced crons register as one contiguous run anchored at the first
// expected expression. Matching sequentially from the anchor (instead of
// a global find by expression) keeps the shared '*/15 * * * *'
// expression from picking up another job's earlier registration
// (chargeback evidence deadline, credit dispute SLA, support ticket SLA).
function matchedCronCallbacks() {
  const scheduled = cron.__scheduled;
  const anchor = scheduled.findIndex((entry) => entry.expression === EXPECTED_CRONS[0].expression);
  expect(anchor).toBeGreaterThanOrEqual(0);
  const matched = [];
  let cursor = anchor;
  for (const expected of EXPECTED_CRONS) {
    const idx = scheduled.findIndex((entry, i) => i >= cursor && entry.expression === expected.expression);
    expect(idx).toBeGreaterThanOrEqual(0);
    matched.push({ ...expected, callback: scheduled[idx].callback });
    cursor = idx + 1;
  }
  return matched;
}

const flush = () => new Promise((resolve) => { setImmediate(resolve); });

describe('Background-jobs audit, Oct 30 item 18: inline crons are fenced', () => {
  let workers;
  let scheduleSpy;

  beforeEach(() => {
    cron.__scheduled.length = 0;
    cron.__tasksById.clear();
    withFencedJobLock.mockReset();
    // Default: the lock is acquired but the body is NOT run, so invoking
    // a tick proves the routing without executing any service code.
    withFencedJobLock.mockImplementation(async () => ({ completed: true }));
    scheduleSpy = jest.spyOn(BackgroundWorkers.prototype, 'scheduleFencedCron');
  });

  afterEach(async () => {
    scheduleSpy.mockRestore();
    if (workers) {
      await workers.stop();
      workers = null;
    }
  });

  test('all 14 inline crons register through the fenced path with distinct lock names', () => {
    ({ workers } = startWorkers());

    expect(scheduleSpy).toHaveBeenCalledTimes(EXPECTED_CRONS.length);
    // The spy sees the caller's options object, not the resolved
    // defaults: a missing ttlSeconds resolves to 300 inside
    // scheduleFencedCron (proven per-tick in the test below).
    const registered = scheduleSpy.mock.calls.map((call) => ({
      expression: call[0],
      jobName: call[1],
      ttlSeconds: (call[3] || {}).ttlSeconds ?? 300,
      timezone: (call[3] || {}).timezone,
    }));
    expect(registered.map((entry) => entry.jobName))
      .toEqual(EXPECTED_CRONS.map((entry) => entry.jobName));
    expect(new Set(registered.map((entry) => entry.jobName)).size)
      .toBe(EXPECTED_CRONS.length);
    for (const [index, expected] of EXPECTED_CRONS.entries()) {
      expect(registered[index].expression).toBe(expected.expression);
      expect(registered[index].ttlSeconds).toBe(expected.ttlSeconds);
      expect(registered[index].timezone || undefined)
        .toBe(expected.timezone || undefined);
    }
  });

  test('each tick acquires that cron’s fenced lock and no other', async () => {
    ({ workers } = startWorkers());
    const matched = matchedCronCallbacks();

    for (const entry of matched) {
      const before = withFencedJobLock.mock.calls.length;
      entry.callback();
      await flush();
      await flush();
      const fresh = withFencedJobLock.mock.calls.slice(before);
      expect(fresh).toHaveLength(1);
      expect(fresh[0][0]).toBe(entry.jobName);
      expect(typeof fresh[0][1]).toBe('function');
      expect(fresh[0][2]).toBe(entry.ttlSeconds);
    }

    const names = withFencedJobLock.mock.calls.map((call) => call[0]);
    expect(new Set(names).size).toBe(EXPECTED_CRONS.length);
    expect(names.sort()).toEqual(EXPECTED_CRONS.map((entry) => entry.jobName).sort());
  });

  test('a fenced tick still runs the cron body once the lock is acquired', async () => {
    withFencedJobLock.mockImplementation(async (jobName, handler) => {
      await handler();
      return { completed: true };
    });
    ({ workers } = startWorkers());
    const matched = matchedCronCallbacks();
    const byName = new Map(matched.map((entry) => [entry.jobName, entry]));

    byName.get('promotion-link-prune').callback();
    byName.get('promotion-account-link-expiry').callback();
    await flush();
    await flush();

    expect(promotionLinkAnalytics.prunePromotionLinkEvents).toHaveBeenCalledTimes(1);
    expect(promotionLinkAnalytics.clearExpiredAccountLinks).toHaveBeenCalledTimes(1);
    expect(withFencedJobLock).toHaveBeenCalledWith(
      'promotion-link-prune', expect.any(Function), 300,
    );
    expect(withFencedJobLock).toHaveBeenCalledWith(
      'promotion-account-link-expiry', expect.any(Function), 300,
    );
  });

  test('the translation poll cron (item 28) is NOT routed through the fenced path', () => {
    ({ workers } = startWorkers());

    // The translation cron still registers (default '*/2 * * * * *'
    // when TRANSLATION_JOB_POLL_CRON is unset), but no fenced
    // registration exists for it: its gating stays with
    // dedicatedWorkerProcess() and its claim stays atomic, per item 28.
    const translationEntry = cron.__scheduled.find(
      (entry) => entry.expression === '*/2 * * * * *',
    );
    expect(translationEntry).toBeDefined();
    const fencedExpressions = new Set(
      scheduleSpy.mock.calls.map((call) => call[0]),
    );
    expect(fencedExpressions.has(translationEntry.expression)).toBe(false);
    expect(scheduleSpy.mock.calls
      .some((call) => /translation/i.test(call[1]))).toBe(false);
  });
});
