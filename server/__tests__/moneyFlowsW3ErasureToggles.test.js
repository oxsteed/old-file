'use strict';

/**
 * moneyFlowsW3ErasureToggles.test.js
 *
 * Money-flows W3 follow-up (same class as background-jobs audit #51 /
 * W6): the three erasure lifecycle notification types
 * (restaurant_erasure_requested / _decided / _completed) must ship with
 * per-type preference toggles. The toggle columns
 * (in_app_restaurant_erasure_*, migration 20261113231000) gate the
 * in-app channel through prefAllows in notificationService.js, the keys
 * are whitelisted in notificationController.updatePreferences, and the
 * settings UI offers them in the Restaurant Alerts section.
 *
 * Mocked-db unit test, following notificationPreferenceWiring.test.js:
 * a disabled toggle must suppress the in-app row; an unset toggle
 * defaults to on.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/socketService', () => ({ broadcastToUser: jest.fn() }));
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
    sendPushNotificationsAsync: jest.fn(),
  }));
  Expo.isExpoPushToken = jest.fn().mockReturnValue(false);
  return { Expo };
});

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { sendNotification } = require('../services/notificationService');

const BASE_PREFS = {
  email: 'user@example.com',
  first_name: 'A',
  is_banned: false,
  preferred_language: 'en',
  web_push_enabled: false,
  push_notifications: true,
  quiet_hours_enabled: false,
};

function mockPrefs(prefs) {
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  db.query
    .mockResolvedValueOnce({ rows: [{ ...BASE_PREFS, ...prefs }] })
    .mockResolvedValueOnce({ rows: [{ id: 'n1', is_push_sent: false, is_email_sent: false }] });
}

function insertCalls() {
  return db.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO notifications'));
}

beforeEach(() => {
  jest.clearAllMocks();
});

const TYPES = [
  'restaurant_erasure_requested',
  'restaurant_erasure_decided',
  'restaurant_erasure_completed',
];

test.each(TYPES)('disabled %s toggle suppresses the in-app row', async (type) => {
  mockPrefs({ [`in_app_${type}`]: false });
  const result = await sendNotification({
    userId: 'u1',
    type,
    title: 'Erasure',
    body: 'Erasure update',
    idempotencyKey: `toggle-off-${type}`,
  });
  expect(result.success).toBe(true);
  expect(insertCalls()).toHaveLength(0);
});

test.each(TYPES)('unset %s toggle defaults to on', async (type) => {
  mockPrefs({});
  const result = await sendNotification({
    userId: 'u1',
    type,
    title: 'Erasure',
    body: 'Erasure update',
    idempotencyKey: `toggle-on-${type}`,
  });
  expect(result.success).toBe(true);
  expect(insertCalls()).toHaveLength(1);
});

test('the three erasure keys are whitelisted for preference updates', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../controllers/notificationController.js'),
    'utf8'
  );
  for (const type of TYPES) {
    expect(src).toContain(`'in_app_${type}'`);
  }
});

test('the three erasure toggles are offered in the settings UI with locale keys', () => {
  const ui = fs.readFileSync(
    path.resolve(__dirname, '../../client/src/components/NotificationPreferences.jsx'),
    'utf8'
  );
  for (const type of TYPES) {
    expect(ui).toContain(`in_app_${type}`);
  }
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, `../../client/src/locales/${lang}.json`), 'utf8')
    );
    for (const type of TYPES) {
      const label = catalog?.notifications?.prefs?.[`in_app_${type}`];
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  }
});
