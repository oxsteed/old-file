'use strict';

// Group 12 Slice 3b acceptance: Take responsibility (608, 606, 607, 609, 610).
// Runs against a dedicated fresh database (credit_statement_test_g12b) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 608: operator responsibility checklist (D-306) — the fixed 8-item set an
//   operator accepts for their territory, seeded at creation, each item
//   acknowledged by the operator; progress tracked on the application and
//   shown on the operator dashboard and in HQ. Not the HQ intake checklist
//   (603): those 8 items are HQ process steps.
// 606: territory acceptance (D-295/D-307) — admin assignment is an offer;
//   the operator accepts or declines (decline needs a reason); the operator
//   surface stays locked while an offer is outstanding or declined.
// 607: assignment boundary summary (D-294/D-308) — explicit structured
//   area list (country/region/city, included/excluded) plus the agreement's
//   exclusivity flag, admin-editable, operator read-only.
// 609: territory launch plan (D-309) — plan steps with dates and owners on
//   top of the readiness status; milestones (611) plug in later.
// 610: operator-facing assignment history (D-310) — the activity log,
//   operator-scoped and server-enforced, without internal-note content.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP12_SLICE3B_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g12b') {
    throw new Error('Group 12 Slice 3b DB tests require the loopback credit_statement_test_g12b database');
  }
  process.env.DATABASE_URL = dbUrl;
}

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g12b-${id}@example.invalid`,
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

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 12 Slice 3b: Take responsibility (608, 606, 607, 609, 610)', () => {
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
      [id, `g12b-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
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
        email: `g12b-${applicantId}@example.invalid`,
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

  function applicantDetail(applicantId, applicationId) {
    return request(app)
      .get(`/api/franchise/my-applications/${applicationId}`)
      .set('x-test-user', applicantId);
  }

  function adminBundle(adminId, applicationId) {
    return request(app)
      .get(`/api/franchise/applications/${applicationId}`)
      .set('x-test-user', adminId);
  }

  describe('608: operator responsibility checklist', () => {
    const EXPECTED_CODES = [
      'operate_territory',
      'brand_standards',
      'recruit_train_team',
      'comply_local_law',
      'report_performance',
      'honor_agreement_fees',
      'protect_brand_assets',
      'resolve_customer_issues',
    ];

    test('a new application seeds the fixed 8-item set, pending, visible to operator and HQ', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      expect(detail.body.responsibilities).toHaveLength(8);
      expect(detail.body.responsibilities.map((item) => item.code)).toEqual(EXPECTED_CODES);
      expect(detail.body.responsibilities.every((item) => item.status === 'pending')).toBe(true);

      const bundle = await adminBundle(admin, applicationId).expect(200);
      expect(bundle.body.responsibilities).toHaveLength(8);
      expect(bundle.body.application.responsibility_total).toBe(8);
      expect(bundle.body.application.responsibility_acknowledged).toBe(0);
    });

    test('operator acknowledges one item; progress tracks; a second acknowledge is a no-op', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const item = detail.body.responsibilities.find((entry) => entry.code === 'brand_standards');

      const acknowledged = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/responsibilities/${item.id}/acknowledge`)
        .set('x-test-user', applicant)
        .expect(200);
      const updated = acknowledged.body.responsibilities.find((entry) => entry.id === item.id);
      expect(updated.status).toBe('acknowledged');
      expect(updated.acknowledged_by).toBe(applicant);
      expect(updated.acknowledged_at).toBeTruthy();
      expect(acknowledged.body.responsibilities.filter((entry) => entry.status === 'acknowledged')).toHaveLength(1);

      const bundle = await adminBundle(admin, applicationId).expect(200);
      expect(bundle.body.application.responsibility_acknowledged).toBe(1);
      expect(bundle.body.responsibilities.find((entry) => entry.id === item.id).status).toBe('acknowledged');

      // Idempotent: acknowledging again changes nothing and logs nothing new.
      const again = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/responsibilities/${item.id}/acknowledge`)
        .set('x-test-user', applicant)
        .expect(200);
      expect(again.body.responsibilities.filter((entry) => entry.status === 'acknowledged')).toHaveLength(1);
      const { rows } = await db.query(
        "SELECT COUNT(*)::int AS n FROM franchise_activity_log WHERE application_id = $1 AND event_type = 'responsibility_acknowledged'",
        [applicationId],
      );
      expect(rows[0].n).toBe(1);
    });

    test('a stranger gets 404, an unknown item gets 404, unauthenticated gets 401', async () => {
      const applicant = await addUser();
      const stranger = await addUser();
      const applicationId = await makeApplication(applicant);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const item = detail.body.responsibilities[0];

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/responsibilities/${item.id}/acknowledge`)
        .set('x-test-user', stranger)
        .expect(404);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/responsibilities/${randomUUID()}/acknowledge`)
        .set('x-test-user', applicant)
        .expect(404);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/responsibilities/${item.id}/acknowledge`)
        .expect(401);
      // The stranger's attempt acknowledged nothing.
      const after = await applicantDetail(applicant, applicationId).expect(200);
      expect(after.body.responsibilities.filter((entry) => entry.status === 'acknowledged')).toHaveLength(0);
    });
  });
});
