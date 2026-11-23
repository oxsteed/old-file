'use strict';

// Group 10 Slice I acceptance: operate the practice (546-550).
// Covers the built items end to end: inquiry pipeline report (546),
// availability utilization (547), outstanding deliverables view (548),
// permitted earnings report (549), and practice support intake (550).
// Decisions D-146..D-152 in persona-roadmap-decisions.md.

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
    || !/^\/((credit_statement_test(_pr804_d)?)|(pa_[tg]\d+))$/.test(url.pathname)) {
    throw new Error('Group 10 Slice I DB tests require a loopback disposable database');
  }
  process.env.DATABASE_URL = dbUrl;
  process.env.STATEMENT_TEST_DATABASE_URL = dbUrl;
}

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g10i-user-${id}@example.invalid`,
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
jest.mock('../services/supportNotificationService', () => ({
  notifySupportStaff: jest.fn().mockResolvedValue(true),
  resolveSupportStaffIds: jest.fn().mockResolvedValue([]),
  scheduleSupportMessageNotifications: jest.fn().mockResolvedValue(undefined),
}));

const { notifySupportStaff } = require('../services/supportNotificationService');
const { NOTIFICATION_TYPES } = require('../utils/notificationTypeCatalog');

const describeDb = dbUrl ? describe : describe.skip;

function isoDate(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

describeDb('Group 10 Slice I: operate the practice', () => {
  let db;
  let app;
  const savedFlags = { ...process.env };

  beforeAll(async () => {
    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'shadow';
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/consulting/contractor', require('../routes/consultantNetwork'));
  });

  afterEach(() => {
    for (const key of ['ACCESS_CONSULTANT_ENFORCEMENT', 'ACCESS_REQUESTS_ENABLED']) {
      if (savedFlags[key] === undefined) delete process.env[key];
      else process.env[key] = savedFlags[key];
    }
    jest.clearAllMocks();
  });

  afterAll(async () => { await db?.end(); });

  async function addUser(role = 'customer') {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed)
       VALUES ($1, $2, 'x', 'Casey', 'Fixture', $3, $4, TRUE, TRUE, TRUE)`,
      [id, `g10i-user-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
    );
    mockRoles.set(id, role);
    return id;
  }

  async function addApprovedConsultant(cutBps = 2000) {
    const id = await addUser();
    await db.query(`UPDATE users SET default_mode = 'consultant' WHERE id = $1`, [id]);
    await db.query(
      `INSERT INTO consultant_contractor_profiles (user_id, approval_status, is_active, default_oxsteed_cut_bps, timezone)
       VALUES ($1, 'approved', TRUE, $2, 'America/New_York')`,
      [id, cutBps],
    );
    return id;
  }

  async function addReferral(consultant, overrides = {}) {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_requests
         (user_id, email, first_name, last_name, phone, business_name,
          skill_description, target_market, status, consultant_assigned_id,
          consultant_assignment_status, assigned_oxsteed_cut_bps,
          assigned_consultant_cut_bps, estimated_total_price_cents,
          estimated_oxsteed_share_cents, estimated_consultant_share_cents)
       VALUES ($1, $2, 'Casey', 'Client', '555-0100', $3,
          'Launch a bakery', 'Local food', 'in_progress', $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        await addUser(),
        `g10i-client-${randomUUID()}@example.invalid`,
        overrides.business_name || 'Casey Bakery',
        consultant,
        overrides.stage || 'assigned',
        overrides.oxsteed_cut_bps ?? 2000,
        overrides.consultant_cut_bps ?? 8000,
        overrides.total_cents ?? 100000,
        overrides.oxsteed_cents ?? 20000,
        overrides.consultant_cents ?? 80000,
      ],
    );
    return String(row.id);
  }

  async function addSession(client, consultant, overrides = {}) {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_sessions
         (user_id, email, first_name, last_name, business_name,
          consultant_assigned_id, status, referral_id)
       VALUES ($1, $2, 'Casey', 'Client', $3, $4, $5, $6)
       RETURNING id`,
      [
        client,
        `g10i-client-${client}@example.invalid`,
        overrides.business_name || 'Casey Bakery',
        consultant,
        overrides.status || 'scheduled',
        overrides.referral_id || null,
      ],
    );
    return String(row.id);
  }

  async function addScheduled(sessionId, consultant, overrides = {}) {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_sessions_scheduled
         (session_id, scheduled_date, scheduled_time, duration_minutes, status, consultant_assigned_id)
       VALUES ($1, $2, '10:00', $3, $4, $5)
       RETURNING id`,
      [
        sessionId,
        overrides.date || isoDate(0),
        overrides.duration_minutes ?? 120,
        overrides.status || 'confirmed',
        consultant,
      ],
    );
    return String(row.id);
  }

  async function addAvailability(consultant, dayOfWeek, start = '09:00', end = '17:00') {
    await db.query(
      `INSERT INTO consultant_availability (consultant_id, day_of_week, start_time, end_time, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (consultant_id, day_of_week) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, is_active = TRUE`,
      [consultant, dayOfWeek, start, end],
    );
  }

  async function addDeliverable(sessionId, overrides = {}) {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_deliverables (session_id, name, description, deliverable_type, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        sessionId,
        overrides.name || 'Supplier shortlist',
        overrides.description || 'Three vetted suppliers.',
        overrides.deliverable_type || 'other',
        overrides.due_date || isoDate(7),
        overrides.status || 'pending',
      ],
    );
    return row;
  }

  async function addPayment(scheduledId, overrides = {}) {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_payments (session_scheduled_id, amount_cents, service_tier, status)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [scheduledId, overrides.amount_cents ?? 50000, overrides.service_tier || 'foundation', overrides.status || 'completed'],
    );
    return row;
  }

  function auth(userId) {
    return { 'x-test-user': userId };
  }

  async function setup() {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const other = await addApprovedConsultant();
    return { client, consultant, other };
  }

  test('546: inquiry pipeline report groups the consultant’s own referrals by stage with estimate sums', async () => {
    const { consultant, other } = await setup();
    await addReferral(consultant, { stage: 'discovery_scheduled', total_cents: 100000, oxsteed_cents: 20000, consultant_cents: 80000 });
    await addReferral(consultant, { stage: 'proposal_sent', total_cents: 50000, oxsteed_cents: 10000, consultant_cents: 40000 });
    await addReferral(consultant, { stage: 'lost', total_cents: 70000, oxsteed_cents: 14000, consultant_cents: 56000 });
    await addReferral(other, { stage: 'won', total_cents: 999999, oxsteed_cents: 999999, consultant_cents: 999999 });

    const res = await request(app)
      .get('/api/consulting/contractor/practice/inquiry-pipeline')
      .set(auth(consultant));
    expect(res.status).toBe(200);
    const byStage = Object.fromEntries(res.body.stages.map((s) => [s.stage, s]));
    expect(byStage.discovery_scheduled.count).toBe(1);
    expect(byStage.discovery_scheduled.estimatedConsultantShareCents).toBe(80000);
    expect(byStage.proposal_sent.count).toBe(1);
    expect(byStage.lost.count).toBe(1);
    expect(byStage.won.count).toBe(0);
    expect(res.body.totals.count).toBe(3);
    expect(res.body.totals.estimatedConsultantShareCents).toBe(176000);
    expect(res.body.referrals).toHaveLength(3);
    expect(res.body.referrals.some((r) => r.stage === 'lost')).toBe(true);
  });

  test('547: utilization counts confirmed and completed minutes against recurring windows, minus blocked days, plus exceptions', async () => {
    const { consultant } = await setup();
    // Eight hours every day of the week.
    for (let dow = 0; dow <= 6; dow += 1) await addAvailability(consultant, dow, '09:00', '17:00');
    const from = isoDate(-6);
    const to = isoDate(0);
    // Block the day 3 days ago entirely; the exception 2 days ago
    // shortens the window to 2 hours.
    await db.query(
      `INSERT INTO consultant_blocked_dates (consultant_id, blocked_date, reason) VALUES ($1, $2, 'Holiday')`,
      [consultant, isoDate(-3)],
    );
    await db.query(
      `INSERT INTO consultant_schedule_exceptions (consultant_id, exception_date, start_time, end_time, is_available)
       VALUES ($1, $2, '09:00', '11:00', TRUE)`,
      [consultant, isoDate(-2)],
    );
    const client = await addUser();
    // One scheduled row per session: session_id is unique on
    // consulting_sessions_scheduled.
    const s1 = await addSession(client, consultant);
    const s2 = await addSession(client, consultant);
    const s3 = await addSession(client, consultant);
    const s4 = await addSession(client, consultant);
    await addScheduled(s1, consultant, { date: isoDate(-1), duration_minutes: 120, status: 'completed' });
    await addScheduled(s2, consultant, { date: isoDate(0), duration_minutes: 60, status: 'confirmed' });
    await addScheduled(s3, consultant, { date: isoDate(0), duration_minutes: 60, status: 'no_show' });
    await addScheduled(s4, consultant, { date: isoDate(0), duration_minutes: 60, status: 'cancelled' });

    const res = await request(app)
      .get(`/api/consulting/contractor/practice/utilization?from=${from}&to=${to}`)
      .set(auth(consultant));
    expect(res.status).toBe(200);
    // 7 days: 5 full days x 480 + blocked 0 + exception 120 = 2520.
    expect(res.body.totalAvailableMinutes).toBe(2520);
    // Only confirmed + completed count: 120 + 60 = 180.
    expect(res.body.totalBookedMinutes).toBe(180);
    expect(res.body.utilizationPercent).toBeCloseTo(7.1, 1);
    expect(res.body.days).toHaveLength(7);
    expect(res.body.days.find((d) => d.date === isoDate(-3)).availableMinutes).toBe(0);
    expect(res.body.days.find((d) => d.date === isoDate(-2)).availableMinutes).toBe(120);

    const bad = await request(app)
      .get(`/api/consulting/contractor/practice/utilization?from=${to}&to=${from}`)
      .set(auth(consultant));
    expect(bad.status).toBe(400);
    const tooLong = await request(app)
      .get(`/api/consulting/contractor/practice/utilization?from=${isoDate(-100)}&to=${to}`)
      .set(auth(consultant));
    expect(tooLong.status).toBe(400);
  });

  test('547: utilization is null when the consultant set no availability', async () => {
    const { consultant } = await setup();
    const res = await request(app)
      .get('/api/consulting/contractor/practice/utilization')
      .set(auth(consultant));
    expect(res.status).toBe(200);
    expect(res.body.totalAvailableMinutes).toBe(0);
    expect(res.body.utilizationPercent).toBeNull();
  });

  test('548: outstanding deliverables split into needs-action and awaiting-acceptance, overdue first, archived excluded', async () => {
    const { client, consultant, other } = await setup();
    const sessionId = await addSession(client, consultant);
    await addDeliverable(sessionId, { name: 'Overdue work', status: 'overdue', due_date: isoDate(-2) });
    await addDeliverable(sessionId, { name: 'Open work', status: 'in_progress', due_date: isoDate(3) });
    await addDeliverable(sessionId, { name: 'Done awaiting client', status: 'completed', due_date: isoDate(-1) });
    await addDeliverable(sessionId, { name: 'Accepted work', status: 'accepted', due_date: isoDate(-5) });
    const archivedId = await addSession(client, consultant, { status: 'archived' });
    await addDeliverable(archivedId, { name: 'Archived work', status: 'overdue', due_date: isoDate(-9) });
    const otherSessionId = await addSession(client, other);
    await addDeliverable(otherSessionId, { name: 'Other consultant work', status: 'overdue', due_date: isoDate(-9) });

    const res = await request(app)
      .get('/api/consulting/contractor/practice/deliverables/outstanding')
      .set(auth(consultant));
    expect(res.status).toBe(200);
    expect(res.body.outstanding.map((d) => d.name)).toEqual(['Overdue work', 'Open work']);
    expect(res.body.outstanding[0].daysOverdue).toBe(2);
    expect(res.body.awaitingAcceptance.map((d) => d.name)).toEqual(['Done awaiting client']);
    expect(res.body.counts.overdue).toBe(1);
    expect(res.body.counts.accepted).toBeUndefined();
  });

  test('549: earnings report counts completed payments only, splits by the agreed cut, refunds counted separately', async () => {
    const { client, consultant, other } = await setup();
    const referralId = await addReferral(consultant, { oxsteed_cut_bps: 2000, consultant_cut_bps: 8000 });
    const sessionId = await addSession(client, consultant, { referral_id: referralId });
    const scheduledId = await addScheduled(sessionId, consultant, { status: 'completed' });
    // 50001 cents at a 20% OxSteed cut: OxSteed rounds to 10000, the
    // consultant takes the 40001 remainder (the assignment formula).
    await addPayment(scheduledId, { amount_cents: 50001, status: 'completed' });
    await addPayment(scheduledId, { amount_cents: 10000, status: 'refunded' });
    await addPayment(scheduledId, { amount_cents: 99999, status: 'pending' });
    const otherSessionId = await addSession(client, other);
    const otherScheduledId = await addScheduled(otherSessionId, other, { status: 'completed' });
    await addPayment(otherScheduledId, { amount_cents: 777777, status: 'completed' });

    const res = await request(app)
      .get('/api/consulting/contractor/practice/earnings')
      .set(auth(consultant));
    expect(res.status).toBe(200);
    expect(res.body.totals.completedPayments).toBe(1);
    expect(res.body.totals.grossCents).toBe(50001);
    expect(res.body.totals.oxsteedShareCents).toBe(10000);
    expect(res.body.totals.consultantShareCents).toBe(40001);
    expect(res.body.totals.refundedCount).toBe(1);
    expect(res.body.totals.refundedCents).toBe(10000);
    expect(res.body.statusCounts.pending).toBe(1);
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.monthly).toHaveLength(1);
    expect(res.body.monthly[0].grossCents).toBe(50001);
  });

  test('549: earnings totals cover all completed payments, not just the 200 listed rows', async () => {
    const { client, consultant } = await setup();
    const sessionId = await addSession(client, consultant);
    const scheduledId = await addScheduled(sessionId, consultant, { status: 'completed' });
    await db.query(
      `INSERT INTO consulting_payments (session_scheduled_id, amount_cents, service_tier, status)
       SELECT $1, 1000, 'foundation', 'completed' FROM generate_series(1, 201)`,
      [scheduledId],
    );

    const res = await request(app)
      .get('/api/consulting/contractor/practice/earnings')
      .set(auth(consultant));
    expect(res.status).toBe(200);
    expect(res.body.totals.completedPayments).toBe(201);
    expect(res.body.totals.grossCents).toBe(201000);
    expect(res.body.totals.oxsteedShareCents).toBe(40200);
    expect(res.body.totals.consultantShareCents).toBe(160800);
    expect(res.body.payments).toHaveLength(200);
  });

  test('549: earnings without a referral fall back to the profile default cut', async () => {
    const { client, consultant } = await setup();
    const sessionId = await addSession(client, consultant);
    const scheduledId = await addScheduled(sessionId, consultant, { status: 'completed' });
    await addPayment(scheduledId, { amount_cents: 10000, status: 'completed' });

    const res = await request(app)
      .get('/api/consulting/contractor/practice/earnings')
      .set(auth(consultant));
    expect(res.status).toBe(200);
    expect(res.body.totals.oxsteedShareCents).toBe(2000);
    expect(res.body.totals.consultantShareCents).toBe(8000);
  });

  test('550: practice support intake files a ticket with the first message and notifies staff; replay dedupes', async () => {
    const { consultant, other } = await setup();
    const clientRequestId = randomUUID();
    const res = await request(app)
      .post('/api/consulting/contractor/practice/support')
      .set(auth(consultant))
      .send({ subject: 'Pricing question', message: 'How do I change my package price?', priority: 'high', clientRequestId });
    expect(res.status).toBe(201);
    expect(res.body.ticket.subject).toBe('Pricing question');
    expect(res.body.ticket.priority).toBe('high');
    expect(res.body.ticket.status).toBe('open');
    expect(res.body.ticket.ticketNumber).toEqual(expect.any(Number));
    expect(res.body.duplicate).toBe(false);
    expect(notifySupportStaff).toHaveBeenCalledTimes(1);
    expect(notifySupportStaff.mock.calls[0][0].type).toBe('consulting_practice_support_requested');

    const replay = await request(app)
      .post('/api/consulting/contractor/practice/support')
      .set(auth(consultant))
      .send({ subject: 'Pricing question', message: 'How do I change my package price?', priority: 'high', clientRequestId });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.ticket.id).toBe(res.body.ticket.id);
    expect(notifySupportStaff).toHaveBeenCalledTimes(1);

    const bad = await request(app)
      .post('/api/consulting/contractor/practice/support')
      .set(auth(consultant))
      .send({ subject: '', message: 'x' });
    expect(bad.status).toBe(400);

    const list = await request(app)
      .get('/api/consulting/contractor/practice/support')
      .set(auth(consultant));
    expect(list.status).toBe(200);
    expect(list.body.tickets).toHaveLength(1);
    expect(list.body.tickets[0].messageCount).toBe(1);

    const otherList = await request(app)
      .get('/api/consulting/contractor/practice/support')
      .set(auth(other));
    expect(otherList.body.tickets).toHaveLength(0);
  });

  test('Catalog: the practice support notification type is cataloged', async () => {
    const types = new Set(NOTIFICATION_TYPES.map((entry) => entry.type));
    expect(types.has('consulting_practice_support_requested')).toBe(true);
  });
});
