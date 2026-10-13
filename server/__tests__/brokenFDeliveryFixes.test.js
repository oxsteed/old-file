'use strict';

// P2-4 bundle F (delivery / restaurant POS) broken-finding fixes.
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const appFlow = require('../controllers/restaurantAppFlowController');
const runner = require('../controllers/restaurantRunnerController');
const localDelivery = require('../controllers/localDeliveryController');
const { reconcilePosOrderPayment } = require('../services/restaurantPosPaymentLedgerService');
const payoutService = require('../services/deliveryDriverPayoutService');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const OWNER_RESTAURANT = { id: 11, business_id: 40, effective_role: 'owner' };

function buildApp(user = { id: USER_ID }) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.post('/api/restaurants/:restaurantId/runner/tasks/:taskId/proofs', express.json(), runner.logProof);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/payments', express.json(), appFlow.recordPosPayment);
  app.post('/api/restaurants/:restaurantId/pos/shifts/:shiftId/close', express.json(), appFlow.closeShift);
  app.patch('/api/restaurants/:restaurantId/runner/tasks/:taskId/dispatch', express.json(), appFlow.updateRunnerDispatch);
  app.post('/api/restaurants/:restaurantId/runner/tasks/:taskId/settlements', express.json(), appFlow.upsertRunnerSettlement);
  app.post('/api/delivery/driver-profile', express.json(), localDelivery.selfServeDriverOnboarding);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

// ── F07/F17: logProof requires a known method and a note ──

test('logProof rejects an unknown proof method', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [OWNER_RESTAURANT] })
    .mockResolvedValueOnce({ rows: [{ id: 5, status: 'En route', assigned_to: USER_ID }] });

  const res = await request(buildApp())
    .post('/api/restaurants/11/runner/tasks/5/proofs')
    .send({ note: 'left at door', method: 'teleport' });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe('validation_failed');
});

test('logProof rejects a proof with no note content', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [OWNER_RESTAURANT] })
    .mockResolvedValueOnce({ rows: [{ id: 5, status: 'En route', assigned_to: USER_ID }] });

  const res = await request(buildApp())
    .post('/api/restaurants/11/runner/tasks/5/proofs')
    .send({ method: 'photo', note: '   ' });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe('proof_note_required');
});

test('logProof accepts the legacy proof_type field and normalizes it', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [OWNER_RESTAURANT] })
    .mockResolvedValueOnce({ rows: [{ id: 5, status: 'En route', assigned_to: USER_ID }] })
    .mockResolvedValueOnce({ rows: [{ id: 77, method: 'delivery' }] }) // proof INSERT
    .mockResolvedValueOnce({ rows: [{ id: 5, status: 'Completed', food_order_id: null }] }); // task UPDATE

  const res = await request(buildApp())
    .post('/api/restaurants/11/runner/tasks/5/proofs')
    .send({ note: 'handed to customer', proof_type: 'delivery' });

  expect(res.status).toBe(201);
  const insertCall = mockQuery.mock.calls.find((c) => /INSERT INTO restaurant_runner_proofs/.test(c[0]));
  expect(insertCall[1][2]).toBe('delivery');
  expect(insertCall[1][3]).toBe('handed to customer');
});

// ── F03: generic refund on a terminal-card order fails closed ──

test('recordPosPayment generic refund is refused when processor card payments are unrefunded', async () => {
  const order = { id: 9, total_cents: 1000, currency_code: 'USD', metadata: {}, pos_ticket_state: 'open', status: 'accepted' };
  mockQuery
    .mockResolvedValueOnce({ rows: [OWNER_RESTAURANT] }) // requireRestaurantAccess
    .mockResolvedValueOnce({ rows: [order] }) // order FOR UPDATE
    .mockResolvedValueOnce({ rows: [] }) // refund idempotency lookup
    .mockResolvedValueOnce({ rows: [] }) // generic idempotency lookup
    .mockResolvedValueOnce({ rows: [{ paid_cents: 1000, refunded_cents: 0 }] }) // ledger sums
    .mockResolvedValueOnce({ rows: [] }) // wallet refund candidates -> none
    .mockResolvedValueOnce({ rows: [] }) // oxsteed credit refund candidates -> none
    .mockResolvedValueOnce({ rows: [{ captured_cents: 1000, refunded_cents: 0 }] }); // processor card exposure

  const res = await request(buildApp())
    .post('/api/restaurants/11/pos/orders/9/payments')
    .set('Idempotency-Key', 'refund-k1')
    .send({ paymentType: 'refund', amountCents: 100 });

  expect(res.status).toBe(409);
  expect(res.body.code).toBe('card_payment_requires_processor_refund');
});

// ── F16: dead branch — no shift check when shiftId is absent ──

