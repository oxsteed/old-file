'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const controller = require('../controllers/oxsteedCreditController');
const service = require('../services/oxsteedCreditService');
const { findUnsupportedCurrencyRecords, verifyEntryHashes } = require('../scripts/verify-oxsteed-credit');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';

function createCustomerApp(role = 'customer') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: CUSTOMER_ID, role };
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
  app.post('/disputes', controller.openMyDispute);
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
  app.post('/adjust/:customerId', controller.adminAdjustCredit);
  app.post('/capture/:holdId', controller.adminCaptureHold);
  app.get('/overview', controller.getAdminOverview);
  app.get('/rail', controller.getAdminCreditRail);
  app.post('/rail', controller.updateAdminCreditRail);
  app.post('/status/:customerId', controller.adminUpdateCreditAccountStatus);
  app.get('/audit-events', controller.listAdminCreditAuditEvents);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET = 'credit-test-ledger-secret-32-chars!!';
});

test('credit verification identifies records outside the configured currency allowlist', () => {
  expect(findUnsupportedCurrencyRecords([
    { resource_type: 'account', currency_code: 'USD' },
    { resource_type: 'partner', currency_code: ' jpy ' },
    { resource_type: 'transaction', currency_code: 'JPY' },
  ], ['USD'])).toEqual([
    { resourceType: 'partner', currencyCode: 'JPY' },
    { resourceType: 'transaction', currencyCode: 'JPY' },
  ]);
});

test('exposes only currencies with verified two-decimal minor-unit support', () => {
  expect(service.SUPPORTED_CREDIT_CURRENCY_META.USD).toEqual({ code: 'USD', minorUnits: 2 });
  expect(Object.values(service.SUPPORTED_CREDIT_CURRENCY_META).every((currency) => currency.minorUnits === 2)).toBe(true);
  expect(service.SUPPORTED_CREDIT_CURRENCY_META.JPY).toBeUndefined();
});

test('customer allowlist agreements require an active entitlement in eligibility queries', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  await expect(service.listEligiblePartners({ customerId: CUSTOMER_ID, currencyCode: 'USD' })).resolves.toEqual([]);

  expect(mockQuery.mock.calls[0][0]).toContain('a.requires_customer_entitlement = FALSE');
  expect(mockQuery.mock.calls[0][0]).toContain('a.requires_customer_entitlement = FALSE AND e.id IS NULL');
  expect(mockQuery.mock.calls[0][0]).toContain('e.id IS NOT NULL');
});

test('transfer replay requires the original sender and recipient', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'transfer-1',
    transaction_type: 'transfer',
    sender_customer_id: CUSTOMER_ID,
    recipient_customer_id: '33333333-3333-4333-8333-333333333333',
  }] });

  await expect(service.findExistingTransferForReplay({ query: mockQuery }, {
    senderCustomerId: CUSTOMER_ID,
    recipientCustomerId: '33333333-3333-4333-8333-333333333333',
    idempotencyKey: 'transfer-replay-1',
  })).resolves.toMatchObject({ id: 'transfer-1' });
});

test('transfer replay rejects reuse by a different recipient', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'transfer-2',
    transaction_type: 'transfer',
    sender_customer_id: CUSTOMER_ID,
    recipient_customer_id: '33333333-3333-4333-8333-333333333333',
  }] });

  await expect(service.findExistingTransferForReplay({ query: mockQuery }, {
    senderCustomerId: CUSTOMER_ID,
    recipientCustomerId: '44444444-4444-4444-8444-444444444444',
    idempotencyKey: 'transfer-replay-2',
  })).rejects.toMatchObject({ code: 'credit_idempotency_conflict', status: 409 });
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

test('does not create or expose an OxSteed Credit wallet for a non-customer role', async () => {
  const response = await request(createCustomerApp('helper')).get('/account');

  expect(response.status).toBe(404);
  expect(response.body.code).toBe('credit_customer_not_found');
  expect(mockQuery.mock.calls[0][0]).toContain("role = 'customer'");
  expect(mockQuery.mock.calls[1][0]).toContain('JOIN users owner');
});

