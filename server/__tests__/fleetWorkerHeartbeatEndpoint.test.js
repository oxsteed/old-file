'use strict';

// Domain 8 #30: the fleet scheduler kept per-worker run state in memory
// (getFleetWorkerHeartbeats) with zero callers outside its own file, so
// a worker skipped in every replica surfaced only via the incident
// after 3 consecutive skips, with no live heartbeat view. The snapshot
// is now wired to a read-only admin endpoint (manage_operations) and
// shown on the Operations Overview page.

const { resetMocks } = require('./setup');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-1', role: req.headers['x-test-role'] || 'customer' };
    next();
  },
  requireAuth: (req, res, next) => {
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
  requireSuperAdmin: (req, res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-1', role: req.headers['x-test-role'] || 'super_admin' };
    req.isSuper = true;
    next();
  },
  requirePermission: () => (req, res, next) => next(),
  hasGlobalGrant: jest.fn().mockResolvedValue(false),
}));
jest.mock('../middleware/regionAuth', () => ({
  loadAssignedRegions: (req, res, next) => next(),
  requireRegionAccessForUser: () => (req, res, next) => next(),
}));
jest.mock('../middleware/rejectImpersonated', () => ({
  rejectImpersonated: (req, res, next) => next(),
}));
jest.mock('../middleware/rateLimiter', () => {
  const pass = (req, res, next) => next();
  return { generalLimiter: pass, strictLimiter: pass, creditAdminMutationLimiter: pass, creditExportLimiter: pass, adminPhoneVerificationLimiter: pass };
});
jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn(async (_name, fn) => fn()),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ persisted: true }),
  resolveOpenIncidentsByDedupeKeys: jest.fn().mockResolvedValue([]),
}));
jest.mock('../utils/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const adminRoutes = require('../routes/admin');
const { runScheduledWorkerOnce, resetFleetWorkerState } = require('../workers/scheduledWorkerSchedule');

const log = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  resetFleetWorkerState();
});

test('admins see the live fleet worker heartbeat snapshot', async () => {
  await runScheduledWorkerOnce(['demo-worker', async () => ({ done: 1 }), 60000, {}], { log });
  const res = await request(buildApp())
    .get('/api/admin/operations/fleet-worker-heartbeats')
    .set('x-test-user', 'admin-1')
    .set('x-test-role', 'admin');
  expect(res.status).toBe(200);
  expect(res.body.generated_at).toEqual(expect.any(String));
  const heartbeat = res.body.heartbeats.find((entry) => entry.worker === 'demo-worker');
  expect(heartbeat).toMatchObject({ worker: 'demo-worker', lastOutcome: 'completed', consecutiveFailures: 0 });
  expect(heartbeat.lastRunAt).toEqual(expect.any(String));
  expect(heartbeat.lastSuccessAt).toEqual(expect.any(String));
});

test('non-admins cannot read fleet heartbeats', async () => {
  const res = await request(buildApp())
    .get('/api/admin/operations/fleet-worker-heartbeats')
    .set('x-test-user', 'user-1')
    .set('x-test-role', 'customer');
  expect(res.status).toBe(403);
});
