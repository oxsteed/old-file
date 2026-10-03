'use strict';

/**
 * Focused tests for server/services/deliveryTrackingEventBus.js.
 *
 * Uses the shared pg mock from ./setup (no real database). socketService is
 * mocked globally by setup.js; the two broadcast helpers the bus needs are
 * attached here since the global mock does not define them.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// Attach the broadcast helpers the bus calls onto the globally mocked
// socketService module (same object reference the bus holds).
const socketService = require('../services/socketService');
socketService.broadcastToRoom = jest.fn();
socketService.broadcastToOpsDelivery = jest.fn();

const bus = require('../services/deliveryTrackingEventBus');

const EXACT_LAT = 40.7128123;
const EXACT_LNG = -74.0060156;

function customerCalls() {
  return socketService.broadcastToRoom.mock.calls;
}

function opsCalls() {
  return socketService.broadcastToOpsDelivery.mock.calls;
}

// Route SQL by fragment: dedupe checks vs the event insert.
function routeDedupeAndInsert({ dedupeRows = [] } = {}) {
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes("payload->>'idempotency_key'") || sql.includes('WHERE provider = $1')) {
      return { rows: dedupeRows, rowCount: dedupeRows.length };
    }
    if (sql.includes('INSERT INTO delivery_tracking_events')) {
      return {
        rows: [{ id: 7, created_at: '2026-09-28T20:00:00.000Z' }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMocks();
  bus._resetCaches();
  routeDedupeAndInsert();
});

const locationPayload = () => ({
  latest: { latitude: EXACT_LAT, longitude: EXACT_LNG, recordedAt: '2026-09-28T19:59:00.000Z' },
  pointCount: 4,
  source: 'driver_gps',
});

// ── customer-safe vs ops-exact projections ──────────────────────────────────

test('customer payload has approximate (rounded) coords, ops payload has exact coords', async () => {
  const result = await bus.publishTrackingEvent({
    deliveryJobId: 42,
    eventType: 'location_updated',
    payload: locationPayload(),
    actorUserId: 'driver-1',
    assignmentId: 9,
  });

  expect(result.published).toBe(true);
  expect(result.eventId).toBe(7);

  // Stored as location_batch per migration 576's CHECK constraint.
  const insertCall = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO delivery_tracking_events'));
  expect(insertCall).toBeDefined();
  expect(insertCall[1][2]).toBe('location_batch');

  // Customer room: tracking:location_updated on delivery_42.
  expect(customerCalls()).toHaveLength(1);
  const [room, event, customerPayload] = customerCalls()[0];
  expect(room).toBe('delivery_42');
  expect(event).toBe('tracking:location_updated');
  expect(customerPayload.data.approximateArea).toEqual({
    approxLat: 40.71,
    approxLng: -74.01,
    accuracyRadiusMeters: 500,
  });
  // Exact coordinates must never appear anywhere in the customer payload.
  const serialized = JSON.stringify(customerPayload);
  expect(serialized).not.toContain(String(EXACT_LAT));
  expect(serialized).not.toContain(String(EXACT_LNG));
  expect(serialized).not.toContain('driver-1');

  // Ops room: exact coordinates pass through verbatim.
  expect(opsCalls()).toHaveLength(1);
  const [opsEvent, opsPayload] = opsCalls()[0];
  expect(opsEvent).toBe('tracking:ops:location_updated');
  expect(opsPayload.data.latest.latitude).toBe(EXACT_LAT);
  expect(opsPayload.data.latest.longitude).toBe(EXACT_LNG);
  expect(opsPayload.actorUserId).toBe('driver-1');
});

test('scan_recorded emits a customer-safe milestone without scan internals', async () => {
  await bus.publishTrackingEvent({
    deliveryJobId: 42,
    eventType: 'scan_recorded',
    payload: { scanType: 'pickup', scannedAt: '2026-09-28T19:30:00.000Z', codeValue: 'QR-SECRET-123' },
    insertEvent: false,
  });

  expect(customerCalls()).toHaveLength(1);
  const [, event, customerPayload] = customerCalls()[0];
  expect(event).toBe('tracking:scan_recorded');
  expect(customerPayload.data.milestone).toBe('Pickup confirmed');
  expect(JSON.stringify(customerPayload)).not.toContain('QR-SECRET-123');
});

test('customerVisible:false emits ops only', async () => {
  await bus.publishTrackingEvent({
    deliveryJobId: 42,
    eventType: 'tracking_exception',
    payload: { pointId: 5, decision: 'rejected' },
    customerVisible: false,
    insertEvent: false,
  });

  expect(customerCalls()).toHaveLength(0);
  expect(opsCalls()).toHaveLength(1);
  expect(opsCalls()[0][0]).toBe('tracking:ops:tracking_exception');
});

test('unknown event type is rejected', async () => {
  await expect(
    bus.publishTrackingEvent({ deliveryJobId: 42, eventType: 'teleport_completed' })
  ).rejects.toThrow('unknown tracking event type');
  expect(customerCalls()).toHaveLength(0);
  expect(opsCalls()).toHaveLength(0);
});

// ── throttling ──────────────────────────────────────────────────────────────

test('rapid location publishes: one customer emit, one ops emit per publish', async () => {
  const args = {
    deliveryJobId: 42,
    eventType: 'location_updated',
    payload: locationPayload(),
    insertEvent: false, // service already wrote the location_batch row
  };

  await bus.publishTrackingEvent(args);
  await bus.publishTrackingEvent(args);

  // Customer broadcast throttled to 1/minute per delivery...
  expect(customerCalls()).toHaveLength(1);
  // ...while the ops room receives every batch.
  expect(opsCalls()).toHaveLength(2);
});

test('throttle is per delivery: different jobs each get a customer emit', async () => {
  await bus.publishTrackingEvent({
    deliveryJobId: 42, eventType: 'location_updated',
    payload: locationPayload(), insertEvent: false,
  });
  await bus.publishTrackingEvent({
    deliveryJobId: 43, eventType: 'location_updated',
    payload: locationPayload(), insertEvent: false,
  });

  expect(customerCalls()).toHaveLength(2);
  expect(customerCalls()[0][0]).toBe('delivery_42');
  expect(customerCalls()[1][0]).toBe('delivery_43');
});

// ── idempotency ─────────────────────────────────────────────────────────────

test('idempotent publish: duplicate key skips the row and both broadcasts', async () => {
  let dedupeHits = 0;
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes("payload->>'idempotency_key'")) {
      dedupeHits += 1;
      // First publish: no existing row. Second: the row exists.
      return dedupeHits === 1
        ? { rows: [], rowCount: 0 }
        : { rows: [{ '?column?': 1 }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO delivery_tracking_events')) {
      return { rows: [{ id: 7, created_at: '2026-09-28T20:00:00.000Z' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const args = {
    deliveryJobId: 42,
    eventType: 'location_updated',
    payload: locationPayload(),
    idempotencyKey: 'telematics:samsara:evt-123',
    provider: 'samsara',
    providerEventId: 'evt-123',
  };

  const first = await bus.publishTrackingEvent(args);
  expect(first).toEqual({ published: true, eventId: 7 });
  expect(customerCalls()).toHaveLength(1);
  expect(opsCalls()).toHaveLength(1);

  const second = await bus.publishTrackingEvent(args);
  expect(second).toEqual({ published: false, duplicate: true });

  // No second row, no second broadcast on either room.
  const inserts = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO delivery_tracking_events'));
  expect(inserts).toHaveLength(1);
  expect(customerCalls()).toHaveLength(1);
  expect(opsCalls()).toHaveLength(1);
});

// ── V2-P1-06: cross-process fencing ──────────────────────────────────────────

const processState = require('../utils/processState');

afterEach(() => {
  processState._resetForTests();
});

test('idempotency fence short-circuits on the Redis NX claim before the DB', async () => {
  const claims = new Map();
  processState._injectRedis({
    set: async (key, _v, _ex, _ttl, nx) => {
      if (nx === 'NX' && claims.has(key)) return null;
      claims.set(key, true);
      return 'OK';
    },
  });

  const args = {
    deliveryJobId: 43,
    eventType: 'eta_updated',
    payload: { etaAt: '2026-09-28T20:05:00.000Z' },
    idempotencyKey: 'redis-fence:k-1',
  };

  const first = await bus.publishTrackingEvent(args);
  expect(first.published).toBe(true);

  const second = await bus.publishTrackingEvent(args);
  expect(second).toEqual({ published: false, duplicate: true });

  // The second publish never reached the DB dedupe check or the insert:
  // the fence claim alone decided it.
  const dedupeCalls = mockQuery.mock.calls.filter(([sql]) => sql.includes("payload->>'idempotency_key'"));
  expect(dedupeCalls).toHaveLength(1);
  const inserts = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO delivery_tracking_events'));
  expect(inserts).toHaveLength(1);
  // The fence key carries the delivery + idempotency identity.
  expect([...claims.keys()].some((k) => k.includes('43:redis-fence:k-1'))).toBe(true);
});

test('customer location throttle allows one broadcast per window, ops still flows', async () => {
  const args = {
    deliveryJobId: 99,
    eventType: 'location_updated',
    payload: locationPayload(),
  };

  const first = await bus.publishTrackingEvent(args);
  expect(first.published).toBe(true);
  expect(customerCalls()).toHaveLength(1);
  expect(opsCalls()).toHaveLength(1);

  const second = await bus.publishTrackingEvent(args);
  expect(second.published).toBe(true);
  // Customer room throttled; ops room still receives every batch.
  expect(customerCalls()).toHaveLength(1);
  expect(opsCalls()).toHaveLength(2);
});

test('insert failure releases the fence so a retry is not treated as duplicate', async () => {
  let attempts = 0;
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes("payload->>'idempotency_key'")) return { rows: [], rowCount: 0 };
    if (sql.includes('INSERT INTO delivery_tracking_events')) {
      attempts += 1;
      if (attempts === 1) throw new Error('db down');
      return { rows: [{ id: 8, created_at: '2026-09-28T20:00:00.000Z' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const args = {
    deliveryJobId: 44,
    eventType: 'eta_updated',
    payload: { etaAt: '2026-09-28T20:05:00.000Z' },
    idempotencyKey: 'retry:k-9',
  };

  await expect(bus.publishTrackingEvent(args)).rejects.toThrow('db down');
  const retry = await bus.publishTrackingEvent(args);
  expect(retry).toEqual({ published: true, eventId: 8 });
});
