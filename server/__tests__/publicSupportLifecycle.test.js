'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/websocketService', () => ({
  broadcastToTicket: jest.fn(),
  broadcastToAdmins: jest.fn(),
}));
jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('support-conversations/test-image.png'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('/api/storage/files/support-conversations/test-image.png'),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

const publicSupport = require('../controllers/publicSupportController');
const WebSocketService = require('../services/websocketService');
const emailService = require('../utils/email');
const storage = require('../utils/storage');

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

test('persists a guest image-only reply with non-null content', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'ticket-1' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'message-image-1', created_at: '2026-09-10T12:00:00.000Z' }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });

  const res = responseDouble();
  await publicSupport.addGuestMessage({
    params: { conversationId: 'ticket-1' },
    guestToken: 'guest-token',
    body: {},
    file: { buffer: Buffer.from('image'), mimetype: 'image/png', originalname: 'proof.png' },
  }, res);

  const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO support_conversation_messages/.test(sql));
  expect(insertCall[1][2]).toBe('Attachment');
  expect(storage.uploadFile).toHaveBeenCalled();
  expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
    'ticket-1',
    'message:new',
    expect.objectContaining({ content: 'Attachment', messageType: 'image' })
  );
});

test('replays a guest retry without incrementing counters or rebroadcasting', async () => {
  const clientMessageId = '11111111-1111-4111-8111-111111111111';
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'ticket-1' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 'message-existing',
      content: 'A follow-up question',
      message_type: 'text',
      client_message_id: clientMessageId,
      created_at: '2026-09-10T12:00:00.000Z',
    }] });

  const res = responseDouble();
  await publicSupport.addGuestMessage({
    params: { conversationId: 'ticket-1' },
    guestToken: 'guest-token',
    body: { message: 'A follow-up question', clientMessageId },
  }, res);

  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    idempotent: true,
    data: expect.objectContaining({ id: 'message-existing' }),
  }));
  expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_conversations/.test(sql))).toBe(false);
  expect(WebSocketService.broadcastToTicket).not.toHaveBeenCalled();
});

test('cleans up a raced guest attachment when the request is replayed', async () => {
  const clientMessageId = '33333333-3333-4333-8333-333333333333';
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'ticket-1' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 'message-existing',
      content: 'Original image',
      message_type: 'image',
      attachment_url: '/api/storage/files/original.png',
      attachment_name: 'original.png',
      client_message_id: clientMessageId,
      created_at: '2026-09-10T12:00:00.000Z',
    }] });

  const res = responseDouble();
  await publicSupport.addGuestMessage({
    params: { conversationId: 'ticket-1' },
    guestToken: 'guest-token',
    body: { clientMessageId },
    file: { buffer: Buffer.from('retry-image'), mimetype: 'image/png', originalname: 'retry.png' },
  }, res);

  expect(storage.deleteFile).toHaveBeenCalledWith('support-conversations/test-image.png');
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ idempotent: true }));
  expect(WebSocketService.broadcastToTicket).not.toHaveBeenCalled();
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

test('serializes guest verification resends and honors the throttle inside the lock', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ guest_name: 'Guest User' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'verification-1' }] });

  const res = responseDouble();
  await publicSupport.resendGuestVerification({
    params: { conversationId: 'ticket-1' },
    body: { visitorEmail: 'guest@example.com' },
  }, res);

  expect(res.status).toHaveBeenCalledWith(429);
  expect(res.json).toHaveBeenCalledWith({ error: 'Please wait before requesting another code' });
  expect(mockQuery.mock.calls[0][0]).toMatch(/FOR UPDATE/);
  expect(emailService.sendEmail).not.toHaveBeenCalled();
});

test('sends a guest verification code only after the locked throttle check passes', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ guest_name: 'Guest User' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ id: 'verification-2' }] });

  const res = responseDouble();
  await publicSupport.resendGuestVerification({
    params: { conversationId: 'ticket-1' },
    body: { visitorEmail: 'guest@example.com' },
  }, res);

  expect(res.json).toHaveBeenCalledWith({ success: true });
  expect(emailService.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
    to: 'guest@example.com',
  }));
  expect(mockQuery.mock.calls[0][0]).toMatch(/FOR UPDATE/);
});
