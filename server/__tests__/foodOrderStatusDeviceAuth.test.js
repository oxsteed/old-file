'use strict';

// Fix 3 server half: a paired kitchen display's token authorizes
// Ready/Handoff order-status transitions without a staff session.
//
// The device path sets req.displayDevice (no req.user). The controller must
// allow ONLY ready/completed for kitchen-role devices and reject everything
// else 403, never letting cancelled/refunded move money from a device. The
// wiring test pins the route to requireKitchenDeviceOrStaff.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/foodController');

function buildDeviceApp(deviceRole) {
  const app = express();
  app.use(express.json());
  // Simulates requireKitchenDeviceOrStaff having authorized a paired token:
  // req.displayDevice is set, req.user is not (devices have no session).
  app.use((req, _res, next) => {
    req.displayDevice = { pairingId: 7, restaurantId: 42, label: 'KDS', deviceRole };
    next();
  });
  app.patch('/api/food/restaurants/:restaurantId/orders/:orderId/status', ctrl.updateOrderStatus);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  mockQuery.mockImplementation(async (sql, params) => {
    // The device path resolves the restaurant's settings directly (there is
    // no staff session to check against the scope model).
    if (/FROM food_restaurants WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: params[0], settings: {} }] };
    }
    return { rows: [], rowCount: 0 };
  });
});

test('a kiosk-role device cannot drive a ready transition', async () => {
  const res = await request(buildDeviceApp('kiosk'))
    .patch('/api/food/restaurants/42/orders/99/status')
    .send({ status: 'ready' });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('forbidden');
  expect(res.body.error).toBe('Unsupported device action');
});

test('a queue_board-role device cannot drive a ready transition', async () => {
  const res = await request(buildDeviceApp('queue_board'))
    .patch('/api/food/restaurants/42/orders/99/status')
    .send({ status: 'ready' });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('forbidden');
});

test('a kitchen device can never cancel or refund an order (money moves)', async () => {
  for (const status of ['cancelled', 'refunded']) {
    const res = await request(buildDeviceApp('kitchen'))
      .patch('/api/food/restaurants/42/orders/99/status')
      // eslint-disable-next-line no-await-in-loop
      .send({ status });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  }
});

test('a kitchen device passes the gate for ready (reaches the transition, not a permission error)', async () => {
  const res = await request(buildDeviceApp('kitchen'))
    .patch('/api/food/restaurants/42/orders/99/status')
    .send({ status: 'ready' });
  // The gate allowed it: with empty fixtures the transaction finds no order
  // and fails as order_not_found instead of 403 forbidden.
  expect(res.status).toBe(404);
  expect(res.body.code).toBe('order_not_found');
});

test('a kitchen device passes the gate for completed', async () => {
  const res = await request(buildDeviceApp('kitchen'))
    .patch('/api/food/restaurants/42/orders/99/status')
    .send({ status: 'completed' });
  expect(res.status).toBe(404);
  expect(res.body.code).toBe('order_not_found');
});

test('a kitchen device cannot drive other staff transitions', async () => {
  const res = await request(buildDeviceApp('kitchen'))
    .patch('/api/food/restaurants/42/orders/99/status')
    .send({ status: 'accepted' });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('forbidden');
});

test('the status route delegates to requireKitchenDeviceOrStaff, not authenticate + requireRestaurantAccess', () => {
  const foodRouter = require('../routes/food');
  const layer = foodRouter.stack.find(
    (l) => l.route && l.route.path === '/restaurants/:restaurantId/orders/:orderId/status' && l.route.methods.patch
  );
  expect(layer).toBeTruthy();
  const handlerNames = layer.route.stack.map((s) => s.handle.name);
  expect(handlerNames).toContain('requireKitchenDeviceOrStaff');
  expect(handlerNames).not.toContain('authenticate');
});
