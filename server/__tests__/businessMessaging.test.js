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
  app.post('/api/businesses/:businessId/messages/:conversationId/attachments', ctrl.uploadAttachment);
  app.post('/api/businesses/:businessId/messages/:conversationId', ctrl.sendMessage);
  app.post('/api/businesses/:businessId/messages/:conversationId/restore', ctrl.restoreConversation);
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
    expect(sql).toMatch(/unread_count/);
    expect(sql).toMatch(/last_message/);
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
    expect(sql).toMatch(/business_conversation_participants/);
  });

  test('marks the latest business message read for the member opening the thread', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conv-1', business_id: 1, conversation_type: 'team' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1', content: 'Hello team', sender_type: 'team_member' }] });

    const res = await request(buildApp()).get('/api/businesses/1/messages/conv-1');
    expect(res.status).toBe(200);
    const threadSql = mockQuery.mock.calls[2][0];
    expect(threadSql).toMatch(/INSERT INTO business_conversation_participants/);
    expect(threadSql).toMatch(/ON CONFLICT \(conversation_id, user_id\)/);
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

  test('replays a team message by client ID without updating the conversation twice', async () => {
    const clientMessageId = '22222222-2222-4222-8222-222222222222';
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conv-1', business_id: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'msg-2', content: 'On my way', client_message_id: clientMessageId }] });

    const res = await request(buildApp())
      .post('/api/businesses/1/messages/conv-1')
      .set('Idempotency-Key', clientMessageId)
      .send({ content: 'On my way', message_type: 'text' });

    expect(res.status).toBe(200);
    expect(res.body.client_message_id).toBe(clientMessageId);
    expect(mockQuery.mock.calls[2][0]).toContain('client_message_id');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE business_conversations/.test(sql))).toBe(false);
  });

  test('commits message attachments with the message and does not add them on replay', async () => {
    const clientMessageId = '44444444-4444-4444-8444-444444444444';
    const attachment = {
      file_name: 'receipt.pdf',
      file_url: 'https://cdn.example.com/receipt.pdf',
      file_size_bytes: 1024,
      file_type: 'application/pdf',
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conv-1', business_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'msg-3', content: 'See the receipt', client_message_id: clientMessageId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conv-1', business_id: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, content: 'See the receipt', client_message_id: clientMessageId }] });

    const app = buildApp();
    const body = { content: 'See the receipt', attachments: [attachment] };
    const first = await request(app)
      .post('/api/businesses/1/messages/conv-1')
      .set('Idempotency-Key', clientMessageId)
      .send(body);
    const retry = await request(app)
      .post('/api/businesses/1/messages/conv-1')
      .set('Idempotency-Key', clientMessageId)
      .send(body);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO business_message_attachments/.test(sql))).toHaveLength(1);
    expect(mockQuery.mock.calls.filter(([sql]) => /UPDATE business_conversations/.test(sql))).toHaveLength(1);
  });

  test('rejects an empty team message unless it has an attachment', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conv-1', business_id: 1 }] });

    const res = await request(buildApp())
      .post('/api/businesses/1/messages/conv-1')
      .send({ content: '', attachments: [] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  test('requires a file before uploading a business attachment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] });

    const res = await request(buildApp())
      .post('/api/businesses/1/messages/conv-1/attachments');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  test('includes archived conversations only when explicitly requested', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res = await request(buildApp()).get('/api/businesses/1/messages?include_archived=true&archived_only=true');
    expect(res.status).toBe(200);
    const listSql = mockQuery.mock.calls[1][0];
    expect(listSql).toContain("bc.status = 'archived'");
  });

  test('restores an archived business conversation', async () => {
    const restored = { id: 'conv-archived', business_id: 1, status: 'active' };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [restored] });

    const res = await request(buildApp())
      .post('/api/businesses/1/messages/conv-archived/restore');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(restored);
    expect(mockQuery.mock.calls[1][0]).toContain("status = 'active'");
    expect(mockQuery.mock.calls[1][0]).toContain("status = 'archived'");
  });

  test('replays a conversation creation without creating a duplicate thread', async () => {
    const clientRequestId = '33333333-3333-4333-8333-333333333333';
    const conversation = {
      id: 'conv-2',
      business_id: 1,
      conversation_type: 'customer',
      created_by_id: OWNER.id,
      client_request_id: clientRequestId,
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [conversation] })
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [conversation] });

    const app = buildApp();
    const body = { conversation_type: 'customer', customer_email: 'customer@example.com', subject: 'Order question' };
    const first = await request(app)
      .post('/api/businesses/1/messages')
      .set('Idempotency-Key', clientRequestId)
      .send(body);
    const second = await request(app)
      .post('/api/businesses/1/messages')
      .set('Idempotency-Key', clientRequestId)
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(expect.objectContaining({ id: conversation.id, idempotent: true }));
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO business_conversations/.test(sql))).toHaveLength(2);
  });
});
