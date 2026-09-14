'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/email', () => ({ sendEmail: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const db = require('../db');
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
});
