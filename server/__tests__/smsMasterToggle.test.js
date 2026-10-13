'use strict';

/**
 * smsMasterToggle.test.js
 *
 * Review P2-8-F05: the sms_notifications master toggle must be honored in
 * the SMS send path. sendSMSIfOptedIn already honors the per-page
 * sms_enabled switch; the master toggle is an additional kill-switch.
 */

const { mockQuery, resetMocks } = require('./setup');
const { sendSMSIfOptedIn } = require('../services/smsNotificationService');

const USER_ROW = {
  phone_number: '+15551234567',
  phone_e164: '+15551234567',
  phone_verified: true,
  sms_enabled: true,
  sms_notifications: true,
};

function mockSendPath(userRow) {
  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('FROM users u')) return { rows: [{ ...userRow }] };
    if (text.includes('FROM notification_preferences WHERE user_id')) return { rows: [] };
    if (text.includes('FROM sms_logs')) return { rows: [{ count: '0' }] };
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => resetMocks());

describe('sms_notifications master toggle', () => {
  test('SMS sends when both sms_enabled and sms_notifications are on', async () => {
    mockSendPath(USER_ROW);
    const ok = await sendSMSIfOptedIn('user-1', 'hello', 'order_created');
    expect(ok).toBe(true);
    const insert = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO sms_logs'));
    expect(insert).toBeDefined();
  });

  test('sms_notifications=false blocks SMS even when sms_enabled is on', async () => {
    mockSendPath({ ...USER_ROW, sms_notifications: false });
    const ok = await sendSMSIfOptedIn('user-1', 'hello', 'order_created');
    expect(ok).toBe(false);
    const insert = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO sms_logs'));
    expect(insert).toBeUndefined();
  });

  test('sms_enabled=false still blocks SMS (existing behavior preserved)', async () => {
    mockSendPath({ ...USER_ROW, sms_enabled: false });
    const ok = await sendSMSIfOptedIn('user-1', 'hello', 'order_created');
    expect(ok).toBe(false);
  });
});
