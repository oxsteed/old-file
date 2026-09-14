'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
}));

const mockCaptureCreditHoldInTransaction = jest.fn();
jest.mock('../services/oxsteedCreditService', () => ({
  captureCreditHoldInTransaction: mockCaptureCreditHoldInTransaction,
  refundCreditInTransaction: jest.fn(),
}));

const appFlow = require('../controllers/restaurantAppFlowController');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const RESTAURANT_ID = 3;
const BUSINESS_ID = 42;
const ORDER_ID = 100;
const HOLD_ID = '00000000-0000-4000-8000-000000000456';

function restaurantRow() {
  return {
    id: RESTAURANT_ID,
    business_id: BUSINESS_ID,
    display_name: 'Ox Burger Lab',
    status: 'active',
    accepts_in_store_orders: true,
    currency_code: 'USD',
    address_city: 'Austin',
    address_state: 'TX',
    address_zip: '78701',
    address_country: 'US',
    effective_role: 'owner',
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: USER_ID, email: 'owner@example.com', role: 'customer' };
    next();
  });
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/payments', appFlow.recordPosPayment);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  mockCaptureCreditHoldInTransaction.mockReset();
});

test('captures a valid customer Credit hold into a POS payment and receipt audit', async () => {
  const capturedOrder = {
    id: ORDER_ID,
    restaurant_id: RESTAURANT_ID,
    total_cents: 300,
    currency_code: 'USD',
    payment_status: 'paid',
    pos_ticket_state: 'closed',
    queue_number: 12,
    guest_name: 'Guest',
    fulfillment_type: 'pickup',
    customer_id: USER_ID,
    metadata: {},
  };
  mockCaptureCreditHoldInTransaction.mockResolvedValue({
    replayed: false,
    transaction: { id: 'credit-transaction-1' },
  });
  mockQuery
    .mockResolvedValueOnce({ rows: [restaurantRow()] })
    .mockResolvedValueOnce({ rows: [{ ...capturedOrder, payment_status: 'unpaid', pos_ticket_state: 'open', customer_id: null }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ paid_cents: 0, refunded_cents: 0 }] })
    .mockResolvedValueOnce({ rows: [{
      id: HOLD_ID,
      amount_cents: 300,
      currency_code: 'USD',
      customer_id: USER_ID,
      hold_customer_id: USER_ID,
      hold_account_currency_code: 'USD',
      partner_id: 'partner-1',
      hold_restaurant_id: RESTAURANT_ID,
    }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 701, payment_type: 'oxsteed_credit', amount_cents: 300 }] })
    .mockResolvedValueOnce({ rows: [capturedOrder] })
    .mockResolvedValueOnce({ rows: [{ paid_cents: 300, refunded_cents: 0, pending_payments: 0 }] })
    .mockResolvedValueOnce({ rows: [{ ...capturedOrder, payment_status: 'paid', pos_ticket_state: 'closed' }] })
    .mockResolvedValueOnce({ rows: [{ id: 801, event_type: 'payment_recorded' }] });

  const response = await request(buildApp())
    .post(`/api/restaurants/${RESTAURANT_ID}/pos/orders/${ORDER_ID}/payments`)
    .set('Idempotency-Key', 'pos-credit-capture-1')
    .send({ paymentType: 'oxsteed_credit', amountCents: 300, creditHoldId: HOLD_ID });

  expect(response.status).toBe(201);
  expect(response.body.payment.payment_type).toBe('oxsteed_credit');
  expect(response.body.oxsteedCredit).toMatchObject({
    transactionId: 'credit-transaction-1',
    amountCents: 300,
    currencyCode: 'USD',
    customerId: USER_ID,
    holdId: HOLD_ID,
  });
  expect(response.body.customer).toEqual({ id: USER_ID });
  expect(mockCaptureCreditHoldInTransaction).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      holdId: HOLD_ID,
      amountCents: 300,
      currencyCode: 'USD',
      actorType: 'system',
      referenceType: 'food_order',
      referenceId: String(ORDER_ID),
    })
  );
  expect(mockQuery.mock.calls.some(([sql, params]) => /restaurant_pos_receipt_events/.test(sql)
    && JSON.stringify(params).includes('creditHoldId'))).toBe(true);
});
