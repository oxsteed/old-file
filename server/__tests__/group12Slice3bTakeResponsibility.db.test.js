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
  describe('606: territory acceptance', () => {
    // The territory-stats/helpers routes sit behind the franchise
    // capability gate (enforce by default). The grant path is covered by
    // franchiseRouteAccess.test.js; here the gate is off so the acceptance
    // lock itself is exercised.
    beforeAll(() => {
      process.env.ACCESS_FRANCHISE_ENFORCEMENT = 'off';
    });

    function answerOffer(userId, applicationId, body) {
      return request(app)
        .post(`/api/franchise/my-applications/${applicationId}/acceptance`)
        .set('x-test-user', userId)
        .send(body);
    }

    async function offerToOperator(applicationId, adminId, operatorId) {
      const offered = await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', adminId)
        .send({ owner_user_id: operatorId })
        .expect(200);
      expect(offered.body.application.acceptance_status).toBe('offered');
      return offered;
    }

    test('admin reassignment offers the territory; the operator accepts; a second answer is a 409', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);
      // The public lead form leaves applicant_user_id NULL; link the
      // applicant's account so the applicant-vs-operator distinction below
      // is the one the handler enforces (owner-only answers).
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant, applicationId]);
      await offerToOperator(applicationId, admin, operator);

      // The applicant record alone is not the operator: only the assigned
      // operator may answer.
      const applicantAnswer = await answerOffer(applicant, applicationId, { decision: 'accepted' });
      expect(applicantAnswer.status).toBe(403);
      expect(applicantAnswer.body.code).toBe('acceptance_operator_only');

      const accepted = await answerOffer(operator, applicationId, { decision: 'accepted' }).expect(200);
      expect(accepted.body.application.acceptance_status).toBe('accepted');
      expect(accepted.body.application.acceptance_decided_at).toBeTruthy();

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.application.acceptance_status).toBe('accepted');
      expect(detail.body.application.is_operator).toBe(true);

      const again = await answerOffer(operator, applicationId, { decision: 'accepted' });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('acceptance_not_offered');

      const { rows } = await db.query(
        "SELECT event_type FROM franchise_activity_log WHERE application_id = $1 AND event_type LIKE 'territory_%' ORDER BY created_at ASC",
        [applicationId],
      );
      expect(rows.map((row) => row.event_type)).toEqual(['territory_offered', 'territory_accepted']);
    });

    test('decline needs a reason; the reason returns to HQ and a reassignment re-offers', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const secondOperator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);
      await offerToOperator(applicationId, admin, operator);

      const noReason = await answerOffer(operator, applicationId, { decision: 'declined' });
      expect(noReason.status).toBe(400);
      expect(noReason.body.code).toBe('acceptance_reason_required');

      const declined = await answerOffer(operator, applicationId, {
        decision: 'declined',
        reason: 'Cannot staff this region before Q3.',
      }).expect(200);
      expect(declined.body.application.acceptance_status).toBe('declined');
      expect(declined.body.application.acceptance_reason).toBe('Cannot staff this region before Q3.');

      const bundle = await adminBundle(admin, applicationId).expect(200);
      expect(bundle.body.application.acceptance_status).toBe('declined');
      expect(bundle.body.application.acceptance_reason).toBe('Cannot staff this region before Q3.');

      // HQ reassigns: the new operator gets a fresh offer.
      await offerToOperator(applicationId, admin, secondOperator);
      const accepted = await answerOffer(secondOperator, applicationId, { decision: 'accepted' }).expect(200);
      expect(accepted.body.application.acceptance_status).toBe('accepted');
      expect(accepted.body.application.acceptance_reason).toBeNull();
    });

    test('approving with an owner offers the territory; answering with no offer is a 409; strangers get 404', async () => {
      const applicant = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      // No offer yet: the applicant cannot answer anything.
      const tooEarly = await answerOffer(applicant, applicationId, { decision: 'accepted' });
      expect(tooEarly.status).toBe(409);
      expect(tooEarly.body.code).toBe('acceptance_not_offered');

      const approved = await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin)
        .send({ status: 'approved' })
        .expect(200);
      expect(approved.body.application.acceptance_status).toBe('offered');

      await answerOffer(stranger, applicationId, { decision: 'accepted' }).expect(404);
      const badDecision = await answerOffer(applicant, applicationId, { decision: 'maybe' });
      expect(badDecision.status).toBe(400);
      expect(badDecision.body.code).toBe('invalid_acceptance_decision');

      const accepted = await answerOffer(applicant, applicationId, { decision: 'accepted' }).expect(200);
      expect(accepted.body.application.acceptance_status).toBe('accepted');
    });

    test('the operator surface stays locked while offered and unlocks after accept', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);
      await offerToOperator(applicationId, admin, operator);
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin)
        .send({ status: 'approved' })
        .expect(200);

      const lockedStats = await request(app)
        .get('/api/franchise/territory-stats')
        .set('x-test-user', operator)
        .expect(200);
      expect(lockedStats.body.has_territory).toBe(false);
      expect(lockedStats.body.acceptance_status).toBe('offered');

      const lockedHelpers = await request(app)
        .get('/api/franchise/territory-helpers')
        .set('x-test-user', operator)
        .expect(200);
      expect(lockedHelpers.body.helpers).toEqual([]);
      expect(lockedHelpers.body.acceptance_status).toBe('offered');

      await answerOffer(operator, applicationId, { decision: 'accepted' }).expect(200);

      const openStats = await request(app)
        .get('/api/franchise/territory-stats')
        .set('x-test-user', operator)
        .expect(200);
      expect(openStats.body.has_territory).toBe(true);
      expect(openStats.body.application.id).toBe(applicationId);
    });
  });
});
