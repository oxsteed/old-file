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

function authRow() {
  return { id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin', is_active: true };
}

beforeEach(() => resetMocks());

describe('support follow-up reminder routes', () => {
  const futureDueAt = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

  test('rejects a reminder due date in the past without loading the database', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [authRow()] });
    const res = await request(buildApp())
      .post('/api/support/conversations/conversation-1/follow-up-reminders')
      .set('Authorization', adminAuthHeader())
      .send({ dueAt: '2020-01-01T00:00:00.000Z', note: 'Call customer' });

    expect(res.status).toBe(400);
    expect(res.body.fields.dueAt).toContain('past');
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('FROM support_conversations'))).toBe(false);
  });

  test('creates a reminder for an accessible conversation and records an audit event', async () => {
    const dueAt = futureDueAt();
    mockQuery
      .mockResolvedValueOnce({ rows: [authRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', business_id: null, agent_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'reminder-1', conversation_id: 'conversation-1', due_at: '2030-01-02T12:00:00.000Z', status: 'pending', note: 'Check the customer account.' }] });

    const res = await request(buildApp())
      .post('/api/support/conversations/conversation-1/follow-up-reminders')
      .set('Authorization', adminAuthHeader())
      .send({ dueAt, note: 'Check the customer account.' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: 'reminder-1', status: 'pending' });
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'support_follow_up_reminder_created',
      targetId: 'conversation-1',
    }));
  });

  test('marks a reminder completed and records the previous state', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'reminder-1', conversation_id: 'conversation-1', status: 'pending', business_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', business_id: null, agent_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'reminder-1', conversation_id: 'conversation-1', status: 'completed' }] });

    const res = await request(buildApp())
      .patch('/api/support/follow-up-reminders/reminder-1')
      .set('Authorization', adminAuthHeader())
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('completed');
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'support_follow_up_reminder_updated',
      before: { status: 'pending' },
      after: { status: 'completed' },
    }));
  });
});
