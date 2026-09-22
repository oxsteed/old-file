'use strict';

const { mockQuery, resetMocks } = require('./setup');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const privacyRoutes = require('../routes/privacy');
const tokenRevocationService = require('../services/tokenRevocationService');

const USER_ID = '7e3c0d42-54b8-4c0b-8c5c-1d8e9f0a1234';

function buildApp() {
  const app = express();
  app.use('/api/privacy', privacyRoutes);
  return app;
}

function authHeader() {
  const token = jwt.sign(
    { id: USER_ID, email: 'export@example.com', role: 'customer' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' },
  );
  return `Bearer ${token}`;
}

function binaryParser(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

beforeEach(() => {
  resetMocks();
  tokenRevocationService.isRevoked.mockResolvedValue(false);
});

describe('GET /api/privacy/export', () => {
  test('exports data using the current users and jobs schema', async () => {
    mockQuery
      // authenticate
      .mockResolvedValueOnce({ rows: [{
        id: USER_ID,
        first_name: 'Export',
        last_name: 'Tester',
        email: 'export@example.com',
        role: 'customer',
        is_active: true,
        email_verified: false,
      }] })
      // export sections
      .mockResolvedValueOnce({ rows: [{ id: USER_ID, first_name: 'Export', last_name: 'Tester' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'job-1', client_id: USER_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(buildApp())
      .get('/api/privacy/export')
      .set('Authorization', authHeader())
      .buffer(true)
      .parse(binaryParser);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/zip/);
    expect(response.headers['content-disposition']).toMatch(/oxsteed-data-export-.*\.zip/);
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.subarray(0, 2).toString()).toBe('PK');

    const exportSql = mockQuery.mock.calls.slice(1).map(([sql]) => sql).join('\n');
    expect(exportSql).toContain('first_name');
    expect(exportSql).toContain('client_id');
    expect(exportSql).toContain('assigned_helper_id');
    expect(exportSql).not.toContain('customer_id = $1');
    expect(exportSql).not.toContain('FROM users WHERE id = $1');
  });

  test('returns a stable error code and request ID when export storage fails', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        id: USER_ID,
        first_name: 'Export',
        last_name: 'Tester',
        email: 'export@example.com',
        role: 'customer',
        is_active: true,
        email_verified: false,
      }] })
      .mockRejectedValueOnce(Object.assign(new Error('column "name" does not exist'), { code: '42703' }));

    const response = await request(buildApp())
      .get('/api/privacy/export')
      .set('Authorization', authHeader())
      .set('X-Request-ID', 'export-test-request');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      code: 'DATA_EXPORT_FAILED',
      error: 'Failed to export data. Please try again.',
      requestId: 'export-test-request',
    });
  });
});
