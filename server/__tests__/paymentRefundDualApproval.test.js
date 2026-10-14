'use strict';

/**
 * paymentRefundDualApproval.test.js — ADM-016 (generic /payments/refund rail)
 *
 * The generic admin payment-refund endpoint moves money through the same
 * payment refund service as manual job refunds, so it must be gated by the
 * same dual-approval threshold: above threshold -> 202 queued for a second
 * admin; below threshold -> existing behavior unchanged.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/paymentRefundService', () => ({
  processPaymentRefund: jest.fn(),
}));
jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
  logUserAction: jest.fn().mockResolvedValue(undefined),
}));

const { processPaymentRefund } = require('../services/paymentRefundService');
const ctrl = require('../controllers/paymentController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function refundReq({ amount = '600.00', fullRefund, headers = {} } = {}) {
  const body = { payment_id: 'pay-9', reason: 'test', amount };
  if (fullRefund !== undefined) body.fullRefund = fullRefund;
  return {
    body,
    user: { id: 'admin-1', role: 'admin' },
    get: (name) => (name === 'Idempotency-Key' ? headers['Idempotency-Key'] : null),
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('above-threshold refund is queued for dual approval (202) with a dualApproval context', async () => {
  const gate = {
    approval: {
      id: 12,
      movement_type: 'job_refund',
      reference_key: 'payment:pay-9',
      amount_cents: 60000,
      currency_code: 'USD',
      status: 'pending',
      requested_by: 'admin-1',
      requested_at: new Date().toISOString(),
      decided_by: null,
      decided_at: null,
      executed_at: null,
    },
    replay: false,
  };
  processPaymentRefund.mockResolvedValue({ dualApproval: gate });

  const res = mockRes();
  await ctrl.refundPayment(refundReq({ headers: { 'Idempotency-Key': 'pay-refund-key-001' } }), res, (err) => {
    throw err;
  });

  expect(processPaymentRefund).toHaveBeenCalledWith(
    expect.objectContaining({
      paymentId: 'pay-9',
      dualApproval: expect.objectContaining({
        movementType: 'job_refund',
        referenceKey: 'payment:pay-9',
        requestedBy: 'admin-1',
        idempotencyKey: 'pay-refund-key-001',
      }),
    })
  );
  expect(res.status).toHaveBeenCalledWith(202);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ code: 'money_movement_pending_approval' })
  );
});

test('below-threshold refund keeps the existing 200 contract', async () => {
  processPaymentRefund.mockResolvedValue({
    attempt: { status: 'succeeded', stripe_refund_id: 're_9', amount_cents: 2500 },
    payment: { refunded_amount: '25.00' },
    replay: false,
  });
  const res = mockRes();
  await ctrl.refundPayment(refundReq({ amount: '25.00' }), res, (err) => {
    throw err;
  });
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ refund_id: 're_9', refund_amount_cents: 2500 })
  );
});

test('omitted amount without fullRefund passes the fail-closed contract through', async () => {
  processPaymentRefund.mockImplementation(async (params) => {
    // Mirror the service's fail-closed contract.
    if (params.requestedAmountCents == null && params.fullRefund !== true) {
      const AppError = require('../utils/appError');
      throw new AppError('Refund amount is required.', 400, 'invalid_refund_amount');
    }
    return { attempt: { status: 'succeeded', amount_cents: 0 }, payment: {} };
  });
  const res = mockRes();
  const next = jest.fn();
  await ctrl.refundPayment(refundReq({ amount: null }), res, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_refund_amount' }));
});
