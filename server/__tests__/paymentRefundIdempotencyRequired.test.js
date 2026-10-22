'use strict';

// Money-flows audit: the admin payment-refund endpoint must fail closed
// (400 payment_refund_idempotency_required) when the caller supplies no
// idempotency key, instead of minting a Date.now() default that defeats
// the refund reservation and allows a double refund at Stripe.
jest.mock('../services/paymentRefundService', () => ({
  processPaymentRefund: jest.fn(),
}));

const { processPaymentRefund } = require('../services/paymentRefundService');
const paymentController = require('../controllers/paymentController');

function mockReq({ body = {}, headers = {}, user = { id: 'admin-1', role: 'admin' } } = {}) {
  return {
    body,
    user,
    get: (name) => headers[name.toLowerCase()] || headers[name] || undefined,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('refundPayment rejects a missing idempotency key with 400', async () => {
  const next = jest.fn();
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  await paymentController.refundPayment(
    mockReq({ body: { payment_id: 7, fullRefund: true } }),
    res,
    next
  );
  expect(next).toHaveBeenCalledWith(
    expect.objectContaining({ statusCode: 400, code: 'payment_refund_idempotency_required' })
  );
  expect(processPaymentRefund).not.toHaveBeenCalled();
});

test('refundPayment accepts an explicit Idempotency-Key header', async () => {
  processPaymentRefund.mockResolvedValue({
    attempt: { status: 'succeeded', stripe_refund_id: 're_1', amount_cents: 1000 },
    payment: { refunded_amount: 1000 },
    replay: false,
  });
  const next = jest.fn();
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  await paymentController.refundPayment(
    mockReq({
      body: { payment_id: 7, fullRefund: true },
      headers: { 'idempotency-key': 'admin-refund-key-1' },
    }),
    res,
    next
  );
  expect(next).not.toHaveBeenCalled();
  expect(processPaymentRefund).toHaveBeenCalledWith(
    expect.objectContaining({ paymentId: 7, requestId: 'admin-refund-key-1' })
  );
});

test('refundPayment accepts a client-generated body key', async () => {
  processPaymentRefund.mockResolvedValue({
    attempt: { status: 'succeeded', stripe_refund_id: 're_2', amount_cents: 1000 },
    payment: { refunded_amount: 1000 },
    replay: false,
  });
  const next = jest.fn();
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  await paymentController.refundPayment(
    mockReq({ body: { payment_id: 7, fullRefund: true, idempotencyKey: 'body-key-2' } }),
    res,
    next
  );
  expect(next).not.toHaveBeenCalled();
  expect(processPaymentRefund).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: 'body-key-2' })
  );
});
