'use strict';

/**
 * Domain 7 #19 (2026-11-11 admin-ops audit): the settlement-payout and
 * withdrawal-approve amount pre-reads are wrapped in try/catch that logs a
 * warning and proceeds with the expected amount null, so
 * verifyStepupChallenge runs with no expectedAmountCents. The challenge
 * still proves fresh auth and the checker re-binds at decision time, but
 * the failure mode is fail-open on the binding. Fix: return 503 instead of
 * proceeding unbound when the amount pre-read errors.
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

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

const stepup = require('../services/stepupChallengeService');
const { requestPendingAction } = require('../services/oxsteedCreditPendingActionService');

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

const QUEUED = { executed: false, replayed: false, pendingAction: { id: 'pa-1', status: 'pending' } };
const STEPUP_BODY = { stepupChallengeId: 'ch-1', stepupCode: '123456' };

function mockAuthQuery() {
  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('COALESCE(totp_enabled')) {
      return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockAuthQuery();
  requestPendingAction.mockResolvedValue(QUEUED);
  stepup.verifyStepupChallenge.mockResolvedValue({ verified: true });
});

describe('Domain 7 #19: settlement payout amount pre-read', () => {
  const url = '/api/admin/super/oxsteed-credit/settlements/set-1/payout';

  test('pre-read failure fails closed with 503; step-up is never verified unbound', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('COALESCE(totp_enabled')) {
        return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
      }
      if (text.includes('FROM oxsteed_credit_settlements')) throw new Error('db down');
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp()).post(url).set('Authorization', bearer()).send(STEPUP_BODY);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('credit_stepup_amount_preread_failed');
    expect(stepup.verifyStepupChallenge).not.toHaveBeenCalled();
    expect(requestPendingAction).not.toHaveBeenCalled();
  });

  test('pre-read success still binds the step-up to net_cents and queues', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('COALESCE(totp_enabled')) {
        return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
      }
      if (text.includes('FROM oxsteed_credit_settlements')) {
        return { rows: [{ net_cents: 42000 }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp()).post(url).set('Authorization', bearer()).send(STEPUP_BODY);
    expect(res.status).toBe(202);
    expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'settlement_payout',
      expectedAmountCents: 42000,
    }));
    expect(requestPendingAction).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'credit_settlement_payout',
    }));
  });
});

describe('Domain 7 #19: withdrawal approve amount pre-read', () => {
  const url = '/api/admin/super/oxsteed-credit/withdrawals/w-1/approve';

  test('pre-read failure fails closed with 503; step-up is never verified unbound', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('COALESCE(totp_enabled')) {
        return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
      }
      if (text.includes('FROM oxsteed_credit_withdrawals')) throw new Error('db down');
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp()).post(url).set('Authorization', bearer()).send(STEPUP_BODY);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('credit_stepup_amount_preread_failed');
    expect(stepup.verifyStepupChallenge).not.toHaveBeenCalled();
    expect(requestPendingAction).not.toHaveBeenCalled();
  });

  test('pre-read success still binds the step-up to amount_cents and queues', async () => {
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
    const res = await request(buildApp()).post(url).set('Authorization', bearer()).send(STEPUP_BODY);
    expect(res.status).toBe(202);
    expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'withdrawal',
      expectedAmountCents: 7500,
    }));
    expect(requestPendingAction).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'credit_withdrawal_approval',
    }));
  });
});
