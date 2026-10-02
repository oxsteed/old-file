'use strict';

/**
 * E05 — Server-side scoping, fail closed.
 *
 * Failing reproduction: several admin list/detail/export surfaces return
 * rows with no region scoping at all (support ticket list + ticket detail,
 * the admin audit-log list + CSV export), so a regional admin can read
 * records from outside their assigned region. And there is no shared
 * scoping contract: each endpoint invents its own, and "scope missing"
 * silently means "unscoped".
 *
 * The contract we need:
 *   1. resolveScope(req): super-admin -> global; regional admin ->
 *      regions; no regions / scope lookup never ran / scope lookup failed
 *      -> FAIL CLOSED (empty scope or a 503 ScopeUnavailableError), never
 *      an silent unscoped pass-through.
 *   2. SQL fragment builders that turn a resolved scope into WHERE
 *      clauses: region_id-column scoping and user-location boundary
 *      scoping, with empty scope -> FALSE (no rows leak).
 *   3. The ticket list/detail and audit-log list/export honor the scope.
 */

const { mockQuery, resetMocks } = require('./setup');
const {
  ScopeUnavailableError,
  resolveScope,
  regionIdsScopeClause,
  userLocationScopeClause,
} = require('../utils/scopeFilter');

beforeEach(() => {
  resetMocks();
  mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
});

const REGION_US = {
  id: 7,
  name: 'US South',
  boundary_definition: { type: 'country_only', countries: ['US'] },
};

describe('E05 resolveScope', () => {
  test('super-admin resolves to global', () => {
    expect(resolveScope({ isSuper: true })).toEqual({ type: 'global' });
  });

  test('regional admin resolves to their regions', () => {
    const scope = resolveScope({ isSuper: false, assigned_regions: [REGION_US] });
    expect(scope.type).toBe('regions');
    expect(scope.regionIds).toEqual([7]);
  });

  test('admin with no regions gets an empty scope, not a pass-through', () => {
    expect(resolveScope({ isSuper: false, assigned_regions: [] }))
      .toEqual({ type: 'empty', regionIds: [] });
  });

  test('scope lookup failure fails closed with 503', () => {
    expect(() => resolveScope({ isSuper: false, assigned_regions: [], region_scope_unavailable: true }))
      .toThrow(ScopeUnavailableError);
    try {
      resolveScope({ isSuper: false, region_scope_unavailable: true });
    } catch (err) {
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe('SCOPE_UNAVAILABLE');
    }
  });

  test('scope never loaded fails closed (no silent unscoped access)', () => {
    expect(() => resolveScope({ isSuper: false }))
      .toThrow(ScopeUnavailableError);
  });
});

describe('E05 scope SQL fragments', () => {
  test('regionIdsScopeClause builds an IN clause', () => {
    const frag = regionIdsScopeClause('l.region_id', [7, 9], 1);
    expect(frag.clause).toBe('(l.region_id IN ($1,$2))');
    expect(frag.values).toEqual([7, 9]);
    expect(frag.nextParam).toBe(3);
  });

  test('regionIdsScopeClause with empty scope matches no rows', () => {
    const frag = regionIdsScopeClause('l.region_id', [], 1);
    expect(frag.clause).toBe('FALSE');
    expect(frag.values).toEqual([]);
  });

  test('userLocationScopeClause builds boundary fragments', () => {
    const frag = userLocationScopeClause('u', [REGION_US], 1);
    expect(frag.clause).toContain('u.country');
    expect(frag.values).toContain('US');
    expect(frag.nextParam).toBeGreaterThan(1);
  });

  test('userLocationScopeClause with empty scope matches no rows', () => {
    expect(userLocationScopeClause('u', [], 1).clause).toBe('FALSE');
  });
});

describe('E05 audit log honors scope', () => {
  test('regional admin only sees in-scope audit rows', async () => {
    const { getUserActionLogs } = require('../services/auditService');
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('COUNT(*)')) return { rows: [{ c: 1 }] };
      return { rows: [{ id: 1 }] };
    });
    await getUserActionLogs({ scopeRegionIds: [7] });
    const dataSql = mockQuery.mock.calls[0][0];
    expect(dataSql).toContain('l.region_id IN ($');
    const values = mockQuery.mock.calls[0][1];
    expect(values).toContain(7);
  });

  test('empty scope returns no audit rows (FALSE in SQL)', async () => {
    const { getUserActionLogs } = require('../services/auditService');
    await getUserActionLogs({ scopeRegionIds: [] });
    const dataSql = mockQuery.mock.calls[0][0];
    expect(dataSql).toContain('FALSE');
  });

  test('global scope leaves the audit query unscoped', async () => {
    const { getUserActionLogs } = require('../services/auditService');
    await getUserActionLogs({});
    const dataSql = mockQuery.mock.calls[0][0];
    expect(dataSql).not.toContain('region_id IN');
    expect(dataSql).not.toContain('FALSE');
  });
});
