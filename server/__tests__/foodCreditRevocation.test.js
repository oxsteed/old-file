'use strict';

/**
 * Phase 6 (restaurant credit protection): the revocation path.
 *
 * Covers the fail-closed money contract:
 *  - revoking a restaurant's credit approval blocks new customer load
 *    requests with 403 `restaurant_credit_not_approved`;
 *  - suspending blocks merchant approvals of pending load requests;
 *  - a restaurant with no approval row is grandfathered (treated as
 *    approved) so existing behavior keeps working;
 *  - the grace-period worker migrates each remaining customer balance to
 *    OxSteed Credit atomically (wallet debit + migration record in one
 *    transaction) and leaves balances untouched on ANY error;
 *  - re-approving clears the revoked/suspended state.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { AppError } = require('../middleware/errorHandler');

jest.mock('../services/foodCreditFraudService', () => ({
  screenLoadRequest: jest.fn().mockResolvedValue(undefined),
  screenPostCreateAnomalies: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/foodWalletService', () => {
  const actual = jest.requireActual('../services/foodWalletService');
  return { ...actual, debitFoodWallet: jest.fn() };
});
jest.mock('../services/oxsteedCreditService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditService');
  return { ...actual, assertCreditRailEnabled: jest.fn().mockResolvedValue(undefined) };
});
jest.mock('../services/sanctionsScreeningService', () => ({
  assertSanctionsClear: jest.fn().mockResolvedValue({ cleared: false }),
}));

const walletCtrl = require('../controllers/foodWalletController');
const revocationService = require('../services/restaurantCreditRevocationService');
const { debitFoodWallet } = require('../services/foodWalletService');
const { assertSanctionsClear } = require('../services/sanctionsScreeningService');

const RESTAURANT_ID = 7;
const BUSINESS_ID = 42;
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000456';
const OPERATOR_ID = '00000000-0000-4000-8000-000000000123';
const ACCOUNT_ID = 55;

function restaurantRow() {
  return {
    id: RESTAURANT_ID,
    business_id: BUSINESS_ID,
    display_name: 'Ox Burger Lab',
    currency_code: 'USD',
    status: 'active',
  };
}

function accessRow(role = 'owner') {
  return {
    id: RESTAURANT_ID,
    business_id: BUSINESS_ID,
    owner_user_id: OPERATOR_ID,
    display_name: 'Ox Burger Lab',
    currency_code: 'USD',
    effective_role: role,
  };
}

function approvalRow(overrides = {}) {
  return {
    restaurant_id: RESTAURANT_ID,
    status: 'revoked',
    approved_at: null,
    revoked_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    revocation_reason: 'Repeated settlement failures',
    grace_period_ends_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    migrated_at: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function accountRow(overrides = {}) {
  return {
    id: ACCOUNT_ID,
    customer_id: CUSTOMER_ID,
    currency_code: 'USD',
    balance_cents: 5000,
    reserved_cents: 0,
    status: 'active',
    ...overrides,
  };
}

// Mutable per-test DB state answered by the mock below.
const dbState = {
  approval: null, // null = no row (grandfathered)
  approvalRows: [],
  restaurantMissing: false,
  loadRequestExisting: null,
  claimRow: null,
  accounts: [],
  migrationExisting: null,
  remainingCount: 0,
};

const calls = { migrationInserts: [], approvalUpdates: 0, approvalInserts: [] };

function resetDbState() {
  dbState.approval = null;
  dbState.approvalRows = [];
  dbState.restaurantMissing = false;
  dbState.loadRequestExisting = null;
  dbState.claimRow = null;
  dbState.accounts = [];
  dbState.migrationExisting = null;
  dbState.remainingCount = 0;
  calls.migrationInserts = [];
  calls.approvalUpdates = 0;
  calls.approvalInserts = [];
  debitFoodWallet.mockReset();
  debitFoodWallet.mockResolvedValue({ entry: { id: 1234 }, account: accountRow(), replayed: false });
  assertSanctionsClear.mockReset();
  assertSanctionsClear.mockResolvedValue({ cleared: false });
}

function installDbMock() {
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);

    // Grace-period worker: claim due revocations.
    if (text.includes('FROM restaurant_credit_approvals') && text.includes('FOR UPDATE SKIP LOCKED')) {
      return { rows: dbState.claimRow ? [dbState.claimRow] : [] };
    }
    // Worker: mark restaurant migrated.
    if (text.includes('UPDATE restaurant_credit_approvals') && text.includes('SET migrated_at')) {
      calls.approvalUpdates += 1;
      return { rows: [] };
    }
    // Admin approval upsert.
    if (text.includes('INSERT INTO restaurant_credit_approvals')) {
      const status = text.includes("'revoked'") ? 'revoked'
        : text.includes("'suspended'") ? 'suspended' : 'approved';
      calls.approvalInserts.push(text);
      return {
        rows: [{
          restaurant_id: RESTAURANT_ID,
          status,
          approved_at: status === 'approved' ? new Date().toISOString() : null,
          revoked_at: status === 'revoked' ? new Date().toISOString() : null,
          revocation_reason: status === 'approved' ? null : (params[1] || null),
          grace_period_ends_at: status === 'revoked' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
          migrated_at: null,
          updated_at: new Date().toISOString(),
        }],
      };
    }
    // Approval read (gate + admin GET).
    if (text.includes('FROM restaurant_credit_approvals') && text.includes('WHERE restaurant_id = $1')) {
      return { rows: dbState.approval ? [dbState.approval] : [] };
    }
    // Merchant listing join.
    if (text.includes('FROM restaurant_credit_approvals') && text.includes('= ANY(')) {
      return { rows: dbState.approvalRows };
    }
    // Migration idempotency check.
    if (text.includes('FROM restaurant_credit_migrations') && text.includes("status = 'completed'")) {
      return { rows: dbState.migrationExisting ? [dbState.migrationExisting] : [] };
    }
    // Migration inserts (completed + failed).
    if (text.includes('INSERT INTO restaurant_credit_migrations')) {
      const status = text.includes("'failed'") ? 'failed' : 'completed';
      calls.migrationInserts.push({ status, sql: text, params });
      return { rows: [{ id: 9001, status }] };
    }
    // Worker: accounts with a balance.
    if (text.includes('FROM food_customer_wallet_accounts')
      && text.includes('balance_cents > 0')
      && text.includes('ORDER BY id ASC')) {
      return { rows: dbState.accounts };
    }
    // Worker: lock the account.
    if (text.includes('FROM food_customer_wallet_accounts') && text.includes('FOR UPDATE')) {
      const account = dbState.accounts.find((row) => Number(row.id) === Number(params[0]));
      return { rows: account ? [account] : [] };
    }
    // Worker: remaining migratable balances.
    if (text.includes('FROM food_customer_wallet_accounts') && text.includes('COUNT(*)::int')) {
      return { rows: [{ n: dbState.remainingCount }] };
    }
    // Merchant restaurant listing.
    if (text.includes('FROM food_restaurants fr') && text.includes('WHERE b.user_id = $1')) {
      return {
        rows: [
          { ...accessRow('owner'), display_name: 'Ox Burger Lab' },
          { ...accessRow('manager'), id: 8, display_name: 'Second Kitchen' },
        ],
      };
    }
    // requireRestaurantAccess.
    if (text.includes('FROM food_restaurants fr') && text.includes('JOIN businesses b')) {
      return { rows: [accessRow()] };
    }
    // Simple restaurant fetch (load request + admin approval endpoints).
    if (text.includes('FROM food_restaurants WHERE id =')) {
      return { rows: dbState.restaurantMissing ? [] : [restaurantRow()] };
    }
    // Operator audit (approval changes).
    if (text.includes('INSERT INTO food_customer_wallet_operator_audit_events')) {
      return { rows: [{ id: 1 }] };
    }
    // Load-request idempotency lookup.
    if (text.includes('FROM food_customer_wallet_load_requests') && text.includes('idempotency_key')) {
      return { rows: dbState.loadRequestExisting ? [dbState.loadRequestExisting] : [] };
    }
    // Load-request insert.
    if (text.includes('INSERT INTO food_customer_wallet_load_requests')) {
      return {
        rows: [{
          id: 31,
          restaurant_id: RESTAURANT_ID,
          business_id: BUSINESS_ID,
          customer_id: CUSTOMER_ID,
          requested_by_user_id: CUSTOMER_ID,
          amount_cents: params[4],
          currency_code: 'USD',
          status: 'pending',
          note: params[5],
          reference_id: params[6],
          idempotency_key: params[7],
          correlation_id: params[8],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

function buildApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId };
    next();
  });
  app.post('/admin/restaurants/:restaurantId/credit-approval', walletCtrl.setRestaurantCreditApproval);
  app.get('/admin/restaurants/:restaurantId/credit-approval', walletCtrl.getRestaurantCreditApproval);
  app.get('/merchant/credit-approval', walletCtrl.getMyRestaurantCreditApproval);
  app.post('/customer/wallets/:restaurantId/load-requests', walletCtrl.createMyWalletLoadRequest);
  app.post('/merchant/wallets/:restaurantId/load-requests/:requestId/approve', walletCtrl.approveCustomerWalletLoadRequest);
  app.use(errorHandler);
  return app;
}

const pool = require('../db');

beforeEach(() => {
  resetMocks();
  resetDbState();
  installDbMock();
});

describe('revocation blocks new credit (fail closed)', () => {
  test('revoked restaurant: customer load request is blocked with 403', async () => {
    dbState.approval = approvalRow({ status: 'revoked' });
    const app = buildApp(CUSTOMER_ID);
    const res = await request(app)
      .post(`/customer/wallets/${RESTAURANT_ID}/load-requests`)
      .send({ amountCents: 1000, idempotencyKey: 'key-1', note: 'top up please' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('restaurant_credit_not_approved');
    expect(res.body.fields.approvalStatus).toBe('revoked');
  });

  test('suspended restaurant: merchant approval of a load request is blocked with 403', async () => {
    dbState.approval = approvalRow({ status: 'suspended', grace_period_ends_at: null });
    const app = buildApp(OPERATOR_ID);
    const res = await request(app)
      .post(`/merchant/wallets/${RESTAURANT_ID}/load-requests/9/approve`)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('restaurant_credit_not_approved');
    expect(res.body.fields.approvalStatus).toBe('suspended');
  });

  test('pending approval (never approved) also blocks new credit', async () => {
    dbState.approval = approvalRow({ status: 'pending', revoked_at: null, revocation_reason: null, grace_period_ends_at: null });
    await expect(revocationService.assertNewRestaurantCreditAllowed(pool, RESTAURANT_ID))
      .rejects.toMatchObject({ code: 'restaurant_credit_not_approved', status: 403 });
  });

  test('grandfathered restaurant (no approval row) can still create load requests', async () => {
    dbState.approval = null;
    const app = buildApp(CUSTOMER_ID);
    const res = await request(app)
      .post(`/customer/wallets/${RESTAURANT_ID}/load-requests`)
      .send({ amountCents: 1000, idempotencyKey: 'key-2', note: 'top up please' });

    expect(res.status).toBe(201);
    expect(res.body.loadRequest).toBeTruthy();
    expect(res.body.loadRequest.idempotencyKey).toBe('key-2');
  });

  test('explicitly approved restaurant can still create load requests', async () => {
    dbState.approval = approvalRow({ status: 'approved', revoked_at: null, revocation_reason: null, grace_period_ends_at: null });
    const app = buildApp(CUSTOMER_ID);
    const res = await request(app)
      .post(`/customer/wallets/${RESTAURANT_ID}/load-requests`)
      .send({ amountCents: 1000, idempotencyKey: 'key-3', note: 'top up please' });

    expect(res.status).toBe(201);
  });
});

describe('admin credit-approval endpoints', () => {
  test('revoke requires a reason', async () => {
    const app = buildApp(OPERATOR_ID);
    const res = await request(app)
      .post(`/admin/restaurants/${RESTAURANT_ID}/credit-approval`)
      .send({ status: 'revoked' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.fields.reason).toMatch(/required/i);
  });

  test('suspend requires a reason', async () => {
    const app = buildApp(OPERATOR_ID);
    const res = await request(app)
      .post(`/admin/restaurants/${RESTAURANT_ID}/credit-approval`)
      .send({ status: 'suspended' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  test('rejects unknown statuses and unknown restaurants', async () => {
    const app = buildApp(OPERATOR_ID);
    const badStatus = await request(app)
      .post(`/admin/restaurants/${RESTAURANT_ID}/credit-approval`)
      .send({ status: 'banned', reason: 'x' });
    expect(badStatus.status).toBe(400);

    dbState.restaurantMissing = true;
    const missing = await request(app)
      .post(`/admin/restaurants/9999/credit-approval`)
      .send({ status: 'revoked', reason: 'fraud' });
    expect(missing.status).toBe(404);
  });

  test('revoke starts the 30-day grace clock and returns it', async () => {
    const app = buildApp(OPERATOR_ID);
    const res = await request(app)
      .post(`/admin/restaurants/${RESTAURANT_ID}/credit-approval`)
      .send({ status: 'revoked', reason: 'Repeated settlement failures' });

    expect(res.status).toBe(200);
    expect(res.body.approval.status).toBe('revoked');
    expect(res.body.approval.revocationReason).toBe('Repeated settlement failures');
    expect(res.body.approval.gracePeriodEndsAt).toBeTruthy();
    expect(res.body.approval.revokedAt).toBeTruthy();
    const graceEnds = new Date(res.body.approval.gracePeriodEndsAt).getTime();
    expect(graceEnds).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    expect(calls.approvalInserts.some((sql) => sql.includes("NOW() + INTERVAL '30 days'"))).toBe(true);
  });

  test('re-approve clears the revoked state (no grace clock, no reason)', async () => {
    const app = buildApp(OPERATOR_ID);
    const res = await request(app)
      .post(`/admin/restaurants/${RESTAURANT_ID}/credit-approval`)
      .send({ status: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body.approval.status).toBe('approved');
    expect(res.body.approval.revokedAt).toBeNull();
    expect(res.body.approval.revocationReason).toBeNull();
    expect(res.body.approval.gracePeriodEndsAt).toBeNull();

    // And the gate lets new credit through again.
    dbState.approval = approvalRow({ status: 'approved', revoked_at: null, revocation_reason: null, grace_period_ends_at: null });
    await expect(revocationService.assertNewRestaurantCreditAllowed(pool, RESTAURANT_ID))
      .resolves.toBeTruthy();
  });

  test('admin GET returns grandfathered approved when no row exists', async () => {
    dbState.approval = null;
    const app = buildApp(OPERATOR_ID);
    const res = await request(app).get(`/admin/restaurants/${RESTAURANT_ID}/credit-approval`);

    expect(res.status).toBe(200);
    expect(res.body.approval.status).toBe('approved');
    expect(res.body.approval.grandfathered).toBe(true);
  });

  test('admin GET returns the stored approval', async () => {
    dbState.approval = approvalRow({ status: 'suspended', grace_period_ends_at: null });
    const app = buildApp(OPERATOR_ID);
    const res = await request(app).get(`/admin/restaurants/${RESTAURANT_ID}/credit-approval`);

    expect(res.status).toBe(200);
    expect(res.body.approval.status).toBe('suspended');
    expect(res.body.approval.grandfathered).toBe(false);
    expect(res.body.approval.revocationReason).toBe('Repeated settlement failures');
  });
});

describe('merchant credit-approval read model', () => {
  test('restaurant sees its own approval statuses, grandfathered included', async () => {
    dbState.approvalRows = [approvalRow({ restaurant_id: RESTAURANT_ID, status: 'revoked' })];
    const app = buildApp(OPERATOR_ID);
    const res = await request(app).get('/merchant/credit-approval');

    expect(res.status).toBe(200);
    expect(res.body.restaurants).toHaveLength(2);
    const first = res.body.restaurants[0];
    expect(first.restaurantId).toBe(RESTAURANT_ID);
    expect(first.status).toBe('revoked');
    expect(first.revocationReason).toBe('Repeated settlement failures');
    expect(first.gracePeriodEndsAt).toBeTruthy();
    const second = res.body.restaurants[1];
    expect(second.status).toBe('approved');
    expect(second.grandfathered).toBe(true);
  });
});

describe('grace-period auto-migration worker', () => {
  test('migrates balances to OxSteed Credit and records migrations', async () => {
    dbState.claimRow = approvalRow({ status: 'revoked' });
    dbState.accounts = [accountRow()];
    dbState.remainingCount = 0;

    const summary = await revocationService.processRevocationGracePeriods({ limit: 10 });

    expect(summary.ran).toBe(true);
    expect(summary.restaurantsProcessed).toBe(1);
    expect(summary.customersMigrated).toBe(1);
    expect(summary.totalMigratedCents).toBe(5000);

    // The OxSteed Credit leg: debit through the audited conversion_out path,
    // 1:1, with the customer sanctions-screened first.
    expect(debitFoodWallet).toHaveBeenCalledTimes(1);
    const debitArgs = debitFoodWallet.mock.calls[0][1];
    expect(debitArgs.amountCents).toBe(5000);
    expect(debitArgs.referenceType).toBe('restaurant_conversion_out');
    expect(debitArgs.actorType).toBe('system');
    expect(debitArgs.metadata.conversionConvertedAmountCents).toBe(5000);
    expect(debitArgs.metadata.source).toBe('revocation_auto_migration');
    expect(assertSanctionsClear).toHaveBeenCalledTimes(1);
    expect(assertSanctionsClear.mock.calls[0][1].subjectId).toBe(CUSTOMER_ID);

    // The migration ledger row.
    const completed = calls.migrationInserts.filter((row) => row.status === 'completed');
    expect(completed).toHaveLength(1);
    expect(completed[0].params[2]).toBe(5000);

    // Restaurant marked fully migrated.
    expect(calls.approvalUpdates).toBe(1);
  });

  test('skips accounts with only held funds and accounts already migrated', async () => {
    dbState.claimRow = approvalRow({ status: 'revoked' });
    dbState.accounts = [accountRow({ balance_cents: 5000, reserved_cents: 5000 })];
    dbState.migrationExisting = { id: 1 };
    dbState.remainingCount = 0;

    const summary = await revocationService.processRevocationGracePeriods({ limit: 10 });

    expect(debitFoodWallet).not.toHaveBeenCalled();
    expect(summary.customersSkipped).toBe(1);
    expect(summary.customersMigrated).toBe(0);
  });

  test('fail closed: a debit error leaves the balance untouched and records a failed migration', async () => {
    dbState.claimRow = approvalRow({ status: 'revoked' });
    dbState.accounts = [accountRow()];
    dbState.remainingCount = 1; // balance still there
    debitFoodWallet.mockRejectedValue(new AppError('wallet exploded', 500, 'wallet_debit_failed'));

    const summary = await revocationService.processRevocationGracePeriods({ limit: 10 });

    expect(summary.customersFailed).toBe(1);
    expect(summary.customersMigrated).toBe(0);

    const completed = calls.migrationInserts.filter((row) => row.status === 'completed');
    const failed = calls.migrationInserts.filter((row) => row.status === 'failed');
    expect(completed).toHaveLength(0);
    expect(failed).toHaveLength(1);
    expect(failed[0].params[4]).toBe('wallet_debit_failed');

    // Restaurant is NOT marked migrated while a balance remains.
    expect(calls.approvalUpdates).toBe(0);
  });

  test('does nothing when no grace period has ended', async () => {
    dbState.claimRow = null;
    const summary = await revocationService.processRevocationGracePeriods({ limit: 10 });

    expect(summary.ran).toBe(false);
    expect(summary.restaurantsProcessed).toBe(0);
    expect(debitFoodWallet).not.toHaveBeenCalled();
  });
});
