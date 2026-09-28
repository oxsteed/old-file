'use strict';

/**
 * telematicsAdapters.test.js
 *
 * Covers the provider-neutral telematics adapter layer:
 *   - adapterRegistry: all four adapters resolve; unknown providers throw
 *   - adapterContract.validateAdapter: every adapter implements the contract
 *   - webhook signature verification round-trips (default HMAC + Samsara scheme)
 *   - normalizeLocationPayload maps each provider's documented payload shape
 *     to the normalized contract shape
 *   - fetchIncrementalUpdates throws PROVIDER_NOT_CONFIGURED without a
 *     credential reference and performs no network I/O with one
 *   - telematicsConnectionService manages delivery_telematics_connections rows
 *     (mocked pg pool; only credential/secret *references* are persisted)
 */

const crypto = require('crypto');
const { mockQuery, resetMocks } = require('./setup');

const {
  validateAdapter,
  verifyWebhookSignature,
  ProviderNotConfiguredError,
} = require('../services/telematics/adapterContract');
const { getAdapter, SUPPORTED_PROVIDERS } = require('../services/telematics/adapterRegistry');
const geotab = require('../services/telematics/geotabAdapter');
const samsara = require('../services/telematics/samsaraAdapter');
const motive = require('../services/telematics/motiveAdapter');
const verizon = require('../services/telematics/verizonConnectAdapter');
const connectionService = require('../services/telematicsConnectionService');

const ALL_ADAPTERS = { geotab, samsara, motive, verizon };

beforeEach(() => {
  resetMocks();
});

describe('adapterRegistry', () => {
  test('lists exactly the four supported providers', () => {
    expect([...SUPPORTED_PROVIDERS].sort()).toEqual(
      ['geotab', 'motive', 'samsara', 'verizon_connect']
    );
  });

  test('returns the matching adapter for every supported provider', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      const adapter = getAdapter(provider);
      expect(adapter.providerName).toBe(provider);
    }
  });

  test('throws on unknown providers', () => {
    expect(() => getAdapter('acme_telematics')).toThrow(/Unknown telematics provider/);
    expect(() => getAdapter('')).toThrow(/Unknown telematics provider/);
    expect(() => getAdapter(undefined)).toThrow(/Unknown telematics provider/);
  });
});

describe('adapterContract.validateAdapter', () => {
  test.each(Object.entries(ALL_ADAPTERS))('%s implements the full contract', (_name, adapter) => {
    expect(validateAdapter(adapter)).toBe(true);
  });

  test('rejects adapters with missing members', () => {
    expect(() => validateAdapter({ providerName: 'broken' })).toThrow(/normalizeLocationPayload/);
    expect(() => validateAdapter(null)).toThrow(/must be an object/);
  });
});

describe('verifyWebhookSignature (contract default: HMAC-SHA256)', () => {
  const rawBody = JSON.stringify({ eventId: 'e-1', lat: 37.7 });
  const secret = 'webhook-secret-abc';

  function sign(body, key) {
    return crypto.createHmac('sha256', key).update(body, 'utf8').digest('hex');
  }

  test('round-trips a signed payload', () => {
    const signature = sign(rawBody, secret);
    expect(verifyWebhookSignature({ rawBody, signature, secret })).toBe(true);
  });

  test('rejects tampered bodies and wrong secrets', () => {
    const signature = sign(rawBody, secret);
    expect(verifyWebhookSignature({ rawBody: `${rawBody} `, signature, secret })).toBe(false);
    expect(verifyWebhookSignature({ rawBody, signature, secret: 'other' })).toBe(false);
  });

  test('fails closed on missing inputs', () => {
    expect(verifyWebhookSignature({})).toBe(false);
    expect(verifyWebhookSignature({ rawBody, signature: sign(rawBody, secret) })).toBe(false);
  });
});

describe('samsara webhook signature (v1:<timestamp>:<body>, base64 secret)', () => {
  const rawBody = JSON.stringify({ eventId: 'e-1', eventMs: 1, eventType: 'Ping', event: { text: 'Ping' } });
  const secretB64 = Buffer.from('samsara-test-secret-key-1234567890').toString('base64');
  const timestamp = '1587597109';

  function samsaraSign(body, ts, secretBase64) {
    const key = Buffer.from(secretBase64, 'base64');
    return `v1=${crypto.createHmac('sha256', key).update(`v1:${ts}:${body}`, 'utf8').digest('hex')}`;
  }

  test('round-trips the documented Samsara scheme', () => {
    const signature = samsaraSign(rawBody, timestamp, secretB64);
    expect(samsara.verifyWebhookSignature({ rawBody, signature, secret: secretB64, timestamp })).toBe(true);
  });

  test('rejects tampered bodies and missing timestamps', () => {
    const signature = samsaraSign(rawBody, timestamp, secretB64);
    expect(samsara.verifyWebhookSignature({
      rawBody: rawBody.replace('Ping', 'Pong'), signature, secret: secretB64, timestamp,
    })).toBe(false);
    expect(samsara.verifyWebhookSignature({ rawBody, signature, secret: secretB64 })).toBe(false);
  });
});

