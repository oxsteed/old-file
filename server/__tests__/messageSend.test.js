'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));

const messageController = require('../controllers/messageController');
const socketService = require('../services/socketService');
socketService.broadcastToUser = jest.fn();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'customer-1', first_name: 'Customer', last_name: 'One' };
    next();
  });
  app.post('/api/messages/conversations/:conversationId', messageController.sendMessage);
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  });
  return app;
}

const conversation = {
  customer_id: 'customer-1',
  helper_id: 'helper-1',
  business_id: null,
  job_id: 'job-1',
  business_name: null,
};

const message = {
  id: 'message-1',
  conversation_id: 'conversation-1',
  sender_id: 'customer-1',
  content: 'I need help.',
  client_message_id: '11111111-1111-4111-8111-111111111111',
  created_at: '2026-09-22T12:00:00.000Z',
};

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('direct message delivery', () => {
  test('persists a client message id and broadcasts a new message once', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [conversation] })
      .mockResolvedValueOnce({ rows: [message] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/messages/conversations/conversation-1')
      .send({
        content: 'I need help.',
        clientMessageId: message.client_message_id,
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ id: message.id }));
    expect(mockQuery.mock.calls[1][0]).toContain('client_message_id');
    expect(mockQuery.mock.calls[1][1]).toContain(message.client_message_id);
    expect(socketService.broadcastToConversation).toHaveBeenCalledTimes(1);
  });

  test('refreshes the business inbox when a customer message belongs to a business', async () => {
    const businessConversation = {
      ...conversation,
      business_id: 17,
      business_name: 'OxSteed Services',
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [businessConversation] })
      .mockResolvedValueOnce({ rows: [message] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/messages/conversations/conversation-1')
      .send({
        content: 'I need help.',
        clientMessageId: message.client_message_id,
      });

    expect(res.status).toBe(201);
    expect(socketService.broadcastToBusinessInbox).toHaveBeenCalledWith(
      17,
      'business_inbox:message',
      expect.objectContaining({
        business_id: 17,
        conversation_id: 'conversation-1',
        message_id: message.id,
      }),
    );
  });

  test('replays the original message without updating or broadcasting twice', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [conversation] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [message] });

    const res = await request(buildApp())
      .post('/api/messages/conversations/conversation-1')
      .set('Idempotency-Key', message.client_message_id)
      .send({ content: 'I need help.' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ id: message.id }));
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE conversations/.test(sql))).toBe(false);
    expect(socketService.broadcastToConversation).not.toHaveBeenCalled();
  });

  test('rejects a malformed client message id before touching the database', async () => {
    const res = await request(buildApp())
      .post('/api/messages/conversations/conversation-1')
      .send({ content: 'I need help.', clientMessageId: 'retry-1' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
