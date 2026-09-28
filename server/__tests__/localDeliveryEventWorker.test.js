'use strict';

jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn() }));
jest.mock('../services/socketService', () => ({ broadcastToUser: jest.fn() }));
jest.mock('../utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

const { mockQuery, resetMocks } = require('./setup');
const { sendNotification } = require('../services/notificationService');
const { broadcastToUser } = require('../services/socketService');
const runtimeState = require('../services/runtimeState');
const {
  processDeliveryEvents, startLocalDeliveryEventWorker,
  buildPublicDeliveryEvent, getPublicDeliveryEventType,
} = require('../services/localDeliveryEventWorker');
const { DELIVERY_NOTIFICATION_EVENTS, deliveryNotifications } = require('../utils/localDeliveryNotifications');
const { tNotif } = require('../utils/i18n');

const eventRow = (patch = {}) => ({
  event_id: '901', consumer: 'notifications', attempts: 1,
  delivery_job_id: '81', event_type: 'delivery_picked_up', event_version: 2,
  event_created_at: '2026-09-28T12:00:00.000Z',
  customer_user_id: 'customer', helper_user_id: 'driver', internal_driver_user_id: null,
  actor_user_id: 'driver', reference: 'DEL-81', status: 'picked_up', payload: {}, customer_visible: true,
  ...patch,
});

// Explicit responses model independently claimed consumers; completion and
// renewal are separate DB operations so tests can inject loss of ownership.
function queueClaims(rows) {
  mockQuery.mockImplementation(async (sql) => {
    if (sql.startsWith('WITH candidate')) {
      const row = rows.shift();
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    return { rows: [], rowCount: 1 };
  });
}
function completions() {
  return mockQuery.mock.calls.filter(([sql]) => sql.includes('SET status = $4'));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMocks();
  runtimeState.reset();
  runtimeState.update({ realtimeReady: true });
  sendNotification.mockReset().mockResolvedValue({ success: true });
  broadcastToUser.mockReset();
});
afterEach(() => jest.useRealTimers());

test('sends localized-key notifications, excluding actor and duplicate recipients, then acknowledges only that claim', async () => {
  queueClaims([eventRow({ internal_driver_user_id: 'driver' })]);
  await expect(processDeliveryEvents()).resolves.toEqual({ scanned: 1, delivered: 1, failed: 0 });
  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(sendNotification).toHaveBeenCalledWith({
    userId: 'customer', type: 'delivery:delivery_picked_up', body: '(DEL-81)',
    data: { deliveryJobId: '81', eventId: '901', eventType: 'delivery_picked_up' },
    action_url: '/delivery/jobs/81', idempotencyKey: 'delivery-event:901:customer',
  });
  expect(completions()[0][1]).toEqual(['901', 'notifications', 1, 'delivered', null, 60000]);
});

test('success:false retries notifications while the independently claimed realtime consumer succeeds', async () => {
  sendNotification.mockResolvedValue({ success: false, error: 'private provider payload' });
  queueClaims([eventRow(), eventRow({ consumer: 'realtime', attempts: 4 })]);
  await expect(processDeliveryEvents()).resolves.toEqual({ scanned: 2, delivered: 1, failed: 1 });
  expect(completions().map(([, args]) => args.slice(0, 5))).toEqual([
    ['901', 'notifications', 1, 'failed', 'delivery_consumer_failed'],
    ['901', 'realtime', 4, 'delivered', null],
  ]);
  expect(broadcastToUser).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(completions())).not.toContain('private provider payload');
});

test('partial recipient failure keeps stable recipient idempotency keys on retry', async () => {
  const row = eventRow({ actor_user_id: null });
  sendNotification.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false });
  queueClaims([row]);
  await expect(processDeliveryEvents()).resolves.toMatchObject({ failed: 1 });
  queueClaims([{ ...row, attempts: 2 }]);
  await expect(processDeliveryEvents()).resolves.toMatchObject({ delivered: 1 });
  expect(sendNotification.mock.calls.map(([notification]) => notification.idempotencyKey)).toEqual([
    'delivery-event:901:customer', 'delivery-event:901:driver',
    'delivery-event:901:customer', 'delivery-event:901:driver',
  ]);
});

test('realtime replay emits a stable public envelope to all participants, including actor devices', async () => {
  queueClaims([eventRow({
    consumer: 'realtime', event_type: 'delivery_coordinated', status: 'assigned',
    payload: { source: 'internal', reason: 'marketplace capacity', driver_user_id: 'private-driver' },
  })]);
  await processDeliveryEvents();
  expect(broadcastToUser.mock.calls.map(([userId]) => userId)).toEqual(['customer', 'driver']);
  expect(broadcastToUser).toHaveBeenCalledWith('customer', 'delivery:updated', {
    eventId: '901', eventVersion: 2, jobId: '81', reference: 'DEL-81',
    eventType: 'delivery_assigned', status: 'assigned', updatedAt: '2026-09-28T12:00:00.000Z',
  });
  const publicData = JSON.stringify(broadcastToUser.mock.calls);
  expect(publicData).not.toMatch(/internal|marketplace|reason|private-driver|coordinated/);
});

test.each(['delivery_marketplace_released', 'delivery_internal_assignment_failed', 'unknown_event'])(
  'retires accidentally queued private event %s without notifications or realtime',
  async (eventType) => {
    queueClaims([
      eventRow({ event_type: eventType, payload: { reason: 'private marketplace reason' } }),
      eventRow({ event_type: eventType, consumer: 'realtime' }),
    ]);
    await expect(processDeliveryEvents()).resolves.toMatchObject({ delivered: 2 });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(broadcastToUser).not.toHaveBeenCalled();
  },
);