describe('normalizeLocationPayload', () => {
  test('geotab DeviceStatusInfo maps to the normalized shape', () => {
    const point = geotab.normalizeLocationPayload({
      device: { id: 'b123' },
      dateTime: '2026-09-28T20:00:00.000Z',
      latitude: 40.7128,
      longitude: -74.006,
      speed: 72,
      bearing: 180,
      isDriving: true,
    });
    expect(point).toMatchObject({
      vehicleExternalId: 'b123',
      latitude: 40.7128,
      longitude: -74.006,
      headingDegrees: 180,
      ignitionOn: true,
      recordedAt: '2026-09-28T20:00:00.000Z',
    });
    expect(point.speedMps).toBeCloseTo(20, 5);
  });

  test('samsara VehicleLocationUpdate maps to the normalized shape', () => {
    const point = samsara.normalizeLocationPayload({
      eventId: 'ev-1',
      eventMs: 1719845724000,
      eventType: 'VehicleLocationUpdate',
      orgId: 42,
      data: {
        vehicle: { id: '281474982394001', name: 'Truck 7' },
        gps: {
          latitude: 37.7749,
          longitude: -122.4194,
          timeMs: 1719845724000,
          headingDegrees: 90,
          speedMilesPerHour: 45,
        },
      },
    });
    expect(point).toMatchObject({
      vehicleExternalId: '281474982394001',
      latitude: 37.7749,
      longitude: -122.4194,
      headingDegrees: 90,
      providerEventId: 'ev-1',
    });
    expect(point.speedMps).toBeCloseTo(45 * 0.44704, 5);
    expect(point.recordedAt).toBe(new Date(1719845724000).toISOString());
  });

  test('motive vehicle_location_updated maps to the normalized shape', () => {
    const point = motive.normalizeLocationPayload({
      action: 'vehicle_location_updated',
      trigger: 'updated',
      id: '5d3d5cf6-501f-4566-ad07-a80c05c743a7',
      vehicle_id: 123,
      vehicle_number: 'V-9',
      located_at: '2026-09-28T20:00:00Z',
      lat: 34.0522,
      lon: -118.2437,
      bearing: 270,
      speed: 60,
    });
    expect(point).toMatchObject({
      vehicleExternalId: '123',
      latitude: 34.0522,
      longitude: -118.2437,
      headingDegrees: 270,
      providerEventId: '5d3d5cf6-501f-4566-ad07-a80c05c743a7',
      recordedAt: '2026-09-28T20:00:00.000Z',
    });
    expect(point.speedMps).toBeCloseTo(60 * 0.44704, 5);
  });

  test('verizon_connect position event maps to the normalized shape', () => {
    const point = verizon.normalizeLocationPayload({
      eventId: 'e-9',
      vehicleId: 'veh-77',
      latitude: 41.8781,
      longitude: -87.6298,
      speed: 55,
      heading: 45,
      ignitionOn: true,
      timestamp: '2026-09-28T20:00:00.000Z',
    });
    expect(point).toMatchObject({
      vehicleExternalId: 'veh-77',
      latitude: 41.8781,
      longitude: -87.6298,
      headingDegrees: 45,
      ignitionOn: true,
      providerEventId: 'e-9',
      recordedAt: '2026-09-28T20:00:00.000Z',
    });
    expect(point.speedMps).toBeCloseTo(55 * 0.44704, 5);
  });

  test.each(Object.entries(ALL_ADAPTERS))('%s returns null for unparseable payloads', (_name, adapter) => {
    expect(adapter.normalizeLocationPayload(null)).toBeNull();
    expect(adapter.normalizeLocationPayload({})).toBeNull();
    expect(adapter.normalizeLocationPayload({ latitude: 999, longitude: 10 })).toBeNull();
  });

  test.each(Object.entries(ALL_ADAPTERS))('%s parseVehicleIdentity returns null without identity', (_name, adapter) => {
    expect(adapter.parseVehicleIdentity(null)).toBeNull();
    expect(adapter.parseVehicleIdentity({})).toBeNull();
  });
});

