'use strict';

// Email-leg verification for the new shared-path notice types (items 53/54):
// each type must be in notificationService emailTypes so the in-app row is
// not the only leg. The in-app leg is covered by the per-surface tests;
// this file pins the email leg through the real sendNotification.

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
  email: 'user@example.com',
  first_name: 'A',
  is_banned: false,
  preferred_language: 'en',
  push_notifications: true,
  quiet_hours_enabled: false,
};

function mockPrefs(prefs = {}) {
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  db.query
    .mockResolvedValueOnce({ rows: [{ ...BASE_PREFS, ...prefs }] })
    .mockResolvedValueOnce({ rows: [{ id: 'n1', is_push_sent: false, is_email_sent: false }] });
}

beforeEach(() => {
  jest.clearAllMocks();
  sendEmail.mockResolvedValue({ success: true });
});

test('consulting_session_scheduled reaches email (item 53)', async () => {
  mockPrefs();
  const result = await sendNotification({
    userId: 'consultant-1',
    type: 'consulting_session_scheduled',
    data: { session_id: 1, scheduled_session_id: 99 },
    action_url: '/consulting/contractor-dashboard',
    emailChannel: true,
    inAppChannel: false,
    pushChannel: false,
    idempotencyKey: 'consulting-session-scheduled:1',
  });
  expect(result.success).toBe(true);
  expect(sendEmail).toHaveBeenCalledTimes(1);
});
