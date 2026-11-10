'use strict';

const { isCheckoutEnabled, orderKey, receiptForOrder } = require('../services/creditKioskCheckout');

test('the Credit checkout pilot requires the exact paired USD kiosk and an assigned store', () => {
  const pilot = {
    device: { id: '23', app_key: 'display' },
    role: 'kiosk',
    locationId: '45',
    restaurant: { screens_v2_enabled: true, currency_code: 'USD' },
  };
  const previous = process.env.OXSTEED_CREDIT_CHECKOUT_KIOSK_ID;
  try {
    delete process.env.OXSTEED_CREDIT_CHECKOUT_KIOSK_ID;
    expect(isCheckoutEnabled(pilot)).toBe(false);
    process.env.OXSTEED_CREDIT_CHECKOUT_KIOSK_ID = '23';
    expect(isCheckoutEnabled(pilot)).toBe(true);
    expect(isCheckoutEnabled({ ...pilot, locationId: null })).toBe(false);
    expect(isCheckoutEnabled({ ...pilot, role: 'queue' })).toBe(false);
    expect(isCheckoutEnabled({ ...pilot, device: { ...pilot.device, id: '24' } })).toBe(false);
    expect(isCheckoutEnabled({ ...pilot, restaurant: { ...pilot.restaurant, currency_code: 'EUR' } })).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.OXSTEED_CREDIT_CHECKOUT_KIOSK_ID;
    else process.env.OXSTEED_CREDIT_CHECKOUT_KIOSK_ID = previous;
  }
});

test('checkout recovery uses a device-scoped opaque ID and returns only receipt fields', () => {
  const attempt = '00000000-0000-4000-8000-000000000001';
  expect(orderKey(23, attempt)).toBe(`credit-kiosk:23:${attempt}`);
  expect(orderKey(24, attempt)).not.toBe(orderKey(23, attempt));
  expect(() => orderKey(23, '../card')).toThrow('checkout attempt ID');
  expect(receiptForOrder({
    id: '789', queue_number: 4, total_cents: '450', currency_code: 'USD', payment_status: 'paid',
    customer_id: 'private', metadata: { internal: true },
  })).toEqual({ orderId: '789', queueNumber: 4, amountCents: 450, currencyCode: 'USD', paymentStatus: 'paid' });
});
