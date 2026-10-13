'use strict';

/**
 * P3-11-F08: subscription lifecycle events (subscribe, user cancel, webhook
 * renewal/cancel, credit renewal) must write transactional fail-closed audit
 * rows. The audit write rides in the same transaction as the state change,
 * with throwOnError so a missing audit row rolls the mutation back.
 */

const { mockQuery, resetMocks } = require('./setup');

const mockStripe = {
  subscriptions: { retrieve: jest.fn(), update: jest.fn(), cancel: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  customers: { create: jest.fn() },
};
jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripe));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../controllers/verificationController', () => ({ recalculateBadges: jest.fn().mockResolvedValue(true) }));
jest.mock('../services/localDeliveryPaymentService', () => ({ handleStripeEvent: jest.fn().mockResolvedValue({ handled: false }) }));

const { handleVerifiedStripeEvent } = require('../controllers/webhookController');
const { logAdminAction } = require('../services/auditService');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const resMock = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis() });
const nextMock = () => jest.fn((err) => { if (err) throw err; });

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function receiptMocks() {
  // beginWebhookEvent: no `created` on the event, so one receipt insert and
  // shouldProcess is true without a watermark write.
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes('INSERT INTO webhook_event_receipts')) return { rows: [{ id: 99 }] };
    return { rows: [], rowCount: 0 };
  });
}

describe('webhook subscription audit', () => {
  test('invoice.paid renewal writes a fail-closed audit row', async () => {
    receiptMocks();
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_1',
      status: 'active',
      current_period_start: 1760000000,
      current_period_end: 1762600000,
      cancel_at_period_end: false,
    });
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('INSERT INTO webhook_event_receipts')) return { rows: [{ id: 99 }] };
      if (sql.includes('FROM subscriptions') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'subrow-1', user_id: USER_ID, status: 'active' }] };
      }
      if (sql.includes('UPDATE subscriptions')) return { rows: [], rowCount: 1 };
      if (sql.includes('SELECT user_id, plan_id FROM subscriptions')) {
        return { rows: [{ user_id: USER_ID, plan_id: 3 }] };
      }
      if (sql.includes('FROM plans')) return { rows: [{ slug: 'pro', tier_slug: 'pro' }] };
      return { rows: [], rowCount: 0 };
    });

    const res = resMock();
    await handleVerifiedStripeEvent(
      { id: 'evt_inv_1', type: 'invoice.paid', data: { object: { id: 'in_1', subscription: 'sub_1' } } },
      'platform',
      res,
      nextMock()
    );

    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: USER_ID,
        action: 'subscription.renewed',
        targetType: 'subscription',
        targetId: 'subrow-1',
        throwOnError: true,
      })
    );
    // The audit call received the transaction client (fail-closed contract).
    const auditCall = logAdminAction.mock.calls.find(([args]) => args.action === 'subscription.renewed');
    expect(auditCall[0].client).toBeTruthy();
    expect(auditCall[0].client).not.toBe(require('../db'));
  });

  test('customer.subscription.deleted writes a fail-closed audit row', async () => {
    receiptMocks();
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('INSERT INTO webhook_event_receipts')) return { rows: [{ id: 99 }] };
      if (sql.includes('FROM subscriptions') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'subrow-2', user_id: USER_ID, status: 'active' }] };
      }
      if (sql.includes("SET status = 'cancelled'")) return { rows: [], rowCount: 1 };
      if (sql.includes('SELECT user_id FROM subscriptions')) return { rows: [{ user_id: USER_ID }] };
      return { rows: [], rowCount: 0 };
    });

    const res = resMock();
    await handleVerifiedStripeEvent(
      { id: 'evt_del_1', type: 'customer.subscription.deleted', data: { object: { id: 'sub_2' } } },
      'platform',
      res,
      nextMock()
    );

    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: USER_ID,
        action: 'subscription.cancelled',
        targetType: 'subscription',
        targetId: 'subrow-2',
        before: { status: 'active' },
        after: { status: 'cancelled' },
        throwOnError: true,
      })
    );
  });

  test('checkout.session.completed writes a fail-closed audit row on subscribe', async () => {
    receiptMocks();
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_3',
      status: 'active',
      current_period_start: 1760000000,
      current_period_end: 1762600000,
    });
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('INSERT INTO webhook_event_receipts')) return { rows: [{ id: 99 }] };
      if (sql.includes('INSERT INTO subscriptions')) return { rows: [{ id: 'subrow-3' }] };
      if (sql.includes('FROM plans')) return { rows: [{ slug: 'pro', tier_slug: 'pro' }] };
      return { rows: [], rowCount: 0 };
    });

    const res = resMock();
    await handleVerifiedStripeEvent(
      {
        id: 'evt_cs_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_1',
            mode: 'subscription',
            subscription: 'sub_3',
            customer: 'cus_1',
            metadata: { userId: USER_ID, planId: '3' },
          },
        },
      },
      'platform',
      res,
      nextMock()
    );

    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: USER_ID,
        action: 'subscription.created',
        targetType: 'subscription',
        targetId: 'subrow-3',
        throwOnError: true,
      })
    );
  });
});

