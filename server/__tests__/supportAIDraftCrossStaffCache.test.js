'use strict';
// Cost audit 2026-11-04 item 10: the draft cache key is business +
// conversation + content hash + language, WITHOUT requested_by. A second
// staff member drafting the same reply must reuse the first staff
// member's pending draft instead of paying for a second generation.
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

const FIRST_STAFF = '00000000-0000-4000-8000-000000000881';
const SECOND_STAFF = '00000000-0000-4000-8000-000000000882';
const BUSINESS_ID = '42';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000042';

function buildApp() {
  const app = express();
  jest.spyOn(require('../services/supportEmployerService'), 'businessIsDeleted').mockResolvedValue(false);
  app.use(require('../utils/requestContext').requestContextMiddleware);
  app.use(express.json());
  app.use('/api/support', supportRoutes);
  app.use(errorHandler);
  return app;
}

function authHeader(staffId) {
  const { accessToken } = generateTokens({ id: staffId, email: 'staff@example.com', role: 'super_admin' });
  return `Bearer ${accessToken}`;
}

function authUserRow(staffId) {
  return { id: staffId, first_name: 'Support', last_name: 'Staff', email: 'staff@example.com', role: 'super_admin', email_verified: true, is_active: true };
}

beforeEach(() => {
  resetMocks();
  process.env.OPENROUTER_API_KEY = 'synthetic-test-key';
  global.fetch = jest.fn();
});

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete global.fetch;
});

test('a second staff member reuses the first staff member\'s pending draft', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [authUserRow(SECOND_STAFF)] })
    .mockResolvedValueOnce({ rows: [{ id: CONVERSATION_ID, business_id: BUSINESS_ID, status: 'open' }] })
    .mockResolvedValueOnce({ rows: [{ status: 'open' }] })
    .mockResolvedValueOnce({
      rows: [{
        id: 'draft-1',
        business_id: BUSINESS_ID,
        conversation_id: CONVERSATION_ID,
        requested_by: FIRST_STAFF,
        source_content: 'Where is my order?',
        draft_content: 'Thanks for reaching out. We are checking this for you.',
        language: 'en',
        ai_model: 'openrouter',
        status: 'pending',
      }],
    });

  const res = await request(buildApp())
    .post(`/api/support/${BUSINESS_ID}/ai/message`)
    .set('Authorization', authHeader(SECOND_STAFF))
    .send({ conversationId: CONVERSATION_ID, content: 'Where is my order?', language: 'en' });

  expect(res.status).toBe(201);
  expect(res.body.data.id).toBe('draft-1');
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_ai_reply_drafts/.test(sql))).toBe(false);
  const lookup = mockQuery.mock.calls.find(([sql]) => /FROM support_ai_reply_drafts/.test(sql) && /SELECT/.test(sql));
  expect(lookup).toBeDefined();
  expect(lookup[0]).not.toMatch(/requested_by/);
});
