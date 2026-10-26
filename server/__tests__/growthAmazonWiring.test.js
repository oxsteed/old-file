'use strict';
// D21: Amazon Associates wiring (links, freshness, reports, refresh).
const wiring = require('../growth/partners/amazonWiring');
const amazon = require('../growth/partners/amazonProducts');

describe('Amazon links carry only the campaign tag', () => {
  const domains = ['www.amazon.com'];
  test('sets tag and strips click ids / foreign tags', () => {
    const url = wiring.amazonDestination('https://www.amazon.com/dp/B000000001?tag=other-20&subid=abc&ascsubtag=u1&th=1', domains, 'oxs-camp1-20');
    const u = new URL(url);
    expect(u.searchParams.get('tag')).toBe('oxs-camp1-20');
    expect(u.searchParams.has('subid')).toBe(false);
    expect(u.searchParams.has('ascsubtag')).toBe(false);
    expect(u.searchParams.get('th')).toBe('1');
  });
  test('refuses hosts outside the allowlist, http and a missing tag', () => {
    expect(() => wiring.amazonDestination('https://evil.example/dp/x', domains, 't-20')).toThrow('partner_destination_denied');
    expect(() => wiring.amazonDestination('http://www.amazon.com/dp/x', domains, 't-20')).toThrow('partner_destination_denied');
    expect(() => wiring.amazonDestination('https://www.amazon.com/dp/x', domains, null)).toThrow('amazon_tracking_tag_required');
  });
  test('campaign tag wins, then the configured associate tag', () => {
    expect(wiring.trackingTagFor('camp-20', { GROWTH_AMAZON_ASSOCIATE_TAG: 'base-20' })).toBe('camp-20');
    expect(wiring.trackingTagFor(null, { GROWTH_AMAZON_ASSOCIATE_TAG: 'base-20' })).toBe('base-20');
    expect(wiring.trackingTagFor(null, {})).toBeNull();
  });
});

describe('24h freshness', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  test('fresh only when available and refreshed within 24h', () => {
    expect(wiring.itemFresh({ available: true, last_refreshed_at: '2026-10-26T00:00:00Z' }, now)).toBe(true);
    expect(wiring.itemFresh({ available: true, last_refreshed_at: '2026-10-25T11:59:00Z' }, now)).toBe(false);
    expect(wiring.itemFresh({ available: false, last_refreshed_at: '2026-10-26T11:00:00Z' }, now)).toBe(false);
    expect(wiring.itemFresh(undefined, now)).toBe(false);
  });
});

describe('report summary', () => {
  test('aggregates tab-separated rows per tracking tag in minor units', () => {
    const csv = [
      'Tracking ID\tClicks\tItems Ordered\tItems Shipped\tRevenue($)\tEarnings($)',
      'camp-a-20\t10\t2\t1\t$45.50\t$1.82',
      'camp-a-20\t5\t1\t1\t10.00\t0.40',
      'camp-b-20\t3\t0\t0\t0\t0',
      'bad tag!\t1\t1\t1\t1\t1',
    ].join('\n');
    const rows = wiring.summarizeReport(csv);
    expect(rows).toEqual([
      { tracking_tag: 'camp-a-20', clicks: 15, ordered_items: 3, shipped_items: 2, revenue_minor: 5550, earnings_minor: 222 },
      { tracking_tag: 'camp-b-20', clicks: 3, ordered_items: 0, shipped_items: 0, revenue_minor: 0, earnings_minor: 0 },
    ]);
  });
});

