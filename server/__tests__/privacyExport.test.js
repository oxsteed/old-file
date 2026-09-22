'use strict';

const { mockQuery, resetMocks } = require('./setup');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const privacyRoutes = require('../routes/privacy');
const tokenRevocationService = require('../services/tokenRevocationService');
const { sendOTPEmail } = require('../utils/email');

const USER_ID = '7e3c0d42-54b8-4c0b-8c5c-1d8e9f0a1234';

function buildApp() {
  const app = express();
  app.use(express.json());
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

function hashVerificationValue(value) {
  return crypto.createHmac('sha256', process.env.ENCRYPTION_KEY).update(String(value)).digest('hex');
}

beforeEach(() => {
  resetMocks();
  tokenRevocationService.isRevoked.mockResolvedValue(false);
  sendOTPEmail.mockClear();
});

describe('privacy export verification', () => {
  test('requires the current password before sending a code', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: USER_ID,
      first_name: 'Export',
      last_name: 'Tester',
      email: 'export@example.com',
      role: 'customer',
      is_active: true,
      email_verified: true,
    }] });

    const response = await request(buildApp())
      .post('/api/privacy/export/verification/request')
      .set('Authorization', authHeader())
      .send({ password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'EXPORT_PASSWORD_INVALID' });
    expect(sendOTPEmail).not.toHaveBeenCalled();
  });

  test('issues a challenge and exchanges the emailed code for one-use export authorization', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    mockQuery
      // authenticate, password lookup, remove older challenge, insert challenge
      .mockResolvedValueOnce({ rows: [{ id: USER_ID, email: 'export@example.com', role: 'customer', is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ email: 'export@example.com', password_hash: passwordHash, preferred_language: 'en' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const start = await request(buildApp())
      .post('/api/privacy/export/verification/request')
      .set('Authorization', authHeader())
      .send({ password: 'correct-password' });

    expect(start.status).toBe(200);
    expect(start.body.challengeToken).toMatch(/^[a-f0-9]{64}$/);
    expect(start.body.emailHint).toBe('ex***@example.com');
    expect(sendOTPEmail).toHaveBeenCalledWith('export@example.com', expect.stringMatching(/^\d{6}$/), 'en');

    const code = sendOTPEmail.mock.calls[0][1];
    mockQuery
      // authenticate, challenge lookup, mark challenge verified
      .mockResolvedValueOnce({ rows: [{ id: USER_ID, email: 'export@example.com', role: 'customer', is_active: true }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'challenge-1',
        code_hash: hashVerificationValue(code),
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
        locked_until: null,
        verified_at: null,
        consumed_at: null,
      }] })
      .mockResolvedValueOnce({ rows: [] });

    const verify = await request(buildApp())
      .post('/api/privacy/export/verification/verify')
      .set('Authorization', authHeader())
      .send({ challengeToken: start.body.challengeToken, code });

    expect(verify.status).toBe(200);
    expect(verify.body.exportToken).toMatch(/^[a-f0-9]{64}$/);
    expect(verify.body.exportToken).not.toBe(start.body.challengeToken);
  });

  test('rejects direct export requests without a verified export token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: USER_ID,
      first_name: 'Export',
      last_name: 'Tester',
      email: 'export@example.com',
      role: 'customer',
      is_active: true,
      email_verified: true,
    }] });

    const response = await request(buildApp())
      .get('/api/privacy/export')
      .set('Authorization', authHeader());

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'EXPORT_VERIFICATION_REQUIRED' });
  });
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
      // verified export authorization
      .mockResolvedValueOnce({ rows: [{ id: 'verification-1' }] })
      // export sections
      .mockResolvedValueOnce({ rows: [{ id: USER_ID, first_name: 'Export', last_name: 'Tester' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'job-1', client_id: USER_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      // consume export authorization
      .mockResolvedValueOnce({ rows: [{ id: 'verification-1' }] });

    const response = await request(buildApp())
      .get('/api/privacy/export')
      .set('Authorization', authHeader())
      .set('X-Export-Verification-Token', 'a'.repeat(64))
      .buffer(true)
      .parse(binaryParser);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/zip/);
    expect(response.headers['content-disposition']).toMatch(/oxsteed-data-export-.*\.zip/);
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.subarray(0, 2).toString()).toBe('PK');

    const exportSql = mockQuery.mock.calls.slice(2).map(([sql]) => sql).join('\n');
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
      .mockResolvedValueOnce({ rows: [{ id: 'verification-1' }] })
      .mockRejectedValueOnce(Object.assign(new Error('column "name" does not exist'), { code: '42703' }));

    const response = await request(buildApp())
      .get('/api/privacy/export')
      .set('Authorization', authHeader())
      .set('X-Export-Verification-Token', 'a'.repeat(64))
      .set('X-Request-ID', 'export-test-request');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      code: 'DATA_EXPORT_FAILED',
      error: 'Failed to export data. Please try again.',
      requestId: 'export-test-request',
    });
  });
});
