'use strict';
// Groups 5-6 items 246-250: performance reports.
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

describeDb('Groups 5-6: performance reports', () => {
  beforeAll(async () => {
    for (const id of [owner, manager, employee]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified) VALUES($1,$2,'x','Perf','User','customer',TRUE,TRUE)", [id, `g56r-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Metrics Co','service',TRUE,'America/New_York') RETURNING id", [owner]));
    for (const [id, role, wage] of [[manager, 'manager', null], [employee, 'employee', 2000]]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,hourly_wage_cents) VALUES($1,$2,$3,$4,$5,'active',$6)", [bizId, owner, id, `g56r-${id}@x.invalid`, role, wage]);
    ({ rows: [{ id: serviceId }] } = await pool.query("INSERT INTO business_services(business_id,name,base_price_cents,duration_minutes,is_active) VALUES($1,'Tune',10000,60,TRUE) RETURNING id", [bizId]));
    const { router } = require('../routes/businessOwnerConsole');
    app = express(); app.use(express.json());
    app.use('/api/businesses', router);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('DELETE FROM businesses WHERE id=$1', [bizId]); await pool.end(); });

  test('246: acceptance rate over decided quotes, by person', async () => {
    const q = (status, total, reason) => pool.query("INSERT INTO business_quotes(business_id,client_name,title,line_items,subtotal_cents,total_cents,status,created_by,decline_reason) VALUES($1,'C','Q','[]',$2,$2,$3,$4,$5)", [bizId, total, status, manager, reason || null]);
    await q('approved', 10000); await q('converted', 30000); await q('declined', 5000, 'Too expensive'); await q('sent', 7000); await q('draft', 1);
    const r = (await request(app).get(`/api/businesses/${bizId}/owner/reports/quote-acceptance?period=30d`).set(as(manager)).expect(200)).body;
    expect(r.totals).toMatchObject({ sent: 4, accepted: 2, declined: 1, waiting: 1 });
    expect(r.acceptance_rate).toBeCloseTo(2 / 3);
    expect(r.average_accepted_cents).toBe(20000);
    expect(r.decline_reasons[0]).toEqual({ reason: 'Too expensive', n: 1 });
    expect(r.by_person[0]).toMatchObject({ user_id: manager, sent: 4, accepted: 2 });
    expect((await request(app).get(`/api/businesses/${bizId}/owner/reports/quote-acceptance?period=7y`).set(as(manager))).status).toBe(400);
    expect((await request(app).get(`/api/businesses/${bizId}/owner/reports/quote-acceptance`).set(as(employee))).status).toBe(403);
  });

  test('247 + 248: utilization and quality trends', async () => {
    for (let dow = 0; dow < 7; dow++) await pool.query("INSERT INTO business_staff_availability(business_id,user_id,day_of_week,start_time,end_time) VALUES($1,$2,$3,'09:00','11:00')", [bizId, employee, dow]);
    const { rows: [a] } = await pool.query("INSERT INTO business_appointments(business_id,service_id,staff_id,start_time,end_time,status,feedback_rating,customer_id) VALUES($1,$2,$3,NOW()-interval '3 days',NOW()-interval '3 days'+interval '7 hours','completed',4,$4) RETURNING id", [bizId, serviceId, employee, owner]);
    await pool.query("INSERT INTO business_appointments(business_id,service_id,staff_id,start_time,end_time,status) VALUES($1,$2,$3,NOW()-interval '2 days',NOW()-interval '2 days'+interval '1 hour','no_show')", [bizId, serviceId, employee]);
    await pool.query("INSERT INTO business_service_issues(business_id,appointment_id,reporter_id,request_id,category,description) VALUES($1,$2,$3,$4,'quality','The paint was uneven in places')", [bizId, a.id, owner, crypto.randomUUID()]);
    const u = (await request(app).get(`/api/businesses/${bizId}/owner/reports/utilization?period=30d`).set(as(manager)).expect(200)).body;
    const emp = u.people.find(p => p.user_id === employee);
    expect(emp).toMatchObject({ scheduled_hours: 60, booked_hours: 7, visits: 1 });
    expect(emp.utilization).toBeCloseTo(7 / 60);
    const q = (await request(app).get(`/api/businesses/${bizId}/owner/reports/quality`).set(as(manager)).expect(200)).body;
    expect(q.months).toHaveLength(12);
    const total = q.months.reduce((n, m) => ({ completed: n.completed + m.completed, issues: n.issues + m.issues, no_shows: n.no_shows + m.no_shows }), { completed: 0, issues: 0, no_shows: 0 });
    expect(total).toEqual({ completed: 1, issues: 1, no_shows: 1 });
    expect(q.services[0]).toMatchObject({ name: 'Tune', completed: 1, issues: 1, avg_rating: 4, issue_rate: 1 });
  });

  test('249 + 250: cost snapshots freeze closed months; recurring revenue normalizes to monthly', async () => {
    const { rows: [{ m }] } = await pool.query("SELECT to_char(date_trunc('month', NOW()) - interval '1 month','YYYY-MM') AS m");
    await pool.query("INSERT INTO business_invoices(user_id,business_id,invoice_number,client_name,status,total,amount_paid,paid_at) VALUES($1,$2,$3,'C','paid',500,500,($4 || '-10')::date)", [owner, bizId, `R-${bizId}`, m]);
    await pool.query("INSERT INTO business_expenses(business_id,category,description,amount_cents,expense_date,created_by,approval_status) VALUES($1,'materials','Wood',10000,($2 || '-05')::date,$3,'approved'),($1,'vehicle','Fuel',99999,($2 || '-05')::date,$3,'pending')", [bizId, m, owner]);
    await pool.query("INSERT INTO business_time_entries(business_id,user_id,entry_date,hours_worked) VALUES($1,$2,($3 || '-06')::date,10)", [bizId, employee, m]);
    const live = (await request(app).get(`/api/businesses/${bizId}/owner/reports/costs?month=${m}`).set(as(manager)).expect(200)).body.live;
    expect(live).toMatchObject({ revenue_cents: '50000', expense_cents: '10000', labor_cents: '20000', labor_hours: 10, margin_cents: 20000, expenses_by_category: { materials: 10000 } });
    const cur = new Date().toISOString().slice(0, 7);
    expect((await request(app).post(`/api/businesses/${bizId}/owner/reports/costs/snapshots`).set(as(manager)).send({ month: cur })).body.code).toBe('month_not_closed');
    const s1 = (await request(app).post(`/api/businesses/${bizId}/owner/reports/costs/snapshots`).set(as(manager)).send({ month: m }).expect(201)).body;
    const s2 = (await request(app).post(`/api/businesses/${bizId}/owner/reports/costs/snapshots`).set(as(manager)).send({ month: m, note: 'restated' }).expect(201)).body;
    expect([s1.version, s2.version]).toEqual([1, 2]);
    expect((await request(app).get(`/api/businesses/${bizId}/owner/reports/costs`).set(as(owner))).body.snapshots[0]).toMatchObject({ month: m, version: 2 });

    const rb = (amt, freq, status) => pool.query("INSERT INTO business_recurring_billing(business_id,client_name,description,amount_cents,frequency,next_billing_date,status) VALUES($1,$2,'Plan',$3,$4,CURRENT_DATE + 5,$5)", [bizId, `Client ${freq}`, amt, freq, status]);
    await rb(1200, 'weekly', 'active'); await rb(9000, 'quarterly', 'active'); await rb(5000, 'monthly', 'paused'); await rb(2000, 'monthly', 'cancelled');
    const r = (await request(app).get(`/api/businesses/${bizId}/owner/reports/recurring`).set(as(manager)).expect(200)).body;
    expect(r).toMatchObject({ mrr_cents: 5200 + 3000, arr_cents: 8200 * 12, active: 2, paused: 1, paused_mrr_cents: 5000, churned_90d: 1, churned_mrr_90d_cents: 2000 });
    expect(r.upcoming).toHaveLength(2);
    expect((await request(app).get(`/api/businesses/${bizId}/owner/reports/recurring`).set(as(employee))).status).toBe(403);
  });
});
