'use strict';

const express = require('express');
const request = require('supertest');
const correlationId = require('../middleware/correlationId');
const { AppError, errorHandler } = require('../middleware/errorHandler');

describe('error handler correlation IDs', () => {
  test('returns the same correlation ID supplied on the request', async () => {
    const app = express();
    app.use(correlationId);
    app.get('/failure', (_req, _res, next) => {
      next(new AppError('Expected failure', 400, 'expected_failure'));
    });
    app.use(errorHandler);

    const res = await request(app)
      .get('/failure')
      .set('x-correlation-id', 'auth-test-correlation-id');

    expect(res.status).toBe(400);
    expect(res.headers['x-correlation-id']).toBe('auth-test-correlation-id');
    expect(res.body.requestId).toBe('auth-test-correlation-id');
  });
});
