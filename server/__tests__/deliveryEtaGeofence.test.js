'use strict';

// The pg pool is globally mocked by __tests__/setup.js; queue query results
// with mockQuery in the exact order the services issue them.

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/geoRouteProviderService', () => ({
  calculateRoute: jest.fn(),
}));

const geoRouteProvider = require('../services/geoRouteProviderService');
const geofenceService = require('../services/deliveryGeofenceService');
const etaService = require('../services/deliveryEtaService');

const DEST_FENCE = {
  id: 11,
  kind: 'destination',
  center_lat: '40.712800',
  center_lng: '-74.006000',
  radius_meters: 150,
};

// ~14m from the fence center: inside the 150m radius.
const INSIDE = { latitude: 40.7129, longitude: -74.0061 };
// ~800m from the fence center: outside the radius.
const OUTSIDE = { latitude: 40.7200, longitude: -74.0060 };

const insertObservationCalls = () => mockQuery.mock.calls.filter(([sql]) =>
  /INSERT INTO delivery_geofence_observations/.test(sql));
const insertEtaSnapshotCalls = () => mockQuery.mock.calls.filter(([sql]) =>
  /INSERT INTO delivery_eta_snapshots/.test(sql));

beforeEach(() => {
  resetMocks();
  geoRouteProvider.calculateRoute.mockReset();
});

describe('delivery geofence edge detection', () => {
  test('records arrival once for a point inside the radius; second inside point is a no-op', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [DEST_FENCE] }) // active geofences
      .mockResolvedValueOnce({ rows: [] }) // no prior observation
      .mockResolvedValueOnce({ rows: [] }) // no prior valid point
      .mockResolvedValueOnce({ rows: [{ id: 501, observation: 'arrival' }] }) // observation insert
      .mockResolvedValueOnce({ rows: [] }); // tracking event insert

    const first = await geofenceService.evaluatePoint({
      deliveryJobId: 7,
      latitude: INSIDE.latitude,
      longitude: INSIDE.longitude,
      recordedAt: '2026-09-28T19:00:00.000Z',
    });

    expect(first).toEqual({ suggestion: 'arrival', geofenceKind: 'destination' });
    expect(insertObservationCalls()).toHaveLength(1);
    const eventCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO delivery_tracking_events/.test(sql));
    expect(eventCall[1][2]).toBe('geofence_arrival');

    // Second inside point: last observation says arrival, no transition.
    mockQuery
      .mockResolvedValueOnce({ rows: [DEST_FENCE] })
      .mockResolvedValueOnce({ rows: [{ observation: 'arrival', observed_at: '2026-09-28T19:00:00.000Z' }] });

    const second = await geofenceService.evaluatePoint({
      deliveryJobId: 7,
      latitude: INSIDE.latitude,
      longitude: INSIDE.longitude,
      recordedAt: '2026-09-28T19:01:00.000Z',
    });

    expect(second).toBeNull();
    expect(insertObservationCalls()).toHaveLength(1); // still exactly one arrival
  });

  test('records departure on inside -> outside transition', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [DEST_FENCE] })
      .mockResolvedValueOnce({ rows: [{ observation: 'arrival', observed_at: '2026-09-28T19:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ id: 502, observation: 'departure' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await geofenceService.evaluatePoint({
      deliveryJobId: 7,
      latitude: OUTSIDE.latitude,
      longitude: OUTSIDE.longitude,
      recordedAt: '2026-09-28T19:05:00.000Z',
    });

    expect(result).toEqual({ suggestion: 'departure', geofenceKind: 'destination' });
    const eventCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO delivery_tracking_events/.test(sql));
    expect(eventCall[1][2]).toBe('geofence_departure');
  });

  test('outside point with no history records nothing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [DEST_FENCE] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await geofenceService.evaluatePoint({
      deliveryJobId: 7,
      latitude: OUTSIDE.latitude,
      longitude: OUTSIDE.longitude,
      recordedAt: '2026-09-28T19:00:00.000Z',
    });

    expect(result).toBeNull();
    expect(insertObservationCalls()).toHaveLength(0);
  });

  test('getObservations returns newest first with geofence kind', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 2, observation: 'departure', geofence_kind: 'destination', observed_at: '2026-09-28T19:05:00Z' },
        { id: 1, observation: 'arrival', geofence_kind: 'destination', observed_at: '2026-09-28T19:00:00Z' },
      ],
    });

    const observations = await geofenceService.getObservations(7);
    expect(observations.map((o) => o.observation)).toEqual(['departure', 'arrival']);
    expect(observations[0].geofence_kind).toBe('destination');
  });
});

