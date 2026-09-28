'use strict';

/**
 * Driver-facing delivery tracking API tests.
 *
 * Exercises the real router (server/routes/localDelivery.js) end to end over
 * HTTP with supertest. The auth middleware is stubbed to inject a chosen test
 * user; the tracking services are mocked so no database is required. The
 * controller's own SQL (job load, scan list, device register/list) goes
 * through the shared pg mock.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/auth', () => {
  const state = { user: null };
  const requireAuth = (req, res, next) => {
    if (!state.user) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.user = state.user;
    return next();
  };
  return { requireAuth, __setUser: (user) => { state.user = user; } };
});

jest.mock('../services/deliveryTrackingService', () => ({
  grantConsent: jest.fn(),
  revokeConsent: jest.fn(),
  getActiveConsent: jest.fn(),
  startTracking: jest.fn(),
  pauseTracking: jest.fn(),
  resumeTracking: jest.fn(),
  stopTracking: jest.fn(),
  ingestLocationBatch: jest.fn(),
  recordScan: jest.fn(),
  getAssignmentStatus: jest.fn(),
}));

jest.mock('../services/deliveryGeofenceService', () => ({
  ensureGeofences: jest.fn(),
  evaluatePoint: jest.fn(),
  getObservations: jest.fn(),
}));

jest.mock('../services/deliveryEtaService', () => ({
  refreshEta: jest.fn(),
  getCurrentEta: jest.fn(),
  markEtaUnavailable: jest.fn(),
}));

const express = require('express');
const request = require('supertest');

const authMock = require('../middleware/auth');
const router = require('../routes/localDelivery');
const trackingService = require('../services/deliveryTrackingService');
const geofenceService = require('../services/deliveryGeofenceService');
const etaService = require('../services/deliveryEtaService');

const DRIVER = { id: 'driver-1', role: 'helper', default_mode: 'helper' };
const CUSTOMER = { id: 'customer-1', role: 'customer' };
const OPS = { id: 'ops-1', role: 'admin' };

const JOB = {
  id: 42,
  helper_user_id: DRIVER.id,
  internal_driver_user_id: null,
  customer_user_id: CUSTOMER.id,
  status: 'assigned',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/delivery', router);
  return app;
}

/** Queue the pg mock responses for the controller's direct queries in order. */
function mockJobQuery(job = JOB) {
  mockQuery.mockResolvedValueOnce({ rows: [job] });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('delivery tracking API', () => {
  test('driver grants tracking consent', async () => {
    authMock.__setUser(DRIVER);
    mockJobQuery();
    trackingService.grantConsent.mockResolvedValue({
      id: 1, delivery_job_id: JOB.id, driver_user_id: DRIVER.id, device_id: 7, consent_version: 'v2',
    });

    const res = await request(buildApp())
      .post('/delivery/jobs/42/tracking/consent')
      .send({ deviceId: 7, consentVersion: 'v2' });

    expect(res.status).toBe(201);
    expect(res.body.consent).toMatchObject({ device_id: 7, consent_version: 'v2' });
    expect(trackingService.grantConsent).toHaveBeenCalledWith({
      deliveryJobId: JOB.id,
      driverUserId: DRIVER.id,
      deviceId: 7,
      consentVersion: 'v2',
    });
  });

  test('consent grant requires deviceId', async () => {
    authMock.__setUser(DRIVER);
    mockJobQuery();

    const res = await request(buildApp())
      .post('/delivery/jobs/42/tracking/consent')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('tracking_consent_invalid');
    expect(trackingService.grantConsent).not.toHaveBeenCalled();
  });

  test('customer cannot grant consent for the driver', async () => {
    authMock.__setUser(CUSTOMER);
    mockJobQuery();

    const res = await request(buildApp())
      .post('/delivery/jobs/42/tracking/consent')
      .send({ deviceId: 7 });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tracking_forbidden');
    expect(trackingService.grantConsent).not.toHaveBeenCalled();
  });

  test('start maps duplicate-session guard to 409', async () => {
    authMock.__setUser(DRIVER);
    mockJobQuery();
    geofenceService.ensureGeofences.mockResolvedValue({ pickup: { id: 1 }, destination: { id: 2 } });
    const guard = new Error('Delivery already has an active tracking assignment');
    guard.code = 'tracking_assignment_active';
    guard.status = 409;
    trackingService.startTracking.mockRejectedValue(guard);

    const res = await request(buildApp())
      .post('/delivery/jobs/42/tracking/start')
      .send({ deviceId: 7 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('tracking_assignment_active');
    expect(geofenceService.ensureGeofences).toHaveBeenCalledWith(JOB.id);
    expect(trackingService.startTracking).toHaveBeenCalledWith({
      deliveryJobId: JOB.id,
      deviceId: 7,
      driverUserId: DRIVER.id,
      vehicleId: null,
      sourcePolicy: 'driver_gps',
    });
  });

  test('start requires consent guard to surface as 403', async () => {
    authMock.__setUser(DRIVER);
    mockJobQuery();
    geofenceService.ensureGeofences.mockResolvedValue({ pickup: { id: 1 }, destination: { id: 2 } });
    const guard = new Error('Active driver tracking consent is required');
    guard.code = 'tracking_consent_required';
    guard.status = 403;
    trackingService.startTracking.mockRejectedValue(guard);

    const res = await request(buildApp())
      .post('/delivery/jobs/42/tracking/start')
      .send({ deviceId: 7 });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tracking_consent_required');
  });

  test('location batch evaluates geofence and refreshes ETA', async () => {
    authMock.__setUser(DRIVER);
    mockJobQuery();
    const assignment = { id: 9, status: 'active', driver_user_id: DRIVER.id };
    trackingService.getAssignmentStatus.mockResolvedValue({ assignment });
    trackingService.ingestLocationBatch.mockResolvedValue({
      accepted: 2, suspicious: 0, rejected: 1, duplicates: 0,
    });
    geofenceService.evaluatePoint.mockResolvedValue({ suggestion: 'arrival', geofenceKind: 'destination' });
    etaService.refreshEta.mockResolvedValue({ throttled: true, snapshot: { id: 3 }, movementMeters: 12 });
    etaService.getCurrentEta.mockResolvedValue({
      stale: false, etaAt: '2026-09-28T23:30:00.000Z', source: 'live_tracking',
      confidence: 'high', lastPointAt: '2026-09-28T23:00:00.000Z',
    });

    const points = [
      { latitude: 18.54, longitude: -72.34, recordedAt: '2026-09-28T22:59:30.000Z', accuracyMeters: 8 },
      { latitude: 18.541, longitude: -72.339, recordedAt: '2026-09-28T23:00:00.000Z', accuracyMeters: 9 },
    ];
    const res = await request(buildApp())
      .post('/delivery/jobs/42/tracking/locations')
      .send({ points });

    expect(res.status).toBe(200);
    expect(trackingService.ingestLocationBatch).toHaveBeenCalledWith({
      assignmentId: 9,
      points,
      actorUserId: DRIVER.id,
    });
    // Latest point (by recordedAt) is evaluated against geofences.
    expect(geofenceService.evaluatePoint).toHaveBeenCalledWith({
      deliveryJobId: JOB.id,
      latitude: 18.541,
      longitude: -72.339,
      recordedAt: '2026-09-28T23:00:00.000Z',
    });
    // Throttled ETA refresh is tolerated, not an error.
    expect(etaService.refreshEta).toHaveBeenCalledWith(JOB.id);
    expect(res.body.summary).toMatchObject({ accepted: 2, rejected: 1 });
    expect(res.body.geofence).toMatchObject({ suggestion: 'arrival' });
    expect(res.body.eta).toMatchObject({ throttled: true });
    expect(res.body.etaSnapshot).toMatchObject({ stale: false, confidence: 'high' });
  });

  test('customer may not submit locations', async () => {
    authMock.__setUser(CUSTOMER);
    mockJobQuery();

    const res = await request(buildApp())
      .post('/delivery/jobs/42/tracking/locations')
      .send({ points: [{ latitude: 18.54, longitude: -72.34, recordedAt: '2026-09-28T23:00:00.000Z' }] });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tracking_forbidden');
    expect(trackingService.ingestLocationBatch).not.toHaveBeenCalled();
    expect(geofenceService.evaluatePoint).not.toHaveBeenCalled();
    expect(etaService.refreshEta).not.toHaveBeenCalled();
  });

  test('locations require an active tracking session', async () => {
    authMock.__setUser(DRIVER);
    mockJobQuery();
    trackingService.getAssignmentStatus.mockResolvedValue({ assignment: null });

    const res = await request(buildApp())
      .post('/delivery/jobs/42/tracking/locations')
      .send({ points: [{ latitude: 18.54, longitude: -72.34, recordedAt: '2026-09-28T23:00:00.000Z' }] });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tracking_assignment_not_found');
  });

  test('ops user can view driver assignment status', async () => {
    authMock.__setUser(OPS);
    mockJobQuery();
    const status = {
      assignment: { id: 9, status: 'active' },
      device: { id: 7 },
      consent: { id: 1 },
      lastLocationAt: '2026-09-28T23:00:00.000Z',
      lastLocationState: 'valid',
    };
    trackingService.getAssignmentStatus.mockResolvedValue(status);

    const res = await request(buildApp()).get('/delivery/jobs/42/tracking/status');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lastLocationState: 'valid' });
  });

  test('driver records and lists scans', async () => {
    authMock.__setUser(DRIVER);
    mockJobQuery();
    trackingService.recordScan.mockResolvedValue({
      id: 5, delivery_job_id: JOB.id, scan_type: 'pickup', code_value: 'QR-1', duplicate: false,
    });

    const recorded = await request(buildApp())
      .post('/delivery/jobs/42/tracking/scans')
      .send({ scanType: 'pickup', codeValue: 'QR-1' });

    expect(recorded.status).toBe(201);
    expect(recorded.body.scan).toMatchObject({ scan_type: 'pickup' });
    expect(trackingService.recordScan).toHaveBeenCalledWith({
      deliveryJobId: JOB.id,
      scanType: 'pickup',
      scannedByUserId: DRIVER.id,
      codeValue: 'QR-1',
      codeFormat: null,
      idempotencyKey: null,
    });

    mockJobQuery();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, delivery_job_id: JOB.id, scan_type: 'pickup', code_value: 'QR-1' }],
    });
    const listed = await request(buildApp()).get('/delivery/jobs/42/tracking/scans');

    expect(listed.status).toBe(200);
    expect(listed.body.scans).toHaveLength(1);
  });

  test('driver registers and lists own devices', async () => {
    authMock.__setUser(DRIVER);
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 7, kind: 'driver_phone', driver_user_id: DRIVER.id, status: 'active' }],
    });

    const registered = await request(buildApp())
      .post('/delivery/tracking/devices')
      .send({ kind: 'driver_phone', deviceLabel: 'Pixel 8', platform: 'android', appVersion: '1.2.3' });

    expect(registered.status).toBe(201);
    expect(registered.body.device).toMatchObject({ kind: 'driver_phone', status: 'active' });

    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 7, kind: 'driver_phone', driver_user_id: DRIVER.id, status: 'active' }],
    });
    const listed = await request(buildApp()).get('/delivery/tracking/devices');

    expect(listed.status).toBe(200);
    expect(listed.body.devices).toHaveLength(1);
  });

  test('driver cannot register a vehicle tracker', async () => {
    authMock.__setUser(DRIVER);

    const res = await request(buildApp())
      .post('/delivery/tracking/devices')
      .send({ kind: 'vehicle_tracker', vehicleId: 3 });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tracking_forbidden');
  });

  test('unknown job returns 404', async () => {
    authMock.__setUser(DRIVER);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/delivery/jobs/999/tracking/status');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tracking_delivery_not_found');
  });
});
