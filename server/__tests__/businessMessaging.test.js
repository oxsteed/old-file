'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/businessMessagingController');

const OWNER = {
  id: '00000000-0000-4000-8000-000000000456',
  email: 'owner@example.com',
};

function buildApp(user = OWNER) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.get('/api/businesses/:businessId/messages', ctrl.getConversations);
  app.post('/api/businesses/:businessId/messages', ctrl.createConversation);
  app.get('/api/businesses/:businessId/messages/:conversationId', ctrl.getConversation);
  app.post('/api/businesses/:businessId/messages/:conversationId', ctrl.sendMessage);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('business hub messaging tab', () => {
  test('lists conversations without querying business_team_members', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'conv-1',
          conversation_type: 'team',
          subject: 'Staff huddle',
          customer_name: null,
          last_message_at: '2026-09-21T12:00:00.000Z',
          message_count: '2',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(buildApp()).get('/api/businesses/1/messages');
    expect(res.status).toBe(200);
    expect(res.body.conversations).toHaveLength(1);
    expect(res.body.conversations[0].subject).toBe('Staff huddle');
    const sql = mockQuery.mock.calls.map(([q]) => q).join('\n');
    expect(sql).not.toMatch(/business_team_members/);
    expect(sql).toMatch(/business_conversations/);
  });

  test('returns 403 when the user cannot access the business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/businesses/1/messages');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  test('loads a conversation thread without invalid json_agg LIMIT SQL', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'conv-1', business_id: 1, conversation_type: 'team', subject: 'Staff huddle' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'msg-1', content: 'Hello team', sender_type: 'team_member', sender_name: 'Ada Lovelace' }],
      });

    const res = await request(buildApp()).get('/api/businesses/1/messages/conv-1');
    expect(res.status).toBe(200);
    expect(res.body.messages[0].content).toBe('Hello team');
    const sql = mockQuery.mock.calls.map(([q]) => q).join('\n');
    expect(sql).not.toMatch(/json_agg\([^\)]*LIMIT/);
    expect(sql).toMatch(/FROM business_messages bm/);
  });

  test('sends a message using first/last name instead of users.display_name', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conv-1', business_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'msg-2', content: 'On my way', sender_type: 'team_member' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/businesses/1/messages/conv-1')
      .send({ content: 'On my way', message_type: 'text' });

    expect(res.status).toBe(201);
    const insertSql = mockQuery.mock.calls.find(([sql]) => /INSERT INTO business_messages/.test(sql))[0];
    expect(insertSql).toMatch(/first_name/);
    expect(insertSql).not.toMatch(/display_name/);
  });
});
