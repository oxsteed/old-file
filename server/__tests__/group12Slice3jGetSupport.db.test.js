'use strict';

// Group 12 Slice 3j acceptance: Get support (646-650).
// Runs against a dedicated fresh database (credit_statement_test_g12j) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 646: policy question intake (D-347) — a policy question IS a support
//   ticket with category 'policy_question', created through the
//   franchise endpoint with the territory (and location / standard)
//   attached; HQ answers in-thread on the ticket. The generic intake
//   allowlist is untouched.
// 647: operations appointment (D-348) — dedicated HQ ops slots, never
//   the consulting flow: HQ publishes, the operator books one (one live
//   booking per territory), HQ confirms/cancels, HQ completes.
// 648: training escalation (D-349) — recorded on the training context
//   (assignment, or member + module + location); one live escalation
//   per training item; HQ resolves with a resolution note.
// 649: territory case tracker (D-350) — tickets, policy questions,
//   training escalations, and handoffs in one derived view, filterable
//   by status/type/location; no new case store.
// 650: franchise support history (D-351) — the territory's support
//   interactions in chronological order, derived from the existing
//   records, with an outcome rollup; no duplicate history store.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP12_SLICE3J_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g12j') {
    throw new Error('Group 12 Slice 3j DB tests require the loopback credit_statement_test_g12j database');
  }
  process.env.DATABASE_URL = dbUrl;
}
// Uploads land in a scratch dir (as in the 3a/3e fixtures), never in the
// shared local upload dir.
process.env.LOCAL_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'g12j-uploads-'));

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g12j-${id}@example.invalid`,
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

describeDb('Group 12 Slice 3j: Get support (646-650)', () => {
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
    const email = `g12j-${id}@example.invalid`;
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

  async function makeApprovedApplication(operator) {
    const applicationId = await makeApplication(operator);
    await setStatus(applicationId, 'approved');
    return applicationId;
  }

  function applicantDetail(user, applicationId) {
    return request(app)
      .get(`/api/franchise/my-applications/${applicationId}`)
      .set('x-test-user', user.id);
  }

  function adminBundle(admin, applicationId) {
    return request(app)
      .get(`/api/franchise/applications/${applicationId}`)
      .set('x-test-user', admin.id);
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

  async function addGuide(title, category = 'Operations') {
    const id = `guide-${randomUUID()}`;
    await db.query(
      `INSERT INTO learn_guides (id, title, category, status)
       VALUES ($1, $2, $3, 'published')`,
      [id, title, category],
    );
    return id;
  }

  async function addStandard(admin, applicationId, guideId) {
    const curated = await request(app)
      .post(`/api/franchise/applications/${applicationId}/standards`)
      .set('x-test-user', admin.id)
      .send({ guide_id: guideId })
      .expect(201);
    return curated.body.standards[0];
  }

  async function addTrainingAssignment(operator, applicationId, assignee, moduleTitle = 'Food safety basics', locationId = null) {
    const created = await request(app)
      .post(`/api/franchise/my-applications/${applicationId}/training`)
      .set('x-test-user', operator.id)
      .send({ assignee_user_id: assignee.id, module_title: moduleTitle, due_date: '2026-12-15', location_id: locationId || undefined })
      .expect(201);
    return created.body.training_assignments
      ? created.body.training_assignments.find((a) => a.module_title === moduleTitle)
      : null;
  }

  async function trainingAssignmentId(operator, applicationId, assignee, moduleTitle, locationId = null) {
    await addTrainingAssignment(operator, applicationId, assignee, moduleTitle, locationId);
    const { rows } = await db.query(
      `SELECT id FROM franchise_training_assignments
        WHERE application_id = $1 AND module_title = $2 ORDER BY created_at DESC LIMIT 1`,
      [applicationId, moduleTitle],
    );
    return rows[0].id;
  }

  function futureIso(hoursFromNow) {
    return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
  }

  function publishSlot(admin, applicationId, { hoursFromNow = 48, title = 'Opening walkthrough' } = {}) {
    return request(app)
      .post(`/api/franchise/applications/${applicationId}/ops-appointments`)
      .set('x-test-user', admin.id)
      .send({
        title,
        starts_at: futureIso(hoursFromNow),
        ends_at: futureIso(hoursFromNow + 1),
        note: 'Bring the checklist.',
      });
  }

  function askPolicyQuestion(operator, applicationId, body) {
    return request(app)
      .post(`/api/franchise/my-applications/${applicationId}/policy-questions`)
      .set('x-test-user', operator.id)
      .send(body);
  }

  function escalateTrainingAs(operator, applicationId, body) {
    return request(app)
      .post(`/api/franchise/my-applications/${applicationId}/training-escalations`)
      .set('x-test-user', operator.id)
      .send(body);
  }

  function listCasesAs(user, applicationId, query = '', asAdmin = false) {
    const base = asAdmin
      ? `/api/franchise/applications/${applicationId}/cases`
      : `/api/franchise/my-applications/${applicationId}/cases`;
    return request(app).get(`${base}${query}`).set('x-test-user', user.id);
  }

  function supportHistoryAs(user, applicationId, asAdmin = false) {
    const base = asAdmin
      ? `/api/franchise/applications/${applicationId}/support-history`
      : `/api/franchise/my-applications/${applicationId}/support-history`;
    return request(app).get(base).set('x-test-user', user.id);
  }

  describe('646: policy question intake', () => {
    test('the operator asks a policy question tied to territory, location, and standard: ticket with category policy_question, question as first message, rides the bundle', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);
      const locationId = await locationIdFor(operator, applicationId);
      const guideId = await addGuide('Royalty reporting', 'Operations');
      const standard = await addStandard(admin, applicationId, guideId);

      const asked = await askPolicyQuestion(operator, applicationId, {
        subject: 'When is the royalty report due?',
        question: 'Is the royalty report due on the 5th or the 15th of the month?',
        location_id: locationId,
        standard_id: standard.id,
      }).expect(201);
      expect(asked.body.ticket.category).toBe('policy_question');
      expect(asked.body.ticket.application_id).toBe(applicationId);
      expect(asked.body.ticket.location_id).toBe(locationId);
      expect(asked.body.ticket.metadata.standard_id).toBe(standard.id);
      expect(asked.body.policy_questions).toHaveLength(1);

      // The question is the ticket's first message.
      const { rows: messages } = await db.query(
        'SELECT content FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC',
        [asked.body.ticket.id],
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toContain('5th or the 15th');

      // It rides the operator detail and the HQ bundle, and it shows in
      // the 629 queue (it IS a ticket) and in the case tracker.
      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.policy_questions).toHaveLength(1);
      expect(detail.body.policy_questions[0].category).toBe('policy_question');
      const hq = await adminBundle(admin, applicationId).expect(200);
      expect(hq.body.policy_questions).toHaveLength(1);
      const queue = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/support-tickets?status=all`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(queue.body.tickets.map((t) => t.category)).toContain('policy_question');
      const cases = await listCasesAs(operator, applicationId, '?type=policy_question').expect(200);
      expect(cases.body.total).toBe(1);
      expect(cases.body.cases[0].kind).toBe('policy_question');
      // HQ reads the same queue.
      const hqList = await request(app)
        .get(`/api/franchise/applications/${applicationId}/policy-questions`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(hqList.body.total).toBe(1);
    });

    test('policy-question guards: non-operator 403, stranger 404, foreign location 404, unknown standard 404, missing question 400', async () => {
      const operator = await addUser();
      const applicant = await addUser();
      const stranger = await addUser();
      const applicationId = await makeApplication(applicant, operator);
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);
      const otherOperator = await addUser();
      const otherApplicationId = await makeApprovedApplication(otherOperator);
      const otherLocationId = await locationIdFor(otherOperator, otherApplicationId);

      await askPolicyQuestion(applicant, applicationId, { subject: 'S', question: 'Q?' })
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));
      await askPolicyQuestion(stranger, applicationId, { subject: 'S', question: 'Q?' }).expect(404);
      await askPolicyQuestion(operator, applicationId, { question: 'Q?' })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('policy_question_subject_required'));
      await askPolicyQuestion(operator, applicationId, { subject: 'S' })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('policy_question_required'));
      if (otherLocationId) {
        await askPolicyQuestion(operator, applicationId, { subject: 'S', question: 'Q?', location_id: otherLocationId })
          .expect(404)
          .then((res) => expect(res.body.code).toBe('location_not_found'));
      }
      await askPolicyQuestion(operator, applicationId, { subject: 'S', question: 'Q?', standard_id: randomUUID() })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('standard_not_found'));
    });
  });

  describe('647: operations appointment', () => {
    test('full lifecycle: HQ publishes, operator books, HQ confirms, HQ completes; rides the bundle', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);

      const published = await publishSlot(admin, applicationId).expect(201);
      const slotId = published.body.slot.id;
      expect(published.body.slot.status).toBe('proposed');
      expect(published.body.slot.title).toBe('Opening walkthrough');

      const booked = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/ops-appointments/${slotId}/book`)
        .set('x-test-user', operator.id)
        .expect(201);
      expect(booked.body.slot.status).toBe('booked');
      expect(booked.body.slot.booked_by).toBe(operator.id);

      const confirmed = await request(app)
        .post(`/api/franchise/applications/${applicationId}/ops-appointments/${slotId}/confirm`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(confirmed.body.slot.status).toBe('confirmed');

      const completed = await request(app)
        .post(`/api/franchise/applications/${applicationId}/ops-appointments/${slotId}/complete`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(completed.body.slot.status).toBe('completed');
      expect(completed.body.slot.completed_at).toBeTruthy();

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.ops_appointments).toHaveLength(1);
      expect(detail.body.ops_appointments[0].status).toBe('completed');
      const hq = await adminBundle(admin, applicationId).expect(200);
      expect(hq.body.ops_appointments).toHaveLength(1);
    });

    test('booking guards: past slot 400, second live booking 409, booked slot unbookable, confirm from proposed 409, complete from booked 409', async () => {
      const operator = await addUser();
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant, operator);
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);

      // A slot starting in the past cannot be published.
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/ops-appointments`)
        .set('x-test-user', admin.id)
        .send({ title: 'Too late', starts_at: new Date(Date.now() - 3600000).toISOString() })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('ops_slot_start_in_past'));

      const first = await publishSlot(admin, applicationId, { hoursFromNow: 24 }).expect(201);
      const second = await publishSlot(admin, applicationId, { hoursFromNow: 72, title: 'Second slot' }).expect(201);

      // Only the operator books; the applicant record alone gets 403.
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/ops-appointments/${first.body.slot.id}/book`)
        .set('x-test-user', applicant.id)
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));

      // Confirm/complete from the wrong state are refused.
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/ops-appointments/${first.body.slot.id}/confirm`)
        .set('x-test-user', admin.id)
        .expect(409)
        .then((res) => expect(res.body.code).toBe('ops_slot_not_booked'));

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/ops-appointments/${first.body.slot.id}/book`)
        .set('x-test-user', operator.id)
        .expect(201);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/ops-appointments/${first.body.slot.id}/complete`)
        .set('x-test-user', admin.id)
        .expect(409)
        .then((res) => expect(res.body.code).toBe('ops_slot_not_confirmed'));

      // A second live booking is refused, and the booked slot itself is
      // unbookable now.
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/ops-appointments/${second.body.slot.id}/book`)
        .set('x-test-user', operator.id)
        .expect(409)
        .then((res) => expect(res.body.code).toBe('ops_appointment_already_booked'));
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/ops-appointments/${first.body.slot.id}/book`)
        .set('x-test-user', operator.id)
        .expect(409)
        .then((res) => expect(res.body.code).toBe('ops_slot_not_bookable'));
    });

    test('the operator cancels their own booking, freeing the live-booking slot; HQ cancels any non-terminal slot', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);
      const first = await publishSlot(admin, applicationId, { hoursFromNow: 24 }).expect(201);
      const second = await publishSlot(admin, applicationId, { hoursFromNow: 72, title: 'Second slot' }).expect(201);

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/ops-appointments/${first.body.slot.id}/book`)
        .set('x-test-user', operator.id)
        .expect(201);
      const cancelled = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/ops-appointments/${first.body.slot.id}/cancel`)
        .set('x-test-user', operator.id)
        .send({ reason: 'Store opening moved' })
        .expect(200);
      expect(cancelled.body.slot.status).toBe('cancelled');
      expect(cancelled.body.slot.cancel_reason).toBe('Store opening moved');

      // The freed operator can book the second slot now.
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/ops-appointments/${second.body.slot.id}/book`)
        .set('x-test-user', operator.id)
        .expect(201);
      // HQ cancels it; a cancelled slot is terminal.
      const hqCancelled = await request(app)
        .post(`/api/franchise/applications/${applicationId}/ops-appointments/${second.body.slot.id}/cancel`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(hqCancelled.body.slot.status).toBe('cancelled');
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/ops-appointments/${second.body.slot.id}/cancel`)
        .set('x-test-user', admin.id)
        .expect(409)
        .then((res) => expect(res.body.code).toBe('ops_slot_terminal'));
    });
  });

  describe('648: training escalation', () => {
    test('the operator escalates a training assignment: context comes from the assignment, one live escalation, HQ queue, rides the bundle', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);
      const locationId = await locationIdFor(operator, applicationId);
      const assignmentId = await trainingAssignmentId(operator, applicationId, operator, 'Food safety basics', locationId);

      const escalated = await escalateTrainingAs(operator, applicationId, {
        assignment_id: assignmentId,
        reason: 'Nobody can pass the quiz — the module video never loads.',
      }).expect(201);
      expect(escalated.body.training_escalation.assignment_id).toBe(assignmentId);
      expect(escalated.body.training_escalation.member_user_id).toBe(operator.id);
      expect(escalated.body.training_escalation.module_title).toBe('Food safety basics');
      expect(escalated.body.training_escalation.status).toBe('open');

      // A second live escalation on the same assignment is refused.
      await escalateTrainingAs(operator, applicationId, {
        assignment_id: assignmentId,
        reason: 'Still broken.',
      })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('training_already_escalated'));

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.training_escalations).toHaveLength(1);
      expect(detail.body.training_escalations[0].location_id).toBe(locationId);
      const hq = await request(app)
        .get(`/api/franchise/applications/${applicationId}/training-escalations`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(hq.body.total).toBe(1);
      expect(hq.body.training_escalations[0].member_name).toBeTruthy();
    });

    test('a free-form gap (member + module + location) escalates without an assignment; the same triple cannot escalate twice live', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);
      const locationId = await locationIdFor(operator, applicationId);

      const escalated = await escalateTrainingAs(operator, applicationId, {
        member_user_id: operator.id,
        module_title: 'Cold storage handling',
        location_id: locationId,
        reason: 'No cold-storage module exists for this location.',
      }).expect(201);
      expect(escalated.body.training_escalation.assignment_id).toBeNull();
      expect(escalated.body.training_escalation.module_title).toBe('Cold storage handling');

      await escalateTrainingAs(operator, applicationId, {
        member_user_id: operator.id,
        module_title: 'Cold storage handling',
        location_id: locationId,
        reason: 'Still missing.',
      })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('training_already_escalated'));

      // A different module for the same member is a different gap.
      await escalateTrainingAs(operator, applicationId, {
        member_user_id: operator.id,
        module_title: 'Allergen awareness',
        reason: 'Nobody finished it.',
      }).expect(201);

      // A stranger is not a territory member.
      const outsider = await addUser();
      await escalateTrainingAs(operator, applicationId, {
        member_user_id: outsider.id,
        module_title: 'Cold storage handling',
        reason: 'Not a member.',
      })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('training_member_not_found'));
      // A foreign assignment is not in this territory.
      await escalateTrainingAs(operator, applicationId, {
        assignment_id: randomUUID(),
        reason: 'No such assignment.',
      })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('training_assignment_not_found'));
      await escalateTrainingAs(operator, applicationId, { reason: '' })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('training_reason_required'));
    });

    test('HQ resolves with a resolution note; resolving needs the note and a resolved escalation is terminal', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);
      const assignmentId = await trainingAssignmentId(operator, applicationId, operator, 'Food safety basics');
      const escalated = await escalateTrainingAs(operator, applicationId, {
        assignment_id: assignmentId,
        reason: 'The module video never loads.',
      }).expect(201);
      const escalationId = escalated.body.training_escalation.id;

      await request(app)
        .post(`/api/franchise/applications/${applicationId}/training-escalations/${escalationId}/resolve`)
        .set('x-test-user', admin.id)
        .send({ status: 'resolved' })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('training_resolution_required'));

      const started = await request(app)
        .post(`/api/franchise/applications/${applicationId}/training-escalations/${escalationId}/resolve`)
        .set('x-test-user', admin.id)
        .send({ status: 'in_progress' })
        .expect(200);
      expect(started.body.training_escalation.status).toBe('in_progress');

      const resolved = await request(app)
        .post(`/api/franchise/applications/${applicationId}/training-escalations/${escalationId}/resolve`)
        .set('x-test-user', admin.id)
        .send({ status: 'resolved', resolution: 'Re-uploaded the video; the quiz passes now.' })
        .expect(200);
      expect(resolved.body.training_escalation.status).toBe('resolved');
      expect(resolved.body.training_escalation.resolution).toContain('Re-uploaded');
      expect(resolved.body.training_escalation.resolved_at).toBeTruthy();

      await request(app)
        .post(`/api/franchise/applications/${applicationId}/training-escalations/${escalationId}/resolve`)
        .set('x-test-user', admin.id)
        .send({ status: 'resolved', resolution: 'Again.' })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('training_escalation_resolved'));

      // A resolved escalation starts a new episode: the same assignment
      // can escalate again.
      await escalateTrainingAs(operator, applicationId, {
        assignment_id: assignmentId,
        reason: 'It broke again after the fix.',
      }).expect(201);
    });

    test('training-escalation guards: non-operator 403, stranger 404', async () => {
      const operator = await addUser();
      const applicant = await addUser();
      const stranger = await addUser();
      const applicationId = await makeApplication(applicant, operator);
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);

      await escalateTrainingAs(applicant, applicationId, {
        member_user_id: operator.id, module_title: 'X', reason: 'Gap.',
      })
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));
      await escalateTrainingAs(stranger, applicationId, {
        member_user_id: operator.id, module_title: 'X', reason: 'Gap.',
      }).expect(404);
      await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/training-escalations`)
        .set('x-test-user', stranger.id)
        .expect(404);
    });
  });

  describe('649: territory case tracker', () => {
    test('cases unify tickets, policy questions, training escalations, and handoffs; filters by type, status, and location work', async () => {
      const operator = await addUser();
      const incoming = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);
      const locationId = await locationIdFor(operator, applicationId);

      const ticket = await addTicket(operator, { applicationId, locationId, subject: 'Fridge down' });
      const resolvedTicket = await addTicket(operator, {
        applicationId, subject: 'Old leak', status: 'resolved',
      });
      await db.query('UPDATE support_tickets SET resolved_at = NOW() WHERE id = $1', [resolvedTicket.id]);
      await askPolicyQuestion(operator, applicationId, {
        subject: 'Royalty due date?', question: 'When is it due?',
      }).expect(201);
      const assignmentId = await trainingAssignmentId(operator, applicationId, operator, 'Food safety basics');
      await escalateTrainingAs(operator, applicationId, {
        assignment_id: assignmentId, reason: 'Video never loads.',
      }).expect(201);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/handoffs`)
        .set('x-test-user', operator.id)
        .send({ incoming_operator_id: incoming.id, reason: 'Relocating' })
        .expect(201);

      const all = await listCasesAs(operator, applicationId, '?status=all').expect(200);
      expect(all.body.total).toBe(5);
      const kinds = all.body.cases.map((c) => c.kind).sort();
      expect(kinds).toEqual(['handoff', 'policy_question', 'ticket', 'ticket', 'training_escalation']);
      expect(all.body.cases.find((c) => c.kind === 'handoff').title).toContain('Handoff to');

      // Type filters narrow to one kind each.
      const onlyPolicy = await listCasesAs(operator, applicationId, '?type=policy_question').expect(200);
      expect(onlyPolicy.body.total).toBe(1);
      expect(onlyPolicy.body.cases[0].ticket_number).toBeTruthy();
      const onlyEscalations = await listCasesAs(operator, applicationId, '?type=training_escalation').expect(200);
      expect(onlyEscalations.body.total).toBe(1);
      const onlyHandoffs = await listCasesAs(operator, applicationId, '?type=handoff').expect(200);
      expect(onlyHandoffs.body.total).toBe(1);

      // The default (open) filter drops the resolved ticket but keeps
      // the live escalation and the pending handoff.
      const open = await listCasesAs(operator, applicationId).expect(200);
      expect(open.body.total).toBe(4);
      expect(open.body.cases.map((c) => c.id)).not.toContain(resolvedTicket.id);
      expect(open.body.cases.map((c) => c.id)).toContain(ticket.id);

      // A concrete status matches the underlying record.
      const resolved = await listCasesAs(operator, applicationId, '?status=resolved').expect(200);
      expect(resolved.body.total).toBe(1);
      expect(resolved.body.cases[0].id).toBe(resolvedTicket.id);

      // A location filter keeps only that location's cases; the
      // territory-wide handoff and the unassigned policy question drop.
      const atLocation = await listCasesAs(operator, applicationId, `?status=all&location_id=${locationId}`).expect(200);
      expect(atLocation.body.total).toBe(1);
      expect(atLocation.body.cases[0].id).toBe(ticket.id);
      const unassigned = await listCasesAs(operator, applicationId, '?status=all&location_id=unassigned').expect(200);
      expect(unassigned.body.total).toBe(4);

      // HQ sees the same tracker.
      const hq = await listCasesAs(admin, applicationId, '?status=all', true).expect(200);
      expect(hq.body.total).toBe(5);
    });

    test('case tracker guards: invalid type/status 400, foreign location 404, non-operator 403, stranger 404', async () => {
      const operator = await addUser();
      const applicant = await addUser();
      const stranger = await addUser();
      const applicationId = await makeApplication(applicant, operator);
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);
      const otherLocationId = await locationIdFor(operator, await makeApprovedApplication(operator));

      await listCasesAs(operator, applicationId, '?type=nope')
        .expect(400)
        .then((res) => expect(res.body.code).toBe('invalid_case_type'));
      await listCasesAs(operator, applicationId, '?status=nope')
        .expect(400)
        .then((res) => expect(res.body.code).toBe('invalid_case_status'));
      await listCasesAs(operator, applicationId, `?location_id=${otherLocationId}`)
        .expect(404)
        .then((res) => expect(res.body.code).toBe('location_not_found'));
      await listCasesAs(applicant, applicationId)
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));
      await listCasesAs(stranger, applicationId).expect(404);
    });
  });

  describe('650: franchise support history', () => {
    test('history derives ticket, policy-question, escalation, appointment, training-escalation, and resolution events in order, with an outcome rollup; rides the bundle', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApprovedApplication(operator);

      // A ticket with an escalation, a follow-up reply, and a verified
      // corrective action.
      const ticket = await addTicket(operator, { applicationId, subject: 'Fridge down', priority: 'high' });
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/escalate`)
        .set('x-test-user', operator.id)
        .send({ reason: 'Customers are waiting' })
        .expect(201);
      await db.query(
        `INSERT INTO support_messages (ticket_id, sender_id, sender_name, sender_email, content, is_internal, is_from_admin)
         VALUES ($1, $2, 'HQ Support', 'hq@example.invalid', 'A technician is on the way.', false, true)`,
        [ticket.id, admin.id],
      );
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
      // Corrective actions move open -> in_progress -> resolved, then HQ
      // reviews the resolved action into verified.
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/corrective-actions/${action.body.action.id}/status`)
        .set('x-test-user', operator.id)
        .send({ status: 'in_progress' })
        .expect(200);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/corrective-actions/${action.body.action.id}/status`)
        .set('x-test-user', operator.id)
        .send({ status: 'resolved' })
        .expect(200);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/corrective-actions/${action.body.action.id}/review`)
        .set('x-test-user', admin.id)
        .send({ decision: 'accept' })
        .expect(200);

      // A policy question, a training escalation + resolution, and an
      // appointment through its full lifecycle.
      await askPolicyQuestion(operator, applicationId, {
        subject: 'Royalty due date?', question: 'When is it due?',
      }).expect(201);
      const assignmentId = await trainingAssignmentId(operator, applicationId, operator, 'Food safety basics');
      const escalated = await escalateTrainingAs(operator, applicationId, {
        assignment_id: assignmentId, reason: 'Video never loads.',
      }).expect(201);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/training-escalations/${escalated.body.training_escalation.id}/resolve`)
        .set('x-test-user', admin.id)
        .send({ status: 'resolved', resolution: 'Re-uploaded the video.' })
        .expect(200);
      const slot = await publishSlot(admin, applicationId, { hoursFromNow: 24 }).expect(201);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/ops-appointments/${slot.body.slot.id}/book`)
        .set('x-test-user', operator.id)
        .expect(201);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/ops-appointments/${slot.body.slot.id}/confirm`)
        .set('x-test-user', admin.id)
        .expect(200);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/ops-appointments/${slot.body.slot.id}/complete`)
        .set('x-test-user', admin.id)
        .expect(200);

      const history = await supportHistoryAs(operator, applicationId).expect(200);
      const kinds = history.body.history.map((event) => event.kind);
      expect(kinds).toEqual(expect.arrayContaining([
        'ticket_created',
        'policy_question_asked',
        'escalation',
        'ticket_reply',
        'corrective_action_verified',
        'training_escalation',
        'training_escalation_resolved',
        'appointment_booked',
        'appointment_confirmed',
        'appointment_completed',
      ]));
      // Newest first.
      const times = history.body.history.map((event) => new Date(event.at).getTime());
      const sorted = [...times].sort((a, b) => b - a);
      expect(times).toEqual(sorted);
      // The intake message is the creation event, not a second reply:
      // exactly one ticket_reply (the HQ follow-up).
      expect(kinds.filter((kind) => kind === 'ticket_reply')).toHaveLength(1);
      expect(history.body.history.find((event) => event.kind === 'ticket_reply').summary)
        .toContain('technician is on the way');
      // Outcome rollup: the fridge ticket and the policy question are
      // still open; the training escalation is resolved.
      expect(history.body.summary.open_cases).toBe(2);
      expect(history.body.summary.resolved_cases).toBe(1);

      // It rides both bundles, and HQ reads the same history.
      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.support_history.total).toBe(history.body.total);
      const hq = await supportHistoryAs(admin, applicationId, true).expect(200);
      expect(hq.body.total).toBe(history.body.total);
      const hqBundle = await adminBundle(admin, applicationId).expect(200);
      expect(hqBundle.body.support_history.total).toBe(history.body.total);
    });

    test('support-history guards: non-operator 403, stranger 404; an empty territory has an empty history', async () => {
      const operator = await addUser();
      const applicant = await addUser();
      const stranger = await addUser();
      const applicationId = await makeApplication(applicant, operator);
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);

      const empty = await supportHistoryAs(operator, applicationId).expect(200);
      expect(empty.body.total).toBe(0);
      expect(empty.body.summary.open_cases).toBe(0);
      expect(empty.body.summary.resolved_cases).toBe(0);
      await supportHistoryAs(applicant, applicationId)
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));
      await supportHistoryAs(stranger, applicationId).expect(404);
    });
  });
});
