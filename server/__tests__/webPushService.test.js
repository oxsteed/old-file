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

test('M5: a 429 aborts the remaining fan-out for that notification', async () => {
  const subs = Array.from({ length: 12 }, (_, i) => sub(i + 1, `https://push.example/${i + 1}`));
  const { active, counts } = installDb(subs);
  mockSendNotification.mockImplementation(async (target) => {
    if (target.endpoint === 'https://push.example/2') throw failWith(429);
  });
  const result = await service.sendToUser('u1', { id: 'n1', type: 'x', title: 'T', body: 'B' });
  expect(result.rateLimited).toBe(true);
  // Only the first chunk (5 sends) was attempted; the rest were not tried.
  expect(mockSendNotification).toHaveBeenCalledTimes(5);
  for (let i = 6; i <= 12; i += 1) {
    expect(mockSendNotification.mock.calls.some(([t]) => t.endpoint === `https://push.example/${i}`)).toBe(false);
    expect(active.get(i)).toBe(true);
  }
  // The 429 itself is a provider signal, not a dead endpoint: no deactivation.
  expect(result.deactivated).toBe(0);
  expect(counts.get(2) || 0).toBe(0);
});
