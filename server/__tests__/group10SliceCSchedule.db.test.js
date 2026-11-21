'use strict';

// Group 10 Slice C acceptance: schedule sessions (516-520).
// Covers the built items end to end: appointment options round-trip
// through book-slot (516, verified EXISTS), time-zone conversion on the
// slot endpoints (517), reschedule proposals with accept/decline/withdraw
// (518), unified cancellation for client, consultant, and admin (519),
// and attendance confirmation plus the admin complete guard (520).
// Decisions D-107/D-108/D-109 in persona-roadmap-decisions.md.

jest.unmock('pg');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.ACCESS_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/(credit_statement_test|pa_t\d+)$/.test(url.pathname)) {
    throw new Error('Group 10 Slice C DB tests require a loopback disposable database');
  }
  process.env.DATABASE_URL = dbUrl;
}

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g10c-consultant-${id}@example.invalid`,
      email_verified: !req.get('x-test-unverified'),
    };
    return next();
  };
  return { authenticate, authenticateIfPresent: (req, res, next) => (
    req.get('x-test-user') ? authenticate(req, res, next) : next()
  ) };
});
jest.mock('../middleware/adminAuth', () => ({
  ...jest.requireActual('../middleware/adminAuth'),
  requireAdmin: (req, res, next) => {
    if (req.user?.role !== 'super_admin') return res.sendStatus(403);
    req.isSuper = true;
    return next();
  },
  requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
  sendEmailOrThrow: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 10 Slice C: schedule sessions', () => {
  let db;
  let app;
  const savedFlags = { ...process.env };

  beforeAll(async () => {
    process.env.SIGNED_URL_SECRET = 'group10-slice-c-fixture-secret';
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/scheduling', require('../routes/consultantScheduling'));
    app.use('/api/consulting/contractor', require('../routes/consultantNetwork'));
    app.use('/api/consulting/admin', require('../routes/consultingAdmin'));
  });

  afterEach(() => {
    for (const key of ['ACCESS_CONSULTANT_ENFORCEMENT', 'ACCESS_REQUESTS_ENABLED']) {
      if (savedFlags[key] === undefined) delete process.env[key];
      else process.env[key] = savedFlags[key];
    }
  });

  afterAll(async () => { await db?.end(); });

  async function addUser(role = 'customer') {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed)
       VALUES ($1, $2, 'x', 'Consultant', 'Fixture', $3, $4, TRUE, TRUE, TRUE)`,
      [id, `g10c-user-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
    );
    mockRoles.set(id, role);
    return id;
  }

  async function addApprovedConsultant({ timezone = 'America/New_York' } = {}) {
    const id = await addUser();
    // getAvailableSlots / getNextAvailableDates require default_mode =
    // 'consultant' outside enforce mode (publicConsultantExists).
    await db.query(`UPDATE users SET default_mode = 'consultant' WHERE id = $1`, [id]);
    await db.query(
      `INSERT INTO consultant_contractor_profiles (user_id, approval_status, is_active, default_oxsteed_cut_bps, timezone)
       VALUES ($1, 'approved', TRUE, 2000, $2)`,
      [id, timezone],
    );
    return id;
  }

  async function addSession(client, consultant) {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_sessions (user_id, email, first_name, last_name, consultant_assigned_id, status)
       VALUES ($1, $2, 'Casey', 'Client', $3, 'scheduled') RETURNING id`,
      [client, `g10c-client-${client}@example.invalid`, consultant],
    );
    return row.id;
  }

  // A confirmed appointment on a date `daysOut` days from now, with
  // availability covering 09:00-13:00 on that weekday. Returns the
  // scheduled row id and the canonical date/time.
  async function addConfirmedAppointment(client, consultant, { daysOut = 7, startTime = '09:00', durationMinutes = 120 } = {}) {
    const target = new Date(Date.now() + daysOut * 864e5);
    const date = target.toISOString().slice(0, 10);
    await db.query(
      `INSERT INTO consultant_availability (consultant_id, day_of_week, start_time, end_time, is_active)
       VALUES ($1, $2, '09:00', '13:00', TRUE)
       ON CONFLICT (consultant_id, day_of_week)
       DO UPDATE SET start_time = '09:00', end_time = '13:00', is_active = TRUE`,
      [consultant, target.getUTCDay()],
    );
    const sessionId = await addSession(client, consultant);
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_sessions_scheduled
         (session_id, scheduled_date, scheduled_time, duration_minutes, consultant_assigned_id, status, timezone)
       VALUES ($1, $2, $3, $4, $5, 'confirmed', 'America/New_York')
       RETURNING id`,
      [sessionId, date, startTime, durationMinutes, consultant],
    );
    return { scheduledId: row.id, sessionId, date, startTime, durationMinutes };
  }

  // A past appointment: yesterday, same availability window.
  async function addPastAppointment(client, consultant) {
    const target = new Date(Date.now() - 864e5);
    const date = target.toISOString().slice(0, 10);
    await db.query(
      `INSERT INTO consultant_availability (consultant_id, day_of_week, start_time, end_time, is_active)
       VALUES ($1, $2, '09:00', '13:00', TRUE)
       ON CONFLICT (consultant_id, day_of_week)
       DO UPDATE SET start_time = '09:00', end_time = '13:00', is_active = TRUE`,
      [consultant, target.getUTCDay()],
    );
    const sessionId = await addSession(client, consultant);
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_sessions_scheduled
         (session_id, scheduled_date, scheduled_time, duration_minutes, consultant_assigned_id, status, timezone)
       VALUES ($1, $2, '09:00', 120, $3, 'completed', 'America/New_York')
       RETURNING id`,
      [sessionId, date, consultant],
    );
    return { scheduledId: row.id, sessionId, date };
  }

  async function approveConsultant(consultant, reviewerId) {
    await db.query(
      `INSERT INTO connect_accounts (user_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_complete)
       VALUES ($1, $2, TRUE, TRUE, TRUE)
       ON CONFLICT (user_id) DO UPDATE SET charges_enabled = TRUE, payouts_enabled = TRUE, onboarding_complete = TRUE`,
      [consultant, `acct_g10c_${consultant.replace(/-/g, '').slice(0, 20)}`],
    );
    const access = require('../services/access/accessService');
    const review = require('../services/access/reviewService');
    const { body: { request: application } } = await access.createRequest(consultant, {
      capability: 'consultant.accept_paying_clients', submit: true, answers: {
        bio: 'An independent consultant with experience designing operational processes and training local teams.',
        yearsExperience: 4,
        areasOfExpertise: ['Operations'],
      },
    });
    await review.decide({ id: reviewerId }, application.id, {
      action: 'approve', expectedVersion: application.version, evidenceRevision: application.evidenceRevision,
    });
  }

  test('516: appointment options round-trip through book-slot (duration + meeting format)', async () => {
    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'enforce';
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    const consultant = await addApprovedConsultant();
    const reviewer = await addUser('super_admin');
    const customer = await addUser();
    const target = new Date(Date.now() + 7 * 864e5);
    const date = target.toISOString().slice(0, 10);
    const sessionId = await addSession(customer, consultant);
    await db.query(
      `INSERT INTO consultant_availability (consultant_id, day_of_week, start_time, end_time, is_active)
       VALUES ($1, $2, '09:00', '13:00', TRUE)`,
      [consultant, target.getUTCDay()],
    );
    await approveConsultant(consultant, reviewer);
    const scheduledId = (await request(app).post('/api/scheduling/sessions')
      .set('x-test-user', customer)
      .send({ consultingSessionId: sessionId, consultantId: consultant }).expect(201)).body.id;
    await db.query(
      `INSERT INTO consulting_payments (session_scheduled_id, amount_cents, service_tier, status)
       VALUES ($1, 10000, 'initial', 'completed')`,
      [scheduledId],
    );

    // The 90-minute option is honored end to end, not just displayed.
    const booked = await request(app).post(`/api/scheduling/sessions/${scheduledId}/book-slot`)
      .set('x-test-user', customer)
      .send({ consultantId: consultant, date, startTime: '09:00', durationMinutes: 90, meetingType: 'google_meet' })
      .expect(200);
    expect(booked.body).toMatchObject({ status: 'confirmed', duration_minutes: 90, meeting_type: 'google_meet' });
    const stored = await db.query(
      'SELECT duration_minutes, meeting_type FROM consulting_sessions_scheduled WHERE id = $1', [scheduledId],
    );
    expect(stored.rows[0]).toMatchObject({ duration_minutes: 90, meeting_type: 'google_meet' });

    // Slot generation follows the chosen duration: 90-minute slots step by 90.
    // Availability runs 09:00-13:00, so the generated starts are 09:00 and
    // 10:30; the booked 09:00 slot is filtered out, leaving 10:30.
    const slots = await request(app)
      .get(`/api/scheduling/consultants/${consultant}/available-slots`)
      .query({ date, durationMinutes: 90 })
      .expect(200);
    expect(slots.body.map((s) => s.slot_start)).toEqual(['10:30:00']);
  });

  test('517: slot endpoints convert canonical slots to the client zone; an unknown zone is a 400', async () => {
    // Non-enforce mode: the public endpoints gate on the profile and the
    // consultant default_mode, not on the paying-access grant.
    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'off';
    const consultant = await addApprovedConsultant({ timezone: 'America/New_York' });
    const customer = await addUser();
    const target = new Date(Date.now() + 7 * 864e5);
    const date = target.toISOString().slice(0, 10);
    await db.query(
      `INSERT INTO consultant_availability (consultant_id, day_of_week, start_time, end_time, is_active)
       VALUES ($1, $2, '09:00', '13:00', TRUE)`,
      [consultant, target.getUTCDay()],
    );

    await request(app)
      .get(`/api/scheduling/consultants/${consultant}/available-slots`)
      .query({ date, timezone: 'Not/AZone' })
      .expect(400);
    await request(app)
      .get(`/api/scheduling/consultants/${consultant}/next-available`)
      .query({ timezone: 'Not/AZone' })
      .expect(400);

    // November: New York is UTC-5, Paris is UTC+1, so 09:00 canonical is
    // 15:00 in Paris on the same date. Canonical values stay alongside.
    const slots = await request(app)
      .get(`/api/scheduling/consultants/${consultant}/available-slots`)
      .query({ date, timezone: 'Europe/Paris' })
      .expect(200);
    expect(slots.body.timezone).toBe('America/New_York');
    expect(slots.body.client_timezone).toBe('Europe/Paris');
    expect(slots.body.slots[0]).toMatchObject({
      slot_start: '09:00:00', slot_end: '10:00:00',
      client_slot_start: '15:00', client_slot_end: '16:00', client_date: date,
    });

    const next = await request(app)
      .get(`/api/scheduling/consultants/${consultant}/next-available`)
      .query({ fromDate: date, timezone: 'Europe/Paris' })
      .expect(200);
    expect(next.body.timezone).toBe('America/New_York');
    expect(next.body.dates[0].availableSlots[0]).toMatchObject({
      slot_start: '09:00:00', client_slot_start: '15:00', client_date: date,
    });

    // Without the parameter the legacy bare array is unchanged.
    const legacy = await request(app)
      .get(`/api/scheduling/consultants/${consultant}/available-slots`)
      .query({ date })
      .expect(200);
    expect(Array.isArray(legacy.body)).toBe(true);
    expect(legacy.body[0].slot_start).toBe('09:00:00');
    expect(legacy.body[0].client_slot_start).toBeUndefined();
  });

  test('518: reschedule proposal moves the confirmed row on accept; decline and withdraw leave it in place', async () => {
    const consultant = await addApprovedConsultant();
    const client = await addUser();
    const stranger = await addUser();
    const { scheduledId, date } = await addConfirmedAppointment(client, consultant);

    // A stranger cannot propose; a proposal needs a real future slot.
    await request(app).post(`/api/scheduling/sessions/${scheduledId}/reschedules`)
      .set('x-test-user', stranger)
      .send({ date, startTime: '10:00' })
      .expect(403);
    await request(app).post(`/api/scheduling/sessions/${scheduledId}/reschedules`)
      .set('x-test-user', client)
      .send({ date, startTime: '08:00' })
      .expect(409);

    const proposed = await request(app).post(`/api/scheduling/sessions/${scheduledId}/reschedules`)
      .set('x-test-user', client)
      .send({ date, startTime: '11:00', durationMinutes: 60, reason: 'A work meeting came up.' })
      .expect(201);
    expect(proposed.body).toMatchObject({ status: 'proposed', proposed_by_role: 'client', proposed_time: '11:00:00' });

    // One open proposal at a time.
    await request(app).post(`/api/scheduling/sessions/${scheduledId}/reschedules`)
      .set('x-test-user', client)
      .send({ date, startTime: '12:00' })
      .expect(409);

    // The proposer cannot accept their own proposal; the consultant can.
    await request(app).post(`/api/scheduling/sessions/${scheduledId}/reschedules/${proposed.body.id}/accept`)
      .set('x-test-user', client)
      .expect(403);
    const accepted = await request(app)
      .post(`/api/scheduling/sessions/${scheduledId}/reschedules/${proposed.body.id}/accept`)
      .set('x-test-user', consultant)
      .expect(200);
    expect(accepted.body.proposal.status).toBe('accepted');
    expect(accepted.body.scheduled).toMatchObject({ scheduled_time: '11:00:00', duration_minutes: 60, status: 'confirmed' });
    const moved = await db.query(
      'SELECT scheduled_time, duration_minutes, status FROM consulting_sessions_scheduled WHERE id = $1', [scheduledId],
    );
    expect(moved.rows[0]).toMatchObject({ scheduled_time: '11:00:00', duration_minutes: 60, status: 'confirmed' });

    // A second proposal on the moved time: decline leaves the row in place,
    // and withdrawing the next one does too.
    const second = await request(app).post(`/api/scheduling/sessions/${scheduledId}/reschedules`)
      .set('x-test-user', consultant)
      .send({ date, startTime: '09:00' })
      .expect(201);
    const declined = await request(app)
      .post(`/api/scheduling/sessions/${scheduledId}/reschedules/${second.body.id}/decline`)
      .set('x-test-user', client)
      .send({ reason: 'That morning does not work for me.' })
      .expect(200);
    expect(declined.body.status).toBe('declined');
    const third = await request(app).post(`/api/scheduling/sessions/${scheduledId}/reschedules`)
      .set('x-test-user', client)
      .send({ date, startTime: '12:00' })
      .expect(201);
    const withdrawn = await request(app)
      .post(`/api/scheduling/sessions/${scheduledId}/reschedules/${third.body.id}/withdraw`)
      .set('x-test-user', client)
      .expect(200);
    expect(withdrawn.body.status).toBe('withdrawn');
    const still = await db.query(
      'SELECT scheduled_time FROM consulting_sessions_scheduled WHERE id = $1', [scheduledId],
    );
    expect(still.rows[0].scheduled_time).toBe('11:00:00');

    // The consultant's sessions list carries the proposals.
    const list = await request(app).get('/api/consulting/contractor/sessions')
      .set('x-test-user', consultant).expect(200);
    const mine = list.body.find((s) => s.scheduled_id === scheduledId);
    expect(mine).toBeDefined();
    expect(mine.proposals).toHaveLength(3);
  });

  test('518: accept re-validates the slot, so a proposal that went stale cannot move the row', async () => {
    const consultant = await addApprovedConsultant();
    const client = await addUser();
    const client2 = await addUser();
    const first = await addConfirmedAppointment(client, consultant, { startTime: '09:00' });
    // Propose 10:00 with a 60-minute duration (hourly slots exist at that
    // length), then a booking lands on 10:00-12:00 between propose and
    // accept; accept must 409 and the row must stay at 09:00.
    const proposal = await request(app).post(`/api/scheduling/sessions/${first.scheduledId}/reschedules`)
      .set('x-test-user', client)
      .send({ date: first.date, startTime: '10:00', durationMinutes: 60 })
      .expect(201);
    const blockerSessionId = await addSession(client2, consultant);
    await db.query(
      `INSERT INTO consulting_sessions_scheduled
         (session_id, scheduled_date, scheduled_time, duration_minutes, consultant_assigned_id, status)
       VALUES ($1, $2, '10:00', 120, $3, 'confirmed')`,
      [blockerSessionId, first.date, consultant],
    );
    const accepted = await request(app)
      .post(`/api/scheduling/sessions/${first.scheduledId}/reschedules/${proposal.body.id}/accept`)
      .set('x-test-user', consultant);
    expect(accepted.status).toBe(409);
    const unchanged = await db.query(
      'SELECT scheduled_time FROM consulting_sessions_scheduled WHERE id = $1', [first.scheduledId],
    );
    expect(unchanged.rows[0].scheduled_time).toBe('09:00:00');
  });

  test('519: cancel moves both rows in one transaction, records the reason and refund request, and notifies both parties', async () => {
    const consultant = await addApprovedConsultant();
    const client = await addUser();
    const stranger = await addUser();
    const { scheduledId } = await addConfirmedAppointment(client, consultant);
    const { sendNotification } = require('../services/notificationService');

    await request(app).post(`/api/scheduling/sessions/${scheduledId}/cancel`)
      .set('x-test-user', stranger)
      .send({ reason: 'Not mine.' })
      .expect(403);

    const cancelled = await request(app).post(`/api/scheduling/sessions/${scheduledId}/cancel`)
      .set('x-test-user', client)
      .send({ reason: 'My plans changed.', refund_requested: true })
      .expect(200);
    expect(cancelled.body).toMatchObject({
      status: 'cancelled', cancellation_reason: 'My plans changed.', refund_requested: true,
    });
    const rows = await db.query(
      `SELECT css.status AS scheduled_status, cs.status AS session_status
         FROM consulting_sessions_scheduled css
         JOIN consulting_sessions cs ON cs.id = css.session_id
        WHERE css.id = $1`,
      [scheduledId],
    );
    expect(rows.rows[0]).toMatchObject({ scheduled_status: 'cancelled', session_status: 'cancelled' });
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'consulting_session_cancelled', userId: client,
    }));
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'consulting_session_cancelled', userId: consultant,
    }));

    // A cancelled appointment cannot be cancelled again.
    await request(app).post(`/api/scheduling/sessions/${scheduledId}/cancel`)
      .set('x-test-user', client)
      .send({ reason: 'Again.' })
      .expect(409);

    // The consultant can cancel their own appointment the same way.
    const second = await addConfirmedAppointment(client, consultant, { startTime: '11:00' });
    const consultantCancelled = await request(app)
      .post(`/api/scheduling/sessions/${second.scheduledId}/cancel`)
      .set('x-test-user', consultant)
      .send({ reason: 'I am ill.' })
      .expect(200);
    expect(consultantCancelled.body.status).toBe('cancelled');
  });

  test('519: the admin status dropdown cancelling a session mirrors the scheduled row', async () => {
    const consultant = await addApprovedConsultant();
    const client = await addUser();
    const admin = await addUser('super_admin');
    const { scheduledId, sessionId } = await addConfirmedAppointment(client, consultant);

    await request(app).patch(`/api/consulting/admin/sessions/${sessionId}`)
      .set('x-test-user', admin)
      .send({ status: 'cancelled' })
      .expect(200);
    const rows = await db.query(
      'SELECT status FROM consulting_sessions_scheduled WHERE id = $1', [scheduledId],
    );
    expect(rows.rows[0].status).toBe('cancelled');
  });

  test('520: each party confirms their own attendance after the start; future sessions and admins are refused', async () => {
    const consultant = await addApprovedConsultant();
    const client = await addUser();
    const admin = await addUser('super_admin');
    const past = await addPastAppointment(client, consultant);
    const future = await addConfirmedAppointment(client, consultant);

    // A future session cannot be attendance-confirmed by anyone.
    await request(app).post(`/api/scheduling/sessions/${future.scheduledId}/attendance`)
      .set('x-test-user', client)
      .expect(409);

    // The admin is not a party and cannot confirm for one.
    await request(app).post(`/api/scheduling/sessions/${past.scheduledId}/attendance`)
      .set('x-test-user', admin)
      .expect(403);

    const clientConfirmed = await request(app)
      .post(`/api/scheduling/sessions/${past.scheduledId}/attendance`)
      .set('x-test-user', client)
      .expect(201);
    expect(clientConfirmed.body).toMatchObject({ role: 'client' });
    const consultantConfirmed = await request(app)
      .post(`/api/scheduling/sessions/${past.scheduledId}/attendance`)
      .set('x-test-user', consultant)
      .expect(201);
    expect(consultantConfirmed.body).toMatchObject({ role: 'consultant' });

    // One confirmation per party.
    await request(app).post(`/api/scheduling/sessions/${past.scheduledId}/attendance`)
      .set('x-test-user', client)
      .expect(409);

    const listed = await request(app)
      .get(`/api/scheduling/sessions/${past.scheduledId}/attendance`)
      .set('x-test-user', consultant)
      .expect(200);
    expect(listed.body.map(({ role }) => role).sort()).toEqual(['client', 'consultant']);
  });

  test('520: admin complete refuses a future-dated session and allows a past one', async () => {
    const consultant = await addApprovedConsultant();
    const client = await addUser();
    const admin = await addUser('super_admin');
    const future = await addConfirmedAppointment(client, consultant);
    const past = await addPastAppointment(client, consultant);

    const refused = await request(app)
      .patch(`/api/consulting/admin/sessions/${future.sessionId}/complete`)
      .set('x-test-user', admin);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('session_not_started');
    const stillConfirmed = await db.query(
      'SELECT status FROM consulting_sessions_scheduled WHERE id = $1', [future.scheduledId],
    );
    expect(stillConfirmed.rows[0].status).toBe('confirmed');

    await request(app)
      .patch(`/api/consulting/admin/sessions/${past.sessionId}/complete`)
      .set('x-test-user', admin)
      .expect(200);
    const completed = await db.query(
      'SELECT status FROM consulting_sessions WHERE id = $1', [past.sessionId],
    );
    expect(completed.rows[0].status).toBe('completed');
  });
});
