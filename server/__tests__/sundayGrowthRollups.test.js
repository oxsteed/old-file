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
  mockQuery.mockImplementation(async sql => ({ rows: sql.includes('INSERT INTO growth_rollup_runs') ? [{ id: 5 }] : [] }));
});
afterEach(() => {
  jest.useRealTimers();
  for (const [key, value] of [['GROWTH_TRACKING_HARD_OFF',previous.off],['GROWTH_CLICKHOUSE_URL',previous.ch]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
test('failed propensity produces a retryable partial day and accurately records skipped event coverage', async () => {
  propensity.computeAll.mockRejectedValue(new Error('scoring unavailable'));
  await run();
  const finish = mockQuery.mock.calls.find(([sql]) => sql.includes('counts=$2'));
  expect(finish[1][2]).toBe('partial');
  expect(finish[1][1]).toMatchObject({ coverage: 'domain_tables', propensity: { error: 'scoring unavailable' } });
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes("status='running' AND started_at<NOW()-interval '1 hour'"))).toBe(true);
  await run();
  expect(propensity.computeAll).toHaveBeenCalledTimes(2);
});
test('successful scoring completes the day', async () => {
  propensity.computeAll.mockResolvedValue({ users: 0 });
  await run();
  const finish = mockQuery.mock.calls.find(([sql]) => sql.includes('counts=$2'));
  expect(finish[1][2]).toBe('complete');
});
