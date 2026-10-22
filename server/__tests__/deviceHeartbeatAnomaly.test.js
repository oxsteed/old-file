'use strict';

/**
 * Device bearer-token anomaly logging (auth-audit finding 34).
 *
 * Device tokens are not bound to any client property. The heartbeat now
 * records the observed IP hash / platform and logs a warning when either
 * changes mid-token-life (the tell of an exfiltrated token). Detection
 * only: a change never blocks the heartbeat.
 */

const { mockQuery, resetMocks } = require('./setup');
const crypto = require('crypto');

jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));
const logger = require('../utils/logger');
const { hashIP } = require('../utils/encryption');

const controller = require('../controllers/restaurantAppFlowController');

const TOKEN = 'device-token-abc';
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex');

function deviceRow(overrides = {}) {
  return {
    id: 11,
    restaurant_id: 42,
    app_key: 'kitchen',
    status: 'paired',
    device_token_hash: TOKEN_HASH,
    device_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
    last_seen_ip_hash: null,
    last_seen_platform: null,
    ...overrides,
  };
}

function heartbeatReq({ ip = '10.0.0.1', platform = 'android' } = {}) {
  return {
    params: { restaurantId: '42', deviceId: '11' },
    body: { platform },
    headers: { 'x-device-token': TOKEN },
    get: (name) => (name.toLowerCase() === 'x-device-token' ? TOKEN : undefined),
    ip,
  };
}

function heartbeatRes() {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  return res;
}

async function invoke(req) {
  const res = heartbeatRes();
  let thrown = null;
  await controller.deviceHeartbeat(req, res, (err) => { thrown = err; });
  if (thrown) throw thrown;
  return res;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('finding 34: heartbeat anomaly logging', () => {
  test('first heartbeat records identity with no anomaly warning', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [deviceRow()] }) // requireDeviceCredential
      .mockResolvedValueOnce({ rows: [deviceRow()] }); // heartbeat UPDATE
    const res = await invoke(heartbeatReq({ ip: '10.0.0.1' }));
    expect(res.statusCode).toBe(200);
    expect(logger.warn).not.toHaveBeenCalledWith('device_token_ip_anomaly', expect.anything());
    // The UPDATE persists the observed ip hash.
    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toContain('last_seen_ip_hash = $9');
    expect(updateCall[1][8]).toBe(hashIP('10.0.0.1'));
  });

  test('same IP and platform: no warning', async () => {
    const seen = deviceRow({ last_seen_ip_hash: hashIP('10.0.0.1'), last_seen_platform: 'android' });
    mockQuery
      .mockResolvedValueOnce({ rows: [seen] })
      .mockResolvedValueOnce({ rows: [seen] });
    await invoke(heartbeatReq({ ip: '10.0.0.1', platform: 'android' }));
    expect(logger.warn).not.toHaveBeenCalledWith('device_token_ip_anomaly', expect.anything());
    expect(logger.warn).not.toHaveBeenCalledWith('device_token_platform_anomaly', expect.anything());
  });

  test('IP hash change mid-token-life logs an anomaly', async () => {
    const seen = deviceRow({ last_seen_ip_hash: hashIP('10.0.0.1'), last_seen_platform: 'android' });
    mockQuery
      .mockResolvedValueOnce({ rows: [seen] })
      .mockResolvedValueOnce({ rows: [seen] });
    await invoke(heartbeatReq({ ip: '203.0.113.9', platform: 'android' }));
    expect(logger.warn).toHaveBeenCalledWith(
      'device_token_ip_anomaly',
      expect.objectContaining({ deviceId: 11, restaurantId: 42 })
    );
  });

  test('platform change mid-token-life logs an anomaly', async () => {
    const seen = deviceRow({ last_seen_ip_hash: hashIP('10.0.0.1'), last_seen_platform: 'android' });
    mockQuery
      .mockResolvedValueOnce({ rows: [seen] })
      .mockResolvedValueOnce({ rows: [seen] });
    await invoke(heartbeatReq({ ip: '10.0.0.1', platform: 'linux-printer-bridge' }));
    expect(logger.warn).toHaveBeenCalledWith(
      'device_token_platform_anomaly',
      expect.objectContaining({ deviceId: 11, restaurantId: 42 })
    );
  });

  test('anomaly never blocks the heartbeat', async () => {
    const seen = deviceRow({ last_seen_ip_hash: hashIP('10.0.0.1') });
    mockQuery
      .mockResolvedValueOnce({ rows: [seen] })
      .mockResolvedValueOnce({ rows: [seen] });
    const res = await invoke(heartbeatReq({ ip: '203.0.113.9' }));
    expect(res.statusCode).toBe(200);
    expect(res.body.device).toBeTruthy();
  });
});
