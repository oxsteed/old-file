'use strict';

/**
 * Phase 3 dual-admin refunds — route wiring proof.
 *
 *  - The old PATCH /refund-cases/:id endpoint (direct status /
 *    stripe_refund_id editing) is GONE: PATCH now 404s.
 *  - The new propose/approve/reject/execute/stepup routes exist and sit
 *    behind the operations-workspace auth middleware.
 *  - Unauthenticated requests are blocked (401) on every refund route.
 *  - Approving without a fresh step-up event is rejected (401
 *    fresh_auth_required) at the route level, before the service runs.
 *  - Reads (GET /refund-cases) stay backward-compatible.
 *
 * The real router is mounted; ../db is faked so no database is touched.
 */

jest.mock('../db', () => {
  // Fake pool: fresh-auth probe returns no event (or a fresh one when
  // __freshAuthEvent is set); the operations middleware short-circuits for
  // admin roles without querying.
  const state = { freshAuthEvent: null };
  async function query(sql, params) {
    const s = String(sql);
    if (s.includes('logistics_fresh_auth_events')) {
      return { rows: state.freshAuthEvent ? [state.freshAuthEvent] : [] };
    }
    if (s.includes('information_schema')) return { rows: [] };
    if (s.includes('totp_enabled')) {
      // Router-level ADM-006 TOTP hard-block: the fake admin has TOTP on.
      return { rows: [{ totp_enabled: true }] };
    }
    if (s.includes('logistics_refund_cases')) {
      // No refund case exists: service returns 404 not_found.
      return { rows: [] };
    }
    throw new Error(`route-test fakeDb: unexpected SQL: ${s.slice(0, 100)}`);
  }
  query.__state = state;
  return { query };
});

const express = require('express');
const request = require('supertest');
const logisticsAdminRouter = require('../routes/logisticsAdmin');
const pool = require('../db');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user || null; next(); });
  app.use('/api/admin/logistics', logisticsAdminRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

const adminUser = { id: 'admin-1', role: 'admin' };

function routeMethods(router, path) {
  const methods = [];
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path) {
      methods.push(...Object.keys(layer.route.methods));
    }
  }
  return methods.sort();
}

describe('refund route surface', () => {
  test('old PATCH /refund-cases/:id hole is closed (no PATCH route registered)', () => {
    expect(routeMethods(logisticsAdminRouter, '/refund-cases/:id')).toEqual([]);
  });

  test('new dual-admin routes are registered', () => {
    expect(routeMethods(logisticsAdminRouter, '/refunds/propose')).toEqual(['post']);
    expect(routeMethods(logisticsAdminRouter, '/refunds/:id/approve')).toEqual(['post']);
    expect(routeMethods(logisticsAdminRouter, '/refunds/:id/reject')).toEqual(['post']);
    expect(routeMethods(logisticsAdminRouter, '/refunds/:id/execute')).toEqual(['post']);
    expect(routeMethods(logisticsAdminRouter, '/refunds/stepup/verify')).toEqual(['post']);
    expect(routeMethods(logisticsAdminRouter, '/refunds')).toEqual(['get']);
    expect(routeMethods(logisticsAdminRouter, '/refunds/:id')).toEqual(['get']);
    expect(routeMethods(logisticsAdminRouter, '/refunds/:id/decisions')).toEqual(['get']);
    // Backward-compatible legacy read path.
    expect(routeMethods(logisticsAdminRouter, '/refund-cases')).toEqual(['get']);
  });

  test('no PUT/PATCH/DELETE exists on any refund path (status cannot be edited directly)', () => {
    const dangerous = [];
    for (const layer of logisticsAdminRouter.stack) {
      if (layer.route && /refund/.test(layer.route.path)) {
        for (const m of Object.keys(layer.route.methods)) {
          if (['put', 'patch', 'delete'].includes(m)) dangerous.push(`${m.toUpperCase()} ${layer.route.path}`);
        }
      }
    }
    expect(dangerous).toEqual([]);
  });

  test('approve route carries auth middleware before the controller', () => {
    const layer = logisticsAdminRouter.stack.find(
      (l) => l.route && l.route.path === '/refunds/:id/approve'
    );
    // workspace auth + fresh-auth + controller = at least 3 handlers
    expect(layer.route.stack.length).toBeGreaterThanOrEqual(3);
  });
});

describe('unauthorized access', () => {
  const paths = [
    ['post', '/api/admin/logistics/refunds/propose'],
    ['post', '/api/admin/logistics/refunds/1/approve'],
    ['post', '/api/admin/logistics/refunds/1/reject'],
    ['post', '/api/admin/logistics/refunds/1/execute'],
    ['get', '/api/admin/logistics/refunds'],
    ['get', '/api/admin/logistics/refund-cases'],
  ];
  test.each(paths)('%s %s without a user -> 401', async (method, path) => {
    const res = await request(buildApp(null))[method](path).send({});
    expect(res.status).toBe(401);
  });

  test('non-operations user is blocked (403)', async () => {
    const res = await request(buildApp({ id: 'buyer-1', role: 'buyer', logistics_role: 'individual_buyer' }))
      .get('/api/admin/logistics/refunds');
    expect([401, 403]).toContain(res.status);
  });
});

describe('hole closure and fresh-auth gate (live requests)', () => {
  test('PATCH /refund-cases/1 (the old hole) returns 404 for an admin', async () => {
    const res = await request(buildApp(adminUser))
      .patch('/api/admin/logistics/refund-cases/1')
      .send({ status: 'processed', stripe_refund_id: 're_forged' });
    expect(res.status).toBe(404);
  });

  test('POST approve without fresh step-up -> 401 fresh_auth_required', async () => {
    pool.query.__state.freshAuthEvent = null;
    const res = await request(buildApp(adminUser))
      .post('/api/admin/logistics/refunds/1/approve')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('fresh_auth_required');
  });

  test('POST approve with a fresh step-up event reaches the service (fails closed without payments table)', async () => {
    pool.query.__state.freshAuthEvent = {
      completed_at: new Date(),
      auth_hash: 'hash-xyz',
      method: 'totp',
    };
    const res = await request(buildApp(adminUser))
      .post('/api/admin/logistics/refunds/1/approve')
      .send({});
    // information_schema probe finds no logistics_payment_attempts table,
    // so the service fails closed with a refund error — but NOT a fresh-auth error.
    expect(res.body.code).not.toBe('fresh_auth_required');
    expect([404, 409, 400]).toContain(res.status);
    pool.query.__state.freshAuthEvent = null;
  });
});
