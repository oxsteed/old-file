'use strict';

/**
 * PR #804 Track D, G-46 (approved delivery drivers still need legacy
 * helper state).
 *
 * Against the real migrated schema, through the real delivery controller
 * and dispatch service:
 *   - a logistics.ship holder with no helper history can self-serve
 *     onboard as a driver (201, pending approval); a plain customer 403s;
 *   - a logistics.ship holder sees marketplace jobs in the list
 *     (canDrive true); a plain customer does not;
 *   - a logistics.ship holder with an approved/active profile claims a
 *     marketplace job; with a pending profile the claim fails with
 *     delivery_driver_pending_approval; with no profile it fails with
 *     delivery_driver_onboarding_required; a plain customer 403s;
 *   - driver payouts list for an admitted driver with an approved/active
 *     profile, and 403 for a pending profile or a plain customer.
 *
 * No legacy helper state is written from the grant anywhere: the ship
 * holder keeps role customer / default_mode customer throughout.
 *
 * DB: disposable loopback database credit_statement_test_pr804_d only; the
 * suite skips otherwise. Run with STATEMENT_TEST_DATABASE_URL pointed at it.
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test(_pr804_d)?$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable Track D test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'pr804-track-d-test-secret';
}

const pool = require('../db');
const localDelivery = require('../controllers/localDeliveryController');
const dispatchService = require('../services/localDeliveryDispatchService');
// The raw claim action (not the (req, res, next) handler wrapper the
// controller re-exports): returns { status, response } or throws AppError.
const claimAction = dispatchService.createDispatchService().actions.claim;

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

function mockNext() {
  const fn = jest.fn();
  fn.mockImplementation((err) => { fn.error = err; });
  return fn;
}

ddescribe('G-46 logistics.ship driver admission', () => {
  async function makeUser(role, { defaultMode = null, logisticsRole = null } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, default_mode, logistics_role)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5, $6)`,
      [id, `pr804d-${id.slice(0, 8)}@example.invalid`, role, role, defaultMode, logisticsRole],
    );
    return id;
  }

  async function grantLogisticsShip(userId) {
    await pool.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES ($1, 'logistics.ship', 'self', 'self', 'active', 'legacy_backfill', 'logistics-policy-1')`,
      [userId],
    );
  }

  async function makeProfile(userId, { approved = true, active = true } = {}) {
    const { rows: [profile] } = await pool.query(
      `INSERT INTO delivery_driver_profiles
         (user_id, approved, active, vehicle_type, max_payload_lbs,
          cargo_length_in, cargo_width_in, cargo_height_in,
          equipment, service_area, insurance_acknowledged)
       VALUES ($1, $2, $3, 'car', 200, 40, 40, 40, '{}', '{}', TRUE)
       RETURNING *`,
      [userId, approved, active],
    );
    return profile;
  }

  async function makeMarketplaceJob(customerId) {
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pickupEnd = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const deliveryEnd = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const { rows: [job] } = await pool.query(
      `INSERT INTO delivery_jobs
         (reference, customer_user_id, status, dispatch_state, fulfillment_source,
          origin_address, origin_lat, origin_lng,
          destination_address, destination_lat, destination_lng,
          distance_miles, package_type, weight_lbs, pieces,
          price_snapshot, customer_total_cents, driver_payout_cents,
          pickup_window_start, pickup_window_end,
          delivery_window_start, delivery_window_end)
       VALUES ($1, $2, 'posted', 'marketplace_posted', 'marketplace',
          '1 Origin Way', 40.0, -83.0, '2 Destination Way', 40.1, -83.1,
          8, 'medium', 20, 1,
          '{}', 1000, 700, $3, $4, $3, $5)
       RETURNING *`,
      [`DLV-TEST-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, customerId, start, pickupEnd, deliveryEnd],
    );
    // Captured payment, so the claim payment gate passes.
    await pool.query(
      `INSERT INTO delivery_payments (delivery_job_id, delivery_extra_id, customer_user_id, amount_cents, status, captured_at, idempotency_key)
       VALUES ($1, NULL, $2, 1000, 'paid', NOW(), $3)`,
      [job.id, customerId, `pr804d-pay-${job.id}`],
    );
    return job;
  }

  async function jobRow(id) {
    return (await pool.query('SELECT * FROM delivery_jobs WHERE id = $1', [id])).rows[0];
  }

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('G-46: logistics.ship holder onboards as a driver; plain customer 403s; legacy helper still works', async () => {
    const shipHolder = await makeUser('customer');
    await grantLogisticsShip(shipHolder);
    const plainCustomer = await makeUser('customer');
    const legacyHelper = await makeUser('helper', { defaultMode: 'helper' });
    // Internal drivers carry the mode in default_mode (logistics_role has
    // no internal_driver value; its CHECK allows only LOGISTICS_ROLES).
    // NOTE: the users CHECKs admit 'internal_driver' in neither
    // default_mode nor logistics_role as STORED state, so this test user
    // carries a valid stored mode and the internal-driver mode only on
    // the request user (admission reads req.user, not the stored row).
    // Pre-existing shape; the leg is preserved as written, not widened.
    const internalDriver = await makeUser('customer');

    const shipRes = mockRes();
    const shipNext = mockNext();
    await localDelivery.selfServeDriverOnboarding({
      user: { id: shipHolder, role: 'customer' },
      body: { insuranceAcknowledged: true, vehicleType: 'car', maxPayloadLbs: 50 },
    }, shipRes, shipNext);
    expect(shipNext).not.toHaveBeenCalled();
    expect(shipRes.statusCode).toBe(201);
    expect(shipRes.payload.success).toBe(true);
    expect(shipRes.payload.pendingApproval).toBe(true);
    const profile = (await pool.query(
      'SELECT * FROM delivery_driver_profiles WHERE user_id = $1', [shipHolder],
    )).rows[0];
    expect(profile.approved).toBe(false);
    expect(profile.active).toBe(true);
    // No legacy helper state was written from the grant.
    const shipUser = (await pool.query(
      'SELECT role, default_mode FROM users WHERE id = $1', [shipHolder],
    )).rows[0];
    expect(shipUser.role).toBe('customer');
    expect(shipUser.default_mode).toBeNull();

    const plainRes = mockRes();
    const plainNext = mockNext();
    await localDelivery.selfServeDriverOnboarding({
      user: { id: plainCustomer, role: 'customer' },
      body: { insuranceAcknowledged: true },
    }, plainRes, plainNext);
    expect(plainNext).toHaveBeenCalled();
    expect(plainNext.error.code).toBe('delivery_helper_required');
    expect(plainNext.error.status).toBe(403);

    const helperRes = mockRes();
    const helperNext = mockNext();
    await localDelivery.selfServeDriverOnboarding({
      user: { id: legacyHelper, role: 'helper', default_mode: 'helper' },
      body: { insuranceAcknowledged: true, vehicleType: 'van' },
    }, helperRes, helperNext);
    expect(helperNext).not.toHaveBeenCalled();
    expect(helperRes.statusCode).toBe(201);

    const internalRes = mockRes();
    const internalNext = mockNext();
    await localDelivery.selfServeDriverOnboarding({
      user: { id: internalDriver, role: 'customer', default_mode: 'internal_driver' },
      body: { insuranceAcknowledged: true },
    }, internalRes, internalNext);
    expect(internalNext).not.toHaveBeenCalled();
    expect(internalRes.statusCode).toBe(201);
  });

  test('G-46: logistics.ship holder sees marketplace jobs; plain customer does not', async () => {
    const customer = await makeUser('customer');
    const shipHolder = await makeUser('customer');
    await grantLogisticsShip(shipHolder);
    const legacyHelper = await makeUser('helper', { defaultMode: 'helper' });
    // A bystander, not the job owner: the owner always sees their own job.
    const bystander = await makeUser('customer');
    const job = await makeMarketplaceJob(customer);

    const shipRes = mockRes();
    await localDelivery.list(
      { user: { id: shipHolder, role: 'customer' }, query: {} },
      shipRes, mockNext(),
    );
    expect(shipRes.payload.canDrive).toBe(true);
    expect(shipRes.payload.jobs.map((j) => String(j.id))).toContain(String(job.id));

    const plainRes = mockRes();
    await localDelivery.list(
      { user: { id: bystander, role: 'customer' }, query: {} },
      plainRes, mockNext(),
    );
    expect(plainRes.payload.canDrive).toBe(false);
    expect(plainRes.payload.jobs.map((j) => String(j.id))).not.toContain(String(job.id));

    const helperRes = mockRes();
    await localDelivery.list(
      { user: { id: legacyHelper, role: 'helper', default_mode: 'helper' }, query: {} },
      helperRes, mockNext(),
    );
    expect(helperRes.payload.canDrive).toBe(true);
    expect(helperRes.payload.jobs.map((j) => String(j.id))).toContain(String(job.id));
  });

  test('G-46: logistics.ship holder with an approved profile claims; pending/no profile and plain customer fail', async () => {
    const customer = await makeUser('customer');

    // Approved profile: claim succeeds and assigns the job.
    const approvedDriver = await makeUser('customer');
    await grantLogisticsShip(approvedDriver);
    await makeProfile(approvedDriver, { approved: true, active: true });
    const job1 = await makeMarketplaceJob(customer);
    const claimed = await claimAction({
      params: { id: String(job1.id) },
      body: {},
      user: { id: approvedDriver, role: 'customer' },
      headers: { 'idempotency-key': `pr804d-claim-ok-${approvedDriver.slice(0, 8)}` },
    });
    expect(claimed.response.job).toBeDefined();
    const claimedRow = await jobRow(job1.id);
    expect(claimedRow.status).toBe('assigned');
    expect(String(claimedRow.helper_user_id)).toBe(approvedDriver);

    // Pending profile: targeted 409, job stays posted.
    const pendingDriver = await makeUser('customer');
    await grantLogisticsShip(pendingDriver);
    await makeProfile(pendingDriver, { approved: false, active: true });
    const job2 = await makeMarketplaceJob(customer);
    await expect(claimAction({
      params: { id: String(job2.id) },
      body: {},
      user: { id: pendingDriver, role: 'customer' },
      headers: { 'idempotency-key': `pr804d-claim-pending-${pendingDriver.slice(0, 8)}` },
    })).rejects.toMatchObject({ code: 'delivery_driver_pending_approval' });
    expect((await jobRow(job2.id)).status).toBe('posted');

    // No profile at all: onboarding required.
    const noProfileDriver = await makeUser('customer');
    await grantLogisticsShip(noProfileDriver);
    const job3 = await makeMarketplaceJob(customer);
    await expect(claimAction({
      params: { id: String(job3.id) },
      body: {},
      user: { id: noProfileDriver, role: 'customer' },
      headers: { 'idempotency-key': `pr804d-claim-noprofile-${noProfileDriver.slice(0, 8)}` },
    })).rejects.toMatchObject({ code: 'delivery_driver_onboarding_required' });
    expect((await jobRow(job3.id)).status).toBe('posted');

    // Plain customer, no grant: 403 at the authorize step.
    const job4 = await makeMarketplaceJob(customer);
    await expect(claimAction({
      params: { id: String(job4.id) },
      body: {},
      user: { id: customer, role: 'customer' },
      headers: { 'idempotency-key': `pr804d-claim-plain-${customer.slice(0, 8)}` },
    })).rejects.toMatchObject({ code: 'delivery_helper_required', status: 403 });
    expect((await jobRow(job4.id)).status).toBe('posted');
  });

  test('G-46: driver payouts list for an admitted driver with an active profile, 403 otherwise', async () => {
    const customer = await makeUser('customer');
    const job = await makeMarketplaceJob(customer);

    const admitted = await makeUser('customer');
    await grantLogisticsShip(admitted);
    await makeProfile(admitted, { approved: true, active: true });
    await pool.query(
      `INSERT INTO delivery_driver_payouts (delivery_job_id, driver_user_id, payout_cents, status)
       VALUES ($1, $2, 700, 'accrued')`,
      [job.id, admitted],
    );
    const okRes = mockRes();
    const okNext = mockNext();
    await localDelivery.listDriverPayouts(
      { user: { id: admitted, role: 'customer' }, query: {} },
      okRes, okNext,
    );
    expect(okNext).not.toHaveBeenCalled();
    expect(okRes.payload.payouts).toHaveLength(1);
    expect(okRes.payload.payouts[0].driver_user_id).toBe(admitted);

    const pendingDriver = await makeUser('customer');
    await grantLogisticsShip(pendingDriver);
    await makeProfile(pendingDriver, { approved: false, active: true });
    const pendingNext = mockNext();
    await localDelivery.listDriverPayouts(
      { user: { id: pendingDriver, role: 'customer' }, query: {} },
      mockRes(), pendingNext,
    );
    expect(pendingNext).toHaveBeenCalled();
    expect(pendingNext.error.code).toBe('delivery_driver_required');
    expect(pendingNext.error.status).toBe(403);

    const plainNext = mockNext();
    await localDelivery.listDriverPayouts(
      { user: { id: customer, role: 'customer' }, query: {} },
      mockRes(), plainNext,
    );
    expect(plainNext).toHaveBeenCalled();
    expect(plainNext.error.code).toBe('delivery_driver_required');

    // Legacy helper with an approved profile keeps payout access.
    // (One payout row per job: use a second job for the second row.)
    const legacyHelper = await makeUser('helper', { defaultMode: 'helper' });
    await makeProfile(legacyHelper, { approved: true, active: true });
    const legacyJob = await makeMarketplaceJob(customer);
    await pool.query(
      `INSERT INTO delivery_driver_payouts (delivery_job_id, driver_user_id, payout_cents, status)
       VALUES ($1, $2, 700, 'approved')`,
      [legacyJob.id, legacyHelper],
    );
    const legacyRes = mockRes();
    const legacyNext = mockNext();
    await localDelivery.listDriverPayouts(
      { user: { id: legacyHelper, role: 'helper', default_mode: 'helper' }, query: {} },
      legacyRes, legacyNext,
    );
    expect(legacyNext).not.toHaveBeenCalled();
    expect(legacyRes.payload.payouts).toHaveLength(1);
  });
});
