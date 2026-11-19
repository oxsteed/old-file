// PR804 Track C — G-22: business-funded Credit.
// An owner/manager names a member, funds from the business payment method
// (their own card via the returned client secret), with an explicit reason
// and an audit record. Settlement still credits the named member.
// The self-service path is untouched: no funding columns, plain key.
// DB-backed; runs only against credit_statement_test_pr804_c.
'use strict';

const TEST_DB_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
if (!TEST_DB_URL.includes('/credit_statement_test_pr804_c')) {
  throw new Error('pr804TrackCBusinessTopup requires STATEMENT_TEST_DATABASE_URL for credit_statement_test_pr804_c');
}
process.env.DATABASE_URL = TEST_DB_URL;

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
jest.mock('stripe', () => jest.fn(() => ({
  paymentIntents: {
    create: jest.fn(async () => ({ id: 'pi_g22_fake', client_secret: 'cs_g22_fake' })),
    retrieve: jest.fn(async () => ({ id: 'pi_g22_fake', client_secret: 'cs_g22_fake' })),
  },
})));

const pool = require('../db');
const topupService = require('../services/oxsteedCreditTopupService');
const topupController = require('../controllers/oxsteedCreditTopupController');

const suffix = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

let owner;
let manager;
let member;
let rep;
let outsider;
let businessId;
let railWasEnabled = false;

function fakeStripe() {
  return {
    paymentIntents: {
      create: jest.fn(async () => ({ id: `pi_g22_${suffix()}`, client_secret: 'cs_g22_fake' })),
      retrieve: jest.fn(async () => ({ id: 'pi_g22_fake', client_secret: 'cs_g22_fake' })),
    },
  };
}

function mockRes() {
  const res = { _status: null, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

async function call(handler, { user, params = {}, body = {} }) {
  const req = { user, params, body, get: () => null, ip: '127.0.0.1' };
  const res = mockRes();
  let nextError = null;
  await handler(req, res, (err) => { nextError = err; });
  return { res, nextError };
}

async function makeUser(role) {
  const s = suffix();
  const { rows: [row] } = await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role)
     VALUES ($1, 'x', 'Track', 'C', $2) RETURNING id`,
    [`g22-${role}-${s}@example.test`, role]);
  return row;
}

beforeAll(async () => {
  const { rows } = await pool.query(`SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
  railWasEnabled = rows[0]?.is_enabled === true;
  await pool.query(`UPDATE feature_flags SET is_enabled = TRUE WHERE key = 'oxsteed_credit_enabled'`);
  owner = await makeUser('customer');
  manager = await makeUser('customer');
  member = await makeUser('customer');
  rep = await makeUser('customer');
  outsider = await makeUser('customer');
  const { rows: [biz] } = await pool.query(
    `INSERT INTO businesses (business_name, user_id, is_active) VALUES ($1, $2, TRUE) RETURNING id`,
    [`G22 Biz ${suffix()}`, owner.id]);
  businessId = biz.id;
  for (const [user, role] of [[manager, 'manager'], [member, 'representative'], [rep, 'representative']]) {
    await pool.query(
      `INSERT INTO business_members (business_id, member_id, role, status, owner_id, invite_email)
       VALUES ($1, $2, $3, 'active', $4, $5)`,
      [businessId, user.id, role, owner.id, `g22-${suffix()}@example.test`]);
  }
});

afterAll(async () => {
  const clean = async (sql, params) => { try { await pool.query(sql, params); } catch (_) {} };
  await clean(`DELETE FROM oxsteed_credit_audit_events WHERE action_type = 'credit.topup.business_funded' AND resource_id IN (SELECT id::text FROM oxsteed_credit_topups WHERE funded_by_business_id = $1)`, [businessId]);
  await clean(`DELETE FROM oxsteed_credit_topups WHERE funded_by_business_id = $1 OR customer_id = ANY($2::uuid[])`, [businessId, [member.id, owner.id]]);
  await clean(`DELETE FROM business_members WHERE business_id = $1`, [businessId]);
  await clean(`DELETE FROM businesses WHERE id = $1`, [businessId]);
  await clean(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [[owner.id, manager.id, member.id, rep.id, outsider.id]]);
  await pool.query(`UPDATE feature_flags SET is_enabled = $1 WHERE key = 'oxsteed_credit_enabled'`, [railWasEnabled]);
  await pool.end();
});