test('creates and reads a customer account in a supported non-USD currency', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({ rows: [{ id: 7002, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, partner_id: null, currency_code: 'EUR', balance_cents: '1250', reserved_cents: '0', status: 'active', ledger_version: '1', updated_at: '2026-09-12T12:00:00.000Z' }] });

  const response = await request(createCustomerApp()).get('/account?currencyCode=EUR');

  expect(response.status).toBe(200);
  expect(response.body.account).toMatchObject({ accountId: '7002', balanceCents: 1250, currencyCode: 'EUR' });
  expect(mockQuery.mock.calls[1][1]).toEqual(['customer_wallet', CUSTOMER_ID, 'EUR']);
});

test('keeps admin credit overview balances separated by currency', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [
      { currency_code: 'EUR', customer_accounts: 1, customer_balance_cents: '2500', customer_reserved_cents: '500', partner_accounts: 1, partner_payable_cents: '2000', inactive_accounts: 0 },
      { currency_code: 'USD', customer_accounts: 2, customer_balance_cents: '10000', customer_reserved_cents: '1000', partner_accounts: 2, partner_payable_cents: '9000', inactive_accounts: 1 },
    ] })
    .mockResolvedValueOnce({ rows: [{ partner_id: 41, restaurant_id: 7, restaurant_name: 'Ox Burger Lab', status: 'active', settlement_currency_code: 'EUR', agreement_count: 1, active_agreement_count: 1 }] })
    .mockResolvedValueOnce({ rows: [] });

  const response = await request(createAdminApp()).get('/overview');

  expect(response.status).toBe(200);
  expect(response.body.summary).toMatchObject({ currencyCode: 'USD', customerBalanceCents: 10000, customerAvailableCents: 9000 });
  expect(response.body.supportedCurrencies).toEqual(expect.arrayContaining(['USD', 'EUR']));
  expect(response.body.riskLimits).toEqual(expect.objectContaining({
    maxTransactionCents: expect.any(Number),
    maxCustomerBalanceCents: expect.any(Number),
    maxTotalIssuanceCents: expect.any(Number),
    maxDailyCustomerIssuanceCents: expect.any(Number),
  }));
  expect(response.body.summaryByCurrency).toEqual(expect.arrayContaining([
    expect.objectContaining({ currencyCode: 'EUR', customerBalanceCents: 2500, customerAvailableCents: 2000 }),
    expect.objectContaining({ currencyCode: 'USD', customerBalanceCents: 10000, customerAvailableCents: 9000 }),
  ]));
  expect(response.body.partners[0].settlementCurrencyCode).toBe('EUR');
  expect(mockQuery.mock.calls[0][0]).toContain('GROUP BY currency_code');
});

test('updates the selected non-USD customer credit wallet status', async () => {
  const account = {
    id: 7002,
    account_type: 'customer_wallet',
    customer_id: CUSTOMER_ID,
    partner_id: null,
    currency_code: 'EUR',
    balance_cents: '0',
    reserved_cents: '0',
    status: 'active',
    ledger_version: '0',
  };
  mockQuery
    .mockResolvedValueOnce({ rows: [account] })
    .mockResolvedValueOnce({ rows: [{ ...account, status: 'suspended', updated_at: '2026-09-12T12:01:00.000Z' }] })
    .mockResolvedValueOnce({ rows: [] });

  const response = await request(createAdminApp())
    .post(`/status/${CUSTOMER_ID}`)
    .send({ currencyCode: 'EUR', status: 'suspended', reason: 'Partner settlement review' });

  expect(response.status).toBe(200);
  expect(response.body.account).toMatchObject({ currencyCode: 'EUR', status: 'suspended' });
  expect(mockQuery.mock.calls[0][1]).toEqual([CUSTOMER_ID, 'EUR']);
  expect(mockQuery.mock.calls[2][1][2]).toBe(String(account.id));
});

