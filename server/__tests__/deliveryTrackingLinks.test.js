'use strict';

// The pg pool is globally mocked by __tests__/setup.js; queue query results
// with mockQuery in the exact order the service issues them.

const crypto = require('crypto');
const { mockQuery, resetMocks } = require('./setup');

const linkService = require('../services/deliveryTrackingLinkService');
const controller = require('../controllers/deliveryTrackingLinkController');

const nowIso = () => new Date().toISOString();
const futureIso = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const pastIso = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

const LINK_ROW = {
  id: 7,
  delivery_job_id: 42,
  token_prefix: 'abcdef12',
  expires_at: futureIso(),
  revoked_at: null,
  revoked_reason: null,
  use_count: 3,
  last_used_at: null,
  created_at: nowIso(),
};

const JOB_ROW = {
  id: 42,
  reference: 'DLV-2026-ABC123',
  status: 'in_transit',
  customer_user_id: 'customer-uuid-1',
  helper_user_id: 'driver-uuid-123',
  internal_driver_user_id: null,
  origin_address: '123 Main St',
  origin_city: 'Miami',
  origin_state: 'FL',
  destination_address: '456 Ocean Ave',
  destination_city: 'Miami Beach',
  destination_state: 'FL',
  notes: 'PRIVATE: gate code 9999 - never show to customers',
  created_at: nowIso(),
  assigned_at: nowIso(),
  picked_up_at: nowIso(),
  delivered_at: null,
  cancelled_at: null,
};

beforeEach(() => {
  resetMocks();
});

describe('tracking link creation', () => {
  test('stores only the token hash; returns the raw token once', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 7, token_prefix: 'placeholder', expires_at: futureIso(), created_at: nowIso() }],
    });

    const link = await linkService.createLink({
      deliveryJobId: 42,
      createdByUserId: 'customer-uuid-1',
      ttlHours: 24,
    });

    expect(link.token).toHaveLength(64);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO delivery_tracking_links/);
    // The raw token must never reach the database.
    expect(params).not.toContain(link.token);
    // Only its SHA-256 hash is persisted.
    expect(params).toContain(crypto.createHash('sha256').update(link.token, 'utf8').digest('hex'));
    // The stored prefix is the first 8 chars of the raw token, and the
    // service echoes back what the database stored via RETURNING.
    expect(params[2]).toBe(link.token.slice(0, 8));
    expect(link.prefix).toBe('placeholder'); // mocked RETURNING row
  });

  test('rejects non-positive or excessive ttlHours', async () => {
    await expect(linkService.createLink({ deliveryJobId: 42, ttlHours: 0 }))
      .rejects.toMatchObject({ code: 'tracking_link_invalid_ttl', status: 400 });
    await expect(linkService.createLink({ deliveryJobId: 42, ttlHours: 24 * 31 }))
      .rejects.toMatchObject({ code: 'tracking_link_invalid_ttl', status: 400 });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('resolveToken', () => {
  test('valid token resolves and increments usage', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [LINK_ROW] }) // lookup
      .mockResolvedValueOnce({ rows: [] }); // usage increment

    const { link, deliveryJobId } = await linkService.resolveToken('a'.repeat(64));
    expect(deliveryJobId).toBe(42);
    expect(link.id).toBe(7);

    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toMatch(/UPDATE delivery_tracking_links/);
    expect(updateSql).toMatch(/use_count = use_count \+ 1/);
    expect(updateParams).toEqual([7]);
  });

  test('unknown token throws tracking_link_invalid (404)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(linkService.resolveToken('b'.repeat(64)))
      .rejects.toMatchObject({ code: 'tracking_link_invalid', status: 404 });
  });

  test('expired token throws tracking_link_expired (410)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...LINK_ROW, expires_at: pastIso() }] });
    await expect(linkService.resolveToken('c'.repeat(64)))
      .rejects.toMatchObject({ code: 'tracking_link_expired', status: 410 });
  });

  test('revoked token throws tracking_link_revoked (410)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...LINK_ROW, revoked_at: nowIso() }] });
    await expect(linkService.resolveToken('d'.repeat(64)))
      .rejects.toMatchObject({ code: 'tracking_link_revoked', status: 410 });
  });
});