describe('webhook subscription update audit (P3-11-F08 residual)', () => {
  function updatedEvent(overrides = {}) {
    return {
      id: 'evt_upd_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_4',
          status: 'past_due',
          current_period_start: 1760000000,
          current_period_end: 1762600000,
          cancel_at_period_end: false,
          ...overrides,
        },
      },
    };
  }

  test('customer.subscription.updated writes a fail-closed audit row on status change', async () => {
    receiptMocks();
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('INSERT INTO webhook_event_receipts')) return { rows: [{ id: 99 }] };
      if (sql.includes('FROM subscriptions') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'subrow-4', user_id: USER_ID, status: 'active', cancel_at_period_end: false, current_period_end: new Date() }] };
      }
      if (sql.includes('UPDATE subscriptions')) return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE users SET subscription_status')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const res = resMock();
    await handleVerifiedStripeEvent(updatedEvent(), 'platform', res, nextMock());

    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: USER_ID,
        action: 'subscription.updated',
        targetType: 'subscription',
        targetId: 'subrow-4',
        before: { status: 'active', cancel_at_period_end: false },
        after: { status: 'past_due', cancel_at_period_end: false },
        throwOnError: true,
      })
    );
  });

  test('customer.subscription.updated skips the audit row when nothing material changed', async () => {
    receiptMocks();
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('INSERT INTO webhook_event_receipts')) return { rows: [{ id: 99 }] };
      if (sql.includes('FROM subscriptions') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'subrow-4', user_id: USER_ID, status: 'active', cancel_at_period_end: false, current_period_end: new Date() }] };
      }
      if (sql.includes('UPDATE subscriptions')) return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE users SET subscription_status')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const res = resMock();
    await handleVerifiedStripeEvent(
      updatedEvent({ status: 'active' }),
      'platform',
      res,
      nextMock()
    );

    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(logAdminAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'subscription.updated' })
    );
  });

  test('invoice.payment_failed writes a fail-closed audit row on the past_due flip', async () => {
    receiptMocks();
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('INSERT INTO webhook_event_receipts')) return { rows: [{ id: 99 }] };
      if (sql.includes('FROM subscriptions') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'subrow-5', user_id: USER_ID, status: 'active' }] };
      }
      if (sql.includes("SET status = 'past_due'")) return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE users SET subscription_status')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const res = resMock();
    await handleVerifiedStripeEvent(
      { id: 'evt_pf_1', type: 'invoice.payment_failed', data: { object: { id: 'in_9', subscription: 'sub_5' } } },
      'platform',
      res,
      nextMock()
    );

    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: USER_ID,
        action: 'subscription.payment_failed',
        targetType: 'subscription',
        targetId: 'subrow-5',
        before: { status: 'active' },
        after: { status: 'past_due' },
        throwOnError: true,
      })
    );
  });
});
