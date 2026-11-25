'use strict';
// D-461 (262, G5-25): the booking visit checklist admits the provider role
// (the booking's helper) and the business member working the linked
// appointment (assignee or crew). Strangers stay out.
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^\/(credit_statement_test|pa_g\d+|g56)$/.test(parsed.pathname)) throw new Error('Disposable database required');
  process.env.DATABASE_URL = raw;
}
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => { const id = req.get('x-user'); if (!id) return res.sendStatus(401); req.user = { id }; next(); };
  const optionalAuth = (req, res, next) => { const id = req.get('x-user'); if (id) req.user = { id }; next(); };
  return { authenticate, requireAuth: authenticate, optionalAuth };
});
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.unmock('pg'); jest.unmock('../db'); jest.unmock('../utils/transaction');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const describeDb = raw ? describe : describe.skip;
const bookerId = crypto.randomUUID(), helperId = crypto.randomUUID(), crewId = crypto.randomUUID();
const strangerId = crypto.randomUUID();
let app, bizId, bookingId, apptId;
const as = (u) => ({ 'x-user': u });

describeDb('Groups 5-6: booking visit checklist for the provider (262)', () => {
  beforeAll(async () => {
    for (const [id, email] of [[bookerId, 'g56c-booker'], [helperId, 'g56c-helper'], [crewId, 'g56c-crew'], [strangerId, 'g56c-stranger']]) {
      await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Work','User','customer',TRUE,TRUE,'555-0100')", [id, `${email}-${id}@example.invalid`]);
    }
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Checklist Co','service',TRUE,'UTC') RETURNING id", [bookerId]));
    await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,'employee','active',NOW())", [bizId, bookerId, crewId, `g56c-${crewId}@x.invalid`]);
    const { rows: [{ id: serviceId }] } = await pool.query("INSERT INTO business_services(business_id,name,base_price_cents,duration_minutes,is_active) VALUES($1,'Clean',10000,60,TRUE) RETURNING id", [bizId]);
    ({ rows: [{ id: apptId }] } = await pool.query(
      "INSERT INTO business_appointments(business_id,service_id,staff_id,start_time,end_time,status) VALUES($1,$2,$3,NOW() + INTERVAL '1 hour',NOW() + INTERVAL '2 hours','confirmed') RETURNING id",
      [bizId, serviceId, helperId],
    ));
    await pool.query('INSERT INTO business_appointment_crew(appointment_id,user_id,business_id,role) VALUES($1,$2,$3,\'member\')', [apptId, crewId, bizId]);
    ({ rows: [{ id: bookingId }] } = await pool.query(
      "INSERT INTO booking_requests(customer_id, helper_id, business_id, business_appointment_id, service_name, requested_date, requested_start_time, status) VALUES($1,$2,$3,$4,'Clean',CURRENT_DATE,'09:00','pending') RETURNING id",
      [bookerId, helperId, bizId, apptId],
    ));
    const router = require('../routes/bookings');
    app = express(); app.use(express.json());
    app.use('/bookings', router);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => {
    await pool.query('DELETE FROM booking_requests WHERE id = $1', [bookingId]);
    await pool.query('DELETE FROM business_appointment_crew WHERE appointment_id = $1', [apptId]);
    await pool.query('DELETE FROM business_appointments WHERE id = $1', [apptId]);
    await pool.query('DELETE FROM business_members WHERE business_id = $1', [bizId]);
    await pool.query('DELETE FROM businesses WHERE id = $1', [bizId]);
    // Fixture users are left in place: deleting any user from this DB fails
    // with "referential integrity query ... gave unexpected result" (the
    // no-delete RULE on oxsteed_credit_partner_funding_records).
    await pool.end();
  });

  test('helper, crew member and booker can read the checklist; a stranger cannot', async () => {
    for (const u of [helperId, crewId, bookerId]) {
      const res = await request(app).get(`/bookings/${bookingId}/checklist`).set(as(u)).expect(200);
      expect(res.body.data.items.map((i) => i.key)).toContain('handoff_confirmed');
    }
    await request(app).get(`/bookings/${bookingId}/checklist`).set(as(strangerId)).expect(403);
  });
});
