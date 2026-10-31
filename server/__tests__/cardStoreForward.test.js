'use strict';

// Card store-and-forward settlement control: flag-gated manual-review hold,
// exactly-once reconciliation, and queue-depth visibility. All DB/Stripe
// access is mocked here; the money-moving paths are covered against real
// PostgreSQL by restaurantTerminalOfflineLeases.db.test.js, which this file
// deliberately does not duplicate (its harness needs a restaurant_store_test
// database, not the credit_statement_test database used elsewhere).

const mockQueries = { pool: jest.fn(), client: jest.fn() };
jest.mock('../db', () => ({ query: (...args) => mockQueries.pool(...args), connect: jest.fn() }));
jest.mock('../utils/transaction', () => ({
  withTransaction: (_pool, fn) => fn({ query: (...args) => mockQueries.client(...args) }),
}));
jest.mock('../services/restaurantPosTerminalService', () => ({
  retrieveConnectedIntent: jest.fn(),
  searchConnectedIntentByOfflineId: jest.fn(),
  resolveRestaurantConnectAccount: jest.fn(),
}));
jest.mock('../services/restaurantPosPaymentLedgerService', () => ({
  reconcilePosOrderPayment: jest.fn(async () => ({ payment_status: 'requires_payment' })),
}));
jest.mock('../services/scopeModel', () => ({ resolveRestaurantAccess: jest.fn() }));
jest.mock('../services/permissionsService', () => ({ hasRestaurantPermission: jest.fn() }));
jest.mock('../services/restaurantLocationAccessService', () => ({ getLocationScope: jest.fn() }));
jest.mock('../services/businessAuditLog', () => ({ logBusinessAction: jest.fn() }));

const cardStoreForward = require('../services/cardStoreForward');
const offline = require('../services/restaurantTerminalOffline');
const leases = require('../services/restaurantTerminalOfflineLeases');
const terminal = require('../services/restaurantPosTerminalService');
const scopeModel = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const locationAccess = require('../services/restaurantLocationAccessService');
const controller = require('../controllers/restaurantTerminalOfflineController');

const OFFLINE_ID = '123e4567-e89b-12d3-a456-426614174000';
const ORDER_ID = 42;

function intentFor(status = 'succeeded', brand = 'visa') {
  return {
    id: 'pi_testintent0000000001',
    status,
    amount: 1000,
    amount_received: status === 'succeeded' ? 1000 : 0,
    currency: 'usd',
    metadata: { offlineId: OFFLINE_ID, food_order_id: String(ORDER_ID) },
    latest_charge: { payment_method_details: { card_present: { brand } } },
  };
}

