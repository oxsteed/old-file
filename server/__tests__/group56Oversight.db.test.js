'use strict';
// Groups 5-6 items 217, 218, 220, 222, 225: owner oversight. Disposable DB only.
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^\/(credit_statement_test|pa_g\d+|g56)$/.test(parsed.pathname)) throw new Error('Disposable database required');
  process.env.DATABASE_URL = raw;
}
jest.mock('../middleware/auth', () => ({ authenticate: (req, res, next) => { const id = req.get('x-user'); if (!id) return res.sendStatus(401); req.user = { id }; next(); } }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.unmock('pg'); jest.unmock('../db'); jest.unmock('../utils/transaction');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const { sendNotification } = require('../services/notificationService');
const describeDb = raw ? describe : describe.skip;
const owner = crypto.randomUUID(), manager = crypto.randomUUID(), staff = crypto.randomUUID(), gone = crypto.randomUUID(), customer = crypto.randomUUID(), other = crypto.randomUUID();
let app, bizId, serviceId;
const as = (u) => ({ 'x-user': u });
const appt = async (fields) => (await pool.query(`INSERT INTO business_appointments(business_id,service_id,staff_id,customer_id,customer_name,customer_email,start_time,end_time,status,completed_at,base_price_cents)
  VALUES($1,$2,$3,$4,'Pat Customer','pat@example.invalid',$5,$6,$7,$8,10000) RETURNING id`, [bizId, serviceId, fields.staff ?? null, fields.customer ?? customer, fields.start, fields.end, fields.status || 'confirmed', fields.completed || null])).rows[0].id;
const hours = h => new Date(Date.now() + h * 3600000).toISOString();

describeDb('Groups 5-6: owner oversight', () => {
  beforeAll(async () => {
    for (const id of [owner, manager, staff, gone, customer, other]) {
      await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified) VALUES($1,$2,'x','Ov','User','customer',TRUE,TRUE)", [id, `g56o-${id}@example.invalid`]);
    }
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Oversight Co','service',TRUE,'America/New_York') RETURNING id", [owner]));
    for (const [id, role, status] of [[manager, 'manager', 'active'], [staff, 'employee', 'active'], [gone, 'employee', 'revoked']]) {
      await pool.query('INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,$5,$6,NOW())', [bizId, owner, id, `g56o-${id}@x.invalid`, role, status]);
    }
    ({ rows: [{ id: serviceId }] } = await pool.query("INSERT INTO business_services(business_id,name,base_price_cents,duration_minutes,is_active) VALUES($1,'Cleaning',10000,60,TRUE) RETURNING id", [bizId]));
    await pool.query('INSERT INTO business_service_staff(service_id,staff_id,is_available) VALUES($1,$2,TRUE)', [serviceId, staff]);
    await pool.query("INSERT INTO business_staff_availability(business_id,user_id,day_of_week,start_time,end_time) VALUES($1,$2,1,'09:00','17:00')", [bizId, staff]);
    const { router, meRouter } = require('../routes/businessOwnerConsole');
    app = express(); app.use(express.json()); app.use('/api/businesses', router); app.use('/api/me/business-visits', meRouter);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('DELETE FROM businesses WHERE id=$1', [bizId]); await pool.end(); });

  test('217: open assignments list unassigned and departed-assignee work with eligible staff; manager+ only', async () => {
    const a1 = await appt({ start: hours(24), end: hours(25) });
    const a2 = await appt({ staff: gone, start: hours(48), end: hours(49) });
    await appt({ staff, start: hours(72), end: hours(73) });
    const res = await request(app).get(`/api/businesses/${bizId}/owner/open-assignments`).set(as(manager));
    expect(res.status).toBe(200);
    expect(res.body.appointments.map(a => [a.id, a.reason])).toEqual([[a1, 'unassigned'], [a2, 'assignee_inactive']]);
    expect(res.body.appointments[0].eligible.map(e => e.id)).toEqual([staff]);
    expect((await request(app).get(`/api/businesses/${bizId}/owner/open-assignments`).set(as(staff))).status).toBe(403);
  });

  test('218: heatmap counts bookings per weekday/hour in business time and staffed hours', async () => {
    const res = await request(app).get(`/api/businesses/${bizId}/owner/schedule-heatmap?weeks=2`).set(as(owner));
    expect(res.status).toBe(200);
    expect(res.body.cells).toHaveLength(168);
    expect(res.body.cells.reduce((n, c) => n + c.booked, 0)).toBe(3);
    expect(res.body.cells.find(c => c.dow === 1 && c.hour === 9).staffed).toBe(1);
    expect(res.body.cells.find(c => c.dow === 1 && c.hour === 17).staffed).toBe(0);
    expect((await request(app).get(`/api/businesses/${bizId}/owner/schedule-heatmap?weeks=99`).set(as(owner))).status).toBe(400);
  });

  test('220 + 222: handoff timeline and repeat records', async () => {
    const a = await appt({ staff, start: hours(96), end: hours(97) });
    await pool.query("INSERT INTO business_appointment_assignment_events(appointment_id,business_id,from_staff_id,to_staff_id,actor_id,source,reason) VALUES($1,$2,$3,$4,$5,'reassign','Sick day')", [a, bizId, gone, staff, owner]);
    const tl = await request(app).get(`/api/businesses/${bizId}/owner/handoff-timeline`).set(as(manager));
    expect(tl.body.events[0]).toMatchObject({ kind: 'assignment', event: 'reassign', to_user: staff, detail: 'Sick day', actor_name: 'Ov User' });
    expect(tl.body.events.some(e => e.event === 'joined')).toBe(true);
    await appt({ start: hours(-24 * 40), end: hours(-24 * 40 + 1), status: 'completed', completed: hours(-24 * 40) });
    await appt({ start: hours(-24 * 10), end: hours(-24 * 10 + 1), status: 'completed', completed: hours(-24 * 10) });
    await appt({ customer: other, start: hours(-24 * 5), end: hours(-24 * 5 + 1), status: 'completed', completed: hours(-24 * 5) });
    const rep = await request(app).get(`/api/businesses/${bizId}/owner/repeat-customers`).set(as(owner));
    expect(rep.body.customers).toHaveLength(1);
    expect(rep.body.customers[0]).toMatchObject({ customer_key: customer, visits: 2, avg_days_between: 30 });
  });

  test('225: only the visit customer can report, within 30 days; owner resolves and the customer is told', async () => {
    const recent = await appt({ start: hours(-48), end: hours(-47), status: 'completed', completed: hours(-47) });
    const old = await appt({ start: hours(-24 * 45), end: hours(-24 * 45 + 1), status: 'completed', completed: hours(-24 * 45) });
    const body = { requestId: crypto.randomUUID(), category: 'quality', description: 'The grout was left unsealed.' };
    expect((await request(app).post(`/api/businesses/${bizId}/appointments/${recent}/service-issues`).set(as(other)).send(body)).status).toBe(404);
    expect((await request(app).post(`/api/businesses/${bizId}/appointments/${old}/service-issues`).set(as(customer)).send({ ...body, requestId: crypto.randomUUID() })).body.code).toBe('issue_window_closed');
    const created = await request(app).post(`/api/businesses/${bizId}/appointments/${recent}/service-issues`).set(as(customer)).send(body);
    expect(created.status).toBe(201);
    expect((await request(app).post(`/api/businesses/${bizId}/appointments/${recent}/service-issues`).set(as(customer)).send(body)).body.id).toBe(created.body.id);
    expect((await request(app).post(`/api/businesses/${bizId}/appointments/${recent}/service-issues`).set(as(customer)).send({ ...body, requestId: crypto.randomUUID() })).body.code).toBe('issue_already_open');
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: owner, type: 'business_service_issue_reported' }));
    const visits = await request(app).get('/api/me/business-visits').set(as(customer));
    expect(visits.body.visits.find(v => v.id === recent).issue.status).toBe('open');
    expect((await request(app).patch(`/api/businesses/${bizId}/owner/service-issues/${created.body.id}`).set(as(staff)).send({ status: 'resolved', resolution: 'x', expectedVersion: 0 })).status).toBe(403);
    expect((await request(app).patch(`/api/businesses/${bizId}/owner/service-issues/${created.body.id}`).set(as(owner)).send({ status: 'resolved', expectedVersion: 0 })).status).toBe(400);
    const done = await request(app).patch(`/api/businesses/${bizId}/owner/service-issues/${created.body.id}`).set(as(owner)).send({ status: 'resolved', resolution: 'We will return Friday to seal it at no charge.', expectedVersion: 0 });
    expect(done.body).toMatchObject({ status: 'resolved', resolved_by: owner });
    expect((await request(app).patch(`/api/businesses/${bizId}/owner/service-issues/${created.body.id}`).set(as(owner)).send({ status: 'dismissed', resolution: 'x', expectedVersion: 1 })).status).toBe(409);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: customer, type: 'business_service_issue_resolved' }));
  });
});
