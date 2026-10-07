'use strict';

jest.mock('../utils/storage', () => {
  const actual = jest.requireActual('../utils/storage');
  return {
    uploadFile: jest.fn(),
    getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/fresh?sig=abc'),
    normalizeStorageKey: actual.normalizeStorageKey,
  };
});

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const messageController = require('../controllers/messageController');
const socketService = require('../services/socketService');
const storage = require('../utils/storage');

socketService.broadcastToConversation = jest.fn();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'customer-1', first_name: 'Customer', last_name: 'One' };
    next();
  });
  app.get('/api/messages/conversations/:conversationId', messageController.getMessages);
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  });
  return app;
}

const convRow = { customer_id: 'customer-1', helper_id: 'helper-1', business_id: null, status: 'active', archived_at: null };

const messageWithKey = {
  id: 'msg-1',
  conversation_id: 'conv-1',
  sender_id: 'helper-1',
  content: 'see photo',
  attachments: [{
    url: 'https://old.example.com/chat/photo.jpg?exp=1',
    key: 'chat-attachments/photo.jpg',
    type: 'image/jpeg',
    filename: 'photo.jpg',
  }],
  is_read: false,
  created_at: '2026-10-01T12:00:00.000Z',
};

const legacyMessage = {
  id: 'msg-2',
  conversation_id: 'conv-1',
  sender_id: 'helper-1',
  content: 'old file',
  attachments: [{
    url: 'https://old.example.com/chat/legacy.jpg',
    type: 'image/jpeg',
    filename: 'legacy.jpg',
  }],
  is_read: false,
  created_at: '2026-09-01T12:00:00.000Z',
};

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('getMessages read receipts', () => {
  test('does not mark messages read by default', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [messageWithKey] });

    const res = await request(buildApp()).get('/api/messages/conversations/conv-1');

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE messages/.test(sql))).toBe(false);
    expect(socketService.broadcastToConversation).not.toHaveBeenCalledWith(
      'conv-1', 'messages:read', expect.anything(),
    );
  });

  test('marks messages read only when mark_read=true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] }) // marked rows
      .mockResolvedValueOnce({ rows: [messageWithKey] });

    const res = await request(buildApp())
      .get('/api/messages/conversations/conv-1?mark_read=true');

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE messages/.test(sql))).toBe(true);
    expect(socketService.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1', 'messages:read', expect.objectContaining({ readBy: 'customer-1' }),
    );
  });

  test('mark_read=false leaves read state alone', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [messageWithKey] });

    const res = await request(buildApp())
      .get('/api/messages/conversations/conv-1?mark_read=false');

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE messages/.test(sql))).toBe(false);
  });
});

describe('getMessages attachment re-signing', () => {
  test('re-signs attachment URLs that carry a storage key', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [messageWithKey] });

    const res = await request(buildApp()).get('/api/messages/conversations/conv-1');

    expect(res.status).toBe(200);
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('chat-attachments/photo.jpg', 3600);
    const attachment = res.body[0].attachments[0];
    expect(attachment.url).toBe('https://signed.example/fresh?sig=abc');
    // Backward-compatible shape: type/filename still present
    expect(attachment.type).toBe('image/jpeg');
    expect(attachment.filename).toBe('photo.jpg');
  });

  test('keeps legacy attachment URLs without a key untouched', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [legacyMessage] });

    const res = await request(buildApp()).get('/api/messages/conversations/conv-1');

    expect(res.status).toBe(200);
    expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    expect(res.body[0].attachments[0].url).toBe('https://old.example.com/chat/legacy.jpg');
  });
});

describe('getMessages pagination sanity', () => {
  test('clamps negative limits to the minimum instead of passing them through', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .get('/api/messages/conversations/conv-1?limit=-5&offset=-2');

    expect(res.status).toBe(200);
    const selectCall = mockQuery.mock.calls.find(([sql]) => /FROM messages m/.test(sql));
    expect(selectCall[1]).toEqual(['conv-1', 1, 0]);
  });
});
