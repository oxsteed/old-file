'use strict';

// Group 1 checkpoint 5 (G1-B7 + D-15): booking-linked support for customers
// and the support booking read for platform support agents (non-admin).
//
// Customer side: POST /support-routing/conversations (the signed-in ticket
// form) accepts job_id / booking_id. Both ids are validated against the
// caller's own booking/job and fail closed (403) otherwise; the missing
// side is derived (booking via converted_to_job_id, job the same way).
// The linkage is stored on the conversation's channel_metadata JSONB
// (migration 403) — no new column, no new migration.
//
// Agent side (D-15): GET /api/support/bookings/:id returns the same
// redacted read admins use (stripe intent/refund ids never selected) to
// an active platform support agent — an active support_agents row for the
// caller under the platform employer (supportEmployerService
// .findPlatformAgent). Business agents stay out: they answer their own
// employer's queue, not platform bookings. Admin permission grants cannot
// authorize a non-admin (grants are issued to regular admins only), so no
// grant check is part of the gate.
//
// The helper-only entry (HelperJobSupport -> helperJobSupportService) is
// untouched: the assigned helper still files, a non-assigned user still
// cannot.
//
// Runs against a dedicated fresh database (credit_statement_test_g1ckpt5)
// so checkpoint fixtures never pollute the shared credit_statement_test DB.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

