'use strict';

/**
 * P3-3-F13: a template-render failure inside sendNotification used to be
 * swallowed — the outer call returned { success: true } and outbox workers
 * marked the row sent while the email was silently lost. An attempted
 * realtime email that fails must propagate { success: false } so the row is
 * retried, not marked sent.
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
  Expo.isExpoPushToken = jest.fn().mockReturnValue(false);
  return { Expo };
});
jest.mock('../utils/emailTemplate', () => ({
  renderOxSteedEmail: jest.fn(() => ({ html: '<p>synthetic</p>', text: 'synthetic' })),
}));

const db = require('../db');
const { sendEmail } = require('../utils/email');
const { renderOxSteedEmail } = require('../utils/emailTemplate');
const { sendNotification } = require('../services/notificationService');

const prefs = {
  email: 'customer@example.invalid',
  first_name: 'Casey',
  is_banned: false,
  preferred_language: 'en',
  in_app_payment_failed: true,
  push_payment_failed: true,
  email_payment_failed: true,
  web_push_enabled: false,
  quiet_hours_enabled: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  sendEmail.mockResolvedValue({ success: true, id: 'synthetic-email' });
  renderOxSteedEmail.mockImplementation(() => ({ html: '<p>synthetic</p>', text: 'synthetic' }));
});

function mockPrefsAndRow() {
  db.query
    .mockResolvedValueOnce({ rows: [{ ...prefs }] })
    .mockResolvedValueOnce({ rows: [{ id: 'notif-1' }] })
    .mockResolvedValue({ rows: [], rowCount: 0 });
}

function emailMarkedSent() {
  return db.query.mock.calls.some(([sql]) => sql.includes('SET is_email_sent = true'));
}

describe('P3-3-F13: realtime email failure propagates', () => {
  test('provider failure returns success:false and never marks email sent', async () => {
    mockPrefsAndRow();
    sendEmail.mockResolvedValueOnce({ success: false, error: 'Resend outage' });

    const result = await sendNotification({
      userId: 'customer-1',
      type: 'payment_failed',
      title: 'Payment failed',
      body: 'Your payment could not be processed.',
      idempotencyKey: 'p3-3-f13:provider-failure',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Resend outage/);
    expect(result.notificationId).toBe('notif-1');
    expect(emailMarkedSent()).toBe(false);
  });

  test('template render failure returns success:false and never marks email sent', async () => {
    mockPrefsAndRow();
    renderOxSteedEmail.mockImplementationOnce(() => { throw new Error('template exploded'); });

    const result = await sendNotification({
      userId: 'customer-1',
      type: 'payment_failed',
      title: 'Payment failed',
      body: 'Your payment could not be processed.',
      idempotencyKey: 'p3-3-f13:render-failure',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/template exploded/);
    expect(emailMarkedSent()).toBe(false);
  });

  test('unconfigured provider in non-production stays success:true (dev tolerance)', async () => {
    mockPrefsAndRow();
    sendEmail.mockResolvedValueOnce({ success: false, error: 'Email not configured', code: 'email_not_configured' });

    const result = await sendNotification({
      userId: 'customer-1',
      type: 'payment_failed',
      title: 'Payment failed',
      body: 'Your payment could not be processed.',
      idempotencyKey: 'p3-3-f13:dev-no-provider',
    });

    expect(result.success).toBe(true);
  });

  test('successful email still marks sent and returns success:true', async () => {
    mockPrefsAndRow();

    const result = await sendNotification({
      userId: 'customer-1',
      type: 'payment_failed',
      title: 'Payment failed',
      body: 'Your payment could not be processed.',
      idempotencyKey: 'p3-3-f13:success',
    });

    expect(result).toEqual({ success: true, notificationId: 'notif-1' });
    expect(emailMarkedSent()).toBe(true);
  });
});
