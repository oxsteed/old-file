'use strict';

/**
 * adminBundleBRoutes.test.js
 *
 * Route-wiring contract for the Bundle B admin-audit fix wave:
 * - ADM-006: /api/admin/logistics enforces the admin TOTP hard-block for
 *   admin-role sessions (requireAdminTotp, router-level)
 * - ADM-027: featured placement routes require the manage_marketing grant
 * - ADM-039: consultingAdmin write routes require the manage_operations grant
 *   (reads unchanged)
 */

const { mockQuery, resetMocks } = require('./setup');

const ok = (name) => (req, res) => res.json({ ok: name });

jest.mock('../controllers/logisticsAdminController', () => {
  const h = {};
  ['approveProduct','approveSupplier','createMarkupRule','createSupplier',
   'createSupplierProduct','getAudit','getStats','getSupplier','listClaims',
   'listCountryAccessRules','listFeeRules','listMarkupRules',
   'listPendingOrganizerApprovals','listQuotes','listRefundCases','listSuppliers',
   'updateClaim','updateFeeRule','updateMarkupRule','updateRefundCase',
   'updateSupplier','upsertCountryAccessRule'].forEach((n) => { h[n] = (req, res) => res.json({ ok: n }); });
  return h;
});
jest.mock('../controllers/logisticsLanesController', () => ({
  createLane: (req, res) => res.json({ ok: 'createLane' }),
  updateLane: (req, res) => res.json({ ok: 'updateLane' }),
  createTradeRule: (req, res) => res.json({ ok: 'createTradeRule' }),
}));
jest.mock('../controllers/logisticsShipmentsController', () => ({
  addMilestone: (req, res) => res.json({ ok: 'addMilestone' }),
  createShipment: (req, res) => res.json({ ok: 'createShipment' }),
  getShipment: (req, res) => res.json({ ok: 'getShipment' }),
  listShipments: (req, res) => res.json({ ok: 'listShipments' }),
  updateTracking: (req, res) => res.json({ ok: 'updateTracking' }),
  uploadDocument: (req, res) => res.json({ ok: 'uploadDocument' }),
}));
jest.mock('../controllers/logisticsPurchaseOrdersController', () => ({
  createPurchaseOrder: (req, res) => res.json({ ok: 'createPurchaseOrder' }),
  getPurchaseOrder: (req, res) => res.json({ ok: 'getPurchaseOrder' }),
  listPurchaseOrders: (req, res) => res.json({ ok: 'listPurchaseOrders' }),
  previewLandedCost: (req, res) => res.json({ ok: 'previewLandedCost' }),
  transitionStatus: (req, res) => res.json({ ok: 'transitionStatus' }),
}));
jest.mock('../controllers/logisticsPooledOrdersController', () => ({
  createPooledOrder: (req, res) => res.json({ ok: 'createPooledOrder' }),
  getPooledOrder: (req, res) => res.json({ ok: 'getPooledOrder' }),
  listPooledOrders: (req, res) => res.json({ ok: 'listPooledOrders' }),
  updateStatus: (req, res) => res.json({ ok: 'updateStatus' }),
}));
jest.mock('../controllers/logisticsWarehouseController', () => {
  const h = {};
  ['createAllocation','createDeliveryOrder','createReceipt','createWarehouse',
   'listAllocations','listDeliveryOrders','listReceipts','listWarehouses',
   'receiveInventory','reconcileReceipt','releaseAllocation'].forEach((n) => { h[n] = (req, res) => res.json({ ok: n }); });
  return h;
});
jest.mock('../controllers/logisticsSourcingController', () => ({
  assignOperator: (req, res) => res.json({ ok: 'assignOperator' }),
  createQuote: (req, res) => res.json({ ok: 'createQuote' }),
  reviewQuote: (req, res) => res.json({ ok: 'reviewQuote' }),
  updateStatus: (req, res) => res.json({ ok: 'updateStatus' }),
}));
jest.mock('../controllers/adminFeaturedPlacementController', () => ({
  listFeatured: (req, res) => res.json({ ok: 'listFeatured' }),
  listRequests: (req, res) => res.json({ ok: 'listRequests' }),
  contactRequest: (req, res) => res.json({ ok: 'contactRequest' }),
  approveRequest: (req, res) => res.json({ ok: 'approveRequest' }),
  declineRequest: (req, res) => res.json({ ok: 'declineRequest' }),
  revokeRequest: (req, res) => res.json({ ok: 'revokeRequest' }),
}));
jest.mock('../controllers/adminConsultingController', () => {
  const h = {};
  ['getEnhancedDashboardStats','getConsultingRequests','createSessionManually',
   'updateRequestStatusById','assignConsultantToRequest','getAvailableConsultants',
   'generateInvoice','generateManualInvoice','markInvoicePaid','downloadInvoice',
   'listInvoices','listPurchases','updatePackage','listSessions','getSessionDetail',
   'updateSessionDetails','completeSession','markNoShow','sendSessionReminder',
   'sendSessionFollowUp'].forEach((n) => { h[n] = (req, res) => res.json({ ok: n }); });
  return h;
});

// Partial mocks: stub the session-establishing middleware, keep the real
// grant/TOTP enforcement under test.
jest.mock('../middleware/adminAuth', () => {
  const actual = jest.requireActual('../middleware/adminAuth');
  return {
    ...actual,
    requireAdmin: (req, res, next) => {
      req.user = { id: 'admin-1', role: 'admin' };
      req.isSuper = false;
      next();
    },
  };
});
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return { ...actual, authenticate: (req, res, next) => next() };
});

