'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const messageController = require('../controllers/messageController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  });
  app.post('/api/messages/conversations', messageController.getOrCreateConversation);
  return app;
}

beforeEach(() => resetMocks());

describe('getOrCreateConversation', () => {
  test('accepts userId as an alias for helperId', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'helper-1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'conv-9', customer_id: 'user-123', helper_id: 'helper-1' }],
      });

    const res = await request(buildApp())
      .post('/api/messages/conversations')
      .send({ userId: 'helper-1' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('conv-9');
    expect(mockQuery.mock.calls[0][1]).toEqual(['helper-1']);
    expect(mockQuery.mock.calls[1][1][1]).toBe('helper-1');
  });

  test('accepts ownerId as an alias for helperId', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'owner-1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'conv-10', customer_id: 'user-123', helper_id: 'owner-1' }],
      });

    const res = await request(buildApp())
      .post('/api/messages/conversations')
      .send({ ownerId: 'owner-1' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('conv-10');
  });

  test('rejects missing counterpart id', async () => {
    const res = await request(buildApp())
      .post('/api/messages/conversations')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Helper ID is required');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
