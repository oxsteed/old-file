'use strict';

// Unit tests for the F-08 hub service validation (the money-moving replay is
// covered by storeHubReplay.db.test.js).

const hub = require('../services/storeHubService');

function sale(overrides = {}) {
  return {
    hubSaleUuid: '123e4567-e89b-12d3-a456-426614174000',
    idempotencyKey: 'hub-sale-key-0001',
    shiftId: 7,
    items: [{ menuItemId: 11, quantity: 2, unitPriceCents: 650 }],
    subtotalCents: 1300,
    taxCents: 104,
    tipCents: 0,
    discountCents: 0,
    totalCents: 1404,
    cashTenderedCents: 1500,
    ...overrides,
  };
}

describe('offline sale normalization', () => {
  test('accepts a well-formed cash sale', () => {
    const normalized = hub.normalizeOfflineSale(sale());
    expect(normalized.totalCents).toBe(1404);
    expect(normalized.lines).toHaveLength(1);
    expect(normalized.currencyCode).toBe('USD');
  });

  test('rejects totals that do not reconcile', () => {
    expect(() => hub.normalizeOfflineSale(sale({ totalCents: 1405 }))).toThrow('does not match');
    expect(() => hub.normalizeOfflineSale(sale({ subtotalCents: 1200 }))).toThrow('does not match');
    try {
      hub.normalizeOfflineSale(sale({ totalCents: 1405 }));
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.code).toBe('totals_mismatch');
    }
  });

  test('rejects under-tendered cash', () => {
    expect(() => hub.normalizeOfflineSale(sale({ cashTenderedCents: 1400 }))).toThrow('must cover');
  });

  test('rejects malformed identifiers', () => {
    expect(() => hub.normalizeOfflineSale(sale({ hubSaleUuid: 'nope' }))).toThrow('UUID');
    expect(() => hub.normalizeOfflineSale(sale({ idempotencyKey: 'short' }))).toThrow('8-200');
    expect(() => hub.normalizeOfflineSale(sale({ items: [] }))).toThrow('non-empty array');
  });

  test('rejects bad line quantities and prices', () => {
    expect(() => hub.normalizeOfflineSale(sale({ items: [{ menuItemId: 11, quantity: 0, unitPriceCents: 650 }] }))).toThrow('quantity');
    expect(() => hub.normalizeOfflineSale(sale({ items: [{ menuItemId: 11, quantity: 1, unitPriceCents: -5 }] }))).toThrow('unitPriceCents');
  });
});

describe('hub name validation', () => {
  test('accepts a normal name', () => {
    expect(hub.normalizeHubName('Front counter hub')).toBe('Front counter hub');
  });
  test('rejects blank and overlong names', () => {
    expect(() => hub.normalizeHubName(' ')).toThrow();
    expect(() => hub.normalizeHubName('x'.repeat(161))).toThrow();
  });
});
