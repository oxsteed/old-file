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

test('marks each newly breached SLA once and alerts the assigned agent', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ locked: true }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'conversation-1',
      business_id: 42,
      agent_id: 'agent-1',
      agent_user_id: 'user-agent-1',
      subject: 'Payment question',
      priority: 'high',
      first_response_breach: true,
      resolution_breach: false,
    }] })
    .mockResolvedValueOnce({ rows: [] });

  await expect(runSupportSlaMonitor()).resolves.toEqual({ locked: true, updated: 1 });

  expect(mockQuery.mock.calls[1][0]).toContain('UPDATE support_conversations');
  expect(mockQuery.mock.calls[1][0]).toContain('LIMIT 100');
  expect(WebSocketService.broadcastToAdmins).toHaveBeenCalledWith(
    'support:sla-breached',
    expect.objectContaining({ conversationId: 'conversation-1', firstResponseBreach: true })
  );
  expect(notificationService.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'user-agent-1',
    type: 'support_sla_breach',
    action_url: '/admin/support/chat',
  }));
});

test('does not query for breaches when another worker owns the lock', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ locked: false }] });

  await expect(runSupportSlaMonitor()).resolves.toEqual({ locked: false, updated: 0 });
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(WebSocketService.broadcastToAdmins).not.toHaveBeenCalled();
});
