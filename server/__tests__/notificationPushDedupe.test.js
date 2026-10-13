'use strict';

// P1-265: one notification must reach at most one push channel.
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
const { sendNotification } = require('../services/notificationService');

const prefs = {
  email: null, first_name: 'A', is_banned: false, preferred_language: 'en',
  web_push_enabled: true, quiet_hours_enabled: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  db.query.mockResolvedValueOnce({ rows: [prefs] })
    .mockResolvedValueOnce({ rows: [{ id: 'n1', is_push_sent: false, is_email_sent: false }] });
  webPushService.sendToUser.mockResolvedValue({ sent: 1 });
  mobilePushService.sendToUser.mockResolvedValue({ sent: 1 });
});

test('Expo success suppresses Web Push and native push', async () => {
  mockSendExpo.mockResolvedValue([{ status: 'ok' }]);
  await sendNotification({ userId: 'u1', type: 'new_message', title: 't', body: 'b', pushToken: 'ExponentPushToken[x]' });
  expect(webPushService.sendToUser).not.toHaveBeenCalled();
  expect(mobilePushService.sendToUser).not.toHaveBeenCalled();
});

test('Expo failure falls through to Web Push, which then suppresses native push', async () => {
  mockSendExpo.mockResolvedValue([{ status: 'error', message: 'x', details: {} }]);
  await sendNotification({ userId: 'u1', type: 'new_message', title: 't', body: 'b', pushToken: 'ExponentPushToken[x]' });
  expect(webPushService.sendToUser).toHaveBeenCalledTimes(1);
  expect(mobilePushService.sendToUser).not.toHaveBeenCalled();
});

test('no Web Push delivery falls through to native push', async () => {
  webPushService.sendToUser.mockResolvedValue({ sent: 0 });
  await sendNotification({ userId: 'u1', type: 'new_message', title: 't', body: 'b' });
  expect(mobilePushService.sendToUser).toHaveBeenCalledTimes(1);
});
