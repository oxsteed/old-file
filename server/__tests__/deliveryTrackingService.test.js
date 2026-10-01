'use strict';

/**
 * Focused tests for server/services/deliveryTrackingService.js.
 *
 * Uses the shared pg mock from ./setup (no real database). SQL is routed by
 * fragment matching so each test only stubs the queries its scenario needs.
 */

const { mockQuery, resetMocks } = require('./setup');
jest.mock('../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const service = require('../services/deliveryTrackingService');

function route(routes) {
  mockQuery.mockImplementation(async (sql, params) => {
    for (const [fragment, handler] of routes) {
      if (sql.includes(fragment)) return handler(params, sql);
    }
    return { rows: [], rowCount: 0 };
  });
}

const jobRow = (patch = {}) => ({
  id: 11, status: 'assigned', helper_user_id: 'drv-1', ...patch,
});

beforeEach(() => {
  jest.clearAllMocks();
  resetMocks();
});

// ── consent ────────────────────────────────────────────────────────────────

test('grantConsent creates a consent row', async () => {
  const consentRow = {
    id: 1, delivery_job_id: 11, driver_user_id: 'drv-1',
    device_id: 5, consent_version: 'v1', revoked_at: null,
  };
  route([
    ['FROM delivery_jobs', () => ({ rows: [jobRow()], rowCount: 1 })],
    ['FROM delivery_tracking_devices', () => ({
      rows: [{ id: 5, kind: 'driver_phone', status: 'active', driver_user_id: 'drv-1' }],
      rowCount: 1,
    })],
    ['INTO delivery_tracking_consent', () => ({ rows: [consentRow], rowCount: 1 })],
  ]);

  const row = await service.grantConsent({ deliveryJobId: 11, driverUserId: 'drv-1', deviceId: 5 });
  expect(row).toEqual(consentRow);
});

test('grantConsent re-grant upserts the single active row (uniqueness)', async () => {
  const updated = {
    id: 1, delivery_job_id: 11, driver_user_id: 'drv-1',
    device_id: 9, consent_version: 'v2', revoked_at: null,
  };
  route([
    ['FROM delivery_jobs', () => ({ rows: [jobRow()], rowCount: 1 })],
    ['FROM delivery_tracking_devices', () => ({
      rows: [{ id: 9, kind: 'driver_phone', status: 'active', driver_user_id: 'drv-1' }],
      rowCount: 1,
    })],
    ['INTO delivery_tracking_consent', (params) => {
      expect(params[2]).toBe(9); // device_id carried into the upsert
      return { rows: [updated], rowCount: 1 };
    }],
  ]);

  const row = await service.grantConsent({
    deliveryJobId: 11, driverUserId: 'drv-1', deviceId: 9, consentVersion: 'v2',
  });
  expect(row.device_id).toBe(9);
  // One upsert statement: the partial unique index guarantees a single active row.
  expect(mockQuery.mock.calls.filter(([sql]) => sql.includes('INTO delivery_tracking_consent')))
    .toHaveLength(1);
});

test('revokeConsent revokes consent and ends the active assignment as consent_revoked', async () => {
  const consent = { id: 1, delivery_job_id: 11, driver_user_id: 'drv-1', revoked_at: null };
  const assignment = { id: 21, delivery_job_id: 11, status: 'active' };
  let endedReason = null;
  let eventType = null;
  route([
    ['FROM delivery_tracking_consent', () => ({ rows: [consent], rowCount: 1 })],
    ['UPDATE delivery_tracking_consent', () => ({
      rows: [{ ...consent, revoked_at: '2026-09-28T00:00:00Z', revoke_reason: 'driver opted out' }],
      rowCount: 1,
    })],
    ['FROM delivery_tracking_assignments', () => ({ rows: [assignment], rowCount: 1 })],
    ['UPDATE delivery_tracking_assignments', (params, sql) => {
      endedReason = sql.includes("ended_reason = 'consent_revoked'") ? 'consent_revoked' : null;
      return { rows: [{ ...assignment, status: 'revoked' }], rowCount: 1 };
    }],
    ['INTO delivery_tracking_events', (params) => {
      eventType = params[2];
      return { rows: [{ id: 100 }], rowCount: 1 };
    }],
  ]);

  const res = await service.revokeConsent({
    deliveryJobId: 11, driverUserId: 'drv-1', reason: 'driver opted out',
  });
  expect(res.endedAssignmentId).toBe(21);
  expect(endedReason).toBe('consent_revoked');
  expect(eventType).toBe('tracking_stopped');
});

test('getActiveConsent returns null when there is no active consent', async () => {
  route([['FROM delivery_tracking_consent', () => ({ rows: [], rowCount: 0 })]]);
  await expect(service.getActiveConsent(11, 'drv-1')).resolves.toBeNull();
});

// ── startTracking guards ───────────────────────────────────────────────────

test('startTracking rejects a delivery in a non-trackable status', async () => {
  route([['FROM delivery_jobs', () => ({ rows: [jobRow({ status: 'posted' })], rowCount: 1 })]]);
  await expect(service.startTracking({ deliveryJobId: 11, deviceId: 5, driverUserId: 'drv-1' }))
    .rejects.toMatchObject({ code: 'tracking_invalid_delivery_status' });
});

test('startTracking rejects when the driver has no active consent', async () => {
  route([
    ['FROM delivery_jobs', () => ({ rows: [jobRow()], rowCount: 1 })],
    ['FROM delivery_tracking_consent', () => ({ rows: [], rowCount: 0 })],
  ]);
  await expect(service.startTracking({ deliveryJobId: 11, deviceId: 5, driverUserId: 'drv-1' }))
    .rejects.toMatchObject({ code: 'tracking_consent_required' });
});

test('startTracking maps a duplicate active assignment to a 409', async () => {
  route([
    ['FROM delivery_jobs', () => ({ rows: [jobRow()], rowCount: 1 })],
    ['FROM delivery_tracking_consent', () => ({ rows: [{ id: 1 }], rowCount: 1 })],
    ['FROM delivery_tracking_devices', () => ({
      rows: [{ id: 5, kind: 'driver_phone', status: 'active', driver_user_id: 'drv-1' }], rowCount: 1,
    })],
    ['INTO delivery_tracking_assignments', () => {
      const err = new Error('duplicate key value violates unique constraint "uq_tracking_assignment_active"');
      err.code = '23505';
      throw err;
    }],
  ]);
  await expect(service.startTracking({ deliveryJobId: 11, deviceId: 5, driverUserId: 'drv-1' }))
    .rejects.toMatchObject({ code: 'tracking_assignment_active', status: 409 });
});

test('startTracking success writes the assignment and a tracking_started event', async () => {
  const assignment = { id: 21, delivery_job_id: 11, status: 'active' };
  let eventType = null;
  route([
    ['FROM delivery_jobs', () => ({ rows: [jobRow()], rowCount: 1 })],
    ['FROM delivery_tracking_consent', () => ({ rows: [{ id: 1 }], rowCount: 1 })],
    ['FROM delivery_tracking_devices', () => ({
      rows: [{ id: 5, kind: 'driver_phone', status: 'active', driver_user_id: 'drv-1' }], rowCount: 1,
    })],
    ['INTO delivery_tracking_assignments', () => ({ rows: [assignment], rowCount: 1 })],
    ['INTO delivery_tracking_events', (params) => {
      eventType = params[2];
      return { rows: [{ id: 1 }], rowCount: 1 };
    }],
  ]);
  const res = await service.startTracking({ deliveryJobId: 11, deviceId: 5, driverUserId: 'drv-1' });
  expect(res.id).toBe(21);
  expect(eventType).toBe('tracking_started');
});

// ── location ingestion ─────────────────────────────────────────────────────

const activeAssignment = {
  id: 21, delivery_job_id: 11, device_id: 5, driver_user_id: 'drv-1',
  status: 'active', source_policy: 'driver_gps',
};

function ingestRoutes(seenKeys, states, eventPayloads) {
  return [
    ['FROM delivery_tracking_assignments', () => ({ rows: [activeAssignment], rowCount: 1 })],
    ['FROM delivery_location_points', () => ({ rows: [], rowCount: 0 })],
    ['INTO delivery_location_points', (params) => {
      const key = params[12];
      if (seenKeys.has(key)) return { rows: [], rowCount: 0 }; // ON CONFLICT DO NOTHING
      seenKeys.add(key);
      states.push(params[10]); // validation_state
      return { rows: [{ id: seenKeys.size }], rowCount: 1 };
    }],
    ['INTO delivery_tracking_events', (params) => {
      eventPayloads.push(params[6]);
      return { rows: [{ id: 1 }], rowCount: 1 };
    }],
  ];
}

test('ingestLocationBatch marks an impossible jump as suspicious but stores it', async () => {
  const t0 = new Date(Date.now() - 10 * 60 * 1000);
  const points = [
    { latitude: 0, longitude: 0, recordedAt: t0.toISOString(), sequence: 1 },
    // ~66.7 km in 30 s: exceeds the 50 km / 60 s jump threshold.
    { latitude: 0.6, longitude: 0, recordedAt: new Date(t0.getTime() + 30 * 1000).toISOString(), sequence: 2 },
  ];
  const states = [];
  const eventPayloads = [];
  route(ingestRoutes(new Set(), states, eventPayloads));

  const summary = await service.ingestLocationBatch({ assignmentId: 21, points });
  expect(summary).toEqual({ accepted: 1, suspicious: 1, rejected: 0, duplicates: 0 });
  expect(states).toEqual(['valid', 'suspicious']);
  expect(eventPayloads[0]).toMatchObject({ accepted: 1, suspicious: 1, point_count: 2 });
});

test('ingestLocationBatch rejects a future timestamp without storing it', async () => {
  const points = [{
    latitude: 0,
    longitude: 0,
    recordedAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min in the future
    sequence: 1,
  }];
  const states = [];
  const eventPayloads = [];
  route(ingestRoutes(new Set(), states, eventPayloads));

  const summary = await service.ingestLocationBatch({ assignmentId: 21, points });
  expect(summary).toEqual({ accepted: 0, suspicious: 0, rejected: 1, duplicates: 0 });
  expect(states).toHaveLength(0);
  expect(mockQuery.mock.calls.filter(([sql]) => sql.includes('INTO delivery_location_points')))
    .toHaveLength(0);
});

test('ingestLocationBatch skips a duplicate sequence silently', async () => {
  const t0 = new Date(Date.now() - 10 * 60 * 1000);
  const points = [
    { latitude: 0, longitude: 0, recordedAt: t0.toISOString(), sequence: 7 },
    { latitude: 0.0001, longitude: 0, recordedAt: new Date(t0.getTime() + 15 * 1000).toISOString(), sequence: 7 },
  ];
  const states = [];
  const eventPayloads = [];
  route(ingestRoutes(new Set(), states, eventPayloads));

  const summary = await service.ingestLocationBatch({ assignmentId: 21, points });
  expect(summary).toEqual({ accepted: 1, suspicious: 0, rejected: 0, duplicates: 1 });
  expect(states).toEqual(['valid']);
});

// ── scans ──────────────────────────────────────────────────────────────────

test('recordScan is idempotent on idempotency_key', async () => {
  const scanRow = {
    id: 31, delivery_job_id: 11, scan_type: 'pickup',
    scanned_by_user_id: 'drv-1', code_value: 'QR1', idempotency_key: 'k1',
  };
  let insertCalls = 0;
  let eventCalls = 0;
  route([
    ['FROM delivery_jobs', () => ({ rows: [jobRow({ status: 'picked_up' })], rowCount: 1 })],
    ['FROM users', () => ({ rows: [{ id: 'drv-1', role: 'helper' }], rowCount: 1 })],
    ['INTO delivery_scan_events', () => {
      insertCalls += 1;
      return insertCalls === 1 ? { rows: [scanRow], rowCount: 1 } : { rows: [], rowCount: 0 };
    }],
    ['FROM delivery_scan_events', () => ({ rows: [scanRow], rowCount: 1 })],
    ['INTO delivery_tracking_events', () => {
      eventCalls += 1;
      return { rows: [{ id: 1 }], rowCount: 1 };
    }],
  ]);

  const input = {
    deliveryJobId: 11, scanType: 'pickup',
    scannedByUserId: 'drv-1', codeValue: 'QR1', idempotencyKey: 'k1',
  };
  const first = await service.recordScan(input);
  expect(first.duplicate).toBe(false);
  expect(first.id).toBe(31);

  const second = await service.recordScan(input);
  expect(second.duplicate).toBe(true);
  expect(second.id).toBe(31);

  // The replayed scan must not write a second scan_recorded event.
  expect(eventCalls).toBe(1);
});

test('recordScan rejects a scanner who is neither the driver nor ops', async () => {
  route([
    ['FROM delivery_jobs', () => ({ rows: [jobRow({ status: 'picked_up' })], rowCount: 1 })],
    ['FROM users', () => ({ rows: [{ id: 'stranger', role: 'customer' }], rowCount: 1 })],
  ]);
  await expect(service.recordScan({
    deliveryJobId: 11, scanType: 'pickup', scannedByUserId: 'stranger', codeValue: 'QR1',
  })).rejects.toMatchObject({ code: 'tracking_scan_forbidden' });
});

test('recordScan rejects an unknown scan type', async () => {
  await expect(service.recordScan({
    deliveryJobId: 11, scanType: 'teleport', scannedByUserId: 'drv-1', codeValue: 'QR1',
  })).rejects.toMatchObject({ code: 'tracking_scan_type_invalid' });
});
