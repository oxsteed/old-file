'use strict';

// Notifications audit item 31: scheduledDeletionJob and siteVisitRetention
// claimed UTC in comments but passed no timezone to cron, so the 3 AM run
// followed the host's local timezone instead.
// Reproduction: cron.schedule is called without a timezone option.

jest.mock('node-cron', () => ({
  schedule: jest.fn(() => ({ stop: jest.fn(), destroy: jest.fn() })),
  validate: jest.fn(() => true),
}));
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));

const cron = require('node-cron');
const { startScheduledDeletionJob } = require('../jobs/scheduledDeletionJob');
const { startSiteVisitRetentionJob } = require('../jobs/siteVisitRetention');

beforeEach(() => {
  jest.clearAllMocks();
});

test('scheduled deletion runs at 3 AM UTC, explicitly', () => {
  startScheduledDeletionJob();
  expect(cron.schedule).toHaveBeenCalledWith(
    '0 3 * * *',
    expect.any(Function),
    { timezone: 'UTC' },
  );
});

test('site visit retention runs at 3 AM UTC, explicitly', () => {
  startSiteVisitRetentionJob();
  expect(cron.schedule).toHaveBeenCalledWith(
    '0 3 * * *',
    expect.any(Function),
    { timezone: 'UTC' },
  );
});
