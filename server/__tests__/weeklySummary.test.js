'use strict';

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const cron = require('node-cron');
const db = require('../db');
const { startWeeklySummaryJob } = require('../jobs/weeklySummary');

describe('weekly summary job', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses live payout and helper completion columns', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    startWeeklySummaryJob();

    const scheduledCallback = cron.schedule.mock.calls[0][1];
    await scheduledCallback();

    const summaryQuery = db.query.mock.calls[0][0];
    expect(summaryQuery).toContain('SUM(COALESCE(p.helper_payout, 0))');
    expect(summaryQuery).toContain('p.status IN (\'captured\', \'released\')');
    expect(summaryQuery).toContain("CASE WHEN p.status = 'released' THEN p.released_at ELSE p.captured_at END");
    expect(summaryQuery).toContain('hp.completed_jobs_count AS completed_jobs');
    expect(summaryQuery).not.toContain('hp.earnings_mtd');
    expect(summaryQuery).not.toContain('hp.completed_jobs,');
  });
});
