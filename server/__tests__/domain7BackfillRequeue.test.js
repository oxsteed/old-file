'use strict';

/**
 * Domain 7 #17 (2026-11-11 admin-ops audit): backfill requeue accepts an
 * impersonated session and an unbounded id list, and requeues everything
 * when ids is null/empty. Fix: rejectImpersonated on the route, cap ids at
 * 500 (matching the message-notification outbox cap), and require an
 * explicit all: true for the requeue-everything case instead of defaulting
 * to it.
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));

const { requeueParkedDualPostingBackfill } = require('../services/oxsteedCreditSubBankService');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');

function bearer(claims) {
  return `Bearer ${jwt.sign({ typ: 'access', sid: 'test-session', id: 'admin-1', ...claims }, SECRET, { algorithm: 'HS256' })}`;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/admin'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ error: err.message, code: err.code }));
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockQuery.mockImplementation(async (sql) => {
    if (String(sql).includes('COALESCE(totp_enabled')) {
      return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
    }
    return { rows: [], rowCount: 0 };
  });
});

describe('Domain 7 #17: requeueParkedDualPostingBackfill scoping', () => {
  const mockPool = { query: jest.fn() };

  beforeEach(() => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rowCount: 2 });
  });

  test('no ids and no all flag fails closed instead of requeueing everything', async () => {
    await expect(requeueParkedDualPostingBackfill(mockPool, {})).rejects.toMatchObject({
      status: 400,
      code: 'validation_failed',
    });
    await expect(requeueParkedDualPostingBackfill(mockPool, { ids: [] })).rejects.toMatchObject({
      status: 400,
      code: 'validation_failed',
    });
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  test('explicit all: true requeues the whole parked queue with no id filter', async () => {
    await expect(requeueParkedDualPostingBackfill(mockPool, { all: true })).resolves.toEqual({ requeued: 2 });
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).not.toMatch(/ANY\(/);
    expect(params).toEqual([]);
  });

  test('an id list scopes the requeue to those rows', async () => {
    await expect(requeueParkedDualPostingBackfill(mockPool, { ids: ['1', '2'] })).resolves.toEqual({ requeued: 2 });
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/id::text = ANY\(\$1::text\[\]\)/);
    expect(params).toEqual([['1', '2']]);
  });

  test('an id list longer than 500 is capped at 500', async () => {
    const ids = Array.from({ length: 600 }, (_, i) => String(i + 1));
    await expect(requeueParkedDualPostingBackfill(mockPool, { ids })).resolves.toEqual({ requeued: 2 });
    const [, params] = mockPool.query.mock.calls[0];
    expect(params[0]).toHaveLength(500);
  });
});

describe('Domain 7 #17: POST /super/oxsteed-credit/backfill/requeue route', () => {
  test('rejectImpersonated is mounted on the requeue route', () => {
    const adminRouter = require('../routes/admin');
    const handlers = [];
    for (const layer of adminRouter.stack || []) {
      if (!layer.route) continue;
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      if (paths.includes('/super/oxsteed-credit/backfill/requeue')) {
        handlers.push(...layer.route.stack.map((l) => l.handle));
      }
    }
    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers).toContain(rejectImpersonated);
  });

  test('no ids and no all flag: 400, nothing requeued', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('COALESCE(totp_enabled')) {
        return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp()).post('/api/admin/super/oxsteed-credit/backfill/requeue')
      .set('Authorization', bearer()).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE credit_dual_posting_backfill/.test(String(sql)))).toBe(false);
  });

  test('explicit all: true requeues everything and audits the scope as all', async () => {
    const { logAdminAction } = require('../services/auditService');
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('COALESCE(totp_enabled')) {
        return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
      }
      if (/UPDATE credit_dual_posting_backfill/.test(text)) return { rows: [], rowCount: 3 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp()).post('/api/admin/super/oxsteed-credit/backfill/requeue')
      .set('Authorization', bearer()).send({ all: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requeued: 3 });
    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE credit_dual_posting_backfill/.test(String(sql)));
    expect(updateCall[0]).not.toMatch(/ANY\(/);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ targetKey: 'all' }));
  });

  test('an id list requeues only those rows', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('COALESCE(totp_enabled')) {
        return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
      }
      if (/UPDATE credit_dual_posting_backfill/.test(text)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp()).post('/api/admin/super/oxsteed-credit/backfill/requeue')
      .set('Authorization', bearer()).send({ ids: ['7', '8'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requeued: 1 });
    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE credit_dual_posting_backfill/.test(String(sql)));
    expect(updateCall[1]).toEqual([['7', '8']]);
  });
});