test('does not create a wallet while changing customer credit account status', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  const response = await request(createAdminApp())
    .post(`/status/${CUSTOMER_ID}`)
    .send({ currencyCode: 'CAD', status: 'suspended', reason: 'Safety review' });

  expect(response.status).toBe(404);
  expect(response.body.code).toBe('credit_account_not_found');
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[0][0]).toContain("account_type = 'customer_wallet'");
});

test('shows only spendable partner restaurants in the customer currency', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [
    {
      partner_id: 41,
      restaurant_id: 7,
      settlement_currency_code: 'USD',
      restaurant_currency_code: 'USD',
      restaurant_name: 'Ox Burger Lab',
      agreement_id: 'agreement-usd',
      version: 2,
      customer_terms: 'Use for lunch.',
      geography: null,
      allowed_order_types: ['pickup'],
      allowed_categories: [],
      max_transaction_cents: '5000',
      daily_customer_limit_cents: null,
      effective_max_transaction_cents: '4500',
      effective_daily_customer_limit_cents: '4500',
      lifetime_customer_limit_cents: '10000',
      entitlement_id: null,
    },
    {
      partner_id: 42,
      restaurant_id: 8,
      settlement_currency_code: 'EUR',
      restaurant_currency_code: 'EUR',
      restaurant_name: 'Ox Cafe Europe',
      agreement_id: 'agreement-eur',
      version: 1,
      customer_terms: 'Use for dinner.',
      geography: null,
      allowed_order_types: ['dine_in'],
      allowed_categories: [],
      max_transaction_cents: null,
      daily_customer_limit_cents: null,
      effective_max_transaction_cents: null,
      effective_daily_customer_limit_cents: null,
      lifetime_customer_limit_cents: null,
      entitlement_id: null,
    },
  ] });

  const response = await request(createCustomerApp()).get('/eligible-partners?currencyCode=USD');

  expect(response.status).toBe(200);
  expect(response.body.partners).toHaveLength(1);
  expect(response.body.partners[0]).toMatchObject({ partnerId: '41', currencyCode: 'USD', maxTransactionCents: 4500, dailyCustomerLimitCents: 4500, lifetimeCustomerLimitCents: 10000 });
  expect(mockQuery.mock.calls[0][0]).toContain('fr.currency_code');
  expect(mockQuery.mock.calls[0][0]).toContain('p.settlement_currency_code = $2');
  expect(mockQuery.mock.calls[0][0]).toContain("ca.status = 'active'");
  expect(mockQuery.mock.calls[0][0]).toContain('LEAST(a.max_transaction_cents, e.max_transaction_cents)');
});

test('rejects unsupported credit currencies before creating a wallet', async () => {
  const response = await request(createCustomerApp()).get('/account?currencyCode=JPY');

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_currency_not_supported');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rejects credit hold creation without an idempotency key', async () => {
  const response = await request(createCustomerApp())
    .post('/holds')
    .send({ partnerId: 41, amountCents: 1500 });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_idempotency_key_required');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rejects a credit hold expiry that is too far in the future before database work', async () => {
  const response = await request(createCustomerApp())
    .post('/holds')
    .set('Idempotency-Key', 'hold-too-long-1')
    .send({ partnerId: 41, amountCents: 1500, expiresAt: '2099-09-12T00:00:00.000Z' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_hold_expiry_too_long');
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

test('keeps credit transfers restricted to customer accounts', async () => {
  const response = await request(createCustomerApp('helper'))
    .post('/transfers')
    .set('Idempotency-Key', 'transfer-helper-1')
    .send({ recipientCustomerId: '22222222-2222-4222-8222-222222222222', amountCents: 100 });

  expect(response.status).toBe(403);
  expect(response.body.code).toBe('credit_transfer_customer_only');
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
      reference_id: '123',
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
    orderId: '123',
  }));
  expect(response.body.statement.transactions[0].idempotencyKey).toBeUndefined();
  expect(mockQuery.mock.calls[0][1]).toEqual([CUSTOMER_ID, '2026-09-01', '2026-09-12', 50, 0, 'USD']);
  expect(mockQuery.mock.calls[0][0]).toContain('t.currency_code = $6');
});

test('keeps legacy customer transaction reads free of ledger secrets', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    transaction_type: 'purchase',
    status: 'posted',
    amount_cents: '700',
    currency_code: 'USD',
    reference_type: 'food_order',
    reference_id: '123',
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
  expect(mockQuery.mock.calls[0][0]).toContain("t.status = 'posted'");
  expect(mockQuery.mock.calls[0][0]).toContain('t.currency_code = $3');
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
      referenceId: '123',
      orderId: '123',
    }],
  });

  expect(csv).toContain('"Description","Restaurant"');
  expect(csv).toContain('"Order ID"');
  expect(csv).toContain('"123"');
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

