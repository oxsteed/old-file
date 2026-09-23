'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const { sendNotification } = require('../services/notificationService');
const {
  resolveSupportStaffIds,
  scheduleSupportMessageNotifications,
} = require('../services/supportNotificationService');

function flushImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('resolves active platform support staff for unassigned tickets', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'admin-1' }, { id: 'admin-2' }] });

  await expect(resolveSupportStaffIds()).resolves.toEqual(['admin-1', 'admin-2']);
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('role = ANY'),
    [['admin', 'super_admin']],
  );
});

test('deduplicates recipients and excludes the sender before sending', async () => {
  scheduleSupportMessageNotifications({
    ticketId: 'ticket-1',
    messageId: 'message-1',
    senderId: 'admin-1',
    recipientIds: ['admin-1', 'admin-2', 'admin-2'],
    body: 'Customer follow-up',
  });

  await flushImmediate();

  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'admin-2',
    type: 'new_message',
    idempotencyKey: 'support-ticket-message:ticket-1:message-1:admin-2',
  }));
  expect(mockQuery).not.toHaveBeenCalled();
});