test('recordPosPayment without shiftId does not query for an open shift', async () => {
  const order = { id: 9, total_cents: 1000, currency_code: 'USD', metadata: {}, pos_ticket_state: 'open', status: 'accepted' };
  mockQuery
    .mockResolvedValueOnce({ rows: [OWNER_RESTAURANT] })
    .mockResolvedValueOnce({ rows: [order] })
    // No idempotency key sent: the generic idempotency lookup is skipped.
    .mockResolvedValueOnce({ rows: [{ paid_cents: 0, refunded_cents: 0 }] }) // ledger sums
    .mockResolvedValueOnce({ rows: [{ id: 55, payment_type: 'cash' }] }) // payment INSERT
    .mockResolvedValueOnce({ rows: [order] }) // reconciliation: order FOR UPDATE
    .mockResolvedValueOnce({ rows: [{ paid_cents: 1000, refunded_cents: 0, pending_payments: 0 }] }) // reconciliation totals
    .mockResolvedValueOnce({ rows: [{ ...order, payment_status: 'paid' }] }) // reconciliation UPDATE
    .mockResolvedValueOnce({ rows: [] }) // cash_collection sync
    .mockResolvedValue({ rows: [] }); // audit insert / anything else

  const res = await request(buildApp())
    .post('/api/restaurants/11/pos/orders/9/payments')
    .send({ paymentType: 'cash', amountCents: 1000 });

  expect(res.status).toBe(201);
  const shiftQueries = mockQuery.mock.calls.filter((c) => /restaurant_pos_shifts/.test(c[0]));
  expect(shiftQueries).toHaveLength(0);
});

// ── F15: dead handoff CASE removed from updateRunnerDispatch ──

test('updateRunnerDispatch no longer carries the unreachable handoff_at branch', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [OWNER_RESTAURANT] }) // requireRestaurantAccess (owner: assertRestaurantPermission returns early, no query)
    .mockResolvedValueOnce({ rows: [{ id: 5, assigned_to: USER_ID, status: 'Assigned' }] }) // task FOR UPDATE
    .mockResolvedValueOnce({ rows: [{ id: 5, status: 'Queued' }] }); // UPDATE

  const res = await request(buildApp())
    .patch('/api/restaurants/11/runner/tasks/5/dispatch')
    .send({ release: true });

  expect(res.status).toBe(200);
  const updateCall = mockQuery.mock.calls.find((c) => /UPDATE restaurant_runner_tasks/.test(c[0]));
  expect(updateCall[0]).not.toMatch(/handoff_at = CASE/);
  expect(updateCall[0]).toMatch(/WHERE restaurant_id = \$7 AND id = \$8/);
  expect(updateCall[1]).toHaveLength(8);
});

// ── F08: settlement paid requires remittance covering reported cash ──

function settlementTask() {
  return {
    id: 7, food_order_id: 100, assigned_to: USER_ID, task_status: 'Completed',
    handoff_at: '2026-10-13T00:00:00Z', cash_collection_required: true,
    delivery_fee_cents: 300, tip_cents: 0, total_cents: 2000,
    payment_status: 'paid', fulfillment_type: 'delivery',
  };
}

test('upsertRunnerSettlement refuses paid when remittance does not cover reported cash', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [OWNER_RESTAURANT] })
    .mockResolvedValueOnce({ rows: [settlementTask()] })
    .mockResolvedValueOnce({ rows: [{ id: 3, status: 'approved', cash_collected_cents: 500, cash_remitted_cents: 0, payment_reference: null }] });

  const res = await request(buildApp())
    .post('/api/restaurants/11/runner/tasks/7/settlements')
    .send({ status: 'paid', cashCollectedCents: 500, paymentReference: 'ref-1' });

  expect(res.status).toBe(409);
  expect(res.body.code).toBe('cash_remittance_required');
});

test('upsertRunnerSettlement accepts paid once remittance covers reported cash', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [OWNER_RESTAURANT] })
    .mockResolvedValueOnce({ rows: [settlementTask()] })
    .mockResolvedValueOnce({ rows: [{ id: 3, status: 'approved', cash_collected_cents: 500, cash_remitted_cents: 0, payment_reference: null }] })
    .mockResolvedValueOnce({ rows: [{ id: 3, status: 'paid', cash_remitted_cents: 500 }] }); // upsert

  const res = await request(buildApp())
    .post('/api/restaurants/11/runner/tasks/7/settlements')
    .send({ status: 'paid', cashCollectedCents: 500, cashRemittedCents: 500, paymentReference: 'ref-1' });

  expect(res.status).toBe(201);
  expect(res.body.settlement).toMatchObject({ status: 'paid', cash_remitted_cents: 500 });
  const upsertCall = mockQuery.mock.calls.find((c) => /INSERT INTO restaurant_runner_settlements/.test(c[0]));
  expect(upsertCall[0]).toMatch(/cash_remitted_cents/);
});

// ── F06: reconciliation clears cash_collection_required once paid ──

