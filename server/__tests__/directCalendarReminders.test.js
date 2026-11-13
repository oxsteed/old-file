'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/email', () => ({ sendEmail: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const db = require('../db');
const { sendEmail } = require('../utils/email');
const { processDirectCalendarReminders } = require('../jobs/directCalendarReminders');

describe('direct calendar reminders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('qualifies quote request columns when joining the assignee user', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await expect(processDirectCalendarReminders()).resolves.toEqual({ sent: 0, failed: 0 });

    const reminderQuery = db.query.mock.calls[0][0];
    expect(reminderQuery).toContain('quote_requests.id');
    expect(reminderQuery).toContain('quote_requests.email IS NOT NULL');
    expect(reminderQuery).toContain('quote_requests.status NOT IN');
    expect(reminderQuery).toContain('ORDER BY quote_requests.scheduled_start_at ASC');
    expect(reminderQuery).not.toMatch(/SELECT id,/);
  });

  test('renders reminders through the shared template and uses a stable delivery key', async () => {
    const scheduled = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.query
      .mockResolvedValueOnce({ rows: [{
        id: 44,
        first_name: '<script>alert(1)</script>',
        email: 'customer@example.com',
        service_category: 'Plumbing',
        service_location: '<img src=x>',
        scheduled_start_at: scheduled,
        assignee_email: null,
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({ rows: [] });
    sendEmail.mockResolvedValueOnce({ success: true });

    await expect(processDirectCalendarReminders()).resolves.toEqual({ sent: 1, failed: 0 });

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^direct-calendar-reminder:44:24_hour:customer@example.com$/),
    }));
    const payload = sendEmail.mock.calls[0][0];
    expect(payload.html).not.toContain('<script>alert(1)</script>');
    expect(payload.html).toContain('&lt;img src=x&gt;');
    expect(payload.text).toContain('Scheduled service reminder');
  });

  test('a {success:false} send is marked failed, never sent (P3-844)', async () => {
    const scheduled = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.query
      .mockResolvedValueOnce({ rows: [{
        id: 45,
        first_name: 'Sam',
        email: 'customer@example.com',
        service_category: 'Plumbing',
        service_location: 'On file',
        scheduled_start_at: scheduled,
        assignee_email: null,
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 8 }] })
      .mockResolvedValueOnce({ rows: [] });
    // sendEmail reports failure without throwing; the reminder must not be
    // marked 'sent' or it would be lost silently.
    sendEmail.mockResolvedValueOnce({ success: false, error: 'provider down' });

    await expect(processDirectCalendarReminders()).resolves.toEqual({ sent: 0, failed: 1 });

    const updateSql = db.query.mock.calls.map(([sql]) => sql).join('\n');
    expect(updateSql).toContain("status = 'failed'");
    expect(updateSql).not.toContain("status = 'sent'");
  });

  test('both recipients of one request are delivered in the same bounded batch (cost audit 2026-11-13 item 15)', async () => {
    const scheduled = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    let deliverySeq = 0;
    db.query.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM quote_requests')) {
        return { rows: [{
          id: 46,
          first_name: 'Jo',
          email: 'customer@example.com',
          service_category: 'Plumbing',
          service_location: 'On file',
          scheduled_start_at: scheduled,
          assignee_email: 'helper@example.com',
        }] };
      }
      if (String(sql).includes('INSERT INTO direct_calendar_reminder_deliveries')) {
        deliverySeq += 1;
        return { rows: [{ id: 100 + deliverySeq }] };
      }
      return { rows: [] };
    });
    sendEmail.mockResolvedValue({ success: true });

    await expect(processDirectCalendarReminders()).resolves.toEqual({ sent: 2, failed: 0 });

    const recipients = sendEmail.mock.calls.map(([arg]) => arg.to).sort();
    expect(recipients).toEqual(['customer@example.com', 'helper@example.com']);
    const keys = sendEmail.mock.calls.map(([arg]) => arg.idempotencyKey).sort();
    expect(keys).toEqual([
      'direct-calendar-reminder:46:24_hour:customer@example.com',
      'direct-calendar-reminder:46:24_hour:helper@example.com',
    ]);
    const sentMarks = db.query.mock.calls.filter(([sql]) => String(sql).includes("status = 'sent'"));
    expect(sentMarks).toHaveLength(2);
  });
});
