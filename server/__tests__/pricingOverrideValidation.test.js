'use strict';

/**
 * pricingOverrideValidation.test.js
 *
 * ADM-165: batchUpdatePricing caps the updates array at 100 entries.
 * ADM-206: price_cents=0 (free tier) is accepted; only null/negative fail.
 */

const { resetMocks } = require('./setup');

jest.mock('../services/pricingService', () => ({
  ...jest.requireActual('../services/pricingService'),
  updatePremiumPrice: jest.fn().mockResolvedValue({ country_code: 'US', price_cents: 0 }),
}));

const controller = require('../controllers/pricingOverrideController');
const { updatePremiumPrice } = require('../services/pricingService');

function requestDouble(params, body) {
  return { params, body, user: { id: 'admin-1' }, ip: '127.0.0.1' };
}

beforeEach(() => {
  resetMocks();
  updatePremiumPrice.mockClear();
});

describe('pricing override validation (ADM-165/ADM-206)', () => {
  test('ADM-165: batch with more than 100 updates is rejected', async () => {
    const updates = Array.from({ length: 101 }, (_, i) => ({
      country_code: `C${i}`, price_cents: 100, currency_code: 'USD',
    }));
    const next = jest.fn();
    await controller.batchUpdatePricing(requestDouble({}, { updates }), {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400, code: 'validation_failed' }));
    expect(updatePremiumPrice).not.toHaveBeenCalled();
  });

  test('ADM-165: batch with exactly 100 updates is accepted', async () => {
    const updates = Array.from({ length: 100 }, (_, i) => ({
      country_code: `C${i}`, price_cents: 100, currency_code: 'USD',
    }));
    const res = { json: jest.fn() };
    await controller.batchUpdatePricing(requestDouble({}, { updates, reason: 't' }), res, jest.fn());
    expect(updatePremiumPrice).toHaveBeenCalledTimes(100);
    expect(res.json).toHaveBeenCalled();
  });

  test('ADM-206: single update accepts price_cents=0 (free tier)', async () => {
    const res = { json: jest.fn() };
    const next = jest.fn();
    await controller.updatePricingOverride(
      requestDouble({ countryCode: 'HT' }, { price_cents: 0, currency_code: 'USD' }),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(updatePremiumPrice).toHaveBeenCalledWith('HT', 0, 'USD', undefined, 'admin-1', expect.any(String), expect.anything());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('ADM-206: batch accepts price_cents=0 entries', async () => {
    const res = { json: jest.fn() };
    await controller.batchUpdatePricing(
      requestDouble({}, { updates: [{ country_code: 'HT', price_cents: 0, currency_code: 'USD' }] }),
      res,
      jest.fn()
    );
    expect(updatePremiumPrice).toHaveBeenCalledWith('HT', 0, 'USD', undefined, 'admin-1', expect.any(String), expect.anything());
  });

  test('negative price_cents is still rejected', async () => {
    const next = jest.fn();
    await controller.updatePricingOverride(
      requestDouble({ countryCode: 'HT' }, { price_cents: -5, currency_code: 'USD' }),
      {},
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400, code: 'validation_failed' }));
    expect(updatePremiumPrice).not.toHaveBeenCalled();
  });
});
