'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const controller = require('../controllers/oxsteedCreditController');
const service = require('../services/oxsteedCreditService');
const { verifyEntryHashes } = require('../scripts/verify-oxsteed-credit');

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
  app.get('/statement.csv', controller.downloadMyStatement);
  app.get('/statement', controller.getMyStatement);
  app.get('/transactions/:transactionId', controller.getMyTransaction);
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
  app.get('/rail', controller.getAdminCreditRail);
  app.post('/rail', controller.updateAdminCreditRail);
  app.get('/audit-events', controller.listAdminCreditAuditEvents);
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

test('returns a bounded customer statement with period totals and safe transaction fields', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    account_id: 7001,
    currency_code: 'USD',
    opening_balance_cents: '1000',
    closing_balance_cents: '800',
    transaction_count: 2,
    total_credits_cents: '500',
    total_debits_cents: '700',
    transactions: [{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      transaction_type: 'purchase',
      status: 'posted',
      amount_cents: '700',
      currency_code: 'USD',
      direction: 'debit',
      related_partner_id: 41,
      restaurant_name: 'Ox Burger Lab',
      description: 'Lunch',
      reference_type: 'food_order',
      reference_id: 'order-1',
      posted_at: '2026-09-10T15:00:00.000Z',
    }],
  }] });

  const response = await request(createCustomerApp())
    .get('/statement?from=2026-09-01&to=2026-09-12&limit=50');

  expect(response.status).toBe(200);
  expect(response.body.statement).toMatchObject({
    accountId: '7001',
    currencyCode: 'USD',
    period: { from: '2026-09-01', to: '2026-09-12' },
    openingBalanceCents: 1000,
    closingBalanceCents: 800,
    totalCreditsCents: 500,
    totalDebitsCents: 700,
    netChangeCents: -200,
    transactionCount: 2,
  });
  expect(response.body.statement.transactions[0]).toEqual(expect.objectContaining({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    restaurantName: 'Ox Burger Lab',
    direction: 'debit',
  }));
  expect(response.body.statement.transactions[0].idempotencyKey).toBeUndefined();
  expect(mockQuery.mock.calls[0][1]).toEqual([CUSTOMER_ID, '2026-09-01', '2026-09-12', 50, 0, 'USD']);
});

test('keeps legacy customer transaction reads free of ledger secrets', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    transaction_type: 'purchase',
    status: 'posted',
    amount_cents: '700',
    currency_code: 'USD',
    reference_type: 'food_order',
    reference_id: 'order-1',
    description: 'Lunch',
    posted_at: '2026-09-10T15:00:00.000Z',
    created_at: '2026-09-10T15:00:00.000Z',
    direction: 'debit',
    related_partner_id: 41,
    restaurant_name: 'Ox Burger Lab',
    idempotency_key: 'must-not-leak',
    debit_account_id: 7001,
    credit_account_id: 8001,
    actor_user_id: ADMIN_ID,
    metadata: { internal: 'must-not-leak' },
  }] });

  const response = await request(createCustomerApp())
    .get('/transactions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

  expect(response.status).toBe(200);
  expect(response.body.transaction).toMatchObject({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    restaurantName: 'Ox Burger Lab',
    direction: 'debit',
    partnerId: '41',
  });
  expect(response.body.transaction).not.toHaveProperty('idempotencyKey');
  expect(response.body.transaction).not.toHaveProperty('debitAccountId');
  expect(response.body.transaction).not.toHaveProperty('creditAccountId');
  expect(response.body.transaction).not.toHaveProperty('actorUserId');
  expect(response.body.transaction).not.toHaveProperty('metadata');
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[0][0]).not.toContain('SELECT t.*');
});

