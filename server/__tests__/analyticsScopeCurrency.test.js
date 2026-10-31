'use strict';

/**
 * Analytics scope, labels, and currency (founder-approved batch, item 3).
 *
 * (a) Disputes scope, Option A: the governed open_disputes metric is scoped
 *     by manage_disputes grants, so the admin dashboard card and the admin
 *     disputes list must agree with it. A regional admin counts/sees only
 *     disputes whose job sits in their regions.
 * (c) Franchise territory revenue takes a validated ?currency= (default USD).
 * (d) getFinancials rows are filtered by the same ?currency= as the totals.
 *
 * Stub-db tests: they pin the SQL wiring (scoped predicates, currency
 * binding, 403/400 fail-closed behavior). The real-database behavior of
 * regionScopedDb over openDisputes is covered by
 * analyticsRegionScope.db.test.js.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../analytics/metricAccess', () => ({ metricScope: jest.fn() }));

const db = require('../db');
const { metricScope } = require('../analytics/metricAccess');
const { regionScopedDb } = require('../analytics/regionScope');
const registry = require('../analytics/metricsRegistry');

const REGIONAL = Object.freeze({
  global: false,
  regions: [{ type: 'zip_range', ranges: [{ start: 43000, end: 43999 }] }],
  regionIds: [7],
  permission: 'manage_disputes',
  geo_source: 'direct_geocode_cache',
});
const GLOBAL = Object.freeze({ global: true, regions: null, regionIds: null });

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
});

describe('(a) dashboard open_disputes scoping via regionScopedDb', () => {
  test('regional scope shadows disputes with the job-location predicate', async () => {
    db.query.mockResolvedValue({ rows: [{ value: 2 }] });
    const scoped = regionScopedDb(db, REGIONAL);
    const count = await registry.openDisputes(scoped);
    expect(count).toBe(2);
    const [text, params] = db.query.mock.calls[0];
    expect(text).toMatch('__rs_disputes');
    expect(text).toMatch('__rs_jobs');
    expect(text).toMatch("status = 'open'");
    expect(params).toEqual([JSON.stringify(REGIONAL.regions)]);
  });

  test('global scope passes the query through unchanged', async () => {
    db.query.mockResolvedValue({ rows: [{ value: 5 }] });
    const count = await registry.openDisputes(regionScopedDb(db, GLOBAL));
    expect(count).toBe(5);
    const [text, params] = db.query.mock.calls[0];
    expect(text).toBe("SELECT COUNT(*)::INT AS value FROM disputes WHERE status = 'open'");
    expect(params).toBeUndefined();
  });
});

describe('(b) renamed labels resolve in all five locales', () => {
  const fs = require('fs');
  const path = require('path');
  const OLD = {
    en: ['Gross Revenue', 'Revenue (30d)'],
    es: ['Ingresos brutos', 'Ingresos (30d)'],
    fr: ['Revenu brut', 'Chiffre d’affaires (30j)'],
    ht: ['Revni brit', 'Revni (30d)'],
    ar: ['إجمالي الإيرادات', 'الإيرادات (30 يومًا)'],
  };
  test.each(['en', 'es', 'fr', 'ht', 'ar'])('%s labels exist, are non-empty, and no longer imply platform take', (lang) => {
    const catalog = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'client', 'src', 'locales', `${lang}.json`), 'utf8'));
    const gross = catalog.superFinancials?.grossRevenue;
    const territory = catalog.franchiseTerritoryPage?.kpis?.revenue;
    expect(typeof gross).toBe('string');
    expect(gross.length).toBeGreaterThan(0);
    expect(typeof territory).toBe('string');
    expect(territory.length).toBeGreaterThan(0);
    expect([gross, territory]).not.toEqual(OLD[lang]);
  });
});

describe('(a) admin disputes list scoping', () => {
  const adminCtrl = require('../controllers/disputeAdminController');

  function mockListQueries() {
    db.query.mockImplementation(async (text) => {
      if (String(text).includes('COUNT(*)')) return { rows: [{ count: '1' }] };
      return { rows: [{ id: 1 }] };
    });
  }

  test('regional admin list carries the job-location predicate on rows and count', async () => {
    metricScope.mockResolvedValue(REGIONAL);
    mockListQueries();
    const req = { user: { id: 9, role: 'admin' }, query: {} };
    const res = mockRes();
    await adminCtrl.getAllDisputes(req, res);
    expect(res.json).toHaveBeenCalled();
    const calls = db.query.mock.calls;
    expect(calls.length).toBe(2);
    for (const [text, params] of calls) {
      expect(text).toMatch('__rj');
      expect(text).toMatch('jobs __rj WHERE __rj.id = d.job_id');
      expect(params[params.length - 1]).toBe(JSON.stringify(REGIONAL.regions));
    }
    // Rows query keeps its party-free numbering: regions is the 4th param.
    expect(calls[0][1]).toHaveLength(4);
    // Count query: statuses + regions.
    expect(calls[1][1]).toHaveLength(2);
  });

  test('global admin list is unchanged (no region predicate, no extra param)', async () => {
    metricScope.mockResolvedValue(GLOBAL);
    mockListQueries();
    const req = { user: { id: 1, role: 'super_admin' }, query: {} };
    const res = mockRes();
    await adminCtrl.getAllDisputes(req, res);
    const calls = db.query.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][0]).not.toMatch('__rj');
    expect(calls[0][1]).toHaveLength(3);
    expect(calls[1][1]).toHaveLength(1);
  });

  test('unknown territory fails closed 403, no queries run', async () => {
    metricScope.mockResolvedValue({ unknown: true });
    const req = { user: { id: 9, role: 'admin' }, query: {} };
    const res = mockRes();
    await adminCtrl.getAllDisputes(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('no manage_disputes scope fails closed 403, no queries run', async () => {
    metricScope.mockResolvedValue(null);
    const req = { user: { id: 9, role: 'admin' }, query: {} };
    const res = mockRes();
    await adminCtrl.getAllDisputes(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('(d) getFinancials rows currency filter', () => {
  const superCtrl = require('../controllers/superAdminController');

  function mockFinancialsQueries() {
    db.query.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('information_schema')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('FROM platform_ledger WHERE UPPER')) {
        return { rows: [{ gross_cents: '10', job_fee_cents: '2', subscription_cents: '1', refunds_cents: '0', net_cents: '10' }] };
      }
      return { rows: [{ id: 1 }] };
    });
  }

  test('rows and totals share one validated currency (default USD)', async () => {
    mockFinancialsQueries();
    const req = { query: {} };
    const res = mockRes();
    await superCtrl.getFinancials(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.totals.currency_code).toBe('USD');
    const rowsCall = db.query.mock.calls.find(([t]) => String(t).includes('u.first_name'));
    expect(rowsCall[0]).toMatch('UPPER(pl.currency) = UPPER($');
    expect(rowsCall[1]).toContain('usd');
  });

  test('?currency=eur filters rows to EUR and totals to EUR', async () => {
    mockFinancialsQueries();
    const req = { query: { currency: 'eur' } };
    const res = mockRes();
    await superCtrl.getFinancials(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.totals.currency_code).toBe('EUR');
    const rowsCall = db.query.mock.calls.find(([t]) => String(t).includes('u.first_name'));
    expect(rowsCall[1]).toContain('eur');
  });

  test('invalid currency fails closed 400 before any rows query', async () => {
    mockFinancialsQueries();
    const req = { query: { currency: 'USDD' } };
    const res = mockRes();
    await superCtrl.getFinancials(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.query.mock.calls.filter(([t]) => String(t).includes('u.first_name'))).toHaveLength(0);
  });
});

describe('(c) franchise territory revenue currency', () => {
  const franchiseCtrl = require('../controllers/franchiseTerritoryController');

  function mockTerritoryQueries() {
    db.query.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('information_schema')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('FROM franchise_applications')) {
        return { rows: [{ id: 1, desired_country: 'US', desired_region: 'OH', desired_city: 'Springfield', status: 'launched', agreement_status: 'signed', training_status: 'done', launch_readiness_status: 'ready', linked_business_id: 42, desired_brand_name: 'Test', current_company_name: 'Test', checklist_done: 1, checklist_all: 1 }] };
      }
      if (sql.includes('FROM platform_ledger')) return { rows: [{ rev_30d: '5000', rev_total: '9000' }] };
      return { rows: [] };
    });
  }

  test('revenue query binds the requested currency and names it in the response', async () => {
    mockTerritoryQueries();
    const req = { user: { id: 5 }, query: { currency: 'eur' } };
    const res = mockRes();
    await franchiseCtrl.getTerritoryStats(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.territory_kpis.revenue_currency_code).toBe('EUR');
    const revCall = db.query.mock.calls.find(([t]) => String(t).includes('FROM platform_ledger'));
    expect(revCall[0]).toMatch('UPPER(currency) = UPPER($2)');
    expect(revCall[1]).toEqual([42, 'eur']);
  });

  test('default currency is USD and invalid currency fails closed 400', async () => {
    mockTerritoryQueries();
    const req = { user: { id: 5 }, query: {} };
    const res = mockRes();
    await franchiseCtrl.getTerritoryStats(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.territory_kpis.revenue_currency_code).toBe('USD');
    const res2 = mockRes();
    await franchiseCtrl.getTerritoryStats({ user: { id: 5 }, query: { currency: 'xx' } }, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });
});
