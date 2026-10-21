'use strict';

const { _normalize: normalize } = require('../controllers/restaurantGiftCardController');

describe('restaurant gift-card product catalog validation', () => {
  test('normalizes supported SKU, currency, and delivery type values', () => {
    expect(normalize.normalizeSku(' spring-25 ')).toBe('SPRING-25');
    expect(normalize.normalizeCurrency('usd')).toBe('USD');
    expect(normalize.normalizeDeliveryType('e-gift')).toBe('e_gift');
    expect(normalize.normalizeAmount(2500)).toBe(2500);
  });

  test('rejects malformed catalog values and keeps the catalog bounded', () => {
    expect(() => normalize.normalizeSku('x')).toThrow(/SKU/);
    expect(() => normalize.normalizeAmount(0)).toThrow(/amount/);
    expect(() => normalize.normalizeAmount(1000001)).toThrow(/amount/);
    expect(() => normalize.normalizeCurrency('US')).toThrow(/Currency/);
    expect(() => normalize.normalizeDeliveryType('reloadable')).toThrow(/Delivery type/);
  });
});