test('requires a funding reference for positive administrative adjustments', async () => {
  const response = await request(createAdminApp())
    .post(`/adjust/${CUSTOMER_ID}`)
    .set('Idempotency-Key', 'admin-adjustment-test-1')
    .send({ amountCents: 10000, direction: 'credit', reason: 'test grant' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_funding_reference_required');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('serializes the global outstanding issuance cap before a new load', async () => {
  const customerAccount = {
    id: 7001,
    account_type: 'customer_wallet',
    customer_id: CUSTOMER_ID,
    partner_id: null,
    currency_code: 'USD',
    balance_cents: '0',
    reserved_cents: '0',
    status: 'active',
    ledger_version: '0',
    last_entry_hash: null,
  };
  const treasuryAccount = {
    id: 9001,
    account_type: 'platform_treasury',
    customer_id: null,
    partner_id: null,
    currency_code: 'USD',
    balance_cents: '0',
    reserved_cents: '0',
    status: 'active',
    ledger_version: '0',
    last_entry_hash: null,
  };
  const transaction = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    transaction_type: 'load',
    status: 'posted',
    debit_account_id: 9001,
    credit_account_id: 7001,
    amount_cents: '100',
    currency_code: 'USD',
    partner_id: null,
    agreement_id: null,
    idempotency_key: 'issuance-test-1',
    reference_type: 'admin_load',
    reference_id: null,
    posted_at: '2026-09-12T12:00:00.000Z',
    created_at: '2026-09-12T12:00:00.000Z',
  };
  const entry = {
    id: 1,
    transaction_id: transaction.id,
    account_id: 9001,
    entry_side: 'debit',
    amount_cents: '100',
    balance_after_cents: '-100',
    sequence: '1',
    previous_entry_hash: null,
    entry_hash: 'hash-1',
    metadata: {},
    created_at: transaction.created_at,
  };
  const updatedTreasury = { ...treasuryAccount, balance_cents: '-100', ledger_version: '1', last_entry_hash: 'hash-1' };
  const updatedCustomer = { ...customerAccount, balance_cents: '100', ledger_version: '1', last_entry_hash: 'hash-2' };
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ is_enabled: true }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [customerAccount] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [treasuryAccount] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ total_cents: '0' }] })
    .mockResolvedValueOnce({ rows: [{ total_cents: '0' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [customerAccount, treasuryAccount] })
    .mockResolvedValueOnce({ rows: [transaction] })
    .mockResolvedValueOnce({ rows: [updatedTreasury] })
    .mockResolvedValueOnce({ rows: [entry] })
    .mockResolvedValueOnce({ rows: [updatedCustomer] })
    .mockResolvedValueOnce({ rows: [{ ...entry, id: 2, account_id: 7001, entry_side: 'credit', balance_after_cents: '100', entry_hash: 'hash-2' }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await service.loadCustomerCredit({
    customerId: CUSTOMER_ID,
    amountCents: 100,
    idempotencyKey: 'issuance-test-1',
  });

  expect(result.transaction.amountCents).toBe(100);
  expect(mockQuery.mock.calls[7][0]).toContain('pg_advisory_xact_lock');
  expect(mockQuery.mock.calls[7][1]).toEqual(['oxsteed-credit:issuance-limit:USD']);
  expect(mockQuery.mock.calls[8][0]).toContain('SUM(balance_cents)');
  expect(mockQuery.mock.calls[9][0]).toContain('CURRENT_DATE');
  expect(mockQuery.mock.calls[9][1]).toEqual(['USD', CUSTOMER_ID]);
});

test('replays a committed credit load while the rail is suspended', async () => {
  const existing = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    transaction_type: 'load',
    status: 'posted',
    debit_account_id: 9001,
    credit_account_id: 7001,
    amount_cents: '100',
    currency_code: 'USD',
    partner_id: null,
    agreement_id: null,
    idempotency_key: 'load-replay-rail-off',
    reference_type: 'admin_load',
    reference_id: 'funding-1',
    metadata: {},
    customer_account_customer_id: CUSTOMER_ID,
  };
  mockQuery
    .mockResolvedValueOnce({ rows: [existing] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await service.loadCustomerCredit({
    customerId: CUSTOMER_ID,
    amountCents: 100,
    idempotencyKey: existing.idempotency_key,
    referenceId: existing.reference_id,
  });

  expect(result.replayed).toBe(true);
  expect(result.transaction).toMatchObject({ id: existing.id, amountCents: 100, replayed: true });
  expect(mockQuery.mock.calls[0][0]).toContain('customer_account.customer_id');
  expect(mockQuery.mock.calls[1][0]).toContain('oxsteed_credit_transaction_entries');
});

test('applies the global issuance cap to positive administrative adjustments', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 7001, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, partner_id: null, currency_code: 'USD', balance_cents: '100', reserved_cents: '0', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 9001, account_type: 'platform_treasury', customer_id: null, partner_id: null, currency_code: 'USD', balance_cents: '0', reserved_cents: '0', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ total_cents: '5000000' }] });

  await expect(service.adjustCustomerCredit({
    customerId: CUSTOMER_ID,
    amountCents: 100,
    direction: 'credit',
    idempotencyKey: 'adjustment-cap-1',
    reason: 'Cap test',
    referenceId: 'funding-adjustment-cap-1',
  })).rejects.toMatchObject({ code: 'credit_total_issuance_limit' });
  expect(mockQuery.mock.calls[5][1]).toEqual(['oxsteed-credit:issuance-limit:USD']);
});

