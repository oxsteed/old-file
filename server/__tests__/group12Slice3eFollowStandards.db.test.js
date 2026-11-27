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
    await db.query('DELETE FROM franchise_standard_acknowledgments');
    await db.query('DELETE FROM franchise_standard_reminders');
    await db.query('DELETE FROM franchise_standards');
    await db.query('DELETE FROM franchise_brand_assets');
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

  describe('622: version acknowledgment', () => {
    async function curateStandard(admin, applicationId, guideTitle = 'Food safety basics') {
      const guideId = await addGuide(guideTitle);
      const curated = await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards`)
        .set('x-test-user', admin.id)
        .send({ guide_id: guideId })
        .expect(201);
      return curated.body.standards.find((row) => row.guide_id === guideId);
    }

    async function inviteAsOperator(operator, applicationId, email, role = 'member') {
      const res = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/invitations`)
        .set('x-test-user', operator.id)
        .send({ email, role })
        .expect(201);
      const invite = res.body.territory_invitations.find((row) => row.email === email.toLowerCase());
      expect(invite).toBeDefined();
      return { invite, token: res.body.new_invite_token };
    }

    function acceptInvite(invitee, token, response = 'accepted') {
      return request(app)
        .post(`/api/franchise/invitations/${token}/respond`)
        .set('x-test-user', invitee.id)
        .set('x-test-email', invitee.email)
        .send({ response });
    }

    function acknowledgeAs(user, applicationId, standardId, version, file = PNG_BYTES) {
      const req = request(app)
        .post(`/api/franchise/my-applications/${applicationId}/standards/${standardId}/acknowledge`)
        .set('x-test-user', user.id);
      if (file) req.attach('signature', file, 'signature.png');
      return req.field('version', String(version));
    }

    test('operator acknowledges the current version with a drawn signature; the ack rides the detail and the HQ list', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const standard = await curateStandard(admin, applicationId);

      const acked = await acknowledgeAs(operator, applicationId, standard.id, 1).expect(201);
      const mine = acked.body.standards.find((row) => row.id === standard.id);
      expect(mine.acknowledged_by_me).toBe(true);
      expect(mine.my_acknowledged_at).toBeTruthy();
      expect(mine.acknowledged_count).toBe(1);
      expect(mine.member_count).toBe(1);
      expect(mine.acknowledgments).toBeUndefined();

      const stored = await db.query(
        'SELECT signature_storage_key FROM franchise_standard_acknowledgments WHERE standard_id = $1 AND user_id = $2 AND version = 1',
        [standard.id, operator.id],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0].signature_storage_key).toMatch(/franchise-standards\/signatures\//);

      const bundle = await adminBundle(admin, applicationId).expect(200);
      const bundled = bundle.body.standards.find((row) => row.id === standard.id);
      expect(bundled.acknowledgments).toHaveLength(1);
      expect(bundled.acknowledgments[0].user_email).toBe(operator.email);
      expect(bundled.acknowledgments[0].version).toBe(1);
      expect(bundled.acknowledgments[0].has_signature).toBe(true);
      expect(bundled.acknowledgments[0].signature_storage_key).toBeUndefined();
    });

    test('re-acknowledging the same version is idempotent, not a second row', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const standard = await curateStandard(admin, applicationId);

      await acknowledgeAs(operator, applicationId, standard.id, 1).expect(201);
      await acknowledgeAs(operator, applicationId, standard.id, 1).expect(200);
      const stored = await db.query(
        'SELECT COUNT(*)::int AS n FROM franchise_standard_acknowledgments WHERE standard_id = $1',
        [standard.id],
      );
      expect(stored.rows[0].n).toBe(1);
    });

    test('re-acknowledging the same version does not upload a second signature (G12-A12)', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const standard = await curateStandard(admin, applicationId);

      await acknowledgeAs(operator, applicationId, standard.id, 1).expect(201);
      const first = await db.query(
        'SELECT signature_storage_key FROM franchise_standard_acknowledgments WHERE standard_id = $1 AND user_id = $2 AND version = 1',
        [standard.id, operator.id],
      );
      expect(first.rows).toHaveLength(1);
      const firstKey = first.rows[0].signature_storage_key;
      expect(firstKey).toMatch(/franchise-standards\/signatures\//);

      // A different PNG on the re-ack: if a second upload happened, the
      // random storage key would change.
      const otherPng = Buffer.concat([PNG_BYTES, Buffer.from([0x01])]);
      await acknowledgeAs(operator, applicationId, standard.id, 1, otherPng).expect(200);
      const second = await db.query(
        'SELECT signature_storage_key FROM franchise_standard_acknowledgments WHERE standard_id = $1 AND user_id = $2 AND version = 1',
        [standard.id, operator.id],
      );
      expect(second.rows).toHaveLength(1);
      expect(second.rows[0].signature_storage_key).toBe(firstKey);
    });

    test('stale version, missing signature, non-PNG signature, and missing version are refused', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const standard = await curateStandard(admin, applicationId);

      await acknowledgeAs(operator, applicationId, standard.id, 2).expect(409)
        .then((res) => expect(res.body.code).toBe('standard_version_conflict'));
      await acknowledgeAs(operator, applicationId, standard.id, 1, null).expect(400)
        .then((res) => expect(res.body.code).toBe('signature_required'));
      await acknowledgeAs(operator, applicationId, standard.id, 1, Buffer.from('not a png')).expect(400)
        .then((res) => expect(res.body.code).toBe('invalid_signature'));
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/standards/${standard.id}/acknowledge`)
        .set('x-test-user', operator.id)
        .attach('signature', PNG_BYTES, 'signature.png')
        .expect(400)
        .then((res) => expect(res.body.code).toBe('standard_version_required'));
    });

    test('an accepted invitee can acknowledge; the applicant record alone gets 403, a stranger gets 404', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const invitee = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant, operator);
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);
      const standard = await curateStandard(admin, applicationId);

      const { token } = await inviteAsOperator(operator, applicationId, invitee.email);
      await acceptInvite(invitee, token).expect(200);

      await acknowledgeAs(invitee, applicationId, standard.id, 1).expect(201);
      const detail = await applicantDetail(operator, applicationId).expect(200);
      const mine = detail.body.standards.find((row) => row.id === standard.id);
      expect(mine.acknowledged_count).toBe(1);
      expect(mine.member_count).toBe(2);

      await acknowledgeAs(applicant, applicationId, standard.id, 1).expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_standard_acknowledge_not_member'));
      await acknowledgeAs(stranger, applicationId, standard.id, 1).expect(404);
    });

    test('HQ publishes a new version; the old acknowledgment no longer counts and v1 cannot be acknowledged', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const standard = await curateStandard(admin, applicationId);
      await acknowledgeAs(operator, applicationId, standard.id, 1).expect(201);

      const published = await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards/${standard.id}/version`)
        .set('x-test-user', admin.id)
        .expect(200);
      const bumped = published.body.standards.find((row) => row.id === standard.id);
      expect(bumped.version).toBe(2);

      const detail = await applicantDetail(operator, applicationId).expect(200);
      const mine = detail.body.standards.find((row) => row.id === standard.id);
      expect(mine.acknowledged_by_me).toBe(false);
      expect(mine.acknowledged_count).toBe(0);

      const bundle = await adminBundle(admin, applicationId).expect(200);
      const bundled = bundle.body.standards.find((row) => row.id === standard.id);
      expect(bundled.acknowledgments).toHaveLength(1);
      expect(bundled.acknowledgments[0].version).toBe(1);

      await acknowledgeAs(operator, applicationId, standard.id, 1).expect(409)
        .then((res) => expect(res.body.code).toBe('standard_version_conflict'));
      await acknowledgeAs(operator, applicationId, standard.id, 2).expect(201);
      const detailAfter = await applicantDetail(operator, applicationId).expect(200);
      expect(detailAfter.body.standards.find((row) => row.id === standard.id).acknowledged_count).toBe(1);
    });

    test('publishing validates the standard and the caller; a standard from another territory is not addressable', async () => {
      const operator = await addUser();
      const otherOperator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const otherApplicationId = await makeApplication(otherOperator);
      const standard = await curateStandard(admin, applicationId);
      const otherStandard = await curateStandard(admin, otherApplicationId);

      await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards/${otherStandard.id}/version`)
        .set('x-test-user', admin.id)
        .expect(404)
        .then((res) => expect(res.body.code).toBe('standard_not_found'));
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards/00000000-0000-0000-0000-000000000000/version`)
        .set('x-test-user', admin.id)
        .expect(404)
        .then((res) => expect(res.body.code).toBe('standard_not_found'));
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards/${standard.id}/version`)
        .set('x-test-user', operator.id)
        .expect(403);
      await acknowledgeAs(otherOperator, otherApplicationId, standard.id, 1).expect(404)
        .then((res) => expect(res.body.code).toBe('standard_not_found'));
    });

    test('a franchise-wide standard publishes from the wide endpoint and every territory sees the new version', async () => {
      const operator = await addUser();
      const otherOperator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const otherApplicationId = await makeApplication(otherOperator);
      const guideId = await addGuide('Wide brand standard');
      const curated = await request(app)
        .post('/api/franchise/standards')
        .set('x-test-user', admin.id)
        .send({ guide_id: guideId })
        .expect(201);
      const standard = curated.body.standards[0];

      const published = await request(app)
        .post(`/api/franchise/standards/${standard.id}/version`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(published.body.standards[0].version).toBe(2);

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.standards.find((row) => row.id === standard.id).version).toBe(2);
      const otherDetail = await applicantDetail(otherOperator, otherApplicationId).expect(200);
      expect(otherDetail.body.standards.find((row) => row.id === standard.id).version).toBe(2);
    });
  });

  describe('623: brand asset access', () => {
    function uploadAs(user, applicationId, file = PDF_BYTES, filename = 'brand-guide.pdf', fields = {}) {
      const req = request(app)
        .post(`/api/franchise/applications/${applicationId}/brand-assets`)
        .set('x-test-user', user.id);
      if (file) req.attach('file', file, filename);
      for (const [key, value] of Object.entries(fields)) req.field(key, value);
      return req;
    }

    test('HQ uploads a territory asset; it rides the bundle and the operator detail with a signed download URL', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);

      const uploaded = await uploadAs(admin, applicationId, PDF_BYTES, 'brand-guide.pdf', {
        name: 'Brand guide 2026', description: 'The brand book.',
      }).expect(201);
      expect(uploaded.body.brand_assets).toHaveLength(1);
      const asset = uploaded.body.brand_assets[0];
      expect(asset.name).toBe('Brand guide 2026');
      expect(asset.description).toBe('The brand book.');
      expect(asset.file_name).toBe('brand-guide.pdf');
      expect(asset.scope).toBe('territory');
      expect(asset.storage_key).toBeUndefined();
      expect(asset.download_url).toBeTruthy();
      expect(asset.download_unavailable).toBe(false);

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.brand_assets).toHaveLength(1);
      expect(detail.body.brand_assets[0].name).toBe('Brand guide 2026');
      expect(detail.body.brand_assets[0].download_url).toBeTruthy();

      const stored = await db.query(
        'SELECT storage_key FROM franchise_brand_assets WHERE id = $1', [asset.id],
      );
      expect(stored.rows[0].storage_key).toMatch(/^franchise-brand-assets\//);
    });

    test('the name defaults to the file name when omitted; a franchise-wide asset appears in every territory', async () => {
      const operator = await addUser();
      const otherOperator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const otherApplicationId = await makeApplication(otherOperator);

      const uploaded = await request(app)
        .post('/api/franchise/brand-assets')
        .set('x-test-user', admin.id)
        .attach('file', PDF_BYTES, 'logo-pack.pdf')
        .expect(201);
      expect(uploaded.body.brand_assets).toHaveLength(1);
      expect(uploaded.body.brand_assets[0].name).toBe('logo-pack.pdf');
      expect(uploaded.body.brand_assets[0].scope).toBe('franchise');

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.brand_assets.map((row) => row.name)).toEqual(['logo-pack.pdf']);
      const otherDetail = await applicantDetail(otherOperator, otherApplicationId).expect(200);
      expect(otherDetail.body.brand_assets.map((row) => row.name)).toEqual(['logo-pack.pdf']);
    });

    test('missing file and non-admin upload are refused', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);

      await uploadAs(admin, applicationId, null).expect(400)
        .then((res) => expect(res.body.code).toBe('brand_asset_file_required'));
      await uploadAs(operator, applicationId).expect(403);
      await request(app)
        .post('/api/franchise/brand-assets')
        .set('x-test-user', operator.id)
        .attach('file', PDF_BYTES, 'logo.pdf')
        .expect(403);
      await request(app)
        .get('/api/franchise/brand-assets')
        .set('x-test-user', operator.id)
        .expect(403);
    });

    test('HQ deletes a territory asset; deleting again is a 404 and the operator detail loses it', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const uploaded = await uploadAs(admin, applicationId).expect(201);
      const assetId = uploaded.body.brand_assets[0].id;

      const removed = await request(app)
        .delete(`/api/franchise/applications/${applicationId}/brand-assets/${assetId}`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(removed.body.brand_assets).toHaveLength(0);

      await request(app)
        .delete(`/api/franchise/applications/${applicationId}/brand-assets/${assetId}`)
        .set('x-test-user', admin.id)
        .expect(404)
        .then((res) => expect(res.body.code).toBe('brand_asset_not_found'));

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.brand_assets).toHaveLength(0);
    });

    test('the brand asset download URL is minted on click, for the territory asset and the franchise-wide one (G12-A11)', async () => {
      const operator = await addUser();
      const otherOperator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const otherApplicationId = await makeApplication(otherOperator);

      const territory = await uploadAs(admin, applicationId, PDF_BYTES, 'brand-guide.pdf', {
        name: 'Brand guide 2026',
      }).expect(201);
      const territoryAsset = territory.body.brand_assets[0];
      const wide = await request(app)
        .post('/api/franchise/brand-assets')
        .set('x-test-user', admin.id)
        .attach('file', PDF_BYTES, 'logo-pack.pdf')
        .expect(201);
      const wideAsset = wide.body.brand_assets[0];

      // The operator mints a fresh URL for their territory asset.
      const minted = await request(app)
        .get(`/api/franchise/my-applications/${applicationId}/brand-assets/${territoryAsset.id}/download-url`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(typeof minted.body.download_url).toBe('string');
      expect(minted.body.download_url).toContain('/api/storage/files/franchise-brand-assets/');
      // The franchise-wide asset is mintable from any territory.
      const wideMinted = await request(app)
        .get(`/api/franchise/my-applications/${otherApplicationId}/brand-assets/${wideAsset.id}/download-url`)
        .set('x-test-user', otherOperator.id)
        .expect(200);
      expect(typeof wideMinted.body.download_url).toBe('string');
      // But a territory asset from another territory is not.
      await request(app)
        .get(`/api/franchise/my-applications/${otherApplicationId}/brand-assets/${territoryAsset.id}/download-url`)
        .set('x-test-user', otherOperator.id)
        .expect(404);
      // HQ's admin twin mints the same way.
      const adminMinted = await request(app)
        .get(`/api/franchise/applications/${applicationId}/brand-assets/${territoryAsset.id}/download-url`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(typeof adminMinted.body.download_url).toBe('string');
    });

    test('deleting a franchise-wide asset removes it from every territory', async () => {
      const operator = await addUser();
      const otherOperator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const otherApplicationId = await makeApplication(otherOperator);
      const uploaded = await request(app)
        .post('/api/franchise/brand-assets')
        .set('x-test-user', admin.id)
        .attach('file', PDF_BYTES, 'wide-logo.pdf')
        .expect(201);
      const assetId = uploaded.body.brand_assets[0].id;

      const removed = await request(app)
        .delete(`/api/franchise/brand-assets/${assetId}`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(removed.body.brand_assets).toHaveLength(0);

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.brand_assets).toHaveLength(0);
      const otherDetail = await applicantDetail(otherOperator, otherApplicationId).expect(200);
      expect(otherDetail.body.brand_assets).toHaveLength(0);
    });
  });

  describe('624: operator compliance checklist', () => {
    async function curateStandard(admin, applicationId, guideTitle = 'Food safety basics') {
      const guideId = await addGuide(guideTitle);
      const curated = await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards`)
        .set('x-test-user', admin.id)
        .send({ guide_id: guideId })
        .expect(201);
      return curated.body.standards.find((row) => row.guide_id === guideId);
    }

    function acknowledgeAs(user, applicationId, standardId, version) {
      return request(app)
        .post(`/api/franchise/my-applications/${applicationId}/standards/${standardId}/acknowledge`)
        .set('x-test-user', user.id)
        .attach('signature', PNG_BYTES, 'signature.png')
        .field('version', String(version));
    }

    async function inviteAsOperator(operator, applicationId, email) {
      const res = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/invitations`)
        .set('x-test-user', operator.id)
        .send({ email, role: 'member' })
        .expect(201);
      return res.body.new_invite_token;
    }

    function acceptInvite(invitee, token) {
      return request(app)
        .post(`/api/franchise/invitations/${token}/respond`)
        .set('x-test-user', invitee.id)
        .set('x-test-email', invitee.email)
        .send({ response: 'accepted' });
    }

    function standardItem(checklist, standardId) {
      return checklist.items.find((item) => item.standard_id === standardId);
    }

    test('with no standards the checklist is the readiness item alone, pending', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);

      const detail = await applicantDetail(operator, applicationId).expect(200);
      const checklist = detail.body.compliance_checklist;
      expect(checklist.total).toBe(1);
      expect(checklist.done).toBe(0);
      expect(checklist.items).toHaveLength(1);
      expect(checklist.items[0].kind).toBe('readiness');
      expect(checklist.items[0].done).toBe(false);
      expect(checklist.items[0].readiness_status).toBe('not_ready');
    });

    test('curating a standard adds its item plus the team rollup; acknowledging checks both', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const standard = await curateStandard(admin, applicationId);

      const before = await applicantDetail(operator, applicationId).expect(200);
      const beforeList = before.body.compliance_checklist;
      expect(beforeList.total).toBe(3);
      expect(beforeList.done).toBe(0);
      const standardBefore = standardItem(beforeList, standard.id);
      expect(standardBefore.kind).toBe('standard');
      expect(standardBefore.done).toBe(false);
      expect(standardBefore.acknowledged_count).toBe(0);
      expect(standardBefore.member_count).toBe(1);
      expect(standardBefore.version).toBe(1);
      const teamBefore = beforeList.items.find((item) => item.kind === 'team');
      expect(teamBefore.done).toBe(false);
      expect(teamBefore.pending_standards).toBe(1);

      await acknowledgeAs(operator, applicationId, standard.id, 1).expect(201);

      const after = await applicantDetail(operator, applicationId).expect(200);
      const afterList = after.body.compliance_checklist;
      expect(afterList.done).toBe(2);
      expect(standardItem(afterList, standard.id).done).toBe(true);
      expect(afterList.items.find((item) => item.kind === 'team').done).toBe(true);

      const bundle = await adminBundle(admin, applicationId).expect(200);
      const bundleList = bundle.body.compliance_checklist;
      expect(bundleList.done).toBe(2);
      expect(standardItem(bundleList, standard.id).done).toBe(true);
      expect(bundleList.items.find((item) => item.kind === 'team').done).toBe(true);
    });

    test('the team item stays pending until every member acknowledges, in both perspectives', async () => {
      const operator = await addUser();
      const invitee = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const standard = await curateStandard(admin, applicationId);
      const token = await inviteAsOperator(operator, applicationId, invitee.email);
      await acceptInvite(invitee, token).expect(200);

      await acknowledgeAs(operator, applicationId, standard.id, 1).expect(201);

      // Viewer perspective: my standard item is checked, the team item is not.
      const detail = await applicantDetail(operator, applicationId).expect(200);
      const viewerList = detail.body.compliance_checklist;
      expect(standardItem(viewerList, standard.id).done).toBe(true);
      expect(standardItem(viewerList, standard.id).acknowledged_count).toBe(1);
      expect(standardItem(viewerList, standard.id).member_count).toBe(2);
      expect(viewerList.items.find((item) => item.kind === 'team').done).toBe(false);
      expect(viewerList.done).toBe(1);

      // Team perspective (HQ): the standard item itself is not done yet.
      const bundle = await adminBundle(admin, applicationId).expect(200);
      const teamList = bundle.body.compliance_checklist;
      expect(standardItem(teamList, standard.id).done).toBe(false);
      expect(teamList.items.find((item) => item.kind === 'team').done).toBe(false);

      await acknowledgeAs(invitee, applicationId, standard.id, 1).expect(201);
      const bundleAfter = await adminBundle(admin, applicationId).expect(200);
      expect(standardItem(bundleAfter.body.compliance_checklist, standard.id).done).toBe(true);
      expect(bundleAfter.body.compliance_checklist.items.find((item) => item.kind === 'team').done).toBe(true);
    });

    test('a passed readiness review checks the readiness item; a new version unchecks the standard item', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const standard = await curateStandard(admin, applicationId);
      await acknowledgeAs(operator, applicationId, standard.id, 1).expect(201);

      await request(app)
        .post(`/api/franchise/applications/${applicationId}/readiness-review`)
        .set('x-test-user', admin.id)
        .send({ outcome: 'passed' })
        .expect(201);

      const detail = await applicantDetail(operator, applicationId).expect(200);
      const checklist = detail.body.compliance_checklist;
      expect(checklist.done).toBe(3);
      expect(checklist.items.find((item) => item.kind === 'readiness').done).toBe(true);
      expect(checklist.items.find((item) => item.kind === 'readiness').readiness_status).toBe('ready');

      await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards/${standard.id}/version`)
        .set('x-test-user', admin.id)
        .expect(200);
      const afterPublish = await applicantDetail(operator, applicationId).expect(200);
      const afterList = afterPublish.body.compliance_checklist;
      expect(standardItem(afterList, standard.id).done).toBe(false);
      expect(standardItem(afterList, standard.id).version).toBe(2);
      expect(afterList.items.find((item) => item.kind === 'team').done).toBe(false);
      expect(afterList.done).toBe(1);
    });
  });

  describe('625: policy change reminders', () => {
    const { sendNotification } = require('../services/notificationService');
    const { sendFranchiseStandardReminders } = require('../jobs/franchiseStandardReminders');

    async function curateStandard(admin, applicationId, guideTitle = 'Food safety basics') {
      const guideId = await addGuide(guideTitle);
      const curated = await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards`)
        .set('x-test-user', admin.id)
        .send({ guide_id: guideId })
        .expect(201);
      return curated.body.standards.find((row) => row.guide_id === guideId);
    }

    function acknowledgeAs(user, applicationId, standardId, version) {
      return request(app)
        .post(`/api/franchise/my-applications/${applicationId}/standards/${standardId}/acknowledge`)
        .set('x-test-user', user.id)
        .attach('signature', PNG_BYTES, 'signature.png')
        .field('version', String(version));
    }

    async function publishVersion(admin, applicationId, standardId) {
      return request(app)
        .post(`/api/franchise/applications/${applicationId}/standards/${standardId}/version`)
        .set('x-test-user', admin.id)
        .expect(200);
    }

    async function reminderRows(standardId) {
      const { rows } = await db.query(
        `SELECT user_id, version FROM franchise_standard_reminders WHERE standard_id = $1`,
        [standardId]
      );
      return rows;
    }

    beforeEach(() => { sendNotification.mockClear(); });

    test('publishing a new version immediately reminds the members who have not acknowledged it', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const standard = await curateStandard(admin, applicationId);

      await publishVersion(admin, applicationId, standard.id);

      expect(sendNotification).toHaveBeenCalledTimes(1);
      const call = sendNotification.mock.calls[0][0];
      expect(call.userId).toBe(operator.id);
      expect(call.type).toBe('franchise_standard_updated');
      expect(call.data.params.version).toBe(2);
      expect(call.data.params.standardTitle).toBe('Food safety basics');
      expect(call.data.standard_id).toBe(standard.id);
      expect(call.idempotencyKey).toContain(`v2`);
      const rows = await reminderRows(standard.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(operator.id);
      expect(rows[0].version).toBe(2);
    });

    test('publishing does not remind a member who already acknowledged the new version, and a reminder failure never fails the publish', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const standard = await curateStandard(admin, applicationId);

      await publishVersion(admin, applicationId, standard.id);
      expect(sendNotification).toHaveBeenCalledTimes(1);
      await acknowledgeAs(operator, applicationId, standard.id, 2).expect(201);
      sendNotification.mockClear();

      sendNotification.mockRejectedValueOnce(new Error('notify down'));
      await publishVersion(admin, applicationId, standard.id);
      // The publish itself still succeeds; the failed reminder is
      // swallowed and logged, never a 500.
      expect(sendNotification).toHaveBeenCalledTimes(1);
      expect(sendNotification.mock.calls[0][0].data.params.version).toBe(3);

      sendNotification.mockClear();
      await acknowledgeAs(operator, applicationId, standard.id, 3).expect(201);
      // Acknowledged the current version: the sweeper has nothing to
      // remind this member about, even with no ledger row for it.
      const sweep = await sendFranchiseStandardReminders({ db });
      expect(sweep.reminded).toEqual([]);
      expect(sendNotification).not.toHaveBeenCalled();
    });

    test('the daily sweeper sends at most once per person per version per day and skips acknowledged members', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const standard = await curateStandard(admin, applicationId);

      const first = await sendFranchiseStandardReminders({ db });
      expect(first.reminded).toEqual([operator.id]);
      expect(sendNotification).toHaveBeenCalledTimes(1);

      const second = await sendFranchiseStandardReminders({ db });
      expect(second.reminded).toEqual([]);
      expect(sendNotification).toHaveBeenCalledTimes(1);

      await acknowledgeAs(operator, applicationId, standard.id, 1).expect(201);
      // Even with the 24h window cleared, an acknowledged member is
      // never reminded again about that version.
      await db.query('DELETE FROM franchise_standard_reminders WHERE standard_id = $1', [standard.id]);
      const third = await sendFranchiseStandardReminders({ db });
      expect(third.reminded).toEqual([]);
      expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    test('the sweeper only ever reminds about the current version', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const standard = await curateStandard(admin, applicationId);

      await sendFranchiseStandardReminders({ db });
      expect(sendNotification.mock.calls[0][0].data.params.version).toBe(1);
      await publishVersion(admin, applicationId, standard.id);
      sendNotification.mockClear();
      await db.query('DELETE FROM franchise_standard_reminders WHERE standard_id = $1', [standard.id]);

      await sendFranchiseStandardReminders({ db });
      expect(sendNotification).toHaveBeenCalledTimes(1);
      expect(sendNotification.mock.calls[0][0].data.params.version).toBe(2);
      const versions = sendNotification.mock.calls.map((args) => args[0].data.params.version);
      expect(versions).not.toContain(1);
    });

    test('HQ manual remind re-sends now (bypassing the daily dedupe) and stops once acknowledged', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const standard = await curateStandard(admin, applicationId);

      const first = await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards/${standard.id}/remind`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(first.body.reminded_user_ids).toEqual([operator.id]);
      expect(sendNotification).toHaveBeenCalledTimes(1);

      const second = await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards/${standard.id}/remind`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(second.body.reminded_user_ids).toEqual([operator.id]);
      expect(sendNotification).toHaveBeenCalledTimes(2);

      await acknowledgeAs(operator, applicationId, standard.id, 1).expect(201);
      const third = await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards/${standard.id}/remind`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(third.body.reminded_user_ids).toEqual([]);
      expect(sendNotification).toHaveBeenCalledTimes(2);
    });

    test('publishing a franchise-wide standard reminds the members of every territory', async () => {
      const operator = await addUser();
      const otherOperator = await addUser();
      const admin = await addUser('super_admin');
      await makeApplication(operator);
      await makeApplication(otherOperator);
      const guideId = await addGuide('Franchise-wide safety');
      const curated = await request(app)
        .post('/api/franchise/standards')
        .set('x-test-user', admin.id)
        .send({ guide_id: guideId })
        .expect(201);
      const standard = curated.body.standards.find((row) => row.guide_id === guideId);

      await request(app)
        .post(`/api/franchise/standards/${standard.id}/version`)
        .set('x-test-user', admin.id)
        .expect(200);

      // Territories from earlier tests in this suite persist in the
      // shared DB, so assert inclusion (not exact equality): both of
      // this test's operators are reminded, each exactly once.
      const remindedIds = sendNotification.mock.calls.map((args) => args[0].userId);
      expect(remindedIds).toContain(operator.id);
      expect(remindedIds).toContain(otherOperator.id);
      expect(new Set(remindedIds).size).toBe(remindedIds.length);
      expect(sendNotification.mock.calls[0][0].type).toBe('franchise_standard_updated');
    });

    test('the HQ remind endpoint 404s for an unknown standard', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/standards/${randomUUID()}/remind`)
        .set('x-test-user', admin.id)
        .expect(404);
      expect(sendNotification).not.toHaveBeenCalled();
    });

    test('the sweeper skips rejected and archived applications (G12-A14)', async () => {
      const liveOperator = await addUser();
      const deadOperator = await addUser();
      const admin = await addUser('super_admin');
      const liveId = await makeApplication(liveOperator);
      const deadId = await makeApplication(deadOperator);
      const liveStandard = await curateStandard(admin, liveId, 'Live standard');
      const deadStandard = await curateStandard(admin, deadId, 'Dead standard');

      // The live application still reminds its operator.
      const liveSweep = await sendFranchiseStandardReminders({ db, standardId: liveStandard.id });
      expect(liveSweep.reminded).toEqual([liveOperator.id]);

      // Reject the second application: its operator is no longer reminded,
      // even with the standard still current and unacknowledged.
      await request(app)
        .patch(`/api/franchise/applications/${deadId}`)
        .set('x-test-user', admin.id)
        .send({ status: 'rejected' })
        .expect(200);
      sendNotification.mockClear();
      const deadSweep = await sendFranchiseStandardReminders({ db, standardId: deadStandard.id });
      expect(deadSweep.reminded).toEqual([]);
      expect(sendNotification).not.toHaveBeenCalled();

      // Archiving behaves the same way.
      await request(app)
        .patch(`/api/franchise/applications/${deadId}`)
        .set('x-test-user', admin.id)
        .send({ status: 'archived' })
        .expect(200);
      const archivedSweep = await sendFranchiseStandardReminders({ db, standardId: deadStandard.id });
      expect(archivedSweep.reminded).toEqual([]);
    });
  });
});