describe('G-22 business-funded Credit', () => {
  test('funded top-up stores the funder, business, reason, namespaced key, and audit event', async () => {
    const stripe = fakeStripe();
    const key = `g22-key-${suffix()}`;
    const { topup, clientSecret, replayed } = await topupService.createTopup({
      customerId: member.id,
      amountCents: 5000,
      currencyCode: 'USD',
      idempotencyKey: key,
      getStripe: () => stripe,
      fundedBy: { userId: owner.id, businessId, reason: 'Quarterly tools allowance.' },
    });
    expect(replayed).toBe(false);
    expect(clientSecret).toBeTruthy();
    expect(String(topup.funded_by_user_id)).toBe(String(owner.id));
    expect(String(topup.funded_by_business_id)).toBe(String(businessId));
    expect(topup.funding_reason).toBe('Quarterly tools allowance.');
    expect(topup.idempotency_key.startsWith('business-funded:')).toBe(true);
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          funded_by_business_id: String(businessId),
          funded_by_user_id: String(owner.id),
        }),
      }),
      expect.anything()
    );
    const { rows: audits } = await pool.query(
      `SELECT actor_user_id, customer_id, reason FROM oxsteed_credit_audit_events
        WHERE action_type = 'credit.topup.business_funded' AND resource_id = $1`,
      [String(topup.id)]);
    expect(audits.length).toBe(1);
    expect(String(audits[0].actor_user_id)).toBe(String(owner.id));
    expect(String(audits[0].customer_id)).toBe(String(member.id));
    expect(audits[0].reason).toBe('Quarterly tools allowance.');
  });

  test('replaying the same funded key returns the same top-up without a second audit event', async () => {
    const stripe = fakeStripe();
    const key = `g22-replay-${suffix()}`;
    const first = await topupService.createTopup({
      customerId: member.id, amountCents: 2500, currencyCode: 'USD', idempotencyKey: key,
      getStripe: () => stripe,
      fundedBy: { userId: manager.id, businessId, reason: 'Replay check.' },
    });
    const second = await topupService.createTopup({
      customerId: member.id, amountCents: 2500, currencyCode: 'USD', idempotencyKey: key,
      getStripe: () => stripe,
      fundedBy: { userId: manager.id, businessId, reason: 'Replay check.' },
    });
    expect(second.replayed).toBe(true);
    expect(second.topup.id).toBe(first.topup.id);
    const { rows } = await pool.query(
      `SELECT 1 FROM oxsteed_credit_audit_events WHERE action_type = 'credit.topup.business_funded' AND resource_id = $1`,
      [String(first.topup.id)]);
    expect(rows.length).toBe(1);
  });

  test('self-service top-up stores no funding columns and a plain key', async () => {
    const stripe = fakeStripe();
    const key = `g22-self-${suffix()}`;
    const { topup } = await topupService.createTopup({
      customerId: owner.id, amountCents: 1000, currencyCode: 'USD', idempotencyKey: key,
      getStripe: () => stripe,
    });
    expect(topup.funded_by_user_id).toBeNull();
    expect(topup.funded_by_business_id).toBeNull();
    expect(topup.funding_reason).toBeNull();
    expect(topup.idempotency_key).toBe(key);
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { oxsteed_credit_topup_id: String(topup.id) } }),
      expect.anything()
    );
  });

  test('business read helpers return only that business funded top-ups', async () => {
    const rows = await topupService.listBusinessTopups({ businessId });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => String(r.funded_by_business_id) === String(businessId))).toBe(true);
    expect(await topupService.getBusinessTopup({ businessId, topupId: rows[0].id })).not.toBeNull();
    expect(await topupService.getBusinessTopup({ businessId: businessId + 999999, topupId: rows[0].id })).toBeNull();
  });

  test('controller refuses a representative, an unknown member, and a missing reason', async () => {
    const asRep = await call(topupController.createBusinessTopup, {
      user: { id: rep.id }, params: { businessId },
      body: { memberId: member.id, amountCents: 1000, currencyCode: 'USD', reason: 'Rep funding.', idempotencyKey: `g22-${suffix()}` },
    });
    expect(asRep.nextError).toMatchObject({ status: 403 });
    const unknownMember = await call(topupController.createBusinessTopup, {
      user: { id: owner.id }, params: { businessId },
      body: { memberId: outsider.id, amountCents: 1000, currencyCode: 'USD', reason: 'Stranger.', idempotencyKey: `g22-${suffix()}` },
    });
    expect(unknownMember.nextError).toMatchObject({ status: 404 });
    const noReason = await call(topupController.createBusinessTopup, {
      user: { id: owner.id }, params: { businessId },
      body: { memberId: member.id, amountCents: 1000, currencyCode: 'USD', idempotencyKey: `g22-${suffix()}` },
    });
    expect(noReason.nextError).toMatchObject({ status: 400 });
  });
});