test('applies the per-customer daily issuance cap to positive administrative adjustments', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 7001, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, partner_id: null, currency_code: 'USD', balance_cents: '100', reserved_cents: '0', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 9001, account_type: 'platform_treasury', customer_id: null, partner_id: null, currency_code: 'USD', balance_cents: '0', reserved_cents: '0', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ total_cents: '0' }] })
    .mockResolvedValueOnce({ rows: [{ total_cents: '1000000' }] });

  await expect(service.adjustCustomerCredit({
    customerId: CUSTOMER_ID,
    amountCents: 100,
    direction: 'credit',
    idempotencyKey: 'daily-cap-1',
    reason: 'Daily cap test',
    referenceId: 'funding-daily-cap-1',
  })).rejects.toMatchObject({ code: 'credit_daily_issuance_limit' });
  expect(mockQuery.mock.calls[5][1]).toEqual(['oxsteed-credit:issuance-limit:USD']);
  expect(mockQuery.mock.calls[7][1]).toEqual(['USD', CUSTOMER_ID]);
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

test('opens disputes only for posted transactions with an atomic duplicate guard', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'tx-1', partner_id: 41 }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 'dispute-1',
      transaction_id: 'tx-1',
      customer_id: CUSTOMER_ID,
      partner_id: 41,
      status: 'open',
      reason_code: 'unauthorized',
      description: 'I do not recognize this purchase',
      opened_by: CUSTOMER_ID,
      resolved_by: null,
      opened_at: '2026-09-12T12:00:00.000Z',
      resolved_at: null,
      updated_at: '2026-09-12T12:00:00.000Z',
    }] })
    .mockResolvedValueOnce({ rows: [] });

  const response = await request(createCustomerApp())
    .post('/disputes')
    .send({ transactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reasonCode: 'unauthorized', description: 'I do not recognize this purchase' });

  expect(response.status).toBe(201);
  expect(response.body.dispute).toMatchObject({ id: 'dispute-1', status: 'open' });
  expect(mockQuery.mock.calls[0][0]).toContain("t.status = 'posted'");
  expect(mockQuery.mock.calls[0][0]).toContain('a.id = t.credit_account_id');
  expect(mockQuery.mock.calls[2][0]).toContain("ON CONFLICT (transaction_id) WHERE status IN ('open', 'in_review') DO NOTHING");
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

