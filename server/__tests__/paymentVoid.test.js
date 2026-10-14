'use strict';

// Review P3-788 (void authorized payments) and P3-816 (under_review freezes).
const { mockQuery, resetMocks } = require('./setup');

const mockIntents = { retrieve: jest.fn(), cancel: jest.fn() };
const mockRefunds = { create: jest.fn(), retrieve: jest.fn() };
jest.mock('stripe', () => () => ({ paymentIntents: mockIntents, refunds: mockRefunds, charges: { retrieve: jest.fn() } }));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));

const svc = require('../services/paymentRefundService');

beforeEach(() => {
  resetMocks();
  Object.values(mockIntents).forEach((f) => f.mockReset());
  Object.values(mockRefunds).forEach((f) => f.mockReset());
});

function route(handlers) {
  mockQuery.mockImplementation(async (sql, params) => {
    const t = String(sql);
    for (const [re, v] of handlers) if (re.test(t)) return typeof v === 'function' ? v(params) : v;
    return { rows: [] };
  });
}

const authorized = { id: 9, job_id: 'j', status: 'authorized', amount: '20.00', refunded_amount: '0', stripe_payment_intent_id: 'pi_9', stripe_account_id: 'acct_h' };

test('an authorized payment reserves a full void, not a refund', async () => {
  route([
    [/FROM payment_refund_attempts WHERE idempotency_key/, { rows: [] }],
    [/FROM payments WHERE id/, { rows: [authorized] }],
    [/FROM disputes/, { rows: [] }],
    [/INSERT INTO payment_refund_attempts/, (p) => ({ rows: [{ id: 1, kind: p[6], amount_cents: p[1], idempotency_key: p[4], payment_id: 9 }] })],
  ]);
  // ADM-009: the full release of an authorized payment must be declared
  // explicitly (fullRefund: true); a missing amount no longer silently
  // means "full".
  const r = await svc.reservePaymentRefund({ paymentId: 9, requestId: 'request-0001', actorUserId: 'a', fullRefund: true });
  expect(r.attempt.kind).toBe('void');
  expect(r.attempt.amount_cents).toBe(2000);
});

test('a missing amount without fullRefund is rejected (ADM-009 fail-closed)', async () => {
  route([
    [/FROM payment_refund_attempts WHERE idempotency_key/, { rows: [] }],
    [/FROM payments WHERE id/, { rows: [authorized] }],
    [/FROM disputes/, { rows: [] }],
  ]);
  await expect(svc.reservePaymentRefund({ paymentId: 9, requestId: 'request-0001', actorUserId: 'a' }))
    .rejects.toMatchObject({ code: 'invalid_refund_amount' });
});

test('a partial amount on an authorized payment is rejected', async () => {
  route([
    [/FROM payment_refund_attempts WHERE idempotency_key/, { rows: [] }],
    [/FROM payments WHERE id/, { rows: [authorized] }],
    [/FROM disputes/, { rows: [] }],
  ]);
  await expect(svc.reservePaymentRefund({ paymentId: 9, requestId: 'request-0001', requestedAmountCents: 500 }))
    .rejects.toMatchObject({ code: 'partial_void_unsupported' });
});

test('an under_review dispute freezes refunds', async () => {
  route([
    [/FROM payment_refund_attempts WHERE idempotency_key/, { rows: [] }],
    [/FROM payments WHERE id/, { rows: [{ ...authorized, status: 'captured' }] }],
    [/FROM disputes/, (p) => ({ rows: [{ id: 'd1' }] })],
  ]);
  await expect(svc.reservePaymentRefund({ paymentId: 9, requestId: 'request-0001' })).rejects.toMatchObject({ code: 'dispute_open' });
  const sql = mockQuery.mock.calls.find(([s]) => /FROM disputes/.test(s))[0];
  expect(sql).toMatch(/'under_review'/);
});

test('settling a void cancels the intent and closes the payment', async () => {
  route([
    [/FROM payment_refund_attempts WHERE id/, { rows: [{ id: 1, status: 'pending', payment_id: 9, amount_cents: 2000 }] }],
    [/UPDATE payment_refund_attempts/, { rows: [{ id: 1, status: 'succeeded' }] }],
    [/UPDATE payments/, { rows: [{ id: 9, status: 'canceled' }] }],
  ]);
  mockIntents.retrieve.mockResolvedValue({ id: 'pi_9', status: 'requires_capture' });
  mockIntents.cancel.mockResolvedValue({ id: 'pi_9', status: 'canceled' });
  const reservation = { payment: authorized, attempt: { id: 1, kind: 'void', idempotency_key: 'k', status: 'pending' } };
  const out = await svc.reconcilePaymentRefundAttempt(reservation);
  expect(mockIntents.cancel).toHaveBeenCalledWith('pi_9', expect.any(Object), expect.objectContaining({ stripeAccount: 'acct_h', idempotencyKey: 'k' }));
  expect(mockRefunds.create).not.toHaveBeenCalled();
  expect(out.payment.status).toBe('canceled');
});

test('an intent captured meanwhile converts the attempt to a refund', async () => {
  route([
    [/FROM payment_refund_attempts WHERE id/, { rows: [{ id: 1, status: 'pending', payment_id: 9 }] }],
    [/SET kind = 'refund'/, { rows: [{ id: 1, kind: 'refund' }] }],
  ]);
  mockIntents.retrieve.mockResolvedValue({ id: 'pi_9', status: 'succeeded' });
  const out = await svc.reconcilePaymentRefundAttempt({ payment: authorized, attempt: { id: 1, kind: 'void', idempotency_key: 'k', status: 'pending' } });
  expect(out.converted).toBe(true);
  expect(mockIntents.cancel).not.toHaveBeenCalled();
});

test('job completion and close freezes include under_review', () => {
  const src = require('fs').readFileSync(require.resolve('../controllers/jobController.js'), 'utf8');
  expect(src).not.toMatch(/status IN \('open', 'in_progress'\)/);
});
