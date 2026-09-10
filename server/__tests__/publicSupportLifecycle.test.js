'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/websocketService', () => ({
  broadcastToTicket: jest.fn(),
  broadcastToAdmins: jest.fn(),
}));

const publicSupport = require('../controllers/publicSupportController');
const WebSocketService = require('../services/websocketService');

function responseDouble() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());

test('persists a guest reply and its counter as one database operation', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'ticket-1' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'message-1', created_at: '2026-09-10T12:00:00.000Z' }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });

  const res = responseDouble();
  await publicSupport.addGuestMessage({
    params: { conversationId: 'ticket-1' },
    guestToken: 'guest-token',
    body: { message: 'A follow-up question' },
  }, res);

  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    success: true,
    data: expect.objectContaining({ id: 'message-1' }),
  }));
  expect(mockQuery).toHaveBeenCalledTimes(3);
  expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO support_conversation_messages/);
  expect(mockQuery.mock.calls[2][0]).toMatch(/UPDATE support_conversations/);
  expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
    'ticket-1',
    'message:new',
    expect.objectContaining({ content: 'A follow-up question' })
  );
});

test('reopens a guest conversation and requeues it atomically', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', status: 'resolved' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', status: 'open', updated_at: '2026-09-10T12:00:00.000Z' }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });

  const res = responseDouble();
  await publicSupport.reopenGuestConversation({
    params: { conversationId: 'ticket-1' },
    guestToken: 'guest-token',
  }, res);

  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    success: true,
    data: expect.objectContaining({ id: 'ticket-1', status: 'open' }),
  }));
  expect(mockQuery).toHaveBeenCalledTimes(3);
  expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE support_conversations/);
  expect(mockQuery.mock.calls[2][0]).toMatch(/UPDATE support_queue/);
});

test('rejects invalid guest verification email input before database access', async () => {
  const resendRes = responseDouble();
  await publicSupport.resendGuestVerification({
    params: { conversationId: 'ticket-1' },
    body: { visitorEmail: 'not-an-email' },
  }, resendRes);

  const verifyRes = responseDouble();
  await publicSupport.verifyGuestConversation({
    params: { conversationId: 'ticket-1' },
    body: { visitorEmail: 'not-an-email', code: '123456' },
  }, verifyRes);

  expect(resendRes.status).toHaveBeenCalledWith(400);
  expect(verifyRes.status).toHaveBeenCalledWith(400);
  expect(mockQuery).not.toHaveBeenCalled();
});
