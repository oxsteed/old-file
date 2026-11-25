'use strict';
// Groups 5-6 items 261-270, 286-290: work board, checklists, progress, exceptions, crews, documents.
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

describeDb('Groups 5-6: team member jobs and crews', () => {
  const at = h => new Date(Date.now() + h * 36e5).toISOString();
  const mk = (staff, h, len = 1) => pool.query("INSERT INTO business_appointments(business_id,service_id,staff_id,start_time,end_time,status) VALUES($1,$2,$3,$4,$5,'confirmed') RETURNING id", [bizId, serviceId, staff, at(h), at(h + len)]).then(r => r.rows[0].id);
  beforeAll(async () => {
    for (const id of [owner, manager, employee, other]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Work','User','customer',TRUE,TRUE,'555-0100')", [id, `g56j-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Jobs Co','service',TRUE,'UTC') RETURNING id", [owner]));
    for (const [id, role] of [[manager, 'manager'], [employee, 'employee'], [other, 'employee']]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,$5,'active',NOW())", [bizId, owner, id, `g56j-${id}@x.invalid`, role]);
    ({ rows: [{ id: serviceId }] } = await pool.query("INSERT INTO business_services(business_id,name,base_price_cents,duration_minutes,is_active) VALUES($1,'Clean',10000,60,TRUE) RETURNING id", [bizId]));
    await pool.query('INSERT INTO business_service_staff(service_id,staff_id,is_available) VALUES($1,$2,TRUE),($1,$3,TRUE)', [serviceId, employee, other]);
    for (let d = 0; d < 7; d++) await pool.query("INSERT INTO business_staff_availability(business_id,user_id,day_of_week,start_time,end_time) VALUES($1,$2,$3,'00:00','23:59')", [bizId, employee, d]);
    const { router } = require('../routes/businessOwnerConsole');
    app = express(); app.use(express.json());
    app.use('/api/businesses', router);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('DELETE FROM businesses WHERE id=$1', [bizId]); await pool.end(); });


  const B = () => `/api/businesses/${bizId}`;
  test('261-262: board lanes and checklist seeded from the service template', async () => {
    const a = await mk(employee, 1);
    await request(app).put(`${B()}/owner/services/${serviceId}/checklist`).set(as(manager)).send({ items: [{ label: 'Photos before' }, { label: 'Sweep', required: false }] }).expect(200);
    const board = (await request(app).get(`${B()}/work/board`).set(as(employee)).expect(200)).body;
    expect([...board.lanes.today, ...board.lanes.upcoming].map(x => x.id)).toContain(a);
    const cl = (await request(app).get(`${B()}/work/appointments/${a}/checklist`).set(as(employee)).expect(200)).body;
    const items = cl.items || cl;
    expect(items.map(i => i.label)).toEqual(['Photos before', 'Sweep']);
    const done = (await request(app).patch(`${B()}/work/appointments/${a}/checklist/${items[0].id}`).set(as(employee)).send({ done: true }).expect(200)).body;
    expect(done.done_at).toBeTruthy();
    await request(app).get(`${B()}/work/appointments/${a}/checklist`).set(as(other)).expect(404);
  });
  test('264: progress updates are visible to managers', async () => {
    const a = await mk(employee, 3);
    await request(app).post(`${B()}/work/appointments/${a}/progress`).set(as(employee)).send({ note: 'Halfway there', percent: 50 }).expect(201);
    await request(app).post(`${B()}/work/appointments/${a}/progress`).set(as(employee)).send({ note: 'x', percent: 150 }).expect(400);
    const p = (await request(app).get(`${B()}/work/appointments/${a}/progress`).set(as(manager)).expect(200)).body;
    expect(p.updates[0]).toMatchObject({ percent: 50, note: 'Halfway there' });
  });
  test('265, 286-290: exceptions route, are idempotent, cannot be self-resolved, and escalate when overdue', async () => {
    const a = await mk(employee, 5);
    const send = { kind: 'missing_instruction', category: 'access_code', description: 'No gate code given', appointment_id: a, request_id: 'r-1' };
    const e = (await request(app).post(`${B()}/work/exceptions`).set(as(employee)).send(send).expect(201)).body;
    expect(e.routed_to).toBeTruthy();
    const again = (await request(app).post(`${B()}/work/exceptions`).set(as(employee)).send(send).expect(201)).body;
    expect(again.id).toBe(e.id);
    await request(app).post(`${B()}/work/exceptions`).set(as(employee)).send({ ...send, kind: 'incident', category: 'weather', request_id: 'r-2' }).expect(400);
    await request(app).patch(`${B()}/work/exceptions/${e.id}`).set(as(employee)).send({ status: 'resolved', resolution: 'done' }).expect(403);
    await request(app).post(`${B()}/work/exceptions/${e.id}/escalate`).set(as(employee)).expect(409);
    await pool.query("UPDATE business_work_exceptions SET created_at=NOW()-INTERVAL '5 hours' WHERE id=$1", [e.id]);
    const esc = (await request(app).post(`${B()}/work/exceptions/${e.id}/escalate`).set(as(employee)).expect(200)).body;
    expect(esc).toMatchObject({ escalation_level: 1, routed_to: owner });
    const q = (await request(app).get(`${B()}/owner/exceptions`).set(as(manager)).expect(200)).body;
    expect(q.exceptions.map(x => x.id)).toContain(e.id);
    const r = (await request(app).patch(`${B()}/work/exceptions/${e.id}`).set(as(owner)).send({ status: 'resolved', resolution: 'Code is 1234' }).expect(200)).body;
    expect(r.status).toBe('resolved');
    await request(app).patch(`${B()}/work/exceptions/${e.id}`).set(as(owner)).send({ status: 'dismissed', resolution: 'x' }).expect(409);
  });
  test('266-267, 270: crews, allocation with conflicts, crew tasks and attendance', async () => {
    const crew = (await request(app).post(`${B()}/owner/crews`).set(as(manager)).send({ name: 'Alpha', lead_user_id: employee, member_ids: [other] }).expect(201)).body;
    await request(app).post(`${B()}/owner/crews`).set(as(manager)).send({ name: 'Alpha' }).expect(409);
    const list = (await request(app).get(`${B()}/work/crews`).set(as(employee)).expect(200)).body;
    expect(list.crews.find(c => c.id === crew.id).members).toHaveLength(2);
    const a = await mk(employee, 30);
    await request(app).put(`${B()}/owner/appointments/${a}/crew`).set(as(manager)).send({ members: [{ user_id: employee }] }).expect(400);
    const busy = await mk(other, 30);
    await request(app).put(`${B()}/owner/appointments/${a}/crew`).set(as(manager)).send({ members: [{ user_id: other }] }).expect(409);
    await pool.query("UPDATE business_appointments SET status='cancelled' WHERE id=$1", [busy]);
    const c = (await request(app).put(`${B()}/owner/appointments/${a}/crew`).set(as(manager)).send({ members: [{ user_id: other, task_note: 'Windows' }] }).expect(200)).body;
    expect(c.crew).toEqual([expect.objectContaining({ user_id: other, attendance: 'pending', task_note: 'Windows' })]);
    await request(app).patch(`${B()}/work/appointments/${a}/crew/${other}`).set(as(other)).send({ task_note: 'none' }).expect(403);
    await request(app).patch(`${B()}/work/appointments/${a}/crew/${other}`).set(as(employee)).send({ task_note: 'Windows + doors' }).expect(200);
    await request(app).post(`${B()}/work/appointments/${a}/attendance`).set(as(other)).send({ response: 'check_in' }).expect(409);
    const r = (await request(app).post(`${B()}/work/appointments/${a}/attendance`).set(as(other)).send({ response: 'confirm' }).expect(200)).body;
    expect(r.attendance).toBe('confirmed');
  });
  test('268-269: subcontractor scope and assignment-only documents', async () => {
    const { rows: [m] } = await pool.query('SELECT id FROM business_members WHERE business_id=$1 AND member_id=$2', [bizId, other]);
    const ws = require('../services/businessOwner/workJobsService');
    await ws.applySubcontractorScope(pool, m.id, owner, 'Glass LLC');
    const { rows: [mm] } = await pool.query('SELECT member_type, company_name FROM business_members WHERE id=$1', [m.id]);
    expect(mm).toEqual({ member_type: 'subcontractor', company_name: 'Glass LLC' });
    const { rows: deny } = await pool.query("SELECT COUNT(*)::int n FROM membership_permission_overrides WHERE membership_id=$1 AND effect='deny'", [m.id]);
    expect(deny[0].n).toBeGreaterThan(3);
    const a = await mk(employee, 50);
    await request(app).post(`${B()}/owner/appointments/${a}/documents`).set(as(manager)).send({ title: 'Plan', url: 'http://insecure' }).expect(400);
    const d = (await request(app).post(`${B()}/owner/appointments/${a}/documents`).set(as(manager)).send({ title: 'Plan', body: 'Use side door' }).expect(201)).body;
    expect((await request(app).get(`${B()}/work/appointments/${a}/documents`).set(as(employee)).expect(200)).body.documents).toHaveLength(1);
    await request(app).get(`${B()}/work/appointments/${a}/documents`).set(as(other)).expect(404);
    await request(app).delete(`${B()}/owner/appointment-documents/${d.id}`).set(as(manager)).expect(200);
  });
});
