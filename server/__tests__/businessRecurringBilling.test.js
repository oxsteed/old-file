'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/businessRecurringBillingController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/api/businesses/:businessId/recurring-billing', ctrl.listRecurring);
  app.post('/api/businesses/:businessId/recurring-billing', ctrl.createRecurring);
  app.put('/api/businesses/:businessId/recurring-billing/:id', ctrl.updateRecurring);
  app.patch('/api/businesses/:businessId/recurring-billing/:id/toggle', ctrl.toggleStatus);
  app.delete('/api/businesses/:businessId/recurring-billing/:id', ctrl.deleteRecurring);
  app.put('/api/businesses/:businessId/recurring/:id', ctrl.updateRecurring);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('business recurring billing backend wiring', () => {
  test('lists recurring billing records from the mounted recurring-billing path', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'rb-1', business_id: 'biz-1', amount_cents: 12000, frequency: 'monthly' }],
    });

    const res = await request(buildApp()).get('/api/businesses/biz-1/recurring-billing');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(['biz-1']);
  });

  test('updates with next_billing_date using the route id parameter', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'rb-1', business_id: 'biz-1', next_billing_date: '2026-07-01' }],
    });

    const res = await request(buildApp())
      .put('/api/businesses/biz-1/recurring-billing/rb-1')
      .send({
        description: 'Monthly service',
        amount_cents: 12000,
        frequency: 'monthly',
        next_billing_date: '2026-07-01',
        status: 'active',
        notes: 'Keep active',
      });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual([
      'Monthly service',
      12000,
      'monthly',
      '2026-07-01',
      'active',
      'Keep active',
      'rb-1',
      'biz-1',
    ]);
  });

  test('keeps the legacy /recurring update route compatible with the same controller', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'rb-2', business_id: 'biz-1', next_billing_date: '2026-08-01' }],
    });

    const res = await request(buildApp())
      .put('/api/businesses/biz-1/recurring/rb-2')
      .send({
        description: 'Legacy path update',
        amount_cents: 25000,
        frequency: 'quarterly',
        next_billing_date: '2026-08-01',
      });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1].slice(-2)).toEqual(['rb-2', 'biz-1']);
  });

  test('toggles status through the dedicated toggle endpoint', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rb-1', status: 'paused' }] });

    const res = await request(buildApp()).patch('/api/businesses/biz-1/recurring-billing/rb-1/toggle');

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(['rb-1', 'biz-1']);
  });
});
