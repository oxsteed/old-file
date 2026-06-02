'use strict';

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(true),
}));

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const socketService = require('../services/socketService');
const messageController = require('../controllers/messageController');

socketService.broadcastToConversation = jest.fn();
socketService.broadcastToUser = jest.fn();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: 'user-123',
      first_name: 'Emile',
      last_name: 'Philippe',
    };
    next();
  });
  app.post('/api/messages/conversations/:conversationId', messageController.sendMessage);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message, fields: err.fields });
  });
  return app;
}

beforeEach(() => resetMocks());
beforeEach(() => {
  socketService.broadcastToConversation.mockClear();
  socketService.broadcastToUser.mockClear();
});

describe('message attachments', () => {
  test('POST /messages/conversations/:id accepts attachment-only messages', async () => {
    const attachment = {
      url: 'https://cdn.example.com/chat/photo.jpg',
      type: 'image/jpeg',
      filename: 'photo.jpg',
    };

    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          customer_id: 'customer-456',
          helper_id: 'user-123',
          business_id: null,
          job_id: null,
          business_name: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'msg-1',
          conversation_id: 'conv-1',
          sender_id: 'user-123',
          content: '',
          message_type: 'attachment',
          attachments: [attachment],
          is_read: false,
          created_at: '2026-06-02T12:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/messages/conversations/conv-1')
      .send({ content: '', attachments: [attachment] });

    expect(res.status).toBe(201);
    expect(res.body.attachments).toEqual([attachment]);
    expect(mockQuery.mock.calls[1][0]).toContain('attachments');
    expect(mockQuery.mock.calls[1][1]).toEqual([
      'conv-1',
      'user-123',
      '',
      'attachment',
      JSON.stringify([attachment]),
    ]);
  });

  test('POST /messages/conversations/:id rejects empty messages without attachments', async () => {
    const res = await request(buildApp())
      .post('/api/messages/conversations/conv-1')
      .send({ content: '   ', attachments: [] });

    expect(res.status).toBe(400);
    expect(res.body.fields.content).toBe('Message content or attachment is required');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
