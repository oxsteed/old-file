'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/restaurantPosController');

const RESTAURANT_ID = 7;
const OWNER_ID = '00000000-0000-4000-8000-000000000456';

function buildApp(userId = OWNER_ID) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, email: 'pos@example.com' };
    next();
  });
  app.get('/api/restaurants/:restaurantId/pos/receipt-events', ctrl.listReceiptEvents);
  app.post('/api/restaurants/:restaurantId/pos/receipt-events', ctrl.createReceiptEvent);
  app.use(errorHandler);
  return app;
}

function accessRow(overrides = {}) {
  return {
    id: RESTAURANT_ID,
    business_id: 44,
    effective_role: 'owner',
    effective_membership_id: null,
    access_user_id: OWNER_ID,
    ...overrides,
  };
}

beforeEach(() => resetMocks());

test('receipt events reject client totals that do not match the server order', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [accessRow()] })
    .mockResolvedValueOnce({ rows: [{ id: 99, queue_number: 12, total_cents: 1800, payment_status: 'paid' }] });

  const res = await request(buildApp())
    .post(`/api/restaurants/${RESTAURANT_ID}/pos/receipt-events`)
    .send({ orderId: 99, queueNumber: 12, totalCents: 1, paymentStatus: 'paid', channel: 'Counter' });

  expect(res.status).toBe(409);
  expect(res.body.code).toBe('receipt_order_mismatch');
  expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO restaurant_pos_receipt_events/.test(sql))).toBe(false);
});

test('receipt events require pos.use for non-owner members', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [accessRow({ effective_role: 'employee', effective_membership_id: 31 })] })
    .mockResolvedValueOnce({ rows: [] }); // role defaults: no pos permission

  const res = await request(buildApp('00000000-0000-4000-8000-000000000789'))
    .post(`/api/restaurants/${RESTAURANT_ID}/pos/receipt-events`)
    .send({ orderId: 99, queueNumber: 12, totalCents: 1800, paymentStatus: 'paid', channel: 'Counter' });

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('forbidden');
  expect(mockQuery.mock.calls.some(([sql]) => /FROM food_orders/.test(sql))).toBe(false);
});

test('receipt events stay within an assigned store', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [accessRow({ effective_role: 'manager', effective_membership_id: 32 })] })
    .mockResolvedValueOnce({ rows: [{ code: 'pos.use', allow: true }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ location_id: 77 }] })
    .mockResolvedValueOnce({ rows: [{ id: 99, location_id: 77, queue_number: 12, total_cents: 1800, payment_status: 'paid' }] })
    .mockResolvedValueOnce({ rows: [{ id: 100, location_id: 77, food_order_id: 99 }] });

  const res = await request(buildApp('00000000-0000-4000-8000-000000000790'))
    .post(`/api/restaurants/${RESTAURANT_ID}/pos/receipt-events`)
    .send({ orderId: 99, queueNumber: 12, totalCents: 1800, paymentStatus: 'paid', channel: 'Counter' });

  expect(res.status).toBe(201);
  const orderQuery = mockQuery.mock.calls.find(([sql]) => /FROM food_orders/.test(sql));
  expect(orderQuery[0]).toContain('location_id = ANY($3::bigint[])');
  const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO restaurant_pos_receipt_events/.test(sql));
  expect(insert[0]).toContain('location_id');
  expect(insert[1][1]).toBe(77);
});
