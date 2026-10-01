'use strict';

/**
 * Tests for the live FX rate provider (Frankfurter) and the live-rate
 * currency quote path. global.fetch is mocked in every test; no real
 * network call is ever made.
 */

const { mockQuery, resetMocks } = require('./setup');
const { getFxQuote } = require('../services/fxRateProvider');
const {
  createLiveRateCurrencyQuote,
  convertCustomerCredit,
} = require('../services/oxsteedCreditCurrencyConversionService');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';

const realFetch = global.fetch;

beforeEach(() => {
  resetMocks();
  global.fetch = jest.fn();
  delete process.env.FX_RATE_TIMEOUT_MS;
});

afterAll(() => {
  global.fetch = realFetch;
});

function mockFrankfurterRate(rate, base = 'USD') {
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ base, date: '2026-10-01', rates: { EUR: rate } }),
  });
}

describe('getFxQuote', () => {
  test('returns the interface shape on success', async () => {
    mockFrankfurterRate(0.85);
    const quote = await getFxQuote('USD', 'EUR');
    expect(quote).toEqual({
      rateNumerator: '85000000',
      rateDenominator: '100000000',
      quotedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      provider: 'frankfurter',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.frankfurter.app/latest?from=USD&to=EUR');
  });

  test('HTTP 500 fails closed with fx_rate_unavailable', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(getFxQuote('USD', 'EUR'))
      .rejects.toMatchObject({ code: 'fx_rate_unavailable', status: 502 });
  });

  test('unknown currency (404) fails closed with fx_rate_unavailable', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ message: 'not found' }) });
    await expect(getFxQuote('USD', 'XXX'))
      .rejects.toMatchObject({ code: 'fx_rate_unavailable', status: 502 });
  });

  test('network error fails closed with fx_rate_unavailable', async () => {
    global.fetch.mockRejectedValue(new Error('socket hang up'));
    await expect(getFxQuote('USD', 'EUR'))
      .rejects.toMatchObject({ code: 'fx_rate_unavailable', status: 502 });
  });

  test('abort fails closed with fx_rate_unavailable', async () => {
    global.fetch.mockRejectedValue(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
    await expect(getFxQuote('USD', 'EUR'))
      .rejects.toMatchObject({ code: 'fx_rate_unavailable', status: 502 });
  });

  test('aborts the request when FX_RATE_TIMEOUT_MS elapses', async () => {
    process.env.FX_RATE_TIMEOUT_MS = '40';
    let seenSignal = null;
    global.fetch.mockImplementation((url, options = {}) => {
      seenSignal = options.signal;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
        });
      });
    });
    try {
      await expect(getFxQuote('USD', 'EUR'))
        .rejects.toMatchObject({ code: 'fx_rate_unavailable', status: 502 });
      expect(seenSignal).toBeInstanceOf(AbortSignal);
    } finally {
      delete process.env.FX_RATE_TIMEOUT_MS;
    }
  });

  test('same currency is rejected without a network call', async () => {
    await expect(getFxQuote('USD', 'USD'))
      .rejects.toMatchObject({ code: 'fx_invalid_currency', status: 400 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('malformed currency codes are rejected without a network call', async () => {
    await expect(getFxQuote('usd', 'EUR')).rejects.toMatchObject({ code: 'fx_invalid_currency', status: 400 });
    await expect(getFxQuote('US', 'EUR')).rejects.toMatchObject({ code: 'fx_invalid_currency', status: 400 });
    await expect(getFxQuote('USDD', 'EUR')).rejects.toMatchObject({ code: 'fx_invalid_currency', status: 400 });
    await expect(getFxQuote('USD', null)).rejects.toMatchObject({ code: 'fx_invalid_currency', status: 400 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('malformed payload fails closed with fx_rate_unavailable', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ rates: {} }) });
    await expect(getFxQuote('USD', 'EUR'))
      .rejects.toMatchObject({ code: 'fx_rate_unavailable', status: 502 });

    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ rates: { EUR: 'nope' } }) });
    await expect(getFxQuote('USD', 'EUR'))
      .rejects.toMatchObject({ code: 'fx_rate_unavailable', status: 502 });

    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new Error('unexpected token'); },
    });
    await expect(getFxQuote('USD', 'EUR'))
      .rejects.toMatchObject({ code: 'fx_rate_unavailable', status: 502 });
  });
});

