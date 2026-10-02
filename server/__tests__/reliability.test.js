'use strict';

/**
 * M4 — Reliability workspace API.
 *
 * Failing reproduction: there is no read path for (a) release history,
 * (b) the _migrations bookkeeping table, or (c) the E04 DB workload
 * budgets, and no write path to record a release. The contract we need:
 *   1. GET /releases returns the newest 100 release_history rows.
 *   2. POST /releases records a release: version and commit_sha required;
 *      deployed_by = req.user.id; 201 on success.
 *   3. GET /migrations reads filename, status, applied_at from _migrations
 *      and fails closed (500) on query error.
 *   4. GET /budgets returns all four E04 budgets with config + state
 *      (active/queued counts), read-only.
 */

const { mockQuery, resetMocks } = require('./setup');

const {
  listReleases,
  createRelease,
  listMigrations,
  getBudgets,
} = require('../controllers/reliabilityController');

beforeEach(() => {
  resetMocks();
});

function mockReq(user = { id: 'admin-1' }, body = {}) {
  return { user, body };
}

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.body = payload; return res; });
  return res;
}

describe('M4 release history', () => {
  test('POST /releases without version fails (400)', async () => {
    const req = mockReq({ id: 'admin-1' }, { commit_sha: 'abc123' });
    const res = mockRes();
    await createRelease(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('POST /releases without commit_sha fails (400)', async () => {
    const req = mockReq({ id: 'admin-1' }, { version: 'v1.2.3' });
    const res = mockRes();
    await createRelease(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('POST /releases inserts with deployed_by from req.user and returns 201', async () => {
    const inserted = {
      id: 7, version: 'v1.2.3', commit_sha: 'deadbeef', status: 'deployed',
      deployed_at: '2026-10-02T12:00:00Z', deployed_by: 'admin-1', notes: 'Weekly deploy',
    };
    mockQuery.mockResolvedValue({ rows: [inserted], rowCount: 1 });
    const req = mockReq({ id: 'admin-1' }, { version: 'v1.2.3', commit_sha: 'deadbeef', notes: 'Weekly deploy' });
    const res = mockRes();
    await createRelease(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body.release.deployed_by).toBe('admin-1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO release_history/i);
    expect(params).toEqual(expect.arrayContaining(['v1.2.3', 'deadbeef', 'admin-1']));
  });

  test('POST /releases rejects an invalid status', async () => {
    const req = mockReq({ id: 'admin-1' }, { version: 'v1.2.3', commit_sha: 'abc', status: 'bogus' });
    const res = mockRes();
    await createRelease(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('GET /releases returns the newest 100 rows', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: i + 1, version: `v1.0.${i}`, commit_sha: `sha${i}`, status: 'deployed',
    }));
    mockQuery.mockResolvedValue({ rows, rowCount: 3 });
    const res = mockRes();
    await listReleases(mockReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.releases).toHaveLength(3);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/ORDER BY deployed_at DESC/i);
    expect(sql).toMatch(/LIMIT 100/i);
  });
});

describe('M4 migration status', () => {
  test('GET /migrations returns the status list', async () => {
    const rows = [
      { filename: '648_x.sql', status: 'applied', applied_at: '2026-10-01T00:00:00Z' },
      { filename: '649_release_history.sql', status: 'applied', applied_at: '2026-10-02T00:00:00Z' },
    ];
    mockQuery.mockResolvedValue({ rows, rowCount: 2 });
    const res = mockRes();
    await listMigrations(mockReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.migrations).toEqual(rows);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM _migrations/i);
  });

  test('GET /migrations fails closed on query error (500, no partial data)', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const res = mockRes();
    await listMigrations(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body.migrations).toBeUndefined();
  });
});

describe('M4 DB budgets', () => {
  test('GET /budgets returns all four budgets with active/queued counts', async () => {
    const res = mockRes();
    await getBudgets(mockReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.budgets).toHaveLength(4);
    const names = res.body.budgets.map((b) => b.name).sort();
    expect(names).toEqual(['exports', 'jobs', 'realtime', 'web']);
    for (const b of res.body.budgets) {
      expect(b.config).toEqual(expect.objectContaining({ maxConcurrent: expect.any(Number) }));
      expect(b.state).toEqual(expect.objectContaining({
        active: expect.any(Number),
        queued: expect.any(Number),
      }));
    }
  });

  test('GET /budgets is read-only: no DB query is issued', async () => {
    const res = mockRes();
    await getBudgets(mockReq(), res);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
