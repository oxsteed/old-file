'use strict';

// Group 10 Slice H acceptance: close the engagement (541-545).
// Covers the built items end to end: final deliverable checklist
// (541), closeout confirmation (542), follow-up schedule (543), client
// feedback request (544), and engagement archive (545).
// Decisions D-138..D-145 in persona-roadmap-decisions.md.

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
    throw new Error('Group 10 Slice H DB tests require a loopback disposable database');
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
      email: req.get('x-test-email') || `g10h-user-${id}@example.invalid`,
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
jest.mock('../middleware/validateFileUpload', () => (req, res, next) => next());

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 10 Slice H: close the engagement', () => {
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
    app.use('/api/consulting/business-launch', require('../routes/businessLaunch'));
    app.use('/api/consulting/admin', require('../routes/consultingAdmin'));
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
      [id, `g10h-user-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
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

  async function addSession(client, consultant, overrides = {}) {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_sessions
         (user_id, email, first_name, last_name, consultant_assigned_id, status)
       VALUES ($1, $2, 'Casey', 'Client', $3, $4)
       RETURNING id`,
      [client, `g10h-client-${client}@example.invalid`, consultant, overrides.status || 'pending'],
    );
    return String(row.id);
  }

  async function addDeliverable(sessionId, overrides = {}) {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_deliverables (session_id, name, description, deliverable_type, due_date, status, accepted_by, accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [sessionId,
        overrides.name || 'Supplier shortlist',
        overrides.description || 'Three vetted suppliers.',
        overrides.deliverable_type || 'other',
        overrides.due_date || '2026-12-15',
        overrides.status || 'pending',
        overrides.accepted_by || null,
        overrides.accepted_at || null],
    );
    return row;
  }

  function auth(userId, email) {
    const headers = { 'x-test-user': userId };
    if (email) headers['x-test-email'] = email;
    return headers;
  }

  function clientAuth(client) {
    return auth(client, `g10h-client-${client}@example.invalid`);
  }

  async function setup(overrides = {}) {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const admin = await addUser('super_admin');
    const sessionId = await addSession(client, consultant, overrides);
    return { client, consultant, admin, sessionId };
  }

  async function setupClosed() {
    const ctx = await setup({ status: 'completed' });
    await addDeliverable(ctx.sessionId, {
      name: 'Launch plan', status: 'accepted',
      accepted_by: ctx.client, accepted_at: new Date(),
    });
    await addDeliverable(ctx.sessionId, {
      name: 'Hiring guide', status: 'accepted',
      accepted_by: ctx.client, accepted_at: new Date(),
    });
    return ctx;
  }

  async function getCloseout(sessionId, actor, asClient = false) {
    return request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/closeout`)
      .set(asClient ? clientAuth(actor) : auth(actor));
  }

  test('541: checklist computes required and recommended items; archive is not eligible until all required items are met', async () => {
    const { client, consultant, sessionId } = await setup({ status: 'completed' });
    await addDeliverable(sessionId, { name: 'Done work', status: 'accepted', accepted_by: client, accepted_at: new Date() });
    await addDeliverable(sessionId, { name: 'Open work', status: 'in_progress' });

    const res = await getCloseout(sessionId, consultant);
    expect(res.status).toBe(200);
    expect(res.body.archiveEligible).toBe(false);
    const byKey = Object.fromEntries(res.body.checklist.map((item) => [item.key, item]));
    expect(byKey.engagement_completed.met).toBe(true);
    expect(byKey.engagement_completed.required).toBe(true);
    expect(byKey.all_drafts_delivered.met).toBe(false);
    expect(byKey.all_milestones_accepted.met).toBe(false);
    expect(byKey.no_open_change_requests.met).toBe(true);
    expect(byKey.consultant_confirmed.met).toBe(false);
    expect(byKey.client_confirmed.met).toBe(false);
    expect(byKey.feedback_requested.required).toBe(false);
    expect(byKey.follow_up_scheduled.required).toBe(false);

    const stranger = await addUser();
    const denied = await getCloseout(sessionId, stranger);
    expect(denied.status).toBe(403);
  });

  test('S-D3 (D-765): closeout cannot be confirmed while milestones are unaccepted', async () => {
    const { client, consultant, sessionId } = await setup({ status: 'completed' });
    await addDeliverable(sessionId, { name: 'Done work', status: 'accepted', accepted_by: client, accepted_at: new Date() });
    const open = await addDeliverable(sessionId, { name: 'Open work', status: 'draft_delivered' });

    const early = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/closeout/confirm`)
      .set(auth(consultant)).send({});
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('checklist_incomplete');
    expect(early.body.unmet).toEqual(['all_milestones_accepted']);
    // The refused confirm wrote nothing: no closeout row exists yet.
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM consulting_closeouts WHERE session_id = $1`, [sessionId]);
    expect(rows[0].n).toBe(0);

    // Accepting the milestone unblocks the confirmation.
    await db.query(`UPDATE consulting_deliverables SET status = 'accepted', accepted_by = $1, accepted_at = NOW() WHERE id = $2`, [client, open.id]);
    const first = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/closeout/confirm`)
      .set(auth(consultant)).send({});
    expect(first.status).toBe(200);
    expect(first.body.closeout.consultantConfirmedAt).toBeTruthy();
  });

  test('542: closeout needs a completed engagement; each party confirms once; both confirmations close it', async () => {
    const { client, consultant, sessionId } = await setup({ status: 'in_progress' });
    const early = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/closeout/confirm`)
      .set(auth(consultant)).send({});
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('engagement_not_completed');

    await db.query(`UPDATE consulting_sessions SET status = 'completed' WHERE id = $1`, [sessionId]);
    const first = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/closeout/confirm`)
      .set(auth(consultant)).send({ note: 'Work is done.' });
    expect(first.status).toBe(200);
    expect(first.body.closeout.consultantConfirmedAt).toBeTruthy();
    expect(first.body.closeout.closedAt).toBeNull();
    expect(first.body.closed).toBe(false);

    const again = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/closeout/confirm`)
      .set(auth(consultant)).send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('already_confirmed');

    const second = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/closeout/confirm`)
      .set(clientAuth(client)).send({});
    expect(second.status).toBe(200);
    expect(second.body.closeout.closedAt).toBeTruthy();
    expect(second.body.closed).toBe(true);

    const checklist = await getCloseout(sessionId, consultant);
    expect(checklist.body.archiveEligible).toBe(true);
    expect(checklist.body.closeout.closedAt).toBeTruthy();
  });

  test('542: an admin confirms on the client behalf only, never for the consultant', async () => {
    const { consultant, admin, sessionId } = await setupClosed();
    const res = await request(app)
      .post(`/api/consulting/admin/sessions/${sessionId}/closeout/confirm`)
      .set(auth(admin)).send({});
    expect(res.status).toBe(200);
    expect(res.body.closeout.clientConfirmedAt).toBeTruthy();
    expect(res.body.closeout.consultantConfirmedAt).toBeNull();
    expect(res.body.closed).toBe(false);

    const consultantConfirm = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/closeout/confirm`)
      .set(auth(consultant)).send({});
    expect(consultantConfirm.status).toBe(200);
    expect(consultantConfirm.body.closed).toBe(true);
  });

  test('543: follow-ups are consultant-only on completed engagements, listed due-soonest first, and move once', async () => {
    const { client, consultant, sessionId } = await setupClosed();
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const created = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/follow-ups`)
      .set(auth(consultant))
      .send({ due_at: future, kind: 'check_in', note: '30-day check-in.' });
    expect(created.status).toBe(201);
    expect(created.body.followUp.status).toBe('scheduled');
    expect(created.body.followUp.kind).toBe('check_in');

    const past = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/follow-ups`)
      .set(auth(consultant))
      .send({ due_at: new Date(Date.now() - 1000).toISOString(), kind: 'review' });
    expect(past.status).toBe(400);
    expect(past.body.code).toBe('due_in_past');

    const badKind = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/follow-ups`)
      .set(auth(consultant))
      .send({ due_at: future, kind: 'party' });
    expect(badKind.status).toBe(400);

    const clientCreates = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/follow-ups`)
      .set(clientAuth(client))
      .send({ due_at: future, kind: 'review' });
    expect(clientCreates.status).toBe(403);

    const list = await request(app)
      .get('/api/consulting/contractor/follow-ups')
      .set(auth(consultant));
    expect(list.status).toBe(200);
    expect(list.body.followUps).toHaveLength(1);
    expect(list.body.followUps[0].clientName).toBe('Casey Client');

    const done = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/follow-ups/${created.body.followUp.id}`)
      .set(auth(consultant)).send({ status: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.followUp.status).toBe('done');
    expect(done.body.followUp.completedAt).toBeTruthy();

    const again = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/follow-ups/${created.body.followUp.id}`)
      .set(auth(consultant)).send({ status: 'cancelled' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('invalid_transition');

    const pending = await setup({ status: 'pending' });
    const notCompleted = await request(app)
      .post(`/api/consulting/contractor/sessions/${pending.sessionId}/follow-ups`)
      .set(auth(pending.consultant))
      .send({ due_at: future, kind: 'review' });
    expect(notCompleted.status).toBe(409);
    expect(notCompleted.body.code).toBe('engagement_not_completed');
  });

  test('544: one open feedback request per session; it is satisfied by the client feedback endpoint', async () => {
    const { client, consultant, sessionId } = await setupClosed();

    const first = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/feedback-request`)
      .set(auth(consultant)).send({ note: 'Please rate the work.' });
    expect(first.status).toBe(201);
    expect(first.body.feedbackRequest.sessionId).toBe(sessionId);

    const second = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/feedback-request`)
      .set(auth(consultant)).send({});
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('feedback_request_open');

    const submitted = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/feedback`)
      .set(clientAuth(client)).send({ rating: 5, feedback_text: 'Great work.' });
    expect(submitted.status).toBe(201);

    const after = await getCloseout(sessionId, consultant);
    expect(after.body.feedbackReceivedAt).toBeTruthy();
    expect(after.body.feedbackRequests[0].submittedAt).toBeTruthy();

    const third = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/feedback-request`)
      .set(auth(consultant)).send({});
    expect(third.status).toBe(409);
    expect(third.body.code).toBe('feedback_already_received');
  });

  test('545: archive needs a complete checklist; archived engagements leave the active lists and freeze mutations; unarchive restores', async () => {
    const { client, consultant, sessionId } = await setupClosed();
    const deliverable = await addDeliverable(sessionId, {
      name: 'Extra', status: 'in_progress',
    });

    const early = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/archive`)
      .set(auth(consultant)).send({});
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('checklist_incomplete');
    expect(early.body.unmet).toContain('all_milestones_accepted');
    expect(early.body.unmet).toContain('consultant_confirmed');

    // Finish the open milestone through the normal path first:
    // consultant completes it, the client accepts it.
    const completed = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/status`)
      .set(auth(consultant)).send({ status: 'completed' });
    expect(completed.status).toBe(200);
    const accepted = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/deliverables/${deliverable.id}/accept`)
      .set(clientAuth(client)).send({});
    expect(accepted.status).toBe(200);

    await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/closeout/confirm`)
      .set(auth(consultant)).send({});
    await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/closeout/confirm`)
      .set(clientAuth(client)).send({});

    const clientArchives = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/archive`)
      .set(clientAuth(client)).send({});
    expect(clientArchives.status).toBe(403);

    const archived = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/archive`)
      .set(auth(consultant)).send({});
    expect(archived.status).toBe(200);
    expect(archived.body.session.status).toBe('archived');

    const { rows: [row] } = await db.query(
      'SELECT status, archived_at, archived_by, status_before_archive FROM consulting_sessions WHERE id = $1',
      [sessionId],
    );
    expect(row.archived_at).toBeTruthy();
    expect(String(row.archived_by)).toBe(consultant);
    expect(row.status_before_archive).toBe('completed');

    const list = await request(app)
      .get('/api/consulting/contractor/engagements')
      .set(auth(consultant));
    expect(list.status).toBe(200);
    expect(list.body.engagements.map((item) => String(item.id))).not.toContain(sessionId);

    const archivedList = await request(app)
      .get('/api/consulting/contractor/engagements?archived=true')
      .set(auth(consultant));
    expect(archivedList.body.engagements.map((item) => String(item.id))).toContain(sessionId);

    // A fresh milestone added after the archive (bypassing the API)
    // still cannot move through the API while the engagement is frozen.
    const fresh = await addDeliverable(sessionId, {
      name: 'Post-archive work', status: 'in_progress',
    });

    const move = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${fresh.id}/status`)
      .set(auth(consultant)).send({ status: 'completed' });
    expect(move.status).toBe(409);
    expect(move.body.code).toBe('engagement_archived');

    const change = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/change-requests`)
      .set(auth(consultant)).send({ request_type: 'scope_revision', reason: 'Needs more scope here.', new_title: 'Wider scope' });
    expect(change.status).toBe(409);
    expect(change.body.code).toBe('engagement_archived');

    const confirm = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/closeout/confirm`)
      .set(auth(consultant)).send({});
    expect(confirm.status).toBe(409);
    expect(confirm.body.code).toBe('engagement_archived');

    const restored = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/unarchive`)
      .set(auth(consultant)).send({});
    expect(restored.status).toBe(200);
    expect(restored.body.session.status).toBe('completed');

    const moveAgain = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${fresh.id}/status`)
      .set(auth(consultant)).send({ status: 'completed' });
    expect(moveAgain.status).toBe(200);
  });

  test('545: the admin status dropdown stamps and clears the archive bookkeeping', async () => {
    const { admin, sessionId } = await setupClosed();
    const archived = await request(app)
      .patch(`/api/consulting/admin/sessions/${sessionId}`)
      .set(auth(admin)).send({ status: 'archived' });
    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe('archived');
    const { rows: [row] } = await db.query(
      'SELECT archived_at, status_before_archive FROM consulting_sessions WHERE id = $1',
      [sessionId],
    );
    expect(row.archived_at).toBeTruthy();
    expect(row.status_before_archive).toBe('completed');

    const restored = await request(app)
      .patch(`/api/consulting/admin/sessions/${sessionId}`)
      .set(auth(admin)).send({ status: 'completed' });
    expect(restored.status).toBe(200);
    const { rows: [cleared] } = await db.query(
      'SELECT archived_at, status_before_archive FROM consulting_sessions WHERE id = $1',
      [sessionId],
    );
    expect(cleared.archived_at).toBeNull();
    expect(cleared.status_before_archive).toBeNull();
  });

  test('541: the checklist is fully met on a closed engagement, and the closeout history records it', async () => {
    const { client, consultant, sessionId } = await setupClosed();
    await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/closeout/confirm`)
      .set(auth(consultant)).send({});
    await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/closeout/confirm`)
      .set(clientAuth(client)).send({});

    const res = await getCloseout(sessionId, consultant);
    expect(res.status).toBe(200);
    expect(res.body.archiveEligible).toBe(true);
    const byKey = Object.fromEntries(res.body.checklist.map((item) => [item.key, item]));
    expect(Object.values(byKey).filter((item) => item.required).every((item) => item.met)).toBe(true);

    const history = await request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/history`)
      .set(auth(consultant));
    expect(history.status).toBe(200);
    const types = history.body.events.map((event) => event.eventType);
    expect(types).toContain('closeout_confirmed');
    expect(types).toContain('closeout_completed');
  });

  test('Catalog: the four Slice H notification types are cataloged', async () => {
    const { NOTIFICATION_TYPES } = require('../utils/notificationTypeCatalog');
    const catalog = new Set(NOTIFICATION_TYPES.map((entry) => entry.type));
    for (const type of [
      'consulting_closeout_confirmed',
      'consulting_feedback_requested',
      'consulting_follow_up_scheduled',
      'consulting_engagement_archived',
    ]) {
      expect(catalog.has(type)).toBe(true);
    }
  });
});
