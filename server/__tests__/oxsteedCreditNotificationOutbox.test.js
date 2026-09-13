'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));
jest.mock('../jobs/jobLockingService', () => ({
  withJobLock: jest.fn(async (_jobName, handler) => handler()),
}));
jest.mock('../jobs/oxsteedCreditJobFailure', () => ({
  recordOxsteedCreditJobFailure: jest.fn(),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ persisted: true }),
}));

const db = require('../db');
const { sendNotification } = require('../services/notificationService');
const { withJobLock } = require('../jobs/jobLockingService');
const { recordIncident } = require('../services/incidentStore');
const {
  CRON_EXPRESSION,
  JOB_NAME,
  buildNotification,
  finishCreditNotification,
  processOxsteedCreditNotificationOutbox,
  runOxsteedCreditNotificationOutbox,
} = require('../jobs/oxsteedCreditNotificationOutbox');

beforeEach(() => {
  jest.clearAllMocks();
});

test('builds a safe customer-facing notification from an outbox payload', () => {
  expect(buildNotification({
    transactionId: 'tx-1',
    transactionType: 'purchase',
    direction: 'debit',
    amountCents: 1250,
    currencyCode: 'USD',
    partnerId: '41',
  })).toMatchObject({
    title: 'OxSteed Credit activity',
    body: 'You spent USD 12.50 in OxSteed Credit (purchase).',
    action_url: '/oxsteed-credit',
    data: expect.objectContaining({ creditTransactionId: 'tx-1', amountCents: 1250 }),
  });
});

test('builds a customer-facing notification for a hold lifecycle event', () => {
  expect(buildNotification({
    eventType: 'hold_released',
    holdId: 'hold-1',
    amountCents: 1250,
    currencyCode: 'USD',
    status: 'released',
  })).toEqual(expect.objectContaining({
    title: 'OxSteed Credit reservation released',
    body: expect.stringContaining('USD 12.50'),
    data: expect.objectContaining({ creditHoldId: 'hold-1', eventType: 'hold_released' }),
  }));
});

test('delivers claimed Credit events and marks them sent', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ id: 'event-1', user_id: 'user-1', attempts: 1, payload: {
      transactionId: 'tx-1', transactionType: 'load', direction: 'credit', amountCents: 500, currencyCode: 'USD',
    } }] })
    .mockResolvedValueOnce({ rows: [] });
  sendNotification.mockResolvedValueOnce({ success: true, notificationId: 'notification-1' });

  await expect(processOxsteedCreditNotificationOutbox()).resolves.toEqual({ claimed: 1, sent: 1, retried: 0, failed: 0 });
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'user-1',
    type: 'oxsteed_credit_transaction',
    action_url: '/oxsteed-credit',
  }));
  expect(db.query.mock.calls[1][0]).toContain("SET status = $1");
  expect(db.query.mock.calls[1][1][0]).toBe('sent');
});

test('retries delivery failures and eventually marks the event failed', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ id: 'event-2', user_id: 'user-2', attempts: 8, payload: {
    transactionId: 'tx-2', transactionType: 'purchase', direction: 'debit', amountCents: 900, currencyCode: 'USD',
  } }] }).mockResolvedValueOnce({ rows: [] });
  sendNotification.mockResolvedValueOnce({ success: false, error: 'provider unavailable' });

  await expect(processOxsteedCreditNotificationOutbox()).resolves.toEqual({ claimed: 1, sent: 0, retried: 0, failed: 1 });
  expect(db.query.mock.calls[1][1].slice(0, 2)).toEqual(['failed', 'provider unavailable']);
  expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'oxsteed_credit_notification_delivery_failed',
    severity: 'critical',
    dedupeKey: 'oxsteed-credit-notifications:terminal-failure',
  }));
});

test('runs under the distributed Credit worker lock', async () => {
  db.query.mockResolvedValueOnce({ rows: [] });

  await expect(runOxsteedCreditNotificationOutbox()).resolves.toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0 });
  expect(withJobLock).toHaveBeenCalledWith(JOB_NAME, expect.any(Function), 120, { throwOnLockError: true });
  expect(CRON_EXPRESSION).toBe('* * * * *');
});
