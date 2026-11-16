'use strict';

jest.mock('../services/access/accessService', () => ({
  can: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const accessService = require('../services/access/accessService');
const flags = require('../services/access/flags');
const { requireAnyCapability } = require('../middleware/requireAccess');

const gate = requireAnyCapability([
  {
    capability: 'helper.offer_services',
    modeFn: flags.helperEnforcement,
    legacyAllowedFn: (req) => ['helper', 'helper_pro', 'broker'].includes(req.user?.role),
  },
  {
    capability: 'consultant.accept_paying_clients',
    modeFn: flags.consultantEnforcement,
    legacyAllowedFn: (req) => req.user?.role === 'consultant',
  },
]);

function appFor(user = { id: 'u-1', role: 'customer' }) {
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.post('/learn/submit', gate, (_req, res) => res.json({ ok: true }));
  return app;
}

afterEach(() => {
  delete process.env.ACCESS_HELPER_ENFORCEMENT;
  delete process.env.ACCESS_CONSULTANT_ENFORCEMENT;
  accessService.can.mockReset();
});

test('enforced customer-class accounts need a current helper or consultant grant', async () => {
  process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
  process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'enforce';
  accessService.can.mockResolvedValue({ allowed: false, reason: 'not_granted' });

  const res = await request(appFor()).post('/learn/submit');

  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({ code: 'access_required', reason: 'not_granted' });
  expect(accessService.can).toHaveBeenCalledTimes(2);
});

test('an enforced grant satisfies Learn authoring without changing users.role', async () => {
  process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
  process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'enforce';
  accessService.can
    .mockResolvedValueOnce({ allowed: true, reason: 'active_grant' })
    .mockResolvedValueOnce({ allowed: false, reason: 'not_granted' });

  const res = await request(appFor()).post('/learn/submit');

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});

test('legacy helper and consultant accounts remain compatible while enforcement is off', async () => {
  const helper = await request(appFor({ id: 'u-helper', role: 'helper' })).post('/learn/submit');
  const consultant = await request(appFor({ id: 'u-consultant', role: 'consultant' })).post('/learn/submit');

  expect(helper.status).toBe(200);
  expect(consultant.status).toBe(200);
  expect(accessService.can).not.toHaveBeenCalled();
});

