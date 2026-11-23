'use strict';

// Group 4 Slice D (171-175): working hours, time off calendar, booking
// buffers, daily job limits, travel time blocks.
//
// Survey verdicts (see persona-roadmap-decisions.md, Slice D section):
// 171/172/174 were PARTIAL on one leg only: the weekly template, time-off
// blocks, and daily limit were all enforced on the booking path
// (isSlotFree / validateBookingSlot) but the job-hire path (assignHelper)
// never checked them. 173 was PARTIAL: the booking buffer had a server
// write path (PUT /helper-profile/core) but no client UI. 175 was PARTIAL:
// the fixed travel gap existed, but manual travel blocks did not.
// This suite proves the hire-path pre-check, the capacity-service booking
// buffer, and the travel-block type end to end, through the real routers.
const { seedHelperPayoutReadiness } = require('./helpers/helperPayoutReadiness');
const { acceptCurrentConsents } = require('./helpers/currentConsents');

const dbUrl = process.env.ACCESS_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/((credit_statement_test(_pr804_d)?)|(pa_[tg]\d+))$/.test(url.pathname)) {
    throw new Error('Group 4 Slice D DB tests require a loopback disposable database');
  }
  process.env.DATABASE_URL = dbUrl;
  process.env.STATEMENT_TEST_DATABASE_URL = dbUrl;
}
process.env.JWT_SECRET = 'slice-d-test-secret';
process.env.REDIS_URL = '';
process.env.FEATURE_PAYMENTS_ENABLED = 'true';

jest.unmock('pg');
jest.unmock('../utils/transaction');
jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: req.headers['x-test-actor'], role: req.headers['x-test-role'] || 'customer' }; next(); },
  optionalAuth: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../middleware/requireEmailVerified', () => (_req, _res, next) => next());
