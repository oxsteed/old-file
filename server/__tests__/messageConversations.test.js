'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const messageController = require('../controllers/messageController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'customer-1', first_name: 'Customer', last_name: 'One' };
    next();
  });
  app.get('/api/messages/conversations', messageController.getConversations);
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  });
  return app;
}

function convRow(id, total) {
  return {
    id,
    job_id: null,
    customer_id: 'customer-1',
    helper_id: 'helper-1',
    business_id: null,
    status: 'active',
    archived_at: null,
    last_message_at: '2026-10-02T12:00:00.000Z',
    created_at: '2026-10-01T12:00:00.000Z',
    updated_at: '2026-10-02T12:00:00.000Z',
    other_user_name: 'Helper One',
    other_user_id: 'helper-1',
    job_title: null,
    last_message: 'hi',
    last_message_sender_id: 'helper-1',
    helper_business_name: null,
    conversation_business_name: null,
    unread_count: '0',
    _total_count: String(total),
  };
}

beforeEach(() => resetMocks());

describe('getConversations pagination', () => {
  test('returns the paginated envelope with hasMore', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [convRow('c1', 3), convRow('c2', 3)] });

    const res = await request(buildApp()).get('/api/messages/conversations?limit=2');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.limit).toBe(2);
    expect(res.body.offset).toBe(0);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.conversations).toHaveLength(2);
    // Internal window-function column is stripped from the response
    expect(res.body.conversations[0]).not.toHaveProperty('_total_count');
    expect(res.body.conversations[0].id).toBe('c1');
  });

  test('hasMore is false on the last page', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [convRow('c3', 3)] });

    const res = await request(buildApp()).get('/api/messages/conversations?limit=2&offset=2');

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.offset).toBe(2);
  });

  test('defaults to limit 50 and offset 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/messages/conversations');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ conversations: [], total: 0, limit: 50, offset: 0, hasMore: false });
    const params = mockQuery.mock.calls[0][1];
    expect(params[params.length - 2]).toBe(50);
    expect(params[params.length - 1]).toBe(0);
  });

  test('caps limit at 100 and floors offset at 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/messages/conversations?limit=500&offset=-3');

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
    expect(res.body.offset).toBe(0);
    const params = mockQuery.mock.calls[0][1];
    expect(params[params.length - 2]).toBe(100);
    expect(params[params.length - 1]).toBe(0);
  });

  test('passes limit/offset through to the SQL query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(buildApp()).get('/api/messages/conversations?limit=10&offset=20');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('LIMIT $');
    expect(sql).toContain('OFFSET $');
    expect(params[params.length - 2]).toBe(10);
    expect(params[params.length - 1]).toBe(20);
  });
});
