'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { generateTokens } = require('../middleware/auth');
const supportRoutingController = require('../controllers/supportRoutingController');
const supportRoutingRoutes = require('../routes/supportRouting');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/support-routing', supportRoutingRoutes);
  return app;
}

function authHeader(role = 'customer') {
  const { accessToken } = generateTokens({
    id: '00000000-0000-4000-8000-000000000888',
    email: 'customer@example.com',
    role,
  });
  return `Bearer ${accessToken}`;
}

function authUserRow(role = 'customer') {
  return {
    id: '00000000-0000-4000-8000-000000000888',
    first_name: 'Customer',
    last_name: 'One',
    email: 'customer@example.com',
    role,
    email_verified: true,
    is_verified: true,
    onboarding_status: 'onboarding_complete',
    onboarding_completed: true,
    contact_completed: true,
    profile_completed: true,
    tier_selected: false,
    w9_completed: false,
    terms_accepted: true,
    membership_tier: 'free',
    id_verified: true,
    background_check_passed: false,
    is_active: true,
    didit_status: 'verified',
    didit_enforcement_required: false,
  };
}

beforeEach(() => resetMocks());

afterEach(() => jest.restoreAllMocks());

test('pins customer live-support routing to the primary support business', async () => {
  jest.spyOn(supportRoutingController, 'connectConversation').mockImplementation((req, res) => {
    res.json({ businessId: req.params.businessId });
  });
  mockQuery
    .mockResolvedValueOnce({ rows: [authUserRow()] })
    .mockResolvedValueOnce({ rows: [{ id: 42 }] });

  const res = await request(buildApp())
    .post('/api/support-routing/connect')
    .set('Authorization', authHeader())
    .send({ businessId: 999 });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ businessId: 42 });
});

test('allows platform admins to select an operational support business', async () => {
  jest.spyOn(supportRoutingController, 'connectConversation').mockImplementation((req, res) => {
    res.json({ businessId: req.params.businessId });
  });
  mockQuery.mockResolvedValueOnce({ rows: [authUserRow('super_admin')] });

  const res = await request(buildApp())
    .post('/api/support-routing/connect')
    .set('Authorization', authHeader('super_admin'))
    .send({ businessId: 999 });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ businessId: 999 });
});

describe('GET /:businessId/status (decision 7)', () => {
  const supportEmployerService = require('../services/supportEmployerService');
  const SupportRoutingService = require('../services/supportRoutingService');

  test('reports only that business, after the business access check', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [authUserRow('customer')] });
    const access = jest.spyOn(supportEmployerService, 'userCanAccessBusinessConversations').mockResolvedValue(true);
    const availability = jest.spyOn(SupportRoutingService, 'getLiveAvailability').mockResolvedValue({
      liveAvailableAgents: 1, onlineAgents: 1, availableCapacity: 2, markedAvailableAgents: 1, diagnostics: [],
    });
    const res = await request(buildApp()).get('/api/support-routing/42/status').set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(access).toHaveBeenCalledWith('42', expect.any(String), 'customer');
    expect(availability).toHaveBeenCalledWith('42');
    expect(res.body).toMatchObject({ businessId: '42', liveAvailableAgents: 1, socketAgents: 1 });
    expect(res.body).not.toHaveProperty('customers');
  });

  test('refuses a caller without access to that business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [authUserRow('customer')] });
    jest.spyOn(supportEmployerService, 'userCanAccessBusinessConversations').mockResolvedValue(false);
    const availability = jest.spyOn(SupportRoutingService, 'getLiveAvailability');
    const res = await request(buildApp()).get('/api/support-routing/43/status').set('Authorization', authHeader());
    expect(res.status).toBe(403);
    expect(availability).not.toHaveBeenCalled();
  });
});
