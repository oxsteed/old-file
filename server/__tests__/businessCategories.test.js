'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/businessController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000456',
      email: 'owner@example.com',
    };
    next();
  });
  app.get('/api/businesses/categories', ctrl.listBusinessCategories);
  app.post('/api/businesses', ctrl.addBusiness);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('business category long-term wiring', () => {
  test('returns backend-owned business category catalog', async () => {
    const res = await request(buildApp()).get('/api/businesses/categories');

    expect(res.status).toBe(200);
    expect(res.body.contract.version).toBe('business-categories-v1');
    expect(res.body.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'food',
        business_mode: 'food',
        subtypes: expect.arrayContaining(['Restaurant']),
      }),
      expect.objectContaining({
        id: 'services',
        business_mode: 'services_marketplace',
      }),
    ]));
  });

  test('creates a linked draft restaurant when business mode is food', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 8,
          user_id: '00000000-0000-4000-8000-000000000456',
          business_name: 'Bon Pate',
          business_type: 'Restaurant',
          industry_category: 'food',
          business_mode: 'food',
          description: null,
          phone: null,
          website: null,
          address_street: null,
          address_city: 'Columbus',
          address_state: 'OH',
          address_zip: null,
          address_country: 'US',
          is_primary: true,
          tax_rate: '25.00',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 12 }] });

    const res = await request(buildApp())
      .post('/api/businesses')
      .send({
        business_name: 'Bon Pate',
        business_type: 'Restaurant',
        industry_category: 'food',
        business_mode: 'food',
        address_city: 'Columbus',
        address_state: 'OH',
        address_country: 'US',
      });

    expect(res.status).toBe(201);
    expect(res.body.business).toEqual(expect.objectContaining({
      business_name: 'Bon Pate',
      industry_category: 'food',
      business_mode: 'food',
    }));
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_restaurants/.test(sql))).toBe(true);
  });

  test('does not create a food restaurant for service marketplace businesses', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 9,
          user_id: '00000000-0000-4000-8000-000000000456',
          business_name: 'FastFix',
          business_type: 'Auto Repair',
          industry_category: 'auto',
          business_mode: 'services_marketplace',
          address_city: 'Columbus',
          address_state: 'OH',
          address_country: 'US',
          is_primary: false,
        }],
      });

    const res = await request(buildApp())
      .post('/api/businesses')
      .send({
        business_name: 'FastFix',
        business_type: 'Auto Repair',
        industry_category: 'auto',
        business_mode: 'services_marketplace',
        address_city: 'Columbus',
        address_state: 'OH',
        address_country: 'US',
      });

    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_restaurants/.test(sql))).toBe(false);
  });
});
