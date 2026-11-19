// PR804 Track C — G-20: business-initiated refund requests.
// An owner/manager holding `refunds.request` queues a `job_refund` movement
// for platform-admin approval; the requester can never execute the refund
// (forceQueue: the approval row is created even below the dual-approval
// threshold, and no refund attempt is reserved or executed at request time).
// DB-backed; runs only against credit_statement_test_pr804_c.
'use strict';

const TEST_DB_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
if (!TEST_DB_URL.includes('/credit_statement_test_pr804_c')) {
  throw new Error('pr804TrackCRefundRequest requires STATEMENT_TEST_DATABASE_URL for credit_statement_test_pr804_c');
}
process.env.DATABASE_URL = TEST_DB_URL;

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const pool = require('../db');
const { requestBusinessRefund, listBusinessRefundRequests } = require('../services/businessRefundRequestService');

const suffix = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

let owner;
let manager;
let rep;
let repRequester;
let outsider;
let businessId;
let jobId;
let paymentId;

async function makeUser(role) {
  const s = suffix();
  const { rows: [row] } = await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role)
     VALUES ($1, 'x', 'Track', 'C', $2) RETURNING id`,
    [`g20-${role}-${s}@example.test`, role]);
  return row;
}

async function addMember(userId, role) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO business_members (business_id, member_id, role, status, owner_id, invite_email)
     VALUES ($1, $2, $3, 'active', $4, $5) RETURNING id`,
    [businessId, userId, role, owner.id, `g20-${suffix()}@example.test`]);
  return row.id;
}

async function addOverride(membershipId, code, effect = 'allow') {
  await pool.query(
    `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect)
     SELECT $1, p.id, $3 FROM team_permissions p WHERE p.code = $2
     ON CONFLICT DO NOTHING`,
    [membershipId, code, effect]);
}

beforeAll(async () => {
  owner = await makeUser('customer');
  manager = await makeUser('customer');
  rep = await makeUser('customer');
  repRequester = await makeUser('customer');
  outsider = await makeUser('customer');
  const { rows: [biz] } = await pool.query(
    `INSERT INTO businesses (business_name, user_id, is_active) VALUES ($1, $2, TRUE) RETURNING id`,
    [`G20 Biz ${suffix()}`, owner.id]);
  businessId = biz.id;
  await addMember(manager.id, 'manager');
  await addMember(rep.id, 'representative');
  const repReqMembership = await addMember(repRequester.id, 'representative');
  await addOverride(repReqMembership, 'refunds.request', 'allow');
  const { rows: [job] } = await pool.query(
    `INSERT INTO jobs (client_id, title, description, status) VALUES ($1, $2, $3, 'completed') RETURNING id`,
    [owner.id, `G20 Job ${suffix()}`, 'Test job for refund request.']);
  jobId = job.id;
  const { rows: [payment] } = await pool.query(
    `INSERT INTO payments (job_id, payer_id, payee_id, amount, platform_fee, currency, stripe_payment_intent_id, status)
     VALUES ($1, $2, $3, 100.00, 0, 'USD', $4, 'captured') RETURNING id`,
    [jobId, owner.id, manager.id, `pi_g20_${suffix()}`]);
  paymentId = payment.id;
});

afterAll(async () => {
  const clean = async (sql, params) => { try { await pool.query(sql, params); } catch (_) {} };
  await clean(`DELETE FROM money_movement_approvals WHERE payload ->> 'jobId' = $1`, [String(jobId)]);
  await clean(`DELETE FROM payments WHERE id = $1`, [paymentId]);
  await clean(`DELETE FROM jobs WHERE id = $1`, [jobId]);
  await clean(`DELETE FROM membership_permission_overrides mpo USING business_members bm WHERE mpo.membership_id = bm.id AND bm.business_id = $1`, [businessId]);
  await clean(`DELETE FROM business_members WHERE business_id = $1`, [businessId]);
  await clean(`DELETE FROM businesses WHERE id = $1`, [businessId]);
  await clean(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [[owner.id, manager.id, rep.id, repRequester.id, outsider.id]]);
  await pool.end();
});

