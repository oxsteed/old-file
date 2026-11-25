'use strict';
// Groups 5-6 items 273-275, 277, 280, 284: handoff summary, mentions, inbox, coverage, day view.
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

describeDb('Groups 5-6: team member comms and schedule', () => {
  const at = h => new Date(Date.now() + h * 36e5).toISOString();
  const mk = (staff, h, len = 1) => pool.query("INSERT INTO business_appointments(business_id,service_id,staff_id,start_time,end_time,status) VALUES($1,$2,$3,$4,$5,'confirmed') RETURNING id", [bizId, serviceId, staff, at(h), at(h + len)]).then(r => r.rows[0].id);
  beforeAll(async () => {
    for (const id of [owner, manager, employee, other]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Work','User','customer',TRUE,TRUE,'555-0100')", [id, `g56c-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Comms Co','service',TRUE,'UTC') RETURNING id", [owner]));
    for (const [id, role] of [[manager, 'manager'], [employee, 'employee'], [other, 'employee']]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,$5,'active',NOW())", [bizId, owner, id, `g56c-${id}@x.invalid`, role]);
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
  test('273-275, 284: handoff summary, ack, mentions and unread inbox', async () => {
    const a = await mk(employee, 2);
    await pool.query("INSERT INTO business_appointment_notes(appointment_id,created_by_id,note_type,content,is_pinned) VALUES($1,$2,'internal','Dog in yard',TRUE)", [a, manager]);
    const hs = (await request(app).get(`${B()}/work/appointments/${a}/handoff`).set(as(employee)).expect(200)).body;
    expect(hs.notes[0]).toMatchObject({ content: 'Dog in yard', is_pinned: true });
    expect(hs.acknowledged_at).toBeNull();
    await request(app).get(`${B()}/work/appointments/${a}/handoff`).set(as(other)).expect(404);
    expect((await request(app).post(`${B()}/work/appointments/${a}/handoff/ack`).set(as(employee)).expect(200)).body.acknowledged_at).toBeTruthy();
    await request(app).post(`${B()}/work/appointments/${a}/team-notes`).set(as(employee)).send({ content: 'hi', mention_user_ids: [employee] }).expect(400);
    await request(app).post(`${B()}/work/appointments/${a}/team-notes`).set(as(employee)).send({ content: 'psst', mention_user_ids: [other] }).expect(409);
    const n = (await request(app).post(`${B()}/work/appointments/${a}/team-notes`).set(as(employee)).send({ content: 'Can you bring a ladder?', mention_user_ids: [manager] }).expect(201)).body;
    const ib = (await request(app).get(`${B()}/work/inbox`).set(as(manager)).expect(200)).body;
    expect(ib.items.find(i => i.kind === 'mention' && i.id === n.note.id)).toBeTruthy();
    expect(ib.unread).toBeGreaterThan(0);
    const after = (await request(app).post(`${B()}/work/inbox/seen`).set(as(manager)).send({}).expect(200)).body;
    expect(after.items.find(i => i.kind === 'mention')).toBeUndefined();
  });
  test('277: coverage request -> claim -> manager approval moves the shift', async () => {
    const { rows: [s] } = await pool.query("INSERT INTO business_staff_shifts(business_id,user_id,shift_date,start_time,end_time) VALUES($1,$2,CURRENT_DATE+3,'09:00','17:00') RETURNING id", [bizId, employee]);
    await request(app).post(`${B()}/work/shifts/${s.id}/coverage`).set(as(other)).send({}).expect(404);
    const r = (await request(app).post(`${B()}/work/shifts/${s.id}/coverage`).set(as(employee)).send({ reason: 'Doctor' }).expect(201)).body;
    await request(app).post(`${B()}/work/shifts/${s.id}/coverage`).set(as(employee)).send({}).expect(409);
    await request(app).post(`${B()}/work/coverage/${r.id}/claim`).set(as(employee)).expect(409);
    const list = (await request(app).get(`${B()}/work/coverage`).set(as(other)).expect(200)).body;
    expect(list.available.map(x => x.id)).toContain(r.id);
    expect((await request(app).get(`${B()}/work/coverage`).set(as(employee)).expect(200)).body.my_shifts.map(x => x.id)).toContain(s.id);
    expect((await request(app).get(`${B()}/work/teammates`).set(as(employee)).expect(200)).body.teammates.map(x => x.id)).toEqual(expect.arrayContaining([owner, manager, other]));
    await request(app).post(`${B()}/work/coverage/${r.id}/claim`).set(as(other)).expect(200);
    await request(app).post(`${B()}/owner/coverage/${r.id}/decision`).set(as(other)).send({ decision: 'approve' }).expect(403);
    expect((await request(app).get(`${B()}/work/coverage`).set(as(manager)).expect(200)).body.awaiting_approval.map(x => x.id)).toContain(r.id);
    const d = (await request(app).post(`${B()}/owner/coverage/${r.id}/decision`).set(as(manager)).send({ decision: 'approve' }).expect(200)).body;
    expect(d.status).toBe('approved');
    const { rows: [moved] } = await pool.query('SELECT user_id FROM business_staff_shifts WHERE id=$1', [s.id]);
    expect(moved.user_id).toBe(other);
  });
  test('280: daily workload view', async () => {
    const { rows: [{ d }] } = await pool.query("SELECT to_char((NOW() AT TIME ZONE 'UTC')::date + 5, 'YYYY-MM-DD') AS d");
    await pool.query("INSERT INTO business_staff_shifts(business_id,user_id,shift_date,start_time,end_time) VALUES($1,$2,$3,'08:00','10:00')", [bizId, employee, d]);
    await pool.query("INSERT INTO business_appointments(business_id,service_id,staff_id,start_time,end_time,status) VALUES($1,$2,$3,($4::date + time '08:00') AT TIME ZONE 'UTC',($4::date + time '10:00') AT TIME ZONE 'UTC','confirmed')", [bizId, serviceId, employee, d]);
    const v = (await request(app).get(`${B()}/work/day?date=${d}`).set(as(employee)).expect(200)).body;
    expect(v.totals).toMatchObject({ booked_minutes: 120, shift_minutes: 120, load: 'full' });
    expect(v.appointments).toHaveLength(1);
  });
});
