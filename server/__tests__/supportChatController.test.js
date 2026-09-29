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

  test('replays a support ticket initiation without opening a second ticket or sending email again', async () => {
    const clientRequestId = '88888888-8888-4888-8888-888888888888';
    const ticket = { id: 'ticket-1', ticket_number: 1001 };
    socketService.getSocketCount = jest.fn().mockResolvedValue(0);
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // first ticket lookup
      .mockResolvedValueOnce({ rows: [ticket] }) // first ticket insert
      .mockResolvedValueOnce({ rows: [{ id: 'support-message-1' }] }) // first message insert
      .mockResolvedValueOnce({ rows: [] }) // admin lookup for email
      .mockResolvedValueOnce({ rows: [ticket] }) // retry ticket lookup
      .mockResolvedValueOnce({ rows: [] }); // retry message conflict

    const appReq = {
      body: {
        message: 'I need help with my account.',
        visitorName: 'Guest User',
        visitorEmail: 'guest@example.com',
        clientRequestId,
      },
    };
    const firstRes = responseDouble();
    const retryRes = responseDouble();

    await supportChatController.initiateSupportChat(appReq, firstRes);
    await supportChatController.initiateSupportChat(appReq, retryRes);

    expect(firstRes.status).toHaveBeenCalledWith(201);
    expect(retryRes.status).toHaveBeenCalledWith(200);
    expect(retryRes.json).toHaveBeenCalledWith(expect.objectContaining({
      ticketNumber: 1001,
      idempotent: true,
    }));
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO support_tickets/.test(sql))).toHaveLength(1);
  });

  test('replays an authenticated support message without updating or broadcasting twice', async () => {
    const clientRequestId = '99999999-9999-4999-8999-999999999999';
    const message = { id: 'message-1', content: 'Anyone there?', created_at: '2026-09-22T12:00:00.000Z' };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: 'user-1', helper_id: 'admin-1' }] })
      .mockResolvedValueOnce({ rows: [message] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // message notification outbox
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: 'user-1', helper_id: 'admin-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [message] });

    const req = {
      user: { id: 'user-1' },
      body: { conversationId: 'conversation-1', message: 'Anyone there?', clientRequestId },
    };
    const firstRes = responseDouble();
    const retryRes = responseDouble();

    await supportChatController.sendSupportMessage(req, firstRes);
    await supportChatController.sendSupportMessage(req, retryRes);


    expect(firstRes.status).toHaveBeenCalledWith(201);
    expect(retryRes.status).toHaveBeenCalledWith(200);
    expect(retryRes.json).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-1',
      idempotent: true,
    }));
    expect(mockQuery.mock.calls.filter(([sql]) => /UPDATE conversations SET last_message_at/.test(sql))).toHaveLength(1);
    expect(socketService.broadcastToConversation).toHaveBeenCalledTimes(1);
  });
});
