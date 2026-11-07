'use strict';

// Finding 1 (design review 2026-11-06): FX conversion ignored
// per-currency minor-unit exponents — Math.round(amount * rate) on
// integer minor units against a major-to-major rate, wrong by 100x
// for JPY and 1000x for BHD. Conversion must go through major
// units on both sides using each currency's own exponent.
// Pure unit test: a stub client stands in for the rates table.

const fx = require('../services/restaurantFxService');

function stubClient(rates) {
  return {
    query: jest.fn(async (sql, params) => {
      if (String(sql).includes('FROM restaurant_fx_rates')) {
        const key = `${params[0]}|${params[1]}`;
        const row = rates[key];
        return { rows: row ? [row] : [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }),
  };
}

const RATES = {
  'JPY|USD': { base_currency: 'JPY', quote_currency: 'USD', rate: 0.0067, rate_date: '2026-10-01', source: 'stored' },
  'USD|BHD': { base_currency: 'USD', quote_currency: 'BHD', rate: 0.376, rate_date: '2026-10-01', source: 'stored' },
  'BHD|USD': { base_currency: 'BHD', quote_currency: 'USD', rate: 2.659, rate_date: '2026-10-01', source: 'stored' },
  'USD|EUR': { base_currency: 'USD', quote_currency: 'EUR', rate: 0.92, rate_date: '2026-10-01', source: 'stored' },
};

describe('FX conversion respects minor-unit exponents', () => {
  const client = stubClient(RATES);

  test('JPY (0 decimals) to USD: 100500 yen converts to 67335 cents, not 673', async () => {
    const converted = await fx.convertAmount(client, {
      amountCents: 100500, fromCurrency: 'JPY', toCurrency: 'USD', rateDate: '2026-10-15',
    });
    expect(converted.missingRate).toBe(false);
    // 100500 JPY x 0.0067 = $673.35 = 67335 cents.
    expect(converted.convertedCents).toBe(67335);
    expect(converted.rate).toBe(0.0067);
  });

  test('USD to BHD (3 decimals): $100.00 converts to 37600 fils, not 3760', async () => {
    const converted = await fx.convertAmount(client, {
      amountCents: 10000, fromCurrency: 'USD', toCurrency: 'BHD', rateDate: '2026-10-15',
    });
    expect(converted.missingRate).toBe(false);
    // $100.00 x 0.376 = 37.600 BHD = 37600 fils.
    expect(converted.convertedCents).toBe(37600);
  });

  test('BHD (3 decimals) to USD: 123.456 BHD converts to 32827 cents, not 328270', async () => {
    const converted = await fx.convertAmount(client, {
      amountCents: 123456, fromCurrency: 'BHD', toCurrency: 'USD', rateDate: '2026-10-15',
    });
    expect(converted.missingRate).toBe(false);
    // 123.456 BHD x 2.659 = $328.269504 -> 32827 cents.
    expect(converted.convertedCents).toBe(32827);
  });

  test('two-decimal to two-decimal conversion is unchanged', async () => {
    const converted = await fx.convertAmount(client, {
      amountCents: 10000, fromCurrency: 'USD', toCurrency: 'EUR', rateDate: '2026-10-15',
    });
    expect(converted.convertedCents).toBe(9200);
  });

  test('same-currency JPY conversion is exact with no stored rate', async () => {
    const converted = await fx.convertAmount(client, {
      amountCents: 100500, fromCurrency: 'JPY', toCurrency: 'JPY', rateDate: '2026-10-15',
    });
    expect(converted.missingRate).toBe(false);
    expect(converted.convertedCents).toBe(100500);
    expect(converted.rate).toBe(1);
  });

  test('a missing rate still fails closed', async () => {
    const converted = await fx.convertAmount(client, {
      amountCents: 10000, fromCurrency: 'EUR', toCurrency: 'JPY', rateDate: '2026-10-15',
    });
    expect(converted.missingRate).toBe(true);
  });

  test('convertBreakdown totals in the reporting currency minor units', async () => {
    const converted = await fx.convertBreakdown(client, {
      entries: [
        { currencyCode: 'JPY', amountCents: 100500 },
        { currencyCode: 'BHD', amountCents: 123456 },
      ],
      reportingCurrency: 'USD',
      rateDate: '2026-10-15',
    });
    expect(converted.missingCurrencies).toEqual([]);
    // 67335 + 32827 = 100162 USD cents.
    expect(converted.convertedTotalCents).toBe(100162);
    expect(converted.lines[0].convertedCents).toBe(67335);
    expect(converted.lines[1].convertedCents).toBe(32827);
  });
});
