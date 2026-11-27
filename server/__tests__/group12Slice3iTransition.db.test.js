'use strict';

// Group 12 Slice 3i acceptance: Transition (641-645).
// Runs against a dedicated fresh database (credit_statement_test_g12i) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 641: operator handoff checklist (D-341/D-346) — the outgoing operator
//   initiates a handoff to a named incoming operator; the checklist is
//   derived on read (open exceptions, open corrective actions,
//   unacknowledged standards, pending training, open locations); HQ
//   approves or rejects. Initiation grants nothing and moves nothing.
// 642: open issue transfer (D-342) — only inside the HQ approval
//   transaction: remediations reassign (due dates preserved), corrective
//   actions move with their remediation, escalations move as a
//   responsibility note; tickets are never reassigned; every moved issue
//   writes a franchise_handoff_transfers row.
// 643: contact directory update (D-343) — operator-maintained directory:
//   roster-linked entries (name/email from the user row) plus manual
//   entries; role/notes/phone editable; HQ reads the same directory.
// 644: records transition (D-344) — records change hands by
//   access/visibility, never by moving files: the approval stores a
//   records manifest on the handoff row; the incoming operator sees the
//   handoff record before approval but no territory records.
// 645: territory access removal (D-345) — explicit HQ removal of a
//   territory member's access (invitation cancelled / opening-team row
//   deleted, grant revoked, audit row); the operator is never removed
//   here — operator access ends only through a completed handoff.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP12_SLICE3I_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g12i') {
    throw new Error('Group 12 Slice 3i DB tests require the loopback credit_statement_test_g12i database');
  }
  process.env.DATABASE_URL = dbUrl;
}
// Uploads land in a scratch dir (as in the 3a/3e fixtures), never in the
// shared local upload dir.
process.env.LOCAL_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'g12i-uploads-'));

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g12i-${id}@example.invalid`,
      email_verified: !req.get('x-test-unverified'),
    };
    return next();
  };
  return { authenticate, authenticateIfPresent: (req, res, next) => (
    req.get('x-test-user') ? authenticate(req, res, next) : next()
  ) };
});
jest.mock('../middleware/adminAuth', () => ({
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

// The mocked send path: B5 assertions read its calls, never the inbox.
const { sendNotification } = require('../services/notificationService');
jest.mock('../growth/emit', () => ({
  emitDomainEvent: jest.fn().mockResolvedValue(undefined),
  commerceEventProps: (value) => value,
}));
jest.mock('../middleware/validateFileUpload', () => (req, res, next) => next());

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 12 Slice 3i: Transition (641-645)', () => {
  let db;
  let app;

  beforeEach(() => { sendNotification.mockClear(); });

  beforeAll(async () => {
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/franchise', require('../routes/franchise'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });

  afterAll(async () => { await db?.end(); });

  async function addUser(role = 'customer') {
    const id = randomUUID();
    const email = `g12i-${id}@example.invalid`;
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed, didit_status, didit_verified_at)
       VALUES ($1, $2, 'x', 'Franchise', 'Fixture', $3, $4, TRUE, TRUE, TRUE, 'pending', NULL)`,
      [id, email, role, role === 'super_admin' ? 'admin' : 'customer'],
    );
    mockRoles.set(id, role);
    return { id, email };
  }

  // Creates an application whose applicant record is `applicant` and
  // whose assigned operator (owner) is `owner`. When owner is omitted
  // the applicant is also the operator, as in the 3c/3d/3f fixtures.
  async function makeApplication(applicant, owner = null) {
    const operator = owner || applicant;
    const created = await request(app)
      .post('/api/franchise/applications')
      .set('x-test-user', applicant.id)
      .send({
        first_name: 'Fran',
        last_name: 'Chise',
        email: applicant.email,
        desired_country: 'US',
        desired_region: 'Texas',
        desired_city: 'Austin',
      })
      .expect(201);
    const applicationId = created.body.application.id;
    const admin = await addUser('super_admin');
    await request(app)
      .patch(`/api/franchise/applications/${applicationId}`)
      .set('x-test-user', admin.id)
      .send({ owner_user_id: operator.id })
      .expect(200);
    return applicationId;
  }

  async function setStatus(applicationId, status) {
    const admin = await addUser('super_admin');
    await request(app)
      .patch(`/api/franchise/applications/${applicationId}`)
      .set('x-test-user', admin.id)
      .send({ status })
      .expect(200);
    return admin;
  }

  // An approved territory: the minimum state a handoff can start from.
  async function makeApprovedApplication(operator) {
    const applicationId = await makeApplication(operator);
    await setStatus(applicationId, 'approved');
    return applicationId;
  }

  // A launched territory with a live per-territory grant for the operator,
  // so the grant-revocation half of 645 can be proven.
  async function makeLaunchedApplication(operator) {
    const applicationId = await makeApplication(operator);
    const { rows: [business] } = await db.query(
      `INSERT INTO businesses (user_id, business_name, is_active, is_listed)
       VALUES ($1, 'G12i Test Business', TRUE, TRUE) RETURNING id`,
      [operator.id],
    );
    await db.query(
      'UPDATE franchise_applications SET linked_business_id = $2 WHERE id = $1',
      [applicationId, business.id],
    );
    await setStatus(applicationId, 'launched');
    return applicationId;
  }

  async function grantStatus(userId, applicationId) {
    const { rows } = await db.query(
      `SELECT status FROM access_grants
        WHERE user_id = $1 AND capability = 'franchise.operate'
          AND subject_type = 'franchise_application' AND subject_id = $2`,
      [userId, String(applicationId)],
    );
    return rows[0]?.status || null;
  }

  function applicantDetail(user, applicationId) {
    return request(app)
      .get(`/api/franchise/my-applications/${applicationId}`)
      .set('x-test-user', user.id);
  }

  async function locationIdFor(operator, applicationId) {
    const detail = await applicantDetail(operator, applicationId).expect(200);
    expect(detail.body.locations).toHaveLength(1);
    return detail.body.locations[0].id;
  }

  async function addTicket(user, {
    applicationId = null,
    locationId = null,
    category = 'general',
    priority = 'normal',
    status = 'open',
    subject = 'Help needed',
  } = {}) {
    const { rows } = await db.query(
      `INSERT INTO support_tickets
         (user_id, name, email, subject, category, priority, status, source,
          franchise_application_id, franchise_location_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'widget', $8, $9)
       RETURNING id, ticket_number, status, priority, category`,
      [user.id, 'Franchise Fixture', user.email, subject, category, priority, status, applicationId, locationId],
    );
    return rows[0];
  }

  async function addOpeningTeamMember(operator, applicationId, member = null) {
    const helper = member || await addUser();
    await db.query(
      `INSERT INTO helper_profiles (user_id, service_city, service_state, avg_rating, total_reviews, is_available_now)
       VALUES ($1, 'Austin', 'TX', 4.9, 1, TRUE)
       ON CONFLICT (user_id) DO NOTHING`,
      [helper.id],
    );
    await request(app)
      .post(`/api/franchise/my-applications/${applicationId}/opening-team`)
      .set('x-test-user', operator.id)
      .send({ helper_user_id: helper.id, role: 'member' })
      .expect(201);
    return helper;
  }

  function initiateAs(user, applicationId, body) {
    return request(app)
      .post(`/api/franchise/my-applications/${applicationId}/handoffs`)
      .set('x-test-user', user.id)
      .send(body);
  }

  function listHandoffsAs(user, applicationId, asAdmin = false) {
    const base = asAdmin
      ? `/api/franchise/applications/${applicationId}/handoffs`
      : `/api/franchise/my-applications/${applicationId}/handoffs`;
    return request(app).get(base).set('x-test-user', user.id);
  }

  function reviewAs(admin, applicationId, handoffId, body) {
    return request(app)
      .post(`/api/franchise/applications/${applicationId}/handoffs/${handoffId}/review`)
      .set('x-test-user', admin.id)
      .send(body);
  }

  // A territory with one open exception carrying a remediation owned by
  // the operator, one open corrective action on it, and one escalation
  // by the operator — the open-issue set 642 must transfer.
  async function setupOpenIssues(operator, applicationId) {
    const ticket = await addTicket(operator, { applicationId, priority: 'high', subject: 'Fridge down' });
    await request(app)
      .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/remediation`)
      .set('x-test-user', operator.id)
      .send({ owner_user_id: operator.id, due_date: '2026-12-01' })
      .expect(201);
    const { rows: [remediation] } = await db.query(
      'SELECT id FROM franchise_remediations WHERE application_id = $1 AND ticket_id = $2',
      [applicationId, ticket.id],
    );
    const action = await request(app)
      .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/corrective-actions`)
      .set('x-test-user', operator.id)
      .send({ title: 'Replace the compressor', remediation_id: remediation.id })
      .expect(201);
    await request(app)
      .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/escalate`)
      .set('x-test-user', operator.id)
      .send({ reason: 'Customers are waiting' })
      .expect(201);
    return { ticket, remediation, actionId: action.body.action.id };
  }

  describe('641: operator handoff checklist', () => {
    test('the operator initiates a handoff: pending, derived checklist, rides the bundle', async () => {
      const operator = await addUser();
      const incoming = await addUser();
      const applicationId = await makeApprovedApplication(operator);
      await addTicket(operator, { applicationId });
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/training`)
        .set('x-test-user', operator.id)
        .send({ assignee_user_id: operator.id, module_title: 'Food safety basics', due_date: '2026-12-15' })
        .expect(201);

      const created = await initiateAs(operator, applicationId, {
        incoming_operator_id: incoming.id,
        reason: 'Relocating out of state',
      }).expect(201);
      expect(created.body.handoff.status).toBe('pending');
      expect(created.body.handoff.outgoing_operator_id).toBe(operator.id);
      expect(created.body.handoff.incoming_operator_id).toBe(incoming.id);
      const checklist = created.body.handoffs.checklist;
      const byCode = Object.fromEntries(checklist.items.map((item) => [item.code, item]));
      expect(byCode.open_exceptions.count).toBe(1);
      expect(byCode.pending_training.count).toBe(1);
      expect(byCode.open_locations.count).toBe(1);
      expect(byCode.unacknowledged_standards.count).toBe(0);

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.handoffs.total).toBe(1);
      expect(detail.body.handoffs.pending).toBe(1);
      expect(detail.body.handoffs.handoffs[0].status).toBe('pending');
      expect(detail.body.handoffs.checklist.items).toHaveLength(5);
    });

    test('the incoming operator can be named by email: resolved server-side, own email is the same 400, unknown email 404', async () => {
      const operator = await addUser();
      const incoming = await addUser();
      const applicationId = await makeApprovedApplication(operator);
      await initiateAs(operator, applicationId, { incoming_operator_email: 'nobody@example.invalid' })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('handoff_incoming_not_found'));
      await initiateAs(operator, applicationId, { incoming_operator_email: operator.email })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('handoff_incoming_same_operator'));
      const created = await initiateAs(operator, applicationId, {
        incoming_operator_email: incoming.email.toUpperCase(),
        reason: 'Email lookup is case-insensitive',
      }).expect(201);
      expect(created.body.handoff.incoming_operator_id).toBe(incoming.id);
    });

    test('initiation grants nothing: the incoming operator sees only the handoff row, never the territory', async () => {
      const operator = await addUser();
      const incoming = await addUser();
      const stranger = await addUser();
      const applicationId = await makeApprovedApplication(operator);
      await initiateAs(operator, applicationId, { incoming_operator_id: incoming.id }).expect(201);

      // The incoming operator cannot read the territory at all.
      await applicantDetail(incoming, applicationId).expect(404);
      await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/expansion-notes`)
        .set('x-test-user', incoming.id)
        .expect(404);
      // But the handoff record naming them is visible, and only that one.
      const mine = await request(app)
        .get('/api/franchise/my-handoffs')
        .set('x-test-user', incoming.id)
        .expect(200);
      expect(mine.body.total).toBe(1);
      expect(mine.body.handoffs[0].status).toBe('pending');
      const listed = await listHandoffsAs(incoming, applicationId).expect(200);
      expect(listed.body.total).toBe(1);
      // A stranger sees neither the handoff nor the territory.
      await listHandoffsAs(stranger, applicationId).expect(404);
      await request(app).get('/api/franchise/my-handoffs').set('x-test-user', stranger.id).expect(200)
        .then((res) => expect(res.body.total).toBe(0));
    });

    test('initiation guards: non-operator 403, same operator 400, unknown incoming 404, second pending 409, inactive territory 409', async () => {
      const operator = await addUser();
      const applicant = await addUser();
      const incoming = await addUser();
      const other = await addUser();
      const applicationId = await makeApplication(applicant, operator);
      // The public intake POST carries no auth, so the applicant record
      // is email-only until HQ links the account (as in the 3g/3h
      // fixtures); link it directly so the 403 path is exercisable.
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);

      // Still in inquiry: no handoff yet.
      await initiateAs(operator, applicationId, { incoming_operator_id: incoming.id })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('handoff_territory_not_active'));
      await setStatus(applicationId, 'approved');

      await initiateAs(applicant, applicationId, { incoming_operator_id: incoming.id })
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));
      await initiateAs(operator, applicationId, { incoming_operator_id: operator.id })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('handoff_incoming_same_operator'));
      await initiateAs(operator, applicationId, { incoming_operator_id: randomUUID() })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('handoff_incoming_not_found'));
      await initiateAs(operator, applicationId, {})
        .expect(400)
        .then((res) => expect(res.body.code).toBe('handoff_incoming_required'));

      await initiateAs(operator, applicationId, { incoming_operator_id: incoming.id }).expect(201);
      await initiateAs(operator, applicationId, { incoming_operator_id: other.id })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('handoff_already_pending'));
    });

    test('HQ rejects with a reason (required) and nothing moves; the operator can cancel a pending handoff', async () => {
      const operator = await addUser();
      const incoming = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);
      const created = await initiateAs(operator, applicationId, { incoming_operator_id: incoming.id }).expect(201);
      const handoffId = created.body.handoff.id;

      await reviewAs(admin, applicationId, handoffId, { decision: 'reject' })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('handoff_decision_reason_required'));
      const rejected = await reviewAs(admin, applicationId, handoffId, { decision: 'reject', reason: 'Incoming operator is not vetted yet.' }).expect(200);
      expect(rejected.body.handoffs.handoffs[0].status).toBe('rejected');
      // G12-B5 (D-645): the outgoing operator learns the handoff was rejected; the incoming is not told.
      expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: operator.id,
        type: 'franchise_handoff_decided',
        data: expect.objectContaining({ params: expect.objectContaining({ decision: 'rejected' }) }),
      }));
      expect(sendNotification).not.toHaveBeenCalledWith(expect.objectContaining({
        userId: incoming.id,
        type: 'franchise_handoff_decided',
      }));
      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.application.owner_user_id).toBe(operator.id);
      // A decided handoff cannot be decided again.
      await reviewAs(admin, applicationId, handoffId, { decision: 'approve' })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('handoff_not_pending'));

      // A fresh handoff can be cancelled by the operator; cancelling moves nothing.
      const second = await initiateAs(operator, applicationId, { incoming_operator_id: incoming.id }).expect(201);
      const cancelled = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/handoffs/${second.body.handoff.id}/cancel`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(cancelled.body.handoffs.handoffs.find((h) => h.id === second.body.handoff.id).status).toBe('cancelled');
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/handoffs/${second.body.handoff.id}/cancel`)
        .set('x-test-user', operator.id)
        .expect(409)
        .then((res) => expect(res.body.code).toBe('handoff_not_pending'));
    });
  });

  describe('642: open issue transfer', () => {
    test('approval transfers the open issues: remediation reassigned with due date, action and escalation logged, ticket requester untouched', async () => {
      const operator = await addUser();
      const incoming = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);
      const { ticket, remediation, actionId } = await setupOpenIssues(operator, applicationId);
      const created = await initiateAs(operator, applicationId, { incoming_operator_id: incoming.id }).expect(201);
      const handoffId = created.body.handoff.id;

      // Nothing moved while pending: the remediation still belongs to the outgoing operator.
      const before = await db.query(
        'SELECT owner_user_id, due_date FROM franchise_remediations WHERE id = $1', [remediation.id],
      );
      expect(before.rows[0].owner_user_id).toBe(operator.id);

      const approved = await reviewAs(admin, applicationId, handoffId, { decision: 'approve' }).expect(200);
      expect(approved.body.handoff.status).toBe('approved');
      // G12-B5 (D-645): both operators learn the handoff was approved.
      expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: incoming.id,
        type: 'franchise_handoff_decided',
        data: expect.objectContaining({ params: expect.objectContaining({ decision: 'approved' }) }),
      }));
      expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: operator.id,
        type: 'franchise_handoff_decided',
        data: expect.objectContaining({ params: expect.objectContaining({ decision: 'approved' }) }),
      }));
      expect(approved.body.handoff.checklist_snapshot.items).toHaveLength(5);
      const after = await db.query(
        'SELECT owner_user_id, due_date FROM franchise_remediations WHERE id = $1', [remediation.id],
      );
      expect(after.rows[0].owner_user_id).toBe(incoming.id);
      expect(new Date(after.rows[0].due_date).toISOString().slice(0, 10)).toBe('2026-12-01');

      const transfers = approved.body.transfers;
      expect(transfers.map((row) => row.kind).sort()).toEqual(
        ['corrective_action', 'escalation', 'remediation'],
      );
      const remediationTransfer = transfers.find((row) => row.kind === 'remediation');
      expect(remediationTransfer.from_user_id).toBe(operator.id);
      expect(remediationTransfer.to_user_id).toBe(incoming.id);
      expect(String(remediationTransfer.due_date).slice(0, 10)).toBe('2026-12-01');
      expect(transfers.find((row) => row.kind === 'corrective_action').action_id).toBe(actionId);

      // The ticket itself was never reassigned: its requester is still the outgoing operator.
      const { rows: [ticketRow] } = await db.query(
        'SELECT user_id FROM support_tickets WHERE id = $1', [ticket.id],
      );
      expect(ticketRow.user_id).toBe(operator.id);

      // The transfer log is HQ-visible and visible to both operators.
      const hqLog = await request(app)
        .get(`/api/franchise/applications/${applicationId}/handoffs/${handoffId}/transfers`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(hqLog.body.total).toBe(3);
      const incomingLog = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/handoffs/${handoffId}/transfers`)
        .set('x-test-user', incoming.id)
        .expect(200);
      expect(incomingLog.body.total).toBe(3);
    });
  });

  describe('643: contact directory update', () => {
    test('the operator adds a roster member and a manual entry, edits role/notes, removes the manual entry; HQ reads the same directory', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);
      const helper = await addOpeningTeamMember(operator, applicationId);
      const base = `/api/franchise/my-applications/${applicationId}/contact-directory`;

      const added = await request(app).post(base).set('x-test-user', operator.id)
        .send({ contact_user_id: helper.id, role: 'Opening lead', notes: 'First call for lockouts' })
        .expect(201);
      expect(added.body.contact.source).toBe('roster');
      expect(added.body.contact.email).toBe(helper.email);
      expect(added.body.contact.role).toBe('Opening lead');
      expect(added.body.contact_directory.roster.find((m) => m.user_id === helper.id).listed).toBe(true);

      await request(app).post(base).set('x-test-user', operator.id)
        .send({ contact_user_id: helper.id, role: 'Duplicate' })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('contact_already_listed'));
      await request(app).post(base).set('x-test-user', operator.id)
        .send({ contact_user_id: randomUUID(), role: 'Stranger' })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('contact_member_not_found'));

      const manual = await request(app).post(base).set('x-test-user', operator.id)
        .send({ name: 'City permits desk', email: 'permits@example.invalid', phone: '555-0100', role: 'Permits', notes: 'Call before fit-out' })
        .expect(201);
      expect(manual.body.contact.source).toBe('manual');
      expect(manual.body.contact_directory.total).toBe(2);
      await request(app).post(base).set('x-test-user', operator.id)
        .send({ name: 'No email' })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('contact_email_invalid'));

      const updated = await request(app)
        .patch(`${base}/${added.body.contact.id}`).set('x-test-user', operator.id)
        .send({ role: 'Site lead', notes: 'Updated notes' })
        .expect(200);
      expect(updated.body.contact.role).toBe('Site lead');
      expect(updated.body.contact.notes).toBe('Updated notes');
      // A roster-linked entry keeps its name/email from the user row: a
      // client-sent name/email is ignored, never stored over the roster.
      const renamed = await request(app)
        .patch(`${base}/${added.body.contact.id}`).set('x-test-user', operator.id)
        .send({ name: 'Impostor', email: 'impostor@example.invalid', role: 'Site lead' })
        .expect(200);
      expect(renamed.body.contact.name).not.toBe('Impostor');
      expect(renamed.body.contact.email).toBe(helper.email);

      const removed = await request(app)
        .delete(`${base}/${manual.body.contact.id}`).set('x-test-user', operator.id)
        .expect(200);
      expect(removed.body.contact_directory.total).toBe(1);

      const hq = await request(app)
        .get(`/api/franchise/applications/${applicationId}/contact-directory`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(hq.body.total).toBe(1);
      expect(hq.body.entries[0].role).toBe('Site lead');

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.contact_directory.total).toBe(1);
    });

    test('directory writes are operator-only: a territory member or a stranger gets 404', async () => {
      const operator = await addUser();
      const applicationId = await makeApprovedApplication(operator);
      const helper = await addOpeningTeamMember(operator, applicationId);
      const stranger = await addUser();
      const base = `/api/franchise/my-applications/${applicationId}/contact-directory`;
      await request(app).post(base).set('x-test-user', helper.id)
        .send({ name: 'X', email: 'x@example.invalid' })
        .expect(404);
      await request(app).get(base).set('x-test-user', stranger.id).expect(404);
      await request(app).post(base).set('x-test-user', stranger.id)
        .send({ name: 'X', email: 'x@example.invalid' })
        .expect(404);
    });
  });

  describe('644: records transition', () => {
    test('approval stores a records manifest and hands the territory over: incoming sees the records, outgoing keeps only the handoff row', async () => {
      const operator = await addUser();
      const incoming = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);
      await addTicket(operator, { applicationId });
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/expansion-notes`)
        .set('x-test-user', operator.id)
        .send({ body: 'Corner unit needs a second exit.' })
        .expect(201);
      const created = await initiateAs(operator, applicationId, { incoming_operator_id: incoming.id }).expect(201);

      const approved = await reviewAs(admin, applicationId, created.body.handoff.id, { decision: 'approve' }).expect(200);
      const snapshot = approved.body.handoff.records_snapshot;
      expect(snapshot.exceptions).toBe(1);
      expect(snapshot.expansion_notes).toBe(1);
      expect(snapshot.activity_entries).toBeGreaterThan(0);

      // The incoming operator is now the operator: full detail, records included.
      const incomingDetail = await applicantDetail(incoming, applicationId).expect(200);
      expect(incomingDetail.body.application.owner_user_id).toBe(incoming.id);
      expect(incomingDetail.body.expansion_notes.total).toBe(1);
      expect(incomingDetail.body.handoffs.handoffs[0].status).toBe('approved');
      // The outgoing operator lost the territory...
      await applicantDetail(operator, applicationId).expect(404);
      // ...but keeps the handoff record in their own list.
      const outgoingMine = await request(app)
        .get('/api/franchise/my-handoffs')
        .set('x-test-user', operator.id)
        .expect(200);
      expect(outgoingMine.body.total).toBe(1);
      expect(outgoingMine.body.handoffs[0].status).toBe('approved');
      // G12-B1 (D-638): the territory-stats rollup and helper roster are
      // owner-only too. The capability gate is set to off so the request
      // reaches the controller (in enforce mode the revoked grant already
      // 403s the outgoing operator before the SQL filter is reached).
      const prevMode = process.env.ACCESS_FRANCHISE_ENFORCEMENT;
      process.env.ACCESS_FRANCHISE_ENFORCEMENT = 'off';
      try {
        const outgoingStats = await request(app)
          .get('/api/franchise/territory-stats')
          .set('x-test-user', operator.id)
          .expect(200);
        expect(outgoingStats.body.has_territory).toBe(false);
        // The incoming operator accepts the outstanding offer first: the
        // stats endpoint stays locked while acceptance is 'offered' (D-307).
        await request(app)
          .post(`/api/franchise/my-applications/${applicationId}/acceptance`)
          .set('x-test-user', incoming.id)
          .send({ decision: 'accepted' })
          .expect(200);
        const incomingStats = await request(app)
          .get('/api/franchise/territory-stats')
          .set('x-test-user', incoming.id)
          .expect(200);
        expect(incomingStats.body.has_territory).toBe(true);
        const outgoingHelpers = await request(app)
          .get('/api/franchise/territory-helpers')
          .set('x-test-user', operator.id)
          .expect(200);
        expect(outgoingHelpers.body.helpers).toEqual([]);
      } finally {
        if (prevMode === undefined) delete process.env.ACCESS_FRANCHISE_ENFORCEMENT;
        else process.env.ACCESS_FRANCHISE_ENFORCEMENT = prevMode;
      }
    });
  });

  describe('645: territory access removal', () => {
    test('HQ removes a helper: opening-team row gone, audit row listed, reason required, non-member 404', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);
      const helper = await addOpeningTeamMember(operator, applicationId);
      const outsider = await addUser();

      await request(app)
        .post(`/api/franchise/applications/${applicationId}/access-removals`)
        .set('x-test-user', admin.id)
        .send({ user_id: helper.id })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('access_removal_reason_required'));
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/access-removals`)
        .set('x-test-user', admin.id)
        .send({ user_id: outsider.id, reason: 'Never a member' })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('access_removal_not_member'));

      const removed = await request(app)
        .post(`/api/franchise/applications/${applicationId}/access-removals`)
        .set('x-test-user', admin.id)
        .send({ user_id: helper.id, reason: 'Left the opening team' })
        .expect(201);
      expect(removed.body.access_removal.membership_kind).toBe('helper');
      // G12-B5 (D-645): the removed member is told, with HQ's reason.
      expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: helper.id,
        type: 'franchise_territory_access_removed',
        data: expect.objectContaining({ params: expect.objectContaining({ reason: 'Left the opening team' }) }),
      }));
      const { rows: teamRows } = await db.query(
        'SELECT id FROM franchise_opening_team_members WHERE application_id = $1 AND helper_user_id = $2',
        [applicationId, helper.id],
      );
      expect(teamRows).toHaveLength(0);
      const listed = await request(app)
        .get(`/api/franchise/applications/${applicationId}/access-removals`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(listed.body.total).toBe(1);
      expect(listed.body.access_removals[0].reason).toBe('Left the opening team');
      // The removed member can no longer read member surfaces.
      await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/contact-directory`)
        .set('x-test-user', helper.id)
        .expect(404);
    });

    test('HQ removes a member with live residue: manager cleared, open remediation reassigned to the operator, open training cancelled, roster directory entry removed, my-remediations empty', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);
      const helper = await addOpeningTeamMember(operator, applicationId);
      const locationId = await locationIdFor(operator, applicationId);

      // (a) The helper is the location's manager of record (HQ-assigned).
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${locationId}/manager`)
        .set('x-test-user', admin.id)
        .send({ manager_user_id: helper.id })
        .expect(201);
      // (b) The helper owns an open remediation.
      const ticket = await addTicket(operator, { applicationId, priority: 'high', subject: 'Fridge down' });
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/remediation`)
        .set('x-test-user', operator.id)
        .send({ owner_user_id: helper.id, due_date: '2026-12-01' })
        .expect(201);
      // (c) The helper has one open and one completed training assignment.
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/training`)
        .set('x-test-user', operator.id)
        .send({ assignee_user_id: helper.id, module_title: 'Food safety basics', due_date: '2026-12-15' })
        .expect(201);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/training`)
        .set('x-test-user', operator.id)
        .send({ assignee_user_id: helper.id, module_title: 'Knife skills', due_date: '2026-12-15' })
        .expect(201);
      const { rows: [doneRow] } = await db.query(
        `SELECT id FROM franchise_training_assignments WHERE application_id = $1 AND assignee_user_id = $2 AND module_title = 'Knife skills'`,
        [applicationId, helper.id],
      );
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/training/${doneRow.id}/complete`)
        .set('x-test-user', helper.id)
        .expect(200);
      // (d) The helper is listed in the contact directory (roster), plus a
      // manual entry that must survive the removal.
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/contact-directory`)
        .set('x-test-user', operator.id)
        .send({ contact_user_id: helper.id, role: 'Opening lead' })
        .expect(201);
      const manual = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/contact-directory`)
        .set('x-test-user', operator.id)
        .send({ name: 'City permits desk', email: 'permits@example.invalid', role: 'Permits' })
        .expect(201);

      // The helper sees their remediation before removal.
      const before = await request(app)
        .get('/api/franchise/my-remediations')
        .set('x-test-user', helper.id)
        .expect(200);
      expect(before.body.total).toBe(1);

      const removed = await request(app)
        .post(`/api/franchise/applications/${applicationId}/access-removals`)
        .set('x-test-user', admin.id)
        .send({ user_id: helper.id, reason: 'Left the opening team' })
        .expect(201);
      expect(removed.body.residue.managers_cleared).toHaveLength(1);
      expect(removed.body.residue.remediations_reassigned_to_operator).toHaveLength(1);
      expect(removed.body.residue.remediations_reassigned_to_operator[0].ticket_id).toBe(ticket.id);
      expect(removed.body.residue.training_assignments_cancelled).toHaveLength(1);
      expect(removed.body.residue.directory_entries_removed).toHaveLength(1);

      const { rows: managerRows } = await db.query(
        'SELECT id FROM franchise_location_managers WHERE application_id = $1 AND manager_user_id = $2',
        [applicationId, helper.id],
      );
      expect(managerRows).toHaveLength(0);
      const { rows: [remediation] } = await db.query(
        'SELECT owner_user_id FROM franchise_remediations WHERE application_id = $1 AND ticket_id = $2',
        [applicationId, ticket.id],
      );
      expect(remediation.owner_user_id).toBe(operator.id);
      const { rows: openTrainingRows } = await db.query(
        `SELECT id FROM franchise_training_assignments WHERE application_id = $1 AND assignee_user_id = $2 AND status IN ('assigned', 'in_progress')`,
        [applicationId, helper.id],
      );
      expect(openTrainingRows).toHaveLength(0);
      const { rows: doneTrainingRows } = await db.query(
        `SELECT id FROM franchise_training_assignments WHERE application_id = $1 AND assignee_user_id = $2 AND status = 'completed'`,
        [applicationId, helper.id],
      );
      expect(doneTrainingRows).toHaveLength(1);
      const { rows: directoryRows } = await db.query(
        'SELECT id FROM franchise_contact_directory WHERE application_id = $1 AND contact_user_id = $2',
        [applicationId, helper.id],
      );
      expect(directoryRows).toHaveLength(0);
      const { rows: manualRows } = await db.query(
        'SELECT id FROM franchise_contact_directory WHERE application_id = $1 AND id = $2',
        [applicationId, manual.body.contact.id],
      );
      expect(manualRows).toHaveLength(1);
      // The removed member's own remediation list is now empty.
      const after = await request(app)
        .get('/api/franchise/my-remediations')
        .set('x-test-user', helper.id)
        .expect(200);
      expect(after.body.total).toBe(0);
    });

    test('HQ cannot remove the operator through the removal endpoint: 409, use a handoff', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/access-removals`)
        .set('x-test-user', admin.id)
        .send({ user_id: operator.id, reason: 'Trying the wrong path' })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('access_removal_use_handoff'));
      expect(await grantStatus(operator.id, applicationId)).toBe(null);
    });

    test('a completed handoff revokes the outgoing operator grant and grants the incoming operator (launched territory)', async () => {
      const operator = await addUser();
      const incoming = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeLaunchedApplication(operator);
      expect(await grantStatus(operator.id, applicationId)).toBe('active');

      const created = await initiateAs(operator, applicationId, { incoming_operator_id: incoming.id }).expect(201);
      // Pending changes nothing: the outgoing grant stays active.
      expect(await grantStatus(operator.id, applicationId)).toBe('active');
      expect(await grantStatus(incoming.id, applicationId)).toBe(null);

      await reviewAs(admin, applicationId, created.body.handoff.id, { decision: 'approve' }).expect(200);
      expect(await grantStatus(operator.id, applicationId)).toBe('revoked');
      expect(await grantStatus(incoming.id, applicationId)).toBe('active');
    });
  });
});