test('respects explicit non-public visibility even for an allowed event', async () => {
  queueClaims([eventRow({ customer_visible: false }), eventRow({ payload: { customerVisible: false } })]);
  await processDeliveryEvents();
  expect(sendNotification).not.toHaveBeenCalled();
});

test('does not acknowledge realtime delivery before the actual socket runtime is ready', async () => {
  runtimeState.reset();
  queueClaims([eventRow({ consumer: 'realtime' })]);
  await expect(processDeliveryEvents()).resolves.toMatchObject({ delivered: 0, failed: 1 });
  expect(broadcastToUser).not.toHaveBeenCalled();
});

test('retries thrown transport failure independently, retaining the same public event identity', async () => {
  broadcastToUser.mockImplementationOnce(() => { throw new Error('unavailable'); });
  queueClaims([eventRow({ consumer: 'realtime' })]);
  await expect(processDeliveryEvents()).resolves.toMatchObject({ failed: 1 });
  queueClaims([eventRow({ consumer: 'realtime', attempts: 2 })]);
  await expect(processDeliveryEvents()).resolves.toMatchObject({ delivered: 1 });
  expect(broadcastToUser.mock.calls.every(([, , event]) => event.eventId === '901')).toBe(true);
});

test('atomic claims recover expired processing rows and delay failed consumers with capped exponential backoff', async () => {
  queueClaims([eventRow({ attempts: 7 })]);
  await processDeliveryEvents();
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain('FOR UPDATE SKIP LOCKED');
  expect(sql).toContain("status = 'processing' AND updated_at <= NOW()");
  expect(sql).toContain("status = 'failed' AND updated_at <= NOW()");
  expect(sql).toContain('POWER(2, LEAST(GREATEST(attempts - 1, 0), 20))');
  expect(sql).toContain('ded.consumer = c.consumer');
  expect(params).toEqual([60000, 5000, 3600000]);
  expect(completions()[0][1][2]).toBe(7);
});

test('a stale owner cannot send or acknowledge after another worker reclaims the event', async () => {
  let claimed = false;
  mockQuery.mockImplementation(async (sql) => {
    if (sql.startsWith('WITH candidate') && !claimed) {
      claimed = true;
      return { rows: [eventRow()], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  await expect(processDeliveryEvents()).resolves.toEqual({ scanned: 1, delivered: 0, failed: 0 });
  expect(sendNotification).not.toHaveBeenCalled();
  const fencedWrites = mockQuery.mock.calls.filter(([sql]) => sql.startsWith('UPDATE'));
  expect(fencedWrites).toHaveLength(2);
  for (const [sql] of fencedWrites) {
    expect(sql).toContain('attempts = $3');
    expect(sql).toContain("status = 'processing'");
    expect(sql).toContain('updated_at > NOW()');
  }
});

test('renews a slow send lease while polling remains non-overlapping and shutdown drains the claim', async () => {
  jest.useFakeTimers();
  let finish;
  sendNotification.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  queueClaims([eventRow(), eventRow({ event_id: '902' })]);
  const worker = startLocalDeliveryEventWorker();
  await jest.advanceTimersByTimeAsync(1500);
  expect(sendNotification).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(20000);
  expect(mockQuery.mock.calls.filter(([sql]) => sql.startsWith('WITH candidate'))).toHaveLength(1);
  expect(mockQuery.mock.calls.filter(([sql]) => sql.includes('SET updated_at = NOW()'))).toHaveLength(2);
  let drained = false;
  const stopping = worker.stop().then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  finish({ success: true });
  await stopping;
  expect(drained).toBe(true);
  expect(mockQuery.mock.calls.filter(([sql]) => sql.startsWith('WITH candidate'))).toHaveLength(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('empty queue and repeated stop are harmless', async () => {
  queueClaims([]);
  await expect(processDeliveryEvents()).resolves.toEqual({ scanned: 0, delivered: 0, failed: 0 });
  const worker = startLocalDeliveryEventWorker();
  await worker.stop();
  await worker.stop();
});

test('ETA public payload validates only the explicit arrival fields and never emits internal metadata', () => {
  const event = buildPublicDeliveryEvent(eventRow({
    event_type: 'delivery_eta_updated',
    payload: { etaAt: '2026-09-28T15:30:00-04:00', source: 'marketplace', reason: 'private', etaAvailable: true },
  }));
  expect(event).toMatchObject({ etaAt: '2026-09-28T19:30:00.000Z', etaAvailable: true });
  expect(event).not.toHaveProperty('source');
  expect(event).not.toHaveProperty('reason');
  expect(buildPublicDeliveryEvent(eventRow({
    event_type: 'delivery_eta_updated', payload: { etaAt: 'not-an-estimate' },
  }))).toMatchObject({ etaAt: null, etaAvailable: false });
});

test.each(['en', 'es', 'fr', 'ht', 'ar'])('all public delivery notifications have explicit %s translations', (language) => {
  for (const event of DELIVERY_NOTIFICATION_EVENTS) {
    expect(getPublicDeliveryEventType(event)).toBe(event);
    const key = 'delivery:' + event;
    expect(deliveryNotifications[key].title[language]).toEqual(expect.any(String));
    expect(deliveryNotifications[key].body[language]).toEqual(expect.any(String));
    expect(tNotif(key, language)).toEqual({
      title: deliveryNotifications[key].title[language], body: deliveryNotifications[key].body[language],
    });
    if (language !== 'en') expect(tNotif(key, language)).not.toEqual(tNotif(key, 'en'));
  }
});
