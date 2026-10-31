'use strict';

// Real-database execution test for the NEWER affiliate payout core
// (server/controllers/affiliatePayoutsController.js runAffiliatePayout /
// processPayout), the only payout path left after the legacy route was
// retired. Unlike the mocked affiliate suites, every money gate here runs
// for real: W-9 + Didit on the users row, sanctions screening rows,
// the credit-rail feature flag + freeze table, the Stripe Connect account
// row, and the dual-approval threshold. Only the Stripe network boundary
// is mocked: the controller requires STRIPE_SECRET_KEY at load time and
// calls stripe.transfers.create, and no live Stripe key exists here.
//
// Explicit opt-in to the shared disposable synthetic database; never load .env.
jest.unmock('pg');
const databaseUrl = process.env.STATEMENT_TEST_DATABASE_URL;
const permitted = (() => {
  try {
    const u = new URL(databaseUrl);
    return ['postgres:', 'postgresql:'].includes(u.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
      && u.pathname === '/credit_statement_test';
  } catch { return false; }
})();
if (permitted) process.env.DATABASE_URL = databaseUrl;
const dbDescribe = permitted ? describe : describe.skip;
const crypto = require('crypto');

// Stripe is the only mocked boundary. The key is synthetic; the factory
// only answers transfers.create, which is the single Stripe call the core
// makes. Everything else (gates, ledger updates, audit row) runs for real.
process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic_affiliate_core';
const mockTransfersCreate = jest.fn();
jest.mock('stripe', () => () => ({ transfers: { create: mockTransfersCreate } }));

const pool = require('../db');
const { processPayout, runAffiliatePayout } = require('../controllers/affiliatePayoutsController');

test('affiliate payout core DB suite requires explicit synthetic disposable database opt-in', () => {
  expect(permitted).toBe(Boolean(databaseUrl && permitted));
});

dbDescribe('newer affiliate payout core against the real database', () => {
  const tag = crypto.randomBytes(8).toString('hex');

  beforeAll(async () => {
    // Credit-rail gate reads this flag; start from a known enabled state.
    await pool.query(`DELETE FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description) VALUES ('oxsteed_credit_enabled', true, 'synthetic core test')`
    );
  });

  afterEach(async () => {
    // Restore shared rail state no matter which gate test just ran.
    await pool.query(`UPDATE feature_flags SET is_enabled = true WHERE key = 'oxsteed_credit_enabled'`);
    await pool.query(`DELETE FROM oxsteed_credit_rail_freezes WHERE reason LIKE 'synthetic-core-%'`);
    mockTransfersCreate.mockClear();
  });

  afterAll(async () => {
    // Do not leak the enabled rail flag into later suites sharing this
    // database: statementSelfService and others assume the rail-off
    // backfill path unless they enable the rail themselves.
    await pool.query(`DELETE FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
  });

  function makeRes() {
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    return res;
  }

  async function makeUser({ role = 'helper', w9 = true, diditStatus = 'verified', diditVerifiedAt = new Date() } = {}) {
    const id = crypto.randomUUID();
    const label = `affcore-${tag}-${id.slice(0, 8)}`;
    const { rows: [u] } = await pool.query(
      `INSERT INTO users(id, email, password_hash, first_name, last_name, role, email_verified, is_active,
         w9_completed, didit_status, didit_verified_at)
       VALUES ($1, $2, 'synthetic-fixture', 'Synthetic', 'Core', $3, true, true, $4, $5, $6)
       RETURNING id`,
      [id, `${label}@example.test`, role, w9, diditStatus, diditVerifiedAt]
    );
    return u.id;
  }

  async function makeProgram(helperId) {
    const { rows: [p] } = await pool.query(
      `INSERT INTO affiliate_programs(helper_id, program_type, commission_rate, status)
       VALUES ($1, 'custom', 10, 'active') RETURNING id`,
      [helperId]
    );
    return p.id;
  }

  async function makePayout(programId, { total = 1000, fee = 0, net = null, status = 'pending' } = {}) {
    const { rows: [p] } = await pool.query(
      `INSERT INTO affiliate_payouts
         (affiliate_program_id, period_start, period_end, total_commission_cents,
          processor_fee_cents, net_payout_cents, commission_count, status, idempotency_key)
       VALUES ($1, '2026-01-01', '2026-02-01', $2, $3, $4, 1, $5, $6)
       RETURNING *`,
      [programId, total, fee, net, status, `affcore-${tag}-${crypto.randomUUID()}`]
    );
    return p;
  }

  async function makeConnect(userId, payoutsEnabled = true) {
    await pool.query(
      `INSERT INTO connect_accounts (user_id, stripe_account_id, payouts_enabled, charges_enabled)
       VALUES ($1, $2, $3, true)`,
      [userId, `acct_synth_${tag}_${crypto.randomBytes(4).toString('hex')}`, payoutsEnabled]
    );
  }

  async function clearScreening(userId) {
    await pool.query(
      `INSERT INTO oxsteed_credit_sanctions_screenings
         (subject_type, subject_id, provider, result, screened_at)
       VALUES ('customer', $1, 'manual_review', 'clear', NOW())`,
      [String(userId)]
    );
  }

  // A confirmed commission already attached to the payout, plus the
  // product/order rows its NOT NULL columns require, so the success path
  // can prove the paid flip.
  async function makeConfirmedCommission(programId, payoutId, customerId) {
    const { rows: [prod] } = await pool.query(
      `INSERT INTO marketplace_products(name) VALUES ($1) RETURNING id`,
      [`Synthetic core product ${tag}`]
    );
    const { rows: [order] } = await pool.query(
      `INSERT INTO marketplace_orders(customer_id, total_cents, subtotal_cents, status)
       VALUES ($1, 10000, 10000, 'paid') RETURNING id`,
      [customerId]
    );
    await pool.query(
      `INSERT INTO affiliate_commissions
         (order_id, affiliate_program_id, product_id, commission_cents, commission_rate,
          product_sale_amount_cents, status, payout_id)
       VALUES ($1, $2, $3, 1000, 10, 10000, 'confirmed', $4)`,
      [order.id, programId, prod.id, payoutId]
    );
  }

  async function payoutRow(id) {
    const { rows: [r] } = await pool.query('SELECT * FROM affiliate_payouts WHERE id = $1', [id]);
    return r;
  }

  // Ready owner: every gate passes. Amount 1000c is below the $500 dual
  // threshold, so processPayout must move money on this single approval.
  async function readySetup({ total = 1000 } = {}) {
    const adminId = await makeUser({ role: 'admin' });
    const ownerId = await makeUser({});
    const customerId = await makeUser({ role: 'customer' });
    const programId = await makeProgram(ownerId);
    const payout = await makePayout(programId, { total });
    await makeConfirmedCommission(programId, payout.id, customerId);
    await makeConnect(ownerId, true);
    await clearScreening(ownerId);
    return { adminId, ownerId, programId, payout };
  }

  function processReq(adminId, payoutId) {
    return { user: { id: adminId }, params: { payoutId }, ip: null, headers: {}, get: () => undefined };
  }

  test('processes a ready payout end to end: completed, transfer, paid commissions, audit row', async () => {
    const { adminId, programId, payout } = await readySetup();
    mockTransfersCreate.mockResolvedValue({ id: `tr_synth_${tag}` });

    const res = makeRes();
    const next = jest.fn();
    await processPayout(processReq(adminId, payout.id), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    const [transferArgs, transferOpts] = mockTransfersCreate.mock.calls[0];
    expect(transferArgs.amount).toBe(1000);
    expect(transferArgs.currency).toBe('usd');
    expect(transferArgs.transfer_group).toBe(`affiliate_payout_${payout.id}`);
    expect(transferOpts.idempotencyKey).toBe(`affiliate-payout:${payout.id}`);

    const done = await payoutRow(payout.id);
    expect(done.status).toBe('completed');
    expect(done.payout_method).toBe('stripe_connect_transfer');
    expect(done.payout_reference).toBe(`tr_synth_${tag}`);
    expect(done.payment_processor).toBe('stripe');
    expect(Number(done.net_payout_cents)).toBe(1000);
    expect(done.sent_at).not.toBeNull();
    expect(done.received_at).not.toBeNull();

    const { rows: [comm] } = await pool.query(
      'SELECT status FROM affiliate_commissions WHERE payout_id = $1', [payout.id]
    );
    expect(comm.status).toBe('paid');
    const { rows: [prog] } = await pool.query(
      'SELECT pending_cents, total_paid_cents FROM affiliate_programs WHERE id = $1', [programId]
    );
    expect(Number(prog.pending_cents)).toBe(0);
    expect(Number(prog.total_paid_cents)).toBe(1000);
    const { rows: [txn] } = await pool.query(
      'SELECT * FROM payout_transactions WHERE payout_id = $1', [payout.id]
    );
    expect(txn).toBeDefined();
    expect(txn.transaction_status).toBe('completed');
    expect(txn.external_transaction_id).toBe(`tr_synth_${tag}`);
    const { rows: [audit] } = await pool.query(
      `SELECT * FROM admin_audit_log WHERE action = 'affiliate_payout_processed' AND target_key = $1`,
      [String(payout.id)]
    );
    expect(audit).toBeDefined();
    expect(audit.admin_id).toBe(adminId);
  });

  test('above-threshold payout queues for dual approval and moves nothing', async () => {
    const { adminId, payout } = await readySetup({ total: 60000 });
    mockTransfersCreate.mockResolvedValue({ id: `tr_synth_${tag}_queued` });

    const res = makeRes();
    const next = jest.fn();
    await processPayout(processReq(adminId, payout.id), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(202);
    expect(res.body.code).toBe('money_movement_pending_approval');
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    expect((await payoutRow(payout.id)).status).toBe('pending');
    const { rows: [approval] } = await pool.query(
      `SELECT * FROM money_movement_approvals WHERE reference_key = $1`,
      [`affiliate-payout:${payout.id}`]
    );
    expect(approval).toBeDefined();
    expect(Number(approval.amount_cents)).toBe(60000);
  });

  test('missing W-9 fails closed without paying', async () => {
    const adminId = await makeUser({ role: 'admin' });
    const ownerId = await makeUser({ w9: false });
    const programId = await makeProgram(ownerId);
    const payout = await makePayout(programId);
    await makeConnect(ownerId, true);
    await clearScreening(ownerId);

    const next = jest.fn();
    await processPayout(processReq(adminId, payout.id), makeRes(), next);
    expect(next.mock.calls[0][0].code).toBe('affiliate_tax_identity_required');
    expect(next.mock.calls[0][0].status).toBe(403);
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    expect((await payoutRow(payout.id)).status).toBe('pending');
  });

  test('unverified Didit fails closed without paying', async () => {
    const adminId = await makeUser({ role: 'admin' });
    const ownerId = await makeUser({ diditStatus: 'pending', diditVerifiedAt: null });
    const programId = await makeProgram(ownerId);
    const payout = await makePayout(programId);
    await makeConnect(ownerId, true);
    await clearScreening(ownerId);

    const next = jest.fn();
    await processPayout(processReq(adminId, payout.id), makeRes(), next);
    expect(next.mock.calls[0][0].code).toBe('affiliate_tax_identity_required');
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    expect((await payoutRow(payout.id)).status).toBe('pending');
  });

  test('stale Didit verification (past the 2-year freshness window) fails closed', async () => {
    const adminId = await makeUser({ role: 'admin' });
    const stale = new Date();
    stale.setUTCFullYear(stale.getUTCFullYear() - 3);
    const ownerId = await makeUser({ diditStatus: 'verified', diditVerifiedAt: stale });
    const programId = await makeProgram(ownerId);
    const payout = await makePayout(programId);
    await makeConnect(ownerId, true);
    await clearScreening(ownerId);

    const next = jest.fn();
    await processPayout(processReq(adminId, payout.id), makeRes(), next);
    expect(next.mock.calls[0][0].code).toBe('affiliate_tax_identity_required');
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    expect((await payoutRow(payout.id)).status).toBe('pending');
  });

  test('sanctions hit (no screening row under manual_review) blocks with 403 and moves nothing', async () => {
    const adminId = await makeUser({ role: 'admin' });
    const ownerId = await makeUser({});
    const programId = await makeProgram(ownerId);
    const payout = await makePayout(programId);
    await makeConnect(ownerId, true);
    // Deliberately no screening row: manual_review screens every
    // unscreened subject as a hit, which must block the payout.

    const next = jest.fn();
    await processPayout(processReq(adminId, payout.id), makeRes(), next);
    expect(next.mock.calls[0][0].code).toBe('credit_sanctions_match');
    expect(next.mock.calls[0][0].status).toBe(403);
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    expect((await payoutRow(payout.id)).status).toBe('pending');
    const { rows: [hit] } = await pool.query(
      `SELECT * FROM oxsteed_credit_sanctions_screenings WHERE subject_type = 'customer' AND subject_id = $1`,
      [String(ownerId)]
    );
    expect(hit.result).toBe('hit');
  });

  test('credit rail disabled fails closed with 503 before claiming', async () => {
    const { adminId, payout } = await readySetup();
    mockTransfersCreate.mockResolvedValue({ id: `tr_synth_${tag}_railoff` });
    try {
      await pool.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'oxsteed_credit_enabled'`);
      const next = jest.fn();
      await processPayout(processReq(adminId, payout.id), makeRes(), next);
      expect(next.mock.calls[0][0].code).toBe('credit_rail_suspended');
      expect(next.mock.calls[0][0].status).toBe(503);
      expect(mockTransfersCreate).not.toHaveBeenCalled();
      expect((await payoutRow(payout.id)).status).toBe('pending');
    } finally {
      await pool.query(`UPDATE feature_flags SET is_enabled = true WHERE key = 'oxsteed_credit_enabled'`);
    }
  });

  test('credit rail frozen fails closed with 503 and moves nothing', async () => {
    const { adminId, payout } = await readySetup();
    mockTransfersCreate.mockResolvedValue({ id: `tr_synth_${tag}_frozen` });
    try {
      await pool.query(
        `INSERT INTO oxsteed_credit_rail_freezes (reason) VALUES ('synthetic-core-freeze')`
      );
      const next = jest.fn();
      await processPayout(processReq(adminId, payout.id), makeRes(), next);
      expect(next.mock.calls[0][0].code).toBe('credit_rail_frozen');
      expect(next.mock.calls[0][0].status).toBe(503);
      expect(mockTransfersCreate).not.toHaveBeenCalled();
      expect((await payoutRow(payout.id)).status).toBe('pending');
    } finally {
      await pool.query(`DELETE FROM oxsteed_credit_rail_freezes WHERE reason = 'synthetic-core-freeze'`);
    }
  });

  test('no payout account fails closed with 400, never auto-verifies', async () => {
    const adminId = await makeUser({ role: 'admin' });
    const ownerId = await makeUser({});
    const programId = await makeProgram(ownerId);
    const payout = await makePayout(programId);
    await clearScreening(ownerId);
    // Deliberately no connect_accounts row.

    const next = jest.fn();
    await processPayout(processReq(adminId, payout.id), makeRes(), next);
    expect(next.mock.calls[0][0].code).toBe('no_payout_account');
    expect(next.mock.calls[0][0].status).toBe(400);
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    expect((await payoutRow(payout.id)).status).toBe('pending');
  });

  test('connect account with payouts disabled fails closed with 400', async () => {
    const adminId = await makeUser({ role: 'admin' });
    const ownerId = await makeUser({});
    const programId = await makeProgram(ownerId);
    const payout = await makePayout(programId);
    await makeConnect(ownerId, false);
    await clearScreening(ownerId);

    const next = jest.fn();
    await processPayout(processReq(adminId, payout.id), makeRes(), next);
    expect(next.mock.calls[0][0].code).toBe('no_payout_account');
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    expect((await payoutRow(payout.id)).status).toBe('pending');
  });

  test('processing the same payout twice does not double-pay', async () => {
    const { adminId, payout } = await readySetup();
    mockTransfersCreate.mockResolvedValue({ id: `tr_synth_${tag}_once` });

    const res1 = makeRes();
    await processPayout(processReq(adminId, payout.id), res1, jest.fn());
    expect(res1.statusCode).toBe(200);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);

    const next = jest.fn();
    await processPayout(processReq(adminId, payout.id), makeRes(), next);
    expect(next.mock.calls[0][0].code).toBe('invalid_payout_state');
    expect(next.mock.calls[0][0].status).toBe(409);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    const done = await payoutRow(payout.id);
    expect(done.status).toBe('completed');
    expect(done.payout_reference).toBe(`tr_synth_${tag}_once`);
  });

  test('a payout stuck processing past the stale window can be re-run to completion', async () => {
    const { adminId, payout } = await readySetup();
    mockTransfersCreate.mockResolvedValue({ id: `tr_synth_${tag}_stale` });
    // Simulate a crash after claim: processing, untouched for 11 minutes
    // (the stale window is 10). The re-run must use the canonical
    // per-payout Stripe idempotency key, so Stripe dedupes if the first
    // attempt actually reached it.
    await pool.query(
      `UPDATE affiliate_payouts SET status = 'processing', updated_at = NOW() - INTERVAL '11 minutes' WHERE id = $1`,
      [payout.id]
    );

    const res = makeRes();
    const next = jest.fn();
    await processPayout(processReq(adminId, payout.id), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(mockTransfersCreate.mock.calls[0][1].idempotencyKey).toBe(`affiliate-payout:${payout.id}`);
    expect((await payoutRow(payout.id)).status).toBe('completed');
  });

  test('unknown payout 404s without touching Stripe', async () => {
    const adminId = await makeUser({ role: 'admin' });
    const next = jest.fn();
    await processPayout(processReq(adminId, 999999999), makeRes(), next);
    expect(next.mock.calls[0][0].code).toBe('payout_not_found');
    expect(next.mock.calls[0][0].status).toBe(404);
    expect(mockTransfersCreate).not.toHaveBeenCalled();
  });

  test('non-positive payable amount fails closed in the core (dual-approval executor path)', async () => {
    const adminId = await makeUser({ role: 'admin' });
    const ownerId = await makeUser({});
    const programId = await makeProgram(ownerId);
    const payout = await makePayout(programId, { total: 0 });
    await makeConnect(ownerId, true);
    await clearScreening(ownerId);

    // Direct core entry point, as the dual-approval executor calls it:
    // skipDualApproval bypasses the queue but must still refuse a zero
    // amount before any claim or transfer.
    await expect(
      runAffiliatePayout({ payoutId: payout.id, adminId, req: processReq(adminId, payout.id), skipDualApproval: true })
    ).rejects.toMatchObject({ code: 'invalid_payout_amount', status: 422 });
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    expect((await payoutRow(payout.id)).status).toBe('pending');
  });
});
