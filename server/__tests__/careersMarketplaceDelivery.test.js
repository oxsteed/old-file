'use strict';

// Domain 8 #23: careers deliver() reports push/SMS delivered before the
// sends complete. The flags were set to true before the fire-and-forget
// sends ran, so a failed push and a failed SMS both came back reported
// as delivered. These tests pin the honest contract: push/sms are true
// only when the send actually resolved successfully.

jest.mock('../services/careers/notify', () => ({
  notifyUser: jest.fn(),
  render: jest.fn(() => ({ title: 'New candidates', body: '3 new candidates' })),
}));
jest.mock('../services/careers/providers/config', () => ({
  smsConfig: jest.fn(() => ({ enabled: true })),
}));
jest.mock('../utils/pushNotification', () => ({
  sendPushToUser: jest.fn(),
}));
jest.mock('../services/mobilePushService', () => ({
  isConfigured: jest.fn(() => false),
  sendToUser: jest.fn(),
}));
jest.mock('../services/smsNotificationService', () => ({
  sendSMSIfOptedIn: jest.fn(),
}));

const { notifyUser } = require('../services/careers/notify');
const { sendPushToUser } = require('../utils/pushNotification');
const mobilePush = require('../services/mobilePushService');
const { sendSMSIfOptedIn } = require('../services/smsNotificationService');
const { deliver } = require('../services/careers/marketplace/delivery');

const db = {
  query: jest.fn(async (sql) => {
    if (String(sql).includes('sms_opt_in')) return { rows: [{ sms_opt_in: true }] };
    if (String(sql).includes('preferred_language')) return { rows: [{ preferred_language: 'en' }] };
    return { rows: [] };
  }),
};

beforeEach(() => {
  jest.clearAllMocks();
  notifyUser.mockResolvedValue({ inserted: true, notificationId: 'n1' });
  sendPushToUser.mockResolvedValue([{ id: 1, success: true }]);
  mobilePush.isConfigured.mockReturnValue(false);
  mobilePush.sendToUser.mockResolvedValue({ sent: 1, failed: 0, skipped: 0 });
  sendSMSIfOptedIn.mockResolvedValue(true);
});

test('push is false when the web push throws and mobile is not configured', async () => {
  sendPushToUser.mockRejectedValueOnce(new Error('vapid down'));
  const result = await deliver(db, {
    userId: 'u1',
    type: 'career_candidate_alert',
    params: { count: 3 },
    deliveryKey: 'career_cand_alert:9:2026-11-13T10',
    channels: ['in_app', 'email', 'push'],
  });
  expect(result.push).toBe(false);
});

test('sms is false when the SMS send reports failure', async () => {
  sendSMSIfOptedIn.mockResolvedValueOnce(false);
  const result = await deliver(db, {
    userId: 'u1',
    type: 'career_candidate_alert',
    params: { count: 3 },
    deliveryKey: 'career_cand_alert:9:2026-11-13T10',
    channels: ['in_app', 'email', 'sms'],
  });
  expect(result.sms).toBe(false);
});

test('push and sms are true when both sends succeed, with a per-event tag', async () => {
  const result = await deliver(db, {
    userId: 'u1',
    type: 'career_candidate_alert',
    params: { count: 3 },
    deliveryKey: 'career_cand_alert:9:2026-11-13T10',
    channels: ['in_app', 'email', 'push', 'sms'],
  });
  expect(result.push).toBe(true);
  expect(result.sms).toBe(true);
  expect(sendPushToUser).toHaveBeenCalledWith(
    'u1',
    expect.objectContaining({ tag: 'careers:career_cand_alert:9:2026-11-13T10' })
  );
});

test('push is true when mobile push succeeds even with no web subscription', async () => {
  sendPushToUser.mockResolvedValueOnce([]);
  mobilePush.isConfigured.mockReturnValue(true);
  const result = await deliver(db, {
    userId: 'u1',
    type: 'career_candidate_alert',
    params: { count: 3 },
    deliveryKey: 'career_cand_alert:9:2026-11-13T10',
    channels: ['in_app', 'email', 'push'],
  });
  expect(result.push).toBe(true);
  expect(mobilePush.sendToUser).toHaveBeenCalledWith(
    'u1',
    expect.objectContaining({ data: expect.objectContaining({ tag: 'careers:career_cand_alert:9:2026-11-13T10' }) })
  );
});

test('a duplicate delivery key sends nothing and reports both channels false', async () => {
  notifyUser.mockResolvedValueOnce({ inserted: false, notificationId: 'n1' });
  const result = await deliver(db, {
    userId: 'u1',
    type: 'career_candidate_alert',
    params: { count: 3 },
    deliveryKey: 'career_cand_alert:9:2026-11-13T10',
    channels: ['in_app', 'email', 'push', 'sms'],
  });
  expect(result.push).toBe(false);
  expect(result.sms).toBe(false);
  expect(sendPushToUser).not.toHaveBeenCalled();
  expect(sendSMSIfOptedIn).not.toHaveBeenCalled();
});
