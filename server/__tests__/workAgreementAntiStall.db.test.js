'use strict';

// Review P1-3-F07 against a real database: unilateral versioning cannot
// stall activation indefinitely.
//   * 24h anti-stranding cooldown: a new version cannot strand the
//     counterparty's fresh signature.
//   * 7-day proposal-sign timeout: a proposal the counterparty signed
//     activates on the author's own terms when the author stalls.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const schema = `wa_antistall_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('W11 fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));

const db = require('../db');
const controller = require('../controllers/workAgreementController');
const { activateTimedOutProposals } = require('../jobs/workAgreementProposalTimeout');
const { sendNotification } = require('../services/notificationService');

const ids = { helper: crypto.randomUUID(), customer: crypto.randomUUID(), job: crypto.randomUUID() };
const SIG = 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUg'.repeat(20);
const describeDb = url ? describe : describe.skip;

function invoke(handler, userId, params, body) {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  return handler({ user: { id: userId }, params, body }, res).then(() => res);
}

async function makeAgreement() {
  const a = (await db.query(
    `INSERT INTO work_agreements(job_id, helper_id, customer_id, status)
     VALUES($1, $2, $3, 'pending_signatures') RETURNING *`,
    [ids.job, ids.helper, ids.customer]
  )).rows[0];
  const v = (await db.query(
    `INSERT INTO work_agreement_versions(agreement_id, version_number, content, created_by)
     VALUES($1, 1, $2::jsonb, $3) RETURNING *`,
    [a.id, JSON.stringify({ scope: 'Fix sink' }), ids.helper]
  )).rows[0];
  return { a, v };
}

async function signAs(userId, role, versionId, agreementId) {
  return invoke(controller.signAgreement, userId, { id: agreementId },
    { versionId, signatureData: SIG, role });
}

async function agreementStatus(agreementId) {
  return (await db.query('SELECT status FROM work_agreements WHERE id = $1', [agreementId])).rows[0].status;
}

describeDb('work agreement anti-stall (P1-3-F07)', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.users (id UUID PRIMARY KEY)`);
    await db.query(`CREATE TABLE ${schema}.jobs (id UUID PRIMARY KEY)`);
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/697_work_agreement_records_room.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/783_work_agreement_mutual_completion.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/794_warranty_claim_under_review.sql'), 'utf8'));
    for (const id of [ids.helper, ids.customer]) await db.query('INSERT INTO users(id) VALUES($1)', [id]);
    await db.query('INSERT INTO jobs(id) VALUES($1)', [ids.job]);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); });
  beforeEach(() => sendNotification.mockClear());

  test('signing the proposer\u2019s terms notifies the proposer that the clock is running', async () => {
    const { a, v } = await makeAgreement();
    const res = await signAs(ids.customer, 'customer', v.id, a.id);
    expect(res.statusCode).toBe(200);
    expect(res.body.activated).toBe(false);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: ids.helper,
      type: 'work_agreement_proposal_signed',
      idempotencyKey: `wa-proposal-signed:${v.id}:${ids.customer}`,
    }));
  });

  test('a new version cannot strand the counterparty\u2019s fresh signature', async () => {
    const { a } = await makeAgreement();
    await signAs(ids.customer, 'customer', (await db.query(
      'SELECT id FROM work_agreement_versions WHERE agreement_id = $1', [a.id])).rows[0].id, a.id);

    const blocked = await invoke(controller.createVersion, ids.helper, { id: a.id },
      { content: { scope: 'Stall attempt' } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.body.code).toBe('version_cooldown');
    expect(blocked.body.retry_after).toBeTruthy();

    // After the cooldown the author may amend again.
    await db.query(`UPDATE work_agreement_signatures SET signed_at = NOW() - INTERVAL '25 hours'
      WHERE agreement_id = $1`, [a.id]);
    const allowed = await invoke(controller.createVersion, ids.helper, { id: a.id },
      { content: { scope: 'Legitimate amendment' } });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.body.version.version_number).toBe(2);
  });

  test('a stale proposal activates through the worker and notifies both parties', async () => {
    const { a, v } = await makeAgreement();
    await signAs(ids.customer, 'customer', v.id, a.id);
    await db.query(`UPDATE work_agreement_signatures SET signed_at = NOW() - INTERVAL '8 days'
      WHERE agreement_id = $1`, [a.id]);
    sendNotification.mockClear();

    const result = await activateTimedOutProposals(7);

    expect(result).toEqual({ checked: 1, activated: 1 });
    expect(await agreementStatus(a.id)).toBe('active');
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: ids.helper, type: 'work_agreement_auto_activated',
      idempotencyKey: `wa-auto-activated:${a.id}`,
    }));
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: ids.customer, type: 'work_agreement_auto_activated',
    }));
  });

  test('versioning after the deadline activates instead of stalling', async () => {
    const { a, v } = await makeAgreement();
    await signAs(ids.customer, 'customer', v.id, a.id);
    await db.query(`UPDATE work_agreement_signatures SET signed_at = NOW() - INTERVAL '8 days'
      WHERE agreement_id = $1`, [a.id]);

    const res = await invoke(controller.createVersion, ids.helper, { id: a.id },
      { content: { scope: 'Last-second stall' } });

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('proposal_auto_activated');
    expect(await agreementStatus(a.id)).toBe('active');
    const versions = await db.query(
      'SELECT COUNT(*)::int AS n FROM work_agreement_versions WHERE agreement_id = $1', [a.id]);
    expect(versions.rows[0].n).toBe(1);
  });
});
