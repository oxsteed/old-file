'use strict';
// D16: coverage guard and operator CLI parsing for the geo source switch.
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
const geo = require('../analytics/regionGeoSourceSwitch');
const { parseArgs } = require('../scripts/regionGeoSourceSwitch');

test('switch refused until centroids are loaded', () => {
  expect(geo.coverageAllowsSwitch({ centroid_rows: 0, users_located_direct: 0, users_located_centroids: 0 }))
    .toEqual({ ok: false, reason: 'centroids_not_loaded' });
});

test('switch refused when centroids place materially fewer users', () => {
  expect(geo.coverageAllowsSwitch({ centroid_rows: 10, users_located_direct: 100, users_located_centroids: 90 }))
    .toEqual({ ok: false, reason: 'centroid_coverage_regression' });
  expect(geo.coverageAllowsSwitch({ centroid_rows: 10, users_located_direct: 100, users_located_centroids: 95 }))
    .toEqual({ ok: true });
  // International users (no direct US cache) never block the switch.
  expect(geo.coverageAllowsSwitch({ centroid_rows: 10, users_located_direct: 0, users_located_centroids: 3 }))
    .toEqual({ ok: true });
});

test('diff query is bounded', () => {
  expect(geo.diffQuery(10 ** 9).values).toEqual([100000]);
  expect(geo.diffQuery('x').values).toEqual([10000]);
});

test('CLI parses actions, version and force', () => {
  expect(parseArgs(['--switch', '--version=geonames-2026-10', '--force']))
    .toEqual({ action: 'switch', version: 'geonames-2026-10', force: true });
  expect(parseArgs(['--rollback'])).toMatchObject({ action: 'rollback', force: false });
  expect(parseArgs([])).toMatchObject({ action: null });
});

test('switch refuses forced override on an empty centroid table', async () => {
  const conn = { query: jest.fn(async (q) => {
    const sql = typeof q === 'string' ? q : q.text;
    if (/FROM platform_settings/.test(sql)) return { rows: [{ value: 'direct_geocode_cache' }] };
    if (/WITH sample/.test(sql)) return { rows: [{ matched: 0 }] };
    if (/centroid_rows/.test(sql)) return { rows: [{ centroid_rows: 0 }] };
    if (/INSERT INTO region_geo_source_switches/.test(sql)) return { rows: [{ id: '1' }] };
    return { rows: [] };
  }) };
  const result = await geo.switchToCentroids(conn, { force: true });
  expect(result).toMatchObject({ switched: false, reason: 'centroids_not_loaded' });
  expect(conn.query.mock.calls.some(([q]) => /INSERT INTO platform_settings/.test(typeof q === 'string' ? q : q.text))).toBe(false);
});