describe('revokeLink and refreshLink', () => {
  test('revoke marks the link revoked for the job', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...LINK_ROW, revoked_at: nowIso(), revoked_reason: 'customer request' }] });
    const revoked = await linkService.revokeLink({ linkId: 7, deliveryJobId: 42, reason: 'customer request' });
    expect(revoked.revoked_reason).toBe('customer request');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/revoked_at = NOW/);
    expect(params.slice(0, 2)).toEqual([7, 42]);
  });

  test('refresh revokes the old link and issues a new raw token', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...LINK_ROW, revoked_at: nowIso(), revoked_reason: 'refreshed' }] })
      .mockResolvedValueOnce({ rows: [{ id: 8, token_prefix: 'placeholder', expires_at: futureIso(), created_at: nowIso() }] });

    const { link, revoked } = await linkService.refreshLink({
      linkId: 7,
      deliveryJobId: 42,
      createdByUserId: 'customer-uuid-1',
    });

    expect(revoked).toEqual({ id: 7, prefix: 'abcdef12' });
    expect(link.id).toBe(8);
    expect(link.token).toHaveLength(64);
  });
});

describe('expireCompletedLinks', () => {
  test('clamps link expiry to 24h after terminal job end', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }, { id: 9 }] });
    const result = await linkService.expireCompletedLinks();
    expect(result).toEqual({ expired: 2 });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/job_end \+ INTERVAL '24 hours'/);
    expect(sql).toMatch(/status IN \('delivered', 'cancelled', 'returned'\)/);
  });
});

describe('listLinks', () => {
  test('returns metadata only, never hashes', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [LINK_ROW] });
    const links = await linkService.listLinks(42);
    expect(links).toHaveLength(1);
    const serialized = JSON.stringify(links[0]);
    expect(serialized).not.toContain('token_hash');
    expect(serialized).toContain('abcdef12');
  });
});

describe('customer-safe projection', () => {
  const eta = {
    stale: false,
    snapshot: { eta_at: futureIso(), source: 'live_tracking', confidence: 'high' },
    etaAt: futureIso(),
    source: 'live_tracking',
    confidence: 'high',
    lastPointAt: nowIso(),
  };
  const observations = [
    { observation: 'departure', geofence_kind: 'pickup', observed_at: nowIso() },
  ];
  const scans = [{ scan_type: 'pickup', scanned_at: nowIso() }];
  const latestPoint = { latitude: '40.712776', longitude: '-74.005974', recorded_at: nowIso() };

  test('approximates location and never leaks exact data', () => {
    const state = linkService.buildCustomerTrackingState({
      job: JOB_ROW,
      eta,
      observations,
      scans,
      latestPoint,
    });

    // Approximate area only: 2-decimal rounding (~1.1km) + 500m radius.
    expect(state.approximateArea).toEqual({
      approxLat: 40.71,
      approxLng: -74.01,
      accuracyRadiusMeters: 500,
    });

    const serialized = JSON.stringify(state);
    // No exact 6-decimal coordinates anywhere in the payload.
    expect(serialized).not.toMatch(/\d{2,3}\.\d{4,}/);
    // No driver identity, no tracker/source fields, no private notes.
    expect(serialized).not.toContain('driver-uuid-123');
    expect(serialized).not.toMatch(/"source"\s*:/);
    expect(serialized).not.toContain('gate code 9999');
    expect(state).not.toHaveProperty('notes');
    expect(state).not.toHaveProperty('helper_user_id');
    expect(state).not.toHaveProperty('internal_driver_user_id');
  });

  test('masks street numbers from addresses', () => {
    const state = linkService.buildCustomerTrackingState({
      job: JOB_ROW, eta, observations, scans, latestPoint,
    });
    expect(state.maskedPickup).toBe('Main St, Miami, FL');
    expect(state.maskedDropoff).toBe('Ocean Ave, Miami Beach, FL');
    expect(state.maskedPickup).not.toContain('123');
  });

  test('derives milestones from status, scans, and geofence observations', () => {
    const state = linkService.buildCustomerTrackingState({
      job: JOB_ROW, eta, observations, scans, latestPoint,
    });
    const byKey = Object.fromEntries(state.milestones.map((m) => [m.key, m]));
    expect(byKey.placed.reached).toBe(true);
    expect(byKey.assigned.reached).toBe(true);
    expect(byKey.picked_up.reached).toBe(true); // pickup scan
    expect(byKey.in_transit.reached).toBe(true);
    expect(byKey.approaching.reached).toBe(false); // no destination arrival yet
    expect(byKey.delivered.reached).toBe(false);
    expect(state.statusLabel).toBe('On the way');
  });

  test('null approximateArea when there is no valid point', () => {
    const state = linkService.buildCustomerTrackingState({
      job: JOB_ROW, eta, observations, scans, latestPoint: null,
    });
    expect(state.approximateArea).toBeNull();
  });

  test('stale ETA reports at:null with stale freshness', () => {
    const state = linkService.buildCustomerTrackingState({
      job: JOB_ROW,
      eta: { stale: true, confidence: 'unavailable', snapshot: null },
      observations,
      scans,
      latestPoint,
    });
    expect(state.eta).toEqual({ at: null, freshness: 'stale' });
  });
});

