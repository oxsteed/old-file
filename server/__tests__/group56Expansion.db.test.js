'use strict';
// Groups 5-6 items 236-240: locations, launch checklist, territory, capacity, staffing forecast.
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

describeDb('Groups 5-6: expansion', () => {
  beforeAll(async () => {
    for (const id of [owner, manager, employee]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,state,zip_code) VALUES($1,$2,'x','Exp','User','customer',TRUE,TRUE,'MA','02139')", [id, `g56x-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Expand Co','service',TRUE,'America/New_York') RETURNING id", [owner]));
    ({ rows: [{ id: otherBiz }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active) VALUES($1,'Diner','restaurant',TRUE) RETURNING id", [manager]));
    for (const [id, role] of [[manager, 'manager'], [employee, 'employee']]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status) VALUES($1,$2,$3,$4,$5,'active')", [bizId, owner, id, `g56x-${id}@x.invalid`, role]);
    ({ rows: [{ id: serviceId }] } = await pool.query("INSERT INTO business_services(business_id,name,base_price_cents,duration_minutes,is_active) VALUES($1,'Repair',10000,60,TRUE) RETURNING id", [bizId]));
    const { router } = require('../routes/businessOwnerConsole');
    app = express(); app.use(express.json());
    app.use('/api/businesses', router);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('DELETE FROM businesses WHERE id = ANY($1)', [[bizId, otherBiz]]); await pool.end(); });

  test('236 + 237: create a location, launch only when the checklist is complete', async () => {
    const url = `/api/businesses/${bizId}/owner/locations`;
    expect((await request(app).post(url).set(as(employee)).send({ name: 'North' })).status).toBe(403);
    expect((await request(app).post(url).set(as(manager)).send({ name: 'North', hours: { mon: ['17:00', '09:00'] } })).status).toBe(400);
    expect((await request(app).post(url).set(as(manager)).send({ name: 'North', member_ids: [crypto.randomUUID()] })).status).toBe(400);
    const loc = (await request(app).post(url).set(as(manager)).send({ name: 'North', address_street: '1 Main', address_city: 'Cambridge', address_state: 'ma', address_zip: '02139' }).expect(201)).body;
    expect(loc).toMatchObject({ status: 'setup', address_state: 'MA' });
    expect((await request(app).post(url).set(as(owner)).send({ name: 'north' })).status).toBe(409);
    await request(app).post(`${url}/${loc.id}/checklist`).set(as(manager)).send({ label: 'Van stocked' }).expect(201);
    expect((await request(app).post(`${url}/${loc.id}/launch`).set(as(manager)).send({})).body.code).toBe('location_not_ready');
    await request(app).put(`${url}/${loc.id}`).set(as(manager)).send({ ...loc, timezone: 'America/New_York', hours: { mon: ['09:00', '17:00'] }, manager_user_id: manager, member_ids: [employee], service_ids: [serviceId], expectedVersion: 1 }).expect(200);
    let list = (await request(app).get(url).set(as(manager))).body.locations[0];
    expect(list.checklist.computed.every(c => c.done)).toBe(true);
    expect(list.checklist.ready).toBe(false);
    await request(app).patch(`${url}/${loc.id}/checklist/${list.checklist.items[0].id}`).set(as(manager)).send({ done: true }).expect(200);
    const launched = (await request(app).post(`${url}/${loc.id}/launch`).set(as(manager)).send({})).body;
    expect(launched).toMatchObject({ status: 'active', launched_by: manager });
    expect((await request(app).post(`${url}/${loc.id}/launch`).set(as(manager)).send({})).body.code).toBe('invalid_transition');
    expect((await request(app).post(`/api/businesses/${otherBiz}/owner/locations`).set(as(manager)).send({ name: 'X' })).body.code).toBe('use_restaurant_locations');
  });

  test('238: territory groups completed visits by client area', async () => {
    const day = n => `NOW() - interval '${n} days'`;
    for (const n of [10, 20, 200]) await pool.query(`INSERT INTO business_appointments(business_id,service_id,customer_id,start_time,end_time,status,final_price_cents) VALUES($1,$2,$3,${day(n)},${day(n)} + interval '1 hour','completed',10000)`, [bizId, serviceId, employee]);
    const r = (await request(app).get(`/api/businesses/${bizId}/owner/territory`).set(as(manager)).expect(200)).body;
    expect(r.areas[0]).toMatchObject({ state: 'MA', zip3: '021', visits: 3, visits_90d: 2, revenue_cents: '30000', share: 1 });
    expect((await request(app).get(`/api/businesses/${bizId}/owner/territory`).set(as(employee))).status).toBe(403);
  });

  test('239 + 240: capacity uses availability and shifts; forecast sizes staff', async () => {
    for (let dow = 0; dow < 7; dow++) await pool.query("INSERT INTO business_staff_availability(business_id,user_id,day_of_week,start_time,end_time) VALUES($1,$2,$3,'09:00','17:00')", [bizId, employee, dow]);
    const { rows: [{ d }] } = await pool.query("SELECT to_char((timezone('America/New_York', NOW()))::date + 1,'YYYY-MM-DD') AS d");
    await pool.query("INSERT INTO business_staff_shifts(business_id,user_id,shift_date,start_time,end_time) VALUES($1,$2,$3,'08:00','12:00')", [bizId, employee, d]);
    await pool.query(`INSERT INTO business_appointments(business_id,service_id,staff_id,start_time,end_time,status) VALUES($1,$2,$3,($4::date + time '10:00') AT TIME ZONE 'America/New_York',($4::date + time '13:00') AT TIME ZONE 'America/New_York','confirmed')`, [bizId, serviceId, employee, d]);
    const cap = (await request(app).get(`/api/businesses/${bizId}/owner/capacity?weeks=1`).set(as(manager)).expect(200)).body;
    expect(cap.days).toHaveLength(7);
    const tomorrow = cap.days.find(x => x.day === d);
    expect(tomorrow).toMatchObject({ capacity_hours: 4, booked_hours: 3, utilization: 0.75, flag: 'ok' });
    expect(cap.days.find(x => x.day !== d).capacity_hours).toBe(8);
    const locId = (await pool.query('SELECT id FROM business_service_locations WHERE business_id=$1', [bizId])).rows[0].id;
    expect((await request(app).get(`/api/businesses/${bizId}/owner/capacity?weeks=1&location_id=${locId}`).set(as(manager))).body.days[0].people).toBe(1);
    expect((await request(app).get(`/api/businesses/${bizId}/owner/capacity?weeks=99`).set(as(manager))).status).toBe(400);
    await pool.query(`INSERT INTO business_appointments(business_id,service_id,start_time,end_time,status)
      SELECT $1,$2, date_trunc('month', NOW()) - interval '12 months' + interval '1 day', date_trunc('month', NOW()) - interval '12 months' + interval '1 day' + interval '200 hours','completed'`, [bizId, serviceId]);
    const f = (await request(app).get(`/api/businesses/${bizId}/owner/staffing-forecast`).set(as(owner)).expect(200)).body;
    expect(f.months).toHaveLength(6);
    expect(f.current_staff).toBe(3);
    expect(f.months[0]).toMatchObject({ basis: 'same_month', demand_hours: 200 });
    expect(f.months[0].staff_needed).toBeGreaterThan(0);
  });
});
