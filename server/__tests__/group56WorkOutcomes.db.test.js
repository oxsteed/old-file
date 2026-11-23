'use strict';
// Groups 5-6 items 281-283, 285: completion records, materials, assignment trail, feedback routing.
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

describeDb('Groups 5-6: team member outcomes', () => {
  const at = h => new Date(Date.now() + h * 36e5).toISOString();
  const mk = (staff, h, len = 1) => pool.query("INSERT INTO business_appointments(business_id,service_id,staff_id,start_time,end_time,status) VALUES($1,$2,$3,$4,$5,'confirmed') RETURNING id", [bizId, serviceId, staff, at(h), at(h + len)]).then(r => r.rows[0].id);
  beforeAll(async () => {
    for (const id of [owner, manager, employee, other]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Work','User','customer',TRUE,TRUE,'555-0100')", [id, `g56o-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Outcome Co','service',TRUE,'UTC') RETURNING id", [owner]));
    for (const [id, role] of [[manager, 'manager'], [employee, 'employee'], [other, 'employee']]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,$5,'active',NOW())", [bizId, owner, id, `g56o-${id}@x.invalid`, role]);
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
  test('281: completion record, and the optional completed-status gate', async () => {
    const a = await mk(employee, -2);
    await pool.query("UPDATE business_appointments SET status='in_progress' WHERE id=$1", [a]);
    await pool.query("INSERT INTO business_operating_policies(business_id, require_completion_record) VALUES($1, TRUE) ON CONFLICT (business_id) DO UPDATE SET require_completion_record=TRUE", [bizId]);
    const ws = require('../services/businessOwner/workOutcomesService');
    await expect(ws.assertCompletionRecord(pool, bizId, a)).rejects.toMatchObject({ code: 'completion_record_required' });
    await request(app).put(`${B()}/work/appointments/${a}/completion`).set(as(other)).send({ summary: 'All done here' }).expect(404);
    await request(app).put(`${B()}/work/appointments/${a}/completion`).set(as(employee)).send({ summary: 'All done', follow_up_needed: true }).expect(400);
    const r = (await request(app).put(`${B()}/work/appointments/${a}/completion`).set(as(employee)).send({ summary: 'All done here', follow_up_needed: true, follow_up_note: 'Return for trim' }).expect(200)).body;
    expect(r.version).toBe(1);
    await request(app).put(`${B()}/work/appointments/${a}/completion`).set(as(employee)).send({ summary: 'All done here v2', expectedVersion: 5 }).expect(409);
    await expect(ws.assertCompletionRecord(pool, bizId, a)).resolves.toBeUndefined();
    const g = (await request(app).get(`${B()}/work/appointments/${a}/completion`).set(as(manager)).expect(200)).body;
    expect(g).toMatchObject({ required: true, record: { summary: 'All done here' } });
  });
  test('282-283: materials and assignment history', async () => {
    const a = await mk(employee, 4);
    await request(app).post(`${B()}/work/appointments/${a}/materials`).set(as(employee)).send({ name: 'Grout', quantity: 0 }).expect(400);
    const m = (await request(app).post(`${B()}/work/appointments/${a}/materials`).set(as(employee)).send({ name: 'Grout', quantity: 2, unit: 'bag', cost_cents: 1250 }).expect(201)).body;
    expect((await request(app).get(`${B()}/work/appointments/${a}/materials`).set(as(manager)).expect(200)).body.total_cost_cents).toBe(1250);
    await pool.query("INSERT INTO business_appointment_assignment_events(appointment_id,business_id,from_staff_id,to_staff_id,actor_id,source) VALUES($1,$2,$3,$4,$5,'reassign')", [a, bizId, other, employee, manager]);
    const h = (await request(app).get(`${B()}/work/appointments/${a}/assignment-history`).set(as(employee)).expect(200)).body;
    expect(h.events[0]).toMatchObject({ event: 'reassign', to_user: employee, actor_name: 'Work User' });
    await request(app).delete(`${B()}/work/materials/${m.id}`).set(as(employee)).expect(200);
  });
  test('285: low ratings become routed follow-ups; the worker cannot close their own', async () => {
    const a = await mk(employee, -30);
    await pool.query("UPDATE business_appointments SET status='completed', completed_at=NOW(), feedback_rating=2 WHERE id=$1", [a]);
    const q = (await request(app).get(`${B()}/owner/feedback-followups`).set(as(manager)).expect(200)).body;
    const f = q.followups.find(x => x.appointment_id === a);
    expect(f).toMatchObject({ rating: 2, routed_to: manager });
    expect((await request(app).get(`${B()}/work/feedback`).set(as(employee)).expect(200)).body.feedback[0]).toMatchObject({ rating: 2, follow_up_status: 'open' });
    await request(app).patch(`${B()}/owner/feedback-followups/${f.id}`).set(as(manager)).send({ status: 'resolved' }).expect(400);
    const r = (await request(app).patch(`${B()}/owner/feedback-followups/${f.id}`).set(as(manager)).send({ status: 'resolved', note: 'Called, offered redo' }).expect(200)).body;
    expect(r.status).toBe('resolved');
  });
});
