'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const disputeCtrl = require('../controllers/foodCreditDisputeController');

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000456';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000999';
const OWNER_ID = '00000000-0000-4000-8000-000000000123';
const STAFF_ID = '00000000-0000-4000-8000-000000000555';
const ADMIN_ID = '00000000-0000-4000-8000-000000000321';
const RESTAURANT_ID = 3;

function loadRequestRow(overrides = {}) {
  return {
    id: 77,
    restaurant_id: RESTAURANT_ID,
    business_id: 42,
    customer_id: CUSTOMER_ID,
    requested_by_user_id: CUSTOMER_ID,
    approved_by_user_id: null,
    cancelled_by_user_id: OWNER_ID,
    amount_cents: 5000,
    currency_code: 'USD',
    status: 'cancelled',
    note: 'Direct payment proof',
    reference_id: 'PAY-123',
    idempotency_key: 'key-1',
    correlation_id: 'corr-1',
    request_ip: null,
    metadata: {},
    approved_at: null,
    cancelled_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago, inside the 48h window
    expires_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function disputeRow(overrides = {}) {
  return {
    id: 9,
    load_request_id: 77,
    customer_id: CUSTOMER_ID,
    restaurant_id: RESTAURANT_ID,
    reason: 'I paid but the credit never landed',
    customer_evidence: { proofUrl: 'https://example.com/receipt.png' },
    restaurant_evidence: {},
    status: 'open',
    opened_at: new Date().toISOString(),
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    restaurant_name: 'Ox Burger Lab',
    ...overrides,
  };
}

function restaurantAccessRow(role = 'owner') {
  return {
    id: RESTAURANT_ID,
    business_id: 42,
    owner_user_id: OWNER_ID,
    display_name: 'Ox Burger Lab',
    currency_code: 'USD',
    effective_role: role,
  };
}

function buildCustomerApp(user = { id: CUSTOMER_ID, email: 'guest@example.com' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.post('/api/food/customer/wallets/:restaurantId/load-requests/:requestId/disputes', disputeCtrl.createDispute);
  app.get('/api/food/customer/wallets/:restaurantId/disputes', disputeCtrl.listMyDisputes);
  app.use(errorHandler);
  return app;
}

function buildMerchantApp(user = { id: OWNER_ID, email: 'owner@example.com' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.get('/api/food/merchant/wallets/:restaurantId/disputes', disputeCtrl.listMerchantDisputes);
  app.post('/api/food/merchant/wallets/:restaurantId/disputes/:disputeId/respond', disputeCtrl.respondToDispute);
  app.use(errorHandler);
  return app;
}

function buildAdminApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: ADMIN_ID, role: 'admin' }; next(); });
  app.post('/api/food/admin/wallets/disputes/:disputeId/resolve', disputeCtrl.resolveDispute);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('POST /api/food/customer/wallets/:restaurantId/load-requests/:requestId/disputes', () => {
  test('happy path: customer opens a dispute on a cancelled request inside the 48h window', async () => {
    const inserted = disputeRow();
    mockQuery
      .mockResolvedValueOnce({ rows: [loadRequestRow()], rowCount: 1 }) // SELECT load request FOR UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // no existing dispute
      .mockResolvedValueOnce({ rows: [inserted], rowCount: 1 }); // INSERT dispute
    // audit INSERT falls through to the default empty-result implementation

    const app = buildCustomerApp();
    const res = await request(app)
      .post(`/api/food/customer/wallets/${RESTAURANT_ID}/load-requests/77/disputes`)
      .send({ reason: 'I paid but the credit never landed', evidence: { proofUrl: 'https://example.com/receipt.png' } });

    expect(res.status).toBe(201);
    expect(res.body.dispute).toMatchObject({
      loadRequestId: '77',
      status: 'open',
      reason: 'I paid but the credit never landed',
      customerEvidence: { proofUrl: 'https://example.com/receipt.png' },
    });
  });

  test('404 when the request does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(buildCustomerApp())
      .post(`/api/food/customer/wallets/${RESTAURANT_ID}/load-requests/4242/disputes`)
      .send({ reason: 'missing' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('wallet_load_request_not_found');
  });

  test('non-owner gets a 404 (fail closed, no ownership signal)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [loadRequestRow({ customer_id: OTHER_USER_ID })], rowCount: 1 });

    const res = await request(buildCustomerApp())
      .post(`/api/food/customer/wallets/${RESTAURANT_ID}/load-requests/77/disputes`)
      .send({ reason: 'not mine' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('wallet_load_request_not_found');
  });

  test('409 when the load request is not cancelled', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [loadRequestRow({ status: 'pending', cancelled_at: null })], rowCount: 1 });

    const res = await request(buildCustomerApp())
      .post(`/api/food/customer/wallets/${RESTAURANT_ID}/load-requests/77/disputes`)
      .send({ reason: 'too early' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('credit_dispute_load_not_cancelled');
  });

  test('409 when the cancellation is older than 48h (window enforcement)', async () => {
    const stale = loadRequestRow({
      cancelled_at: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(), // 49h ago
    });
    mockQuery.mockResolvedValueOnce({ rows: [stale], rowCount: 1 });

    const res = await request(buildCustomerApp())
      .post(`/api/food/customer/wallets/${RESTAURANT_ID}/load-requests/77/disputes`)
      .send({ reason: 'too late' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('credit_dispute_window_expired');
  });

  test('409 when a dispute already exists for the load request', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [loadRequestRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 9 }], rowCount: 1 }); // existing dispute

    const res = await request(buildCustomerApp())
      .post(`/api/food/customer/wallets/${RESTAURANT_ID}/load-requests/77/disputes`)
      .send({ reason: 'duplicate attempt' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('credit_dispute_already_exists');
  });

  test('409 on unique-violation race (23505)', async () => {
    const conflict = new Error('duplicate key value violates unique constraint');
    conflict.code = '23505';
    mockQuery
      .mockResolvedValueOnce({ rows: [loadRequestRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockRejectedValueOnce(conflict); // concurrent insert won the race

    const res = await request(buildCustomerApp())
      .post(`/api/food/customer/wallets/${RESTAURANT_ID}/load-requests/77/disputes`)
      .send({ reason: 'racing' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('credit_dispute_already_exists');
  });

  test('400 when reason is missing or evidence is not an object', async () => {
    const missingReason = await request(buildCustomerApp())
      .post(`/api/food/customer/wallets/${RESTAURANT_ID}/load-requests/77/disputes`)
      .send({ evidence: {} });
    expect(missingReason.status).toBe(400);
    expect(missingReason.body.code).toBe('validation_failed');

    const badEvidence = await request(buildCustomerApp())
      .post(`/api/food/customer/wallets/${RESTAURANT_ID}/load-requests/77/disputes`)
      .send({ reason: 'ok', evidence: ['not-an-object'] });
    expect(badEvidence.status).toBe(400);
    expect(badEvidence.body.code).toBe('validation_failed');
  });
});

describe('GET /api/food/customer/wallets/:restaurantId/disputes', () => {
  test('lists the customer\'s disputes for the restaurant only', async () => {
    const mine = disputeRow();
    const other = disputeRow({ id: 10, customer_id: OTHER_USER_ID });
    mockQuery.mockResolvedValueOnce({ rows: [mine, other], rowCount: 2 });

    const res = await request(buildCustomerApp()).get(`/api/food/customer/wallets/${RESTAURANT_ID}/disputes`);

    expect(res.status).toBe(200);
    expect(res.body.disputes).toHaveLength(2);
    expect(res.body.disputes[0]).toMatchObject({ id: '9', status: 'open' });
    // The SQL scopes to (restaurant_id, customer_id) — the DB never returns
    // another customer's disputes; the mock above only proves the shape.
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([RESTAURANT_ID, CUSTOMER_ID]);
  });
});

describe('GET /api/food/merchant/wallets/:restaurantId/disputes', () => {
  test('owner lists disputes for their restaurant', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurantAccessRow('owner')], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [disputeRow()], rowCount: 1 });

    const res = await request(buildMerchantApp()).get(`/api/food/merchant/wallets/${RESTAURANT_ID}/disputes`);

    expect(res.status).toBe(200);
    expect(res.body.disputes).toHaveLength(1);
    expect(res.body.disputes[0]).toMatchObject({ status: 'open' });
  });

  test('non-operator staff is forbidden', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [restaurantAccessRow('staff')], rowCount: 1 });

    const res = await request(buildMerchantApp({ id: STAFF_ID })).get(
      `/api/food/merchant/wallets/${RESTAURANT_ID}/disputes`
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  test('unknown restaurant is a 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(buildMerchantApp()).get('/api/food/merchant/wallets/9999/disputes');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('restaurant_not_found');
  });
});

describe('POST /api/food/merchant/wallets/:restaurantId/disputes/:disputeId/respond', () => {
  test('restaurant adds evidence and the dispute moves to under_review', async () => {
    const underReview = disputeRow({ status: 'under_review', restaurant_evidence: { statement: 'We refunded' } });
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurantAccessRow('manager')], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [disputeRow()], rowCount: 1 }) // SELECT dispute FOR UPDATE
      .mockResolvedValueOnce({ rows: [underReview], rowCount: 1 }); // UPDATE

    const res = await request(buildMerchantApp())
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/disputes/9/respond`)
      .send({ evidence: { statement: 'We refunded' } });

    expect(res.status).toBe(200);
    expect(res.body.dispute).toMatchObject({
      status: 'under_review',
      restaurantEvidence: { statement: 'We refunded' },
    });
  });

  test('404 when the dispute is not for this restaurant', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurantAccessRow('owner')], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(buildMerchantApp())
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/disputes/4242/respond`)
      .send({ evidence: {} });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('credit_dispute_not_found');
  });

  test('409 when the dispute is already resolved', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurantAccessRow('owner')], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [disputeRow({ status: 'resolved_deny' })], rowCount: 1 });

    const res = await request(buildMerchantApp())
      .post(`/api/food/merchant/wallets/${RESTAURANT_ID}/disputes/9/respond`)
      .send({ evidence: {} });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('credit_dispute_already_resolved');
  });
});

