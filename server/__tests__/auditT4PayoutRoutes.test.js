'use strict';

/**
 * Audit T4 (items 15 & 20) — payout route guards.
 *
 * Item 15: POST /api/payouts/:payout_id/process moves affiliate money on a
 * single admin's say-so. It now mounts rejectImpersonated and verifies a
 * fresh maker step-up challenge (actionType 'affiliate_payout_process')
 * before PayoutController.processPayout runs.
 *
 * Item 20: helper payout-method create/update/delete is the classic
 * account-takeover payout-redirection vector. The write routes now require
 * a fresh TOTP proof (requireUserTotpStepUp), fail closed when TOTP is not
 * enrolled.
 */

const fs = require('fs');
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { encrypt } = require('../utils/encryption');
const { authenticator } = require('@otplib/v12-adapter');
const { requireUserTotpStepUp } = require('../middleware/requireUserTotpStepUp');

const ROUTE_SRC = fs.readFileSync(require.resolve('../routes/payoutRoutes.js'), 'utf8');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  resetMocks();
  authenticator.verify.mockReset();
  authenticator.verify.mockReturnValue(true);
});

describe('item 15: affiliate payout process route wiring', () => {
  test('process route mounts rejectImpersonated', () => {
    const at = ROUTE_SRC.indexOf('/:payout_id/process');
    expect(at).toBeGreaterThan(-1);
    const block = ROUTE_SRC.slice(at, at + 400);
    expect(block).toContain('requireAdmin');
    expect(block).toContain('rejectImpersonated');
    expect(block).toContain('view_financials');
  });
  test('process route verifies a maker step-up before processPayout', () => {
    const at = ROUTE_SRC.indexOf('/:payout_id/process');
    expect(at).toBeGreaterThan(-1);
    const block = ROUTE_SRC.slice(at, at + 1200);
    expect(block).toContain('verifyStepupChallenge');
    expect(block).toContain('affiliate_payout_process');
    expect(block).toContain('PayoutController.processPayout');
  });
});

describe('item 15: maker step-up enforced on /:payout_id/process', () => {
  const verifyStepupChallenge = jest.fn();
  const processPayout = jest.fn();

  function buildApp() {
    jest.resetModules();
    jest.doMock('../middleware/auth', () => ({
      requireAuth: (req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); },
    }));
    jest.doMock('../middleware/adminAuth', () => ({
      requireAdmin: (req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); },
      requirePermission: () => (req, res, next) => next(),
    }));
    jest.doMock('../middleware/rejectImpersonated', () => ({
      rejectImpersonated: (req, res, next) => next(),
    }));
    jest.doMock('../middleware/requireUserTotpStepUp', () => ({
      requireUserTotpStepUp: (req, res, next) => next(),
    }));
    jest.doMock('../middleware/rateLimiter', () => ({
      strictLimiter: (req, res, next) => next(),
    }));
    jest.doMock('../middleware/helperOnboardingMiddleware', () => ({
      requireOnboardingStep: () => (req, res, next) => next(),
    }));
    jest.doMock('../services/stepupChallengeService', () => ({
      verifyStepupChallenge,
    }));
    jest.doMock('../controllers/PayoutController', () => ({
      getPayoutMethods: jest.fn(),
      createPayoutMethod: jest.fn(),
      updatePayoutMethod: jest.fn(),
      deletePayoutMethod: jest.fn(),
      getPayouts: jest.fn(),
      getPayout: jest.fn(),
      getPayoutStats: jest.fn(),
      processPayout,
    }));
    jest.doMock('../controllers/AffiliateAnalyticsController', () => ({
      getMetricsTimeSeries: jest.fn(),
      getConversionFunnel: jest.fn(),
      getTopProducts: jest.fn(),
      getProductAnalytics: jest.fn(),
      getVisitorFunnel: jest.fn(),
      getSourceBreakdown: jest.fn(),
    }));

    const payoutRoutes = require('../routes/payoutRoutes');
    const app = express();
    app.use(express.json());
    app.use('/api/payouts', payoutRoutes);
    // map AppError-style throws to their status codes
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
    });
    return app;
  }

  beforeEach(() => {
    verifyStepupChallenge.mockReset();
    processPayout.mockReset();
  });

  test('no step-up challenge -> 403 and processPayout never runs', async () => {
    const err = new Error('A step-up verification code is required for this action');
    err.statusCode = 403;
    err.code = 'credit_stepup_challenge_required';
    verifyStepupChallenge.mockRejectedValue(err);
    processPayout.mockImplementation((req, res) => res.json({ ok: true }));

    const res = await request(buildApp())
      .post('/api/payouts/payout-1/process')
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('credit_stepup_challenge_required');
    expect(verifyStepupChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        actionType: 'affiliate_payout_process',
      })
    );
    expect(processPayout).not.toHaveBeenCalled();
  });

  test('verified step-up -> processPayout runs', async () => {
    verifyStepupChallenge.mockResolvedValue({ verified: true });
    processPayout.mockImplementation((req, res) => res.json({ ok: true }));

    const res = await request(buildApp())
      .post('/api/payouts/payout-1/process')
      .send({ stepupChallengeId: 'c1', stepupCode: '123456' });

    expect(verifyStepupChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: 'c1',
        actorUserId: 'admin-1',
        actionType: 'affiliate_payout_process',
        code: '123456',
      })
    );
    expect(processPayout).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });
});

