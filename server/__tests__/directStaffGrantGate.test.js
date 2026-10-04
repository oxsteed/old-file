'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const directController = require('../controllers/directController');

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000123';
const ADMIN_ID = '00000000-0000-4000-8000-000000000456';
const SUPER_ID = '00000000-0000-4000-8000-000000000789';
const REQUEST_ROW = {
  id: 42,
  user_id: CUSTOMER_ID,
  status: 'new',
  metadata: null,
  proof_attachment: null,
};

let currentUser = { id: CUSTOMER_ID, role: 'customer' };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = currentUser;
    next();
  });
  app.get('/api/direct/requests/:id', directController.getRequestDetail);
  app.get('/api/direct/requests/:id/messages', directController.getRequestMessages);
  return app;
}

function mockRequestLoad() {
  mockQuery.mockResolvedValueOnce({ rows: [REQUEST_ROW] });
}

function mockTotp(enabled) {
  mockQuery.mockResolvedValueOnce({ rows: [{ totp_enabled: enabled }] });
}

function mockGrant(hasGrant) {
  mockQuery.mockResolvedValueOnce({
    rows: hasGrant ? [{ id: 1, region_id: null, grant_source: 'direct' }] : [],
  });
}

function mockPresentTail() {
  mockQuery.mockResolvedValueOnce({ rows: [] }); // direct_request_messages
  mockQuery.mockResolvedValueOnce({ rows: [] }); // direct_request_events
}

beforeEach(() => {
  resetMocks();
  currentUser = { id: CUSTOMER_ID, role: 'customer' };
});

describe('DG1: staff grant + MFA gate on direct request detail/messages', () => {
  test('admin without MFA (totp disabled) cannot read a customer request', async () => {
    currentUser = { id: ADMIN_ID, role: 'admin' };
    mockRequestLoad();
    mockTotp(false);

    const res = await request(buildApp()).get('/api/direct/requests/42');
    expect(res.status).toBe(403);
  });

  test('admin with MFA but no manage_operations grant cannot read messages', async () => {
    currentUser = { id: ADMIN_ID, role: 'admin' };
    mockRequestLoad();
    mockTotp(true);
    mockGrant(false);

    const res = await request(buildApp()).get('/api/direct/requests/42/messages');
    expect(res.status).toBe(403);
  });

  test('admin with MFA and an active grant can read the request', async () => {
    currentUser = { id: ADMIN_ID, role: 'admin' };
    mockRequestLoad();
    mockTotp(true);
    mockGrant(true);
    mockPresentTail();

    const res = await request(buildApp()).get('/api/direct/requests/42');
    expect(res.status).toBe(200);
    expect(res.body.request.id).toBe('42');
  });

  test('super-admin with MFA bypasses the grant check but not the MFA check', async () => {
    currentUser = { id: SUPER_ID, role: 'super_admin' };
    mockRequestLoad();
    mockTotp(true);
    mockPresentTail();

    const res = await request(buildApp()).get('/api/direct/requests/42');
    expect(res.status).toBe(200);
    expect(
      mockQuery.mock.calls.some(([sql]) => /admin_permission_grants/.test(sql))
    ).toBe(false);
  });

  test('super-admin without MFA is denied', async () => {
    currentUser = { id: SUPER_ID, role: 'super_admin' };
    mockRequestLoad();
    mockTotp(false);

    const res = await request(buildApp()).get('/api/direct/requests/42');
    expect(res.status).toBe(403);
  });

  test('customer owner still reads their own request without staff checks', async () => {
    currentUser = { id: CUSTOMER_ID, role: 'customer' };
    mockRequestLoad();
    mockPresentTail();

    const res = await request(buildApp()).get('/api/direct/requests/42');
    expect(res.status).toBe(200);
    expect(res.body.request.id).toBe('42');
    expect(
      mockQuery.mock.calls.some(([sql]) => /totp_enabled|admin_permission_grants/.test(sql))
    ).toBe(false);
  });

  test('customer who does not own the request is still denied', async () => {
    currentUser = { id: '00000000-0000-4000-8000-000000000999', role: 'customer' };
    mockRequestLoad();

    const res = await request(buildApp()).get('/api/direct/requests/42');
    expect(res.status).toBe(403);
  });
});
