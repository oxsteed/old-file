'use strict';

const express = require('express');
const request = require('supertest');
jest.mock('../services/access/accessService', () => ({ can: jest.fn(), getInvestorAudience: jest.fn() }));
const investorRoutes = require('../routes/investor');
const access = require('../services/access/accessService');

function mountedFixture() {
  const app = express();
  const kpis = investorRoutes.stack.find((layer) => layer.route?.path === '/kpis');
  if (!kpis) throw new Error('Investor KPI route is not mounted');

  // Keep the route's actual middleware chain, but supply the authenticated
  // fixture user and replace only the external authentication/controller
  // boundaries. This exercises the mounted allowInvestor middleware itself.
  kpis.route.stack[0].handle = (_req, _res, next) => next();
  kpis.route.stack[kpis.route.stack.length - 1].handle = (_req, res) => res.json({ reached: true });

  app.use('/api/investor', (req, _res, next) => {
    req.user = { id: 'investor-fixture', role: req.get('x-test-role') || 'customer' };
    next();
  });
  app.use('/api/investor', investorRoutes);
  return app;
}

describe('mounted investor reporting access', () => {
  beforeEach(() => {
    delete process.env.ACCESS_INVESTOR_ENFORCEMENT;
    access.can.mockReset();
    access.getInvestorAudience.mockReset();
  });

  test.each(['admin', 'super_admin'])('%s reaches KPI reporting during explicit legacy rollback', async (role) => {
    process.env.ACCESS_INVESTOR_ENFORCEMENT = 'off';
    const response = await request(mountedFixture()).get('/api/investor/kpis').set('x-test-role', role);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reached: true });
  });

  test('a customer is denied before the reporting handler', async () => {
    process.env.ACCESS_INVESTOR_ENFORCEMENT = 'enforce';
    access.can.mockResolvedValue({ allowed: false, reason: 'no_grant' });
    const response = await request(mountedFixture()).get('/api/investor/kpis').set('x-test-role', 'customer');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'access_required', capability: 'investor.reporting' });
  });

  test('enforce mode lets an approved customer-class grant reach reporting', async () => {
    process.env.ACCESS_INVESTOR_ENFORCEMENT = 'enforce';
    access.can.mockResolvedValue({ allowed: true, reason: 'grant' });
    access.getInvestorAudience.mockResolvedValue({ id: 'audience-1', datasets: ['overview'] });
    const response = await request(mountedFixture()).get('/api/investor/kpis').set('x-test-role', 'customer');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reached: true });
    expect(access.can).toHaveBeenCalledWith('investor-fixture', 'investor.reporting', undefined);
    expect(access.getInvestorAudience).toHaveBeenCalledWith('investor-fixture');
  });

  test('enforce mode denies a customer without an approved grant', async () => {
    process.env.ACCESS_INVESTOR_ENFORCEMENT = 'enforce';
    access.can.mockResolvedValue({ allowed: false, reason: 'no_grant' });
    const response = await request(mountedFixture()).get('/api/investor/kpis').set('x-test-role', 'customer');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'access_required', capability: 'investor.reporting' });
  });

  test('enforce mode denies an approved grant without a live audience', async () => {
    process.env.ACCESS_INVESTOR_ENFORCEMENT = 'enforce';
    access.can.mockResolvedValue({ allowed: true, reason: 'grant' });
    access.getInvestorAudience.mockResolvedValue(null);
    const response = await request(mountedFixture()).get('/api/investor/kpis').set('x-test-role', 'customer');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'investor_audience_required', capability: 'investor.reporting' });
  });
});
