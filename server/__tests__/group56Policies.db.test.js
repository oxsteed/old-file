'use strict';
// Groups 5-6 items 226-228: approval thresholds, work authorization, cancellation settings.
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^\/(credit_statement_test|pa_g\d+|g56)$/.test(parsed.pathname)) throw new Error('Disposable database required');
  process.env.DATABASE_URL = raw;
}
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => { const id = req.get('x-user'); if (!id) return res.sendStatus(401); req.user = { id }; next(); };
  return { authenticate, requireAuth: authenticate };
});
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.unmock('pg'); jest.unmock('../db'); jest.unmock('../utils/transaction');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const describeDb = raw ? describe : describe.skip;
const owner = crypto.randomUUID(), manager = crypto.randomUUID(), employee = crypto.randomUUID();
let app, bizId, serviceId;
const as = (u) => ({ 'x-user': u });

describeDb('Groups 5-6: business policies', () => {
  beforeAll(async () => {
    for (const id of [owner, manager, employee]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified) VALUES($1,$2,'x','Pol','User','customer',TRUE,TRUE)", [id, `g56p-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active) VALUES($1,'Policy Co','service',TRUE) RETURNING id", [owner]));
    for (const [id, role] of [[manager, 'manager'], [employee, 'employee']]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status) VALUES($1,$2,$3,$4,$5,'active')", [bizId, owner, id, `g56p-${id}@x.invalid`, role]);
    ({ rows: [{ id: serviceId }] } = await pool.query("INSERT INTO business_services(business_id,name,base_price_cents,duration_minutes,is_active) VALUES($1,'Install',20000,60,TRUE) RETURNING id", [bizId]));
    const { router } = require('../routes/businessOwnerConsole');
    app = express(); app.use(express.json());
    app.use('/api/businesses', router);
    app.use('/api/businesses', require('../routes/businessFinance'));
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('DELETE FROM businesses WHERE id=$1', [bizId]); await pool.end(); });

  test('owner-only, versioned policy edits with history; managers can read', async () => {
    const base = { quote_approval_cents: 50000, expense_approval_cents: 10000, refund_approval_cents: 5000, work_start_requires: 'confirmed_booking', work_start_min_role: 'employee', default_cancellation_fee_percent: 25, no_show_fee_percent: 50, cancellation_notice_hours: 48, allow_customer_reschedule: true };
    expect((await request(app).put(`/api/businesses/${bizId}/owner/policies`).set(as(manager)).send({ ...base, expectedVersion: 0 })).status).toBe(403);
    expect((await request(app).put(`/api/businesses/${bizId}/owner/policies`).set(as(owner)).send({ ...base, default_cancellation_fee_percent: 150, expectedVersion: 0 })).status).toBe(400);
    const saved = await request(app).put(`/api/businesses/${bizId}/owner/policies`).set(as(owner)).send({ ...base, expectedVersion: 0 });
    expect(saved.body.version).toBe(1);
    expect((await request(app).put(`/api/businesses/${bizId}/owner/policies`).set(as(owner)).send({ ...base, expectedVersion: 0 })).status).toBe(409);
    const read = await request(app).get(`/api/businesses/${bizId}/owner/policies`).set(as(manager));
    expect(read.body.cancellation).toMatchObject({ notice_hours: 48, fee_percent: 25, no_show_fee_percent: 50 });
    expect(read.body.history[0].version).toBe(1);
    expect((await request(app).get(`/api/businesses/${bizId}/owner/policies`).set(as(employee))).status).toBe(403);
  });

  test('226: quote above threshold needs approval of the exact total; expenses above threshold wait for an approver who is not the requester', async () => {
    const { rows: [q] } = await pool.query("INSERT INTO business_quotes(business_id,client_name,title,line_items,subtotal_cents,total_cents,status,created_by) VALUES($1,'Client','Big job','[]',60000,60000,'draft',$2) RETURNING id", [bizId, manager]);
    const policy = require('../services/businessOwner/policyService');
    await expect(policy.assertQuoteSendAllowed(pool, bizId, q.id, 'representative', new Set(['quotes.create']))).rejects.toMatchObject({ code: 'quote_approval_required' });
    await expect(policy.assertQuoteSendAllowed(pool, bizId, q.id, 'owner', new Set())).resolves.toBeUndefined();
    expect((await request(app).get(`/api/businesses/${bizId}/owner/policies`).set(as(owner))).body.pending.map(p => p.kind)).toEqual(['quote']);
    await request(app).post(`/api/businesses/${bizId}/owner/quotes/${q.id}/approve`).set(as(owner)).expect(200);
    await expect(policy.assertQuoteSendAllowed(pool, bizId, q.id, 'representative', new Set())).resolves.toBeUndefined();
    await pool.query('UPDATE business_quotes SET total_cents=70000 WHERE id=$1', [q.id]);
    await expect(policy.assertQuoteSendAllowed(pool, bizId, q.id, 'representative', new Set())).rejects.toMatchObject({ code: 'quote_approval_required' });
    expect(await policy.expenseStatusFor(bizId, 'manager', new Set(['invoices.create']), 20000)).toBe('pending');
    expect(await policy.expenseStatusFor(bizId, 'manager', new Set(['invoices.create']), 9000)).toBe('approved');
    expect(await policy.expenseStatusFor(bizId, 'owner', new Set(), 20000)).toBe('approved');
    const { rows: [e] } = await pool.query("INSERT INTO business_expenses(business_id,category,description,amount_cents,expense_date,created_by,approval_status) VALUES($1,'materials','Tile',20000,CURRENT_DATE,$2,'pending') RETURNING id", [bizId, owner]);
    expect((await request(app).post(`/api/businesses/${bizId}/owner/expenses/${e.id}/decision`).set(as(owner)).send({ decision: 'approved' })).status).toBe(409);
    await pool.query('UPDATE business_expenses SET created_by=$2 WHERE id=$1', [e.id, manager]);
    expect((await request(app).post(`/api/businesses/${bizId}/owner/expenses/${e.id}/decision`).set(as(manager)).send({ decision: 'approved' })).status).toBe(403);
    expect((await request(app).post(`/api/businesses/${bizId}/owner/expenses/${e.id}/decision`).set(as(owner)).send({ decision: 'approved' })).body.approval_status).toBe('approved');
    await expect(policy.assertRefundRequestAllowed(bizId, 'manager', 6000, false)).rejects.toMatchObject({ code: 'refund_owner_approval_required' });
    await expect(policy.assertRefundRequestAllowed(bizId, 'manager', 4000, false)).resolves.toBeUndefined();
    await expect(policy.assertRefundRequestAllowed(bizId, 'manager', null, true)).rejects.toMatchObject({ code: 'refund_owner_approval_required' });
  });

  test('227 + 228: work start needs a confirmed booking; business default fees apply', async () => {
    const policy = require('../services/businessOwner/policyService');
    await expect(policy.assertWorkStart(pool, bizId, { id: crypto.randomUUID(), status: 'pending' }, 'employee')).rejects.toMatchObject({ code: 'work_authorization_required' });
    await expect(policy.assertWorkStart(pool, bizId, { id: crypto.randomUUID(), status: 'confirmed' }, 'employee')).resolves.toBeUndefined();
    const cur = (await request(app).get(`/api/businesses/${bizId}/owner/policies`).set(as(owner))).body.policy;
    await request(app).put(`/api/businesses/${bizId}/owner/policies`).set(as(owner)).send({ ...cur, work_start_requires: 'accepted_quote', work_start_min_role: 'manager', cancellation_notice_hours: 48, expectedVersion: cur.version }).expect(200);
    await expect(policy.assertWorkStart(pool, bizId, { id: crypto.randomUUID(), status: 'confirmed' }, 'employee')).rejects.toMatchObject({ code: 'work_start_role_required' });
    await expect(policy.assertWorkStart(pool, bizId, { id: crypto.randomUUID(), status: 'confirmed' }, 'manager')).rejects.toMatchObject({ code: 'work_authorization_required' });
    const { rows: [fee] } = await pool.query(`SELECT COALESCE(NULLIF(s.cancellation_fee_percent,0), p.default_cancellation_fee_percent, 0) AS f FROM business_services s
      LEFT JOIN business_operating_policies p ON p.business_id=s.business_id WHERE s.id=$1`, [serviceId]);
    expect(Number(fee.f)).toBe(25);
    expect(await policy.defaultFees(pool, bizId)).toEqual({ fee: 25, noShow: 50 });
  });
});
