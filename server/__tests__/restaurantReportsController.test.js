'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

const reports = require('../controllers/restaurantReportsController');
const permissionsService = require('../services/permissionsService');

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
  server.get('/api/restaurants/:restaurantId/reports/sales/export.csv', reports.salesExportCsv);
  server.get('/api/restaurants/:restaurantId/reports/sales/journal.csv', reports.salesJournalExportCsv);
  server.get('/api/restaurants/:restaurantId/reports/inventory', reports.inventorySummary);
  server.get('/api/restaurants/:restaurantId/reports/operations', reports.operationsSummary);
  server.use(errorHandler);
  return server;
}

// S-08: report gates resolve through permissionsService; clear its cache
// per test so each scripted chain includes the resolver's catalog rows.
beforeEach(() => { resetMocks(); permissionsService.invalidateCache(); });

describe('franchise reports backend', () => {
  test('non-managers cannot view reports', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access('employee')] });
    const res = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/reports/sales`);
    expect(res.status).toBe(403);
  });

  // F-07: salesSummary runs bounds + totals + daily + fulfillment +
  // source + payment-method queries (in that order) over an
  // order-financials CTE; revenue is net collected per currency.
  function mockSalesQueries() {
    const money = {
      orders: '12', paid_orders: '10', revenue_cents: '4800',
      gross_cents: '5000', discount_cents: '200', tax_cents: '300',
      tips_cents: '150', service_fee_cents: '0', delivery_fee_cents: '0',
      collected_cents: '4800', refunds_cents: '0',
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [access('manager')] })
      .mockResolvedValueOnce({ rows: [{ code: 'analytics.view_financial', allow: true }] })
      .mockResolvedValueOnce({ rows: [{ from_instant: '2026-10-01T00:00:00.000Z', to_instant: '2026-10-04T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ currency: 'USD', ...money, cancelled: '1', refunded: '0' }] })
      .mockResolvedValueOnce({ rows: [{ currency: 'USD', day: '2026-10-01', ...money }] })
      .mockResolvedValueOnce({ rows: [{ currency: 'USD', fulfillment_type: 'pickup', orders: '12', paid_orders: '10', revenue_cents: '4800' }] })
      .mockResolvedValueOnce({ rows: [{ currency: 'USD', order_source: 'mobile', orders: '12', paid_orders: '10', revenue_cents: '4800' }] })
      .mockResolvedValueOnce({ rows: [{ currency: 'USD', payment_type: 'cash', payments: '10', amount_cents: '4800' }] });
  }

  test('salesSummary returns daily rows, totals, and breakdowns', async () => {
    mockSalesQueries();
    const res = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/reports/sales?from=2026-10-01&to=2026-10-03`);
    expect(res.status).toBe(200);
    expect(res.body.totals.orders).toBe(12);
    expect(res.body.totals.revenue_cents).toBe(4800);
    // Avg ticket divides net collected by PAID orders (10), not all orders.
    expect(res.body.totals.avg_ticket_cents).toBe(480);
    expect(res.body.totals.net_sales_cents).toBe(4800); // 5000 gross - 200 discounts
    expect(res.body.totals.tax_cents).toBe(300);
    expect(res.body.daily).toHaveLength(1);
    expect(res.body.by_fulfillment[0].fulfillment_type).toBe('pickup');
    expect(res.body.currency).toBe('USD');
    expect(res.body.currencies).toHaveLength(1);
    expect(res.body.payment_methods[0]).toEqual({ payment_type: 'cash', payments: 10, amount_cents: 4800 });
  });

  test('salesExportCsv streams the same facts as CSV', async () => {
    mockSalesQueries();
    const res = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/reports/sales/export.csv?from=2026-10-01&to=2026-10-03`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('sales-report-2026-10-01-to-2026-10-03.csv');
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toContain('net_collected_cents');
    expect(lines).toContain('2026-10-01,USD,12,10,5000,200,4800,300,150,0,0,0,4800,480');
    expect(lines).toContain('TOTAL,USD,12,10,5000,200,4800,300,150,0,0,0,4800,480');
  });

  test('salesJournalExportCsv emits order and tender rows without combining currencies', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access('manager')] })
      .mockResolvedValueOnce({ rows: [{ code: 'analytics.view_financial', allow: true }] })
      .mockResolvedValueOnce({ rows: [{
        business_date: '2026-10-01', order_id: 91, location_id: 7, location_name: 'Main, Store',
        currency: 'USD', order_source: 'counter', fulfillment_type: 'dine_in', order_status: 'completed',
        payment_status: 'paid', subtotal_cents: 1200, discount_cents: 0, tax_cents: 96,
        service_fee_cents: 0, delivery_fee_cents: 0, tip_cents: 100, order_total_cents: 1396,
        payment_id: 301, payment_type: 'cash', payment_status_detail: 'recorded', payment_amount_cents: 1396,
        payment_reference: 'drawer,1', payment_created_at: '2026-10-01T18:00:00.000Z',
      }] });
    const res = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/reports/sales/journal.csv?from=2026-10-01&to=2026-10-01`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('sales-journal-2026-10-01-to-2026-10-01.csv');
    expect(res.text).toContain('business_date,order_id,location_id');
    expect(res.text).toContain('2026-10-01,91,7,"Main, Store",USD,counter');
    expect(res.text).toContain('"drawer,1"');
  });

  test('salesSummary rejects invalid ranges', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access('owner')] })
      .mockResolvedValueOnce({ rows: [{ code: 'analytics.view_financial' }] });
    const res = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/reports/sales?from=2026-10-05&to=2026-10-01`);
    expect(res.status).toBe(400);
  });

  test('inventorySummary returns adjustment breakdown and waste leaders', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access('owner')] })
      .mockResolvedValueOnce({ rows: [{ code: 'analytics.view_financial' }] })
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
      .mockResolvedValueOnce({ rows: [{ code: 'analytics.view_financial' }] })
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