// Mutable fake rows. The fake query layer below applies the same CASE guards
// the real SQL uses, so a test that double-settles observes the same
// idempotency the database enforces.
function installState({ policy = null, offlineStatus = 'recorded', posStatus = 'pending', permitStatus = 'issued' } = {}) {
  const state = {
    policy,
    offlinePayment: {
      offline_id: OFFLINE_ID, lease_id: '223e4567-e89b-12d3-a456-426614174001',
      restaurant_id: 7, location_id: 5, screen_ticket_id: null, food_order_id: ORDER_ID,
      provider_payment_intent_id: 'pi_testintent0000000001', amount_cents: 1000,
      status: offlineStatus, review_reasons: [],
    },
    posPayment: { id: 9001, status: posStatus, provider_payment_intent_id: null },
    permit: {
      id: OFFLINE_ID, restaurant_id: 7, location_id: 5, device_id: 11, food_order_id: ORDER_ID,
      shift_id: 3, amount_cents: 1000, currency_code: 'USD', provider_account_id: 'acct_x',
      business_date: '2026-10-31', expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      policy_snapshot: { allowedBrands: ['visa'] }, pos_payment_id: 9001,
      provider_payment_intent_id: null, status: permitStatus,
    },
    order: { id: ORDER_ID, restaurant_id: 7, location_id: 5, total_cents: 1000, payment_status: 'unpaid' },
    lease: { id: '223e4567-e89b-12d3-a456-426614174001', device_id: 11, shift_id: 3, currency_code: 'USD', provider_account_id: 'acct_x', business_date: '2026-10-31', created_by: 'user-1' },
    capturedSettingsArgs: null,
    listPayments: [],
    listPermits: [],
  };

  mockQueries.pool.mockImplementation(async (sql, params = []) => {
    if (sql.includes('SELECT location_id FROM restaurant_terminal_offline_permits')) {
      return { rows: [{ location_id: state.permit.location_id }] };
    }
    if (sql.includes('FROM restaurant_terminal_offline_permits WHERE id=$1 AND restaurant_id=$2')) {
      return { rows: [state.permit] };
    }
    if (sql.includes('FROM restaurant_terminal_offline_payments WHERE offline_id=$1 AND restaurant_id=$2')) {
      return { rows: [state.offlinePayment] };
    }
    if (sql.includes('FROM restaurant_store_forward_settings')) {
      return { rows: state.policy ? [state.policy] : [] };
    }
    if (sql.includes('COUNT(*)')) {
      if (sql.includes('restaurant_terminal_offline_payments')) return { rows: [{ status: 'recorded', n: 2 }, { status: 'requires_reconciliation', n: 1 }] };
      return { rows: [{ status: 'issued', n: 1 }] };
    }
    if (sql.includes('FROM restaurant_terminal_offline_payments WHERE restaurant_id=$1 AND status IN')) {
      return { rows: state.listPayments };
    }
    if (sql.includes('FROM restaurant_terminal_offline_permits WHERE restaurant_id=$1 AND status IN')) {
      return { rows: state.listPermits };
    }
    return { rows: [] };
  });

  mockQueries.client.mockImplementation(async (sql, params = []) => {
    if (sql.includes('array_append')) {
      const reason = params[1];
      if (!state.offlinePayment.review_reasons.includes(reason)) state.offlinePayment.review_reasons.push(reason);
      state.offlinePayment.status = 'requires_reconciliation';
      return { rows: [] };
    }
    if (sql.startsWith('SELECT id FROM food_orders')) return { rows: [{ id: ORDER_ID }] };
    if (sql.includes('FROM restaurant_terminal_offline_payments WHERE offline_id=$1 FOR UPDATE')) {
      return { rows: [state.offlinePayment] };
    }
    if (sql.includes('FROM restaurant_terminal_offline_permits WHERE id=$1 FOR UPDATE')) {
      return { rows: [state.permit] };
    }
    if (sql.includes('FROM restaurant_terminal_offline_permits WHERE id=$1')) return { rows: [] };
    if (sql.includes('FROM restaurant_terminal_offline_leases WHERE id=$1')) return { rows: [state.lease] };
    if (sql.includes('FROM food_orders WHERE id=$1 AND restaurant_id=$2 FOR UPDATE')) return { rows: [state.order] };
    if (sql.includes('FROM restaurant_terminal_offline_permits WHERE food_order_id=$1')) return { rows: [] };
    if (sql.includes('FROM restaurant_pos_payments WHERE food_order_id=$1 AND status IN')) return { rows: [{ n: 0 }] };
    if (sql.startsWith('INSERT INTO restaurant_terminal_offline_permits')) return { rows: [state.permit] };
    if (sql.startsWith('INSERT INTO restaurant_pos_payments')) return { rows: [{ id: 9001 }] };
    if (sql.includes('SET pos_payment_id=$2 WHERE id=$1')) {
      state.permit.pos_payment_id = params[1];
      return { rows: [] };
    }
    if (sql.includes('UPDATE restaurant_terminal_offline_payments SET food_order_id=')) {
      if (state.offlinePayment.status !== 'requires_reconciliation') state.offlinePayment.status = 'attached';
      return { rows: [] };
    }
    if (sql.includes('UPDATE restaurant_pos_payments SET')) {
      if (sql.includes("status='failed'")) {
        state.posPayment.status = 'failed';
        return { rows: [] };
      }
      if (sql.includes("ELSE 'pending' END")) {
        state.posPayment.status = state.posPayment.status === 'captured' ? 'captured' : 'pending';
        state.posPayment.provider_payment_intent_id = params[1];
      } else {
        state.posPayment.status = state.posPayment.status === 'captured' ? 'captured' : params[1];
        state.posPayment.provider_payment_intent_id = params[2];
      }
      return { rows: [state.posPayment] };
    }
    if (sql.includes('UPDATE restaurant_terminal_offline_permits SET status=')) {
      if (sql.includes("status='requires_reconciliation'")) state.permit.status = 'requires_reconciliation';
      else if (sql.includes("status='captured'")) state.permit.status = 'captured';
      else if (sql.includes("status='declined'")) state.permit.status = 'declined';
      else state.permit.status = params[1];
      state.permit.provider_payment_intent_id = sql.includes("status='requires_reconciliation'") || sql.includes("status='captured'") || sql.includes("status='declined'") ? params[1] : params[2];
      return { rows: [] };
    }
    if (sql.includes('SELECT id FROM restaurant_locations')) return { rows: [{ id: 5 }] };
    if (sql.startsWith('INSERT INTO restaurant_store_forward_settings')) {
      state.capturedSettingsArgs = params;
      return { rows: [] };
    }
    return { rows: [] };
  });
  return state;
}

