'use strict';

const { mockQuery, resetMocks } = require('./setup');
const {
  enrichBusinessesWithRestaurantFields,
} = require('../utils/businessListRestaurantEnrichment');
const ctrl = require('../controllers/businessController');
const express = require('express');
const request = require('supertest');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const logger = require('../utils/logger');

function buildListApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: '00000000-0000-4000-8000-000000000456' };
    next();
  });
  app.get('/api/businesses', ctrl.listBusinesses);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('enrichBusinessesWithRestaurantFields', () => {
  test('attaches restaurant summary when food_restaurants query succeeds', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        business_id: 1,
        id: 99,
        status: 'active',
        discovery_status: 'visible',
        accepts_online_orders: true,
        is_accepting_orders_now: false,
      }],
    });

    const pool = { query: mockQuery };
    const out = await enrichBusinessesWithRestaurantFields(
      pool,
      [{ id: 1, business_name: 'Cafe' }],
      { logLabel: 'test' },
    );

    expect(out[0]).toMatchObject({
      id: 1,
      restaurant_id: 99,
      restaurant_status: 'active',
      restaurant_discovery_status: 'visible',
      restaurant_accepts_online_orders: true,
      restaurant_is_accepting_orders_now: false,
    });
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM food_restaurants/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/discovery_status/);
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/JOIN/);
  });

  test('falls back to baseline columns when discovery_status is missing', async () => {
    const missingCol = Object.assign(new Error('column "discovery_status" does not exist'), { code: '42703' });
    mockQuery
      .mockRejectedValueOnce(missingCol)
      .mockResolvedValueOnce({
        rows: [{
          business_id: 1,
          id: 99,
          status: 'active',
          accepts_online_orders: true,
        }],
      });

    const pool = { query: mockQuery };
    const out = await enrichBusinessesWithRestaurantFields(
      pool,
      [{ id: 1, business_name: 'Cafe' }],
      { logLabel: 'test' },
    );

    expect(out[0]).toMatchObject({
      id: 1,
      restaurant_id: 99,
      restaurant_status: 'active',
      restaurant_accepts_online_orders: true,
      restaurant_discovery_status: null,
      restaurant_is_accepting_orders_now: null,
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toMatch(/accepts_online_orders/);
    expect(mockQuery.mock.calls[1][0]).not.toMatch(/discovery_status/);
    expect(logger.warn).toHaveBeenCalledWith(
      'test: food_restaurants full enrichment unavailable; retrying baseline columns',
      expect.objectContaining({ code: '42703' }),
    );
  });

  test('returns null restaurant_* when food_restaurants relation is missing', async () => {
    const err = Object.assign(new Error('relation "food_restaurants" does not exist'), { code: '42P01' });
    mockQuery.mockRejectedValueOnce(err);

    const pool = { query: mockQuery };
    const out = await enrichBusinessesWithRestaurantFields(
      pool,
      [{ id: 1, business_name: 'Cafe' }],
      { logLabel: 'test' },
    );

    expect(out[0]).toMatchObject({
      id: 1,
      business_name: 'Cafe',
      restaurant_id: null,
      restaurant_discovery_status: null,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'test: food_restaurants enrichment skipped (missing relation)',
      expect.objectContaining({ err: err.message, code: '42P01' }),
    );
  });
});

describe('GET /api/businesses listBusinesses', () => {
  test('core list SQL does not JOIN food_restaurants and still 200s when enrichment fails', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          business_name: 'Cafe',
          business_type: 'Restaurant',
          industry_category: 'food',
          business_mode: 'food',
          business_kind: 'restaurant',
          setup_status: 'active',
          timezone: 'America/New_York',
          currency_code: 'USD',
          published_at: null,
          profile_version: 1,
          description: null,
          website: null,
          phone: null,
          address_city: null,
          address_state: null,
          address_country: 'US',
          is_primary: true,
          is_active: true,
          is_listed: true,
          tax_rate: null,
          logo_url: null,
          created_at: new Date().toISOString(),
          active_template: 'default',
        }],
      })
      .mockRejectedValueOnce(Object.assign(new Error('relation "food_restaurants" does not exist'), { code: '42P01' }));

    const res = await request(buildListApp()).get('/api/businesses');

    expect(res.status).toBe(200);
    expect(res.body.businesses).toHaveLength(1);
    expect(res.body.businesses[0].id).toBe(1);
    expect(res.body.businesses[0].restaurant_id).toBeNull();
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM businesses/);
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/food_restaurants/);
    expect(logger.warn).toHaveBeenCalled();
  });

  test('still 200s with partial restaurant fields when only discovery columns are missing', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          business_name: 'Cafe',
          business_type: 'Restaurant',
          industry_category: 'food',
          business_mode: 'food',
          business_kind: 'restaurant',
          setup_status: 'active',
          timezone: 'America/New_York',
          currency_code: 'USD',
          published_at: null,
          profile_version: 1,
          description: null,
          website: null,
          phone: null,
          address_city: null,
          address_state: null,
          address_country: 'US',
          is_primary: true,
          is_active: true,
          is_listed: true,
          tax_rate: null,
          logo_url: null,
          created_at: new Date().toISOString(),
          active_template: 'default',
        }],
      })
      .mockRejectedValueOnce(Object.assign(new Error('column "discovery_status" does not exist'), { code: '42703' }))
      .mockResolvedValueOnce({
        rows: [{
          business_id: 1,
          id: 42,
          status: 'draft',
          accepts_online_orders: true,
        }],
      });

    const res = await request(buildListApp()).get('/api/businesses');

    expect(res.status).toBe(200);
    expect(res.body.businesses[0].restaurant_id).toBe(42);
    expect(res.body.businesses[0].restaurant_status).toBe('draft');
    expect(res.body.businesses[0].restaurant_discovery_status).toBeNull();
  });
});
