'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const {
  requireRestaurantAccess,
  requireSupportBusinessAccess,
  supportScopeSatisfies,
  scopedBusinessId,
  scopedRestaurantId,
} = require('../middleware/scopeGates');
const scopeModel = require('../services/scopeModel');

const USER = '00000000-0000-0000-0000-0000000000aa';
const restaurantRow = (over = {}) => ({ id: 7, business_id: 3, effective_role: 'manager', operator_role: 'manager', membership_id: 11, effective_membership_id: 11, ...over });

function app(gate, handler, user = { id: USER, role: 'customer' }) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = user; next(); });
  a.get('/r/:restaurantId', gate, handler);
  a.get('/b/:businessId', gate, handler);
  a.use(errorHandler);
  return a;
}

beforeEach(() => resetMocks());

describe('requireRestaurantAccess gate', () => {
  test('hands the resolved row to the controller lookup without a second query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [restaurantRow()] });
    const handler = async (req, res, next) => {
      try {
        const first = await scopeModel.resolveRestaurantAccess(req.user.id, Number(req.params.restaurantId));
        res.json({ id: first.id, role: first.effective_role, scoped: scopedRestaurantId(req), calls: mockQuery.mock.calls.length });
      } catch (err) { next(err); }
    };
    const res = await request(app(requireRestaurantAccess(), handler)).get('/r/7');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 7, role: 'manager', scoped: '7', calls: 1 });
  });

  test('only the first lookup is handed off; later lookups read fresh', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [restaurantRow()] }).mockResolvedValueOnce({ rows: [restaurantRow({ effective_role: 'owner' })] });
    const handler = async (req, res) => {
      await scopeModel.resolveRestaurantAccess(req.user.id, req.params.restaurantId);
      const second = await scopeModel.resolveRestaurantAccess(req.user.id, req.params.restaurantId);
      res.json({ role: second.effective_role, calls: mockQuery.mock.calls.length });
    };
    const res = await request(app(requireRestaurantAccess(), handler)).get('/r/7');
    expect(res.body).toEqual({ role: 'owner', calls: 2 });
  });

  test('another restaurant or another user is never served from the hand-off', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [restaurantRow()] }).mockResolvedValueOnce({ rows: [] });
    const handler = async (req, res, next) => {
      try { await scopeModel.resolveRestaurantAccess('someone-else', 7); res.json({ ok: true }); } catch (err) { next(err); }
    };
    const res = await request(app(requireRestaurantAccess(), handler)).get('/r/7');
    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('no standing is the same 404 restaurant_not_found as the controller wrappers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const handler = jest.fn();
    const res = await request(app(requireRestaurantAccess(), handler)).get('/r/7');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('restaurant_not_found');
    expect(handler).not.toHaveBeenCalled();
  });

  test('non-numeric ids are 404 without querying', async () => {
    const res = await request(app(requireRestaurantAccess(), jest.fn())).get('/r/abc');
    expect(res.status).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('unauthenticated callers get 401', async () => {
    const res = await request(app(requireRestaurantAccess(), jest.fn(), null)).get('/r/7');
    expect(res.status).toBe(401);
  });
});

describe('requireSupportBusinessAccess gate', () => {
  const ok = (req, res) => res.json({ scope: req.scope, business: scopedBusinessId(req) });

  test('administrate uses the owner/manager/representative rule', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const res = await request(app(requireSupportBusinessAccess('administrate'), ok)).get('/b/5');
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/bm\.role IN \('manager', 'representative'\)/);
    expect(res.body.business).toBe('5');
  });

  test('denial is the same 403 Access denied the controllers return', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const handler = jest.fn();
    const res = await request(app(requireSupportBusinessAccess('manage'), handler)).get('/b/5');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Access denied' });
    expect(handler).not.toHaveBeenCalled();
  });

  test('conversations level admits an employed support agent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'agent-1' }] });
    const res = await request(app(requireSupportBusinessAccess('conversations'), ok)).get('/b/5');
    expect(res.status).toBe(200);
  });

  test('platform admins pass unless the route opts out', async () => {
    const admin = { id: USER, role: 'admin' };
    const yes = await request(app(requireSupportBusinessAccess('administrate'), ok, admin)).get('/b/5');
    expect(yes.status).toBe(200);
    expect(mockQuery).not.toHaveBeenCalled();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const no = await request(app(requireSupportBusinessAccess('manage', { platformAdmins: false }), ok, admin)).get('/b/5');
    expect(no.status).toBe(403);
  });

  test('supportScopeSatisfies honours level order and the exact business', () => {
    const req = { scope: { businessId: '5', supportLevel: 'manage' } };
    expect(supportScopeSatisfies(req, '5', 'conversations')).toBe(true);
    expect(supportScopeSatisfies(req, 5, 'manage')).toBe(true);
    expect(supportScopeSatisfies(req, '5', 'administrate')).toBe(false);
    expect(supportScopeSatisfies(req, '6', 'conversations')).toBe(false);
    expect(supportScopeSatisfies({}, '5', 'conversations')).toBe(false);
  });
});

describe('scoped id accessors fail closed', () => {
  test('without a gate they throw scope_gate_missing', () => {
    expect(() => scopedBusinessId({ params: { businessId: '5' } })).toThrow(/scope unavailable/i);
    expect(() => scopedRestaurantId({ params: { restaurantId: '7' } })).toThrow(/scope unavailable/i);
  });

  test('requireBusinessAccess sets the canonical business id', () => {
    expect(scopedBusinessId({ business: { id: 12 } })).toBe('12');
  });
});
