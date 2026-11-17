'use strict';

// M2 (per-type push TTL) + M5 (dead-endpoint deactivation, fan-out cap, 429 abort).
// web-push and the DB are mocked: no VAPID keys, network, or database needed.
const mockSendNotification = jest.fn();
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: (...args) => mockSendNotification(...args),
}));
const mockQuery = jest.fn();
jest.mock('../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';

const service = require('../services/webPushService');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function sub(id, endpoint) {
  return { id, endpoint, p256dh: `p256dh-${id}`, auth: `auth-${id}` };
}

// Minimal in-memory stand-in for the push_subscriptions table. It mirrors
// the SQL the service sends: SELECT returns the active rows, the success
// UPDATE resets failure_count, the failure UPDATEs increment it, and the
// threshold UPDATE deactivates a row whose count reached the limit.
function installDb(subs, initialCounts = {}) {
  const counts = new Map(Object.entries(initialCounts).map(([k, v]) => [Number(k), v]));
  const active = new Map(subs.map((s) => [s.id, true]));
  mockQuery.mockImplementation(async (sql, params = []) => {
    if (/^\s*SELECT/i.test(sql)) {
      return { rows: subs.filter((s) => active.get(s.id) !== false) };
    }
    const id = params[0];
    if (/SET last_used_at = now\(\), failure_count = 0/.test(sql)) {
      counts.set(id, 0);
      return { rows: [], rowCount: 1 };
    }
    if (/SET active = FALSE,/.test(sql)) {
      active.set(id, false);
      counts.set(id, (counts.get(id) || 0) + 1);
      return { rows: [], rowCount: 1 };
    }
    if (/SET failure_count = failure_count \+ 1/.test(sql)) {
      counts.set(id, (counts.get(id) || 0) + 1);
      return { rows: [], rowCount: 1 };
    }
    if (/SET active = FALSE\s+WHERE id = \$1 AND failure_count >=/.test(sql)) {
      const threshold = params[1];
      if (active.get(id) !== false && (counts.get(id) || 0) >= threshold) {
        active.set(id, false);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { counts, active };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSendNotification.mockReset();
  mockSendNotification.mockResolvedValue(undefined);
  delete process.env.WEBPUSH_429_RETRY_BACKOFF_MS;
});

// ── M2: TTL by notification type ──

describe('ttlForNotificationType', () => {
  test.each([
    ['food_order', 3600],
    ['food_ready', 3600],
    ['job_matched', 3600],
    ['job_payment', 3600],
    ['order_shipped', 3600],
    ['delivery_update', 3600],
    ['booking_confirmed', 3600],
    ['appointment_reminder', 3600],
    ['new_message', 3600],
    ['payment_received', 3600],
    ['growth_offer', 21600],
    ['offer_expiring', 21600],
  ])('%s gets %s seconds', (type, ttl) => {
    expect(service.ttlForNotificationType(type)).toBe(ttl);
  });

  test('everything else keeps the 24h default, including a missing type', () => {
    expect(service.ttlForNotificationType('account_deletion_financial_blocker')).toBe(86400);
    expect(service.ttlForNotificationType('webpush_test')).toBe(86400);
    expect(service.ttlForNotificationType(undefined)).toBe(86400);
    expect(service.ttlForNotificationType(null)).toBe(86400);
  });
});

test('M2: sendToUser passes the per-type TTL to the push provider', async () => {
  installDb([sub(1, 'https://push.example/1')]);
  await service.sendToUser('u1', { id: 'n1', type: 'food_order', title: 'T', body: 'B' });
  expect(mockSendNotification).toHaveBeenCalledTimes(1);
  expect(mockSendNotification.mock.calls[0][2]).toEqual({ TTL: 3600 });

  mockSendNotification.mockClear();
  await service.sendToUser('u1', { id: 'n2', type: 'growth_offer', title: 'T', body: 'B' });
  expect(mockSendNotification.mock.calls[0][2]).toEqual({ TTL: 21600 });

  mockSendNotification.mockClear();
  await service.sendToUser('u1', { id: 'n3', type: 'some_admin_alert', title: 'T', body: 'B' });
  expect(mockSendNotification.mock.calls[0][2]).toEqual({ TTL: 86400 });
});

// ── M5: dead endpoints, fan-out cap, 429 abort ──

function failWith(status) {
  const err = new Error(`push failed with ${status}`);
  err.statusCode = status;
  return err;
}

test('M5: a 400 or 413 deactivates the subscription at once', async () => {
  for (const status of [400, 413]) {
    mockSendNotification.mockRejectedValueOnce(failWith(status));
    const { active } = installDb([sub(1, 'https://push.example/1')]);
    const result = await service.sendToUser('u1', { id: 'n1', type: 'x', title: 'T', body: 'B' });
    expect(result.deactivated).toBe(1);
    expect(active.get(1)).toBe(false);
  }
});

test('M5: 404 and 410 still deactivate at once', async () => {
  for (const status of [404, 410]) {
    mockSendNotification.mockRejectedValueOnce(failWith(status));
    const { active } = installDb([sub(1, 'https://push.example/1')]);
    const result = await service.sendToUser('u1', { id: 'n1', type: 'x', title: 'T', body: 'B' });
    expect(result.deactivated).toBe(1);
    expect(active.get(1)).toBe(false);
  }
});

test('M5: the fifth consecutive failure deactivates, the fourth does not', async () => {
  mockSendNotification.mockRejectedValue(failWith(500));
  const fifth = installDb([sub(1, 'https://push.example/1')], { 1: 4 });
  const r5 = await service.sendToUser('u1', { id: 'n1', type: 'x', title: 'T', body: 'B' });
  expect(r5.deactivated).toBe(1);
  expect(fifth.active.get(1)).toBe(false);
  expect(fifth.counts.get(1)).toBe(5);

  mockSendNotification.mockRejectedValue(failWith(500));
  const fourth = installDb([sub(1, 'https://push.example/1')], { 1: 3 });
  const r4 = await service.sendToUser('u1', { id: 'n1', type: 'x', title: 'T', body: 'B' });
  expect(r4.deactivated).toBe(0);
  expect(fourth.active.get(1)).toBe(true);
  expect(fourth.counts.get(1)).toBe(4);
});

test('M5: a successful send resets the consecutive failure count', async () => {
  const { counts } = installDb([sub(1, 'https://push.example/1')], { 1: 3 });
  const result = await service.sendToUser('u1', { id: 'n1', type: 'x', title: 'T', body: 'B' });
  expect(result.sent).toBe(1);
  await settle();
  await settle();
  expect(counts.get(1)).toBe(0);
});

test('M5: fan-out runs at most FANOUT_CONCURRENCY sends at once', async () => {
  const subs = Array.from({ length: 12 }, (_, i) => sub(i + 1, `https://push.example/${i + 1}`));
  installDb(subs);
  let inFlight = 0;
  let maxInFlight = 0;
  mockSendNotification.mockImplementation(async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 10));
    inFlight -= 1;
  });
  const result = await service.sendToUser('u1', { id: 'n1', type: 'x', title: 'T', body: 'B' });
  expect(result.sent).toBe(12);
  expect(maxInFlight).toBeLessThanOrEqual(service.FANOUT_CONCURRENCY);
  expect(maxInFlight).toBeGreaterThan(1);
});

test('M5: a 429 aborts the remaining fan-out, then the single retry pass delivers them', async () => {
  // Finding 9: the old behaviour stopped at the first chunk and left the
  // rest to a later, unrelated notification. Now the skipped subscriptions
  // are re-attempted once, for this notification, after a short backoff.
  process.env.WEBPUSH_429_RETRY_BACKOFF_MS = '10';
  const subs = Array.from({ length: 12 }, (_, i) => sub(i + 1, `https://push.example/${i + 1}`));
  const { active, counts } = installDb(subs);
  mockSendNotification.mockImplementation(async (target) => {
    if (target.endpoint === 'https://push.example/2') throw failWith(429);
  });
  const result = await service.sendToUser('u1', { id: 'n1', type: 'x', title: 'T', body: 'B' });
  expect(result.rateLimited).toBe(true);
  // First pass attempted only the first chunk (5 sends); the retry pass
  // then attempted the 7 never-tried subscriptions plus the throttled one.
  expect(mockSendNotification).toHaveBeenCalledTimes(13);
  expect(result.retried).toBe(8);
  expect(result.dropped).toBe(0);
  // Every subscription except the permanently-throttled one got the push.
  expect(result.sent).toBe(11);
  expect(result.failed).toBe(2); // sub 2 failed with 429 in both passes
  for (let i = 6; i <= 12; i += 1) {
    expect(mockSendNotification.mock.calls.some(([t]) => t.endpoint === `https://push.example/${i}`)).toBe(true);
    expect(active.get(i)).toBe(true);
  }
  // The throttled subscription was attempted twice (once per pass).
  expect(mockSendNotification.mock.calls.filter(([t]) => t.endpoint === 'https://push.example/2')).toHaveLength(2);
  // The 429 itself is a provider signal, not a dead endpoint: no deactivation.
  expect(result.deactivated).toBe(0);
  expect(counts.get(2) || 0).toBe(0);
});

// ── Finding 9: 429 retry pass ──

test('Finding 9: a 429 mid-fan-out retries the skipped subscriptions once after backoff', async () => {
  process.env.WEBPUSH_429_RETRY_BACKOFF_MS = '30';
  const subs = Array.from({ length: 12 }, (_, i) => sub(i + 1, `https://push.example/${i + 1}`));
  installDb(subs);
  const callTimes = [];
  const attempts = new Map();
  mockSendNotification.mockImplementation(async (target) => {
    callTimes.push(Date.now());
    const n = (attempts.get(target.endpoint) || 0) + 1;
    attempts.set(target.endpoint, n);
    // Sub 2 is throttled on its first attempt only, then accepts.
    if (target.endpoint === 'https://push.example/2' && n === 1) throw failWith(429);
  });
  const result = await service.sendToUser('u1', { id: 'n1', type: 'x', title: 'T', body: 'B' });
  expect(result.rateLimited).toBe(true);
  // The notification is not lost: every subscription eventually got it.
  expect(result.sent).toBe(12);
  expect(result.retried).toBe(8); // 7 never attempted + the throttled sub 2
  expect(result.dropped).toBe(0);
  expect(mockSendNotification).toHaveBeenCalledTimes(13);
  expect(attempts.get('https://push.example/2')).toBe(2);
  // The retry pass waited for the backoff: the first retry call (6th call)
  // lands at least ~the backoff after the last first-pass call (5th call).
  expect(callTimes).toHaveLength(13);
  expect(callTimes[5] - callTimes[4]).toBeGreaterThanOrEqual(25);
});

test('Finding 9: the retry is bounded - a second 429 ends it, no retry storm', async () => {
  process.env.WEBPUSH_429_RETRY_BACKOFF_MS = '10';
  const subs = Array.from({ length: 12 }, (_, i) => sub(i + 1, `https://push.example/${i + 1}`));
  const { active, counts } = installDb(subs);
  const attempts = new Map();
  mockSendNotification.mockImplementation(async (target) => {
    const n = (attempts.get(target.endpoint) || 0) + 1;
    attempts.set(target.endpoint, n);
    // Sub 2 is throttled on its first attempt only; sub 6 is throttled
    // on every attempt, so the retry pass itself hits a 429 and must stop.
    if (target.endpoint === 'https://push.example/2' && n === 1) throw failWith(429);
    if (target.endpoint === 'https://push.example/6') throw failWith(429);
  });
  const result = await service.sendToUser('u1', { id: 'n1', type: 'x', title: 'T', body: 'B' });
  expect(result.rateLimited).toBe(true);
  // Exactly two passes: first chunk (5) + first retry chunk (5). No third
  // pass, no re-attempt of the subscriptions the retry never reached.
  expect(mockSendNotification).toHaveBeenCalledTimes(10);
  expect(result.retried).toBe(5);
  expect(result.dropped).toBe(3); // subs 11, 12 and the throttled sub 2
  expect(result.sent).toBe(8);
  expect(attempts.get('https://push.example/2')).toBe(1);
  for (const i of [11, 12]) {
    expect(mockSendNotification.mock.calls.some(([t]) => t.endpoint === `https://push.example/${i}`)).toBe(false);
    expect(active.get(i)).toBe(true);
  }
  // Still no deactivation on a throttle, in either pass.
  expect(result.deactivated).toBe(0);
  expect(counts.get(2) || 0).toBe(0);
  expect(counts.get(6) || 0).toBe(0);
});

test('Finding 9: a Retry-After header on the 429 sets the retry backoff', async () => {
  // No env override here: the header is the only backoff source.
  const subs = Array.from({ length: 7 }, (_, i) => sub(i + 1, `https://push.example/${i + 1}`));
  installDb(subs);
  const callTimes = [];
  const fail429WithRetryAfter = () => {
    const err = failWith(429);
    err.headers = { 'retry-after': '1' };
    return err;
  };
  mockSendNotification.mockImplementation(async (target) => {
    callTimes.push(Date.now());
    if (target.endpoint === 'https://push.example/2') throw fail429WithRetryAfter();
  });
  const result = await service.sendToUser('u1', { id: 'n1', type: 'x', title: 'T', body: 'B' });
  expect(result.rateLimited).toBe(true);
  expect(result.sent).toBe(6);
  expect(result.retried).toBe(3); // subs 6, 7 + the throttled sub 2
  expect(result.dropped).toBe(0);
  // First pass: 5 calls; retry pass: 3 calls. The first retry call lands
  // ~1s after the last first-pass call, per the Retry-After header.
  expect(callTimes).toHaveLength(8);
  expect(callTimes[5] - callTimes[4]).toBeGreaterThanOrEqual(900);
});
