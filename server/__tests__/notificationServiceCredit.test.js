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
const { sendEmail } = require('../utils/email');

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
  sendEmail.mockResolvedValue({ success: true, id: 'synthetic-email' });
});

test('failed security email remains retryable and never marks email sent', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ ...prefs, email: 'test@example.invalid' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'security-notice' }] });
  sendEmail.mockResolvedValueOnce({ success: false });
  const result = await sendNotification({ userId: 'customer-1', type: 'oxsteed_credit_card_security', idempotencyKey: 'credit-outbox:1' });
  expect(result.success).toBe(false);
  expect(db.query.mock.calls.some(([sql]) => sql.includes('SET is_email_sent = true'))).toBe(false);
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

// W10.5: prove the real notification service creates a localized row and email,
// rather than accepting a mocked emitter with missing title/body templates.
describe('W10.5 lifecycle delivery', () => {
  const types = ['dispute_update', 'subscription_renewed', 'subscription_cancelled', 'subscription_past_due', 'payment_failed'];
  const languages = ['en', 'es', 'fr', 'ht', 'ar'];
  test.each(languages.flatMap((lang) => types.map((type) => [lang, type])))('%s %s delivers matching catalog copy', async (lang, type) => {
    const legacy = require(`../../client/src/locales/${lang}.json`).reviewLifecycleNotifications[type];
    const namespaced = require(`../../client/src/i18n/locales/${lang}/common.json`).reviewLifecycleNotifications[type];
    expect(namespaced).toEqual(legacy);
    expect(require('../utils/i18n').tNotif(type, lang)).toEqual(legacy);
    db.query.mockImplementation(async (sql) => {
      if (/SELECT np\.\*/.test(sql)) return { rows: [{ ...prefs, email: 'synthetic@example.invalid', preferred_language: lang }] };
      if (/INSERT INTO notifications/.test(sql)) return { rows: [{ id: 'lifecycle-notice' }] };
      return { rows: [] };
    });
    expect(await sendNotification({ userId: 'customer', type, action_url: '/support', idempotencyKey: `synthetic:${lang}:${type}` }))
      .toMatchObject({ success: true });
    const insert = db.query.mock.calls.find(([sql]) => /INSERT INTO notifications/.test(sql));
    expect(insert[1][2]).toBe(legacy.title); expect(insert[1][3]).toBe(legacy.body);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: legacy.title, idempotencyKey: `synthetic:${lang}:${type}` }));
    if (lang === 'ar') expect(sendEmail.mock.calls[0][0].html).toMatch(/dir="rtl"/);
  });
});

describe('W11 warranty and job-start delivery', () => {
  const types = ['warranty_claim_filed', 'warranty_claim_updated', 'job_started'];
  test.each(['en', 'es', 'fr', 'ht', 'ar'].flatMap(lang => types.map(type => [lang, type])))('%s %s uses actual localized notification and email', async (lang, type) => {
    const legacy = require(`../../client/src/locales/${lang}.json`).reviewW11Notifications[type];
    expect(require(`../../client/src/i18n/locales/${lang}/common.json`).reviewW11Notifications[type]).toEqual(legacy);
    expect(require('../utils/i18n').tNotif(type, lang)).toEqual(legacy);
    db.query.mockImplementation(async sql => {
      if (/SELECT np\.\*/.test(sql)) return { rows: [{ ...prefs, email: 'synthetic@example.invalid', preferred_language: lang }] };
      if (/INSERT INTO notifications/.test(sql)) return { rows: [{ id: 'w11-notice' }] };
      return { rows: [] };
    });
    const key = `w11-fixture:${lang}:${type}`;
    expect(await sendNotification({ userId: 'participant', type, action_url: '/agreements/synthetic', idempotencyKey: key })).toMatchObject({ success: true });
    const insert = db.query.mock.calls.find(([sql]) => /INSERT INTO notifications/.test(sql));
    expect(insert[1][2]).toBe(legacy.title);
    expect(insert[1][3]).toBe(legacy.body);
    expect(insert[1][6]).toBe(key);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: legacy.title, idempotencyKey: key }));
    expect(sendEmail.mock.calls[0][0].html).toContain(legacy.body);
    if (lang === 'ar') expect(sendEmail.mock.calls[0][0].html).toContain('dir="rtl"');
  });
  test.each(types)('%s respects disabled email preferences', async type => {
    db.query.mockResolvedValueOnce({ rows: [{ ...prefs, email: 'synthetic@example.invalid', email_notifications: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'w11-optout-notice' }] });
    expect(await sendNotification({ userId: 'participant', type, idempotencyKey: `w11-optout:${type}` })).toMatchObject({ success: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