describe('POST /api/food/admin/wallets/disputes/:disputeId/resolve', () => {
  test('resolved_deny closes the dispute without touching the load request', async () => {
    const resolved = disputeRow({ status: 'resolved_deny', resolved_at: new Date().toISOString(), resolved_by: ADMIN_ID, resolution_note: 'No payment received' });
    mockQuery
      .mockResolvedValueOnce({ rows: [disputeRow()], rowCount: 1 }) // SELECT dispute FOR UPDATE
      .mockResolvedValueOnce({ rows: [resolved], rowCount: 1 }); // UPDATE dispute

    const res = await request(buildAdminApp())
      .post('/api/food/admin/wallets/disputes/9/resolve')
      .send({ outcome: 'resolved_deny', resolution_note: 'No payment received' });

    expect(res.status).toBe(200);
    expect(res.body.dispute).toMatchObject({ status: 'resolved_deny', resolutionNote: 'No payment received' });
    expect(res.body.requeued).toBe(false);
    const updateCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('UPDATE food_customer_wallet_load_requests')
    );
    expect(updateCalls).toHaveLength(0);
  });

  test('resolved_info_needed keeps the dispute open for more evidence', async () => {
    const resolved = disputeRow({ status: 'resolved_info_needed', resolved_at: new Date().toISOString() });
    mockQuery
      .mockResolvedValueOnce({ rows: [disputeRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [resolved], rowCount: 1 });

    const res = await request(buildAdminApp())
      .post('/api/food/admin/wallets/disputes/9/resolve')
      .send({ outcome: 'resolved_info_needed', resolutionNote: 'Please attach the transfer receipt' });

    expect(res.status).toBe(200);
    expect(res.body.dispute.status).toBe('resolved_info_needed');
    expect(res.body.requeued).toBe(false);
  });

  test('resolved_release re-queues the load request to pending WITHOUT posting credit (money fails closed)', async () => {
    const resolved = disputeRow({ status: 'resolved_release', resolved_at: new Date().toISOString(), resolved_by: ADMIN_ID });
    const requeuedRequest = loadRequestRow({ status: 'pending', cancelled_by_user_id: null, cancelled_at: null });
    mockQuery
      .mockResolvedValueOnce({ rows: [disputeRow()], rowCount: 1 }) // SELECT dispute FOR UPDATE
      .mockResolvedValueOnce({ rows: [resolved], rowCount: 1 }) // UPDATE dispute
      .mockResolvedValueOnce({ rows: [requeuedRequest], rowCount: 1 }); // UPDATE load request

    const res = await request(buildAdminApp())
      .post('/api/food/admin/wallets/disputes/9/resolve')
      .send({ outcome: 'resolved_release', resolution_note: 'Proof looks valid; restaurant to re-review' });

    expect(res.status).toBe(200);
    expect(res.body.dispute.status).toBe('resolved_release');
    expect(res.body.requeued).toBe(true);
    expect(res.body.requeuedLoadRequestStatus).toBe('pending');

    // The re-queue UPDATE must clear the cancellation markers (the maker-checker
    // status-consistency constraint requires pending requests to have no
    // cancelled/approved fields) and must never post ledger credit.
    const requeueCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE food_customer_wallet_load_requests')
    );
    expect(requeueCall).toBeDefined();
    const requeueSql = String(requeueCall[0]);
    expect(requeueSql).toContain("status = 'pending'");
    expect(requeueSql).toContain('cancelled_by_user_id = NULL');
    expect(requeueSql).toContain("AND status = 'cancelled'");

    const ledgerWrites = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO food_customer_wallet_ledger')
    );
    expect(ledgerWrites).toHaveLength(0);
  });

  test('400 on an invalid outcome', async () => {
    const res = await request(buildAdminApp())
      .post('/api/food/admin/wallets/disputes/9/resolve')
      .send({ outcome: 'resolved_maybe' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  test('404 when the dispute does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(buildAdminApp())
      .post('/api/food/admin/wallets/disputes/4242/resolve')
      .send({ outcome: 'resolved_deny' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('credit_dispute_not_found');
  });

  test('409 when the dispute is already resolved', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [disputeRow({ status: 'resolved_deny' })], rowCount: 1 });

    const res = await request(buildAdminApp())
      .post('/api/food/admin/wallets/disputes/9/resolve')
      .send({ outcome: 'resolved_release' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('credit_dispute_already_resolved');
  });
});
