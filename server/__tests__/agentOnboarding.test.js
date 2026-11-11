'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { generateTokens } = require('../middleware/auth');
const supportRoutes = require('../routes/support');
const controller = require('../controllers/agentOnboardingController');
const supportEmployerService = require('../services/supportEmployerService');

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
afterEach(() => jest.restoreAllMocks());

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

  test('approve and hire commits the agent and application state together', async () => {
    jest.spyOn(supportEmployerService, 'userCanManageEmployer').mockResolvedValue(true);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'app-1', employer_id: 'employer-1', business_id: 42, user_id: 'user-1', status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1', user_id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    await controller.approveAndHire({
      params: { applicationId: 'app-1' },
      body: { role: 'agent' },
      user: { id: USER_ID, role: 'super_admin' },
    }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ agent: expect.objectContaining({ id: 'agent-1' }) }),
    }));
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE agent_applications/.test(sql))).toBe(true);
  });
});