test('rejects an invalid or oversized customer statement period before querying', async () => {
  const response = await request(createCustomerApp())
    .get('/statement?from=2025-01-01&to=2026-09-12');

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_statement_period_invalid');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('creates a quoted CSV statement without exposing ledger secrets', () => {
  const csv = service.customerCreditStatementCsv({
    transactions: [{
      postedAt: '2026-09-10T15:00:00.000Z',
      id: 'tx-1',
      transactionType: 'purchase',
      description: 'Lunch, "special"',
      restaurantName: 'Ox Burger Lab',
      direction: 'debit',
      amountCents: 700,
      currencyCode: 'USD',
      referenceType: 'food_order',
      referenceId: 'order-1',
    }],
  });

  expect(csv).toContain('"Description","Restaurant"');
  expect(csv).toContain('"Lunch, ""special"""');
  expect(csv).not.toContain('idempotency');
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

test('counts active credit holds toward agreement spending limits', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      partner_id: 41,
      status: 'active',
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: null,
      allowed_order_types: [],
      allowed_categories: [],
      allowed_menu_item_ids: [],
      geography: {},
      settlement_currency_code: 'USD',
      daily_customer_limit_cents: '5000',
      lifetime_customer_limit_cents: '10000',
      entitlement_id: null,
      entitlement_status: null,
      entitlement_starts_at: null,
      entitlement_ends_at: null,
      entitlement_max_transaction_cents: null,
      entitlement_daily_limit_cents: null,
    }] })
    .mockResolvedValueOnce({ rows: [{ daily_cents: '5000', lifetime_cents: '7000' }] });

  await expect(service.findSpendAgreement({
    query: mockQuery,
  }, {
    customerId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 1,
  })).rejects.toMatchObject({ code: 'credit_daily_limit_reached' });

  expect(mockQuery.mock.calls[1][0]).toContain('oxsteed_credit_holds');
  expect(mockQuery.mock.calls[1][0]).toContain("h.status = 'active'");
});

test('recomputes the full OxSteed Credit hash chain and account heads', () => {
  const first = {
    transaction_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    account_id: 7001,
    entry_side: 'credit',
    amount_cents: '1000',
    balance_after_cents: '1000',
    sequence: 1,
    previous_entry_hash: null,
    transaction_type: 'load',
    currency_code: 'USD',
    metadata: { source: 'test' },
  };
  first.entry_hash = service.computeEntryHash({
    transactionId: first.transaction_id,
    transactionType: first.transaction_type,
    accountId: first.account_id,
    entrySide: first.entry_side,
    amountCents: 1000,
    balanceAfterCents: 1000,
    currencyCode: 'USD',
    sequence: 1,
    previousEntryHash: null,
    metadata: first.metadata,
  });
  const second = {
    ...first,
    transaction_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    entry_side: 'debit',
    amount_cents: '250',
    balance_after_cents: '750',
    sequence: 2,
    previous_entry_hash: first.entry_hash,
    transaction_type: 'purchase',
  };
  second.entry_hash = service.computeEntryHash({
    transactionId: second.transaction_id,
    transactionType: second.transaction_type,
    accountId: second.account_id,
    entrySide: second.entry_side,
    amountCents: 250,
    balanceAfterCents: 750,
    currencyCode: 'USD',
    sequence: 2,
    previousEntryHash: second.previous_entry_hash,
    metadata: second.metadata,
  });

  expect(verifyEntryHashes([first, second], [{ id: 7001, ledger_version: 2, last_entry_hash: second.entry_hash }])).toEqual({
    invalidEntryHashes: 0,
    invalidHashChains: 0,
    invalidAccountHashHeads: 0,
  });
  expect(verifyEntryHashes([{ ...second, entry_hash: 'tampered' }], [{ id: 7001, ledger_version: 2, last_entry_hash: second.entry_hash }])).toMatchObject({
    invalidEntryHashes: 1,
    invalidHashChains: 1,
    invalidAccountHashHeads: 1,
  });
});

