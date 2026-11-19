'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));

const dualApproval = require('../services/dualApprovalService');
const controller = require('../controllers/affiliatePayoutsController');

beforeEach(() => {
  resetMocks();
  jest.spyOn(dualApproval, 'requestMoneyMovementApproval').mockResolvedValue({
    queued: true,
    approval: {
      id: 4,
      status: 'pending',
      amount_cents: 1400,
      movement_type: 'affiliate_payout',
      reference_key: 'affiliate-payout:9',
    },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('payout gate queues the payable net and binds the checker to it', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT ap\.\*/.test(sql)) {
      return {
        rows: [{
          id: 9,
          status: 'pending',
          helper_id: 'helper',
          net_payout_cents: 1400,
          total_commission_cents: 1500,
          processor_fee_cents: 100,
        }],
      };
    }
    return { rows: [] };
  });
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await controller.processPayout({
    user: { id: 'admin' },
    params: { payoutId: 9 },
    get: () => 'synthetic-payout-key',
    body: {},
  }, res, jest.fn());

  expect(dualApproval.requestMoneyMovementApproval).toHaveBeenCalledWith(expect.objectContaining({
    movementType: 'affiliate_payout',
    referenceKey: 'affiliate-payout:9',
    amountCents: 1400,
    payload: expect.objectContaining({ payoutId: 9, expectedAmountCents: 1400 }),
  }));
  expect(res.status).toHaveBeenCalledWith(202);
});

// All-launch flip (2026-11-04): the router gate and the client flag used
// to drift (client true while the API defaulted off, or vice versa),
// because no test ever mounted the real router. These cases pin the
// router gate itself: explicit false 503s, unset passes through.
describe('affiliatePayouts router gate (real router)', () => {
  const express = require('express');
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  const { errorHandler } = require('../middleware/errorHandler');

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/affiliate', require('../routes/affiliatePayouts'));
    app.use(errorHandler);
    return app;
  }

  function token() {
    return jwt.sign({ typ: 'access', sid: 'test-session',  id: 'user-123' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  }

  test('AFFILIATE_ENABLED=false returns 503 feature_disabled at the router gate', async () => {
    const previous = process.env.AFFILIATE_ENABLED;
    process.env.AFFILIATE_ENABLED = 'false';
    try {
      const res = await request(buildApp())
        .get('/api/affiliate')
        .set('Authorization', `Bearer ${token()}`);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('feature_disabled');
    } finally {
      if (previous === undefined) delete process.env.AFFILIATE_ENABLED;
      else process.env.AFFILIATE_ENABLED = previous;
    }
  });

  test('AFFILIATE_ENABLED unset passes the gate (default on after the all-launch flip)', async () => {
    const previous = process.env.AFFILIATE_ENABLED;
    delete process.env.AFFILIATE_ENABLED;
    try {
      // requireAuth looks the token's user up in the DB; the default mock
      // returns no user (401), so stub that lookup to reach the handler
      // and prove the gate itself passed.
      //
      // Classification (Domain 6 enforce fallout): the 403 here IS from
      // the helper gate. GET /api/affiliate runs requireHelperCapability
      // after requireAuth, and loadFacts found no grant for this user.
      // The stub below answers the gate's three fact queries with an
      // active helper.offer_services grant (legacy_backfill provenance,
      // as the backfill writes), so the test keeps proving the
      // AFFILIATE_ENABLED router gate, not access.
      mockQuery.mockImplementation(async (sql) => {
        if (/FROM users u/.test(sql)) return { rows: [{ id: 'user-123', is_active: true, id_verified: true, terms_accepted: true, terms_accepted_at: new Date(), terms_version: 'test-v1' }] };
        if (/FROM users WHERE id/.test(sql)) return { rows: [{ id: 'user-123', is_active: true, id_verified: true, terms_accepted: true, terms_accepted_at: new Date(), terms_version: 'test-v1' }] };
        if (/FROM access_grants/.test(sql)) {
          return { rows: [{ id: 1, capability: 'helper.offer_services', subject_type: 'self', subject_id: null, status: 'active', expires_at: null, provenance: 'legacy_backfill', version: 1 }] };
        }
        if (/FROM businesses b/.test(sql)) return { rows: [] };
        return { rows: [], rowCount: 0 };
      });
      const res = await request(buildApp())
        .get('/api/affiliate')
        .set('Authorization', `Bearer ${token()}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, data: [] });
    } finally {
      if (previous === undefined) delete process.env.AFFILIATE_ENABLED;
      else process.env.AFFILIATE_ENABLED = previous;
    }
  });
});
