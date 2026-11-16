'use strict';

jest.unmock('pg');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.ACCESS_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/(credit_statement_test|pa_t\d+)$/.test(url.pathname)) {
    throw new Error('Progressive access DB tests require a loopback disposable database');
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
      email: req.get('x-test-email') || `pa-consultant-${id}@example.invalid`,
      email_verified: !req.get('x-test-unverified'),
    };
    return next();
  };
  return { authenticate, authenticateIfPresent: (req, res, next) => (
    req.get('x-test-user') ? authenticate(req, res, next) : next()
  ) };
});
jest.mock('../middleware/adminAuth', () => ({
  ...jest.requireActual('../middleware/adminAuth'),
  requireAdmin: (req, res, next) => {
    if (req.user?.role !== 'super_admin') return res.sendStatus(403);
    req.isSuper = true;
    return next();
  },
}));
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
  sendEmailOrThrow: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const describeDb = dbUrl ? describe : describe.skip;
const capability = 'consultant.accept_paying_clients';
let fixtureUpload;

describeDb('progressive consultant and business launch access', () => {
  let db;
  let app;
  const savedFlags = { ...process.env };

  beforeAll(async () => {
    process.env.SIGNED_URL_SECRET = 'progressive-access-fixture-signed-url-secret';
    fixtureUpload = await sharp(fs.readFileSync(path.join(__dirname, '../../client/public/icons/icon-192.png'))).jpeg().toBuffer();
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/consulting/contractor', require('../routes/consultantNetwork'));
    app.use('/api/consulting/business-launch', require('../routes/businessLaunch'));
    app.use('/api/scheduling', require('../routes/consultantScheduling'));
    app.use('/api/consulting', require('../routes/consultingPayment'));
    app.use('/api/consulting', require('../routes/consultingActionItems'));
  });

  afterEach(() => {
    for (const key of ['ACCESS_CONSULTANT_ENFORCEMENT', 'ACCESS_REQUESTS_ENABLED']) {
      if (savedFlags[key] === undefined) delete process.env[key];
      else process.env[key] = savedFlags[key];
    }
  });

  afterAll(async () => { await db?.end(); });

  async function addUser(role = 'customer') {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Consultant', 'Fixture', $3, $4, TRUE, TRUE)`,
      [id, `pa-consultant-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
    );
    mockRoles.set(id, role);
    return id;
  }

  async function addReferral(consultant) {
    const { rows } = await db.query(
      `INSERT INTO consulting_requests
         (email, first_name, last_name, phone, skill_description, target_market, package_selected,
          consultant_assigned_id, consultant_assignment_status, additional_notes)
       VALUES ($1, 'Client', 'Fixture', '5550000000', 'Operations', 'Local', 'launch', $2, 'assigned', 'Private intake')
       RETURNING id`,
      [`pa-client-${randomUUID()}@example.invalid`, consultant],
    );
    return rows[0].id;
  }

  const change = (user, id, status) => request(app)
    .patch(`/api/consulting/contractor/referrals/${id}`)
    .set('x-test-user', user)
    .send({ consultant_assignment_status: status, consultant_status_notes: 'Fixture follow-up' });
  const dashboard = (user) => request(app).get('/api/consulting/contractor/dashboard').set('x-test-user', user);

  async function approve(consultant, reviewerId) {
    const access = require('../services/access/accessService');
    const review = require('../services/access/reviewService');
    const { body: { request: application } } = await access.createRequest(consultant, {
      capability, submit: true, answers: {
        bio: 'An independent consultant with experience designing operational processes and training local teams.',
        yearsExperience: 4,
        areasOfExpertise: ['Operations'],
      },
    });
    const { body } = await review.decide({ id: reviewerId }, application.id, {
      action: 'approve', expectedVersion: application.version, evidenceRevision: application.evidenceRevision,
    });
    return body.grantId;
  }

  test('pending applicants keep setup, approval unlocks only their referrals, and revocation blocks new paid updates', async () => {
    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'enforce';
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    const consultant = await addUser();
    const otherConsultant = await addUser();
    const reviewer = await addUser('super_admin');
    const applicant = await addUser();
    const mine = await addReferral(consultant);
    const foreign = await addReferral(otherConsultant);
    await db.query(
      'UPDATE consulting_requests SET user_id = $1, estimated_consultant_share_cents = 8000 WHERE id = $2',
      [applicant, mine],
    );

    await request(app).put('/api/consulting/contractor/profile').set('x-test-user', consultant).send({
      coverage_countries: ['US'], coverage_regions: ['OH'], languages: ['English'],
      specialties: ['Operations'], years_experience: 4,
    }).expect(200);
    const before = await dashboard(consultant).expect(200);
    expect(before.body.profile).toMatchObject({ coverage_regions: ['OH'], languages: ['English'], specialties: ['Operations'] });
    expect(before.body.referrals.map((entry) => entry.id)).toEqual([mine]);
    expect(before.body.payingReferralAccess).toEqual({ allowed: false, canApply: true });
    await change(consultant, foreign, 'engaged').expect(404);
    const denied = await change(consultant, mine, 'engaged').expect(403);
    expect(denied.body).toMatchObject({ code: 'access_required', capability, canApply: true });
    await change(consultant, mine, 'intro_sent').expect(200);

    const grantId = await approve(consultant, reviewer);
    const approved = await dashboard(consultant).expect(200);
    expect(approved.body.payingReferralAccess.allowed).toBe(true);
    const paid = await change(consultant, mine, 'engaged').expect(200);
    expect(paid.body.referral).toMatchObject({ id: mine, consultant_assignment_status: 'engaged' });
    expect(paid.body.referral).not.toHaveProperty('additional_notes');
    await change(consultant, foreign, 'won').expect(404);
    const customer = await request(app).get('/api/consulting/business-launch/my-requests').set('x-test-user', applicant).expect(200);
    expect(customer.body).toHaveLength(1);
    expect(customer.body[0]).toMatchObject({ id: mine, package_selected: 'launch' });
    expect(customer.body[0]).not.toHaveProperty('consultant_status_notes');
    expect(customer.body[0]).not.toHaveProperty('estimated_consultant_share_cents');

    await require('../services/access/reviewService').changeGrant({ id: reviewer }, grantId, {
      action: 'revoke', expectedVersion: 1, reasonCode: 'policy_not_met',
    });
    await change(consultant, mine, 'won').expect(403);
    await change(consultant, mine, 'completed').expect(200);

    await db.query('UPDATE consulting_requests SET consultant_assigned_id = $1 WHERE id = $2', [otherConsultant, mine]);
    const reassigned = await dashboard(consultant).expect(200);
    expect(reassigned.body).toMatchObject({ referrals: [], activity: [] });
    const audit = await db.query('SELECT metadata FROM consulting_request_referral_log WHERE request_id = $1 ORDER BY created_at', [mine]);
    expect(audit.rows.map(({ metadata }) => metadata.new_status)).toEqual(['intro_sent', 'engaged', 'completed']);
  });

  test('off and shadow preserve the legacy paid-action result', async () => {
    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'off';
    const consultant = await addUser();
    const reviewer = await addUser('super_admin');
    const mine = await addReferral(consultant);
    await approve(consultant, reviewer);

    const off = await change(consultant, mine, 'engaged').expect(403);
    expect(off.body.error).toBe('platform_approval_required');
    expect((await dashboard(consultant).expect(200)).body).not.toHaveProperty('payingReferralAccess');

    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'shadow';
    const warning = jest.spyOn(require('../utils/logger'), 'warn').mockImplementation(() => {});
    try {
      await change(consultant, mine, 'engaged').expect(403);
      expect(warning).toHaveBeenCalledWith('access.shadow_mismatch', expect.objectContaining({
        capability, legacyAllowed: false, capabilityAllowed: true,
      }));
    } finally {
      warning.mockRestore();
    }
  });

  test('WP-076: a customer can start Business Launch, recover guest intake and work with an eligible advisor while Owner access is pending', async () => {
    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'enforce';
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    const advisor = await addUser();
    const nextAdvisor = await addUser();
    const reviewer = await addUser('super_admin');
    const customer = await addUser();
    const otherCustomer = await addUser();
    const email = `pa-consultant-${customer}@example.invalid`;
    const access = require('../services/access/accessService');
    const ownerCapability = 'business.own';
    const { body: { request: ownerRequest } } = await access.createRequest(customer, {
      capability: ownerCapability,
      subject: { type: 'business_proposal' },
      submit: true,
      answers: {
        businessName: 'Corner Bakery', businessType: 'sole_prop', serviceArea: { country: 'US', region: 'OH', city: 'Columbus' },
      },
    });
    expect(ownerRequest.status).toBe('submitted');

    const launch = '/api/consulting/business-launch';
    const intake = {
      email, first_name: 'Prospect', last_name: 'Fixture', phone: '5550000000',
      skill_description: 'Baking', target_market: 'Local', operating_country: 'US', operating_state: 'OH',
      package_selected: 'launch', package_price: 750,
    };
    const submit = request(app).post(`${launch}/submit`).set('x-test-user', customer);
    const { body: { requestId } } = await submit.send({ ...intake, access_request_id: ownerRequest.id }).expect(201);
    await request(app).post(`${launch}/submit`).set('x-test-user', otherCustomer)
      .send({ ...intake, access_request_id: ownerRequest.id }).expect(404);
    await request(app).post(`${launch}/submit`).send({ ...intake, access_request_id: ownerRequest.id }).expect(404);
    const { body: { requestId: foreignId } } = await request(app).post(`${launch}/submit`)
      .set('x-test-user', otherCustomer).send(intake).expect(201);
    const { body: { requestId: guestId } } = await request(app).post(`${launch}/submit`)
      .send({ ...intake, email: email.toUpperCase() }).expect(201);

    const history = (user) => request(app).get(`${launch}/my-requests`).set('x-test-user', user);
    const ids = ({ body }) => body.map(({ id }) => id);
    const owned = await history(customer).expect(200);
    expect(ids(owned)).toEqual(expect.arrayContaining([requestId, guestId]));
    expect(ids(owned)).toHaveLength(2);
    expect(owned.body.find(({ id }) => id === requestId)).toMatchObject({
      user_id: customer, setup_items_selected: [], access_request_id: ownerRequest.id,
    });
    expect((await access.listMine(customer)).requests[0]).toMatchObject({
      id: ownerRequest.id, status: 'submitted', businessLaunch: { status: 'pending' },
    });
    expect((await access.listMine(otherCustomer)).requests).toEqual([]);
    expect(ids(await history(customer).set('x-test-unverified', '1').expect(200))).toEqual([requestId]);
    expect(ids(await history(otherCustomer).set('x-test-email', email).expect(200))).not.toContain(requestId);
    const search = () => request(app).get(`${launch}/search`).query({ email }).set('x-test-user', customer);
    expect(ids(await search().expect(200))).not.toContain(foreignId);
    await search().set('x-test-unverified', '1').expect(403);

    const shortlist = () => request(app).get(`${launch}/consultants`).set('x-test-user', reviewer)
      .query({ country: 'US', region: 'OH' });
    const assign = (consultant, noteText) => request(app).post(`${launch}/requests/${requestId}/assign-consultant`)
      .set('x-test-user', reviewer).send({ consultant_user_id: consultant, note_text: noteText });

    for (const candidate of [advisor, nextAdvisor]) {
      await request(app).put('/api/consulting/contractor/profile').set('x-test-user', candidate).send({
        coverage_countries: ['US'], coverage_regions: ['OH'],
      }).expect(200);
    }
    expect((await shortlist().expect(200)).body.consultants.map(({ user_id }) => user_id)).not.toContain(advisor);
    const denied = await assign(advisor).expect(409);
    expect(denied.body.code).toBe('consultant_access_inactive');
    await approve(advisor, reviewer);
    expect((await shortlist().expect(200)).body.consultants.map(({ user_id }) => user_id)).toContain(advisor);
    await assign(advisor, 'Private match notes').expect(200);
    expect((await dashboard(advisor).expect(200)).body.referrals.map(({ id }) => id)).toEqual([requestId]);
    await change(advisor, requestId, 'intro_sent').expect(200);
    await approve(nextAdvisor, reviewer);
    const reassigned = await assign(nextAdvisor).expect(200);
    expect(reassigned.body.request).toMatchObject({ consultant_status_notes: null, consultant_intro_sent_at: null });
    expect((await dashboard(advisor).expect(200)).body).toMatchObject({ referrals: [], activity: [] });
    expect((await dashboard(nextAdvisor).expect(200)).body.referrals.map(({ id }) => id)).toEqual([requestId]);
    expect((await dashboard(nextAdvisor).expect(200)).body.referrals[0]).not.toHaveProperty('access_request_id');

    const upload = (actor, visibility, name = 'plan.pdf') => request(app)
      .post(`${launch}/requests/${requestId}/attachments`)
      .set('x-test-user', actor)
      .field('visibility', visibility)
      .attach('file', fixtureUpload, { filename: name.replace(/\.pdf$/, '.jpg'), contentType: 'image/jpeg' });
    const shared = (await upload(customer, 'shared', 'shared-plan.pdf').expect(201)).body.attachment;
    const applicantOnly = (await upload(customer, 'applicant_only', 'private-plan.pdf').expect(201)).body.attachment;
    const consultantOnly = (await upload(nextAdvisor, 'consultant_only', 'advisor-notes.pdf').expect(201)).body.attachment;
    expect((await request(app).get(`${launch}/requests/${requestId}/attachments`).set('x-test-user', customer).expect(200)).body.attachments.map(({ id }) => id))
      .toEqual(expect.arrayContaining([shared.id, applicantOnly.id]));
    expect((await request(app).get(`${launch}/requests/${requestId}/attachments`).set('x-test-user', nextAdvisor).expect(200)).body.attachments.map(({ id }) => id))
      .toEqual(expect.arrayContaining([shared.id, consultantOnly.id]));
    await request(app).get(`${launch}/requests/${requestId}/attachments`).set('x-test-user', advisor).expect(404);
    const download = await request(app).get(`${launch}/attachments/${shared.id}/download`).set('x-test-user', customer);
    expect(download.status).toBe(200);
    await request(app).get(`${launch}/attachments/${applicantOnly.id}/download`).set('x-test-user', nextAdvisor).expect(404);
    await request(app).delete(`${launch}/attachments/${shared.id}`).set('x-test-user', nextAdvisor).expect(403);
    await request(app).delete(`${launch}/attachments/${applicantOnly.id}`).set('x-test-user', customer).expect(200);

    const { rows: [session] } = await db.query(
      `INSERT INTO consulting_sessions (user_id, email, first_name, last_name, consultant_assigned_id)
       VALUES ($1, $2, 'Prospect', 'Fixture', $3) RETURNING id`, [customer, email, nextAdvisor],
    );
    await db.query(
      `INSERT INTO consulting_action_items (session_id, title, client_visible)
       VALUES ($1, 'Send draft', TRUE), ($1, 'Internal review', FALSE)`, [session.id],
    );
    const items = (actor) => request(app).get(`/api/consulting/sessions/${session.id}/action-items`).set('x-test-user', actor);
    expect((await items(customer).expect(200)).body.map(({ title }) => title)).toEqual(['Send draft']);
    await items(otherCustomer).expect(403);

    expect((await db.query('SELECT status FROM access_requests WHERE id = $1', [ownerRequest.id])).rows[0].status).toBe('submitted');
    const ownerGrants = await db.query('SELECT id FROM access_grants WHERE user_id = $1 AND capability = $2', [customer, ownerCapability]);
    expect(ownerGrants.rows).toHaveLength(0);
  });

  test('WP-075: the assigned consultant grant controls slots, checkout and booking without changing existing appointments', async () => {
    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'enforce';
    const consultant = await addUser();
    const reviewer = await addUser('super_admin');
    const customer = await addUser();
    const stranger = await addUser();
    const slotDate = new Date(Date.now() + 7 * 864e5);
    const date = slotDate.toISOString().slice(0, 10);
    await db.query('UPDATE users SET onboarding_completed = TRUE WHERE id = $1', [consultant]);

    const addSession = async () => (await db.query(
      `INSERT INTO consulting_sessions (user_id, email, first_name, last_name, consultant_assigned_id)
       VALUES ($1, $2, 'Customer', 'Fixture', $3) RETURNING id`,
      [customer, `pa-booking-${customer}@example.invalid`, consultant],
    )).rows[0].id;
    const firstId = await addSession();
    const secondId = await addSession();
    const schedule = (id, actor = customer, selected = consultant) => request(app)
      .post('/api/scheduling/sessions').set('x-test-user', actor)
      .send({ consultingSessionId: id, consultantId: selected });
    const book = (id, selected = consultant, actor = customer) => request(app)
      .post(`/api/scheduling/sessions/${id}/book-slot`).set('x-test-user', actor)
      .send({ consultantId: selected, date, startTime: '09:00', durationMinutes: 120 });
    const slots = () => request(app).get(`/api/scheduling/consultants/${consultant}/available-slots`).query({ date });

    await request(app).post(`/api/scheduling/consultants/${consultant}/availability`)
      .set('x-test-user', consultant)
      .send({ dayOfWeek: slotDate.getUTCDay(), startTime: '09:00', endTime: '13:00' }).expect(200);
    await slots().expect(404);
    await schedule(firstId).expect(409);
    const grantId = await approve(consultant, reviewer);

    const availability = await slots().expect(200);
    expect(availability.body.map((slot) => slot.slot_start)).toEqual(['09:00:00', '10:00:00', '11:00:00', '12:00:00']);
    await schedule(firstId, stranger).expect(403);
    await schedule(firstId, customer, stranger).expect(409);
    const attempts = await Promise.all([schedule(firstId), schedule(firstId)]);
    expect(attempts.map(({ status }) => status).sort()).toEqual([200, 201]);
    expect(attempts[0].body.id).toBe(attempts[1].body.id);
    const first = attempts[0].body.id;
    const second = (await schedule(secondId).expect(201)).body.id;
    await book(first, stranger).expect(409);
    await book(first, consultant, stranger).expect(403);
    await book(first).expect(402);
    await db.query(
      `INSERT INTO consulting_payments (session_scheduled_id, amount_cents, service_tier, status)
       SELECT id, 10000, 'initial', 'completed' FROM consulting_sessions_scheduled WHERE id = ANY($1::bigint[])`,
      [[first, second]],
    );

    const bookings = await Promise.all([book(first), book(second)]);
    expect(bookings.map(({ status }) => status).sort()).toEqual([200, 409]);
    const confirmed = bookings.find(({ status }) => status === 200).body;
    const unfinished = confirmed.id === first ? second : first;
    const afterBooking = await slots().expect(200);
    expect(afterBooking.body.map((slot) => slot.slot_start)).toEqual(['11:00:00', '12:00:00']);

    await db.query('UPDATE access_grants SET expires_at = NOW() - INTERVAL \'1 day\' WHERE id = $1', [grantId]);
    await slots().expect(404);
    await book(unfinished).expect(409);
    const stored = await schedule(confirmed.session_id).expect(200);
    expect(stored.body).toMatchObject({ id: confirmed.id, status: 'confirmed', alreadyScheduled: true });
    const declinedPayment = await request(app).post('/api/consulting/payment-intent')
      .set('x-test-user', customer).send({ sessionId: firstId, packageId: 1 }).expect(409);
    expect(declinedPayment.body.error).toBe('consultant_pending_platform_approval');
    expect(require('stripe').__mockInstance.paymentIntents.create).not.toHaveBeenCalled();
  });
});
