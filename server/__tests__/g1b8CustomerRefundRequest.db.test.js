'use strict';

// Group 1 checkpoint 2 (G1-B8): customer refund request + status.
//
// A plain customer (the job owner, no managed business) files a refund
// request on their own job and reads its status. The request queues in
// the existing Money Approvals flow as a `job_refund` movement
// (forceQueue): nothing moves at request time, one open request per job
// (409 on a duplicate, D-30 pattern), and the requester can never
// approve or execute their own refund.
//
// Runs against a dedicated fresh database (credit_statement_test_g1ckpt2)
// so checkpoint fixtures never pollute the shared credit_statement_test DB.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.G1_CKPT2_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g1ckpt2') {
    throw new Error('Group 1 checkpoint 2 DB tests require the loopback credit_statement_test_g1ckpt2 database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: 'customer',
      email: req.get('x-test-email') || `g1ckpt2-${id}@example.invalid`,
      email_verified: true,
    };
    return next();
  };
  return {
    authenticate,
    authenticateIfPresent: (req, res, next) => (
      req.get('x-test-user') ? authenticate(req, res, next) : next()
    ),
  };
});

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 1 checkpoint 2: customer refund request + status (G1-B8)', () => {
  let db;
  let app;
  let owner;
  let helper;
  let stranger;
  let admin;
  let jobA;
  let jobB;
  let jobC;
  let jobD;
  let payA;
  let payB;
  let payD;
  let approvalD;

  async function addUser() {
    const id = randomUUID();
    const email = `g1ckpt2-${id}@example.invalid`;
    const { rows: [row] } = await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed, didit_status, didit_verified_at)
       VALUES ($1, $2, 'x', 'Checkpoint', 'Fixture', 'customer', 'customer', TRUE, TRUE, TRUE, 'pending', NULL)
       RETURNING id`,
      [id, email],
    );
    return row;
  }

  async function addJob(clientId, title) {
    const id = randomUUID();
    const { rows: [row] } = await db.query(
      `INSERT INTO jobs (id, client_id, title, description, status)
       VALUES ($1, $2, $3, 'Test job for customer refund request.', 'completed')
       RETURNING id`,
      [id, clientId, title],
    );
    return row;
  }

  async function addPayment(jobId, amount) {
    const { rows: [row] } = await db.query(
      `INSERT INTO payments (job_id, payer_id, payee_id, amount, platform_fee, currency, stripe_payment_intent_id, status)
       VALUES ($1, $2, $3, $4, 0, 'USD', $5, 'captured')
       RETURNING id`,
      [jobId, owner.id, helper.id, amount, `pi_g1ckpt2_${randomUUID().replace(/-/g, '')}`],
    );
    return row;
  }

  beforeAll(async () => {
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/jobs', require('../routes/jobs'));
    app.use(require('../middleware/errorHandler').errorHandler);

    owner = await addUser();
    helper = await addUser();
    stranger = await addUser();
    admin = await addUser();
    jobA = await addJob(owner.id, 'G1B8 Job A');
    jobB = await addJob(owner.id, 'G1B8 Job B');
    jobC = await addJob(owner.id, 'G1B8 Job C');
    jobD = await addJob(owner.id, 'G1B8 Job D');
    payA = await addPayment(jobA.id, 100.00);
    payB = await addPayment(jobB.id, 50.00);
    payD = await addPayment(jobD.id, 80.00);
  });

  afterAll(async () => {
    const clean = async (sql, params) => { try { await db.query(sql, params); } catch (_) {} };
    const jobIds = [jobA?.id, jobB?.id, jobC?.id, jobD?.id].filter(Boolean);
    for (const jobId of jobIds) {
      await clean(`DELETE FROM money_movement_approvals WHERE payload ->> 'jobId' = $1`, [String(jobId)]);
    }
    await clean(`DELETE FROM payments WHERE id = ANY($1::int[])`, [[payA?.id, payB?.id, payD?.id].filter(Boolean)]);
    await clean(`DELETE FROM jobs WHERE id = ANY($1::uuid[])`, [jobIds]);
    await clean(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[owner?.id, helper?.id, stranger?.id, admin?.id].filter(Boolean)]);
    await db?.end();
  });

  test('owner queues a refund for admin approval; nothing moves', async () => {
    const res = await request(app)
      .post(`/api/jobs/${jobA.id}/refund-request`)
      .set('x-test-user', owner.id)
      .send({ amount_cents: 2500, reason: 'Work was not completed.' });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending');
    expect(Number(res.body.amountCents)).toBe(2500);
    expect(res.body.approvalId).toBeTruthy();
    const { rows } = await db.query(
      `SELECT movement_type, status, requested_by, payload FROM money_movement_approvals WHERE id = $1`,
      [res.body.approvalId]);
    expect(rows.length).toBe(1);
    expect(rows[0].movement_type).toBe('job_refund');
    expect(rows[0].status).toBe('pending');
    expect(String(rows[0].requested_by)).toBe(String(owner.id));
    // The queued row carries everything the existing job_refund
    // executor needs on approval: payment, amount, reason, maker.
    expect(Number(rows[0].payload.paymentId)).toBe(payA.id);
    expect(rows[0].payload.jobId).toBe(String(jobA.id));
    expect(rows[0].payload.customerRefund).toBe(true);
    // No refund attempt was reserved or executed at request time.
    const attempts = await db.query(
      `SELECT 1 FROM payment_refund_attempts WHERE payment_id = $1 LIMIT 1`, [payA.id]);
    expect(attempts.rows.length).toBe(0);
  });

  test('duplicate open request for the same job is a 409', async () => {
    const res = await request(app)
      .post(`/api/jobs/${jobA.id}/refund-request`)
      .set('x-test-user', owner.id)
      .send({ amount_cents: 1000, reason: 'Second request while one is open.' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('customer_refund_already_open');
  });

  test('stranger cannot request or list', async () => {
    const post = await request(app)
      .post(`/api/jobs/${jobA.id}/refund-request`)
      .set('x-test-user', stranger.id)
      .send({ amount_cents: 100, reason: 'Not my job.' });
    expect(post.status).toBe(403);
    const get = await request(app)
      .get(`/api/jobs/${jobA.id}/refund-requests`)
      .set('x-test-user', stranger.id);
    expect(get.status).toBe(403);
  });

  test('owner lists the queued request with its status', async () => {
    const res = await request(app)
      .get(`/api/jobs/${jobA.id}/refund-requests`)
      .set('x-test-user', owner.id);
    expect(res.status).toBe(200);
    expect(res.body.requests.length).toBe(1);
    expect(res.body.requests[0].status).toBe('pending');
    expect(Number(res.body.requests[0].amountCents)).toBe(2500);
    expect(res.body.requests[0].reason).toBe('Work was not completed.');
  });

  test('amount above the captured total is refused', async () => {
    const res = await request(app)
      .post(`/api/jobs/${jobB.id}/refund-request`)
      .set('x-test-user', owner.id)
      .send({ amount_cents: 5001, reason: 'Too much.' });
    expect(res.status).toBe(400);
  });

  test('job with no refundable payment is a 404', async () => {
    const res = await request(app)
      .post(`/api/jobs/${jobC.id}/refund-request`)
      .set('x-test-user', owner.id)
      .send({ fullRefund: true, reason: 'Nothing was ever paid.' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('refundable_payment_not_found');
  });

  test('a reason is required', async () => {
    const res = await request(app)
      .post(`/api/jobs/${jobD.id}/refund-request`)
      .set('x-test-user', owner.id)
      .send({ fullRefund: true, reason: '   ' });
    expect(res.status).toBe(400);
  });

  test('full refund queues, requester cannot approve it, admin rejects it', async () => {
    const { decideMoneyMovementApproval } = require('../services/dualApprovalService');
    const filed = await request(app)
      .post(`/api/jobs/${jobD.id}/refund-request`)
      .set('x-test-user', owner.id)
      .send({ fullRefund: true, reason: 'Full refund requested.' });
    expect(filed.status).toBe(202);
    expect(Number(filed.body.amountCents)).toBe(8000);
    approvalD = filed.body.approvalId;
    // Maker-checker: the requester can never approve their own refund.
    await expect(decideMoneyMovementApproval({
      approvalId: approvalD, approverId: owner.id, decision: 'approve',
    })).rejects.toMatchObject({ status: 403, code: 'money_movement_self_approval' });
    const stillPending = await db.query(
      `SELECT status FROM money_movement_approvals WHERE id = $1`, [approvalD]);
    expect(stillPending.rows[0].status).toBe('pending');
    // A different approver rejects it through the existing approval leg.
    const rejected = await decideMoneyMovementApproval({
      approvalId: approvalD, approverId: admin.id, decision: 'reject', reason: 'Not eligible.',
    });
    expect(rejected.approval.status).toBe('rejected');
    expect(rejected.executed).toBe(false);
    // The customer sees the decided status.
    const list = await request(app)
      .get(`/api/jobs/${jobD.id}/refund-requests`)
      .set('x-test-user', owner.id);
    expect(list.status).toBe(200);
    expect(list.body.requests[0].status).toBe('rejected');
  });

  test('a rejected request can be re-filed as a new approval row', async () => {
    const res = await request(app)
      .post(`/api/jobs/${jobD.id}/refund-request`)
      .set('x-test-user', owner.id)
      .send({ fullRefund: true, reason: 'Re-filing after rejection.' });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending');
    expect(String(res.body.approvalId)).not.toBe(String(approvalD));
  });
});
