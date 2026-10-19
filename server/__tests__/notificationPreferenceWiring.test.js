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

test('an email-only metric alert creates no in-app row and sends no push', async () => {
  mockPrefs({});
  sendEmail.mockResolvedValue({ success: true });
  const result = await sendNotification({ userId: 'u1', type: 'metric_threshold_alert', body: 'Threshold crossed',
    emailChannel: true, inAppChannel: false, pushChannel: false, idempotencyKey: 'email-only-metric' });
  expect(result.success).toBe(true);
  expect(insertCalls()).toHaveLength(0);
  expect(webPushService.sendToUser).not.toHaveBeenCalled();
  expect(mobilePushService.sendToUser).not.toHaveBeenCalled();
  expect(sendEmail).toHaveBeenCalledTimes(1);
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

describe('P2-8-F04 email_frequency honored by the realtime path', () => {
  function digestQueueCalls() {
    return db.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO email_digest_queue'));
  }

  test("email_frequency='off' suppresses non-transactional realtime email", async () => {
    mockPrefs({ email_frequency: 'off' });
    await sendNotification({ userId: 'u1', type: 'new_message', title: 't', body: 'b' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(digestQueueCalls()).toHaveLength(0);
  });

  test("email_frequency='off' still sends transactional email", async () => {
    mockPrefs({ email_frequency: 'off' });
    await sendNotification({ userId: 'u1', type: 'account_banned', title: 't', body: 'b' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test("email_frequency='daily' queues for the digest instead of sending", async () => {
    mockPrefs({ email_frequency: 'daily' });
    await sendNotification({ userId: 'u1', type: 'new_message', title: 't', body: 'b' });
    expect(sendEmail).not.toHaveBeenCalled();
    const queued = digestQueueCalls();
    expect(queued).toHaveLength(1);
    expect(queued[0][1]).toEqual(['u1', 'n1', 'daily']);
  });

  test("email_frequency='weekly' queues for the digest instead of sending", async () => {
    mockPrefs({ email_frequency: 'weekly' });
    await sendNotification({ userId: 'u1', type: 'new_message', title: 't', body: 'b' });
    expect(sendEmail).not.toHaveBeenCalled();
    const queued = digestQueueCalls();
    expect(queued).toHaveLength(1);
    expect(queued[0][1]).toEqual(['u1', 'n1', 'weekly']);
  });

  test('real-time (default) sends email immediately and queues nothing', async () => {
    mockPrefs({});
    await sendNotification({ userId: 'u1', type: 'new_message', title: 't', body: 'b' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(digestQueueCalls()).toHaveLength(0);
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

describe('P2-8-F03 removed dead toggles stay rejected by the API', () => {
  // The server whitelist dropped in_app_message_mention, push_message_mention
  // and push_new_job_nearby (no such events are ever emitted); the settings
  // UI no longer offers them. The API must keep rejecting them so a stale
  // client cannot write dead preference rows.
  const { updatePreferences } = require('../controllers/notificationController');
  test('updatePreferences 400s when only dead keys are sent', async () => {
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await updatePreferences(
      {
        user: { id: 'u1' },
        body: { in_app_message_mention: false, push_message_mention: true, push_new_job_nearby: false },
      },
      res,
      next
    );
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('updatePreferences still accepts every live toggle', async () => {
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    db.query.mockResolvedValue({ rows: [{ user_id: 'u1' }] });
    await updatePreferences(
      {
        user: { id: 'u1' },
        body: { in_app_new_bid: false, push_new_bid: true, email_weekly_summary: false },
      },
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    const update = db.query.mock.calls.find(([sql]) => /UPDATE|INSERT INTO notification_preferences/.test(String(sql)));
    expect(update).toBeDefined();
  });
});
