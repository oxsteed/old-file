'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const messageController = require('../controllers/messageController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'customer-1' };
    next();
  });
  app.post('/api/messages/conversations', messageController.getOrCreateConversation);
  return app;
}

beforeEach(() => resetMocks());

describe('progressive access Messages boundary (WP-034)', () => {
  test('approved business representatives use the member_id scope when opening a thread', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'helper-1' }] })
      .mockResolvedValueOnce({ rows: [{ member_id: 'helper-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', business_id: 42 }] });

    const res = await request(buildApp())
      .post('/api/messages/conversations')
      .send({ helperId: 'helper-1', businessId: 42 });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('conversation-1');
    expect(mockQuery.mock.calls[1][0]).toMatch(/business_members\s+WHERE business_id = \$1 AND member_id = \$2/);
    expect(mockQuery.mock.calls[1][0]).not.toMatch(/business_members\s+WHERE business_id = \$1 AND user_id = \$2/);
  });
});
