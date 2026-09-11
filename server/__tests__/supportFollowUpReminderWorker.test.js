'use strict';

const { mockQuery, resetMocks } = require('./setup');
const WebSocketService = require('../services/websocketService');
const notificationService = require('../services/notificationService');
const { processSupportFollowUpReminders } = require('../services/supportFollowUpReminderWorker');

jest.mock('../services/websocketService', () => ({
  broadcastToAdmins: jest.fn(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('notifies the assigned agent and marks the reminder delivered', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ locked: true }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'reminder-1', conversation_id: 'conversation-1', business_id: 42,
      recipient_user_id: 'user-agent-1', subject: 'Payment question',
      note: 'Review the invoice.', due_at: '2030-01-02T12:00:00.000Z',
    }] })
    .mockResolvedValueOnce({ rows: [{ id: 'reminder-1' }] })
    .mockResolvedValueOnce({ rows: [] });

  await expect(processSupportFollowUpReminders()).resolves.toEqual({ locked: true, notified: 1 });
  expect(notificationService.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'user-agent-1',
    type: 'support_follow_up_due',
    data: expect.objectContaining({ reminderId: 'reminder-1' }),
  }));
  expect(WebSocketService.broadcastToAdmins).not.toHaveBeenCalled();
  expect(mockQuery.mock.calls[2][0]).toContain('notified_at = NOW()');
});

test('broadcasts to admins when no agent is assigned', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ locked: true }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'reminder-2', conversation_id: 'conversation-2', business_id: 42,
      recipient_user_id: null, subject: 'Refund question', note: null,
      due_at: '2030-01-02T12:00:00.000Z',
    }] })
    .mockResolvedValueOnce({ rows: [{ id: 'reminder-2' }] })
    .mockResolvedValueOnce({ rows: [] });

  await expect(processSupportFollowUpReminders()).resolves.toEqual({ locked: true, notified: 1 });
  expect(WebSocketService.broadcastToAdmins).toHaveBeenCalledWith(
    'support:follow-up-due',
    expect.objectContaining({ reminderId: 'reminder-2', conversationId: 'conversation-2' })
  );
  expect(notificationService.sendNotification).not.toHaveBeenCalled();
});

test('does not query reminders when another worker owns the lock', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ locked: false }] });

  await expect(processSupportFollowUpReminders()).resolves.toEqual({ locked: false, notified: 0 });
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(notificationService.sendNotification).not.toHaveBeenCalled();
});
