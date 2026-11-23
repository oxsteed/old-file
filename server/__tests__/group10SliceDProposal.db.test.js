'use strict';

// Group 10 Slice D acceptance: agree on work (521-525).
// Covers the built items end to end: versioned engagement proposals on
// the referral (521), deliverable definitions (522) and scope exclusions
// (523) on each version, client approval moving the referral to engaged
// (524), and proposal version history with supersede-on-send (525).
// Decisions D-111..D-118 in persona-roadmap-decisions.md.

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
    throw new Error('Group 10 Slice D DB tests require a loopback disposable database');
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
      email: req.get('x-test-email') || `g10d-user-${id}@example.invalid`,
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
  requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
  sendEmailOrThrow: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 10 Slice D: agree on work', () => {
  let db;
  let app;
  const savedFlags = { ...process.env };

  beforeAll(async () => {
    process.env.SIGNED_URL_SECRET = 'group10-slice-d-fixture-secret';
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/consulting/contractor', require('../routes/consultantNetwork'));
    app.use('/api/consulting/business-launch', require('../routes/businessLaunch'));
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
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed)
       VALUES ($1, $2, 'x', 'Casey', 'Fixture', $3, $4, TRUE, TRUE, TRUE)`,
      [id, `g10d-user-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
    );
    mockRoles.set(id, role);
    return id;
  }

  async function addApprovedConsultant() {
    const id = await addUser();
    await db.query(`UPDATE users SET default_mode = 'consultant' WHERE id = $1`, [id]);
    await db.query(
      `INSERT INTO consultant_contractor_profiles (user_id, approval_status, is_active, default_oxsteed_cut_bps, timezone)
       VALUES ($1, 'approved', TRUE, 2000, 'America/New_York')`,
      [id],
    );
    return id;
  }

  async function addReferral(client, consultant, status = 'assigned') {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_requests
         (user_id, email, first_name, last_name, phone, skill_description, target_market,
          consultant_assigned_id, consultant_assignment_status)
       VALUES ($1, $2, 'Casey', 'Client', '555-0100', 'Launch a bakery', 'Local customers', $3, $4)
       RETURNING id`,
      [client, `g10d-client-${client}@example.invalid`, consultant, status],
    );
    return row.id;
  }

  function auth(userId, email) {
    const headers = { 'x-test-user': userId };
    if (email) headers['x-test-email'] = email;
    return headers;
  }

  const draftBody = {
    title: 'Bakery launch engagement',
    scope_summary: 'Set up the bakery: licensing, suppliers, and a launch plan.',
    price_cents: 250000,
    deliverables: [
      { title: 'Supplier shortlist', deliverable_type: 'other', due_date: '2026-12-15', description: 'Three vetted suppliers.' },
      { title: 'Launch plan', deliverable_type: 'marketing_plan', due_date: '2026-12-31' },
    ],
    exclusions: ['Legal filing fees', 'Equipment purchases'],
  };

  async function createSentProposal(client, consultant, referralId) {
    const create = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals`)
      .set(auth(consultant))
      .send(draftBody);
    expect(create.status).toBe(201);
    const send = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals/${create.body.proposal.id}/send`)
      .set(auth(consultant))
      .send();
    expect(send.status).toBe(200);
    return send.body.proposal;
  }

  test('521/522/523: consultant drafts a version with deliverables and exclusions', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const referralId = await addReferral(client, consultant);

    const res = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals`)
      .set(auth(consultant))
      .send(draftBody);
    expect(res.status).toBe(201);
    expect(res.body.proposal.version).toBe(1);
    expect(res.body.proposal.status).toBe('draft');
    expect(res.body.proposal.deliverables).toHaveLength(2);
    expect(res.body.proposal.deliverables[0].title).toBe('Supplier shortlist');
    expect(res.body.proposal.exclusions).toHaveLength(2);
    expect(res.body.proposal.exclusions[0].exclusion_text).toBe('Legal filing fees');
  });

  test('521: sending requires scope, price, and at least one deliverable', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const referralId = await addReferral(client, consultant);

    const bare = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals`)
      .set(auth(consultant))
      .send({ title: 'Bare draft' });
    expect(bare.status).toBe(201);
    const sendBare = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals/${bare.body.proposal.id}/send`)
      .set(auth(consultant))
      .send();
    expect(sendBare.status).toBe(400);

    const filled = await request(app)
      .put(`/api/consulting/contractor/referrals/${referralId}/proposals/${bare.body.proposal.id}`)
      .set(auth(consultant))
      .send(draftBody);
    expect(filled.status).toBe(200);
    const send = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals/${bare.body.proposal.id}/send`)
      .set(auth(consultant))
      .send();
    expect(send.status).toBe(200);
    expect(send.body.proposal.status).toBe('sent');
    const { rows: [referral] } = await db.query(
      `SELECT consultant_assignment_status FROM consulting_requests WHERE id = $1`, [referralId],
    );
    expect(referral.consultant_assignment_status).toBe('proposal_sent');
  });

  test('525: sent versions are immutable; a new version supersedes the sent one', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const referralId = await addReferral(client, consultant);
    const first = await createSentProposal(client, consultant, referralId);

    const editSent = await request(app)
      .put(`/api/consulting/contractor/referrals/${referralId}/proposals/${first.id}`)
      .set(auth(consultant))
      .send({ ...draftBody, title: 'Changed after send' });
    expect(editSent.status).toBe(409);

    const second = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals`)
      .set(auth(consultant))
      .send({ ...draftBody, title: 'Revised engagement', price_cents: 275000 });
    expect(second.status).toBe(201);
    expect(second.body.proposal.version).toBe(2);
    const sendSecond = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals/${second.body.proposal.id}/send`)
      .set(auth(consultant))
      .send();
    expect(sendSecond.status).toBe(200);

    const list = await request(app)
      .get(`/api/consulting/contractor/referrals/${referralId}/proposals`)
      .set(auth(consultant));
    expect(list.status).toBe(200);
    expect(list.body.proposals).toHaveLength(2);
    expect(list.body.proposals[0].version).toBe(2);
    expect(list.body.proposals[0].status).toBe('sent');
    expect(list.body.proposals[1].version).toBe(1);
    expect(list.body.proposals[1].status).toBe('superseded');
  });

  test('524: the client approves the sent version and the referral engages', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const referralId = await addReferral(client, consultant);
    const sent = await createSentProposal(client, consultant, referralId);

    const approve = await request(app)
      .post(`/api/consulting/business-launch/requests/${referralId}/proposals/${sent.id}/approve`)
      .set(auth(client, `g10d-client-${client}@example.invalid`))
      .send();
    expect(approve.status).toBe(200);
    expect(approve.body.proposal.status).toBe('approved');
    const { rows: [referral] } = await db.query(
      `SELECT consultant_assignment_status FROM consulting_requests WHERE id = $1`, [referralId],
    );
    expect(referral.consultant_assignment_status).toBe('engaged');

    const again = await request(app)
      .post(`/api/consulting/business-launch/requests/${referralId}/proposals/${sent.id}/approve`)
      .set(auth(client, `g10d-client-${client}@example.invalid`))
      .send();
    expect(again.status).toBe(409);
  });

  test('524: rejection needs a reason; the referral stays open for a new version', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const referralId = await addReferral(client, consultant);
    const sent = await createSentProposal(client, consultant, referralId);
    const clientAuth = auth(client, `g10d-client-${client}@example.invalid`);

    const short = await request(app)
      .post(`/api/consulting/business-launch/requests/${referralId}/proposals/${sent.id}/reject`)
      .set(clientAuth)
      .send({ reason: 'no' });
    expect(short.status).toBe(400);

    const reject = await request(app)
      .post(`/api/consulting/business-launch/requests/${referralId}/proposals/${sent.id}/reject`)
      .set(clientAuth)
      .send({ reason: 'The price is higher than the budget we discussed.' });
    expect(reject.status).toBe(200);
    expect(reject.body.proposal.status).toBe('rejected');
    expect(reject.body.proposal.decision_reason).toMatch('higher than the budget');
    const { rows: [referral] } = await db.query(
      `SELECT consultant_assignment_status FROM consulting_requests WHERE id = $1`, [referralId],
    );
    expect(referral.consultant_assignment_status).toBe('proposal_sent');

    const revised = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals`)
      .set(auth(consultant))
      .send({ ...draftBody, price_cents: 200000 });
    expect(revised.status).toBe(201);
    expect(revised.body.proposal.version).toBe(2);
  });

  test('521: only the assigned consultant authors; only the client decides', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const otherConsultant = await addApprovedConsultant();
    const stranger = await addUser();
    const referralId = await addReferral(client, consultant);
    const sent = await createSentProposal(client, consultant, referralId);
    const clientAuth = auth(client, `g10d-client-${client}@example.invalid`);

    const wrongConsultant = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals`)
      .set(auth(otherConsultant))
      .send(draftBody);
    expect(wrongConsultant.status).toBe(403);

    const consultantApproves = await request(app)
      .post(`/api/consulting/business-launch/requests/${referralId}/proposals/${sent.id}/approve`)
      .set(auth(consultant))
      .send();
    expect(consultantApproves.status).toBe(403);

    const strangerReads = await request(app)
      .get(`/api/consulting/business-launch/requests/${referralId}/proposals`)
      .set(auth(stranger, `g10d-user-${stranger}@example.invalid`))
      .send();
    expect(strangerReads.status).toBe(403);

    const ownerReads = await request(app)
      .get(`/api/consulting/business-launch/requests/${referralId}/proposals`)
      .set(clientAuth);
    expect(ownerReads.status).toBe(200);
    expect(ownerReads.body.proposals).toHaveLength(1);

    const unknown = await request(app)
      .get(`/api/consulting/contractor/referrals/${randomUUID()}/proposals`)
      .set(auth(consultant));
    expect(unknown.status).toBe(404);
  });

  test('521: an open conflict blocks sending a proposal', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const referralId = await addReferral(client, consultant);
    await db.query(
      `INSERT INTO consulting_request_conflicts (request_id, consultant_id, has_conflict, description)
       VALUES ($1, $2, TRUE, 'The client is a direct competitor of an existing client.')`,
      [referralId, consultant],
    );
    const draft = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals`)
      .set(auth(consultant))
      .send(draftBody);
    expect(draft.status).toBe(201);
    const send = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals/${draft.body.proposal.id}/send`)
      .set(auth(consultant))
      .send();
    expect(send.status).toBe(409);
    expect(send.body.error).toBe('conflict_declared');
  });

  test('521: withdrawing the sent version returns the referral to discovery', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const referralId = await addReferral(client, consultant, 'discovery_scheduled');
    const sent = await createSentProposal(client, consultant, referralId);

    const withdraw = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals/${sent.id}/withdraw`)
      .set(auth(consultant))
      .send();
    expect(withdraw.status).toBe(200);
    expect(withdraw.body.proposal.status).toBe('withdrawn');
    const { rows: [referral] } = await db.query(
      `SELECT consultant_assignment_status FROM consulting_requests WHERE id = $1`, [referralId],
    );
    expect(referral.consultant_assignment_status).toBe('discovery_scheduled');

    const withdrawAgain = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals/${sent.id}/withdraw`)
      .set(auth(consultant))
      .send();
    expect(withdrawAgain.status).toBe(409);
  });

  test('521: no new proposal on a closed referral', async () => {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const referralId = await addReferral(client, consultant, 'declined');

    const create = await request(app)
      .post(`/api/consulting/contractor/referrals/${referralId}/proposals`)
      .set(auth(consultant))
      .send(draftBody);
    expect(create.status).toBe(409);
  });
});
