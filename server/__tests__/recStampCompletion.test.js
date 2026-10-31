'use strict';

// Recommendation track 7: service-layer request-context convention for audit
// stamps (auth audit finding 35 completion).
//
// Proves the convention end to end with mocked dependencies:
//  - logUserAction stamps impersonated_by (value when impersonated, NULL
//    for direct sessions).
//  - reservePaymentRefund stamps the refund attempt the same way.
//  - cancelJobTransaction stamps the cancellation audit row AND forwards
//    req to the agent audit (logAdminAction) for admin cancels.
//  - captureAuthorizedPayment forwards req to the capture audit.
// Direct sessions, system jobs and workers pass no req, so their stamps
// stay NULL, byte-identical to before.

const { mockQuery, resetMocks } = require('./setup');

const mockCapture = jest.fn();
// paymentCaptureService constructs `new Stripe(...)`; the mock must be a
// constructor, unlike the factory-style mock paymentRefundService uses.
jest.mock('stripe', () => jest.fn(() => ({
  paymentIntents: { retrieve: jest.fn(), cancel: jest.fn(), capture: mockCapture },
  refunds: { create: jest.fn(), retrieve: jest.fn() },
  charges: { retrieve: jest.fn() },
})));
jest.mock('../growth/emit', () => ({
  emitDomainEvent: jest.fn().mockResolvedValue(undefined),
  jobEventProps: jest.fn((job) => ({ job_id: job.id })),
}));

const auditService = require('../services/auditService');
const refundService = require('../services/paymentRefundService');
const cancelService = require('../services/jobCancellationService');
const captureService = require('../services/paymentCaptureService');

const ADMIN = '00000000-0000-4000-8000-000000000101';
const VICTIM = '00000000-0000-4000-8000-000000000102';
const IMPERSONATOR = '00000000-0000-4000-8000-000000000103';

beforeEach(() => {
  resetMocks();
  mockCapture.mockReset();
});

function route(handlers) {
  mockQuery.mockImplementation(async (sql) => {
    const t = String(sql);
    for (const [re, v] of handlers) {
      if (re.test(t)) return typeof v === 'function' ? v() : v;
    }
    return { rows: [] };
  });
}

describe('logUserAction impersonated_by stamp', () => {
  test('stamps the impersonating admin when given', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, created_at: new Date() }] });
    await auditService.logUserAction({
      adminId: ADMIN,
      targetUserId: VICTIM,
      actionType: 'edit_email',
      impersonatedBy: IMPERSONATOR,
    });
    const [, params] = mockQuery.mock.calls.find(([s]) => /INSERT INTO admin_user_action_log/.test(s));
    expect(params[9]).toBe(IMPERSONATOR);
  });

  test('stamps NULL for direct sessions', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, created_at: new Date() }] });
    await auditService.logUserAction({
      adminId: ADMIN,
      targetUserId: VICTIM,
      actionType: 'edit_email',
    });
    const [, params] = mockQuery.mock.calls.find(([s]) => /INSERT INTO admin_user_action_log/.test(s));
    expect(params[9]).toBeNull();
  });
});

describe('reservePaymentRefund impersonated_by stamp', () => {
  const captured = {
    id: 9, job_id: 'j', status: 'captured', amount: '20.00',
    refunded_amount: '0', stripe_payment_intent_id: 'pi_9', stripe_account_id: 'acct_h',
  };
  function refundRoutes() {
    route([
      [/FROM payment_refund_attempts WHERE idempotency_key/, { rows: [] }],
      [/FROM payments WHERE id/, { rows: [captured] }],
      [/FROM disputes/, { rows: [] }],
      [/INSERT INTO payment_refund_attempts/, { rows: [{ id: 1, status: 'pending' }] }],
    ]);
  }

  test('stamps the impersonating admin on the attempt', async () => {
    refundRoutes();
    await refundService.reservePaymentRefund({
      paymentId: 9, requestId: 'request-0001', actorUserId: VICTIM,
      requestedAmountCents: 500, req: { impersonatedBy: IMPERSONATOR },
    });
    const [, params] = mockQuery.mock.calls.find(([s]) => /INSERT INTO payment_refund_attempts/.test(s));
    expect(params[7]).toBe(IMPERSONATOR);
  });

  test('stamps NULL without a request context', async () => {
    refundRoutes();
    await refundService.reservePaymentRefund({
      paymentId: 9, requestId: 'request-0001', actorUserId: VICTIM,
      requestedAmountCents: 500,
    });
    const [, params] = mockQuery.mock.calls.find(([s]) => /INSERT INTO payment_refund_attempts/.test(s));
    expect(params[7]).toBeNull();
  });
});

