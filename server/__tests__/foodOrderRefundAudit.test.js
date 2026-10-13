'use strict';

/**
 * P3-11-F11: kitchen-cancel food refunds move money with no actor-stamped
 * audit event. Cancelling a paid order must write an operator audit row
 * naming the acting staff member, in the same transaction as the refund:
 *   - wallet_credit orders -> order_wallet_refund
 *   - pay_now/card orders  -> order_card_refund
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

const mockStripeRefundsCreate = jest.fn();
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({
  refunds: { create: (...args) => mockStripeRefundsCreate(...args) },
})));
jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
}));
jest.mock('../services/smsNotificationService', () => ({
  sendOrderCancelledSMS: jest.fn().mockResolvedValue(true),
  sendOrderRefundedSMS: jest.fn().mockResolvedValue(true),
}));
jest.mock('../services/foodWalletService', () => {
  const actual = jest.requireActual('../services/foodWalletService');
  return {
    ...actual,
    refundWalletDebitForReference: jest.fn(),
  };
});
jest.mock('../services/restaurantPosPaymentLedgerService', () => {
  const actual = jest.requireActual('../services/restaurantPosPaymentLedgerService');
  return {
    ...actual,
    recordWalletCreditRefundForOrder: jest.fn().mockResolvedValue({ payment: { id: 900 } }),
  };
});
jest.mock('../services/foodWalletAuditService', () => ({
  logFoodWalletOperatorAudit: jest.fn().mockResolvedValue({ id: 1234 }),
}));

const ctrl = require('../controllers/foodController');
const { refundWalletDebitForReference } = require('../services/foodWalletService');
const { logFoodWalletOperatorAudit } = require('../services/foodWalletAuditService');

const RESTAURANT_ID = 3;
const BUSINESS_ID = 42;
const ORDER_ID = 100;
const OWNER_ID = '00000000-0000-4000-8000-000000000123';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000456';

function buildApp(user = { id: OWNER_ID, email: 'owner@example.com' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.patch('/api/food/restaurants/:restaurantId/orders/:orderId/status', ctrl.updateOrderStatus);
  app.use(errorHandler);
  return app;
}

function restaurantRow() {
  return {
    id: RESTAURANT_ID,
    business_id: BUSINESS_ID,
    display_name: 'Ox Burger Lab',
    status: 'active',
    currency_code: 'USD',
    settings: {},
    business_owner_id: OWNER_ID,
    owner_user_id: OWNER_ID,
    effective_role: 'owner',
  };
}

function cancelledOrderRow(paymentMode) {
  return {
    id: ORDER_ID,
    restaurant_id: RESTAURANT_ID,
    business_id: BUSINESS_ID,
    customer_id: CUSTOMER_ID,
    total_cents: 2500,
    currency_code: 'USD',
    queue_number: 7,
    status: 'cancelled',
    payment_status: paymentMode === 'wallet_credit' ? 'refunded' : 'paid',
    stripe_payment_intent_id: paymentMode === 'wallet_credit' ? null : 'pi_123',
    metadata: { paymentMode },
    previous_status: 'preparing',
    previous_kitchen_stage: 'preparing',
    previous_payment_status: 'paid',
  };
}

function baseMocks(orderRow) {
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes('FROM food_restaurants')) return { rows: [restaurantRow()] };
    if (sql.includes('previous_status')) return { rows: [orderRow] };
    if (sql.includes('INSERT INTO restaurant_kitchen_events')) return { rows: [{ id: 55 }] };
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockStripeRefundsCreate.mockReset();
});

describe('kitchen-cancel refund actor audit (P3-11-F11)', () => {
  test('wallet re-credit writes an operator-stamped audit event', async () => {
    baseMocks(cancelledOrderRow('wallet_credit'));
    refundWalletDebitForReference.mockResolvedValue({
      refunded: true,
      entry: { id: 7001, account_id: 55, amount_cents: 2500, balance_after_cents: 2500, metadata: {} },
      account: { id: 55 },
    });

    const res = await request(buildApp())
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/orders/${ORDER_ID}/status`)
      .send({ status: 'cancelled', reason: 'Kitchen out of stock' });

    expect(res.status).toBe(200);
    expect(refundWalletDebitForReference).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ createdByUserId: OWNER_ID, actorType: 'restaurant_staff' })
    );
    expect(logFoodWalletOperatorAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        customerId: CUSTOMER_ID,
        operatorUserId: OWNER_ID,
        actionType: 'order_wallet_refund',
        amountCents: 2500,
        correlationId: `food-order-status:${ORDER_ID}:cancelled`,
      })
    );
  });

  test('stripe refund writes an operator-stamped audit event', async () => {
    baseMocks(cancelledOrderRow('pay_now'));
    mockStripeRefundsCreate.mockResolvedValue({ id: 're_1', amount: 2500, charge: 'ch_1' });
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM food_restaurants')) return { rows: [restaurantRow()] };
      if (sql.includes('previous_status')) return { rows: [cancelledOrderRow('pay_now')] };
      if (sql.includes('INSERT INTO restaurant_kitchen_events')) return { rows: [{ id: 55 }] };
      if (sql.includes('INSERT INTO restaurant_pos_payments')) return { rows: [{ id: 901 }] };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildApp())
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/orders/${ORDER_ID}/status`)
      .send({ status: 'cancelled', reason: 'Kitchen out of stock' });

    expect(res.status).toBe(200);
    expect(mockStripeRefundsCreate).toHaveBeenCalled();
    expect(logFoodWalletOperatorAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        customerId: CUSTOMER_ID,
        operatorUserId: OWNER_ID,
        actionType: 'order_card_refund',
        amountCents: 2500,
        correlationId: `food-order-status:${ORDER_ID}:cancelled`,
        metadata: expect.objectContaining({ stripeRefundId: 're_1' }),
      })
    );
  });
});