describe('G-20 business refund requests', () => {
  test('owner queues a refund for admin approval; nothing executes', async () => {
    const { approval, replay } = await requestBusinessRefund({
      businessId, userId: owner.id, jobId, amountCents: 2500, reason: 'Work was not completed.',
      idempotencyKey: `g20-owner-${suffix()}`,
    });
    expect(replay).toBe(false);
    expect(approval.movement_type).toBe('job_refund');
    expect(approval.status).toBe('pending');
    expect(Number(approval.amount_cents)).toBe(2500);
    expect(approval.requested_by).toBe(String(owner.id));
    const { rows } = await pool.query(
      `SELECT id FROM money_movement_approvals WHERE id = $1 AND status = 'pending'`, [approval.id]);
    expect(rows.length).toBe(1);
    // No refund attempt was reserved or executed at request time.
    const attempts = await pool.query(
      `SELECT 1 FROM payment_refund_attempts WHERE payment_id = $1 LIMIT 1`, [paymentId]);
    expect(attempts.rows.length).toBe(0);
  });

  test('manager holds refunds.request by default and can queue', async () => {
    const { approval } = await requestBusinessRefund({
      businessId, userId: manager.id, jobId, fullRefund: true, reason: 'Full refund requested.',
      idempotencyKey: `g20-manager-${suffix()}`,
    });
    expect(approval.status).toBe('pending');
    expect(Number(approval.amount_cents)).toBe(10000);
  });

  test('representative with an explicit refunds.request override can queue', async () => {
    const { approval } = await requestBusinessRefund({
      businessId, userId: repRequester.id, jobId, amountCents: 100, reason: 'Partial goodwill refund.',
      idempotencyKey: `g20-rep-${suffix()}`,
    });
    expect(approval.status).toBe('pending');
  });

  test('representative without the code cannot request', async () => {
    await expect(requestBusinessRefund({
      businessId, userId: rep.id, jobId, amountCents: 100, reason: 'No code.',
      idempotencyKey: `g20-rep-no-${suffix()}`,
    })).rejects.toMatchObject({ status: 403 });
  });

  test('outsider cannot request or list', async () => {
    await expect(requestBusinessRefund({
      businessId, userId: outsider.id, jobId, amountCents: 100, reason: 'Outsider.',
      idempotencyKey: `g20-out-${suffix()}`,
    })).rejects.toMatchObject({ status: 403 });
    await expect(listBusinessRefundRequests({ businessId, userId: outsider.id, jobId }))
      .rejects.toMatchObject({ status: 403 });
  });

  test('amount above the captured total is refused', async () => {
    await expect(requestBusinessRefund({
      businessId, userId: owner.id, jobId, amountCents: 10001, reason: 'Too much.',
      idempotencyKey: `g20-over-${suffix()}`,
    })).rejects.toMatchObject({ status: 400 });
  });

  test('replaying the same idempotency key returns the same approval', async () => {
    const key = `g20-replay-${suffix()}`;
    const first = await requestBusinessRefund({
      businessId, userId: owner.id, jobId, amountCents: 500, reason: 'Replay test.', idempotencyKey: key,
    });
    const second = await requestBusinessRefund({
      businessId, userId: owner.id, jobId, amountCents: 500, reason: 'Replay test.', idempotencyKey: key,
    });
    expect(second.replay).toBe(true);
    expect(second.approval.id).toBe(first.approval.id);
  });

  test('owner lists the queued requests for the job', async () => {
    const requests = await listBusinessRefundRequests({ businessId, userId: owner.id, jobId });
    expect(requests.length).toBeGreaterThanOrEqual(4);
    expect(requests.every((r) => r.status === 'pending')).toBe(true);
    expect(requests[0]).toHaveProperty('reason');
  });
});
