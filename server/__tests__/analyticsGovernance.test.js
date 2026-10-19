'use strict';

jest.mock('../middleware/adminAuth', () => ({ hasGlobalGrant: jest.fn() }));
jest.mock('../services/scopeModel', () => ({ resolveScope: jest.fn() }));
jest.mock('../utils/logger', () => ({ warn: jest.fn() }));

const { hasGlobalGrant } = require('../middleware/adminAuth');
const { resolveScope } = require('../services/scopeModel');
const { assertMetricAccess, permittedMetrics, METRIC_PERMISSIONS } = require('../analytics/metricAccess');
const { executeBuilderQuery, runCappedQuery, getBuilderMeta } = require('../analytics/queryBuilder');
const admin = { id: '88888888-8888-4888-8888-888888888888', role: 'admin' };
const superAdmin = { ...admin, role: 'super_admin' };

beforeEach(() => {
  jest.resetAllMocks();
  hasGlobalGrant.mockResolvedValue(false);
  resolveScope.mockResolvedValue({ isAdmin: true, restaurantIds: [], regionRestricted: true });
});

test.each(Object.keys(METRIC_PERMISSIONS))('denies %s without its current global grant', async metric => {
  await expect(assertMetricAccess(admin, metric)).rejects.toMatchObject({ status: 403 });
});

test('filters catalogs by grants and never exposes unknown/inherited metrics', async () => {
  hasGlobalGrant.mockImplementation(async (_, permission) => permission === 'manage_support');
  const allowed = await permittedMetrics(admin);
  expect(allowed.sort()).toEqual(['sla_first_response_compliance_pct', 'support_nps_index']);
  expect(getBuilderMeta(allowed).metrics.map(m => m.name).sort()).toEqual(allowed);
  expect(await permittedMetrics(superAdmin, ['constructor', '__proto__'])).toEqual([]);
});

test('rechecks grant revocation on subsequent executions', async () => {
  hasGlobalGrant.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await assertMetricAccess(admin, 'platform_revenue_cents');
  await expect(assertMetricAccess(admin, 'platform_revenue_cents')).rejects.toMatchObject({ status: 403 });
});

test('a restricted admin cannot reach metric SQL but denial is audited', async () => {
  const db = { query: jest.fn(async () => ({ rows: [] })), connect: jest.fn() };
  await expect(executeBuilderQuery(db, admin, { metric: 'platform_revenue_cents' }))
    .rejects.toMatchObject({ status: 403 });
  expect(db.connect).not.toHaveBeenCalled();
  expect(db.query.mock.calls[0][0]).toContain('INSERT INTO analytics_query_audit');
});

test('no results are disclosed when audit persistence fails', async () => {
  const client = { query: jest.fn(async sql => ({ rows: sql.startsWith('SELECT') ? [{ value: 5 }] : [] })), release: jest.fn() };
  const db = { connect: jest.fn(async () => client), query: jest.fn(async () => { throw new Error('audit unavailable'); }) };
  await expect(executeBuilderQuery(db, superAdmin, { metric: 'open_disputes' }))
    .rejects.toMatchObject({ status: 503, code: 'analytics_audit_unavailable' });
  expect(client.release).toHaveBeenCalled();
});

test('uses database read-only transactions with timeout and rollback on failure', async () => {
  const client = { query: jest.fn(async sql => {
    if (sql.startsWith('SELECT')) throw Object.assign(new Error('timeout'), { code: '57014' });
    return { rows: [] };
  }), release: jest.fn() };
  await expect(runCappedQuery({ connect: async () => client }, { text: 'SELECT 1', params: [] }))
    .rejects.toMatchObject({ code: '57014' });
  expect(client.query.mock.calls.map(call => call[0])).toEqual([
    'BEGIN READ ONLY', "SET LOCAL statement_timeout = '30s'", 'SELECT 1\nLIMIT 10001', 'ROLLBACK',
  ]);
  expect(client.release).toHaveBeenCalledTimes(1);
});
