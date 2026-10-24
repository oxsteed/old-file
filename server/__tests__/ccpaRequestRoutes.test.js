'use strict';

/**
 * P3-11-F04: the CCPA admin get-single and bulk-complete handlers must be
 * mounted, and the public intake must accept opt_out requests.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      id: req.headers['x-test-user'] || 'user-1',
      role: req.headers['x-test-role'] || 'customer',
    };
    next();
  },
}));
jest.mock('../middleware/adminAuth', () => ({
  requireAdmin: (req, res, next) => {
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  },
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

function userHeaders(userId, role) {
  const headers = {};
  if (userId) headers['x-test-user'] = userId;
  if (role) headers['x-test-role'] = role;
  return headers;
}

function applyHeaders(req, headers) {
  for (const [key, value] of Object.entries(headers)) req.set(key, value);
  return req;
}

beforeEach(resetMocks);

describe('CCPA request routes', () => {
  test('the get-single and bulk-complete routes are mounted', () => {
    const routes = legalRoutes.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
    expect(routes).toContain('GET /ccpa-requests/:requestId');
    expect(routes).toContain('POST /ccpa-requests/bulk/mark-completed');
  });

  test('GET /ccpa-requests/:requestId returns the owning user request', async () => {
    const row = {
      id: 7,
      user_id: 'user-1',
      request_type: 'opt_out',
      email: 'user@example.com',
      status: 'pending',
      submitted_at: new Date().toISOString(),
      due_at: new Date(Date.now() + 45 * 86400000).toISOString(),
      completed_at: null,
      fulfillment_date: null,
      data_provided: null,
      denial_reason: null,
      request_notes: null,
      admin_notes: null,
      fulfilled_by_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockQuery.mockImplementation(async (text) => {
      if (String(text).includes('FROM ccpa_data_requests WHERE id = $1')) return { rows: [row] };
      return { rows: [], rowCount: 0 };
    });

    const response = await applyHeaders(
      request(buildApp()).get('/api/legal/ccpa-requests/7'),
      userHeaders('user-1', 'customer')
    );

    expect(response.status).toBe(200);
    expect(response.body.request).toMatchObject({ id: 7, requestType: 'opt_out' });
  });

  test('GET /ccpa-requests/:requestId forbids other users', async () => {
    const row = { id: 7, user_id: 'user-1', request_type: 'opt_out', due_at: new Date().toISOString() };
    mockQuery.mockImplementation(async (text) => {
      if (String(text).includes('FROM ccpa_data_requests WHERE id = $1')) return { rows: [row] };
      return { rows: [], rowCount: 0 };
    });

    const response = await applyHeaders(
      request(buildApp()).get('/api/legal/ccpa-requests/7'),
      userHeaders('user-2', 'customer')
    );

    expect(response.status).toBe(403);
  });

  test('POST /ccpa-requests/bulk/mark-completed completes requests as admin', async () => {
    mockQuery.mockImplementation(async (text, params) => {
      const sql = String(text);
      if (sql.includes('SELECT * FROM ccpa_data_requests WHERE id=$1 FOR UPDATE')) return { rows: [{ id: params[0], status: 'pending', request_type: 'access', email: 'fixture@example.invalid' }] };
      if (sql.includes('UPDATE ccpa_data_requests')) return { rows: [{ id: 1 }, { id: 2 }] };
      if (sql.includes('INSERT INTO legal_audit_log')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });

    const response = await applyHeaders(
      request(buildApp())
        .post('/api/legal/ccpa-requests/bulk/mark-completed')
        .send({ requestIds: [1, 2] }),
      userHeaders('admin-1', 'super_admin')
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, updatedCount: 2 });
    const updateCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE ccpa_data_requests'));
    expect(String(updateCall[0])).toContain("SET status='completed'");
  });

  test('POST /ccpa-requests/bulk/mark-completed rejects non-admins', async () => {
    const response = await applyHeaders(
      request(buildApp())
        .post('/api/legal/ccpa-requests/bulk/mark-completed')
        .send({ requestIds: [1] }),
      userHeaders('user-1', 'customer')
    );

    expect(response.status).toBe(403);
  });

  test('POST /ccpa-requests accepts opt_out intake', async () => {
    mockQuery.mockImplementation(async (text, params) => {
      const sql = String(text);
      if (sql.includes('FROM ccpa_data_requests') && sql.includes('submitted_at >=')) return { rows: [] };
      if (sql.includes('INSERT INTO ccpa_data_requests')) {
        expect(params[1]).toBe('opt_out');
        return { rows: [{ id: 9, submitted_at: new Date().toISOString(), due_at: new Date().toISOString() }] };
      }
      if (sql.includes('INSERT INTO legal_audit_log')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });

    const response = await applyHeaders(
      request(buildApp())
        .post('/api/legal/ccpa-requests')
        .send({ requestType: 'opt_out', email: 'optout@example.com', requestNotes: 'Do not sell my data.' }),
      userHeaders('user-1', 'customer')
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ success: true, requestId: 9 });
  });
});
