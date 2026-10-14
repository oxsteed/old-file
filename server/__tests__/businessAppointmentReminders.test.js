'use strict';
const { mockQuery, resetMocks } = require('./setup');
const mockSendNotification = jest.fn(async () => ({ success: true }));
jest.mock('../services/notificationService', () => ({
  sendNotification: (...args) => mockSendNotification(...args),
}));
const { sendEmailOrThrow } = require('../utils/email');
const { processDueReminders } = require('../jobs/businessAppointmentReminders');

beforeEach(() => { resetMocks(); mockSendNotification.mockClear(); sendEmailOrThrow.mockClear(); });

const dueRow = {
  reminder_id: 'rem-1',
  hours_before: 24,
  scheduled_at: new Date(Date.now() - 60000).toISOString(),
  appointment_id: 'appt-1',
  business_id: 7,
  service_id: 'svc-1',
  start_time: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  end_time: new Date(Date.now() + 25 * 3600 * 1000).toISOString(),
  status: 'confirmed',
  customer_id: 'cust-1',
  customer_name: 'Jane',
  customer_email: 'jane@example.com',
  business_name: 'Acme Services',
  owner_id: 'owner-1',
  service_name: 'Deep clean',
};

describe('processDueReminders (P2-3-F04)', () => {
  test('sends a due reminder to customer and owner, then leaves it sent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // supersede sweep
      .mockResolvedValueOnce({ rows: [dueRow] }) // due reminders
      .mockResolvedValueOnce({ rows: [{ id: 'rem-1' }] }); // atomic claim
    const result = await processDueReminders();
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    const notified = mockSendNotification.mock.calls.map(([arg]) => arg.userId).sort();
    expect(notified).toEqual(['cust-1', 'owner-1']);
    expect(mockSendNotification.mock.calls[0][0].type).toBe('appointment_reminder');
    // guest email path not needed when customer_id exists
    expect(sendEmailOrThrow).not.toHaveBeenCalled();
  });

  test('emails the guest contact address when there is no customer_id', async () => {
    const guestRow = { ...dueRow, reminder_id: 'rem-2', customer_id: null };
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [guestRow] })
      .mockResolvedValueOnce({ rows: [{ id: 'rem-2' }] });
    const result = await processDueReminders();
    expect(result.sent).toBe(1);
    expect(sendEmailOrThrow).toHaveBeenCalledTimes(1);
    expect(sendEmailOrThrow.mock.calls[0][0].to).toBe('jane@example.com');
  });

  test('a concurrently claimed reminder is skipped, not double-sent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [dueRow] })
      .mockResolvedValueOnce({ rows: [] }); // claim lost the race
    const result = await processDueReminders();
    expect(result).toMatchObject({ sent: 0, failed: 0 });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test('cancelled appointments are never picked up', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await processDueReminders();
    expect(result).toMatchObject({ sent: 0, failed: 0 });
    const dueQuery = mockQuery.mock.calls[1][0];
    expect(dueQuery).toMatch(/NOT IN \('cancelled', 'completed', 'no_show'\)/);
  });
});
