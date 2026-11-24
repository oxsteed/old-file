'use strict';

// Group 12 Slice 3d acceptance: Guide teams (616-620).
// Runs against a dedicated fresh database (credit_statement_test_g12d) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 616: territory invitations (D-316) — territory-scoped invites by email
//   (operator or HQ), accept/decline by token with the invitee's account
//   email matching, cancel by operator/HQ. An invite never grants
//   business-wide access.
// 617: location manager assignments (D-318) — HQ-only assignment of a
//   territory member as a location's manager (one per location,
//   reassignment replaces), shown on the location and in HQ.
// 618: training task distribution (D-317) — territory-scoped assignment
//   of training modules/tasks to territory members, completion tracked
//   per person; the catalogue is the existing restaurant training
//   modules, the assignment state lives in franchise_training_assignments.
// 619: coverage planning (D-319) — read-only 14-day rollup of the linked
//   business's staff shifts per day, gaps flagged; per-location coverage
//   is manager + opening-team presence.
// 620: territory announcement feed (D-320) — HQ broadcast announcements
//   to a territory, operators read the feed on the territory ops page
//   with read tracking; expired announcements hide from the operator
//   feed but stay visible to HQ.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP12_SLICE3D_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g12d') {
    throw new Error('Group 12 Slice 3d DB tests require the loopback credit_statement_test_g12d database');
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
      email: req.get('x-test-email') || `g12d-${id}@example.invalid`,
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

