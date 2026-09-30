'use strict';

// Fraud-case ingestion wiring tests (no live DB; pool and Stripe are mocked).
//
// Covers:
//  - fraudCaseService.createFraudCase: insert path, subject+category dedupe,
//    source_ref dedupe, validation, explicit db handle.
//  - webhookController: charge.dispute.created creates a case,
//    charge.dispute.updated merges evidence without duplicating,
//    unresolvable subjects skip case creation.
//  - userReportController: fraud-type reports create abuse_report cases.
//  - affiliateAntiFraudService: flags create affiliate_fraud cases.

const { mockQuery, resetMocks } = require('./setup');

// Mocked for controller/service-level tests; the real implementation is
// reached through jest.requireActual in the service describe block.
jest.mock('../services/fraudCaseService', () => ({
  createFraudCase: jest.fn(),
}));

jest.mock('../services/localDeliveryPaymentService', () => ({
  handleStripeEvent: jest.fn().mockResolvedValue({ handled: false }),
}));

const express = require('express');
const request = require('supertest');
const stripe = require('stripe')();

const { createFraudCase: mockedCreateFraudCase } = require('../services/fraudCaseService');
const actualFraudCaseService = jest.requireActual('../services/fraudCaseService');
const webhookRoutes = require('../routes/webhook');
const userReportController = require('../controllers/userReportController');
const affiliateAntiFraudService = require('../services/affiliateAntiFraudService');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

