'use strict';
// Groups 5-6 items 252-260: responsibility, onboarding, permission help, queue, matching, conflicts, dispatch.
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
const owner = crypto.randomUUID(), manager = crypto.randomUUID(), employee = crypto.randomUUID(), other = crypto.randomUUID();
let app, bizId, serviceId, otherBiz;
const as = (u) => ({ 'x-user': u });

describeDb('Groups 5-6: team member start and dispatch', () => {
  const at = h => new Date(Date.now() + h * 36e5).toISOString();
  const mk = (staff, h, len = 1) => pool.query("INSERT INTO business_appointments(business_id,service_id,staff_id,start_time,end_time,status) VALUES($1,$2,$3,$4,$5,'confirmed') RETURNING id", [bizId, serviceId, staff, at(h), at(h + len)]).then(r => r.rows[0].id);
  beforeAll(async () => {
    for (const id of [owner, manager, employee, other]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Work','User','customer',TRUE,TRUE,'555-0100')", [id, `g56w-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Crew Co','service',TRUE,'UTC') RETURNING id", [owner]));
    for (const [id, role] of [[manager, 'manager'], [employee, 'employee'], [other, 'employee']]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,$5,'active',NOW())", [bizId, owner, id, `g56w-${id}@x.invalid`, role]);
    ({ rows: [{ id: serviceId }] } = await pool.query("INSERT INTO business_services(business_id,name,base_price_cents,duration_minutes,is_active) VALUES($1,'Clean',10000,60,TRUE) RETURNING id", [bizId]));
    await pool.query('INSERT INTO business_service_staff(service_id,staff_id,is_available) VALUES($1,$2,TRUE),($1,$3,TRUE)', [serviceId, employee, other]);
    for (let d = 0; d < 7; d++) await pool.query("INSERT INTO business_staff_availability(business_id,user_id,day_of_week,start_time,end_time) VALUES($1,$2,$3,'00:00','23:59')", [bizId, employee, d]);
    const { router } = require('../routes/businessOwnerConsole');
    app = express(); app.use(express.json());
    app.use('/api/businesses', router);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('DELETE FROM businesses WHERE id=$1', [bizId]); await pool.end(); });

  test('252 + 254: responsibility overview and onboarding checklist', async () => {
    const me = (await request(app).get(`/api/businesses/${bizId}/work/me`).set(as(employee)).expect(200)).body;
    expect(me).toMatchObject({ role: 'employee', member_type: 'staff', services: [{ name: 'Clean' }] });
    expect(me.permissions).toContain('business.view');
    expect(me.managers.map(m => m.role).sort()).toEqual(['manager', 'owner']);
    const ob = (await request(app).get(`/api/businesses/${bizId}/work/onboarding`).set(as(employee)).expect(200)).body;
    expect(Object.fromEntries(ob.items.map(i => [i.key, i.done]))).toEqual({ phone: true, availability: true, documents: true, services: true, first_shift: false });
    expect((await request(app).get(`/api/businesses/${bizId}/work/me`).set(as(crypto.randomUUID()))).status).toBe(404);
  });

  test('254: first-shift confirmations record explicitly and persist', async () => {
    const byKey = (ob) => Object.fromEntries(ob.confirm_items.map((i) => [i.key, i]));
    const before = (await request(app).get(`/api/businesses/${bizId}/work/onboarding`).set(as(employee)).expect(200)).body;
    expect(Object.keys(byKey(before)).sort()).toEqual(['contact', 'first_task', 'location', 'role']);
    // Role and contact have something to confirm (membership + phone on
    // file); location and first task do not yet, so they cannot be confirmed.
    expect(byKey(before).role).toMatchObject({ done: false, can_confirm: true, detail: 'employee' });
    expect(byKey(before).contact).toMatchObject({ done: false, can_confirm: true, detail: '555-0100' });
    expect(byKey(before).location).toMatchObject({ done: false, can_confirm: false, detail: null });
    expect(byKey(before).first_task).toMatchObject({ done: false, can_confirm: false, detail: null });
    expect(before.confirm_complete).toBe(false);

    // Confirming an unready step fails closed; an unknown item is invalid.
    expect((await request(app).post(`/api/businesses/${bizId}/work/onboarding/confirm`).set(as(employee)).send({ item: 'location' })).body.code).toBe('onboarding_not_ready');
    expect((await request(app).post(`/api/businesses/${bizId}/work/onboarding/confirm`).set(as(employee)).send({ item: 'nope' })).body.code).toBe('validation_failed');

    // Role confirms, persists, and re-confirming is idempotent.
    expect((await request(app).post(`/api/businesses/${bizId}/work/onboarding/confirm`).set(as(employee)).send({ item: 'role' }).expect(200)).body).toMatchObject({ item: 'role', done: true });
    await request(app).post(`/api/businesses/${bizId}/work/onboarding/confirm`).set(as(employee)).send({ item: 'role' }).expect(200);
    const afterRole = (await request(app).get(`/api/businesses/${bizId}/work/onboarding`).set(as(employee)).expect(200)).body;
    expect(byKey(afterRole).role.done).toBe(true);

    // A first task makes the first-task step confirmable.
    const appt = await mk(employee, 72);
    const withTask = (await request(app).get(`/api/businesses/${bizId}/work/onboarding`).set(as(employee)).expect(200)).body;
    expect(byKey(withTask).first_task).toMatchObject({ done: false, can_confirm: true });
    expect(byKey(withTask).first_task.detail.label).toBe('Clean');
    await request(app).post(`/api/businesses/${bizId}/work/onboarding/confirm`).set(as(employee)).send({ item: 'first_task' }).expect(200);
    await pool.query("UPDATE business_appointments SET status='cancelled' WHERE id=$1", [appt]);
  });

  test('255 + 288: permission help request, explained denial, approval grants an override', async () => {
    const chk = (await request(app).get(`/api/businesses/${bizId}/work/access-check?code=customers.view_all`).set(as(employee)).expect(200)).body;
    expect(chk).toMatchObject({ allowed: false, reason: 'not_in_role', can_request: true });
    expect((await request(app).post(`/api/businesses/${bizId}/work/permission-requests`).set(as(employee)).send({ permission_code: 'payouts.manage', reason: 'Need it' })).body.code).toBe('permission_not_requestable');
    const r = (await request(app).post(`/api/businesses/${bizId}/work/permission-requests`).set(as(employee)).send({ permission_code: 'customers.view_all', reason: 'Call clients back', duration_days: 30 }).expect(201)).body;
    expect((await request(app).post(`/api/businesses/${bizId}/work/permission-requests`).set(as(employee)).send({ permission_code: 'customers.view_all', reason: 'Again please' })).body.code).toBe('permission_request_pending');
    expect((await request(app).get(`/api/businesses/${bizId}/owner/permission-requests`).set(as(employee))).status).toBe(403);
    expect((await request(app).get(`/api/businesses/${bizId}/owner/permission-requests`).set(as(manager))).body.requests).toHaveLength(1);
    await request(app).post(`/api/businesses/${bizId}/owner/permission-requests/${r.id}/decision`).set(as(manager)).send({ decision: 'approve' }).expect(200);
    const after = (await request(app).get(`/api/businesses/${bizId}/work/access-check?code=customers.view_all`).set(as(employee))).body;
    expect(after.allowed).toBe(true);
    const r2 = (await request(app).post(`/api/businesses/${bizId}/work/permission-requests`).set(as(employee)).send({ permission_code: 'payroll.view', reason: 'See my pay history' }).expect(201)).body;
    expect((await request(app).post(`/api/businesses/${bizId}/owner/permission-requests/${r2.id}/decision`).set(as(manager)).send({ decision: 'approve' })).body.code).toBe('cannot_grant_unheld');
  });

  test('256 + 257 + 258: queue claim honors policy, qualification and conflicts; matches rank candidates', async () => {
    const open = await mk(null, 48);
    const q = (await request(app).get(`/api/businesses/${bizId}/work/queue`).set(as(employee)).expect(200)).body;
    expect(q.self_claim).toBe(false);
    expect(q.visits.map(v => v.id)).toContain(open);
    expect((await request(app).post(`/api/businesses/${bizId}/work/queue/${open}/claim`).set(as(employee))).body.code).toBe('self_claim_disabled');
    await pool.query('INSERT INTO business_operating_policies(business_id,allow_self_claim) VALUES($1,TRUE) ON CONFLICT (business_id) DO UPDATE SET allow_self_claim=TRUE', [bizId]);
    expect((await request(app).post(`/api/businesses/${bizId}/work/queue/${open}/claim`).set(as(manager))).body.code).toBe('not_qualified');
    const m = (await request(app).get(`/api/businesses/${bizId}/owner/appointments/${open}/matches`).set(as(manager)).expect(200)).body;
    expect(m.candidates[0]).toMatchObject({ user_id: employee, qualified: true, available: true, eligible: true });
    await request(app).post(`/api/businesses/${bizId}/work/queue/${open}/claim`).set(as(employee)).expect(200);
    expect((await request(app).post(`/api/businesses/${bizId}/work/queue/${open}/claim`).set(as(other))).body.code).toBe('already_assigned');
    const clash = await mk(null, 48);
    expect((await request(app).post(`/api/businesses/${bizId}/work/queue/${clash}/claim`).set(as(employee))).body.code).toBe('schedule_conflict');
    await pool.query("INSERT INTO business_appointment_crew(appointment_id,user_id,business_id) VALUES($1,$2,$3)", [clash, employee, bizId]);
    const w = (await request(app).get(`/api/businesses/${bizId}/work/conflicts`).set(as(employee)).expect(200)).body;
    expect(w.warnings.map(x => x.warnings)).toEqual([['overlap'], ['overlap']]);
    await pool.query("UPDATE business_appointments SET status='cancelled' WHERE id=$1", [clash]);
  });

  test('260: dispatch confirm / decline; release window', async () => {
    const a = await mk(employee, 72);
    await pool.query("UPDATE business_appointments SET dispatch_status='pending' WHERE id=$1", [a]);
    expect((await request(app).get(`/api/businesses/${bizId}/owner/dispatch`).set(as(manager))).body.pending.map(p => p.id)).toContain(a);
    expect((await request(app).post(`/api/businesses/${bizId}/work/appointments/${a}/dispatch`).set(as(other)).send({ response: 'confirm' })).status).toBe(404);
    expect((await request(app).post(`/api/businesses/${bizId}/work/appointments/${a}/dispatch`).set(as(employee)).send({ response: 'decline' })).status).toBe(400);
    await request(app).post(`/api/businesses/${bizId}/work/appointments/${a}/dispatch`).set(as(employee)).send({ response: 'confirm' }).expect(200);
    const d = (await request(app).post(`/api/businesses/${bizId}/work/appointments/${a}/dispatch`).set(as(employee)).send({ response: 'decline', note: 'Car broke down' }).expect(200)).body;
    expect(d.staff_id).toBeNull();
    const ev = (await pool.query('SELECT source FROM business_appointment_assignment_events WHERE appointment_id=$1 ORDER BY id', [a])).rows.map(r => r.source);
    expect(ev).toEqual(['confirm', 'decline']);
    const soon = await mk(employee, 5);
    expect((await request(app).post(`/api/businesses/${bizId}/work/appointments/${soon}/release`).set(as(employee)).send({})).body.code).toBe('release_too_late');
    const later = await mk(employee, 100);
    expect((await request(app).post(`/api/businesses/${bizId}/work/appointments/${later}/release`).set(as(employee)).send({ reason: 'Exam' }).expect(200)).body.staff_id).toBeNull();
  });
});
