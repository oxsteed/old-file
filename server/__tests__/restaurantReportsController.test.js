'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

const reports = require('../controllers/restaurantReportsController');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const RESTAURANT_ID = 9;

function access(role = 'owner') {
  return { id: RESTAURANT_ID, business_id: 42, effective_role: role };
}

function app() {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.user = { id: USER_ID, email: 'owner@example.com' };
    next();
  });
  server.get('/api/restaurants/:restaurantId/reports/sales', reports.salesSummary);
  server.get('/api/restaurants/:restaurantId/reports/inventory', reports.inventorySummary);
  server.get('/api/restaurants/:restaurantId/reports/operations', reports.operationsSummary);
  server.use(errorHandler);
  return server;
}

beforeEach(() => resetMocks());

describe('franchise reports backend', () => {
  test('non-managers cannot view reports', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access('employee')] });
    const res = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/reports/sales`);
    expect(res.status).toBe(403);
  });

  test('salesSummary returns daily rows, totals, and breakdowns', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access('manager')] })
      .mockResolvedValueOnce({ rows: [{ day: '2026-10-01', orders: '12', revenue_cents: '4800' }] })
      .mockResolvedValueOnce({ rows: [{ orders: '12', revenue_cents: '4800', cancelled: '1', refunded: '0' }] })
      .mockResolvedValueOnce({ rows: [{ fulfillment_type: 'pickup', orders: '12', revenue_cents: '4800' }] })
      .mockResolvedValueOnce({ rows: [{ order_source: 'mobile', orders: '12', revenue_cents: '4800' }] })
      .mockResolvedValueOnce({ rows: [{ currency_code: 'USD' }] });
    const res = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/reports/sales?from=2026-10-01&to=2026-10-03`);
    expect(res.status).toBe(200);
    expect(res.body.totals.orders).toBe(12);
    expect(res.body.totals.revenue_cents).toBe(4800);
    expect(res.body.totals.avg_ticket_cents).toBe(400);
    expect(res.body.daily).toHaveLength(1);
    expect(res.body.by_fulfillment[0].fulfillment_type).toBe('pickup');
    expect(res.body.currency).toBe('USD');
  });

  test('salesSummary rejects invalid ranges', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access('owner')] });
    const res = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/reports/sales?from=2026-10-05&to=2026-10-01`);
    expect(res.status).toBe(400);
  });

  test('inventorySummary returns adjustment breakdown and waste leaders', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access('owner')] })
      .mockResolvedValueOnce({ rows: [{ adjustment_type: 'waste', events: '4', total_qty: '9.5' }] })
      .mockResolvedValueOnce({ rows: [{ item_name: 'Milk', events: '3', wasted_qty: '6' }] })
      .mockResolvedValueOnce({ rows: [{ low_count: '2', out_count: '1' }] });
    const res = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/reports/inventory`);
    expect(res.status).toBe(200);
    expect(res.body.by_type[0].adjustment_type).toBe('waste');
    expect(res.body.top_waste[0].item_name).toBe('Milk');
    expect(res.body.low_stock_count).toBe(2);
    expect(res.body.out_of_stock_count).toBe(1);
  });

  test('operationsSummary aggregates checklists, audits, and training', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access('owner')] })
      .mockResolvedValueOnce({ rows: [{ runs: '20', completed: '18', avg_completion: '0.95' }] })
      .mockResolvedValueOnce({ rows: [{ completed: '3', in_progress: '1', avg_score: '0.82', open_actions: '2' }] })
      .mockResolvedValueOnce({ rows: [{ assigned: '10', completed: '8', avg_score: '88', passed: '7' }] });
    const res = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/reports/operations`);
    expect(res.status).toBe(200);
    expect(res.body.checklists.avg_completion_pct).toBe(95);
    expect(res.body.audits.avg_score_pct).toBe(82);
    expect(res.body.audits.open_corrective_actions).toBe(2);
    expect(res.body.training.passed).toBe(7);
  });
});
