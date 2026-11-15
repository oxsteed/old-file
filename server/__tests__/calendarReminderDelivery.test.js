'use strict';

/**
 * Notifications audit item 14 (SMS + in-app legs only; quiet-hours
 * unification belongs to Track C):
 *  - calendar SMS bypasses SMS opt-outs: it sends via sendSMS over
 *    sendTransactionalSMS, which never checks sms_enabled, per-type keys,
 *    or the sms_opt_outs STOP list. Route it through sendSMSIfOptedIn.
 *  - the in-app leg fire-and-forget broadcasts with no acknowledgement
 *    and sets sent=true unconditionally with no notifications row. Persist
 *    calendar in-app reminders as notifications rows and count sent only
 *    when the row actually delivered.
 */

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({
    success: true, notificationId: 'notif-1',
    delivered: { inApp: true, push: false, email: false, emailQueued: false },
  }),
}));
jest.mock('../services/smsNotificationService', () => ({
  sendSMSIfOptedIn: jest.fn().mockResolvedValue(true),
}));
jest.mock('../utils/sms', () => ({
  sendSMS: jest.fn().mockResolvedValue({ success: true }),
  sendOTPSMS: jest.fn().mockResolvedValue(true),
}));

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/calendarNotificationController');
const { sendNotification } = require('../services/notificationService');
const { sendSMSIfOptedIn } = require('../services/smsNotificationService');
const { sendSMS } = require('../utils/sms');

function dueRow(over = {}) {
  return {
    notification_id: 42,
    user_id: 'cust-1',
    recipient_preferred_language: 'en',
    appointment_id: 7,
    notification_type: 'reminder_24h',
    channel: 'in_app',
    customer_id: 'cust-1',
    helper_id: 'helper-1',
    service_description: 'Deep clean',
    scheduled_start_time: new Date('2026-11-20T10:00:00Z'),
    location_address: '1 Main St',
    customer_email: 'cust@example.invalid',
    customer_name: 'Casey',
    customer_phone: '+15551234567',
    helper_email: 'helper@example.invalid',
    helper_name: 'Harper',
    helper_phone: '+15557654321',
    appointment_confirmed_channels: null,
    appointment_cancelled_channels: null,
    reminder_24h_channels: null,
    reminder_2h_channels: null,
    reminder_same_day_channels: null,
    quiet_hours_start: null,
    quiet_hours_end: null,
    timezone: 'UTC',
    ...over,
  };
}

async function runOnce(row) {
  mockQuery
    .mockResolvedValueOnce({ rows: [row] })
    .mockResolvedValue({ rows: [], rowCount: 0 });
  await controller.processReminderNotifications();
  const statusCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('SET status'));
  return statusCall ? statusCall[1][0] : null;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMocks();
});

describe('item 14: calendar SMS honours opt-outs', () => {
  test('SMS leg routes through sendSMSIfOptedIn, never the raw sendSMS', async () => {
    const status = await runOnce(dueRow({
      channel: 'sms', reminder_24h_channels: ['sms'],
    }));
    expect(sendSMSIfOptedIn).toHaveBeenCalledWith(
      'cust-1', expect.any(String), 'reminder'
    );
    expect(sendSMS).not.toHaveBeenCalled();
    expect(status).toBe('sent');
  });

  test('an opted-out SMS leg marks the reminder failed, not sent', async () => {
    sendSMSIfOptedIn.mockResolvedValueOnce(false);
    const status = await runOnce(dueRow({
      channel: 'sms', reminder_24h_channels: ['sms'],
    }));
    expect(status).toBe('failed');
  });
});

describe('item 14: calendar in-app persists a notifications row', () => {
  test('in-app leg persists a row through sendNotification with a stable key', async () => {
    const status = await runOnce(dueRow());
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'cust-1',
      type: 'reminder_24h',
      idempotencyKey: 'calendar-reminder:42',
      inAppChannel: true,
      pushChannel: false,
      emailChannel: false,
    }));
    expect(status).toBe('sent');
  });

  test('an undelivered in-app leg marks the reminder failed, not sent', async () => {
    sendNotification.mockResolvedValueOnce({
      success: true, notificationId: null,
      delivered: { inApp: false, push: false, email: false, emailQueued: false },
    });
    const status = await runOnce(dueRow());
    expect(status).toBe('failed');
  });
});
