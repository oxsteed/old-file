'use strict';

// Group 13 Slice 4f acceptance: Fund approved use (676-680).
// 676/678 are EXISTS re-checks (evidence in docs/persona-roadmap/group13.md);
// 677 stays PARTIAL and HELD (no approval step for business-funded top-ups
// — see the tracker row; no decision is logged for it, no step is built).
// This suite proves live: 679 (the top-up record exposes every status the
// top-up-specific pending/posted explanation renders, and the failed list
// is the failed section's data source) and 680 (retry on the failed record
// — a new attempt through the existing creation path, linked to the
// original, replayed instead of double-charged, owner/funder-only).
// Runs against a dedicated fresh database (credit_statement_test_g13f) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// Stripe is stubbed at the module level: the fake PaymentIntent factory
// mints a distinct intent per creation, so a second create call is
// observable — the no-double-charge proof counts creations, not rows.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const mockStripeState = { count: 0, created: [] };
const mockPaymentIntentsCreate = jest.fn(async () => {
  mockStripeState.count += 1;
  const intent = { id: `pi_test_${mockStripeState.count}`, client_secret: `cs_test_${mockStripeState.count}` };
  mockStripeState.created.push(intent);
  return intent;
});
const mockPaymentIntentsRetrieve = jest.fn(async (id) => {
  const found = mockStripeState.created.find((intent) => intent.id === id);
  return found || { id, client_secret: `cs_test_${id}` };
});
const mockPaymentIntentsCancel = jest.fn(async (id) => ({ id, status: 'canceled' }));
const mockStripeClient = {
  paymentIntents: {
    create: mockPaymentIntentsCreate,
    retrieve: mockPaymentIntentsRetrieve,
    cancel: mockPaymentIntentsCancel,
  },
};
jest.mock('stripe', () => jest.fn(() => mockStripeClient));