test('requires a dedicated ledger secret in production', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLedgerSecret = process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET;
  process.env.NODE_ENV = 'production';
  delete process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET;

  expect(() => service.computeEntryHash({ transactionId: 'tx-1', accountId: 7, entrySide: 'debit', amountCents: 1 })).toThrow('OXSTEED_CREDIT_LEDGER_HMAC_SECRET');

  process.env.NODE_ENV = originalNodeEnv;
  if (originalLedgerSecret === undefined) delete process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET;
  else process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET = originalLedgerSecret;
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

test('can exclude the hold being captured from agreement usage totals', async () => {
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
    .mockResolvedValueOnce({ rows: [{ daily_cents: '0', lifetime_cents: '0' }] });

  await expect(service.findSpendAgreement({ query: mockQuery }, {
    customerId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 5000,
    excludeHoldId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  })).resolves.toBeTruthy();

  expect(mockQuery.mock.calls[1][0]).toContain('h.id <> $4::uuid');
  expect(mockQuery.mock.calls[1][1]).toEqual([41, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', CUSTOMER_ID, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
});

test('passes the requested agreement through purchase authorization', async () => {
  const agreementId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const customerAccount = { id: 7001, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, partner_id: null, currency_code: 'USD', balance_cents: '1000', reserved_cents: '0', status: 'active', ledger_version: '0', last_entry_hash: null };
  const partnerAccount = { id: 8001, account_type: 'partner_payable', customer_id: null, partner_id: 41, currency_code: 'USD', balance_cents: '0', reserved_cents: '0', status: 'active', ledger_version: '0', last_entry_hash: null };
  const transaction = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', transaction_type: 'purchase', status: 'posted', debit_account_id: 7001, credit_account_id: 8001, amount_cents: '100', currency_code: 'USD', partner_id: 41, agreement_id: agreementId, idempotency_key: 'purchase-agreement-1', reference_type: 'food_order', reference_id: 'order-1', metadata: {}, posted_at: '2026-09-12T12:00:00.000Z' };
  const entry = { id: 1, account_id: 7001, entry_side: 'debit', amount_cents: '100', balance_after_cents: '900', sequence: 1, previous_entry_hash: null, entry_hash: 'hash-1' };

  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ is_enabled: true }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: agreementId, partner_id: 41, status: 'active', starts_at: '2026-09-01T00:00:00.000Z', ends_at: null, allowed_order_types: [], allowed_categories: [], allowed_menu_item_ids: [], geography: {}, settlement_currency_code: 'USD', restaurant_currency_code: 'USD', daily_customer_limit_cents: '10000', entitlement_id: null, entitlement_status: null }] })
    .mockResolvedValueOnce({ rows: [{ daily_cents: '0', lifetime_cents: '0' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [customerAccount] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [partnerAccount] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [customerAccount, partnerAccount] })
    .mockResolvedValueOnce({ rows: [transaction] })
    .mockResolvedValueOnce({ rows: [{ ...customerAccount, balance_cents: '900', ledger_version: '1', last_entry_hash: 'hash-1' }] })
    .mockResolvedValueOnce({ rows: [entry] })
    .mockResolvedValueOnce({ rows: [{ ...partnerAccount, balance_cents: '100', ledger_version: '1', last_entry_hash: 'hash-2' }] })
    .mockResolvedValueOnce({ rows: [{ ...entry, id: 2, account_id: 8001, entry_side: 'credit', balance_after_cents: '100', entry_hash: 'hash-2' }] })
    .mockResolvedValueOnce({ rows: [] });

  await service.purchaseWithCreditInTransaction({ query: mockQuery }, {
    customerId: CUSTOMER_ID,
    partnerId: 41,
    agreementId,
    excludeHoldId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    amountCents: 100,
    currencyCode: 'USD',
    idempotencyKey: 'purchase-agreement-1',
    referenceType: 'food_order',
    referenceId: 'order-1',
  });

  expect(mockQuery.mock.calls[4][0]).toContain('AND ($3::uuid IS NULL OR a.id = $3::uuid)');
  expect(mockQuery.mock.calls[4][1]).toEqual([CUSTOMER_ID, 41, agreementId]);
  expect(mockQuery.mock.calls[5][1]).toEqual([41, agreementId, CUSTOMER_ID, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
});

test('replays a committed purchase while the credit rail is suspended', async () => {
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
    idempotency_key: 'purchase-replay-rail-off',
    reference_type: 'food_order',
    reference_id: 'order-replay-1',
    metadata: {},
    debit_account_customer_id: CUSTOMER_ID,
    credit_account_partner_id: 41,
  };
  mockQuery
    .mockResolvedValueOnce({ rows: [existing] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await service.purchaseWithCreditInTransaction({ query: mockQuery }, {
    customerId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 1250,
    currencyCode: 'USD',
    idempotencyKey: existing.idempotency_key,
    referenceType: existing.reference_type,
    referenceId: existing.reference_id,
  });

  expect(result.replayed).toBe(true);
  expect(result.transaction).toMatchObject({ id: existing.id, amountCents: 1250, replayed: true });
  expect(mockQuery).toHaveBeenCalledTimes(2);
  expect(mockQuery.mock.calls[0][0]).toContain('debit_account.customer_id');
  expect(mockQuery.mock.calls[1][0]).toContain('oxsteed_credit_transaction_entries');
});

test('does not create a new hold for a suspended credit account', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ is_enabled: true }] })
    .mockResolvedValueOnce({ rows: [] })
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
      max_transaction_cents: null,
      daily_customer_limit_cents: null,
      lifetime_customer_limit_cents: null,
      entitlement_id: null,
      entitlement_status: null,
      entitlement_starts_at: null,
      entitlement_ends_at: null,
      entitlement_max_transaction_cents: null,
      entitlement_daily_limit_cents: null,
    }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 7001,
      account_type: 'customer_wallet',
      customer_id: CUSTOMER_ID,
      currency_code: 'USD',
      balance_cents: '1000',
      reserved_cents: '0',
      status: 'suspended',
    }] })
    .mockResolvedValueOnce({ rows: [] });

  await expect(service.createCreditHold({
    customerId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 100,
    idempotencyKey: 'suspended-hold-1',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  })).rejects.toMatchObject({ code: 'credit_account_inactive' });

  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO oxsteed_credit_holds'))).toBe(false);
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('reserved_cents = reserved_cents +'))).toBe(false);
});

