'use strict';

const { mockQuery, resetMocks } = require('./setup');
const WebSocketService = require('../services/websocketService');
const notificationService = require('../services/notificationService');
const { runSupportSlaMonitor } = require('../services/supportSlaMonitor');

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

function breachRow(overrides = {}) {
  return {
    id: 'conversation-1',
    business_id: 42,
    agent_id: 'agent-1',
    agent_user_id: 'user-agent-1',
    subject: 'Payment question',
    priority: 'high',
    first_response_breach: true,
    resolution_breach: false,
    ...overrides,
  };
}

function updateCalls() {
  return mockQuery.mock.calls.filter(([sql]) => /UPDATE support_conversations/.test(sql));
}

test('marks each newly breached SLA once and alerts the assigned agent', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ locked: true }] })
    .mockResolvedValueOnce({ rows: [breachRow()] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });

  await expect(runSupportSlaMonitor()).resolves.toEqual({ locked: true, updated: 1 });

  const selectSql = mockQuery.mock.calls[1][0];
  expect(selectSql).not.toContain('UPDATE support_conversations');
  expect(selectSql).toContain('LIMIT 100');
  expect(selectSql).toContain("status NOT IN ('resolved', 'closed', 'merged')");
  expect(WebSocketService.broadcastToAdmins).toHaveBeenCalledWith(
    'support:sla-breached',
    expect.objectContaining({ conversationId: 'conversation-1', firstResponseBreach: true })
  );
  expect(notificationService.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'user-agent-1',
    type: 'support_sla_breach',
    action_url: '/admin/support/chat',
    idempotencyKey: 'support-sla-breach:conversation-1:fr1:res0',
  }));
  expect(updateCalls()).toHaveLength(1);
  expect(updateCalls()[0][1][0]).toBe('conversation-1');
});

test('a failed notify leaves the breach unmarked and does not block later rows', async () => {
  notificationService.sendNotification
    .mockRejectedValueOnce(new Error('db down'))
    .mockResolvedValueOnce({ success: true });
  mockQuery
    .mockResolvedValueOnce({ rows: [{ locked: true }] })
    .mockResolvedValueOnce({ rows: [
      breachRow(),
      breachRow({ id: 'conversation-2', subject: 'Refund question' }),
    ] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });

  await expect(runSupportSlaMonitor()).resolves.toEqual({ locked: true, updated: 1 });

  expect(notificationService.sendNotification).toHaveBeenCalledTimes(2);
  expect(WebSocketService.broadcastToAdmins).toHaveBeenCalledTimes(2);
  // Only the successfully notified row is marked; the failed breach
  // stays eligible for the next run instead of being lost.
  expect(updateCalls()).toHaveLength(1);
  expect(updateCalls()[0][1][0]).toBe('conversation-2');
});

test('a notification that reports success:false leaves the breach unmarked', async () => {
  notificationService.sendNotification.mockResolvedValueOnce({ success: false });
  mockQuery
    .mockResolvedValueOnce({ rows: [{ locked: true }] })
    .mockResolvedValueOnce({ rows: [breachRow()] });

  await expect(runSupportSlaMonitor()).resolves.toEqual({ locked: true, updated: 0 });

  expect(notificationService.sendNotification).toHaveBeenCalledTimes(1);
  expect(updateCalls()).toHaveLength(0);
});

test('does not query for breaches when another worker owns the lock', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ locked: false }] });

  await expect(runSupportSlaMonitor()).resolves.toEqual({ locked: false, updated: 0 });
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(WebSocketService.broadcastToAdmins).not.toHaveBeenCalled();
});
