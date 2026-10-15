'use strict';

// Phase 1 (logistics refactor): searchable campaign endpoints, paginated
// envelope with legacy-shape backward compatibility, and safe public
// visibility (guests must not see draft campaigns).

jest.mock('../services/pooledOrderService', () => ({
  listPooledOrders: jest.fn(),
  getPooledOrder: jest.fn(),
  createPooledOrder: jest.fn(),
  joinPooledOrder: jest.fn(),
  updatePooledOrderStatus: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const pooledOrderService = require('../services/pooledOrderService');
const pooledCtrl = require('../controllers/logisticsPooledOrdersController');

function buildApp(asUser) {
  const app = express();
  app.use(express.json());
  if (asUser) {
    app.use((req, _res, next) => { req.user = { id: 'user-1' }; next(); });
  }
  app.get('/campaigns', pooledCtrl.listPooledOrders);
  app.get('/campaigns/:id', pooledCtrl.getPooledOrder);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

const guestApp = () => buildApp(false);
const authedApp = () => buildApp(true);

const sampleOrders = [
  { id: 1, title: 'Steel beams', status: 'open' },
  { id: 2, title: 'Copper wire', status: 'pledging' },
];

beforeEach(() => {
  jest.clearAllMocks();
  pooledOrderService.listPooledOrders.mockResolvedValue({ orders: sampleOrders, total: 42 });
});

describe('GET /campaigns — legacy shape (no pagination params)', () => {
  test('returns the existing { success, orders, total } shape unchanged', async () => {
    const res = await request(guestApp()).get('/campaigns');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orders).toEqual(sampleOrders);
    expect(res.body.total).toBe(42);
    expect(res.body.data).toBeUndefined();
    expect(res.body.pagination).toBeUndefined();
  });

  test('passes defaults and guest draft exclusion to the service', async () => {
    await request(guestApp()).get('/campaigns');
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 20,
        offset: 0,
        open: null,
        publicSafe: true,
        excludeDrafts: true,
        search: null,
        laneId: undefined,
        status: undefined,
      })
    );
  });

  test('legacy limit/offset still work without triggering the new envelope', async () => {
    // offset without page/limit keeps the legacy shape.
    const res = await request(guestApp()).get('/campaigns').query({ offset: 20 });
    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual(sampleOrders);
    expect(res.body.pagination).toBeUndefined();
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 20 })
    );
  });
});

describe('GET /campaigns — search and filters', () => {
  test('search is forwarded and matched against title/description server-side', async () => {
    await request(guestApp()).get('/campaigns').query({ search: 'steel' });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'steel' })
    );
  });

  test('blank search is treated as no search', async () => {
    await request(guestApp()).get('/campaigns').query({ search: '   ' });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ search: null })
    );
  });

  test('lane filter accepts ?lane= and the legacy ?lane_id= alias', async () => {
    await request(guestApp()).get('/campaigns').query({ lane: '3' });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ laneId: 3 })
    );
    await request(guestApp()).get('/campaigns').query({ lane_id: '4' });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ laneId: 4 })
    );
  });

  test('non-numeric lane is ignored instead of crashing the query', async () => {
    const res = await request(guestApp()).get('/campaigns').query({ lane: 'abc' });
    expect(res.status).toBe(200);
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ laneId: undefined })
    );
  });

  test('status filter is forwarded', async () => {
    await request(guestApp()).get('/campaigns').query({ status: 'pledging' });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pledging' })
    );
  });
});

describe('GET /campaigns — paginated envelope', () => {
  test('?page=&limit= returns data + pagination and keeps legacy fields', async () => {
    const res = await request(guestApp()).get('/campaigns').query({ page: '2', limit: '10' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(sampleOrders);
    expect(res.body.pagination).toEqual({ page: 2, limit: 10, total: 42, totalPages: 5 });
    // Backward compatibility: legacy fields still present.
    expect(res.body.orders).toEqual(sampleOrders);
    expect(res.body.total).toBe(42);
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 10 })
    );
  });

  test('limit alone opts into pagination with page 1', async () => {
    const res = await request(guestApp()).get('/campaigns').query({ limit: '5' });
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 5 });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, offset: 0 })
    );
  });

  test('legacy limit+offset without page keeps the explicit offset', async () => {
    const res = await request(guestApp()).get('/campaigns').query({ limit: '20', offset: '40' });
    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ page: 3, limit: 20 });
    expect(res.body.orders).toEqual(sampleOrders);
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 40 })
    );
  });

  test('limit is capped at 100', async () => {
    await request(guestApp()).get('/campaigns').query({ limit: '500' });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100, offset: 0 })
    );
  });

  test('page defaults to 1 and is clamped to >= 1', async () => {
    await request(guestApp()).get('/campaigns').query({ page: '0', limit: '10' });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 0 })
    );
  });
});

describe('GET /campaigns — visibility', () => {
  test('authenticated callers keep current behavior (no forced draft exclusion)', async () => {
    await request(authedApp()).get('/campaigns');
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ excludeDrafts: false })
    );
  });
});

describe('GET /campaigns/:id — visibility', () => {
  test('guest requesting a draft campaign gets 404 (no existence leak)', async () => {
    pooledOrderService.getPooledOrder.mockResolvedValue({
      id: 9, title: 'Draft widgets', status: 'draft', organizer_user_id: 'user-9',
    });
    const res = await request(guestApp()).get('/campaigns/9');
    expect(res.status).toBe(404);
  });

  test('guest can still fetch a published campaign', async () => {
    pooledOrderService.getPooledOrder.mockResolvedValue({
      id: 9, title: 'Steel beams', status: 'open', organizer_user_id: 'user-9',
    });
    const res = await request(guestApp()).get('/campaigns/9');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(9);
  });

  test('authenticated organizer can fetch their own draft', async () => {
    pooledOrderService.getPooledOrder.mockResolvedValue({
      id: 9, title: 'Draft widgets', status: 'draft', organizer_user_id: 'user-1',
    });
    const res = await request(authedApp()).get('/campaigns/9');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('draft');
  });

  test('missing campaign still 404s for guests', async () => {
    pooledOrderService.getPooledOrder.mockResolvedValue(null);
    const res = await request(guestApp()).get('/campaigns/999');
    expect(res.status).toBe(404);
  });
});