test('rejects credit hold idempotency reuse for a different agreement or reference', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ is_enabled: true }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 'agreement-current',
      partner_id: 41,
      status: 'active',
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: null,
      allowed_order_types: [],
      allowed_categories: [],
      allowed_menu_item_ids: [],
      geography: {},
      settlement_currency_code: 'USD',
      max_transaction_cents: null,
      daily_customer_limit_cents: null,
      lifetime_customer_limit_cents: null,
      entitlement_id: null,
      entitlement_status: null,
      entitlement_starts_at: null,
      entitlement_ends_at: null,
      entitlement_max_transaction_cents: null,
      entitlement_daily_limit_cents: null,
      entitlement_lifetime_limit_cents: null,
    }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 7001, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, currency_code: 'USD', balance_cents: '1000', reserved_cents: '0', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'hold-existing',
      amount_cents: '100',
      partner_id: 41,
      agreement_id: 'agreement-old',
      currency_code: 'USD',
      purpose: 'Old order',
      reference_type: 'food_order',
      reference_id: 'order-old',
    }] });

  await expect(service.createCreditHold({
    customerId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 100,
    idempotencyKey: 'hold-replay-conflict-1',
    purpose: 'New order',
    referenceType: 'food_order',
    referenceId: 'order-new',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  })).rejects.toMatchObject({ code: 'credit_hold_idempotency_conflict' });
});

