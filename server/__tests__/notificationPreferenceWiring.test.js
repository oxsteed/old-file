'use strict';

/**
 * notificationPreferenceWiring.test.js
 *
 * Review P2-8-F03 / P2-8-F05: every settings toggle must gate something.
 * - Friendly alias toggles (in_app_new_bid/push_new_bid, in_app_subscription/
 *   email_subscription) suppress the canonical types they describe.
 * - The push_notifications master toggle gates every push channel
 *   (Expo, Web Push, native).
 * - new_message is email-eligible so the email_new_message toggle works.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/socketService', () => ({ broadcastToUser: jest.fn() }));
jest.mock('../services/webPushService', () => ({
  isConfigured: jest.fn().mockReturnValue(true),
  sendToUser: jest.fn(),
}));
jest.mock('../services/mobilePushService', () => ({
  isConfigured: jest.fn().mockReturnValue(true),
  sendToUser: jest.fn(),
}));
const mockSendExpo = jest.fn();
jest.mock('expo-server-sdk', () => {
  const Expo = jest.fn().mockImplementation(() => ({
    chunkPushNotifications: jest.fn((messages) => [messages]),
    sendPushNotificationsAsync: (...args) => mockSendExpo(...args),
  }));
  Expo.isExpoPushToken = jest.fn().mockReturnValue(true);
  return { Expo };
});

const db = require('../db');
const webPushService = require('../services/webPushService');
const mobilePushService = require('../services/mobilePushService');
const { sendEmail } = require('../utils/email');
const { sendNotification } = require('../services/notificationService');

const BASE_PREFS = {
  email: 'user@example.com',
  first_name: 'A',
  is_banned: false,
  preferred_language: 'en',
  web_push_enabled: true,
  push_notifications: true,
  quiet_hours_enabled: false,
};

function mockPrefs(prefs) {
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  db.query
    .mockResolvedValueOnce({ rows: [{ ...BASE_PREFS, ...prefs }] })
    .mockResolvedValueOnce({ rows: [{ id: 'n1', is_push_sent: false, is_email_sent: false }] });
  webPushService.sendToUser.mockResolvedValue({ sent: 1 });
  mobilePushService.sendToUser.mockResolvedValue({ sent: 1 });
}

function insertCalls() {
  return db.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO notifications'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSendExpo.mockResolvedValue([{ status: 'ok' }]);
});

describe('P2-8-F03 friendly toggle aliases', () => {
  test('in_app_new_bid=false suppresses the in-app row for bid_received', async () => {
    mockPrefs({ in_app_new_bid: false });
    await sendNotification({ userId: 'u1', type: 'bid_received', title: 't', body: 'b' });
    expect(insertCalls()).toHaveLength(0);
  });

  test('in_app_new_bid left on keeps the in-app row for bid_received', async () => {
    mockPrefs({});
    await sendNotification({ userId: 'u1', type: 'bid_received', title: 't', body: 'b' });
    expect(insertCalls()).toHaveLength(1);
  });

  test('push_new_bid=false suppresses Expo push for bid_received', async () => {
    mockPrefs({ push_new_bid: false });
    await sendNotification({
      userId: 'u1', type: 'bid_received', title: 't', body: 'b',
      pushToken: 'ExponentPushToken[x]',
    });
    expect(mockSendExpo).not.toHaveBeenCalled();
  });

  test('in_app_subscription=false suppresses in-app for subscription_renewed', async () => {
    mockPrefs({ in_app_subscription: false });
    await sendNotification({ userId: 'u1', type: 'subscription_renewed', title: 't', body: 'b' });
    expect(insertCalls()).toHaveLength(0);
  });

  test('email_subscription=false suppresses email for subscription_renewed', async () => {
    mockPrefs({ email_subscription: false });
    await sendNotification({ userId: 'u1', type: 'subscription_renewed', title: 't', body: 'b' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('email_new_message toggle gates chat-message email (type is email-eligible)', async () => {
    mockPrefs({ email_new_message: false });
    await sendNotification({ userId: 'u1', type: 'new_message', title: 't', body: 'b' });
    expect(sendEmail).not.toHaveBeenCalled();

    mockPrefs({});
    await sendNotification({ userId: 'u1', type: 'new_message', title: 't', body: 'b' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('P2-8-F05 push_notifications master toggle', () => {
  test('push_notifications=false suppresses Expo push', async () => {
    mockPrefs({ push_notifications: false });
    await sendNotification({
      userId: 'u1', type: 'new_message', title: 't', body: 'b',
      pushToken: 'ExponentPushToken[x]',
    });
    expect(mockSendExpo).not.toHaveBeenCalled();
  });

  test('push_notifications=false suppresses Web Push and native push', async () => {
    mockPrefs({ push_notifications: false });
    await sendNotification({ userId: 'u1', type: 'new_message', title: 't', body: 'b' });
    expect(webPushService.sendToUser).not.toHaveBeenCalled();
    expect(mobilePushService.sendToUser).not.toHaveBeenCalled();
  });

  test('push_notifications left on keeps push delivery', async () => {
    mockPrefs({});
    await sendNotification({
      userId: 'u1', type: 'new_message', title: 't', body: 'b',
      pushToken: 'ExponentPushToken[x]',
    });
    expect(mockSendExpo).toHaveBeenCalled();
  });
});
