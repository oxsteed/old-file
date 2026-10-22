'use strict';

/**
 * API key hygiene (auth-audit findings 29 and 37).
 *
 * Finding 29: the product monthly quota (api_products.max_requests_per_month)
 * was selected and attached to req.apiKey but never enforced. The effective
 * limit is now the LEAST of the product quota and the key's own usage_limit.
 *
 * Finding 37: API keys are accepted from headers only. The ?api_key= query
 * parameter is no longer honored (keys leak into logs/history/referers),
 * and invalid-key attempts no longer log the key prefix.
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');

jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));
const logger = require('../utils/logger');

const { validateApiKey } = require('../middleware/apiKeyValidator');

function buildApp() {
  const app = express();
  app.get('/probe', validateApiKey, (req, res) => res.json({ ok: true, key: req.apiKey }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

function keyRow(overrides = {}) {
  return {
    id: 7,
    key_hash: 'deadbeef',
    usage_limit: null,
    requests_this_month: 0,
    revoked_at: null,
    expires_at: null,
    api_product_id: 3,
    max_requests_per_month: null,
    customer_id: 'cust-1',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('finding 29: product monthly quota enforcement', () => {
  test('429 when the product quota is hit even though the key has no usage_limit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [keyRow({ usage_limit: null, max_requests_per_month: 100, requests_this_month: 100 })] });
    const res = await request(buildApp()).get('/probe').set('X-API-Key', 'some-key');
    expect(res.status).toBe(429);
  });

  test('429 when the key limit is hit even though the product quota is higher', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [keyRow({ usage_limit: 50, max_requests_per_month: 1000, requests_this_month: 50 })] });
    const res = await request(buildApp()).get('/probe').set('X-API-Key', 'some-key');
    expect(res.status).toBe(429);
  });

  test('the LOWER of the two limits wins', async () => {
    // usage 90: under the key limit (100) but over the product quota (80).
    mockQuery.mockResolvedValueOnce({ rows: [keyRow({ usage_limit: 100, max_requests_per_month: 80, requests_this_month: 90 })] });
    const res = await request(buildApp()).get('/probe').set('X-API-Key', 'some-key');
    expect(res.status).toBe(429);
  });

  test('passes when under both limits', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [keyRow({ usage_limit: 100, max_requests_per_month: 80, requests_this_month: 10 })] });
    const res = await request(buildApp()).get('/probe').set('X-API-Key', 'some-key');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('unlimited when both limits are null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [keyRow({ usage_limit: null, max_requests_per_month: null, requests_this_month: 999999 })] });
    const res = await request(buildApp()).get('/probe').set('X-API-Key', 'some-key');
    expect(res.status).toBe(200);
  });
});

describe('finding 37: headers-only keys, no key material in logs', () => {
  test('?api_key= query parameter is rejected as missing', async () => {
    const res = await request(buildApp()).get('/probe?api_key=some-key');
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('query param does not override a missing header into acceptance', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [keyRow()] });
    const res = await request(buildApp()).get('/probe?api_key=other-key').set('X-API-Key', 'some-key');
    // Header key is the one validated; the query value is ignored entirely.
    expect(res.status).toBe(200);
  });

  test('invalid-key log carries no key prefix', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/probe').set('X-API-Key', 'supersecretkey123');
    expect(res.status).toBe(401);
    expect(logger.warn).toHaveBeenCalledWith('Invalid API key attempt');
    const calls = logger.warn.mock.calls.flatMap((args) => args);
    expect(calls.join(' ')).not.toContain('supersec');
  });

  test('Authorization: Bearer still accepted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [keyRow()] });
    const res = await request(buildApp()).get('/probe').set('Authorization', 'Bearer header-key');
    expect(res.status).toBe(200);
  });
});
