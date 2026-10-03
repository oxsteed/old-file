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

  test('responds to the user before escalation emails complete (non-blocking)', async () => {
    const emailService = require('../utils/email');
    let resolveEmail;
    const emailGate = new Promise((resolve) => { resolveEmail = resolve; });
    emailService.sendEmail.mockReturnValueOnce(emailGate);

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', ticket_number: 1001 }] }) // ticket insert
      .mockResolvedValueOnce({ rows: [{ id: 'support-message-1' }] }) // message insert
      .mockResolvedValueOnce({ rows: [] }); // admin lookup for emails

    const req = {
      body: {
        message: 'I need help with my account.',
        visitorName: 'Guest User',
        visitorEmail: 'guest@example.com',
      },
    };
    const res = responseDouble();

    await supportChatController.initiateSupportChat(req, res);

    // The HTTP response goes out while the first escalation email is still
    // in flight: emails must never block the request.
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      routedTo: 'support_ticket',
      ticketNumber: 1001,
    }));
    expect(emailService.sendEmail).toHaveBeenCalled();

    // Let the fan-out finish; it must not throw or send a second response.
    resolveEmail({ success: true, id: 'email-1' });
    await emailGate;
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  test('assigns live support chat to an actually-online admin, not the first DB row', async () => {
    socketService.getSocketCount = jest.fn().mockResolvedValue(2);
    socketService.isOnline = jest.fn((id) => String(id) === 'admin-online');
    socketService.broadcastToAdmins = jest.fn();

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'admin-offline' }, { id: 'admin-online' }] }) // admin list
      .mockResolvedValueOnce({ rows: [{ id: 'conv-1' }] }) // conversation insert
      .mockResolvedValueOnce({ rows: [{ id: 'message-1' }] }) // message insert
      .mockResolvedValueOnce({ rows: [] }); // notification outbox

    const req = {
      user: { id: 'user-1' },
      body: { message: 'Hello', visitorName: 'Cust', visitorEmail: 'c@example.com' },
    };
    const res = responseDouble();

    await supportChatController.initiateSupportChat(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      routedTo: 'live_admin',
      conversationId: 'conv-1',
    }));
    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO conversations/.test(sql));
    expect(insertCall).toBeDefined();
    // helper_id (param $2) must be the online admin, not the first DB row.
    expect(insertCall[1][1]).toBe('admin-online');
  });

  test('falls back to ticket escalation when no admin is actually online', async () => {
    socketService.getSocketCount = jest.fn().mockResolvedValue(1);
    socketService.isOnline = jest.fn().mockReturnValue(false);
    socketService.broadcastToAdmins = jest.fn();

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'admin-offline' }] }) // admin list, none online
      .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', ticket_number: 1001 }] }) // ticket insert
      .mockResolvedValueOnce({ rows: [{ id: 'support-message-1' }] }) // message insert
      .mockResolvedValueOnce({ rows: [] }); // admin lookup for emails

    const req = {
      user: { id: 'user-1' },
      body: { message: 'Hello', visitorName: 'Cust', visitorEmail: 'c@example.com' },
    };
    const res = responseDouble();

    await supportChatController.initiateSupportChat(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      routedTo: 'support_ticket',
      ticketNumber: 1001,
    }));
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO conversations/.test(sql))).toBe(false);
  });

  test('admin-status returns a boolean, never the exact online count', async () => {
    socketService.getSocketCount = jest.fn().mockResolvedValue(7);
    const res = responseDouble();

    await supportChatController.getAdminStatus({}, res);

    expect(res.json).toHaveBeenCalledWith({
      adminsOnline: true,
      available: true,
      estimatedWaitTime: '< 2 minutes',
    });
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('onlineCount');
  });

  test('admin-status reports unavailable as false when nobody is online', async () => {
    socketService.getSocketCount = jest.fn().mockResolvedValue(0);
    const res = responseDouble();

    await supportChatController.getAdminStatus({}, res);

    expect(res.json).toHaveBeenCalledWith({
      adminsOnline: false,
      available: false,
      estimatedWaitTime: null,
    });
  });
});
