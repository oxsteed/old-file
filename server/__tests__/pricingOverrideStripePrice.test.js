const pricingService = require('../services/pricingService');
const { mockQuery, resetMocks } = require('./setup');

describe('pricingService.updatePremiumPrice Stripe sync', () => {
  beforeEach(() => {
    resetMocks();
    pricingService.invalidateCache();
    delete process.env.STRIPE_PREMIUM_PRODUCT_ID;
    stripePriceCreate.mockReset();
  });

  const stripePriceCreate = jest.fn();

  function oldRow() {
    return {
      rows: [{
        id: 7,
        price_cents: 2900,
        currency_code: 'USD',
        stripe_price_id: 'price_old',
      }],
    };
  }

  function upsertResult(stripePriceId) {
    return {
      rows: [{
        id: 7,
        country_code: 'US',
        price_cents: 3500,
        currency_code: 'USD',
        stripe_price_id: stripePriceId,
      }],
    };
  }

  test('an override that changes the price creates a new Stripe price id', async () => {
    stripePriceCreate.mockResolvedValue({ id: 'price_new' });
    const stripeClient = { prices: { create: stripePriceCreate } };

    mockQuery
      .mockResolvedValueOnce(oldRow())            // SELECT old row
      .mockResolvedValueOnce({ rows: [] })        // INSERT audit log
      .mockResolvedValueOnce(upsertResult('price_new')); // upsert RETURNING

    const updated = await pricingService.updatePremiumPrice(
      'US',
      3500,
      'USD',
      'Regional adjustment',
      'admin-1',
      'iphash',
      { stripeClient, productId: 'prod_premium' }
    );

    expect(stripePriceCreate).toHaveBeenCalledTimes(1);
    expect(stripePriceCreate).toHaveBeenCalledWith(expect.objectContaining({
      product: 'prod_premium',
      unit_amount: 3500,
      currency: 'usd',
      recurring: { interval: 'month' },
      nickname: 'OxSteed Premium US',
      metadata: expect.objectContaining({ country_code: 'US', pricing_override_id: '7' }),
    }));

    // The upsert must carry the new Stripe price id so checkout charges it.
    expect(mockQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO pricing_overrides'),
      ['US', 3500, 'USD', 'admin-1', 'price_new', true]
    );
    expect(updated.stripe_price_id).toBe('price_new');
  });

  test('without a Stripe client the stale id is cleared so the sync job recreates it', async () => {
    mockQuery
      .mockResolvedValueOnce(oldRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(upsertResult(null));

    const updated = await pricingService.updatePremiumPrice(
      'US',
      3500,
      'USD',
      'Regional adjustment',
      'admin-1',
      'iphash'
    );

    expect(stripePriceCreate).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO pricing_overrides'),
      ['US', 3500, 'USD', 'admin-1', null, true]
    );
    expect(updated.stripe_price_id).toBeNull();
  });

  test('an unchanged price keeps the existing Stripe price id', async () => {
    const stripeClient = { prices: { create: stripePriceCreate } };

    mockQuery
      .mockResolvedValueOnce(oldRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 7, country_code: 'US', price_cents: 2900, currency_code: 'USD', stripe_price_id: 'price_old' }],
      });

    const updated = await pricingService.updatePremiumPrice(
      'US',
      2900,
      'USD',
      'No-op update',
      'admin-1',
      'iphash',
      { stripeClient, productId: 'prod_premium' }
    );

    expect(stripePriceCreate).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO pricing_overrides'),
      ['US', 2900, 'USD', 'admin-1', 'price_old', false]
    );
    expect(updated.stripe_price_id).toBe('price_old');
  });
});
