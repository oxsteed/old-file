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
});
