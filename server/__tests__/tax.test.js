'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'helper-1' };
    next();
  },
}));

const taxRoutes = require('../routes/tax');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tax', taxRoutes);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

beforeEach(() => resetMocks());

describe('tax document routes', () => {
  test('GET /api/tax/summary returns annual income, expense, and 1099 requirement data', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ gross_cents: '75000', job_count: '3' }] })
      .mockResolvedValueOnce({ rows: [{ revenue_cents: '25000', invoice_count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ total_expense_cents: '10000', expense_count: '4' }] })
      .mockResolvedValueOnce({ rows: [{ category: 'tools', total_cents: '10000', count: '4' }] });

    const res = await request(buildApp()).get('/api/tax/summary').query({ year: 2026 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      year: 2026,
      helper_earnings: { gross_cents: 75000, job_count: 3 },
      business_revenue: { revenue_cents: 25000, invoice_count: 2 },
      total_income_cents: 100000,
      total_expense_cents: 10000,
      net_income_cents: 90000,
      form_1099_required: true,
    });
    expect(res.body.expense_by_category[0]).toEqual({ category: 'tools', total_cents: 10000, count: 4 });
  });

  test('GET /api/tax/expenses returns deductible expense rows for the year', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 7,
          category: 'tools',
          description: 'Replacement drill bits',
          amount_cents: 4500,
          expense_date: '2026-05-01',
          receipt_url: null,
          notes: 'Job supplies',
          business_name: 'Ox Services',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ cnt: '1' }] });

    const res = await request(buildApp()).get('/api/tax/expenses').query({ year: 2026 });

    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.total).toBe(1);
    expect(res.body.expenses[0]).toMatchObject({
      id: 7,
      category: 'tools',
      amount_cents: 4500,
      business_name: 'Ox Services',
    });
  });

  test('GET /api/tax/1099-preview returns payer-level threshold data', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        payer_name: 'Jamie Customer',
        payer_email: 'jamie@example.com',
        business_name: 'Jamie Homes',
        total_paid_cents: '65000',
        payment_count: '4',
      }],
    });

    const res = await request(buildApp()).get('/api/tax/1099-preview').query({ year: 2026 });

    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.payers[0]).toMatchObject({
      payer_name: 'Jamie Customer',
      payer_email: 'jamie@example.com',
      business_name: 'Jamie Homes',
      total_paid_cents: 65000,
      payment_count: 4,
      form_required: true,
    });
  });
});
