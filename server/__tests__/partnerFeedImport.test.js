'use strict';

// Background-jobs audit (finding G2): partner feed price-sanity guard.
// isSanePriceChange quarantines zero/negative feed prices and moves beyond
// PARTNER_FEED_PRICE_RATIO (default 5x) in either direction.
const { isSanePriceChange, buildUpsertBatch, UPSERT_PARAMS_PER_ROW } = require('../jobs/partnerFeedImport');

function fakeItem(n) {
  return {
    feedItemId: `item-${n}`,
    name: `Item ${n}`,
    description: `Description ${n}`,
    categoryPath: 'Food > Snacks',
    priceCents: 100 * n,
    currency: 'USD',
    affiliateUrl: `https://example.com/${n}`,
    available: true,
    countryCodes: ['US'],
    brand: 'Brand',
    gtin: `000${n}`,
    taxonomyNodeId: null,
    productImageUrl: null,
  };
}

describe('partner feed price sanity', () => {
  const OLD_ENV = process.env.PARTNER_FEED_PRICE_RATIO;
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.PARTNER_FEED_PRICE_RATIO;
    else process.env.PARTNER_FEED_PRICE_RATIO = OLD_ENV;
  });

  test('accepts modest moves in either direction', () => {
    expect(isSanePriceChange(1000, 1000)).toBe(true);
    expect(isSanePriceChange(1000, 4999)).toBe(true);
    expect(isSanePriceChange(1000, 201)).toBe(true);
  });

  test('quarantines zero or negative feed prices', () => {
    expect(isSanePriceChange(1000, 0)).toBe(false);
    expect(isSanePriceChange(1000, -5)).toBe(false);
  });

  test('quarantines moves beyond 5x in either direction', () => {
    expect(isSanePriceChange(1000, 5001)).toBe(false); // >5x up
    expect(isSanePriceChange(1000, 199)).toBe(false); // >5x down
    expect(isSanePriceChange(1000, 5000)).toBe(true); // exactly 5x up ok
    expect(isSanePriceChange(1000, 200)).toBe(true); // exactly 5x down ok
  });

  test('a new item with no previous price is always sane when positive', () => {
    expect(isSanePriceChange(0, 1000)).toBe(true);
    expect(isSanePriceChange(null, 1000)).toBe(true);
    expect(isSanePriceChange(undefined, 1000)).toBe(true);
    expect(isSanePriceChange(0, 0)).toBe(false);
  });

  test('the ratio is env-tunable', () => {
    process.env.PARTNER_FEED_PRICE_RATIO = '2';
    expect(isSanePriceChange(1000, 2001)).toBe(false);
    expect(isSanePriceChange(1000, 2000)).toBe(true);
  });
});

describe('batched upsert placeholder numbering', () => {
  test('placeholders are contiguous across rows and match the param count', () => {
    const batch = [fakeItem(1), fakeItem(2), fakeItem(3)];
    const { valuesClause, params } = buildUpsertBatch({ source: 'partner', partnerId: 42, batch });
    expect(params).toHaveLength(3 * UPSERT_PARAMS_PER_ROW);
    const placeholders = [...valuesClause.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...placeholders)).toBe(params.length);
    expect(new Set(placeholders).size).toBe(params.length);
    expect(placeholders).toEqual([...Array(params.length)].map((_, i) => i + 1));
  });

  test('each row carries its own values in column order', () => {
    const batch = [fakeItem(1), fakeItem(2)];
    const { params } = buildUpsertBatch({ source: 'partner', partnerId: 42, batch });
    // Row 1: source, external_id, name, ..., price_cents(6th)
    expect(params[0]).toBe('partner');
    expect(params[1]).toBe('item-1');
    expect(params[5]).toBe(100);
    // Row 2 starts at offset UPSERT_PARAMS_PER_ROW.
    expect(params[UPSERT_PARAMS_PER_ROW + 1]).toBe('item-2');
    expect(params[UPSERT_PARAMS_PER_ROW + 5]).toBe(200);
    expect(params[UPSERT_PARAMS_PER_ROW + 9]).toBe(42); // partner_id
  });
});
