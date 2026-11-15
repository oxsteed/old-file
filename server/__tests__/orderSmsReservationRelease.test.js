'use strict';

/**
 * Notifications audit item 51: a failed SMS send burns one of the two
 * daily order-SMS budget slots — the reservation insert runs before the
 * send, and a definitive failure keeps the slot consumed. Release the
 * reservation when the send definitively failed; keep it only for
 * genuinely uncertain outcomes (transport errors where the provider may
 * still have accepted the message).
 */

// Fake Twilio client whose behaviour each test controls.
const mockCreate = jest.fn();
jest.mock('twilio', () => jest.fn(() => ({ messages: { create: mockCreate } })));

process.env.TWILIO_ACCOUNT_SID = 'AC-test';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_PHONE_NUMBER = '+15550000000';

const { mockQuery, resetMocks } = require('./setup');
const { sendOrderCreatedSMS } = require('../services/smsNotificationService');

const verifiedUser = {
  phone_number: '+15551234567', phone_e164: '+15551234567',
  phone_verified: true, sms_enabled: true, sms_notifications: true,
};

function mockHappyPath() {
  mockQuery
    .mockResolvedValueOnce({ rows: [verifiedUser] }) // user + prefs
    .mockResolvedValueOnce({ rows: [] }) // no STOP row
    .mockResolvedValueOnce({ rows: [{}] }) // np.* — sms_order_created allowed
    .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // rate limit
    .mockResolvedValueOnce({ rows: [{ reserved: 1 }] }) // budget reservation
    .mockResolvedValue({ rows: [], rowCount: 0 });
}

function releaseCalls() {
  return mockQuery.mock.calls.filter(([sql]) => String(sql).includes('UPDATE order_sms_budgets'));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMocks();
  mockCreate.mockResolvedValue({ sid: 'SM-test', status: 'queued' });
});

describe('item 51: failed order SMS releases its budget slot', () => {
  test('a definitive provider rejection releases the reservation', async () => {
    const apiError = new Error('Invalid phone number');
    apiError.status = 400;
    apiError.code = 21211;
    mockCreate.mockRejectedValueOnce(apiError);
    mockHappyPath();
    const result = await sendOrderCreatedSMS('user-1', 'ord-1', 2500);
    expect(result).toBe(false);
    expect(releaseCalls()).toHaveLength(1);
    expect(releaseCalls()[0][1]).toEqual(['user-1', 'ord-1:order_created']);
  });

  test('an uncertain transport failure keeps the reservation', async () => {
    const transportError = new Error('socket hang up');
    transportError.code = 'ECONNRESET';
    mockCreate.mockRejectedValueOnce(transportError);
    mockHappyPath();
    const result = await sendOrderCreatedSMS('user-1', 'ord-1', 2500);
    expect(result).toBe(false);
    // The message may have been accepted before the socket died; the slot
    // stays consumed so a retry cannot double-send past the cap.
    expect(releaseCalls()).toHaveLength(0);
  });

  test('a successful send keeps the reservation', async () => {
    mockHappyPath();
    const result = await sendOrderCreatedSMS('user-1', 'ord-1', 2500);
    expect(result).toBe(true);
    expect(releaseCalls()).toHaveLength(0);
  });
});
