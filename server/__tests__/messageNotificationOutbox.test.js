'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));
jest.mock('../jobs/jobLockingService', () => ({
  withJobLock: jest.fn(async (_jobName, handler) => handler()),
}));

const db = require('../db');
const { sendNotification } = require('../services/notificationService');
const { withJobLock } = require('../jobs/jobLockingService');
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
    }] })
    .mockResolvedValueOnce({ rows: [] });
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
    }] })
    .mockResolvedValueOnce({ rows: [] });
  sendNotification.mockResolvedValueOnce({ success: false, error: 'provider unavailable' });

  await expect(processMessageNotificationOutbox()).resolves.toEqual({
    claimed: 1,
    sent: 0,
    retried: 0,
    failed: 1,
  });
  expect(db.query.mock.calls[1][1].slice(0, 2)).toEqual(['failed', 'provider unavailable']);
});

test('runs under the distributed worker lock', async () => {
  db.query.mockResolvedValueOnce({ rows: [] });

  await expect(runMessageNotificationOutbox()).resolves.toEqual({
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
  });
  expect(withJobLock).toHaveBeenCalledWith(JOB_NAME, expect.any(Function), 120, { throwOnLockError: true });
  expect(CRON_EXPRESSION).toBe('55 * * * * *');
});
