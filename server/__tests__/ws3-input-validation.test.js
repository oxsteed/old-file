'use strict';

/**
 * server/__tests__/ws3-input-validation.test.js
 *
 * Regression tests for the WS3 audit remediation batch:
 *  M5 — sanitizeObject drops __proto__/constructor/prototype keys
 *        (prototype-pollution guard in server/middleware/sanitize.js)
 *  L5 — complianceAuditLogger day windows are bound parameters, never
 *        interpolated into SQL text
 *  M6 — business webhook SSRF safety:
 *        server/utils/webhookUrlSafety.js + registration-time and
 *        delivery-time enforcement
 *
 * Unit-style: DB (../db) and dns are mocked; no live network.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('dns', () => ({
  promises: { lookup: jest.fn() },
}));

jest.mock('../services/paymentQueue', () => ({
  QUEUES: {},
  listDeadLetterJobs: jest.fn(),
  requeueDeadLetterJob: jest.fn(),
}));

jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

const dns = require('dns');
const sanitizeInputs = require('../middleware/sanitize');
const { sanitizeObject } = sanitizeInputs;
const ComplianceAuditLogger = require('../services/complianceAuditLogger');
const {
  isPublicIp,
  assertPublicWebhookTarget,
} = require('../utils/webhookUrlSafety');
const opsActions = require('../controllers/opsActionsController');
const { createWebhook } = require('../controllers/businessIntegrationsController');

const originalFetch = global.fetch;

function responseDouble() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  resetMocks();
  dns.promises.lookup.mockReset();
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ── M5: prototype-pollution guard ────────────────────────────────────────────

describe('M5 sanitizeObject prototype-pollution guard', () => {
  test('drops __proto__ key and does not pollute Object.prototype', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"name":"<b>x</b>"}');
    const out = sanitizeObject(input);
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(false);
    expect(out.name).toBe('x');
  });

  test('drops __proto__ at nested depths', () => {
    const input = { nested: JSON.parse('{"__proto__":{"polluted":true}}') };
    const out = sanitizeObject(input);
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(out.nested, '__proto__')).toBe(false);
  });

  test('drops constructor and prototype keys, keeps legitimate data', () => {
    const input = JSON.parse(
      '{"constructor":{"x":1},"prototype":{"y":2},"legit":"<i>ok</i>"}'
    );
    const out = sanitizeObject(input);
    expect(Object.prototype.hasOwnProperty.call(out, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'prototype')).toBe(false);
    expect(out.legit).toBe('ok');
  });

  test('middleware strips __proto__ from req.body without pollution', () => {
    const req = {
      body: JSON.parse('{"__proto__":{"polluted":true},"q":"<b>hi</b>"}'),
      query: {},
      params: {},
    };
    const next = jest.fn();
    sanitizeInputs(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
    expect(req.body.q).toBe('hi');
  });
});

// ── L5: day-window parameterization ──────────────────────────────────────────

describe('L5 complianceAuditLogger day-window parameterization', () => {
  test('getEventsByAction binds days as a parameter, not string interpolation', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await ComplianceAuditLogger.getEventsByAction('login', 7);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("$2 * INTERVAL '1 day'");
    expect(sql).not.toContain('7 days');
    expect(params).toEqual(['login', 7]);
  });

  test('getFailuresByUser binds days as a parameter, not string interpolation', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await ComplianceAuditLogger.getFailuresByUser('user-1', 30);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("$2 * INTERVAL '1 day'");
    expect(sql).not.toContain('30 days');
    expect(params).toEqual(['user-1', 30]);
  });

  test('injection-shaped days value is coerced to the default, never interpolated', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await ComplianceAuditLogger.getEventsByAction('login', '7) OR 1=1 --');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('OR 1=1');
    expect(params).toEqual(['login', 7]);
  });

  test('garbage days falls back to defaults; negatives clamp to 0; floats floor', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await ComplianceAuditLogger.getFailuresByUser('user-1', 'garbage');
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-1', 30]);

    await ComplianceAuditLogger.getEventsByAction('login', -5);
    expect(mockQuery.mock.calls[1][1]).toEqual(['login', 0]);

    await ComplianceAuditLogger.getEventsByAction('login', 2.9);
    expect(mockQuery.mock.calls[2][1]).toEqual(['login', 2]);

    await ComplianceAuditLogger.getEventsByAction('login', Infinity);
    expect(mockQuery.mock.calls[3][1]).toEqual(['login', 7]);
  });
});

// ── M6: webhook SSRF safety ──────────────────────────────────────────────────

describe('M6 isPublicIp', () => {
  test.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '2606:2800:220:1:248:1893:25c8:1946',
    '2001:4860:4860::8888',
  ])('accepts public address %s', (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });

  test.each([
    '10.0.0.1',
    '172.16.5.4',
    '172.31.255.255',
    '192.168.1.1',
    '127.0.0.1',
    '127.53.0.1',
    '169.254.169.254', // cloud metadata
    '224.0.0.1',
    '0.0.0.0',
    '240.0.0.1',
    '192.0.2.1',
    '198.51.100.7',
    '203.0.113.9',
    '100.64.0.1', // CGNAT
    '198.18.0.1', // benchmarking
    '::1',
    '::',
    'fe80::1',
    'ff02::1',
    '2001:db8::1', // documentation
    'fc00::1', // unique local
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:10.0.0.1', // IPv4-mapped private
    'not-an-ip',
    '',
  ])('denies non-public address %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  test('unwraps IPv4-mapped public address as public', () => {
    expect(isPublicIp('::ffff:8.8.8.8')).toBe(true);
  });
});

describe('M6 assertPublicWebhookTarget', () => {
  test('accepts https URL whose IPs are all public', async () => {
    dns.promises.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    const result = await assertPublicWebhookTarget('https://hooks.example.com/deliver');
    expect(result.ok).toBe(true);
    expect(result.ips).toEqual(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']);
  });

  test('rejects non-https scheme without resolving DNS', async () => {
    const result = await assertPublicWebhookTarget('http://hooks.example.com/deliver');
    expect(result).toEqual({ ok: false, reason: 'https_required' });
    expect(dns.promises.lookup).not.toHaveBeenCalled();
  });

  test('rejects when any resolved IP is non-public', async () => {
    dns.promises.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    const result = await assertPublicWebhookTarget('https://hooks.example.com/deliver');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('non_public_ip');
    expect(result.ip).toBe('10.0.0.5');
  });

  test('rejects literal-IP hostnames pointing at loopback', async () => {
    dns.promises.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const result = await assertPublicWebhookTarget('https://127.0.0.1/hook');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('non_public_ip');
  });

  test('fails closed when DNS resolution fails', async () => {
    dns.promises.lookup.mockRejectedValue(new Error('ENOTFOUND'));
    const result = await assertPublicWebhookTarget('https://hooks.example.com/deliver');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('dns_resolution_failed');
  });

  test('rejects malformed URLs', async () => {
    const result = await assertPublicWebhookTarget('not a url');
    expect(result).toEqual({ ok: false, reason: 'invalid_url' });
  });
});

describe('M6 createWebhook registration-time enforcement', () => {
  function reqDouble(url) {
    return {
      params: { businessId: '12' },
      body: { url, events: ['order.created'] },
      user: { id: 'user-123' },
    };
  }

  test('returns 400 webhook_url_not_public for internal targets', async () => {
    dns.promises.lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const res = responseDouble();
    await createWebhook(reqDouble('https://169.254.169.254/hook'), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'webhook_url_not_public' })
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('stores pinned_ip from the first resolved address on success', async () => {
    dns.promises.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockQuery.mockResolvedValue({
      rows: [{ id: 'w-1', url: 'https://hooks.example.com/hook', events: ['order.created'], is_active: true }],
    });
    const res = responseDouble();
    await createWebhook(reqDouble('https://hooks.example.com/hook'), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(201);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('pinned_ip');
    expect(params).toContain('93.184.216.34');
  });
});

describe('M6 attemptWebhookRedelivery delivery-time enforcement', () => {
  const deliveryRow = {
    id: 'd-1',
    webhook_id: 'w-1',
    event_type: 'order.created',
    payload: { orderId: 7 },
    attempt_number: 0,
  };
  const webhookRow = {
    webhook_url: 'https://hooks.example.com/hook',
    custom_headers: {},
    timeout_seconds: 10,
    pinned_ip: '93.184.216.34',
  };

  test('records a failed attempt without fetching when the target is not public', async () => {
    dns.promises.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    mockQuery.mockResolvedValue({
      rows: [{ ...deliveryRow, attempt_number: 1, error_message: 'blocked' }],
    });
    await opsActions.attemptWebhookRedelivery(deliveryRow, webhookRow);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('attempt_number');
    expect(params[1]).toBe(1); // attempt_number incremented
    expect(params[4]).toContain('blocked by safety check');
  });

  test('fetches with redirect manual and succeeds on 2xx for public targets', async () => {
    dns.promises.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    global.fetch.mockResolvedValue({ status: 200, text: async () => 'ok' });
    mockQuery.mockResolvedValue({ rows: [{ ...deliveryRow, completed_at: '2026-09-30T00:00:00Z' }] });
    const updated = await opsActions.attemptWebhookRedelivery(deliveryRow, webhookRow);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://hooks.example.com/hook',
      expect.objectContaining({ method: 'POST', redirect: 'manual' })
    );
    expect(updated.completed_at).toBe('2026-09-30T00:00:00Z');
  });

  test('treats 3xx as a failed attempt (no redirect following)', async () => {
    dns.promises.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    global.fetch.mockResolvedValue({ status: 302, text: async () => '' });
    mockQuery.mockResolvedValue({
      rows: [{ ...deliveryRow, attempt_number: 1, error_message: 'HTTP 302' }],
    });
    await opsActions.attemptWebhookRedelivery(deliveryRow, webhookRow);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('attempt_number');
    expect(params[1]).toBe(1);
    expect(params[2]).toBe(302);
  });

  test('proceeds on DNS change vs pinned_ip but does not block', async () => {
    dns.promises.lookup.mockResolvedValue([{ address: '93.184.216.35', family: 4 }]);
    global.fetch.mockResolvedValue({ status: 200, text: async () => 'ok' });
    mockQuery.mockResolvedValue({ rows: [{ ...deliveryRow, completed_at: '2026-09-30T00:00:00Z' }] });
    const updated = await opsActions.attemptWebhookRedelivery(deliveryRow, webhookRow);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(updated.completed_at).toBe('2026-09-30T00:00:00Z');
  });
});
