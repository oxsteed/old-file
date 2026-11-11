'use strict';

require('./setup');

const { mockQuery, resetMocks } = require('./setup');
const stripeMock = require('stripe').__mockInstance;
const controller = require('../controllers/cartCheckoutController');

function res() {
  const response = { statusCode: 200 };
  response.status = jest.fn((code) => { response.statusCode = code; return response; });
  response.json = jest.fn((body) => { response.body = body; return response; });
  return response;
}

beforeEach(() => {
  resetMocks();
  stripeMock.paymentIntents.create.mockReset();
});

test('cancels an orphaned marketplace intent and order when transaction recording fails', async () => {
  const cancel = jest.fn().mockResolvedValue({ id: 'pi-market-1', status: 'canceled' });
  const previousCancel = stripeMock.paymentIntents.cancel;
  stripeMock.paymentIntents.cancel = cancel;
  try {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'cart-1' }] }) // cart
      .mockResolvedValueOnce({ rows: [{
        product_id: 'product-1', price_cents: 2500, quantity: 1, quantity_available: 3,
        affiliate_url: null, business_product_id: null, source_business_id: null,
      }] }) // items
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // reusable pending order
      .mockResolvedValueOnce({ rows: [{ id: 77, cart_id: 'cart-1', status: 'pending' }] }) // order
      .mockResolvedValueOnce({ rows: [] }) // order item
      .mockRejectedValueOnce(new Error('transaction insert unavailable'))
      .mockResolvedValueOnce({ rows: [] }); // cancel local order
    stripeMock.paymentIntents.create.mockResolvedValueOnce({ id: 'pi-market-1', client_secret: 'secret', status: 'requires_payment_method' });

    const response = res();
    await controller.createPaymentIntent({
      user: { id: 'customer-1' },
      body: { cartId: 'cart-1', email: 'customer@example.com' },
    }, response);

    expect(response.statusCode).toBe(500);
    expect(cancel).toHaveBeenCalledWith('pi-market-1');
    const orderCancel = mockQuery.mock.calls.find(([sql]) => /SET status = 'cancelled'/.test(sql));
    expect(orderCancel).toBeTruthy();
    expect(orderCancel[1]).toEqual([77]);
  } finally {
    if (previousCancel) stripeMock.paymentIntents.cancel = previousCancel;
    else delete stripeMock.paymentIntents.cancel;
  }
});

test('fails closed and cancels the order when Stripe omits the client secret', async () => {
  const cancel = jest.fn().mockResolvedValue({ id: 'pi-market-missing-secret', status: 'canceled' });
  const previousCancel = stripeMock.paymentIntents.cancel;
  stripeMock.paymentIntents.cancel = cancel;
  try {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'cart-1' }] }) // cart
      .mockResolvedValueOnce({ rows: [{
        product_id: 'product-1', price_cents: 2500, quantity: 1, quantity_available: 3,
        affiliate_url: null, business_product_id: null, source_business_id: null,
      }] }) // items
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // reusable pending order
      .mockResolvedValueOnce({ rows: [{ id: 78, cart_id: 'cart-1', status: 'pending' }] }) // order
      .mockResolvedValueOnce({ rows: [] }) // order item
      .mockResolvedValueOnce({ rows: [] }); // cancel local order
    stripeMock.paymentIntents.create.mockResolvedValueOnce({ id: 'pi-market-missing-secret', client_secret: null });

    const response = res();
    await controller.createPaymentIntent({
      user: { id: 'customer-1' },
      body: { cartId: 'cart-1', email: 'customer@example.com' },
    }, response);

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual(expect.objectContaining({ code: 'payment_intent_unavailable' }));
    expect(cancel).toHaveBeenCalledWith('pi-market-missing-secret');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO marketplace_transactions/.test(sql))).toBe(false);
    const orderCancel = mockQuery.mock.calls.find(([sql]) => /SET status = 'cancelled'/.test(sql));
    expect(orderCancel?.[1]).toEqual([78]);
  } finally {
    if (previousCancel) stripeMock.paymentIntents.cancel = previousCancel;
    else delete stripeMock.paymentIntents.cancel;
  }
});

test('rejects a reusable marketplace payment row without a client secret', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'cart-1' }] }) // cart
    .mockResolvedValueOnce({ rows: [{
      product_id: 'product-1', price_cents: 2500, quantity: 1, quantity_available: 3,
      affiliate_url: null, business_product_id: null, source_business_id: null,
    }] }) // items
    .mockResolvedValueOnce({ rows: [] }) // advisory lock
    .mockResolvedValueOnce({ rows: [{ id: 79, payment_intent_id: 'pi-replay', client_secret: null }] }); // reusable order

  const response = res();
  await controller.createPaymentIntent({
    user: { id: 'customer-1' },
    body: { cartId: 'cart-1', email: 'customer@example.com' },
  }, response);

  expect(response.statusCode).toBe(503);
  expect(response.body).toEqual(expect.objectContaining({ code: 'payment_intent_unavailable' }));
  expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
});