// Coordinator correction: the beforeAll (three route trees + ~15
// sequential fixture inserts) takes most of the 15s default hook timeout
// on this VM, so the suite timed out in beforeAll on a cold run while
// passing with a longer timeout. 60s, same as the checkpoint-3 suite.
jest.setTimeout(60000);

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.G1_CKPT5_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g1ckpt5') {
    throw new Error('Group 1 checkpoint 5 DB tests require the loopback credit_statement_test_g1ckpt5 database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: req.get('x-test-role') || 'customer',
      email: req.get('x-test-email') || `g1ckpt5-${id}@example.invalid`,
      email_verified: true,
    };
    return next();
  };
  return {
    authenticate,
    requireAuth: authenticate,
    optionalAuth: authenticate,
    authenticateIfPresent: (req, res, next) => (
      req.get('x-test-user') ? authenticate(req, res, next) : next()
    ),
  };
});
jest.mock('../middleware/adminAuth', () => ({
  ...jest.requireActual('../middleware/adminAuth'),
  // The real requireAdmin authenticates from the bearer token and sets
  // req.user itself; the admin router does not run the auth middleware
  // first, so this mock must do both jobs for the test headers.
  requireAdmin: (req, res, next) => {
    if (!req.user) {
      const id = req.get('x-test-user');
      if (!id) return res.sendStatus(401);
      req.user = {
        id,
        role: req.get('x-test-role') || 'customer',
        email: req.get('x-test-email') || `g1ckpt5-${id}@example.invalid`,
      };
    }
    if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') return res.sendStatus(403);
    return next();
  },
  requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../middleware/rejectImpersonated', () => ({
  rejectImpersonated: (req, res, next) => next(),
  isImpersonatedRequest: () => false,
}));
// Routing is pre-existing behaviour, not under test here: every filed
// conversation queues instead of racing a live agent assignment.
jest.mock('../services/supportRoutingService', () => class {
  static async routeTicket() {
    return { routedTo: 'queue', confidence: 1 };
  }
});
jest.mock('../services/websocketService', () => ({
  broadcastToAdmins: jest.fn(),
  notifyAgent: jest.fn(),
  isInitialized: () => false,
  getActiveAgentCount: () => 0,
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/supportNotificationService', () => ({
  notifySupportStaff: jest.fn().mockResolvedValue({}),
  scheduleSupportMessageNotifications: jest.fn(),
  SUPPORT_STAFF_ALERT_LIMIT: 10,
}));
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true, id: 'email-test' }),
  sendEmailOrThrow: jest.fn().mockResolvedValue({ success: true }),
  sendOTPEmail: jest.fn().mockResolvedValue(true),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
}));

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 1 checkpoint 5: booking-linked support + support-agent booking read (G1-B7, D-15)', () => {
  let db;
  let app;
  let customer;
  let helper;
  let stranger;
  let platformAgentUser;
  let businessAgentUser;
  let plainAdmin;
  let superAdmin;
  let businessId;
  let businessEmployerId;
  let platformEmployerId;
  let appointmentId;
  let bookingId;
  let bareBookingId;
  let jobId;

  async function addUser(role) {
    const id = randomUUID();
    const { rows: [row] } = await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed, didit_status, didit_verified_at)
       VALUES ($1, $2, 'x', 'Checkpoint', 'Fixture', $3, 'customer', TRUE, TRUE, TRUE, 'pending', NULL)
       RETURNING id`,
      [id, `g1ckpt5-${id}@example.invalid`, role],
    );
    return row;
  }

  function as(user, role) {
    return (req) => req.set('x-test-user', user.id).set('x-test-role', role || 'customer');
  }

  async function fileConversation(user, body) {
    return request(app)
      .post('/api/support-routing/conversations')
      .use(as(user))
      .send({
        visitorEmail: `g1ckpt5-${user.id}@example.invalid`,
        visitorName: 'Checkpoint Fixture',
        message: 'The sink still leaks after the visit.',
        category: 'support_request',
        priority: 'normal',
        clientRequestId: randomUUID(),
        ...body,
      });
  }

  beforeAll(async () => {
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/support-routing', require('../routes/supportRouting'));
    app.use('/api/support', require('../routes/support'));
    app.use('/api/admin', require('../routes/admin'));
    app.use(require('../middleware/errorHandler').errorHandler);

    customer = await addUser('customer');
    helper = await addUser('helper');
    // helper.offer_services activates on identity + terms (G-1): the
    // helper-only entry test files through requireHelper, so the fixture
    // helper carries verified Didit and accepted terms.
    await db.query(
      `UPDATE users SET didit_status = 'verified', didit_verified_at = NOW(),
         terms_accepted = TRUE, terms_accepted_at = NOW(), terms_version = '1'
       WHERE id = $1`,
      [helper.id],
    );
    // access.can reads access_grants rows only (the legacy role mapping
    // feeds the projection, not the gate): the fixture helper holds an
    // active helper.offer_services grant, the bidAcceptance pattern.
    await db.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES ($1, 'helper.offer_services', 'self', 'self', 'active', 'legacy_backfill', 'helper-policy-1')`,
      [helper.id],
    );
    stranger = await addUser('customer');
    platformAgentUser = await addUser('customer');
    businessAgentUser = await addUser('customer');
    plainAdmin = await addUser('admin');
    superAdmin = await addUser('super_admin');

    const { rows: [platformEmployer] } = await db.query(
      `SELECT id FROM support_employers WHERE kind = 'platform' LIMIT 1`,
    );
    platformEmployerId = platformEmployer.id;

    const { rows: [business] } = await db.query(
      `INSERT INTO businesses (user_id, business_name, is_active, is_primary)
       VALUES ($1, 'G1 ckpt5 support business', TRUE, TRUE) RETURNING id`,
      [customer.id],
    );
    businessId = business.id;
    const { rows: [businessEmployer] } = await db.query(
      `INSERT INTO support_employers (kind, business_id) VALUES ('business', $1) RETURNING id`,
      [businessId],
    );
    businessEmployerId = businessEmployer.id;

    // Platform agent: active, under the platform employer (non-admin user).
    await db.query(
      `INSERT INTO support_agents (business_id, employer_id, user_id, status, role)
       VALUES (NULL, $1, $2, 'active', 'agent')`,
      [platformEmployerId, platformAgentUser.id],
    );
    // Business agent: active, but only for their own employer's queue.
    await db.query(
      `INSERT INTO support_agents (business_id, employer_id, user_id, status, role)
       VALUES ($1, $2, $3, 'active', 'agent')`,
      [businessId, businessEmployerId, businessAgentUser.id],
    );

    const { rows: [job] } = await db.query(
      `INSERT INTO jobs (client_id, assigned_helper_id, title, description, status)
       VALUES ($1, $2, 'Fix the sink', 'Kitchen sink leaks', 'accepted') RETURNING id`,
      [customer.id, helper.id],
    );
    jobId = job.id;

    const { rows: [appt] } = await db.query(
      `INSERT INTO appointments
         (customer_id, helper_id, service_description, scheduled_start_time, scheduled_end_time, status)
       VALUES ($1, $2, 'Fix the sink', NOW() + interval '1 day', NOW() + interval '1 day 1 hour', 'confirmed')
       RETURNING id`,
      [customer.id, helper.id],
    );
    appointmentId = appt.id;

    const { rows: [booking] } = await db.query(
      `INSERT INTO booking_requests
         (customer_id, helper_id, service_name, requested_date, requested_start_time,
          requested_end_time, status, appointment_id, converted_to_job_id,
          payment_requirement, payment_amount_cents, gross_amount_cents, payment_status,
          stripe_payment_intent_id, stripe_refund_id)
       VALUES ($1, $2, 'Fix the sink', CURRENT_DATE + 1, '10:00', '11:00',
          'accepted', $3, $4, 'deposit', 2500, 10000, 'paid',
          'pi_SENTINEL_INTENT_123', 're_SENTINEL_REFUND_456')
       RETURNING id`,
      [customer.id, helper.id, appointmentId, jobId],
    );
    bookingId = booking.id;

    const { rows: [bare] } = await db.query(
      `INSERT INTO booking_requests
         (customer_id, helper_id, service_name, requested_date, requested_start_time,
          requested_end_time, status, payment_amount_cents, payment_status)
       VALUES ($1, $2, 'Unclog the drain', CURRENT_DATE + 2, '09:00', '10:00',
          'pending', 0, 'not_required')
       RETURNING id`,
      [customer.id, helper.id],
    );
    bareBookingId = bare.id;
  });

  afterAll(async () => {
    // Remove every fixture this suite created so a re-run against the same
    // dedicated DB sees a clean slate. Cleanup uses the email-pattern
    // subselects (not array parameters) so it also clears residue from
    // earlier runs. Users are NOT deleted: any DELETE FROM users raises
    // the pre-existing oxsteed_credit_partner_funding_records RI
    // rule-rewrite error, so the user rows stay as inert orphans
    // (distinctive g1ckpt5- emails, no child rows left after this cleanup).
    if (!db) return;
    const pattern = 'g1ckpt5-%';
    const userSub = `(SELECT id FROM users WHERE email LIKE $1)`;
    await db.query(
      `DELETE FROM notifications WHERE user_id IN ${userSub}`,
      [pattern],
    );
    await db.query(
      `DELETE FROM support_queue WHERE conversation_id IN
         (SELECT id FROM support_conversations WHERE customer_id IN ${userSub})`,
      [pattern],
    );
    await db.query(
      `DELETE FROM support_conversation_messages WHERE conversation_id IN
         (SELECT id FROM support_conversations WHERE customer_id IN ${userSub})`,
      [pattern],
    );
    // support_conversations rows themselves are NOT deleted: migration 405
    // makes lifecycle events append-only, and the cascade from a
    // conversation delete into support_conversation_lifecycle_events trips
    // that trigger, so a DELETE raises. The rows stay as inert fixtures
    // (distinctive g1ckpt5- customers, no assertions read absolute
    // conversation totals), like the orphaned user rows below.
    await db.query(
      `DELETE FROM support_messages WHERE ticket_id IN
         (SELECT id FROM support_tickets WHERE user_id IN ${userSub})`,
      [pattern],
    );
    await db.query(
      `DELETE FROM support_tickets WHERE user_id IN ${userSub}`,
      [pattern],
    );
    await db.query(
      `DELETE FROM booking_requests WHERE customer_id IN ${userSub}`,
      [pattern],
    );
    await db.query(
      `DELETE FROM appointments WHERE customer_id IN ${userSub}`,
      [pattern],
    );
    await db.query(
      `DELETE FROM jobs WHERE client_id IN ${userSub}`,
      [pattern],
    );
    await db.query(
      `DELETE FROM access_grants WHERE user_id IN ${userSub}`,
      [pattern],
    );
    await db.query(
      `DELETE FROM support_agents WHERE user_id IN ${userSub}`,
      [pattern],
    );
    await db.query(
      `DELETE FROM support_employers WHERE kind = 'business' AND business_id = $1`,
      [businessId],
    );
    await db.query(`DELETE FROM businesses WHERE id = $1`, [businessId]);
    await db.end().catch(() => {});
  });

  test('customer files with booking_id: linkage stored and both ids echoed', async () => {
    const res = await fileConversation(customer, { bookingId });
    expect(res.status).toBe(200);
    expect(res.body.ticketId).toBeTruthy();
    expect(res.body.bookingId).toBe(bookingId);
    expect(res.body.jobId).toBe(String(jobId));

    const { rows } = await db.query(
      `SELECT channel_metadata FROM support_conversations WHERE id = $1`,
      [res.body.ticketId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].channel_metadata).toEqual({ booking_id: bookingId, job_id: String(jobId) });
  });

  test('customer files with job_id only: booking is derived from the job', async () => {
    const res = await fileConversation(customer, { jobId: String(jobId) });
    expect(res.status).toBe(200);
    expect(res.body.bookingId).toBe(bookingId);
    expect(res.body.jobId).toBe(String(jobId));

    const { rows } = await db.query(
      `SELECT channel_metadata FROM support_conversations WHERE id = $1`,
      [res.body.ticketId],
    );
    expect(rows[0].channel_metadata).toEqual({ booking_id: bookingId, job_id: String(jobId) });
  });

  test('customer files with an unconverted booking_id only: no job is invented', async () => {
    const res = await fileConversation(customer, { bookingId: bareBookingId });
    expect(res.status).toBe(200);
    expect(res.body.bookingId).toBe(bareBookingId);
    expect(res.body.jobId).toBeUndefined();

    const { rows } = await db.query(
      `SELECT channel_metadata FROM support_conversations WHERE id = $1`,
      [res.body.ticketId],
    );
    expect(rows[0].channel_metadata).toEqual({ booking_id: bareBookingId });
  });

  test('a stranger cannot attach another customer booking: 403 and nothing stored', async () => {
    const res = await fileConversation(stranger, { bookingId });
    expect(res.status).toBe(403);

    const { rows } = await db.query(
      `SELECT id FROM support_conversations WHERE customer_id = $1`,
      [stranger.id],
    );
    expect(rows).toHaveLength(0);
  });

  test('a stranger cannot attach another customer job: 403', async () => {
    const res = await fileConversation(stranger, { jobId: String(jobId) });
    expect(res.status).toBe(403);
  });

  test('malformed linkage ids are 400s', async () => {
    const badJob = await fileConversation(customer, { jobId: 'not-a-uuid' });
    expect(badJob.status).toBe(400);
    const badBooking = await fileConversation(customer, { bookingId: 'not-a-uuid' });
    expect(badBooking.status).toBe(400);
  });

  test('no linkage filed: conversation still files with empty metadata', async () => {
    const res = await fileConversation(customer, {});
    expect(res.status).toBe(200);
    expect(res.body.bookingId).toBeUndefined();
    expect(res.body.jobId).toBeUndefined();

    const { rows } = await db.query(
      `SELECT channel_metadata FROM support_conversations WHERE id = $1`,
      [res.body.ticketId],
    );
    expect(rows[0].channel_metadata).toEqual({});
  });

  test('platform support agent reads the linked booking, redacted like the admin read', async () => {
    const res = await request(app)
      .get(`/api/support/bookings/${bookingId}`)
      .use(as(platformAgentUser));
    expect(res.status).toBe(200);
    expect(res.body.booking.id).toBe(bookingId);
    expect(res.body.booking.status).toBe('accepted');
    expect(res.body.booking.serviceName).toBe('Fix the sink');
    expect(res.body.booking.customer.id).toBe(customer.id);
    expect(res.body.booking.helper.id).toBe(helper.id);
    expect(res.body.appointment.id).toBe(String(appointmentId));
    expect(res.body.payment.status).toBe('paid');
    expect(res.body.payment.amountCents).toBe(2500);
    expect(res.body.job.id).toBe(String(jobId));
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('SENTINEL_INTENT');
    expect(serialized).not.toContain('SENTINEL_REFUND');
    expect(serialized).not.toContain('stripe_payment_intent_id');
    expect(serialized).not.toContain('stripe_refund_id');
  });

  test('admin still reads the linked booking through the admin route', async () => {
    const res = await request(app)
      .get(`/api/admin/support/bookings/${bookingId}`)
      .use(as(plainAdmin, 'admin'));
    expect(res.status).toBe(200);
    expect(res.body.booking.id).toBe(bookingId);
    expect(res.body.payment.status).toBe('paid');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('SENTINEL_INTENT');
    expect(serialized).not.toContain('SENTINEL_REFUND');
  });

  test('business agent cannot read a platform booking', async () => {
    const res = await request(app)
      .get(`/api/support/bookings/${bookingId}`)
      .use(as(businessAgentUser));
    expect(res.status).toBe(403);
  });

  test('a stranger customer cannot read the booking through the agent route', async () => {
    const res = await request(app)
      .get(`/api/support/bookings/${bookingId}`)
      .use(as(stranger));
    expect(res.status).toBe(403);
  });

  test('unknown booking 404s for the agent', async () => {
    const res = await request(app)
      .get(`/api/support/bookings/${randomUUID()}`)
      .use(as(platformAgentUser));
    expect(res.status).toBe(404);
  });

  test('helper-only support entry is unchanged: assigned helper files, stranger cannot', async () => {
    const helperJobSupport = require('../services/helperJobSupportService');
    const filed = await helperJobSupport.file(helper.id, String(jobId), {
      kind: 'job_issue',
      message: 'The customer changed the scope on site.',
      clientRequestId: randomUUID(),
    });
    expect(filed.ticket).toBeTruthy();
    expect(filed.ticket.kind).toBe('job_issue');
    const { rows: ticketRows } = await db.query(
      `SELECT metadata FROM support_tickets WHERE id = $1`,
      [filed.ticket.id],
    );
    expect(ticketRows).toHaveLength(1);
    expect(ticketRows[0].metadata.job_id).toBe(String(jobId));
    expect(ticketRows[0].metadata.helper_job_support).toBe(true);

    const listed = await helperJobSupport.list(helper.id, String(jobId));
    expect(listed.some((t) => String(t.id) === String(filed.ticket.id))).toBe(true);

    await expect(helperJobSupport.file(stranger.id, String(jobId), {
      kind: 'job_issue',
      message: 'Not my job.',
      clientRequestId: randomUUID(),
    })).rejects.toMatchObject({ statusCode: 403 });
  });
});
