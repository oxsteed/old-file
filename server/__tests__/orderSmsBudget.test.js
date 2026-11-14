'use strict';

/**
 * Notifications audit item 32: order SMS has a mock-sent fallback
 * (sendTwilioSMS returns {sid:'mock_sid'} when no Twilio client is
 * configured, and the caller believes an SMS was sent) and a shared
 * 2-per-order-per-day budget that silently drops later lifecycle events.
 * Order SMS must use sendConfiguredSMS (throws when unconfigured), the
 * budget must be per event type, and a budget drop must be logged.
 */

const { mockQuery, resetMocks } = require('./setup');
const { sendOrderCreatedSMS, sendOrderCancelledSMS } = require('../services/smsNotificationService');

const verifiedUser = {
  phone_number: '+15551234567', phone_e164: '+15551234567',
  phone_verified: true, sms_enabled: true, sms_notifications: true,
};

function mockHappyPath({ budgetRows = [{ reserved: 1 }] } = {}) {
  mockQuery
    .mockResolvedValueOnce({ rows: [verifiedUser] }) // user + prefs
    .mockResolvedValueOnce({ rows: [] }) // no STOP row
    .mockResolvedValueOnce({ rows: [{}] }) // np.* — sms_order_created allowed
    .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // rate limit
    .mockResolvedValueOnce({ rows: budgetRows }) // budget reservation
    .mockResolvedValue({ rows: [], rowCount: 0 }); // sms_logs insert
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMocks();
});

describe('item 32: order SMS never mock-sends', () => {
  test('an unconfigured provider fails the order SMS instead of returning mock_sid', async () => {
    mockHappyPath();
    const result = await sendOrderCreatedSMS('user-1', 'ord-1', 2500);
    expect(result).toBe(false);
    // No SMS was sent, so no sms_logs row may claim one was.
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO sms_logs'))).toBe(false);
    // Item 51: the failure is definitive (nothing was attempted), so the
    // budget reservation must be released instead of burning a slot.
    const releaseCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE order_sms_budgets'));
    expect(releaseCall).toBeDefined();
    expect(releaseCall[1]).toEqual(['user-1', 'ord-1:order_created']);
  });

  test('the budget is keyed per event type, not shared across the order', async () => {
    mockHappyPath();
    await sendOrderCreatedSMS('user-1', 'ord-1', 2500);
    const budgetCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO order_sms_budgets'));
    expect(budgetCall[1]).toEqual(['user-1', 'ord-1:order_created']);

    jest.clearAllMocks();
    resetMocks();
    mockHappyPath();
    await sendOrderCancelledSMS('user-1', 'ord-1');
    const cancelBudgetCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO order_sms_budgets'));
    expect(cancelBudgetCall[1]).toEqual(['user-1', 'ord-1:order_cancelled']);
  });

  test('an exhausted budget is logged, not silently dropped', async () => {
    const logger = require('../utils/logger');
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      mockHappyPath({ budgetRows: [] }); // reservation refused: budget spent
      const result = await sendOrderCreatedSMS('user-1', 'ord-1', 2500);
      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('budget'),
        expect.objectContaining({ userId: 'user-1', notificationType: 'order_created' })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
