'use strict';

// Group 12 Slice 3g acceptance: Resolve exceptions (631-635).
// Runs against a dedicated fresh database (credit_statement_test_g12g) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 631: issue escalation (D-331) — territory-scoped escalation recorded ON
//   the ticket: a priority bump to urgent, an escalation note on the ticket
//   thread, and an escalation row for the per-territory HQ queue.
// 632: remediation owner assignment (D-332) — one remediation owner +
//   due date per linked exception; the owner is a territory member checked
//   against live rows, and sees their assigned remediations.
// 633: corrective action checklist (D-333) — a franchise corrective-action
//   list per exception with the open -> in_progress -> resolved -> verified
//   workflow, server-enforced.
// 634: evidence submission (D-334) — file evidence attached to a corrective
//   action through the vault upload path (private prefix, signed-URL
//   downloads only, storage key never leaves the server).
// 635: resolution review (D-335) — HQ reviews a resolved action (accept =
//   verified, reject = back to in_progress with a reason); the linked
//   exception closes only when its actions are verified, and reopening a
//   ticket reopens the exception.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP12_SLICE3G_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g12g') {
    throw new Error('Group 12 Slice 3g DB tests require the loopback credit_statement_test_g12g database');
  }
  process.env.DATABASE_URL = 'postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test_g12g';
}
// Uploads land in a scratch dir (as in the 3a/3e fixtures), never in the
// shared local upload dir.
process.env.LOCAL_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'g12g-uploads-'));

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g12g-${id}@example.invalid`,
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
jest.mock('../growth/emit', () => ({
  emitDomainEvent: jest.fn().mockResolvedValue(undefined),
  commerceEventProps: (value) => value,
}));
jest.mock('../middleware/validateFileUpload', () => (req, res, next) => next());

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 12 Slice 3g: Resolve exceptions (631-635)', () => {
  let db;
  let app;

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
    const email = `g12g-${id}@example.invalid`;
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

  // Inserts a support ticket directly. When applicationId is given the
  // ticket is already linked to that territory (and optionally one of
  // its locations); otherwise it is an unlinked ticket.
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

  describe('631: issue escalation', () => {
    test('the operator escalates a linked exception: priority bumps to urgent, a note lands on the ticket, the queue shows it', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const locationId = await locationIdFor(operator, applicationId);
      const ticket = await addTicket(operator, { applicationId, locationId, priority: 'low', subject: 'Fridge down' });

      const escalated = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/escalate`)
        .set('x-test-user', operator.id)
        .send({ reason: 'Fridge down for two days, stock spoiling' })
        .expect(201);
      expect(escalated.body.escalation.ticket_id).toBe(ticket.id);
      expect(escalated.body.escalation.reason).toBe('Fridge down for two days, stock spoiling');
      expect(escalated.body.escalation.priority_before).toBe('low');
      expect(escalated.body.escalation.priority_after).toBe('urgent');
      expect(escalated.body.ticket.priority).toBe('urgent');

      const { rows: ticketRows } = await db.query(
        'SELECT priority FROM support_tickets WHERE id = $1', [ticket.id]);
      expect(ticketRows[0].priority).toBe('urgent');
      const { rows: messageRows } = await db.query(
        'SELECT content, is_internal FROM support_messages WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 1',
        [ticket.id]);
      expect(messageRows).toHaveLength(1);
      expect(messageRows[0].content).toContain('Escalated to headquarters');
      expect(messageRows[0].content).toContain('Fridge down for two days');
      expect(messageRows[0].is_internal).toBe(false);

      const queue = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/escalations`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(queue.body.total).toBe(1);
      const [row] = queue.body.escalations;
      expect(row.ticket_number).toBe(ticket.ticket_number);
      expect(row.subject).toBe('Fridge down');
      expect(row.location_id).toBe(locationId);
      expect(row.location_name).toBeTruthy();
      expect(row.priority).toBe('urgent');
      expect(row.escalated_by_name).toBeTruthy();
    });

    test('escalation needs a reason and refuses a second live escalation', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const ticket = await addTicket(operator, { applicationId });

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/escalate`)
        .set('x-test-user', operator.id)
        .send({})
        .expect(400)
        .then((res) => expect(res.body.code).toBe('escalation_reason_required'));

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/escalate`)
        .set('x-test-user', operator.id)
        .send({ reason: 'First escalation' })
        .expect(201);

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/escalate`)
        .set('x-test-user', operator.id)
        .send({ reason: 'Second escalation' })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('exception_already_escalated'));
    });

    test('escalating a resolved ticket is 409; an unlinked ticket and a stranger ticket are 404', async () => {
      const operator = await addUser();
      const other = await addUser();
      const applicationId = await makeApplication(operator);
      const resolved = await addTicket(operator, { applicationId, status: 'resolved' });
      const unlinked = await addTicket(operator, {});
      const strangerTicket = await addTicket(other, {});

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${resolved.ticket_number}/escalate`)
        .set('x-test-user', operator.id)
        .send({ reason: 'Too late' })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('exception_closed'));
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${unlinked.ticket_number}/escalate`)
        .set('x-test-user', operator.id)
        .send({ reason: 'Not linked' })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('exception_not_found'));
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${strangerTicket.ticket_number}/escalate`)
        .set('x-test-user', operator.id)
        .send({ reason: 'Not mine' })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('ticket_not_found'));
    });

    test('a stranger gets 404, a non-operator applicant 403, HQ escalates any linked ticket and reads the queue', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant, operator);
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);
      const ticket = await addTicket(applicant, { applicationId, priority: 'high' });

      await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/escalations`)
        .set('x-test-user', stranger.id)
        .expect(404);
      await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/escalations`)
        .set('x-test-user', applicant.id)
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/escalate`)
        .set('x-test-user', applicant.id)
        .send({ reason: 'Applicant tries' })
        .expect(403);

      const escalated = await request(app)
        .post(`/api/franchise/applications/${applicationId}/support-tickets/${ticket.ticket_number}/escalate`)
        .set('x-test-user', admin.id)
        .send({ reason: 'HQ escalates for the territory' })
        .expect(201);
      expect(escalated.body.escalation.priority_before).toBe('high');
      expect(escalated.body.escalation.priority_after).toBe('urgent');

      const hqQueue = await request(app)
        .get(`/api/franchise/applications/${applicationId}/escalations`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(hqQueue.body.total).toBe(1);
      expect(hqQueue.body.escalations[0].ticket_number).toBe(ticket.ticket_number);
      await request(app)
        .get(`/api/franchise/applications/${applicationId}/escalations`)
        .set('x-test-user', operator.id)
        .expect(403);
    });
  });

  describe('632: remediation owner assignment', () => {
    async function addMember(operator, applicationId, existing = null) {
      const member = existing || await addUser();
      // Opening-team designation requires a helper profile (3c).
      await db.query(
        `INSERT INTO helper_profiles (user_id, service_city, service_state, avg_rating, total_reviews, is_available_now)
         VALUES ($1, 'Austin', 'TX', 4.9, 1, TRUE)
         ON CONFLICT (user_id) DO NOTHING`,
        [member.id],
      );
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/opening-team`)
        .set('x-test-user', operator.id)
        .send({ helper_user_id: member.id, role: 'member' })
        .expect(201);
      return member;
    }

    function assignFor(user, applicationId, ticket, body) {
      return request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/remediation`)
        .set('x-test-user', user.id)
        .send(body);
    }

    test('the operator assigns a territory member with a due date; reassigning replaces the row', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const member = await addMember(operator, applicationId);
      const ticket = await addTicket(operator, { applicationId });

      const assigned = await assignFor(operator, applicationId, ticket,
        { owner_user_id: member.id, due_date: '2026-12-01' })
        .expect(201);
      expect(assigned.body.remediation.owner_user_id).toBe(member.id);
      expect(assigned.body.remediation.owner_name).toBeTruthy();
      expect(String(assigned.body.remediation.due_date).slice(0, 10)).toBe('2026-12-01');
      expect(assigned.body.remediation.ticket_id).toBe(ticket.id);
      expect(assigned.body.remediation.ticket_number).toBe(ticket.ticket_number);

      const reassigned = await assignFor(operator, applicationId, ticket,
        { owner_user_id: operator.id, due_date: '2026-12-15' })
        .expect(200);
      expect(reassigned.body.remediation.owner_user_id).toBe(operator.id);
      expect(String(reassigned.body.remediation.due_date).slice(0, 10)).toBe('2026-12-15');

      const { rows } = await db.query(
        'SELECT COUNT(*)::int AS n FROM franchise_remediations WHERE ticket_id = $1', [ticket.id]);
      expect(rows[0].n).toBe(1);

      const list = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/remediations`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(list.body.total).toBe(1);
      expect(list.body.remediations[0].owner_user_id).toBe(operator.id);
    });

    test('the owner sees their assignments across territories; ?mine=true narrows the territory list', async () => {
      const operator = await addUser();
      const otherOperator = await addUser();
      const applicationId = await makeApplication(operator);
      const otherApplicationId = await makeApplication(otherOperator);
      const member = await addMember(operator, applicationId);
      const ticket = await addTicket(operator, { applicationId });
      const otherTicket = await addTicket(otherOperator, { applicationId: otherApplicationId });

      await assignFor(operator, applicationId, ticket, { owner_user_id: member.id, due_date: '2026-12-01' }).expect(201);
      // The member joins the second territory's opening team too, so HQ
      // may assign them there as well.
      await addMember(otherOperator, otherApplicationId, member);
      await request(app)
        .post(`/api/franchise/applications/${otherApplicationId}/support-tickets/${otherTicket.ticket_number}/remediation`)
        .set('x-test-user', (await addUser('super_admin')).id)
        .send({ owner_user_id: member.id, due_date: '2026-12-02' })
        .expect(201);

      // The member is not the operator of the second territory, so HQ
      // assigned them there — my-remediations still finds both rows.
      const mine = await request(app)
        .get('/api/franchise/my-remediations')
        .set('x-test-user', member.id)
        .expect(200);
      expect(mine.body.total).toBe(2);
      expect(mine.body.remediations.map((r) => r.application_id).sort())
        .toEqual([applicationId, otherApplicationId].sort());

      const narrowed = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/remediations?mine=true`)
        .set('x-test-user', member.id)
        .expect(200);
      expect(narrowed.body.total).toBe(1);
      const notMine = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/remediations?mine=true`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(notMine.body.total).toBe(0);
    });

    test('a non-member cannot be assigned, and a bad due date is 400', async () => {
      const operator = await addUser();
      const outsider = await addUser();
      const applicationId = await makeApplication(operator);
      const ticket = await addTicket(operator, { applicationId });

      await assignFor(operator, applicationId, ticket, { owner_user_id: outsider.id, due_date: '2026-12-01' })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('remediation_owner_not_member'));
      await assignFor(operator, applicationId, ticket, { owner_user_id: operator.id, due_date: 'not-a-date' })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('invalid_remediation_due_date'));
      await assignFor(operator, applicationId, ticket, { owner_user_id: operator.id })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('remediation_due_date_required'));
      await assignFor(operator, applicationId, ticket, { due_date: '2026-12-01' })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('remediation_owner_required'));

      const list = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/remediations`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(list.body.total).toBe(0);
    });

    test('the operator can assign remediation for a ticket filed by another member; HQ assigns and reads', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant, operator);
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);
      const ticket = await addTicket(applicant, { applicationId });

      const assigned = await assignFor(operator, applicationId, ticket,
        { owner_user_id: operator.id, due_date: '2026-12-01' })
        .expect(201);
      expect(assigned.body.remediation.ticket_id).toBe(ticket.id);

      const hqList = await request(app)
        .get(`/api/franchise/applications/${applicationId}/remediations`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(hqList.body.total).toBe(1);

      const member = await addMember(operator, applicationId);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/support-tickets/${ticket.ticket_number}/remediation`)
        .set('x-test-user', admin.id)
        .send({ owner_user_id: member.id, due_date: '2026-12-05' })
        .expect(200);

      // A territory member may read the list; an applicant who is
      // neither operator nor member gets 403; a stranger gets 404.
      await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/remediations`)
        .set('x-test-user', member.id)
        .expect(200);
      await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/remediations`)
        .set('x-test-user', applicant.id)
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));
      await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/remediations`)
        .set('x-test-user', (await addUser()).id)
        .expect(404);
    });

    test('territory_members rides both bundles and names the operator and the member', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const member = await addMember(operator, applicationId);

      const detail = await applicantDetail(operator, applicationId).expect(200);
      const memberIds = (detail.body.territory_members || []).map((m) => m.user_id);
      expect(memberIds).toContain(operator.id);
      expect(memberIds).toContain(member.id);
      const admin = await addUser('super_admin');
      const bundle = await request(app)
        .get(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect((bundle.body.territory_members || []).map((m) => m.user_id))
        .toEqual(expect.arrayContaining([operator.id, member.id]));
    });
  });

  describe('633: corrective action checklist', () => {
    async function setupTicketWithOwner() {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const member = await addUser();
      await db.query(
        `INSERT INTO helper_profiles (user_id, service_city, service_state, avg_rating, total_reviews, is_available_now)
         VALUES ($1, 'Austin', 'TX', 4.9, 1, TRUE)`,
        [member.id],
      );
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/opening-team`)
        .set('x-test-user', operator.id)
        .send({ helper_user_id: member.id, role: 'member' })
        .expect(201);
      const ticket = await addTicket(operator, { applicationId });
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/remediation`)
        .set('x-test-user', operator.id)
        .send({ owner_user_id: member.id, due_date: '2026-12-01' })
        .expect(201);
      return { operator, member, applicationId, ticket };
    }

    function createAction(user, applicationId, ticket, body, asAdmin = false) {
      const base = asAdmin
        ? `/api/franchise/applications/${applicationId}/support-tickets/${ticket.ticket_number}/corrective-actions`
        : `/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/corrective-actions`;
      return request(app).post(base).set('x-test-user', user.id).send(body);
    }

    function moveAction(user, applicationId, actionId, status, asAdmin = false) {
      const base = asAdmin
        ? `/api/franchise/applications/${applicationId}/corrective-actions/${actionId}/status`
        : `/api/franchise/my-applications/${applicationId}/corrective-actions/${actionId}/status`;
      return request(app).post(base).set('x-test-user', user.id).send({ status });
    }

    test('the operator creates an action linked to the remediation; it rides the per-ticket and territory lists', async () => {
      const { operator, member, applicationId, ticket } = await setupTicketWithOwner();

      const created = await createAction(operator, applicationId, ticket,
        { title: 'Replace the fridge compressor', description: 'OEM part only' })
        .expect(201);
      expect(created.body.action.status).toBe('open');
      expect(created.body.action.title).toBe('Replace the fridge compressor');
      expect(created.body.action.remediation_owner_id).toBe(member.id);
      expect(created.body.action.remediation_owner_name).toBeTruthy();
      expect(String(created.body.action.remediation_due_date).slice(0, 10)).toBe('2026-12-01');
      expect(created.body.action.evidence_count).toBe(0);

      const perTicket = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/corrective-actions`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(perTicket.body.total).toBe(1);
      const territory = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/corrective-actions`)
        .set('x-test-user', member.id)
        .expect(200);
      expect(territory.body.total).toBe(1);

      await createAction(operator, applicationId, ticket, {})
        .expect(400)
        .then((res) => expect(res.body.code).toBe('corrective_action_title_required'));
    });

    test('the owner walks open -> in_progress -> resolved; HQ verifies; verified is terminal', async () => {
      const { operator, member, applicationId, ticket } = await setupTicketWithOwner();
      const admin = await addUser('super_admin');
      const created = await createAction(operator, applicationId, ticket, { title: 'Fix the leak' }).expect(201);
      const actionId = created.body.action.id;

      // An invalid jump is 409.
      await moveAction(member, applicationId, actionId, 'resolved')
        .expect(409)
        .then((res) => expect(res.body.code).toBe('corrective_action_transition_invalid'));

      const started = await moveAction(member, applicationId, actionId, 'in_progress').expect(200);
      expect(started.body.action.status).toBe('in_progress');
      // A same-status move is a no-op returning the row.
      expect((await moveAction(member, applicationId, actionId, 'in_progress').expect(200)).body.action.status)
        .toBe('in_progress');
      const resolved = await moveAction(member, applicationId, actionId, 'resolved').expect(200);
      expect(resolved.body.action.status).toBe('resolved');
      expect(resolved.body.action.resolved_at).toBeTruthy();

      // The owner cannot verify their own work.
      await moveAction(member, applicationId, actionId, 'verified')
        .expect(403)
        .then((res) => expect(res.body.code).toBe('corrective_action_review_hq_only'));
      const verified = await moveAction(admin, applicationId, actionId, 'verified', true).expect(200);
      expect(verified.body.action.status).toBe('verified');

      await moveAction(admin, applicationId, actionId, 'in_progress', true)
        .expect(409)
        .then((res) => expect(res.body.code).toBe('corrective_action_transition_invalid'));
    });

    test('a member who is not the remediation owner cannot move the action; HQ can move it back', async () => {
      const { operator, member, applicationId, ticket } = await setupTicketWithOwner();
      const admin = await addUser('super_admin');
      const otherMember = await addUser();
      await db.query(
        `INSERT INTO helper_profiles (user_id, service_city, service_state, avg_rating, total_reviews, is_available_now)
         VALUES ($1, 'Austin', 'TX', 4.9, 1, TRUE)`,
        [otherMember.id],
      );
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/opening-team`)
        .set('x-test-user', operator.id)
        .send({ helper_user_id: otherMember.id, role: 'member' })
        .expect(201);
      const created = await createAction(operator, applicationId, ticket, { title: 'Repaint the sign' }).expect(201);
      const actionId = created.body.action.id;

      await moveAction(otherMember, applicationId, actionId, 'in_progress')
        .expect(403)
        .then((res) => expect(res.body.code).toBe('corrective_action_not_assignee'));
      // The operator may also move it.
      await moveAction(operator, applicationId, actionId, 'in_progress').expect(200);
      await moveAction(member, applicationId, actionId, 'resolved').expect(200);
      // HQ sends a resolved action back to in_progress.
      const sentBack = await moveAction(admin, applicationId, actionId, 'in_progress', true).expect(200);
      expect(sentBack.body.action.status).toBe('in_progress');
      expect(sentBack.body.action.resolved_at).toBeNull();
    });

    test('status and mine filters narrow the list; a stranger gets 404 and an applicant 403', async () => {
      const { operator, member, applicationId, ticket } = await setupTicketWithOwner();
      const applicant = await addUser();
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);
      const first = await createAction(operator, applicationId, ticket, { title: 'First fix' }).expect(201);
      await createAction(operator, applicationId, ticket, { title: 'Second fix' }).expect(201);
      await moveAction(member, applicationId, first.body.action.id, 'in_progress').expect(200);

      const open = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/corrective-actions?status=open`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(open.body.total).toBe(1);
      const mine = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/corrective-actions?mine=true`)
        .set('x-test-user', member.id)
        .expect(200);
      expect(mine.body.total).toBe(2);
      const notMine = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/corrective-actions?mine=true`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(notMine.body.total).toBe(0);
      await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/corrective-actions?status=bogus`)
        .set('x-test-user', operator.id)
        .expect(400)
        .then((res) => expect(res.body.code).toBe('invalid_corrective_action_status'));
      await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/corrective-actions`)
        .set('x-test-user', applicant.id)
        .expect(403);
      await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/corrective-actions`)
        .set('x-test-user', (await addUser()).id)
        .expect(404);
    });
  });

  describe('634: evidence submission', () => {
    const PDF_BYTES = Buffer.from('%PDF-1.4\n% test franchise evidence\n', 'utf8');

    async function setupAction() {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const member = await addUser();
      const otherMember = await addUser();
      for (const user of [member, otherMember]) {
        await db.query(
          `INSERT INTO helper_profiles (user_id, service_city, service_state, avg_rating, total_reviews, is_available_now)
           VALUES ($1, 'Austin', 'TX', 4.9, 1, TRUE)`,
          [user.id],
        );
        await request(app)
          .post(`/api/franchise/my-applications/${applicationId}/opening-team`)
          .set('x-test-user', operator.id)
          .send({ helper_user_id: user.id, role: 'member' })
          .expect(201);
      }
      const ticket = await addTicket(operator, { applicationId });
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/remediation`)
        .set('x-test-user', operator.id)
        .send({ owner_user_id: member.id, due_date: '2026-12-01' })
        .expect(201);
      const created = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/corrective-actions`)
        .set('x-test-user', operator.id)
        .send({ title: 'Replace the compressor' })
        .expect(201);
      return { operator, member, otherMember, applicationId, ticket, action: created.body.action };
    }

    function uploadAs(user, applicationId, actionId, { file = PDF_BYTES, filename = 'receipt.pdf', note = null, asAdmin = false } = {}) {
      const base = asAdmin
        ? `/api/franchise/applications/${applicationId}/corrective-actions/${actionId}/evidence`
        : `/api/franchise/my-applications/${applicationId}/corrective-actions/${actionId}/evidence`;
      const req = request(app).post(base).set('x-test-user', user.id);
      if (file) req.attach('file', file, filename);
      if (note) req.field('note', note);
      return req;
    }

    function listAs(user, applicationId, actionId, asAdmin = false) {
      const base = asAdmin
        ? `/api/franchise/applications/${applicationId}/corrective-actions/${actionId}/evidence`
        : `/api/franchise/my-applications/${applicationId}/corrective-actions/${actionId}/evidence`;
      return request(app).get(base).set('x-test-user', user.id);
    }

    test('the remediation owner uploads evidence with a note; the key never leaves the server', async () => {
      const { operator, member, applicationId, action } = await setupAction();

      const uploaded = await uploadAs(member, applicationId, action.id, { note: 'New compressor installed' })
        .expect(201);
      expect(uploaded.body.evidence.action_id).toBe(action.id);
      expect(uploaded.body.evidence.note).toBe('New compressor installed');
      expect(uploaded.body.evidence.file_name).toBe('receipt.pdf');
      expect(uploaded.body.evidence.storage_key).toBeUndefined();
      expect(uploaded.body.evidence.download_url || null).toBeTruthy();
      expect(uploaded.body.evidence.uploaded_by_name).toBeTruthy();

      const list = await listAs(operator, applicationId, action.id).expect(200);
      expect(list.body.total).toBe(1);
      expect(list.body.evidence[0].id).toBe(uploaded.body.evidence.id);
      expect(list.body.evidence[0].storage_key).toBeUndefined();

      const { rows } = await db.query(
        'SELECT storage_key FROM franchise_action_evidence WHERE id = $1', [uploaded.body.evidence.id]);
      expect(rows[0].storage_key).toContain('franchise-evidence/');

      const actions = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/corrective-actions`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(actions.body.corrective_actions[0].evidence_count).toBe(1);
    });

    test('the operator may upload too; a non-owner member may not; a missing file is 400', async () => {
      const { operator, otherMember, applicationId, action } = await setupAction();

      await uploadAs(operator, applicationId, action.id, { note: 'Operator photo' }).expect(201);
      await uploadAs(otherMember, applicationId, action.id, {})
        .expect(403)
        .then((res) => expect(res.body.code).toBe('evidence_upload_not_assignee'));
      await uploadAs(operator, applicationId, action.id, { file: null })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('evidence_file_required'));

      const list = await listAs(operator, applicationId, action.id).expect(200);
      expect(list.body.total).toBe(1);
    });

    test('HQ uploads and reads evidence; an action from another territory is 404', async () => {
      const { operator, applicationId, action } = await setupAction();
      const admin = await addUser('super_admin');
      const otherOperator = await addUser();
      const otherApplicationId = await makeApplication(otherOperator);

      await uploadAs(admin, applicationId, action.id, { note: 'HQ receipt', asAdmin: true }).expect(201);
      const hqList = await listAs(admin, applicationId, action.id, true).expect(200);
      expect(hqList.body.total).toBe(1);

      await uploadAs(admin, otherApplicationId, action.id, { asAdmin: true })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('corrective_action_not_found'));
      await listAs(operator, otherApplicationId, action.id)
        .expect(404);
    });

    test('a stranger gets 404 and a non-operator applicant 403 on the evidence list', async () => {
      const { operator, applicationId, action } = await setupAction();
      const applicant = await addUser();
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);

      await listAs(applicant, applicationId, action.id)
        .expect(403);
      await listAs(await addUser(), applicationId, action.id)
        .expect(404);
      await listAs(operator, applicationId, '00000000-0000-0000-0000-000000000000')
        .expect(404)
        .then((res) => expect(res.body.code).toBe('corrective_action_not_found'));
    });
  });

  describe('635: resolution review', () => {
    async function setupResolvedAction() {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const member = await addUser();
      await db.query(
        `INSERT INTO helper_profiles (user_id, service_city, service_state, avg_rating, total_reviews, is_available_now)
         VALUES ($1, 'Austin', 'TX', 4.9, 1, TRUE)`,
        [member.id],
      );
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/opening-team`)
        .set('x-test-user', operator.id)
        .send({ helper_user_id: member.id, role: 'member' })
        .expect(201);
      const ticket = await addTicket(operator, { applicationId });
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/remediation`)
        .set('x-test-user', operator.id)
        .send({ owner_user_id: member.id, due_date: '2026-12-01' })
        .expect(201);
      const created = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/corrective-actions`)
        .set('x-test-user', operator.id)
        .send({ title: 'Replace the compressor' })
        .expect(201);
      const action = created.body.action;
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/corrective-actions/${action.id}/status`)
        .set('x-test-user', member.id)
        .send({ status: 'in_progress' })
        .expect(200);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/corrective-actions/${action.id}/status`)
        .set('x-test-user', member.id)
        .send({ status: 'resolved' })
        .expect(200);
      return { operator, member, applicationId, ticket, action };
    }

    function reviewAs(user, applicationId, actionId, body) {
      return request(app)
        .post(`/api/franchise/applications/${applicationId}/corrective-actions/${actionId}/review`)
        .set('x-test-user', user.id)
        .send(body);
    }

    function resolutionFor(user, applicationId, asAdmin = false) {
      const base = asAdmin
        ? `/api/franchise/applications/${applicationId}/resolution`
        : `/api/franchise/my-applications/${applicationId}/resolution`;
      return request(app).get(base).set('x-test-user', user.id);
    }

    test('a resolved ticket with an unverified action awaits verification; HQ accept closes the exception', async () => {
      const { operator, applicationId, ticket, action } = await setupResolvedAction();
      const admin = await addUser('super_admin');
      await db.query("UPDATE support_tickets SET status = 'resolved', resolved_at = NOW() WHERE id = $1", [ticket.id]);

      const waiting = await resolutionFor(operator, applicationId).expect(200);
      expect(waiting.body.total).toBe(1);
      expect(waiting.body.awaiting_verification).toBe(1);
      expect(waiting.body.resolved).toBe(0);
      const [item] = waiting.body.items;
      expect(item.exception_state).toBe('awaiting_verification');
      expect(item.actions).toEqual({ total: 1, open: 0, in_progress: 0, resolved: 1, verified: 0 });
      expect(item.remediation.owner_name).toBeTruthy();

      const reviewed = await reviewAs(admin, applicationId, action.id, { decision: 'accept' }).expect(200);
      expect(reviewed.body.action.status).toBe('verified');
      expect(reviewed.body.exception_resolution.resolved).toBe(1);
      expect(reviewed.body.exception_resolution.items[0].exception_state).toBe('resolved');

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.exception_resolution.resolved).toBe(1);
    });

    test('HQ reject sends the action back with a reason; a reason is required and only resolved actions can be reviewed', async () => {
      const { operator, applicationId, action } = await setupResolvedAction();
      const admin = await addUser('super_admin');

      await reviewAs(admin, applicationId, action.id, { decision: 'reject' })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('resolution_review_reason_required'));
      await reviewAs(admin, applicationId, action.id, { decision: 'maybe' })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('invalid_resolution_review_decision'));

      const rejected = await reviewAs(admin, applicationId, action.id,
        { decision: 'reject', reason: 'Photo shows the old part still fitted' })
        .expect(200);
      expect(rejected.body.action.status).toBe('in_progress');
      expect(rejected.body.action.review_reason).toBe('Photo shows the old part still fitted');
      expect(rejected.body.action.resolved_at).toBeNull();

      // Now it is in_progress, so a second review is 409.
      await reviewAs(admin, applicationId, action.id, { decision: 'accept' })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('corrective_action_not_resolved'));
      // And a non-admin cannot review at all (admin route).
      await reviewAs(operator, applicationId, action.id, { decision: 'accept' })
        .expect(403);
    });

    test('reopening a ticket reopens the exception, and it may escalate again', async () => {
      const { operator, applicationId, ticket, action } = await setupResolvedAction();
      const admin = await addUser('super_admin');
      await db.query("UPDATE support_tickets SET status = 'resolved', resolved_at = NOW() WHERE id = $1", [ticket.id]);
      await reviewAs(admin, applicationId, action.id, { decision: 'accept' }).expect(200);

      let resolution = await resolutionFor(operator, applicationId).expect(200);
      expect(resolution.body.items[0].exception_state).toBe('resolved');

      // The generic reopen: status back to open, resolved_at cleared, a
      // 'reopened' event recorded — the derived exception reopens.
      await db.query("UPDATE support_tickets SET status = 'open', resolved_at = NULL, closed_at = NULL WHERE id = $1", [ticket.id]);
      await db.query(
        `INSERT INTO support_ticket_events (ticket_id, actor_id, event_type, before_status, after_status)
         VALUES ($1, $2, 'reopened', 'resolved', 'open')`,
        [ticket.id, operator.id],
      );

      resolution = await resolutionFor(operator, applicationId).expect(200);
      expect(resolution.body.open).toBe(1);
      expect(resolution.body.items[0].exception_state).toBe('open');

      const escalated = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/escalate`)
        .set('x-test-user', operator.id)
        .send({ reason: 'Still broken after the fix' })
        .expect(201);
      expect(escalated.body.escalation.priority_after).toBe('urgent');
    });

    test('a resolved ticket with no actions is resolved; an open ticket with no actions is open', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const openTicket = await addTicket(operator, { applicationId, subject: 'Open one' });
      const closedTicket = await addTicket(operator, { applicationId, status: 'closed', subject: 'Closed one' });

      const resolution = await resolutionFor(operator, applicationId).expect(200);
      expect(resolution.body.total).toBe(2);
      const byNumber = new Map(resolution.body.items.map((item) => [item.ticket_number, item]));
      expect(byNumber.get(openTicket.ticket_number).exception_state).toBe('open');
      expect(byNumber.get(openTicket.ticket_number).actions.total).toBe(0);
      expect(byNumber.get(closedTicket.ticket_number).exception_state).toBe('resolved');
      expect(resolution.body.open).toBe(1);
      expect(resolution.body.resolved).toBe(1);

      const hq = await resolutionFor(await addUser('super_admin'), applicationId, true).expect(200);
      expect(hq.body.total).toBe(2);
    });
  });
});
