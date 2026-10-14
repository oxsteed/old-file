'use strict';

/**
 * disputeResolveLockOrder.test.js — ADM-078
 *
 * The Stripe refund must fire only AFTER the dispute row is locked
 * (SELECT ... FOR UPDATE) inside the same transaction. Previously the
 * refund fired first, so two admins resolving concurrently with different
 * split amounts both moved money at Stripe before the loser hit the 409.
 *
 * This test records the order of DB queries vs the provider-refund call and
 * asserts the dispute lock precedes any money movement.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/paymentRefundService', () => ({
  processPaymentRefund: jest.fn(),
}));
jest.mock('../services/disputeNotifications', () => ({
  notifyDisputeParties: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
  logUserAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));

const { processPaymentRefund } = require('../services/paymentRefundService');
const ctrl = require('../controllers/disputeAdminController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const DISPUTE = { id: 'd-1', job_id: 'job-1', status: 'under_review' };
const PAYMENT_JOIN = {
  status: 'under_review',
  payment_id: 'pay-1',
  amount: '100.00',
  payment_status: 'captured',
  stripe_payment_intent_id: 'pi_123',
  stripe_account_id: null,
};

beforeEach(() => {
  resetMocks();
  processPaymentRefund.mockReset();
});

function mockDbForResolve() {
  const events = [];
  processPaymentRefund.mockImplementation(async () => {
    events.push('stripe-refund');
    return {
      attempt: { id: 'att-1', status: 'succeeded', stripe_refund_id: 're_123', amount_cents: 10000 },
    };
  });
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('FROM disputes d')) {
      return { rows: [PAYMENT_JOIN] }; // pre-validation payment join
    }
    if (sql.includes('FROM disputes WHERE id = $1 FOR UPDATE')) {
      events.push('dispute-lock');
      return { rows: [DISPUTE] };
    }
    if (sql.includes('UPDATE disputes')) {
      return { rows: [{ ...DISPUTE, status: 'resolved', resolved_at: new Date().toISOString() }] };
    }
    if (sql.includes('FROM payments') && sql.includes("escrow_status = 'disputed'")) {
      return { rows: [] }; // no escrow row
    }
    return { rows: [], rowCount: 0 };
  });
  return events;
}

test('dispute row is locked BEFORE the Stripe refund fires', async () => {
  const events = mockDbForResolve();
  const res = mockRes();
  await ctrl.resolveDispute(
    {
      params: { disputeId: 'd-1' },
      body: { resolution: 'refund_customer', resolution_notes: 'test' },
      user: { id: 'admin-1' },
    },
    res
  );
  expect(processPaymentRefund).toHaveBeenCalledTimes(1);
  const lockIdx = events.indexOf('dispute-lock');
  const refundIdx = events.indexOf('stripe-refund');
  expect(lockIdx).toBeGreaterThanOrEqual(0);
  expect(refundIdx).toBeGreaterThanOrEqual(0);
  expect(lockIdx).toBeLessThan(refundIdx);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'Dispute resolved successfully.' })
  );
});

test('already-resolved dispute 409s without touching Stripe', async () => {
  const events = mockDbForResolve();
  // Dispute is already resolved when locked.
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('FROM disputes d')) return { rows: [PAYMENT_JOIN] };
    if (sql.includes('FROM disputes WHERE id = $1 FOR UPDATE')) {
      events.push('dispute-lock');
      return { rows: [{ ...DISPUTE, status: 'resolved' }] };
    }
    return { rows: [], rowCount: 0 };
  });
  const res = mockRes();
  await ctrl.resolveDispute(
    {
      params: { disputeId: 'd-1' },
      body: { resolution: 'refund_customer', resolution_notes: 'test' },
      user: { id: 'admin-1' },
    },
    res
  );
  expect(res.status).toHaveBeenCalledWith(409);
  expect(processPaymentRefund).not.toHaveBeenCalled();
  expect(events).not.toContain('stripe-refund');
});