describe('public tracking endpoint', () => {
  function mockRes() {
    return { status: jest.fn().mockReturnThis(), json: jest.fn() };
  }

  function queueFullStateQueries() {
    mockQuery
      .mockResolvedValueOnce({ rows: [LINK_ROW] }) // token lookup
      .mockResolvedValueOnce({ rows: [] }) // usage increment
      .mockResolvedValueOnce({ rows: [JOB_ROW] }) // job
      .mockResolvedValueOnce({ rows: [{ id: 1, eta_at: futureIso(), source: 'live_tracking', confidence: 'high', created_at: nowIso() }] }) // eta snapshot
      .mockResolvedValueOnce({ rows: [{ latitude: '40.712776', longitude: '-74.005974', recorded_at: nowIso() }] }) // eta point
      .mockResolvedValueOnce({ rows: [] }) // geofence observations
      .mockResolvedValueOnce({ rows: [] }) // scans
      .mockResolvedValueOnce({ rows: [{ latitude: '40.712776', longitude: '-74.005974', recorded_at: nowIso() }] }); // latest point
  }

  test('returns only the allowlisted public shape', async () => {
    queueFullStateQueries();
    const req = { params: { token: 'a'.repeat(64) } };
    const res = mockRes();
    const next = jest.fn();

    await controller.publicTrack(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual([
      'approximateArea',
      'eta',
      'maskedDropoff',
      'maskedPickup',
      'milestones',
      'reference',
      'status',
      'supportContact',
    ]);
    expect(Object.keys(body.eta).sort()).toEqual(['at', 'freshness']);
    expect(body.reference).toBe('DLV-2026-ABC123');
    expect(body.status).toBe('On the way');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/\d{2,3}\.\d{4,}/);
    expect(serialized).not.toContain('driver-uuid-123');
  });

  test('invalid token returns a generic 404 that does not leak link codes', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no link
    const req = { params: { token: 'z'.repeat(64) } };
    const res = mockRes();
    const next = jest.fn();

    await controller.publicTrack(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({ error: 'Not found', code: 'not_found', status: 404 });
    expect(JSON.stringify(body)).not.toContain('tracking_link');
    expect(next).not.toHaveBeenCalled();
  });

  test('expired token returns 404 (unified with invalid to prevent oracle)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...LINK_ROW, expires_at: pastIso() }] });
    const req = { params: { token: 'e'.repeat(64) } };
    const res = mockRes();
    const next = jest.fn();

    await controller.publicTrack(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found', code: 'not_found', status: 404 });
    expect(next).not.toHaveBeenCalled();
  });
});
