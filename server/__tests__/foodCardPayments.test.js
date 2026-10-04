'use strict';

// Checkout server: card payments (Stripe Elements / destination charges).
// Stripe is fully mocked; the DB is the shared pg mock from setup.js.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/foodController');
const webhookCtrl = require('../controllers/webhookController');
const stripe = require('stripe');

const stripeMock = stripe.__mockInstance;

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
}));
jest.mock('../services/localDeliveryPaymentService', () => ({
  handleStripeEvent: jest.fn().mockResolvedValue({ handled: false }),
}));
jest.mock('../services/oxsteedCreditTopupService', () => ({
  applyCreditTopupWebhookEvent: jest.fn().mockResolvedValue(false),
}));
jest.mock('../services/restaurantTopupService', () => ({
  applyRestaurantTopupWebhookEvent: jest.fn().mockResolvedValue(false),
}));
jest.mock('../services/restaurantPosPaymentLedgerService', () => {
  const actual = jest.requireActual('../services/restaurantPosPaymentLedgerService');
  return {
    ...actual,
    applyStripePaymentIntent: jest.fn().mockResolvedValue({}),
    applyStripeRefund: jest.fn().mockResolvedValue({}),
    applyStripeChargeRefund: jest.fn().mockResolvedValue({}),
  };
});
jest.mock('../services/restaurantInventoryOrderService', () => {
  const actual = jest.requireActual('../services/restaurantInventoryOrderService');
  return {
    ...actual,
    releaseInventoryForOrder: jest.fn().mockResolvedValue({ released: 0 }),
  };
});

const RESTAURANT_ROW = {
  id: 1,
  business_id: 5,
  currency_code: 'USD',
  business_stripe_account_id: 'acct_123',
  business_stripe_charges_enabled: true,
  business_stripe_payouts_enabled: true,
  business_stripe_account_status: 'active',
  // createOrder fields
  prep_time_min: 15,
  timezone: 'UTC',
  accepts_in_store_orders: true,
  accepts_online_orders: true,
  fulfillment_modes: ['pickup'],
  settings: {},
  tax_rate_bps: 0,
  service_fee_bps: 0,
  minimum_order_cents: 0,
  temporarily_closed_until: null,
  is_accepting_orders_now: true,
  operating_hours: null,
};

const MENU_ITEM_ROW = {
  id: 10,
  name: 'Burger',
  price_cents: 1000,
  currency_code: 'USD',
  is_available: true,
  category_name: 'Mains',
  modifier_groups: [],
};

function buildFoodApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: '00000000-0000-4000-8000-000000000123', email: 'diner@example.com' };
    next();
  });
  app.post('/api/food/card-payment/intent', ctrl.createCardPaymentIntent);
  app.post('/api/food/restaurants/:restaurantId/orders', ctrl.createOrder);
  app.use(errorHandler);
  return app;
}

function buildWebhookApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.stripeWebhookDestination = 'platform';
    next();
  });
  app.post('/api/webhooks/stripe', webhookCtrl.stripeWebhook);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  stripeMock.paymentIntents.create.mockReset();
  stripeMock.paymentIntents.retrieve.mockReset();
  stripeMock.paymentIntents.update.mockReset();
  stripeMock.webhooks.constructEvent.mockReset();
});

