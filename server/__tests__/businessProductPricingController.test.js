'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/businessProductPricingController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'manager-123' };
    next();
  });
  app.get('/api/businesses/:businessId/product-pricing/rules', ctrl.listPricingRules);
  app.post('/api/businesses/:businessId/product-pricing/rules', ctrl.createPricingRule);
  app.put('/api/businesses/:businessId/product-pricing/rules/:ruleId', ctrl.updatePricingRule);
  app.post('/api/businesses/:businessId/products/:productId/bulk-pricing', ctrl.setBulkPricingTiers);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('business product pricing controller wiring', () => {
  test('lists pricing rules without re-checking owner-only access after route authorization', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'rule-1',
          business_id: '12',
          rule_name: 'Spring promo',
          rule_type: 'promotion',
          description: 'Seasonal offer',
          priority: 20,
          is_active: true,
          applies_to: 'all',
          conditions_json: {},
          pricing_adjustment: { type: 'percentage', value: 10 },
          start_date: null,
          end_date: null,
          created_at: '2026-06-02T12:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] });

    const res = await request(buildApp()).get('/api/businesses/12/product-pricing/rules');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM product_pricing_rules/);
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/FROM businesses WHERE id = \$1 AND user_id = \$2/);
  });

  test('creates a pricing rule for a manager-authorized business context', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'rule-2', business_id: '12', rule_name: 'Bulk discount' }],
    });

    const res = await request(buildApp())
      .post('/api/businesses/12/product-pricing/rules')
      .send({
        name: 'Bulk discount',
        type: 'volume',
        priority: 10,
        appliesToType: 'all',
        conditions: { minQuantity: 3 },
        adjustment: { type: 'percentage', value: 15 },
      });

    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO product_pricing_rules/);
    expect(mockQuery.mock.calls[0][1][0]).toBe('12');
    expect(mockQuery.mock.calls[0][1][1]).toBe('Bulk discount');
  });

  test('updates pricing rules scoped by rule and business id', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'rule-2', business_id: '12', is_active: false }],
    });

    const res = await request(buildApp())
      .put('/api/businesses/12/product-pricing/rules/rule-2')
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE id = \$1 AND business_id = \$2/);
    expect(mockQuery.mock.calls[0][1].slice(0, 2)).toEqual(['rule-2', '12']);
  });

  test('sets bulk pricing tiers inside the transaction helper with the pool argument', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'product-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/businesses/12/products/product-1/bulk-pricing')
      .send({ tiers: [{ minQuantity: 3, discountPercent: 10 }] });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM business_products/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/DELETE FROM product_bulk_tiers/);
    expect(mockQuery.mock.calls[2][0]).toMatch(/INSERT INTO product_bulk_tiers/);
  });
});