describeDb('Group 12 Slice 3d: Guide teams (616-620)', () => {
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
    const email = `g12d-${id}@example.invalid`;
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
  // the applicant is also the operator, as in the 3c fixtures.
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

  function adminBundle(admin, applicationId) {
    return request(app)
      .get(`/api/franchise/applications/${applicationId}`)
      .set('x-test-user', admin.id);
  }

  // Invites an email to the territory as the operator and returns the
  // invite row plus the token handed back on create.
  async function inviteAsOperator(operator, applicationId, email, role = 'member') {
    const res = await request(app)
      .post(`/api/franchise/my-applications/${applicationId}/invitations`)
      .set('x-test-user', operator.id)
      .send({ email, role })
      .expect(201);
    const invite = res.body.territory_invitations.find((row) => row.email === email.toLowerCase());
    expect(invite).toBeDefined();
    expect(res.body.new_invite_token).toBeTruthy();
    return { invite, token: res.body.new_invite_token };
  }

  function acceptInvite(invitee, token, response = 'accepted') {
    return request(app)
      .post(`/api/franchise/invitations/${token}/respond`)
      .set('x-test-user', invitee.id)
      .set('x-test-email', invitee.email)
      .send({ response });
  }

  describe('616: territory invitations', () => {
    test('operator invites by email; the invite rides the detail and HQ bundle without its token', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);

      const { invite, token } = await inviteAsOperator(operator, applicationId, 'Teammate@Example.invalid', 'manager');
      expect(invite.email).toBe('teammate@example.invalid');
      expect(invite.role).toBe('manager');
      expect(invite.status).toBe('invited');
      expect(invite.invite_token).toBeUndefined();
      expect(invite.expires_at).toBeTruthy();
      expect(token).toMatch(/^[0-9a-f]{48}$/);

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.territory_invitations).toHaveLength(1);
      expect(detail.body.territory_invitations[0].invite_token).toBeUndefined();

      const bundle = await adminBundle(admin, applicationId).expect(200);
      expect(bundle.body.territory_invitations).toHaveLength(1);
      expect(bundle.body.territory_invitations[0].status).toBe('invited');
    });

    test('duplicate outstanding invite, bad email, and bad role are refused', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      await inviteAsOperator(operator, applicationId, 'dup@example.invalid');

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/invitations`)
        .set('x-test-user', operator.id)
        .send({ email: 'DUP@example.invalid' })
        .expect(409)
        .then((res) => expect(res.body.code).toBe('territory_invite_exists'));

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/invitations`)
        .set('x-test-user', operator.id)
        .send({ email: 'not-an-email' })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('invalid_invite_email'));

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/invitations`)
        .set('x-test-user', operator.id)
        .send({ email: 'other@example.invalid', role: 'superuser' })
        .expect(400)
        .then((res) => expect(res.body.code).toBe('invalid_invite_role'));
    });

    test('applicant record alone gets 403, a stranger gets 404', async () => {
      const applicant = await addUser();
      const operator = await addUser();
      const stranger = await addUser();
      const applicationId = await makeApplication(applicant, operator);
      // The public lead form leaves applicant_user_id NULL; link the
      // applicant record directly, as the 3c fixtures do.
      await db.query('UPDATE franchise_applications SET applicant_user_id = $1 WHERE id = $2', [applicant.id, applicationId]);

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/invitations`)
        .set('x-test-user', applicant.id)
        .send({ email: 'a@example.invalid' })
        .expect(403)
        .then((res) => expect(res.body.code).toBe('franchise_operator_only'));

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/invitations`)
        .set('x-test-user', stranger.id)
        .send({ email: 'a@example.invalid' })
        .expect(404);
    });

    test('invitee accepts by token; a second answer and a wrong-email answer are refused', async () => {
      const operator = await addUser();
      const invitee = await addUser();
      const applicationId = await makeApplication(operator);
      const { token } = await inviteAsOperator(operator, applicationId, invitee.email);

      const accepted = await acceptInvite(invitee, token).expect(200);
      expect(accepted.body.invitation.status).toBe('accepted');
      expect(accepted.body.invitation.responded_at).toBeTruthy();

      await acceptInvite(invitee, token).expect(409)
        .then((res) => expect(res.body.code).toBe('territory_invite_not_pending'));

      const other = await addUser();
      const { token: token2 } = await inviteAsOperator(operator, applicationId, other.email);
      const wrongEmail = await addUser();
      await request(app)
        .post(`/api/franchise/invitations/${token2}/respond`)
        .set('x-test-user', wrongEmail.id)
        .set('x-test-email', wrongEmail.email)
        .send({ response: 'accepted' })
        .expect(403)
        .then((res) => expect(res.body.code).toBe('territory_invite_email_mismatch'));

      await request(app)
        .post('/api/franchise/invitations/does-not-exist/respond')
        .set('x-test-user', other.id)
        .set('x-test-email', other.email)
        .send({ response: 'accepted' })
        .expect(404);
    });

    test('invitee declines; the decline is tracked and frees the email for a fresh invite', async () => {
      const operator = await addUser();
      const invitee = await addUser();
      const applicationId = await makeApplication(operator);
      const { token } = await inviteAsOperator(operator, applicationId, invitee.email);

      const declined = await acceptInvite(invitee, token, 'declined').expect(200);
      expect(declined.body.invitation.status).toBe('declined');

      const { invite } = await inviteAsOperator(operator, applicationId, invitee.email);
      expect(invite.status).toBe('invited');
    });

    test('operator cancels an outstanding invite; cancelling again is a 409', async () => {
      const operator = await addUser();
      const applicationId = await makeApplication(operator);
      const { invite } = await inviteAsOperator(operator, applicationId, 'cancel@example.invalid');

      const cancelled = await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/invitations/${invite.id}/cancel`)
        .set('x-test-user', operator.id)
        .expect(200);
      expect(cancelled.body.territory_invitations[0].status).toBe('cancelled');

      await request(app)
        .post(`/api/franchise/my-applications/${applicationId}/invitations/${invite.id}/cancel`)
        .set('x-test-user', operator.id)
        .expect(409)
        .then((res) => expect(res.body.code).toBe('territory_invite_not_pending'));
    });

    test('HQ invites and cancels; a non-admin cannot use the HQ endpoints', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);

      const created = await request(app)
        .post(`/api/franchise/applications/${applicationId}/invitations`)
        .set('x-test-user', admin.id)
        .send({ email: 'hq-invite@example.invalid', role: 'member' })
        .expect(201);
      expect(created.body.new_invite_token).toBeTruthy();
      const invite = created.body.territory_invitations[0];
      expect(invite.status).toBe('invited');

      await request(app)
        .post(`/api/franchise/applications/${applicationId}/invitations`)
        .set('x-test-user', operator.id)
        .send({ email: 'nope@example.invalid' })
        .expect(403);

      const cancelled = await request(app)
        .post(`/api/franchise/applications/${applicationId}/invitations/${invite.id}/cancel`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(cancelled.body.territory_invitations[0].status).toBe('cancelled');
    });
  });

  describe('617: location manager assignments', () => {
    function assignManager(admin, applicationId, locationId, managerUserId) {
      return request(app)
        .post(`/api/franchise/applications/${applicationId}/locations/${locationId}/manager`)
        .set('x-test-user', admin.id)
        .send({ manager_user_id: managerUserId });
    }

    test('HQ assigns the operator as manager; the manager rides the location on both payloads', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);

      const assigned = await assignManager(admin, applicationId,
        (await applicantDetail(operator, applicationId).expect(200)).body.locations[0].id,
        operator.id).expect(201);
      const location = assigned.body.locations[0];
      expect(location.manager.manager_user_id).toBe(operator.id);
      expect(location.manager.manager_email).toBe(operator.email);

      const detail = await applicantDetail(operator, applicationId).expect(200);
      expect(detail.body.locations[0].manager.manager_user_id).toBe(operator.id);
    });

    test('HQ assigns an accepted invitee; a pending invitee and a stranger are not members', async () => {
      const operator = await addUser();
      const invitee = await addUser();
      const pendingInvitee = await addUser();
      const stranger = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const locationId = (await applicantDetail(operator, applicationId).expect(200)).body.locations[0].id;

      const { token } = await inviteAsOperator(operator, applicationId, invitee.email);
      await acceptInvite(invitee, token).expect(200);
      await inviteAsOperator(operator, applicationId, pendingInvitee.email);

      await assignManager(admin, applicationId, locationId, invitee.id).expect(201);

      await assignManager(admin, applicationId, locationId, pendingInvitee.id).expect(404)
        .then((res) => expect(res.body.code).toBe('location_manager_not_member'));
      await assignManager(admin, applicationId, locationId, stranger.id).expect(404)
        .then((res) => expect(res.body.code).toBe('location_manager_not_member'));
    });

    test('reassignment replaces the manager (one per location); removal clears it and a second removal is a 404', async () => {
      const operator = await addUser();
      const invitee = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const locationId = (await applicantDetail(operator, applicationId).expect(200)).body.locations[0].id;
      const { token } = await inviteAsOperator(operator, applicationId, invitee.email);
      await acceptInvite(invitee, token).expect(200);

      await assignManager(admin, applicationId, locationId, operator.id).expect(201);
      const reassigned = await assignManager(admin, applicationId, locationId, invitee.id).expect(201);
      expect(reassigned.body.locations[0].manager.manager_user_id).toBe(invitee.id);
      const managers = await db.query(
        'SELECT COUNT(*)::int AS n FROM franchise_location_managers WHERE location_id = $1', [locationId]);
      expect(managers.rows[0].n).toBe(1);

      const removed = await request(app)
        .delete(`/api/franchise/applications/${applicationId}/locations/${locationId}/manager`)
        .set('x-test-user', admin.id)
        .expect(200);
      expect(removed.body.locations[0].manager).toBeNull();

      await request(app)
        .delete(`/api/franchise/applications/${applicationId}/locations/${locationId}/manager`)
        .set('x-test-user', admin.id)
        .expect(404)
        .then((res) => expect(res.body.code).toBe('location_manager_not_assigned'));
    });

    test('manager assignment is HQ-only: the operator gets 403 on the admin endpoint', async () => {
      const operator = await addUser();
      const admin = await addUser('super_admin');
      const applicationId = await makeApplication(operator);
      const locationId = (await applicantDetail(operator, applicationId).expect(200)).body.locations[0].id;

      await assignManager(operator, applicationId, locationId, operator.id).expect(403);
      await request(app)
        .post(`/api/franchise/applications/00000000-0000-0000-0000-000000000000/locations/${locationId}/manager`)
        .set('x-test-user', admin.id)
        .send({ manager_user_id: operator.id })
        .expect(404);
      await assignManager(admin, applicationId, '00000000-0000-0000-0000-000000000000', operator.id).expect(404);
    });
  });
});