describe('GetItems and refresh', () => {
  const cfg = { host: 'webservices.amazon.com', region: 'us-east-1', associateTag: 'base-20', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'synthetic' };
  test('getItems signs a GetItems call and reports missing ASINs', async () => {
    const fetchImpl = jest.fn(async (url, init) => {
      expect(url).toBe('https://webservices.amazon.com/paapi5/getitems');
      expect(JSON.parse(init.body).ItemIds).toEqual(['B000000001', 'B000000002']);
      return { ok: true, json: async () => ({ ItemsResult: { Items: [{ ASIN: 'B000000001', DetailPageURL: 'https://www.amazon.com/dp/B000000001', ItemInfo: { Title: { DisplayValue: 'Drain snake' } }, Offers: { Listings: [{ Price: { Amount: 19.99, Currency: 'USD' } }] } }] } }) };
    });
    const out = await amazon.getItems(['B000000001', 'B000000002'], { config: cfg, fetchImpl });
    expect(out.items[0]).toMatchObject({ asin: 'B000000001', price: 19.99, available: true });
    expect(out.missing).toEqual(['B000000002']);
  });

  test('refreshDue updates returned items and marks missing ones unavailable', async () => {
    const queries = [];
    const conn = { query: jest.fn(async (sql, params) => {
      queries.push([sql, params]);
      if (/FROM amazon_offer_items i JOIN offers/.test(sql)) return { rows: [{ offer_id: 1, asin: 'B000000001' }, { offer_id: 2, asin: 'B000000002' }] };
      return { rows: [], rowCount: 1 };
    }) };
    const getItems = jest.fn(async () => ({ enabled: true, items: [{ asin: 'B000000001', title: 'X', price: 5, currency: 'USD', available: true }], missing: ['B000000002'] }));
    const out = await wiring.refreshDue(conn, { deps: { getItems } });
    expect(out).toEqual({ checked: 2, refreshed: 1, unavailable: 1, failed: 0 });
    const unavailable = queries.find(([sql]) => /available=FALSE/.test(sql));
    expect(unavailable[1]).toEqual([2, 'not_returned']);
  });

  test('a failed API call leaves rows untouched (they go stale and stop showing)', async () => {
    const conn = { query: jest.fn(async (sql) => (/JOIN offers/.test(sql) ? { rows: [{ offer_id: 1, asin: 'B000000001' }] } : { rows: [] })) };
    const out = await wiring.refreshDue(conn, { deps: { getItems: async () => { throw new Error('amazon_paapi_http_429'); } } });
    expect(out.failed).toBe(1);
    expect(conn.query).toHaveBeenCalledTimes(1);
  });
});

const targetDb = process.env.STATEMENT_TEST_DATABASE_URL || '';
(/credit_statement_test/.test(targetDb) ? describe : describe.skip)('Amazon report import (migration 99992)', () => {
  let pool; let client;
  beforeAll(() => {
    jest.unmock('pg'); jest.unmock('../db'); jest.resetModules();
    process.env.DATABASE_URL = targetDb; process.env.LOG_LEVEL = 'error';
    pool = require('../db');
  });
  beforeEach(async () => { client = await pool.connect(); await client.query('BEGIN'); });
  afterEach(async () => { await client.query('ROLLBACK'); client.release(); });

  test('imports once, maps tags to a single campaign, refuses duplicates', async () => {
    const w = require('../growth/partners/amazonWiring');
    const csv = 'Tracking ID\tClicks\tItems Ordered\tItems Shipped\tRevenue($)\tEarnings($)\nunmapped-tag-20\t4\t1\t1\t12.00\t0.48';
    const first = await w.importReport(client, { reportRef: 'rpt-2026-10-a', csv, periodStart: '2026-10-01', periodEnd: '2026-10-25' });
    expect(first).toMatchObject({ duplicate: false, tags: 1, mapped: 0, unmapped: 1 });
    const { rows } = await client.query('SELECT tracking_tag, clicks, earnings_minor, campaign_id FROM amazon_campaign_results WHERE report_id=$1', [first.report_id]);
    expect(rows).toEqual([{ tracking_tag: 'unmapped-tag-20', clicks: 4, earnings_minor: '48', campaign_id: null }]);
    const again = await w.importReport(client, { reportRef: 'rpt-2026-10-b', csv });
    expect(again.duplicate).toBe(true);
  });

  test('amazon_offer_items rejects malformed ASINs', async () => {
    await expect(client.query("INSERT INTO amazon_offer_items (offer_id, asin, marketplace_host) VALUES (1, 'bad', 'www.amazon.com')"))
      .rejects.toThrow();
  });
});
