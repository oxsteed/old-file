'use strict';

/**
 * One Truth P1 tests: auth (item 11), region handling (item 13), currency
 * aggregates (item 14), and caps (item 12.8).
 *
 * Contract:
 *  1. Auth: super-admins pass the One Truth gate by role; delegated
 *     analysts need an active investigation grant (no grant -> 403
 *     'investigation_access_required'); analyst reads are scoped to the
 *     union of their grants' scope_user_ids; every read is audit-logged.
 *  2. Regions: geo_radius and unknown boundary types are rejected with
 *     HTTP 400 (never silently widened to global); supported types work.
 *  3. Currency: money/commerce volumes are grouped by stored currency and
 *     never labeled with a single currency; no hardcoded 'USD'.
 *  4. Caps: list limit is capped at 100.
 */

const { mockQuery, resetMocks } = require('./setup');

const { requireOneTruthGrant } = require('../middleware/oneTruthAccess');
const oneTruthController = require('../controllers/oneTruthController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const next = jest.fn();

function grantRow(overrides = {}) {
  return {
    id: 11,
    investigation_ref: 'fraud-sweep-3',
    requester_admin_id: 'analyst-1',
    approver_admin_id: 'super-1',
    purpose: 'Review suspected duplicate accounts in the fraud sweep',
    scope_user_ids: ['user-1', 'user-2'],
    status: 'active',
    grant_scope: 'fraud_analyst',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    revoked_at: null,
    ...overrides,
  };
}

// Default dispatcher: schema probes succeed, everything else is empty.
function baseDispatcher(sql) {
  if (sql.includes('information_schema.tables')) return { rows: [{ exists: true }], rowCount: 1 };
  if (sql.includes('information_schema.columns')) return { rows: [{ exists: true }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
}

function analystReq(overrides = {}) {
  return {
    user: { id: 'analyst-1', role: 'admin' },
    isSuper: false,
    query: {},
    params: {},
    body: {},
    ip: '127.0.0.1',
    headers: {},
    get: () => null,
    ...overrides,
  };
}

beforeEach(() => {
  resetMocks();
  next.mockClear();
});

describe('oneTruth read gate (item 11)', () => {
  test('super-admin passes by role with no grant lookup', async () => {
    const req = analystReq({ user: { id: 'super-1', role: 'super_admin' }, isSuper: true });
    const res = mockRes();
    await requireOneTruthGrant(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.oneTruthGrants).toEqual([]);
    expect(req.oneTruthScopeIds).toBeNull();
  });

  test('admin with no active grant -> 403 investigation_access_required', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM investigation_access_grants')) return { rows: [], rowCount: 0 };
      return baseDispatcher(sql);
    });
    const req = analystReq();
    const res = mockRes();
    await requireOneTruthGrant(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'investigation_access_required' })
    );
  });

  test('admin with an active grant passes with scoped ids', async () => {
    const grant = grantRow();
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM investigation_access_grants')) return { rows: [grant], rowCount: 1 };
      return baseDispatcher(sql);
    });
    const req = analystReq();
    const res = mockRes();
    await requireOneTruthGrant(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.oneTruthGrants).toEqual([grant]);
    expect(req.oneTruthScopeIds).toEqual(['user-1', 'user-2']);
  });
});

describe('oneTruth region handling (item 13)', () => {
  function regionRow(def) {
    return {
      id: 'region-1',
      name: 'Test region',
      description: '',
      boundary_definition: JSON.stringify(def),
    };
  }

  test('geo_radius is rejected with 400, never widened to global', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM admin_regions WHERE id')) {
        return { rows: [regionRow({ type: 'geo_radius', radius_miles: 25 })], rowCount: 1 };
      }
      return baseDispatcher(sql);
    });
    const req = analystReq({ isSuper: true, query: { regionId: 'region-1' } });
    const res = mockRes();
    await oneTruthController.listUsers(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'unsupported_region' })
    );
    // The users table was never queried: no silent global read happened.
    expect(
      mockQuery.mock.calls.some(([sql]) => String(sql).includes('FROM users u'))
    ).toBe(false);
  });

  test('unknown boundary types are rejected with 400', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM admin_regions WHERE id')) {
        return { rows: [regionRow({ type: 'mystery_zone', foo: 'bar' })], rowCount: 1 };
      }
      return baseDispatcher(sql);
    });
    const req = analystReq({ isSuper: true, query: { regionId: 'region-1' } });
    const res = mockRes();
    await oneTruthController.listUsers(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'unsupported_region' })
    );
  });

  test('supported country_only region still works', async () => {
    const userRow = { id: 'user-1', email: 'u@example.com', created_at: new Date().toISOString() };
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM admin_regions WHERE id')) {
        return { rows: [regionRow({ type: 'country_only', countries: ['US'] })], rowCount: 1 };
      }
      if (sql.includes('COUNT(*)::int AS count FROM users u')) {
        return { rows: [{ count: 1 }], rowCount: 1 };
      }
      if (sql.includes('FROM users u') && sql.includes('ORDER BY u.created_at DESC')) {
        return { rows: [userRow], rowCount: 1 };
      }
      return baseDispatcher(sql);
    });
    const req = analystReq({ isSuper: true, query: { regionId: 'region-1' } });
    const res = mockRes();
    await oneTruthController.listUsers(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 1 }));
  });
});

