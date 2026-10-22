'use strict';

const { _normalize: normalize } = require('../controllers/restaurantGiftCardController');
const giftCardValue = require('../services/restaurantGiftCardService');

describe('restaurant gift-card product catalog validation', () => {
  test('normalizes supported SKU, currency, and delivery type values', () => {
    expect(normalize.normalizeSku(' spring-25 ')).toBe('SPRING-25');
    expect(normalize.normalizeCurrency('usd')).toBe('USD');
    expect(normalize.normalizeDeliveryType('e-gift')).toBe('e_gift');
    expect(normalize.normalizeActive('false')).toBe(false);
    expect(normalize.normalizeAmount(2500)).toBe(2500);
  });

  test('rejects malformed catalog values and keeps the catalog bounded', () => {
    expect(() => normalize.normalizeSku('x')).toThrow(/SKU/);
    expect(() => normalize.normalizeAmount(0)).toThrow(/amount/);
    expect(() => normalize.normalizeAmount(1000001)).toThrow(/amount/);
    expect(() => normalize.normalizeCurrency('US')).toThrow(/Currency/);
    expect(() => normalize.normalizeDeliveryType('reloadable')).toThrow(/Delivery type/);
    expect(() => normalize.normalizeActive('maybe')).toThrow(/isActive/);
  });

  test('gift-card value codes are normalized and hashed without retaining plaintext', () => {
    expect(giftCardValue.normalizeCode(' abcd-2345-efgh-6789 ')).toBe('ABCD2345EFGH6789');
    const digest = giftCardValue.hashCode('ABCD2345EFGH6789');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain('ABCD2345EFGH6789');
    expect(giftCardValue.generateCode()).toMatch(/^[A-Z2-9]{16}$/);
  });

  test('value issue inputs require a valid product and customer UUID when supplied', () => {
    const { _valueNormalize: valueNormalize } = require('../controllers/restaurantGiftCardController');
    expect(valueNormalize.issueProductId(9)).toBe(9);
    expect(valueNormalize.issueCustomerId('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(() => valueNormalize.issueProductId(0)).toThrow(/product/);
    expect(() => valueNormalize.issueCustomerId('not-a-uuid')).toThrow(/Customer/);
  });
});
