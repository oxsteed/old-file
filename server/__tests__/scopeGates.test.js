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
const { requestContextMiddleware } = require('../utils/requestContext');

const USER = '00000000-0000-0000-0000-0000000000aa';
const restaurantRow = (over = {}) => ({ id: 7, business_id: 3, effective_role: 'manager', operator_role: 'manager', membership_id: 11, effective_membership_id: 11, ...over });

function app(gate, handler, user = { id: USER, role: 'customer' }) {
  const a = express();
  a.use(requestContextMiddleware);
  a.use(express.json());
  a.use((req, _res, next) => { req.user = user; next(); });
  a.all('/r/:restaurantId', gate, handler);
  a.all('/b/:businessId', gate, handler);
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
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ deleted_at: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1' }] });
    const res = await request(app(requireSupportBusinessAccess('conversations'), ok)).get('/b/5');
    expect(res.status).toBe(200);
  });

  test('platform admins pass unless the route opts out', async () => {
    const admin = { id: USER, role: 'admin' };
    mockQuery.mockResolvedValueOnce({ rows: [{ deleted_at: null }] });
    const yes = await request(app(requireSupportBusinessAccess('administrate'), ok, admin)).get('/b/5');
    expect(yes.status).toBe(200);
    // Only the deleted-business check (decision 5), no membership query.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/deleted_at FROM businesses/);
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

describe('appendAnalystUserScope (One Truth analyst scope)', () => {
  const { appendAnalystUserScope } = require('../services/scopeModel');
  test('null scope is unscoped; arrays bind one param per column; empty array matches nothing', () => {
    const w = []; const p = ['x'];
    appendAnalystUserScope(w, p, 'u.id', null);
    expect([w, p]).toEqual([[], ['x']]);
    appendAnalystUserScope(w, p, ['j.client_id', 'j.assigned_helper_id'], ['a']);
    expect(w).toEqual(['(j.client_id = ANY($2::uuid[]) OR j.assigned_helper_id = ANY($3::uuid[]))']);
    expect(p).toEqual(['x', ['a'], ['a']]);
    const w2 = []; const p2 = [];
    appendAnalystUserScope(w2, p2, 'u.id', []);
    expect(w2).toEqual(['u.id = ANY($1::uuid[])']);
    expect(p2).toEqual([[]]);
  });
});

describe('decision 5: deleted businesses and restaurants', () => {
  const ok = (req, res) => res.json({ role: req.restaurantRole, scope: req.scope });
  const admin = { id: USER, role: 'admin' };
  const deletedAt = '2026-10-01T00:00:00Z';

  test('support membership SQL excludes deleted businesses', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app(requireSupportBusinessAccess('manage'), jest.fn())).get('/b/5');
    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls[0][0]).toMatch(/b\.deleted_at IS NULL/);
  });

  test('support agents cannot work a deleted business queue', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ deleted_at: deletedAt }] });
    const handler = jest.fn();
    const res = await request(app(requireSupportBusinessAccess('conversations'), handler)).get('/b/5');
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('platform admins keep read-only support access to a deleted business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ deleted_at: deletedAt }] });
    const read = await request(app(requireSupportBusinessAccess('manage'), ok, admin)).get('/b/5');
    expect(read.status).toBe(200);
    mockQuery.mockResolvedValueOnce({ rows: [{ deleted_at: deletedAt }] });
    const write = await request(app(requireSupportBusinessAccess('manage'), jest.fn(), admin)).post('/b/5').send({});
    expect(write.status).toBe(403);
  });

  test('owners lose restaurant access when the business is deleted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [restaurantRow({ effective_role: 'owner', business_deleted_at: deletedAt })] });
    const res = await request(app(requireRestaurantAccess(), jest.fn())).get('/r/7');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('restaurant_not_found');
    expect(mockQuery.mock.calls[0][0]).toMatch(/b\.deleted_at AS business_deleted_at/);
  });

  test('platform admins can read a deleted restaurant but not change it', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurantRow({ effective_role: null, business_deleted_at: deletedAt })] })
      .mockResolvedValueOnce({ rows: [] }); // audit insert
    const read = await request(app(requireRestaurantAccess(), ok, admin)).get('/r/7');
    expect(read.status).toBe(200);
    expect(read.body.role).toBe('owner');

    mockQuery.mockResolvedValueOnce({ rows: [restaurantRow({ effective_role: null, business_deleted_at: deletedAt })] });
    const handler = jest.fn();
    const write = await request(app(requireRestaurantAccess(), handler, admin)).patch('/r/7').send({});
    expect(write.status).toBe(409);
    expect(write.body.code).toBe('restaurant_deleted_read_only');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('decision 6: platform admins on individual restaurants', () => {
  const admin = { id: USER, role: 'super_admin' };

  test('admin without membership gets owner access and the request is audit-logged', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurantRow({ effective_role: null, operator_role: null, membership_id: null })] })
      .mockResolvedValueOnce({ rows: [] });
    const handler = async (req, res) => res.json({ role: req.restaurantRole, via: req.scope.restaurantViaPlatformAdmin });
    const res = await request(app(requireRestaurantAccess(), handler, admin)).post('/r/7').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ role: 'owner', via: true });
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/INSERT INTO admin_audit_log/);
    expect(params[0]).toBe(USER);
    expect(params[1]).toBe('restaurant_admin_access:POST');
    expect(params[2]).toBe('food_restaurant');
    expect(params[4]).toBe('restaurant:7');
  });

  test('controller lookups later in the same request still grant the admin', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurantRow({ effective_role: null })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [restaurantRow({ effective_role: null })] });
    const handler = async (req, res, next) => {
      try {
        await scopeModel.resolveRestaurantAccess(req.user.id, 7);
        const fresh = await scopeModel.resolveRestaurantAccess(req.user.id, 7);
        res.json({ role: fresh.effective_role, admin: fresh.platform_admin_access });
      } catch (err) { next(err); }
    };
    const res = await request(app(requireRestaurantAccess(), handler, admin)).get('/r/7');
    expect(res.body).toEqual({ role: 'owner', admin: true });
  });

  test('a failed audit write refuses the request (fail closed)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurantRow({ effective_role: null })] })
      .mockRejectedValueOnce(new Error('audit down'));
    const handler = jest.fn();
    const res = await request(app(requireRestaurantAccess(), handler, admin)).get('/r/7');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('admin_audit_unavailable');
    expect(handler).not.toHaveBeenCalled();
  });

  test('an admin who is also a member is not audited as a platform-admin access', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [restaurantRow({ effective_role: 'manager' })] });
    const res = await request(app(requireRestaurantAccess(), (req, r) => r.json({ role: req.restaurantRole }), admin)).get('/r/7');
    expect(res.body.role).toBe('manager');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('direct lookups outside the gate never grant admins', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [restaurantRow({ effective_role: null })] });
    await expect(scopeModel.resolveRestaurantAccess(USER, 7)).rejects.toMatchObject({ statusCode: 404 });
  });
});
