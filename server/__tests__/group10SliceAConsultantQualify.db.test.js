'use strict';

// Group 10 Slice A acceptance: qualify for work + present services (501-510).
// Covers the built items end to end: consultant-specific application fields
// (501), profile approval workflow + matching/public gating (504), readiness
// checklist computation (505), public specialty profile (506), engagement
// format round-trip through book-slot (507), portfolio CRUD + visibility
// (509), consultant pricing summary (510). Items 502, 503, 508 were
// verified EXISTS at this tip; their existing suites are run alongside this
// file rather than re-proven here.

jest.unmock('pg');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.ACCESS_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/(credit_statement_test|pa_t\d+)$/.test(url.pathname)) {
    throw new Error('Group 10 Slice A DB tests require a loopback disposable database');
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
      email: req.get('x-test-email') || `g10a-consultant-${id}@example.invalid`,
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

describeDb('Group 10 Slice A: consultant qualify + present services', () => {
  let db;
  let app;
  const savedFlags = { ...process.env };

  beforeAll(async () => {
    process.env.SIGNED_URL_SECRET = 'group10-slice-a-fixture-secret';
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/consulting/contractor', require('../routes/consultantNetwork'));
    app.use('/api/consulting/business-launch', require('../routes/businessLaunch'));
    app.use('/api/scheduling', require('../routes/consultantScheduling'));
    const progressiveAccess = require('../routes/progressiveAccess');
    app.use('/api/me', progressiveAccess.meRouter);
    // The access admin router relies on requireAdmin to authenticate (the
    // real one reads the session); the test mock of requireAdmin only checks
    // req.user, so mount it behind the same test authenticate used above.
    const testAuthenticate = (req, res, next) => {
      const id = req.get('x-test-user');
      if (!id) return res.sendStatus(401);
      req.user = {
        id,
        role: mockRoles.get(id) || 'customer',
        email: req.get('x-test-email') || `g10a-consultant-${id}@example.invalid`,
        email_verified: !req.get('x-test-unverified'),
      };
      return next();
    };
    app.use('/api/admin/access-requests', testAuthenticate, progressiveAccess.adminRouter);
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
      [id, `g10a-consultant-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
    );
    mockRoles.set(id, role);
    return id;
  }

  async function enableConsultantPayouts(consultant) {
    await db.query(
      `INSERT INTO connect_accounts (user_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_complete)
       VALUES ($1, $2, TRUE, TRUE, TRUE)
       ON CONFLICT (user_id) DO UPDATE SET charges_enabled = TRUE, payouts_enabled = TRUE, onboarding_complete = TRUE`,
      [consultant, `acct_g10a_${consultant.replace(/-/g, '').slice(0, 20)}`],
    );
  }

  // Grants the paying-client access (501's review outcome) and approves the
  // contractor profile (504). Both gates must pass for matching/public.
  async function approveConsultant(consultant, reviewerId) {
    await enableConsultantPayouts(consultant);
    const access = require('../services/access/accessService');
    const review = require('../services/access/reviewService');
    const { body: { request: application } } = await access.createRequest(consultant, {
      capability, submit: true, answers: {
        bio: 'An independent consultant with experience designing operational processes and training local teams.',
        yearsExperience: 4,
        areasOfExpertise: ['Operations'],
      },
    });
    await review.decide({ id: reviewerId }, application.id, {
      action: 'approve', expectedVersion: application.version, evidenceRevision: application.evidenceRevision,
    });
    await request(app)
      .post(`/api/consulting/contractor/admin/profiles/${consultant}/decision`)
      .set('x-test-user', reviewerId)
      .send({ action: 'approve' })
      .expect(200);
  }

  const putProfile = (user, body) => request(app)
    .put('/api/consulting/contractor/profile').set('x-test-user', user).send(body);
  const getProfile = (user) => request(app)
    .get('/api/consulting/contractor/profile').set('x-test-user', user);
  const getReadiness = (user) => request(app)
    .get('/api/consulting/contractor/readiness').set('x-test-user', user);
  const getDashboard = (user) => request(app)
    .get('/api/consulting/contractor/dashboard').set('x-test-user', user);
  const publicProfile = (userId) => request(app)
    .get(`/api/consulting/contractor/public/${userId}`);
  const shortlist = (reviewer) => request(app)
    .get('/api/consulting/business-launch/consultants').set('x-test-user', reviewer)
    .query({ country: 'US', region: 'OH' });

  const completeProfile = {
    headline: 'Operations consultant for growing shops',
    bio: 'Ten years helping small businesses tighten operations and train teams.',
    home_country: 'US',
    home_region: 'OH',
    coverage_countries: ['US'],
    coverage_regions: ['OH'],
    languages: ['English'],
    specialties: ['Operations'],
    years_experience: 10,
    minimum_package_price_cents: 5000,
  };

  test('501: consultant application collects qualifications and credentials, visible to the reviewer', async () => {
    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'enforce';
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    const consultant = await addUser();
    const reviewer = await addUser('super_admin');
    const access = require('../services/access/accessService');
    const { body: { request: application } } = await access.createRequest(consultant, {
      capability, submit: true, answers: {
        bio: 'An independent consultant with experience designing operational processes and training local teams.',
        yearsExperience: 6,
        areasOfExpertise: ['Operations', 'Pricing'],
        qualifications: 'MBA, operations management; ten years running multi-site retail.',
        credentials: ['MBA', 'Lean Six Sigma Green Belt'],
      },
    });
    expect(application.status).toBe('submitted');
    const stored = await db.query('SELECT answers FROM access_requests WHERE id = $1', [application.id]);
    expect(stored.rows[0].answers).toMatchObject({
      qualifications: expect.stringContaining('MBA'),
      credentials: ['MBA', 'Lean Six Sigma Green Belt'],
      yearsExperience: 6,
    });
    const review = await request(app)
      .get(`/api/admin/access-requests/${application.id}`)
      .set('x-test-user', reviewer)
      .expect(200);
    expect(JSON.stringify(review.body)).toContain('Lean Six Sigma Green Belt');
    expect(JSON.stringify(review.body)).toContain('ten years running multi-site retail');
  });

  test('504: new profiles start pending, admin approve/decline drives matching and public visibility', async () => {
    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'enforce';
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    const consultant = await addUser();
    const declined = await addUser();
    const reviewer = await addUser('super_admin');

    await putProfile(consultant, completeProfile).expect(200);
    expect((await getProfile(consultant).expect(200)).body.profile.approval_status).toBe('pending');
    await putProfile(declined, completeProfile).expect(200);

    // Pending profiles are hidden from matching and the public profile even
    // before any access decision.
    expect((await shortlist(reviewer).expect(200)).body.consultants.map(({ user_id }) => user_id))
      .not.toContain(consultant);
    await publicProfile(consultant).expect(404);

    // A non-admin cannot decide, and an unknown action is rejected.
    await request(app).post(`/api/consulting/contractor/admin/profiles/${consultant}/decision`)
      .set('x-test-user', consultant).send({ action: 'approve' }).expect(403);
    await request(app).post(`/api/consulting/contractor/admin/profiles/${consultant}/decision`)
      .set('x-test-user', reviewer).send({ action: 'maybe' }).expect(400);

    // Approve one, decline the other with a note the consultant can see.
    const approved = await request(app).post(`/api/consulting/contractor/admin/profiles/${consultant}/decision`)
      .set('x-test-user', reviewer).send({ action: 'approve' }).expect(200);
    expect(approved.body.profile.approval_status).toBe('approved');
    const declinedRes = await request(app).post(`/api/consulting/contractor/admin/profiles/${declined}/decision`)
      .set('x-test-user', reviewer).send({ action: 'decline', note: 'Add a verifiable credential first.' }).expect(200);
    expect(declinedRes.body.profile).toMatchObject({ approval_status: 'declined', approval_note: 'Add a verifiable credential first.' });
    expect((await getProfile(declined).expect(200)).body.profile.approval_status).toBe('declined');
    await publicProfile(declined).expect(404);

    // The admin queue lists by status.
    const pending = await request(app).get('/api/consulting/contractor/admin/profiles')
      .set('x-test-user', reviewer).query({ status: 'pending' }).expect(200);
    expect(pending.body.profiles.map(({ user_id }) => user_id)).not.toContain(consultant);
    const approvedList = await request(app).get('/api/consulting/contractor/admin/profiles')
      .set('x-test-user', reviewer).query({ status: 'approved' }).expect(200);
    expect(approvedList.body.profiles.map(({ user_id }) => user_id)).toContain(consultant);

    // Approval alone is not enough for matching: the access grant is the
    // second gate. Grant it and the consultant appears in the shortlist.
    expect((await shortlist(reviewer).expect(200)).body.consultants.map(({ user_id }) => user_id))
      .not.toContain(consultant);
    await approveConsultant(consultant, reviewer);
    expect((await shortlist(reviewer).expect(200)).body.consultants.map(({ user_id }) => user_id))
      .toContain(consultant);

    // Saving the profile again does not move the approval state.
    await putProfile(consultant, { ...completeProfile, headline: 'Updated headline' }).expect(200);
    expect((await getProfile(consultant).expect(200)).body.profile.approval_status).toBe('approved');
  });

  test('505: readiness is server-computed from profile, availability, pricing, and approval', async () => {
    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'enforce';
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    const consultant = await addUser();
    const reviewer = await addUser('super_admin');

    // No profile at all: nothing is ready.
    let readiness = (await getReadiness(consultant).expect(200)).body.readiness;
    expect(readiness).toMatchObject({ hasProfile: false, ready: false });
    expect(readiness.items.every((item) => item.met === false)).toBe(true);

    // Complete profile + pricing, but no availability and no approval.
    await putProfile(consultant, completeProfile).expect(200);
    readiness = (await getReadiness(consultant).expect(200)).body.readiness;
    const byKey = Object.fromEntries(readiness.items.map((item) => [item.key, item.met]));
    expect(byKey).toMatchObject({
      profile_complete: true, specialties_declared: true, availability_set: false,
      pricing_set: true, profile_approved: false,
    });
    expect(readiness.ready).toBe(false);

    // Add recurring availability: only approval is left.
    const slotDate = new Date(Date.now() + 7 * 864e5);
    await request(app).post(`/api/scheduling/consultants/${consultant}/availability`)
      .set('x-test-user', consultant)
      .send({ dayOfWeek: slotDate.getUTCDay(), startTime: '09:00', endTime: '13:00' }).expect(200);
    readiness = (await getReadiness(consultant).expect(200)).body.readiness;
    expect(Object.fromEntries(readiness.items.map((item) => [item.key, item.met]))).toMatchObject({
      availability_set: true, profile_approved: false,
    });
    expect(readiness.ready).toBe(false);

    // Admin approval completes the checklist; the dashboard carries it too.
    await request(app).post(`/api/consulting/contractor/admin/profiles/${consultant}/decision`)
      .set('x-test-user', reviewer).send({ action: 'approve' }).expect(200);
    readiness = (await getReadiness(consultant).expect(200)).body.readiness;
    expect(readiness.ready).toBe(true);
    expect(readiness.items.every((item) => item.met)).toBe(true);
    expect((await getDashboard(consultant).expect(200)).body.readiness.ready).toBe(true);

    // Pricing unset drops readiness again (minimum price back to zero).
    await putProfile(consultant, { ...completeProfile, minimum_package_price_cents: 0 }).expect(200);
    readiness = (await getReadiness(consultant).expect(200)).body.readiness;
    expect(readiness.ready).toBe(false);
    expect(Object.fromEntries(readiness.items.map((item) => [item.key, item.met])).pricing_set).toBe(false);
  });

  test('506 + 510: approved public profile shows specialties, pricing, and portfolio; it never leaks email or the OxSteed cut', async () => {
    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'enforce';
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    const consultant = await addUser();
    const reviewer = await addUser('super_admin');
    await putProfile(consultant, completeProfile).expect(200);
    await publicProfile(consultant).expect(404);

    const item = (await request(app).post('/api/consulting/contractor/portfolio')
      .set('x-test-user', consultant)
      .send({ title: 'Bakery turnaround', description: 'Cut waste 30% for a Columbus bakery.',
        link_url: 'https://example.invalid/bakery-case-study', visibility: 'public' })
      .expect(201)).body.item;
    await request(app).post('/api/consulting/contractor/portfolio')
      .set('x-test-user', consultant)
      .send({ title: 'Draft notes', description: 'Not for clients.', visibility: 'hidden' })
      .expect(201);
    expect(item.title).toBe('Bakery turnaround');

    await approveConsultant(consultant, reviewer);
    const pub = await publicProfile(consultant).expect(200);
    expect(pub.body.profile).toMatchObject({
      headline: completeProfile.headline,
      specialties: ['Operations'],
      languages: ['English'],
    });
    expect(pub.body.profile.pricingSummary).toMatchObject({
      minimum_package_price_cents: 5000, currency: 'USD',
    });
    expect(pub.body.profile.portfolio.map(({ title }) => title)).toEqual(['Bakery turnaround']);
    expect(pub.body.profile).not.toHaveProperty('email');
    expect(pub.body.profile).not.toHaveProperty('default_oxsteed_cut_bps');
    expect(JSON.stringify(pub.body)).not.toContain('Draft notes');

    // The owner pricing summary does carry the internal split.
    const summary = await request(app).get('/api/consulting/contractor/pricing-summary')
      .set('x-test-user', consultant).expect(200);
    expect(summary.body.pricingSummary).toMatchObject({
      minimum_package_price_cents: 5000, default_oxsteed_cut_bps: 2000, currency: 'USD',
    });
    expect((await getDashboard(consultant).expect(200)).body.pricingSummary.minimum_package_price_cents).toBe(5000);
  });

  test('509: portfolio CRUD enforces ownership and validation; visibility hides items from the public profile', async () => {
    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'enforce';
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    const consultant = await addUser();
    const stranger = await addUser();
    const reviewer = await addUser('super_admin');
    await putProfile(consultant, completeProfile).expect(200);

    await request(app).post('/api/consulting/contractor/portfolio')
      .set('x-test-user', consultant).send({ description: 'No title' }).expect(400);
    await request(app).post('/api/consulting/contractor/portfolio')
      .set('x-test-user', consultant).send({ title: 'Bad link', link_url: 'not-a-url' }).expect(400);
    await request(app).post('/api/consulting/contractor/portfolio')
      .set('x-test-user', consultant).send({ title: 'Bad visibility', visibility: 'everyone' }).expect(400);

    const { body: { item } } = await request(app).post('/api/consulting/contractor/portfolio')
      .set('x-test-user', consultant)
      .send({ title: 'First case', description: 'v1', visibility: 'public', sort_order: 2 })
      .expect(201);
    await request(app).put(`/api/consulting/contractor/portfolio/${item.id}`)
      .set('x-test-user', stranger).send({ title: 'Hijacked' }).expect(404);
    await request(app).delete(`/api/consulting/contractor/portfolio/${item.id}`)
      .set('x-test-user', stranger).expect(404);

    const updated = await request(app).put(`/api/consulting/contractor/portfolio/${item.id}`)
      .set('x-test-user', consultant)
      .send({ title: 'First case', description: 'v2', visibility: 'hidden', sort_order: 1 })
      .expect(200);
    expect(updated.body.item).toMatchObject({ description: 'v2', visibility: 'hidden' });

    const mine = await request(app).get('/api/consulting/contractor/portfolio')
      .set('x-test-user', consultant).expect(200);
    expect(mine.body.portfolio.map(({ id }) => id)).toEqual([item.id]);

    // Hidden items never reach the public profile.
    await approveConsultant(consultant, reviewer);
    expect((await publicProfile(consultant).expect(200)).body.profile.portfolio).toEqual([]);

    await request(app).delete(`/api/consulting/contractor/portfolio/${item.id}`)
      .set('x-test-user', consultant).expect(200);
    expect((await request(app).get('/api/consulting/contractor/portfolio')
      .set('x-test-user', consultant).expect(200)).body.portfolio).toEqual([]);
  });

  test('507: the chosen engagement format round-trips through book-slot; unknown formats are rejected', async () => {
    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'enforce';
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    const consultant = await addUser();
    const reviewer = await addUser('super_admin');
    const customer = await addUser();
    const slotDate = new Date(Date.now() + 7 * 864e5);
    const date = slotDate.toISOString().slice(0, 10);
    await db.query('UPDATE users SET onboarding_completed = TRUE WHERE id = $1', [consultant]);
    await putProfile(consultant, completeProfile).expect(200);

    const sessionId = (await db.query(
      `INSERT INTO consulting_sessions (user_id, email, first_name, last_name, consultant_assigned_id)
       VALUES ($1, $2, 'Customer', 'Fixture', $3) RETURNING id`,
      [customer, `g10a-booking-${customer}@example.invalid`, consultant],
    )).rows[0].id;

    await request(app).post(`/api/scheduling/consultants/${consultant}/availability`)
      .set('x-test-user', consultant)
      .send({ dayOfWeek: slotDate.getUTCDay(), startTime: '09:00', endTime: '13:00' }).expect(200);
    await approveConsultant(consultant, reviewer);
    const scheduledId = (await request(app).post('/api/scheduling/sessions')
      .set('x-test-user', customer)
      .send({ consultingSessionId: sessionId, consultantId: consultant }).expect(201)).body.id;
    await db.query(
      `INSERT INTO consulting_payments (session_scheduled_id, amount_cents, service_tier, status)
       VALUES ($1, 10000, 'initial', 'completed')`,
      [scheduledId],
    );

    await request(app).post(`/api/scheduling/sessions/${scheduledId}/book-slot`)
      .set('x-test-user', customer)
      .send({ consultantId: consultant, date, startTime: '09:00', durationMinutes: 120, meetingType: 'carrier_pigeon' })
      .expect(400);

    const booked = await request(app).post(`/api/scheduling/sessions/${scheduledId}/book-slot`)
      .set('x-test-user', customer)
      .send({ consultantId: consultant, date, startTime: '09:00', durationMinutes: 120, meetingType: 'phone' })
      .expect(200);
    expect(booked.body).toMatchObject({ status: 'confirmed', meeting_type: 'phone' });
    const stored = await db.query(
      'SELECT meeting_type FROM consulting_sessions_scheduled WHERE id = $1', [scheduledId],
    );
    expect(stored.rows[0].meeting_type).toBe('phone');
  });
});