test('replays the winning transaction when a concurrent idempotent insert loses the race', async () => {
  const existing = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    transaction_type: 'purchase',
    status: 'posted',
    debit_account_id: 7001,
    credit_account_id: 8001,
    amount_cents: '1250',
    currency_code: 'USD',
    partner_id: 41,
    agreement_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    idempotency_key: 'purchase-race-1',
    reference_type: 'food_order',
    reference_id: 'order-1',
    metadata: {},
  };
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [
      { id: 7001, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, partner_id: null, currency_code: 'USD', balance_cents: '5000', reserved_cents: '0', status: 'active' },
      { id: 8001, account_type: 'partner_payable', customer_id: null, partner_id: 41, currency_code: 'USD', balance_cents: '0', reserved_cents: '0', status: 'active' },
    ] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [existing] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await service.postJournalTransaction({ query: mockQuery }, {
    transactionType: 'purchase',
    debitAccountId: 7001,
    creditAccountId: 8001,
    amountCents: 1250,
    currencyCode: 'USD',
    partnerId: 41,
    agreementId: existing.agreement_id,
    idempotencyKey: existing.idempotency_key,
    referenceType: existing.reference_type,
    referenceId: existing.reference_id,
  });

  expect(result.replayed).toBe(true);
  expect(result.transaction).toMatchObject({ id: existing.id, amountCents: 1250, replayed: true });
  expect(mockQuery.mock.calls[2][0]).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO oxsteed_credit_transaction_entries'))).toBe(false);
});

test('fails closed when the OxSteed Credit emergency flag is disabled', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ is_enabled: false }] });

  expect(await service.isCreditRailEnabled({ query: mockQuery })).toBe(false);
  await expect(service.assertCreditRailEnabled({ query: mockQuery }))
    .rejects.toMatchObject({ code: 'credit_rail_suspended', status: 503 });
});

test('rejects a rail status change without a strict boolean', async () => {
  const response = await request(createAdminApp())
    .post('/rail')
    .send({ enabled: 'yes', reason: 'test change' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('invalid_enabled');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('changes the rail status with an audit reason and serialized control lock', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ key: 'oxsteed_credit_enabled', is_enabled: false, description: 'Credit rail', updated_by: null, updated_at: '2026-09-12T12:00:00.000Z' }] })
    .mockResolvedValueOnce({ rows: [{ key: 'oxsteed_credit_enabled', is_enabled: true, description: 'Credit rail', updated_by: ADMIN_ID, updated_at: '2026-09-12T12:01:00.000Z' }] })
    .mockResolvedValueOnce({ rows: [] });

  const response = await request(createAdminApp())
    .post('/rail')
    .send({ enabled: true, reason: 'Approved after custody review' });

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ changed: true, rail: { enabled: true, status: 'enabled', updatedBy: ADMIN_ID } });
  expect(mockQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  expect(mockQuery.mock.calls[2][0]).toContain('UPDATE feature_flags');
  expect(mockQuery.mock.calls[3][1][0]).toBe('credit.rail.enabled');
});

test('lists bounded OxSteed Credit audit events with state snapshots', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 55,
    action_type: 'credit.rail.suspended',
    actor_user_id: ADMIN_ID,
    customer_id: null,
    partner_id: null,
    resource_type: 'credit_rail',
    resource_id: 'oxsteed_credit_enabled',
    reason: 'Incident response',
    correlation_id: 'audit-test-1',
    before_state: { enabled: true },
    after_state: { enabled: false },
    metadata: { emergencyControl: true },
    created_at: '2026-09-12T12:00:00.000Z',
  }] });

  const response = await request(createAdminApp())
    .get('/audit-events?resourceType=credit_rail&limit=10');

  expect(response.status).toBe(200);
  expect(response.body.auditEvents[0]).toMatchObject({
    id: '55',
    actionType: 'credit.rail.suspended',
    resourceType: 'credit_rail',
    beforeState: { enabled: true },
    afterState: { enabled: false },
  });
  expect(mockQuery.mock.calls[0][1]).toEqual(['credit_rail', 10, 0]);
});
