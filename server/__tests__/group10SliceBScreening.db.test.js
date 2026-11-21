'use strict';

// Group 10 Slice B acceptance: screen inquiries (511-515).
// Covers the built items end to end: consultant-addressed intake on the
// live business-launch form and on the sessions intake (511), fit
// assessment (512), conflict declaration + forward-move block (513),
// accept/decline of an unaccepted referral (514), inquiry response
// templates + consultant replies shared with the admin composer (515).
// Decisions D-104/D-105/D-106 in persona-roadmap-decisions.md.

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
    throw new Error('Group 10 Slice B DB tests require a loopback disposable database');
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
      email: req.get('x-test-email') || `g10b-consultant-${id}@example.invalid`,
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
}));
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
  sendEmailOrThrow: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/supportNotificationService', () => ({
  notifySupportStaff: jest.fn().mockResolvedValue({ success: true }),
}));

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 10 Slice B: screen inquiries', () => {
  let db;
  let app;

  beforeAll(async () => {
    process.env.SIGNED_URL_SECRET = 'group10-slice-a-fixture-secret';
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/consulting/contractor', require('../routes/consultantNetwork'));
    app.use('/api/consulting/business-launch', require('../routes/businessLaunch'));
    app.use('/api/consulting', require('../routes/consulting'));
  });

  afterAll(async () => { await db?.end(); });

  async function addUser(role = 'customer') {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Consultant', 'Fixture', $3, $4, TRUE, TRUE)`,
      [id, `g10b-consultant-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
    );
    mockRoles.set(id, role);
    return id;
  }

  // Approved + active contractor profile (D-104 gate). No access grant is
  // created on purpose: intake must not require one.
  async function addApprovedConsultant({ active = true } = {}) {
    const id = await addUser();
    await db.query(
      `INSERT INTO consultant_contractor_profiles (user_id, approval_status, is_active, default_oxsteed_cut_bps)
       VALUES ($1, 'approved', $2, 2000)`,
      [id, active],
    );
    return id;
  }

  async function addPendingConsultant() {
    const id = await addUser();
    await db.query(
      `INSERT INTO consultant_contractor_profiles (user_id, approval_status, is_active)
       VALUES ($1, 'pending', TRUE)`,
      [id],
    );
    return id;
  }

  async function addAssignedReferral(consultant) {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_requests
         (email, first_name, last_name, phone, skill_description, target_market,
          operating_country, operating_state, package_selected, package_price,
          consultant_assigned_id, consultant_assignment_status, consultant_assigned_at)
       VALUES ($1, 'Casey', 'Client', '+15551234567', 'Help me launch a bakery',
               'Local food lovers', 'US', 'OH', 'launch', 1000, $2, 'assigned', NOW())
       RETURNING id`,
      [`g10b-client-${randomUUID()}@example.invalid`, consultant],
    );
    return row.id;
  }

  const businessLaunchBody = (overrides = {}) => ({
    email: `g10b-client-${randomUUID()}@example.invalid`,
    first_name: 'Casey',
    last_name: 'Client',
    phone: '+15551234567',
    skill_description: 'Help me launch a bakery',
    target_market: 'Local food lovers',
    operating_country: 'US',
    operating_state: 'OH',
    package_selected: 'launch',
    package_price: 1000,
    ...overrides,
  });

  const patchReferral = (user, requestId, body) => request(app)
    .patch(`/api/consulting/contractor/referrals/${requestId}`)
    .set('x-test-user', user).send(body);

  test('511: business-launch intake addresses an approved consultant, rejects a pending one, stays unaddressed without one', async () => {
    const consultant = await addApprovedConsultant();
    const pending = await addPendingConsultant();
    const client = await addUser();

    const addressed = await request(app)
      .post('/api/consulting/business-launch/submit')
      .set('x-test-user', client)
      .send(businessLaunchBody({ consultant_id: consultant }))
      .expect(201);
    expect(addressed.body.consultant_assigned_id).toBe(consultant);
    const stored = await db.query(
      'SELECT consultant_assignment_status, assigned_oxsteed_cut_bps FROM consulting_requests WHERE id = $1',
      [addressed.body.requestId],
    );
    expect(stored.rows[0]).toMatchObject({ consultant_assignment_status: 'assigned', assigned_oxsteed_cut_bps: 2000 });

    await request(app)
      .post('/api/consulting/business-launch/submit')
      .set('x-test-user', client)
      .send(businessLaunchBody({ consultant_id: pending }))
      .expect(400);
    await request(app)
      .post('/api/consulting/business-launch/submit')
      .set('x-test-user', client)
      .send(businessLaunchBody({ consultant_id: randomUUID() }))
      .expect(400);

    const unaddressed = await request(app)
      .post('/api/consulting/business-launch/submit')
      .set('x-test-user', client)
      .send(businessLaunchBody())
      .expect(201);
    expect(unaddressed.body.consultant_assigned_id).toBeNull();
  });

  test('511: sessions intake accepts consultant_id and stores it', async () => {
    const consultant = await addApprovedConsultant();
    const client = await addUser();
    const res = await request(app)
      .post('/api/consulting/submit')
      .set('x-test-user', client)
      .send({
        email: `g10b-client-${randomUUID()}@example.invalid`,
        first_name: 'Casey', last_name: 'Client',
        consultant_id: consultant,
      })
      .expect(201);
    expect(res.body.consultant_assigned_id).toBe(consultant);
    const stored = await db.query(
      'SELECT consultant_assigned_id FROM consulting_sessions WHERE id = $1', [res.body.id],
    );
    expect(stored.rows[0].consultant_assigned_id).toBe(consultant);
  });

  test('512: fit assessment saves, updates, validates, and is scoped to the assignee', async () => {
    const consultant = await addApprovedConsultant();
    const other = await addApprovedConsultant();
    const requestId = await addAssignedReferral(consultant);

    const saved = await request(app)
      .post(`/api/consulting/contractor/referrals/${requestId}/fit`)
      .set('x-test-user', consultant)
      .send({ budget_fit: 4, scope_fit: 5, timing_fit: 3, overall_fit: 4, decision: 'fit', notes: 'Strong match on scope.' })
      .expect(200);
    expect(saved.body.fit).toMatchObject({ decision: 'fit', overall_fit: 4 });

    const updated = await request(app)
      .post(`/api/consulting/contractor/referrals/${requestId}/fit`)
      .set('x-test-user', consultant)
      .send({ decision: 'needs_info', notes: 'Need the budget range first.' })
      .expect(200);
    expect(updated.body.fit).toMatchObject({ decision: 'needs_info', overall_fit: null });

    await request(app)
      .post(`/api/consulting/contractor/referrals/${requestId}/fit`)
      .set('x-test-user', consultant)
      .send({ decision: 'maybe' })
      .expect(400);
    await request(app)
      .post(`/api/consulting/contractor/referrals/${requestId}/fit`)
      .set('x-test-user', consultant)
      .send({ overall_fit: 6, decision: 'fit' })
      .expect(400);
    await request(app)
      .post(`/api/consulting/contractor/referrals/${requestId}/fit`)
      .set('x-test-user', other)
      .send({ decision: 'fit' })
      .expect(404);
  });

  test('513: conflict declaration blocks forward moves until cleared, decline stays open', async () => {
    const consultant = await addApprovedConsultant();
    const requestId = await addAssignedReferral(consultant);

    await request(app)
      .post(`/api/consulting/contractor/referrals/${requestId}/conflict`)
      .set('x-test-user', consultant)
      .send({ has_conflict: true, description: 'short' })
      .expect(400);
    const declared = await request(app)
      .post(`/api/consulting/contractor/referrals/${requestId}/conflict`)
      .set('x-test-user', consultant)
      .send({ has_conflict: true, description: 'The client is a direct competitor of an existing client of mine.' })
      .expect(200);
    expect(declared.body.conflict.has_conflict).toBe(true);

    const blocked = await patchReferral(consultant, requestId, { consultant_assignment_status: 'intro_pending' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('conflict_declared');

    // Declining is an exit, not a forward move, so it stays allowed.
    await patchReferral(consultant, requestId, { consultant_assignment_status: 'declined' }).expect(200);

    // A fresh referral: clear the conflict and the forward move proceeds.
    const requestId2 = await addAssignedReferral(consultant);
    await request(app)
      .post(`/api/consulting/contractor/referrals/${requestId2}/conflict`)
      .set('x-test-user', consultant)
      .send({ has_conflict: true, description: 'The client is a direct competitor of an existing client of mine.' })
      .expect(200);
    await patchReferral(consultant, requestId2, { consultant_assignment_status: 'intro_pending' }).expect(409);
    await request(app)
      .post(`/api/consulting/contractor/referrals/${requestId2}/conflict`)
      .set('x-test-user', consultant)
      .send({ has_conflict: false, description: null })
      .expect(200);
    await patchReferral(consultant, requestId2, { consultant_assignment_status: 'intro_pending' }).expect(200);
  });

  test('514: decline only from assigned, accept moves to intro_pending, decline frees the referral', async () => {
    const consultant = await addApprovedConsultant();
    const requestId = await addAssignedReferral(consultant);

    await patchReferral(consultant, requestId, { consultant_assignment_status: 'intro_pending' }).expect(200);
    const late = await patchReferral(consultant, requestId, { consultant_assignment_status: 'declined' });
    expect(late.status).toBe(409);

    const requestId2 = await addAssignedReferral(consultant);
    const dashboardBefore = await request(app)
      .get('/api/consulting/contractor/dashboard').set('x-test-user', consultant).expect(200);
    const activeBefore = dashboardBefore.body.summary.active_referrals;
    await patchReferral(consultant, requestId2, { consultant_assignment_status: 'declined' }).expect(200);
    const stored = await db.query(
      'SELECT consultant_assignment_status FROM consulting_requests WHERE id = $1', [requestId2],
    );
    expect(stored.rows[0].consultant_assignment_status).toBe('declined');
    const dashboardAfter = await request(app)
      .get('/api/consulting/contractor/dashboard').set('x-test-user', consultant).expect(200);
    // pg returns COUNT as a string; coerce before comparing.
    expect(Number(dashboardAfter.body.summary.active_referrals)).toBe(Number(activeBefore) - 1);
    const { notifySupportStaff } = require('../services/supportNotificationService');
    expect(notifySupportStaff).toHaveBeenCalledWith(expect.objectContaining({
      type: 'consulting_referral_declined',
    }));
  });

  test('515: inquiry templates list, consultant reply stores with template and author role, admin composer shares the templates', async () => {
    const consultant = await addApprovedConsultant();
    const other = await addApprovedConsultant();
    const reviewer = await addUser('super_admin');
    const requestId = await addAssignedReferral(consultant);

    const templates = await request(app)
      .get('/api/consulting/contractor/inquiry-templates')
      .set('x-test-user', consultant)
      .expect(200);
    expect(templates.body.templates.map(({ id }) => id)).toEqual(
      ['acknowledge', 'more_info', 'propose_intro', 'decline_referral'],
    );

    await request(app)
      .post(`/api/consulting/contractor/referrals/${requestId}/reply`)
      .set('x-test-user', consultant)
      .send({ template_id: 'not_a_template' })
      .expect(400);
    await request(app)
      .post(`/api/consulting/contractor/referrals/${requestId}/reply`)
      .set('x-test-user', other)
      .send({ template_id: 'acknowledge' })
      .expect(404);

    const reply = await request(app)
      .post(`/api/consulting/contractor/referrals/${requestId}/reply`)
      .set('x-test-user', consultant)
      .send({ template_id: 'acknowledge' })
      .expect(201);
    expect(reply.body.message).toMatchObject({ subject: 'Thanks for your consulting inquiry' });
    const stored = await db.query(
      `SELECT author_role, template_id, recipient_email, status FROM consulting_request_messages
        WHERE request_id = $1 ORDER BY created_at ASC`,
      [requestId],
    );
    expect(stored.rows[0]).toMatchObject({ author_role: 'consultant', template_id: 'acknowledge', status: 'sent' });

    const screen = await request(app)
      .get(`/api/consulting/contractor/referrals/${requestId}/screen`)
      .set('x-test-user', consultant)
      .expect(200);
    expect(screen.body.messages).toHaveLength(1);
    expect(screen.body.messages[0].author_role).toBe('consultant');

    // The admin message-template list carries the same four inquiry templates.
    const adminTemplates = await request(app)
      .get('/api/consulting/business-launch/message-templates')
      .set('x-test-user', reviewer)
      .expect(200);
    expect(adminTemplates.body.map(({ id }) => id)).toEqual(expect.arrayContaining(
      ['acknowledge', 'more_info', 'propose_intro', 'decline_referral'],
    ));
  });
});
