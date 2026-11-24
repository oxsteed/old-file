'use strict';

// Group 12 Slice 3h acceptance: Plan development (636-640).
// Runs against a dedicated fresh database (credit_statement_test_g12h) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 636: candidate location tracker (D-336) — candidate locations inside a
//   territory: the operator proposes (scouting), HQ reviews through
//   scouting -> shortlisted -> approved/rejected, rejected -> scouting
//   reopens. The operator may only submit/withdraw; HQ reviews.
// 637: territory capacity map (D-337) — a structured per-area capacity
//   view (no geographic map): target, open, planned, and candidate
//   locations plus staffing/coverage load per structured boundary area.
// 638: training resource planner (D-338) — who needs what training by
//   when, derived from training assignments, the roster, and Learn.
// 639: launch dependency overview (D-339) — per-location dependencies
//   (agreement, training, staffing, milestones, compliance, readiness,
//   services, exceptions) with blocked/blocking status, derived.
// 640: expansion readiness notes (D-340) — operator-authored readiness
//   notes per territory/location, read by HQ alongside its own admin
//   readiness fields in one view.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP12_SLICE3H_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g12h') {
    throw new Error('Group 12 Slice 3h DB tests require the loopback credit_statement_test_g12h database');
  }
  process.env.DATABASE_URL = 'postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test_g12h';
}
// Uploads land in a scratch dir (as in the 3a/3e fixtures), never in the
// shared local upload dir.
process.env.LOCAL_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'g12h-uploads-'));

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g12h-${id}@example.invalid`,
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

describeDb('Group 12 Slice 3h: Plan development (636-640)', () => {
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
    const email = `g12h-${id}@example.invalid`;
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

  async function addOpeningTeamMember(operator, applicationId, member = null) {
    const helper = member || await addUser();
    await db.query(
      `INSERT INTO helper_profiles (user_id, service_city, service_state, avg_rating, total_reviews, is_available_now)
       VALUES ($1, 'Austin', 'TX', 4.9, 1, TRUE)
       ON CONFLICT (user_id) DO NOTHING`,
      [helper.id],
    );
    await request(app)
      .post(`/api/franchise/my-applications/${applicationId}/opening-team`)
      .set('x-test-user', operator.id)
      .send({ helper_user_id: helper.id, role: 'member' })
      .expect(201);
    return helper;
  }

  describe('636: candidate location tracker', () => {
    function proposeAs(user, applicationId, body, asAdmin = false) {
      const base = asAdmin
        ? `/api/franchise/applications/${applicationId}/candidate-locations`
        : `/api/franchise/my-applications/${applicationId}/candidate-locations`;
      return request(app).post(base).set('x-test-user', user.id).send(body);
    }

    function moveAs(user, applicationId, candidateId, body, asAdmin = false) {
      const base = asAdmin
        ? `/api/franchise/applications/${applicationId}/candidate-locations/${candidateId}`
        : `/api/franchise/my-applications/${applicationId}/candidate-locations/${candidateId}`;
      return request(app).patch(base).set('x-test-user', user.id).send(body);
    }

    function listAs(user, applicationId, query = '', asAdmin = false) {
      const base = asAdmin
        ? `/api/franchise/applications/${applicationId}/candidate-locations${query}`
        : `/api/franchise/my-applications/${applicationId}/candidate-locations${query}`;
      return request(app).get(base).set('x-test-user', user.id);
    }

    test('the operator proposes a candidate: scouting, area derived, rides the bundle and the list', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);

      const created = await proposeAs(operator, applicationId, {
        proposed_name: 'Round Rock storefront',
        city: 'Round Rock',
        region: 'Texas',
        country: 'US',
        notes: 'High foot traffic near the outlet mall',
      }).expect(201);
      expect(created.body.candidate_location.status).toBe('scouting');
      expect(created.body.candidate_location.proposed_name).toBe('Round Rock storefront');
      expect(created.body.candidate_location.area).toBe('Round Rock, Texas, US');
      expect(created.body.candidate_location.proposed_by_name).toBeTruthy();
      expect(created.body.candidate_locations.total).toBe(1);
      expect(created.body.candidate_locations.by_status.scouting).toBe(1);

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.candidate_locations.total).toBe(1);
      expect(detail.body.candidate_locations.candidate_locations[0].proposed_name)
        .toBe('Round Rock storefront');

      const list = await listAs(operator, applicationId).expect(200);
      expect(list.body.total).toBe(1);
      const filtered = await listAs(operator, applicationId, '?status=approved').expect(200);
      expect(filtered.body.total).toBe(0);
      await listAs(operator, applicationId, '?status=bogus')
        .expect(400)
        .then((res) => expect(res.body.code).toBe('invalid_candidate_status'));
    });

    test('the operator submits for review, HQ shortlists then approves; the operator cannot approve and a jump is 409', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const created = await proposeAs(operator, applicationId,
        { proposed_name: 'Cedar Park corner', city: 'Cedar Park', country: 'US' }).expect(201);
      const candidateId = created.body.candidate_location.id;

      // scouting -> approved is not a legal jump, even for HQ.
      await moveAs(admin, applicationId, candidateId, { status: 'approved' }, true)
        .expect(409)
        .then((res) => expect(res.body.code).toBe('candidate_transition_invalid'));
      // The operator cannot approve either (and cannot jump).
      await moveAs(operator, applicationId, candidateId, { status: 'approved' })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('candidate_transition_invalid'));
      await moveAs(operator, applicationId, candidateId, { status: 'rejected' })
        .expect(403)
        .then((res) => expect(res.body.code).toBe('candidate_review_hq_only'));

      const submitted = await moveAs(operator, applicationId, candidateId, { status: 'shortlisted' }).expect(200);
      expect(submitted.body.candidate_location.status).toBe('shortlisted');
      const approved = await moveAs(admin, applicationId, candidateId, { status: 'approved' }, true).expect(200);
      expect(approved.body.candidate_location.status).toBe('approved');
      expect(approved.body.candidate_location.reviewed_by_name).toBeTruthy();
      expect(approved.body.candidate_location.reviewed_at).toBeTruthy();

      // Approved is terminal.
      await moveAs(admin, applicationId, candidateId, { status: 'scouting' }, true)
        .expect(409)
        .then((res) => expect(res.body.code).toBe('candidate_transition_invalid'));
      // Approval does not create an open location (promotion stays the
      // HQ add-location step, D-336).
      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.locations).toHaveLength(1);
      expect(detail.body.candidate_locations.by_status.approved).toBe(1);
    });

    test('HQ rejects, the candidate reopens to scouting; edits and deletes lock once shortlisted', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const created = await proposeAs(operator, applicationId,
        { proposed_name: 'Pflugerville unit', city: 'Pflugerville', country: 'US' }).expect(201);
      const candidateId = created.body.candidate_location.id;

      const rejected = await moveAs(admin, applicationId, candidateId, { status: 'rejected' }, true).expect(200);
      expect(rejected.body.candidate_location.status).toBe('rejected');
      const reopened = await moveAs(admin, applicationId, candidateId, { status: 'scouting' }, true).expect(200);
      expect(reopened.body.candidate_location.status).toBe('scouting');

      // The operator may edit and delete while scouting.
      const edited = await moveAs(operator, applicationId, candidateId, { notes: 'Revised foot-traffic note' }).expect(200);
      expect(edited.body.candidate_location.notes).toBe('Revised foot-traffic note');
      await moveAs(operator, applicationId, candidateId, { status: 'shortlisted' }).expect(200);

      // Shortlisted: the operator can no longer edit or delete.
      await moveAs(operator, applicationId, candidateId, { notes: 'Too late' })
        .expect(403)
        .then((res) => expect(res.body.code).toBe('candidate_edit_locked'));
      await request(app)
        .delete(`/api/franchise/my-applications/${applicationId}/candidate-locations/${candidateId}`)
        .set('x-test-user', operator.id)
        .expect(403)
        .then((res) => expect(res.body.code).toBe('candidate_delete_locked'));

      // HQ may still delete a shortlisted candidate, and the list empties.
      await request(app)
        .delete(`/api/franchise/applications/${applicationId}/candidate-locations/${candidateId}`)
        .set('x-test-user', admin.id)
        .expect(200)
        .then((res) => expect(res.body.candidate_locations.total).toBe(0));
    });

    test('validation: a name is required, the country must be ISO-2, a foreign candidate is 404', async () => {
      const operator = await addUser();
      const otherOperator = await addUser();
      const applicationId = await makeApplication(operator);
      const otherApplicationId = await makeApplication(otherOperator);

      await proposeAs(operator, applicationId, { city: 'Austin', country: 'US' })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('candidate_name_required'));
      await proposeAs(operator, applicationId, { proposed_name: 'Nowhere', country: 'USA' })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('invalid_candidate_country'));

      const created = await proposeAs(operator, applicationId,
        { proposed_name: 'Georgetown shop', country: 'US' }).expect(201);
      const candidateId = created.body.candidate_location.id;
      await moveAs(otherOperator, otherApplicationId, candidateId, { status: 'shortlisted' })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('candidate_not_found'));
      await moveAs(operator, applicationId, '00000000-0000-0000-0000-000000000000', { status: 'shortlisted' })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('candidate_not_found'));

      const list = await listAs(operator, applicationId).expect(200);
      expect(list.body.total).toBe(1);
    });

    test('a stranger gets 404, a non-operator applicant 403, HQ proposes and reads', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant, operator);
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);

      await listAs(stranger, applicationId).expect(404);
      await listAs(applicant, applicationId)
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));
      await proposeAs(applicant, applicationId, { proposed_name: 'Applicant try', country: 'US' })
        .expect(403);

      const created = await proposeAs(admin, applicationId,
        { proposed_name: 'HQ-scouted site', city: 'Austin', country: 'US' }, true).expect(201);
      expect(created.body.candidate_location.status).toBe('scouting');
      const hqList = await listAs(admin, applicationId, '', true).expect(200);
      expect(hqList.body.total).toBe(1);
      const hqBundle = await request(app)
        .get(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(hqBundle.body.candidate_locations.total).toBe(1);
      await listAs(operator, applicationId).expect(200);
      // The operator cannot use the HQ admin read (admin route).
      await listAs(operator, applicationId, '', true).expect(403);
    });
  });

  describe('637: territory capacity map', () => {
    function capacityAs(user, applicationId, asAdmin = false) {
      const base = asAdmin
        ? `/api/franchise/applications/${applicationId}/capacity`
        : `/api/franchise/my-applications/${applicationId}/capacity`;
      return request(app).get(base).set('x-test-user', user.id);
    }

    async function addArea(admin, applicationId, body) {
      const res = await request(app)
        .post(`/api/franchise/applications/${applicationId}/areas`)
        .set('x-test-user', admin.id)
        .send(body)
        .expect(201);
      return res.body.territory_areas || res.body.areas || [];
    }

    test('the seeded area carries the seeded location as planned, with no target and no utilization', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);

      const capacity = await capacityAs(operator, applicationId).expect(200);
      expect(capacity.body.application_id).toBe(applicationId);
      expect(capacity.body.totals.areas).toBe(1);
      expect(capacity.body.totals.target_locations).toBeNull();
      expect(capacity.body.totals.utilization_pct).toBeNull();
      expect(capacity.body.totals.planned_locations).toBe(1);
      expect(capacity.body.totals.open_locations).toBe(0);
      const austin = capacity.body.areas.find((area) => area.city === 'Austin');
      expect(austin).toBeTruthy();
      expect(austin.target_locations).toBeNull();
      expect(austin.utilization_pct).toBeNull();
      expect(austin.planned_locations).toBe(1);
      const unassigned = capacity.body.areas.find((area) => area.area_type === 'unassigned');
      expect(unassigned.planned_locations).toBe(0);

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.territory_capacity.totals.planned_locations).toBe(1);
    });

    test('HQ sets a target per area; utilization follows open plus approved candidates', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const detail = await applicantDetail(operator, applicationId).expect(200);
      const areaId = detail.body.territory_areas[0].id;

      const set = await request(app)
        .post(`/api/franchise/applications/${applicationId}/capacity-targets`)
        .set('x-test-user', admin.id)
        .send({ area_id: areaId, target_locations: 4 })
        .expect(200);
      expect(set.body.capacity_target.target_locations).toBe(4);
      expect(set.body.territory_capacity.totals.target_locations).toBe(4);
      expect(set.body.territory_capacity.totals.utilization_pct).toBe(0);

      // An approved candidate in the same city counts toward utilization.
      const created = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/candidate-locations`)
        .set('x-test-user', operator.id)
        .send({ proposed_name: 'Austin second site', city: 'Austin', country: 'US' })
        .expect(201);
      const candidateId = created.body.candidate_location.id;
      await request(app)
        .patch(`/api/franchise/my-applications/${applicationId}/candidate-locations/${candidateId}`)
        .set('x-test-user', operator.id)
        .send({ status: 'shortlisted' })
        .expect(200);
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}/candidate-locations/${candidateId}`)
        .set('x-test-user', admin.id)
        .send({ status: 'approved' })
        .expect(200);

      let capacity = await capacityAs(operator, applicationId).expect(200);
      const austin = capacity.body.areas.find((area) => area.city === 'Austin');
      expect(austin.candidates.approved).toBe(1);
      expect(austin.utilization_pct).toBe(25);
      expect(capacity.body.totals.utilization_pct).toBe(25);

      // Re-setting the target replaces it (upsert).
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/capacity-targets`)
        .set('x-test-user', admin.id)
        .send({ area_id: areaId, target_locations: 2 })
        .expect(200);
      capacity = await capacityAs(operator, applicationId).expect(200);
      expect(capacity.body.totals.utilization_pct).toBe(50);

      // The operator cannot set a target (admin route).
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/capacity-targets`)
        .set('x-test-user', operator.id)
        .send({ area_id: areaId, target_locations: 9 })
        .expect(403);
    });

    test('region and country matching, and the unassigned bucket', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);

      // A region-only area (no city) catches other Texas cities by region.
      await addArea(admin, applicationId, { country: 'US', region: 'Texas' });
      // A country-only area catches other countries by country.
      await addArea(admin, applicationId, { country: 'CA' });

      const propose = (name, city, region, country) => request(app)
        .post(`/api/franchise/my-applications/${applicationId}/candidate-locations`)
        .set('x-test-user', operator.id)
        .send({ proposed_name: name, city, region, country });
      await propose('Dallas site', 'Dallas', 'Texas', 'US').expect(201);
      await propose('Toronto site', 'Toronto', 'Ontario', 'CA').expect(201);
      await propose('Lyon site', 'Lyon', 'Auvergne', 'FR').expect(201);

      const capacity = await capacityAs(operator, applicationId).expect(200);
      const byKey = new Map(capacity.body.areas.map((area) => [
        area.area_id ? `${area.city || ''}|${area.region || ''}|${area.country || ''}` : 'unassigned', area,
      ]));
      expect(byKey.get('Dallas|Texas|US')).toBeUndefined();
      const texasRegion = capacity.body.areas.find((area) => !area.city && area.region === 'Texas');
      expect(texasRegion.candidates.total).toBe(1);
      const canada = capacity.body.areas.find((area) => !area.city && !area.region && area.country === 'CA');
      expect(canada.candidates.total).toBe(1);
      const unassigned = capacity.body.areas.find((area) => area.area_type === 'unassigned');
      expect(unassigned.candidates.total).toBe(1);
      expect(capacity.body.totals.candidates.total).toBe(3);
    });

    test('staffing and exception load ride the matched area', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const locationId = await locationIdFor(operator, applicationId);
      const member = await addOpeningTeamMember(operator, applicationId);
      await db.query(
        `INSERT INTO franchise_opening_team_members (application_id, location_id, helper_user_id, role)
         VALUES ($1, $2, $3, 'member')`,
        [applicationId, locationId, member.id],
      );
      await db.query(
        `INSERT INTO support_tickets
           (user_id, name, email, subject, category, priority, status, source,
            franchise_application_id, franchise_location_id)
         VALUES ($1, $2, $3, 'Oven down', 'general', 'normal', 'open', 'widget', $4, $5)`,
        [operator.id, 'Franchise Fixture', operator.email, applicationId, locationId],
      );

      const capacity = await capacityAs(operator, applicationId).expect(200);
      const austin = capacity.body.areas.find((area) => area.city === 'Austin');
      expect(austin.team_members).toBe(1);
      expect(austin.open_exceptions).toBe(1);
      expect(capacity.body.totals.team_members).toBe(2);
      expect(capacity.body.totals.open_exceptions).toBe(1);
    });

    test('target validation and scoping: bad targets 400, foreign areas 404, stranger 404, applicant 403', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant, operator);
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);
      const detail = await applicantDetail(operator, applicationId).expect(200);
      const areaId = detail.body.territory_areas[0].id;

      await request(app)
        .post(`/api/franchise/applications/${applicationId}/capacity-targets`)
        .set('x-test-user', admin.id)
        .send({ area_id: areaId, target_locations: 0 })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('invalid_capacity_target'));
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/capacity-targets`)
        .set('x-test-user', admin.id)
        .send({ area_id: areaId, target_locations: 2.5 })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('invalid_capacity_target'));
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/capacity-targets`)
        .set('x-test-user', admin.id)
        .send({ area_id: '00000000-0000-0000-0000-000000000000', target_locations: 3 })
        .expect(404)
        .then((res) => expect(res.body.code).toBe('area_not_found'));

      await capacityAs(stranger, applicationId).expect(404);
      await capacityAs(applicant, applicationId)
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));
      const hq = await capacityAs(admin, applicationId, true).expect(200);
      expect(hq.body.totals.planned_locations).toBe(1);
      await capacityAs(operator, applicationId, true).expect(403);
    });
  });

  describe('638: training resource planner', () => {
    function plannerAs(user, applicationId, asAdmin = false) {
      const base = asAdmin
        ? `/api/franchise/applications/${applicationId}/training-planner`
        : `/api/franchise/my-applications/${applicationId}/training-planner`;
      return request(app).get(base).set('x-test-user', user.id);
    }

    function assignAs(user, applicationId, body) {
      return request(app)
        .post(`/api/franchise/my-applications/${applicationId}/training`)
        .set('x-test-user', user.id)
        .send(body);
    }

    test('with no assignments the planner names the gap: every member has no training', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const member = await addOpeningTeamMember(operator, applicationId);
      const locationId = await locationIdFor(operator, applicationId);
      await db.query(
        `INSERT INTO franchise_opening_team_members (application_id, location_id, helper_user_id, role)
         VALUES ($1, $2, $3, 'member')`,
        [applicationId, locationId, member.id],
      );

      const planner = await plannerAs(operator, applicationId).expect(200);
      expect(planner.body.totals.members).toBe(2);
      expect(planner.body.totals.assignments).toBe(0);
      expect(planner.body.totals.completion_pct).toBeNull();
      expect(planner.body.totals.members_without_training).toBe(2);
      expect(planner.body.members.every((m) => m.has_no_training)).toBe(true);
      expect(planner.body.gaps.filter((g) => g.kind === 'no_training')).toHaveLength(2);
      expect(planner.body.locations).toHaveLength(1);
      expect(planner.body.locations[0].completion_pct).toBeNull();
      expect(planner.body.locations[0].members_without_training).toHaveLength(1);

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.training_planner.totals.members).toBe(2);
    });

    test('assignments land on the member, the location, and the module row with due dates', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const member = await addOpeningTeamMember(operator, applicationId);
      const locationId = await locationIdFor(operator, applicationId);

      const assigned = await assignAs(operator, applicationId, {
        assignee_user_id: member.id,
        location_id: locationId,
        module_title: 'Food Safety Basics',
        category: 'food_safety',
        due_date: '2026-12-20',
      }).expect(201);
      expect(assigned.body.training_assignment || assigned.body.assignment || assigned.body).toBeTruthy();

      const planner = await plannerAs(operator, applicationId).expect(200);
      expect(planner.body.totals.assignments).toBe(1);
      expect(planner.body.totals.completion_pct).toBe(0);
      const memberPlan = planner.body.members.find((m) => m.user_id === member.id);
      expect(memberPlan.assigned).toBe(1);
      expect(memberPlan.next_due_date).toBe('2026-12-20');
      expect(memberPlan.has_no_training).toBe(false);
      const locationPlan = planner.body.locations[0];
      expect(locationPlan.assignments.total).toBe(1);
      expect(locationPlan.completion_pct).toBe(0);
      expect(locationPlan.modules).toContain('Food Safety Basics');
      expect(locationPlan.members_without_training).toHaveLength(0);
      const moduleRow = planner.body.modules.find((m) => m.module_title === 'Food Safety Basics');
      expect(moduleRow.assigned).toBe(1);
      expect(moduleRow.coverage_pct).toBe(0);
      expect(moduleRow.category).toBe('food_safety');
    });

    test('completing an assignment covers it; a past-due assignment is an overdue gap', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const member = await addOpeningTeamMember(operator, applicationId);
      const locationId = await locationIdFor(operator, applicationId);

      const first = await assignAs(operator, applicationId, {
        assignee_user_id: member.id,
        location_id: locationId,
        module_title: 'Food Safety Basics',
        category: 'food_safety',
        due_date: '2026-12-20',
      }).expect(201);
      const firstId = (first.body.training_assignment || first.body.assignment
        || first.body.training_assignments?.[0] || {}).id
        || (await db.query(
          `SELECT id FROM franchise_training_assignments WHERE application_id = $1 AND module_title = $2`,
          [applicationId, 'Food Safety Basics'])).rows[0].id;
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/training/${firstId}/complete`)
        .set('x-test-user', member.id)
        .expect(200);

      await assignAs(operator, applicationId, {
        assignee_user_id: member.id,
        location_id: locationId,
        module_title: 'Kitchen Cleaning',
        category: 'cleaning',
        due_date: '2020-01-15',
      }).expect(201);

      const planner = await plannerAs(operator, applicationId).expect(200);
      expect(planner.body.totals.assignments).toBe(2);
      expect(planner.body.totals.completed).toBe(1);
      expect(planner.body.totals.completion_pct).toBe(50);
      expect(planner.body.totals.overdue).toBe(1);
      const memberPlan = planner.body.members.find((m) => m.user_id === member.id);
      expect(memberPlan.completed).toBe(1);
      expect(memberPlan.overdue).toBe(1);
      expect(planner.body.gaps.filter((g) => g.kind === 'overdue')).toHaveLength(1);
      expect(planner.body.gaps.find((g) => g.kind === 'overdue').detail).toContain('Kitchen Cleaning');
      const moduleRow = planner.body.modules.find((m) => m.module_title === 'Food Safety Basics');
      expect(moduleRow.coverage_pct).toBe(100);
    });

    test('an active Learn program in the assignment category links onto the module row', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const member = await addOpeningTeamMember(operator, applicationId);
      await db.query(
        `INSERT INTO learn_programs (slug, category, is_active) VALUES ('food-safety-101', 'food_safety', TRUE)
         ON CONFLICT (slug) DO UPDATE SET is_active = TRUE`,
      );
      await assignAs(operator, applicationId, {
        assignee_user_id: member.id,
        module_title: 'Food Safety Basics',
        category: 'food_safety',
        due_date: '2026-12-20',
      }).expect(201);

      const planner = await plannerAs(operator, applicationId).expect(200);
      const moduleRow = planner.body.modules.find((m) => m.module_title === 'Food Safety Basics');
      expect(moduleRow.learn_programs).toContain('food-safety-101');
      expect(planner.body.learn_programs.map((p) => p.slug)).toContain('food-safety-101');
    });

    test('a stranger gets 404, a non-operator applicant 403, HQ reads the planner', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant, operator);
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);

      await plannerAs(stranger, applicationId).expect(404);
      await plannerAs(applicant, applicationId)
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));
      const hq = await plannerAs(admin, applicationId, true).expect(200);
      expect(hq.body.totals.members).toBe(1);
      await plannerAs(operator, applicationId, true).expect(403);
    });
  });

  describe('639: launch dependency overview', () => {
    function depsAs(user, applicationId, asAdmin = false) {
      const base = asAdmin
        ? `/api/franchise/applications/${applicationId}/launch-dependencies`
        : `/api/franchise/my-applications/${applicationId}/launch-dependencies`;
      return request(app).get(base).set('x-test-user', user.id);
    }

    function depOf(view, code) {
      return view.dependencies.find((d) => d.code === code);
    }

    test('a fresh territory is blocked on agreement and services, pending on the rest', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);

      const deps = await depsAs(operator, applicationId).expect(200);
      expect(deps.body.total).toBe(1);
      expect(deps.body.blocked).toBe(1);
      expect(deps.body.ready).toBe(0);
      const [view] = deps.body.locations;
      expect(view.overall).toBe('blocked');
      expect(view.ready_to_launch).toBe(false);
      expect(depOf(view, 'agreement').status).toBe('blocked');
      expect(depOf(view, 'agreement').blocks_launch).toBe(true);
      expect(depOf(view, 'services').status).toBe('blocked');
      expect(depOf(view, 'milestones').status).toBe('pending');
      expect(depOf(view, 'training').status).toBe('pending');
      expect(depOf(view, 'staffing').status).toBe('pending');
      expect(depOf(view, 'readiness').status).toBe('pending');
      expect(depOf(view, 'compliance').status).toBe('satisfied');
      expect(depOf(view, 'exceptions').status).toBe('satisfied');
      expect(view.blocked_dependencies).toEqual(expect.arrayContaining(['agreement', 'services']));

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.launch_dependencies.total).toBe(1);
    });

    test('signing the agreement and adding an available service clears the blocks to pending', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const locationId = await locationIdFor(operator, applicationId);
      await db.query("UPDATE franchise_applications SET agreement_status = 'signed' WHERE id = $1", [applicationId]);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${locationId}/services`)
        .set('x-test-user', operator.id)
        .send({ service_name: 'Dine-in', available: true })
        .expect(201);

      const deps = await depsAs(operator, applicationId).expect(200);
      const [view] = deps.body.locations;
      expect(view.overall).toBe('pending');
      expect(view.blocked_dependencies).toHaveLength(0);
      expect(depOf(view, 'agreement').status).toBe('satisfied');
      expect(depOf(view, 'services').status).toBe('satisfied');
      expect(depOf(view, 'services').detail).toContain('1/1');
    });

    test('a blocked milestone blocks the location; completing it clears the block', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const locationId = await locationIdFor(operator, applicationId);
      const created = await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${locationId}/milestones`)
        .set('x-test-user', admin.id)
        .send({ title: 'Fit-out complete', owner_role: 'operator' })
        .expect(201);
      const milestoneId = (created.body.milestones || created.body.locations?.[0]?.milestones || [])
        .find((m) => m.title === 'Fit-out complete')?.id
        || (await db.query(
          `SELECT id FROM franchise_location_milestones WHERE application_id = $1 AND title = $2`,
          [applicationId, 'Fit-out complete'])).rows[0].id;

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${locationId}/milestones/${milestoneId}/status`)
        .set('x-test-user', operator.id)
        .send({ status: 'blocked' })
        .expect(200);
      let deps = await depsAs(operator, applicationId).expect(200);
      expect(deps.body.locations[0].overall).toBe('blocked');
      expect(depOf(deps.body.locations[0], 'milestones').status).toBe('blocked');
      expect(depOf(deps.body.locations[0], 'milestones').detail).toContain('1 milestone(s) blocked');

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${locationId}/milestones/${milestoneId}/status`)
        .set('x-test-user', operator.id)
        .send({ status: 'completed' })
        .expect(200);
      deps = await depsAs(operator, applicationId).expect(200);
      expect(depOf(deps.body.locations[0], 'milestones').status).toBe('satisfied');
      expect(deps.body.locations[0].overall).toBe('blocked');
    });

    test('an open urgent exception blocks; resolving the ticket clears it, and a full pass reads ready', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const locationId = await locationIdFor(operator, applicationId);
      const member = await addOpeningTeamMember(operator, applicationId);
      await db.query("UPDATE franchise_applications SET agreement_status = 'signed' WHERE id = $1", [applicationId]);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${locationId}/services`)
        .set('x-test-user', operator.id)
        .send({ service_name: 'Dine-in', available: true })
        .expect(201);
      const { rows: [ticket] } = await db.query(
        `INSERT INTO support_tickets
           (user_id, name, email, subject, category, priority, status, source,
            franchise_application_id, franchise_location_id)
         VALUES ($1, $2, $3, 'Oven down', 'general', 'urgent', 'open', 'widget', $4, $5)
         RETURNING id`,
        [operator.id, 'Franchise Fixture', operator.email, applicationId, locationId],
      );

      let deps = await depsAs(operator, applicationId).expect(200);
      expect(depOf(deps.body.locations[0], 'exceptions').status).toBe('blocked');
      expect(deps.body.locations[0].overall).toBe('blocked');

      await db.query("UPDATE support_tickets SET status = 'resolved', resolved_at = NOW() WHERE id = $1", [ticket.id]);
      deps = await depsAs(operator, applicationId).expect(200);
      expect(depOf(deps.body.locations[0], 'exceptions').status).toBe('satisfied');

      // Finish the rest: manager, training complete, readiness passed.
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${locationId}/manager`)
        .set('x-test-user', admin.id)
        .send({ manager_user_id: member.id })
        .expect(201);
      await db.query(
        `INSERT INTO franchise_opening_team_members (application_id, location_id, helper_user_id, role)
         VALUES ($1, $2, $3, 'member')`,
        [applicationId, locationId, member.id],
      );
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/training`)
        .set('x-test-user', operator.id)
        .send({ assignee_user_id: member.id, location_id: locationId, module_title: 'Food Safety Basics', category: 'food_safety' })
        .expect(201);
      const { rows: [assignment] } = await db.query(
        `SELECT id FROM franchise_training_assignments WHERE application_id = $1`, [applicationId]);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/training/${assignment.id}/complete`)
        .set('x-test-user', member.id)
        .expect(200);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/readiness-review`)
        .set('x-test-user', admin.id)
        .send({ outcome: 'passed', notes: 'Ready to open.' })
        .expect(201);
      const milestone = await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${locationId}/milestones`)
        .set('x-test-user', admin.id)
        .send({ title: 'Fit-out complete', owner_role: 'operator' })
        .expect(201);
      const milestoneId = (milestone.body.milestones || milestone.body.locations?.[0]?.milestones || [])
        .find((m) => m.title === 'Fit-out complete')?.id
        || (await db.query(
          `SELECT id FROM franchise_location_milestones WHERE application_id = $1 AND title = $2`,
          [applicationId, 'Fit-out complete'])).rows[0].id;
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${locationId}/milestones/${milestoneId}/status`)
        .set('x-test-user', operator.id)
        .send({ status: 'completed' })
        .expect(200);

      deps = await depsAs(operator, applicationId).expect(200);
      const [view] = deps.body.locations;
      expect(view.dependencies.every((d) => d.status === 'satisfied')).toBe(true);
      expect(view.overall).toBe('ready');
      expect(view.ready_to_launch).toBe(true);
      expect(deps.body.ready).toBe(1);
    });

    test('a stranger gets 404, a non-operator applicant 403, HQ reads the overview', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant, operator);
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);

      await depsAs(stranger, applicationId).expect(404);
      await depsAs(applicant, applicationId)
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));
      const hq = await depsAs(admin, applicationId, true).expect(200);
      expect(hq.body.total).toBe(1);
      await depsAs(operator, applicationId, true).expect(403);
    });
  });
});
