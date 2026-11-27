'use strict';

// Group 12 Slice 3c acceptance: Open locations (611-615).
// Runs against a dedicated fresh database (credit_statement_test_g12c) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 611: location launch milestones (D-311) — milestones per location launch
//   (title, due date, status, owner), attached to a franchise location (a
//   business/restaurant location inside the territory, D-298) and linked
//   to the 609 launch-plan steps via the reserved `milestone_id`.
// 612: opening team roster (D-312) — opening-team designation on the
//   territory helper roster, with assignment and roster scoping.
// 613: readiness review (D-313) — HQ sign-off (or request-changes) with
//   actor + timestamp; readiness moves to `ready` only through a passed
//   review, never through a bare admin status set.
// 614: service availability checklist (D-314) — per-location services
//   marked available/unavailable with a reason; a location cannot launch
//   with zero available services.
// 615: opening confirmation (D-315) — the operator confirms the location
//   opened (date + notes, actor + timestamp); the launch is only complete
//   once confirmed, on top of the fail-closed activation gates.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP12_SLICE3C_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g12c') {
    throw new Error('Group 12 Slice 3c DB tests require the loopback credit_statement_test_g12c database');
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
      email: req.get('x-test-email') || `g12c-${id}@example.invalid`,
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

describeDb('Group 12 Slice 3c: Open locations (611-615)', () => {
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
      [id, `g12c-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
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
        email: `g12c-${applicantId}@example.invalid`,
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

  describe('611: location launch milestones', () => {
    test('a new application seeds one location from its territory fields, visible to operator and HQ', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      expect(detail.body.locations).toHaveLength(1);
      const seeded = detail.body.locations[0];
      expect(seeded.name).toBe('Austin location');
      expect(seeded.city).toBe('Austin');
      expect(seeded.region).toBe('Texas');
      expect(seeded.country).toBe('US');
      expect(seeded.status).toBe('planned');
      expect(seeded.milestones).toEqual([]);
      expect(seeded.services).toEqual([]);
      expect(seeded.opening_team).toEqual([]);
      expect(seeded.opening_confirmation).toBeNull();
      expect(seeded.launch_complete).toBe(false);

      const bundle = await adminBundle(admin, applicationId).expect(200);
      expect(bundle.body.locations).toHaveLength(1);
      expect(bundle.body.locations[0].id).toBe(seeded.id);
    });

    test('HQ adds a location; bad input and non-admins are refused', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const added = await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations`)
        .set('x-test-user', admin)
        .send({ name: 'Downtown store', city: 'Dallas', region: 'Texas', country: 'US' })
        .expect(201);
      expect(added.body.locations).toHaveLength(2);
      const downtown = added.body.locations.find((loc) => loc.name === 'Downtown store');
      expect(downtown.city).toBe('Dallas');
      expect(downtown.status).toBe('planned');

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      expect(detail.body.locations).toHaveLength(2);

      await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations`)
        .set('x-test-user', admin)
        .send({ city: 'Houston' })
        .expect(400);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations`)
        .set('x-test-user', admin)
        .send({ name: 'Bad country', country: 'XX' })
        .expect(400);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations`)
        .set('x-test-user', applicant)
        .send({ name: 'Operator adding locations' })
        .expect(403);
      await request(app)
        .post(`/api/franchise/applications/${randomUUID()}/locations`)
        .set('x-test-user', admin)
        .send({ name: 'Nowhere' })
        .expect(404);

      const after = await applicantDetail(applicant, applicationId).expect(200);
      expect(after.body.locations).toHaveLength(2);
    });

    test('HQ adds a milestone linked to a launch plan step; a second milestone on the same step is a 409', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const location = detail.body.locations[0];
      const step = detail.body.launch_plan_steps.find((entry) => entry.code === 'secure_location');

      const added = await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${location.id}/milestones`)
        .set('x-test-user', admin)
        .send({
          title: 'Sign the lease',
          description: 'First store lease signed.',
          due_date: '2026-12-01',
          owner_role: 'operator',
          launch_plan_step_id: step.id,
        })
        .expect(201);
      const withMilestone = added.body.locations.find((entry) => entry.id === location.id);
      expect(withMilestone.milestones).toHaveLength(1);
      const milestone = withMilestone.milestones[0];
      expect(milestone.title).toBe('Sign the lease');
      expect(String(milestone.due_date).slice(0, 10)).toBe('2026-12-01');
      expect(milestone.owner_role).toBe('operator');
      expect(milestone.status).toBe('pending');
      // The plan step now points at the milestone (D-309 reserved column).
      const linkedStep = added.body.launch_plan_steps.find((entry) => entry.id === step.id);
      expect(linkedStep.milestone_id).toBe(milestone.id);

      const operatorDetail = await applicantDetail(applicant, applicationId).expect(200);
      expect(operatorDetail.body.locations[0].milestones).toHaveLength(1);

      const second = await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${location.id}/milestones`)
        .set('x-test-user', admin)
        .send({ title: 'Another milestone for the same step', launch_plan_step_id: step.id });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('launch_plan_step_milestone_linked');

      await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${location.id}/milestones`)
        .set('x-test-user', admin)
        .send({ title: 'Unknown step', launch_plan_step_id: randomUUID() })
        .expect(404);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${location.id}/milestones`)
        .set('x-test-user', admin)
        .send({ title: 'Bad date', due_date: '01/12/2026' })
        .expect(400);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${location.id}/milestones`)
        .set('x-test-user', admin)
        .send({ description: 'No title.' })
        .expect(400);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${randomUUID()}/milestones`)
        .set('x-test-user', admin)
        .send({ title: 'Unknown location' })
        .expect(404);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${location.id}/milestones`)
        .set('x-test-user', applicant)
        .send({ title: 'Operator adding milestones' })
        .expect(403);
    });

    test('HQ edits and removes a milestone; removal clears the plan step link', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const location = detail.body.locations[0];
      const step = detail.body.launch_plan_steps.find((entry) => entry.code === 'recruit_team');
      const added = await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${location.id}/milestones`)
        .set('x-test-user', admin)
        .send({ title: 'Hire the team', due_date: '2026-12-10', launch_plan_step_id: step.id })
        .expect(201);
      const milestone = added.body.locations[0].milestones[0];

      const updated = await request(app)
        .patch(`/api/franchise/applications/${applicationId}/locations/${location.id}/milestones/${milestone.id}`)
        .set('x-test-user', admin)
        .send({ status: 'in_progress', due_date: '2026-12-15', owner_role: 'hq' })
        .expect(200);
      const edited = updated.body.locations[0].milestones[0];
      expect(edited.status).toBe('in_progress');
      expect(String(edited.due_date).slice(0, 10)).toBe('2026-12-15');
      expect(edited.owner_role).toBe('hq');

      await request(app)
        .patch(`/api/franchise/applications/${applicationId}/locations/${location.id}/milestones/${milestone.id}`)
        .set('x-test-user', admin)
        .send({ status: 'done' })
        .expect(400);
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}/locations/${location.id}/milestones/${randomUUID()}`)
        .set('x-test-user', admin)
        .send({ status: 'completed' })
        .expect(404);

      const removed = await request(app)
        .delete(`/api/franchise/applications/${applicationId}/locations/${location.id}/milestones/${milestone.id}`)
        .set('x-test-user', admin)
        .expect(200);
      expect(removed.body.locations[0].milestones).toHaveLength(0);
      // The plan step keeps working standalone — its milestone link is cleared.
      expect(removed.body.launch_plan_steps.find((entry) => entry.id === step.id).milestone_id).toBeNull();

      await request(app)
        .delete(`/api/franchise/applications/${applicationId}/locations/${location.id}/milestones/${milestone.id}`)
        .set('x-test-user', admin)
        .expect(404);
    });

    test('the operator updates milestone status; completing stamps who and when; strangers get 404', async () => {
      const applicant = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const location = detail.body.locations[0];
      const added = await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${location.id}/milestones`)
        .set('x-test-user', admin)
        .send({ title: 'Fit out the store' })
        .expect(201);
      const milestone = added.body.locations[0].milestones[0];

      const updated = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${location.id}/milestones/${milestone.id}/status`)
        .set('x-test-user', applicant)
        .send({ status: 'in_progress' })
        .expect(200);
      expect(updated.body.locations[0].milestones[0].status).toBe('in_progress');

      const completed = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${location.id}/milestones/${milestone.id}/status`)
        .set('x-test-user', applicant)
        .send({ status: 'completed' })
        .expect(200);
      const done = completed.body.locations[0].milestones[0];
      expect(done.status).toBe('completed');
      expect(done.completed_by).toBe(applicant);
      expect(done.completed_at).toBeTruthy();

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${location.id}/milestones/${milestone.id}/status`)
        .set('x-test-user', stranger)
        .send({ status: 'pending' })
        .expect(404);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${location.id}/milestones/${milestone.id}/status`)
        .set('x-test-user', applicant)
        .send({ status: 'done' })
        .expect(400);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${location.id}/milestones/${randomUUID()}/status`)
        .set('x-test-user', applicant)
        .send({ status: 'pending' })
        .expect(404);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${location.id}/milestones/${milestone.id}/status`)
        .expect(401);

      const { rows } = await db.query(
        "SELECT event_type FROM franchise_activity_log WHERE application_id = $1 AND event_type LIKE 'location_milestone_%' ORDER BY created_at ASC",
        [applicationId],
      );
      expect(rows.map((row) => row.event_type)).toEqual([
        'location_milestone_added',
        'location_milestone_updated',
        'location_milestone_updated',
      ]);
    });

    test('a non-operator applicant gets 403 on milestone status; the assigned operator succeeds', async () => {
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
      const location = detail.body.locations[0];
      const added = await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${location.id}/milestones`)
        .set('x-test-user', admin)
        .send({ title: 'Fit out the store' })
        .expect(201);
      const milestone = added.body.locations[0].milestones[0];

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${location.id}/milestones/${milestone.id}/status`)
        .set('x-test-user', applicant)
        .send({ status: 'completed' })
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));
      const stillPending = await applicantDetail(applicant, applicationId).expect(200);
      expect(stillPending.body.locations[0].milestones[0].status).toBe('pending');

      const updated = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${location.id}/milestones/${milestone.id}/status`)
        .set('x-test-user', operator)
        .send({ status: 'completed' })
        .expect(200);
      const done = updated.body.locations[0].milestones[0];
      expect(done.status).toBe('completed');
      expect(done.completed_by).toBe(operator);
    });

    test('milestones are scoped per application: a second application sees none of the first', async () => {
      const first = await addUser();
      const second = await addUser();
      const admin = await addUser('super_admin');
      const firstId = await makeApplication(first);
      const secondId = await makeApplication(second);

      const firstDetail = await applicantDetail(first, firstId).expect(200);
      const location = firstDetail.body.locations[0];
      await request(app)
        .post(`/api/franchise/applications/${firstId}/locations/${location.id}/milestones`)
        .set('x-test-user', admin)
        .send({ title: 'First territory milestone' })
        .expect(201);

      // The second operator's detail carries only their own location, empty.
      const secondDetail = await applicantDetail(second, secondId).expect(200);
      expect(secondDetail.body.locations).toHaveLength(1);
      expect(secondDetail.body.locations[0].milestones).toEqual([]);
      // And the first application's milestone id is not addressable
      // through the second application.
      const firstBundle = await adminBundle(admin, firstId).expect(200);
      const milestoneId = firstBundle.body.locations[0].milestones[0].id;
      await request(app)
        .post(`/api/franchise/my-applications/${secondId}/locations/${secondDetail.body.locations[0].id}/milestones/${milestoneId}/status`)
        .set('x-test-user', second)
        .send({ status: 'completed' })
        .expect(404);
    });
  });

  describe('612: opening team roster', () => {
    // The territory endpoints sit behind the franchise capability gate
    // (enforce by default). The gate is off here so the roster scoping
    // itself is exercised, as in the 606 suite.
    // The roster is a top-50 list ordered by rating, then reviews, so a
    // helper only shows when it outranks the rows this shared slice DB
    // accumulated from earlier runs. Each run starts its review counts
    // above the previous maximum, so this run's helpers always sort in.
    let helperSeq = 0;
    beforeAll(async () => {
      process.env.ACCESS_FRANCHISE_ENFORCEMENT = 'off';
      const { rows } = await db.query('SELECT COALESCE(MAX(total_reviews), 0) AS m FROM helper_profiles');
      helperSeq = Number(rows[0].m) || 0;
    });

    async function addHelper(city = 'Austin', state = 'TX') {
      const id = await addUser();
      await db.query(
        `INSERT INTO helper_profiles (user_id, service_city, service_state, avg_rating, total_reviews, is_available_now)
         VALUES ($1, $2, $3, 4.9, $4, TRUE)`,
        [id, city, state, ++helperSeq],
      );
      return id;
    }

    async function approveAndAccept(applicationId, adminId, operatorId) {
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', adminId)
        .send({ status: 'approved' })
        .expect(200);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/acceptance`)
        .set('x-test-user', operatorId)
        .send({ decision: 'accepted' })
        .expect(200);
    }

    function assignTeam(userId, applicationId, body) {
      return request(app)
        .post(`/api/franchise/my-applications/${applicationId}/opening-team`)
        .set('x-test-user', userId)
        .send(body);
    }

    test('the operator designates a helper for a location launch; the designation shows in the detail, the bundle, and the roster', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant, { desired_region: 'TX' });
      const helper = await addHelper();

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const location = detail.body.locations[0];

      const assigned = await assignTeam(applicant, applicationId, {
        helper_user_id: helper,
        location_id: location.id,
        role: 'lead',
      }).expect(201);
      const team = assigned.body.locations[0].opening_team;
      expect(team).toHaveLength(1);
      expect(team[0].helper_user_id).toBe(helper);
      expect(team[0].role).toBe('lead');
      expect(team[0].helper_email).toBe(`g12c-${helper}@example.invalid`);
      expect(assigned.body.opening_team).toEqual([]);

      const bundle = await adminBundle(admin, applicationId).expect(200);
      expect(bundle.body.locations[0].opening_team).toHaveLength(1);

      await approveAndAccept(applicationId, admin, applicant);
      const roster = await request(app)
        .get('/api/franchise/territory-helpers')
        .set('x-test-user', applicant)
        .expect(200);
      // The roster accumulates helpers from earlier runs in this shared
      // slice DB, so assert on this test's helper row, not the list size.
      const row = roster.body.helpers.find((entry) => entry.user_id === helper);
      expect(row).toBeDefined();
      expect(row.opening_team).toBe(true);
      expect(row.opening_team_role).toBe('lead');
      expect(row.opening_team_location_id).toBe(location.id);
    });

    test('territory-wide designation, duplicates, and validation', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant, { desired_region: 'TX' });
      const helper = await addHelper();
      const noProfile = await addUser();

      const assigned = await assignTeam(applicant, applicationId, { helper_user_id: helper }).expect(201);
      expect(assigned.body.opening_team).toHaveLength(1);
      expect(assigned.body.opening_team[0].role).toBe('member');
      expect(assigned.body.opening_team[0].location_id).toBeNull();

      const duplicate = await assignTeam(applicant, applicationId, { helper_user_id: helper });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.code).toBe('opening_team_already_assigned');

      const unknown = await assignTeam(applicant, applicationId, { helper_user_id: randomUUID() });
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('opening_team_helper_not_found');

      const profileless = await assignTeam(applicant, applicationId, { helper_user_id: noProfile });
      expect(profileless.status).toBe(404);
      expect(profileless.body.code).toBe('opening_team_helper_not_found');

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const location = detail.body.locations[0];
      const badLocation = await assignTeam(applicant, applicationId, { helper_user_id: helper, location_id: randomUUID() });
      expect(badLocation.status).toBe(404);
      const badRole = await assignTeam(applicant, applicationId, { helper_user_id: helper, location_id: location.id, role: 'captain' });
      expect(badRole.status).toBe(400);
      expect(badRole.body.code).toBe('invalid_opening_team_role');
      await assignTeam(applicant, applicationId, {}).expect(400);

      // The refused assignments changed nothing: still one member.
      const after = await applicantDetail(applicant, applicationId).expect(200);
      expect(after.body.opening_team).toHaveLength(1);
    });

    test('the operator removes a member; HQ assigns and removes; strangers and applicant-only callers are refused', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant, { desired_region: 'TX' });
      const helper = await addHelper();

      // Intake is authenticated-only (D-643), so the row is already owned
      // by the applicant; the applicant-vs-operator distinction below is
      // the one the handler enforces.
      // HQ reassigns the territory to a second operator; the original
      // applicant record alone is no longer the operator.
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin)
        .send({ owner_user_id: operator })
        .expect(200);

      const applicantOnly = await assignTeam(applicant, applicationId, { helper_user_id: helper });
      expect(applicantOnly.status).toBe(403);
      expect(applicantOnly.body.code).toBe('franchise_operator_only');

      const assigned = await assignTeam(operator, applicationId, { helper_user_id: helper, role: 'lead' }).expect(201);
      const memberId = assigned.body.opening_team[0].id;

      await request(app)
        .delete(`/api/franchise/my-applications/${applicationId}/opening-team/${memberId}`)
        .set('x-test-user', stranger)
        .expect(404);
      await assignTeam(stranger, applicationId, { helper_user_id: helper }).expect(404);

      const removed = await request(app)
        .delete(`/api/franchise/my-applications/${applicationId}/opening-team/${memberId}`)
        .set('x-test-user', operator)
        .expect(200);
      expect(removed.body.opening_team).toEqual([]);

      await request(app)
        .delete(`/api/franchise/my-applications/${applicationId}/opening-team/${memberId}`)
        .set('x-test-user', operator)
        .expect(404);

      const adminAssigned = await request(app)
        .post(`/api/franchise/applications/${applicationId}/opening-team`)
        .set('x-test-user', admin)
        .send({ helper_user_id: helper })
        .expect(201);
      expect(adminAssigned.body.opening_team).toHaveLength(1);
      const adminMemberId = adminAssigned.body.opening_team[0].id;
      const adminRemoved = await request(app)
        .delete(`/api/franchise/applications/${applicationId}/opening-team/${adminMemberId}`)
        .set('x-test-user', admin)
        .expect(200);
      expect(adminRemoved.body.opening_team).toEqual([]);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/opening-team`)
        .set('x-test-user', applicant)
        .send({ helper_user_id: helper })
        .expect(403);
    });

    test('roster scoping: the opening team is flagged apart from the rest of the roster', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant, { desired_region: 'TX' });
      const onTeam = await addHelper();
      const offTeam = await addHelper();
      const elsewhere = await addHelper('Dallas', 'TX');

      await approveAndAccept(applicationId, admin, applicant);

      const before = await request(app)
        .get('/api/franchise/territory-helpers')
        .set('x-test-user', applicant)
        .expect(200);
      // The Dallas helper is outside the Austin roster; the two Austin
      // helpers are listed, neither on the team yet. (This also proves
      // the roster query itself returns rows: it used to reference a
      // `service_area_city` column that never existed, so it always
      // returned an empty list.) The roster accumulates helpers from
      // earlier runs in this shared slice DB, so assert membership, not
      // list size.
      const listedBefore = before.body.helpers.map((helper) => helper.user_id);
      expect(listedBefore).toContain(onTeam);
      expect(listedBefore).toContain(offTeam);
      expect(listedBefore).not.toContain(elsewhere);
      expect(before.body.helpers.find((helper) => helper.user_id === onTeam).opening_team).toBe(false);
      expect(before.body.helpers.find((helper) => helper.user_id === offTeam).opening_team).toBe(false);

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      await assignTeam(applicant, applicationId, {
        helper_user_id: onTeam,
        location_id: detail.body.locations[0].id,
      }).expect(201);

      const after = await request(app)
        .get('/api/franchise/territory-helpers')
        .set('x-test-user', applicant)
        .expect(200);
      const flagged = after.body.helpers.find((helper) => helper.user_id === onTeam);
      const unflagged = after.body.helpers.find((helper) => helper.user_id === offTeam);
      expect(flagged.opening_team).toBe(true);
      expect(flagged.opening_team_member_id).toBeTruthy();
      expect(unflagged.opening_team).toBe(false);
      expect(unflagged.opening_team_role).toBeNull();
      expect(elsewhere).toBeTruthy();
    });
  });

  describe('613: readiness review sign-off', () => {
    function review(adminId, applicationId, body) {
      return request(app)
        .post(`/api/franchise/applications/${applicationId}/readiness-review`)
        .set('x-test-user', adminId)
        .send(body);
    }

    test('a passed review is the only path to ready, and it is recorded with actor + timestamp', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      // A bare admin status set to `ready` is refused.
      const refused = await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin)
        .send({ launch_readiness_status: 'ready' })
        .expect(409);
      expect(refused.body.code).toBe('readiness_requires_review');

      const res = await review(admin, applicationId, { outcome: 'passed', notes: 'Site walk done.' }).expect(201);
      expect(res.body.application.launch_readiness_status).toBe('ready');
      expect(res.body.readiness_reviews).toHaveLength(1);
      const [first] = res.body.readiness_reviews;
      expect(first.outcome).toBe('passed');
      expect(first.notes).toBe('Site walk done.');
      expect(first.reviewer_id).toBe(admin);
      expect(first.created_at).toBeTruthy();

      // The operator sees outcome, notes, and date — never the reviewer.
      const detail = await applicantDetail(applicant, applicationId).expect(200);
      expect(detail.body.readiness_reviews).toHaveLength(1);
      expect(detail.body.readiness_reviews[0].reviewer_id).toBeUndefined();
      expect(detail.body.readiness_reviews[0].outcome).toBe('passed');

      // Re-saving an application that is already `ready` is a no-op, not
      // a move, so the HQ edit form still saves.
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin)
        .send({ launch_readiness_status: 'ready' })
        .expect(200);
    });

    test('requesting changes needs reasons and sends readiness back to planning', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      await review(admin, applicationId, { outcome: 'changes_requested' }).expect(400);
      await review(admin, applicationId, { outcome: 'changes_requested', notes: '   ' }).expect(400);

      const res = await review(admin, applicationId, { outcome: 'changes_requested', notes: 'Staffing plan missing.' }).expect(201);
      expect(res.body.application.launch_readiness_status).toBe('planning');
      expect(res.body.readiness_reviews[0].outcome).toBe('changes_requested');

      // A later passed review moves it back to ready.
      const again = await review(admin, applicationId, { outcome: 'passed', notes: 'Staffing plan filed.' }).expect(201);
      expect(again.body.application.launch_readiness_status).toBe('ready');
      expect(again.body.readiness_reviews).toHaveLength(2);
    });

    test('review validation: unknown application, bad outcome, non-admin, closed application', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      await review(admin, '00000000-0000-0000-0000-000000000000', { outcome: 'passed' }).expect(404);
      await review(admin, applicationId, { outcome: 'maybe' }).expect(400);
      await review(applicant, applicationId, { outcome: 'passed' }).expect(403);

      await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin)
        .send({ status: 'rejected' })
        .expect(200);
      const closed = await review(admin, applicationId, { outcome: 'passed' }).expect(409);
      expect(closed.body.code).toBe('readiness_review_closed');
    });

    test('activation chain: without a passed review activation refuses; with one it launches', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);

      // Approve, train, sign, waive the fee, complete every checklist
      // item — everything but the review.
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin)
        .send({ status: 'approved', training_status: 'completed' })
        .expect(200);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/agreement/sign`)
        .set('x-test-user', applicant)
        .send({ signed_by_name: 'Franchise Fixture' })
        .expect(200);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/agreement/collect-fee`)
        .set('x-test-user', admin)
        .send({ waived: true, reason: 'Founding operator' })
        .expect(200);
      const bundle = await adminBundle(admin, applicationId).expect(200);
      expect(bundle.body.checklist.length).toBeGreaterThan(0);
      for (const item of bundle.body.checklist) {
        await request(app)
          .patch(`/api/franchise/applications/${applicationId}/checklist/${item.id}`)
          .set('x-test-user', admin)
          .send({ status: 'completed' })
          .expect(200);
      }

      // No review yet: activation refuses on readiness.
      const refused = await request(app)
        .post(`/api/franchise/applications/${applicationId}/activate-store`)
        .set('x-test-user', admin)
        .expect(409);
      expect(refused.body.code).toBe('franchise_launch_not_ready');

      // The passed review opens the gate; activation launches.
      await review(admin, applicationId, { outcome: 'passed', notes: 'Ready to open.' }).expect(201);
      const launched = await request(app)
        .post(`/api/franchise/applications/${applicationId}/activate-store`)
        .set('x-test-user', admin)
        .expect(201);
      expect(launched.body.application.status).toBe('launched');
      expect(launched.body.application.launched_at).toBeTruthy();
    });
  });

  describe('614: service availability checklist', () => {
    async function addBusinessWithServices(ownerId, names = ['Plumbing', 'Electrical']) {
      const { rows: businessRows } = await db.query(
        `INSERT INTO businesses (user_id, business_name)
         VALUES ($1, 'Franchise Fixture Business') RETURNING id`,
        [ownerId]
      );
      const businessId = businessRows[0].id;
      const serviceIds = [];
      for (const name of names) {
        const { rows } = await db.query(
          `INSERT INTO business_services (business_id, name, is_active)
           VALUES ($1, $2, TRUE) RETURNING id`,
          [businessId, name]
        );
        serviceIds.push(rows[0].id);
      }
      return { businessId, serviceIds };
    }

    async function linkBusiness(applicationId, businessId) {
      await db.query(
        'UPDATE franchise_applications SET linked_business_id = $1 WHERE id = $2',
        [businessId, applicationId]
      );
    }

    function review(adminId, applicationId, body) {
      return request(app)
        .post(`/api/franchise/applications/${applicationId}/readiness-review`)
        .set('x-test-user', adminId)
        .send(body);
    }

    // The full fail-closed activation chain from 613, reused so the
    // location launch tests start from a launched application.
    async function launchApplication(applicant, admin, applicationId) {
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin)
        .send({ status: 'approved', training_status: 'completed' })
        .expect(200);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/agreement/sign`)
        .set('x-test-user', applicant)
        .send({ signed_by_name: 'Franchise Fixture' })
        .expect(200);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/agreement/collect-fee`)
        .set('x-test-user', admin)
        .send({ waived: true, reason: 'Founding operator' })
        .expect(200);
      const bundle = await adminBundle(admin, applicationId).expect(200);
      for (const item of bundle.body.checklist) {
        await request(app)
          .patch(`/api/franchise/applications/${applicationId}/checklist/${item.id}`)
          .set('x-test-user', admin)
          .send({ status: 'completed' })
          .expect(200);
      }
      await review(admin, applicationId, { outcome: 'passed', notes: 'Ready to open.' }).expect(201);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/activate-store`)
        .set('x-test-user', admin)
        .expect(201);
    }

    function saveService(userId, applicationId, locationId, body) {
      return request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${locationId}/services`)
        .set('x-test-user', userId)
        .send(body);
    }

    function launch(userId, applicationId, locationId) {
      return request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${locationId}/launch`)
        .set('x-test-user', userId);
    }

    test('the operator upserts catalogue and free-text services; upserts are idempotent', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);
      const { businessId, serviceIds } = await addBusinessWithServices(applicant);
      await linkBusiness(applicationId, businessId);
      const [plumbingId, electricalId] = serviceIds;

      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const location = detail.body.locations[0];
      expect(detail.body.business_services).toHaveLength(2);
      expect(detail.body.business_services.map((service) => service.name)).toEqual(['Electrical', 'Plumbing']);

      const first = await saveService(applicant, applicationId, location.id, { service_id: plumbingId, available: true }).expect(201);
      expect(first.body.locations[0].services).toHaveLength(1);
      expect(first.body.locations[0].services[0]).toMatchObject({
        service_id: plumbingId, service_name: 'Plumbing', available: true,
      });

      // Re-upserting the same catalogue service updates the row in place.
      const updated = await saveService(applicant, applicationId, location.id, {
        service_id: plumbingId, available: false, reason: 'No plumber yet',
      }).expect(201);
      expect(updated.body.locations[0].services).toHaveLength(1);
      expect(updated.body.locations[0].services[0]).toMatchObject({
        service_id: plumbingId, available: false, reason: 'No plumber yet',
      });

      // A free-text service (no linked catalogue row) works alongside.
      const named = await saveService(applicant, applicationId, location.id, { service_name: 'Roofing', available: true }).expect(201);
      expect(named.body.locations[0].services).toHaveLength(2);
      const renamed = await saveService(applicant, applicationId, location.id, { service_name: 'Roofing', available: false }).expect(201);
      expect(renamed.body.locations[0].services).toHaveLength(2);

      // HQ can upsert too; the row lands on the same checklist.
      const adminSaved = await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${location.id}/services`)
        .set('x-test-user', admin)
        .send({ service_id: electricalId, available: true, reason: 'Licensed electrician on staff' })
        .expect(201);
      expect(adminSaved.body.locations[0].services).toHaveLength(3);
      const electrical = adminSaved.body.locations[0].services.find((service) => service.service_id === electricalId);
      expect(electrical.service_name).toBe('Electrical');
      expect(electrical.reason).toBe('Licensed electrician on staff');
    });

    test('service validation: unknown catalogue service, other business service, bad input, scoping', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);
      const { businessId, serviceIds } = await addBusinessWithServices(applicant);
      await linkBusiness(applicationId, businessId);
      const otherBusiness = await addBusinessWithServices(operator, ['Gardening']);
      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const location = detail.body.locations[0];

      const unknown = await saveService(applicant, applicationId, location.id, { service_id: 999999, available: true }).expect(404);
      expect(unknown.body.code).toBe('location_service_not_offered');
      const foreign = await saveService(applicant, applicationId, location.id, { service_id: otherBusiness.serviceIds[0], available: true }).expect(404);
      expect(foreign.body.code).toBe('location_service_not_offered');
      const nameless = await saveService(applicant, applicationId, location.id, { available: true }).expect(400);
      expect(nameless.body.code).toBe('location_service_name_required');
      const untyped = await saveService(applicant, applicationId, location.id, { service_id: serviceIds[0], available: 'yes' }).expect(400);
      expect(untyped.body.code).toBe('invalid_service_available');
      await saveService(applicant, applicationId, '00000000-0000-0000-0000-000000000000', { service_name: 'Roofing', available: true }).expect(404);

      // The applicant record alone is not the operator; a stranger 404s.
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant, applicationId]);
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin)
        .send({ owner_user_id: operator })
        .expect(200);
      const applicantOnly = await saveService(applicant, applicationId, location.id, { service_name: 'Roofing', available: true });
      expect(applicantOnly.status).toBe(403);
      expect(applicantOnly.body.code).toBe('franchise_operator_only');
      await saveService(stranger, applicationId, location.id, { service_name: 'Roofing', available: true }).expect(404);

      // The reassigned operator can save; the checklist is still empty.
      const saved = await saveService(operator, applicationId, location.id, { service_id: serviceIds[0], available: true }).expect(201);
      expect(saved.body.locations[0].services).toHaveLength(1);
    });

    test('a location cannot launch with zero available services; with one it launches', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);
      const { businessId, serviceIds } = await addBusinessWithServices(applicant);
      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const location = detail.body.locations[0];

      // The application itself is not launched yet.
      const early = await launch(applicant, applicationId, location.id).expect(409);
      expect(early.body.code).toBe('location_application_not_launched');

      await launchApplication(applicant, admin, applicationId);
      // Activation creates and links its own business; the fixture
      // business (with the catalogue services) is linked after, so the
      // checklist draws on it. Activation refuses an already-linked
      // application, so the link must come after, not before.
      await linkBusiness(applicationId, businessId);

      // No services at all: the launch is refused.
      const empty = await launch(applicant, applicationId, location.id).expect(409);
      expect(empty.body.code).toBe('location_no_available_services');

      // Only unavailable services: still refused.
      await saveService(applicant, applicationId, location.id, {
        service_id: serviceIds[0], available: false, reason: 'Not staffed yet',
      }).expect(201);
      const noneAvailable = await launch(applicant, applicationId, location.id).expect(409);
      expect(noneAvailable.body.code).toBe('location_no_available_services');

      // One available service opens the launch.
      await saveService(applicant, applicationId, location.id, { service_name: 'Roofing', available: true }).expect(201);
      const launched = await launch(applicant, applicationId, location.id).expect(200);
      const launchedLocation = launched.body.locations.find((entry) => entry.id === location.id);
      expect(launchedLocation.status).toBe('launched');
      expect(launchedLocation.launched_at).toBeTruthy();
      // The launch is not complete yet: 615's opening confirmation is
      // still missing.
      expect(launchedLocation.launch_complete).toBe(false);

      // A second launch is a 409.
      const again = await launch(applicant, applicationId, location.id).expect(409);
      expect(again.body.code).toBe('location_already_launched');

      // HQ can launch a second location too.
      const second = await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations`)
        .set('x-test-user', admin)
        .send({ name: 'Second location', city: 'Austin', country: 'US' })
        .expect(201);
      const secondLocation = second.body.locations.find((entry) => entry.name === 'Second location');
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${secondLocation.id}/services`)
        .set('x-test-user', admin)
        .send({ service_id: serviceIds[1], available: true })
        .expect(201);
      const hqLaunched = await request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${secondLocation.id}/launch`)
        .set('x-test-user', admin)
        .expect(200);
      const hqLocation = hqLaunched.body.locations.find((entry) => entry.id === secondLocation.id);
      expect(hqLocation.status).toBe('launched');
    });
  });

  describe('615: opening confirmation', () => {
    async function addBusinessWithServices(ownerId, names = ['Plumbing']) {
      const { rows: businessRows } = await db.query(
        `INSERT INTO businesses (user_id, business_name)
         VALUES ($1, 'Franchise Fixture Business') RETURNING id`,
        [ownerId]
      );
      const businessId = businessRows[0].id;
      const serviceIds = [];
      for (const name of names) {
        const { rows } = await db.query(
          `INSERT INTO business_services (business_id, name, is_active)
           VALUES ($1, $2, TRUE) RETURNING id`,
          [businessId, name]
        );
        serviceIds.push(rows[0].id);
      }
      return { businessId, serviceIds };
    }

    async function linkBusiness(applicationId, businessId) {
      await db.query(
        'UPDATE franchise_applications SET linked_business_id = $1 WHERE id = $2',
        [businessId, applicationId]
      );
    }

    function review(adminId, applicationId, body) {
      return request(app)
        .post(`/api/franchise/applications/${applicationId}/readiness-review`)
        .set('x-test-user', adminId)
        .send(body);
    }

    async function launchApplication(applicant, admin, applicationId) {
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin)
        .send({ status: 'approved', training_status: 'completed' })
        .expect(200);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/agreement/sign`)
        .set('x-test-user', applicant)
        .send({ signed_by_name: 'Franchise Fixture' })
        .expect(200);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/agreement/collect-fee`)
        .set('x-test-user', admin)
        .send({ waived: true, reason: 'Founding operator' })
        .expect(200);
      const bundle = await adminBundle(admin, applicationId).expect(200);
      for (const item of bundle.body.checklist) {
        await request(app)
          .patch(`/api/franchise/applications/${applicationId}/checklist/${item.id}`)
          .set('x-test-user', admin)
          .send({ status: 'completed' })
          .expect(200);
      }
      await review(admin, applicationId, { outcome: 'passed', notes: 'Ready to open.' }).expect(201);
      await request(app)
        .post(`/api/franchise/applications/${applicationId}/activate-store`)
        .set('x-test-user', admin)
        .expect(201);
    }

    function confirm(userId, applicationId, locationId, body) {
      return request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${locationId}/confirm-opening`)
        .set('x-test-user', userId)
        .send(body);
    }

    test('the operator confirms a launched location; the launch is only complete once confirmed', async () => {
      const applicant = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);
      const { businessId, serviceIds } = await addBusinessWithServices(applicant);
      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const location = detail.body.locations[0];

      // A planned location cannot be confirmed.
      const early = await confirm(applicant, applicationId, location.id, { opened_date: '2026-11-24' }).expect(409);
      expect(early.body.code).toBe('location_not_launched');

      await launchApplication(applicant, admin, applicationId);
      await linkBusiness(applicationId, businessId);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${location.id}/services`)
        .set('x-test-user', applicant)
        .send({ service_id: serviceIds[0], available: true })
        .expect(201);
      const launched = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${location.id}/launch`)
        .set('x-test-user', applicant)
        .expect(200);
      const launchedLocation = launched.body.locations.find((entry) => entry.id === location.id);
      expect(launchedLocation.status).toBe('launched');
      expect(launchedLocation.launch_complete).toBe(false);

      const confirmed = await confirm(applicant, applicationId, location.id, { opened_date: '2026-11-24', notes: 'Doors open.' }).expect(201);
      const confirmedLocation = confirmed.body.locations.find((entry) => entry.id === location.id);
      expect(confirmedLocation.launch_complete).toBe(true);
      expect(confirmedLocation.opening_confirmation).toMatchObject({ notes: 'Doors open.' });
      expect(confirmedLocation.opening_confirmation.opened_date).toMatch(/^2026-11-24/);
      expect(confirmedLocation.opening_confirmation.confirmed_by).toBe(applicant);

      // HQ sees the same confirmation in the bundle.
      const bundle = await adminBundle(admin, applicationId).expect(200);
      const bundleLocation = bundle.body.locations.find((entry) => entry.id === location.id);
      expect(bundleLocation.opening_confirmation.notes).toBe('Doors open.');
      expect(bundleLocation.launch_complete).toBe(true);

      // Re-confirming corrects the record instead of adding a second one.
      const corrected = await confirm(applicant, applicationId, location.id, { opened_date: '2026-11-25', notes: 'Corrected date.' }).expect(200);
      const correctedLocation = corrected.body.locations.find((entry) => entry.id === location.id);
      expect(correctedLocation.launch_complete).toBe(true);
      expect(correctedLocation.opening_confirmation.opened_date).toMatch(/^2026-11-25/);
      expect(correctedLocation.opening_confirmation.notes).toBe('Corrected date.');
      const { rows } = await db.query(
        'SELECT COUNT(*)::int AS n FROM franchise_opening_confirmations WHERE location_id = $1',
        [location.id]
      );
      expect(rows[0].n).toBe(1);
    });

    test('confirmation validation: bad dates, unknown location, scoping', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(applicant);
      const { businessId, serviceIds } = await addBusinessWithServices(applicant);
      const detail = await applicantDetail(applicant, applicationId).expect(200);
      const location = detail.body.locations[0];

      await launchApplication(applicant, admin, applicationId);
      await linkBusiness(applicationId, businessId);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${location.id}/services`)
        .set('x-test-user', applicant)
        .send({ service_id: serviceIds[0], available: true })
        .expect(201);
      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/locations/${location.id}/launch`)
        .set('x-test-user', applicant)
        .expect(200);

      const missing = await confirm(applicant, applicationId, location.id, {}).expect(400);
      expect(missing.body.code).toBe('invalid_opened_date');
      const garbage = await confirm(applicant, applicationId, location.id, { opened_date: 'not-a-date' }).expect(400);
      expect(garbage.body.code).toBe('invalid_opened_date');
      const impossible = await confirm(applicant, applicationId, location.id, { opened_date: '2026-02-30' }).expect(400);
      expect(impossible.body.code).toBe('invalid_opened_date');
      await confirm(applicant, applicationId, '00000000-0000-0000-0000-000000000000', { opened_date: '2026-11-24' }).expect(404);

      // The applicant record alone is not the operator; a stranger 404s;
      // even an admin cannot confirm through the operator endpoint.
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant, applicationId]);
      await request(app)
        .patch(`/api/franchise/applications/${applicationId}`)
        .set('x-test-user', admin)
        .send({ owner_user_id: operator })
        .expect(200);
      const applicantOnly = await confirm(applicant, applicationId, location.id, { opened_date: '2026-11-24' });
      expect(applicantOnly.status).toBe(403);
      expect(applicantOnly.body.code).toBe('franchise_operator_only');
      await confirm(stranger, applicationId, location.id, { opened_date: '2026-11-24' }).expect(404);
      await confirm(admin, applicationId, location.id, { opened_date: '2026-11-24' }).expect(404);

      // The reassigned operator confirms; the record lands.
      const confirmed = await confirm(operator, applicationId, location.id, { opened_date: '2026-11-24' }).expect(201);
      const confirmedLocation = confirmed.body.locations.find((entry) => entry.id === location.id);
      expect(confirmedLocation.launch_complete).toBe(true);
    });
  });
});