describe('oneTruth currency aggregates (item 14)', () => {
  function statsDispatcher(sql) {
    if (sql.includes('GROUP BY 1') && sql.includes('FROM payments p')) {
      return {
        rows: [
          { currency: 'USD', volume_amount: '100.50' },
          { currency: 'EUR', volume_amount: '200.25' },
        ],
        rowCount: 2,
      };
    }
    if (sql.includes('GROUP BY 1') && sql.includes('FROM marketplace_orders mo')) {
      return {
        rows: [
          { currency: 'USD', volume_cents: '1500' },
          { currency: 'HTG', volume_cents: '30000' },
        ],
        rowCount: 2,
      };
    }
    if (sql.includes('AS total_payments')) {
      return { rows: [{ total_payments: 2, pending_payments: 0, completed_payments: 2 }], rowCount: 1 };
    }
    if (sql.includes('AS total_orders')) {
      return { rows: [{ total_orders: 2, paid_orders: 2 }], rowCount: 1 };
    }
    if (sql.includes('AS total_users')) {
      return { rows: [{ total_users: 4, inactive_users: 0, banned_users: 0, verified_users: 1 }], rowCount: 1 };
    }
    if (sql.includes('AS total_businesses')) {
      return { rows: [{ total_businesses: 1, inactive_businesses: 0, active_businesses: 1 }], rowCount: 1 };
    }
    if (sql.includes('FROM users u') && sql.includes('businesses b WHERE b.user_id = u.id')) {
      return { rows: [{ count: 0 }], rowCount: 1 };
    }
    if (sql.includes('AS total_jobs')) {
      return { rows: [{ total_jobs: 0, open_jobs: 0, active_jobs: 0, completed_jobs: 0, cancelled_jobs: 0 }], rowCount: 1 };
    }
    if (sql.includes('AS total_tickets')) {
      return { rows: [{ total_tickets: 0, open_tickets: 0, escalated_tickets: 0 }], rowCount: 1 };
    }
    if (sql.includes('AS total_listings')) {
      return { rows: [{ total_listings: 0, available_listings: 0 }], rowCount: 1 };
    }
    if (sql.includes('AS active_bookings')) {
      return { rows: [{ active_bookings: 0 }], rowCount: 1 };
    }
    if (sql.includes('AS total_sessions')) {
      return { rows: [{ total_sessions: 0, scheduled_sessions: 0, completed_sessions: 0 }], rowCount: 1 };
    }
    if (sql.includes('FROM admin_regions')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM fraud_cases')) return { rows: [], rowCount: 0 };
    return baseDispatcher(sql);
  }

  test('money volume is grouped by currency, never a single USD-labeled sum', async () => {
    mockQuery.mockImplementation(async (sql) => statsDispatcher(sql));
    const req = analystReq({ isSuper: true });
    const res = mockRes();
    await oneTruthController.getStats(req, res);

    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.sections.money.volumeByCurrency).toEqual([
      { currency: 'USD', amount: 100.5 },
      { currency: 'EUR', amount: 200.25 },
    ]);
    // The old currency-blind fields are gone.
    expect(body.sections.money.completedVolumeAmount).toBeUndefined();
    expect(body.sections.money.volume_currency).toBeUndefined();
  });

  test('commerce volume is grouped by currency in cents', async () => {
    mockQuery.mockImplementation(async (sql) => statsDispatcher(sql));
    const req = analystReq({ isSuper: true });
    const res = mockRes();
    await oneTruthController.getStats(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.sections.commerce.volumeByCurrency).toEqual([
      { currency: 'USD', amountCents: 1500 },
      { currency: 'HTG', amountCents: 30000 },
    ]);
    expect(body.sections.commerce.paidVolumeCents).toBeUndefined();
  });

  test('coverage KPIs are present with source + as-of timestamps', async () => {
    mockQuery.mockImplementation(async (sql) => statsDispatcher(sql));
    const req = analystReq({ isSuper: true });
    const res = mockRes();
    await oneTruthController.getStats(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.coverage).toEqual(
      expect.objectContaining({
        evaluatedUsers: expect.any(Number),
        unevaluatedUsers: expect.any(Number),
        openPairs: expect.any(Number),
        confirmedCases: expect.any(Number),
        asOf: expect.any(String),
      })
    );
    expect(body.coverage.sources).toHaveLength(2);
    for (const source of body.coverage.sources) {
      expect(source.asOf).toEqual(expect.any(String));
    }
  });
});

