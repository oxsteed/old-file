'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const controller = require('../controllers/oxsteedCreditController');
const service = require('../services/oxsteedCreditService');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';

function createCustomerApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: CUSTOMER_ID, role: 'customer' };
    req.correlationId = 'request-credit-test';
    next();
  });
  app.get('/account', controller.getMyAccount);
  app.get('/eligible-partners', controller.getEligiblePartners);
  app.post('/holds', controller.createMyHold);
  app.post('/transfers', controller.transferMyCredit);
  app.use(errorHandler);
  return app;
}

function createAdminApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: ADMIN_ID, role: 'super_admin' };
    req.correlationId = 'request-credit-admin-test';
    next();
  });
  app.post('/load/:customerId', controller.adminLoadCredit);
  app.post('/capture/:holdId', controller.adminCaptureHold);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET = 'credit-test-ledger-secret';
});

afterAll(() => {
  delete process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET;
});

test('creates a customer OxSteed Credit account with zero balance', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({ rows: [{ id: 7001, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, partner_id: null, currency_code: 'USD', balance_cents: '0', reserved_cents: '0', status: 'active', ledger_version: '0', updated_at: '2026-09-12T12:00:00.000Z' }] });

  const response = await request(createCustomerApp()).get('/account');

  expect(response.status).toBe(200);
  expect(response.body.name).toBe('OxSteed Credit');
  expect(response.body.account).toMatchObject({
    accountId: '7001',
    balanceCents: 0,
    availableBalanceCents: 0,
    currencyCode: 'USD',
  });
});

test('rejects credit hold creation without an idempotency key', async () => {
  const response = await request(createCustomerApp())
    .post('/holds')
    .send({ partnerId: 41, amountCents: 1500 });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_idempotency_key_required');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rejects malformed recipient ids before any credit transfer query', async () => {
  const response = await request(createCustomerApp())
    .post('/transfers')
    .set('Idempotency-Key', 'transfer-test-1')
    .send({ recipientCustomerId: 'not-a-uuid', amountCents: 100 });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('invalid_recipientCustomerId');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('requires a funding reference for Super Admin credit loads', async () => {
  const response = await request(createAdminApp())
    .post(`/load/${CUSTOMER_ID}`)
    .set('Idempotency-Key', 'admin-load-test-1')
    .send({ amountCents: 10000, reason: 'test grant' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_funding_reference_required');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rejects malformed hold capture ids before any database query', async () => {
  const response = await request(createAdminApp())
    .post('/capture/not-a-uuid')
    .set('Idempotency-Key', 'capture-test-1')
    .send({});

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('invalid_holdId');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('hashes the same journal payload deterministically', () => {
  const payload = {
    transactionId: 'tx-1',
    transactionType: 'purchase',
    accountId: 7,
    entrySide: 'debit',
    amountCents: 500,
    balanceAfterCents: 1500,
    currencyCode: 'USD',
    sequence: 2,
    previousEntryHash: 'abc',
    metadata: { b: 2, a: 1 },
  };

  expect(service.computeEntryHash(payload)).toBe(service.computeEntryHash({ ...payload, metadata: { a: 1, b: 2 } }));
});