// ── fraudCaseService (real implementation, mocked pool) ─────────────────────
describe('createFraudCase', () => {
  const base = {
    subjectType: 'user',
    subjectId: 'user-1',
    category: 'chargeback',
    severity: 'high',
    source: 'stripe_webhook',
  };

  test('inserts a new case when no open case exists', async () => {
    const newRow = { id: 'case-new', ...base, status: 'open', source_ref: 'dp_1' };
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // source_ref dedupe miss
      .mockResolvedValueOnce({ rows: [] }) // subject+category dedupe miss
      .mockResolvedValueOnce({ rows: [newRow] }); // insert

    const row = await actualFraudCaseService.createFraudCase({
      ...base,
      sourceRef: 'dp_1',
      summary: 'dispute',
      evidence: { dispute_id: 'dp_1' },
    });

    expect(row).toEqual(newRow);
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const insertCall = mockQuery.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO fraud_cases');
    expect(insertCall[1]).toEqual([
      'user',
      'user-1',
      'chargeback',
      'high',
      'stripe_webhook',
      'dp_1',
      'dispute',
      JSON.stringify({ dispute_id: 'dp_1' }),
    ]);
  });

  test('dedupes on same subject+category without inserting', async () => {
    const existing = { id: 'case-existing', ...base, status: 'open' };
    mockQuery.mockResolvedValueOnce({ rows: [existing] });

    const row = await actualFraudCaseService.createFraudCase(base);

    expect(row).toEqual(existing);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain('subject_type');
    expect(mockQuery.mock.calls[0][1]).toEqual(['user', 'user-1', 'chargeback', ['open', 'investigating']]);
  });

  test('dedupes on source_ref even for a different subject+category', async () => {
    const existing = { id: 'case-by-ref', ...base, status: 'investigating' };
    mockQuery.mockResolvedValueOnce({ rows: [existing] });

    const row = await actualFraudCaseService.createFraudCase({
      ...base,
      subjectId: 'user-2',
      category: 'other',
      sourceRef: 'dp_9',
    });

    expect(row).toEqual(existing);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain('source_ref');
    expect(mockQuery.mock.calls[0][1][0]).toBe('dp_9');
  });

  test('rejects invalid enums and missing subjectId before any query', async () => {
    await expect(actualFraudCaseService.createFraudCase({ ...base, severity: 'extreme' }))
      .rejects.toThrow('Invalid severity');
    await expect(actualFraudCaseService.createFraudCase({ ...base, category: 'scam' }))
      .rejects.toThrow('Invalid category');
    await expect(actualFraudCaseService.createFraudCase({ ...base, subjectId: null }))
      .rejects.toThrow('subjectId is required');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('honors an explicit db handle instead of the default pool', async () => {
    const newRow = { id: 'case-explicit', ...base, status: 'open' };
    const fakeDb = { query: jest.fn() };
    fakeDb.query
      .mockResolvedValueOnce({ rows: [] }) // no sourceRef: subject+category dedupe miss
      .mockResolvedValueOnce({ rows: [newRow] }); // insert

    const row = await actualFraudCaseService.createFraudCase({ ...base, db: fakeDb });

    expect(row).toEqual(newRow);
    expect(fakeDb.query).toHaveBeenCalledTimes(2);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ── webhookController: charge.dispute.* ──────────────────────────────────────
describe('stripe webhook charge disputes', () => {
  function buildApp() {
    const app = express();
    app.use('/api/webhooks', webhookRoutes);
    return app;
  }

  function sendEvent(app, eventObj) {
    stripe.webhooks.constructEvent.mockReturnValueOnce(eventObj);
    return request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'test-sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(eventObj));
  }

  function disputeEvent(overrides = {}) {
    return {
      id: 'evt_dispute_1',
      type: 'charge.dispute.created',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'dp_1',
          amount: 2500,
          currency: 'usd',
          reason: 'fraudulent',
          status: 'needs_response',
          charge: 'ch_123',
          payment_intent: 'pi_123',
          ...overrides,
        },
      },
    };
  }

  // Receipt insert + watermark insert so the event is processed; the third
  // queued query answers the payments-table subject lookup.
  function mockReceiptWithPayer(payerId) {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 101 }] })
      .mockResolvedValueOnce({ rows: [{ event_id: 'evt_dispute_1' }] })
      .mockResolvedValueOnce({ rows: payerId ? [{ payer_id: payerId }] : [] });
  }

  test('charge.dispute.created creates a chargeback case', async () => {
    mockReceiptWithPayer('user-999');
    mockedCreateFraudCase.mockResolvedValue({ id: 'case-1' });

    const response = await sendEvent(buildApp(), disputeEvent());

    expect(response.status).toBe(200);
    expect(mockedCreateFraudCase).toHaveBeenCalledTimes(1);
    expect(mockedCreateFraudCase).toHaveBeenCalledWith(expect.objectContaining({
      subjectType: 'user',
      subjectId: 'user-999',
      category: 'chargeback',
      severity: 'high',
      source: 'stripe_webhook',
      sourceRef: 'dp_1',
    }));
    const evidence = mockedCreateFraudCase.mock.calls[0][0].evidence;
    expect(evidence).toEqual(expect.objectContaining({ dispute_id: 'dp_1', status: 'needs_response' }));
    // The real service is mocked, so creation must not issue a raw INSERT here.
    expect(mockQuery.mock.calls.some((c) => c[0].includes('INSERT INTO fraud_cases'))).toBe(false);
  });

  test('charge.dispute.updated merges evidence without creating a duplicate', async () => {
    mockReceiptWithPayer('user-999');
    mockedCreateFraudCase.mockResolvedValue({ id: 'case-1' });

    const event = disputeEvent({ status: 'lost' });
    event.type = 'charge.dispute.updated';
    const response = await sendEvent(buildApp(), event);

    expect(response.status).toBe(200);
    expect(mockedCreateFraudCase).toHaveBeenCalledTimes(1);
    expect(mockedCreateFraudCase).toHaveBeenCalledWith(expect.objectContaining({
      sourceRef: 'dp_1',
      category: 'chargeback',
    }));
    // No duplicate insert; instead an evidence merge on the existing case.
    expect(mockQuery.mock.calls.some((c) => c[0].includes('INSERT INTO fraud_cases'))).toBe(false);
    const updateCall = mockQuery.mock.calls.find((c) => c[0].includes('UPDATE fraud_cases'));
    expect(updateCall).toBeDefined();
    expect(updateCall[1][0]).toContain('escalation_note');
    expect(updateCall[1][1]).toBe('case-1');
  });

  test('skips case creation when no subject mapping exists', async () => {
    mockReceiptWithPayer(null);

    const response = await sendEvent(buildApp(), disputeEvent());

    expect(response.status).toBe(200);
    expect(mockedCreateFraudCase).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some((c) => c[0].includes('fraud_cases'))).toBe(false);
  });
});

