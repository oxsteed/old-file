'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const messageController = require('../controllers/messageController');
const socketService = require('../services/socketService');

socketService.broadcastToConversation = jest.fn();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'customer-1', first_name: 'Customer', last_name: 'One' };
    next();
  });
  app.put('/api/messages/conversations/:conversationId/:messageId', messageController.editMessage);
  app.delete('/api/messages/conversations/:conversationId/:messageId', messageController.deleteMessage);
  app.post('/api/messages/conversations/:conversationId/:messageId/reactions', messageController.addReaction);
  app.delete('/api/messages/conversations/:conversationId/:messageId/reactions', messageController.removeReaction);
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  });
  return app;
}

const recentMessage = (overrides = {}) => ({
  id: 'msg-1',
  sender_id: 'customer-1',
  conversation_id: 'conv-1',
  deleted_at: null,
  created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
  content: 'hello',
  ...overrides,
});

const oldMessage = () => recentMessage({
  created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
});

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('editMessage', () => {
  test('edits within the 15-minute window', async () => {
    const updated = { ...recentMessage(), content: 'hello edited', edited_at: new Date().toISOString() };
    mockQuery
      .mockResolvedValueOnce({ rows: [recentMessage()] })
      .mockResolvedValueOnce({ rows: [] }) // no blocks
      .mockResolvedValueOnce({ rows: [updated] });

    const res = await request(buildApp())
      .put('/api/messages/conversations/conv-1/msg-1')
      .send({ content: 'hello edited' });

    expect(res.status).toBe(200);
    expect(res.body.content).toBe('hello edited');
    expect(socketService.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1', 'message:updated', expect.anything(),
    );
  });

  test('rejects edits after the 15-minute window', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [oldMessage()] });

    const res = await request(buildApp())
      .put('/api/messages/conversations/conv-1/msg-1')
      .send({ content: 'too late' });

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('edit_window_expired');
    expect(mockQuery.mock.calls.some(([sql]) => /^UPDATE messages SET content/.test(sql.trim()))).toBe(false);
  });

  test('rejects edits when a block exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [recentMessage()] })
      .mockResolvedValueOnce({ rows: [{ blocked: 1 }] });

    const res = await request(buildApp())
      .put('/api/messages/conversations/conv-1/msg-1')
      .send({ content: 'blocked edit' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('blocked_by_user');
  });

  test('masks phone numbers in edited content', async () => {
    const updated = { ...recentMessage(), content: 'call ·······' };
    mockQuery
      .mockResolvedValueOnce({ rows: [recentMessage()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [updated] });

    const res = await request(buildApp())
      .put('/api/messages/conversations/conv-1/msg-1')
      .send({ content: 'call 5551234' });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[2][1][0]).toBe('call ·······');
  });
});

describe('deleteMessage', () => {
  test('rejects deletion when a block exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [recentMessage()] })
      .mockResolvedValueOnce({ rows: [{ blocked: 1 }] });

    const res = await request(buildApp())
      .delete('/api/messages/conversations/conv-1/msg-1');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('blocked_by_user');
    expect(mockQuery.mock.calls.some(([sql]) => /SET deleted_at/.test(sql))).toBe(false);
  });

  test('deletes when no block exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [recentMessage()] })
      .mockResolvedValueOnce({ rows: [] }) // no blocks
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] });

    const res = await request(buildApp())
      .delete('/api/messages/conversations/conv-1/msg-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('reactions', () => {
  const convRow = { customer_id: 'customer-1', helper_id: 'helper-1', business_id: null };

  test('rejects addReaction when a block exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [{ blocked: 1 }] });

    const res = await request(buildApp())
      .post('/api/messages/conversations/conv-1/msg-1/reactions')
      .send({ reaction: 'heart' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('blocked_by_user');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO message_reactions/.test(sql))).toBe(false);
  });

  test('rejects removeReaction when a block exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [{ blocked: 1 }] });

    const res = await request(buildApp())
      .delete('/api/messages/conversations/conv-1/msg-1/reactions')
      .send({ reaction: 'heart' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('blocked_by_user');
  });

  test('adds a reaction when no block exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [convRow] })
      .mockResolvedValueOnce({ rows: [] }) // no blocks
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] }) // message exists
      .mockResolvedValueOnce({ rows: [{ message_id: 'msg-1', user_id: 'customer-1', reaction: 'heart' }] })
      .mockResolvedValueOnce({ rows: [{ reaction: 'heart', count: '1', users: ['customer-1'] }] });

    const res = await request(buildApp())
      .post('/api/messages/conversations/conv-1/msg-1/reactions')
      .send({ reaction: 'heart' });

    expect(res.status).toBe(201);
    expect(res.body.reaction).toBe('heart');
  });
});
