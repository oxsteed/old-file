'use strict';

// Design-review fix run, item 64 staleness-only (goal goal_a0fc7c0f0394).
//
// getRate / convertAmount report how old the stored rate they used
// is, and flag it stale when it is older than
// FX_RATE_STALE_AFTER_DAYS. The threshold is a display-warning
// threshold only: the rate picked never changes.
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

describe('FX rate staleness (item 64)', () => {
  test('the staleness threshold is 30 days', () => {
    expect(fx.FX_RATE_STALE_AFTER_DAYS).toBe(30);
  });

  test('a fresh rate reports its age and is not stale', async () => {
    const client = stubClient({
      'HTG|USD': { base_currency: 'HTG', quote_currency: 'USD', rate: 0.0075, rate_date: '2026-10-01', source: 'stored' },
    });
    const rate = await fx.getRate(client, { baseCurrency: 'HTG', quoteCurrency: 'USD', rateDate: '2026-10-15' });
    expect(rate.rateAgeDays).toBe(14);
    expect(rate.rateStale).toBe(false);
    const converted = await fx.convertAmount(client, {
      amountCents: 10000, fromCurrency: 'HTG', toCurrency: 'USD', rateDate: '2026-10-15',
    });
    expect(converted.rateAgeDays).toBe(14);
    expect(converted.rateStale).toBe(false);
    expect(converted.rateDate).toBe('2026-10-01');
  });

  test('a rate older than the threshold is flagged stale but still used', async () => {
    const client = stubClient({
      'HTG|USD': { base_currency: 'HTG', quote_currency: 'USD', rate: 0.0075, rate_date: '2026-08-01', source: 'stored' },
    });
    const rate = await fx.getRate(client, { baseCurrency: 'HTG', quoteCurrency: 'USD', rateDate: '2026-10-15' });
    expect(rate.rateAgeDays).toBe(75);
    expect(rate.rateStale).toBe(true);
    // Staleness never changes which rate is used.
    expect(rate.rate).toBe(0.0075);
    const converted = await fx.convertAmount(client, {
      amountCents: 10000, fromCurrency: 'HTG', toCurrency: 'USD', rateDate: '2026-10-15',
    });
    expect(converted.convertedCents).toBe(75);
    expect(converted.rateStale).toBe(true);
  });

  test('exactly 30 days is not stale; 31 days is', async () => {
    const at30 = stubClient({
      'HTG|USD': { base_currency: 'HTG', quote_currency: 'USD', rate: 0.0075, rate_date: '2026-09-15', source: 'stored' },
    });
    expect((await fx.getRate(at30, { baseCurrency: 'HTG', quoteCurrency: 'USD', rateDate: '2026-10-15' })).rateStale).toBe(false);
    const at31 = stubClient({
      'HTG|USD': { base_currency: 'HTG', quote_currency: 'USD', rate: 0.0075, rate_date: '2026-09-14', source: 'stored' },
    });
    const rate = await fx.getRate(at31, { baseCurrency: 'HTG', quoteCurrency: 'USD', rateDate: '2026-10-15' });
    expect(rate.rateAgeDays).toBe(31);
    expect(rate.rateStale).toBe(true);
  });

  test('same-currency conversion reports age 0 and is never stale', async () => {
    const client = stubClient({});
    const converted = await fx.convertAmount(client, {
      amountCents: 10000, fromCurrency: 'USD', toCurrency: 'USD', rateDate: '2026-10-15',
    });
    expect(converted.rateAgeDays).toBe(0);
    expect(converted.rateStale).toBe(false);
  });

  test('a missing rate reports no age and is not flagged stale', async () => {
    const client = stubClient({});
    const converted = await fx.convertAmount(client, {
      amountCents: 10000, fromCurrency: 'EUR', toCurrency: 'USD', rateDate: '2026-10-15',
    });
    expect(converted.missingRate).toBe(true);
    expect(converted.rateAgeDays).toBeNull();
    expect(converted.rateStale).toBe(false);
  });

  test('convertBreakdown summarizes staleness per line and per response', async () => {
    const client = stubClient({
      'HTG|USD': { base_currency: 'HTG', quote_currency: 'USD', rate: 0.0075, rate_date: '2026-08-01', source: 'stored' },
      'JPY|USD': { base_currency: 'JPY', quote_currency: 'USD', rate: 0.0067, rate_date: '2026-10-01', source: 'stored' },
    });
    const converted = await fx.convertBreakdown(client, {
      entries: [
        { currencyCode: 'HTG', amountCents: 10000 },
        { currencyCode: 'JPY', amountCents: 100500 },
      ],
      reportingCurrency: 'USD',
      rateDate: '2026-10-15',
    });
    expect(converted.stale).toBe(true);
    expect(converted.staleCurrencies).toEqual(['HTG']);
    expect(converted.maxRateAgeDays).toBe(75);
    expect(converted.stalestRateDate).toBe('2026-08-01');
    const htg = converted.lines.find((line) => line.currencyCode === 'HTG');
    expect(htg.rateAgeDays).toBe(75);
    expect(htg.rateStale).toBe(true);
    const jpy = converted.lines.find((line) => line.currencyCode === 'JPY');
    expect(jpy.rateAgeDays).toBe(14);
    expect(jpy.rateStale).toBe(false);
  });

  test('an all-fresh breakdown is not stale', async () => {
    const client = stubClient({
      'JPY|USD': { base_currency: 'JPY', quote_currency: 'USD', rate: 0.0067, rate_date: '2026-10-01', source: 'stored' },
    });
    const converted = await fx.convertBreakdown(client, {
      entries: [{ currencyCode: 'JPY', amountCents: 100500 }],
      reportingCurrency: 'USD',
      rateDate: '2026-10-15',
    });
    expect(converted.stale).toBe(false);
    expect(converted.staleCurrencies).toEqual([]);
    expect(converted.maxRateAgeDays).toBe(14);
    expect(converted.stalestRateDate).toBe('2026-10-01');
  });
});
