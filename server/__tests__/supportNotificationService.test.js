'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const { sendNotification } = require('../services/notificationService');
const {
  resolveSupportStaffIds,
  scheduleSupportMessageNotifications,
  notifySupportStaff,
  SUPPORT_STAFF_ALERT_LIMIT,
} = require('../services/supportNotificationService');

function flushImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('resolves active platform support staff for unassigned tickets', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [
    { id: 'admin-1', on_call: false },
    { id: 'admin-2', on_call: false },
  ] });

  await expect(resolveSupportStaffIds()).resolves.toEqual(['admin-1', 'admin-2']);
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('role = ANY'),
    [['admin', 'super_admin'], SUPPORT_STAFF_ALERT_LIMIT],
  );
  // On-call scoping (item 10): the resolution prefers on-call staff and
  // caps the fan-out instead of notifying every admin.
  expect(mockQuery.mock.calls[0][0]).toContain('safety_on_call');
  expect(mockQuery.mock.calls[0][0]).toContain('LIMIT');
});

test('prefers on-call staff when any are on call', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [
    { id: 'admin-1', on_call: true },
    { id: 'admin-2', on_call: false },
    { id: 'admin-3', on_call: true },
  ] });

  await expect(resolveSupportStaffIds()).resolves.toEqual(['admin-1', 'admin-3']);
});

test('notifySupportStaff fans out once per resolved staff member', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [
    { id: 'admin-1', on_call: false },
    { id: 'admin-2', on_call: false },
  ] });

  const result = await notifySupportStaff({
    type: 'support_sla_breach',
    title: 'Support ticket SLA breached',
    body: 'Ticket #12 breached its SLA.',
    data: { supportTicketId: 'ticket-12' },
    action_url: '/support/agent',
    idempotencyKeyPrefix: 'support-ticket-sla:ticket-12:round-1',
  });

  expect(result).toEqual(expect.objectContaining({ notified: 2, failed: 0 }));
  expect(sendNotification).toHaveBeenCalledTimes(2);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'admin-1',
    type: 'support_sla_breach',
    action_url: '/support/agent',
    idempotencyKey: 'support-ticket-sla:ticket-12:round-1:admin-1',
  }));
});

test('delivers a reply alert to the assigned agent (notification center)', async () => {
  scheduleSupportMessageNotifications({
    ticketId: 'ticket-1',
    messageId: 'message-1',
    senderId: 'customer-1',
    recipientIds: ['agent-1'],
    body: 'Customer follow-up',
  });

  await flushImmediate();

  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'agent-1',
    type: 'new_message',
    action_url: '/support/agent',
    idempotencyKey: 'support-ticket-message:ticket-1:message-1:agent-1',
  }));
  expect(mockQuery).not.toHaveBeenCalled();
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
