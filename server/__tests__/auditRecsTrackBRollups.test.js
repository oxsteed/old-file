'use strict';
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../jobs/jobLockingService', () => ({ withFencedJobLock: jest.fn(async (_name, fn) => fn({
  db: require('../db'), assertActive() {}, fencedTransaction: async fn => fn(require('../db')),
})) }));
jest.mock('../growth/rollups/domain', () => ({ collectDomainDay: jest.fn(async () => ({ sources: { food: 0 } })), addDemand: jest.fn(), addSupply: jest.fn(), key3: jest.fn() }));
jest.mock('../growth/propensity', () => ({ computeAll: jest.fn() }));
const propensity = require('../growth/propensity');
const { run } = require('../jobs/growthNightlyRollups');
const previous = { off: process.env.GROWTH_TRACKING_HARD_OFF, ch: process.env.GROWTH_CLICKHOUSE_URL };
beforeEach(() => {
  resetMocks();
  jest.useFakeTimers().setSystemTime(Date.parse('2026-10-25T04:00:00Z'));
  process.env.GROWTH_TRACKING_HARD_OFF = 'false';
  delete process.env.GROWTH_CLICKHOUSE_URL;
  propensity.computeAll.mockReset();
  propensity.computeAll.mockResolvedValue({ users: 0 });
  mockQuery.mockImplementation(async sql => ({ rows: sql.includes('INSERT INTO growth_rollup_runs') ? [{ id: 5 }] : [] }));
});
afterEach(() => {
  jest.useRealTimers();
  for (const [key, value] of [['GROWTH_TRACKING_HARD_OFF', previous.off], ['GROWTH_CLICKHOUSE_URL', previous.ch]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
test('rerunning a past partial day recomputes it and clears the stale subject sets first', async () => {
  const result = await run({ day: '2026-10-20' });
  expect(result.day).toBe('2026-10-20');
  const deletes = mockQuery.mock.calls.map(([sql]) => sql);
  expect(deletes.some(sql => sql.includes('DELETE FROM demand_subject_daily WHERE day=$1'))).toBe(true);
  expect(deletes.some(sql => sql.includes('DELETE FROM supply_subject_daily WHERE day=$1'))).toBe(true);
  const finish = mockQuery.mock.calls.find(([sql]) => sql.includes('counts=$2'));
  expect(finish[1][2]).toBe('complete');
});
test('a completed day is skipped unless force is passed', async () => {
  mockQuery.mockImplementation(async sql => ({
    rows: sql.includes("status='complete'") ? [{ id: 9 }]
      : sql.includes('INSERT INTO growth_rollup_runs') ? [{ id: 5 }] : [],
  }));
  await expect(run({ day: '2026-10-20' })).resolves.toMatchObject({ skipped: true, reason: 'already_complete' });
  expect(propensity.computeAll).not.toHaveBeenCalled();
  await run({ day: '2026-10-20', force: true });
  expect(propensity.computeAll).toHaveBeenCalledTimes(1);
});
test('today and malformed days are rejected instead of computed', async () => {
  await expect(run({ day: '2026-10-25' })).rejects.toThrow('growth_rollup_day_invalid');
  await expect(run({ day: 'not-a-day' })).rejects.toThrow('growth_rollup_day_invalid');
  await expect(run({ day: '2026-10-26' })).rejects.toThrow('growth_rollup_day_invalid');
  expect(propensity.computeAll).not.toHaveBeenCalled();
});