describe('item 20: payout-method write routes require fresh TOTP step-up', () => {
  test.each([['post', "'/payout-methods'"], ['put', "'/payout-methods/:method_id'"], ['delete', "'/payout-methods/:method_id'"]])(
    '%s %s mounts requireUserTotpStepUp',
    (method, path) => {
      const re = new RegExp(`router\\.${method}\\(\\s*${path.replace(/[/:]/g, (c) => `\\${c}`)}[^;]*requireUserTotpStepUp`, 's');
      expect(ROUTE_SRC).toMatch(re);
    }
  );

  test('read route stays open (no step-up)', () => {
    const line = ROUTE_SRC.split('\n').find((l) => l.includes("router.get('/payout-methods'"));
    expect(line).not.toMatch(/requireUserTotpStepUp/);
  });
});

describe('item 20: requireUserTotpStepUp middleware', () => {
  const enrolledRow = () => ({
    totp_secret: encrypt('TESTSECRET'),
    totp_enabled: true,
  });

  const run = (req) =>
    new Promise((resolve) => {
      const res = mockRes();
      res.status.mockImplementation((code) => {
        res.statusCode = code;
        return res;
      });
      res.json.mockImplementation((body) => {
        resolve({ blocked: true, status: res.statusCode, body });
        return res;
      });
      const next = jest.fn(() => resolve({ blocked: false, next }));
      requireUserTotpStepUp(req, res, next);
    });

  test('401 when unauthenticated', async () => {
    const out = await run({ body: {} });
    expect(out.blocked).toBe(true);
    expect(out.status).toBe(401);
  });

  test('403 totp_stepup_required when TOTP is not enrolled', async () => {
    mockQuery.mockResolvedValue({ rows: [{ totp_secret: null, totp_enabled: false }] });
    const out = await run({ user: { id: 'u1' }, body: { totp_code: '123456' } });
    expect(out.blocked).toBe(true);
    expect(out.status).toBe(403);
    expect(out.body.code).toBe('totp_stepup_required');
  });

  test('403 totp_stepup_required when no code is presented', async () => {
    mockQuery.mockResolvedValue({ rows: [enrolledRow()] });
    const out = await run({ user: { id: 'u1' }, body: {} });
    expect(out.blocked).toBe(true);
    expect(out.status).toBe(403);
    expect(out.body.code).toBe('totp_stepup_required');
    expect(authenticator.verify).not.toHaveBeenCalled();
  });

  test('403 totp_stepup_invalid when the code is wrong', async () => {
    authenticator.verify.mockReturnValue(false);
    mockQuery.mockResolvedValue({ rows: [enrolledRow()] });
    const out = await run({ user: { id: 'u1' }, body: { totp_code: '000000' } });
    expect(out.blocked).toBe(true);
    expect(out.status).toBe(403);
    expect(out.body.code).toBe('totp_stepup_invalid');
  });

  test('passes through on a valid fresh code', async () => {
    mockQuery.mockResolvedValue({ rows: [enrolledRow()] });
    const out = await run({ user: { id: 'u1' }, body: { totpCode: '123456' } });
    expect(out.blocked).toBe(false);
    expect(out.next).toHaveBeenCalledTimes(1);
    expect(authenticator.verify).toHaveBeenCalledWith(
      expect.objectContaining({ secret: 'TESTSECRET', token: '123456' })
    );
  });
});
