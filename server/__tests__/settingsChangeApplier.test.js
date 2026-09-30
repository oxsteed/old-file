'use strict';

const { mockQuery, resetMocks } = require('./setup');

// Run the job handler inline so tests exercise the applier logic without a
// real job lock table.
jest.mock('../jobs/jobLockingService', () => ({
  withJobLock: jest.fn(async (jobName, handler) => handler()),
}));

jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

// The controller lands in a parallel change set; mock it virtually so this
// test does not depend on Worker A's file existing yet.
const mockApplyChangeRequest = jest.fn();
jest.mock('../controllers/settingsChangeController', () => ({
  applyChangeRequest: mockApplyChangeRequest,
}), { virtual: true });

const {
  runSettingsChangeApplierOnce,
  JOB_NAME,
  CHANGE_REQUESTS_TABLE,
} = require('../jobs/settingsChangeApplier');
const { withJobLock } = require('../jobs/jobLockingService');
const { logAdminAction } = require('../services/auditService');

const past = new Date(Date.now() - 60 * 1000).toISOString();
const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

function changeRequest(overrides = {}) {
  return {
    id: 1,
    status: 'approved',
    effective_at: null,
    reviewed_by: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    setting_key: 'site.name',
    new_value: 'OxSteed',
    ...overrides,
  };
}

function mockDiscovery(rows) {
  mockQuery
    .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
    .mockResolvedValueOnce({ rows, rowCount: rows.length }) // SELECT ... FOR UPDATE
    .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT
}

function discoverySelectSql() {
  const call = mockQuery.mock.calls.find(
    ([sql]) => typeof sql === 'string' && sql.includes('FOR UPDATE')
  );
  expect(call).toBeDefined();
  return call[0];
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockApplyChangeRequest.mockResolvedValue(undefined);
});

test('acquires the job lock before doing any work', async () => {
  mockDiscovery([]);
  await runSettingsChangeApplierOnce();
  expect(withJobLock).toHaveBeenCalledTimes(1);
  expect(withJobLock.mock.calls[0][0]).toBe(JOB_NAME);
});

test('applies every due row: approved with NULL effective_at and scheduled with past effective_at', async () => {
  const due = [
    changeRequest({ id: 1, status: 'approved', effective_at: null }),
    changeRequest({ id: 2, status: 'scheduled', effective_at: past }),
  ];
  mockDiscovery(due);

  const result = await runSettingsChangeApplierOnce();

  expect(result).toEqual({ locked: true, due: 2, applied: 2, failed: 0 });
  expect(mockApplyChangeRequest).toHaveBeenCalledTimes(2);
  expect(mockApplyChangeRequest).toHaveBeenCalledWith(expect.anything(), due[0], due[0].reviewed_by);
  expect(mockApplyChangeRequest).toHaveBeenCalledWith(expect.anything(), due[1], due[1].reviewed_by);
});

test('selects only approved/scheduled rows that are due (never applied, never future)', async () => {
  mockDiscovery([changeRequest({ id: 7 })]);
  await runSettingsChangeApplierOnce();

  const sql = discoverySelectSql();
  expect(sql).toContain(`FROM ${CHANGE_REQUESTS_TABLE}`);
  expect(sql).toMatch(/status\s+IN\s*\(\s*'approved'\s*,\s*'scheduled'\s*\)/i);
  expect(sql).not.toContain('applied');
  expect(sql).toMatch(/effective_at\s+IS\s+NULL\s+OR\s+effective_at\s*<=\s*NOW\(\)/i);
  expect(sql).toContain('FOR UPDATE');
});

test('future-effective rows are never selected by the worker', async () => {
  // The database filter excludes them; the worker only sees due rows.
  mockDiscovery([]);
  const result = await runSettingsChangeApplierOnce();

  expect(result).toEqual({ locked: true, due: 0, applied: 0, failed: 0 });
  expect(mockApplyChangeRequest).not.toHaveBeenCalled();
  const sql = discoverySelectSql();
  expect(sql).toMatch(/effective_at\s+IS\s+NULL\s+OR\s+effective_at\s*<=\s*NOW\(\)/i);
});

test('a failing row does not block the remaining rows and is left untouched', async () => {
  const good1 = changeRequest({ id: 11, status: 'approved' });
  const bad = changeRequest({ id: 12, status: 'scheduled', effective_at: past });
  const good2 = changeRequest({ id: 13, status: 'approved' });
  mockDiscovery([good1, bad, good2]);

  mockApplyChangeRequest.mockImplementation(async (_client, request) => {
    if (request.id === 12) throw new Error('invalid setting value');
    return { id: request.id, status: 'applied' };
  });

  const result = await runSettingsChangeApplierOnce();

  expect(result).toEqual({ locked: true, due: 3, applied: 2, failed: 1 });
  expect(mockApplyChangeRequest).toHaveBeenCalledTimes(3);
  // The worker never mutates the request row itself on failure; status is
  // owned by applyChangeRequest's own transaction (which rolled back).
  const workerUpdates = mockQuery.mock.calls.filter(
    ([sql]) => typeof sql === 'string' && /^\s*UPDATE\b/i.test(sql) && sql.includes(CHANGE_REQUESTS_TABLE)
  );
  expect(workerUpdates).toHaveLength(0);

  expect(logAdminAction).toHaveBeenCalledTimes(1);
  expect(logAdminAction).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'settings_change_apply_failed',
      targetType: 'settings_change_request',
      targetId: 12,
      description: expect.stringContaining('invalid setting value'),
    })
  );
});

test('a failing audit write does not block the remaining rows', async () => {
  const bad = changeRequest({ id: 21 });
  const good = changeRequest({ id: 22 });
  mockDiscovery([bad, good]);

  mockApplyChangeRequest.mockImplementation(async (_client, request) => {
    if (request.id === 21) throw new Error('boom');
    return { id: request.id, status: 'applied' };
  });
  logAdminAction.mockRejectedValueOnce(new Error('audit db down'));

  const result = await runSettingsChangeApplierOnce();

  expect(result).toEqual({ locked: true, due: 2, applied: 1, failed: 1 });
  expect(mockApplyChangeRequest).toHaveBeenCalledTimes(2);
});

test('already-applied rows are excluded by the discovery filter', async () => {
  // Simulate the second tick: applyChangeRequest already marked the row
  // 'applied', so the discovery SELECT returns nothing and nothing is
  // applied again.
  mockDiscovery([]);
  const result = await runSettingsChangeApplierOnce();

  expect(result.applied).toBe(0);
  expect(mockApplyChangeRequest).not.toHaveBeenCalled();
  expect(discoverySelectSql()).not.toMatch(/'applied'/);
});

test('a discovery failure rolls back and propagates', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
    .mockRejectedValueOnce(new Error('table missing')); // SELECT fails
  await expect(runSettingsChangeApplierOnce()).rejects.toThrow('table missing');
  const sqls = mockQuery.mock.calls.map(([sql]) => sql);
  expect(sqls).toContain('ROLLBACK');
  expect(mockApplyChangeRequest).not.toHaveBeenCalled();
});
