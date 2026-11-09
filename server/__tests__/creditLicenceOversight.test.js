'use strict';

// Background-jobs audit (Oct 30 item 12): licence-oversight tasks load
// their compliance module through optional(), which returns
// { skipped: 'not_installed' } when the module is missing, and runTask
// used to return that as a normal result. A sanctions/AML/SAR task could
// report success forever while no screening ran. Those five tasks are
// now compliance-critical: a not_installed skip raises a high-severity
// incident instead of passing quietly.

jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn(),
}));

const { withFencedJobLock } = require('../jobs/jobLockingService');
const { mockQuery, resetMocks } = require('./setup');
const { tasks, runTask } = require('../jobs/creditLicenceOversight');

beforeEach(() => {
  jest.clearAllMocks();
  resetMocks();
  withFencedJobLock.mockImplementation(async (_name, handler) => {
    await handler({ assertActive: jest.fn(), db: { query: mockQuery } });
    return { completed: true };
  });
});

describe('licence oversight critical-task skip (Oct 30 item 12)', () => {
  test('the five sanctions/AML/SAR tasks are marked compliance-critical', () => {
    const byName = Object.fromEntries(tasks().map(([name, , , , critical]) => [name, Boolean(critical)]));
    for (const name of [
      'credit-sanctions-list-refresh',
      'credit-sanctions-rescreen',
      'credit-sanctions-queue',
      'credit-aml-monitor',
      'credit-sar-deadlines',
    ]) {
      expect(byName[name]).toBe(true);
    }
    expect(byName['credit-fx-reference-refresh']).toBe(false);
    expect(byName['credit-dispute-sla']).toBe(false);
  });

  test('a critical task whose module is missing records a high-severity incident', async () => {
    const result = await runTask('credit-sanctions-queue', 600, async () => ({ skipped: 'not_installed' }), { critical: true });
    expect(result).toEqual({ skipped: 'not_installed' });
    const incident = mockQuery.mock.calls.find(
      ([sql, params]) => String(sql).includes('INSERT INTO incident_log')
        && Array.isArray(params) && params.includes('credit-oversight-missing:credit-sanctions-queue')
    );
    expect(incident).toBeTruthy();
    expect(incident[1][0]).toBe('credit_oversight_module_missing');
    expect(incident[1][1]).toBe('high');
  });

  test('a non-critical task whose module is missing stays silent', async () => {
    await runTask('credit-dispute-sla', 600, async () => ({ skipped: 'not_installed' }));
    const incident = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO incident_log'));
    expect(incident).toBeFalsy();
  });

  test('a critical task that runs normally records no incident', async () => {
    await runTask('credit-aml-monitor', 900, async () => ({ processed: 3 }), { critical: true });
    const incident = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO incident_log'));
    expect(incident).toBeFalsy();
  });
});