const express = require('express');
const request = require('supertest');

const logisticsAdminRoutes = require('../routes/logisticsAdmin');
const adminFeaturedPlacementRoutes = require('../routes/adminFeaturedPlacement');
const consultingAdminRoutes = require('../routes/consultingAdmin');

beforeEach(() => {
  resetMocks();
  mockQuery.mockResolvedValue({ rows: [] });
});

// Stub "authenticate": the inner authenticate is mocked to next(), so the
// outer stub only needs to establish req.user for role checks.
function buildApp(mountPath, router, user = { id: 'admin-1', role: 'admin' }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  app.use(mountPath, router);
  return app;
}

const GRANT_ROW = { id: 'grant-1', region_id: null, grant_source: 'direct' };

// ─── ADM-006: logistics admin TOTP hard-block ─────────────────────────────────

describe('ADM-006: logistics admin API TOTP enforcement', () => {
  const app = () => buildApp('/api/admin/logistics', logisticsAdminRoutes);

  test('403s a TOTP-less admin on a workspace route', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_enabled: false }] });
    const res = await request(app()).get('/api/admin/logistics/stats');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('admin_2fa_required');
  });

  test('403s a TOTP-less admin on a requireRole write route', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_enabled: false }] });
    const res = await request(app()).post('/api/admin/logistics/lanes').send({ name: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('admin_2fa_required');
  });

  test('403s a TOTP-less super_admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_enabled: false }] });
    const superApp = buildApp('/api/admin/logistics', logisticsAdminRoutes, { id: 'super-1', role: 'super_admin' });
    const res = await request(superApp).get('/api/admin/logistics/stats');
    expect(res.status).toBe(403);
  });

  test('passes an admin with TOTP enabled', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_enabled: true }] });
    const res = await request(app()).get('/api/admin/logistics/stats');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe('getStats');
  });

  test('does not disturb non-admin callers (role check still applies)', async () => {
    const customerApp = buildApp('/api/admin/logistics', logisticsAdminRoutes, { id: 'c-1', role: 'customer' });
    const res = await request(customerApp).post('/api/admin/logistics/lanes').send({ name: 'x' });
    // requireAdminTotp passes non-admins through; requireRole then 403s.
    expect(res.status).toBe(403);
    expect(res.body.code).not.toBe('admin_2fa_required');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ─── ADM-027: featured placements grant ───────────────────────────────────────

describe('ADM-027: featured placements require manage_marketing', () => {
  const app = () => buildApp('/api/admin/featured-placements', adminFeaturedPlacementRoutes);

  test('403s reads without the grant', async () => {
    const res = await request(app()).get('/api/admin/featured-placements/');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('manage_marketing');
  });

  test('403s approve without the grant', async () => {
    const res = await request(app()).post('/api/admin/featured-placements/1/approve').send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('manage_marketing');
  });

  test('403s revoke without the grant', async () => {
    const res = await request(app()).post('/api/admin/featured-placements/1/revoke').send({});
    expect(res.status).toBe(403);
  });

  test('passes reads and writes with a global manage_marketing grant', async () => {
    mockQuery.mockResolvedValue({ rows: [GRANT_ROW] });
    const read = await request(app()).get('/api/admin/featured-placements/');
    expect(read.status).toBe(200);
    expect(read.body.ok).toBe('listRequests');
    const write = await request(app()).post('/api/admin/featured-placements/1/approve').send({});
    expect(write.status).toBe(200);
    expect(write.body.ok).toBe('approveRequest');
  });
});

// ─── ADM-039: consultingAdmin write grants ────────────────────────────────────

describe('ADM-039: consultingAdmin writes require manage_operations', () => {
  const app = () => buildApp('/api/admin/consulting', consultingAdminRoutes);

  const writeRoutes = [
    ['post', '/api/admin/consulting/requests/create'],
    ['patch', '/api/admin/consulting/requests/1/status'],
    ['post', '/api/admin/consulting/assign'],
    ['post', '/api/admin/consulting/sessions/create'],
    ['patch', '/api/admin/consulting/sessions/1'],
    ['patch', '/api/admin/consulting/sessions/1/complete'],
    ['patch', '/api/admin/consulting/sessions/1/no-show'],
    ['post', '/api/admin/consulting/sessions/1/send-reminder'],
    ['post', '/api/admin/consulting/sessions/1/send-followup'],
    ['post', '/api/admin/consulting/sessions/1/send-invite'],
  ];

  test.each(writeRoutes)('%s %s 403s without the grant', async (method, path) => {
    const res = await request(app())[method](path).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('manage_operations');
  });

  test('writes pass with a global manage_operations grant', async () => {
    mockQuery.mockResolvedValue({ rows: [GRANT_ROW] });
    const res = await request(app()).post('/api/admin/consulting/requests/create').send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe('createSessionManually');
  });

  test('reads are unchanged (no grant required)', async () => {
    const reqs = await request(app()).get('/api/admin/consulting/requests');
    expect(reqs.status).toBe(200);
    const sessions = await request(app()).get('/api/admin/consulting/sessions');
    expect(sessions.status).toBe(200);
    const dashboard = await request(app()).get('/api/admin/consulting/dashboard-stats');
    expect(dashboard.status).toBe(200);
  });
});