describe('cancelJobTransaction impersonated_by stamps', () => {
  const job = {
    id: 'job-1', status: 'accepted', client_id: 'client-1',
    assigned_helper_id: 'helper-1', scheduled_date: new Date(Date.now() + 86400000 * 5),
  };
  function cancelRoutes() {
    route([
      [/SELECT \* FROM jobs WHERE id/, { rows: [job] }],
      [/SELECT \* FROM bids WHERE job_id/, { rows: [{ id: 'b1', payment_method: 'card', cancellation_policy: {} }] }],
      [/UPDATE jobs SET/, { rows: [{ id: 'job-1' }] }],
      [/UPDATE appointments SET/, { rows: [] }],
      [/INSERT INTO cancellation_audit_log/, { rows: [{ id: 7 }] }],
    ]);
  }

  test('admin cancel stamps the audit row and the agent audit', async () => {
    cancelRoutes();
    const result = await cancelService.cancelJobTransaction({
      jobId: 'job-1', actorId: ADMIN, actorKind: 'admin',
      reason: 'test cancel', req: { impersonatedBy: IMPERSONATOR },
    });
    expect(result.type).toBe('post_acceptance');
    const [, cancelParams] = mockQuery.mock.calls.find(([s]) => /INSERT INTO cancellation_audit_log/.test(s));
    expect(cancelParams[10]).toBe(IMPERSONATOR);
    const [, adminParams] = mockQuery.mock.calls.find(([s]) => /INSERT INTO admin_audit_log/.test(s));
    expect(adminParams[10]).toBe(IMPERSONATOR);
  });

  test('direct cancel stamps NULL on both rows', async () => {
    cancelRoutes();
    await cancelService.cancelJobTransaction({
      jobId: 'job-1', actorId: ADMIN, actorKind: 'admin', reason: 'test cancel',
    });
    const [, cancelParams] = mockQuery.mock.calls.find(([s]) => /INSERT INTO cancellation_audit_log/.test(s));
    expect(cancelParams[10]).toBeNull();
    const [, adminParams] = mockQuery.mock.calls.find(([s]) => /INSERT INTO admin_audit_log/.test(s));
    expect(adminParams[10]).toBeNull();
  });
});

describe('captureAuthorizedPayment req forwarding', () => {
  const payment = {
    id: 9, job_id: 'j1', stripe_payment_intent_id: 'pi_9', stripe_account_id: 'acct_h',
    status: 'authorized', capture_amount_cents: null, pending_increase_cents: null,
    charge_model: null, destination_account_id: null, currency: 'USD',
    amount: 2000, platform_fee: 0, metadata: {},
  };
  function captureRoutes() {
    mockCapture.mockResolvedValue({ charges: { data: [{ id: 'ch_1' }] } });
    route([
      [/FROM payments WHERE id/, { rows: [payment] }],
      [/FROM disputes/, { rows: [] }],
      [/UPDATE payments/, { rows: [] }],
    ]);
  }

  test('forwards the impersonating admin to the capture audit', async () => {
    captureRoutes();
    const r = await captureService.captureAuthorizedPayment({
      paymentId: 9, jobId: 'j1', actorUserId: VICTIM,
      req: { impersonatedBy: IMPERSONATOR },
    });
    expect(r.success).toBe(true);
    const [, params] = mockQuery.mock.calls.find(([s]) => /INSERT INTO admin_audit_log/.test(s));
    expect(params[10]).toBe(IMPERSONATOR);
  });

  test('passes NULL req for system captures', async () => {
    captureRoutes();
    await captureService.captureAuthorizedPayment({
      paymentId: 9, jobId: 'j1', actorUserId: VICTIM,
    });
    const [, params] = mockQuery.mock.calls.find(([s]) => /INSERT INTO admin_audit_log/.test(s));
    expect(params[10]).toBeNull();
  });
});
