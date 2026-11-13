'use strict';

// Domain 7 #11 (repro-first): the FX quote page takes a bare customer UUID
// with no name preview. The customer-role transfer-recipient lookup
// (GET /oxsteed-credit/transfer-recipients/:customerId) is not callable
// from an admin session — its router requires the customer role — so the
// admin side needs its own lookup: the same read-only resolver wired
// behind requireSuperAdmin.
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-1', role: req.headers['x-test-role'] || 'customer' };
    next();
  },
  requireAuth: (req, _res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-1', role: req.headers['x-test-role'] || 'customer' };
    next();
  },
}));
jest.mock('../middleware/adminAuth', () => ({
  requireAdmin: (req, res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-1', role: req.headers['x-test-role'] || 'customer' };
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    req.isSuper = req.headers['x-test-super'] === '1' || req.user.role === 'super_admin';
    next();
  },
  requireSuperAdmin: (req, _res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-1', role: req.headers['x-test-role'] || 'super_admin' };
    req.isSuper = true;
    next();
  },
  requirePermission: () => (req, _res, next) => next(),
  hasGlobalGrant: jest.fn().mockResolvedValue(false),
}));
jest.mock('../middleware/regionAuth', () => ({
  loadAssignedRegions: (req, _res, next) => next(),
  requireRegionAccessForUser: () => (req, _res, next) => next(),
}));
jest.mock('../middleware/rejectImpersonated', () => ({
  rejectImpersonated: (req, _res, next) => next(),
}));
jest.mock('../middleware/rateLimiter', () => {
  const pass = (req, _res, next) => next();
  return { generalLimiter: pass, strictLimiter: pass, creditAdminMutationLimiter: pass, creditExportLimiter: pass, adminPhoneVerificationLimiter: pass };
});

const adminRoutes = require('../routes/admin');
const { errorHandler } = require('../middleware/errorHandler');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('admin lookup resolves the customer display name for the FX quote page', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (String(sql).includes('FROM users')) {
      return { rows: [{ id: CUSTOMER_ID, first_name: 'Ada', last_name: 'Lovelace' }] };
    }
    return { rows: [] };
  });
  const res = await request(buildApp())
    .get(`/api/admin/super/oxsteed-credit/customers/${CUSTOMER_ID}`)
    .set('x-test-user', 'admin-1')
    .set('x-test-role', 'super_admin');
  expect(res.status).toBe(200);
  expect(res.body.recipient).toMatchObject({ customerId: CUSTOMER_ID, displayName: 'Ada Lovelace' });
});

test('admin lookup of an unknown customer is a 404', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  const res = await request(buildApp())
    .get('/api/admin/super/oxsteed-credit/customers/22222222-2222-4222-8222-222222222222')
    .set('x-test-user', 'admin-1')
    .set('x-test-role', 'super_admin');
  expect(res.status).toBe(404);
  // Not a bare Express 404: the lookup itself reports the missing customer.
  expect(res.body.code).toBe('credit_recipient_not_found');
});

test('the admin lookup route is not the customer-role transfer-recipients route', async () => {
  // The customer-role route lives on a different router and requires the
  // customer role; the admin page must not depend on it. This test pins the
  // admin route path so a future edit cannot silently re-point the page.
  const router = require('../routes/admin');
  const paths = (router.stack || [])
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',')}:${layer.route.path}`);
  expect(paths).toContain('get:/super/oxsteed-credit/customers/:customerId');
});
