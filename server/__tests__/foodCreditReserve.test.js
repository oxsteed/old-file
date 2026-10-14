'use strict';

/**
 * Phase 4: restaurant credit pre-purchase reserve ("gift card inventory"
 * model).
 *
 * Covers the fail-closed money contract:
 *  - The reserve is credited ONLY after Stripe confirms the PaymentIntent
 *    succeeded (matching amount + currency); anything else leaves the
 *    reserve untouched.
 *  - Issuance draws the reserve down atomically inside the same transaction
 *    as the wallet credit: a shortfall throws 409 insufficient_credit_reserve.
 *  - Opt-in per restaurant: no reserve row means no cap (trial-tier cap
 *    continues; Phase 5 owns that).
 *  - Purchase confirm is idempotent: an already-succeeded purchase returns
 *    without crediting twice.
 *  - Fee math: 2.5% rounded to the cent, reserve credited with the net.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const reserveCtrl = require('../controllers/restaurantCreditReserveController');
const reserveService = require('../services/restaurantCreditReserveService');

const stripe = require('stripe');
const mockPaymentIntents = stripe.__mockInstance.paymentIntents;

const RESTAURANT_ID = 7;
const OPERATOR_ID = '00000000-0000-4000-8000-000000000123';

function restaurantRow(role = 'owner') {
  return {
    id: RESTAURANT_ID,
    business_id: 42,
    owner_user_id: OPERATOR_ID,
    display_name: 'Ox Burger Lab',
    currency_code: 'USD',
    effective_role: role,
  };
}

function purchaseRow(overrides = {}) {
  return {
    id: 11,
    restaurant_id: RESTAURANT_ID,
    amount_cents: 5000,
    fee_cents: 125,
    issuable_cents: 4875,
    currency_code: 'USD',
    status: 'pending',
    stripe_payment_intent_id: null,
    idempotency_key: 'reserve-key-1',
    initiated_by: OPERATOR_ID,
    confirmed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function reserveRow(overrides = {}) {
  return {
    restaurant_id: RESTAURANT_ID,
    balance_cents: 5000,
    currency_code: 'USD',
    lifetime_purchased_cents: 5000,
    lifetime_issued_cents: 0,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// Mutable per-test DB state answered by the mock below.
const dbState = {
  role: 'owner',
  purchaseInsertRow: null,
  existingPurchase: null,
  purchaseById: null,
  purchaseForUpdate: null,
  purchaseUpdateRow: null,
  reserveRow: null,
  reserveUpsertRow: null,
  reserveUpdateRow: null,
  ledgerInsertRow: null,
  ledgerList: [],
  ledgerTotal: 0,
};

function resetDbState() {
  dbState.role = 'owner';
  dbState.purchaseInsertRow = null;
  dbState.existingPurchase = null;
  dbState.purchaseById = null;
  dbState.purchaseForUpdate = null;
  dbState.purchaseUpdateRow = null;
  dbState.reserveRow = null;
  dbState.reserveUpsertRow = null;
  dbState.reserveUpdateRow = null;
  dbState.ledgerInsertRow = null;
  dbState.ledgerList = [];
  dbState.ledgerTotal = 0;
}

function installDbMock(calls) {
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    calls.push(text);

    if (text.includes('FROM food_restaurants fr') && text.includes('JOIN businesses b')) {
      return { rows: [restaurantRow(dbState.role)] };
    }
    if (text.includes('INSERT INTO restaurant_credit_reserve_purchases')) {
      return { rows: dbState.purchaseInsertRow ? [dbState.purchaseInsertRow] : [] };
    }
    if (text.includes('FROM restaurant_credit_reserve_purchases') && text.includes('FOR UPDATE')) {
      return { rows: dbState.purchaseForUpdate ? [dbState.purchaseForUpdate] : [] };
    }
    if (text.includes('FROM restaurant_credit_reserve_purchases') && text.includes('idempotency_key')) {
      return { rows: dbState.existingPurchase ? [dbState.existingPurchase] : [] };
    }
    if (text.includes('FROM restaurant_credit_reserve_purchases')) {
      return { rows: dbState.purchaseById ? [dbState.purchaseById] : [] };
    }
    if (text.includes('UPDATE restaurant_credit_reserve_purchases')) {
      return { rows: dbState.purchaseUpdateRow ? [dbState.purchaseUpdateRow] : [] };
    }
    if (text.includes('INSERT INTO restaurant_credit_reserves')) {
      return { rows: dbState.reserveUpsertRow ? [dbState.reserveUpsertRow] : [] };
    }
    if (text.includes('UPDATE restaurant_credit_reserves')) {
      return { rows: dbState.reserveUpdateRow ? [dbState.reserveUpdateRow] : [] };
    }
    if (text.includes('FROM restaurant_credit_reserves')) {
      return { rows: dbState.reserveRow ? [dbState.reserveRow] : [] };
    }
    if (text.includes('INSERT INTO restaurant_credit_reserve_ledger')) {
      return { rows: dbState.ledgerInsertRow ? [dbState.ledgerInsertRow] : [] };
    }
    if (text.includes('FROM restaurant_credit_reserve_ledger') && text.includes('COUNT(*)')) {
      return { rows: [{ total: dbState.ledgerTotal }] };
    }
    if (text.includes('FROM restaurant_credit_reserve_ledger')) {
      return { rows: dbState.ledgerList };
    }
    return { rows: [], rowCount: 0 };
  });
}

function buildReserveApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.post('/api/food/merchant/credit-reserve/purchase', reserveCtrl.purchaseCreditReserve);
  app.post('/api/food/merchant/credit-reserve/purchase/:purchaseId/confirm', reserveCtrl.confirmCreditReservePurchase);
  app.get('/api/food/merchant/credit-reserve/balance', reserveCtrl.getCreditReserveBalance);
  app.get('/api/food/merchant/credit-reserve/ledger', reserveCtrl.listCreditReserveLedger);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  resetDbState();
  mockPaymentIntents.create.mockReset();
  mockPaymentIntents.retrieve.mockReset();
});

describe('computeReserveFee (2.5% platform fee)', () => {
  test.each([
    [1000, 25, 975],
    [1010, 25, 985], // 25.25 rounds down
    [1013, 25, 988], // 25.325 rounds down
    [1020, 26, 994], // 25.5 rounds up (half-up)
    [1030, 26, 1004], // 25.75 rounds up
    [1999, 50, 1949], // 49.975 rounds up
    [9999, 250, 9749], // 249.975 rounds up
    [5000, 125, 4875],
    [1000000, 25000, 975000],
  ])('amount %i cents -> fee %i, issuable %i', (amount, fee, issuable) => {
    expect(reserveService.computeReserveFee(amount)).toEqual({ feeCents: fee, issuableCents: issuable });
  });

  test('fee never exceeds the amount (issuable stays positive)', () => {
    for (const amount of [1000, 1001, 1019, 1021, 99999]) {
      const { feeCents, issuableCents } = reserveService.computeReserveFee(amount);
      expect(feeCents).toBeGreaterThanOrEqual(0);
      expect(issuableCents).toBe(amount - feeCents);
      expect(issuableCents).toBeGreaterThan(0);
    }
  });
});

describe('createReservePurchase', () => {
  test('rejects amounts below the $10 minimum and above the $10,000 maximum', async () => {
    const calls = [];
    installDbMock(calls);
    await expect(
      reserveService.createReservePurchase({
        restaurantId: RESTAURANT_ID, operatorUserId: OPERATOR_ID, amountCents: 999, currencyCode: 'USD', idempotencyKey: 'k1',
      })
    ).rejects.toMatchObject({ code: 'credit_reserve_amount_invalid', status: 400 });
    await expect(
      reserveService.createReservePurchase({
        restaurantId: RESTAURANT_ID, operatorUserId: OPERATOR_ID, amountCents: 1000001, currencyCode: 'USD', idempotencyKey: 'k2',
      })
    ).rejects.toMatchObject({ code: 'credit_reserve_amount_invalid', status: 400 });
    expect(mockPaymentIntents.create).not.toHaveBeenCalled();
  });

  test('rejects a missing idempotency key before touching Stripe', async () => {
    const calls = [];
    installDbMock(calls);
    await expect(
      reserveService.createReservePurchase({
        restaurantId: RESTAURANT_ID, operatorUserId: OPERATOR_ID, amountCents: 5000, currencyCode: 'USD', idempotencyKey: '',
      })
    ).rejects.toMatchObject({ code: 'credit_reserve_idempotency_key_required' });
    expect(mockPaymentIntents.create).not.toHaveBeenCalled();
  });

  test('creates a Stripe PaymentIntent and returns the client secret with fee math', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.purchaseInsertRow = purchaseRow();
    dbState.purchaseById = purchaseRow({ stripe_payment_intent_id: 'pi_test_1' });
    mockPaymentIntents.create.mockResolvedValue({ id: 'pi_test_1', client_secret: 'secret_1' });

    const result = await reserveService.createReservePurchase({
      restaurantId: RESTAURANT_ID,
      operatorUserId: OPERATOR_ID,
      amountCents: 5000,
      currencyCode: 'USD',
      idempotencyKey: 'reserve-key-1',
    });

    expect(result.clientSecret).toBe('secret_1');
    expect(result.feeCents).toBe(125);
    expect(result.issuableCents).toBe(4875);
    expect(result.replayed).toBe(false);
    expect(mockPaymentIntents.create).toHaveBeenCalledTimes(1);
    const [piParams, piOpts] = mockPaymentIntents.create.mock.calls[0];
    expect(piParams.amount).toBe(5000);
    expect(piParams.currency).toBe('usd');
    expect(piParams.metadata.credit_reserve_purchase_id).toBe('11');
    expect(piOpts.idempotencyKey).toBe('credit-reserve-purchase:11');
    // The PaymentIntent id is persisted before the secret is returned.
    expect(calls.some((sql) => sql.includes('UPDATE restaurant_credit_reserve_purchases') && sql.includes('stripe_payment_intent_id'))).toBe(true);
  });

  test('replays the same idempotency key without charging twice', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.purchaseInsertRow = null; // ON CONFLICT DO NOTHING -> no row
    dbState.existingPurchase = purchaseRow(); // replay lookup finds the pending purchase
    dbState.purchaseById = purchaseRow({ stripe_payment_intent_id: 'pi_test_1' });
    mockPaymentIntents.create.mockResolvedValue({ id: 'pi_test_1', client_secret: 'secret_1' });

    const result = await reserveService.createReservePurchase({
      restaurantId: RESTAURANT_ID,
      operatorUserId: OPERATOR_ID,
      amountCents: 5000,
      currencyCode: 'USD',
      idempotencyKey: 'reserve-key-1',
    });

    expect(result.replayed).toBe(true);
    expect(result.clientSecret).toBe('secret_1');
    expect(mockPaymentIntents.create).toHaveBeenCalledTimes(1);
  });

  test('rejects a reused idempotency key with a different amount', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.purchaseInsertRow = null;
    dbState.existingPurchase = purchaseRow({ amount_cents: 6000 });

    await expect(
      reserveService.createReservePurchase({
        restaurantId: RESTAURANT_ID,
        operatorUserId: OPERATOR_ID,
        amountCents: 5000,
        currencyCode: 'USD',
        idempotencyKey: 'reserve-key-1',
      })
    ).rejects.toMatchObject({ code: 'credit_reserve_idempotency_conflict', status: 409 });
    expect(mockPaymentIntents.create).not.toHaveBeenCalled();
  });

  test('marks the purchase failed when Stripe cannot create the intent', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.purchaseInsertRow = purchaseRow();
    mockPaymentIntents.create.mockRejectedValue(new Error('card declined'));

    await expect(
      reserveService.createReservePurchase({
        restaurantId: RESTAURANT_ID,
        operatorUserId: OPERATOR_ID,
        amountCents: 5000,
        currencyCode: 'USD',
        idempotencyKey: 'reserve-key-1',
      })
    ).rejects.toMatchObject({ code: 'credit_reserve_stripe_failed', status: 502 });
    expect(calls.some((sql) => sql.includes('UPDATE restaurant_credit_reserve_purchases') && sql.includes("status = 'failed'"))).toBe(true);
  });
});

describe('confirmReservePurchase', () => {
  function happyPathState() {
    dbState.purchaseById = purchaseRow({ stripe_payment_intent_id: 'pi_test_1' });
    dbState.purchaseForUpdate = purchaseRow({ stripe_payment_intent_id: 'pi_test_1' });
    dbState.reserveUpsertRow = reserveRow({ balance_cents: 4875, lifetime_purchased_cents: 4875 });
    dbState.ledgerInsertRow = {
      id: 1, restaurant_id: RESTAURANT_ID, amount_cents: 4875, balance_after_cents: 4875,
      reference_type: 'purchase', reference_id: '11', stripe_payment_intent_id: 'pi_test_1',
      created_at: new Date().toISOString(),
    };
    dbState.purchaseUpdateRow = purchaseRow({ status: 'succeeded', stripe_payment_intent_id: 'pi_test_1', confirmed_at: new Date().toISOString() });
    mockPaymentIntents.retrieve.mockResolvedValue({ id: 'pi_test_1', status: 'succeeded', amount: 5000, currency: 'usd' });
  }

  test('credits the reserve with the net amount after Stripe confirms success', async () => {
    const calls = [];
    installDbMock(calls);
    happyPathState();

    const result = await reserveService.confirmReservePurchase({ restaurantId: RESTAURANT_ID, purchaseId: 11 });

    expect(result.duplicate).toBe(false);
    expect(result.purchase.status).toBe('succeeded');
    expect(Number(result.reserve.balance_cents)).toBe(4875);
    expect(Number(result.ledgerEntry.amount_cents)).toBe(4875);
    expect(result.ledgerEntry.reference_type).toBe('purchase');
    expect(Number(result.ledgerEntry.balance_after_cents)).toBe(4875);
    // The reserve upsert credits issuable (net of the 2.5% fee), not the gross.
    const upsertCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO restaurant_credit_reserves'));
    expect(upsertCall[1]).toEqual(expect.arrayContaining([RESTAURANT_ID, 4875, 'USD']));
  });

  test('is idempotent: an already-succeeded purchase never credits twice', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.purchaseById = purchaseRow({ status: 'succeeded', stripe_payment_intent_id: 'pi_test_1' });
    dbState.reserveRow = reserveRow({ balance_cents: 4875 });

    const result = await reserveService.confirmReservePurchase({ restaurantId: RESTAURANT_ID, purchaseId: 11 });

    expect(result.duplicate).toBe(true);
    expect(Number(result.reserve.balance_cents)).toBe(4875);
    expect(mockPaymentIntents.retrieve).not.toHaveBeenCalled();
    expect(calls.some((sql) => sql.includes('INSERT INTO restaurant_credit_reserves'))).toBe(false);
    expect(calls.some((sql) => sql.includes('INSERT INTO restaurant_credit_reserve_ledger'))).toBe(false);
  });

  test('fails closed when the payment has not completed: reserve untouched, purchase stays pending', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.purchaseById = purchaseRow({ stripe_payment_intent_id: 'pi_test_1' });
    mockPaymentIntents.retrieve.mockResolvedValue({ id: 'pi_test_1', status: 'requires_payment_method', amount: 5000, currency: 'usd' });

    await expect(
      reserveService.confirmReservePurchase({ restaurantId: RESTAURANT_ID, purchaseId: 11 })
    ).rejects.toMatchObject({ code: 'credit_reserve_payment_pending', status: 409 });
    expect(calls.some((sql) => sql.includes('INSERT INTO restaurant_credit_reserves'))).toBe(false);
    expect(calls.some((sql) => sql.includes("status = 'failed'"))).toBe(false);
  });

  test('parks the purchase as failed when Stripe reports the payment canceled', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.purchaseById = purchaseRow({ stripe_payment_intent_id: 'pi_test_1' });
    mockPaymentIntents.retrieve.mockResolvedValue({ id: 'pi_test_1', status: 'canceled', amount: 5000, currency: 'usd' });

    await expect(
      reserveService.confirmReservePurchase({ restaurantId: RESTAURANT_ID, purchaseId: 11 })
    ).rejects.toMatchObject({ code: 'credit_reserve_payment_failed', status: 409 });
    expect(calls.some((sql) => sql.includes('INSERT INTO restaurant_credit_reserves'))).toBe(false);
    expect(calls.some((sql) => sql.includes('UPDATE restaurant_credit_reserve_purchases') && sql.includes("status = 'failed'"))).toBe(true);
  });

  test('fails closed on amount mismatch: never credits a mismatched payment', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.purchaseById = purchaseRow({ stripe_payment_intent_id: 'pi_test_1' });
    mockPaymentIntents.retrieve.mockResolvedValue({ id: 'pi_test_1', status: 'succeeded', amount: 9999, currency: 'usd' });

    await expect(
      reserveService.confirmReservePurchase({ restaurantId: RESTAURANT_ID, purchaseId: 11 })
    ).rejects.toMatchObject({ code: 'credit_reserve_amount_mismatch', status: 409 });
    expect(calls.some((sql) => sql.includes('INSERT INTO restaurant_credit_reserves'))).toBe(false);
  });

  test('404s for an unknown purchase', async () => {
    installDbMock([]);
    dbState.purchaseById = null;
    await expect(
      reserveService.confirmReservePurchase({ restaurantId: RESTAURANT_ID, purchaseId: 999 })
    ).rejects.toMatchObject({ code: 'credit_reserve_purchase_not_found', status: 404 });
  });
});

describe('debitCreditReserveForIssuance (issuance cap)', () => {
  const fakeClient = () => ({ query: mockQuery });

  test('opt-in gate: no reserve row means no cap is enforced', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.reserveRow = null;

    const result = await reserveService.debitCreditReserveForIssuance(fakeClient(), {
      restaurantId: RESTAURANT_ID,
      amountCents: 5000,
      referenceType: 'issuance',
      referenceId: 'req-1',
    });

    expect(result).toEqual({ enforced: false });
    expect(calls.some((sql) => sql.includes('UPDATE restaurant_credit_reserves'))).toBe(false);
    expect(calls.some((sql) => sql.includes('INSERT INTO restaurant_credit_reserve_ledger'))).toBe(false);
  });

  test('blocks issuance with 409 insufficient_credit_reserve when the balance is short', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.reserveRow = reserveRow({ balance_cents: 1000 });

    await expect(
      reserveService.debitCreditReserveForIssuance(fakeClient(), {
        restaurantId: RESTAURANT_ID,
        amountCents: 5000,
        referenceType: 'issuance',
        referenceId: 'req-1',
      })
    ).rejects.toMatchObject({
      code: 'insufficient_credit_reserve',
      status: 409,
      fields: { balanceCents: 1000, requiredCents: 5000 },
    });
    expect(calls.some((sql) => sql.includes('UPDATE restaurant_credit_reserves'))).toBe(false);
    expect(calls.some((sql) => sql.includes('INSERT INTO restaurant_credit_reserve_ledger'))).toBe(false);
  });

  test('draws the reserve down and writes a negative ledger row when covered', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.reserveRow = reserveRow({ balance_cents: 5000, lifetime_issued_cents: 2000 });
    dbState.reserveUpdateRow = reserveRow({ balance_cents: 3000, lifetime_issued_cents: 4000 });
    dbState.ledgerInsertRow = {
      id: 9, restaurant_id: RESTAURANT_ID, amount_cents: -2000, balance_after_cents: 3000,
      reference_type: 'issuance', reference_id: 'req-1', stripe_payment_intent_id: null,
      created_at: new Date().toISOString(),
    };

    const result = await reserveService.debitCreditReserveForIssuance(fakeClient(), {
      restaurantId: RESTAURANT_ID,
      amountCents: 2000,
      referenceType: 'issuance',
      referenceId: 'req-1',
    });

    expect(result.enforced).toBe(true);
    expect(Number(result.reserve.balance_cents)).toBe(3000);
    expect(Number(result.ledgerEntry.amount_cents)).toBe(-2000);
    expect(result.ledgerEntry.reference_type).toBe('issuance');
    expect(Number(result.ledgerEntry.balance_after_cents)).toBe(3000);
    const updateCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE restaurant_credit_reserves'));
    expect(updateCall[1]).toEqual([RESTAURANT_ID, 2000]);
    const ledgerCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO restaurant_credit_reserve_ledger'));
    expect(ledgerCall[1]).toEqual(expect.arrayContaining([RESTAURANT_ID, -2000, 3000, 'issuance', 'req-1']));
  });

  test('locks the reserve row (FOR UPDATE) so concurrent issuances serialize', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.reserveRow = reserveRow({ balance_cents: 5000 });
    dbState.reserveUpdateRow = reserveRow({ balance_cents: 4000, lifetime_issued_cents: 1000 });
    dbState.ledgerInsertRow = { id: 9 };

    await reserveService.debitCreditReserveForIssuance(fakeClient(), {
      restaurantId: RESTAURANT_ID,
      amountCents: 1000,
      referenceType: 'issuance',
      referenceId: 'req-1',
    });

    expect(calls.some((sql) => sql.includes('FROM restaurant_credit_reserves') && sql.includes('FOR UPDATE'))).toBe(true);
  });
});

describe('HTTP: merchant credit-reserve endpoints', () => {
  const operator = { id: OPERATOR_ID, email: 'owner@example.com' };

  test('POST /purchase validates and returns the client secret', async () => {
    const calls = [];
    installDbMock(calls);
    dbState.purchaseInsertRow = purchaseRow();
    dbState.purchaseById = purchaseRow({ stripe_payment_intent_id: 'pi_test_1' });
    mockPaymentIntents.create.mockResolvedValue({ id: 'pi_test_1', client_secret: 'secret_1' });

    const app = buildReserveApp(operator);
    const res = await request(app)
      .post('/api/food/merchant/credit-reserve/purchase')
      .send({ restaurantId: RESTAURANT_ID, amountCents: 5000, idempotencyKey: 'reserve-key-1' });

    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toBe('secret_1');
    expect(res.body.feeCents).toBe(125);
    expect(res.body.issuableCents).toBe(4875);
    expect(res.body.purchase.amountCents).toBe(5000);
    expect(res.body.replayed).toBe(false);
  });

  test('POST /purchase requires amount and idempotency key', async () => {
    installDbMock([]);
    const app = buildReserveApp(operator);

    const missingAmount = await request(app)
      .post('/api/food/merchant/credit-reserve/purchase')
      .send({ restaurantId: RESTAURANT_ID, idempotencyKey: 'k' });
    expect(missingAmount.status).toBe(400);
    expect(missingAmount.body.code).toBe('validation_failed');

    const missingKey = await request(app)
      .post('/api/food/merchant/credit-reserve/purchase')
      .send({ restaurantId: RESTAURANT_ID, amountCents: 5000 });
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.code).toBe('validation_failed');
  });

  test('POST /purchase rejects non-operators and unknown restaurants', async () => {
    installDbMock([]);

    const staffApp = buildReserveApp(operator);
    dbState.role = 'staff';
    const forbidden = await request(staffApp)
      .post('/api/food/merchant/credit-reserve/purchase')
      .send({ restaurantId: RESTAURANT_ID, amountCents: 5000, idempotencyKey: 'k' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('forbidden');

    dbState.role = 'owner';
    const noRestaurant = await request(staffApp)
      .post('/api/food/merchant/credit-reserve/purchase')
      .send({ amountCents: 5000, idempotencyKey: 'k' });
    expect(noRestaurant.status).toBe(404);
    expect(noRestaurant.body.code).toBe('restaurant_not_found');
  });

  test('POST /purchase/:purchaseId/confirm credits the reserve', async () => {
    installDbMock([]);
    dbState.purchaseById = purchaseRow({ stripe_payment_intent_id: 'pi_test_1' });
    dbState.purchaseForUpdate = purchaseRow({ stripe_payment_intent_id: 'pi_test_1' });
    dbState.reserveUpsertRow = reserveRow({ balance_cents: 4875, lifetime_purchased_cents: 4875 });
    dbState.ledgerInsertRow = { id: 1, amount_cents: 4875, balance_after_cents: 4875, reference_type: 'purchase' };
    dbState.purchaseUpdateRow = purchaseRow({ status: 'succeeded', stripe_payment_intent_id: 'pi_test_1' });
    mockPaymentIntents.retrieve.mockResolvedValue({ id: 'pi_test_1', status: 'succeeded', amount: 5000, currency: 'usd' });

    const app = buildReserveApp(operator);
    const res = await request(app)
      .post('/api/food/merchant/credit-reserve/purchase/11/confirm')
      .send({ restaurantId: RESTAURANT_ID });

    expect(res.status).toBe(200);
    expect(res.body.purchase.status).toBe('succeeded');
    expect(res.body.reserve.balanceCents).toBe(4875);
    expect(res.body.duplicate).toBe(false);
  });

  test('GET /balance reports opt-in state and lifetime stats', async () => {
    installDbMock([]);
    dbState.reserveRow = reserveRow({ balance_cents: 3000, lifetime_purchased_cents: 4875, lifetime_issued_cents: 1875 });

    const app = buildReserveApp(operator);
    const res = await request(app).get('/api/food/merchant/credit-reserve/balance').query({ restaurantId: RESTAURANT_ID });

    expect(res.status).toBe(200);
    expect(res.body.optedIn).toBe(true);
    expect(res.body.balanceCents).toBe(3000);
    expect(res.body.currencyCode).toBe('USD');
    expect(res.body.lifetimePurchasedCents).toBe(4875);
    expect(res.body.lifetimeIssuedCents).toBe(1875);
  });

  test('GET /balance for a non-enrolled restaurant reports optedIn false', async () => {
    installDbMock([]);
    dbState.reserveRow = null;

    const app = buildReserveApp(operator);
    const res = await request(app).get('/api/food/merchant/credit-reserve/balance').query({ restaurantId: RESTAURANT_ID });

    expect(res.status).toBe(200);
    expect(res.body.optedIn).toBe(false);
    expect(res.body.balanceCents).toBe(0);
  });

  test('GET /ledger returns paginated entries', async () => {
    installDbMock([]);
    dbState.ledgerList = [
      { id: 2, restaurant_id: RESTAURANT_ID, amount_cents: -2000, balance_after_cents: 2875, reference_type: 'issuance', reference_id: 'req-1', stripe_payment_intent_id: null, created_at: new Date().toISOString() },
      { id: 1, restaurant_id: RESTAURANT_ID, amount_cents: 4875, balance_after_cents: 4875, reference_type: 'purchase', reference_id: '11', stripe_payment_intent_id: 'pi_test_1', created_at: new Date().toISOString() },
    ];
    dbState.ledgerTotal = 2;

    const app = buildReserveApp(operator);
    const res = await request(app).get('/api/food/merchant/credit-reserve/ledger').query({ restaurantId: RESTAURANT_ID, limit: 20 });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries[0].referenceType).toBe('issuance');
    expect(res.body.entries[0].amountCents).toBe(-2000);
    expect(res.body.entries[1].referenceType).toBe('purchase');
  });
});
