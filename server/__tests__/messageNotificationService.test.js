'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));

const db = require('../db');
const {
  enqueueMessageNotification,
  enqueueMessageNotifications,
  resolveConversationRecipients,
  enqueueConversationMessageNotifications,
} = require('../services/messageNotificationService');

beforeEach(() => {
  db.query.mockReset();
});

test('enqueues a durable notification with a bounded payload', async () => {
  await expect(enqueueMessageNotification({
    messageId: 'message-1',
    conversationId: 'conversation-1',
    recipientId: 'user-1',
    senderName: 'Customer',
    body: 'x'.repeat(400),
    actionUrl: '/messages/conversation-1',
  })).resolves.toBe(true);

  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO message_notification_outbox'),
    [
      'message-1',
      'conversation-1',
      'user-1',
      expect.any(String),
    ]
  );
  const payload = JSON.parse(db.query.mock.calls[0][1][3]);
  expect(payload.body).toHaveLength(280);
  expect(payload.actionUrl).toBe('/messages/conversation-1');
});

test('deduplicates recipients and never enqueues back to the sender', async () => {
  db.query.mockResolvedValue({ rows: [] });

  await enqueueMessageNotifications({
    messageId: 'message-2',
    conversationId: 'conversation-2',
    recipientIds: ['sender-1', 'recipient-1', 'recipient-1'],
    senderId: 'sender-1',
    senderName: 'Helper',
    body: 'Update',
  });

  expect(db.query).toHaveBeenCalledTimes(1);
  expect(db.query.mock.calls[0][1][2]).toBe('recipient-1');
});

test('resolves customer, helper, and active business representatives', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ customer_id: 'customer-1', helper_id: 'helper-1', business_id: 7 }] })
    .mockResolvedValueOnce({ rows: [{ member_id: 'rep-1' }, { member_id: 'helper-1' }] });

  await expect(resolveConversationRecipients({
    conversationId: 'conversation-3',
    senderId: 'customer-1',
  })).resolves.toEqual({
    conversation: {
      customer_id: 'customer-1',
      helper_id: 'helper-1',
      business_id: 7,
    },
    recipientIds: ['helper-1', 'rep-1'],
  });
});

test('conversation enqueue uses the same resolved recipient set', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ customer_id: 'customer-1', helper_id: 'helper-1', business_id: null }] })
    .mockResolvedValueOnce({ rows: [] });

  await enqueueConversationMessageNotifications({
    conversationId: 'conversation-4',
    messageId: 'message-4',
    senderId: 'helper-1',
    senderName: 'Helper',
    body: 'Done',
  });

  expect(db.query).toHaveBeenCalledTimes(2);
  expect(db.query.mock.calls[1][1][2]).toBe('customer-1');
});
