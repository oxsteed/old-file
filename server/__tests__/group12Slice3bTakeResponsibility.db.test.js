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

// The mocked send path: A3 assertions read its calls, never the inbox.
const { sendNotification } = require('../services/notificationService');
jest.mock('../growth/emit', () => ({
  emitDomainEvent: jest.fn().mockResolvedValue(undefined),
  commerceEventProps: (value) => value,
}));

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 12 Slice 3b: Take responsibility (608, 606, 607, 609, 610)', () => {
  let db;
  let app;

  beforeEach(() => { sendNotification.mockClear(); });

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
    // Group 12 Slice A (G12-A2 / S-E4, D-643): intake is authenticated-only,
    // so the row is created owned by the applicant at creation.
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

    test('a non-operator applicant gets 403 on acknowledge; the assigned operator succeeds', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);
      // HQ assigns a different operator, so the applicant of record is no
      // longer the operator (G12-A4, D-646).
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin)
        .send({ owner_user_id: operator })
        .expect(200);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const item = detail.body.responsibilities[0];

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/responsibilities/${item.id}/acknowledge`)
        .set('x-test-user', applicant)
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));
      const stillPending = await applicantDetail(applicant, applicationId).expect(200);
      expect(stillPending.body.responsibilities.filter((entry) => entry.status === 'acknowledged')).toHaveLength(0);

      const acknowledged = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/responsibilities/${item.id}/acknowledge`)
        .set('x-test-user', operator)
        .expect(200);
      expect(acknowledged.body.responsibilities.find((entry) => entry.id === item.id).status).toBe('acknowledged');
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
      // Intake is authenticated-only (D-643), so the row is already owned
      // by the applicant; the applicant-vs-operator distinction below is
      // the one the handler enforces (owner-only answers).
      await offerToOperator(applicationId, admin, operator);

      // G12-A3 (D-644): the new operator is notified of the territory offer.
      expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: operator,
        type: 'franchise_territory_offered',
      }));

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
  describe('607: assignment boundary summary', () => {
    function addArea(adminId, applicationId, body) {
      return request(app)
        .post(`/api/franchise/applications/${applicationId}/areas`)
        .set('x-test-user', adminId)
        .send(body);
    }

    test('a new application seeds one included area from its territory fields; exclusivity defaults to false', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      expect(detail.body.territory_areas).toHaveLength(1);
      const seeded = detail.body.territory_areas[0];
      expect(seeded.country).toBe('US');
      expect(seeded.region).toBe('Texas');
      expect(seeded.city).toBe('Austin');
      expect(seeded.area_type).toBe('included');
      expect(detail.body.application.territory_exclusive).toBe(false);

      const bundle = await adminBundle(admin, applicationId).expect(200);
      expect(bundle.body.territory_areas).toHaveLength(1);
      expect(bundle.body.agreement.territory_exclusive).toBe(false);
    });

    test('HQ adds included and excluded areas; the operator sees them read-only; exclusivity surfaces from the agreement', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const added = await addArea(admin, applicationId, { country: 'US', region: 'Texas', city: 'Dallas', area_type: 'included' }).expect(201);
      expect(added.body.territory_areas).toHaveLength(2);
      const excluded = await addArea(admin, applicationId, { country: 'US', region: 'Texas', city: 'Houston', area_type: 'excluded' }).expect(201);
      expect(excluded.body.territory_areas).toHaveLength(3);
      expect(excluded.body.territory_areas.filter((area) => area.area_type === 'excluded')).toHaveLength(1);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      expect(detail.body.territory_areas.filter((area) => area.area_type === 'included')).toHaveLength(2);
      expect(detail.body.territory_areas.find((area) => area.city === 'Houston').area_type).toBe('excluded');

      // Exclusivity is the agreement flag, surfaced to the operator.
      const agreement = await request(app)
        .put(`/api/franchise/applications/${applicationId}/agreement`)
        .set('x-test-user', admin)
        .send({ territory_exclusive: true })
        .expect(200);
      expect(agreement.body.agreement.territory_exclusive).toBe(true);
      const exclusiveDetail = await applicantDetail(applicant, applicationId).expect(200);
      expect(exclusiveDetail.body.application.territory_exclusive).toBe(true);
    });

    test('HQ removes areas, but never the last included one; bad input and non-admins are refused', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const added = await addArea(admin, applicationId, { country: 'US', region: 'Texas', city: 'Houston', area_type: 'excluded' }).expect(201);
      const houston = added.body.territory_areas.find((area) => area.city === 'Houston');
      const austin = added.body.territory_areas.find((area) => area.city === 'Austin');

      const removed = await request(app)
        .delete(`/api/franchise/applications/${applicationId}/areas/${houston.id}`)
        .set('x-test-user', admin)
        .expect(200);
      expect(removed.body.territory_areas).toHaveLength(1);

      const lastIncluded = await request(app)
        .delete(`/api/franchise/applications/${applicationId}/areas/${austin.id}`)
        .set('x-test-user', admin);
      expect(lastIncluded.status).toBe(409);
      expect(lastIncluded.body.code).toBe('boundary_last_included_area');

      await request(app)
        .delete(`/api/franchise/applications/${applicationId}/areas/${randomUUID()}`)
        .set('x-test-user', admin)
        .expect(404);
      await addArea(admin, applicationId, { country: 'XX', city: 'Nowhere' }).expect(400);
      await addArea(admin, applicationId, { country: 'US', city: 'Dallas', area_type: 'partial' }).expect(400);
      await addArea(applicant, applicationId, { country: 'US', city: 'Dallas' }).expect(403);
      await request(app)
        .delete(`/api/franchise/applications/${applicationId}/areas/${austin.id}`)
        .set('x-test-user', applicant)
        .expect(403);

      // The refused deletes changed nothing.
      const after = await applicantDetail(applicant, applicationId).expect(200);
      expect(after.body.territory_areas).toHaveLength(1);
      expect(after.body.territory_areas[0].city).toBe('Austin');
    });
  });

  describe('609: territory launch plan', () => {
    const EXPECTED_CODES = [
      'confirm_boundary',
      'complete_training',
      'secure_location',
      'recruit_team',
      'confirm_opening_date',
    ];

    test('a new application seeds the five default steps, pending, with owners and no milestone link yet', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      expect(detail.body.launch_plan_steps).toHaveLength(5);
      expect(detail.body.launch_plan_steps.map((step) => step.code)).toEqual(EXPECTED_CODES);
      expect(detail.body.launch_plan_steps.every((step) => step.status === 'pending')).toBe(true);
      expect(detail.body.launch_plan_steps.every((step) => step.milestone_id === null)).toBe(true);
      expect(detail.body.launch_plan_steps.find((step) => step.code === 'confirm_opening_date').owner_role).toBe('shared');
      expect(detail.body.launch_plan_steps.find((step) => step.code === 'secure_location').owner_role).toBe('operator');

      const bundle = await adminBundle(admin, applicationId).expect(200);
      expect(bundle.body.launch_plan_steps).toHaveLength(5);
    });

    test('HQ adds, edits, and removes steps; bad input and non-admins are refused', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const added = await request(app)
        .post(`/api/franchise/applications/${applicationId}/launch-plan`)
        .set('x-test-user', admin)
        .send({ title: 'Open the first store', description: 'First store opening.', due_date: '2026-12-01', owner_role: 'hq' })
        .expect(201);
      expect(added.body.launch_plan_steps).toHaveLength(6);
      const custom = added.body.launch_plan_steps.find((step) => step.title === 'Open the first store');
      expect(custom.code).toBeNull();
      // pg returns DATE columns as ISO timestamps; the date part is the contract.
      expect(String(custom.due_date).slice(0, 10)).toBe('2026-12-01');
      expect(custom.owner_role).toBe('hq');
      expect(custom.milestone_id).toBeNull();

      const updated = await request(app)
        .patch(`/api/franchise/applications/${applicationId}/launch-plan/${custom.id}`)
        .set('x-test-user', admin)
        .send({ status: 'in_progress', due_date: '2026-12-15' })
        .expect(200);
      const edited = updated.body.launch_plan_steps.find((step) => step.id === custom.id);
      expect(edited.status).toBe('in_progress');
      expect(String(edited.due_date).slice(0, 10)).toBe('2026-12-15');

      const removed = await request(app)
        .delete(`/api/franchise/applications/${applicationId}/launch-plan/${custom.id}`)
        .set('x-test-user', admin)
        .expect(200);
      expect(removed.body.launch_plan_steps).toHaveLength(5);

      await request(app)
        .post(`/api/franchise/applications/${applicationId}/launch-plan`)
        .set('x-test-user', admin)
        .send({ description: 'No title.' })
        .expect(400);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/launch-plan`)
        .set('x-test-user', admin)
        .send({ title: 'Bad owner', owner_role: 'vendor' })
        .expect(400);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/launch-plan`)
        .set('x-test-user', admin)
        .send({ title: 'Bad date', due_date: '15/12/2026' })
        .expect(400);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/launch-plan`)
        .set('x-test-user', applicant)
        .send({ title: 'Operator adding steps' })
        .expect(403);
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}/launch-plan/${randomUUID()}`)
        .set('x-test-user', admin)
        .send({ status: 'completed' })
        .expect(404);
      const seeded = removed.body.launch_plan_steps[0];
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}/launch-plan/${seeded.id}`)
        .set('x-test-user', admin)
        .send({ status: 'done' })
        .expect(400);
    });

    test('the operator updates step status on their own application; strangers get 404', async () => {
      const applicant = await addUser();
      const stranger = await addUser();
      const applicationId = await makeApplication(applicant);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const step = detail.body.launch_plan_steps.find((entry) => entry.code === 'secure_location');

      const updated = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/launch-plan/${step.id}/status`)
        .set('x-test-user', applicant)
        .send({ status: 'in_progress' })
        .expect(200);
      expect(updated.body.launch_plan_steps.find((entry) => entry.id === step.id).status).toBe('in_progress');

      const completed = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/launch-plan/${step.id}/status`)
        .set('x-test-user', applicant)
        .send({ status: 'completed' })
        .expect(200);
      expect(completed.body.launch_plan_steps.find((entry) => entry.id === step.id).status).toBe('completed');

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/launch-plan/${step.id}/status`)
        .set('x-test-user', stranger)
        .send({ status: 'pending' })
        .expect(404);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/launch-plan/${step.id}/status`)
        .set('x-test-user', applicant)
        .send({ status: 'done' })
        .expect(400);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/launch-plan/${randomUUID()}/status`)
        .set('x-test-user', applicant)
        .send({ status: 'pending' })
        .expect(404);

      const { rows } = await db.query(
        "SELECT event_type FROM franchise_activity_log WHERE application_id = $1 AND event_type = 'launch_plan_step_updated' ORDER BY created_at ASC",
        [applicationId],
      );
      expect(rows).toHaveLength(2);
    });

    test('a non-operator applicant gets 403 on step status; the assigned operator succeeds', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin)
        .send({ owner_user_id: operator })
        .expect(200);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const step = detail.body.launch_plan_steps.find((entry) => entry.code === 'secure_location');

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/launch-plan/${step.id}/status`)
        .set('x-test-user', applicant)
        .send({ status: 'completed' })
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));
      const stillPending = await applicantDetail(applicant, applicationId).expect(200);
      expect(stillPending.body.launch_plan_steps.find((entry) => entry.id === step.id).status).toBe('pending');

      const updated = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/launch-plan/${step.id}/status`)
        .set('x-test-user', operator)
        .send({ status: 'completed' })
        .expect(200);
      expect(updated.body.launch_plan_steps.find((entry) => entry.id === step.id).status).toBe('completed');
    });
  });

  describe('610: operator-facing assignment history', () => {
    test('the operator sees their own application events, newest first, without metadata or actor', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      expect(detail.body.activity).toBeDefined();
      expect(detail.body.activity.length).toBeGreaterThanOrEqual(1);
      // Newest first: the owner-linking PATCH is the newest event, the
      // creation event is the oldest.
      expect(detail.body.activity[detail.body.activity.length - 1].event_type).toBe('application_created');
      expect(detail.body.activity[0]).not.toHaveProperty('metadata');
      expect(detail.body.activity[0]).not.toHaveProperty('actor_id');
      expect(detail.body.activity[0]).not.toHaveProperty('actor_email');

      // A responsibility acknowledgment adds a newer event on top.
      const item = detail.body.responsibilities[0];
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/responsibilities/${item.id}/acknowledge`)
        .set('x-test-user', applicant)
        .expect(200);
      const after = await applicantDetail(applicant, applicationId).expect(200);
      expect(after.body.activity[0].event_type).toBe('responsibility_acknowledged');
      expect(after.body.activity.some((event) => event.event_type === 'application_created')).toBe(true);
      const createdAt = after.body.activity.map((event) => event.created_at);
      expect([...createdAt].sort().reverse()).toEqual(createdAt);
    });

    test('internal notes are hidden from the operator; shared notes still show their arrival', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      await request(app)
        .post(`/api/franchise/applications/${applicationId}/notes`)
        .set('x-test-user', admin)
        .send({ note_text: 'Internal: hold for risk review.', visibility: 'internal' })
        .expect(201);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/notes`)
        .set('x-test-user', admin)
        .send({ note_text: 'Shared: welcome call booked.', visibility: 'shared' })
        .expect(201);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const notes = detail.body.activity.filter((event) => event.event_type === 'note_added');
      expect(notes).toHaveLength(1);
      expect(notes[0].event_summary).not.toContain('risk review');
      expect(notes[0].event_summary).not.toContain('welcome call');

      // HQ still sees both note events in the admin bundle.
      const bundle = await adminBundle(admin, applicationId).expect(200);
      expect(bundle.body.activity.filter((event) => event.event_type === 'note_added')).toHaveLength(2);
    });

    test('a stranger gets 404 and learns nothing about the application history', async () => {
      const applicant = await addUser();
      const stranger = await addUser();
      const applicationId = await makeApplication(applicant);
      await request(app)
        .get(`/api/franchise/my-applications/${applicationId}`)
        .set('x-test-user', stranger)
        .expect(404);
    });
  });

});
