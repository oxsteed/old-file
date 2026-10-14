'use strict';

/**
 * Phase 5: restaurant credit trial cap + FIFO derisking.
 *
 * Covers the trial-tier money contract:
 *  - New credit requests are blocked with 409 restaurant_credit_at_capacity
 *    when a reserve-less restaurant's outstanding exposure reaches the cap.
 *  - Restaurants WITH a Phase 4 reserve row skip the trial cap entirely
 *    (no double-enforcement).
 *  - Idempotency replays of already-created requests are never blocked by
 *    a later cap hit.
 *  - GET /credit-capacity reports { at_capacity, outstanding_cents,
 *    cap_cents } for the customer modal.
 *  - The FIFO queue lists oldest balances first.
 *  - deriskOldest migrates oldest balances to OxSteed Credit until the
 *    target is covered: partial derisk when the target exceeds the total,
 *    per-customer atomicity (a failing customer is skipped with its balance
 *    unchanged while the run continues), held funds are never derisked.
 *  - Merchant exposure + derisk endpoints enforce operator authorization
 *    and write operator audit rows.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const walletCtrl = require('../controllers/foodWalletController');
const deriskService = require('../services/restaurantCreditDeriskService');

const RESTAURANT_ID = 9;
const BUSINESS_ID = 42;
const OPERATOR_ID = '00000000-0000-4000-8000-000000000123';
const CUSTOMER_A = '00000000-0000-4000-8000-0000000000a1'; // oldest
const CUSTOMER_B = '00000000-0000-4000-8000-0000000000b2';
const CUSTOMER_C = '00000000-0000-4000-8000-0000000000c3'; // newest

const ACCOUNT_IDS = { [CUSTOMER_A]: 5001, [CUSTOMER_B]: 5002, [CUSTOMER_C]: 5003 };
const CUSTOMER_BY_ACCOUNT = { 5001: CUSTOMER_A, 5002: CUSTOMER_B, 5003: CUSTOMER_C };

function restaurantAccessRow(role = 'owner') {
  return {
    id: RESTAURANT_ID,
    business_id: BUSINESS_ID,
    owner_user_id: OPERATOR_ID,
    display_name: 'Ox Burger Lab',
    currency_code: 'USD',
    effective_role: role,
  };
}

function restaurantRow() {
  return {
    id: RESTAURANT_ID,
    business_id: BUSINESS_ID,
    display_name: 'Ox Burger Lab',
    currency_code: 'USD',
    status: 'active',
  };
}

function walletAccountRow(customerId) {
  const b = fixture.balances[customerId];
  return {
    id: ACCOUNT_IDS[customerId],
    restaurant_id: RESTAURANT_ID,
    customer_id: customerId,
    currency_code: b.currency_code,
    balance_cents: b.balance_cents,
    reserved_cents: b.reserved_cents,
    status: b.status || 'active',
    ledger_version: 3,
    last_entry_hash: 'hash-0',
    created_at: b.created_at,
    updated_at: new Date().toISOString(),
  };
}

function queueRow(customerId, createdAt) {
  const b = fixture.balances[customerId];
  return {
    customer_id: customerId,
    balance_cents: b.balance_cents,
    reserved_cents: b.reserved_cents,
    currency_code: b.currency_code,
    oldest_activity_at: createdAt,
    customer_email: `${customerId.slice(-4)}@example.com`,
    customer_name: 'Test Customer',
  };
}

function creditAccountRow(type, customerId) {
  const base = {
    currency_code: 'USD',
    balance_cents: 1000000,
    reserved_cents: 0,
    status: 'active',
    ledger_version: 0,
    last_entry_hash: null,
  };
  if (type === 'customer_wallet') {
    // A fresh platform account: zero balance so derisk grants stay under
    // MAX_CUSTOMER_BALANCE_CENTS.
    return { ...base, id: 1001, account_type: 'customer_wallet', customer_id: customerId || CUSTOMER_A, partner_id: null, restaurant_id: null, balance_cents: 0 };
  }
  if (type === 'restaurant_sub_bank') {
    return { ...base, id: 1003, account_type: 'restaurant_sub_bank', customer_id: null, partner_id: null, restaurant_id: RESTAURANT_ID };
  }
  return { ...base, id: 1002, account_type: 'platform_treasury', customer_id: null, partner_id: null, restaurant_id: null };
}

// Mutable per-test DB state answered by the mock below.
const fixture = {
  role: 'owner',
  reserveRow: null,
  exposureRow: null,
  queueRows: [],
  balances: {},
  processedOrder: [],
  ledgerCustomers: [],
  deriskInserts: [],
  auditInserts: [],
  txSeq: 7000,
  replayRow: null,
  loadRequestInsert: null,
};

function resetFixture() {
  fixture.role = 'owner';
  fixture.reserveRow = null;
  fixture.exposureRow = null;
  fixture.queueRows = [];
  fixture.balances = {};
  fixture.processedOrder = [];
  fixture.ledgerCustomers = [];
  fixture.deriskInserts = [];
  fixture.auditInserts = [];
  fixture.txSeq = 7000;
  fixture.replayRow = null;
  fixture.loadRequestInsert = null;
}

function setBalances(entries) {
  // entries: [[customerId, balanceCents, reservedCents, currencyCode, createdAt]]
  fixture.balances = {};
  for (const [customerId, balanceCents, reservedCents = 0, currencyCode = 'USD', createdAt] of entries) {
    fixture.balances[customerId] = {
      balance_cents: balanceCents,
      reserved_cents: reservedCents,
      currency_code: currencyCode,
      status: 'active',
      created_at: createdAt || new Date().toISOString(),
    };
  }
  // The DB would return the queue ordered oldest-first; the fixture mirrors that.
  const ordered = Object.keys(fixture.balances).sort(
    (a, b) => new Date(fixture.balances[a].created_at) - new Date(fixture.balances[b].created_at)
  );
  fixture.queueRows = ordered.map((customerId) => queueRow(customerId, fixture.balances[customerId].created_at));
}

function installMock() {
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);

    // --- restaurant lookups
    if (text.includes('FROM food_restaurants fr') && text.includes('JOIN businesses b')) {
      return { rows: [restaurantAccessRow(fixture.role)] };
    }
    if (text.includes('FROM food_restaurants')) {
      return { rows: [restaurantRow()] };
    }
    // --- Phase 5 trial-cap reads
    if (text.includes('FROM restaurant_credit_reserves')) {
      return { rows: fixture.reserveRow ? [fixture.reserveRow] : [] };
    }
    if (text.includes('INSERT INTO restaurant_credit_exposure')) {
      return { rows: [] };
    }
    if (text.includes('FROM restaurant_credit_exposure')) {
      return { rows: fixture.exposureRow ? [fixture.exposureRow] : [] };
    }
    // --- Phase 3 fraud screen (must pass: small amounts, zero counts)
    if (text.includes('oxsteed_credit_identity_verifications')) return { rows: [] };
    if (text.includes('COUNT(DISTINCT restaurant_id)')) return { rows: [{ count: 1 }] };
    if (text.includes('COUNT') && text.includes('food_customer_wallet_load_requests')) {
      return { rows: [{ count: 0 }] };
    }
    if (text.includes('INSERT INTO food_credit_fraud_signals')) return { rows: [{ id: 1 }] };
    // --- load-request replay + insert
    if (text.includes('FROM food_customer_wallet_load_requests') && text.includes('idempotency_key')) {
      return { rows: fixture.replayRow ? [fixture.replayRow] : [] };
    }
    if (text.includes('INSERT INTO food_customer_wallet_load_requests')) {
      fixture.loadRequestInsert = params;
      return {
        rows: [{
          id: 1001, restaurant_id: RESTAURANT_ID, business_id: BUSINESS_ID,
          customer_id: params[2], requested_by_user_id: params[2],
          amount_cents: params[3], currency_code: params[4], status: 'pending',
          idempotency_key: params[7], correlation_id: params[7], metadata: {},
          created_at: new Date().toISOString(),
        }],
      };
    }
    // --- FIFO queue (honor the SQL LIMIT like the real database would)
    if (text.includes('FROM food_customer_wallet_accounts a') && text.includes('JOIN users u')) {
      const limit = Number.parseInt(params[1], 10);
      return { rows: Number.isSafeInteger(limit) ? fixture.queueRows.slice(0, limit) : fixture.queueRows };
    }
    // --- wallet account lock (deriskOneCustomer + getOrCreateWalletAccount)
    if (text.includes('FROM food_customer_wallet_accounts') && text.includes('FOR UPDATE')) {
      const customerId = params[1];
      const last = fixture.processedOrder[fixture.processedOrder.length - 1];
      if (last !== customerId) fixture.processedOrder.push(customerId);
      return { rows: [walletAccountRow(customerId)] };
    }
    if (text.includes('INSERT INTO food_customer_wallet_accounts')) {
      return { rows: [] };
    }
    if (text.includes('UPDATE food_customer_wallet_accounts')) {
      const customerId = CUSTOMER_BY_ACCOUNT[params[4]];
      if (customerId && fixture.balances[customerId]) {
        fixture.balances[customerId].balance_cents = Number(params[0]);
      }
      const row = customerId ? walletAccountRow(customerId) : {};
      return { rows: [{ ...row, balance_cents: Number(params[0]) }] };
    }
    if (text.includes('INSERT INTO food_customer_wallet_ledger')) {
      fixture.ledgerCustomers.push(params[2]); // customer_id
      return { rows: [{ id: 8000 + fixture.ledgerCustomers.length, balance_after_cents: params[5] }] };
    }
    if (text.includes('FROM food_customer_wallet_ledger')) {
      return { rows: [] };
    }
    // --- OxSteed Credit platform accounts (ensureAccount)
    if (text.includes('INSERT INTO oxsteed_credit_accounts')) {
      return { rows: [] };
    }
    if (text.includes('FROM oxsteed_credit_accounts a')) {
      const type = params[0];
      return { rows: [creditAccountRow(type, params[1])] };
    }
    // --- credit journal
    if (text.includes('pg_advisory_xact_lock(hashtext')) {
      return { rows: [{}] };
    }
    if (text.includes('SELECT * FROM oxsteed_credit_transactions WHERE idempotency_key')) {
      return { rows: [] };
    }
    if (text.includes('FROM oxsteed_credit_transactions t') && text.includes('CURRENT_DATE')) {
      return { rows: [{ total_cents: 0 }] };
    }
    if (text.includes('SUM(balance_cents)') && text.includes('FROM oxsteed_credit_accounts')) {
      return { rows: [{ total_cents: 0 }] };
    }
    if (text.includes('WHERE id = ANY($1::bigint[])')) {
      const ids = new Set((params[0] || []).map(String));
      const all = [creditAccountRow('customer_wallet'), creditAccountRow('platform_treasury'), creditAccountRow('restaurant_sub_bank')];
      return { rows: all.filter((a) => ids.has(String(a.id))).sort((a, b) => a.id - b.id) };
    }
    if (text.includes('INSERT INTO oxsteed_credit_transactions')) {
      fixture.txSeq += 1;
      return { rows: [{ id: fixture.txSeq, status: 'posted', transaction_type: params[0] }] };
    }
    if (text.includes('WITH ledger_write AS')) {
      return { rows: [{ id: 1002, balance_cents: 999999 }] };
    }
    if (text.includes('INSERT INTO oxsteed_credit_transaction_entries')) {
      return { rows: [{ id: 1 }] };
    }
    if (text.includes('INSERT INTO oxsteed_credit_audit_events')) {
      return { rows: [] };
    }
    // --- rail / partner / sub-bank (dual posting)
    if (text.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) {
      return { rows: [{ is_enabled: true }] };
    }
    if (text.includes('FROM oxsteed_credit_rail_freezes')) {
      return { rows: [] };
    }
    if (text.includes('FROM oxsteed_credit_partners p WHERE p.restaurant_id')) {
      return { rows: [{ id: 41, restaurant_id: RESTAURANT_ID, business_id: BUSINESS_ID, status: 'active' }] };
    }
    // --- derisk record + operator audit
    if (text.includes('INSERT INTO restaurant_credit_derisks')) {
      fixture.deriskInserts.push(params);
      return { rows: [{ id: 9000 + fixture.deriskInserts.length }] };
    }
    if (text.includes('INSERT INTO food_customer_wallet_operator_audit_events')) {
      fixture.auditInserts.push(params);
      return { rows: [{ id: 700 + fixture.auditInserts.length }] };
    }
    return { rows: [], rowCount: 0 };
  });
}

function buildCustomerApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: OPERATOR_ID, email: 'customer@example.com' };
    next();
  });
  app.post('/api/food/customer/wallets/:restaurantId/load-requests', walletCtrl.createMyWalletLoadRequest);
  app.get('/api/food/customer/wallets/:restaurantId/credit-capacity', walletCtrl.getCreditCapacity);
  app.use(errorHandler);
  return app;
}

function buildMerchantApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: OPERATOR_ID, email: 'owner@example.com' };
    next();
  });
  app.get('/api/food/merchant/wallets/:restaurantId/exposure', walletCtrl.getCreditExposure);
  app.post('/api/food/merchant/wallets/:restaurantId/derisk', walletCtrl.deriskCredit);
  app.use(errorHandler);
  return app;
}

function createLoadRequest(amountCents = 5000) {
  return request(buildCustomerApp())
    .post(`/api/food/customer/wallets/${RESTAURANT_ID}/load-requests`)
    .send({
      amountCents,
      idempotencyKey: `key-${Date.now()}-${Math.random()}`,
      paymentReference: 'ref-1',
    });
}

beforeEach(() => {
  resetMocks();
  resetFixture();
  installMock();
});

describe('trial cap enforcement on credit requests', () => {
  test('blocks new requests with 409 restaurant_credit_at_capacity at the cap', async () => {
    fixture.exposureRow = { restaurant_id: RESTAURANT_ID, outstanding_cents: 10000, cap_cents: 10000 };
    fixture.reserveRow = null;

    const res = await createLoadRequest(5000);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('restaurant_credit_at_capacity');
    expect(fixture.loadRequestInsert).toBeNull();
  });

  test('blocks new requests when outstanding exceeds the cap', async () => {
    fixture.exposureRow = { restaurant_id: RESTAURANT_ID, outstanding_cents: 15000, cap_cents: 10000 };
    fixture.reserveRow = null;

    const res = await createLoadRequest(5000);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('restaurant_credit_at_capacity');
  });

  test('allows requests below the cap', async () => {
    fixture.exposureRow = { restaurant_id: RESTAURANT_ID, outstanding_cents: 9999, cap_cents: 10000 };
    fixture.reserveRow = null;

    const res = await createLoadRequest(5000);

    expect(res.status).toBe(201);
    expect(res.body.loadRequest).toBeDefined();
  });

  test('reserve restaurants skip the trial cap entirely (no double-enforcement)', async () => {
    fixture.exposureRow = { restaurant_id: RESTAURANT_ID, outstanding_cents: 10000, cap_cents: 10000 };
    fixture.reserveRow = { restaurant_id: RESTAURANT_ID, balance_cents: 5000, currency_code: 'USD' };

    const res = await createLoadRequest(5000);

    expect(res.status).toBe(201);
    expect(res.body.loadRequest).toBeDefined();
  });

  test('idempotency replays are never blocked by a later cap hit', async () => {
    fixture.exposureRow = { restaurant_id: RESTAURANT_ID, outstanding_cents: 10000, cap_cents: 10000 };
    fixture.reserveRow = null;
    fixture.replayRow = {
      id: 1001, restaurant_id: RESTAURANT_ID, business_id: BUSINESS_ID,
      customer_id: OPERATOR_ID, requested_by_user_id: OPERATOR_ID,
      amount_cents: 5000, currency_code: 'USD', status: 'pending',
      idempotency_key: 'replay-key', correlation_id: 'replay-key', metadata: {},
    };

    const res = await request(buildCustomerApp())
      .post(`/api/food/customer/wallets/${RESTAURANT_ID}/load-requests`)
      .send({ amountCents: 5000, idempotencyKey: 'replay-key', paymentReference: 'ref-1' });

    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(true);
  });
});

describe('GET /credit-capacity', () => {
  test('reports at_capacity with outstanding and cap cents', async () => {
    fixture.exposureRow = { restaurant_id: RESTAURANT_ID, outstanding_cents: 10000, cap_cents: 10000 };
    fixture.reserveRow = null;

    const res = await request(buildCustomerApp()).get(
      `/api/food/customer/wallets/${RESTAURANT_ID}/credit-capacity`
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      at_capacity: true,
      outstanding_cents: 10000,
      cap_cents: 10000,
      trial_cap_applies: true,
    });
  });

  test('reports trial_cap_applies false for reserve restaurants', async () => {
    fixture.exposureRow = { restaurant_id: RESTAURANT_ID, outstanding_cents: 10000, cap_cents: 10000 };
    fixture.reserveRow = { restaurant_id: RESTAURANT_ID, balance_cents: 5000, currency_code: 'USD' };

    const res = await request(buildCustomerApp()).get(
      `/api/food/customer/wallets/${RESTAURANT_ID}/credit-capacity`
    );

    expect(res.status).toBe(200);
    expect(res.body.at_capacity).toBe(false);
    expect(res.body.trial_cap_applies).toBe(false);
  });

  test('404s for an unknown restaurant', async () => {
    mockQuery.mockImplementationOnce(async () => ({ rows: [] }));
    const res = await request(buildCustomerApp()).get(
      `/api/food/customer/wallets/${RESTAURANT_ID}/credit-capacity`
    );
    expect(res.status).toBe(404);
  });
});

describe('getFifoQueue', () => {
  test('returns oldest balances first with the FIFO key', async () => {
    setBalances([
      [CUSTOMER_B, 5000, 0, 'USD', '2026-10-10T10:00:00Z'],
      [CUSTOMER_A, 6000, 0, 'USD', '2026-10-08T10:00:00Z'],
      [CUSTOMER_C, 1000, 0, 'USD', '2026-10-12T10:00:00Z'],
    ]);

    const queue = await deriskService.getFifoQueue(RESTAURANT_ID, { limit: 10 });

    expect(queue.map((e) => e.customer_id)).toEqual([CUSTOMER_A, CUSTOMER_B, CUSTOMER_C]);
    expect(queue[0]).toMatchObject({ balance_cents: 6000, currency_code: 'USD' });
    expect(queue[0].oldest_activity_at).toBeDefined();
    // The ordering guarantee lives in the SQL.
    const fifoCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('JOIN users u'));
    expect(String(fifoCall[0])).toContain('ORDER BY a.created_at ASC');
    expect(String(fifoCall[0])).toContain("AND a.balance_cents > 0");
  });

  test('respects the limit', async () => {
    setBalances([
      [CUSTOMER_A, 6000, 0, 'USD', '2026-10-08T10:00:00Z'],
      [CUSTOMER_B, 5000, 0, 'USD', '2026-10-10T10:00:00Z'],
    ]);

    const queue = await deriskService.getFifoQueue(RESTAURANT_ID, { limit: 1 });

    expect(queue).toHaveLength(1);
    const fifoCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('JOIN users u'));
    expect(fifoCall[1]).toEqual([RESTAURANT_ID, 1]);
  });
});

describe('deriskOldest', () => {
  test('migrates oldest balances first until the target is covered', async () => {
    setBalances([
      [CUSTOMER_A, 6000, 0, 'USD', '2026-10-08T10:00:00Z'],
      [CUSTOMER_B, 5000, 0, 'USD', '2026-10-10T10:00:00Z'],
    ]);

    const result = await deriskService.deriskOldest({
      restaurantId: RESTAURANT_ID,
      targetCents: 8000,
      operatorId: OPERATOR_ID,
    });

    expect(result.derisked_cents).toBe(8000);
    expect(result.migrations).toEqual([
      expect.objectContaining({ customer_id: CUSTOMER_A, amount_cents: 6000 }),
      expect.objectContaining({ customer_id: CUSTOMER_B, amount_cents: 2000 }),
    ]);
    expect(result.skipped).toEqual([]);
    // Oldest customer was processed first.
    expect(fixture.processedOrder[0]).toBe(CUSTOMER_A);
    // A durable derisk row per migrated customer.
    expect(fixture.deriskInserts).toHaveLength(2);
    expect(fixture.deriskInserts[0].slice(0, 4)).toEqual([RESTAURANT_ID, CUSTOMER_A, 6000, 'USD']);
    // The restaurant wallet was debited through the append-only ledger.
    expect(fixture.ledgerCustomers).toEqual([CUSTOMER_A, CUSTOMER_B]);
  });

  test('partial derisk when the target exceeds total balances', async () => {
    setBalances([
      [CUSTOMER_A, 6000, 0, 'USD', '2026-10-08T10:00:00Z'],
      [CUSTOMER_B, 5000, 0, 'USD', '2026-10-10T10:00:00Z'],
    ]);

    const result = await deriskService.deriskOldest({
      restaurantId: RESTAURANT_ID,
      targetCents: 50000,
      operatorId: OPERATOR_ID,
    });

    expect(result.derisked_cents).toBe(11000);
    expect(result.migrations).toHaveLength(2);
    expect(result.skipped).toEqual([]);
  });

  test('a failing customer is skipped with its balance unchanged while the run continues', async () => {
    setBalances([
      [CUSTOMER_C, 9000, 0, 'EUR', '2026-10-07T10:00:00Z'], // oldest, non-USD
      [CUSTOMER_A, 6000, 0, 'USD', '2026-10-08T10:00:00Z'],
      [CUSTOMER_B, 5000, 0, 'USD', '2026-10-10T10:00:00Z'],
    ]);

    const result = await deriskService.deriskOldest({
      restaurantId: RESTAURANT_ID,
      targetCents: 8000,
      operatorId: OPERATOR_ID,
    });

    expect(result.derisked_cents).toBe(8000);
    expect(result.migrations.map((m) => m.customer_id)).toEqual([CUSTOMER_A, CUSTOMER_B]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ customer_id: CUSTOMER_C, code: 'credit_derisk_currency_unsupported' }),
    ]);
    // Fail closed: no wallet movement for the skipped customer.
    expect(fixture.ledgerCustomers).not.toContain(CUSTOMER_C);
    expect(fixture.balances[CUSTOMER_C].balance_cents).toBe(9000);
  });

  test('held funds are never derisked', async () => {
    setBalances([
      [CUSTOMER_A, 6000, 1000, 'USD', '2026-10-08T10:00:00Z'],
    ]);

    const result = await deriskService.deriskOldest({
      restaurantId: RESTAURANT_ID,
      targetCents: 10000,
      operatorId: OPERATOR_ID,
    });

    expect(result.derisked_cents).toBe(5000);
    expect(result.migrations).toEqual([
      expect.objectContaining({ customer_id: CUSTOMER_A, amount_cents: 5000 }),
    ]);
  });

  test('rejects non-positive targets', async () => {
    await expect(
      deriskService.deriskOldest({ restaurantId: RESTAURANT_ID, targetCents: 0, operatorId: OPERATOR_ID })
    ).rejects.toMatchObject({ code: 'credit_derisk_target_invalid' });
    await expect(
      deriskService.deriskOldest({ restaurantId: RESTAURANT_ID, targetCents: -100, operatorId: OPERATOR_ID })
    ).rejects.toMatchObject({ code: 'credit_derisk_target_invalid' });
  });

  test('404s for an unknown restaurant', async () => {
    await expect(
      deriskService.deriskOldest({ restaurantId: 'nope', targetCents: 1000, operatorId: OPERATOR_ID })
    ).rejects.toMatchObject({ code: 'restaurant_not_found', status: 404 });
  });
});

describe('merchant exposure + derisk endpoints', () => {
  test('GET /exposure returns the cap state and the FIFO queue', async () => {
    fixture.exposureRow = { restaurant_id: RESTAURANT_ID, outstanding_cents: 11000, cap_cents: 10000 };
    fixture.reserveRow = null;
    setBalances([
      [CUSTOMER_A, 6000, 0, 'USD', '2026-10-08T10:00:00Z'],
      [CUSTOMER_B, 5000, 0, 'USD', '2026-10-10T10:00:00Z'],
    ]);

    const res = await request(buildMerchantApp()).get(
      `/api/food/merchant/wallets/${RESTAURANT_ID}/exposure`
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      restaurant_id: RESTAURANT_ID,
      outstanding_cents: 11000,
      cap_cents: 10000,
      at_capacity: true,
      trial_cap_applies: true,
    });
    expect(res.body.fifo_queue).toHaveLength(2);
    expect(res.body.fifo_queue[0]).toMatchObject({ customer_id: CUSTOMER_A, balance_cents: 6000 });
  });

  test('GET /exposure rejects non-operators', async () => {
    fixture.role = 'staff';

    const res = await request(buildMerchantApp()).get(
      `/api/food/merchant/wallets/${RESTAURANT_ID}/exposure`
    );

    expect(res.status).toBe(403);
  });

  test('POST /derisk migrates oldest balances and writes operator audit rows', async () => {
    setBalances([
      [CUSTOMER_A, 6000, 0, 'USD', '2026-10-08T10:00:00Z'],
      [CUSTOMER_B, 5000, 0, 'USD', '2026-10-10T10:00:00Z'],
    ]);

    const res = await request(buildMerchantApp())
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/derisk`)
      .send({ target_cents: 8000 });

    expect(res.status).toBe(200);
    expect(res.body.derisked_cents).toBe(8000);
    expect(res.body.batch_id).toBeDefined();
    expect(res.body.migrations).toEqual([
      { customer_id: CUSTOMER_A, amount_cents: 6000 },
      { customer_id: CUSTOMER_B, amount_cents: 2000 },
    ]);
    expect(res.body.skipped).toEqual([]);
    // One operator audit row per migrated customer.
    expect(fixture.auditInserts).toHaveLength(2);
    expect(fixture.auditInserts[0][5]).toBe('credit_derisk');
    expect(fixture.auditInserts[0][4]).toBe(OPERATOR_ID);
  });

  test('POST /derisk rejects non-operators', async () => {
    fixture.role = 'staff';

    const res = await request(buildMerchantApp())
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/derisk`)
      .send({ target_cents: 8000 });

    expect(res.status).toBe(403);
    expect(fixture.deriskInserts).toHaveLength(0);
  });

  test('POST /derisk validates the target', async () => {
    const res = await request(buildMerchantApp())
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/derisk`)
      .send({ target_cents: 0 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });
});

describe('getTrialCapCents', () => {
  const ORIGINAL = process.env.FOOD_CREDIT_TRIAL_CAP_CENTS;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FOOD_CREDIT_TRIAL_CAP_CENTS;
    else process.env.FOOD_CREDIT_TRIAL_CAP_CENTS = ORIGINAL;
  });

  test('defaults to $100 (10000 cents)', () => {
    delete process.env.FOOD_CREDIT_TRIAL_CAP_CENTS;
    expect(deriskService.getTrialCapCents()).toBe(10000);
  });

  test('honors FOOD_CREDIT_TRIAL_CAP_CENTS', () => {
    process.env.FOOD_CREDIT_TRIAL_CAP_CENTS = '25000';
    expect(deriskService.getTrialCapCents()).toBe(25000);
  });

  test('falls back to the default on invalid values (never disables the cap)', () => {
    for (const bad of ['0', '-5', 'not-a-number', '']) {
      process.env.FOOD_CREDIT_TRIAL_CAP_CENTS = bad;
      expect(deriskService.getTrialCapCents()).toBe(10000);
    }
  });
});
