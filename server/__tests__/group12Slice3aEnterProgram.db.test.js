'use strict';

// Group 12 Slice 3a acceptance: Enter program (604, 603, 605).
// Runs against a dedicated fresh database (credit_statement_test_g12a) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 604: dedicated franchise interview scheduling (D-300) — HQ proposes slots
//   on the application, the applicant books one, status tracked on the
//   application. One booked slot per application (D-303); an applicant
//   cancel returns the slot to `proposed`.
// 603: applicant document checklist (D-296/D-302) — identity, entity,
//   financials (capital proof), territory plan; applicant uploads per item
//   through the staff-document vault path (private `franchise-documents/`
//   prefix, signed-URL downloads only); admin accepts/rejects with a
//   reason; per-category status is derived (D-304).
// 605: decision follow-up (D-301/D-305) — `shared` notes surface to the
//   applicant, `internal` notes never do (server-enforced); applicant and
//   HQ reply in a dedicated follow-up thread.

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

const PDF_BYTES = Buffer.from('%PDF-1.4\n% test franchise document\n', 'utf8');

describeDb('Group 12 Slice 3a: Enter program (604, 603, 605)', () => {
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
    // Group 12 Slice A (G12-A2 / S-E4, D-643): intake is authenticated-only,
    // so the row is created owned by the applicant at creation; no HQ
    // owner-linking step is needed for the applicant to see it.
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

  describe('G12-A2 / S-E4: authenticated-only intake', () => {
    test('a guest POST is refused with 401 and creates no row; an authenticated POST owns the row', async () => {
      const guestEmail = `g12a2-guest-${randomUUID()}@example.invalid`;
      await request(app)
        .post('/api/franchise/applications')
        .send({
          first_name: 'Guest',
          last_name: 'Applicant',
          email: guestEmail,
          desired_country: 'US',
        })
        .expect(401);

      const orphan = await db.query(
        'SELECT id FROM franchise_applications WHERE email = $1',
        [guestEmail],
      );
      expect(orphan.rows).toHaveLength(0);

      const applicant = await addUser();
      const applicationId = await makeApplication(applicant);
      const owned = await db.query(
        'SELECT applicant_user_id, owner_user_id FROM franchise_applications WHERE id = $1',
        [applicationId],
      );
      expect(owned.rows[0].applicant_user_id).toBe(applicant);
      expect(owned.rows[0].owner_user_id).toBe(applicant);
    });
  });

  describe('603: applicant document checklist', () => {
    function uploadDoc(applicantId, applicationId, category, filename = 'id.pdf') {
      return request(app)
        .post(`/api/franchise/my-applications/${applicationId}/documents`)
        .set('x-test-user', applicantId)
        .field('category', category)
        .attach('file', PDF_BYTES, filename);
    }

    test('applicant uploads per category; admin accepts; per-category status is derived', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const uploaded = await uploadDoc(applicant, applicationId, 'identity').expect(201);
      expect(uploaded.body.documents).toHaveLength(1);
      const doc = uploaded.body.documents[0];
      expect(doc.category).toBe('identity');
      expect(doc.status).toBe('pending');
      expect(doc.storage_key).toBeUndefined();
      expect(typeof doc.download_url).toBe('string');
      expect(doc.download_url).toContain('/api/storage/files/franchise-documents/');
      const identityCategory = uploaded.body.document_categories.find((entry) => entry.category === 'identity');
      expect(identityCategory.status).toBe('pending');
      expect(uploaded.body.document_categories.find((entry) => entry.category === 'entity').status).toBe('missing');

      const reviewed = await request(app)
        .patch(`/api/franchise/applications/${applicationId}/documents/${doc.id}`)
        .set('x-test-user', admin)
        .send({ status: 'accepted' })
        .expect(200);
      expect(reviewed.body.documents[0].status).toBe('accepted');
      expect(reviewed.body.document_categories.find((entry) => entry.category === 'identity').status).toBe('accepted');
    });

    test('rejection needs a reason, shows it to the applicant, and a re-upload reads pending again', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const uploaded = await uploadDoc(applicant, applicationId, 'financials', 'capital.pdf').expect(201);
      const doc = uploaded.body.documents[0];

      await request(app)
        .patch(`/api/franchise/applications/${applicationId}/documents/${doc.id}`)
        .set('x-test-user', admin)
        .send({ status: 'rejected' })
        .expect(400);

      const rejected = await request(app)
        .patch(`/api/franchise/applications/${applicationId}/documents/${doc.id}`)
        .set('x-test-user', admin)
        .send({ status: 'rejected', reason: 'Bank statement is older than 90 days.' })
        .expect(200);
      expect(rejected.body.documents[0].status).toBe('rejected');
      expect(rejected.body.documents[0].review_reason).toBe('Bank statement is older than 90 days.');

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      expect(detail.body.document_categories.find((entry) => entry.category === 'financials').status).toBe('rejected');
      expect(detail.body.documents[0].review_reason).toBe('Bank statement is older than 90 days.');

      const reuploaded = await uploadDoc(applicant, applicationId, 'financials', 'capital-new.pdf').expect(201);
      expect(reuploaded.body.document_categories.find((entry) => entry.category === 'financials').status).toBe('pending');
      expect(reuploaded.body.documents).toHaveLength(2);
    });

    test('invalid category, missing file, stranger upload, and non-admin review are refused', async () => {
      const applicant = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      await uploadDoc(applicant, applicationId, 'passport').expect(400);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/documents`)
        .set('x-test-user', applicant)
        .field('category', 'identity')
        .expect(400);
      await uploadDoc(stranger, applicationId, 'identity').expect(404);

      const uploaded = await uploadDoc(applicant, applicationId, 'entity').expect(201);
      const doc = uploaded.body.documents[0];
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}/documents/${doc.id}`)
        .set('x-test-user', applicant)
        .send({ status: 'accepted' })
        .expect(403);
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}/documents/${randomUUID()}`)
        .set('x-test-user', admin)
        .send({ status: 'accepted' })
        .expect(404);
    });
  });

  describe('605: decision follow-up', () => {
    test('shared notes surface to the applicant; internal notes never do', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      await request(app)
        .post(`/api/franchise/applications/${applicationId}/notes`)
        .set('x-test-user', admin)
        .send({ note_text: 'Internal: capital looks thin, verify before diligence.', visibility: 'internal' })
        .expect(201);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/notes`)
        .set('x-test-user', admin)
        .send({ note_text: 'Shared: your application moved to diligence. We will contact you within 5 days.', visibility: 'shared' })
        .expect(201);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      expect(detail.body.shared_notes).toHaveLength(1);
      expect(detail.body.shared_notes[0].note_text).toContain('moved to diligence');
      const detailText = JSON.stringify(detail.body);
      expect(detailText).not.toContain('capital looks thin');
      expect(detail.body).not.toHaveProperty('notes');

      // The admin bundle still carries both notes.
      const bundle = await request(app)
        .get(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin)
        .expect(200);
      expect(bundle.body.notes).toHaveLength(2);
    });

    test('applicant and HQ reply in one thread; strangers and empty bodies are refused', async () => {
      const applicant = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const fromApplicant = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/followup`)
        .set('x-test-user', applicant)
        .send({ body: 'Thanks for the update. When is the interview?' })
        .expect(201);
      expect(fromApplicant.body.followup).toHaveLength(1);
      expect(fromApplicant.body.followup[0].author_role).toBe('applicant');
      expect(fromApplicant.body.followup[0].body).toContain('When is the interview');

      const fromAdmin = await request(app)
        .post(`/api/franchise/applications/${applicationId}/followup`)
        .set('x-test-user', admin)
        .send({ body: 'We proposed two slots on your dashboard — pick the one that suits you.' })
        .expect(201);
      expect(fromAdmin.body.followup).toHaveLength(2);
      expect(fromAdmin.body.followup[1].author_role).toBe('admin');

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      expect(detail.body.followup).toHaveLength(2);
      expect(detail.body.followup.map((message) => message.author_role)).toEqual(['applicant', 'admin']);

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/followup`)
        .set('x-test-user', stranger)
        .send({ body: 'Hello?' })
        .expect(404);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/followup`)
        .set('x-test-user', applicant)
        .send({ body: '   ' })
        .expect(400);
      await request(app)
        .post(`/api/franchise/applications/${randomUUID()}/followup`)
        .set('x-test-user', admin)
        .send({ body: 'No such application.' })
        .expect(404);
    });
  });
});
