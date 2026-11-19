'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../services/access/accessService', () => ({ can: jest.fn() }));
const franchiseRoutes = require('../routes/franchise');
const access = require('../services/access/accessService');

function mountedFixture() {
  const app = express();
  const territory = franchiseRoutes.stack.find((layer) => layer.route?.path === '/territory-stats');
  if (!territory) throw new Error('Franchise territory route is not mounted');

  // Keep the route's actual rollout and capability middleware, replacing only
  // authentication and the territory controller boundary.
  territory.route.stack[0].handle = (_req, _res, next) => next();
  territory.route.stack[territory.route.stack.length - 1].handle = (_req, res) => res.json({ reached: true });

  app.use('/api/franchise', (req, _res, next) => {
    req.user = {
      id: 'franchise-fixture',
      role: req.get('x-test-role') || 'customer',
      default_mode: req.get('x-test-mode') || 'customer',
    };
    next();
  });
  app.use('/api/franchise', franchiseRoutes);
  return app;
}

describe('mounted franchise territory access', () => {
  beforeEach(() => {
    delete process.env.ACCESS_FRANCHISE_ENFORCEMENT;
    access.can.mockReset();
  });

  test('legacy rollout keeps the territory route available', async () => {
    process.env.ACCESS_FRANCHISE_ENFORCEMENT = 'off';
    const response = await request(mountedFixture()).get('/api/franchise/territory-stats');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reached: true });
  });

  test('enforce mode denies a customer without a territory grant', async () => {
    process.env.ACCESS_FRANCHISE_ENFORCEMENT = 'enforce';
    access.can.mockResolvedValue({ allowed: false, reason: 'no_grant' });
    const response = await request(mountedFixture()).get('/api/franchise/territory-stats');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'access_required', capability: 'franchise.operate' });
  });

  test('enforce mode lets an approved territory grant reach operations', async () => {
    process.env.ACCESS_FRANCHISE_ENFORCEMENT = 'enforce';
    access.can.mockResolvedValue({ allowed: true, reason: 'grant' });
    const response = await request(mountedFixture()).get('/api/franchise/territory-stats');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reached: true });
    // G-26: the franchise gate evaluates "any active territory grant".
    expect(access.can).toHaveBeenCalledWith('franchise-fixture', 'franchise.operate', { type: 'any' });
  });
});
