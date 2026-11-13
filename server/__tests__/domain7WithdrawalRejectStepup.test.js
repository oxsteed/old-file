'use strict';

/**
 * Domain 7 #18 (2026-11-11 admin-ops audit): withdrawal reject is
 * single-admin with no step-up and no impersonation rejection, unlike
 * approve on the same page (rejectImpersonated plus an amount-bound maker
 * step-up, queued for a second admin). Fix: add rejectImpersonated and an
 * amount-bound step-up to the reject route, for symmetry with approve.
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
jest.mock('../services/oxsteedCreditWithdrawalService', () => ({
  listWithdrawals: jest.fn(),
  rejectWithdrawal: jest.fn(),
}));

const stepup = require('../services/stepupChallengeService');
const withdrawalService = require('../services/oxsteedCreditWithdrawalService');
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

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('COALESCE(totp_enabled')) {
      return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
    }
    if (text.includes('FROM oxsteed_credit_withdrawals')) {
      return { rows: [{ amount_cents: 7500 }] };
    }
    return { rows: [], rowCount: 0 };
  });
  withdrawalService.rejectWithdrawal.mockResolvedValue({ id: 'w-1', status: 'rejected' });
});

describe('Domain 7 #18: withdrawal reject route', () => {
  const url = '/api/admin/super/oxsteed-credit/withdrawals/w-1/reject';
  const body = { reason: 'bad account', stepupChallengeId: 'ch-1', stepupCode: '123456' };

  test('rejectImpersonated is mounted on the reject route', () => {
    const adminRouter = require('../routes/admin');
    const handlers = [];
    for (const layer of adminRouter.stack || []) {
      if (!layer.route) continue;
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      if (paths.includes('/super/oxsteed-credit/withdrawals/:id/reject')) {
        handlers.push(...layer.route.stack.map((l) => l.handle));
      }
    }
    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers).toContain(rejectImpersonated);
  });

  test('no step-up proof: 403 and the withdrawal is not rejected', async () => {
    stepup.verifyStepupChallenge.mockRejectedValue(STEPUP_REQUIRED);
    const res = await request(buildApp()).post(url).set('Authorization', bearer()).send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('credit_stepup_challenge_required');
    expect(withdrawalService.rejectWithdrawal).not.toHaveBeenCalled();
  });

  test('fresh step-up bound to the withdrawal amount: reject runs', async () => {
    stepup.verifyStepupChallenge.mockResolvedValue({ verified: true });
    const res = await request(buildApp()).post(url).set('Authorization', bearer()).send(body);
    expect(res.status).toBe(200);
    expect(res.body.withdrawal).toEqual({ id: 'w-1', status: 'rejected' });
    expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: 'ch-1',
      actorUserId: 'admin-1',
      actionType: 'withdrawal',
      code: '123456',
      expectedAmountCents: 7500,
    }));
    expect(withdrawalService.rejectWithdrawal).toHaveBeenCalledWith(expect.objectContaining({
      withdrawalId: 'w-1',
      actorUserId: 'admin-1',
      reason: 'bad account',
    }));
  });

  test('amount pre-read failure fails closed with 503, nothing is rejected', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('COALESCE(totp_enabled')) {
        return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
      }
      if (text.includes('FROM oxsteed_credit_withdrawals')) throw new Error('db down');
      return { rows: [], rowCount: 0 };
    });
    stepup.verifyStepupChallenge.mockResolvedValue({ verified: true });
    const res = await request(buildApp()).post(url).set('Authorization', bearer()).send(body);
    expect(res.status).toBe(503);
    expect(stepup.verifyStepupChallenge).not.toHaveBeenCalled();
    expect(withdrawalService.rejectWithdrawal).not.toHaveBeenCalled();
  });
});
