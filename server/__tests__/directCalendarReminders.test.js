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
});
