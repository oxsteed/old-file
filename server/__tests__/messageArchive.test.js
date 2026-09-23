'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const messageController = require('../controllers/messageController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: 'rep-123',
      first_name: 'Emile',
      last_name: 'Philippe',
    };
    next();
  });
  app.post('/api/messages/conversations/:conversationId/archive', messageController.archiveConversation);
  app.post('/api/messages/conversations/:conversationId/restore', messageController.restoreConversation);
  app.get('/api/messages/archived', messageController.getArchivedConversations);
  return app;
}

beforeEach(() => resetMocks());

describe('message archive routes', () => {
  test('POST /messages/conversations/:id/archive allows active business members', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ customer_id: 'customer-1', helper_id: 'helper-1', business_id: 7 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'conv-1', archived_at: '2026-06-02T12:00:00.000Z' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/messages/conversations/conv-1/archive')
      .send({ reason: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('conv-1');
    expect(mockQuery.mock.calls[0][0]).toContain('business_members');
    expect(mockQuery.mock.calls[1][0]).toMatch(/SET status = 'archived', archived_at = NOW\(\), archived_by = \$2/);
  });

  test('POST /messages/conversations/:id/restore allows active business members', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ customer_id: 'customer-1', helper_id: 'helper-1', business_id: 7 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'conv-1', archived_at: null }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/messages/conversations/conv-1/restore');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('conv-1');
    expect(mockQuery.mock.calls[0][0]).toContain('business_members');
    expect(mockQuery.mock.calls[1][0]).toMatch(/SET status = 'active', archived_at = NULL, archived_by = NULL/);
  });

  test('GET /messages/archived includes conversations available through business membership', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'conv-1',
          business_id: 7,
          archived_at: '2026-06-02T12:00:00.000Z',
          other_user_name: 'Customer One',
          job_title: 'Paint office',
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 });

    const res = await request(buildApp()).get('/api/messages/archived');

    expect(res.status).toBe(200);
    expect(res.body.archived[0].id).toBe('conv-1');
    expect(res.body.total).toBe(1);
    expect(mockQuery.mock.calls[0][0]).toContain('business_members');
    expect(mockQuery.mock.calls[1][0]).toContain('business_members');
  });

  test('restores a legacy status-only archived conversation', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ customer_id: 'customer-1', helper_id: 'helper-1', business_id: null }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'legacy-1', status: 'active', archived_at: null, archived_by: null }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/messages/conversations/legacy-1/restore');

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][0]).toContain("status = 'archived'");
    expect(mockQuery.mock.calls[1][0]).toContain('archived_at IS NOT NULL OR status =');
  });
});
