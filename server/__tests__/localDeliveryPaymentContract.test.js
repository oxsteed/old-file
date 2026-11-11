'use strict';

const { checkoutUrlForSession } = require('../services/localDeliveryPaymentService');

test('open unpaid delivery checkouts require a usable HTTPS URL', () => {
  const payment = { id: 1, captured_at: null };
  expect(checkoutUrlForSession({ status: 'open', url: 'https://checkout.stripe.com/cs_1' }, payment)).toBe('https://checkout.stripe.com/cs_1');
  expect(() => checkoutUrlForSession({ status: 'open', url: null }, payment)).toThrow(expect.objectContaining({
    status: 503,
    code: 'delivery_payment_checkout_unavailable',
  }));
  expect(() => checkoutUrlForSession({ status: 'open', url: 'http://checkout.stripe.com/cs_1' }, payment)).toThrow(expect.objectContaining({
    status: 503,
    code: 'delivery_payment_checkout_unavailable',
  }));
});

test('settled and non-open sessions do not require a redirect URL', () => {
  expect(checkoutUrlForSession({ status: 'complete', url: null }, { captured_at: null })).toBeNull();
  expect(checkoutUrlForSession({ status: 'open', url: null }, { captured_at: new Date().toISOString() })).toBeNull();
});

