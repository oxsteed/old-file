'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
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

const db = require('../db');
const { sendNotification } = require('../services/notificationService');
const { withFencedJobLock } = require('../jobs/jobLockingService');
const {
  CRON_EXPRESSION,
  JOB_NAME,
  processMessageNotificationOutbox,
  runMessageNotificationOutbox,
} = require('../jobs/messageNotificationOutbox');

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
});

test('delivers a claimed message notification and marks it sent', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{
      id: 'outbox-1',
      message_id: 'message-1',
      conversation_id: 'conversation-1',
      recipient_id: 'helper-1',
      attempts: 1,
      payload: {
        conversationId: 'conversation-1',
        messageId: 'message-1',
        senderName: 'Customer One',
        body: 'I need help.',
        actionUrl: '/messages/conversation-1',
      },
      lease_token: 'lease-1',
    }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });
  sendNotification.mockResolvedValueOnce({ success: true, notificationId: 42 });

  await expect(processMessageNotificationOutbox()).resolves.toEqual({
    claimed: 1,
    sent: 1,
    retried: 0,
    failed: 0,
  });
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'helper-1',
    type: 'new_message',
    idempotencyKey: 'message:message-1:helper-1',
    data: expect.objectContaining({ messageId: 'message-1' }),
  }));
  expect(db.query.mock.calls[1][1][0]).toBe('sent');
});

test('retries failed deliveries and eventually records a terminal failure', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{
      id: 'outbox-2',
      message_id: 'message-2',
      conversation_id: 'conversation-2',
      recipient_id: 'customer-1',
      attempts: 8,
      payload: { senderName: 'Helper One', body: 'Update' },
      lease_token: 'lease-2',
    }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });
  sendNotification.mockResolvedValueOnce({ success: false, error: 'provider unavailable' });

  await expect(processMessageNotificationOutbox()).resolves.toEqual({
    claimed: 1,
    sent: 0,
    retried: 0,
    failed: 1,
  });
  expect(db.query.mock.calls[1][1].slice(0, 2)).toEqual(['failed', 'provider unavailable']);
});

test('does not count a stale worker completion after its lease is replaced', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{
      id: 'outbox-stale',
      message_id: 'message-stale',
      conversation_id: 'conversation-stale',
      recipient_id: 'customer-stale',
      attempts: 2,
      lease_token: 'lease-stale',
      payload: { senderName: 'Helper', body: 'Update' },
    }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 0 });
  sendNotification.mockResolvedValueOnce({ success: true });

  await expect(processMessageNotificationOutbox()).resolves.toEqual({
    claimed: 1,
    sent: 0,
    retried: 0,
    failed: 0,
  });
});

test('runs under the distributed worker lock', async () => {
  db.query.mockResolvedValueOnce({ rows: [] });

  await expect(runMessageNotificationOutbox()).resolves.toEqual({
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
  });
  expect(withFencedJobLock).toHaveBeenCalledWith(JOB_NAME, expect.any(Function), 120, { throwOnLockError: true });
  expect(CRON_EXPRESSION).toBe('55 * * * * *');
});