function setFlag(on) {
  if (on) process.env.CARD_STORE_FORWARD_ENABLED = 'true';
  else delete process.env.CARD_STORE_FORWARD_ENABLED;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.CARD_STORE_FORWARD_ENABLED;
});
afterAll(() => { delete process.env.CARD_STORE_FORWARD_ENABLED; });

describe('cardStoreForward flag and policy helpers', () => {
  test('flag is off unless explicitly true', () => {
    delete process.env.CARD_STORE_FORWARD_ENABLED;
    expect(cardStoreForward.isGloballyEnabled()).toBe(false);
    process.env.CARD_STORE_FORWARD_ENABLED = 'yes';
    expect(cardStoreForward.isGloballyEnabled()).toBe(false);
    process.env.CARD_STORE_FORWARD_ENABLED = 'true';
    expect(cardStoreForward.isGloballyEnabled()).toBe(true);
  });

  test('hold requires global flag AND enabled policy AND manual_review mode', () => {
    setFlag(true);
    expect(cardStoreForward.shouldHoldForManagerReview({ enabled: true, settlement_mode: 'manual_review' })).toBe(true);
    expect(cardStoreForward.shouldHoldForManagerReview({ enabled: true, settlement_mode: 'automatic' })).toBe(false);
    expect(cardStoreForward.shouldHoldForManagerReview({ enabled: false, settlement_mode: 'manual_review' })).toBe(false);
    expect(cardStoreForward.shouldHoldForManagerReview(null)).toBe(false);
    setFlag(false);
    expect(cardStoreForward.shouldHoldForManagerReview({ enabled: true, settlement_mode: 'manual_review' })).toBe(false);
  });

  test('settlement mode defaults to manual_review and rejects unknown modes', () => {
    expect(cardStoreForward.normalizeSettlementMode(undefined)).toBe('manual_review');
    expect(cardStoreForward.normalizeSettlementMode('automatic')).toBe('automatic');
    expect(() => cardStoreForward.normalizeSettlementMode('instant')).toThrow(expect.objectContaining({ code: 'validation_failed' }));
  });

  test('policy read returns the row or null', async () => {
    const state = installState({ policy: { enabled: true, settlement_mode: 'automatic' } });
    await expect(cardStoreForward.getStoreForwardPolicy({ query: (...a) => mockQueries.pool(...a) }, 7, 5))
      .resolves.toMatchObject({ settlement_mode: 'automatic' });
    state.policy = null;
    await expect(cardStoreForward.getStoreForwardPolicy({ query: (...a) => mockQueries.pool(...a) }, 7, 5)).resolves.toBeNull();
  });
});