jest.mock('../middleware/helperOnboardingMiddleware', () => ({
  requireOnboardingStep: () => (_req, _res, next) => next(),
  requireHelperWorkEligible: (_req, _res, next) => next(),
  requireListingEligible: (_req, _res, next) => next(),
}));
jest.mock('../middleware/checkRestrictions', () => () => (_req, _res, next) => next());
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../services/socketService', () => ({ broadcastToUser: jest.fn(), emitToUser: jest.fn(), getIO: () => null }));

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const db = require('../db');
const availability = require('../services/helperAvailabilityService');
const capacity = require('../services/helperCapacityService');
const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 4 Slice D: working hours, time off, buffers, limits, travel blocks', () => {
  let app;
  const customer = crypto.randomUUID();
  const helper = crypto.randomUUID();
  const helperNoTemplate = crypto.randomUUID();
  const jobIds = [];

  async function makeJob(helperId, schedule) {
    const { rows: [job] } = await db.query(
      `INSERT INTO jobs (client_id, title, description, status, budget_type, budget_min_cents, budget_max_cents, location_city, location_state)
       VALUES ($1, 'Fix the leaking sink', 'Disposable Slice D job', 'published', 'fixed', 20000, 20000, 'Austin', 'TX') RETURNING *`,
      [customer]
    );
    jobIds.push(job.id);
    if (schedule) {
      await db.query('UPDATE jobs SET scheduled_start_at = $2, scheduled_precision = $3 WHERE id = $1',
        [job.id, schedule.start, schedule.precision]);
    }
    const { rows: [bid] } = await db.query(
      `INSERT INTO bids (job_id, helper_id, amount, status, job_revision, expires_at)
       VALUES ($1, $2, 180, 'pending', 1, NOW() + INTERVAL '7 days') RETURNING *`,
      [job.id, helperId]
    );
    return { job, bid };
  }

  async function hire(bidId, extra = {}) {
    return request(app).post('/api/jobs/assign').set('x-test-actor', customer)
      .send({ bid_id: bidId, payment_method: 'off_platform', ...extra });
  }

  async function appointment(helperId, start, end, status = 'confirmed') {
    const { rows: [row] } = await db.query(
      `INSERT INTO appointments (customer_id, helper_id, service_description, scheduled_start_time, scheduled_end_time, status, created_by_user_id)
       VALUES ($1, $2, 'Slice D fixture', $3, $4, $5, $1) RETURNING *`,
      [customer, helperId, start, end, status]);
    return row;
  }

  async function setCapacity(daily, travel, buffer) {
    const current = await capacity.read(helper);
    return capacity.save(helper, {
      daily_job_limit: daily,
      travel_buffer_minutes: travel,
      ...(buffer === undefined ? {} : { booking_buffer_minutes: buffer }),
      expectedVersion: current.capacity_version,
    });
  }

  async function jobState(jobId, bidId) {
    const job = (await db.query('SELECT status, assigned_helper_id FROM jobs WHERE id = $1', [jobId])).rows[0];
    const bid = (await db.query('SELECT status FROM bids WHERE id = $1', [bidId])).rows[0];
    const appts = (await db.query('SELECT id FROM appointments WHERE job_id = $1', [jobId])).rows;
    return { job, bid, appts };
  }

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/jobs', require('../routes/jobs'));
    app.use('/api/helper-profile', require('../routes/helperProfile'));
    app.use('/api/calendar', require('../routes/calendar'));
    app.use(require('../middleware/errorHandler').errorHandler);
    for (const [id, role] of [[customer, 'customer'], [helper, 'helper'], [helperNoTemplate, 'helper']]) {
      await db.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, timezone,
                           is_active, email_verified, onboarding_completed,
                           id_verified, terms_accepted, terms_accepted_at, terms_version)
         VALUES ($1, $2, 'x', 'Slice', 'D', $3, 'UTC', TRUE, TRUE, TRUE,
                 $4, $5, CASE WHEN $5 THEN NOW() END, CASE WHEN $5 THEN 'test-v1' END)`,
        [id, `${id}@slice-d.test`, role, role === 'helper', role === 'helper']
      );
      await acceptCurrentConsents(db, id);
      if (role === 'helper') {
        await seedHelperPayoutReadiness(db, id);
        await db.query(
          `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
           VALUES ($1, 'helper.offer_services', 'self', 'self', 'active', 'legacy_backfill', 'helper-policy-1')`,
          [id],
        );
      }
    }
    // Mon-Fri 08:00-18:00 UTC working hours for the main helper; the second
    // helper has no template (permissive fallback).
    for (let day = 1; day <= 5; day++) {
      await db.query("INSERT INTO helper_availability (helper_id, day_of_week, start_time, end_time, is_active) VALUES ($1, $2, '08:00', '18:00', TRUE)", [helper, day]);
    }
  }, 60000);

  afterEach(async () => {
    await db.query('DELETE FROM appointments WHERE helper_id = ANY($1::uuid[])', [[helper, helperNoTemplate]]);
    await db.query('DELETE FROM availability_blocks WHERE helper_id = ANY($1::uuid[])', [[helper, helperNoTemplate]]);
    await db.query('UPDATE helper_profiles SET daily_job_limit = NULL, travel_buffer_minutes = 0, booking_buffer_minutes = 0 WHERE user_id = ANY($1::uuid[])', [[helper, helperNoTemplate]]);
  });

  afterAll(async () => {
    for (const sql of [
      'DELETE FROM appointments WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM bids WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM jobs WHERE id = ANY($1::uuid[])',
    ]) await db.query(sql, [jobIds]).catch(() => {});
    await db.query('DELETE FROM appointments WHERE helper_id = ANY($1::uuid[])', [[helper, helperNoTemplate]]).catch(() => {});
    await db.query('DELETE FROM availability_blocks WHERE helper_id = ANY($1::uuid[])', [[helper, helperNoTemplate]]).catch(() => {});
    await db.query('DELETE FROM helper_availability WHERE helper_id = ANY($1::uuid[])', [[helper, helperNoTemplate]]).catch(() => {});
    await db.query('DELETE FROM access_grants WHERE user_id = ANY($1::uuid[])', [[helper, helperNoTemplate]]).catch(() => {});
    await db.query('DELETE FROM helper_profiles WHERE user_id = ANY($1::uuid[])', [[helper, helperNoTemplate]]).catch(() => {});
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[customer, helper, helperNoTemplate]]).catch(() => {});
    await db.end();
  }, 30000);

  test('hire outside working hours is refused and nothing is hired (171)', async () => {
    const { job, bid } = await makeJob(helper);
    const result = await hire(bid.id, { scheduled_start: '2030-08-12T03:00:00Z', scheduled_end: '2030-08-12T04:00:00Z' });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('helper_unavailable');
    const state = await jobState(job.id, bid.id);
    expect(state.job).toMatchObject({ status: 'published', assigned_helper_id: null });
    expect(state.bid.status).toBe('pending');
    expect(state.appts).toEqual([]);
  });

  test('hire inside working hours succeeds and creates the appointment (171)', async () => {
    const { job, bid } = await makeJob(helper);
    const result = await hire(bid.id, { scheduled_start: '2030-08-12T10:00:00Z', scheduled_end: '2030-08-12T11:00:00Z' });
    expect(result.status).toBe(200);
    const state = await jobState(job.id, bid.id);
    expect(state.job).toMatchObject({ status: 'accepted', assigned_helper_id: helper });
    expect(state.bid.status).toBe('accepted');
    expect(state.appts).toHaveLength(1);
    const appt = (await db.query('SELECT scheduled_start_time, scheduled_end_time, status FROM appointments WHERE job_id = $1', [job.id])).rows[0];
    expect(new Date(appt.scheduled_start_time).toISOString()).toBe('2030-08-12T10:00:00.000Z');
    expect(new Date(appt.scheduled_end_time).toISOString()).toBe('2030-08-12T11:00:00.000Z');
    expect(appt.status).toBe('confirmed');
  });

  test('a date-precision job on a non-working day is refused (171)', async () => {
    // 2030-08-11 is a Sunday; the template is Mon-Fri.
    const { job, bid } = await makeJob(helper, { start: '2030-08-11T09:00:00Z', precision: 'date' });
    const result = await hire(bid.id);
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('helper_unavailable');
    const state = await jobState(job.id, bid.id);
    expect(state.job.status).toBe('published');
    expect(state.bid.status).toBe('pending');
    expect(state.appts).toEqual([]);
  });

  test('a date-precision job on a working day succeeds (171)', async () => {
    // 2030-08-12 is a Monday.
    const { job, bid } = await makeJob(helper, { start: '2030-08-12T09:00:00Z', precision: 'date' });
    const result = await hire(bid.id);
    expect(result.status).toBe(200);
    const state = await jobState(job.id, bid.id);
    expect(state.job.status).toBe('accepted');
    expect(state.appts).toHaveLength(1);
  });

  test('a date-precision job on a fully blocked day is refused (172)', async () => {
    await db.query(
      `INSERT INTO availability_blocks (helper_id, start_time, end_time, type, title)
       VALUES ($1, '2030-08-12T00:00:00Z', '2030-08-13T00:00:00Z', 'unavailable', 'Holiday')`,
      [helper]);
    const { job, bid } = await makeJob(helper, { start: '2030-08-12T09:00:00Z', precision: 'date' });
    const result = await hire(bid.id);
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('helper_unavailable');
    const state = await jobState(job.id, bid.id);
    expect(state.job.status).toBe('published');
    expect(state.appts).toEqual([]);
  });

  test('a date-precision job with no template succeeds unless the day is fully blocked (171/172)', async () => {
    const first = await makeJob(helperNoTemplate, { start: '2030-08-12T09:00:00Z', precision: 'date' });
    const ok = await hire(first.bid.id);
    expect(ok.status).toBe(200);
    await db.query(
      `INSERT INTO availability_blocks (helper_id, start_time, end_time, type, title)
       VALUES ($1, '2030-08-13T00:00:00Z', '2030-08-14T00:00:00Z', 'unavailable', 'Day off')`,
      [helperNoTemplate]);
    const second = await makeJob(helperNoTemplate, { start: '2030-08-13T09:00:00Z', precision: 'date' });
    const refused = await hire(second.bid.id);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('helper_unavailable');
  });

  test('the daily limit is enforced before the bid is accepted (174)', async () => {
    await setCapacity(1, 0);
    await appointment(helper, '2030-08-12T09:00:00Z', '2030-08-12T10:00:00Z');
    const { job, bid } = await makeJob(helper);
    const result = await hire(bid.id, { scheduled_start: '2030-08-12T13:00:00Z', scheduled_end: '2030-08-12T14:00:00Z' });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('helper_daily_capacity');
    const state = await jobState(job.id, bid.id);
    expect(state.job).toMatchObject({ status: 'published', assigned_helper_id: null });
    expect(state.bid.status).toBe('pending');
    expect(state.appts).toEqual([]);
  });

  test('the booking buffer is enforced on the hire path (173)', async () => {
    await setCapacity(null, 0, 60);
    await appointment(helper, '2030-08-12T10:00:00Z', '2030-08-12T11:00:00Z');
    const first = await makeJob(helper);
    const tooSoon = await hire(first.bid.id, { scheduled_start: '2030-08-12T11:30:00Z', scheduled_end: '2030-08-12T12:30:00Z' });
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.code).toBe('helper_unavailable');
    const second = await makeJob(helper);
    const clear = await hire(second.bid.id, { scheduled_start: '2030-08-12T12:00:00Z', scheduled_end: '2030-08-12T13:00:00Z' });
    expect(clear.status).toBe(200);
  });

  test('travel blocks and partial-day time off are created through the overrides API and block the slot (175/172)', async () => {
    const created = await request(app).post('/api/helper-profile/availability/overrides')
      .set('x-test-actor', helper).set('x-test-role', 'helper')
      .send({ override_date: '2030-08-12', kind: 'travel', start_time: '09:00', end_time: '10:00', reason: 'Drive to site' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ type: 'travel', start_time: '09:00', end_time: '10:00' });
    const listed = await request(app).get('/api/helper-profile/availability/overrides')
      .set('x-test-actor', helper).set('x-test-role', 'helper');
    expect(listed.status).toBe(200);
    expect(listed.body.overrides).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'travel', override_date: '2030-08-12' }),
    ]));
    expect(await availability.isSlotFree(helper, '2030-08-12T09:30:00Z', '2030-08-12T10:30:00Z', db, 'UTC'))
      .toMatchObject({ free: false });
    expect(await availability.isSlotFree(helper, '2030-08-12T11:00:00Z', '2030-08-12T12:00:00Z', db, 'UTC'))
      .toMatchObject({ free: true });
    const partial = await request(app).post('/api/helper-profile/availability/overrides')
      .set('x-test-actor', helper).set('x-test-role', 'helper')
      .send({ override_date: '2030-08-13', kind: 'time_off', start_time: '09:00', end_time: '12:00', reason: 'Morning off' });
    expect(partial.status).toBe(201);
    expect(partial.body).toMatchObject({ type: 'unavailable', start_time: '09:00', end_time: '12:00' });
    expect(await availability.isSlotFree(helper, '2030-08-13T10:00:00Z', '2030-08-13T11:00:00Z', db, 'UTC'))
      .toMatchObject({ free: false });
    expect(await availability.isSlotFree(helper, '2030-08-13T13:00:00Z', '2030-08-13T14:00:00Z', db, 'UTC'))
      .toMatchObject({ free: true });
    const badKind = await request(app).post('/api/helper-profile/availability/overrides')
      .set('x-test-actor', helper).set('x-test-role', 'helper')
      .send({ override_date: '2030-08-14', kind: 'holiday' });
    expect(badKind.status).toBe(400);
    const removed = await request(app).delete(`/api/helper-profile/availability/overrides/${created.body.id}`)
      .set('x-test-actor', helper).set('x-test-role', 'helper');
    expect(removed.status).toBe(200);
    expect(await availability.isSlotFree(helper, '2030-08-12T09:30:00Z', '2030-08-12T10:30:00Z', db, 'UTC'))
      .toMatchObject({ free: true });
  });

  test('booking buffer persists through the capacity service and preserves when omitted (173)', async () => {
    expect((await capacity.read(helper)).booking_buffer_minutes).toBe(0);
    const saved = await setCapacity(null, 0, 45);
    expect(saved).toMatchObject({ booking_buffer_minutes: 45 });
    expect((await capacity.read(helper)).booking_buffer_minutes).toBe(45);
    const preserved = await setCapacity(null, 0);
    expect(preserved).toMatchObject({ booking_buffer_minutes: 45 });
    const current = await capacity.read(helper);
    await expect(capacity.save(helper, {
      daily_job_limit: null, travel_buffer_minutes: 0, booking_buffer_minutes: 241,
      expectedVersion: current.capacity_version,
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('a travel block created through the one-off blocks API is accepted (175)', async () => {
    const created = await request(app).post('/api/calendar/availability')
      .set('x-test-actor', helper).set('x-test-role', 'helper')
      .send({ start_time: '2030-08-14T09:00:00Z', end_time: '2030-08-14T10:00:00Z', type: 'travel', title: 'Drive' });
    expect(created.status).toBe(201);
    expect(created.body.type).toBe('travel');
    expect(await availability.isSlotFree(helper, '2030-08-14T09:30:00Z', '2030-08-14T10:30:00Z', db, 'UTC'))
      .toMatchObject({ free: false });
  });
});
