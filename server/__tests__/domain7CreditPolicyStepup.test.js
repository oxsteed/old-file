'use strict';

/**
 * Domain 7 #9 (2026-11-11 admin-ops audit): the three credit policy PUTs
 * (fee-schedule, reserve-policies, restaurant-conversion-policies) queue
 * pending actions with no maker step-up and no rejectImpersonated,
 * bypassing the requestMoneyMovement maker choke point. A stolen
 * super-admin session could queue fee-schedule, reserve-ratio, and
 * conversion-policy changes with no fresh-auth proof.
 *
 * Each PUT must verify a fresh maker step-up (actionType
 * 'pending_action_request', the same challenge requestMoneyMovement
 * verifies) before requestPendingAction, and carry rejectImpersonated.
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
jest.mock('../services/oxsteedCreditPendingActionService', () => ({
  requestPendingAction: jest.fn(),
}));
jest.mock('../services/oxsteedCreditFeeScheduleService', () => ({
  listFeeSchedule: jest.fn(),
}));
jest.mock('../services/oxsteedCreditReserveService', () => ({
  listReservePolicies: jest.fn(),
  validateReservePolicyInput: jest.fn(),
}));
jest.mock('../services/oxsteedCreditRestaurantConversionPolicyService', () => ({
  listConversionPolicies: jest.fn(),
  validateConversionPolicyInput: jest.fn(),
}));

const stepup = require('../services/stepupChallengeService');
const { requestPendingAction } = require('../services/oxsteedCreditPendingActionService');
const feeScheduleService = require('../services/oxsteedCreditFeeScheduleService');
const reserveService = require('../services/oxsteedCreditReserveService');
const conversionPolicyService = require('../services/oxsteedCreditRestaurantConversionPolicyService');
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
const QUEUED = { executed: false, replayed: false, pendingAction: { id: 'pa-1', status: 'pending' } };

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockQuery.mockImplementation(async (sql) => {
    if (String(sql).includes('COALESCE(totp_enabled')) {
      return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
    }
    return { rows: [], rowCount: 0 };
  });
  requestPendingAction.mockResolvedValue(QUEUED);
  feeScheduleService.listFeeSchedule.mockResolvedValue([{ id: 'fee-1' }]);
  reserveService.validateReservePolicyInput.mockImplementation((input) => ({
    partnerId: input.partnerId ?? null,
    currencyCode: input.currencyCode,
    ratioBps: input.ratioBps,
    floorCents: input.floorCents,
  }));
  conversionPolicyService.validateConversionPolicyInput.mockImplementation((input) => ({
    restaurantId: input.restaurantId,
    allowRestaurantToOxsteed: input.allowRestaurantToOxsteed,
  }));
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

describe('Domain 7 #9: rejectImpersonated is mounted on the three credit policy PUTs', () => {
  const adminRouter = require('../routes/admin');
  test.each([
    '/super/oxsteed-credit/fee-schedule/:id',
    '/super/oxsteed-credit/reserve-policies',
    '/super/oxsteed-credit/restaurant-conversion-policies',
  ])('%s', (path) => {
    const handlers = routeHandlers(adminRouter, path);
    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers).toContain(rejectImpersonated);
  });
});

describe('Domain 7 #9: fee-schedule PUT verifies a maker step-up before queueing', () => {
  const url = '/api/admin/super/oxsteed-credit/fee-schedule/fee-1';
  const body = {
    fixedCents: 100, percentageBps: 250, minFeeCents: 50, maxFeeCents: null,
    reason: 'test', stepupChallengeId: 'ch-1', stepupCode: '123456',
  };

  test('no step-up proof: 403 and nothing is queued', async () => {
    stepup.verifyStepupChallenge.mockRejectedValue(STEPUP_REQUIRED);
    const res = await request(buildApp()).put(url).set('Authorization', bearer()).send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('credit_stepup_challenge_required');
    expect(requestPendingAction).not.toHaveBeenCalled();
  });

  test('fresh maker step-up: queues as a pending action', async () => {
    stepup.verifyStepupChallenge.mockResolvedValue({ verified: true });
    const res = await request(buildApp()).put(url).set('Authorization', bearer()).send(body);
    expect(res.status).toBe(202);
    expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: 'ch-1',
      actorUserId: 'admin-1',
      actionType: 'pending_action_request',
      code: '123456',
    }));
    expect(requestPendingAction).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'credit_fee_schedule_update',
      requestedBy: 'admin-1',
    }));
  });
});

describe('Domain 7 #9: reserve-policies PUT verifies a maker step-up before queueing', () => {
  const url = '/api/admin/super/oxsteed-credit/reserve-policies';
  const body = {
    currencyCode: 'USD', ratioBps: 1000, floorCents: 50000,
    stepupChallengeId: 'ch-1', stepupCode: '123456',
  };

  test('no step-up proof: 403 and nothing is queued', async () => {
    stepup.verifyStepupChallenge.mockRejectedValue(STEPUP_REQUIRED);
    const res = await request(buildApp()).put(url).set('Authorization', bearer()).send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('credit_stepup_challenge_required');
    expect(requestPendingAction).not.toHaveBeenCalled();
  });

  test('fresh maker step-up: queues as a pending action', async () => {
    stepup.verifyStepupChallenge.mockResolvedValue({ verified: true });
    const res = await request(buildApp()).put(url).set('Authorization', bearer()).send(body);
    expect(res.status).toBe(202);
    expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'pending_action_request',
    }));
    expect(requestPendingAction).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'credit_reserve_policy_update',
    }));
  });
});

describe('Domain 7 #9: restaurant-conversion-policies PUT verifies a maker step-up before queueing', () => {
  const url = '/api/admin/super/oxsteed-credit/restaurant-conversion-policies';
  const body = {
    restaurantId: 9, allowRestaurantToOxsteed: true,
    stepupChallengeId: 'ch-1', stepupCode: '123456',
  };

  test('no step-up proof: 403 and nothing is queued', async () => {
    stepup.verifyStepupChallenge.mockRejectedValue(STEPUP_REQUIRED);
    const res = await request(buildApp()).put(url).set('Authorization', bearer()).send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('credit_stepup_challenge_required');
    expect(requestPendingAction).not.toHaveBeenCalled();
  });

  test('fresh maker step-up: queues as a pending action', async () => {
    stepup.verifyStepupChallenge.mockResolvedValue({ verified: true });
    const res = await request(buildApp()).put(url).set('Authorization', bearer()).send(body);
    expect(res.status).toBe(202);
    expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'pending_action_request',
    }));
    expect(requestPendingAction).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'credit_restaurant_conversion_policy_update',
    }));
  });
});
