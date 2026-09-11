'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { generateTokens } = require('../middleware/auth');

const supportRoutes = require('../routes/support');

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000888';
const ADMIN_ID = '00000000-0000-4000-8000-000000000889';
const BUSINESS_ID = '7';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/support', supportRoutes);
  app.use(errorHandler);
  return app;
}

function authHeader(id, role, email) {
  const { accessToken } = generateTokens({ id, email, role });
  return `Bearer ${accessToken}`;
}

function authUser(id, role, email) {
  return { id, email, role, is_active: true };
}

beforeEach(() => resetMocks());

describe('support satisfaction surveys', () => {
  test('accepts the valid NPS score of zero and creates one review', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUser(CUSTOMER_ID, 'customer', 'customer@example.com')] })
      .mockResolvedValueOnce({ rows: [{
        id: 'conversation-1', business_id: BUSINESS_ID, customer_id: CUSTOMER_ID,
        agent_id: null, status: 'resolved',
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'survey-1', conversation_id: 'conversation-1', rating: 4, nps_score: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/support/${BUSINESS_ID}/surveys/conversation-1`)
      .set('Authorization', authHeader(CUSTOMER_ID, 'customer', 'customer@example.com'))
      .send({ rating: 4, npsScore: 0, comment: 'Helpful.' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ rating: 4, nps_score: 0 });
    expect(mockQuery.mock.calls.some(([sql, params]) => String(sql).includes('INSERT INTO satisfaction_surveys') && params[5] === 0)).toBe(true);
  });

  test('makes a repeated submission idempotent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUser(CUSTOMER_ID, 'customer', 'customer@example.com')] })
      .mockResolvedValueOnce({ rows: [{
        id: 'conversation-1', business_id: BUSINESS_ID, customer_id: CUSTOMER_ID,
        status: 'closed',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'survey-1', conversation_id: 'conversation-1', rating: 5, nps_score: 10 }] });

    const res = await request(buildApp())
      .post(`/api/support/${BUSINESS_ID}/surveys/conversation-1`)
      .set('Authorization', authHeader(CUSTOMER_ID, 'customer', 'customer@example.com'))
      .send({ rating: 5, npsScore: 10 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, alreadySubmitted: true });
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO satisfaction_surveys'))).toBe(false);
  });

  test('rejects reviews from another customer or an open conversation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUser(CUSTOMER_ID, 'customer', 'customer@example.com')] })
      .mockResolvedValueOnce({ rows: [{
        id: 'conversation-1', business_id: BUSINESS_ID, customer_id: 'other-customer', status: 'resolved',
      }] });

    const forbidden = await request(buildApp())
      .post(`/api/support/${BUSINESS_ID}/surveys/conversation-1`)
      .set('Authorization', authHeader(CUSTOMER_ID, 'customer', 'customer@example.com'))
      .send({ rating: 5, npsScore: 10 });

    expect(forbidden.status).toBe(403);

    resetMocks();
    mockQuery
      .mockResolvedValueOnce({ rows: [authUser(CUSTOMER_ID, 'customer', 'customer@example.com')] })
      .mockResolvedValueOnce({ rows: [{
        id: 'conversation-2', business_id: BUSINESS_ID, customer_id: CUSTOMER_ID, status: 'open',
      }] });

    const invalidState = await request(buildApp())
      .post(`/api/support/${BUSINESS_ID}/surveys/conversation-2`)
      .set('Authorization', authHeader(CUSTOMER_ID, 'customer', 'customer@example.com'))
      .send({ rating: 5, npsScore: 10 });

    expect(invalidState.status).toBe(409);
  });

  test('requires support management access for survey follow-up updates', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUser(CUSTOMER_ID, 'customer', 'customer@example.com')] })
      .mockResolvedValueOnce({ rows: [{ id: 'survey-1', business_id: BUSINESS_ID }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/support/${BUSINESS_ID}/surveys/survey-1/follow-up`)
      .set('Authorization', authHeader(CUSTOMER_ID, 'customer', 'customer@example.com'));

    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('SET follow_up_email_sent'))).toBe(false);
  });
});
