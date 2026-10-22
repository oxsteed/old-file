'use strict';

// Unit tests for the F-02 phase 2 brand service (validation only; the
// database-backed publish path is covered by restaurantBrandPublish.db.test.js).

const brand = require('../services/restaurantBrandService');

describe('restaurant brand publish request validation', () => {
  const base = {
    sourceRestaurantId: 11,
    targetRestaurantIds: [22, 33],
    idempotencyKey: 'brand-publish-0001',
  };

  test('accepts a full cross-restaurant publish request', () => {
    expect(brand.normalizePublishRequest({
      ...base,
      sourceMenuItemIds: [101, 102],
      targetLocationIds: [5, 6],
      priceCents: 1299,
      isAvailable: false,
    })).toEqual({
      sourceRestaurantId: 11,
      sourceMenuItemIds: [101, 102],
      targetRestaurantIds: [22, 33],
      targetLocationIds: [5, 6],
      priceCents: 1299,
      isAvailable: false,
      idempotencyKey: 'brand-publish-0001',
    });
  });

  test('defaults optional fields to null (whole menu, all stores)', () => {
    const request = brand.normalizePublishRequest(base);
    expect(request.sourceMenuItemIds).toBeNull();
    expect(request.targetLocationIds).toBeNull();
    expect(request.priceCents).toBeNull();
    expect(request.isAvailable).toBeNull();
  });

  test('rejects the source restaurant as a target', () => {
    expect(() => brand.normalizePublishRequest({ ...base, targetRestaurantIds: [11, 22] }))
      .toThrow('source restaurant cannot be a target');
  });

  test('rejects duplicate targets and empty target sets', () => {
    expect(() => brand.normalizePublishRequest({ ...base, targetRestaurantIds: [22, 22] }))
      .toThrow('Target restaurants must be unique');
    expect(() => brand.normalizePublishRequest({ ...base, targetRestaurantIds: [] }))
      .toThrow('At least one');
  });

  test('rejects negative price overrides and non-boolean availability', () => {
    expect(() => brand.normalizePublishRequest({ ...base, priceCents: -5 }))
      .toThrow('non-negative integer');
    expect(() => brand.normalizePublishRequest({ ...base, isAvailable: 'yes' }))
      .toThrow('must be a boolean');
  });

  test('requires a usable idempotency key', () => {
    expect(() => brand.normalizePublishRequest({ ...base, idempotencyKey: 'short' }))
      .toThrow('idempotency key');
    expect(() => brand.normalizePublishRequest({ ...base, idempotencyKey: '   ' }))
      .toThrow('idempotency key');
  });

  test('rejects invalid identifiers', () => {
    expect(() => brand.normalizePublishRequest({ ...base, sourceRestaurantId: 'abc' })).toThrow();
    expect(() => brand.normalizePublishRequest({ ...base, targetRestaurantIds: [0] })).toThrow();
  });
});
