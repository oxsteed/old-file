'use strict';

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const cron = require('node-cron');
const db = require('../db');
const { startWeeklySummaryJob, buildWeeklySummaryNotification } = require('../jobs/weeklySummary');

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

  test('earnings are grouped by payment currency, not summed into one USD total', async () => {
    // Item 15: the query summed helper_payout across currencies while
    // formatMoney hardcoded USD, so a EUR payout rendered as dollars.
    db.query.mockResolvedValueOnce({ rows: [] });
    startWeeklySummaryJob();

    const scheduledCallback = cron.schedule.mock.calls[0][1];
    await scheduledCallback();

    const summaryQuery = db.query.mock.calls[0][0];
    expect(summaryQuery).toContain('earnings_by_currency');
    expect(summaryQuery).toContain('GROUP BY');
    expect(summaryQuery).toContain('p.currency');
  });

  test('renders each currency group in its own currency', () => {
    const multi = buildWeeklySummaryNotification({
      earnings_by_currency: [
        { currency: 'EUR', total: 85 },
        { currency: 'USD', total: 1250 },
      ],
      active_bids: 2,
    }, 'en');
    // Both amounts keep their own currency; the codes disambiguate
    // symbols that collide across currencies (e.g. $ is not only USD).
    expect(multi.body).toContain('€85.00 EUR');
    expect(multi.body).toContain('$1,250.00 USD');
    expect(multi.body).not.toContain('$1,335.00');

    const single = buildWeeklySummaryNotification({
      earnings_by_currency: [{ currency: 'EUR', total: 85 }],
      earnings_mtd: 85,
      active_bids: 0,
    }, 'en');
    expect(single.body).toContain('€85.00');
    expect(single.body).not.toContain('$85.00');
  });

  test('falls back to the USD total when no currency groups are present', () => {
    const legacy = buildWeeklySummaryNotification({ earnings_mtd: 40, active_bids: 1 }, 'en');
    expect(legacy.body).toContain('$40.00');
  });
});