describe('reconcileForwarded hold and fail-closed behavior', () => {
  test('manual-review hold records the intent but does not mark the order paid', async () => {
    installState();
    terminal.retrieveConnectedIntent.mockResolvedValue(intentFor('succeeded'));
    const result = await offline.reconcileForwarded({
      restaurantId: 7, permitId: OFFLINE_ID, intentId: 'pi_testintent0000000001', holdForManagerReview: true,
    });
    expect(result.held).toBe(true);
    expect(result.payment.status).toBe('pending');
    expect(result.payment_status).toBe('requires_payment');
  });

  test('without the hold flag the same intent captures (today behavior)', async () => {
    const state = installState();
    terminal.retrieveConnectedIntent.mockResolvedValue(intentFor('succeeded'));
    const result = await offline.reconcileForwarded({
      restaurantId: 7, permitId: OFFLINE_ID, intentId: 'pi_testintent0000000001',
    });
    expect(result.held).toBeUndefined();
    expect(result.payment.status).toBe('captured');
    expect(state.permit.status).toBe('captured');
  });

  test('a payment already captured is never un-captured by a later hold pass', async () => {
    const state = installState({ posStatus: 'captured', permitStatus: 'captured' });
    terminal.retrieveConnectedIntent.mockResolvedValue(intentFor('succeeded'));
    const result = await offline.reconcileForwarded({
      restaurantId: 7, permitId: OFFLINE_ID, intentId: 'pi_testintent0000000001', holdForManagerReview: true,
    });
    expect(result.held).toBe(false);
    expect(result.payment.status).toBe('captured');
    expect(state.permit.status).toBe('captured');
  });

  test('amount mismatch fails closed with 409 and no capture', async () => {
    const state = installState();
    const intent = intentFor('succeeded');
    intent.amount_received = 999;
    terminal.retrieveConnectedIntent.mockResolvedValue(intent);
    await expect(offline.reconcileForwarded({
      restaurantId: 7, permitId: OFFLINE_ID, intentId: 'pi_testintent0000000001', holdForManagerReview: true,
    })).rejects.toMatchObject({ code: 'terminal_offline_intent_mismatch' });
    expect(state.posPayment.status).toBe('pending');
  });

  test('unknown intent status holds for review without capture', async () => {
    const state = installState();
    terminal.retrieveConnectedIntent.mockResolvedValue(intentFor('processing'));
    const result = await offline.reconcileForwarded({
      restaurantId: 7, permitId: OFFLINE_ID, intentId: 'pi_testintent0000000001', holdForManagerReview: true,
    });
    expect(result).toMatchObject({ status: 'requires_reconciliation', paid: false });
    expect(state.posPayment.status).toBe('pending');
  });

  test('canceled intent fails the reservation and declines the permit', async () => {
    const state = installState();
    terminal.retrieveConnectedIntent.mockResolvedValue(intentFor('canceled'));
    await offline.reconcileForwarded({
      restaurantId: 7, permitId: OFFLINE_ID, intentId: 'pi_testintent0000000001', holdForManagerReview: true,
    });
    expect(state.permit.status).toBe('declined');
    expect(state.posPayment.status).toBe('failed');
  });

  test('reconciling the same intent twice captures exactly once; a different intent conflicts', async () => {
    const state = installState();
    terminal.retrieveConnectedIntent.mockResolvedValue(intentFor('succeeded'));
    const first = await offline.reconcileForwarded({
      restaurantId: 7, permitId: OFFLINE_ID, intentId: 'pi_testintent0000000001',
    });
    expect(first.payment.status).toBe('captured');
    const second = await offline.reconcileForwarded({
      restaurantId: 7, permitId: OFFLINE_ID, intentId: 'pi_testintent0000000001',
    });
    expect(second.payment.status).toBe('captured');
    state.permit.provider_payment_intent_id = 'pi_testintent0000000001';
    const other = intentFor('succeeded');
    other.id = 'pi_differentintent0000002';
    terminal.retrieveConnectedIntent.mockResolvedValue(other);
    await expect(offline.reconcileForwarded({
      restaurantId: 7, permitId: OFFLINE_ID, intentId: 'pi_differentintent0000002',
    })).rejects.toMatchObject({ code: 'terminal_offline_permit_conflict' });
  });
});

describe('attach() settlement-mode wiring', () => {
  const manualPolicy = { restaurant_id: 7, location_id: 5, enabled: true, settlement_mode: 'manual_review' };
  const autoPolicy = { restaurant_id: 7, location_id: 5, enabled: true, settlement_mode: 'automatic' };

  test('flag on + manual_review holds a clean payment for manager accept', async () => {
    setFlag(true);
    const state = installState({ policy: manualPolicy });
    terminal.retrieveConnectedIntent.mockResolvedValue(intentFor('succeeded'));
    const result = await leases.attach({ restaurantId: 7, offlineId: OFFLINE_ID });
    expect(result).toMatchObject({ attached: true, settled: false, held: true, flagged: true });
    expect(state.offlinePayment.status).toBe('requires_reconciliation');
    expect(state.offlinePayment.review_reasons).toContain('manual_review_required');
    expect(state.posPayment.status).toBe('pending');
  });

  test('flag on + automatic settles a clean payment', async () => {
    setFlag(true);
    installState({ policy: autoPolicy });
    terminal.retrieveConnectedIntent.mockResolvedValue(intentFor('succeeded'));
    const result = await leases.attach({ restaurantId: 7, offlineId: OFFLINE_ID });
    expect(result).toMatchObject({ attached: true, settled: true });
    expect(result.held).toBeUndefined();
  });

  test('flag off + manual_review settles exactly as today (mode ignored)', async () => {
    setFlag(false);
    installState({ policy: manualPolicy });
    terminal.retrieveConnectedIntent.mockResolvedValue(intentFor('succeeded'));
    const result = await leases.attach({ restaurantId: 7, offlineId: OFFLINE_ID });
    expect(result).toMatchObject({ attached: true, settled: true });
    expect(result.held).toBeUndefined();
  });
});

