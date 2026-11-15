'use strict';

// Notifications audit N9: the reengagement job sends the nudge twice
// through two paths — sendNotification (in-app/push, promotional) and
// deliverDigestEmail for the email. The single-send invariant holds only
// because 'reengagement_nudge' is NOT in sendNotification's emailTypes
// allow-list. Pin it: if the type is ever added to emailTypes, the
// user gets the nudge twice (once from each path).

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/socketService', () => ({
  broadcastToUser: jest.fn(),
}));
jest.mock('../services/webPushService', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  sendToUser: jest.fn(),
}));
jest.mock('../services/mobilePushService', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  sendToUser: jest.fn(),
}));
jest.mock('expo-server-sdk', () => {
  const Expo = jest.fn().mockImplementation(() => ({
    chunkPushNotifications: jest.fn((messages) => [messages]),
    sendPushNotificationsAsync: jest.fn().mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]),
  }));
  Expo.isExpoPushToken = jest.fn().mockReturnValue(true);
  return { Expo };
});

const db = require('../db');
const { sendEmail } = require('../utils/email');
const { sendNotification } = require('../services/notificationService');

const prefs = {
  email: 'test@example.invalid',
  first_name: 'Test',
  is_banned: false,
  preferred_language: 'en',
  in_app_reengagement_nudge: true,
  email_notifications: true,
  web_push_enabled: false,
  quiet_hours_enabled: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.query.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('FROM users u')) return { rows: [{ ...prefs }] };
    if (text.includes('INSERT INTO notifications')) {
      return { rows: [{ id: 42, is_push_sent: false, is_email_sent: false }] };
    }
    return { rows: [], rowCount: 0 };
  });
  sendEmail.mockResolvedValue({ success: true, id: 'synthetic-email' });
});

test('reengagement_nudge sends exactly once: no email leg from sendNotification', async () => {
  const result = await sendNotification({
    userId: 'customer-1',
    type: 'reengagement_nudge',
    title: 'We miss you',
    body: 'Come back and post a job',
    idempotencyKey: 'reengagement-nudge:customer-1:1',
  });
  expect(result.success).toBe(true);
  // The in-app row is still created (the job's sendNotification leg).
  expect(result.delivered.inApp).toBe(true);
  expect(result.notificationId).toBe(42);
  // But no email is sent or queued here: the job's deliverDigestEmail
  // call owns the single email. If reengagement_nudge ever joins
  // emailTypes, this fails and the user gets the nudge twice.
  expect(result.delivered.email).toBe(false);
  expect(result.delivered.emailQueued).toBe(false);
  expect(sendEmail).not.toHaveBeenCalled();
});
