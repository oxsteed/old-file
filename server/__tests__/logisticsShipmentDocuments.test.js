'use strict';

// Route tests for the logistics shipment document download endpoint
// (review P3-6-F02: documents were write-only with no retrieval path).

jest.mock('../services/shipmentService', () => ({
  getShipment: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const shipmentService = require('../services/shipmentService');
const shipCtrl = require('../controllers/logisticsShipmentsController');

jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'user-1' };
    next();
  },
}));
const { requireAuth } = require('../middleware/auth');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/shipments/:id/documents/:docId/download', requireAuth, shipCtrl.downloadDocument);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

const shipment = (docs) => ({
  id: 7,
  documents: docs,
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('mints a signed download URL for a document on a visible shipment', async () => {
  shipmentService.getShipment.mockResolvedValue(shipment([
    { id: 3, doc_type: 'bill_of_lading', filename: 'bol.pdf', file_url: 'logistics/shipment-docs/7/123-bol.pdf' },
  ]));
  const res = await request(buildApp()).get('/shipments/7/documents/3/download');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.data.download_url).toMatch(/\/api\/storage\/files\/logistics\/shipment-docs\/7\/123-bol\.pdf\?exp=\d+&sig=[0-9a-f]+/);
  expect(res.body.data.filename).toBe('bol.pdf');
  expect(shipmentService.getShipment).toHaveBeenCalledWith('7', { userId: 'user-1', isAdmin: false });
});

test('404s when the shipment is not visible to the caller', async () => {
  shipmentService.getShipment.mockResolvedValue(null);
  const res = await request(buildApp()).get('/shipments/7/documents/3/download');
  expect(res.status).toBe(404);
});

test('404s for an unknown document id', async () => {
  shipmentService.getShipment.mockResolvedValue(shipment([]));
  const res = await request(buildApp()).get('/shipments/7/documents/99/download');
  expect(res.status).toBe(404);
});

test('404s when the stored key escapes the shipment folder', async () => {
  shipmentService.getShipment.mockResolvedValue(shipment([
    { id: 3, doc_type: 'x', filename: 'evil.pdf', file_url: 'logistics/shipment-docs/8/other.pdf' },
  ]));
  const res = await request(buildApp()).get('/shipments/7/documents/3/download');
  expect(res.status).toBe(404);
});
