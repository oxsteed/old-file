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
      null,
      null,
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

  test('rejects invalid recurring billing amounts before touching the database', async () => {
    const res = await request(buildApp())
      .post('/api/businesses/biz-1/recurring-billing')
      .send({
        client_name: 'Client',
        description: 'Monthly service',
        amount_cents: -1,
        frequency: 'monthly',
        start_date: '2026-07-01',
      });

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
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

  describe('generateInvoice per-period duplicate guard (P3-9-F04)', () => {
    function buildGenerateApp() {
      const app = express();
      app.use(express.json());
      app.post(
        '/api/businesses/:businessId/recurring-billing/:id/generate-invoice',
        ctrl.generateInvoice
      );
      app.use(errorHandler);
      return app;
    }

    const billingRow = {
      id: 'rb-1',
      business_id: 'biz-1',
      amount_cents: 12000,
      frequency: 'monthly',
      next_billing_date: '2026-10-01',
      client_name: 'Acme',
      client_email: 'acme@example.com',
      description: 'Monthly service',
      status: 'active',
    };

    // Query order inside the transaction (the test mock of withTransaction
    // runs the callback directly: no BEGIN/COMMIT queries): advisory lock,
    // billing FOR UPDATE, period start, latest-invoice guard, legacy
    // same-day check, invoice_seq bump, INSERT, next_billing_date advance.
    function queueFreshGeneration(periodStart = '2026-09-01') {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // advisory lock
      mockQuery.mockResolvedValueOnce({ rows: [billingRow] }); // billing FOR UPDATE
      mockQuery.mockResolvedValueOnce({ rows: [{ period_start: periodStart }] });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // latest invoice: none billed
      mockQuery.mockResolvedValueOnce({ rows: [] }); // legacy same-day: none
      mockQuery.mockResolvedValueOnce({ rows: [{ invoice_seq: 42, user_id: 'user-1' }] });
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 7,
          invoice_number: 'INV-2026-0042',
          recurring_billing_id: 'rb-1',
          billing_period_start: periodStart,
        }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // advance next_billing_date
    }

    test('records the billing period on the invoice', async () => {
      queueFreshGeneration();
      const res = await request(buildGenerateApp()).post(
        '/api/businesses/biz-1/recurring-billing/rb-1/generate-invoice'
      );
      expect(res.status).toBe(201);
      const insertCall = mockQuery.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO business_invoices')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[0]).toContain('recurring_billing_id');
      expect(insertCall[0]).toContain('billing_period_start');
      expect(insertCall[1][10]).toBe('rb-1');
      expect(String(insertCall[1][11])).toContain('2026-09-01');
    });

    test('replays the existing invoice when the period was already billed', async () => {
      const existing = { id: 7, invoice_number: 'INV-2026-0042', recurring_billing_id: 'rb-1', same_period: true, later_period_billed: false };
      mockQuery.mockResolvedValueOnce({ rows: [] }); // advisory lock
      mockQuery.mockResolvedValueOnce({ rows: [billingRow] }); // billing FOR UPDATE
      mockQuery.mockResolvedValueOnce({ rows: [{ period_start: '2026-09-01' }] });
      mockQuery.mockResolvedValueOnce({ rows: [existing] }); // latest invoice: same period

      const res = await request(buildGenerateApp()).post(
        '/api/businesses/biz-1/recurring-billing/rb-1/generate-invoice'
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 7, invoice_number: 'INV-2026-0042' });
      const insertCall = mockQuery.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO business_invoices')
      );
      expect(insertCall).toBeUndefined();
    });

    test('returns 409 instead of billing backwards when a later period was already billed', async () => {
      const latest = { id: 9, invoice_number: 'INV-2026-0043', recurring_billing_id: 'rb-1', same_period: false, later_period_billed: true };
      mockQuery.mockResolvedValueOnce({ rows: [] }); // advisory lock
      mockQuery.mockResolvedValueOnce({ rows: [billingRow] }); // billing FOR UPDATE
      mockQuery.mockResolvedValueOnce({ rows: [{ period_start: '2026-09-01' }] });
      mockQuery.mockResolvedValueOnce({ rows: [latest] }); // latest invoice: later period

      const res = await request(buildGenerateApp()).post(
        '/api/businesses/biz-1/recurring-billing/rb-1/generate-invoice'
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('billing_period_already_billed');
      const insertCall = mockQuery.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO business_invoices')
      );
      expect(insertCall).toBeUndefined();
    });

    test('returns the conflicting invoice as replay when the unique backstop fires', async () => {
      const conflict = { id: 7, invoice_number: 'INV-2026-0042', recurring_billing_id: 'rb-1' };
      mockQuery.mockResolvedValueOnce({ rows: [] }); // advisory lock
      mockQuery.mockResolvedValueOnce({ rows: [billingRow] }); // billing FOR UPDATE
      mockQuery.mockResolvedValueOnce({ rows: [{ period_start: '2026-09-01' }] });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // latest invoice: none
      mockQuery.mockResolvedValueOnce({ rows: [] }); // legacy same-day: none
      mockQuery.mockResolvedValueOnce({ rows: [{ invoice_seq: 42, user_id: 'user-1' }] });
      mockQuery.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' })); // INSERT
      mockQuery.mockResolvedValueOnce({ rows: [conflict] }); // conflict re-select

      const res = await request(buildGenerateApp()).post(
        '/api/businesses/biz-1/recurring-billing/rb-1/generate-invoice'
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 7, invoice_number: 'INV-2026-0042' });
    });

    // P3-9-F04 (fail closed): cancelled or paused plans must never mint an
    // invoice, even via direct API calls that bypass the scheduler.
    test.each(['paused', 'cancelled'])('rejects invoice generation for a %s plan', async (status) => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // advisory lock
      mockQuery.mockResolvedValueOnce({ rows: [{ ...billingRow, status }] }); // billing FOR UPDATE

      const res = await request(buildGenerateApp()).post(
        '/api/businesses/biz-1/recurring-billing/rb-1/generate-invoice'
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('billing_plan_inactive');
      const insertCall = mockQuery.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO business_invoices')
      );
      expect(insertCall).toBeUndefined();
    });
  });
});
