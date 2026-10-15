'use strict';

/**
 * Workstream 3 (state machine consolidation): controller + route wiring.
 *  - GET /orders/:id and GET /shipments/:id include additive availableActions
 *  - GET /api/logistics/capabilities serves the server-derived capabilities
 *
 * buildActionContext is mocked here so no DB is touched; the real
 * getAvailableActions logic is covered in logisticsStateMachine.test.js.
 */

jest.mock('../services/purchaseOrderService', () => ({ getPurchaseOrder: jest.fn() }));
jest.mock('../services/shipmentService', () => ({ getShipment: jest.fn() }));
jest.mock('../middleware/requireLogisticsAccess', () => {
  const actual = jest.requireActual('../middleware/requireLogisticsAccess');
  return {
    ...actual,
    buildActionContext: jest.fn(async () => ({
      logisticsRole: 'sourcing_operator', userId: 'u1',
      isAdmin: false, isOwner: false, isAssigned: false,
    })),
  };
});

const express = require('express');
const request = require('supertest');
const poService = require('../services/purchaseOrderService');
const shipmentService = require('../services/shipmentService');
const poCtrl = require('../controllers/logisticsPurchaseOrdersController');
const shipCtrl = require('../controllers/logisticsShipmentsController');
const capabilitiesCtrl = require('../controllers/logisticsCapabilitiesController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1', logistics_role: 'individual_buyer' };
    next();
  });
  app.get('/orders/:id', poCtrl.getPurchaseOrder);
  app.get('/shipments/:id', shipCtrl.getShipment);
  app.get('/capabilities', capabilitiesCtrl.getCapabilities);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('detail endpoints include availableActions (additive)', () => {
  test('GET /orders/:id keeps data intact and adds availableActions', async () => {
    poService.getPurchaseOrder.mockResolvedValue({
      id: 3, status: 'draft', buyer_user_id: 'u1', reference: 'PO-2026-X',
    });
    const res = await request(buildApp()).get('/orders/3');
    expect(res.status).toBe(200);
    expect(res.body.data.reference).toBe('PO-2026-X');
    expect(res.body.availableActions.actions).toEqual([
      { action: 'request_quote', to: 'quoted' },
      { action: 'cancel_order', to: 'cancelled' },
    ]);
    expect(res.body.availableActions.blockers).toEqual([]);
  });

  test('GET /shipments/:id adds milestone actions for an ops viewer', async () => {
    shipmentService.getShipment.mockResolvedValue({
      id: 5, status: 'planned', reference: 'SHP-2026-00005', assigned_coordinator: 'u2',
    });
    const res = await request(buildApp()).get('/shipments/5');
    expect(res.status).toBe(200);
    expect(res.body.data.reference).toBe('SHP-2026-00005');
    expect(res.body.availableActions.actions).toEqual([
      { action: 'book_shipment', to: 'booked' },
      { action: 'flag_exception', to: 'exception' },
    ]);
  });

  test('missing order still 404s (no availableActions leak)', async () => {
    poService.getPurchaseOrder.mockResolvedValue(null);
    const res = await request(buildApp()).get('/orders/999');
    expect(res.status).toBe(404);
    expect(res.body.availableActions).toBeUndefined();
  });
});

describe('GET /api/logistics/capabilities', () => {
  test('returns the role-derived capability model for a buyer', async () => {
    const res = await request(buildApp()).get('/capabilities');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('individual_buyer');
    expect(res.body.data.campaigns.join).toBe(true);
    expect(res.body.data.orders.transition).toBe(false);
    expect(res.body.data.warehouse.manage).toBe(false);
  });

  test('controller resolves admin role to full capabilities', async () => {
    const req = { user: { id: 'u9', logistics_role: 'super_admin' } };
    const res = { json: jest.fn() };
    await capabilitiesCtrl.getCapabilities(req, res, (e) => { throw e; });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const caps = res.json.mock.calls[0][0].data;
    expect(caps.isAdmin).toBe(true);
    expect(caps.warehouse.manage).toBe(true);
    expect(caps.compliance.review).toBe(true);
  });
});
