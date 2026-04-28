'use strict';

const { mockQuery, resetMocks } = require('./setup');

const express = require('express');
const request = require('supertest');

jest.mock('@otplib/v12-adapter', () => ({
  authenticator: {
    options: {},
    verify: jest.fn().mockReturnValue(true),
    generateSecret: jest.fn().mockReturnValue('TESTSECRET'),
    keyuri: jest.fn().mockReturnValue('otpauth://totp/OxSteed:test@example.com?secret=TESTSECRET'),
  },
}));

jest.mock('../middleware/validateFileUpload', () => (req, res, next) => next());
jest.mock('../middleware/upload', () => ({
  single: () => (req, res, next) => next(),
}));

const helperRegistrationRoutes = require('../routes/helperRegistration');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/helper-registration', helperRegistrationRoutes);
  return app;
}

beforeEach(() => resetMocks());

describe('POST /api/helper-registration/start', () => {
  test('normalizes trimmed fields before DB insert', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // duplicate email check
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // pendingRegistrationsHasRoleColumn
      .mockResolvedValueOnce({ rows: [] }) // delete existing pending row
      .mockResolvedValueOnce({ rows: [{ token: 'generated-token' }] }); // insert pending row

    const res = await request(buildApp())
      .post('/api/helper-registration/start')
      .send({
        email: '  HELPER@Example.com  ',
        password: 'SecurePass123!',
        firstName: '  Helper  ',
        lastName: '  User  ',
        phone: '  +1 (234) 567-8901  ',
        addressLine1: '  99 Oak Ave  ',
        city: ' Columbus ',
        state: ' oh ',
        zip: ' 12345 ',
        ageConfirmed: true,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');

    const insertArgs = mockQuery.mock.calls[3][1];
    expect(insertArgs[1]).toBe('helper@example.com');
    expect(insertArgs[3]).toBe('Helper');
    expect(insertArgs[4]).toBe('User');
    expect(insertArgs[5]).toBe('+1 (234) 567-8901');
    expect(insertArgs[6]).toBe('12345');
    expect(insertArgs[7]).toBe('99 Oak Ave');
    expect(insertArgs[8]).toBe('Columbus');
    expect(insertArgs[9]).toBe('OH');
  });

  test('returns 400 for DB field length overflow instead of 500', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // duplicate email check
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // pendingRegistrationsHasRoleColumn
      .mockResolvedValueOnce({ rows: [] }) // delete existing pending row
      .mockRejectedValueOnce({ code: '22001' }); // insert too long for varchar

    const res = await request(buildApp())
      .post('/api/helper-registration/start')
      .send({
        email: 'helper@example.com',
        password: 'SecurePass123!',
        firstName: 'Helper',
        lastName: 'User',
        phone: '+12345678901',
        addressLine1: '1 Elm',
        city: 'Toledo',
        state: 'OH',
        zip: '12345',
        ageConfirmed: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
  });
});
