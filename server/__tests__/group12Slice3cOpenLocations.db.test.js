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
});
