'use strict';

const {
  calculateLocalDeliveryPrice,
  DEFAULTS,
} = require('../services/localDeliveryPricing');

describe('local delivery launch pricing', () => {
  test('applies the minimum fare and platform minimum to a short standard delivery', () => {
    const quote = calculateLocalDeliveryPrice({ distanceMiles: 2, packageType: 'small', serviceLevel: 'standard' });

    expect(quote.cents.deliverySubtotal).toBe(DEFAULTS.minimumFareCents);
    expect(quote.cents.platformFee).toBe(DEFAULTS.platformFeeMinimumCents);
    expect(quote.cents.customerTotal).toBe(1799);
    expect(quote.cents.driverPayout).toBe(DEFAULTS.driverMinimumCents);
  });

  test('adds distance, package size, and speed adjustments', () => {
    const quote = calculateLocalDeliveryPrice({
      distanceMiles: 12,
      packageType: 'large',
      serviceLevel: 'rush',
    });

    expect(quote.cents.deliverySubtotal).toBe(4489);
    expect(quote.breakdown.distance).toBe(12.25);
    expect(quote.breakdown.packageSurcharge).toBe(12);
    expect(quote.cents.platformFee).toBe(539);
  });

  test('enforces package weight limits', () => {
    expect(() => calculateLocalDeliveryPrice({ packageType: 'small', weightLbs: 25.1 }))
      .toThrow('Weight exceeds the small package limit');
  });

  test('clamps demand pricing to the safe launch range', () => {
    const quote = calculateLocalDeliveryPrice({ distanceMiles: 10, demandMultiplier: 5 });
    expect(quote.demandMultiplier).toBe(1.5);
    expect(quote.cents.deliverySubtotal).toBe(2663);
  });

  test('passes tolls and parking through without changing the driver payout', () => {
    const quote = calculateLocalDeliveryPrice({ distanceMiles: 5, tollsCents: 425, parkingCents: 300 });
    expect(quote.cents.passThrough).toBe(725);
    expect(quote.cents.customerTotal).toBe(2524);
    expect(quote.cents.driverPayout).toBe(DEFAULTS.driverMinimumCents);
  });
});
