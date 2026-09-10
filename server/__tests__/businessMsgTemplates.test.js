'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { generateTokens } = require('../middleware/auth');
const routes = require('../routes/businessMsgTemplates');

const USER_ID = '00000000-0000-4000-8000-000000000990';

function buildApp(role) {
  const app = express();
  app.use(express.json());
  app.use('/api/businesses', routes);

  const user = {
    id: USER_ID,
    first_name: 'Business',
    last_name: 'User',
    email: 'business@example.com',
    role,
    email_verified: true,
    is_verified: true,
    onboarding_status: 'onboarding_complete',
    onboarding_completed: true,
    is_active: true,
    didit_status: 'verified',
    didit_enforcement_required: false,
  };

  mockQuery.mockImplementation(async (sql) => {
    if (/FROM users u/.test(sql)) return { rows: [user] };
    if (/FROM businesses b/.test(sql)) {
      return { rows: [{ id: 42, business_name: 'Test Business', is_primary: true, tax_rate: 0, owner_id: USER_ID, effective_role: role, membership_id: null }] };
    }
    if (/FROM business_message_templates/.test(sql)) return { rows: [] };
    return { rows: [] };
  });

  app.use(errorHandler);
  return app;
}

function authHeader(role) {
  const { accessToken } = generateTokens({ id: USER_ID, email: 'business@example.com', role });
  return `Bearer ${accessToken}`;
}

beforeEach(() => resetMocks());

describe('business message template permissions', () => {
  test('blocks representatives from creating templates', async () => {
    const res = await request(buildApp('representative'))
      .post('/api/businesses/42/message-templates')
      .set('Authorization', authHeader('representative'))
      .send({ name: 'Reply', category: 'support', body: 'Thanks for reaching out.' });

    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO business_message_templates/.test(sql))).toBe(false);
  });

  test('keeps manager template reads available', async () => {
    const res = await request(buildApp('manager'))
      .get('/api/businesses/42/message-templates')
      .set('Authorization', authHeader('manager'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
