'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../controllers/PayoutController', () => {
  const handler = (req, res) => res.json({ capabilityGateReached: !!req.helperCapabilityGateReached });
  return {
    getPayoutMethods: handler,
    createPayoutMethod: handler,
    updatePayoutMethod: handler,
    deletePayoutMethod: handler,
  };
});
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'customer-1', role: 'customer' }; next(); },
}));
jest.mock('../middleware/requireUserTotpStepUp', () => ({
  requireUserTotpStepUp: (_req, _res, next) => next(),
}));
jest.mock('../middleware/helperOnboardingMiddleware', () => ({
  requireOnboardingStep: () => (_req, _res, next) => next(),
}));
jest.mock('../middleware/requireAccess', () => ({
  requireHelperCapability: jest.fn((req, _res, next) => {
    req.helperCapabilityGateReached = true;
    next();
  }),
}));

const { requireHelperCapability } = require('../middleware/requireAccess');
const router = require('../routes/payoutRoutes');

test('payout-method writes pass through the progressive helper capability gate', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', router);

  const res = await request(app)
    .post('/api/payout-methods')
    .send({ method_type: 'bank_account' });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ capabilityGateReached: true });
  expect(requireHelperCapability).toHaveBeenCalledTimes(1);
});

