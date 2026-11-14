'use strict';

// Domain 6 finding 5 (2026-11-13): the fee-schedule / reserve-policy /
// restaurant-conversion-policy PUTs called requestPendingAction directly,
// bypassing the maker step-up choke point (requestMoneyMovement) and with
// no rejectImpersonated. They queued checker-gated policy changes with no
// maker proof at all. Each must now verify a fresh pending_action_request
// step-up before queueing (unbound: these policy changes carry no single
// amount, the same documented exception as agent_job_cancel) and reject
// impersonated sessions. The checker half is untouched.
//
// Mock-based route test through the real admin router: without a step-up
// proof the queue is never reached; with one it queues with the right
// action type.

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const AppError = require('../utils/appError');

jest.mock('../services/stepupChallengeService', () => ({ verifyStepupChallenge: jest.fn() }));
jest.mock('../services/oxsteedCreditPendingActionService', () => ({ requestPendingAction: jest.fn() }));
jest.mock('../services/oxsteedCreditFeeScheduleService', () => ({ listFeeSchedule: jest.fn() }));
jest.mock('../services/oxsteedCreditReserveService', () => ({
  listReservePolicies: jest.fn(),
  validateReservePolicyInput: jest.fn(),
}));
jest.mock('../services/oxsteedCreditRestaurantConversionPolicyService', () => ({
  listConversionPolicies: jest.fn(),
  validateConversionPolicyInput: jest.fn(),
}));

const SECRET = process.env.JWT_SECRET;
const stepup = require('../services/stepupChallengeService');
const pendingActions = require('../services/oxsteedCreditPendingActionService');
const feeScheduleService = require('../services/oxsteedCreditFeeScheduleService');
const reserveService = require('../services/oxsteedCreditReserveService');
const conversionService = require('../services/oxsteedCreditRestaurantConversionPolicyService');

function bearer() {
  return `Bearer ${jwt.sign({ typ: 'access', sid: 'test-session', id: 'admin-1' }, SECRET, { algorithm: 'HS256' })}`;
}

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/admin'));
  app.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ code: err.code }));
});

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    // requireSuperAdmin's admin lookup (TOTP-enrolled super-admin).
    if (sql.includes('COALESCE(totp_enabled')) {
      return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
    }
    return { rows: [] };
  });
  stepup.verifyStepupChallenge.mockRejectedValue(
    new AppError('A step-up verification code is required for this action', 403, 'credit_stepup_challenge_required')
  );
  pendingActions.requestPendingAction.mockResolvedValue({
    executed: false,
    replayed: false,
    pendingAction: { id: 'pa-1', status: 'pending' },
  });
  feeScheduleService.listFeeSchedule.mockResolvedValue([{ id: 1 }]);
  reserveService.validateReservePolicyInput.mockImplementation((input) => ({
    partnerId: input.partnerId ?? null,
    currencyCode: input.currencyCode,
    ratioBps: input.ratioBps,
    floorCents: input.floorCents,
  }));
  conversionService.validateConversionPolicyInput.mockImplementation((input) => ({
    restaurantId: input.restaurantId,
    allowRestaurantToOxsteed: input.allowRestaurantToOxsteed,
  }));
});

function routeHasMiddleware(router, method, routePath, name) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  expect(layer).toBeDefined();
  return layer.route.stack.some((l) => l.handle && l.handle.name === name);
}

const ROUTES = [
  {
    name: 'fee-schedule',
    method: 'put',
    path: '/api/admin/super/oxsteed-credit/fee-schedule/1',
    routePath: '/super/oxsteed-credit/fee-schedule/:id',
    body: { fixedCents: 100, percentageBps: 250, minFeeCents: 0, isActive: true, reason: 'test' },
    actionType: 'credit_fee_schedule_update',
  },
  {
    name: 'reserve-policies',
    method: 'put',
    path: '/api/admin/super/oxsteed-credit/reserve-policies',
    routePath: '/super/oxsteed-credit/reserve-policies',
    body: { currencyCode: 'USD', ratioBps: 1000, floorCents: 0 },
    actionType: 'credit_reserve_policy_update',
  },
  {
    name: 'conversion-policies',
    method: 'put',
    path: '/api/admin/super/oxsteed-credit/restaurant-conversion-policies',
    routePath: '/super/oxsteed-credit/restaurant-conversion-policies',
    body: { restaurantId: 'rest-1', allowRestaurantToOxsteed: true },
    actionType: 'credit_restaurant_conversion_policy_update',
  },
];

describe('finding 5: the three credit-policy PUTs require a maker step-up', () => {
  test.each(ROUTES)('$name without a step-up proof never queues (403)', async ({ method, path }) => {
    const res = await request(app)[method](path)
      .set('Authorization', bearer())
      .send({ stepupChallengeId: 'ch-1', stepupCode: '123456' });
    expect(res.status).toBe(403);
    expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: 'ch-1',
      actorUserId: 'admin-1',
      actionType: 'pending_action_request',
      code: '123456',
    }));
    // Unbound exception: policy changes carry no single amount, so no
    // amount binding is passed (same documented exception as
    // agent_job_cancel).
    expect(stepup.verifyStepupChallenge.mock.calls[0][0]).not.toHaveProperty('expectedAmountCents');
    expect(pendingActions.requestPendingAction).not.toHaveBeenCalled();
  });

  test.each(ROUTES)('$name with a fresh step-up queues with the right action type', async ({ method, path, body, actionType }) => {
    stepup.verifyStepupChallenge.mockResolvedValue({ verified: true });
    const res = await request(app)[method](path)
      .set('Authorization', bearer())
      .send({ ...body, stepupChallengeId: 'ch-1', stepupCode: '123456' });
    expect(res.status).toBe(202);
    expect(res.body.pendingAction).toEqual(expect.objectContaining({ id: 'pa-1', status: 'pending' }));
    expect(pendingActions.requestPendingAction).toHaveBeenCalledTimes(1);
    expect(pendingActions.requestPendingAction).toHaveBeenCalledWith(expect.objectContaining({
      actionType,
      requestedBy: 'admin-1',
    }));
  });

  test.each(ROUTES)('$name mounts rejectImpersonated', async ({ routePath }) => {
    const router = require('../routes/admin');
    expect(routeHasMiddleware(router, 'put', routePath, 'rejectImpersonated')).toBe(true);
  });
});
