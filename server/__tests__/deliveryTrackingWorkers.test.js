'use strict';

/**
 * Focused tests for server/workers/deliveryTrackingWorkers.js.
 *
 * Uses the shared pg mock from ./setup (no real database). SQL is routed by
 * fragment matching so each test only stubs the queries its scenario needs.
 * Services are mocked, except evaluatePoint which runs for real against the
 * pg mock so geofence transition idempotency is exercised end to end.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));
jest.mock('../services/deliveryEtaService', () => ({
  refreshEta: jest.fn(),
  getCurrentEta: jest.fn(),
  markEtaUnavailable: jest.fn(),
}));
jest.mock('../services/deliveryTrackingLinkService', () => ({
  expireCompletedLinks: jest.fn(),
}));
jest.mock('../services/telematicsConnectionService', () => ({
  updateCursor: jest.fn(),
  recordSyncError: jest.fn(),
  recordSyncSuccess: jest.fn(),
}));
jest.mock('../services/telematics/adapterRegistry', () => ({
  getAdapter: jest.fn(),
  SUPPORTED_PROVIDERS: [],
}));
// Real evaluatePoint (transition-based and idempotent) against the pg mock,
// wrapped so calls stay observable.
jest.mock('../services/deliveryGeofenceService', () => {
  const actual = jest.requireActual('../services/deliveryGeofenceService');
  return { ...actual, evaluatePoint: jest.fn((args) => actual.evaluatePoint(args)) };
});

const workers = require('../workers/deliveryTrackingWorkers');
const { refreshEta } = require('../services/deliveryEtaService');
const { expireCompletedLinks } = require('../services/deliveryTrackingLinkService');
const telematicsConnectionService = require('../services/telematicsConnectionService');
const { getAdapter } = require('../services/telematics/adapterRegistry');
const { sendNotification } = require('../services/notificationService');

function route(routes) {
  mockQuery.mockImplementation(async (sql, params) => {
    for (const [fragment, handler] of routes) {
      if (sql.includes(fragment)) return handler(params, sql);
    }
    return { rows: [], rowCount: 0 };
  });
}

// In-memory sink for every tracking event written during a test, whatever the
// caller's INSERT shape (4 or 5 params).
const insertedEvents = [];
function trackEventInsert() {
  return (params) => {
    const hasProvider = params.length === 5;
    const raw = params[params.length - 1];
    insertedEvents.push({
      deliveryJobId: params[0],
      assignmentId: params[1],
      eventType: params[2],
      provider: hasProvider ? params[3] : null,
      payload: typeof raw === 'string' ? JSON.parse(raw) : raw,
    });
    return { rows: [{ id: insertedEvents.length }], rowCount: 1 };
  };
}

const staleEvents = () => insertedEvents.filter((e) => e.eventType === 'tracking_stale');

beforeEach(() => {
  jest.clearAllMocks();
  resetMocks();
  insertedEvents.length = 0;
  refreshEta.mockReset();
  expireCompletedLinks.mockReset();
  telematicsConnectionService.updateCursor.mockReset();
  telematicsConnectionService.recordSyncError.mockReset();
  telematicsConnectionService.recordSyncSuccess.mockReset();
  getAdapter.mockReset();
  sendNotification.mockReset();
  // evaluatePoint keeps the requireActual wrapper set in the mock factory.
});

// ── normalizeLocations ──────────────────────────────────────────────────────

const pendingPoint = (patch = {}) => ({
  id: 101,
  assignment_id: 11,
  delivery_job_id: 7,
  latitude: '40.7128',
  longitude: '-74.0060',
  accuracy_meters: '25',
  speed_mps: null,
  recorded_at: new Date(Date.now() - 60000).toISOString(),
  ...patch,
});

function routeNormalizer(pendingRows) {
  let pending = [...pendingRows];
  route([
    // UPDATE first: its WHERE clause contains "validation_state = 'pending'",
    // so it must not fall through to the pending SELECT handler.
    ['UPDATE delivery_location_points', () => ({ rows: [], rowCount: 1 })],
    ["validation_state = 'pending'", () => {
      const rows = pending;
      pending = [];
      return { rows, rowCount: rows.length };
    }],
    ["IN ('valid', 'suspicious')", () => ({ rows: [], rowCount: 0 })],
    ['INSERT INTO delivery_tracking_events', trackEventInsert()],
  ]);
}

test('normalizeLocations flips pending points to valid and is a no-op on rerun', async () => {
  routeNormalizer([pendingPoint()]);

  const first = await workers.normalizeLocations({ limit: 10 });
  expect(first).toEqual({ scanned: 1, normalized: 1, suspicious: 0, reviewEvents: 0 });

  const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE delivery_location_points'));
  expect(updateCall[1]).toEqual([101, 'valid', null]);

  const second = await workers.normalizeLocations({ limit: 10 });
  expect(second).toEqual({ scanned: 0, normalized: 0, suspicious: 0, reviewEvents: 0 });
  expect(insertedEvents).toHaveLength(0);
  // Exactly one flip across both runs: no duplicate updates or events.
  expect(mockQuery.mock.calls.filter(([sql]) => sql.includes('UPDATE delivery_location_points'))).toHaveLength(1);
});

test('normalizeLocations quarantines suspicious points with a review event', async () => {
  routeNormalizer([pendingPoint({ id: 102, accuracy_meters: '5000' })]);

  const summary = await workers.normalizeLocations({ limit: 10 });
  expect(summary).toEqual({ scanned: 1, normalized: 1, suspicious: 1, reviewEvents: 1 });

  const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE delivery_location_points'));
  expect(updateCall[1][1]).toBe('suspicious');
  expect(String(updateCall[1][2])).toContain('low_accuracy');

  expect(insertedEvents).toHaveLength(1);
  expect(insertedEvents[0].eventType).toBe('tracking_exception');
  expect(insertedEvents[0].payload.reason).toBe('suspicious_location_point');
  expect(insertedEvents[0].payload.point_id).toBe(102);
});

// ── refreshEtas ─────────────────────────────────────────────────────────────

function routeEtaStaleChecks(anchorIso) {
  return [
    ['last_point_at', () => ({
      rows: [{ started_at: anchorIso, last_point_at: null }],
      rowCount: 1,
    })],
    ["event_type = 'tracking_stale'", () => ({ rows: staleEvents(), rowCount: staleEvents().length })],
    ['INSERT INTO delivery_tracking_events', trackEventInsert()],
  ];
}

test('refreshEtas refreshes fresh assignments and marks silent ones stale exactly once', async () => {
  refreshEta
    .mockResolvedValueOnce({ id: 55 })
    .mockResolvedValueOnce({ throttled: true });
  const anchor = new Date(Date.now() - 20 * 60000).toISOString();
  route([
    ['JOIN delivery_location_points p', () => ({
      rows: [{ delivery_job_id: 7 }, { delivery_job_id: 9 }],
      rowCount: 2,
    })],
    ['NOT EXISTS', () => ({ rows: [{ id: 12, delivery_job_id: 8 }], rowCount: 1 })],
    ...routeEtaStaleChecks(anchor),
  ]);

  const first = await workers.refreshEtas({ limit: 10 });
  expect(first.refreshed).toBe(1);
  expect(first.throttled).toBe(1);
  expect(first.staleMarked).toBe(1);
  expect(refreshEta).toHaveBeenCalledWith(7);
  expect(refreshEta).toHaveBeenCalledWith(9);

  const second = await workers.refreshEtas({ limit: 10 });
  expect(second.staleMarked).toBe(0);
  expect(staleEvents()).toHaveLength(1);
});

// ── detectStaleTrackers ─────────────────────────────────────────────────────

test('detectStaleTrackers fires only after 15 min of silence, and only once', async () => {
  sendNotification.mockResolvedValue({ success: true });
  const anchor = new Date(Date.now() - 30 * 60000).toISOString();
  let silentRows = [];
  route([
    ['dj.reference', (params) => {
      // The 15-minute silence window is encoded in the selection query.
      expect(params).toContain(workers.STALE_POINT_MINUTES);
      expect(workers.STALE_POINT_MINUTES).toBe(15);
      return { rows: silentRows, rowCount: silentRows.length };
    }],
    ...routeEtaStaleChecks(anchor),
  ]);

  // A recent valid point exists -> the assignment is not selected -> silence.
  const quiet = await workers.detectStaleTrackers({ limit: 10 });
  expect(quiet).toEqual({ checked: 0, staleMarked: 0, notified: 0 });
  expect(sendNotification).not.toHaveBeenCalled();

  // Fifteen minutes with no valid point -> marked + one driver notification.
  silentRows = [{ id: 9, delivery_job_id: 8, driver_user_id: 'drv-1', reference: 'OX-100' }];
  const first = await workers.detectStaleTrackers({ limit: 10 });
  expect(first).toEqual({ checked: 1, staleMarked: 1, notified: 1 });
  expect(sendNotification).toHaveBeenCalledTimes(1);
  const notifArg = sendNotification.mock.calls[0][0];
  expect(notifArg.type).toBe('delivery:tracking_stale');
  expect(notifArg.userId).toBe('drv-1');
  expect(notifArg.idempotencyKey).toBe('tracking-stale:9');
  expect(JSON.stringify(notifArg)).not.toMatch(/-?\d{2}\.\d+/); // no coordinates leak

  // Rerun with no new data -> no duplicate event, no second notification.
  const second = await workers.detectStaleTrackers({ limit: 10 });
  expect(second).toEqual({ checked: 1, staleMarked: 0, notified: 0 });
  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(staleEvents()).toHaveLength(1);
});

// ── evaluateGeofences ───────────────────────────────────────────────────────

test('evaluateGeofences records arrivals once and never duplicates on re-evaluation', async () => {
  const fence = {
    id: 1, kind: 'destination',
    center_lat: '40.7128', center_lng: '-74.0060', radius_meters: '150',
  };
  const observations = [];
  let points = [
    { latitude: '40.7129', longitude: '-74.0061', recorded_at: new Date(Date.now() - 5 * 60000).toISOString() },
  ];
  route([
    ['DISTINCT a.delivery_job_id', () => ({ rows: [{ delivery_job_id: 7 }], rowCount: 1 })],
    ['MAX(observed_at)', () => ({
      rows: [{ last_observed_at: observations.length ? observations[observations.length - 1].observed_at : null }],
      rowCount: 1,
    })],
    ["INTERVAL '2 hours'", () => {
      const rows = points;
      points = [];
      return { rows, rowCount: rows.length };
    }],
    ['observed_at DESC, id DESC', () => ({ rows: observations.slice(-1), rowCount: observations.length ? 1 : 0 })],
    ['recorded_at < $2', () => ({ rows: [], rowCount: 0 })],
    ['INSERT INTO delivery_geofence_observations', (params) => {
      const obs = {
        id: observations.length + 1,
        geofence_id: params[0],
        delivery_job_id: params[1],
        observation: params[2],
        observed_at: params[3],
      };
      observations.push(obs);
      return { rows: [obs], rowCount: 1 };
    }],
    ['FROM delivery_geofences', () => ({ rows: [fence], rowCount: 1 })],
    ['INSERT INTO delivery_tracking_events', trackEventInsert()],
  ]);

  const first = await workers.evaluateGeofences({ limit: 10 });
  expect(first).toEqual({ jobs: 1, pointsEvaluated: 1, transitions: 1 });
  expect(observations).toHaveLength(1);
  expect(observations[0].observation).toBe('arrival');

  // A new point, still inside the fence: re-evaluated, but no new transition.
  points = [
    { latitude: '40.7130', longitude: '-74.0062', recorded_at: new Date().toISOString() },
  ];
  const second = await workers.evaluateGeofences({ limit: 10 });
  expect(second.pointsEvaluated).toBe(1);
  expect(second.transitions).toBe(0);
  expect(observations).toHaveLength(1);
  expect(insertedEvents.filter((e) => e.eventType === 'geofence_arrival')).toHaveLength(1);
});

// ── retryProviderWebhooks ───────────────────────────────────────────────────

const errorConn = (patch = {}) => ({
  id: 5, provider: 'geotab', vehicle_id: 3, cursor: 'v1',
  credential_ref: null, error_count: 5,
  updated_at: new Date(Date.now() - 3600000).toISOString(),
  ...patch,
});

test('retryProviderWebhooks records unconfigured providers without burning retries, then backs off', async () => {
  const fetchMock = jest.fn().mockRejectedValue(
    Object.assign(new Error("Telematics provider 'geotab' is not configured"), { code: 'PROVIDER_NOT_CONFIGURED' })
  );
  getAdapter.mockReturnValue({ fetchIncrementalUpdates: fetchMock });
  let conns = [errorConn()];
  route([
    ["status = 'error'", () => {
      const rows = conns;
      conns = []; // the recorded attempt advances updated_at -> backoff hides it next run
      return { rows, rowCount: rows.length };
    }],
    ['SET last_error', () => ({ rows: [], rowCount: 1 })],
  ]);

  const first = await workers.retryProviderWebhooks({ limit: 10 });
  expect(first).toEqual({ scanned: 1, succeeded: 0, notConfigured: 1, failed: 0 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith({ credentialRef: null, cursor: 'v1', vehicleExternalId: null });
  expect(telematicsConnectionService.recordSyncError).not.toHaveBeenCalled();
  expect(telematicsConnectionService.updateCursor).not.toHaveBeenCalled();

  const second = await workers.retryProviderWebhooks({ limit: 10 });
  expect(second.scanned).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('retryProviderWebhooks advances the cursor and clears errors on success', async () => {
  const fetchMock = jest.fn().mockResolvedValue({ points: [], nextCursor: 'v2' });
  getAdapter.mockReturnValue({ fetchIncrementalUpdates: fetchMock });
  route([
    ["status = 'error'", () => ({ rows: [errorConn({ id: 6, credential_ref: 'ref-1' })], rowCount: 1 })],
  ]);

  const summary = await workers.retryProviderWebhooks({ limit: 10 });
  expect(summary).toEqual({ scanned: 1, succeeded: 1, notConfigured: 0, failed: 0 });
  expect(telematicsConnectionService.updateCursor).toHaveBeenCalledWith(6, 'v2');
  expect(telematicsConnectionService.recordSyncSuccess).toHaveBeenCalledWith(6);
});

// ── reconcileCursors ────────────────────────────────────────────────────────

test('reconcileCursors alerts ops once per stale cursor window', async () => {
  const lastSync = new Date(Date.now() - 60 * 60000).toISOString();
  const created = new Date(Date.now() - 120 * 60000).toISOString();
  route([
    ['delivery_telematics_connections c', () => ({
      rows: [{ id: 5, provider: 'geotab', vehicle_id: 3, last_sync_at: lastSync, created_at: created }],
      rowCount: 1,
    })],
    ['FROM delivery_tracking_assignments', () => ({
      rows: [{ id: 11, delivery_job_id: 7 }],
      rowCount: 1,
    })],
    ["payload->>'reason' = 'stale_cursor'", () => ({
      rows: insertedEvents.filter((e) => e.payload && e.payload.reason === 'stale_cursor'),
      rowCount: 0,
    })],
    ['INSERT INTO delivery_tracking_events', trackEventInsert()],
  ]);

  const first = await workers.reconcileCursors({ limit: 10 });
  expect(first).toEqual({ staleConnections: 1, events: 1, skipped: 0 });

  const second = await workers.reconcileCursors({ limit: 10 });
  expect(second.events).toBe(0);

  const alerts = insertedEvents.filter((e) => e.payload && e.payload.reason === 'stale_cursor');
  expect(alerts).toHaveLength(1);
  expect(alerts[0].payload.connection_id).toBe(5);
  expect(alerts[0].provider).toBe('geotab');
});

// ── cleanupTrackingLinks ────────────────────────────────────────────────────

test('cleanupTrackingLinks clamps terminal links and prunes old revoked links', async () => {
  expireCompletedLinks.mockResolvedValue({ expired: 3 });
  let prunable = 2;
  route([
    ['DELETE FROM delivery_tracking_links', () => {
      const n = prunable;
      prunable = 0;
      return { rows: [], rowCount: n };
    }],
  ]);

  const first = await workers.cleanupTrackingLinks({ limit: 10 });
  expect(first).toEqual({ expiredLinks: 3, prunedLinks: 2 });
  expect(expireCompletedLinks).toHaveBeenCalledTimes(1);

  const second = await workers.cleanupTrackingLinks({ limit: 10 });
  expect(second).toEqual({ expiredLinks: 3, prunedLinks: 0 });
});

// ── enforceRetention ────────────────────────────────────────────────────────

test('enforceRetention deletes only points past retention_expires_at', async () => {
  let table = [
    { id: 1, expired: true },
    { id: 2, expired: false },
    { id: 3, expired: true },
  ];
  let deleteSql = null;
  route([
    ['DELETE FROM delivery_location_points', (params, sql) => {
      deleteSql = sql;
      const removed = table.filter((r) => r.expired).slice(0, params[0]);
      table = table.filter((r) => !removed.includes(r));
      return { rows: [], rowCount: removed.length };
    }],
  ]);

  const first = await workers.enforceRetention({ limit: 10 });
  expect(first.deleted).toBe(2);
  expect(table.map((r) => r.id)).toEqual([2]); // the unexpired point survives
  expect(deleteSql).toContain('retention_expires_at');

  const second = await workers.enforceRetention({ limit: 10 });
  expect(second.deleted).toBe(0);
});
