'use strict';
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'admin', role: 'super_admin' };
    next();
  },
}));
jest.mock('../middleware/adminAuth', () => ({
  requireAdmin: (req, res, next) => next(),
  requirePermission: () => (req, res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const legalRoutes = require('../routes/legalDocuments');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/legal', legalRoutes);
  return app;
}

beforeEach(resetMocks);

test('PUT completed on an opt-out request delegates to completeRequest and returns the suppression', async () => {
  mockQuery.mockImplementation(async sql => {
    const text = String(sql);
    if (text.includes('FROM ccpa_data_requests WHERE id = $1') || text.startsWith('SELECT * FROM ccpa_data_requests')) {
      return { rows: [{ id: 13, user_id: 'subject', status: 'pending', request_type: 'opt_out', email: 'fixture@example.invalid', data_provided: null }] };
    }
    if (text.includes('FROM users WHERE id=$1')) return { rows: [] };
    return { rows: [], rowCount: 0 };
  });
  const response = await request(buildApp())
    .put('/api/legal/ccpa-requests/13')
    .send({ status: 'completed' });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ status: 'completed' });
  expect(response.body.suppression).toMatchObject({ source: 'ccpa_opt_out' });
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('ccpa_opt_out_suppression'))).toBe(true);
});
