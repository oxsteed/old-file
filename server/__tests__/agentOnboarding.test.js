'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { generateTokens } = require('../middleware/auth');
const supportRoutes = require('../routes/support');

const USER_ID = '00000000-0000-4000-8000-000000000991';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/support', supportRoutes);
  app.use(errorHandler);

  mockQuery.mockImplementation(async (sql) => {
    if (/FROM users u/.test(sql)) {
      return {
        rows: [{
          id: USER_ID,
          first_name: 'Applicant',
          last_name: 'User',
          email: 'applicant@example.com',
          role: 'customer',
          email_verified: true,
          is_verified: true,
          onboarding_status: 'onboarding_complete',
          onboarding_completed: true,
          is_active: true,
          didit_status: 'verified',
          didit_enforcement_required: false,
        }],
      };
    }
    return { rows: [] };
  });
  return app;
}

function authHeader() {
  const { accessToken } = generateTokens({ id: USER_ID, email: 'applicant@example.com', role: 'customer' });
  return `Bearer ${accessToken}`;
}

beforeEach(() => resetMocks());

describe('support agent onboarding validation', () => {
  test('does not create an employer for a nonexistent business', async () => {
    const res = await request(buildApp())
      .post('/api/support/42/apply')
      .set('Authorization', authHeader())
      .send({ jobTitle: 'Support specialist' });

    expect(res.status).toBe(404);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_employers/.test(sql))).toBe(false);
  });

  test('rejects oversized application fields before database work', async () => {
    const res = await request(buildApp())
      .post('/api/support/apply')
      .set('Authorization', authHeader())
      .send({ businessId: 42, jobTitle: 'Support specialist', coverLetter: 'x'.repeat(5001) });

    expect(res.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls.some(([sql]) => /FROM businesses|INSERT INTO support_employers|INSERT INTO agent_applications/.test(sql))).toBe(false);
  });
});
