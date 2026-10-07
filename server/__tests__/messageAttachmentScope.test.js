'use strict';

// Audit P1: chat attachment re-signing must be bound to conversation ownership.
// A client must not be able to re-sign (or plant) storage keys that belong to
// another conversation or to an unrelated storage area.

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(true),
}));
jest.mock('../utils/storage', () => {
  const actual = jest.requireActual('../utils/storage');
  return {
    uploadFile: jest.fn(),
    getSignedDownloadUrl: jest.fn().mockImplementation((key) =>
      Promise.resolve(`https://signed.example/fresh/${encodeURIComponent(key)}?sig=abc`)),
    normalizeStorageKey: actual.normalizeStorageKey,
  };
});

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
    req.user = { id: 'user-123', first_name: 'Emile', last_name: 'Philippe' };
    next();
  });
  app.get('/api/messages/conversations/:conversationId', messageController.getMessages);
  app.post('/api/messages/conversations/:conversationId', messageController.sendMessage);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message, code: err.code, fields: err.fields });
  });
  return app;
}

const convRow = {
  customer_id: 'customer-456',
  helper_id: 'user-123',
  business_id: null,
  status: 'active',
  archived_at: null,
};

function messageWithAttachment(key) {
  return {
    id: 'msg-1',
    conversation_id: 'conv-1',
    sender_id: 'helper-1',
    content: 'see photo',
    attachments: [{
      url: 'https://old.example.com/chat/photo.jpg?exp=1',
      key,
      type: 'image/jpeg',
      filename: 'photo.jpg',
    }],
    is_read: false,
    created_at: '2026-10-01T12:00:00.000Z',
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('attachment re-sign ownership (read path)', () => {
  test('(a) re-signs a key minted for this conversation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [messageWithAttachment('chat-attachments/c-conv-1/abc123.jpg')] });

    const res = await request(buildApp()).get('/api/messages/conversations/conv-1');

    expect(res.status).toBe(200);
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('chat-attachments/c-conv-1/abc123.jpg', 3600);
    expect(res.body[0].attachments[0].url).toContain('https://signed.example/fresh/');
  });

  test('(b) refuses to re-sign a key minted for another conversation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [messageWithAttachment('chat-attachments/c-conv-999/abc123.jpg')] });

    const res = await request(buildApp()).get('/api/messages/conversations/conv-1');

    expect(res.status).toBe(200);
    expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    expect(res.body[0].attachments[0].url).toBeNull();
  });

  test('(b2) refuses to re-sign a key from an unrelated storage area', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [messageWithAttachment('proofs/some-proof.pdf')] });

    const res = await request(buildApp()).get('/api/messages/conversations/conv-1');

    expect(res.status).toBe(200);
    expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    expect(res.body[0].attachments[0].url).toBeNull();
  });

  test('(c) rejects path traversal keys', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [messageWithAttachment('chat-attachments/c-conv-1/../../etc/passwd')] });

    const res = await request(buildApp()).get('/api/messages/conversations/conv-1');

    expect(res.status).toBe(200);
    expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    expect(res.body[0].attachments[0].url).toBeNull();
  });

  test('grandfathers pre-scoping legacy keys so old attachments keep working', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [messageWithAttachment('chat-attachments/photo.jpg')] });

    const res = await request(buildApp()).get('/api/messages/conversations/conv-1');

    expect(res.status).toBe(200);
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('chat-attachments/photo.jpg', 3600);
    expect(res.body[0].attachments[0].url).toContain('https://signed.example/fresh/');
  });

  test('prefix spoofing (c-conv-1-evil) does not match the conversation scope', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [messageWithAttachment('chat-attachments/c-conv-1-evil/abc123.jpg')] });

    const res = await request(buildApp()).get('/api/messages/conversations/conv-1');

    expect(res.status).toBe(200);
    expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    expect(res.body[0].attachments[0].url).toBeNull();
  });
});

describe('attachment key ownership (write path)', () => {
  function mockSendMessageQueries() {
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
          id: 'msg-9',
          conversation_id: 'conv-1',
          sender_id: 'user-123',
          content: 'see photo',
          message_type: 'text',
          attachments: [],
          is_read: false,
          created_at: '2026-10-07T12:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
  }

  test('rejects planting another conversation\'s attachment key', async () => {
    const res = await request(buildApp())
      .post('/api/messages/conversations/conv-1')
      .send({
        content: 'see photo',
        attachments: [{
          url: 'https://signed.example.com/chat/evil.jpg?exp=1',
          key: 'chat-attachments/c-conv-999/evil.jpg',
          name: 'evil.jpg',
          mimeType: 'image/jpeg',
        }],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('attachment_key_not_issued_here');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects planting an unrelated storage key', async () => {
    const res = await request(buildApp())
      .post('/api/messages/conversations/conv-1')
      .send({
        content: 'see photo',
        attachments: [{
          url: 'https://signed.example.com/proofs/x.pdf?exp=1',
          key: 'proofs/x.pdf',
          name: 'x.pdf',
          mimeType: 'application/pdf',
        }],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('attachment_key_not_issued_here');
  });

  test('accepts an attachment key minted for this conversation', async () => {
    mockSendMessageQueries();

    const res = await request(buildApp())
      .post('/api/messages/conversations/conv-1')
      .send({
        content: 'see photo',
        attachments: [{
          url: 'https://signed.example.com/chat/photo.jpg?exp=1',
          key: 'chat-attachments/c-conv-1/abc123.jpg',
          name: 'photo.jpg',
          mimeType: 'image/jpeg',
        }],
      });

    expect(res.status).toBe(201);
    const persisted = JSON.parse(mockQuery.mock.calls[3][1][4]);
    expect(persisted[0].key).toBe('chat-attachments/c-conv-1/abc123.jpg');
  });
});
