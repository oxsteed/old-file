'use strict';

// Group 1 checkpoint 6 (G1-A4): job status timeline data.
//
// The timeline renders from timestamps the job-detail payload already
// carries — no new column, no migration, no serializer change. getJob
// selects created_at / accepted_at / started_at / completed_at /
// cancelled_at (jobController.js) and serializeJob passes them through:
// none of them is in ALWAYS_STRIPPED, PARTY_ONLY, or OWNER_ONLY. The
// bid event comes from GET /bids/job/:jobId, which selects b.created_at
// (bidController.js) and server-filters helpers to their own bid.
//
// This suite pins the payload side: one job in each reachable state
// (posted/published, accepted, started/in_progress, completed, cancelled)
// carries exactly the timestamps its state implies and no future ones,
// and a helper viewer still gets no owner-only fields (private_notes
// stays stripped per the serializer's OWNER_ONLY rules).
//
// Runs against a dedicated fresh database (credit_statement_test_g1ckpt6,
// a template clone of credit_statement_test_g1ckpt5) so checkpoint
// fixtures never pollute the shared credit_statement_test DB.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

// Coordinator correction (checkpoint 5): the beforeAll (two route trees +
// sequential fixture inserts) takes most of the 15s default hook timeout
// on this VM, so the suite timed out in beforeAll on a cold run while
// passing with a longer timeout. 60s, same as the checkpoint-3/5 suites.
jest.setTimeout(60000);

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.G1_CKPT6_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g1ckpt6') {
    throw new Error('Group 1 checkpoint 6 DB tests require the loopback credit_statement_test_g1ckpt6 database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: req.get('x-test-role') || 'customer',
      email: req.get('x-test-email') || `g1ckpt6-${id}@example.invalid`,
      email_verified: true,
    };
    return next();
  };
  return {
    authenticate,
    requireAuth: authenticate,
    optionalAuth: authenticate,
    authenticateIfPresent: (req, res, next) => (
      req.get('x-test-user') ? authenticate(req, res, next) : next()
    ),
  };
});
jest.mock('../middleware/rejectImpersonated', () => ({
  rejectImpersonated: (req, res, next) => next(),
  isImpersonatedRequest: () => false,
}));
jest.mock('../services/websocketService', () => ({
  broadcastToAdmins: jest.fn(),
  notifyAgent: jest.fn(),
  isInitialized: () => false,
  getActiveAgentCount: () => 0,
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({}),
}));

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 1 checkpoint 6: job status timeline payload (G1-A4)', () => {
  let db;
  let app;
  let owner;
  let helper;
  let otherHelper;
  let stranger;
  let admin;
  let jobPosted;
  let jobAccepted;
  let jobStarted;
  let jobCompleted;
  let jobCancelled;

  async function addUser(role) {
    const id = randomUUID();
    const { rows: [row] } = await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed, didit_status, didit_verified_at)
       VALUES ($1, $2, 'x', 'Checkpoint', 'Fixture', $3, 'customer', TRUE, TRUE, TRUE, 'pending', NULL)
       RETURNING id`,
      [id, `g1ckpt6-${id}@example.invalid`, role],
    );
    return row;
  }

  async function addJob({ status, assignedHelperId = null, stamps = {} }) {
    const id = randomUUID();
    const { rows: [row] } = await db.query(
      `INSERT INTO jobs (id, client_id, assigned_helper_id, title, description, status,
           private_notes, created_at, accepted_at, started_at, completed_at, cancelled_at)
       VALUES ($1, $2, $3, $4, 'Timeline fixture job.', $5,
           'Owner secret notes.', $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        id, owner.id, assignedHelperId, `G1A4 ${status}`, status,
        stamps.created_at || '2026-11-01T10:00:00.000Z',
        stamps.accepted_at || null,
        stamps.started_at || null,
        stamps.completed_at || null,
        stamps.cancelled_at || null,
      ],
    );
    return row;
  }

  function as(user, role) {
    return (req) => req.set('x-test-user', user.id).set('x-test-role', role || 'customer');
  }

  async function getJobAs(jobId, user, role) {
    const res = await request(app).get(`/api/jobs/${jobId}`).use(as(user, role));
    expect(res.status).toBe(200);
    return res.body;
  }

  beforeAll(async () => {
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/jobs', require('../routes/jobs'));
    app.use('/api/bids', require('../routes/bids'));
    app.use(require('../middleware/errorHandler').errorHandler);

    owner = await addUser('customer');
    helper = await addUser('helper');
    otherHelper = await addUser('helper');
    stranger = await addUser('customer');
    admin = await addUser('admin');

    jobPosted = await addJob({ status: 'published' });
    jobAccepted = await addJob({
      status: 'accepted', assignedHelperId: helper.id,
      stamps: { accepted_at: '2026-11-02T10:00:00.000Z' },
    });
    jobStarted = await addJob({
      status: 'in_progress', assignedHelperId: helper.id,
      stamps: { accepted_at: '2026-11-02T10:00:00.000Z', started_at: '2026-11-03T10:00:00.000Z' },
    });
    jobCompleted = await addJob({
      status: 'completed', assignedHelperId: helper.id,
      stamps: {
        accepted_at: '2026-11-02T10:00:00.000Z',
        started_at: '2026-11-03T10:00:00.000Z',
        completed_at: '2026-11-04T10:00:00.000Z',
      },
    });
    jobCancelled = await addJob({
      status: 'cancelled',
      stamps: { cancelled_at: '2026-11-02T12:00:00.000Z' },
    });

    // Two bids on the posted job, one per helper, at distinct times.
    // The timeline's bid event is the earliest of these.
    await db.query(
      `INSERT INTO bids (job_id, helper_id, amount, currency_code, status, created_at)
       VALUES ($1, $2, 120, 'USD', 'pending', '2026-11-01T15:00:00.000Z'),
              ($1, $3, 100, 'USD', 'pending', '2026-11-01T12:00:00.000Z')`,
      [jobPosted.id, helper.id, otherHelper.id],
    );
  });

  afterAll(async () => {
    // Remove every fixture this suite created so a re-run against the same
    // dedicated DB sees a clean slate. Cleanup uses the email-pattern
    // subselects (not array parameters) so it also clears residue from
    // earlier runs. Users are NOT deleted: any DELETE FROM users raises
    // the pre-existing oxsteed_credit_partner_funding_records RI
    // rule-rewrite error, so the user rows stay as inert orphans
    // (distinctive g1ckpt6- emails, no child rows left after this cleanup).
    if (!db) return;
    const pattern = 'g1ckpt6-%';
    const userSub = `(SELECT id FROM users WHERE email LIKE $1)`;
    await db.query(
      `DELETE FROM bids WHERE job_id IN (SELECT id FROM jobs WHERE client_id IN ${userSub})`,
      [pattern],
    );
    await db.query(`DELETE FROM jobs WHERE client_id IN ${userSub}`, [pattern]);
    await db.end().catch(() => {});
  });

  test('posted job carries created_at only; no future timestamps are invented', async () => {
    const job = await getJobAs(jobPosted.id, owner);
    expect(job.created_at).toBe('2026-11-01T10:00:00.000Z');
    expect(job.accepted_at).toBeNull();
    expect(job.started_at).toBeNull();
    expect(job.completed_at).toBeNull();
    expect(job.cancelled_at).toBeNull();
  });

  test('accepted job carries accepted_at and still no started/completed stamps', async () => {
    const job = await getJobAs(jobAccepted.id, owner);
    expect(job.created_at).toBe('2026-11-01T10:00:00.000Z');
    // The fixture tried to set accepted_at to 2026-11-02, but the
    // jobs_stamp_accepted_at trigger stamps accepted_at := NOW() on any
    // insert/update into status 'accepted' — so the live value is the
    // real acceptance time, not the fixture's. Assert presence and
    // chronology instead of the exact stamp: the timeline's accepted
    // event always shows the true acceptance time.
    expect(job.accepted_at).toBeTruthy();
    expect(Number.isNaN(Date.parse(job.accepted_at))).toBe(false);
    expect(Date.parse(job.accepted_at)).toBeGreaterThanOrEqual(Date.parse(job.created_at));
    expect(job.started_at).toBeNull();
    expect(job.completed_at).toBeNull();
    expect(job.cancelled_at).toBeNull();
  });

  test('started job carries accepted_at and started_at', async () => {
    const job = await getJobAs(jobStarted.id, owner);
    expect(job.accepted_at).toBe('2026-11-02T10:00:00.000Z');
    expect(job.started_at).toBe('2026-11-03T10:00:00.000Z');
    expect(job.completed_at).toBeNull();
    expect(job.cancelled_at).toBeNull();
  });

  test('completed job carries the full chain through completed_at', async () => {
    const job = await getJobAs(jobCompleted.id, owner);
    expect(job.created_at).toBe('2026-11-01T10:00:00.000Z');
    expect(job.accepted_at).toBe('2026-11-02T10:00:00.000Z');
    expect(job.started_at).toBe('2026-11-03T10:00:00.000Z');
    expect(job.completed_at).toBe('2026-11-04T10:00:00.000Z');
    expect(job.cancelled_at).toBeNull();
  });

  test('cancelled job carries cancelled_at and no completed_at', async () => {
    const job = await getJobAs(jobCancelled.id, owner);
    expect(job.created_at).toBe('2026-11-01T10:00:00.000Z');
    expect(job.accepted_at).toBeNull();
    expect(job.completed_at).toBeNull();
    expect(job.cancelled_at).toBe('2026-11-02T12:00:00.000Z');
  });

  test('owner sees private notes; assigned helper and stranger do not', async () => {
    const asOwner = await getJobAs(jobCompleted.id, owner);
    expect(asOwner.private_notes).toBe('Owner secret notes.');
    const asHelper = await getJobAs(jobCompleted.id, helper, 'helper');
    expect(asHelper.private_notes).toBeUndefined();
    expect(asHelper.created_at).toBe('2026-11-01T10:00:00.000Z');
    expect(asHelper.accepted_at).toBe('2026-11-02T10:00:00.000Z');
    expect(asHelper.started_at).toBe('2026-11-03T10:00:00.000Z');
    expect(asHelper.completed_at).toBe('2026-11-04T10:00:00.000Z');
    const asStranger = await getJobAs(jobCompleted.id, stranger);
    expect(asStranger.private_notes).toBeUndefined();
    expect(asStranger.created_at).toBe('2026-11-01T10:00:00.000Z');
    // Admins keep the moderation read (D-665): private notes are visible
    // to the admin viewer, never to helpers or strangers.
    const asAdmin = await getJobAs(jobCompleted.id, admin, 'admin');
    expect(asAdmin.private_notes).toBe('Owner secret notes.');
  });

  test('bid list carries created_at; owner sees both bids, a helper only their own', async () => {
    const asOwner = await request(app).get(`/api/bids/job/${jobPosted.id}`).use(as(owner));
    expect(asOwner.status).toBe(200);
    expect(asOwner.body).toHaveLength(2);
    const times = asOwner.body.map((bid) => bid.created_at).sort();
    expect(times[0]).toBe('2026-11-01T12:00:00.000Z');
    expect(times[1]).toBe('2026-11-01T15:00:00.000Z');
    const asHelper = await request(app).get(`/api/bids/job/${jobPosted.id}`).use(as(helper, 'helper'));
    expect(asHelper.status).toBe(200);
    expect(asHelper.body).toHaveLength(1);
    expect(asHelper.body[0].created_at).toBe('2026-11-01T15:00:00.000Z');
  });
});
