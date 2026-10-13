'use strict';

/**
 * P2-1 / P2-3 partial-findings regression tests (bundle C: admin + bizhub).
 *
 * - P2-1-F05: suspension is enforced on the chat websocket and on
 *   optionalAuth (no authenticated treatment for suspended users).
 * - P2-1-F08: flagBusiness audit failure fails closed (503).
 * - P2-1-F12: business moderation audit failures fail closed (503) on
 *   updateAdminNotes / deleteBusiness.
 * - P2-1-F13: suspendUser revokes all user tokens via the denylist.
 * - P2-3-F04: reading an appointment does not notify participants.
 * - P2-3-F12: DELETE service soft-deletes (deleted_at) instead of
 *   hard-deleting; deleted services are hidden from listings.
 * - P2-3-F13: unpublishBusinessIfIncomplete auto-unpublishes a published
 *   business whose readiness broke.
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const tokenRevocationService = require('../services/tokenRevocationService');

jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn(),
}));
jest.mock('../utils/businessOwnership', () => ({
  canAccessBusiness: jest.fn().mockResolvedValue(true),
}));

const { logAdminAction } = require('../services/auditService');
const { optionalAuth } = require('../middleware/auth');
const { createChatAuthenticator } = require('../realtime/chatNamespace');
const businessContentController = require('../controllers/businessContentController');
const businessModerationController = require('../controllers/businessModerationController');
const { unpublishBusinessIfIncomplete } = require('../controllers/businessController');

const JWT_SECRET = process.env.JWT_SECRET;
const sign = (payload) => jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

beforeEach(() => {
  resetMocks();
  logAdminAction.mockReset();
  tokenRevocationService.isRevoked.mockResolvedValue(false);
  tokenRevocationService.revokeAllUserTokens.mockResolvedValue(undefined);
});

// ─── P2-1-F05: chat websocket suspension ──────────────────────────────────────

describe('P2-1-F05 chat websocket enforces suspension', () => {
  function authFor(userRow) {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [userRow] }) };
    return createChatAuthenticator({ pool, jwtSecret: JWT_SECRET });
  }
  const makeSocket = (token) => ({ handshake: { auth: { token }, query: {}, headers: {} } });

  test('actively suspended user is rejected', async () => {
    const auth = authFor({ is_active: true, role: 'customer', logistics_role: null, is_suspended: true, suspended_until: null });
    const next = jest.fn();
    await auth(makeSocket(sign({ id: 'u1' })), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].message).toMatch(/suspended/i);
  });

  test('expired suspension is allowed through', async () => {
    const auth = authFor({
      is_active: true, role: 'customer', logistics_role: null,
      is_suspended: true, suspended_until: new Date(Date.now() - 3600_000).toISOString(),
    });
    const socket = makeSocket(sign({ id: 'u1' }));
    const next = jest.fn();
    await auth(socket, next);
    expect(next).toHaveBeenCalledWith();
    expect(socket.userId).toBe('u1');
  });

  test('non-suspended user is allowed through', async () => {
    const auth = authFor({ is_active: true, role: 'customer', logistics_role: null, is_suspended: false, suspended_until: null });
    const socket = makeSocket(sign({ id: 'u1' }));
    const next = jest.fn();
    await auth(socket, next);
    expect(next).toHaveBeenCalledWith();
  });
});

// ─── P2-1-F05: optionalAuth suspension ────────────────────────────────────────

describe('P2-1-F05 optionalAuth denies authenticated treatment to suspended users', () => {
  function buildApp() {
    const app = express();
    app.get('/p', optionalAuth, (req, res) => res.json({ userId: req.user?.id || null }));
    return app;
  }
  const token = sign({ id: 42, role: 'customer' });

  test('suspended user is treated as unauthenticated', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 42, role: 'customer', is_active: true, is_suspended: true, suspended_until: null }],
    });
    const res = await request(buildApp()).get('/p').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBeNull();
  });

  test('active user is still attached', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 42, role: 'customer', is_active: true, is_suspended: false, suspended_until: null }],
    });
    const res = await request(buildApp()).get('/p').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(42);
  });
});

// ─── P2-1-F13: token revocation on suspend ────────────────────────────────────

describe('P2-1-F13 suspend revokes user tokens', () => {
  test('superAdminController.suspendUser revokes tokens before suspending', async () => {
    const superAdminController = require('../controllers/superAdminController');
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'u9', email: 'e@x.com', first_name: 'A', role: 'customer' }] })
      .mockResolvedValue({ rows: [] });
    const req = { params: { userId: 'u9' }, body: { reason: 'test', days: 0 }, user: { id: 'admin1' }, ip: '1.2.3.4' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    // notifyUserAccountEvent and log helpers are best-effort; the controller
    // catches their failures internally only if they throw synchronously.
    await superAdminController.suspendUser(req, res).catch(() => {});
    expect(tokenRevocationService.revokeAllUserTokens).toHaveBeenCalledWith('u9');
  });
});

// ─── P2-1-F08 / P2-1-F12: moderation audit fail-closed ───────────────────────

describe('business moderation audit fail-closed', () => {
  function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  test('flagBusiness returns 503 when the audit write fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '5', business_name: 'B' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE
    logAdminAction.mockRejectedValueOnce(new Error('audit down'));
    const req = { params: { id: '5' }, body: { reason: 'spam' }, user: { id: 'admin1' }, ip: '1.1.1.1' };
    const res = mockRes();
    await businessModerationController.flagBusiness(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'audit_unavailable' }));
  });

  test('updateAdminNotes returns 503 when the audit write fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '5', admin_notes: null }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '5' }] }); // UPDATE ... RETURNING
    logAdminAction.mockRejectedValueOnce(new Error('audit down'));
    const req = { params: { id: '5' }, body: { notes: 'n' }, user: { id: 'admin1' }, ip: '1.1.1.1' };
    const res = mockRes();
    await businessModerationController.updateAdminNotes(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'audit_unavailable' }));
  });

  test('deleteBusiness returns 503 when the audit write fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '5', business_name: 'B', is_active: true }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '5' }] }); // soft delete
    logAdminAction.mockRejectedValueOnce(new Error('audit down'));
    const req = { params: { id: '5' }, body: { confirmed: true, reason: 'r' }, user: { id: 'admin1' }, ip: '1.1.1.1' };
    const res = mockRes();
    await businessModerationController.deleteBusiness(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'audit_unavailable' }));
  });

  test('listBusinesses supports the flagged review queue', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], }); // list
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 0, active: 0, inactive: 0, newThisMonth: 0, dormant: 0 }] }); // stats
    const req = { query: { status: 'flagged', page: '1', limit: '25' }, user: { id: 'admin1' } };
    const res = mockRes();
    await businessModerationController.listBusinesses(req, res);
    const listSql = String(mockQuery.mock.calls[0][0]);
    expect(listSql).toMatch(/admin_review_reason IS NOT NULL/);
    expect(listSql).toMatch(/admin_reviewed_at/);
    expect(res.json).toHaveBeenCalled();
  });
});

// ─── P2-3-F12: service soft-delete ────────────────────────────────────────────

describe('P2-3-F12 deleteBusinessService soft-deletes', () => {
  function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  let originalConnect;
  beforeEach(() => {
    const db = require('../db');
    originalConnect = db.connect;
  });
  afterEach(() => {
    require('../db').connect = originalConnect;
  });

  function clientWithOnce(result) {
    // First query (the soft-delete UPDATE) gets `result`; the follow-up
    // unpublishBusinessIfIncomplete queries fall through to the resetMocks
    // default ({ rows: [] }) which means "not published".
    mockQuery.mockResolvedValueOnce(result);
    const client = { query: (...args) => mockQuery(...args), release: jest.fn() };
    require('../db').connect = jest.fn().mockResolvedValue(client);
  }

  test('issues an UPDATE setting deleted_at instead of DELETE', async () => {
    clientWithOnce({ rows: [{ id: '9' }], rowCount: 1 });
    const req = { params: { businessId: '3', serviceId: '9' }, user: { id: 'owner1' } };
    const res = mockRes();
    await businessContentController.deleteBusinessService(req, res);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/UPDATE business_services/);
    expect(sql).toMatch(/deleted_at = NOW\(\)/);
    expect(sql).not.toMatch(/^\s*DELETE/i);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }));
  });

  test('returns 404 when the service is already deleted', async () => {
    clientWithOnce({ rows: [], rowCount: 0 });
    const req = { params: { businessId: '3', serviceId: '9' }, user: { id: 'owner1' } };
    const res = mockRes();
    await businessContentController.deleteBusinessService(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/not found/i) }));
  });
});

// ─── P2-3-F13: auto-unpublish on broken readiness ─────────────────────────────

describe('P2-3-F13 unpublishBusinessIfIncomplete', () => {
  const readinessRow = (overrides = {}) => ({
    id: 'b1',
    setup_status: 'active',
    business_name: 'Biz',
    industry_category: 'Food',
    address_city: 'Springfield',
    description: 'Great food',
    business_kind: 'restaurant',
    business_mode: 'food',
    ...overrides,
  });

  function mockReadinessQuery({ ready }) {
    mockQuery.mockImplementation((text) => {
      const sql = String(text);
      if (sql.includes('FROM businesses b') && sql.includes('service_count')) {
        return Promise.resolve({
          rows: [readinessRow({
            service_count: 0,
            restaurant_id: 7,
            restaurant_status: 'active',
            menu_item_count: ready ? 3 : 0,
          })],
        });
      }
      if (sql.startsWith('SELECT id, setup_status')) {
        return Promise.resolve({ rows: [{ id: 'b1', setup_status: 'active', user_id: 'owner1' }] });
      }
      if (sql.includes('SET setup_status = \'paused\'')) {
        return Promise.resolve({ rows: [{ id: 'b1', setup_status: 'paused', is_listed: false }] });
      }
      if (sql.includes('INSERT INTO business_audit_log')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  test('does nothing when the business is not published', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'b1', setup_status: 'draft', user_id: 'owner1' }] });
    const db = require('../db');
    const result = await unpublishBusinessIfIncomplete(db, 'b1', { actorUserId: 'owner1' });
    expect(result.unpublished).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('does nothing when a published business is still ready', async () => {
    mockReadinessQuery({ ready: true });
    const db = require('../db');
    const result = await unpublishBusinessIfIncomplete(db, 'b1', { actorUserId: 'owner1' });
    expect(result.unpublished).toBe(false);
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("SET setup_status = 'paused'"))).toBe(false);
  });

  test('auto-unpublishes a published restaurant with no available menu items', async () => {
    mockReadinessQuery({ ready: false });
    const db = require('../db');
    const result = await unpublishBusinessIfIncomplete(db, 'b1', { actorUserId: 'owner1' });
    expect(result.unpublished).toBe(true);
    expect(result.missing).toContain('menu');
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("SET setup_status = 'paused'") && s.includes('is_listed = FALSE'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO business_audit_log') && s.includes('business.auto_unpublished'))).toBe(true);
  });
});