test('reconcilePosOrderPayment clears cash_collection_required when the order becomes paid', async () => {
  const client = { query: mockQuery };
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 9, total_cents: 1000, pos_ticket_state: 'open', metadata: {} }] })
    .mockResolvedValueOnce({ rows: [{ paid_cents: 1000, refunded_cents: 0, pending_payments: 0 }] })
    .mockResolvedValueOnce({ rows: [{ id: 9, payment_status: 'paid' }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await reconcilePosOrderPayment(client, 9);
  expect(result.order.payment_status).toBe('paid');
  const syncCall = mockQuery.mock.calls.find((c) => /cash_collection_required = FALSE/.test(c[0]));
  expect(syncCall).toBeTruthy();
  expect(syncCall[1]).toEqual([9]);
});

// ── F11: closeShift expected cash subtracts cash refunds ──

test('closeShift subtracts cash refunds from expected cash', async () => {
  const shift = { id: 3, status: 'open', opening_cash_cents: 10000, staff_user_id: USER_ID };
  const summary = {
    cash_payments_cents: 20000, settled_payments_cents: 20000, refunds_cents: 1500,
    cash_refunds_cents: 1500, pending_payments: 0, paid_order_count: 5,
    drawer_cash_in_cents: 0, drawer_cash_out_cents: 0,
  };
  mockQuery
    .mockResolvedValueOnce({ rows: [OWNER_RESTAURANT] })
    .mockResolvedValueOnce({ rows: [shift] })
    .mockResolvedValueOnce({ rows: [summary] })
    .mockResolvedValueOnce({ rows: [{ ...shift, status: 'closed' }] }); // UPDATE

  const res = await request(buildApp())
    .post('/api/restaurants/11/pos/shifts/3/close')
    .send({ closingCashCents: 28500 });

  expect(res.status).toBe(200);
  // opening 10000 + cash payments 20000 - cash refunds 1500 = 28500 expected.
  expect(res.body.summary.expectedCashCents).toBe(28500);
  expect(res.body.summary.cashRefundsCents).toBe(1500);
  expect(res.body.summary.cashOverShortCents).toBe(0);
  const summaryCall = mockQuery.mock.calls.find((c) => /cash_refunds_cents/.test(c[0]));
  expect(summaryCall).toBeTruthy();
});

// ── F04: driver payout lifecycle ──

test('accrueDriverPayout inserts an accrued payout from the quoted amount', async () => {
  const client = { query: mockQuery };
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 10, status: 'accrued', payout_cents: 450 }] });

  const payout = await payoutService.accrueDriverPayout(client, {
    id: 1, helper_user_id: USER_ID, internal_driver_user_id: null, driver_payout_cents: 450,
  });

  expect(payout).toMatchObject({ status: 'accrued', payout_cents: 450 });
  const insertCall = mockQuery.mock.calls[0];
  expect(insertCall[0]).toMatch(/ON CONFLICT \(delivery_job_id\) DO NOTHING/);
  expect(insertCall[1]).toEqual([1, USER_ID, 450]);
});

test('accrueDriverPayout is a no-op without a driver or amount', async () => {
  const client = { query: mockQuery };
  const result = await payoutService.accrueDriverPayout(client, { id: 1, driver_payout_cents: 450 });
  expect(result).toBeNull();
  expect(mockQuery).not.toHaveBeenCalled();
});

test('markPayoutPaid fails closed without a payment reference', async () => {
  const client = { query: mockQuery };
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 10, status: 'approved', payout_cents: 450 }] });

  await expect(payoutService.markPayoutPaid(client, 10, USER_ID, ''))
    .rejects.toMatchObject({ code: 'driver_payout_reference_required' });
  expect(mockQuery.mock.calls.filter((c) => /UPDATE delivery_driver_payouts/.test(c[0]))).toHaveLength(0);
});

test('approvePayout rejects illegal transitions', async () => {
  const client = { query: mockQuery };
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 10, status: 'paid', payout_cents: 450 }] });

  await expect(payoutService.approvePayout(client, 10, USER_ID, null))
    .rejects.toMatchObject({ code: 'driver_payout_transition_invalid' });
});

test('approvePayout moves accrued to approved', async () => {
  const client = { query: mockQuery };
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 10, status: 'accrued', payout_cents: 450 }] })
    .mockResolvedValueOnce({ rows: [{ id: 10, status: 'approved', payout_cents: 450 }] });

  const payout = await payoutService.approvePayout(client, 10, USER_ID, 'ok');
  expect(payout.status).toBe('approved');
});

// ── F10: self-serve driver onboarding ──

test('selfServeDriverOnboarding rejects non-helpers', async () => {
  const res = await request(buildApp({ id: USER_ID, default_mode: 'customer' }))
    .post('/api/delivery/driver-profile')
    .send({ insuranceAcknowledged: true });

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('delivery_helper_required');
});

test('selfServeDriverOnboarding creates a pending-approval profile for helpers', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ user_id: USER_ID, approved: false, active: true }] });

  const res = await request(buildApp({ id: USER_ID, default_mode: 'helper' }))
    .post('/api/delivery/driver-profile')
    .send({ insuranceAcknowledged: true, vehicleType: 'car', maxPayloadLbs: 50 });

  expect(res.status).toBe(201);
  expect(res.body.success).toBe(true);
  expect(res.body.pendingApproval).toBe(true);
  const insertCall = mockQuery.mock.calls[0];
  expect(insertCall[0]).toMatch(/INSERT INTO delivery_driver_profiles/);
  expect(insertCall[1][0]).toBe(USER_ID);
});
