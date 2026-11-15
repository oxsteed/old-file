'use strict';

// Notifications audit item 39 (email half): customer360_attention appears
// nowhere in notificationService.js, so the attention alerts never email.
// Reproduction: sendNotification for the type never reaches sendEmail.

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

const db = require('../db');
const { sendEmail } = require('../utils/email');
const { sendNotification } = require('../services/notificationService');

const BASE_PREFS = {
  email: 'admin@example.com',
  first_name: 'A',
  is_banned: false,
  preferred_language: 'en',
  push_notifications: true,
  quiet_hours_enabled: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  db.query
    .mockResolvedValueOnce({ rows: [{ ...BASE_PREFS }] })
    .mockResolvedValueOnce({ rows: [{ id: 'n1', is_push_sent: false, is_email_sent: false }] });
  sendEmail.mockResolvedValue({ success: true });
});

test('customer360_attention reaches email', async () => {
  const result = await sendNotification({
    userId: 'admin-1',
    type: 'customer360_attention',
    body: '3 anomalies were held back by the per-tick cap.',
    emailChannel: true,
    inAppChannel: false,
    pushChannel: false,
    idempotencyKey: 'customer360-digest:admin-1:12345',
  });
  expect(result.success).toBe(true);
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
    to: 'admin@example.com',
  }));
});

test('customer360_attention respects email_notifications=false', async () => {
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  db.query
    .mockResolvedValueOnce({ rows: [{ ...BASE_PREFS, email_notifications: false }] })
    .mockResolvedValueOnce({ rows: [{ id: 'n1', is_push_sent: false, is_email_sent: false }] });
  await sendNotification({
    userId: 'admin-1',
    type: 'customer360_attention',
    body: '3 anomalies were held back by the per-tick cap.',
    emailChannel: true,
    inAppChannel: false,
    pushChannel: false,
    idempotencyKey: 'customer360-digest:admin-1:12346',
  });
  expect(sendEmail).not.toHaveBeenCalled();
});
