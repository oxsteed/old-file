'use strict';

// DB-backed proof for the B-scheduling-profiles-search bundle (P1-5-F02,
// P1-5-F03, P1-6-F03): the StaffScheduler write path produces rows the real
// booking slot engine reads; the allow_booking gate 403s against real SQL;
// Direct member templates load from the real helper_availability table.
//
// Isolated schema per run; business_staff_shifts and helper_availability come
// from the REAL migrations (238, 168). The business booking tables are
// hand-built with the production column names/types the engines query
// (migration 220's business_service_staff.service_id INTEGER FK is not
// reproduced: it cannot reference the UUID business_services.id).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const schema = `sched_shifts_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Scheduling fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const db = require('../db');
const staffScheduleCtrl = require('../controllers/businessStaffScheduleController');
const appointmentCtrl = require('../controllers/appointmentController');
const { computeSlots } = require('../services/bookingSlotEngine');
const { loadMemberTemplates } = require('../services/directSlotEngine');

const describeDb = url ? describe : describe.skip;

const STAFF = crypto.randomUUID();
const CUSTOMER = crypto.randomUUID();
const OWNER = crypto.randomUUID();
const SERVICE_ID = crypto.randomUUID();
let BUSINESS_ID;

const MONDAY = '2030-01-07'; // a Monday
const at = (h) => `${MONDAY}T${String(h).padStart(2, '0')}:00:00.000Z`;

function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  return res;
}

