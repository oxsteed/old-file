'use strict';

// Notifications audit item 29 (this track's share): the customer360Alerts
// starter ran bare from backgroundWorkers with only an in-process running
// guard, so two replicas could evaluate the same tick concurrently and
// double-notify (the cap is per-process).
// Reproduction: a tick never acquires a fenced job lock.

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/customer360Workspace', () => ({
  sources: { anomaliesFinancial: { area: 'anomalies' } },
  access: jest.fn(() => async () => true),
  target: jest.fn(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn(async (_name, fn) => fn({})),
}));

const db = require('../db');
const { withFencedJobLock } = require('../jobs/jobLockingService');
const { startCustomer360Alerts } = require('../jobs/customer360Alerts');

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  delete process.env.CUSTOMER360_ALERTS_ENABLED;
  db.query.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  jest.useRealTimers();
});

test('each tick runs under the fenced customer360-alerts lock', async () => {
  const handle = startCustomer360Alerts();
  try {
    await jest.advanceTimersByTimeAsync(60000);
    expect(withFencedJobLock).toHaveBeenCalledWith(
      'customer360-alerts',
      expect.any(Function),
      60,
    );
    expect(db.query).toHaveBeenCalled();
  } finally {
    handle.stop();
  }
});

test('a tick that cannot acquire the lock does not evaluate', async () => {
  withFencedJobLock.mockResolvedValueOnce({ skipped: true, lockSkipped: true });
  const handle = startCustomer360Alerts();
  try {
    await jest.advanceTimersByTimeAsync(60000);
    expect(withFencedJobLock).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  } finally {
    handle.stop();
  }
});

test('the fenced tick entry point is exported for direct invocation', async () => {
  const { runCustomer360AlertsTick } = require('../jobs/customer360Alerts');
  expect(typeof runCustomer360AlertsTick).toBe('function');
  await runCustomer360AlertsTick();
  expect(withFencedJobLock).toHaveBeenCalledWith(
    'customer360-alerts',
    expect.any(Function),
    60,
  );
});
