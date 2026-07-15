'use strict';

/**
 * F7 — Food order loop E2E (server-side integration)
 *
 * Exercises the pilot path without Postgres or Socket.IO:
 *   kiosk order → KDS active feed → status progression →
 *   restaurant-display ping (queue board) → customer ready notification.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(true),
}));
jest.mock('../services/smsNotificationService', () => ({
  sendDirectSMS: jest.fn().mockResolvedValue({ sid: 'SM_TEST' }),
}));
jest.mock('../services/emailService', () => ({
  send: jest.fn().mockResolvedValue(true),
}));

const socketService = require('../services/socketService');
const { sendNotification } = require('../services/notificationService');
const smsNotificationService = require('../services/smsNotificationService');
const emailService = require('../services/emailService');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/foodController');

const RESTAURANT_ID = 3;
const BUSINESS_ID = 42;
const ORDER_ID = 100;
const MENU_ITEM_ID = 11;
const OWNER_ID = '00000000-0000-4000-8000-000000000123';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000456';

function buildApp(user = { id: OWNER_ID, email: 'owner@example.com' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.post('/api/food/restaurants/:restaurantId/orders', ctrl.createOrder);
  app.get('/api/food/restaurants/:restaurantId/orders', ctrl.listRestaurantOrders);
  app.patch('/api/food/restaurants/:restaurantId/orders/:orderId/status', ctrl.updateOrderStatus);
  app.use(errorHandler);
  return app;
}

function restaurantRow(overrides = {}) {
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
    ...overrides,
  };
}

function orderRow(overrides = {}) {
  return {
    id: ORDER_ID,
    restaurant_id: RESTAURANT_ID,
    business_id: BUSINESS_ID,
    customer_id: null,
    guest_name: 'Kiosk Guest',
    guest_phone: '+15551234567',
    guest_email: null,
    order_source: 'kiosk',
    fulfillment_type: 'pickup',
    payment_status: 'unpaid',
    subtotal_cents: 899,
    total_cents: 899,
    queue_number: 7,
    status: 'received',
    metadata: { trackingToken: 'track-kiosk-1' },
    ...overrides,
  };
}

function mockRestaurantAccess(restaurantOverrides = {}) {
  return {
    rows: [{
      ...restaurantRow(restaurantOverrides),
      business_owner_id: OWNER_ID,
      owner_user_id: OWNER_ID,
      effective_role: 'owner',
    }],
  };
}

function mockKioskCreateOrderQueries(orderOverrides = {}) {
  const order = orderRow(orderOverrides);
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
    .mockResolvedValueOnce({ rows: [{ next_queue: order.queue_number }] })
    .mockResolvedValueOnce({ rows: [order] })
    .mockResolvedValueOnce({ rows: [{ id: 501 }] });
  return order;
}

function mockStatusUpdate(toStatus, orderOverrides = {}) {
  mockQuery
    .mockResolvedValueOnce(mockRestaurantAccess())
    .mockResolvedValueOnce({ rows: [orderRow({ status: toStatus, ...orderOverrides })] });
}

async function flushAsyncSideEffects() {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  resetMocks();
  socketService.broadcastToBusinessInbox.mockClear();
  socketService.broadcastToRestaurantDisplay.mockClear();
  sendNotification.mockClear();
  smsNotificationService.sendDirectSMS.mockClear();
  emailService.send.mockClear();
});

describe('food order loop E2E (F7)', () => {
  test('kiosk → KDS feed → preparing → ready → display ping + guest SMS', async () => {
    const app = buildApp();
    const order = mockKioskCreateOrderQueries();

    const createRes = await request(app)
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .send({
        orderSource: 'kiosk',
        fulfillmentType: 'pickup',
        guestName: 'Kiosk Guest',
        guestPhone: '+15551234567',
        items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.order.queue_number).toBe(7);
    expect(createRes.body.order.status).toBe('received');
    expect(createRes.body.trackingToken).toBeTruthy();
    expect(createRes.body.replayed).toBe(false);

    expect(socketService.broadcastToBusinessInbox).toHaveBeenCalledWith(
      BUSINESS_ID,
      'food:order:created',
      expect.objectContaining({
        order: expect.objectContaining({ id: ORDER_ID, queue_number: 7 }),
      })
    );
    expect(socketService.broadcastToRestaurantDisplay).toHaveBeenCalledWith(
      RESTAURANT_ID,
      'food:display:changed',
      {
        restaurantId: String(RESTAURANT_ID),
        queueNumber: 7,
        status: 'received',
      }
    );

    mockQuery
      .mockResolvedValueOnce(mockRestaurantAccess())
      .mockResolvedValueOnce({ rows: [order] });

    const kdsRes = await request(app)
      .get(`/api/food/restaurants/${RESTAURANT_ID}/orders?active=1`);

    expect(kdsRes.status).toBe(200);
    expect(kdsRes.body.orders).toHaveLength(1);
    expect(kdsRes.body.orders[0].id).toBe(ORDER_ID);

    mockStatusUpdate('preparing');

    const prepRes = await request(app)
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/orders/${ORDER_ID}/status`)
      .send({ status: 'preparing' });

    expect(prepRes.status).toBe(200);
    expect(prepRes.body.order.status).toBe('preparing');
    expect(socketService.broadcastToRestaurantDisplay).toHaveBeenLastCalledWith(
      RESTAURANT_ID,
      'food:display:changed',
      {
        restaurantId: String(RESTAURANT_ID),
        queueNumber: 7,
        status: 'preparing',
      }
    );

    mockStatusUpdate('ready');

    const readyRes = await request(app)
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/orders/${ORDER_ID}/status`)
      .send({ status: 'ready' });

    expect(readyRes.status).toBe(200);
    expect(readyRes.body.order.status).toBe('ready');
    expect(socketService.broadcastToRestaurantDisplay).toHaveBeenLastCalledWith(
      RESTAURANT_ID,
      'food:display:changed',
      {
        restaurantId: String(RESTAURANT_ID),
        queueNumber: 7,
        status: 'ready',
      }
    );

    await flushAsyncSideEffects();

    expect(smsNotificationService.sendDirectSMS).toHaveBeenCalledWith(
      '+15551234567',
      expect.stringMatching(/#7.*Ox Burger Lab.*ready for pickup/i)
    );
    expect(sendNotification).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  test('stores direct-payment proof and receipt confirmation in canonical order metadata', async () => {
    const app = buildApp();
    mockKioskCreateOrderQueries();

    const createRes = await request(app)
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .send({
        orderSource: 'counter',
        fulfillmentType: 'pickup',
        paymentMode: 'direct_payment',
        guestName: 'Counter Guest',
        items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
        externalPayment: {
          method: 'cash_app',
          reference: 'CA-12345',
          receiptConfirmed: true,
          proofRequired: true,
          proof: {
            attachmentUrl: 'https://oxsteed.com/uploads/payment-proof.png',
            attachmentKey: 'user-uploads/customer/payment-proof.png',
            attachmentName: 'payment-proof.png',
            attachmentType: 'image/png',
            attachmentSizeBytes: 2048,
          },
        },
      });

    expect(createRes.status).toBe(201);
    const insertCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO food_orders'));
    expect(insertCall).toBeTruthy();
    const metadata = insertCall[1][23];
    expect(metadata.externalPayment.submission).toMatchObject({
      method: 'cash_app',
      reference: 'CA-12345',
      receiptConfirmed: true,
      proofRequired: true,
      proof: {
        attachmentUrl: 'https://oxsteed.com/uploads/payment-proof.png',
        attachmentKey: 'user-uploads/customer/payment-proof.png',
        attachmentName: 'payment-proof.png',
        attachmentType: 'image/png',
        attachmentSizeBytes: 2048,
      },
    });
  });

  test('signed-in customer receives notificationService on ready (not SMS)', async () => {
    const app = buildApp({ id: CUSTOMER_ID, email: 'guest@example.com' });
    mockKioskCreateOrderQueries({
      customer_id: CUSTOMER_ID,
      guest_phone: null,
      guest_email: null,
    });

    await request(app)
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .send({
        orderSource: 'mobile',
        fulfillmentType: 'pickup',
        items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
      });

    mockStatusUpdate('ready', {
      customer_id: CUSTOMER_ID,
      guest_phone: null,
      guest_email: null,
    });

    const readyRes = await request(app)
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/orders/${ORDER_ID}/status`)
      .send({ status: 'ready' });

    expect(readyRes.status).toBe(200);
    await flushAsyncSideEffects();

    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: CUSTOMER_ID,
      type: 'food_order_ready',
      title: 'Order ready for pickup',
      body: expect.stringContaining('#7'),
      data: expect.objectContaining({
        orderId: String(ORDER_ID),
        status: 'ready',
        queueNumber: '7',
      }),
    }));
    expect(smsNotificationService.sendDirectSMS).not.toHaveBeenCalled();
  });

  test('delivery order status sync marks runner task ready', async () => {
    const app = buildApp();
    mockQuery
      .mockResolvedValueOnce(mockRestaurantAccess())
      .mockResolvedValueOnce({
        rows: [orderRow({
          status: 'ready',
          fulfillment_type: 'delivery',
          metadata: {
            trackingToken: 'track-delivery-1',
            deliveryAddress: { line1: '123 Main St', city: 'Columbus' },
          },
        })],
      })
      .mockResolvedValueOnce({ rows: [{ id: 901, status: 'Assigned', food_order_id: ORDER_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: 901, status: 'Ready', food_order_id: ORDER_ID }] });

    const readyRes = await request(app)
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/orders/${ORDER_ID}/status`)
      .send({ status: 'ready' });

    expect(readyRes.status).toBe(200);
    expect(readyRes.body.runnerTask.status).toBe('Ready');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE restaurant_runner_tasks/.test(sql))).toBe(true);
  });

  test('guest email receives ready email when no phone or account', async () => {
    const app = buildApp();
    mockKioskCreateOrderQueries({
      guest_phone: null,
      guest_email: 'pickup@example.com',
    });

    await request(app)
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .send({
        orderSource: 'kiosk',
        fulfillmentType: 'pickup',
        guestEmail: 'pickup@example.com',
        items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
      });

    mockStatusUpdate('ready', {
      guest_phone: null,
      guest_email: 'pickup@example.com',
    });

    await request(app)
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/orders/${ORDER_ID}/status`)
      .send({ status: 'ready' });

    await flushAsyncSideEffects();

    expect(emailService.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'pickup@example.com',
      subject: expect.stringContaining('Order ready'),
    }));
    expect(smsNotificationService.sendDirectSMS).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test('rejects illegal status transition (ready → preparing)', async () => {
    const app = buildApp();
    mockQuery
      .mockResolvedValueOnce(mockRestaurantAccess())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'ready' }] });

    const res = await request(app)
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/orders/${ORDER_ID}/status`)
      .send({ status: 'preparing' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('illegal_state_transition');
    expect(socketService.broadcastToRestaurantDisplay).not.toHaveBeenCalled();
  });

  test('ready → completed closes the pickup loop', async () => {
    const app = buildApp();
    mockQuery
      .mockResolvedValueOnce(mockRestaurantAccess())
      .mockResolvedValueOnce({ rows: [{ fulfillment_type: 'pickup' }] })
      .mockResolvedValueOnce({ rows: [orderRow({ status: 'completed' })] });

    const res = await request(app)
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/orders/${ORDER_ID}/status`)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('completed');
    expect(socketService.broadcastToRestaurantDisplay).toHaveBeenCalledWith(
      RESTAURANT_ID,
      'food:display:changed',
      expect.objectContaining({ status: 'completed' })
    );
  });
});
