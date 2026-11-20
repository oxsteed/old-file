'use strict';

/**
 * Group 9 Slice A (items 451-455), Driver/shipper enroll-and-prepare.
 *
 * Against the real migrated schema, through the real delivery controller
 * and dispatch service:
 *   451 (verify only): self-serve onboarding creates a pending profile,
 *       GET returns it, and a claim with a pending profile fails with
 *       delivery_driver_pending_approval.
 *   452: free-text equipment ("dolly, liftgate") no longer 400s
 *       onboarding; driver-owned vehicles carry plate/make/model/year,
 *       can be listed/activated, and the active vehicle shows on the
 *       profile; another driver cannot touch them.
 *   453: driver documents record expiry dates; the renewal sweep
 *       notifies once per window (30/7/1 days) and never repeats a
 *       window; expired documents get no reminder.
 *   454: onboarding stores a structured service-area object (a bare
 *       string is coerced to {}), a stored string area never fails the
 *       dispatch gate, and upsertDriver persists the dispatch form's
 *       serviceArea/capacity fields instead of dropping them.
 *   455: the readiness endpoint renders the capabilityFailures gate as
 *       a driver-facing checklist (pass/fail/warn/na), with and without
 *       a job.
 *
 * DB: disposable loopback database credit_statement_test only; the suite
 * skips otherwise. Run with STATEMENT_TEST_DATABASE_URL pointed at it.
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

test('suite targets only the disposable Group 9 test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'group9-slice-a-test-secret';
}

const pool = require('../db');
const localDelivery = require('../controllers/localDeliveryController');
const dispatchService = require('../services/localDeliveryDispatchService');
const { capabilityFailures } = dispatchService;
const claimAction = dispatchService.createDispatchService().actions.claim;
const { sweepDriverDocumentRenewalReminders } = require('../services/driverDocumentRenewalService');

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

async function call(fn, req) {
  const res = mockRes();
  const next = mockNext();
  await fn(req, res, next);
  return { res, next };
}

ddescribe('Group 9 Slice A: driver enroll and prepare (451-455)', () => {
  async function makeUser(role, { defaultMode = null } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, default_mode)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5)`,
      [id, `g9a-${id.slice(0, 8)}@example.invalid`, role, role, defaultMode],
    );
    return id;
  }

  function helperUser(id) {
    return { id, role: 'helper', default_mode: 'helper' };
  }

  async function makeMarketplaceJob(customerId, { originState = 'OH', destinationState = 'OH' } = {}) {
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pickupEnd = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const deliveryEnd = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const { rows: [job] } = await pool.query(
      `INSERT INTO delivery_jobs
         (reference, customer_user_id, status, dispatch_state, fulfillment_source,
          origin_address, origin_city, origin_state, origin_lat, origin_lng,
          destination_address, destination_city, destination_state, destination_lat, destination_lng,
          distance_miles, package_type, weight_lbs, pieces,
          price_snapshot, customer_total_cents, driver_payout_cents,
          pickup_window_start, pickup_window_end,
          delivery_window_start, delivery_window_end)
       VALUES ($1, $2, 'posted', 'marketplace_posted', 'marketplace',
          '1 Origin Way', 'Columbus', $3, 40.0, -83.0, '2 Destination Way', 'Columbus', $4, 40.1, -83.1,
          8, 'medium', 20, 1,
          '{}', 1000, 700, $5, $6, $5, $7)
       RETURNING *`,
      [`DLV-G9A-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, customerId, originState, destinationState, start, pickupEnd, deliveryEnd],
    );
    await pool.query(
      `INSERT INTO delivery_payments (delivery_job_id, delivery_extra_id, customer_user_id, amount_cents, status, captured_at, idempotency_key)
       VALUES ($1, NULL, $2, 1000, 'paid', NOW(), $3)`,
      [job.id, customerId, `g9a-pay-${job.id}`],
    );
    return job;
  }

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('451 (verify): onboarding creates a pending profile, GET returns it, pending claim 409s to onboarding', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const { res, next } = await call(localDelivery.selfServeDriverOnboarding, {
      user: helperUser(driverId),
      body: { insuranceAcknowledged: true, vehicleType: 'car', maxPayloadLbs: 100 },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.payload.pendingApproval).toBe(true);
    expect(res.payload.profile.approved).toBe(false);

    const got = await call(localDelivery.getDriverProfile, { user: helperUser(driverId) });
    expect(got.next).not.toHaveBeenCalled();
    expect(got.res.payload.profile.approved).toBe(false);
    expect(got.res.payload.profile.vehicle_type).toBe('car');

    const job = await makeMarketplaceJob(customerId);
    await expect(claimAction({
      params: { id: String(job.id) },
      body: {},
      user: helperUser(driverId),
      headers: { 'idempotency-key': `g9a-claim-pending-${driverId.slice(0, 8)}` },
    })).rejects.toMatchObject({ code: 'delivery_driver_pending_approval' });
  });

  test('452: free-text equipment no longer 400s; it parses into the allowed object', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const { res, next } = await call(localDelivery.selfServeDriverOnboarding, {
      user: helperUser(driverId),
      body: {
        insuranceAcknowledged: true, vehicleType: 'van', maxPayloadLbs: 500,
        equipment: 'dolly, liftgate, straps',
      },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.payload.profile.equipment).toEqual({ dolly: true, liftgate: true });
  });

  test('452: driver vehicles carry identity, activate, and show on the profile; other drivers are locked out', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const otherId = await makeUser('helper', { defaultMode: 'helper' });
    await call(localDelivery.selfServeDriverOnboarding, {
      user: helperUser(driverId),
      body: { insuranceAcknowledged: true, vehicleType: 'van', maxPayloadLbs: 500 },
    });
    const created = await call(localDelivery.createDriverVehicle, {
      user: helperUser(driverId),
      body: {
        vehicleType: 'van', maxPayloadLbs: 1200, plate: 'ABC-1234',
        make: 'Ford', model: 'Transit', year: 2022, maxPieces: 4,
      },
    });
    expect(created.next).not.toHaveBeenCalled();
    expect(created.res.statusCode).toBe(201);
    expect(created.res.payload.vehicle.plate).toBe('ABC-1234');
    expect(created.res.payload.vehicle.make).toBe('Ford');
    expect(created.res.payload.vehicle.model).toBe('Transit');
    expect(created.res.payload.vehicle.year).toBe(2022);
    const vehicleId = created.res.payload.vehicle.id;

    const listed = await call(localDelivery.listDriverVehicles, { user: helperUser(driverId) });
    expect(listed.res.payload.vehicles).toHaveLength(1);

    const activated = await call(localDelivery.activateDriverVehicle, {
      user: helperUser(driverId), params: { vehicleId: String(vehicleId) },
    });
    expect(activated.next).not.toHaveBeenCalled();
    expect(String(activated.res.payload.profile.active_vehicle_id)).toBe(String(vehicleId));

    const profile = await call(localDelivery.getDriverProfile, { user: helperUser(driverId) });
    expect(profile.res.payload.activeVehicle).toBeTruthy();
    expect(profile.res.payload.activeVehicle.plate).toBe('ABC-1234');

    const foreign = await call(localDelivery.updateDriverVehicle, {
      user: helperUser(otherId), params: { vehicleId: String(vehicleId) },
      body: { plate: 'STOLEN-1' },
    });
    expect(foreign.next).toHaveBeenCalled();
    expect(foreign.next.error.status).toBe(404);
    const foreignList = await call(localDelivery.listDriverVehicles, { user: helperUser(otherId) });
    expect(foreignList.res.payload.vehicles).toHaveLength(0);
  });

  test('453: documents record expiry; the renewal sweep notifies once per window and never repeats', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const in5Days = new Date(Date.now() + 5 * 86400000).toISOString();
    const in25Days = new Date(Date.now() + 25 * 86400000).toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();

    const created = await call(localDelivery.createDriverDocument, {
      user: helperUser(driverId),
      body: { documentType: 'license', title: 'Driver licence', expiresAt: in5Days },
    });
    expect(created.next).not.toHaveBeenCalled();
    expect(created.res.statusCode).toBe(201);
    await call(localDelivery.createDriverDocument, {
      user: helperUser(driverId),
      body: { documentType: 'insurance', title: 'Auto insurance', expiresAt: in25Days },
    });
    await call(localDelivery.createDriverDocument, {
      user: helperUser(driverId),
      body: { documentType: 'registration', title: 'Old registration', expiresAt: yesterday },
    });

    const listed = await call(localDelivery.listDriverDocuments, { user: helperUser(driverId) });
    expect(listed.res.payload.documents).toHaveLength(3);
    const licence = listed.res.payload.documents.find((doc) => doc.title === 'Driver licence');
    expect(licence.days_until_expiry).toBeGreaterThan(0);
    expect(licence.days_until_expiry).toBeLessThanOrEqual(5);

    const sent = [];
    const first = await sweepDriverDocumentRenewalReminders(pool, {
      send: async (notification) => { sent.push(notification); return { success: true }; },
    });
    // 5-day doc -> 7-day window; 25-day doc -> 30-day window; expired doc -> none.
    // The sweep covers every driver, so scope the assertions to this
    // test's driver (other suites leave rows in the shared test DB).
    const mine = sent.filter((n) => n.userId === driverId);
    expect(first.notified).toBeGreaterThanOrEqual(2);
    expect(mine).toHaveLength(2);
    expect(mine.map((n) => n.type)).toEqual(['driver_document_renewal', 'driver_document_renewal']);
    expect(mine.map((n) => n.data.windowDays).sort((a, b) => a - b)).toEqual([7, 30]);

    const sentAgain = [];
    const second = await sweepDriverDocumentRenewalReminders(pool, {
      send: async (notification) => { sentAgain.push(notification); return { success: true }; },
    });
    expect(second.notified).toBe(0);
    expect(sentAgain.filter((n) => n.userId === driverId)).toHaveLength(0);
  });

  test('454: structured service area persists; a bare string coerces to {}; a stored string never fails the gate', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const structured = await call(localDelivery.selfServeDriverOnboarding, {
      user: helperUser(driverId),
      body: {
        insuranceAcknowledged: true, vehicleType: 'car', maxPayloadLbs: 100,
        serviceArea: { states: ['OH'], cities: ['Columbus'] },
      },
    });
    expect(structured.next).not.toHaveBeenCalled();
    expect(structured.res.payload.profile.service_area).toEqual({ states: ['OH'], cities: ['Columbus'] });

    const bare = await makeUser('helper', { defaultMode: 'helper' });
    const coerced = await call(localDelivery.selfServeDriverOnboarding, {
      user: helperUser(bare),
      body: { insuranceAcknowledged: true, vehicleType: 'car', serviceArea: 'Columbus, OH' },
    });
    expect(coerced.next).not.toHaveBeenCalled();
    expect(coerced.res.payload.profile.service_area).toEqual({});

    // A pre-fix row stored as a JSON string: read coerces it, and the
    // dispatch gate treats it as everywhere.
    const legacyId = await makeUser('helper', { defaultMode: 'helper' });
    await pool.query(
      `INSERT INTO delivery_driver_profiles
         (user_id, approved, active, vehicle_type, max_payload_lbs, equipment, service_area, insurance_acknowledged)
       VALUES ($1, TRUE, TRUE, 'car', 500, '{}', '"Columbus, OH"'::jsonb, TRUE)`,
      [legacyId],
    );
    const read = await call(localDelivery.getDriverProfile, { user: helperUser(legacyId) });
    expect(read.res.payload.profile.service_area).toEqual({});
    const legacyProfile = (await pool.query('SELECT * FROM delivery_driver_profiles WHERE user_id = $1', [legacyId])).rows[0];
    const customerId = await makeUser('customer');
    const job = await makeMarketplaceJob(customerId);
    const reasons = capabilityFailures(legacyProfile, job, { driver: true });
    expect(reasons).not.toContain('service_area');

    // A structured area passes jobs inside it and fails jobs outside it.
    const profile = (await pool.query('SELECT * FROM delivery_driver_profiles WHERE user_id = $1', [driverId])).rows[0];
    expect(capabilityFailures(profile, job, { driver: true })).not.toContain('service_area');
    const farJob = await makeMarketplaceJob(customerId, { originState: 'CA', destinationState: 'CA' });
    expect(capabilityFailures(profile, farJob, { driver: true })).toContain('service_area');
  });

  test('454b: upsertDriver persists the dispatch form fields it used to drop', async () => {
    const opsId = await makeUser('admin');
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const insuranceExpires = new Date(Date.now() + 90 * 86400000).toISOString();
    const availableFrom = new Date(Date.now() + 86400000).toISOString();
    const availableUntil = new Date(Date.now() + 30 * 86400000).toISOString();
    const { res, next } = await call(localDelivery.upsertDriver, {
      user: { id: opsId, role: 'admin' },
      body: {
        userId: driverId, vehicleType: 'van', maxPayloadLbs: 800,
        serviceArea: { states: ['OH'] }, maxPieces: 6,
        fragileSupported: true, perishableSupported: false,
        insuranceExpiresAt: insuranceExpires, availableFrom, availableUntil,
        insuranceAcknowledged: true,
      },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.payload.driver.service_area).toEqual({ states: ['OH'] });
    expect(res.payload.driver.max_pieces).toBe(6);
    expect(res.payload.driver.fragile_supported).toBe(true);
    expect(new Date(res.payload.driver.insurance_expires_at).getTime())
      .toBe(new Date(insuranceExpires).getTime());
    expect(new Date(res.payload.driver.available_from).getTime())
      .toBe(new Date(availableFrom).getTime());
    expect(new Date(res.payload.driver.available_until).getTime())
      .toBe(new Date(availableUntil).getTime());
  });

  test('454c: PATCH driver-profile updates only the fields sent and keeps approval', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    await pool.query(
      `INSERT INTO delivery_driver_profiles
         (user_id, approved, active, vehicle_type, max_payload_lbs, equipment, service_area, insurance_acknowledged, max_pieces)
       VALUES ($1, TRUE, TRUE, 'car', 300, '{}', '{"states":["OH"]}'::jsonb, TRUE, 2)`,
      [driverId],
    );
    const { res, next } = await call(localDelivery.updateOwnDriverProfile, {
      user: helperUser(driverId),
      body: { serviceArea: { states: ['OH', 'PA'] } },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.profile.approved).toBe(true);
    expect(res.payload.profile.service_area).toEqual({ states: ['OH', 'PA'] });
    expect(res.payload.profile.vehicle_type).toBe('car');
    expect(res.payload.profile.max_pieces).toBe(2);
  });

  test('455: readiness checklist renders the gate as pass/fail/warn, with and without a job', async () => {
    // No profile at all: everything fails.
    const nobodyId = await makeUser('helper', { defaultMode: 'helper' });
    const none = await call(localDelivery.getDriverReadiness, {
      user: helperUser(nobodyId), query: {},
    });
    expect(none.next).not.toHaveBeenCalled();
    const noneByKey = Object.fromEntries(none.res.payload.checklist.map((item) => [item.key, item.status]));
    expect(noneByKey.approval).toBe('fail');
    expect(noneByKey.documents).toBe('fail');
    expect(noneByKey.vehicle).toBe('fail');

    // Pending profile: approval fails; everything else is profile-scoped.
    const pendingId = await makeUser('helper', { defaultMode: 'helper' });
    await call(localDelivery.selfServeDriverOnboarding, {
      user: helperUser(pendingId),
      body: { insuranceAcknowledged: true, vehicleType: 'car', maxPayloadLbs: 500, maxPieces: 3 },
    });
    const pending = await call(localDelivery.getDriverReadiness, {
      user: helperUser(pendingId), query: {},
    });
    const pendingByKey = Object.fromEntries(pending.res.payload.checklist.map((item) => [item.key, item.status]));
    expect(pendingByKey.approval).toBe('fail');
    expect(pendingByKey.insurance).toBe('pass');
    expect(pendingByKey.pieces).toBe('pass');

    // Approved profile, OH area, expiring licence: documents warn,
    // approval passes; a CA job fails serviceArea, an OH job passes it.
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    await pool.query(
      `INSERT INTO delivery_driver_profiles
         (user_id, approved, active, vehicle_type, max_payload_lbs, cargo_length_in, cargo_width_in, cargo_height_in,
          equipment, service_area, insurance_acknowledged, max_pieces, insurance_expires_at)
       VALUES ($1, TRUE, TRUE, 'car', 500, 40, 40, 40, '{}', '{"states":["OH"]}'::jsonb, TRUE, 3, NOW() + INTERVAL '90 days')`,
      [driverId],
    );
    await call(localDelivery.createDriverDocument, {
      user: helperUser(driverId),
      body: { documentType: 'license', title: 'Licence', expiresAt: new Date(Date.now() + 5 * 86400000).toISOString() },
    });
    const customerId = await makeUser('customer');
    const ohJob = await makeMarketplaceJob(customerId);
    const caJob = await makeMarketplaceJob(customerId, { originState: 'CA', destinationState: 'CA' });

    const ready = await call(localDelivery.getDriverReadiness, {
      user: helperUser(driverId), query: { jobId: String(ohJob.id) },
    });
    const readyByKey = Object.fromEntries(ready.res.payload.checklist.map((item) => [item.key, item.status]));
    expect(readyByKey.approval).toBe('pass');
    expect(readyByKey.serviceArea).toBe('pass');
    expect(readyByKey.documents).toBe('warn');

    const far = await call(localDelivery.getDriverReadiness, {
      user: helperUser(driverId), query: { jobId: String(caJob.id) },
    });
    const farByKey = Object.fromEntries(far.res.payload.checklist.map((item) => [item.key, item.status]));
    expect(farByKey.serviceArea).toBe('fail');
    expect(far.res.payload.checklist.find((item) => item.key === 'serviceArea').fix).toBe('service-area');
  });
});