test('replays a non-USD credit hold when the settlement currency matches', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ is_enabled: true }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 'agreement-eur',
      partner_id: 41,
      status: 'active',
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: null,
      allowed_order_types: [],
      allowed_categories: [],
      allowed_menu_item_ids: [],
      geography: {},
      settlement_currency_code: 'EUR',
      max_transaction_cents: null,
      daily_customer_limit_cents: null,
      lifetime_customer_limit_cents: null,
      entitlement_id: null,
      entitlement_status: null,
      entitlement_starts_at: null,
      entitlement_ends_at: null,
      entitlement_max_transaction_cents: null,
      entitlement_daily_limit_cents: null,
    }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 7001,
      account_type: 'customer_wallet',
      customer_id: CUSTOMER_ID,
      currency_code: 'EUR',
      balance_cents: '1000',
      reserved_cents: '0',
      status: 'active',
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'hold-eur',
      amount_cents: '100',
      partner_id: 41,
      agreement_id: 'agreement-eur',
      currency_code: 'EUR',
      purpose: 'Order retry',
      reference_type: 'food_order',
      reference_id: 'order-eur',
      idempotency_key: 'hold-eur-replay-1',
      status: 'active',
      expires_at: '2026-09-12T13:00:00.000Z',
      created_at: '2026-09-12T12:00:00.000Z',
    }] });

  const result = await service.createCreditHold({
    customerId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 100,
    currencyCode: 'EUR',
    idempotencyKey: 'hold-eur-replay-1',
    purpose: 'Order retry',
    referenceType: 'food_order',
    referenceId: 'order-eur',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  expect(result.replayed).toBe(true);
  expect(result.hold).toMatchObject({ id: 'hold-eur', currencyCode: 'EUR' });
});

test('replays a committed credit hold while the rail is suspended', async () => {
  const existing = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    account_id: 7001,
    customer_id: CUSTOMER_ID,
    partner_id: 41,
    agreement_id: 'agreement-hold-replay',
    amount_cents: '100',
    currency_code: 'USD',
    status: 'active',
    purpose: 'Order retry',
    reference_type: 'food_order',
    reference_id: 'order-hold-replay-1',
    idempotency_key: 'hold-replay-rail-off',
    expires_at: '2026-09-12T13:00:00.000Z',
    created_at: '2026-09-12T12:00:00.000Z',
  };
  mockQuery.mockResolvedValueOnce({ rows: [existing] });

  const result = await service.createCreditHold({
    customerId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 100,
    currencyCode: 'USD',
    idempotencyKey: existing.idempotency_key,
    purpose: existing.purpose,
    referenceType: existing.reference_type,
    referenceId: existing.reference_id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  expect(result.replayed).toBe(true);
  expect(result.hold).toMatchObject({ id: existing.id, amountCents: 100, currencyCode: 'USD' });
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[0][0]).toContain('WHERE idempotency_key = $1');
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
