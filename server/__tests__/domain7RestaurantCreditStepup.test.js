'use strict';

/**
 * Domain 7 #2 (2026-11-11 admin-ops audit): restaurant-credit hold release,
 * wallet-status update, and load-request approve/decline unlock customer
 * funds on session auth alone — no rejectImpersonated, no fresh step-up.
 *
 * The four routes must carry rejectImpersonated and verify a fresh
 * amount-bound (where an amount exists) admin step-up before the controller
 * runs, following the settlement-payout / withdrawal-approve pattern in
 * server/routes/admin.js.
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const AppError = require('../utils/appError');

const SECRET = process.env.JWT_SECRET;

jest.mock('../services/stepupChallengeService', () => ({
  verifyStepupChallenge: jest.fn(),
  issueStepupChallenge: jest.fn(),
  TOTP_STEPUP_ACTION_TYPES: ['pending_action_request'],
  STEPUP_ACTION_TYPES: ['pending_action_request'],
}));
jest.mock('../controllers/restaurantCreditAdminController', () => ({
  getOverview: jest.fn((req, res) => res.json({})),
  getWalletDetail: jest.fn((req, res) => res.json({})),
  updateWalletStatus: jest.fn((req, res) => res.json({ changed: true })),
  releaseHold: jest.fn((req, res) => res.json({ changed: true })),
  approveLoadRequest: jest.fn((req, res) => res.json({ approved: true })),
  declineLoadRequest: jest.fn((req, res) => res.json({ declined: true })),
}));

const stepup = require('../services/stepupChallengeService');
const restaurantCreditAdminCtrl = require('../controllers/restaurantCreditAdminController');
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

const STEPUP_REQUIRED = new AppError(
  'A step-up verification code is required for this action',
  403,
  'credit_stepup_challenge_required',
);

// The amount pre-reads the routes perform before verifying the step-up.
function mockDbForPreReads() {
  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('COALESCE(totp_enabled')) {
      return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
    }
    if (text.includes('FROM food_customer_wallet_holds')) {
      return { rows: [{ amount_cents: 2500 }] };
    }
    if (text.includes('FROM food_customer_wallet_load_requests')) {
      return { rows: [{ amount_cents: 5000 }] };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockDbForPreReads();
});

function routeHandlers(router, path) {
  const matches = [];
  for (const layer of router.stack || []) {
    if (!layer.route) continue;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    if (paths.includes(path)) matches.push(...layer.route.stack.map((l) => l.handle));
  }
  return matches;
}

describe('Domain 7 #2: rejectImpersonated is mounted on the restaurant-credit mutation routes', () => {
  const adminRouter = require('../routes/admin');
  test.each([
    '/super/restaurant-credit/wallets/:accountId/status',
    '/super/restaurant-credit/holds/:holdId/release',
    '/super/restaurant-credit/load-requests/:requestId/approve',
    '/super/restaurant-credit/load-requests/:requestId/decline',
  ])('%s', (path) => {
    const handlers = routeHandlers(adminRouter, path);
    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers).toContain(rejectImpersonated);
  });
});

describe('Domain 7 #2: hold release requires a fresh amount-bound step-up', () => {
  const url = '/api/admin/super/restaurant-credit/holds/11111111-1111-4111-8111-111111111111/release';
  const body = { reason: 'customer asked', stepupChallengeId: 'ch-1', stepupCode: '123456' };

  test('no step-up proof: 403 and the controller never runs', async () => {
    stepup.verifyStepupChallenge.mockRejectedValue(STEPUP_REQUIRED);
    const res = await request(buildApp()).post(url).set('Authorization', bearer()).send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('credit_stepup_challenge_required');
    expect(restaurantCreditAdminCtrl.releaseHold).not.toHaveBeenCalled();
  });

  test('fresh step-up bound to the held amount: controller runs', async () => {
    stepup.verifyStepupChallenge.mockResolvedValue({ verified: true });
    const res = await request(buildApp()).post(url).set('Authorization', bearer()).send(body);
    expect(res.status).toBe(200);
    expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: 'ch-1',
      actorUserId: 'admin-1',
      actionType: 'restaurant_credit_hold_release',
      code: '123456',
      expectedAmountCents: 2500,
    }));
    expect(restaurantCreditAdminCtrl.releaseHold).toHaveBeenCalledTimes(1);
  });

  test('amount pre-read failure fails closed with 503, step-up never verified', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('COALESCE(totp_enabled')) {
        return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
      }
      if (text.includes('FROM food_customer_wallet_holds')) throw new Error('db down');
      return { rows: [], rowCount: 0 };
    });
    stepup.verifyStepupChallenge.mockResolvedValue({ verified: true });
    const res = await request(buildApp()).post(url).set('Authorization', bearer()).send(body);
    expect(res.status).toBe(503);
    expect(stepup.verifyStepupChallenge).not.toHaveBeenCalled();
    expect(restaurantCreditAdminCtrl.releaseHold).not.toHaveBeenCalled();
  });
});

describe('Domain 7 #2: wallet-status update requires a fresh step-up', () => {
  const url = '/api/admin/super/restaurant-credit/wallets/42/status';

  test('no step-up proof: 403 and the controller never runs', async () => {
    stepup.verifyStepupChallenge.mockRejectedValue(STEPUP_REQUIRED);
    const res = await request(buildApp()).post(url).set('Authorization', bearer())
      .send({ status: 'suspended', reason: 'fraud', stepupChallengeId: 'ch-1', stepupCode: '123456' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('credit_stepup_challenge_required');
    expect(restaurantCreditAdminCtrl.updateWalletStatus).not.toHaveBeenCalled();
  });

  test('fresh step-up: controller runs', async () => {
    stepup.verifyStepupChallenge.mockResolvedValue({ verified: true });
    const res = await request(buildApp()).post(url).set('Authorization', bearer())
      .send({ status: 'suspended', reason: 'fraud', stepupChallengeId: 'ch-1', stepupCode: '123456' });
    expect(res.status).toBe(200);
    expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'restaurant_credit_wallet_status_update',
      actorUserId: 'admin-1',
    }));
    expect(restaurantCreditAdminCtrl.updateWalletStatus).toHaveBeenCalledTimes(1);
  });
});

describe('Domain 7 #2: load-request approve requires a fresh amount-bound step-up', () => {
  const url = '/api/admin/super/restaurant-credit/load-requests/7/approve';

  test('no step-up proof: 403 and the controller never runs', async () => {
    stepup.verifyStepupChallenge.mockRejectedValue(STEPUP_REQUIRED);
    const res = await request(buildApp()).post(url).set('Authorization', bearer())
      .send({ stepupChallengeId: 'ch-1', stepupCode: '123456' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('credit_stepup_challenge_required');
    expect(restaurantCreditAdminCtrl.approveLoadRequest).not.toHaveBeenCalled();
  });

  test('fresh step-up bound to the requested amount: controller runs', async () => {
    stepup.verifyStepupChallenge.mockResolvedValue({ verified: true });
    const res = await request(buildApp()).post(url).set('Authorization', bearer())
      .send({ stepupChallengeId: 'ch-1', stepupCode: '123456' });
    expect(res.status).toBe(200);
    expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'restaurant_credit_load_approve',
      expectedAmountCents: 5000,
    }));
    expect(restaurantCreditAdminCtrl.approveLoadRequest).toHaveBeenCalledTimes(1);
  });
});

describe('Domain 7 #2: load-request decline requires a fresh step-up', () => {
  const url = '/api/admin/super/restaurant-credit/load-requests/7/decline';

  test('no step-up proof: 403 and the controller never runs', async () => {
    stepup.verifyStepupChallenge.mockRejectedValue(STEPUP_REQUIRED);
    const res = await request(buildApp()).post(url).set('Authorization', bearer())
      .send({ reason: 'nope', stepupChallengeId: 'ch-1', stepupCode: '123456' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('credit_stepup_challenge_required');
    expect(restaurantCreditAdminCtrl.declineLoadRequest).not.toHaveBeenCalled();
  });

  test('fresh step-up: controller runs', async () => {
    stepup.verifyStepupChallenge.mockResolvedValue({ verified: true });
    const res = await request(buildApp()).post(url).set('Authorization', bearer())
      .send({ reason: 'nope', stepupChallengeId: 'ch-1', stepupCode: '123456' });
    expect(res.status).toBe(200);
    expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'restaurant_credit_load_decline',
      actorUserId: 'admin-1',
    }));
    expect(restaurantCreditAdminCtrl.declineLoadRequest).toHaveBeenCalledTimes(1);
  });
});
