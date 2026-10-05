'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/oxsteedCreditCardRecovery', () => ({ processReplacementRequests: jest.fn().mockResolvedValue({ ready: 0 }) }));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));
jest.mock('../jobs/jobLockingService', () => {
  // E03: fenced lock mock. The fence is healthy by default; db calls pass
  // through to the (mocked) db module so job logic is exercised.
  const fence = {
    isActive: () => true,
    assertActive: () => {},
    db: {
      query: (...args) => require('../db').query(...args),
      tx: (work) => work({ query: (...args) => require('../db').query(...args) }),
    },
    fencedQuery: (...args) => require('../db').query(...args),
    fencedTransaction: (work) => work({ query: (...args) => require('../db').query(...args) }),
  };
  return {
    withJobLock: jest.fn(async (_jobName, handler) => handler(fence)),
    withFencedJobLock: jest.fn(async (_jobName, handler) => handler(fence)),
    LeaseLostError: class LeaseLostError extends Error {},
  };
});
jest.mock('../jobs/oxsteedCreditJobFailure', () => ({
  recordOxsteedCreditJobFailure: jest.fn(),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ persisted: true }),
}));
jest.mock('../services/oxsteedCreditWorkerHeartbeat', () => ({
  recordOxsteedCreditWorkerRun: jest.fn().mockResolvedValue({ persisted: true }),
}));

jest.mock('../services/oxsteedCreditService', () => {
  // Rail guard pinned to "enabled": these suites exercise job logic, not the
  // rail-disabled skip path (covered in oxsteedCreditRailDisabled.test.js).
  const actual = jest.requireActual('../services/oxsteedCreditService');
  return { ...actual, skipCreditJobWhenRailDisabled: jest.fn().mockResolvedValue(false) };
});

const db = require('../db');
const { sendNotification } = require('../services/notificationService');
const { withFencedJobLock } = require('../jobs/jobLockingService');
const { recordIncident } = require('../services/incidentStore');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');
const {
  CRON_EXPRESSION,
  JOB_NAME,
  buildNotification,
  finishCreditNotification,
  processOxsteedCreditNotificationOutbox,
  getSentRetentionDays,
  purgeSentCreditNotifications,
  purgeExpiredCardChallenges,
  runOxsteedCreditNotificationOutbox,
} = require('../jobs/oxsteedCreditNotificationOutbox');

beforeEach(() => {
  jest.clearAllMocks();
});

test('continues committed security notices while rail-paused replacement issuance stops', async () => {
  const rail = require('../services/oxsteedCreditService').skipCreditJobWhenRailDisabled;
  rail.mockResolvedValueOnce(true);
  db.query.mockResolvedValueOnce({ rows: [{ id: 'security-1', user_id: 'owner', attempts: 1,
    payload: { eventType: 'card_security', cardId: 'card-1', auditEventId: 'audit-1' } }] })
    .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
  sendNotification.mockResolvedValueOnce({ success: true });
  await expect(runOxsteedCreditNotificationOutbox()).resolves.toMatchObject({ sent: 1 });
  expect(require('../services/oxsteedCreditCardRecovery').processReplacementRequests).not.toHaveBeenCalled();
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'oxsteed_credit_card_security', idempotencyKey: 'credit-outbox:security-1' }));
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

test('formats international currency notifications using the currency precision', () => {
  expect(buildNotification({
    transactionId: 'tx-jpy',
    transactionType: 'load',
    direction: 'credit',
    amountCents: 1250,
    currencyCode: 'JPY',
  }).body).toBe('You received JPY 1250 in OxSteed Credit (load).');
  expect(buildNotification({
    transactionId: 'tx-kwd',
    transactionType: 'purchase',
    direction: 'debit',
    amountCents: 1250,
    currencyCode: 'KWD',
  }).body).toBe('You spent KWD 1.250 in OxSteed Credit (purchase).');
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
  expect(db.query.mock.calls[1][0]).toContain('status = $1::varchar(20)');
  expect(db.query.mock.calls[1][0]).toContain('$5::boolean');
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
  db.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  await expect(runOxsteedCreditNotificationOutbox()).resolves.toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0, purged: 0, challengesPurged: 0 });
  expect(withFencedJobLock).toHaveBeenCalledWith(JOB_NAME, expect.any(Function), 120, { throwOnLockError: true });
  expect(recordOxsteedCreditWorkerRun).toHaveBeenCalledWith({ jobName: JOB_NAME, result: { claimed: 0, sent: 0, retried: 0, failed: 0, purged: 0, challengesPurged: 0 } });
  expect(CRON_EXPRESSION).toBe('30 * * * * *');
});

test('bounds notification retention and purges only old sent rows', async () => {
  expect(getSentRetentionDays('1')).toBe(30);
  expect(getSentRetentionDays('9999')).toBe(730);
  expect(getSentRetentionDays('not-a-number')).toBe(90);
  db.query.mockResolvedValueOnce({ rows: [{ id: 'event-1' }, { id: 'event-2' }] });

  await expect(purgeSentCreditNotifications(10, 45)).resolves.toBe(2);
  expect(db.query.mock.calls[0][0]).toContain("status = 'sent'");
  expect(db.query.mock.calls[0][0]).toContain('DELETE FROM oxsteed_credit_notification_outbox');
  expect(db.query.mock.calls[0][1]).toEqual([10, 45]);
});

test('bounds cleanup of expired challenge hashes without deleting audit or replay history', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ id: 'expired' }] });
  await expect(purgeExpiredCardChallenges(999999)).resolves.toBe(1);
  expect(db.query.mock.calls[0][1]).toEqual([5000]);
  expect(db.query.mock.calls[0][0]).toContain("expires_at < NOW() - INTERVAL '30 days'");
  expect(db.query.mock.calls[0][0]).toContain('DELETE FROM oxsteed_credit_card_security_challenges');
});
