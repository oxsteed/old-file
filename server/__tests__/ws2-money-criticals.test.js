'use strict';

/**
 * WS2 (money criticals) regression tests — audit remediation 2026-09-30.
 *
 * Covers: C2 (payout stats days validation), C5 (pay_now Stripe refund on
 * cancel/refund), C6 (wallet hold capture reference + refund fallback),
 * C7 (payment refund audit columns), C8 (lost-dispute financials),
 * C9 (payout processing gate + idempotency), H1 (instant payout idempotency
 * + audit), H5 (hidden-restaurant predicate), H7 (affiliate payout audit),
 * H12 (checkout idempotency), M12 (open redirect), M13 (loyalty clawback),
 * M14 (runner completion guards + device ownership).
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/reconciliationExceptions', () => ({
  recordException: jest.fn().mockResolvedValue(1),
}));

// C6: refundWalletDebitForReference dual-posts to the OxSteed Credit central
// journal, which fails closed when the credit rail is disabled. These tests
// cover the wallet refund fallback logic, not the central posting, so stub
// the posting while keeping the rest of the real module intact.
jest.mock('../services/oxsteedCreditSubBankService', () => ({
  ...jest.requireActual('../services/oxsteedCreditSubBankService'),
  postFoodWalletDualEntry: jest.fn().mockResolvedValue({ posted: true }),
}));

const stripeMock = require('stripe').__mockInstance;
// The shared stripe mock has no balance/payouts namespaces; the payout paths
// under test need them.
stripeMock.balance = stripeMock.balance || { retrieve: jest.fn() };
stripeMock.payouts = stripeMock.payouts || { create: jest.fn() };
const { recordException } = require('../services/reconciliationExceptions');
const PayoutController = require('../controllers/PayoutController');
const paymentController = require('../controllers/paymentController');
const foodController = require('../controllers/foodController');
const affiliatePayoutsController = require('../controllers/affiliatePayoutsController');
const webhookController = require('../controllers/webhookController');
const {
  assertLegalRunnerCompletion,
  assertFoodOrderPaidForHandoff,
} = require('../controllers/restaurantRunnerController');
const { _verifyDeviceForDriver } = require('../services/deliveryTrackingService');
const { refundWalletDebitForReference } = require('../services/foodWalletService');
const { postFoodWalletDualEntry } = require('../services/oxsteedCreditSubBankService');
const { settlePaymentRefund } = require('../services/paymentRefundService');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function keyed(impl) {
  mockQuery.mockImplementation(async (sql, params) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    return impl(sql, params);
  });
}

beforeEach(() => {
  resetMocks();
  recordException.mockClear();
  postFoodWalletDualEntry.mockClear();
  Object.values(stripeMock).forEach((ns) => {
    if (ns && typeof ns === 'object') Object.values(ns).forEach((fn) => fn && fn.mockReset && fn.mockReset());
  });
  delete process.env.PAYOUT_PROCESSOR_ENABLED;
});

// ── C2: payout stats `days` must be a bound integer, never SQL ──────────────
describe('C2 getPayoutStats days validation', () => {
  test('injection string is parsed to an integer and bound as a param', async () => {
    keyed(async () => ({ rows: [{}], rowCount: 0 }));
    const res = mockRes();
    await PayoutController.getPayoutStats(
      { user: { helper_id: 9 }, query: { days: '7; DROP TABLE affiliate_payouts' } },
      res
    );
    expect(mockQuery).toHaveBeenCalled();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('make_interval(days => $2)');
    expect(sql).not.toContain('DROP');
    expect(params).toEqual([9, 7]);
    expect(res.json).toHaveBeenCalled();
  });

  test('non-numeric days falls back to 30; huge values clamp to 3650', async () => {
    keyed(async () => ({ rows: [{}], rowCount: 0 }));
    await PayoutController.getPayoutStats({ user: { helper_id: 9 }, query: { days: 'abc' } }, mockRes());
    expect(mockQuery.mock.calls[0][1]).toEqual([9, 30]);
    resetMocks();
    keyed(async () => ({ rows: [{}], rowCount: 0 }));
    await PayoutController.getPayoutStats({ user: { helper_id: 9 }, query: { days: '99999' } }, mockRes());
    expect(mockQuery.mock.calls[0][1]).toEqual([9, 3650]);
  });
});

// ── C9: payout processing gate + idempotency ─────────────────────────────────
describe('C9 processPayout', () => {
  test('503 while no real money processor is wired', async () => {
    const res = mockRes();
    await PayoutController.processPayout(
      { params: { payout_id: '1' }, body: {}, get: () => null, user: { id: 'u1' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(503);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('400 when Idempotency-Key is missing or malformed', async () => {
    process.env.PAYOUT_PROCESSOR_ENABLED = 'true';
    const bad = mockRes();
    await PayoutController.processPayout(
      { params: { payout_id: '1' }, body: {}, get: () => null, user: { id: 'u1' } },
      bad
    );
    expect(bad.status).toHaveBeenCalledWith(400);
    const malformed = mockRes();
    await PayoutController.processPayout(
      { params: { payout_id: '1' }, body: {}, get: () => 'x', user: { id: 'u1' } },
      malformed
    );
    expect(malformed.status).toHaveBeenCalledWith(400);
  });
});

// ── H1: instant payout idempotency + audit ───────────────────────────────────
describe('H1 requestInstantPayout', () => {
  function payoutApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'u1' }; next(); });
    app.post('/payout', paymentController.requestInstantPayout);
    app.use(errorHandler);
    return app;
  }

  test('uses a per-user-day Stripe idempotency key and writes an audit row', async () => {
    const today = new Date().toISOString().slice(0, 10);
    keyed(async (sql) => {
      if (sql.includes('FROM connect_accounts')) {
        return { rows: [{ id: 1, user_id: 'u1', stripe_account_id: 'acct_1', payouts_enabled: true, charges_enabled: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    stripeMock.accounts.retrieve.mockResolvedValue({ charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [] } });
    stripeMock.balance.retrieve.mockResolvedValue({ available: [{ currency: 'usd', amount: 5000 }] });
    stripeMock.payouts.create.mockResolvedValue({ id: 'po_123', status: 'pending' });

    const res = await request(payoutApp()).post('/payout');
    expect(res.status).toBe(200);
    expect(stripeMock.payouts.create).toHaveBeenCalledWith(
      { amount: 5000, currency: 'usd', method: 'instant' },
      expect.objectContaining({ idempotencyKey: `instant-payout:u1:${today}` })
    );
    const auditCall = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO admin_audit_log'));
    expect(auditCall).toBeTruthy();
    expect(auditCall[0]).toContain('admin_id, action, target_type');
  });
});

// ── C5: pay_now Stripe refund on cancel/refund ───────────────────────────────
describe('C5 pay_now card refund', () => {
  test('refunds the payment intent with a per-order idempotency key and records the POS refund', async () => {
    stripeMock.refunds.create.mockResolvedValue({ id: 're_1', amount: 2500, charge: 'ch_1' });
    keyed(async (sql) => {
      if (sql.includes('INSERT INTO restaurant_pos_payments')) return { rows: [{ id: 7 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const order = {
      id: 42,
      stripe_payment_intent_id: 'pi_1',
      total_cents: 2500,
      currency_code: 'USD',
      metadata: { stripeCheckout: { connectedAccountId: 'acct_9' } },
    };
    const result = await foodController._refundFoodOrderStripePayment(
      { query: mockQuery },
      { order, restaurantId: 3, status: 'cancelled' }
    );
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_1' },
      expect.objectContaining({ stripeAccount: 'acct_9', idempotencyKey: 'food-order:42:refund' })
    );
    expect(result.posPayment).toEqual({ id: 7 });
    const posCall = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO restaurant_pos_payments'));
    expect(posCall[0]).toContain("'stripe_checkout'");
    expect(posCall[0]).toContain('ON CONFLICT (restaurant_id, idempotency_key)');
  });

  test('a failed Stripe refund surfaces a 502 instead of silently skipping', async () => {
    stripeMock.refunds.create.mockRejectedValue(new Error('card_declined'));
    keyed(async () => ({ rows: [], rowCount: 0 }));
    const order = { id: 42, stripe_payment_intent_id: 'pi_1', total_cents: 2500, currency_code: 'USD', metadata: {} };
    await expect(
      foodController._refundFoodOrderStripePayment({ query: mockQuery }, { order, restaurantId: 3 })
    ).rejects.toMatchObject({ status: 502, code: 'stripe_refund_failed' });
  });
});

// ── C6: wallet hold capture reference + refund fallback ──────────────────────
describe('C6 wallet hold capture reference', () => {
  const legacyDebit = { id: 99, amount_cents: 1200, currency_code: 'USD', reference_type: 'wallet_hold', reference_id: 'sess_1' };

  function refundMocks({ directRows, legacyRows }) {
    keyed(async (sql) => {
      if (sql.includes('INSERT INTO food_customer_wallet_accounts')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM food_customer_wallet_accounts a')) {
        return { rows: [{ id: 55, status: 'active', currency_code: 'USD', balance_cents: 5000, ledger_version: 1 }], rowCount: 1 };
      }
      if (sql.includes("entry_type = 'debit'") && sql.includes("reference_type = 'food_order'")) return { rows: directRows, rowCount: directRows.length };
      if (sql.includes("metadata->>'orderId'")) return { rows: legacyRows, rowCount: legacyRows.length };
      if (sql.includes("reference_type = 'food_order_refund'")) return { rows: [], rowCount: 0 };
      if (sql.includes('UPDATE food_customer_wallet_accounts')) return { rows: [{ id: 55, balance_cents: 6200 }], rowCount: 1 };
      if (sql.includes('INSERT INTO food_customer_wallet_ledger')) return { rows: [{ id: 101, amount_cents: 1200 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
  }

  test('refunds a legacy hold-captured debit via the metadata orderId fallback', async () => {
    refundMocks({ directRows: [], legacyRows: [legacyDebit] });
    const result = await refundWalletDebitForReference({ query: mockQuery }, {
      restaurantId: 3,
      customerId: 'cust-1',
      currencyCode: 'USD',
      orderReferenceId: '42',
      description: 'refund',
    });
    expect(result.refunded).toBe(true);
    expect(recordException).not.toHaveBeenCalled();
    const fallbackCall = mockQuery.mock.calls.find(([sql]) => sql.includes("metadata->>'orderId'"));
    expect(fallbackCall).toBeTruthy();
  });

  test('records a reconciliation exception instead of silently skipping when no debit exists', async () => {
    refundMocks({ directRows: [], legacyRows: [] });
    const result = await refundWalletDebitForReference({ query: mockQuery }, {
      restaurantId: 3,
      customerId: 'cust-1',
      currencyCode: 'USD',
      orderReferenceId: '42',
      description: 'refund',
    });
    expect(result).toMatchObject({ refunded: false, reason: 'debit_not_found' });
    expect(recordException).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'payment_refund',
      referenceId: 'food-order:42',
    }));
  });
});

// ── C7: payment refund settlement writes a real audit row ────────────────────
describe('C7 settlePaymentRefund audit', () => {
  test('audit INSERT uses the real admin_audit_log columns', async () => {
    const attempt = { id: 'att-1', payment_id: 11, amount_cents: 2500, reason: 'test', actor_user_id: 'admin-1', status: 'pending', reverse_application_fee: false };
    const payment = { id: 11, job_id: 5, amount: 25.0, refunded_amount: 0, stripe_charge_id: 'ch_1', stripe_account_id: null, stripe_payment_intent_id: 'pi_1', currency: 'usd' };
    keyed(async (sql) => {
      if (sql.includes('FROM payment_refund_attempts')) return { rows: [attempt], rowCount: 1 };
      if (sql.includes('FROM payments')) return { rows: [payment], rowCount: 1 };
      if (sql.includes('UPDATE payment_refund_attempts')) return { rows: [{ ...attempt, status: 'succeeded' }], rowCount: 1 };
      if (sql.includes('UPDATE payments')) return { rows: [{ ...payment, status: 'refunded' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    stripeMock.charges.retrieve.mockResolvedValue({
      id: 'ch_1', amount: 2500, amount_refunded: 2500, payment_intent: 'pi_1', currency: 'usd',
    });
    const providerRefund = { id: 're_9', amount: 2500, currency: 'usd', payment_intent: 'pi_1', charge: 'ch_1', status: 'succeeded' };
    const result = await settlePaymentRefund(
      { payment, attempt: { ...attempt, idempotency_key: 'k1' } },
      providerRefund
    );
    expect(result.replay).toBe(false);
    const auditCall = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO admin_audit_log'));
    expect(auditCall).toBeTruthy();
    expect(auditCall[0]).toContain('admin_id, action, target_type, target_id');
    expect(auditCall[0]).not.toContain('performed_by');
  });
});

// ── C8: lost-dispute financials ──────────────────────────────────────────────
describe('C8 recordLostDisputeFinancials', () => {
  const dispute = { id: 'dp_1', status: 'lost', amount: 2500, currency: 'usd', reason: 'fraudulent', charge: 'ch_1', payment_intent: 'pi_1' };

  test('marks the payment disputed and posts the loss to the ledger', async () => {
    keyed(async (sql) => {
      if (sql.includes('FROM payments')) {
        return { rows: [{ id: 11, payee_id: 'u9', dispute_status: null, escrow_status: 'held' }], rowCount: 1 };
      }
      if (sql.includes('UPDATE payments')) return { rows: [{ id: 11, status: 'disputed' }], rowCount: 1 };
      if (sql.includes("type = 'dispute_lost'")) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO platform_ledger')) return { rows: [{ id: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const result = await webhookController.recordLostDisputeFinancials(dispute, 'acct_1');
    expect(result.replayed).toBe(false);
    const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE payments'));
    expect(updateCall[0]).toContain("payment_hold_status = 'disputed'");
    expect(updateCall[0]).toContain('stripe_dispute_id');
    const ledgerCall = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO platform_ledger'));
    expect(ledgerCall).toBeTruthy();
    // VALUES ($1, 'dispute_lost', $2, $3, $4) — amount_cents is the 2nd param.
    expect(ledgerCall[1][1]).toBe(-2500);
  });

  test('replays without double-posting when already recorded', async () => {
    keyed(async (sql) => {
      if (sql.includes('FROM payments')) {
        return { rows: [{ id: 11, dispute_status: 'lost' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const result = await webhookController.recordLostDisputeFinancials(dispute, 'acct_1');
    expect(result.replayed).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('UPDATE payments'))).toBe(false);
  });

  test('ignores non-lost disputes', async () => {
    const result = await webhookController.recordLostDisputeFinancials({ ...dispute, status: 'won' }, 'acct_1');
    expect(result).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ── H5: admin-hidden restaurants stay out of public surfaces ──────────────────
describe('H5 hidden restaurant predicate', () => {
  test('listRestaurants filters out admin-hidden restaurants', async () => {
    keyed(async () => ({ rows: [], rowCount: 0 }));
    const app = express();
    app.use(express.json());
    app.get('/restaurants', foodController.listRestaurants);
    app.use(errorHandler);
    await request(app).get('/restaurants');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE');
  });
});

// ── H7: affiliate payout audit ───────────────────────────────────────────────
describe('H7 affiliate payout audit', () => {
  test('processing a payout writes an admin_audit_log row', async () => {
    const payout = { id: 'pay-1', status: 'pending', total_commission_cents: 3000, affiliate_program_id: 'prg-1', helper_id: 'u1' };
    keyed(async (sql) => {
      if (sql.includes('FROM affiliate_payouts ap')) return { rows: [payout], rowCount: 1 };
      if (sql.includes("SET status = 'processing'")) return { rows: [{ ...payout, status: 'processing' }], rowCount: 1 };
      if (sql.includes('SET status = $1, payout_method')) return { rows: [{ ...payout, status: 'processing' }], rowCount: 1 };
      if (sql.includes('UPDATE affiliate_programs')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    stripeMock.payouts.create.mockResolvedValue({ id: 'po_9' });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'u1' }; next(); });
    app.post('/payouts/:payoutId/process', affiliatePayoutsController.processPayout);
    app.use(errorHandler);
    const res = await request(app).post('/payouts/pay-1/process').send({ payment_method_id: 'pm_1' });
    expect(res.status).toBe(200);
    const auditCall = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO admin_audit_log'));
    expect(auditCall).toBeTruthy();
    expect(auditCall[1][1]).toBe('affiliate_payout_processed');
  });
});

// ── H12: checkout idempotency ────────────────────────────────────────────────
describe('H12 checkout idempotency', () => {
  test('resume replays an existing checkout session instead of calling Stripe', async () => {
    keyed(async (sql) => {
      if (sql.includes('FROM food_orders fo')) {
        return {
          rows: [{
            id: 42, customer_id: 'u1', payment_status: 'requires_payment',
            metadata: { paymentMode: 'pay_now', checkoutSessionId: 'cs_existing' },
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM food_order_items')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'u1' }; next(); });
    app.post('/orders/:orderId/checkout', foodController.resumeFoodCheckoutSession);
    app.use(errorHandler);
    const res = await request(app).post('/orders/42/checkout').send({});
    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(true);
    expect(res.body.payment.checkoutSessionId).toBe('cs_existing');
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

// ── M12: return URL allowlist ────────────────────────────────────────────────
describe('M12 safeReturnUrl', () => {
  const { _safeReturnUrl: safeReturnUrl } = foodController;

  test('rejects absolute URLs on other hosts (open redirect)', () => {
    expect(safeReturnUrl('https://evil.example/phish')).toBeNull();
    expect(safeReturnUrl('http://evil.example/phish')).toBeNull();
    expect(safeReturnUrl('//evil.example/phish')).toBeNull();
  });

  test('anchors relative paths to the public site', () => {
    const out = safeReturnUrl('/orders/42');
    expect(out).toContain('/orders/42');
    expect(out).toMatch(/^https?:\/\//);
  });
});

// ── M13: loyalty clawback ────────────────────────────────────────────────────
describe('M13 clawBackFoodLoyaltyOnRefund', () => {
  test('claws back earned points with a negative ledger row, floored at zero', async () => {
    keyed(async (sql) => {
      if (sql.includes('FROM food_loyalty_accounts')) return { rows: [{ id: 8 }], rowCount: 1 };
      if (sql.includes("reason = 'order_completed'")) return { rows: [{ id: 1, delta_points: 25 }], rowCount: 1 };
      if (sql.includes("reason = 'order_refunded'") && sql.includes('SELECT')) return { rows: [], rowCount: 0 };
      if (sql.includes('UPDATE food_loyalty_accounts')) return { rows: [], rowCount: 1 };
      if (sql.includes('INSERT INTO food_loyalty_ledger')) return { rows: [{ id: 2 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const result = await foodController._clawBackFoodLoyaltyOnRefund(
      { query: mockQuery },
      { id: 42, restaurant_id: 3, customer_id: 'u1' }
    );
    expect(result).toMatchObject({ accountId: 8, points: 25 });
    const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE food_loyalty_accounts'));
    expect(updateCall[0]).toContain('GREATEST(0, points_balance - $1)');
    const ledgerCall = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO food_loyalty_ledger'));
    expect(ledgerCall[1]).toEqual(expect.arrayContaining([8, 42, -25]));
  });

  test('is a no-op when already clawed back (idempotent)', async () => {
    keyed(async (sql) => {
      if (sql.includes('FROM food_loyalty_accounts')) return { rows: [{ id: 8 }], rowCount: 1 };
      if (sql.includes("reason = 'order_completed'")) return { rows: [{ id: 1, delta_points: 25 }], rowCount: 1 };
      if (sql.includes("reason = 'order_refunded'")) return { rows: [{ id: 2 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const result = await foodController._clawBackFoodLoyaltyOnRefund(
      { query: mockQuery },
      { id: 42, restaurant_id: 3, customer_id: 'u1' }
    );
    expect(result).toBeNull();
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('UPDATE food_loyalty_accounts'))).toBe(false);
  });
});

// ── M14: runner completion guards + device ownership ─────────────────────────
describe('M14 runner completion guards', () => {
  test('only En route may transition to Completed', () => {
    expect(() => assertLegalRunnerCompletion('En route')).not.toThrow();
    expect(() => assertLegalRunnerCompletion('Picked up')).toThrow(
      expect.objectContaining({ status: 409, code: 'illegal_runner_status_transition' })
    );
    expect(() => assertLegalRunnerCompletion('Issue')).toThrow(
      expect.objectContaining({ code: 'illegal_runner_status_transition' })
    );
    expect(() => assertLegalRunnerCompletion('Completed')).toThrow(
      expect.objectContaining({ code: 'illegal_runner_status_transition' })
    );
  });

  test('unpaid pay_now orders cannot complete on handoff', () => {
    expect(() => assertFoodOrderPaidForHandoff({
      payment_status: 'requires_payment',
      metadata: { paymentMode: 'pay_now' },
    })).toThrow(expect.objectContaining({ status: 409, code: 'order_unpaid' }));
    expect(() => assertFoodOrderPaidForHandoff({
      payment_status: 'paid',
      metadata: { paymentMode: 'pay_now' },
    })).not.toThrow();
    expect(() => assertFoodOrderPaidForHandoff({
      payment_status: 'unpaid',
      metadata: { paymentMode: 'cash' },
    })).not.toThrow();
  });
});

describe('M14 device ownership', () => {
  test('a driver cannot use another driver\u2019s phone', () => {
    expect(() => _verifyDeviceForDriver(
      { id: 'd1', kind: 'driver_phone', status: 'active', driver_user_id: 'driver-b' },
      'driver-a'
    )).toThrow(expect.objectContaining({ code: 'tracking_device_not_owned', status: 403 }));
  });

  test('own phone and fleet vehicle trackers are allowed; inactive rejected', () => {
    expect(_verifyDeviceForDriver(
      { id: 'd1', kind: 'driver_phone', status: 'active', driver_user_id: 'driver-a' },
      'driver-a'
    )).toBeTruthy();
    expect(_verifyDeviceForDriver(
      { id: 'd2', kind: 'vehicle_tracker', status: 'active', driver_user_id: null },
      'driver-a'
    )).toBeTruthy();
    expect(() => _verifyDeviceForDriver(
      { id: 'd1', kind: 'driver_phone', status: 'suspended', driver_user_id: 'driver-a' },
      'driver-a'
    )).toThrow(expect.objectContaining({ code: 'tracking_device_not_active' }));
  });
});
