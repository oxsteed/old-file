'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/businessProductsController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'manager-123' };
    next();
  });
  app.post('/api/businesses/:businessId/products', ctrl.createProduct);
  app.put('/api/businesses/:businessId/products/:productId', ctrl.updateProduct);
  app.put('/api/businesses/:businessId/products/:productId/variants/:variantId/inventory', ctrl.updateVariantInventory);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('business products controller wiring', () => {
  test('creates a product without re-checking owner-only access after route authorization', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 'product-1', business_id: '12', name: 'Air Filter', sku: 'FILTER-20X20' }],
      });

    const res = await request(buildApp())
      .post('/api/businesses/12/products')
      .send({
        name: 'Air Filter',
        category: 'Maintenance',
        price: 24.99,
        sku: 'FILTER-20X20',
      });

    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM business_products/);
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/FROM businesses WHERE id = \$1 AND user_id = \$2/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO business_products/);
  });

  test('updates a product using the business-scoped product id', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'product-1', business_id: '12', name: 'Updated Filter' }],
    });

    const res = await request(buildApp())
      .put('/api/businesses/12/products/product-1')
      .send({ name: 'Updated Filter', isActive: false });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE id = \$1 AND business_id = \$2/);
    expect(mockQuery.mock.calls[0][1].slice(0, 2)).toEqual(['product-1', '12']);
  });

  test('scopes variant inventory updates to the requested product and business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ stock_quantity: 5 }] })
      .mockResolvedValueOnce({ rows: [{ stock_quantity: 8, updated_at: '2026-06-02T12:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .put('/api/businesses/12/products/product-1/variants/variant-1/inventory')
      .send({ quantityChange: 3, reason: 'Restock' });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/JOIN business_products p ON p.id = v.product_id/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/p.business_id = \$3/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['variant-1', 'product-1', '12']);
    expect(res.body.data.stock).toBe(8);
  });
});
