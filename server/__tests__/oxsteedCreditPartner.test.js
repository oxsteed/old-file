'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/oxsteedCreditAdminService', () => ({
  listSettlements: jest.fn(),
}));

const { listSettlements } = require('../services/oxsteedCreditAdminService');
const controller = require('../controllers/oxsteedCreditPartnerController');

function buildApp(role = 'owner') {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: '11111111-1111-4111-8111-111111111111', role };
    req.correlationId = 'credit-partner-test';
    next();
  });
  app.get('/restaurants/:restaurantId/settlements', controller.listPartnerSettlements);
  app.get('/restaurants/:restaurantId/transactions', controller.listPartnerTransactions);
  app.get('/restaurants/:restaurantId/report.csv', controller.downloadPartnerCreditReport);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  listSettlements.mockReset();
});

test('allows an owner to view partner settlements without customer data', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 9, effective_role: 'owner' }] })
    .mockResolvedValueOnce({ rows: [{ id: 55, status: 'active' }] });
  listSettlements.mockResolvedValueOnce([{ id: 'settlement-1', netCents: 2500 }]);

  const response = await request(buildApp())
    .get('/restaurants/9/settlements?status=pending&limit=25');

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    partnerId: '55',
    partnerStatus: 'active',
    settlements: [{ id: 'settlement-1', netCents: 2500 }],
  });
  expect(listSettlements).toHaveBeenCalledWith({ partnerId: 55, status: 'pending', limit: '25', includePagination: true });
});

test('allows an active manager to view partner transactions without customer identity fields', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 9, effective_role: 'manager' }] })
    .mockResolvedValueOnce({ rows: [{ id: 55, status: 'active', settlement_currency_code: 'EUR' }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'transaction-1',
      transaction_type: 'purchase',
      status: 'posted',
      amount_cents: '1800',
      currency_code: 'EUR',
      agreement_id: 'agreement-1',
      reference_type: 'food_order',
      reference_id: 'order-1',
      description: 'Restricted credit purchase',
      customer_id: 'private-customer-id',
      customer_email: 'private@example.com',
      created_at: '2026-09-12T12:00:00.000Z',
    }] });

  const response = await request(buildApp('manager'))
    .get('/restaurants/9/transactions?limit=10');

  expect(response.status).toBe(200);
  expect(response.body.transactions[0]).toMatchObject({
    id: 'transaction-1',
    amountCents: 1800,
    status: 'posted',
  });
  expect(response.body.transactions[0]).not.toHaveProperty('customerId');
  expect(response.body.transactions[0]).not.toHaveProperty('customerEmail');
  expect(response.body.pagination).toEqual({ limit: 10, offset: 0, hasMore: false, nextOffset: null });
  expect(mockQuery.mock.calls[2][0]).toContain("t.status = 'posted'");
  expect(mockQuery.mock.calls[2][0]).toContain('t.currency_code = $2');
  expect(mockQuery.mock.calls[2][1]).toEqual([55, 'EUR', 11, 0]);
});

test('removes internal settlement fields from the partner response', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 9, effective_role: 'owner' }] })
    .mockResolvedValueOnce({ rows: [{ id: 55, status: 'active' }] });
  listSettlements.mockResolvedValueOnce([{
    id: 'settlement-1',
    partnerId: '55',
    agreementId: 'agreement-1',
    currencyCode: 'USD',
    grossCents: 3000,
    refundCents: 500,
    feeCents: 100,
    netCents: 2400,
    status: 'approved',
    paymentReference: null,
    approvedBy: 'internal-admin-id',
    metadata: { internal: 'must-not-leak' },
    createdAt: '2026-09-12T12:00:00.000Z',
  }]);

  const response = await request(buildApp()).get('/restaurants/9/settlements');

  expect(response.status).toBe(200);
  expect(response.body.settlements[0]).toMatchObject({ id: 'settlement-1', netCents: 2400 });
  expect(response.body.settlements[0]).not.toHaveProperty('approvedBy');
  expect(response.body.settlements[0]).not.toHaveProperty('metadata');
  expect(response.body.pagination).toEqual({ limit: 1, offset: 0, hasMore: false, nextOffset: null });
});

test('exports a bounded partner Credit report without customer identity fields', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 9, effective_role: 'owner' }] })
    .mockResolvedValueOnce({ rows: [{ id: 55, status: 'active', settlement_currency_code: 'USD' }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'transaction-1',
      transaction_type: 'purchase',
      status: 'posted',
      amount_cents: '1800',
      currency_code: 'USD',
      agreement_id: 'agreement-1',
      reference_type: 'food_order',
      reference_id: 'order-1',
      description: '=2+2',
      customer_id: 'private-customer-id',
      customer_email: 'private@example.com',
      posted_at: '2026-09-12T12:00:00.000Z',
    }] });
  listSettlements.mockResolvedValueOnce([{ id: 'settlement-1', createdAt: '2026-09-13T12:00:00.000Z', currencyCode: 'USD', periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-09-02T00:00:00.000Z', refundCents: 0, feeCents: 100, netCents: 1700, status: 'approved', agreementId: 'agreement-1', paymentReference: null }]);

  const response = await request(buildApp()).get('/restaurants/9/report.csv');

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/text\/csv/);
  expect(response.headers['content-disposition']).toMatch(/oxsteed-credit-report-/);
  expect(response.text).toContain('Record type');
  expect(response.text).toContain('"\'=2+2"');
  expect(response.text).not.toContain('private@example.com');
  expect(response.text).not.toContain('private-customer-id');
  expect(mockQuery.mock.calls[2][1]).toEqual([55, 'USD', 5001]);
  expect(listSettlements).toHaveBeenCalledWith({ partnerId: 55, limit: 250, offset: 0, includePagination: true });
});

test('rejects non-manager restaurant staff before reading partner data', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 9, effective_role: 'employee' }] });

  const response = await request(buildApp('employee')).get('/restaurants/9/transactions');

  expect(response.status).toBe(403);
  expect(response.body.code).toBe('forbidden');
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('rejects invalid restaurant ids before any database query', async () => {
  const response = await request(buildApp()).get('/restaurants/not-an-id/settlements');

  expect(response.status).toBe(404);
  expect(response.body.code).toBe('restaurant_not_found');
  expect(mockQuery).not.toHaveBeenCalled();
});
