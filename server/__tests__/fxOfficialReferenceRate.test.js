'use strict';

/**
 * HTG is not published by the ECB. Quotes for HTG use the Banque de la
 * République d'Haïti reference rate stored in credit_fx_reference_rates,
 * cross through USD, and fail closed when no fresh rate exists.
 */

const fs = require('fs');
const path = require('path');
const { mockQuery, resetMocks } = require('./setup');
const { getFxQuote, decimalToFraction, OFFICIAL_SOURCES } = require('../services/fxRateProvider');
const { parseBrhReferencePage } = require('../services/fx/brhReferenceRate');
const manual = require('../services/fx/manualReferenceRate');

const realFetch = global.fetch;
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'brh-taux-du-jour.html'), 'utf8');

beforeEach(() => {
  resetMocks();
  global.fetch = jest.fn();
});
afterAll(() => { global.fetch = realFetch; });

function routeRates(rows) {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM credit_fx_reference_rates/.test(sql)) return { rows };
    return { rows: [] };
  });
}

describe('BRH reference page parser', () => {
  test('reads the reference rate and its date from the published page', () => {
    expect(parseBrhReferencePage(FIXTURE)).toEqual({ unitsPerUsd: '130.6474', rateDate: '2026-10-27' });
  });

  test('refuses a page without a reference rate', () => {
    expect(() => parseBrhReferencePage('<html><body>maintenance</body></html>')).toThrow();
  });

  test('refuses an implausible rate', () => {
    const broken = FIXTURE.replace('130.6474', '3.1');
    expect(() => parseBrhReferencePage(broken)).toThrow();
  });
});

describe('official cross quotes', () => {
  test('HTG is routed to BRH', () => {
    expect(OFFICIAL_SOURCES.HTG).toBe('brh');
  });

  test('decimalToFraction is exact', () => {
    expect(decimalToFraction('130.6474')).toEqual({ n: 1306474n, d: 10000n });
    expect(decimalToFraction('abc')).toBeNull();
  });

  test('USD -> HTG uses the stored BRH rate exactly', async () => {
    routeRates([{ units_per_base: '130.6474', rate_date: '2026-10-27', source: 'brh' }]);
    const quote = await getFxQuote('USD', 'HTG');
    expect(Number(quote.rateNumerator) / Number(quote.rateDenominator)).toBeCloseTo(130.6474, 6);
    expect(quote.provider).toBe('brh:HTG');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('HTG -> USD is the inverse', async () => {
    routeRates([{ units_per_base: '130.6474', rate_date: '2026-10-27', source: 'brh' }]);
    const quote = await getFxQuote('HTG', 'USD');
    expect(Number(quote.rateNumerator) / Number(quote.rateDenominator)).toBeCloseTo(1 / 130.6474, 6);
  });

  test('EUR -> HTG crosses ECB EUR/USD with BRH USD/HTG', async () => {
    routeRates([{ units_per_base: '130', rate_date: '2026-10-27', source: 'brh' }]);
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ rates: { USD: 1.1 } }) });
    const quote = await getFxQuote('EUR', 'HTG');
    expect(Number(quote.rateNumerator) / Number(quote.rateDenominator)).toBeCloseTo(143, 4);
    expect(quote.provider).toContain('brh:HTG');
  });

  test('fails closed when no fresh rate exists and BRH is unreachable', async () => {
    routeRates([]);
    global.fetch.mockRejectedValue(new Error('network down'));
    await expect(getFxQuote('USD', 'HTG')).rejects.toMatchObject({ statusCode: 502, code: 'fx_rate_unavailable' });
  });

  test('the freshness window is applied in SQL', async () => {
    routeRates([{ units_per_base: '130.6474', rate_date: '2026-10-27', source: 'brh' }]);
    process.env.FX_REFERENCE_MAX_AGE_DAYS = '2';
    try {
      await getFxQuote('USD', 'HTG');
      const call = mockQuery.mock.calls.find(([sql]) => /credit_fx_reference_rates/.test(sql));
      expect(call[0]).toMatch(/rate_date >= \(CURRENT_DATE - \$2::int\)/);
      expect(call[1]).toEqual(['HTG', 2]);
    } finally {
      delete process.env.FX_REFERENCE_MAX_AGE_DAYS;
    }
  });
});

describe('manual reference rate entry (two administrators)', () => {
  test('is registered as an oversight action', () => {
    const register = jest.fn();
    manual.registerOversightActions(register);
    expect(register).toHaveBeenCalledWith('credit_fx_reference_rate_entry', manual.applyManualReferenceRate);
  });

  test('validates the payload', () => {
    expect(() => manual.validate({ quoteCurrency: 'HTG', unitsPerUsd: '-1', rateDate: '2026-10-27', note: 'BRH site' })).toThrow();
    expect(() => manual.validate({ quoteCurrency: 'HTG', unitsPerUsd: '130.5', rateDate: '2026-10-27', note: '' })).toThrow();
    expect(manual.validate({ quoteCurrency: 'htg', unitsPerUsd: '130.5', rateDate: '2026-10-27', note: 'BRH bulletin' }))
      .toEqual({ quoteCurrency: 'HTG', units: '130.5', rateDate: '2026-10-27', note: 'BRH bulletin' });
  });

  test('records maker and checker separately', async () => {
    const client = { query: jest.fn(async () => ({ rows: [{ id: 7 }] })) };
    await manual.applyManualReferenceRate({
      client, requestedBy: 'maker', actorUserId: 'checker',
      payload: { quoteCurrency: 'HTG', unitsPerUsd: '130.5', rateDate: '2026-10-27', note: 'BRH bulletin' },
    });
    const insert = client.query.mock.calls[0];
    expect(insert[0]).toMatch(/INSERT INTO credit_fx_reference_rates/);
    expect(insert[1].slice(3, 5)).toEqual(['maker', 'checker']);
  });
});