describe('oneTruth caps (item 12.8)', () => {
  test('list limit is capped at 100', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM admin_regions')) return { rows: [], rowCount: 0 };
      if (sql.includes('COUNT(*)::int AS count FROM users u')) {
        return { rows: [{ count: 0 }], rowCount: 1 };
      }
      return baseDispatcher(sql);
    });
    const req = analystReq({ isSuper: true, query: { limit: '500' } });
    const res = mockRes();
    await oneTruthController.listUsers(req, res);

    const listCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('ORDER BY u.created_at DESC')
    );
    expect(listCall).toBeDefined();
    const params = listCall[1];
    // [...params, limit, offset]: limit is second-to-last.
    expect(params[params.length - 2]).toBe(100);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });
});

describe('oneTruth analyst scoping + audit (item 11)', () => {
  test('analyst list read is scoped to grant ids and audit-logged', async () => {
    const userInScope = { id: 'user-1', email: 'a@example.com', phone: '+15551234567' };
    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM admin_regions')) return { rows: [], rowCount: 0 };
      if (sql.includes('COUNT(*)::int AS count FROM users u')) {
        // The analyst scope clause must be present.
        expect(String(sql)).toContain('= ANY(');
        return { rows: [{ count: 1 }], rowCount: 1 };
      }
      if (sql.includes('FROM users u') && sql.includes('ORDER BY u.created_at DESC')) {
        expect(String(sql)).toContain('= ANY(');
        expect(params).toContainEqual(['user-1', 'user-2']);
        return { rows: [userInScope], rowCount: 1 };
      }
      return baseDispatcher(sql);
    });
    const req = analystReq({
      oneTruthGrants: [grantRow()],
      oneTruthScopeIds: ['user-1', 'user-2'],
    });
    const res = mockRes();
    await oneTruthController.listUsers(req, res);

    const body = res.json.mock.calls[0][0];
    // PII is masked for analysts.
    expect(body.users[0].phone).toBe('***4567');
    // Per-read audit entry was written.
    const auditCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO admin_audit_log')
    );
    expect(auditCall).toBeDefined();
    expect(String(auditCall[1][5])).toContain('one_truth_list_users');
  });

  test('detail without a covering grant -> 403, no user data', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM investigation_access_grants')) return { rows: [], rowCount: 0 };
      return baseDispatcher(sql);
    });
    const req = analystReq({ params: { userId: 'user-9' } });
    const res = mockRes();
    await oneTruthController.getUserDetail(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'investigation_access_required' })
    );
    expect(
      mockQuery.mock.calls.some(([sql]) => String(sql).includes('FROM users u WHERE u.id'))
    ).toBe(false);
  });

  test('detail with a covering grant -> 200 and audit-logged with purpose', async () => {
    const grant = grantRow({ scope_user_ids: ['user-1'] });
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM investigation_access_grants')) return { rows: [grant], rowCount: 1 };
      if (sql.includes('FROM users u WHERE u.id')) {
        return { rows: [{ id: 'user-1', email: 'a@example.com' }], rowCount: 1 };
      }
      if (sql.includes('FROM businesses b')) return { rows: [], rowCount: 0 };
      return baseDispatcher(sql);
    });
    const req = analystReq({ params: { userId: 'user-1' } });
    const res = mockRes();
    await oneTruthController.getUserDetail(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 'user-1' }) })
    );
    const auditCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO admin_audit_log')
    );
    expect(auditCall).toBeDefined();
    expect(String(auditCall[1][5])).toContain('one_truth_user_detail');
  });
});

describe('oneTruth pair reviews (item 12.4)', () => {
  const UUID_A = '11111111-1111-1111-1111-111111111111';
  const UUID_B = '22222222-2222-2222-2222-222222222222';
  const UUID_OUT = '99999999-9999-9999-9999-999999999999';

  test('invalid review status -> 400', async () => {
    mockQuery.mockImplementation(async (sql) => baseDispatcher(sql));
    const req = analystReq({
      isSuper: true,
      body: { userAId: UUID_A, userBId: UUID_B, status: 'bogus' },
    });
    const res = mockRes();
    await oneTruthController.reviewSuspectPair(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'invalid_review_status' })
    );
  });

  test('analyst cannot review a pair outside grant scope -> 403', async () => {
    mockQuery.mockImplementation(async (sql) => baseDispatcher(sql));
    const req = analystReq({
      oneTruthGrants: [grantRow()],
      oneTruthScopeIds: [UUID_A],
      body: {
        userAId: UUID_A,
        userBId: UUID_OUT,
        status: 'reviewed',
      },
    });
    const res = mockRes();
    await oneTruthController.reviewSuspectPair(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'grant_scope_exceeded' })
    );
  });
});
