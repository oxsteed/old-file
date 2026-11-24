'use strict';

// Group 12 Slice 3f acceptance: Monitor locations (626-630).
// Runs against a dedicated fresh database (credit_statement_test_g12f) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 626: permitted performance rollup — EXISTS, verified by the survey
//   (`GET /franchise/territory-stats`, KPI grid in
//   `FranchiseTerritoryOpsPage.jsx`); no build, no test here.
// 628: service exception summary (D-327) — a franchise "exception" is a
//   support ticket attached to a territory (D-293: tickets own
//   exceptions, no parallel exception store). The operator links one of
//   their own tickets by ticket number (location optional, must belong
//   to the territory); HQ links any ticket. The summary derives on read.
// 627: per-location health view (D-328) — per-location status, KPIs, and
//   compliance, derived from the open locations plus their linked
//   tickets; operator-facing and territory-scoped.
// 629: open support requests (D-329) — the territory ticket queue: a
//   territory filter over the linked tickets, each carrying its
//   application/location link.
// 630: shift coverage trends (D-330) — a territory-level coverage trend
//   over time, derived from the linked business's staff shifts.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP12_SLICE3F_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g12f') {
    throw new Error('Group 12 Slice 3f DB tests require the loopback credit_statement_test_g12f database');
  }
  process.env.DATABASE_URL = 'postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test_g12f';
}
// Uploads land in a scratch dir (as in the 3a fixtures), never in the
// shared local upload dir.
process.env.LOCAL_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'g12f-uploads-'));

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g12f-${id}@example.invalid`,
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

describeDb('Group 12 Slice 3f: Monitor locations (626-630)', () => {
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
    const email = `g12f-${id}@example.invalid`;
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
  // the applicant is also the operator, as in the 3c/3d fixtures.
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
  // its locations); otherwise it is an unlinked ticket the operator can
  // attach with the link endpoint.
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

  describe('628: service exception summary', () => {
    test('an unlinked territory reports an empty summary', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);

      const summary = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/exceptions`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(summary.body.total).toBe(0);
      expect(summary.body.open_count).toBe(0);
      expect(summary.body.open_urgent_count).toBe(0);
      expect(summary.body.closed_count).toBe(0);
      expect(summary.body.oldest_open_at).toBeNull();
      expect(summary.body.by_status).toEqual([]);
      expect(summary.body.by_category).toEqual([]);
      expect(summary.body.by_priority).toEqual([]);
      expect(summary.body.by_location).toEqual([]);
      expect(summary.body.recent_open).toEqual([]);
    });

    test('the operator links their own ticket by number; the summary aggregates it and rides the detail bundle', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const locationId = await locationIdFor(operator, applicationId);
      const ticket = await addTicket(operator, { category: 'technical', priority: 'high' });

      const linked = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.ticket_number}/link`)
        .set('x-test-user', operator.id)
        .send({ location_id: locationId })
        .expect(200);
      expect(linked.body.ticket.ticket_number).toBe(ticket.ticket_number);
      expect(linked.body.exception_summary.open_count).toBe(1);
      expect(linked.body.exception_summary.open_urgent_count).toBe(1);

      const summary = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/exceptions`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(summary.body.total).toBe(1);
      expect(summary.body.open_count).toBe(1);
      expect(summary.body.by_category).toEqual([{ category: 'technical', count: 1 }]);
      expect(summary.body.by_priority).toEqual([{ priority: 'high', count: 1 }]);
      expect(summary.body.by_status).toEqual([{ status: 'open', count: 1 }]);
      expect(summary.body.by_location).toHaveLength(1);
      expect(summary.body.by_location[0].location_id).toBe(locationId);
      expect(summary.body.by_location[0].open_count).toBe(1);
      expect(summary.body.recent_open).toHaveLength(1);
      expect(summary.body.recent_open[0].ticket_number).toBe(ticket.ticket_number);
      expect(summary.body.recent_open[0].location_id).toBe(locationId);
      expect(summary.body.oldest_open_at).toBeTruthy();

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.exception_summary.open_count).toBe(1);
      expect(detail.body.exception_summary.total).toBe(1);
    });

    test('resolved tickets close the exception but stay in the totals', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      await addTicket(operator, { applicationId, status: 'resolved', priority: 'urgent' });
      await addTicket(operator, { applicationId, status: 'open', priority: 'low' });

      const summary = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/exceptions`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(summary.body.total).toBe(2);
      expect(summary.body.open_count).toBe(1);
      expect(summary.body.closed_count).toBe(1);
      expect(summary.body.open_urgent_count).toBe(0);
    });

    test('linking refuses a stranger ticket, an unknown ticket, and a location from another territory', async () => {
      const operator = await addUser();
      const other = await addUser();
      const applicationId = await makeApplication(operator);
      const otherApplicationId = await makeApplication(other);
      const foreignLocationId = await locationIdFor(other, otherApplicationId);
      const strangerTicket = await addTicket(other);
      const ownTicket = await addTicket(operator);

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${strangerTicket.ticket_number}/link`)
        .set('x-test-user', operator.id)
        .send({})
        .expect(404)
        .then((res) => expect(res.body.code).toBe('ticket_not_found'));
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/999999/link`)
        .set('x-test-user', operator.id)
        .send({})
        .expect(404)
        .then((res) => expect(res.body.code).toBe('ticket_not_found'));
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ownTicket.ticket_number}/link`)
        .set('x-test-user', operator.id)
        .send({ location_id: foreignLocationId })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('location_not_found'));

      // Nothing was linked by the refused attempts.
      const summary = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/exceptions`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(summary.body.total).toBe(0);
    });

    test('unlinking drops the exception and leaves the ticket itself untouched', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const ticket = await addTicket(operator, { applicationId });

      const unlinked = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.id}/unlink`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(unlinked.body.exception_summary.total).toBe(0);

      const { rows } = await db.query('SELECT * FROM support_tickets WHERE id = $1', [ticket.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].franchise_application_id).toBeNull();
      expect(rows[0].status).toBe('open');

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/support-tickets/${ticket.id}/unlink`)
        .set('x-test-user', operator.id)
        .expect(404)
        .then((res) => expect(res.body.code).toBe('ticket_not_found'));
    });

    test('a stranger gets 404, a non-operator applicant 403, HQ reads and links any ticket', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant, operator);
      // The public lead form leaves applicant_user_id NULL; link the
      // applicant record directly, as the 3c/3d fixtures do.
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);
      const ticket = await addTicket(applicant, { priority: 'urgent' });

      await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/exceptions`)
        .set('x-test-user', stranger.id)
        .expect(404);
      await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/exceptions`)
        .set('x-test-user', applicant.id)
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));

      // HQ links the applicant's ticket: the operator then sees it in
      // their territory summary, including tickets filed by others.
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/support-tickets/${ticket.ticket_number}/link`)
        .set('x-test-user', admin.id)
        .send({})
        .expect(200);
      const adminSummary = await request(app)
        .get(`/api/franchise/applications/${applicationId}/exceptions`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(adminSummary.body.open_count).toBe(1);
      expect(adminSummary.body.open_urgent_count).toBe(1);
      expect(adminSummary.body.by_location).toHaveLength(1);
      expect(adminSummary.body.by_location[0].location_id).toBeNull();
      expect(adminSummary.body.by_location[0].location_name).toBeNull();

      const operatorSummary = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/exceptions`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(operatorSummary.body.open_count).toBe(1);
      expect(operatorSummary.body.recent_open[0].requester_name).toBe('Franchise Fixture');

      // HQ unlink clears it again; the admin detail bundle carries it too.
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/support-tickets/${ticket.id}/unlink`)
        .set('x-test-user', admin.id)
        .expect(200);
      const bundle = await request(app)
        .get(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(bundle.body.exception_summary.total).toBe(0);
    });
  });
});
