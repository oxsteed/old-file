'use strict';
// Notifications audit item 40: a growth rollup run whose fenced
// callback threw (ClickHouse stream, domain collect, write phase) kept
// its 'running' row forever: the only status update was the final one
// at the end of the callback, and a fenced abort ({ fenced: true })
// left it running too. Reproduction: fail the domain collect after
// the run row is inserted and watch for the failed-marking update;
// before the fix the throw propagated with no marking at all.

const { mockQuery, resetMocks } = require('./setup');

let mockFenceBehavior = 'throw';
const mockFenceDb = {
  query: jest.fn(async (sql) => {
    const text = String(sql);
    if (text.includes("UPDATE growth_rollup_runs SET status='failed'")) return { rowCount: 0 };
    if (text.includes('SELECT id FROM growth_rollup_runs WHERE day=')) return { rows: [] };
    if (text.includes('INSERT INTO growth_rollup_runs')) return { rows: [{ id: 7 }] };
    throw new Error(`unexpected fence query: ${text.slice(0, 80)}`);
  }),
};
const mockFence = {
  db: mockFenceDb,
  assertActive() {},
  fencedTransaction: async (tx) => tx(mockFenceDb),
};

jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn(async (_name, fn) => {
    try {
      return await fn(mockFence);
    } catch (err) {
      // Mirror the real service: a lease-loss error becomes a fenced
      // outcome instead of a throw; anything else rethrows.
      if (mockFenceBehavior === 'fenced' && err && err.isLeaseLost) return { fenced: true };
      throw err;
    }
  }),
}));
jest.mock('../growth/rollups/domain', () => ({
  collectDomainDay: jest.fn(),
  addDemand: jest.fn(),
  addSupply: jest.fn(),
  key3: jest.fn(),
}));
jest.mock('../growth/propensity', () => ({ computeAll: jest.fn() }));
jest.mock('../growth/gate', () => ({
  contexts: jest.fn(async () => new Map()),
  allow: jest.fn(async () => ({ allowed: true })),
  allowMany: jest.fn(() => new Map()),
  runtimePolicy: jest.fn(async () => ({ enabled: true, rollout: {}, rules: [] })),
  resolveJurisdiction: jest.fn(() => ({})),
}));

const { collectDomainDay } = require('../growth/rollups/domain');
const { run } = require('../jobs/growthNightlyRollups');

const OLD_HARD_OFF = process.env.GROWTH_TRACKING_HARD_OFF;

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockFenceBehavior = 'throw';
  process.env.GROWTH_TRACKING_HARD_OFF = 'false';
  delete process.env.GROWTH_CLICKHOUSE_URL;
});

afterAll(() => {
  if (OLD_HARD_OFF === undefined) delete process.env.GROWTH_TRACKING_HARD_OFF;
  else process.env.GROWTH_TRACKING_HARD_OFF = OLD_HARD_OFF;
});

function failedMarkCall() {
  return mockQuery.mock.calls.find(([sql]) =>
    sql.includes("UPDATE growth_rollup_runs SET status='failed'") && sql.includes("AND status='running'"));
}

test('a mid-run throw marks the run failed and rethrows', async () => {
  collectDomainDay.mockRejectedValue(new Error('clickhouse stream died'));
  await expect(run({ day: '2026-11-10' })).rejects.toThrow('clickhouse stream died');
  const mark = failedMarkCall();
  expect(mark).toBeTruthy();
  expect(mark[1]).toEqual([7, expect.objectContaining({ error: expect.stringContaining('clickhouse stream died') })]);
});

test('a fenced abort marks the run failed and returns the fenced outcome', async () => {
  mockFenceBehavior = 'fenced';
  const leaseErr = new Error('lease lost');
  leaseErr.isLeaseLost = true;
  collectDomainDay.mockRejectedValue(leaseErr);
  const outcome = await run({ day: '2026-11-10' });
  expect(outcome).toEqual({ fenced: true });
  const mark = failedMarkCall();
  expect(mark).toBeTruthy();
  expect(mark[1]).toEqual([7, expect.objectContaining({ error: 'lease_lost' })]);
});

test('no run row means no marking (already-complete skip)', async () => {
  mockFenceDb.query.mockImplementationOnce(async () => ({ rowCount: 0 }));
  mockFenceDb.query.mockImplementationOnce(async () => ({ rows: [{ id: 3 }] }));
  const outcome = await run({ day: '2026-11-10' });
  expect(outcome).toMatchObject({ skipped: true, reason: 'already_complete' });
  expect(failedMarkCall()).toBeUndefined();
});
