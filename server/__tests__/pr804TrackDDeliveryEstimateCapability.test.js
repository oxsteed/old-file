'use strict';

/**
 * PR #804 Track D, G-29 (delivery estimates presented as live but fail
 * on every submit without a geo provider).
 *
 * The estimate form gates on the public geocoding capability flag
 * (GET /api/config/capabilities): when no geo provider key is configured
 * the EstimateCard renders an honest "delivery estimates are unavailable
 * right now" state with the form disabled, instead of a live-looking
 * form whose every submit fails server-side.
 *
 * This suite pins the flag the UI reads: geocoding is available exactly
 * when GOOGLE_MAPS_API_KEY is set, unavailable otherwise. No provider
 * keys are set by the fix; the flag only reports configuration.
 */
const { getPublicCapabilities } = require('../services/featureCapabilities');

describe('G-29 delivery estimate geocoding capability flag', () => {
  const OLD_KEY = process.env.GOOGLE_MAPS_API_KEY;

  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = OLD_KEY;
  });

  test('geocoding is unavailable with no provider key configured', () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const capabilities = getPublicCapabilities();
    expect(capabilities.geocoding.available).toBe(false);
    expect(capabilities.geocoding.status).toBe('unavailable');
    expect(capabilities.geocoding.unavailableReason).toBe('configuration_missing');
  });

  test('geocoding is available when the provider key is configured', () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const capabilities = getPublicCapabilities();
    expect(capabilities.geocoding.available).toBe(true);
    expect(capabilities.geocoding.status).toBe('available');
    expect(capabilities.geocoding.unavailableReason).toBeUndefined();
  });

  test('a blank provider key does not count as configured', () => {
    process.env.GOOGLE_MAPS_API_KEY = '   ';
    expect(getPublicCapabilities().geocoding.available).toBe(false);
  });
});
