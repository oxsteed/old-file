'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000099',
      email: 'payer@example.com',
      role: 'customer',
    };
    next();
  },
}));

const invoicesRouter = require('../routes/invoices');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/invoices', invoicesRouter);
  return app;
}

beforeEach(() => resetMocks());

describe('GET /api/invoices payer inbox', () => {
  test('returns received invoices matched by client email with total count', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          source_id: 12,
          invoice_kind: 'business',
          invoice_number: 'INV-2026-0001',
          client_email: 'payer@example.com',
          status: 'sent',
          amount_cents: 5000,
          counterparty_name: 'Acme LLC',
          perspective: 'received',
          public_token: 'tok-abc',
          created_at: '2026-01-01T00:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/invoices?view=received');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.invoices[0]).toMatchObject({
      perspective: 'received',
      public_token: 'tok-abc',
      id: '12',
    });
  });
});