describeDb('scheduling write path feeds the slot engine (P1-5-F02, P1-6-F03, P1-5-F03)', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.users (
      id UUID PRIMARY KEY, email TEXT, timezone TEXT, role TEXT,
      is_active BOOLEAN DEFAULT TRUE, deleted_at TIMESTAMPTZ,
      first_name TEXT, last_name TEXT, display_name_preference TEXT)`);
    await db.query(`CREATE TABLE ${schema}.businesses (id SERIAL PRIMARY KEY, user_id UUID)`);
    await db.query(`CREATE TABLE ${schema}.business_members (
      business_id INTEGER, member_id UUID, status TEXT)`);
    // Real migrations for the tables at the heart of the findings.
    // The legacy migration checks table_name across every schema. Scope only
    // that existence probe to this fixture so migrated public tables cannot
    // cause the test to write shifts referencing public.users.
    const shiftMigration = fs.readFileSync(path.join(__dirname, '../migrations/238_staff_schedules.sql'), 'utf8');
    await db.query(shiftMigration.replaceAll('WHERE table_name =', 'WHERE table_schema = current_schema() AND table_name ='));
    const ownedTables = await db.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema=$1 AND table_name IN ('business_staff_shifts','business_time_entries')`, [schema]);
    expect(ownedTables.rows).toHaveLength(2);
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/168_helper_availability.sql'), 'utf8'));
    // Business booking tables: production column names/types the engines read.
    await db.query(`CREATE TABLE ${schema}.business_services (
      id UUID PRIMARY KEY, business_id INTEGER, duration_minutes INTEGER,
      preparation_minutes INTEGER DEFAULT 0, max_capacity INTEGER DEFAULT 1,
      min_notice_hours INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT TRUE,
      allow_online_booking BOOLEAN DEFAULT TRUE, deleted_at TIMESTAMPTZ)`);
    await db.query(`CREATE TABLE ${schema}.business_service_staff (
      service_id UUID, staff_id UUID, is_available BOOLEAN DEFAULT TRUE)`);
    await db.query(`CREATE TABLE ${schema}.business_service_availability (
      service_id UUID, staff_id UUID, day_of_week INTEGER,
      start_time TIME, end_time TIME, is_available BOOLEAN DEFAULT TRUE)`);
    await db.query(`CREATE TABLE ${schema}.business_service_blocked_times (
      business_id INTEGER, service_id UUID, staff_id UUID,
      start_time TIMESTAMPTZ, end_time TIMESTAMPTZ)`);
    await db.query(`CREATE TABLE ${schema}.business_appointments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id INTEGER,
      service_id UUID, staff_id UUID, customer_id UUID,
      start_time TIMESTAMPTZ, end_time TIMESTAMPTZ, status TEXT)`);
    await db.query(`CREATE TABLE ${schema}.business_booking_rules (
      business_id INTEGER, min_advance_booking_hours INTEGER DEFAULT 0,
      max_advance_booking_days INTEGER DEFAULT 365,
      cancellation_allowed_hours_before INTEGER DEFAULT 24,
      require_payment_upfront BOOLEAN DEFAULT TRUE)`);
    await db.query(`CREATE TABLE ${schema}.helper_profiles (
      user_id UUID PRIMARY KEY, booking_buffer_minutes INTEGER DEFAULT 0,
      allow_booking BOOLEAN DEFAULT TRUE, allow_scheduling BOOLEAN DEFAULT TRUE)`);
    await db.query(`CREATE TABLE ${schema}.appointments (
      helper_id UUID, scheduled_start_time TIMESTAMPTZ,
      scheduled_end_time TIMESTAMPTZ, status TEXT)`);
    await db.query(`CREATE TABLE ${schema}.availability_blocks (
      helper_id UUID, start_time TIMESTAMPTZ, end_time TIMESTAMPTZ, type TEXT)`);
    await db.query(`CREATE TABLE ${schema}.quote_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), assigned_to UUID,
      scheduled_start_at TIMESTAMPTZ, scheduled_end_at TIMESTAMPTZ,
      status TEXT, metadata JSONB)`);
    await db.query(`CREATE TABLE ${schema}.quote_request_crew (
      quote_request_id UUID, user_id UUID)`);

    for (const [id, role, tz] of [[STAFF, 'helper', 'UTC'], [CUSTOMER, 'customer', null], [OWNER, 'helper', null]]) {
      await db.query('INSERT INTO users(id, email, role, timezone) VALUES($1, $2, $3, $4)', [id, `${id}@t.co`, role, tz]);
    }
    const biz = await db.query('INSERT INTO businesses(user_id) VALUES($1) RETURNING id', [OWNER]);
    BUSINESS_ID = biz.rows[0].id;
    await db.query('INSERT INTO business_members(business_id, member_id, status) VALUES($1, $2, $3)',
      [BUSINESS_ID, STAFF, 'active']);
    await db.query(`INSERT INTO business_services
      (id, business_id, duration_minutes, preparation_minutes, max_capacity,
       min_notice_hours, is_active, allow_online_booking, deleted_at)
      VALUES ($1, $2, 60, 0, 1, 0, TRUE, TRUE, NULL)`, [SERVICE_ID, BUSINESS_ID]);
    await db.query('INSERT INTO business_service_staff(service_id, staff_id, is_available) VALUES($1, $2, TRUE)',
      [SERVICE_ID, STAFF]);
    await db.query(`INSERT INTO business_service_availability
      (service_id, staff_id, day_of_week, start_time, end_time, is_available)
      VALUES ($1, $2, 1, '09:00', '17:00', TRUE)`, [SERVICE_ID, STAFF]);
    await db.query('INSERT INTO business_booking_rules(business_id, min_advance_booking_hours, max_advance_booking_days) VALUES($1, 0, 36500)',
      [BUSINESS_ID]);
  }, 60000);

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  test('a shift written by the StaffScheduler write path constrains the slot engine', async () => {
    // Exactly what StaffScheduler.jsx POSTs after the P1-5-F02 fix.
    const res = mockRes();
    await staffScheduleCtrl.createShift(
      { params: { businessId: String(BUSINESS_ID) },
        body: { user_id: STAFF, shift_start: `${MONDAY}T11:00`, shift_end: `${MONDAY}T13:00`, role: 'Lead', notes: '' } },
      res, (e) => { throw e; }
    );
    expect(res.statusCode).toBe(201);

    const { slots } = await computeSlots({
      businessId: BUSINESS_ID,
      serviceId: SERVICE_ID,
      from: at(0),
      to: new Date(Date.UTC(2030, 0, 8)).toISOString(),
    });
    expect(slots.map((s) => s.start)).toEqual([at(11), at(12)]);
  });

  test('a shift for another staff member does not constrain this one', async () => {
    const other = crypto.randomUUID();
    await db.query('INSERT INTO users(id, email, role) VALUES($1, $2, $3)', [other, `${other}@t.co`, 'helper']);
    await db.query('INSERT INTO business_members(business_id, member_id, status) VALUES($1, $2, $3)',
      [BUSINESS_ID, other, 'active']);
    await db.query(`INSERT INTO business_staff_shifts
      (business_id, user_id, shift_date, start_time, end_time)
      VALUES ($1, $2, $3::date, '15:00', '16:00')`, [BUSINESS_ID, other, MONDAY]);
    const { slots } = await computeSlots({
      businessId: BUSINESS_ID, serviceId: SERVICE_ID, from: at(0), to: at(23),
    });
    // STAFF's own shift (11:00-13:00) still binds; the other member's shift is ignored.
    expect(slots.map((s) => s.start)).toEqual([at(11), at(12)]);
  });

  test('the appointment API 403s for a helper who switched booking off (P1-6-F03)', async () => {
    await db.query('INSERT INTO helper_profiles(user_id, allow_booking) VALUES($1, FALSE)', [STAFF]);
    const res = mockRes();
    const next = jest.fn();
    await appointmentCtrl.createAppointment(
      { user: { id: CUSTOMER },
        body: { helper_id: STAFF, service_description: 'Fix the leaking sink',
                scheduled_start_time: new Date(Date.now() + 3600000).toISOString(),
                scheduled_end_time: new Date(Date.now() + 7200000).toISOString() } },
      res, next
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(next.mock.calls[0][0].code).toBe('booking_disabled');
    const { rows } = await db.query('SELECT 1 FROM appointments WHERE helper_id = $1', [STAFF]);
    expect(rows).toHaveLength(0);
  });

  test('Direct member templates load from the real helper_availability table (P1-5-F03)', async () => {
    await db.query(`INSERT INTO helper_availability
      (helper_id, day_of_week, start_time, end_time, is_active)
      VALUES ($1, 1, '09:00', '17:00', TRUE)`, [STAFF]);
    const map = await loadMemberTemplates([STAFF, CUSTOMER], at(0), at(23), db);
    expect(map.has(STAFF)).toBe(true);
    expect(map.has(CUSTOMER)).toBe(false);
    expect(map.get(STAFF).byDay.get(1)).toEqual([{ start: 540, end: 1020 }]);
    expect(map.get(STAFF).timeZone).toBe('UTC');
  });
});
