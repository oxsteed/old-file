'use strict';

/**
 * G10-1 consultant payout leg acceptance suite (Nov 21 audit finding).
 *
 * Against the real migrated schema, through the real admin status route,
 * the real payout service, and the real Credit load:
 *   1. Completion pays: PATCH completed -> payout paid, one Credit load
 *      posted under consultant-payout:<requestId>, wallet credited, the
 *      consultant notified with consultant_payout_paid.
 *   2. Rail off parks: payout parked credit_rail_suspended, no load
 *      posted; the hourly sweeper pays it once the rail comes back.
 *   3. Legal clearance missing parks: parked credit_payment_not_cleared;
 *      the admin retry endpoint pays it once clearance lands.
 *   4. A second completion (and a second attempt) never pays twice.
 *   5. No consultant assigned, or a zero share, creates no payout row.
 *   6. The contractor dashboard lists the payout with its status.
 *   7. Retry on a request with no payout returns 404.
 *
 * DB: disposable loopback database credit_statement_test_g101 only; the
 * suite skips otherwise. Run with CONSULTANT_PAYOUT_TEST_DATABASE_URL
 * pointed at it, e.g.:
 *   CONSULTANT_PAYOUT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test_g101 \
 *     npx jest __tests__/consultantPayoutG101.db.test.js --forceExit
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.CONSULTANT_PAYOUT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test_g101$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable G10-1 test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = 'g101-test-secret';
  process.env.FEATURE_PAYMENT_RAILS = 'true';
  process.env.FEATURE_RAIL_CREDIT = 'true';
}

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g101-${id}@example.invalid`,
      email_verified: !req.get('x-test-unverified'),
    };
    return next();
  };
  return {
    authenticate,
    authenticateIfPresent: (req, res, next) => (
      req.get('x-test-user') ? authenticate(req, res, next) : next()
    ),
  };
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

jest.setTimeout(60000);

ddescribe('G10-1 consultant payout leg', () => {
  let db;
  let app;
  let sendNotification;
  let attemptPayout;
  let sweepDuePayouts;
  let runConsultantPayoutSweeper;
  let clearPolicyCache;
  let getCustomerCreditAccount;

  beforeAll(async () => {
    db = require('../db');
    ({ sendNotification } = require('../services/notificationService'));
    ({ attemptPayout, sweepDuePayouts, clearPolicyCache } = require('../services/consultantPayoutService'));
    ({ runConsultantPayoutSweeper } = require('../jobs/consultantPayoutSweeper'));
    ({ getCustomerCreditAccount } = require('../services/oxsteedCreditService'));

    // The disposable DB persists across runs: clear payout rows left by
    // earlier runs so the sweeper's bounded batch always reaches this
    // run's rows.
    await db.query(`DELETE FROM consulting_consultant_payouts`);

    app = express();
    app.use(express.json());
    app.use('/api/consulting/contractor', require('../routes/consultantNetwork'));
    app.use('/api/consulting/business-launch', require('../routes/businessLaunch'));

    // Rail kill-switch on, US legally cleared for Credit payments.
    await db.query(
      `INSERT INTO feature_flags (key, is_enabled)
       VALUES ('oxsteed_credit_enabled', TRUE)
       ON CONFLICT (key) DO UPDATE SET is_enabled = TRUE`
    );
    await db.query(
      `INSERT INTO payment_country_policies
         (country_code, default_currency, enabled, tax_review_cleared,
          stripe_rail_enabled, credit_rail_enabled, credit_payment_legal_cleared)
       VALUES ('US', 'USD', TRUE, TRUE, FALSE, TRUE, TRUE)
       ON CONFLICT (country_code) DO UPDATE SET
         enabled = TRUE, tax_review_cleared = TRUE,
         credit_rail_enabled = TRUE, credit_payment_legal_cleared = TRUE`
    );
    clearPolicyCache();
  });

  afterAll(async () => { await db?.end(); });

  beforeEach(() => {
    sendNotification.mockClear();
  });

  afterEach(async () => {
    // Restore the rail + clearance between tests; each test flips at most
    // one of them.
    await db.query(`UPDATE feature_flags SET is_enabled = TRUE WHERE key = 'oxsteed_credit_enabled'`);
    await db.query(`UPDATE payment_country_policies SET credit_payment_legal_cleared = TRUE WHERE country_code = 'US'`);
    clearPolicyCache();
  });

  async function addUser(role, { country = 'US' } = {}) {
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, country, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', 'G101', 'Fixture', $3, $4, 'customer', TRUE, TRUE)`,
      [id, `g101-${id}@example.invalid`, role, country]
    );
    mockRoles.set(id, role);
    return id;
  }

  async function addRequest(consultantId, { shareCents = 5000, status = 'in_progress', packagePrice = 100 } = {}) {
    const { rows } = await db.query(
      `INSERT INTO consulting_requests
         (email, first_name, last_name, phone, business_name, skill_description, target_market,
          package_selected, package_price, status, consultant_assigned_id, consultant_assignment_status,
          estimated_total_price_cents, estimated_consultant_share_cents, operating_country)
       VALUES ($1, 'Client', 'Fixture', '5550000000', 'G101 Test Business', 'Operations', 'Local',
          'launch', $2, $3, $4, 'assigned', $5, $6, 'US')
       RETURNING id`,
      [`g101-client-${crypto.randomUUID()}@example.invalid`, packagePrice, status, consultantId, packagePrice * 100, shareCents]
    );
    return rows[0].id;
  }

  async function getPayout(requestId) {
    const { rows } = await db.query(
      `SELECT * FROM consulting_consultant_payouts WHERE consulting_request_id = $1`,
      [requestId]
    );
    return rows[0] || null;
  }

  async function creditLoads(idempotencyKey) {
    const { rows } = await db.query(
      `SELECT * FROM oxsteed_credit_transactions WHERE idempotency_key = $1 ORDER BY created_at`,
      [idempotencyKey]
    );
    return rows;
  }

  async function setRailEnabled(enabled) {
    await db.query(`UPDATE feature_flags SET is_enabled = $1 WHERE key = 'oxsteed_credit_enabled'`, [enabled]);
  }

  async function setLegalCleared(cleared) {
    await db.query(
      `UPDATE payment_country_policies SET credit_payment_legal_cleared = $1 WHERE country_code = 'US'`,
      [cleared]
    );
    clearPolicyCache();
  }

  const complete = (adminId, id) => request(app)
    .patch(`/api/consulting/business-launch/requests/${id}`)
    .set('x-test-user', adminId)
    .send({ status: 'completed' });
  const retryPayout = (adminId, id) => request(app)
    .post(`/api/consulting/business-launch/requests/${id}/payout/retry`)
    .set('x-test-user', adminId)
    .send({});
  const dashboard = (userId) => request(app)
    .get('/api/consulting/contractor/dashboard')
    .set('x-test-user', userId);

  test('completion pays the consultant share once in OxSteed Credit', async () => {
    const admin = await addUser('super_admin');
    const consultant = await addUser('customer');
    const requestId = await addRequest(consultant, { shareCents: 5000 });

    const res = await complete(admin, requestId).expect(200);
    expect(res.body.request.status).toBe('completed');
    expect(res.body.payout).toMatchObject({
      consulting_request_id: requestId,
      consultant_user_id: consultant,
      amount_cents: 5000,
      currency_code: 'USD',
      status: 'paid',
    });
    expect(res.body.payout.credit_transaction_id).toBeTruthy();
    expect(res.body.payout.idempotency_key).toBe(`consultant-payout:${requestId}`);

    const loads = await creditLoads(`consultant-payout:${requestId}`);
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({
      transaction_type: 'load',
      status: 'posted',
      amount_cents: '5000',
      reference_type: 'consultant_payout',
      actor_type: 'admin',
      actor_user_id: admin,
    });

    const account = await getCustomerCreditAccount(consultant);
    expect(Number(account.balanceCents)).toBe(5000);

    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: consultant,
      type: 'consultant_payout_paid',
    }));
  });

  test('rail off parks the payout with a visible reason; the sweeper pays it once the rail returns', async () => {
    const admin = await addUser('super_admin');
    const consultant = await addUser('customer');
    const requestId = await addRequest(consultant, { shareCents: 7500 });

    await setRailEnabled(false);
    const res = await complete(admin, requestId).expect(200);
    expect(res.body.payout).toMatchObject({
      status: 'parked',
      reason_code: 'credit_rail_suspended',
    });
    expect(res.body.payout.reason_detail).toBeTruthy();
    expect(await creditLoads(`consultant-payout:${requestId}`)).toHaveLength(0);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: consultant,
      type: 'consultant_payout_parked',
    }));

    // The sweeper skips while the rail is off, then pays on the first tick
    // after it comes back.
    const skipped = await runConsultantPayoutSweeper();
    expect(skipped).toMatchObject({ skipped: 'rail_disabled' });
    expect(await creditLoads(`consultant-payout:${requestId}`)).toHaveLength(0);

    await setRailEnabled(true);
    const swept = await sweepDuePayouts({ limit: 10 });
    const mine = swept.find((row) => row.consulting_request_id === requestId);
    expect(mine).toMatchObject({ status: 'paid' });
    expect(await creditLoads(`consultant-payout:${requestId}`)).toHaveLength(1);
  });

  test('missing legal clearance parks; the admin retry endpoint pays once clearance lands', async () => {
    const admin = await addUser('super_admin');
    const consultant = await addUser('customer');
    const requestId = await addRequest(consultant, { shareCents: 2500 });

    await setLegalCleared(false);
    const res = await complete(admin, requestId).expect(200);
    expect(res.body.payout).toMatchObject({
      status: 'parked',
      reason_code: 'credit_payment_not_cleared',
    });
    expect(await creditLoads(`consultant-payout:${requestId}`)).toHaveLength(0);

    await setLegalCleared(true);
    const retried = await retryPayout(admin, requestId).expect(200);
    expect(retried.body.payout).toMatchObject({ status: 'paid' });
    expect(await creditLoads(`consultant-payout:${requestId}`)).toHaveLength(1);
  });

  test('a second completion and a second attempt never pay twice', async () => {
    const admin = await addUser('super_admin');
    const consultant = await addUser('customer');
    const requestId = await addRequest(consultant, { shareCents: 4000 });

    await complete(admin, requestId).expect(200);
    // Re-marking completed does not re-attempt (no transition), and a
    // direct second attempt replays instead of posting a second load.
    const second = await complete(admin, requestId).expect(200);
    expect(second.body.payout).toMatchObject({ status: 'paid' });
    const payout = await getPayout(requestId);
    await attemptPayout(payout.id, { actorUserId: admin });
    await attemptPayout(payout.id, { actorUserId: admin });

    expect(await creditLoads(`consultant-payout:${requestId}`)).toHaveLength(1);
    const account = await getCustomerCreditAccount(consultant);
    expect(Number(account.balanceCents)).toBe(4000);
  });

  test('no consultant assigned, or a zero share, creates no payout row', async () => {
    const admin = await addUser('super_admin');
    const consultant = await addUser('customer');

    const unassignedId = await addRequest(null, { shareCents: 5000 });
    const unassigned = await complete(admin, unassignedId).expect(200);
    expect(unassigned.body.payout).toBeNull();
    expect(await getPayout(unassignedId)).toBeNull();

    const zeroShareId = await addRequest(consultant, { shareCents: 0 });
    const zeroShare = await complete(admin, zeroShareId).expect(200);
    expect(zeroShare.body.payout).toBeNull();
    expect(await getPayout(zeroShareId)).toBeNull();
  });

  test('the contractor dashboard lists the payout with its status', async () => {
    const admin = await addUser('super_admin');
    const consultant = await addUser('customer');
    const requestId = await addRequest(consultant, { shareCents: 6000 });

    await complete(admin, requestId).expect(200);
    const res = await dashboard(consultant).expect(200);
    expect(Array.isArray(res.body.payouts)).toBe(true);
    const mine = res.body.payouts.find((row) => row.consulting_request_id === requestId);
    expect(mine).toMatchObject({
      amount_cents: 6000,
      status: 'paid',
      business_name: 'G101 Test Business',
    });
    expect(mine).not.toHaveProperty('created_by');
  });

  test('retry on a request with no payout returns 404', async () => {
    const admin = await addUser('super_admin');
    const consultant = await addUser('customer');
    const requestId = await addRequest(consultant, { shareCents: 0 });
    await complete(admin, requestId).expect(200);

    await retryPayout(admin, requestId).expect(404);
  });
});
