'use strict';

/**
 * M3 — Global Service Operations: capacity + ops runbooks.
 *
 * Failing-first contracts:
 *   1. GET /capacity?days=30 returns { window_days, regions, totals } with
 *      days bounded to 1..90, and aggregates booking load even though no
 *      `bookings` table or booking-to-region linkage exists in the schema
 *      (the gap is surfaced honestly in the payload).
 *   2. PUT /runbooks/:id bumps `version` and stamps `updated_by`.
 *   3. DELETE /runbooks/:id soft-deletes (is_active = false), never hard-deletes.
 */

const { mockQuery, resetMocks } = require('./setup');

const controller = require('../controllers/serviceOpsController');

beforeEach(() => {
  resetMocks();
});

function mockReq(overrides = {}) {
  return {
    query: {},
    params: {},
    body: {},
    user: { id: 'admin-1', role: 'super_admin' },
    ...overrides,
  };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function infoSchemaColumns(columns) {
  return { rows: columns.map((column_name) => ({ column_name })), rowCount: columns.length };
}

// ── Capacity ────────────────────────────────────────────────────────────────

describe('GET /capacity', () => {
  // Mirrors the real schema: booking_requests is the booking entity
  // (status + created_at, no region column). A `bookings` table with a
  // region column is only used to cover the regions branch.
  function mockCapacitySchema({ bookingsTable = false, regionColumn = null } = {}) {
    mockQuery.mockImplementation(async (sql, params) => {
      const text = String(sql);
      if (text.includes('information_schema.columns')) {
        const table = params && params[0];
        if (table === 'booking_requests') {
          return infoSchemaColumns(['id', 'status', 'created_at', 'service_location']);
        }
        if (table === 'bookings') {
          if (!bookingsTable) return { rows: [], rowCount: 0 };
          const cols = ['id', 'status', 'created_at'];
          if (regionColumn) cols.push(regionColumn);
          return infoSchemaColumns(cols);
        }
        if (table === 'jobs') {
          return infoSchemaColumns(['id', 'status', 'created_at', 'location_state']);
        }
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('/* serviceops:capacity:region_status */')) {
        if (bookingsTable && regionColumn) {
          return {
            rows: [
              { region: 'Texas', status: 'open', count: 5 },
              { region: 'Texas', status: 'completed', count: 3 },
              { region: 'Texas', status: 'cancelled', count: 1 },
              { region: 'Florida', status: 'in_progress', count: 2 },
              { region: null, status: 'open', count: 4 },
            ],
            rowCount: 5,
          };
        }
        return {
          rows: [
            { region: 'unassigned', status: 'pending', count: 5 },
            { region: 'unassigned', status: 'accepted', count: 3 },
            { region: 'unassigned', status: 'declined', count: 2 },
            { region: 'unassigned', status: 'expired', count: 1 },
            { region: 'unassigned', status: 'cancelled', count: 1 },
          ],
          rowCount: 5,
        };
      }
      if (text.includes('/* serviceops:capacity:by_day */')) {
        return {
          rows: [
            { day: '2026-09-30', count: 6 },
            { day: '2026-10-01', count: 6 },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  test('returns the documented shape, aggregating booking_requests by status/day', async () => {
    mockCapacitySchema();
    const res = mockRes();

    await controller.getCapacity(mockReq({ query: { days: '30' } }), res, jest.fn());

    expect(res.json).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    expect(payload.window_days).toBe(30);
    expect(payload.source).toBe('booking_requests');
    expect(Array.isArray(payload.regions)).toBe(true);
    expect(payload.totals).toEqual({
      bookings_total: 12,
      bookings_active: 8, // pending + accepted; declined/expired/cancelled are terminal
      bookings_completed: 0,
    });
    // No region column on booking_requests: honest fallback, not invented regions.
    expect(payload.regions).toEqual([]);
    expect(payload.region_attribution).toBe('unavailable');
    expect(payload.by_status).toHaveLength(5);
    // Daily series is present for capacity trending.
    expect(payload.by_day).toHaveLength(2);
  });

  test('populates regions when the demand table has a region column', async () => {
    mockCapacitySchema({ bookingsTable: true, regionColumn: 'region' });
    // booking_requests would win the probe; simulate a deployment where it
    // is absent so the `bookings` table is the source.
    mockQuery.mockImplementation(async (sql, params) => {
      const text = String(sql);
      if (text.includes('information_schema.columns')) {
        const table = params && params[0];
        if (table === 'bookings') return infoSchemaColumns(['id', 'status', 'created_at', 'region']);
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('/* serviceops:capacity:region_status */')) {
        return {
          rows: [
            { region: 'Texas', status: 'open', count: 5 },
            { region: 'Texas', status: 'completed', count: 3 },
            { region: 'Texas', status: 'cancelled', count: 1 },
            { region: 'Florida', status: 'in_progress', count: 2 },
            { region: null, status: 'open', count: 4 },
          ],
          rowCount: 5,
        };
      }
      if (text.includes('/* serviceops:capacity:by_day */')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = mockRes();

    await controller.getCapacity(mockReq({ query: { days: '30' } }), res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.source).toBe('bookings');
    expect(payload.region_attribution).toBe('table_column');
    const texas = payload.regions.find((r) => r.region === 'Texas');
    expect(texas).toEqual({
      region: 'Texas',
      bookings_total: 9,
      bookings_active: 5,
      bookings_completed: 3,
    });
    // NULL region is reported as unassigned, not dropped.
    expect(payload.regions.find((r) => r.region === 'unassigned')).toBeDefined();
  });

  test('bounds the days window to 1..90', async () => {
    mockCapacitySchema();
    for (const [input, expected] of [['500', 90], ['0', 1], ['-7', 1], ['abc', 30], [undefined, 30]]) {
      const res = mockRes();
      await controller.getCapacity(mockReq({ query: { days: input } }), res, jest.fn());
      expect(res.json.mock.calls[0][0].window_days).toBe(expected);
    }
  });

  test('states the region gap honestly when no region column exists', async () => {
    mockCapacitySchema({ regionColumn: null });
    const res = mockRes();

    await controller.getCapacity(mockReq({ query: {} }), res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.regions).toEqual([]);
    expect(payload.region_attribution).toBe('unavailable');
    expect(payload.by_status.length).toBeGreaterThan(0);
    expect(payload.totals.bookings_total).toBeGreaterThan(0);
  });

  test('reports not_configured when no demand table exists at all', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('information_schema.columns')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const res = mockRes();

    await controller.getCapacity(mockReq({ query: {} }), res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.available).toBe(false);
    expect(payload.reason).toBe('not_configured');
    expect(payload.regions).toEqual([]);
    expect(payload.totals).toEqual({
      bookings_total: 0,
      bookings_active: 0,
      bookings_completed: 0,
    });
  });
});

// ── Runbooks: list ──────────────────────────────────────────────────────────

describe('runbooks list', () => {
  test('GET returns active runbooks only, ordered by category then code', async () => {
    mockQuery.mockImplementation(async () => ({
      rows: [
        { id: 2, code: 'deploy-hotfix', title: 'Hotfix deploy', category: 'deployment', version: 2 },
        { id: 1, code: 'incident-sev1', title: 'SEV-1 response', category: 'incident', version: 1 },
      ],
      rowCount: 2,
    }));
    const res = mockRes();

    await controller.listRunbooks(mockReq(), res, jest.fn());

    const listSql = mockQuery.mock.calls[0][0];
    expect(listSql).toMatch(/is_active\s*=\s*(TRUE|true)/);
    expect(listSql).toMatch(/ORDER BY/i);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ runbooks: expect.any(Array) })
    );
    expect(res.json.mock.calls[0][0].runbooks).toHaveLength(2);
  });
});

// ── Runbooks: create ────────────────────────────────────────────────────────

describe('POST /runbooks', () => {
  test('creates a runbook and returns 201', async () => {
    const row = { id: 7, code: 'safety-escalation', title: 'Safety escalation', category: 'safety', body: 'Steps…', version: 1, is_active: true };
    mockQuery.mockImplementation(async () => ({ rows: [row], rowCount: 1 }));
    const res = mockRes();

    await controller.createRunbook(
      mockReq({ body: { code: 'safety-escalation', title: 'Safety escalation', category: 'safety', body: 'Steps…' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ runbook: row }));
  });

  test('rejects an invalid category with 400', async () => {
    const res = mockRes();
    await controller.createRunbook(
      mockReq({ body: { code: 'x-y', title: 'T', category: 'finance', body: 'B' } }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects a non-slug code with 400', async () => {
    const res = mockRes();
    await controller.createRunbook(
      mockReq({ body: { code: 'Bad Code!', title: 'T', category: 'incident', body: 'B' } }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns 409 on duplicate code', async () => {
    mockQuery.mockImplementation(async () => {
      const err = new Error('duplicate key value violates unique constraint "ops_runbooks_code_key"');
      err.code = '23505';
      throw err;
    });
    const res = mockRes();

    await controller.createRunbook(
      mockReq({ body: { code: 'dup-code', title: 'T', category: 'incident', body: 'B' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(409);
  });
});

// ── Runbooks: update (version bump) ─────────────────────────────────────────

describe('PUT /runbooks/:id', () => {
  test('bumps version and stamps updated_by', async () => {
    mockQuery.mockImplementation(async () => ({
      rows: [{ id: 3, code: 'k', title: 'New', category: 'vendor', body: 'B2', version: 4, updated_by: 'admin-1' }],
      rowCount: 1,
    }));
    const res = mockRes();

    await controller.updateRunbook(
      mockReq({ params: { id: '3' }, body: { title: 'New', category: 'vendor', body: 'B2' } }),
      res,
      jest.fn()
    );

    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).toMatch(/version\s*=\s*version\s*\+\s*1/i);
    expect(updateSql).toMatch(/updated_by/i);
    expect(mockQuery.mock.calls[0][1]).toContain('admin-1');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ runbook: expect.objectContaining({ version: 4 }) })
    );
  });

  test('returns 404 for an unknown or inactive runbook', async () => {
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    const res = mockRes();

    await controller.updateRunbook(
      mockReq({ params: { id: '999' }, body: { title: 'T', category: 'incident', body: 'B' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ── Runbooks: soft delete ───────────────────────────────────────────────────

describe('DELETE /runbooks/:id', () => {
  test('soft-deletes: sets is_active=false, never hard-deletes', async () => {
    mockQuery.mockImplementation(async () => ({
      rows: [{ id: 3, code: 'k', is_active: false }],
      rowCount: 1,
    }));
    const res = mockRes();

    await controller.deleteRunbook(mockReq({ params: { id: '3' } }), res, jest.fn());

    const deleteSql = mockQuery.mock.calls[0][0];
    expect(deleteSql).toMatch(/is_active\s*=\s*FALSE/i);
    expect(deleteSql).not.toMatch(/^\s*DELETE\s+FROM/i);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('returns 404 for an unknown or already-inactive runbook', async () => {
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    const res = mockRes();

    await controller.deleteRunbook(mockReq({ params: { id: '999' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
