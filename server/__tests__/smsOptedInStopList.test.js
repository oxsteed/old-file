'use strict';

/**
 * Item 14 support: sendSMSIfOptedIn is the shared SMS opt-in gate the
 * calendar SMS leg now routes through. It must honour the sms_opt_outs
 * STOP list, and its per-type check must tolerate notification types with
 * no sms_* column (calendar types have none yet) instead of throwing and
 * refusing every send for that type.
 */

const { mockQuery, resetMocks } = require('./setup');
const { sendSMSIfOptedIn } = require('../services/smsNotificationService');

beforeEach(() => {
  jest.clearAllMocks();
  resetMocks();
});

const verifiedUser = {
  phone_number: '+15551234567', phone_e164: '+15551234567',
  phone_verified: true, sms_enabled: true, sms_notifications: true,
};

describe('item 14: sendSMSIfOptedIn STOP list and per-type tolerance', () => {
  test('a STOP-listed phone is refused before any send', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [verifiedUser] })
      .mockResolvedValueOnce({ rows: [{ '1': 1 }] }); // sms_opt_outs hit
    const result = await sendSMSIfOptedIn('cust-1', 'Reminder text', 'reminder_24h');
    expect(result).toBe(false);
    expect(mockQuery.mock.calls.length).toBe(2);
    expect(mockQuery.mock.calls[1][0]).toContain('sms_opt_outs');
  });

  test('a calendar type with no sms_* column still sends (absent means allowed)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [verifiedUser] })
      .mockResolvedValueOnce({ rows: [] }) // no STOP row
      .mockResolvedValueOnce({ rows: [{}] }) // np.* — no sms_reminder_24h value
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // rate limit
      .mockResolvedValue({ rows: [], rowCount: 0 }); // sms_logs insert
    const result = await sendSMSIfOptedIn('cust-1', 'Reminder text', 'reminder_24h');
    expect(result).toBe(true);
  });

  test('a STOP-listed phone in national format is refused (digits-normalized)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...verifiedUser, phone_number: '(555) 123-4567', phone_e164: null }] })
      .mockResolvedValueOnce({ rows: [{ '1': 1 }] });
    const result = await sendSMSIfOptedIn('cust-1', 'Reminder text', 'reminder_24h');
    expect(result).toBe(false);
    // The STOP lookup checks both the raw digits and the E.164 digits.
    expect(mockQuery.mock.calls[1][1][0]).toEqual(expect.arrayContaining(['5551234567', '15551234567']));
  });
});
