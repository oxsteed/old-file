'use strict';
// Groups 5-6 items 231-234: invoice overview, refund tracker, payout reconciliation, expense categories.
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
let app, bizId, serviceId, otherBiz;
const as = (u) => ({ 'x-user': u });

describeDb('Groups 5-6: business finance', () => {
  beforeAll(async () => {
    for (const id of [owner, manager, employee]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified) VALUES($1,$2,'x','Fin','User','customer',TRUE,TRUE)", [id, `g56f-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active) VALUES($1,'Finance Co','service',TRUE) RETURNING id", [owner]));
    ({ rows: [{ id: otherBiz }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active) VALUES($1,'Other Co','service',TRUE) RETURNING id", [manager]));
    for (const [id, role] of [[manager, 'manager'], [employee, 'employee']]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status) VALUES($1,$2,$3,$4,$5,'active')", [bizId, owner, id, `g56f-${id}@x.invalid`, role]);
    ({ rows: [{ id: serviceId }] } = await pool.query("INSERT INTO business_services(business_id,name,base_price_cents,duration_minutes,is_active) VALUES($1,'Clean',15000,60,TRUE) RETURNING id", [bizId]));
    const { router } = require('../routes/businessOwnerConsole');
    app = express(); app.use(express.json());
    app.use('/api/businesses', router);
    app.use('/api/businesses', require('../routes/businessFinance'));
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('DELETE FROM businesses WHERE id = ANY($1)', [[bizId, otherBiz]]); await pool.end(); });

  test('231: aging buckets and overdue list', async () => {
    const ins = (n, status, total, paid, dueOffset) => pool.query(`INSERT INTO business_invoices(user_id,business_id,invoice_number,client_name,status,total,amount_paid,issue_date,due_date) VALUES($1,$2,$3,'C',$4,$5,$6,CURRENT_DATE,CURRENT_DATE + $7::int)`, [owner, bizId, n, status, total, paid, dueOffset]);
    await ins(`F-${bizId}-1`, 'sent', 100, 0, 5);
    await ins(`F-${bizId}-2`, 'partial', 200, 50, -10);
    await ins(`F-${bizId}-3`, 'overdue', 300, 0, -95);
    await ins(`F-${bizId}-4`, 'paid', 400, 400, -5);
    const r = await request(app).get(`/api/businesses/${bizId}/owner/invoice-overview`).set(as(manager)).expect(200);
    expect(r.body.totals).toMatchObject({ open_count: 3, outstanding_cents: '55000', current_cents: '10000', d1_30_cents: '15000', d90_plus_cents: '30000' });
    expect(r.body.overdue.map(o => o.invoice_number)).toEqual([`F-${bizId}-3`, `F-${bizId}-2`]);
    expect((await request(app).get(`/api/businesses/${bizId}/owner/invoice-overview`).set(as(employee))).status).toBe(403);
  });

  test('232: refund tracker lists only this business', async () => {
    const add = (b, amt) => pool.query("INSERT INTO money_movement_approvals(movement_type,reference_key,amount_cents,requested_by,idempotency_key,payload) VALUES('job_refund',$1,$2,$3,$1,$4)", [crypto.randomUUID(), amt, manager, { businessId: b, jobId: '1', reason: 'Damaged' }]);
    await add(bizId, 1200); await add(otherBiz, 999);
    const r = await request(app).get(`/api/businesses/${bizId}/owner/refund-tracker`).set(as(owner)).expect(200);
    expect(r.body.requests.map(x => Number(x.amount_cents))).toEqual([1200]);
    expect(r.body.counts.pending).toBe(1);
  });

  test('233: deposits match only own card payments, once each, with variance', async () => {
    const { rows: [inv] } = await pool.query(`INSERT INTO business_invoices(user_id,business_id,invoice_number,client_name,status,total,amount_paid,paid_at,stripe_payment_intent_id) VALUES($1,$2,$3,'C','paid',100,100,NOW(),'pi_g56_a') RETURNING id`, [owner, bizId, `F-${bizId}-card`]);
    const { rows: [appt] } = await pool.query(`INSERT INTO business_appointments(business_id,service_id,start_time,end_time,status,final_price_cents,payment_status,stripe_payment_intent_id) VALUES($1,$2,NOW(),NOW()+interval '1 hour','completed',5000,'paid','pi_g56_b') RETURNING id`, [bizId, serviceId]);
    const { rows: [foreign] } = await pool.query(`INSERT INTO business_invoices(user_id,business_id,invoice_number,client_name,status,total,amount_paid,paid_at,stripe_payment_intent_id) VALUES($1,$2,$3,'C','paid',10,10,NOW(),'pi_g56_c') RETURNING id`, [manager, otherBiz, `F-${otherBiz}-x`]);
    let rec = (await request(app).get(`/api/businesses/${bizId}/owner/payout-reconciliation`).set(as(owner)).expect(200)).body;
    expect(rec.unmatched).toHaveLength(2); expect(rec.unmatched_cents).toBe(15000);
    const items = [{ source: 'invoice', source_id: String(inv.id) }, { source: 'appointment', source_id: String(appt.id) }];
    expect((await request(app).post(`/api/businesses/${bizId}/owner/payout-deposits`).set(as(manager)).send({ amount_cents: 14500, deposited_on: '2026-11-20', items })).status).toBe(403);
    expect((await request(app).post(`/api/businesses/${bizId}/owner/payout-deposits`).set(as(owner)).send({ amount_cents: 10, deposited_on: '2026-11-20', items: [{ source: 'invoice', source_id: String(foreign.id) }] })).status).toBe(404);
    const d = await request(app).post(`/api/businesses/${bizId}/owner/payout-deposits`).set(as(owner)).send({ amount_cents: 14500, deposited_on: '2026-11-20', reference: 'ACH 123', items }).expect(201);
    expect((await request(app).post(`/api/businesses/${bizId}/owner/payout-deposits`).set(as(owner)).send({ amount_cents: 5000, deposited_on: '2026-11-21', items: [items[1]] })).status).toBe(409);
    rec = (await request(app).get(`/api/businesses/${bizId}/owner/payout-reconciliation`).set(as(owner))).body;
    expect(rec.unmatched).toHaveLength(0);
    expect(rec.deposits[0]).toMatchObject({ items: 2, variance_cents: -500 });
    await request(app).delete(`/api/businesses/${bizId}/owner/payout-deposits/${d.body.id}`).set(as(owner)).expect(200);
    expect((await request(app).get(`/api/businesses/${bizId}/owner/payout-reconciliation`).set(as(owner))).body.unmatched).toHaveLength(2);
  });

  test('234: custom categories roll up to a base category and are business-scoped', async () => {
    const c = await request(app).post(`/api/businesses/${bizId}/owner/expense-categories`).set(as(manager)).send({ name: 'Fuel', base_category: 'vehicle' }).expect(201);
    expect((await request(app).post(`/api/businesses/${bizId}/owner/expense-categories`).set(as(owner)).send({ name: 'fuel', base_category: 'other' })).status).toBe(409);
    expect((await request(app).post(`/api/businesses/${bizId}/owner/expense-categories`).set(as(owner)).send({ name: 'X', base_category: 'bogus' })).status).toBe(400);
    const e = await request(app).post(`/api/businesses/${bizId}/expenses`).set(as(owner)).send({ category: 'other', custom_category_id: c.body.id, description: 'Gas', amount_cents: 4000, expense_date: '2026-11-20' }).expect(201);
    expect(e.body).toMatchObject({ category: 'vehicle', custom_category_id: String(c.body.id) });
    const { rows: [oc] } = await pool.query("INSERT INTO business_expense_categories(business_id,name,base_category) VALUES($1,'Theirs','other') RETURNING id", [otherBiz]);
    expect((await request(app).post(`/api/businesses/${bizId}/expenses`).set(as(owner)).send({ custom_category_id: oc.id, description: 'x', amount_cents: 1, expense_date: '2026-11-20' })).status).toBe(400);
    await request(app).put(`/api/businesses/${bizId}/owner/expense-categories/${c.body.id}`).set(as(owner)).send({ name: 'Fuel', base_category: 'equipment' }).expect(200);
    const list = (await request(app).get(`/api/businesses/${bizId}/owner/expense-categories`).set(as(owner))).body;
    expect(list.categories[0]).toMatchObject({ name: 'Fuel', base_category: 'equipment', total_cents: '4000', expenses: 1 });
    expect((await pool.query('SELECT category FROM business_expenses WHERE id=$1', [e.body.id])).rows[0].category).toBe('equipment');
  });
});
