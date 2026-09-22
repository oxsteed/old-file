'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

const chatController = require('../controllers/chatController');
const socketService = require('../services/socketService');

const clientMessageId = '11111111-1111-4111-8111-111111111111';
const message = {
  id: 'profile-message-1',
  conversation_id: 'conversation-1',
  sender_id: 'customer-1',
  content: 'I need help with this job.',
  client_message_id: clientMessageId,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'customer-1' };
    next();
  });
  app.post('/api/chat/profile-message', chatController.profileChatMessage);
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  });
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  socketService.isOnline = jest.fn().mockReturnValue(true);
  socketService.broadcastToUser = jest.fn();
});

describe('profile chat delivery', () => {
  test('replays a committed live message without duplicate side effects', async () => {
    mockQuery
      // First request: availability, conversation, insert, timestamp, sender.
      .mockResolvedValueOnce({ rows: [{ is_available_now: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1' }] })
      .mockResolvedValueOnce({ rows: [message] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ first_name: 'Customer', last_name: 'One', profile_photo_url: null }] })
      // Retry: availability, conversation, conflict, original message, sender.
      .mockResolvedValueOnce({ rows: [{ is_available_now: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [message] })
      .mockResolvedValueOnce({ rows: [{ first_name: 'Customer', last_name: 'One', profile_photo_url: null }] });

    const app = buildApp();
    const body = {
      helperId: 'helper-1',
      destination: 'helper',
      clientMessageId,
      messages: [{ role: 'user', content: message.content }],
    };

    const first = await request(app).post('/api/chat/profile-message').send(body);
    const retry = await request(app).post('/api/chat/profile-message').send(body);

    expect(first.status).toBe(201);
    expect(first.body).toEqual(expect.objectContaining({ type: 'live', idempotent: false }));
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(expect.objectContaining({
      type: 'live',
      idempotent: true,
      message,
    }));
    expect(socketService.broadcastToUser).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls.filter(([sql]) => /UPDATE conversations/.test(sql))).toHaveLength(1);
  });

  test('rejects a malformed client message id before touching the database', async () => {
    const res = await request(buildApp())
      .post('/api/chat/profile-message')
      .send({
        helperId: 'helper-1',
        clientMessageId: 'retry-1',
        messages: [{ role: 'user', content: 'Hello' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
