'use strict';
// S-20: minor profiles and Fair Workweek change records, real PostgreSQL (st_t3).
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.ST_T3_TEST_DATABASE_URL || '';
const ok = (() => { try { const u = new URL(RAW_URL); return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname) && u.pathname === '/st_t3'; } catch { return false; } })();
if (ok) { process.env.DATABASE_URL = RAW_URL; process.env.NODE_ENV = 'test'; process.env.LOG_LEVEL = 'error'; }
const ddescribe = ok ? describe : describe.skip;
test('targets only the disposable st_t3 database', () => { expect(ok).toBe(Boolean(RAW_URL) && ok); });

const pool = require('../db');
const ctrl = require('../controllers/businessStaffScheduleController');
const { errorHandler } = require('../middleware/errorHandler');
jest.setTimeout(60000);

function app(userId, role) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { id: userId }; req.businessRole = role; next(); });
  a.put('/b/:businessId/staff/shifts/:shiftId', ctrl.updateShift);
  a.delete('/b/:businessId/staff/shifts/:shiftId', ctrl.deleteShift);
  a.post('/b/:businessId/staff/shifts/publish', ctrl.publishShifts);
  a.get('/b/:businessId/staff/members/:userId/labor-profile', ctrl.getLaborProfile);
  a.put('/b/:businessId/staff/members/:userId/labor-profile', ctrl.setLaborProfile);
  a.get('/b/:businessId/staff/schedule-changes', ctrl.listScheduleChanges);
  a.use(errorHandler);
  return a;
}
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

ddescribe('minor profiles and schedule changes', () => {
  let owner, employee, businessId, restaurantId, locationId;
  beforeAll(async () => {
    owner = crypto.randomUUID(); employee = crypto.randomUUID();
    for (const id of [owner, employee]) {
      await pool.query(`INSERT INTO users (id,email,password_hash,first_name,last_name,role,email_verified,is_active) VALUES ($1,$2,'x','F','W','customer',TRUE,TRUE)`, [id, `fww-${id}@example.invalid`]);
    }
    businessId = (await pool.query('INSERT INTO businesses (user_id,business_name) VALUES ($1,$2) RETURNING id', [owner, `FWW ${owner.slice(0, 8)}`])).rows[0].id;
    await pool.query(`INSERT INTO business_members (business_id,owner_id,member_id,invite_email,role,status) VALUES ($1,$2,$3,$4,'employee','active')`, [businessId, owner, employee, `fww-${employee}@example.invalid`]);
    restaurantId = (await pool.query("INSERT INTO food_restaurants(business_id,owner_user_id,display_name,status) VALUES($1,$2,'FWW','active') RETURNING id", [businessId, owner])).rows[0].id;
    locationId = (await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND is_primary', [restaurantId])).rows[0].id;
    await pool.query("INSERT INTO restaurant_labor_jurisdictions(restaurant_id,location_id,jurisdiction_code) VALUES($1,$2,'US-NYC')", [restaurantId, locationId]);
  });
  afterAll(async () => { await pool.end(); });

  test('labor profile: manager only, band and end date together, no birth date', async () => {
    const owners = app(owner, 'owner');
    expect((await request(owners).put(`/b/${businessId}/staff/members/${employee}/labor-profile`).send({ minor_band: 'under_16' })).status).toBe(400);
    expect((await request(owners).put(`/b/${businessId}/staff/members/${employee}/labor-profile`).send({ minor_band: 'kid', minor_until: '2030-01-01' })).status).toBe(400);
    const set = await request(owners).put(`/b/${businessId}/staff/members/${employee}/labor-profile`).send({ minor_band: 'under_16', minor_until: '2030-01-01' });
    expect(set.status).toBe(200);
    expect((await request(owners).get(`/b/${businessId}/staff/members/${employee}/labor-profile`)).body.profile).toMatchObject({ minor_band: 'under_16', minor_until: '2030-01-01' });
    expect((await request(app(employee, 'employee')).put(`/b/${businessId}/staff/members/${employee}/labor-profile`).send({ minor_band: null, minor_until: null })).status).toBe(403);
    const cols = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='business_staff_labor_profiles'")).rows.map((r) => r.column_name);
    expect(cols.some((c) => /birth|dob/.test(c))).toBe(false);
  });

  test('publishing a minor shift returns minor warnings', async () => {
    const day = isoDay(30);
    await pool.query(`INSERT INTO business_staff_shifts(business_id,user_id,shift_date,start_time,end_time,restaurant_id,location_id) VALUES($1,$2,$3,'06:00','20:30',$4,$5)`, [businessId, employee, day, restaurantId, locationId]);
    const res = await request(app(owner, 'owner')).post(`/b/${businessId}/staff/shifts/publish`).send({ restaurant_id: restaurantId });
    expect(res.status).toBe(200);
    const rules = (res.body.rule_warnings || []).map((w) => w.rule);
    expect(rules).toEqual(expect.arrayContaining(['minor_u16_window']));
  });

  test('editing or cancelling a published shift inside the notice window records predictability pay', async () => {
    const day = isoDay(3);
    const { rows: [s] } = await pool.query(`INSERT INTO business_staff_shifts(business_id,user_id,shift_date,start_time,end_time,restaurant_id,location_id,published_at,published_by)
      VALUES($1,$2,$3,'09:00','17:00',$4,$5,NOW(),$6) RETURNING id`, [businessId, employee, day, restaurantId, locationId, owner]);
    const owners = app(owner, 'owner');
    const edit = await request(owners).put(`/b/${businessId}/staff/shifts/${s.id}`).send({ shift_start: `${day}T11:00` });
    expect(edit.status).toBe(200);
    expect(edit.body.schedule_change).toMatchObject({ premium_due: true, notice_hours: 336, jurisdiction_code: 'US-NYC' });
    const swap = await request(owners).put(`/b/${businessId}/staff/shifts/${s.id}`).send({ shift_start: `${day}T12:00`, employee_requested: true });
    expect(swap.body.schedule_change.premium_due).toBe(false);
    const noop = await request(owners).put(`/b/${businessId}/staff/shifts/${s.id}`).send({ notes: 'bring keys' });
    expect(noop.body.schedule_change).toBeUndefined();
    const del = await request(owners).delete(`/b/${businessId}/staff/shifts/${s.id}`);
    expect(del.body.schedule_change.premium_due).toBe(true);
    const list = await request(owners).get(`/b/${businessId}/staff/schedule-changes?premium=true`);
    expect(list.body.changes.map((c) => c.change_type)).toEqual(['deleted', 'edited']);
    // Drafts are not commitments: editing an unpublished shift records nothing.
    const { rows: [draft] } = await pool.query(`INSERT INTO business_staff_shifts(business_id,user_id,shift_date,start_time,end_time,restaurant_id,location_id) VALUES($1,$2,$3,'09:00','17:00',$4,$5) RETURNING id`, [businessId, employee, day, restaurantId, locationId]);
    expect((await request(owners).put(`/b/${businessId}/staff/shifts/${draft.id}`).send({ shift_start: `${day}T10:00` })).body.schedule_change).toBeUndefined();
  });
});
