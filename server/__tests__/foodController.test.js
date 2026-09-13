'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/foodController');
const stripe = require('stripe');

jest.mock('../services/socketService', () => ({ broadcastToBusinessInbox: jest.fn() }));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: '00000000-0000-4000-8000-000000000123', email: 'owner@example.com' };
    next();
  });
  app.get('/api/food/restaurants', ctrl.listRestaurants);
  app.get('/api/food/restaurants/:restaurantId', ctrl.getRestaurant);
  app.get('/api/food/markets', ctrl.listMarkets);
  app.get('/api/food/orders/track/:trackingToken', ctrl.getTrackedOrder);
  app.post('/api/food/restaurants', ctrl.createRestaurant);
  app.patch('/api/food/restaurants/:restaurantId', ctrl.updateRestaurant);
  app.post('/api/food/restaurants/:restaurantId/orders', ctrl.createOrder);
  app.post('/api/food/restaurants/:restaurantId/orders/quote', ctrl.quoteOrder);
  app.get('/api/food/restaurants/:restaurantId/orders', ctrl.listRestaurantOrders);
  app.patch('/api/food/restaurants/:restaurantId/orders/:orderId/status', ctrl.updateOrderStatus);
  app.patch('/api/food/restaurants/:restaurantId/orders/:orderId/payment', ctrl.updateOrderPayment);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('food controller', () => {
  const quoteRestaurant = {
    id: 3,
    business_id: 42,
    display_name: 'Ox Burger Lab',
    status: 'active',
    discovery_status: 'visible',
    accepts_online_orders: true,
    accepts_in_store_orders: true,
    fulfillment_modes: ['pickup'],
    settings: {},
    operating_hours: {},
    timezone: 'UTC',
  };

  test('rejects a modifier that belongs to another menu item', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [quoteRestaurant] })
      .mockResolvedValueOnce({
        rows: [{
          id: 10,
          name: 'Burger',
          price_cents: 1200,
          currency_code: 'USD',
          is_available: true,
          modifier_groups: [{
            id: 1,
            name: 'Size',
            min_select: 0,
            max_select: 1,
            is_required: false,
            options: [{ id: 101, name: 'Large', price_delta_cents: 200, is_available: true }],
          }],
        }],
      });

    const res = await request(buildApp())
      .post('/api/food/restaurants/3/orders/quote')
      .send({ items: [{ menuItemId: 10, quantity: 1, modifierIds: [999] }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.fields['items.0.modifierIds']).toMatch(/not available for this menu item/);
  });

  test('rejects a quote that omits a required modifier selection', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [quoteRestaurant] })
      .mockResolvedValueOnce({
        rows: [{
          id: 10,
          name: 'Burger',
          price_cents: 1200,
          currency_code: 'USD',
          is_available: true,
          modifier_groups: [{
            id: 1,
            name: 'Choose a size',
            min_select: 0,
            max_select: 1,
            is_required: true,
            options: [{ id: 101, name: 'Large', price_delta_cents: 200, is_available: true }],
          }],
        }],
      });

    const res = await request(buildApp())
      .post('/api/food/restaurants/3/orders/quote')
      .send({ items: [{ menuItemId: 10, quantity: 1, modifierIds: [] }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.fields['items.0.modifierIds']).toMatch(/at least 1 option/);
  });

  test('public restaurant lookup exposes storefront fields, not business credentials', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 3,
          business_id: 42,
          owner_user_id: '00000000-0000-4000-8000-000000000999',
          display_name: 'Ox Burger Lab',
          status: 'active',
          discovery_status: 'visible',
          settings: {
            externalPaymentEnabled: true,
            externalPaymentHandle: 'oxburger@example.com',
            privateProcessorSecret: 'do not return',
          },
          operating_hours: {},
          timezone: 'America/New_York',
          business_stripe_account_id: 'acct_private',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ avg_rating: 4.5, review_count: 8 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/food/restaurants/3');

    expect(res.status).toBe(200);
    expect(res.body.restaurant.display_name).toBe('Ox Burger Lab');
    expect(res.body.restaurant.settings).toEqual({
      externalPaymentEnabled: true,
      externalPaymentHandle: 'oxburger@example.com',
    });
    expect(res.body.restaurant).not.toHaveProperty('owner_user_id');
    expect(res.body.restaurant).not.toHaveProperty('business_stripe_account_id');
    expect(res.body.restaurant.settings).not.toHaveProperty('privateProcessorSecret');
  });

  test('public order tracking returns only customer-safe fields', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 100,
        restaurant_id: 3,
        status: 'preparing',
        payment_status: 'paid',
        order_source: 'web',
        fulfillment_type: 'pickup',
        subtotal_cents: 1200,
        tax_cents: 96,
        service_fee_cents: 0,
        delivery_fee_cents: 0,
        tip_cents: 0,
        discount_cents: 0,
        total_cents: 1296,
        currency_code: 'USD',
        table_label: null,
        queue_number: 7,
        promised_at: null,
        created_at: '2026-09-07T09:00:00.000Z',
        updated_at: '2026-09-07T09:05:00.000Z',
        accepted_at: '2026-09-07T09:02:00.000Z',
        ready_at: null,
        completed_at: null,
        cancelled_at: null,
        stripe_payment_intent_id: 'pi_private',
        guest_email: 'guest@example.com',
        guest_phone: '+15551234567',
        customer_id: '00000000-0000-4000-8000-000000000999',
        metadata: { trackingToken: 'track-safe', privateNote: 'do not return' },
        restaurant_name: 'Ox Burger Lab',
        prep_time_min: 15,
        has_review: false,
        items: [{ id: 1, itemName: 'Burger', quantity: 1, lineTotalCents: 1200, specialInstructions: 'secret' }],
      }],
    });

    const res = await request(buildApp()).get('/api/food/orders/track/track-safe');

    expect(res.status).toBe(200);
    expect(res.body.order).toMatchObject({
      id: 100,
      status: 'preparing',
      queue_number: 7,
      total_cents: 1296,
      restaurant_name: 'Ox Burger Lab',
      items: [{ id: 1, itemName: 'Burger', quantity: 1, lineTotalCents: 1200 }],
    });
    expect(res.body.order).not.toHaveProperty('guest_email');
    expect(res.body.order).not.toHaveProperty('guest_phone');
    expect(res.body.order).not.toHaveProperty('customer_id');
    expect(res.body.order).not.toHaveProperty('metadata');
    expect(res.body.order).not.toHaveProperty('stripe_payment_intent_id');
    expect(res.body.order.items[0]).not.toHaveProperty('specialInstructions');
  });

  test('checks connected-account payment intents when refreshing order payment status', async () => {
    stripe.__mockInstance.paymentIntents.retrieve = jest.fn();
    stripe.__mockInstance.paymentIntents.retrieve.mockResolvedValueOnce({ status: 'succeeded' });
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 101,
          restaurant_id: 3,
          status: 'received',
          payment_status: 'requires_payment',
          stripe_payment_intent_id: 'pi_connected',
          metadata: {
            trackingToken: 'track-connected',
            stripeCheckout: { connectedAccountId: 'acct_restaurant' },
          },
          restaurant_name: 'Ox Burger Lab',
          prep_time_min: 15,
          items: [],
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 101, payment_status: 'paid', status: 'received' }],
      });

    const res = await request(buildApp()).get('/api/food/orders/track/track-connected');

    expect(res.status).toBe(200);
    expect(res.body.order.payment_status).toBe('paid');
    expect(stripe.__mockInstance.paymentIntents.retrieve).toHaveBeenCalledWith(
      'pi_connected',
      { stripeAccount: 'acct_restaurant' }
    );
  });

  test('lists restaurants with country and search filters', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 7, display_name: 'Ox Burger', address_country: 'US' }],
    });

    const res = await request(buildApp())
      .get('/api/food/restaurants?q=burger&country=us');

    expect(res.status).toBe(200);
    expect(res.body.restaurants).toHaveLength(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM food_restaurants fr/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/JOIN businesses b ON b\.id = fr\.business_id/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/b\.is_active = TRUE/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/address_country/);
    expect(mockQuery.mock.calls[0][1]).toContain('US');
  });

  test('returns available markets grouped by city and country', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          address_country: 'United States',
          address_city: 'Columbus',
          currency_code: 'USD',
          restaurant_count: '3',
        },
        {
          address_country: 'CA',
          address_city: 'Montreal',
          currency_code: 'CAD',
          restaurant_count: '1',
        },
      ],
    });

    const res = await request(buildApp()).get('/api/food/markets');

    expect(res.status).toBe(200);
    expect(res.body.markets).toEqual([
      {
        city: 'Columbus',
        country: 'USA',
        countryCode: 'US',
        currencyCode: 'USD',
        distanceUnit: 'miles',
        flag: '🇺🇸',
        restaurantCount: 3,
      },
      {
        city: 'Montreal',
        country: 'Canada',
        countryCode: 'CA',
        currencyCode: 'CAD',
        distanceUnit: 'kilometers',
        flag: '🇨🇦',
        restaurantCount: 1,
      },
    ]);
    expect(mockQuery.mock.calls[0][0]).toMatch(/GROUP BY fr\.address_country, fr\.address_city/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/JOIN businesses b ON b\.id = fr\.business_id/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/b\.is_active = TRUE/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/MIN\(NULLIF\(trim\(fr\.currency_code\), ''\)\)/);
  });

  test('creates a restaurant and backing business in one transaction', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 9, business_id: 42, display_name: 'Island Grill', status: 'draft' }],
      });

    const res = await request(buildApp())
      .post('/api/food/restaurants')
      .send({
        displayName: 'Island Grill',
        cuisineTags: ['Caribbean', 'Breakfast'],
        addressCountry: 'HT',
      });

    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO businesses/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO food_restaurants/);
    expect(res.body.restaurant.display_name).toBe('Island Grill');
  });

  test('pausing a restaurant keeps its private workspace active while hiding the storefront', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 9, business_id: 42, effective_role: 'owner' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 9, business_id: 42, display_name: 'Island Grill', status: 'paused', discovery_status: 'hidden' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .patch('/api/food/restaurants/9')
      .send({ status: 'paused' });

    expect(res.status).toBe(200);
    const businessUpdate = mockQuery.mock.calls.find(([sql]) => /UPDATE businesses/.test(sql));
    expect(businessUpdate[0]).toMatch(/is_active = TRUE/);
    expect(businessUpdate[1]).toEqual(['active', false, 42]);
    expect(res.body.restaurant).toEqual(expect.objectContaining({ status: 'paused', discovery_status: 'hidden' }));
  });

  test('manager role does not bypass effective restaurant permissions', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 10, business_id: 43, effective_role: 'manager', effective_membership_id: 91 }],
      })
      .mockResolvedValueOnce({ rows: [{ code: 'orders.view', allow: true }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .patch('/api/food/restaurants/10')
      .send({ status: 'paused' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE food_restaurants/.test(sql))).toBe(false);
  });

  test('creates order totals from menu prices and assigns next queue number', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 3,
          business_id: 42,
          accepts_online_orders: true,
          currency_code: 'USD',
          prep_time_min: 12,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: '11', name: 'Classic Burger', price_cents: 899, currency_code: 'USD', is_available: true }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ next_queue: 5 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 100,
          restaurant_id: 3,
          queue_number: 5,
          subtotal_cents: 1798,
          total_cents: 1798,
          status: 'received',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 200 }] });

    const res = await request(buildApp())
      .post('/api/food/restaurants/3/orders')
      .send({
        fulfillmentType: 'pickup',
        discount_cents: 1000,
        items: [{ menuItemId: 11, quantity: 2 }],
      });

    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls[0][0]).toMatch(/b\.is_active = TRUE/);
    expect(mockQuery.mock.calls.some(([sql]) => /MAX\(queue_number\)/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_orders/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_order_items/.test(sql))).toBe(true);
    const orderInsert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO food_orders/.test(sql));
    expect(orderInsert[1][16]).toBe(0);
  });

  test('rejects online checkout mode until the restaurant connects Stripe', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 3,
        business_id: 42,
        accepts_online_orders: true,
        currency_code: 'USD',
        prep_time_min: 12,
      }],
    });

    const res = await request(buildApp())
      .post('/api/food/restaurants/3/orders')
      .send({
        fulfillmentType: 'pickup',
        paymentMode: 'pay_now',
        items: [{ menuItemId: 11, quantity: 1 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('restaurant_card_payments_unavailable');
    expect(res.body.error).toMatch(/connected Stripe/i);
    expect(mockQuery.mock.calls[0][0]).toMatch(/LEFT JOIN businesses b ON b.id = fr.business_id/);
    expect(mockQuery.mock.calls).toHaveLength(1);
  });

  test('creates a hosted Stripe checkout session for pay_now orders when the restaurant is connected', async () => {
    stripe.__mockInstance.checkout.sessions.create.mockResolvedValueOnce({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/pay/cs_test_123',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      payment_intent: 'pi_test_123',
    });

    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 3,
          business_id: 42,
          accepts_online_orders: true,
          currency_code: 'USD',
          prep_time_min: 12,
          business_stripe_account_id: 'acct_123',
          business_stripe_charges_enabled: true,
          business_stripe_payouts_enabled: true,
          business_stripe_account_status: 'active',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: '11', name: 'Classic Burger', price_cents: 899, currency_code: 'USD', is_available: true }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ next_queue: 5 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 100,
          restaurant_id: 3,
          queue_number: 5,
          subtotal_cents: 899,
          total_cents: 899,
          status: 'received',
          business_id: 42,
          currency_code: 'USD',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 200 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 100,
          restaurant_id: 3,
          queue_number: 5,
          subtotal_cents: 899,
          total_cents: 899,
          status: 'received',
          payment_status: 'requires_payment',
          business_id: 42,
          currency_code: 'USD',
          metadata: { paymentMode: 'pay_now' },
        }],
      });

    const res = await request(buildApp())
      .post('/api/food/restaurants/3/orders')
      .send({
        fulfillmentType: 'pickup',
        paymentMode: 'pay_now',
        items: [{ menuItemId: 11, quantity: 1 }],
        returnUrl: 'https://app.oxsteed.test/orders',
      });

    expect(res.status).toBe(201);
    expect(res.body.payment.mode).toBe('hosted_checkout');
    expect(res.body.payment.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_test_123');
    expect(res.body.payment.checkoutSessionId).toBe('cs_test_123');
    expect(stripe.__mockInstance.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(stripe.__mockInstance.checkout.sessions.create.mock.calls[0][0].metadata.connected_account_id).toBe('acct_123');
    expect(stripe.__mockInstance.checkout.sessions.create.mock.calls[0][1]).toEqual({ stripeAccount: 'acct_123' });
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE food_orders/.test(sql))).toBe(true);
  });

  test('rejects discount codes on pay-at-counter orders during restaurant-credit launch', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 3,
          business_id: 42,
          accepts_online_orders: true,
          currency_code: 'USD',
          prep_time_min: 12,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: '11', name: 'Classic Burger', price_cents: 899, currency_code: 'USD', is_available: true }],
      });

    const res = await request(buildApp())
      .post('/api/food/restaurants/3/orders')
      .send({
        fulfillmentType: 'pickup',
        paymentMode: 'pay_at_counter',
        discountCode: 'FOOD10',
        items: [{ menuItemId: 11, quantity: 1 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('discount_requires_wallet_credit');
    expect(mockQuery.mock.calls.some(([sql]) => /MAX\(queue_number\)/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_orders/.test(sql))).toBe(false);
  });

  test('replays an existing order when client_order_id matches', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 100,
          restaurant_id: 3,
          queue_number: 5,
          metadata: { clientOrderId: 'offline-abc', trackingToken: 'track-xyz' },
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 3, business_id: 42, currency_code: 'USD' }],
      });

    const res = await request(buildApp())
      .post('/api/food/restaurants/3/orders')
      .send({
        client_order_id: 'offline-abc',
        fulfillmentType: 'pickup',
        items: [{ menuItemId: 11, quantity: 1 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(true);
    expect(res.body.order.id).toBe(100);
    expect(res.body.trackingToken).toBe('track-xyz');
    expect(mockQuery.mock.calls[0][0]).toMatch(/customer_id = \$2/);
    expect(mockQuery.mock.calls[0][1]).toEqual([3, '00000000-0000-4000-8000-000000000123', 'offline-abc']);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('rejects idempotency key reuse for a different order request', async () => {
    const fingerprint = ctrl.buildFoodOrderIdempotencyFingerprint({
      restaurantId: 3,
      paymentMode: 'pay_at_restaurant',
      request: {
        fulfillmentType: 'pickup',
        items: [{ menuItemId: 11, quantity: 1 }],
      },
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 100,
        restaurant_id: 3,
        customer_id: '00000000-0000-4000-8000-000000000123',
        metadata: {
          clientOrderId: 'offline-abc',
          idempotency: { scope: 'food_order', version: 1, requestFingerprint: fingerprint },
        },
      }],
    });

    const res = await request(buildApp())
      .post('/api/food/restaurants/3/orders')
      .send({
        client_order_id: 'offline-abc',
        fulfillmentType: 'pickup',
        paymentMode: 'pay_now',
        items: [{ menuItemId: 11, quantity: 1 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('food_order_idempotency_conflict');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('rechecks the idempotency key after locking the restaurant', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 3,
          business_id: 42,
          accepts_online_orders: true,
          currency_code: 'USD',
          prep_time_min: 12,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 101,
          restaurant_id: 3,
          metadata: { clientOrderId: 'offline-race', trackingToken: 'track-race' },
        }],
      });

    const res = await request(buildApp())
      .post('/api/food/restaurants/3/orders')
      .send({
        client_order_id: 'offline-race',
        fulfillmentType: 'pickup',
        items: [{ menuItemId: 11, quantity: 1 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(true);
    expect(res.body.order.id).toBe(101);
    expect(res.body.trackingToken).toBe('track-race');
    expect(mockQuery.mock.calls[2][0]).toMatch(/customer_id = \$2/);
    expect(mockQuery.mock.calls[2][1]).toEqual([3, '00000000-0000-4000-8000-000000000123', 'offline-race']);
    expect(mockQuery.mock.calls).toHaveLength(3);
  });

  test('updates order status through restaurant-scoped access', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 3, business_id: 42, owner_user_id: '00000000-0000-4000-8000-000000000123', effective_role: 'owner', settings: { kitchenPrep: { requireQualityCheck: true } } }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 100,
          restaurant_id: 3,
          status: 'ready',
          kitchen_stage: 'ready',
          previous_status: 'preparing',
          previous_kitchen_stage: 'quality_check',
          fulfillment_type: 'pickup',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .patch('/api/food/restaurants/3/orders/100/status')
      .send({ status: 'ready', action: 'mark_ready' });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/JOIN businesses b ON b.id = fr.business_id/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/FOR UPDATE/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/NOT EXISTS/);
    expect(mockQuery.mock.calls[2][0]).toMatch(/INSERT INTO restaurant_kitchen_events/);
    expect(res.body.order.status).toBe('ready');
    expect(res.body.order.previous_status).toBeUndefined();
  });

  test('does not publish a kitchen order as ready while required items are incomplete', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 3, business_id: 42, owner_user_id: '00000000-0000-4000-8000-000000000123', effective_role: 'owner', settings: {} }],
      })
      .mockResolvedValueOnce({
        rows: [],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 100, restaurant_id: 3, status: 'preparing', kitchen_stage: 'quality_check', fulfillment_type: 'pickup' }],
      })
      .mockResolvedValueOnce({ rows: [{ total_items: 3, finished_items: 2 }] });

    const res = await request(buildApp())
      .patch('/api/food/restaurants/3/orders/100/status')
      .send({ status: 'ready', action: 'mark_ready' });

    expect(res.status).toBe(409);
    expect(res.body.code || res.body.error?.code).toBe('kitchen_items_incomplete');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE food_orders/.test(sql))).toBe(true);
  });

  test('filters restaurant orders to POS sources for compatibility clients', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 3, business_id: 42, owner_user_id: '00000000-0000-4000-8000-000000000123', effective_role: 'owner' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .get('/api/food/restaurants/3/orders?source=pos');

    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual([]);
    expect(mockQuery.mock.calls[1][0]).toMatch(/fo\.order_source = ANY\(\$2::text\[\]\)/);
    expect(mockQuery.mock.calls[1][1][1]).toEqual(expect.arrayContaining(['counter', 'kiosk', 'tablet']));
  });

  test('keeps legacy payment patch route ledger-backed instead of mutating status directly', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 3, business_id: 42, owner_user_id: '00000000-0000-4000-8000-000000000123', effective_role: 'owner' }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 100 }] });

    const res = await request(buildApp())
      .patch('/api/food/restaurants/3/orders/100/payment')
      .send({ paymentStatus: 'paid' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('payment_transaction_required');
    expect(res.body.fields.createPaymentPath).toBe('/api/restaurants/3/pos/orders/100/payments');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE food_orders/.test(sql))).toBe(false);
  });

  test('creates a review for a completed customer order', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: '00000000-0000-4000-8000-000000000123' };
      next();
    });
    app.post('/api/food/orders/:orderId/review', ctrl.createOrderReview);
    app.use(errorHandler);

    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 100,
          restaurant_id: 3,
          customer_id: '00000000-0000-4000-8000-000000000123',
          status: 'completed',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          restaurant_id: 3,
          order_id: 100,
          customer_id: '00000000-0000-4000-8000-000000000123',
          rating: 5,
          body: 'Great',
        }],
      });

    const res = await request(app)
      .post('/api/food/orders/100/review')
      .send({ rating: 5, body: 'Great' });

    expect(res.status).toBe(201);
    expect(res.body.review.rating).toBe(5);
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO food_reviews/);
  });

  test('rejects review when order is not completed', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: '00000000-0000-4000-8000-000000000123' };
      next();
    });
    app.post('/api/food/orders/:orderId/review', ctrl.createOrderReview);
    app.use(errorHandler);

    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 100,
        restaurant_id: 3,
        customer_id: '00000000-0000-4000-8000-000000000123',
        status: 'preparing',
      }],
    });

    const res = await request(app)
      .post('/api/food/orders/100/review')
      .send({ rating: 4 });

    expect(res.status).toBe(409);
    expect(res.body.error?.code || res.body.code).toBe('order_not_reviewable');
  });

  test('requires the private tracking token for the public checkout cancel page', async () => {
    const app = express();
    app.use(express.json());
    app.get('/api/food/orders/:orderId/checkout/cancelled', ctrl.cancelCheckout);
    app.use(errorHandler);

    const missingToken = await request(app)
      .get('/api/food/orders/100/checkout/cancelled');

    expect(missingToken.status).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();

    mockQuery.mockResolvedValueOnce({ rows: [{ queue_number: 12 }] });
    const validToken = await request(app)
      .get('/api/food/orders/100/checkout/cancelled')
      .query({ tracking_token: 'private-random-token' });

    expect(validToken.status).toBe(200);
    expect(validToken.text).toContain('Checkout cancelled');
    expect(mockQuery.mock.calls[0][0]).toMatch(/metadata->>'trackingToken'/);
    expect(mockQuery.mock.calls[0][1]).toEqual([100, 'private-random-token']);
  });
});
