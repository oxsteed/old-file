'use strict';

/**
 * Phase 2: restaurant-initiated credit refunds.
 *
 * Covers the fail-closed money contract: on ANY error the customer's wallet
 * balance must be unchanged. The wallet deduction and the Stripe leg run in
 * one transaction; a Stripe failure rolls the deduction back to a savepoint
 * while the refund row persists as 'failed' for audit.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const walletCtrl = require('../controllers/foodWalletController');

const stripe = require('stripe');
const mockStripeRefundsCreate = stripe.__mockInstance.refunds.create;

const RESTAURANT_ID = 7;
const BUSINESS_ID = 42;
const ACCOUNT_ID = 55;
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000456';
const OPERATOR_ID = '00000000-0000-4000-8000-000000000123';
const STAFF_ID = '00000000-0000-4000-8000-000000000999';

function restaurantRow(role = 'owner') {
  return {
    id: RESTAURANT_ID,
    business_id: BUSINESS_ID,
    owner_user_id: OPERATOR_ID,
    display_name: 'Ox Burger Lab',
    currency_code: 'USD',
    effective_role: role,
  };
}

function customerRow() {
  return {
    id: CUSTOMER_ID,
    first_name: 'Sam',
    last_name: 'Diner',
    email: 'sam@example.com',
  };
}

function accountRow(overrides = {}) {
  return {
    id: ACCOUNT_ID,
    restaurant_id: RESTAURANT_ID,
    customer_id: CUSTOMER_ID,
    currency_code: 'USD',
    balance_cents: 5000,
    reserved_cents: 0,
    status: 'active',
    ledger_version: 3,
    last_entry_hash: 'hash-abc',
    ...overrides,
  };
}

function pendingRefundRow(overrides = {}) {
  return {
    id: 77,
    wallet_id: ACCOUNT_ID,
    customer_id: CUSTOMER_ID,
    restaurant_id: RESTAURANT_ID,
    amount_cents: 2500,
    currency_code: 'USD',
    status: 'pending',
    stripe_refund_id: null,
    idempotency_key: 'refund-key-1',
    reason: 'customer request',
    initiated_by: OPERATOR_ID,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    processed_at: null,
    ...overrides,
  };
}

// Mutable per-test DB state answered by the mock below.
const dbState = {
  role: 'owner',
  account: null, // null = wallet not found
  issuedCents: 5000,
  existingRefund: null,
  refundList: [],
  order: { id: 9, stripe_payment_intent_id: 'pi_test_123', metadata: {} },
};

function resetDbState() {
  dbState.role = 'owner';
  dbState.account = accountRow();
  dbState.issuedCents = 5000;
  dbState.existingRefund = null;
  dbState.refundList = [];
  dbState.order = { id: 9, stripe_payment_intent_id: 'pi_test_123', metadata: {} };
}

// Mirrors the dual-posting fixture in foodWallet.test.js: answers the
// central-journal queries issued by debitFoodWallet -> postFoodWalletDualEntry.
function dualPostFixture(sql, params = []) {
  const normalized = String(sql);
  const subBank = {
    id: 900, account_type: 'restaurant_sub_bank', customer_id: null, partner_id: null,
    restaurant_id: RESTAURANT_ID, currency_code: 'USD', balance_cents: 5000,
    reserved_cents: 0, status: 'active', ledger_version: 0, last_entry_hash: null,
  };
  const treasury = {
    id: 901, account_type: 'platform_treasury', customer_id: null, partner_id: null,
    restaurant_id: null, currency_code: 'USD', balance_cents: 1000000,
    reserved_cents: 0, status: 'active', ledger_version: 0, last_entry_hash: null,
  };
  const payable = {
    id: 902, account_type: 'partner_payable', customer_id: null, partner_id: 41,
    restaurant_id: null, currency_code: 'USD', balance_cents: 0,
    reserved_cents: 0, status: 'active', ledger_version: 0, last_entry_hash: null,
  };
  const byType = { restaurant_sub_bank: subBank, platform_treasury: treasury, partner_payable: payable };
  if (normalized.includes('pg_advisory_xact_lock(hashtext')) return { rows: [{}] };
  if (normalized.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) {
    return { rows: [{ is_enabled: true }] };
  }
  if (normalized.includes('FROM oxsteed_credit_partners p WHERE p.restaurant_id')) {
    return { rows: [{ id: 41, restaurant_id: RESTAURANT_ID, business_id: BUSINESS_ID, status: 'pending' }] };
  }
  if (normalized.includes('INSERT INTO oxsteed_credit_accounts')) return { rows: [] };
  if (normalized.includes('FROM oxsteed_credit_accounts a')) {
    return { rows: [byType[params[0]] || subBank] };
  }
  if (normalized.includes('SELECT * FROM oxsteed_credit_transactions WHERE idempotency_key')) return { rows: [] };
  if (normalized.includes('SELECT id, status, transaction_type FROM oxsteed_credit_transactions')) return { rows: [] };
  if (normalized.includes('WHERE id = ANY($1::bigint[])')) {
    const requestedIds = new Set((params[0] || []).map(String));
    const accounts = [subBank, treasury, payable].filter((account) => requestedIds.has(String(account.id)));
    return { rows: accounts.sort((a, b) => a.id - b.id) };
  }
  if (normalized.includes('INSERT INTO oxsteed_credit_transactions')) {
    return {
      rows: [{
        id: 7000,
        transaction_type: params[2],
        debit_account_id: params[0],
        credit_account_id: params[1],
        amount_cents: params[3],
        currency_code: params[4],
        partner_id: params[5],
        status: 'posted',
        posted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }],
    };
  }
  if (normalized.includes('INSERT INTO oxsteed_credit_transaction_entries')) return { rows: [{ id: 1 }] };
  if (normalized.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
  if (normalized.includes('oxsteed_credit_notifications')) return { rows: [] };
  return null;
}

function installDbMock(calls) {
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    calls.push(text);
    const creditFixture = dualPostFixture(text, params);
    if (creditFixture) return creditFixture;

    if (text.includes('FROM food_restaurants fr') && text.includes('JOIN businesses b')) {
      return { rows: [restaurantRow(dbState.role)] };
    }
    if (text.includes('FROM users') && text.includes('first_name')) {
      return { rows: [customerRow()] };
    }
    if (text.includes('INSERT INTO food_credit_refunds')) {
      return { rows: [pendingRefundRow()] };
    }
    if (text.includes('UPDATE food_credit_refunds')) {
      if (text.includes("SET status = 'processed'")) {
        return { rows: [pendingRefundRow({ status: 'processed', stripe_refund_id: 're_test_1', processed_at: new Date().toISOString() })] };
      }
      if (text.includes("SET status = 'failed'")) {
        return { rows: [pendingRefundRow({ status: 'failed', reason: params[1] || 'failed' })] };
      }
      return { rows: [pendingRefundRow({ status: 'pending' })] };
    }
    if (text.includes('FROM food_credit_refunds')) {
      if (text.includes('idempotency_key')) {
        return { rows: dbState.existingRefund ? [dbState.existingRefund] : [] };
      }
      return { rows: dbState.refundList };
    }
    if (text.includes('FROM food_customer_wallet_accounts a') && text.includes('JOIN food_restaurants fr')) {
      return { rows: dbState.account ? [dbState.account] : [] };
    }
    if (text.includes('INSERT INTO food_customer_wallet_accounts')) {
      return { rows: [] };
    }
    if (text.includes('FROM food_customer_wallet_accounts a')) {
      return { rows: [dbState.account || accountRow()] };
    }
    if (text.includes('FROM food_customer_wallet_ledger') && text.includes('SUM(amount_cents)')) {
      return { rows: [{ issued_cents: String(dbState.issuedCents) }] };
    }
    if (text.includes('FROM food_customer_wallet_ledger')) {
      return { rows: [] };
    }
    if (text.includes('UPDATE food_customer_wallet_accounts')) {
      const newBalance = Number(params[0]);
      return { rows: [accountRow({ balance_cents: newBalance, ledger_version: 4, last_entry_hash: 'hash-def' })] };
    }
    if (text.includes('INSERT INTO food_customer_wallet_ledger')) {
      return {
        rows: [{
          id: 1234, entry_type: 'debit', amount_cents: 2500, balance_after_cents: 2500,
          currency_code: 'USD', entry_sequence: 4, entry_hash: 'hash-def',
        }],
      };
    }
    if (text.includes('FROM food_orders')) {
      return { rows: dbState.order ? [dbState.order] : [] };
    }
    if (text.includes('INSERT INTO food_customer_wallet_operator_audit_events')) {
      return { rows: [{}] };
    }
    return { rows: [], rowCount: 0 };
  });
}

function buildMerchantApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.post('/api/food/merchant/wallets/:restaurantId/refunds', walletCtrl.createCustomerWalletRefund);
  app.get('/api/food/merchant/wallets/:restaurantId/refunds', walletCtrl.listRestaurantWalletRefunds);
  app.get('/api/food/customer/wallets/:restaurantId/refunds', walletCtrl.listMyWalletRefunds);
  app.use(errorHandler);
  return app;
}

function refundPayload(overrides = {}) {
  return {
    customer_id: CUSTOMER_ID,
    amount_cents: 2500,
    reason: 'customer request',
    idempotency_key: 'refund-key-1',
    ...overrides,
  };
}

beforeEach(() => {
  resetMocks();
  resetDbState();
  mockStripeRefundsCreate.mockReset();
});

describe('POST /api/food/merchant/wallets/:restaurantId/refunds', () => {
  test('happy path: debits wallet, processes Stripe refund, marks processed', async () => {
    const calls = [];
    installDbMock(calls);
    mockStripeRefundsCreate.mockResolvedValue({ id: 're_test_1', amount: 2500, status: 'succeeded' });

    const app = buildMerchantApp({ id: OPERATOR_ID, email: 'owner@example.com' });
    const res = await request(app)
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/refunds`)
      .send(refundPayload());

    expect(res.status).toBe(201);
    expect(res.body.refund.status).toBe('processed');
    expect(res.body.refund.stripeRefundId).toBe('re_test_1');
    expect(res.body.refund.amountCents).toBe(2500);
    expect(res.body.replayed).toBe(false);

    // Stripe was called against the customer's most recent charge.
    expect(mockStripeRefundsCreate).toHaveBeenCalledTimes(1);
    const [refundParams] = mockStripeRefundsCreate.mock.calls[0];
    expect(refundParams.payment_intent).toBe('pi_test_123');
    expect(refundParams.amount).toBe(2500);

    // The wallet deduction went through inside the money savepoint.
    const walletUpdateIdx = calls.findIndex((sql) => sql.includes('UPDATE food_customer_wallet_accounts'));
    const savepointIdx = calls.findIndex((sql) => sql.includes('SAVEPOINT food_credit_refund_money'));
    const releaseIdx = calls.findIndex((sql) => sql.includes('RELEASE SAVEPOINT food_credit_refund_money'));
    expect(walletUpdateIdx).toBeGreaterThan(-1);
    expect(savepointIdx).toBeGreaterThan(-1);
    expect(releaseIdx).toBeGreaterThan(walletUpdateIdx);
    expect(calls.some((sql) => sql.includes('ROLLBACK TO SAVEPOINT'))).toBe(false);
  });

  test('insufficient balance blocks the refund before any money moves', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.account = accountRow({ balance_cents: 1000 });

    const app = buildMerchantApp({ id: OPERATOR_ID, email: 'owner@example.com' });
    const res = await request(app)
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/refunds`)
      .send(refundPayload());

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('wallet_insufficient_funds');
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
    expect(calls.some((sql) => sql.includes('INSERT INTO food_credit_refunds'))).toBe(false);
    expect(calls.some((sql) => sql.includes('UPDATE food_customer_wallet_accounts'))).toBe(false);
  });

  test('duplicate idempotency key returns the existing refund without moving money', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.existingRefund = pendingRefundRow({ status: 'processed', stripe_refund_id: 're_test_1' });
    mockStripeRefundsCreate.mockResolvedValue({ id: 're_test_9', amount: 2500, status: 'succeeded' });

    const app = buildMerchantApp({ id: OPERATOR_ID, email: 'owner@example.com' });
    const res = await request(app)
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/refunds`)
      .send(refundPayload());

    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(true);
    expect(res.body.refund.stripeRefundId).toBe('re_test_1');
    // No second Stripe call, no wallet write: the replay is a pure read.
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
    expect(calls.some((sql) => sql.includes('UPDATE food_customer_wallet_accounts'))).toBe(false);
    expect(calls.some((sql) => sql.includes('INSERT INTO food_credit_refunds'))).toBe(false);
  });

  test('idempotency conflict on mismatched params fails closed', async () => {
    installDbMock([]);
    dbState.existingRefund = pendingRefundRow({ status: 'processed', amount_cents: 9999 });

    const app = buildMerchantApp({ id: OPERATOR_ID, email: 'owner@example.com' });
    const res = await request(app)
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/refunds`)
      .send(refundPayload());

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('wallet_refund_idempotency_conflict');
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
  });

  test('Stripe failure rolls back the wallet deduction and marks the refund failed', async () => {
    const calls = [];
    installDbMock(calls);
    mockStripeRefundsCreate.mockRejectedValue(new Error('card declined'));

    const app = buildMerchantApp({ id: OPERATOR_ID, email: 'owner@example.com' });
    const res = await request(app)
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/refunds`)
      .send(refundPayload());

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('stripe_refund_failed');

    // The wallet deduction was attempted, then rolled back to the savepoint.
    const walletUpdateIdx = calls.findIndex((sql) => sql.includes('UPDATE food_customer_wallet_accounts'));
    const rollbackIdx = calls.findIndex((sql) => sql.includes('ROLLBACK TO SAVEPOINT food_credit_refund_money'));
    expect(walletUpdateIdx).toBeGreaterThan(-1);
    expect(rollbackIdx).toBeGreaterThan(walletUpdateIdx);
    // The refund row survives as 'failed' for audit, with the wallet untouched.
    const failedUpdateIdx = calls.findIndex(
      (sql) => sql.includes('UPDATE food_credit_refunds') && sql.includes("SET status = 'failed'")
    );
    expect(failedUpdateIdx).toBeGreaterThan(rollbackIdx);
    expect(calls.some((sql) => sql.includes('RELEASE SAVEPOINT food_credit_refund_money'))).toBe(false);
  });

  test('no Stripe payment on file fails closed without touching the wallet', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.order = null;

    const app = buildMerchantApp({ id: OPERATOR_ID, email: 'owner@example.com' });
    const res = await request(app)
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/refunds`)
      .send(refundPayload());

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('refund_no_payment_rail');
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
    const rollbackIdx = calls.findIndex((sql) => sql.includes('ROLLBACK TO SAVEPOINT food_credit_refund_money'));
    expect(rollbackIdx).toBeGreaterThan(-1);
  });

  test('non-operator is blocked before any money logic runs', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.role = 'staff';
    mockStripeRefundsCreate.mockResolvedValue({ id: 're_test_1', amount: 2500, status: 'succeeded' });

    const app = buildMerchantApp({ id: STAFF_ID, email: 'staff@example.com' });
    const res = await request(app)
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/refunds`)
      .send(refundPayload());

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
    expect(calls.some((sql) => sql.includes('food_credit_refunds'))).toBe(false);
  });

  test('credit issued outside the 30-day window cannot be refunded', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.issuedCents = 1000;

    const app = buildMerchantApp({ id: OPERATOR_ID, email: 'owner@example.com' });
    const res = await request(app)
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/refunds`)
      .send(refundPayload());

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('wallet_refund_outside_window');
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
    expect(calls.some((sql) => sql.includes('INSERT INTO food_credit_refunds'))).toBe(false);
  });

  test('missing idempotency key is rejected', async () => {
    installDbMock([]);
    const app = buildMerchantApp({ id: OPERATOR_ID, email: 'owner@example.com' });
    const res = await request(app)
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/refunds`)
      .send({ customer_id: CUSTOMER_ID, amount_cents: 2500 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
  });

  test('refund above the configured max is rejected', async () => {
    installDbMock([]);
    const app = buildMerchantApp({ id: OPERATOR_ID, email: 'owner@example.com' });
    const res = await request(app)
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/refunds`)
      .send(refundPayload({ amount_cents: 10000000, idempotency_key: 'refund-key-big' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
  });
});

describe('refund listing', () => {
  test('merchant lists refunds for their restaurant', async () => {
    installDbMock([]);
    dbState.refundList = [
      pendingRefundRow({ status: 'processed', stripe_refund_id: 're_test_1' }),
      pendingRefundRow({ id: 78, status: 'failed', idempotency_key: 'refund-key-2', reason: 'stripe_refund_failed: card declined' }),
    ];

    const app = buildMerchantApp({ id: OPERATOR_ID, email: 'owner@example.com' });
    const res = await request(app).get(`/api/food/merchant/wallets/${RESTAURANT_ID}/refunds`);

    expect(res.status).toBe(200);
    expect(res.body.refunds).toHaveLength(2);
    expect(res.body.refunds[0].status).toBe('processed');
    expect(res.body.refunds[0].stripeRefundId).toBe('re_test_1');
  });

  test('merchant list is blocked for non-operators', async () => {
    installDbMock([]);
    dbState.role = 'staff';

    const app = buildMerchantApp({ id: STAFF_ID, email: 'staff@example.com' });
    const res = await request(app).get(`/api/food/merchant/wallets/${RESTAURANT_ID}/refunds`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  test('customer sees their own refunds', async () => {
    installDbMock([]);
    dbState.refundList = [pendingRefundRow({ status: 'processed', stripe_refund_id: 're_test_1' })];

    const app = buildMerchantApp({ id: CUSTOMER_ID, email: 'sam@example.com' });
    const res = await request(app).get(`/api/food/customer/wallets/${RESTAURANT_ID}/refunds`);

    expect(res.status).toBe(200);
    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0].status).toBe('processed');
  });
});
