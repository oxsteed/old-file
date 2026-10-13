'use strict';

// Review W6: P3-1067, P3-1069, P3-1070, P3-1071.
const { mockQuery, resetMocks } = require('./setup');
const stripeMock = require('stripe').__mockInstance;
const svc = require('../services/consultingPaymentService');
const paymentCtrl = require('../controllers/consultingPaymentController');
const adminCtrl = require('../controllers/adminConsultingController');
const phasesCtrl = require('../controllers/allPhasesConsultingController');

function res() {
  const r = { statusCode: 200 };
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((b) => { r.body = b; return r; });
  return r;
}
const pi = (over = {}) => ({ id: 'pi_1', status: 'succeeded', amount: 10000, amount_received: 10000, currency: 'usd', metadata: { consulting_payment: 'true' }, ...over });

beforeEach(() => {
  resetMocks();
  stripeMock.paymentIntents.retrieve.mockReset();
  stripeMock.paymentIntents.create.mockReset();
});

describe('completeConsultingPaymentFromIntent', () => {
  test('completes a matching processing payment', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, amount_cents: 10000, status: 'processing' }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, status: 'completed', session_scheduled_id: 3 }] });
    const r = await svc.completeConsultingPaymentFromIntent(pi());
    expect(r.status).toBe('completed');
    expect(mockQuery.mock.calls[1][0]).toMatch(/status IN \('pending', 'processing'\)/);
  });
  test('rejects amount mismatch', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, amount_cents: 10000 }] });
    expect((await svc.completeConsultingPaymentFromIntent(pi({ amount_received: 100 }))).status).toBe('mismatch');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
  test('webhook ignores PaymentIntents that are not consulting', async () => {
    expect(await svc.applyConsultingPaymentWebhookEvent({ type: 'payment_intent.succeeded', object: pi({ metadata: {} }) })).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
  test('webhook completes a consulting purchase only at the stored amount (P3-1071)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const handled = await svc.applyConsultingPaymentWebhookEvent({ type: 'payment_intent.succeeded', object: pi({ metadata: { consulting_purchase_id: '5' } }) });
    expect(handled).toBe(true);
    expect(mockQuery.mock.calls[0][0]).toMatch(/total_cost_cents = \$3/);
    expect(mockQuery.mock.calls[0][1]).toEqual([5, 'pi_1', 10000, 'usd']);
  });
});

describe('confirmPayment contract (P3-1067)', () => {
  test('accepts paymentId alone and resolves the intent server-side', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1', amount_cents: 10000, stripe_payment_intent_id: 'pi_1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, amount_cents: 10000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, status: 'completed' }] });
    stripeMock.paymentIntents.retrieve.mockResolvedValueOnce(pi());
    const r = res();
    await paymentCtrl.confirmPayment({ user: { id: 'u1', role: 'customer' }, body: { paymentId: 7 } }, r);
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1');
    expect(r.body.status).toBe('completed');
  });
  test('rejects a mismatched intent id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1', stripe_payment_intent_id: 'pi_1' }] });
    const r = res();
    await paymentCtrl.confirmPayment({ user: { id: 'u1' }, body: { paymentId: 7, stripePaymentIntentId: 'pi_other' } }, r);
    expect(r.statusCode).toBe(404);
  });
});

describe('admin mark paid (P3-1070)', () => {
  test('marks a sent invoice paid and records a completed session payment', async () => {
    const pool = require('../db');
    const r = res();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 9, status: 'paid', session_scheduled_id: 3, amount_cents: 5000, service_tier: 'initial' }] })
      .mockResolvedValueOnce({ rows: [{ id: 44 }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({}); // COMMIT
    await adminCtrl.markInvoicePaid({ params: { invoiceId: '9' }, body: { method: 'check', reference: 'CHK-1' }, user: { id: 'a1' } }, r);
    expect(pool.connect).toHaveBeenCalled();
    expect(r.body.consulting_payment_id).toBe(44);
    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO consulting_payments/.test(sql));
    expect(insert[1]).toEqual([3, 5000, 'initial', 'off_platform_check']);
  });
  test('rejects unknown methods', async () => {
    const r = res();
    await adminCtrl.markInvoicePaid({ params: { invoiceId: '9' }, body: { method: 'iou' }, user: { id: 'a1' } }, r);
    expect(r.statusCode).toBe(400);
  });
});

describe('purchasePackage (P3-1071)', () => {
  test('creates a pending purchase and a PaymentIntent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 2, price_cents: 50000, name: 'Foundation' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 11 }] })
      .mockResolvedValueOnce({ rows: [] });
    stripeMock.paymentIntents.create.mockResolvedValueOnce({ id: 'pi_9', client_secret: 'sec' });
    const r = res();
    await phasesCtrl.purchasePackage({ user: { id: 'u1' }, body: { packageId: 2 } }, r);
    expect(r.statusCode).toBe(201);
    expect(r.body).toMatchObject({ purchaseId: 11, clientSecret: 'sec', amountCents: 50000 });
    expect(stripeMock.paymentIntents.create.mock.calls[0][0].metadata.consulting_purchase_id).toBe('11');
    expect(mockQuery.mock.calls[2][0]).toMatch(/'pending'/);
  });
});

describe('bookTimeSlot payment gate (P3-1069)', () => {
  test('402 when the session has no completed payment', async () => {
    jest.resetModules();
    jest.doMock('../services/modePlatformApprovalService', () => ({ canPerformAction: jest.fn().mockResolvedValue({ allowed: true }) }));
    const { mockQuery: mq } = require('./setup');
    const ctrl = require('../controllers/consultantSchedulingController');
    const future = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    mq.mockImplementation(async (sql) => {
      if (/FROM consulting_sessions_scheduled css\s+JOIN consulting_sessions/.test(sql)) return { rows: [{ id: 3, session_id: 1, user_id: 'u1' }] };
      return { rows: [] };
    });
    const r = res();
    await ctrl.bookTimeSlot({ params: { sessionId: '3' }, user: { id: 'u1', role: 'customer' },
      body: { consultantId: 'c1', date: future, startTime: '10:00', durationMinutes: 60 } }, r);
    expect(r.statusCode).toBe(402);
    expect(r.body.error).toBe('payment_required');
  });
});
