'use strict';

const { mockQuery, resetMocks } = require('./setup');
const supportChatController = require('../controllers/supportChatController');
const socketService = require('../services/socketService');

function responseDouble() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  socketService.getSocketCount = jest.fn().mockResolvedValue(1);
  socketService.broadcastToAdmins = jest.fn();
});

describe('legacy support chat compatibility', () => {
  test('routes a guest to the canonical support ticket even when an admin is online', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', ticket_number: 1001 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      body: {
        message: 'I need help with my account.',
        visitorName: 'Guest User',
        visitorEmail: 'guest@example.com',
      },
    };
    const res = responseDouble();

    await supportChatController.initiateSupportChat(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      routedTo: 'support_ticket',
      ticketNumber: 1001,
    }));
    expect(mockQuery.mock.calls[0][0]).toContain('name, email');
    expect(mockQuery.mock.calls[1][0]).toContain('sender_email');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO conversations/.test(sql))).toBe(false);
    expect(socketService.broadcastToAdmins).not.toHaveBeenCalled();
  });

  test('does not let a guest post into an authenticated live conversation', async () => {
    const req = { body: { conversationId: 'conversation-1', message: 'Anyone there?' } };
    const res = responseDouble();

    await supportChatController.sendSupportMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Sign in to continue a live support chat',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
