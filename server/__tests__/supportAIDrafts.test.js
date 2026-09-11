'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { generateTokens } = require('../middleware/auth');

jest.mock('../services/websocketService', () => ({
  broadcastToTicket: jest.fn(),
}));
jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

const supportRoutes = require('../routes/support');
const WebSocketService = require('../services/websocketService');
const { logAdminAction } = require('../services/auditService');

const ADMIN_ID = '00000000-0000-4000-8000-000000000889';
const BUSINESS_ID = '42';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000042';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/support', supportRoutes);
  app.use(errorHandler);
  return app;
}

function adminAuthHeader() {
  const { accessToken } = generateTokens({
    id: ADMIN_ID,
    email: 'admin@example.com',
    role: 'super_admin',
  });
  return `Bearer ${accessToken}`;
}

function authUserRow() {
  return {
    id: ADMIN_ID,
    first_name: 'Support',
    last_name: 'Admin',
    email: 'admin@example.com',
    role: 'super_admin',
    email_verified: true,
    is_active: true,
  };
}

beforeEach(() => {
  resetMocks();
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'Thanks for reaching out. We are checking this for you.' } }] }),
  });
});

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete global.fetch;
});

describe('approval-gated support AI drafts', () => {
  test('creates an audited draft without inserting a customer-visible message', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: CONVERSATION_ID, business_id: BUSINESS_ID, status: 'open' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'draft-1',
          business_id: BUSINESS_ID,
          conversation_id: CONVERSATION_ID,
          requested_by: ADMIN_ID,
          source_content: 'Where is my order?',
          draft_content: 'Thanks for reaching out. We are checking this for you.',
          language: 'en',
          ai_model: 'openrouter',
          status: 'pending',
        }],
      });

    const res = await request(buildApp())
      .post(`/api/support/${BUSINESS_ID}/ai/message`)
      .set('Authorization', adminAuthHeader())
      .send({ conversationId: CONVERSATION_ID, content: 'Where is my order?', language: 'en' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, draft: true, data: { status: 'pending' } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_conversation_messages/.test(sql))).toBe(false);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'support_ai_reply_draft_previewed',
      targetId: CONVERSATION_ID,
    }));
  });

  test('applies a pending draft transactionally as a public agent reply', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'draft-1',
          business_id: BUSINESS_ID,
          conversation_id: CONVERSATION_ID,
          customer_id: 'customer-1',
          agent_id: null,
          draft_content: 'Thanks for reaching out. We are checking this for you.',
          ai_model: 'openrouter',
          status: 'pending',
          conversation_status: 'open',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'message-1', content: 'Thanks for reaching out. We are checking this for you.', created_at: '2026-09-10T00:00:00.000Z' }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'draft-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .post(`/api/support/${BUSINESS_ID}/ai/drafts/draft-1/apply`)
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, data: { id: 'message-1' } });
    expect(mockQuery.mock.calls.some(([sql, values]) => /INSERT INTO support_conversation_messages/.test(sql) && values[1] === ADMIN_ID)).toBe(true);
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
      CONVERSATION_ID,
      'message:new',
      expect.objectContaining({ isInternal: false, isAI: true })
    );
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'support_ai_reply_draft_applied' }));
  });

  test('discards a pending draft without sending a message', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({
        rows: [{ id: 'draft-1', conversation_id: CONVERSATION_ID, business_id: BUSINESS_ID, customer_id: 'customer-1', agent_id: null }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'draft-1', status: 'discarded' }], rowCount: 1 });

    const res = await request(buildApp())
      .post(`/api/support/${BUSINESS_ID}/ai/drafts/draft-1/discard`)
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'discarded' } });
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_conversation_messages/.test(sql))).toBe(false);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'support_ai_reply_draft_discarded' }));
  });

  test('fails closed when the AI provider is not configured', async () => {
    delete process.env.OPENROUTER_API_KEY;
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: CONVERSATION_ID, business_id: BUSINESS_ID, status: 'open' }] });

    const res = await request(buildApp())
      .post(`/api/support/${BUSINESS_ID}/ai/message`)
      .set('Authorization', adminAuthHeader())
      .send({ conversationId: CONVERSATION_ID, content: 'Please help', language: 'en' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/manual reply/i);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_ai_reply_drafts/.test(sql))).toBe(false);
  });

  test('does not create drafts for closed conversations', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: CONVERSATION_ID, business_id: BUSINESS_ID, status: 'closed' }] });

    const res = await request(buildApp())
      .post(`/api/support/${BUSINESS_ID}/ai/message`)
      .set('Authorization', adminAuthHeader())
      .send({ conversationId: CONVERSATION_ID, content: 'Please help', language: 'en' });

    expect(res.status).toBe(409);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
