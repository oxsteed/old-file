'use strict';

// Group 10 Slice E acceptance: deliver work (526-530).
// Covers the built items end to end: start-engagement seeds the milestone
// board from the approved proposal (526), document exchange on a milestone
// with visibility + signed downloads (527), draft delivery (528), client
// feedback (529), and milestone acceptance (530). Decisions D-119..D-125
// in persona-roadmap-decisions.md.

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
    throw new Error('Group 10 Slice E DB tests require a loopback disposable database');
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
      email: req.get('x-test-email') || `g10e-user-${id}@example.invalid`,
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
jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('test-storage-key'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/test-key'),
  deleteFile: jest.fn().mockResolvedValue(true),
}));
// The upload validator is pre-existing infrastructure (magic bytes +
// ClamAV scan, which has no daemon in tests) covered by its own suites;
// the acceptance under test is the controller's visibility/auth/storage
// behavior, with real multer parsing the multipart body.
jest.mock('../middleware/validateFileUpload', () => (req, res, next) => next());

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 10 Slice E: deliver work', () => {
  let db;
  let app;
  const savedFlags = { ...process.env };

  beforeAll(async () => {
    process.env.SIGNED_URL_SECRET = 'group10-slice-e-fixture-secret';
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/consulting/contractor', require('../routes/consultantNetwork'));
    app.use('/api/consulting/business-launch', require('../routes/businessLaunch'));
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
       VALUES ($1, $2, 'x', 'Casey', 'Fixture', $3, $4, TRUE, TRUE, TRUE)`,
      [id, `g10e-user-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
    );
    mockRoles.set(id, role);
    return id;
  }

  async function addApprovedConsultant() {
    const id = await addUser();
    await db.query(`UPDATE users SET default_mode = 'consultant' WHERE id = $1`, [id]);
    await db.query(
      `INSERT INTO consultant_contractor_profiles (user_id, approval_status, is_active, default_oxsteed_cut_bps, timezone)
       VALUES ($1, 'approved', TRUE, 2000, 'America/New_York')`,
      [id],
    );
    return id;
  }

  async function addReferral(client, consultant, status = 'assigned') {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_requests
         (user_id, email, first_name, last_name, phone, skill_description, target_market,
          consultant_assigned_id, consultant_assignment_status)
       VALUES ($1, $2, 'Casey', 'Client', '555-0100', 'Launch a bakery', 'Local customers', $3, $4)
       RETURNING id`,
      [client, `g10e-client-${client}@example.invalid`, consultant, status],
    );
    return row.id;
  }

  async function addApprovedProposal(client, consultant, referralId) {
    const { rows: [proposal] } = await db.query(
      `INSERT INTO consulting_engagement_proposals
         (request_id, consultant_id, version, title, scope_summary, price_cents, currency, status, created_by, decided_by, decided_at)
       VALUES ($1, $2, 1, 'Bakery launch engagement', 'Set up the bakery.', 250000, 'USD', 'approved', $2, $3, NOW())
       RETURNING id`,
      [referralId, consultant, client],
    );
    await db.query(
      `INSERT INTO consulting_proposal_deliverables (proposal_id, title, description, deliverable_type, due_date, sort_order)
       VALUES ($1, 'Supplier shortlist', 'Three vetted suppliers.', 'other', '2026-12-15', 0),
              ($1, 'Launch plan', 'Opening-week plan.', 'marketing_plan', '2026-12-31', 1)`,
      [proposal.id],
    );
    return proposal;
  }

  async function addSession(client, consultant, referralId = null) {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_sessions
         (user_id, email, first_name, last_name, consultant_assigned_id, status, referral_id)
       VALUES ($1, $2, 'Casey', 'Client', $3, 'pending', $4)
       RETURNING id`,
      [client, `g10e-client-${client}@example.invalid`, consultant, referralId],
    );
    return String(row.id);
  }

  async function addDeliverable(sessionId, overrides = {}) {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_deliverables (session_id, name, description, deliverable_type, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [sessionId,
        overrides.name || 'Supplier shortlist',
        overrides.description || null,
        overrides.deliverable_type || 'other',
        overrides.due_date || '2026-12-15',
        overrides.status || 'pending'],
    );
    return row;
  }

  function auth(userId, email) {
    const headers = { 'x-test-user': userId };
    if (email) headers['x-test-email'] = email;
    return headers;
  }

  const pdfBuffer = Buffer.from('%PDF-1.4\n%Test draft document\n', 'utf8');

  async function startEngagedSession(client, consultant) {
    const referralId = await addReferral(client, consultant, 'engaged');
    await addApprovedProposal(client, consultant, referralId);
    const res = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/start-engagement`)
      .set(auth(consultant))
      .send();
    expect(res.status).toBe(201);
    return { referralId, sessionId: String(res.body.session.id), session: res.body.session };
  }

  test('526: start-engagement seeds the board from the approved proposal', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const referralId = await addReferral(client, consultant, 'engaged');
    await addApprovedProposal(client, consultant, referralId);

    const res = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/start-engagement`)
      .set(auth(consultant))
      .send();
    expect(res.status).toBe(201);
    expect(res.body.deliverables).toHaveLength(2);
    expect(res.body.deliverables[0].name).toBe('Supplier shortlist');
    expect(res.body.deliverables[0].status).toBe('pending');
    expect(res.body.deliverables[0].source_proposal_id).toBeDefined();
    expect(res.body.session.referral_id).toBe(referralId);

    const again = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/start-engagement`)
      .set(auth(consultant))
      .send();
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('session_exists');
  });

  test('526: start-engagement needs an engaged referral and the assigned consultant', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const otherConsultant = await addApprovedConsultant();
    const pendingReferral = await addReferral(client, consultant, 'assigned');
    await addApprovedProposal(client, consultant, pendingReferral);

    const notEngaged = await request(app)
      .post(`/api/consulting/contractor/referrals/${pendingReferral}/start-engagement`)
      .set(auth(consultant))
      .send();
    expect(notEngaged.status).toBe(409);
    expect(notEngaged.body.code).toBe('referral_not_engaged');

    const engagedReferral = await addReferral(client, consultant, 'engaged');
    await addApprovedProposal(client, consultant, engagedReferral);
    const wrongConsultant = await request(app)
      .post(`/api/consulting/contractor/referrals/${engagedReferral}/start-engagement`)
      .set(auth(otherConsultant))
      .send();
    expect(wrongConsultant.status).toBe(403);
  });

  test('526: the board lists milestones for consultant, client, and admin only', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const stranger = await addUser();
    const admin = await addUser('super_admin');
    const { sessionId } = await startEngagedSession(client, consultant);
    const clientAuth = auth(client, `g10e-client-${client}@example.invalid`);

    const asConsultant = await request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/deliverables`)
      .set(auth(consultant));
    expect(asConsultant.status).toBe(200);
    expect(asConsultant.body.deliverables).toHaveLength(2);

    const asClient = await request(app)
      .get(`/api/consulting/business-launch/sessions/${sessionId}/deliverables`)
      .set(clientAuth);
    expect(asClient.status).toBe(200);
    expect(asClient.body.deliverables).toHaveLength(2);

    const asAdmin = await request(app)
      .get(`/api/consulting/admin/sessions/${sessionId}/deliverables`)
      .set(auth(admin));
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.deliverables).toHaveLength(2);

    const asStranger = await request(app)
      .get(`/api/consulting/business-launch/sessions/${sessionId}/deliverables`)
      .set(auth(stranger, `g10e-user-${stranger}@example.invalid`));
    expect(asStranger.status).toBe(403);

    const sessionView = await request(app)
      .get(`/api/consulting/business-launch/requests/${(await db.query('SELECT referral_id FROM consulting_sessions WHERE id = $1', [sessionId])).rows[0].referral_id}/session`)
      .set(clientAuth);
    expect(sessionView.status).toBe(200);
    expect(sessionView.body.deliverables).toHaveLength(2);
  });

  test('526: consultant moves milestones; invalid moves and other parties 409/403', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const admin = await addUser('super_admin');
    const sessionId = await addSession(client, consultant);
    const deliverable = await addDeliverable(sessionId);

    const bad = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/status`)
      .set(auth(consultant))
      .send({ status: 'completed' });
    expect(bad.status).toBe(409);

    const move = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/status`)
      .set(auth(consultant))
      .send({ status: 'in_progress' });
    expect(move.status).toBe(200);
    expect(move.body.deliverable.status).toBe('in_progress');

    const clientMoves = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/status`)
      .set(auth(client, `g10e-client-${client}@example.invalid`))
      .send({ status: 'completed' });
    expect(clientMoves.status).toBe(403);

    const adminMoves = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/status`)
      .set(auth(admin))
      .send({ status: 'completed' });
    expect(adminMoves.status).toBe(403);
  });

  test('528: draft delivery needs work in progress and a note or a document', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const sessionId = await addSession(client, consultant);
    const pending = await addDeliverable(sessionId, { status: 'pending' });
    const working = await addDeliverable(sessionId, { name: 'Launch plan', status: 'in_progress' });

    const onPending = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${pending.id}/deliver-draft`)
      .set(auth(consultant))
      .send({ draft_note: 'First draft.' });
    expect(onPending.status).toBe(409);

    const empty = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${working.id}/deliver-draft`)
      .set(auth(consultant))
      .send({ draft_note: '' });
    expect(empty.status).toBe(400);

    const delivered = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${working.id}/deliver-draft`)
      .set(auth(consultant))
      .send({ draft_note: 'First draft ready for review.' });
    expect(delivered.status).toBe(200);
    expect(delivered.body.deliverable.status).toBe('draft_delivered');
    expect(delivered.body.deliverable.draft_note).toBe('First draft ready for review.');
  });

  test('527: documents exchange with visibility; downloads are audience-checked', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const stranger = await addUser();
    const sessionId = await addSession(client, consultant);
    const deliverable = await addDeliverable(sessionId, { status: 'in_progress' });
    const clientAuth = auth(client, `g10e-client-${client}@example.invalid`);

    const shared = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents`)
      .set(auth(consultant))
      .field('visibility', 'shared')
      .attach('file', pdfBuffer, 'draft.pdf');
    expect(shared.status).toBe(201);
    expect(shared.body.document.originalName).toBe('draft.pdf');
    expect(shared.body.document.visibility).toBe('shared');

    const clientOnly = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/deliverables/${deliverable.id}/documents`)
      .set(clientAuth)
      .field('visibility', 'client_only')
      .attach('file', pdfBuffer, 'notes.pdf');
    expect(clientOnly.status).toBe(201);

    const forbidden = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/deliverables/${deliverable.id}/documents`)
      .set(clientAuth)
      .field('visibility', 'consultant_only')
      .attach('file', pdfBuffer, 'sneaky.pdf');
    expect(forbidden.status).toBe(403);

    const consultantSees = await request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents`)
      .set(auth(consultant));
    expect(consultantSees.status).toBe(200);
    expect(consultantSees.body.documents).toHaveLength(1);
    expect(consultantSees.body.documents[0].originalName).toBe('draft.pdf');

    const clientSees = await request(app)
      .get(`/api/consulting/business-launch/sessions/${sessionId}/deliverables/${deliverable.id}/documents`)
      .set(clientAuth);
    expect(clientSees.status).toBe(200);
    expect(clientSees.body.documents).toHaveLength(2);

    const download = await request(app)
      .get(`/api/consulting/business-launch/documents/${shared.body.document.id}/download`)
      .set(clientAuth);
    expect(download.status).toBe(200);
    expect(download.body.url).toBe('https://signed.example/test-key');

    const strangerDownload = await request(app)
      .get(`/api/consulting/business-launch/documents/${shared.body.document.id}/download`)
      .set(auth(stranger, `g10e-user-${stranger}@example.invalid`));
    expect(strangerDownload.status).toBe(404);
  });

  test('529: the client leaves feedback on a milestone, once', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const sessionId = await addSession(client, consultant);
    const deliverable = await addDeliverable(sessionId, { status: 'draft_delivered' });
    const clientAuth = auth(client, `g10e-client-${client}@example.invalid`);

    const badRating = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/feedback`)
      .set(clientAuth)
      .send({ rating: 0, feedback_text: 'Too low to count.', deliverable_id: deliverable.id });
    expect(badRating.status).toBe(400);

    const sent = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/feedback`)
      .set(clientAuth)
      .send({ rating: 5, feedback_text: 'Exactly what we needed.', deliverable_id: deliverable.id });
    expect(sent.status).toBe(201);
    expect(sent.body.feedback.session_quality_rating).toBe(5);

    const again = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/feedback`)
      .set(clientAuth)
      .send({ rating: 4, feedback_text: 'Second note.', deliverable_id: deliverable.id });
    expect(again.status).toBe(409);

    const consultantFeedback = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/feedback`)
      .set(auth(consultant))
      .send({ rating: 5, feedback_text: 'Self praise.', deliverable_id: deliverable.id });
    expect(consultantFeedback.status).toBe(403);
  });

  test('530: the client accepts a delivered milestone; acceptance is final', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const sessionId = await addSession(client, consultant);
    const pending = await addDeliverable(sessionId, { status: 'pending' });
    const delivered = await addDeliverable(sessionId, { name: 'Launch plan', status: 'draft_delivered' });
    const clientAuth = auth(client, `g10e-client-${client}@example.invalid`);

    const tooEarly = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/deliverables/${pending.id}/accept`)
      .set(clientAuth)
      .send();
    expect(tooEarly.status).toBe(409);

    const consultantAccepts = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/deliverables/${delivered.id}/accept`)
      .set(auth(consultant))
      .send();
    expect(consultantAccepts.status).toBe(403);

    const accepted = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/deliverables/${delivered.id}/accept`)
      .set(clientAuth)
      .send();
    expect(accepted.status).toBe(200);
    expect(accepted.body.deliverable.status).toBe('accepted');
    expect(accepted.body.deliverable.accepted_by).toBe(client);
    expect(accepted.body.deliverable.accepted_at).toBeTruthy();

    const again = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/deliverables/${delivered.id}/accept`)
      .set(clientAuth)
      .send();
    expect(again.status).toBe(409);
  });

  test('526: the consultant engagement list carries board counts', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const { sessionId } = await startEngagedSession(client, consultant);

    const list = await request(app)
      .get('/api/consulting/contractor/engagements')
      .set(auth(consultant));
    expect(list.status).toBe(200);
    expect(list.body.engagements).toHaveLength(1);
    expect(String(list.body.engagements[0].id)).toBe(sessionId);
    expect(list.body.engagements[0].deliverable_count).toBe(2);
    expect(list.body.engagements[0].accepted_count).toBe(0);
  });
});
