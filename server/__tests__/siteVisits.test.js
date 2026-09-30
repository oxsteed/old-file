'use strict';

// Visitor history (in-house analytics): the beacon must never break the page,
// raw IPs must never reach the database, and DNT visitors must be skipped.

const fs = require('fs');
const path = require('path');
const { mockQuery, resetMocks } = require('./setup');
const siteVisitService = require('../services/siteVisitService');
const siteVisitController = require('../controllers/siteVisitController');

function reqDouble(overrides = {}) {
  return {
    body: {},
    query: {},
    headers: {},
    ip: '203.0.113.7',
    user: undefined,
    ...overrides,
  };
}

function resDouble() {
  const res = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { return this; },
  };
  return res;
}

beforeEach(() => {
  resetMocks();
});

describe('siteVisitService helpers', () => {
  test('hashIp is stable and never contains the raw IP', () => {
    const a = siteVisitService.hashIp('203.0.113.7');
    const b = siteVisitService.hashIp('203.0.113.7');
    expect(a).toBe(b);
    expect(a).not.toContain('203.0.113.7');
    expect(siteVisitService.hashIp('203.0.113.8')).not.toBe(a);
  });

  test('locationFromHeaders reads Cloudflare geo headers', () => {
    const loc = siteVisitService.locationFromHeaders({
      headers: { 'cf-ipcountry': 'HT', 'cf-ipcity': 'Port-au-Prince', 'cf-region': 'Ouest' },
    });
    expect(loc).toEqual({ countryCode: 'HT', city: 'Port-au-Prince', regionName: 'Ouest' });
  });

  test('locationFromHeaders ignores unknown and Tor country codes', () => {
    for (const code of ['XX', 'T1', '']) {
      const loc = siteVisitService.locationFromHeaders({ headers: { 'cf-ipcountry': code } });
      expect(loc.countryCode).toBeNull();
    }
  });

  test('deviceFromUserAgent classifies bots, mobile, tablet, desktop', () => {
    expect(siteVisitService.deviceFromUserAgent('Googlebot/2.1').isBot).toBe(true);
    expect(siteVisitService.deviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)').deviceType).toBe('mobile');
    expect(siteVisitService.deviceFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0)').deviceType).toBe('tablet');
    expect(siteVisitService.deviceFromUserAgent('Mozilla/5.0 (Windows NT 10.0)').deviceType).toBe('desktop');
  });

  test('cleanPath strips query strings and rejects non-path input', () => {
    expect(siteVisitService.cleanPath('/direct/tools?category=plumbing')).toBe('/direct/tools');
    expect(siteVisitService.cleanPath('https://evil.example/')).toBe('/');
    expect(siteVisitService.cleanPath(null)).toBe('/');
  });
});

describe('siteVisitService.recordVisit', () => {
  test('inserts a visit with the hashed IP, never the raw IP', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'visit-1' }] });
    const id = await siteVisitService.recordVisit({
      path: '/pricing',
      referrer: 'https://www.google.com/search?q=oxsteed',
      req: reqDouble({ headers: { 'cf-ipcountry': 'US', 'user-agent': 'Mozilla/5.0' } }),
      userId: null,
    });
    expect(id).toBe('visit-1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO site_visits/);
    expect(params).not.toContain('203.0.113.7');
    expect(params[2]).toBe(siteVisitService.hashIp('203.0.113.7'));
    expect(params[3]).toBe('US');
  });

  test('skips visitors with Do Not Track enabled', async () => {
    const id = await siteVisitService.recordVisit({
      path: '/',
      req: reqDouble({ headers: { dnt: '1' } }),
    });
    expect(id).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('never throws when the database is unavailable', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(siteVisitService.recordVisit({ path: '/', req: reqDouble() })).resolves.toBeNull();
  });

  test('pruneOldVisits deletes rows older than the retention window', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 42 });
    const deleted = await siteVisitService.pruneOldVisits(90);
    expect(deleted).toBe(42);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM site_visits/);
    expect(params).toEqual(['90']);
  });
});

describe('siteVisitController.recordPageview', () => {
  test('always answers 204, even when recording fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = resDouble();
    await siteVisitController.recordPageview(
      reqDouble({ body: { path: '/direct/skills', referrer: '' } }),
      res
    );
    expect(res.statusCode).toBe(204);
  });

  test('attributes the visit to the signed-in user when present', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'visit-2' }] });
    const res = resDouble();
    await siteVisitController.recordPageview(
      reqDouble({ body: { path: '/' }, user: { id: 'user-9' } }),
      res
    );
    const [, params] = mockQuery.mock.calls[0];
    expect(params[params.length - 1]).toBe('user-9');
    expect(res.statusCode).toBe(204);
  });
});

describe('siteVisitController.listVisits', () => {
  test('returns paginated visits with filters applied', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'v1', path: '/' }] });
    const res = resDouble();
    await siteVisitController.listVisits(
      reqDouble({ query: { country: 'ht', page: '2', limit: '10' } }),
      res
    );
    expect(res.payload.total).toBe(3);
    expect(res.payload.page).toBe(2);
    expect(res.payload.limit).toBe(10);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/FROM site_visits v/);
    expect(sql).toMatch(/LEFT JOIN users/);
    expect(params).toContain('HT');
  });

  test('excludes bots unless explicitly requested', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = resDouble();
    await siteVisitController.listVisits(reqDouble({ query: {} }), res);
    const [sql] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/v\.is_bot = FALSE/);
  });
});

describe('siteVisitController.getSummary', () => {
  test('returns totals, per-country, top pages, and daily series', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ visits: 100, unique_visitors: 40 }] })
      .mockResolvedValueOnce({ rows: [{ country_code: 'US', visits: 60, unique_visitors: 25 }] })
      .mockResolvedValueOnce({ rows: [{ path: '/', visits: 50 }] })
      .mockResolvedValueOnce({ rows: [{ day: '2026-09-30', visits: 100 }] });
    const res = resDouble();
    await siteVisitController.getSummary(reqDouble({ query: {} }), res);
    expect(res.payload.totals).toEqual({ visits: 100, unique_visitors: 40 });
    expect(res.payload.byCountry).toHaveLength(1);
    expect(res.payload.topPages).toHaveLength(1);
    expect(res.payload.perDay).toHaveLength(1);
  });
});

describe('visitor history wiring', () => {
  test('migration 613 creates the site_visits table', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../migrations/613_site_visits.sql'),
      'utf8'
    );
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS site_visits/);
    expect(sql).not.toMatch(/ip_address|client_ip/);
  });

  test('analytics routes are mounted and the grant is registered', () => {
    const indexSource = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
    expect(indexSource).toMatch(/app\.use\('\/api\/analytics', siteVisitRoutes\)/);
    const permSource = fs.readFileSync(
      path.resolve(__dirname, '../controllers/adminPermissionController.js'),
      'utf8'
    );
    expect(permSource).toMatch(/view_visitor_analytics/);
    const routeSource = fs.readFileSync(path.resolve(__dirname, '../routes/siteVisits.js'), 'utf8');
    expect(routeSource).toMatch(/requirePermission\('view_visitor_analytics'\)/);
  });
});
