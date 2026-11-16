'use strict';

jest.mock('../controllers/paymentLayersController', () => {
  const handler = (req, res) => res.json({ ok: true });
  return {
    getConfig: handler,
    getPaymentOptions: handler,
    createCreditQuote: handler,
    getRailSwitch: handler,
    requestRailSwitch: handler,
    respondRailSwitch: handler,
    getOfflinePayment: handler,
    confirmOfflinePayment: handler,
    listTips: handler,
    quoteTip: handler,
    createTip: handler,
    getCashoutEligibility: handler,
    listCashouts: handler,
    requestCashout: handler,
    issueCashoutStepup: handler,
    cancelCashout: handler,
    listPayoutDestinations: handler,
    addPayoutDestination: handler,
    verifyPayoutDestination: handler,
    removePayoutDestination: handler,
    getErasureStatus: handler,
    requestErasure: handler,
    adminListPolicies: handler,
    adminUpdatePolicy: handler,
    adminListPartners: handler,
  };
});
jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'customer-1', role: 'customer' }; next(); },
}));
jest.mock('../middleware/rejectImpersonated', () => ({
  rejectImpersonated: (_req, _res, next) => next(),
}));
jest.mock('../middleware/checkRestrictions', () => jest.fn(() => (req, _res, next) => {
  req.checkoutRestrictionChecked = true;
  next();
}));
jest.mock('../middleware/rateLimiter', () => ({
  paymentsLimiter: (_req, _res, next) => next(),
  generalLimiter: (_req, _res, next) => next(),
}));
jest.mock('../middleware/errorHandler', () => ({ errorHandler: (err, _req, res, _next) => res.status(500).json({ error: err.message }) }));

const express = require('express');
const request = require('supertest');
const checkRestrictions = require('../middleware/checkRestrictions');
const router = require('../routes/paymentLayers');

test('offline payment confirmation re-checks checkout restrictions', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/payment-layers', router);

  const res = await request(app)
    .post('/api/payment-layers/jobs/job-1/offline-payment/confirm')
    .send({ acknowledge_not_covered: true });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
  expect(checkRestrictions).toHaveBeenCalledWith('checkout');
});