describe('normalizeStatusPayload', () => {
  test('geotab isDriving infers stopped state', () => {
    const status = geotab.normalizeStatusPayload({
      device: { id: 'b123' },
      dateTime: '2026-09-28T20:00:00.000Z',
      isDriving: false,
    });
    expect(status).toMatchObject({
      vehicleExternalId: 'b123',
      ignitionOn: false,
      stopped: true,
    });
  });

  test('samsara engine-off alert maps to ignitionOn false', () => {
    const status = samsara.normalizeStatusPayload({
      eventId: 'ev-2',
      eventMs: 1719845724000,
      eventType: 'Alert',
      event: {
        alertConditionId: 'DeviceEngineOff',
        device: { id: 212014918732717 },
        startMs: 1719845724000,
      },
    });
    expect(status).toMatchObject({
      vehicleExternalId: '212014918732717',
      ignitionOn: false,
      providerEventId: 'ev-2',
    });
  });

  test.each(Object.entries(ALL_ADAPTERS))('%s returns null when no status signal exists', (_name, adapter) => {
    expect(adapter.normalizeStatusPayload(null)).toBeNull();
    expect(adapter.normalizeStatusPayload({})).toBeNull();
  });
});

describe('fetchIncrementalUpdates', () => {
  test.each(Object.entries(ALL_ADAPTERS))(
    '%s throws PROVIDER_NOT_CONFIGURED without a credential reference',
    async (_name, adapter) => {
      await expect(adapter.fetchIncrementalUpdates({})).rejects.toMatchObject({
        code: 'PROVIDER_NOT_CONFIGURED',
      });
      await expect(adapter.fetchIncrementalUpdates({})).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    }
  );

  test.each(Object.entries(ALL_ADAPTERS))(
    '%s returns an unexecuted request shape with a credential reference (no fake data, no network)',
    async (_name, adapter) => {
      const result = await adapter.fetchIncrementalUpdates({
        credentialRef: 'vault://telematics/test',
        cursor: 'cursor-1',
        vehicleExternalId: 'veh-1',
      });
      expect(result.points).toEqual([]);
      expect(result.executed).toBe(false);
      expect(result.request).toMatchObject({ method: expect.any(String), url: expect.any(String) });
    }
  );
});

describe('telematicsConnectionService', () => {
  const dbRow = {
    id: 1,
    provider: 'samsara',
    vehicle_id: 9,
    status: 'active',
    cursor: null,
    webhook_subscription_id: 'sub-1',
    webhook_secret_ref: 'vault://telematics/samsara/webhook-secret',
    credential_ref: 'vault://telematics/samsara/api-token',
    last_sync_at: null,
    last_error: null,
    error_count: 0,
    sync_state: {},
    created_at: '2026-09-28T20:00:00.000Z',
    updated_at: '2026-09-28T20:00:00.000Z',
  };

  test('connect inserts a row holding only credential/secret references', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [dbRow] });
    const row = await connectionService.connect({
      provider: 'samsara',
      vehicleId: 9,
      credentialRef: 'vault://telematics/samsara/api-token',
      webhookSecretRef: 'vault://telematics/samsara/webhook-secret',
    });
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('INSERT INTO delivery_telematics_connections');
    expect(row).toMatchObject({
      id: 1,
      provider: 'samsara',
      vehicleId: 9,
      status: 'active',
      credentialRef: 'vault://telematics/samsara/api-token',
      webhookSecretRef: 'vault://telematics/samsara/webhook-secret',
    });
    expect(row).not.toHaveProperty('webhookSecret');
    expect(row).not.toHaveProperty('credential');
  });

  test('connect rejects unknown providers before touching the database', async () => {
    await expect(connectionService.connect({ provider: 'nope' })).rejects.toThrow(
      /Unknown telematics provider/
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('updateCursor persists the provider cursor', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...dbRow, cursor: 'toVersion-42' }] });
    const row = await connectionService.updateCursor(1, 'toVersion-42');
    expect(mockQuery.mock.calls[0][0]).toContain('SET cursor = $2');
    expect(row.cursor).toBe('toVersion-42');
  });

  test('recordSyncError increments the error counter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...dbRow, error_count: 3, last_error: 'timeout' }] });
    const row = await connectionService.recordSyncError(1, new Error('timeout'));
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('error_count = error_count + 1');
    expect(sql).toContain("THEN 'error'");
    expect(row.errorCount).toBe(3);
    expect(row.lastError).toBe('timeout');
  });

  test('recordSyncSuccess clears errors and re-activates error-flagged rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...dbRow, status: 'active', error_count: 0 }] });
    const row = await connectionService.recordSyncSuccess(1);
    expect(mockQuery.mock.calls[0][0]).toContain('error_count = 0');
    expect(row.errorCount).toBe(0);
    expect(row.lastError).toBeNull();
  });

  test('pause and resume transition status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...dbRow, status: 'paused' }] });
    expect((await connectionService.pause(1)).status).toBe('paused');
    mockQuery.mockResolvedValueOnce({ rows: [{ ...dbRow, status: 'active' }] });
    expect((await connectionService.resume(1)).status).toBe('active');
  });

  test('getActiveForVehicle returns only active connections', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [dbRow] });
    const rows = await connectionService.getActiveForVehicle(9);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain("status = 'active'");
    expect(rows).toHaveLength(1);
    expect(rows[0].vehicleId).toBe(9);
  });
});
