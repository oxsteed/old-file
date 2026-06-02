'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const savedSearchesRoutes = require('../routes/savedSearches');
const { generateTokens } = require('../middleware/auth');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/saved-searches', savedSearchesRoutes);
  return app;
}

function authHeader() {
  const { accessToken } = generateTokens({
    id: 'user-123',
    email: 'user@example.com',
    role: 'customer',
  });
  return `Bearer ${accessToken}`;
}

function authUser() {
  return {
    id: 'user-123',
    email: 'user@example.com',
    role: 'customer',
    email_verified: false,
    is_active: true,
  };
}

beforeEach(() => resetMocks());

describe('Saved searches API', () => {
  test('creates a job alert from the iOS Universal Search Save button payload', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUser()] })
      .mockResolvedValueOnce({
        rows: [{
          id: 77,
          user_id: 'user-123',
          name: 'plumbing',
          keyword: 'plumbing',
          category: null,
          city: null,
          state: null,
          radius_miles: 25,
          min_budget: null,
          max_budget: null,
          notify: true,
        }],
      });

    const res = await request(buildApp())
      .post('/api/saved-searches')
      .set('Authorization', authHeader())
      .send({
        name: 'plumbing',
        keyword: 'plumbing',
        radius_miles: 25,
        notify: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.keyword).toBe('plumbing');
    expect(res.body.notify).toBe(true);
    expect(mockQuery.mock.calls[1][1]).toEqual([
      'user-123',
      'plumbing',
      'plumbing',
      null,
      null,
      null,
      25,
      null,
      null,
      true,
    ]);
  });

  test('rejects empty saved search names', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [authUser()] });

    const res = await request(buildApp())
      .post('/api/saved-searches')
      .set('Authorization', authHeader())
      .send({ name: '   ', keyword: 'plumbing' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name is required/i);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