describe('policy endpoint and queue depth', () => {
  function mockAccess() {
    scopeModel.resolveRestaurantAccess.mockResolvedValue({ id: 7, business_id: 3 });
    permissions.hasRestaurantPermission.mockResolvedValue(true);
    locationAccess.getLocationScope.mockResolvedValue({ mode: 'all', location_ids: [] });
  }
  function reqRes(body) {
    let jsonBody;
    let nextError;
    return {
      req: { user: { id: 9 }, params: { restaurantId: '7', locationId: '5' }, body },
      res: { set: jest.fn().mockReturnThis(), json: jest.fn((b) => { jsonBody = b; }), status: jest.fn().mockReturnThis() },
      next: jest.fn((e) => { nextError = e; }),
      getJson: () => jsonBody,
      getError: () => nextError,
    };
  }

  test('policy stores automatic when requested and defaults to manual_review', async () => {
    mockAccess();
    const state = installState();
    const t1 = reqRes({ enabled: true, allowedCardBrands: ['visa'], maxTransactionCents: 2000, maxDailyCents: 5000, settlementMode: 'automatic' });
    await controller.policy(t1.req, t1.res, t1.next);
    expect(t1.getError()).toBeUndefined();
    expect(t1.getJson()).toMatchObject({ configured: true, settlementMode: 'automatic' });
    expect(state.capturedSettingsArgs).toContain('automatic');
    const t2 = reqRes({ enabled: true, allowedCardBrands: ['visa'], maxTransactionCents: 2000, maxDailyCents: 5000 });
    await controller.policy(t2.req, t2.res, t2.next);
    expect(t2.getJson()).toMatchObject({ settlementMode: 'manual_review' });
    const t3 = reqRes({ enabled: true, allowedCardBrands: ['visa'], maxTransactionCents: 2000, maxDailyCents: 5000, settlementMode: 'instant' });
    await controller.policy(t3.req, t3.res, t3.next);
    expect(t3.getError()).toMatchObject({ code: 'validation_failed' });
  });

  test('openQueue depth appears only when the flag is on', async () => {
    mockAccess();
    installState();
    setFlag(false);
    const t1 = reqRes({});
    t1.req.params = { restaurantId: '7' };
    await controller.openQueue(t1.req, t1.res, t1.next);
    expect(t1.getJson().depth).toBeUndefined();
    setFlag(true);
    const t2 = reqRes({});
    t2.req.params = { restaurantId: '7' };
    await controller.openQueue(t2.req, t2.res, t2.next);
    expect(t2.getJson().depth).toMatchObject({ payments: { recorded: 2, requires_reconciliation: 1 }, permits: { issued: 1 } });
  });

  test('reconcile endpoint holds in manual_review mode only when the flag is on', async () => {
    mockAccess();
    const manualPolicy = { restaurant_id: 7, location_id: 5, enabled: true, settlement_mode: 'manual_review' };
    setFlag(true);
    installState({ policy: manualPolicy });
    terminal.retrieveConnectedIntent.mockResolvedValue(intentFor('succeeded'));
    const t1 = reqRes({ intentId: 'pi_testintent0000000001' });
    t1.req.params = { restaurantId: '7', permitId: OFFLINE_ID };
    await controller.reconcile(t1.req, t1.res, t1.next);
    expect(t1.getError()).toBeUndefined();
    expect(t1.getJson()).toMatchObject({ held: true });
    setFlag(false);
    installState({ policy: manualPolicy });
    terminal.retrieveConnectedIntent.mockResolvedValue(intentFor('succeeded'));
    const t2 = reqRes({ intentId: 'pi_testintent0000000001' });
    t2.req.params = { restaurantId: '7', permitId: OFFLINE_ID };
    await controller.reconcile(t2.req, t2.res, t2.next);
    expect(t2.getError()).toBeUndefined();
    expect(t2.getJson().payment.status).toBe('captured');
    expect(t2.getJson().held).toBeUndefined();
  });
});
