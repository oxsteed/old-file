'use strict';

// Group 12 Slice 3a acceptance: Enter program (604).
// Runs against a dedicated fresh database (credit_statement_test_g12a) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 604: dedicated franchise interview scheduling (D-300) — HQ proposes slots
//   on the application, the applicant books one, status tracked on the
//   application. One booked slot per application (D-303); an applicant
//   cancel returns the slot to `proposed`.
//   reason; per-category status is derived (D-304).

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP12_SLICE3A_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g12a') {
    throw new Error('Group 12 Slice 3a DB tests require the loopback credit_statement_test_g12a database');
  }
  process.env.DATABASE_URL = dbUrl;
}

// Uploads land in a throwaway local dir; signed download URLs need a secret.
process.env.LOCAL_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'g12a-uploads-'));
process.env.SIGNED_URL_SECRET = process.env.SIGNED_URL_SECRET || 'g12a-test-secret';

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g12a-${id}@example.invalid`,
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
// Upload validation (malware scan + EXIF strip) is exercised in
// fileScanUpload.test.js; acceptance here uses the passthrough, the same
// pattern as group10SliceE / group11Slice2f. Multer's own file filter
// still applies.
jest.mock('../middleware/validateFileUpload', () => (req, res, next) => next());

const describeDb = dbUrl ? describe : describe.skip;


describeDb('Group 12 Slice 3a: Enter program (604)', () => {
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
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed, didit_status, didit_verified_at)
       VALUES ($1, $2, 'x', 'Franchise', 'Fixture', $3, $4, TRUE, TRUE, TRUE, 'pending', NULL)`,
      [id, `g12a-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
    );
    mockRoles.set(id, role);
    return id;
  }

  async function makeApplication(applicantId, overrides = {}) {
    const created = await request(app)
      .post('/api/franchise/applications')
      .set('x-test-user', applicantId)
      .send({
        first_name: 'Fran',
        last_name: 'Chise',
        email: `g12a-${applicantId}@example.invalid`,
        desired_country: 'US',
        desired_region: 'Texas',
        desired_city: 'Austin',
        ...overrides,
      })
      .expect(201);
    const applicationId = created.body.application.id;
    // The intake is a public lead form (no `authenticate` on POST
    // /applications), so the row is created ownerless; HQ links the
    // applicant's account through the admin owner assignment, which is the
    // production path that makes the application visible to the applicant.
    const adminId = await addUser('super_admin');
    await request(app)
      .patch(`/api/franchise/applications/${applicationId}`)
      .set('x-test-user', adminId)
      .send({ owner_user_id: applicantId })
      .expect(200);
    return applicationId;
  }

  function futureIso(hoursFromNow) {
    return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
  }

  function proposeSlot(adminId, applicationId, overrides = {}) {
    return request(app)
      .post(`/api/franchise/applications/${applicationId}/interviews`)
      .set('x-test-user', adminId)
      .send({
        starts_at: futureIso(48),
        ends_at: futureIso(49),
        interviewer_name: 'HQ Reviewer',
        note: 'Introductory interview.',
        ...overrides,
      });
  }

  function applicantDetail(applicantId, applicationId) {
    return request(app)
      .get(`/api/franchise/my-applications/${applicationId}`)
      .set('x-test-user', applicantId);
  }

  describe('604: interview scheduling', () => {
    test('HQ proposes, applicant books, HQ completes; status tracked on the application', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const proposed = await proposeSlot(admin, applicationId).expect(201);
      expect(proposed.body.interviews).toHaveLength(1);
      const slot = proposed.body.interviews[0];
      expect(slot.status).toBe('proposed');
      expect(slot.interviewer_name).toBe('HQ Reviewer');

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      expect(detail.body.interviews).toHaveLength(1);
      expect(detail.body.interviews[0].status).toBe('proposed');

      const booked = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/interviews/${slot.id}/book`)
        .set('x-test-user', applicant)
        .expect(200);
      expect(booked.body.interviews[0].status).toBe('booked');
      expect(booked.body.interviews[0].booked_by).toBe(applicant);

      const completed = await request(app)
        .patch(`/api/franchise/applications/${applicationId}/interviews/${slot.id}`)
        .set('x-test-user', admin)
        .send({ status: 'completed' })
        .expect(200);
      expect(completed.body.interviews[0].status).toBe('completed');

      const { rows } = await db.query(
        'SELECT event_type FROM franchise_activity_log WHERE application_id = $1 ORDER BY created_at ASC',
        [applicationId],
      );
      const events = rows.map((row) => row.event_type);
      expect(events).toContain('interview_proposed');
      expect(events).toContain('interview_booked');
      expect(events).toContain('interview_completed');
    });

    test('one booked slot per application; a stranger cannot book; past slots are refused', async () => {
      const applicant = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const first = await proposeSlot(admin, applicationId).expect(201);
      const firstSlot = first.body.interviews[0];
      const second = await proposeSlot(admin, applicationId, { starts_at: futureIso(72), ends_at: futureIso(73) }).expect(201);
      const secondSlot = second.body.interviews.find((slot) => slot.id !== firstSlot.id);

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/interviews/${firstSlot.id}/book`)
        .set('x-test-user', stranger)
        .expect(404);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/interviews/${firstSlot.id}/book`)
        .set('x-test-user', applicant)
        .expect(200);
      const doubleBook = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/interviews/${secondSlot.id}/book`)
        .set('x-test-user', applicant)
        .expect(409);
      expect(doubleBook.body.code).toBe('interview_already_booked');

      await proposeSlot(admin, applicationId, { starts_at: new Date(Date.now() - 3600 * 1000).toISOString() }).expect(400);
      await proposeSlot(admin, applicationId, { starts_at: 'not-a-date' }).expect(400);
      await proposeSlot(admin, applicationId, { starts_at: futureIso(80), ends_at: futureIso(79) }).expect(400);
    });

    test('applicant cancel returns the slot to proposed; HQ cancel/complete rules are enforced', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const proposed = await proposeSlot(admin, applicationId).expect(201);
      const slot = proposed.body.interviews[0];

      // HQ cannot complete a merely proposed slot.
      const earlyComplete = await request(app)
        .patch(`/api/franchise/applications/${applicationId}/interviews/${slot.id}`)
        .set('x-test-user', admin)
        .send({ status: 'completed' })
        .expect(409);
      expect(earlyComplete.body.code).toBe('interview_not_booked');

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/interviews/${slot.id}/book`)
        .set('x-test-user', applicant)
        .expect(200);

      // A second cancel by the applicant after re-booking is a 409 once the
      // slot is no longer theirs to cancel.
      const cancelled = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/interviews/${slot.id}/cancel`)
        .set('x-test-user', applicant)
        .expect(200);
      expect(cancelled.body.interviews[0].status).toBe('proposed');
      expect(cancelled.body.interviews[0].booked_by).toBeNull();

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/interviews/${slot.id}/cancel`)
        .set('x-test-user', applicant)
        .expect(409);

      // HQ cancels the proposed slot; a terminal slot cannot change again.
      const hqCancelled = await request(app)
        .patch(`/api/franchise/applications/${applicationId}/interviews/${slot.id}`)
        .set('x-test-user', admin)
        .send({ status: 'cancelled' })
        .expect(200);
      expect(hqCancelled.body.interviews[0].status).toBe('cancelled');
      const terminal = await request(app)
        .patch(`/api/franchise/applications/${applicationId}/interviews/${slot.id}`)
        .set('x-test-user', admin)
        .send({ status: 'completed' })
        .expect(409);
      expect(terminal.body.code).toBe('interview_terminal');
    });

    test('a non-admin cannot propose; the applicant cannot see another application', async () => {
      const applicant = await addUser();
      const other = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      await proposeSlot(applicant, applicationId).expect(403);
      await applicantDetail(other, applicationId).expect(404);
      await request(app).get(`/api/franchise/my-applications/${randomUUID()}`).set('x-test-user', applicant).expect(404);
      expect(admin).toBeTruthy();
    });
  });


});
