'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/foodController');

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
}));

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000456';
const RESTAURANT_ID = 3;
const BUSINESS_ID = 42;
const MENU_ITEM_ID = 11;
const ACCOUNT_ID = 55;

function buildApp(user = { id: CUSTOMER_ID, email: 'guest@example.com' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.post('/api/food/restaurants/:restaurantId/orders', ctrl.createOrder);
  app.use(errorHandler);
  return app;
}

function restaurantRow() {
  return {
    id: RESTAURANT_ID,
    business_id: BUSINESS_ID,
    display_name: 'Ox Burger Lab',
    status: 'active',
    accepts_online_orders: true,
    accepts_in_store_orders: true,
    currency_code: 'USD',
    prep_time_min: 12,
    operating_hours: null,
    timezone: 'America/New_York',
    fulfillment_modes: ['pickup', 'delivery'],
  };
}

beforeEach(() => resetMocks());

describe('food loyalty redeem (B4)', () => {
  test('applies loyalty points as checkout discount and writes ledger debit', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurantRow()] })
      .mockResolvedValueOnce({
        rows: [{
          id: MENU_ITEM_ID,
          name: 'Classic Burger',
          price_cents: 899,
          currency_code: 'USD',
          is_available: true,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: ACCOUNT_ID, points_balance: 500 }],
      })
      .mockResolvedValueOnce({ rows: [{ next_queue: 3 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 200,
          restaurant_id: RESTAURANT_ID,
          business_id: BUSINESS_ID,
          customer_id: CUSTOMER_ID,
          subtotal_cents: 899,
          discount_cents: 500,
          total_cents: 399,
          queue_number: 3,
          status: 'received',
          metadata: { loyaltyRedemption: { pointsRedeemed: 500, discountCents: 500 } },
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 901 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .send({
        fulfillmentType: 'pickup',
        loyaltyPointsToRedeem: 500,
        items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.order.discount_cents).toBe(500);
    expect(res.body.order.total_cents).toBe(399);
    expect(mockQuery.mock.calls[2][0]).toMatch(/FROM food_loyalty_accounts/);
    expect(mockQuery.mock.calls[2][0]).toMatch(/FOR UPDATE/);
    const loyaltyAccountUpdateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE food_loyalty_accounts/.test(sql));
    const loyaltyLedgerInsertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO food_loyalty_ledger/.test(sql));
    expect(loyaltyAccountUpdateCall?.[0]).toMatch(/UPDATE food_loyalty_accounts/);
    expect(loyaltyLedgerInsertCall?.[0]).toMatch(/INSERT INTO food_loyalty_ledger/);
    expect(loyaltyLedgerInsertCall?.[1]).toEqual([ACCOUNT_ID, 200, -500]);
  });

  test('caps redemption at subtotal and ignores requests below minimum', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurantRow()] })
      .mockResolvedValueOnce({
        rows: [{
          id: MENU_ITEM_ID,
          name: 'Classic Burger',
          price_cents: 899,
          currency_code: 'USD',
          is_available: true,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ next_queue: 4 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 201,
          restaurant_id: RESTAURANT_ID,
          business_id: BUSINESS_ID,
          customer_id: CUSTOMER_ID,
          subtotal_cents: 899,
          discount_cents: 0,
          total_cents: 899,
          queue_number: 4,
          status: 'received',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 902 }] });

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .send({
        fulfillmentType: 'pickup',
        loyaltyPointsToRedeem: 50,
        items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.order.discount_cents).toBe(0);
    expect(mockQuery.mock.calls.some(([sql]) => /food_loyalty_accounts/.test(sql))).toBe(false);
  });

  test('guest orders cannot redeem loyalty points', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurantRow()] })
      .mockResolvedValueOnce({
        rows: [{
          id: MENU_ITEM_ID,
          name: 'Classic Burger',
          price_cents: 899,
          currency_code: 'USD',
          is_available: true,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ next_queue: 5 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 202,
          restaurant_id: RESTAURANT_ID,
          business_id: BUSINESS_ID,
          customer_id: null,
          subtotal_cents: 899,
          discount_cents: 0,
          total_cents: 899,
          queue_number: 5,
          status: 'received',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 903 }] });

    const app = express();
    app.use(express.json());
    app.post('/api/food/restaurants/:restaurantId/orders', ctrl.createOrder);
    app.use(errorHandler);

    const res = await request(app)
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .send({
        fulfillmentType: 'pickup',
        guestName: 'Guest Shopper',
        loyaltyPointsToRedeem: 500,
        items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.order.discount_cents).toBe(0);
    expect(mockQuery.mock.calls.some(([sql]) => /food_loyalty_accounts/.test(sql))).toBe(false);
  });
});
