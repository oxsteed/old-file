const pricingService = require('../services/pricingService');
const { mockQuery, resetMocks } = require('./setup');

describe('pricingService.syncRegionalPricesToStripe', () => {
  beforeEach(() => {
    resetMocks();
    pricingService.invalidateCache();
  });

  test('creates Stripe prices only for active overrides missing a stripe_price_id', async () => {
    const stripeClient = {
      prices: {
        create: jest.fn()
          .mockResolvedValueOnce({ id: 'price_us_new' })
          .mockResolvedValueOnce({ id: 'price_gb_new' }),
      },
    };

    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 1, country_code: 'US', price_cents: 2900, currency_code: 'USD', stripe_price_id: null },
          { id: 2, country_code: 'CA', price_cents: 3500, currency_code: 'CAD', stripe_price_id: 'price_ca_existing' },
          { id: 3, country_code: 'GB', price_cents: 2300, currency_code: 'GBP', stripe_price_id: null },
        ],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await pricingService.syncRegionalPricesToStripe({
      stripeClient,
      productId: 'prod_premium',
    });

    expect(stripeClient.prices.create).toHaveBeenCalledTimes(2);
    expect(stripeClient.prices.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      product: 'prod_premium',
      unit_amount: 2900,
      currency: 'usd',
      recurring: { interval: 'month' },
      nickname: 'OxSteed Premium US',
      metadata: expect.objectContaining({ country_code: 'US', pricing_override_id: '1' }),
    }));
    expect(stripeClient.prices.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      unit_amount: 2300,
      currency: 'gbp',
      nickname: 'OxSteed Premium GB',
    }));
    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE pricing_overrides'), ['price_us_new', 1]);
    expect(mockQuery).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE pricing_overrides'), ['price_gb_new', 3]);
    expect(result).toEqual({
      synced: 2,
      skipped: 1,
      failed: 0,
      results: [
        { country_code: 'US', status: 'synced', stripe_price_id: 'price_us_new' },
        { country_code: 'CA', status: 'skipped', reason: 'already_synced', stripe_price_id: 'price_ca_existing' },
        { country_code: 'GB', status: 'synced', stripe_price_id: 'price_gb_new' },
      ],
    });
  });

  test('requires a configured Stripe client and product id', async () => {
    await expect(pricingService.syncRegionalPricesToStripe({
      stripeClient: null,
      productId: 'prod_premium',
    })).rejects.toThrow('Stripe client is not configured');

    await expect(pricingService.syncRegionalPricesToStripe({
      stripeClient: { prices: { create: jest.fn() } },
      productId: '',
    })).rejects.toThrow('STRIPE_PREMIUM_PRODUCT_ID is required');
  });
});
