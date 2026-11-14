'use strict';

// Notifications audit item 39 (skip half): a Customer 360 tick that found
// the previous tick still running returned silently, with no log line and
// no metric, so overruns were invisible.
// Reproduction: start the job, hang the first tick, advance past the next
// tick, and no skip is logged.

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

const db = require('../db');
const logger = require('../utils/logger');
const { startCustomer360Alerts } = require('../jobs/customer360Alerts');

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test('an overrun tick is logged instead of silently skipped', async () => {
  process.env.CUSTOMER360_ALERTS_ENABLED = 'true';
  // The first tick never resolves: the rules query hangs, so the tick
  // stays "running" past the next 60s boundary.
  db.query.mockImplementation(() => new Promise(() => {}));
  const handle = startCustomer360Alerts();
  try {
    await jest.advanceTimersByTimeAsync(60000); // tick 1 starts, hangs
    await jest.advanceTimersByTimeAsync(60000); // tick 2 finds it running
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/skipped/i),
    );
  } finally {
    handle.stop();
    delete process.env.CUSTOMER360_ALERTS_ENABLED;
  }
});
