'use strict';

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(true),
}));
jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('chat-attachments/private-photo.jpg'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('/api/storage/files/chat-attachments/private-photo.jpg?exp=1&sig=test'),
}));

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const socketService = require('../services/socketService');
const messageController = require('../controllers/messageController');
const storage = require('../utils/storage');

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
  test('returns a private signed URL for uploaded images', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ customer_id: 'customer-456', helper_id: 'user-123', business_id: null }],
    });

    const uploadApp = express();
    uploadApp.use(express.json());
    uploadApp.use((req, _res, next) => {
      req.user = { id: 'user-123' };
      next();
    });
    uploadApp.post('/api/messages/conversations/:conversationId/attachments', (req, _res, next) => {
      req.file = {
        buffer: Buffer.from('image bytes'),
        originalname: 'photo.jpg',
        mimetype: 'image/jpeg',
        size: 11,
      };
      next();
    }, messageController.uploadAttachment);

    const res = await request(uploadApp)
      .post('/api/messages/conversations/conv-1/attachments');

    expect(res.status).toBe(200);
    expect(res.body.url).toContain('/api/storage/files/');
    expect(res.body.url).not.toContain('s3.amazonaws.com');
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('chat-attachments/private-photo.jpg', 3600);
  });

  test('POST /messages/conversations/:id accepts attachment-only messages', async () => {
    const attachment = {
      url: 'https://cdn.example.com/chat/photo.jpg',
      type: 'image/jpeg',
      filename: 'photo.jpg',
    };
    const storedAttachment = { ...attachment, key: null };

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
      .mockResolvedValueOnce({ rows: [] }) // no blocks
      .mockResolvedValueOnce({ rows: [] }) // recipient active
      .mockResolvedValueOnce({
        rows: [{
          id: 'msg-1',
          conversation_id: 'conv-1',
          sender_id: 'user-123',
          content: '',
          message_type: 'attachment',
          attachments: [storedAttachment],
          is_read: false,
          created_at: '2026-06-02T12:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/messages/conversations/conv-1')
      .send({ content: '', attachments: [attachment] });

    expect(res.status).toBe(201);
    expect(res.body.attachments).toEqual([storedAttachment]);
    expect(mockQuery.mock.calls[3][0]).toContain('attachments');
    expect(mockQuery.mock.calls[3][1]).toEqual([
      'conv-1',
      'user-123',
      '',
      'attachment',
      JSON.stringify([{ url: attachment.url, key: null, type: 'image/jpeg', filename: 'photo.jpg' }]),
      null,
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

  test('POST /messages/conversations/:id accepts name/mimeType attachment aliases', async () => {
    const stored = {
      url: 'https://cdn.example.com/chat/photo.jpg',
      key: null,
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
      .mockResolvedValueOnce({ rows: [] }) // no blocks
      .mockResolvedValueOnce({ rows: [] }) // recipient active
      .mockResolvedValueOnce({
        rows: [{
          id: 'msg-2',
          conversation_id: 'conv-1',
          sender_id: 'user-123',
          content: 'see photo',
          message_type: 'text',
          attachments: [stored],
          is_read: false,
          created_at: '2026-06-02T12:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/messages/conversations/conv-1')
      .send({
        content: 'see photo',
        attachments: [{
          url: stored.url,
          name: 'photo.jpg',
          mimeType: 'image/jpeg',
        }],
      });

    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls[3][1][4]).toBe(JSON.stringify([stored]));
  });

  test('POST /messages/conversations/:id persists the storage key for later re-signing', async () => {
    const stored = {
      url: 'https://signed.example.com/chat/photo.jpg?exp=1',
      key: 'chat-attachments/private-photo.jpg',
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
      .mockResolvedValueOnce({ rows: [] }) // no blocks
      .mockResolvedValueOnce({ rows: [] }) // recipient active
      .mockResolvedValueOnce({
        rows: [{
          id: 'msg-3',
          conversation_id: 'conv-1',
          sender_id: 'user-123',
          content: 'see photo',
          message_type: 'text',
          attachments: [stored],
          is_read: false,
          created_at: '2026-06-02T12:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/messages/conversations/conv-1')
      .send({
        content: 'see photo',
        attachments: [{
          url: stored.url,
          key: stored.key,
          name: 'photo.jpg',
          mimeType: 'image/jpeg',
        }],
      });

    expect(res.status).toBe(201);
    const persisted = JSON.parse(mockQuery.mock.calls[3][1][4]);
    expect(persisted[0].key).toBe('chat-attachments/private-photo.jpg');
    // Backward-compatible shape: url/type/filename still present
    expect(persisted[0].url).toBe(stored.url);
    expect(persisted[0].type).toBe('image/jpeg');
    expect(persisted[0].filename).toBe('photo.jpg');
  });
});
