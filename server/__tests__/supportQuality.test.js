'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { generateTokens } = require('../middleware/auth');

jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

const supportRoutes = require('../routes/support');
const { logAdminAction } = require('../services/auditService');

const ADMIN_ID = '00000000-0000-4000-8000-000000000889';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/support', supportRoutes);
  app.use(errorHandler);
  return app;
}

function adminAuthHeader() {
  const { accessToken } = generateTokens({ id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin' });
  return `Bearer ${accessToken}`;
}

beforeEach(() => resetMocks());

describe('support QA review routes', () => {
  test('lists pending completed conversations without QA reviews', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin', is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', status: 'resolved', subject: 'Refund question' }] });

    const res = await request(buildApp())
      .get('/api/support/qa/reviews?status=pending')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(1);
    expect(mockQuery.mock.calls.find(([sql]) => String(sql).includes('qa.id IS NULL'))).toBeTruthy();
  });

  test('rejects invalid QA scores before loading a conversation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin', is_active: true }] });

    const res = await request(buildApp())
      .post('/api/support/qa/reviews/conversation-1')
      .set('Authorization', adminAuthHeader())
      .send({ score: 101 });

    expect(res.status).toBe(400);
    expect(res.body.fields.score).toContain('0 to 100');
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('FROM support_conversations'))).toBe(false);
  });

  test('saves an audited QA review for a completed conversation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin', is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', business_id: null, status: 'closed', subject: 'Refund question' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'qa-1', conversation_id: 'conversation-1', reviewer_id: ADMIN_ID, score: 92, notes: 'Clear and accurate.' }] });

    const res = await request(buildApp())
      .post('/api/support/qa/reviews/conversation-1')
      .set('Authorization', adminAuthHeader())
      .send({ score: 92, notes: 'Clear and accurate.' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ score: 92, notes: 'Clear and accurate.' });
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'support_conversation_qa_review_saved',
      targetId: 'conversation-1',
      after: { score: 92, notesProvided: true },
    }));
  });
});