const dbUrl = process.env.GROUP13_SLICE4F_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g13f') {
    throw new Error('Group 13 Slice 4f DB tests require the loopback credit_statement_test_g13f database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.setTimeout(60000);

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 13 Slice 4f: fund approved use (676-680)', () => {
  let pool;
  let creditCtrl;
  let creditService;
  let topupCtrl;
  let topupService;
  let app;
  let admin;
  let treasuryId;

  beforeAll(async () => {
    pool = require('../db');
    creditService = require('../services/oxsteedCreditService');
    creditCtrl = require('../controllers/oxsteedCreditController');
    topupCtrl = require('../controllers/oxsteedCreditTopupController');
    topupService = require('../services/oxsteedCreditTopupService');
    const { authenticate } = require('../middleware/auth');
    app = express();
    app.use(express.json());
    app.post('/api/oxsteed-credit/topups', authenticate, topupCtrl.createTopup);
    app.get('/api/oxsteed-credit/topups', authenticate, topupCtrl.listMyTopups);
    app.get('/api/oxsteed-credit/topups/:id', authenticate, topupCtrl.getTopup);
    app.post('/api/oxsteed-credit/topups/:id/retry', authenticate, topupCtrl.retryTopup);
    app.get('/api/oxsteed-credit/transactions/:transactionId', authenticate, creditCtrl.getMyTransaction);
    app.post('/api/businesses/:businessId/credit-topups', authenticate, topupCtrl.createBusinessTopup);
    app.get('/api/businesses/:businessId/credit-topups/:topupId', authenticate, topupCtrl.getBusinessTopup);
    app.post('/api/businesses/:businessId/credit-topups/:topupId/retry', authenticate, topupCtrl.retryBusinessTopup);
    app.use(require('../middleware/errorHandler').errorHandler);

    admin = await makeUser('super_admin');
    // R-3: top-up settlement posts as this service admin (migration 487
    // requires an admin actor with a user id and a reason). Without it
    // the webhook completion path — used by the 678 re-check — cannot
    // post the load on a migrated database.
    process.env.OXSTEED_CREDIT_SERVICE_ADMIN_ID = admin.id;
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', true, 'Group 13 Slice 4f test')
       ON CONFLICT (key) DO UPDATE SET is_enabled = true`,
    );
    treasuryId = await ensureCreditAccount({ accountType: 'platform_treasury' });
  });

  afterAll(async () => {
    delete process.env.OXSTEED_CREDIT_SERVICE_ADMIN_ID;
    if (pool) {
      await pool.query(`DELETE FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
      await pool.end();
    }
  });

  async function makeUser(role = 'customer') {
    const id = crypto.randomUUID();
    const email = `t${id}@example.invalid`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, totp_enabled)
       VALUES ($1, $2, 'x', 'Test', 'Fixture', $3, TRUE, TRUE, TRUE)`,
      [id, email, role],
    );
    return { id, email, role };
  }

  async function ensureCreditAccount({ accountType, customerId = null, partnerId: pid = null }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const account = await creditService.ensureAccount(client, {
        accountType, customerId, partnerId: pid, currencyCode: 'USD',
      });
      await client.query('COMMIT');
      return account.id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Compliance-gated money paths require a verified identity tier and a
  // fresh 'clear' sanctions screening (see the 4e suite's verifyCustomer).
  async function verifyCustomer(user) {
    await pool.query(
      `INSERT INTO oxsteed_credit_identity_verifications (customer_id, requested_tier, tier, status, expires_at)
       SELECT $1, 1, 1, 'verified', NOW() + INTERVAL '1 year'
        WHERE NOT EXISTS (
          SELECT 1 FROM oxsteed_credit_identity_verifications
           WHERE customer_id = $1 AND status = 'verified'
        )`,
      [user.id],
    );
    await pool.query(
      `INSERT INTO oxsteed_credit_sanctions_screenings (subject_type, subject_id, provider, result, payload_hash)
       VALUES ('customer', $1, 'manual_review', 'clear', $2) ON CONFLICT DO NOTHING`,
      [user.id, `g13f-sanctions-${user.id}`],
    );
  }

  const tokenFor = (user) => require('../middleware/auth').generateTokens(user).accessToken;
  const getAs = (user, path) => request(app).get(path).set('Authorization', `Bearer ${tokenFor(user)}`);
  const postAs = (user, path) => request(app).post(path).set('Authorization', `Bearer ${tokenFor(user)}`);

  async function makeBusiness({ owner, member }) {
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active)
       VALUES ($1, 'Fixture Business', FALSE, TRUE) RETURNING id`,
      [owner.id],
    );
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'representative', $4, 'active', NOW())`,
      [business.id, owner.id, member.id, member.email],
    );
    return business;
  }

  async function createTopupAs(user, amountCents = 5000, keySuffix = '') {
    await verifyCustomer(user);
    const res = await postAs(user, '/api/oxsteed-credit/topups')
      .set('Idempotency-Key', `g13f-topup-${user.id}-${amountCents}${keySuffix}`)
      .send({ amountCents, currencyCode: 'USD' });
    expect(res.status).toBe(201);
    expect(res.body.topup).toMatchObject({ amountCents, currencyCode: 'USD', status: 'pending' });
    expect(res.body.clientSecret).toMatch(/^cs_test_/);
    return res.body.topup;
  }

  async function markTopupStatus(topupId, status) {
    await pool.query(
      `UPDATE oxsteed_credit_topups SET status = $2, updated_at = NOW() WHERE id = $1`,
      [topupId, status],
    );
  }

  async function topupRow(topupId) {
    const { rows: [row] } = await pool.query(
      `SELECT * FROM oxsteed_credit_topups WHERE id = $1`,
      [topupId],
    );
    return row;
  }

  test('676 re-check: a business funds a named member with a required reason, funder recorded', async () => {
    const funder = await makeUser();
    const member = await makeUser();
    const business = await makeBusiness({ owner: funder, member });
    await verifyCustomer(member);

    const res = await postAs(funder, `/api/businesses/${business.id}/credit-topups`)
      .set('Idempotency-Key', `g13f-676-${business.id}-${member.id}`)
      .send({ memberId: member.id, reason: 'Quarterly tools allowance.', amountCents: 5000, currencyCode: 'USD' });
    expect(res.status).toBe(201);
    expect(res.body.topup).toMatchObject({
      amountCents: 5000,
      currencyCode: 'USD',
      status: 'pending',
      recipientCustomerId: member.id,
      fundedByUserId: funder.id,
      fundedByBusinessId: String(business.id),
      fundingReason: 'Quarterly tools allowance.',
    });

    const row = await topupRow(res.body.topup.id);
    expect(String(row.funded_by_user_id)).toBe(funder.id);
    expect(Number(row.funded_by_business_id)).toBe(Number(business.id));
    expect(row.funding_reason).toBe('Quarterly tools allowance.');

    // No approval step gates the request: it is pending immediately, and
    // neither the response nor the row carries any approval status.
    // (677 stays PARTIAL/HELD — see the tracker row.)
    expect(res.body.topup.approvalStatus).toBeUndefined();
    expect(res.body.topup.approval).toBeUndefined();

    const noReason = await postAs(funder, `/api/businesses/${business.id}/credit-topups`)
      .set('Idempotency-Key', `g13f-676-noreason-${business.id}`)
      .send({ memberId: member.id, amountCents: 5000, currencyCode: 'USD' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe('credit_topup_reason_required');
  });

  test('678 re-check: a completed top-up is readable and its load posts a receipted ledger transaction', async () => {
    const user = await makeUser();
    const topup = await createTopupAs(user, 5000, '-678');
    const row = await topupRow(topup.id);

    const completed = await topupService.completeCreditTopupFromWebhook({
      paymentIntentId: row.stripe_payment_intent_id,
      providerEvidence: { amountCents: 5000, currency: 'usd' },
    });
    expect(completed.outcome).toBe('completed');
    expect(String(completed.topupId)).toBe(String(topup.id));

    const read = await getAs(user, `/api/oxsteed-credit/topups/${topup.id}`);
    expect(read.status).toBe(200);
    expect(read.body.topup).toMatchObject({ id: String(topup.id), amountCents: 5000, status: 'completed' });

    const done = await topupRow(topup.id);
    expect(done.journal_transaction_id).toBeTruthy();
    const receipt = await getAs(user, `/api/oxsteed-credit/transactions/${done.journal_transaction_id}`);
    expect(receipt.status).toBe(200);
    expect(JSON.stringify(receipt.body)).toContain(String(done.journal_transaction_id));
  });

  test('679: the record exposes every status the top-up explanation renders, and failed rows list', async () => {
    const user = await makeUser();
    const pending = await createTopupAs(user, 5000, '-679pending');
    const failed = await createTopupAs(user, 2500, '-679failed');
    await markTopupStatus(failed.id, 'failed');
    const attention = await createTopupAs(user, 3000, '-679attention');
    await markTopupStatus(attention.id, 'requires_attention');

    for (const [topup, status] of [[pending, 'pending'], [failed, 'failed'], [attention, 'requires_attention']]) {
      const read = await getAs(user, `/api/oxsteed-credit/topups/${topup.id}`);
      expect(read.status).toBe(200);
      // The facts the per-status explanation renders: status, amount,
      // expiry (when pending value lands / expires), and request date.
      expect(read.body.topup).toMatchObject({ id: String(topup.id), status });
      expect(typeof read.body.topup.amountCents).toBe('number');
      expect(read.body.topup.expiresAt).toBeTruthy();
      expect(read.body.topup.createdAt).toBeTruthy();
    }

    // The failed section on the Credit page reads this list.
    const failedList = await getAs(user, '/api/oxsteed-credit/topups?status=failed');
    expect(failedList.status).toBe(200);
    expect(failedList.body.topups.map((row) => row.id)).toContain(String(failed.id));
    expect(failedList.body.topups.map((row) => row.id)).not.toContain(String(pending.id));
  });

  test('680: retry creates a new linked attempt; a repeat retry replays it and creates no second Stripe intent', async () => {
    const user = await makeUser();
    const original = await createTopupAs(user, 5000, '-680');
    await markTopupStatus(original.id, 'failed');
    const createsBefore = mockPaymentIntentsCreate.mock.calls.length;

    const first = await postAs(user, `/api/oxsteed-credit/topups/${original.id}/retry`)
      .set('Idempotency-Key', `g13f-680-retry-1-${original.id}`)
      .send({});
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);
    expect(first.body.topup).toMatchObject({
      amountCents: 5000,
      currencyCode: 'USD',
      status: 'pending',
      retriedFromTopupId: String(original.id),
    });
    expect(first.body.topup.id).not.toBe(String(original.id));
    expect(first.body.clientSecret).toMatch(/^cs_test_/);
    expect(mockPaymentIntentsCreate.mock.calls.length).toBe(createsBefore + 1);

    // The failed original is untouched and now carries its retry link.
    const originalRow = await topupRow(original.id);
    expect(originalRow.status).toBe('failed');
    const originalRead = await getAs(user, `/api/oxsteed-credit/topups/${original.id}`);
    expect(originalRead.body.topup.retryTopupId).toBe(String(first.body.topup.id));
    const childRow = await topupRow(first.body.topup.id);
    expect(String(childRow.retried_from_topup_id)).toBe(String(original.id));

    const { rows: [audit] } = await pool.query(
      `SELECT * FROM oxsteed_credit_audit_events
        WHERE action_type = 'credit.topup.retried' AND resource_id = $1`,
      [String(first.body.topup.id)],
    );
    expect(audit).toBeTruthy();

    // A second retry with a fresh key replays the same child — no new
    // row, no second Stripe PaymentIntent, no second charge.
    const second = await postAs(user, `/api/oxsteed-credit/topups/${original.id}/retry`)
      .set('Idempotency-Key', `g13f-680-retry-2-${original.id}`)
      .send({});
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.topup.id).toBe(String(first.body.topup.id));
    expect(mockPaymentIntentsCreate.mock.calls.length).toBe(createsBefore + 1);
    const { rows: [countRow] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM oxsteed_credit_topups WHERE retried_from_topup_id = $1`,
      [original.id],
    );
    expect(countRow.n).toBe(1);
  });

  test('680: a failed child is retried from the child, forming a chain', async () => {
    const user = await makeUser();
    const original = await createTopupAs(user, 5000, '-680chain');
    await markTopupStatus(original.id, 'failed');

    const first = await postAs(user, `/api/oxsteed-credit/topups/${original.id}/retry`)
      .set('Idempotency-Key', `g13f-680-chain-1-${original.id}`)
      .send({});
    expect(first.status).toBe(201);
    await markTopupStatus(first.body.topup.id, 'failed');

    const second = await postAs(user, `/api/oxsteed-credit/topups/${first.body.topup.id}/retry`)
      .set('Idempotency-Key', `g13f-680-chain-2-${first.body.topup.id}`)
      .send({});
    expect(second.status).toBe(201);
    expect(second.body.topup).toMatchObject({
      status: 'pending',
      retriedFromTopupId: String(first.body.topup.id),
    });
    expect(second.body.topup.id).not.toBe(String(first.body.topup.id));
    const childRead = await getAs(user, `/api/oxsteed-credit/topups/${first.body.topup.id}`);
    expect(childRead.body.topup.retryTopupId).toBe(String(second.body.topup.id));
  });

  test('680: only failed top-ups retry; requires_attention never retries', async () => {
    const user = await makeUser();
    const pending = await createTopupAs(user, 5000, '-680pending');
    const pendingRetry = await postAs(user, `/api/oxsteed-credit/topups/${pending.id}/retry`)
      .set('Idempotency-Key', `g13f-680-pending-${pending.id}`)
      .send({});
    expect(pendingRetry.status).toBe(409);
    expect(pendingRetry.body.code).toBe('credit_topup_state_invalid');

    const attention = await createTopupAs(user, 5000, '-680attention');
    await markTopupStatus(attention.id, 'requires_attention');
    const attentionRetry = await postAs(user, `/api/oxsteed-credit/topups/${attention.id}/retry`)
      .set('Idempotency-Key', `g13f-680-attention-${attention.id}`)
      .send({});
    // Money may already have moved at Stripe for this record; a retry
    // could double-charge, so it stays a human-review state.
    expect(attentionRetry.status).toBe(409);
    expect(attentionRetry.body.code).toBe('credit_topup_state_invalid');
    const { rows: [row] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM oxsteed_credit_topups WHERE retried_from_topup_id = $1`,
      [attention.id],
    );
    expect(row.n).toBe(0);
  });

  test('680: a non-owner cannot retry another customer top-up, and cannot read it', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const original = await createTopupAs(owner, 5000, '-680owner');
    await markTopupStatus(original.id, 'failed');

    const retry = await postAs(stranger, `/api/oxsteed-credit/topups/${original.id}/retry`)
      .set('Idempotency-Key', `g13f-680-stranger-${original.id}`)
      .send({});
    expect(retry.status).toBe(404);
    expect(retry.body.code).toBe('credit_topup_not_found');

    const read = await getAs(stranger, `/api/oxsteed-credit/topups/${original.id}`);
    expect(read.status).toBe(404);
    const { rows: [row] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM oxsteed_credit_topups WHERE retried_from_topup_id = $1`,
      [original.id],
    );
    expect(row.n).toBe(0);
  });

  test('680: the recipient cannot retry a business-funded top-up as self-service; the funder retries it', async () => {
    const funder = await makeUser();
    const member = await makeUser();
    const outsider = await makeUser();
    const business = await makeBusiness({ owner: funder, member });
    await verifyCustomer(member);

    const created = await postAs(funder, `/api/businesses/${business.id}/credit-topups`)
      .set('Idempotency-Key', `g13f-680-biz-${business.id}-${member.id}`)
      .send({ memberId: member.id, reason: 'Quarterly tools allowance.', amountCents: 5000, currencyCode: 'USD' });
    expect(created.status).toBe(201);
    await markTopupStatus(created.body.topup.id, 'failed');
    const createsBefore = mockPaymentIntentsCreate.mock.calls.length;

    const recipientRetry = await postAs(member, `/api/oxsteed-credit/topups/${created.body.topup.id}/retry`)
      .set('Idempotency-Key', `g13f-680-biz-recipient-${created.body.topup.id}`)
      .send({});
    expect(recipientRetry.status).toBe(403);
    expect(recipientRetry.body.code).toBe('credit_topup_retry_funder_required');

    const outsiderRetry = await postAs(outsider, `/api/businesses/${business.id}/credit-topups/${created.body.topup.id}/retry`)
      .set('Idempotency-Key', `g13f-680-biz-outsider-${created.body.topup.id}`)
      .send({});
    expect(outsiderRetry.status).toBe(403);

    const funderRetry = await postAs(funder, `/api/businesses/${business.id}/credit-topups/${created.body.topup.id}/retry`)
      .set('Idempotency-Key', `g13f-680-biz-funder-${created.body.topup.id}`)
      .send({});
    expect(funderRetry.status).toBe(201);
    expect(funderRetry.body.replayed).toBe(false);
    expect(funderRetry.body.topup).toMatchObject({
      amountCents: 5000,
      status: 'pending',
      retriedFromTopupId: String(created.body.topup.id),
      fundedByUserId: funder.id,
      fundedByBusinessId: String(business.id),
      fundingReason: 'Quarterly tools allowance.',
      recipientCustomerId: member.id,
    });
    expect(mockPaymentIntentsCreate.mock.calls.length).toBe(createsBefore + 1);

    const repeat = await postAs(funder, `/api/businesses/${business.id}/credit-topups/${created.body.topup.id}/retry`)
      .set('Idempotency-Key', `g13f-680-biz-funder-2-${created.body.topup.id}`)
      .send({});
    expect(repeat.status).toBe(200);
    expect(repeat.body.replayed).toBe(true);
    expect(repeat.body.topup.id).toBe(String(funderRetry.body.topup.id));
    expect(mockPaymentIntentsCreate.mock.calls.length).toBe(createsBefore + 1);

    const businessRead = await getAs(funder, `/api/businesses/${business.id}/credit-topups/${created.body.topup.id}`);
    expect(businessRead.status).toBe(200);
    expect(businessRead.body.topup.retryTopupId).toBe(String(funderRetry.body.topup.id));
  });

  test('680: retry fails closed when the credit rail is off', async () => {
    const user = await makeUser();
    const original = await createTopupAs(user, 5000, '-680rail');
    await markTopupStatus(original.id, 'failed');
    await pool.query(
      `UPDATE feature_flags SET is_enabled = false WHERE key = 'oxsteed_credit_enabled'`,
    );
    try {
      const retry = await postAs(user, `/api/oxsteed-credit/topups/${original.id}/retry`)
        .set('Idempotency-Key', `g13f-680-rail-${original.id}`)
        .send({});
      expect(retry.status).toBe(503);
      const { rows: [row] } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM oxsteed_credit_topups WHERE retried_from_topup_id = $1`,
        [original.id],
      );
      expect(row.n).toBe(0);
    } finally {
      await pool.query(
        `UPDATE feature_flags SET is_enabled = true WHERE key = 'oxsteed_credit_enabled'`,
      );
    }
  });
});