describe('card payment intent', () => {
  // In-memory stand-in for food_card_payment_intents.
  let intentStore;
  beforeEach(() => {
    intentStore = [];
    mockQuery.mockImplementation(async (sql, params) => {
      if (/FROM food_card_payment_intents/.test(sql)) {
        const rows = intentStore.filter(
          (row) => row.restaurant_id === params[0] && row.idempotency_key === params[1]
        );
        return { rows, rowCount: rows.length };
      }
      if (/INSERT INTO food_card_payment_intents/.test(sql)) {
        const [restaurant_id, customer_id, idempotency_key, stripe_payment_intent_id, amount_cents, currency_code] = params;
        if (!intentStore.some((row) => row.restaurant_id === restaurant_id && row.idempotency_key === idempotency_key)) {
          intentStore.push({
            restaurant_id, customer_id, idempotency_key,
            stripe_payment_intent_id, amount_cents, currency_code, status: 'created',
          });
        }
        return { rows: [], rowCount: 1 };
      }
      if (/FROM food_restaurants/.test(sql)) {
        return { rows: [{ ...RESTAURANT_ROW }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  test('creates a destination-charge intent and reuses it on idempotency-key replay', async () => {
    stripeMock.paymentIntents.create.mockResolvedValue({ id: 'pi_1', client_secret: 'secret_1' });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', client_secret: 'secret_1' });
    const app = buildFoodApp();
    const body = { restaurantId: 1, amountCents: 2500, currency: 'USD', idempotencyKey: 'key-1' };

    const first = await request(app).post('/api/food/card-payment/intent').send(body);
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ clientSecret: 'secret_1', paymentIntentId: 'pi_1' });

    // Destination charge to the restaurant's Connect account with the
    // platform fee from FOOD_CARD_FEE_BPS (default 0 -> omitted).
    const [createParams, createOpts] = stripeMock.paymentIntents.create.mock.calls[0];
    expect(createParams.amount).toBe(2500);
    expect(createParams.currency).toBe('usd');
    expect(createParams.transfer_data).toEqual({ destination: 'acct_123' });
    expect(createParams.application_fee_amount).toBeUndefined();
    expect(createOpts.stripeAccount).toBeUndefined();
    expect(createOpts.idempotencyKey).toBe('food-card-payment:1:key-1');

    const second = await request(app).post('/api/food/card-payment/intent').send(body);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ clientSecret: 'secret_1', paymentIntentId: 'pi_1' });
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
  });

  test('rejects idempotency-key reuse with different payment terms', async () => {
    stripeMock.paymentIntents.create.mockResolvedValue({ id: 'pi_1', client_secret: 'secret_1' });
    const app = buildFoodApp();
    await request(app)
      .post('/api/food/card-payment/intent')
      .send({ restaurantId: 1, amountCents: 2500, currency: 'USD', idempotencyKey: 'key-1' });
    const conflict = await request(app)
      .post('/api/food/card-payment/intent')
      .send({ restaurantId: 1, amountCents: 9999, currency: 'USD', idempotencyKey: 'key-1' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('card_payment_idempotency_conflict');
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
  });

  test('returns 400 when the restaurant cannot accept charges', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM food_restaurants/.test(sql)) {
        return {
          rows: [{ ...RESTAURANT_ROW, business_stripe_charges_enabled: false }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const app = buildFoodApp();
    const res = await request(app)
      .post('/api/food/card-payment/intent')
      .send({ restaurantId: 1, amountCents: 2500, currency: 'USD', idempotencyKey: 'key-1' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('restaurant_card_payments_unavailable');
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe('card order creation', () => {
  beforeEach(() => {
    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT \* FROM food_orders/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM food_restaurants/.test(sql) && /FOR UPDATE/.test(sql)) {
        return { rows: [{ ...RESTAURANT_ROW }], rowCount: 1 };
      }
      if (/FROM food_menu_items fmi/.test(sql)) {
        return { rows: [{ ...MENU_ITEM_ROW }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  function orderBody() {
    return {
      restaurantId: 1,
      paymentMode: 'card',
      items: [{ menuItemId: 10, quantity: 1 }],
      stripePaymentIntentId: 'pi_test_1',
    };
  }

  test('rejects an amount mismatch with 402 and creates no order', async () => {
    // Server-priced total is 1000c; the intent is for 9999c.
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_test_1',
      amount: 9999,
      currency: 'usd',
      status: 'succeeded',
      transfer_data: { destination: 'acct_123' },
    });
    const app = buildFoodApp();
    const res = await request(app)
      .post('/api/food/restaurants/1/orders')
      .set('Idempotency-Key', 'order-key-1')
      .send(orderBody());
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('card_payment_amount_mismatch');
    const inserts = mockQuery.mock.calls.filter(([sql]) => /INSERT INTO food_orders/.test(sql));
    expect(inserts).toHaveLength(0);
  });

  test('rejects a non-succeeded intent with 402 and creates no order', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_test_1',
      amount: 1000,
      currency: 'usd',
      status: 'requires_payment',
      transfer_data: { destination: 'acct_123' },
    });
    const app = buildFoodApp();
    const res = await request(app)
      .post('/api/food/restaurants/1/orders')
      .set('Idempotency-Key', 'order-key-2')
      .send(orderBody());
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('card_payment_not_succeeded');
    const inserts = mockQuery.mock.calls.filter(([sql]) => /INSERT INTO food_orders/.test(sql));
    expect(inserts).toHaveLength(0);
  });

  test('rejects an intent bound to a different connected account with 402', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_test_1',
      amount: 1000,
      currency: 'usd',
      status: 'succeeded',
      transfer_data: { destination: 'acct_other' },
    });
    const app = buildFoodApp();
    const res = await request(app)
      .post('/api/food/restaurants/1/orders')
      .set('Idempotency-Key', 'order-key-3')
      .send(orderBody());
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('card_payment_account_mismatch');
  });
});

describe('checkout fields', () => {
  beforeEach(() => {
    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT \* FROM food_orders/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM food_restaurants/.test(sql) && /FOR UPDATE/.test(sql)) {
        return { rows: [{ ...RESTAURANT_ROW }], rowCount: 1 };
      }
      if (/FROM food_menu_items fmi/.test(sql)) {
        return { rows: [{ ...MENU_ITEM_ROW }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  function baseBody() {
    return {
      restaurantId: 1,
      paymentMode: 'card',
      items: [{ menuItemId: 10, quantity: 1 }],
      stripePaymentIntentId: 'pi_test_1',
    };
  }

  test('rejects a scheduled_for in the past', async () => {
    const app = buildFoodApp();
    const res = await request(app)
      .post('/api/food/restaurants/1/orders')
      .set('Idempotency-Key', 'order-key-past')
      .send({ ...baseBody(), scheduledFor: new Date(Date.now() - 60000).toISOString() });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.fields.scheduledFor).toMatch(/future/);
  });

  test('rejects a scheduled_for beyond 48 hours', async () => {
    const app = buildFoodApp();
    const res = await request(app)
      .post('/api/food/restaurants/1/orders')
      .set('Idempotency-Key', 'order-key-far')
      .send({ ...baseBody(), scheduledFor: new Date(Date.now() + 72 * 3600 * 1000).toISOString() });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.fields.scheduledFor).toMatch(/48 hours/);
  });

  test('creates a card order, persisting checkout fields and linking the intent', async () => {
    const scheduledFor = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_test_1',
      amount: 1000,
      currency: 'usd',
      status: 'succeeded',
      transfer_data: { destination: 'acct_123' },
    });
    stripeMock.paymentIntents.update.mockResolvedValue({ id: 'pi_test_1' });
    let capturedInsertParams = null;
    mockQuery.mockImplementation(async (sql, params) => {
      if (/SELECT \* FROM food_orders/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM food_restaurants/.test(sql) && /FOR UPDATE/.test(sql)) {
        return { rows: [{ ...RESTAURANT_ROW }], rowCount: 1 };
      }
      if (/FROM food_menu_items fmi/.test(sql)) {
        return { rows: [{ ...MENU_ITEM_ROW }], rowCount: 1 };
      }
      if (/COALESCE\(MAX\(queue_number\)/.test(sql)) return { rows: [{ next_queue: 3 }], rowCount: 1 };
      if (/INSERT INTO food_orders/.test(sql)) {
        capturedInsertParams = params;
        return {
          rows: [{
            id: 42,
            business_id: 5,
            restaurant_id: 1,
            payment_status: 'paid',
            total_cents: 1000,
            currency_code: 'USD',
            stripe_payment_intent_id: 'pi_test_1',
            queue_number: 3,
            fulfillment_type: 'pickup',
            order_source: 'mobile',
            kitchen_notes: 'Extra napkins',
            pickup_contact_name: 'Jane Doe',
            pickup_contact_phone: '+15551234567',
            scheduled_for: scheduledFor,
            metadata: {
              paymentMode: 'card',
              payment_mode: 'card',
              restaurantPaymentMode: 'card',
              paymentContract: { mode: 'card', legacyMode: 'card', collection: 'card' },
              trackingToken: 'tok_123',
            },
          }],
          rowCount: 1,
        };
      }
      if (/INSERT INTO food_order_items/.test(sql)) return { rows: [{ id: 100 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const app = buildFoodApp();
    const res = await request(app)
      .post('/api/food/restaurants/1/orders')
      .set('Idempotency-Key', 'order-key-success')
      .send({
        ...baseBody(),
        kitchenNotes: 'Extra napkins',
        pickupContactName: 'Jane Doe',
        pickupContactPhone: '+15551234567',
        scheduledFor,
      });

    expect(res.status).toBe(201);
    expect(res.body.payment.mode).toBe('card_payment');
    expect(res.body.payment.status).toBe('paid');
    expect(res.body.payment.paymentIntentId).toBe('pi_test_1');

    // New columns persisted on the order row.
    expect(capturedInsertParams).not.toBeNull();
    expect(capturedInsertParams[8]).toBe('paid'); // payment_status
    expect(capturedInsertParams[24]).toBe('Extra napkins'); // kitchen_notes
    expect(capturedInsertParams[25]).toBe('Jane Doe'); // pickup_contact_name
    expect(capturedInsertParams[26]).toBe('+15551234567'); // pickup_contact_phone
    expect(capturedInsertParams[27]).toBe(scheduledFor); // scheduled_for
    expect(capturedInsertParams[28]).toBe('pi_test_1'); // stripe_payment_intent_id

    // The intent is stamped with the order id for webhook reconciliation.
    expect(stripeMock.paymentIntents.update).toHaveBeenCalledWith('pi_test_1', {
      metadata: { food_order_id: '42' },
    });
  });
});

describe('card payment webhook', () => {
  test('payment_intent.succeeded marks the food order paid', async () => {
    const event = {
      id: 'evt_test_1',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'pi_test_1',
          metadata: { food_order_id: '42', restaurant_id: '1' },
        },
      },
    };
    stripeMock.webhooks.constructEvent.mockReturnValue(event);
    mockQuery.mockImplementation(async (sql) => {
      if (/INSERT INTO webhook_event_receipts/.test(sql)) return { rows: [{ id: 7 }], rowCount: 1 };
      if (/INSERT INTO webhook_event_watermarks/.test(sql)) {
        return { rows: [{ event_id: 'evt_test_1' }], rowCount: 1 };
      }
      if (/UPDATE food_orders/.test(sql)) {
        return {
          rows: [{ id: 42, business_id: 5, restaurant_id: 1, payment_status: 'paid' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig_test')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    const orderUpdates = mockQuery.mock.calls.filter(([sql]) => /UPDATE food_orders/.test(sql));
    expect(orderUpdates).toHaveLength(1);
    expect(orderUpdates[0][1]).toEqual(['paid', 'pi_test_1', 42]);
  });

  test('payment_intent.succeeded reconciles via intent id when metadata lacks the order id', async () => {
    const event = {
      id: 'evt_test_2',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'pi_test_9',
          metadata: { food_card_payment: 'true', restaurant_id: '1' },
        },
      },
    };
    stripeMock.webhooks.constructEvent.mockReturnValue(event);
    mockQuery.mockImplementation(async (sql, params) => {
      if (/INSERT INTO webhook_event_receipts/.test(sql)) return { rows: [{ id: 8 }], rowCount: 1 };
      if (/INSERT INTO webhook_event_watermarks/.test(sql)) {
        return { rows: [{ event_id: 'evt_test_2' }], rowCount: 1 };
      }
      if (/FROM food_orders WHERE stripe_payment_intent_id/.test(sql)) {
        expect(params).toEqual(['pi_test_9']);
        return { rows: [{ id: 77 }], rowCount: 1 };
      }
      if (/UPDATE food_orders/.test(sql)) {
        return {
          rows: [{ id: 77, business_id: 5, restaurant_id: 1, payment_status: 'paid' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig_test')
      .send({});

    expect(res.status).toBe(200);
    const orderUpdates = mockQuery.mock.calls.filter(([sql]) => /UPDATE food_orders/.test(sql));
    expect(orderUpdates).toHaveLength(1);
    expect(orderUpdates[0][1]).toEqual(['paid', 'pi_test_9', 77]);
  });
});