describe('createLiveRateCurrencyQuote', () => {
  function mockQuoteInsert() {
    mockQuery.mockImplementation(async (text, params = []) => {
      const sql = String(text);
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) return { rows: [{ is_enabled: true }] };
      if (sql.includes('FROM oxsteed_credit_currency_quotes WHERE idempotency_key')) return { rows: [] };
      if (sql.includes('INSERT INTO oxsteed_credit_currency_quotes')) {
        return {
          rows: [{
            id: 21,
            customer_id: params[0],
            source_currency_code: params[1],
            target_currency_code: params[2],
            source_amount_minor_units: params[3],
            target_amount_minor_units: params[4],
            fee_amount_minor_units: params[5],
            rate_numerator: params[6],
            rate_denominator: params[7],
            rounding_mode: params[8],
            provider: params[9],
            provider_quote_reference: params[10],
            status: 'open',
            expires_at: params[11] instanceof Date ? params[11].toISOString() : params[11],
            consumed_at: null,
            reason: params[13],
            metadata: JSON.parse(params[14]),
            created_at: new Date().toISOString(),
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  test('creates a frankfurter quote with exact half-up target math', async () => {
    mockFrankfurterRate(0.9);
    mockQuoteInsert();

    const result = await createLiveRateCurrencyQuote({
      sourceCurrency: 'USD',
      targetCurrency: 'EUR',
      sourceAmountCents: 100,
      customerId: CUSTOMER_ID,
      reason: 'Live FX quote test',
      actor: ADMIN_ID,
      idempotencyKey: 'live-quote-1',
    });

    expect(result.replayed).toBe(false);
    expect(result.quote.provider).toBe('frankfurter');
    expect(result.quote.rateNumerator).toBe('90000000');
    expect(result.quote.rateDenominator).toBe('100000000');
    expect(result.quote.targetAmountMinorUnits).toBe(90);
    expect(result.quote.providerQuoteReference)
      .toMatch(/^frankfurter:USD:EUR:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(result.quote.metadata.fxProvider).toBe('frankfurter');
    expect(result.quote.metadata.fxQuotedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The stored provider reference embeds the same quotedAt the metadata carries.
    expect(result.quote.providerQuoteReference).toContain(result.quote.metadata.fxQuotedAt);
  });

  test('provider failure propagates and no quote row is created', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));
    await expect(createLiveRateCurrencyQuote({
      sourceCurrency: 'USD',
      targetCurrency: 'EUR',
      sourceAmountCents: 100,
      customerId: CUSTOMER_ID,
      reason: 'Live FX quote test',
      actor: ADMIN_ID,
      idempotencyKey: 'live-quote-fail',
    })).rejects.toMatchObject({ code: 'fx_rate_unavailable', status: 502 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('an expired live-rate quote cannot be executed (fail closed, flips to expired)', async () => {
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('FROM oxsteed_credit_currency_conversions WHERE idempotency_key')) return { rows: [] };
      if (sql.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) return { rows: [{ is_enabled: true }] };
      if (sql.includes('FROM oxsteed_credit_currency_quotes WHERE id = $1')) {
        return {
          rows: [{
            id: 22,
            customer_id: CUSTOMER_ID,
            status: 'open',
            source_currency_code: 'USD',
            source_amount_minor_units: 100,
            target_currency_code: 'EUR',
            target_amount_minor_units: 90,
            fee_amount_minor_units: 0,
            expires_at: new Date(Date.now() - 60000).toISOString(),
          }],
        };
      }
      if (sql.includes("UPDATE oxsteed_credit_currency_quotes SET status = 'expired'")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    await expect(convertCustomerCredit({
      customerId: CUSTOMER_ID,
      quoteId: 22,
      sourceAmountMinorUnits: 100,
      idempotencyKey: 'live-conversion-expired',
      actorUserId: CUSTOMER_ID,
    })).rejects.toMatchObject({ code: 'credit_conversion_quote_expired', status: 409 });

    const expiredFlip = mockQuery.mock.calls.some(([sql]) => String(sql).includes("SET status = 'expired'"));
    expect(expiredFlip).toBe(true);
  });
});
