'use strict';

// Group 12 Slice 3e acceptance: Follow standards (621-625).
// Runs against a dedicated fresh database (credit_statement_test_g12e) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 621: standards library (D-321/D-322) — franchise-scoped views over the
//   Learn guides catalog: HQ curates guides as franchise-wide or
//   per-territory standards, operators browse them from the territory
//   ops page. No separate library system.
// 622: version acknowledgment (D-323) — when a standard's version
//   changes, territory members acknowledge the new version with a drawn
//   e-signature, tracked per person per version, with an acknowledgment
//   list visible to HQ. Reuses the SOP read-and-sign pattern.
// 623: brand asset access (D-324) — HQ uploads brand assets (logos,
//   templates, guidelines), operators browse and download them from the
//   territory ops page, scoped to their franchise. Reuses the
//   staff-document vault storage pattern (private prefix, signed URLs).
// 624: operator compliance checklist (D-325) — standards-compliance
//   items per territory, derived from the standards library, the
//   acknowledgment state, and readiness; each checkable, completion
//   shown to the operator and HQ. Distinct from the HQ intake checklist.
// 625: policy change reminders (D-326) — when a standard's version
//   changes, a reminder goes to members who have not yet acknowledged
//   (622), repeating daily until acknowledged or superseded. Type
//   `franchise_standard_updated`, registered in the notification catalog.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP12_SLICE3E_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g12e') {
    throw new Error('Group 12 Slice 3e DB tests require the loopback credit_statement_test_g12e database');
  }
  process.env.DATABASE_URL = dbUrl;
}
// Uploads land in a scratch dir (as in the 3a fixtures), never in the
// shared local upload dir.
process.env.LOCAL_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'g12e-uploads-'));

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g12e-${id}@example.invalid`,
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

// A minimal valid 1x1 PNG (magic bytes + IHDR), used as the drawn
// e-signature for 622 acknowledgments.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
// A minimal PDF body, used as a brand asset upload for 623.
const PDF_BYTES = Buffer.from('%PDF-1.4\n% test franchise brand asset\n', 'utf8');

describeDb('Group 12 Slice 3e: Follow standards (621-625)', () => {
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

  // Franchise-wide standards (and, from 622 on, acknowledgments,
  // brand assets, and reminder rows) are visible to every territory,
  // so each test starts from an empty standards set: the suite
  // database persists across runs.
  beforeEach(async () => {
    await db.query('DELETE FROM franchise_standards');
  });

  async function addUser(role = 'customer') {
    const id = randomUUID();
    const email = `g12e-${id}@example.invalid`;
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

  // Guide ids are unique per call: the suite database persists across
  // runs, so a fixed id would collide with the previous run's row.
  async function addGuide(title, category = 'Operations') {
    const id = `guide-${randomUUID()}`;
    await db.query(
      `INSERT INTO learn_guides (id, title, category, status)
       VALUES ($1, $2, $3, 'published')`,
      [id, title, category],
    );
    return id;
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

  describe('621: standards library', () => {
    test('HQ curates a territory standard; it rides the bundle and the operator detail with the guide title', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const guideId = await addGuide('Food safety basics', 'Operations');

      const curated = await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards`)
        .set('x-test-user', admin.id)
        .send({ guide_id: guideId })
        .expect(201);
      expect(curated.body.standards).toHaveLength(1);
      const standard = curated.body.standards[0];
      expect(standard.guide_id).toBe(guideId);
      expect(standard.guide_title).toBe('Food safety basics');
      expect(standard.guide_category).toBe('Operations');
      expect(standard.scope).toBe('territory');
      expect(standard.version).toBe(1);

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.standards).toHaveLength(1);
      expect(detail.body.standards[0].guide_title).toBe('Food safety basics');
    });

    test('a franchise-wide standard appears in every territory; the same guide can be both scopes, but not twice in one scope', async () => {
      const operator = await addUser();
      const otherOperator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const otherApplicationId = await makeApplication(otherOperator);
      const guideId = await addGuide('Brand standards', 'Brand');

      await request(app)
        .post('/api/franchise/standards')
        .set('x-test-user', admin.id)
        .send({ guide_id: guideId })
        .expect(201)
        .then((res) => {
          expect(res.body.standards).toHaveLength(1);
          expect(res.body.standards[0].scope).toBe('franchise');
        });

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.standards.map((row) => row.guide_id)).toEqual([guideId]);
      const otherDetail = await applicantDetail(otherOperator, otherApplicationId).expect(200);
      expect(otherDetail.body.standards.map((row) => row.guide_id)).toEqual([guideId]);

      // The same guide as a territory standard is a different scope: allowed.
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards`)
        .set('x-test-user', admin.id)
        .send({ guide_id: guideId })
        .expect(201);
      const detailAfter = await applicantDetail(operator, applicationId).expect(200);
      expect(detailAfter.body.standards).toHaveLength(2);
      expect(detailAfter.body.standards.map((row) => row.scope).sort()).toEqual(['franchise', 'territory']);

      // But curating it again in the same scope is a 409.
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards`)
        .set('x-test-user', admin.id)
        .send({ guide_id: guideId })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('standard_already_curated'));
      await request(app)
        .post('/api/franchise/standards')
        .set('x-test-user', admin.id)
        .send({ guide_id: guideId })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('standard_already_curated'));
    });

    test('unknown guide, missing guide id, and non-admin curation are refused', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);

      await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards`)
        .set('x-test-user', admin.id)
        .send({ guide_id: 'guide-does-not-exist' })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('standard_guide_not_found'));
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards`)
        .set('x-test-user', admin.id)
        .send({})
        .expect(400)
        .then((res) => expect(res.body.code).toBe('standard_guide_required'));
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards`)
        .set('x-test-user', operator.id)
        .send({ guide_id: 'guide-brand' })
        .expect(403);
      await request(app)
        .post('/api/franchise/standards')
        .set('x-test-user', operator.id)
        .send({ guide_id: 'guide-brand' })
        .expect(403);
      await request(app)
        .get('/api/franchise/standards')
        .set('x-test-user', operator.id)
        .expect(403);
    });

    test('HQ removes a territory standard; removing again is a 404 and the operator detail loses it', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const guideId = await addGuide('Temporary standard');
      const curated = await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards`)
        .set('x-test-user', admin.id)
        .send({ guide_id: guideId })
        .expect(201);
      const standardId = curated.body.standards[0].id;

      const removed = await request(app)
        .delete(`/api/franchise/applications/${applicationId}/standards/${standardId}`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(removed.body.standards).toHaveLength(0);

      await request(app)
        .delete(`/api/franchise/applications/${applicationId}/standards/${standardId}`)
        .set('x-test-user', admin.id)
        .expect(404)
        .then((res) => expect(res.body.code).toBe('standard_not_found'));

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.standards).toHaveLength(0);
    });

    test('removing a franchise-wide standard removes it from every territory', async () => {
      const operator = await addUser();
      const otherOperator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const otherApplicationId = await makeApplication(otherOperator);
      const guideId = await addGuide('Wide temporary standard');
      const curated = await request(app)
        .post('/api/franchise/standards')
        .set('x-test-user', admin.id)
        .send({ guide_id: guideId })
        .expect(201);
      const standardId = curated.body.standards[0].id;

      const removed = await request(app)
        .delete(`/api/franchise/standards/${standardId}`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(removed.body.standards).toHaveLength(0);

      await expect(applicantDetail(operator, applicationId).expect(200))
        .resolves.toMatchObject({ body: { standards: [] } });
      const otherDetail = await applicantDetail(otherOperator, otherApplicationId).expect(200);
      expect(otherDetail.body.standards).toHaveLength(0);
    });
  });
});
