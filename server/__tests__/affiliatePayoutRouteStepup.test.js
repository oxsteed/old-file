'use strict';

// Audit fix (item 3): the newer affiliate payout process route must require
// a fresh step-up challenge from the maker, mirroring the legacy route.
// Previously below-threshold payouts on this route moved on a single admin
// session alone.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const AppError = require('../utils/appError');

const mockTransfers = { create: jest.fn() };
jest.mock('stripe', () => () => ({ transfers: mockTransfers }));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/sanctionsScreeningService', () => ({ assertSanctionsClear: jest.fn().mockResolvedValue({ cleared: false }) }));
jest.mock('../services/stepupChallengeService', () => ({ verifyStepupChallenge: jest.fn() }));
jest.mock('../middleware/adminAuth', () => ({
  requireAdmin: (req, res, next) => next(),
  requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../middleware/rejectImpersonated', () => ({ rejectImpersonated: (req, res, next) => next() }));
jest.mock('../middleware/rateLimiter', () => ({ strictLimiter: (req, res, next) => next() }));
jest.mock('../middleware/featureFlags', () => ({ requireFeatureEnabled: () => (req, res, next) => next() }));
jest.mock('../middleware/auth', () => ({ requireAuth: (req, res, next) => next() }));
jest.mock('../controllers/AffiliateAnalyticsController', () => ({
  getMetricsTimeSeries: jest.fn(),
  getConversionFunnel: jest.fn(),
  getTopProducts: jest.fn(),
  getVisitorFunnel: jest.fn(),
  getSourceBreakdown: jest.fn(),
  getProductAnalytics: jest.fn(),
}));

const stepup = require('../services/stepupChallengeService');
const controller = require('../controllers/affiliatePayoutsController');
const router = require('../routes/affiliatePayouts');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com' };
    next();
  });
  app.use(router);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  // Nov 1 audit item 1: the process route loads the payout before verifying
  // so the step-up binds to the fresh payable. Serve a payout row whose net
  // figure wins, matching utils/affiliatePayableCents.
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM affiliate_payouts/.test(sql)) {
      return { rows: [{ id: '123', net_payout_cents: 50000, total_commission_cents: 60000, processor_fee_cents: 10000 }] };
    }
    return { rows: [], rowCount: 0 };
  });
});

test('rejects below-threshold processing without a fresh step-up, controller never runs', async () => {
  stepup.verifyStepupChallenge.mockRejectedValue(
    new AppError('A step-up verification code is required for this action', 403, 'credit_stepup_challenge_required')
  );
  const spy = jest.spyOn(controller, 'processPayout');
  const res = await request(buildApp())
    .post('/123/process')
    .send({ stepupChallengeId: 'ch-1', stepupCode: '123456' });
  expect(res.status).toBe(403);
  expect(spy).not.toHaveBeenCalled();
  expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
    challengeId: 'ch-1',
    actorUserId: 'admin-1',
    actionType: 'affiliate_payout_process',
    code: '123456',
    expectedAmountCents: 50000,
  }));
  spy.mockRestore();
});

test('allows processing with a fresh step-up, controller runs', async () => {
  stepup.verifyStepupChallenge.mockResolvedValue({ verified: true });
  const spy = jest.spyOn(controller, 'processPayout')
    .mockImplementation((req, res) => res.json({ success: true }));
  const res = await request(buildApp())
    .post('/123/process')
    .send({ stepupChallengeId: 'ch-1', stepupCode: '123456' });
  expect(res.status).toBe(200);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
    expectedAmountCents: 50000,
  }));
  spy.mockRestore();
});

test('missing payout 404s before verification, challenge never consumed', async () => {
  mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  const spy = jest.spyOn(controller, 'processPayout');
  const res = await request(buildApp())
    .post('/999/process')
    .send({ stepupChallengeId: 'ch-1', stepupCode: '123456' });
  expect(res.status).toBe(404);
  expect(stepup.verifyStepupChallenge).not.toHaveBeenCalled();
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});
