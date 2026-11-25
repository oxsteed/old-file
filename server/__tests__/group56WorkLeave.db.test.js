'use strict';
// Groups 5-6 items 291-300: handovers, task owner replacement, delegation, transfer, end-of-shift, leaving.
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

describeDb('Groups 5-6: team member continuity and leave', () => {
  const at = h => new Date(Date.now() + h * 36e5).toISOString();
  const mk = (staff, h, len = 1) => pool.query("INSERT INTO business_appointments(business_id,service_id,staff_id,start_time,end_time,status) VALUES($1,$2,$3,$4,$5,'confirmed') RETURNING id", [bizId, serviceId, staff, at(h), at(h + len)]).then(r => r.rows[0].id);
  beforeAll(async () => {
    for (const id of [owner, manager, employee, other]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Work','User','customer',TRUE,TRUE,'555-0100')", [id, `g56l-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Leave Co','service',TRUE,'UTC') RETURNING id", [owner]));
    for (const [id, role] of [[manager, 'manager'], [employee, 'employee'], [other, 'employee']]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,$5,'active',NOW())", [bizId, owner, id, `g56l-${id}@x.invalid`, role]);
    ({ rows: [{ id: serviceId }] } = await pool.query("INSERT INTO business_services(business_id,name,base_price_cents,duration_minutes,is_active) VALUES($1,'Clean',10000,60,TRUE) RETURNING id", [bizId]));
    await pool.query('INSERT INTO business_service_staff(service_id,staff_id,is_available) VALUES($1,$2,TRUE),($1,$3,TRUE)', [serviceId, employee, other]);
    for (let d = 0; d < 7; d++) await pool.query("INSERT INTO business_staff_availability(business_id,user_id,day_of_week,start_time,end_time) VALUES($1,$2,$3,'00:00','23:59')", [bizId, employee, d]);
    const { router } = require('../routes/businessOwnerConsole');
    app = express(); app.use(express.json());
    app.use('/api/businesses', router);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('UPDATE businesses SET deleted_at=NOW(), is_active=FALSE WHERE id=$1', [bizId]); await pool.end(); });


  const B = () => `/api/businesses/${bizId}`;
  const task = (who, h = 24) => pool.query("INSERT INTO business_team_tasks(business_id,assignee_id,created_by,request_id,kind,title,due_at,status) VALUES($1,$2,$3,gen_random_uuid(),'task','Restock',$4,'open') RETURNING id", [bizId, who, manager, at(h)]).then(r => r.rows[0].id);
  test('291: shift handover and acknowledgment', async () => {
    const hnd = (await request(app).post(`${B()}/work/handovers`).set(as(employee)).send({ to_user_id: other, summary: 'Van keys in office', open_items: ['Call Mrs. Lee'] }).expect(201)).body;
    await request(app).post(`${B()}/work/handovers/${hnd.id}/ack`).set(as(employee)).expect(404);
    expect((await request(app).get(`${B()}/work/handovers`).set(as(other)).expect(200)).body.received[0].id).toBe(hnd.id);
    expect((await request(app).post(`${B()}/work/handovers/${hnd.id}/ack`).set(as(other)).expect(200)).body.acknowledged_at).toBeTruthy();
  });
  test('292, 294: task owner replacement and unfinished-work transfer leave a history', async () => {
    const t1 = await task(employee), t2 = await task(employee);
    await request(app).post(`${B()}/owner/team-tasks/${t1}/owner`).set(as(employee)).send({ to_user_id: other }).expect(403);
    await request(app).post(`${B()}/owner/team-tasks/${t1}/owner`).set(as(manager)).send({ to_user_id: other, reason: 'Workload' }).expect(200);
    await request(app).post(`${B()}/work/tasks/transfer`).set(as(employee)).send({ to_user_id: other, task_ids: [t1] }).expect(404);
    expect((await request(app).post(`${B()}/work/tasks/transfer`).set(as(employee)).send({ to_user_id: other, task_ids: [t2] }).expect(200)).body.moved).toBe(1);
    const h = (await request(app).get(`${B()}/work/tasks/${t1}/history`).set(as(employee)).expect(200)).body;
    expect(h.events[0]).toMatchObject({ from_user_id: employee, to_user_id: other, reason: 'Workload' });
  });
  test('293: absence delegation moves tasks and flags visits for a manager', async () => {
    const t = await task(employee, 30);
    await mk(employee, 30);
    const d = (await request(app).post(`${B()}/work/delegations`).set(as(employee)).send({ delegate_id: other, starts_at: at(1), ends_at: at(48) }).expect(201)).body;
    await request(app).post(`${B()}/work/delegations`).set(as(employee)).send({ delegate_id: other, starts_at: at(2), ends_at: at(40) }).expect(409);
    await request(app).post(`${B()}/work/delegations/${d.id}/respond`).set(as(employee)).send({ response: 'accept' }).expect(404);
    const r = (await request(app).post(`${B()}/work/delegations/${d.id}/respond`).set(as(other)).send({ response: 'accept' }).expect(200)).body;
    expect(r.delegation).toMatchObject({ status: 'accepted', moved_count: 1, skipped_count: 1 });
    const { rows: [moved] } = await pool.query('SELECT assignee_id FROM business_team_tasks WHERE id=$1', [t]);
    expect(moved.assignee_id).toBe(other);
  });
  test('295: end-of-shift review lists unresolved work and saves once per day', async () => {
    const a = await mk(employee, 0.01);
    await pool.query("UPDATE business_appointments SET status='in_progress' WHERE id=$1", [a]);
    const s = (await request(app).get(`${B()}/work/end-of-shift`).set(as(employee)).expect(200)).body;
    expect(s.unresolved.in_progress).toContain(a);
    const r1 = (await request(app).put(`${B()}/work/end-of-shift`).set(as(employee)).send({ notes: 'Ran late' }).expect(200)).body;
    const r2 = (await request(app).put(`${B()}/work/end-of-shift`).set(as(employee)).send({ notes: 'Ran late, finishing tomorrow' }).expect(200)).body;
    expect(r2.id).toBe(r1.id);
    await pool.query("UPDATE business_appointments SET status='completed', completed_at=NOW() WHERE id=$1", [a]);
  });
  test('296-300: leave preview, owner blocked, leaving moves work and clears the workspace', async () => {
    expect((await request(app).get(`${B()}/work/leave-preview`).set(as(owner)).expect(200)).body.blockers).toContain('owner_must_transfer');
    const t = await task(other);
    await pool.query('INSERT INTO user_workspace_contexts(user_id,business_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [other, bizId]);
    const p = (await request(app).get(`${B()}/work/leave-preview`).set(as(other)).expect(200)).body;
    expect(p).toMatchObject({ can_leave: true });
    expect(p.counts.open_tasks).toBeGreaterThan(0);
    await request(app).post(`${B()}/work/leave`).set(as(other)).send({}).expect(400);
    const r = (await request(app).post(`${B()}/work/leave`).set(as(other)).send({ confirm: true }).expect(200)).body;
    expect(r).toMatchObject({ left: true, redirect: '/dashboard', work_moved_to: manager });
    const { rows: [m] } = await pool.query('SELECT status FROM business_members WHERE business_id=$1 AND member_id=$2', [bizId, other]);
    expect(m.status).toBe('revoked');
    const { rows: [tt] } = await pool.query('SELECT assignee_id FROM business_team_tasks WHERE id=$1', [t]);
    expect(tt.assignee_id).toBe(manager);
    const { rows: ctxRows } = await pool.query('SELECT 1 FROM user_workspace_contexts WHERE user_id=$1 AND business_id=$2', [other, bizId]);
    expect(ctxRows).toHaveLength(0);
    const { rows: [o] } = await pool.query('SELECT 1 FROM staff_offboarding_records WHERE business_id=$1 AND user_id=$2', [bizId, other]);
    expect(o).toBeTruthy();
    await request(app).get(`${B()}/work/leave-preview`).set(as(other)).expect(404);
  });
});
