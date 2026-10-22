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
    // P3-1-F19: 'released' is never written to payments.status (release is
    // tracked in payment_hold_status), so the filter is captured-only.
    expect(summaryQuery).toContain("p.status = 'captured'");
    expect(summaryQuery).not.toContain("'released')");
    expect(summaryQuery).toContain("CASE WHEN p.payment_hold_status = 'released' THEN p.released_at ELSE p.captured_at END");
    expect(summaryQuery).toContain('hp.completed_jobs_count AS completed_jobs');
    expect(summaryQuery).not.toContain('hp.earnings_mtd');
    expect(summaryQuery).not.toContain('hp.completed_jobs,');
  });

  test('does not exclude helpers who never opened notification settings', async () => {
    // Notifications audit: preference rows are created lazily while
    // email_weekly_summary defaults to TRUE. An INNER JOIN silently
    // dropped every helper without a row.
    db.query.mockResolvedValueOnce({ rows: [] });
    startWeeklySummaryJob();

    const scheduledCallback = cron.schedule.mock.calls[0][1];
    await scheduledCallback();

    const summaryQuery = db.query.mock.calls[0][0];
    expect(summaryQuery).toContain('LEFT JOIN notification_preferences np ON np.user_id = u.id');
    expect(summaryQuery).toContain('COALESCE(np.email_weekly_summary, true)');
  });
});
