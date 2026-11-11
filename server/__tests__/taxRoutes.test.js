'use strict';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { mockQuery, resetMocks } = require('./setup');
const taxRoutes = require('../routes/tax');

const USER = {
  id: 'tax-user-1',
  email: 'tax@example.com',
  role: 'helper',
  email_verified: true,
  is_active: true,
};
const TOKEN = jwt.sign({ typ: 'access', sid: 'tax-test-session', ...USER }, process.env.JWT_SECRET);

function buildApp() {
  const app = express();
  app.use('/api/tax', taxRoutes);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => resetMocks());

test('does not turn a summary database failure into zero income', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [USER] })
    .mockRejectedValueOnce(new Error('database unavailable'));

  const res = await request(buildApp())
    .get('/api/tax/summary?year=2025')
    .set('Authorization', `Bearer ${TOKEN}`);

  expect(res.status).toBe(500);
  expect(res.body.error).toBe('database unavailable');
});
