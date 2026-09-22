'use strict';

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
    sendPushNotificationsAsync: jest.fn().mockResolvedValue([{
      status: 'error',
      message: 'device is no longer registered',
      details: { error: 'DeviceNotRegistered' },
    }]),
  }));
  Expo.isExpoPushToken = jest.fn().mockReturnValue(true);
  return { Expo };
});

const db = require('../db');
const { sendNotification } = require('../services/notificationService');

const prefs = {
  email: null,
  first_name: 'Credit',
  is_banned: false,
  preferred_language: 'en',
  in_app_oxsteed_credit_transaction: true,
  push_oxsteed_credit_transaction: true,
  web_push_enabled: false,
  quiet_hours_enabled: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

test('loads notification preferences without the removed helper profile token column', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [prefs] })
    .mockResolvedValueOnce({ rows: [{ id: 'notification-1' }] })
    .mockResolvedValueOnce({ rows: [] });

  await expect(sendNotification({
    userId: 'customer-1',
    type: 'oxsteed_credit_transaction',
    title: 'Credit activity',
    body: 'A test transaction posted.',
  })).resolves.toMatchObject({ success: true, notificationId: 'notification-1' });

  expect(db.query.mock.calls[0][0]).not.toMatch(/helper_profiles|push_token/);
  expect(db.query.mock.calls[0][0]).toContain('notification_preferences');
});

test('disables an unregistered Expo token in the current mobile token registry', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [prefs] })
    .mockResolvedValueOnce({ rows: [{ id: 'notification-2' }] })
    .mockResolvedValue({ rows: [], rowCount: 0 });

  const result = await sendNotification({
    userId: 'customer-1',
    type: 'oxsteed_credit_transaction',
    title: 'Credit activity',
    body: 'A test transaction posted.',
    pushToken: 'ExponentPushToken[test-token]',
  });
  // Keep the failure details visible if the service's non-throwing guard trips.
  expect(result).toEqual({ success: true, notificationId: 'notification-2' });

  const cleanupCall = db.query.mock.calls.find(([sql]) => sql.includes('disabled_at = NOW()'));
  expect(cleanupCall).toBeDefined();
  expect(cleanupCall[0]).toContain('UPDATE mobile_push_tokens');
  expect(cleanupCall[0]).not.toContain('helper_profiles');
  expect(cleanupCall[1]).toEqual(['ExponentPushToken[test-token]']);
});

test('reuses an existing delivery-keyed notification without broadcasting twice', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [prefs] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'notification-existing', is_push_sent: true, is_email_sent: false }] });

  const result = await sendNotification({
    userId: 'customer-1',
    type: 'new_message',
    title: 'New message',
    body: 'Hello',
    idempotencyKey: 'message:message-1:customer-1',
  });

  expect(result).toEqual({ success: true, notificationId: 'notification-existing' });
  expect(db.query.mock.calls[1][0]).toContain('delivery_key');
  expect(db.query.mock.calls[2][0]).toContain('WHERE delivery_key = $1');
  expect(require('../services/socketService').broadcastToUser).not.toHaveBeenCalled();
});
