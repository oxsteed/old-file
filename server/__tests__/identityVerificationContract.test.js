'use strict';

const express = require('express');
const request = require('supertest');
const stripe = require('stripe');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const controller = require('../controllers/verificationController');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => { req.user = { id: 'user-identity-1' }; next(); });
  instance.post('/identity', controller.createIdentitySession);
  instance.use(errorHandler);
  return instance;
}

beforeEach(() => {
  resetMocks();
  stripe.__mockInstance.identity = { verificationSessions: { create: jest.fn() } };
});

test('identity verification fails closed before persistence when Stripe omits the URL', async () => {
  stripe.__mockInstance.identity.verificationSessions.create.mockResolvedValueOnce({ id: 'vs_missing_url', url: null });

  const response = await request(app()).post('/identity');

  expect(response.status).toBe(503);
  expect(response.body.code).toBe('identity_verification_unavailable');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('identity verification accepts only a complete HTTPS session', () => {
  expect(controller._requireIdentitySession({ id: 'vs_1', url: 'https://verify.stripe.com/vs_1' })).toEqual({
    id: 'vs_1', url: 'https://verify.stripe.com/vs_1',
  });
  expect(() => controller._requireIdentitySession({ id: 'vs_1', url: 'http://verify.stripe.com/vs_1' })).toThrow(/temporarily unavailable/i);
});

