// PR804 Track C — G-21: the owning business's owner/manager may read a
// dispute about one of the business's jobs and submit evidence.
// Resolution stays admin-only; dispute messages stay party-only.
// DB-backed; runs only against credit_statement_test_pr804_c.
'use strict';

const TEST_DB_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
if (!TEST_DB_URL.includes('/credit_statement_test_pr804_c')) {
  throw new Error('pr804TrackCDisputeBusiness requires STATEMENT_TEST_DATABASE_URL for credit_statement_test_pr804_c');
}
process.env.DATABASE_URL = TEST_DB_URL;

jest.unmock('pg');
jest.unmock('../db');

const pool = require('../db');
const disputeController = require('../controllers/disputeController');
const { isBusinessDisputeParty } = require('../services/businessDisputeAccess');

const suffix = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

let owner;
let helper;
let manager;
let rep;
let outsider;
let businessId;
let jobId;
let disputeId;

function mockRes() {
  const res = { _status: null, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

async function call(handler, { user, params = {}, body = {}, files = [] }) {
  const req = { user, params, body, files, get: () => null };
  const res = mockRes();
  let nextError = null;
  const next = (err) => { nextError = err; };
  await handler(req, res, next);
  return { res, nextError };
}

async function makeUser(role) {
  const s = suffix();
  const { rows: [row] } = await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role)
     VALUES ($1, 'x', 'Track', 'C', $2) RETURNING id`,
    [`g21-${role}-${s}@example.test`, role]);
  return row;
}

beforeAll(async () => {
  owner = await makeUser('customer');
  helper = await makeUser('helper');
  manager = await makeUser('customer');
  rep = await makeUser('customer');
  outsider = await makeUser('customer');
  const { rows: [biz] } = await pool.query(
    `INSERT INTO businesses (business_name, user_id, is_active) VALUES ($1, $2, TRUE) RETURNING id`,
    [`G21 Biz ${suffix()}`, owner.id]);
  businessId = biz.id;
  for (const [user, role] of [[manager, 'manager'], [rep, 'representative']]) {
    await pool.query(
      `INSERT INTO business_members (business_id, member_id, role, status, owner_id, invite_email)
       VALUES ($1, $2, $3, 'active', $4, $5)`,
      [businessId, user.id, role, owner.id, `g21-${suffix()}@example.test`]);
  }
  const { rows: [job] } = await pool.query(
    `INSERT INTO jobs (client_id, assigned_helper_id, title, description, status)
     VALUES ($1, $2, $3, $4, 'completed') RETURNING id`,
    [owner.id, helper.id, `G21 Job ${suffix()}`, 'Test job for dispute access.']);
  jobId = job.id;
  const { rows: [dispute] } = await pool.query(
    `INSERT INTO disputes (job_id, raised_by, against_user, opened_by, reason, description, status)
     VALUES ($1, $2, $3, $2, 'work_not_completed', 'Work was not completed as agreed.', 'open') RETURNING id`,
    [jobId, helper.id, owner.id]);
  disputeId = dispute.id;
});

afterAll(async () => {
  const clean = async (sql, params) => { try { await pool.query(sql, params); } catch (_) {} };
  await clean(`DELETE FROM dispute_evidence WHERE dispute_id = $1`, [disputeId]);
  await clean(`DELETE FROM dispute_messages WHERE dispute_id = $1`, [disputeId]);
  await clean(`DELETE FROM disputes WHERE id = $1`, [disputeId]);
  await clean(`DELETE FROM jobs WHERE id = $1`, [jobId]);
  await clean(`DELETE FROM business_members WHERE business_id = $1`, [businessId]);
  await clean(`DELETE FROM businesses WHERE id = $1`, [businessId]);
  await clean(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [[owner.id, helper.id, manager.id, rep.id, outsider.id]]);
  await pool.end();
});

describe('G-21 business dispute access', () => {
  test('manager is a business party for the job client', async () => {
    expect(await isBusinessDisputeParty(manager.id, owner.id)).toBe(true);
    expect(await isBusinessDisputeParty(rep.id, owner.id)).toBe(false);
    expect(await isBusinessDisputeParty(outsider.id, owner.id)).toBe(false);
    expect(await isBusinessDisputeParty(manager.id, helper.id)).toBe(false);
  });

  test('manager can read the dispute; rep and outsider cannot', async () => {
    const asManager = await call(disputeController.getDispute, { user: { id: manager.id, role: 'customer' }, params: { disputeId } });
    expect(asManager.nextError).toBeNull();
    expect(asManager.res._body.dispute.id).toBe(disputeId);
    const asRep = await call(disputeController.getDispute, { user: { id: rep.id, role: 'customer' }, params: { disputeId } });
    expect(asRep.nextError).toMatchObject({ status: 403 });
    const asOutsider = await call(disputeController.getDispute, { user: { id: outsider.id, role: 'customer' }, params: { disputeId } });
    expect(asOutsider.nextError).toMatchObject({ status: 403 });
  });

  test('manager lists the dispute in My Disputes; rep does not', async () => {
    const asManager = await call(disputeController.getMyDisputes, { user: { id: manager.id, role: 'customer' } });
    expect(asManager.nextError).toBeNull();
    expect(asManager.res._body.disputes.map((d) => d.id)).toContain(disputeId);
    const asRep = await call(disputeController.getMyDisputes, { user: { id: rep.id, role: 'customer' } });
    expect(asRep.nextError).toBeNull();
    expect(asRep.res._body.disputes.map((d) => d.id)).not.toContain(disputeId);
  });

  test('manager can submit evidence; rep cannot', async () => {
    const asManager = await call(disputeController.submitEvidence, {
      user: { id: manager.id, role: 'customer' },
      params: { disputeId },
      body: { evidence: 'The business confirms the work was left unfinished.' },
    });
    expect(asManager.nextError).toBeNull();
    expect(asManager.res._status).toBe(201);
    expect(asManager.res._body.evidence.length).toBeGreaterThan(0);
    const { rows } = await pool.query(
      `SELECT submitted_by, submitter_role FROM dispute_evidence WHERE dispute_id = $1 AND submitted_by = $2`,
      [disputeId, manager.id]);
    expect(rows.length).toBe(1);
    expect(rows[0].submitter_role).toBe('client');
    const asRep = await call(disputeController.submitEvidence, {
      user: { id: rep.id, role: 'customer' },
      params: { disputeId },
      body: { evidence: 'Rep evidence.' },
    });
    expect(asRep.nextError).toMatchObject({ status: 403 });
  });

  test('dispute messages stay party-only for the manager', async () => {
    const asManager = await call(disputeController.sendDisputeMessage, {
      user: { id: manager.id, role: 'customer' },
      params: { disputeId },
      body: { message: 'Manager message.' },
    });
    expect(asManager.nextError).toMatchObject({ status: 403 });
  });

  test('original parties keep their access', async () => {
    const asOwner = await call(disputeController.getDispute, { user: { id: owner.id, role: 'customer' }, params: { disputeId } });
    expect(asOwner.nextError).toBeNull();
    const asHelper = await call(disputeController.getDispute, { user: { id: helper.id, role: 'helper' }, params: { disputeId } });
    expect(asHelper.nextError).toBeNull();
  });
});
