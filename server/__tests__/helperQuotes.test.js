'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

const quoteRoutes = require('../routes/helperQuotes');

const CUSTOMER_ID = 1;
const HELPER_ID = 2;
const CUSTOMER_TOKEN = jwt.sign({ id: CUSTOMER_ID, email: 'c@test.com', role: 'customer' }, process.env.JWT_SECRET);
const HELPER_TOKEN = jwt.sign({ id: HELPER_ID, email: 'h@test.com', role: 'helper' }, process.env.JWT_SECRET);

const CUSTOMER = {
  id: CUSTOMER_ID,
  first_name: 'Casey',
  last_name: 'Home',
  email: 'c@test.com',
  role: 'customer',
  email_verified: true,
  is_active: true,
  didit_status: 'verified',
  didit_verified_at: new Date(),
  didit_enforcement_required: false,
};

const HELPER = {
  id: HELPER_ID,
  first_name: 'Bob',
  last_name: 'Fix',
  email: 'h@test.com',
  role: 'helper',
  email_verified: true,
  is_active: true,
  didit_status: 'verified',
  didit_verified_at: new Date(),
  didit_enforcement_required: false,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/helper-quotes', quoteRoutes);
  return app;
}

const customerAuth = r => r.set('Authorization', `Bearer ${CUSTOMER_TOKEN}`);
const helperAuth = r => r.set('Authorization', `Bearer ${HELPER_TOKEN}`);

beforeEach(() => resetMocks());

describe('PATCH /api/helper-quotes/:id/status', () => {
  test('accepts a sent quote for the job owner', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [CUSTOMER] })
      .mockResolvedValueOnce({ rows: [{ id: 9 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: '9',
          job_id: '10',
          helper_id: HELPER_ID,
          line_items: [{ description: 'Labor', type: 'labor', quantity: 1, unit_price_cents: 25000 }],
          tax_rate: 0,
          subtotal_cents: 25000,
          tax_cents: 0,
          total_cents: 25000,
          status: 'accepted',
        }],
      });

    const res = await customerAuth(
      request(buildApp()).patch('/api/helper-quotes/9/status').send({ status: 'accepted' })
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(res.body.total_cents).toBe(25000);
  });

  test('rejects invalid quote status values', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [CUSTOMER] });

    const res = await customerAuth(
      request(buildApp()).patch('/api/helper-quotes/9/status').send({ status: 'withdrawn' })
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/accepted or declined/i);
  });

  test('does not let the helper accept their own quote as the customer', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [HELPER] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await helperAuth(
      request(buildApp()).patch('/api/helper-quotes/9/status').send({ status: 'accepted' })
    );

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/cannot update/i);
  });
});