// ── userReportController: fraud reports ───────────────────────────────────────
describe('fraud-type user reports', () => {
  function mockReqRes(body) {
    return {
      req: { body, user: { id: 'reporter-1' } },
      res: { json: jest.fn(), status: jest.fn().mockReturnThis() },
      next: jest.fn(),
    };
  }

  test('fraud report creates a critical abuse_report case', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // duplicate-report check
      .mockResolvedValueOnce({ rows: [{ id: 42, report_type: 'fraud', status: 'open', severity: 'critical', created_at: '2026-09-29' }] });
    const { req, res, next } = mockReqRes({
      reportedUserId: 'user-bad',
      bookingId: 'booking-1',
      reportType: 'fraud',
      description: 'This user committed clear payment fraud on my booking.',
    });

    await userReportController.submitReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reportId: 42 }));
    expect(mockedCreateFraudCase).toHaveBeenCalledTimes(1);
    expect(mockedCreateFraudCase).toHaveBeenCalledWith(expect.objectContaining({
      subjectType: 'user',
      subjectId: 'user-bad',
      category: 'abuse_report',
      severity: 'critical',
      source: 'user_report',
      sourceRef: 'user_report:42',
    }));
  });

  test('non-fraud reports do not create cases', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 43, report_type: 'other', status: 'open', severity: 'low', created_at: '2026-09-29' }] });
    const { req, res, next } = mockReqRes({
      reportedUserId: 'user-2',
      bookingId: 'booking-2',
      reportType: 'other',
      description: 'Just a general issue with communication here.',
    });

    await userReportController.submitReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockedCreateFraudCase).not.toHaveBeenCalled();
  });
});

// ── affiliateAntiFraudService: flags create cases ─────────────────────────────
describe('affiliate anti-fraud flags', () => {
  function mockOrderQueries(order, { count = '1', commissionTotal = '100', refunded = false } = {}) {
    mockQuery
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ count }] })
      .mockResolvedValueOnce({ rows: [{ total: commissionTotal }] })
      .mockResolvedValueOnce({ rows: refunded ? [{ id: 'o1', refund_date: '2026-09-29' }] : [] });
  }

  test('self-purchase flag creates a critical affiliate_fraud case', async () => {
    mockOrderQueries({
      id: 'order-1', customer_id: 'aff-1', amount_cents: 10000,
      created_at: '2026-09-29', ip_address: null,
    });

    const result = await affiliateAntiFraudService.detectAffiliateeFraud('order-1', 'aff-1');

    expect(result.fraud_risk).toBe('HIGH');
    expect(result.should_block).toBe(true);
    expect(mockedCreateFraudCase).toHaveBeenCalledTimes(1);
    expect(mockedCreateFraudCase).toHaveBeenCalledWith(expect.objectContaining({
      subjectType: 'user',
      subjectId: 'aff-1',
      category: 'affiliate_fraud',
      severity: 'critical',
      source: 'auto_rule',
      sourceRef: 'affiliate_fraud:aff-1:order-1',
    }));
    expect(mockedCreateFraudCase.mock.calls[0][0].evidence.flags).toEqual(
      expect.arrayContaining([expect.objectContaining({ flag: 'self_purchase' })])
    );
  });

  test('flag severity follows the highest flag severity', async () => {
    mockOrderQueries(
      { id: 'order-2', customer_id: 'cust-9', amount_cents: 10000, created_at: '2026-09-29', ip_address: null },
      { count: '9' } // rapid_orders, severity high
    );

    const result = await affiliateAntiFraudService.detectAffiliateeFraud('order-2', 'aff-1');

    expect(result.fraud_risk).toBe('HIGH');
    expect(mockedCreateFraudCase).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'high',
      category: 'affiliate_fraud',
    }));
  });

  test('clean orders create no case', async () => {
    mockOrderQueries({
      id: 'order-3', customer_id: 'cust-9', amount_cents: 10000,
      created_at: '2026-09-29', ip_address: null,
    });

    const result = await affiliateAntiFraudService.detectAffiliateeFraud('order-3', 'aff-1');

    expect(result.fraud_risk).toBe('LOW');
    expect(mockedCreateFraudCase).not.toHaveBeenCalled();
  });

  test('detection result survives fraud-case creation failure', async () => {
    mockOrderQueries({
      id: 'order-4', customer_id: 'aff-1', amount_cents: 10000,
      created_at: '2026-09-29', ip_address: null,
    });
    mockedCreateFraudCase.mockRejectedValueOnce(new Error('db down'));

    const result = await affiliateAntiFraudService.detectAffiliateeFraud('order-4', 'aff-1');

    expect(result.fraud_risk).toBe('HIGH');
    expect(result.flags).toHaveLength(1);
  });
});
