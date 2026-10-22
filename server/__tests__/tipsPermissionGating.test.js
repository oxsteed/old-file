'use strict';

/**
 * Tips permission catalog gating (auth-audit finding 25).
 *
 * The tip-pool / payroll-exception sub-surfaces were gated by a hard-coded
 * owner/manager role check, invisible to per-membership deny overrides.
 * They now resolve through the permission catalog:
 *   - exceptionsReport, getTipPoolSettings -> tips.view
 *   - updateTipPoolSettings, declareCashTip -> tips.manage
 * (codes seeded by migration 1101; owners/managers hold both by default.)
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');

jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(async () => ({
    id: 42,
    business_id: 7,
    effective_role: 'manager',
    effective_membership_id: 11,
    currency_code: 'USD',
    timezone: 'UTC',
    settings: {},
  })),
}));
jest.mock('../services/permissionsService', () => {
  const actual = jest.requireActual('../services/permissionsService');
  return { ...actual, getEffectivePermissions: jest.fn() };
});
jest.mock('../services/restaurantPayrollService', () => {
  const actual = jest.requireActual('../services/restaurantPayrollService');
  return {
    ...actual,
    computeExceptions: jest.fn(async () => ({ employees: [] })),
    getTipPoolSettings: jest.fn(async () => ({ pooling_enabled: false, tip_out_rules: [] })),
    saveTipPoolSettings: jest.fn(async () => ({ pooling_enabled: true, tip_out_rules: [] })),
    declareCashTip: jest.fn(async (_rid, input) => ({ id: 1, ...input })),
    getRoster: jest.fn(async () => [{ user_id: 'staff-1', name: 'Staff One' }]),
  };
});
jest.mock('../services/restaurantLocationAccessService', () => ({
  getLocationScope: jest.fn(async () => ({ mode: 'all', location_ids: null, assignments: [] })),
  assertLocationAccess: jest.fn(async () => ({ mode: 'all', location_ids: null, assignments: [] })),
}));
jest.mock('../services/businessAuditLog', () => ({
  logBusinessAction: jest.fn(async () => {}),
  listBusinessAudit: jest.fn(async () => ({ rows: [], total: 0 })),
  listBusinessAuditActors: jest.fn(async () => []),
}));

const permissionsService = require('../services/permissionsService');
const payrollService = require('../services/restaurantPayrollService');
const locationAccess = require('../services/restaurantLocationAccessService');
const ctrl = require('../controllers/restaurantPayrollController');
const { errorHandler } = require('../middleware/errorHandler');

function grant(...codes) {
  permissionsService.getEffectivePermissions.mockResolvedValue({ permissions: new Set(codes) });
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'manager-1' };
    next();
  });
  app.get('/r/:restaurantId/exceptions', ctrl.exceptionsReport);
  app.get('/r/:restaurantId/tip-pool', ctrl.getTipPoolSettings);
  app.put('/r/:restaurantId/tip-pool', ctrl.updateTipPoolSettings);
  app.post('/r/:restaurantId/cash-tips', ctrl.declareCashTip);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => errorHandler(err, _req, res, _req));
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('finding 25: tips.view gates the reads', () => {
  test('exceptionsReport 403s without tips.view', async () => {
    grant();
    const res = await request(buildApp()).get('/r/42/exceptions?from=2026-10-01&to=2026-10-21');
    expect(res.status).toBe(403);
    expect(res.body.code || res.body.error).toMatch(/tips/i);
    expect(payrollService.computeExceptions).not.toHaveBeenCalled();
  });

  test('exceptionsReport 200s with tips.view and threads the location scope', async () => {
    grant('tips.view');
    locationAccess.getLocationScope.mockResolvedValueOnce({
      mode: 'assigned', location_ids: [7], assignments: [],
    });
    const res = await request(buildApp()).get('/r/42/exceptions?from=2026-10-01&to=2026-10-21');
    expect(res.status).toBe(200);
    expect(payrollService.computeExceptions).toHaveBeenCalledWith(
      expect.objectContaining({ locationScope: expect.objectContaining({ mode: 'assigned' }) })
    );
  });

  test('getTipPoolSettings 403s without tips.view', async () => {
    grant();
    const res = await request(buildApp()).get('/r/42/tip-pool');
    expect(res.status).toBe(403);
    expect(payrollService.getTipPoolSettings).not.toHaveBeenCalled();
  });

  test('getTipPoolSettings 200s with tips.view', async () => {
    grant('tips.view');
    const res = await request(buildApp()).get('/r/42/tip-pool');
    expect(res.status).toBe(200);
  });
});

describe('finding 25: tips.manage gates the writes', () => {
  test('updateTipPoolSettings 403s without tips.manage', async () => {
    grant('tips.view');
    const res = await request(buildApp()).put('/r/42/tip-pool').send({ poolingEnabled: true });
    expect(res.status).toBe(403);
    expect(payrollService.saveTipPoolSettings).not.toHaveBeenCalled();
  });

  test('updateTipPoolSettings 200s with tips.manage', async () => {
    grant('tips.manage');
    const res = await request(buildApp()).put('/r/42/tip-pool').send({ poolingEnabled: true });
    expect(res.status).toBe(200);
    expect(payrollService.saveTipPoolSettings).toHaveBeenCalled();
  });

  test('declareCashTip 403s without tips.manage', async () => {
    grant('tips.view');
    const res = await request(buildApp()).post('/r/42/cash-tips').send({
      staffUserId: 'staff-1', date: '2026-10-20', amountCents: 500,
    });
    expect(res.status).toBe(403);
    expect(payrollService.declareCashTip).not.toHaveBeenCalled();
  });

  test('declareCashTip passes the store through with tips.manage', async () => {
    grant('tips.manage');
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] }); // location lookup
    const res = await request(buildApp()).post('/r/42/cash-tips').send({
      staffUserId: 'staff-1', date: '2026-10-20', amountCents: 500, locationId: 7,
    });
    expect(res.status).toBe(201);
    expect(locationAccess.assertLocationAccess).toHaveBeenCalled();
    expect(payrollService.declareCashTip).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ locationId: 7 })
    );
  });

  test('declareCashTip rejects an unknown store', async () => {
    grant('tips.manage');
    locationAccess.assertLocationAccess.mockRejectedValueOnce(
      Object.assign(new Error('A valid store is required'), { status: 400, code: 'invalid_location_id' })
    );
    const res = await request(buildApp()).post('/r/42/cash-tips').send({
      staffUserId: 'staff-1', date: '2026-10-20', amountCents: 500, locationId: 999,
    });
    expect(res.status).toBe(400);
    expect(payrollService.declareCashTip).not.toHaveBeenCalled();
  });
});