describe('delivery ETA refresh', () => {
  const jobRow = {
    id: 7,
    destination_lat: '40.712800',
    destination_lng: '-74.006000',
    duration_minutes: 30,
  };
  const assignmentRow = { id: 3, device_id: 9, driver_user_id: null, vehicle_id: null, source_policy: 'driver_gps' };
  const freshSnapshot = (overrides = {}) => ({
    id: 1,
    delivery_job_id: 7,
    created_at: new Date(Date.now() - 10 * 1000).toISOString(),
    basis: { lastLatitude: 40.7128, lastLongitude: -74.0060 },
    ...overrides,
  });
  const nearPoint = {
    latitude: '40.712900',
    longitude: '-74.006100',
    accuracy_meters: '20',
    recorded_at: new Date().toISOString(),
    assignment_id: 3,
    source: 'driver_gps',
  };

  test('throttles a second rapid refresh when movement is under 250m', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [jobRow] })
      .mockResolvedValueOnce({ rows: [freshSnapshot()] })
      .mockResolvedValueOnce({ rows: [assignmentRow] })
      .mockResolvedValueOnce({ rows: [nearPoint] });

    const result = await etaService.refreshEta(7);

    expect(result.throttled).toBe(true);
    expect(result.movementMeters).toBeLessThanOrEqual(250);
    expect(geoRouteProvider.calculateRoute).not.toHaveBeenCalled();
    expect(insertEtaSnapshotCalls()).toHaveLength(0);
  });

  test('recomputes when forced, using the live route provider', async () => {
    geoRouteProvider.calculateRoute.mockResolvedValue({
      provider: 'test',
      distanceMeters: 1609.344,
      durationSeconds: 600,
      legs: [],
      geometry: [],
      notices: [],
    });
    const saved = { id: 2, delivery_job_id: 7, eta_at: '2026-09-28T19:10:00.000Z', source: 'live_tracking', confidence: 'high' };
    mockQuery
      .mockResolvedValueOnce({ rows: [jobRow] })
      .mockResolvedValueOnce({ rows: [freshSnapshot()] })
      .mockResolvedValueOnce({ rows: [assignmentRow] })
      .mockResolvedValueOnce({ rows: [nearPoint] })
      .mockResolvedValueOnce({ rows: [saved] }) // snapshot insert
      .mockResolvedValueOnce({ rows: [] }); // tracking event insert

    const result = await etaService.refreshEta(7, { force: true });

    expect(result).toEqual(saved);
    expect(geoRouteProvider.calculateRoute).toHaveBeenCalledWith({
      origin: [-74.0061, 40.7129],
      destination: [-74.006, 40.7128],
      travelMode: 'Car',
    });
    const snapshotCall = insertEtaSnapshotCalls()[0];
    expect(snapshotCall[1][2]).toBe('live_tracking');
    expect(snapshotCall[1][3]).toBe('high');
    const basis = JSON.parse(snapshotCall[1][4]);
    expect(basis.distanceMiles).toBeCloseTo(1, 5);
    expect(basis.durationMinutes).toBe(10);
  });

  test('falls back to the job route estimate when no live point exists', async () => {
    const saved = { id: 3, source: 'route_estimate', confidence: 'medium' };
    mockQuery
      .mockResolvedValueOnce({ rows: [jobRow] })
      .mockResolvedValueOnce({ rows: [] }) // no prior snapshot
      .mockResolvedValueOnce({ rows: [] }) // no active assignment
      .mockResolvedValueOnce({ rows: [] }) // no valid point
      .mockResolvedValueOnce({ rows: [saved] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await etaService.refreshEta(7);

    expect(result).toEqual(saved);
    expect(geoRouteProvider.calculateRoute).not.toHaveBeenCalled();
    const snapshotCall = insertEtaSnapshotCalls()[0];
    expect(snapshotCall[1][2]).toBe('route_estimate');
  });

  test('marks ETA unavailable explicitly', async () => {
    const saved = { id: 4, eta_at: null, confidence: 'unavailable' };
    mockQuery
      .mockResolvedValueOnce({ rows: [saved] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await etaService.markEtaUnavailable(7, 'provider_outage');

    expect(result).toEqual(saved);
    const snapshotCall = insertEtaSnapshotCalls()[0];
    expect(snapshotCall[0]).toMatch(/eta_at, source, confidence/);
    expect(snapshotCall[0]).toMatch(/NULL, 'live_tracking', 'unavailable'/); // eta_at NULL, inline literals
    expect(JSON.parse(snapshotCall[1][1]).reason).toBe('provider_outage');
  });
});

describe('delivery ETA freshness', () => {
  test('reports stale with unavailable confidence when data is old', async () => {
    const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, created_at: old, confidence: 'medium' }] })
      .mockResolvedValueOnce({ rows: [{ recorded_at: old }] });

    const result = await etaService.getCurrentEta(7);

    expect(result.stale).toBe(true);
    expect(result.confidence).toBe('unavailable');
  });

  test('reports fresh when snapshot and point are recent', async () => {
    const recent = new Date(Date.now() - 30 * 1000).toISOString();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, created_at: recent, eta_at: '2026-09-28T19:10:00Z', source: 'live_tracking', confidence: 'high' }] })
      .mockResolvedValueOnce({ rows: [{ recorded_at: recent }] });

    const result = await etaService.getCurrentEta(7);

    expect(result.stale).toBe(false);
    expect(result.confidence).toBe('high');
  });
});
