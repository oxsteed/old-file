'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const schema = `w11_warranty_${crypto.randomBytes(6).toString('hex')}`;
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
const { sendNotification } = require('../services/notificationService');
const ids = { helper: crypto.randomUUID(), customer: crypto.randomUUID(), outsider: crypto.randomUUID(), job: crypto.randomUUID() };
const describeDb = url ? describe : describe.skip;

describeDb('W11 production warranty SQL and counterpart notifications', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.users (id UUID PRIMARY KEY)`);
    await db.query(`CREATE TABLE ${schema}.jobs (id UUID PRIMARY KEY)`);
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/697_work_agreement_records_room.sql'), 'utf8'));
    // Apply the production constraint chain so the fixture matches the real
    // schema: 783 narrowed the warranty-claim CHECK (dropping under_review),
    // 794 restored it. Without these, the test cannot catch CHECK regressions.
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/783_work_agreement_mutual_completion.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/794_warranty_claim_under_review.sql'), 'utf8'));
    for (const id of [ids.helper, ids.customer, ids.outsider]) await db.query('INSERT INTO users(id) VALUES($1)', [id]);
    await db.query('INSERT INTO jobs(id) VALUES($1)', [ids.job]);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); });
  beforeEach(() => sendNotification.mockClear());
  async function agreement() {
    return (await db.query(`INSERT INTO work_agreements(job_id,helper_id,customer_id,status)
      VALUES($1,$2,$3,'active') RETURNING *`, [ids.job, ids.helper, ids.customer])).rows[0];
  }
  async function invoke(handler, userId, agreementId, body, claimId) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ user: { id: userId }, params: { id: agreementId, claimId }, body }, res);
    return res;
  }
  async function file(a, userId = ids.customer) {
    const res = await invoke(controller.fileWarrantyClaim, userId, a.id, { description: 'Synthetic warranty problem for regression testing' });
    expect(res.statusCode).toBe(201);
    return res.body.claim;
  }
  async function state(id) { return (await db.query('SELECT * FROM work_agreement_warranty_claims WHERE id=$1', [id])).rows[0]; }

  test.each(['customer', 'helper'])('a %s filing notifies only the counterparty with a persisted key', async role => {
    const a = await agreement(); const claim = await file(a, ids[role]);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: ids[role === 'customer' ? 'helper' : 'customer'], type: 'warranty_claim_filed',
      idempotencyKey: `wa-warranty-filed:${claim.id}`, action_url: `/agreements/${a.id}`,
    }));
  });
  test.each(['resolved', 'denied'])('a claim can pass through under_review to %s exactly once', async decision => {
    const a = await agreement(); const claim = await file(a);
    sendNotification.mockClear();
    const reviewing = await invoke(controller.resolveWarrantyClaim, ids.helper, a.id, { decision: 'under_review' }, claim.id);
    expect(reviewing.statusCode).toBe(200);
    expect(await state(claim.id)).toMatchObject({ status: 'under_review', resolved_at: null, resolved_by: null });
    const result = await invoke(controller.resolveWarrantyClaim, ids.helper, a.id, { decision, note: 'Synthetic decision' }, claim.id);
    expect(result.statusCode).toBe(200);
    expect(await state(claim.id)).toMatchObject({ status: decision, resolved_by: ids.helper, resolved_at: expect.any(Date) });
    expect(sendNotification.mock.calls.map(([n]) => n.idempotencyKey)).toEqual([`wa-warranty-under_review:${claim.id}`, `wa-warranty-${decision}:${claim.id}`]);
    expect(sendNotification.mock.calls.every(([n]) => n.userId === ids.customer)).toBe(true);
    expect((await invoke(controller.resolveWarrantyClaim, ids.helper, a.id, { decision }, claim.id)).statusCode).toBe(404);
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });
  test('the filer cannot deny their own claim and an outsider cannot act', async () => {
    const a = await agreement(); const claim = await file(a); sendNotification.mockClear();
    expect((await invoke(controller.resolveWarrantyClaim, ids.customer, a.id, { decision: 'denied' }, claim.id)).statusCode).toBe(403);
    expect((await invoke(controller.resolveWarrantyClaim, ids.outsider, a.id, { decision: 'resolved' }, claim.id)).statusCode).toBe(403);
    expect((await state(claim.id)).status).toBe('filed');
    expect(sendNotification).not.toHaveBeenCalled();
  });
  test('concurrent terminal decisions have one winner and one notification', async () => {
    const a = await agreement(); const claim = await file(a); sendNotification.mockClear();
    const outcomes = await Promise.all(['resolved', 'denied'].map(decision => invoke(controller.resolveWarrantyClaim, ids.helper, a.id, { decision }, claim.id)));
    expect(outcomes.map(r => r.statusCode).sort()).toEqual([200, 404]);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
  test('a database rejection keeps the claim filed and emits no notice', async () => {
    const a = await agreement(); const claim = await file(a); sendNotification.mockClear();
    // Use a real PostgreSQL constraint failure, not a mocked controller query.
    await db.query(`ALTER TABLE work_agreement_warranty_claims ADD CONSTRAINT reject_fixture_note
      CHECK(resolution_note IS DISTINCT FROM 'synthetic rejected update')`);
    try {
      expect((await invoke(controller.resolveWarrantyClaim, ids.helper, a.id,
        { decision: 'resolved', note: 'synthetic rejected update' }, claim.id)).statusCode).toBe(500);
      expect((await state(claim.id)).status).toBe('filed');
      expect(sendNotification).not.toHaveBeenCalled();
    } finally { await db.query('ALTER TABLE work_agreement_warranty_claims DROP CONSTRAINT reject_fixture_note'); }
  });
});
