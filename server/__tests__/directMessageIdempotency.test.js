'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const directController = require('../controllers/directController');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const CLIENT_MESSAGE_ID = '11111111-1111-4111-8111-111111111111';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: USER_ID, role: 'customer' };
    next();
  });
  app.post('/api/direct/requests/:id/messages', directController.addMessage);
  return app;
}

beforeEach(() => resetMocks());

describe('Direct request message idempotency', () => {
  test('persists the client message id on the first send', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 42, user_id: USER_ID, status: 'new' }] })
      .mockResolvedValueOnce({ rows: [{
        id: 7,
        quote_request_id: 42,
        sender_user_id: USER_ID,
        sender_role: 'customer',
        message: 'Can we schedule this?',
        created_at: '2026-09-22T12:00:00.000Z',
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/direct/requests/42/messages')
      .send({ message: 'Can we schedule this?', clientMessageId: CLIENT_MESSAGE_ID });

    expect(res.status).toBe(201);
    expect(res.body.message.id).toBe('7');
    expect(mockQuery.mock.calls[1][0]).toContain('client_message_id');
    expect(mockQuery.mock.calls[1][1]).toContain(CLIENT_MESSAGE_ID);
  });

  test('replays a committed send without updating the request or appending an event', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 42, user_id: USER_ID, status: 'new' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: 7,
        quote_request_id: 42,
        sender_user_id: USER_ID,
        sender_role: 'customer',
        message: 'Can we schedule this?',
        created_at: '2026-09-22T12:00:00.000Z',
      }] });

    const res = await request(buildApp())
      .post('/api/direct/requests/42/messages')
      .set('Idempotency-Key', CLIENT_MESSAGE_ID)
      .send({ message: 'Can we schedule this?' });

    expect(res.status).toBe(200);
    expect(res.body.message.id).toBe('7');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE quote_requests/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO direct_request_events/.test(sql))).toBe(false);
  });
});
