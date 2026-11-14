'use strict';

/**
 * Notifications audit item 19: sendNotification "success" means "in-app row
 * persisted", not "user reached" — it even returns success:true when no row
 * exists at all (inAppEnabled false). Callers that count success overstate
 * delivery (weekly summary, SOS). The fix returns a delivered breakdown
 * (in-app / push / email / emailQueued) on every return path so callers can
 * count actual reach.
 */

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
    sendPushNotificationsAsync: jest.fn().mockResolvedValue([{ status: 'ok' }]),
  }));
  Expo.isExpoPushToken = jest.fn().mockReturnValue(true);
  return { Expo };
});
jest.mock('../utils/emailTemplate', () => ({
  renderOxSteedEmail: jest.fn(() => ({ html: '<p>synthetic</p>', text: 'synthetic' })),
}));

const db = require('../db');
const { sendEmail } = require('../utils/email');
const { sendNotification } = require('../services/notificationService');

const basePrefs = {
  email: 'customer@example.invalid',
  first_name: 'Casey',
  is_banned: false,
  preferred_language: 'en',
  push_notifications: true,
  web_push_enabled: false,
  quiet_hours_enabled: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  sendEmail.mockResolvedValue({ success: true, id: 'synthetic-email' });
});

function mockPrefsAndRow(prefsOverrides = {}, row = { id: 'notif-1' }) {
  db.query
    .mockResolvedValueOnce({ rows: [{ ...basePrefs, ...prefsOverrides }] })
    .mockResolvedValueOnce({ rows: [row] })
    .mockResolvedValue({ rows: [], rowCount: 0 });
}

describe('item 19: delivered breakdown', () => {
  // Item 19 test type: a synthetic type that is in no email allow-list,
  // so the send is in-app-only. (weekly_summary used to serve here, but
  // item 9 added it to emailTypes, so it emails now.)
  test('in-app-only send reports inApp:true and every other channel false', async () => {
    mockPrefsAndRow();
    const result = await sendNotification({
      userId: 'customer-1',
      type: 'item19_in_app_only',
      title: 'Weekly summary',
      body: 'This week: $0 earned MTD',
      idempotencyKey: 'item19:in-app-only',
    });
    expect(result.notificationId).toBe('notif-1');
    expect(result.delivered).toEqual({ inApp: true, push: false, email: false, emailQueued: false });
  });

  test('success:true with in-app opted out reports inApp:false and no row id', async () => {
    // Audit sharpening: success:true is returned even when no row exists at
    // all because inAppEnabled is false. The breakdown must say so.
    mockPrefsAndRow({ in_app_item19_in_app_only: false }, null);
    // No row: the INSERT returns no rows and there is no delivery key
    // collision to resolve, so sendNotification throws inside and the
    // catch-all returns success:false. Use a keyed dedupe-free path by
    // letting the insert return nothing and no existing row.
    db.query.mockReset();
    db.query
      .mockResolvedValueOnce({ rows: [{ ...basePrefs, in_app_item19_in_app_only: false }] })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const result = await sendNotification({
      userId: 'customer-1',
      type: 'item19_in_app_only',
      title: 'Weekly summary',
      body: 'This week: $0 earned MTD',
      idempotencyKey: 'item19:in-app-off',
    });
    // No channel reached the user; the breakdown must not claim otherwise.
    expect(result.delivered).toEqual({ inApp: false, push: false, email: false, emailQueued: false });
    expect(result.notificationId).toBeNull();
  });

  test('Expo push ack reports push:true', async () => {
    mockPrefsAndRow();
    const result = await sendNotification({
      userId: 'customer-1',
      type: 'weekly_summary',
      title: 'Weekly summary',
      body: 'This week: $0 earned MTD',
      pushToken: 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]',
      idempotencyKey: 'item19:expo-push',
    });
    expect(result.delivered.push).toBe(true);
    expect(result.delivered.inApp).toBe(true);
  });

  test('failed realtime email reports email:false while inApp stays true', async () => {
    mockPrefsAndRow();
    sendEmail.mockResolvedValueOnce({ success: false, error: 'Resend outage' });
    const result = await sendNotification({
      userId: 'customer-1',
      type: 'payment_failed',
      title: 'Payment failed',
      body: 'Your payment could not be processed.',
      idempotencyKey: 'item19:email-failed',
    });
    expect(result.success).toBe(false);
    expect(result.delivered).toEqual({ inApp: true, push: false, email: false, emailQueued: false });
  });
});
