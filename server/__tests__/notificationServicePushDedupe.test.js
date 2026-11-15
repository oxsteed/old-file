'use strict';

// Notifications audit N2: the push-dedupe row (is_push_sent) was only
// created inside `if (inAppEnabled)`, so a retry re-fired push when
// in-app was off. The push ledger (notification_push_deliveries)
// records each push send by delivery key, independent of the in-app
// row. Reproduction: send the same event twice with in-app off and a
// live Expo token; before the fix the Expo send fires twice, after
// the fix it fires once.

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
  const sendPushNotificationsAsync = jest.fn().mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);
  const Expo = jest.fn().mockImplementation(() => ({
    chunkPushNotifications: jest.fn((messages) => [messages]),
    sendPushNotificationsAsync,
  }));
  Expo.isExpoPushToken = jest.fn().mockReturnValue(true);
  Expo.__sendPushNotificationsAsync = sendPushNotificationsAsync;
  return { Expo };
});

const db = require('../db');
const { Expo } = require('expo-server-sdk');
const { sendNotification } = require('../services/notificationService');

const DELIVERY_KEY = 'push-dedupe:test-1';
const ledger = new Set();

const prefs = {
  email: 'test@example.invalid',
  first_name: 'Test',
  is_banned: false,
  preferred_language: 'en',
  // In-app OFF (master toggle), push ON. The Expo token rides the
  // pushToken param (sendNotification does not read prefs for it).
  in_app_notifications: false,
  push_notifications: true,
  web_push_enabled: false,
  quiet_hours_enabled: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  ledger.clear();
  db.query.mockReset();
  db.query.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('FROM users u')) return { rows: [{ ...prefs }] };
    if (text.includes('INSERT INTO notifications')) {
      return { rows: [{ id: 42, is_push_sent: false, is_email_sent: false }] };
    }
    if (text.includes('FROM notification_push_deliveries')) {
      return { rows: ledger.has(DELIVERY_KEY) ? [{ '?column?': 1 }] : [] };
    }
    if (text.includes('INSERT INTO notification_push_deliveries')) {
      ledger.add(DELIVERY_KEY);
      return { rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
});

test('a retry does not re-fire push when in-app is off', async () => {
  const sendPush = Expo.__sendPushNotificationsAsync;
  const args = {
    userId: 'customer-1',
    type: 'push_dedupe_test',
    title: 'Test push',
    body: 'This push must arrive once',
    pushToken: 'ExponentPushToken[test]',
    idempotencyKey: DELIVERY_KEY,
  };
  const first = await sendNotification(args);
  expect(first.success).toBe(true);
  expect(first.delivered.push).toBe(true);
  expect(sendPush).toHaveBeenCalledTimes(1);

  // Same event, same delivery key: the retry must not push again.
  const second = await sendNotification(args);
  expect(second.success).toBe(true);
  expect(second.delivered.push).toBe(true);
  expect(sendPush).toHaveBeenCalledTimes(1);
  // And no in-app row was ever created for this opted-out user.
  expect(db.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO notifications'))).toBe(false);
});
