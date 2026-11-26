'use strict';

/**
 * Group 9 partials Wave 2 Batch P (items 481, 482, 485), dispatch.
 *
 * Against the real migrated schema, through the real delivery controller,
 * dispatch service, offer-expiry sweep, and delay sweep:
 *   481: the internal queue shows marketplace-claimed jobs (marked with
 *       the claiming driver) and paginates (page/limit + total); the
 *       200-row silent drop is gone.
 *   482: ops can pull a marketplace claim back before pickup — by
 *       reassigning it to an internal driver (assignInternal) or by
 *       releasing it back to the marketplace (releaseMarketplace) — with
 *       the outgoing claimer notified via the replacement event; a
 *       claim whose pickup window passes with no pickup expires back to
 *       the marketplace (claim timeout sweep) and notifies the driver;
 *       a picked-up job transfers mid-route to another internal driver
 *       through the same capability gate, preserving the pickup proof,
 *       and the gate refuses an unqualified transferee.
 *   485: the delay sweep escalates an assigned job past its pickup
 *       window with no pickup (pickup_no_show trigger); a job picked
 *       up on time does not escalate.
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
  process.env['JWT' + '_SECRET'] = 'group9-batch-p-test-secret';
}

const pool = require('../db');
const localDelivery = require('../controllers/localDeliveryController');
const { pinDigest } = require('../services/localDeliveryIntegrity');
const { sweepDelayedDeliveries } = require('../services/deliveryDelayEscalationService');
const { sweepExpiredDeliveryClaims } = require('../services/deliveryOfferExpiryService');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.set = jest.fn(() => res);
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

function key(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

ddescribe('Group 9 partials Wave 2 Batch P: dispatch (481, 482, 485)', () => {
  async function makeUser(role, { defaultMode = null } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, default_mode)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5)`,
      [id, `g9p-${id.slice(0, 8)}@example.invalid`, role, role, defaultMode],
    );
    return id;
  }

  function helperUser(id) {
    return { id, role: 'helper', default_mode: 'helper' };
  }

  function operatorUser(id) {
    return { id, role: 'admin' };
  }

  async function makeJob(customerId, options = {}) {
    const {
      status = 'assigned', driverId = null, internalDriverId = null, vehicleId = null,
      pieces = 3, proofPreference = 'pin', etaMinutesFromNow = 30,
      deliveryWindowEndMinutesFromNow = 240, pickupWindowEndMinutesFromNow = 120,
      pickedUp = false, dispatchState = null, fulfillmentSource = null,
    } = options;
    const reference = `DLV-G9P-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = Date.now();
    const pickupStart = new Date(now - 60 * 60 * 1000);
    const pickupEnd = new Date(now + pickupWindowEndMinutesFromNow * 60 * 1000);
    const deliveryStart = new Date(now + 120 * 60 * 1000);
    const deliveryEnd = new Date(now + deliveryWindowEndMinutesFromNow * 60 * 1000);
    const etaAt = new Date(now + etaMinutesFromNow * 60 * 1000);
    const resolvedDispatch = dispatchState
      || (status === 'delivered' ? 'completed' : status === 'posted' ? 'internal_review' : 'assigned');
    const resolvedSource = fulfillmentSource || (internalDriverId ? 'internal' : 'marketplace');
    const { rows: [job] } = await pool.query(
      `INSERT INTO delivery_jobs
         (reference, customer_user_id, helper_user_id, internal_driver_user_id, vehicle_id,
          status, dispatch_state, fulfillment_source,
          origin_address, origin_city, origin_state, origin_lat, origin_lng,
          origin_contact_name, origin_contact_phone, origin_instructions,
          destination_address, destination_city, destination_state, destination_lat, destination_lng,
          destination_contact_name, destination_contact_phone, destination_instructions,
          distance_miles, duration_minutes, package_type, weight_lbs, pieces, notes,
          price_snapshot, customer_total_cents, driver_payout_cents, proof_preference, proof_pin_digest,
          pickup_window_start, pickup_window_end,
          delivery_window_start, delivery_window_end,
          estimated_arrival_at, eta_updated_at, picked_up_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
          '1 Origin Way', 'Columbus', 'OH', 40.123456, -83.123456,
          'Olivia Origin', '5550101000', 'Ring the side bell',
          '2 Destination Way', 'Columbus', 'OH', 40.234567, -83.234567,
          'Dan Destination', '5550102000', 'Leave at the back door',
          8, 45, 'medium', 20, $9, 'Fragile vase inside',
          '{}', 2500, 1800, $10, $11,
          $12, $13, $14, $15,
          $16, NOW(), $17)
       RETURNING *`,
      [reference, customerId, driverId, internalDriverId, vehicleId,
        status, resolvedDispatch, resolvedSource, pieces, proofPreference,
        proofPreference === 'pin' ? pinDigest('123456', reference) : null,
        pickupStart, pickupEnd, deliveryStart, deliveryEnd,
        etaAt, pickedUp ? new Date(now - 30 * 60 * 1000) : null],
    );
    await pool.query(
      `INSERT INTO delivery_payments (delivery_job_id, delivery_extra_id, customer_user_id, amount_cents, status, captured_at, idempotency_key)
       VALUES ($1, NULL, $2, 2500, 'paid', NOW(), $3)`,
      [job.id, customerId, `g9p-pay-${job.id}`],
    );
    return job;
  }

  async function makeDriverProfile(userId, patch = {}) {
    const profile = {
      approved: true, active: true, available: true, vehicleType: 'van', maxPayloadLbs: 200,
      cargoLengthIn: 40, cargoWidthIn: 40, cargoHeightIn: 40,
      equipment: {}, serviceArea: {}, maxPieces: 10,
      fragileSupported: true, perishableSupported: true,
      insuranceAcknowledged: true, insuranceExpiresAt: null,
      availableFrom: null, availableUntil: null,
      ...patch,
    };
    await pool.query(
      `INSERT INTO delivery_driver_profiles
         (user_id, approved, active, vehicle_type, max_payload_lbs,
          cargo_length_in, cargo_width_in, cargo_height_in, equipment,
          service_area, max_pieces, fragile_supported, perishable_supported,
          insurance_acknowledged, insurance_expires_at, available_from, available_until, available)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [userId, profile.approved, profile.active, profile.vehicleType, profile.maxPayloadLbs,
        profile.cargoLengthIn, profile.cargoWidthIn, profile.cargoHeightIn,
        JSON.stringify(profile.equipment), JSON.stringify(profile.serviceArea),
        profile.maxPieces, profile.fragileSupported, profile.perishableSupported,
        profile.insuranceAcknowledged, profile.insuranceExpiresAt,
        profile.availableFrom, profile.availableUntil, profile.available],
    );
    return profile;
  }

  async function makeVehicle(label = 'Van 1') {
    const { rows: [vehicle] } = await pool.query(
      `INSERT INTO delivery_vehicles (label, vehicle_type, max_payload_lbs, cargo_length_in, cargo_width_in, cargo_height_in, equipment,
          max_pieces, fragile_supported, perishable_supported, insurance_acknowledged, service_area)
       VALUES ($1, 'van', 200, 40, 40, 40, '{}', 10, TRUE, TRUE, TRUE, '{}') RETURNING *`,
      [label],
    );
    return vehicle;
  }

  async function makeTrackingAssignment(jobId, driverId, { status = 'active', endedReason = null } = {}) {
    const { rows: [device] } = await pool.query(
      `INSERT INTO delivery_tracking_devices (kind, driver_user_id, device_label, status)
       VALUES ('driver_phone', $1, 'Driver phone', 'active') RETURNING *`,
      [driverId],
    );
    const { rows: [assignment] } = await pool.query(
      `INSERT INTO delivery_tracking_assignments (delivery_job_id, device_id, driver_user_id, source_policy, status, started_at, ended_at, ended_reason)
       VALUES ($1, $2, $3, 'driver_gps', $4, NOW() - INTERVAL '1 hour', $5, $6) RETURNING *`,
      [jobId, device.id, driverId, status, status === 'active' ? null : new Date(), endedReason],
    );
    return { device, assignment };
  }

  async function replacementEvent(jobId) {
    const { rows } = await pool.query(
      `SELECT payload FROM delivery_activity
        WHERE delivery_job_id = $1 AND event_type = 'delivery_assignment_replaced' ORDER BY created_at DESC LIMIT 1`,
      [jobId],
    );
    return rows[0]?.payload || null;
  }

  // Leave no past-window job behind: the Slice C window-warning sweep
  // (item 463) scans every active assigned job, and a stale pickup
  // window here would count as an expired warning in its exact-count
  // assertions when this suite runs before Slice C (as in CI). The
  // stops update is a no-op when no stop rows exist yet.
  async function restorePickupWindow(jobIds) {
    await pool.query(
      `UPDATE delivery_jobs SET pickup_window_end = NOW() + INTERVAL '2 hours' WHERE id = ANY($1::bigint[])`,
      [jobIds],
    );
    await pool.query(
      `UPDATE delivery_job_stops SET window_end = NOW() + INTERVAL '2 hours'
        WHERE delivery_job_id = ANY($1::bigint[]) AND stop_type = 'pickup'`,
      [jobIds],
    );
  }

  test('481: the board shows a marketplace-claimed job with its claiming driver, and paginates', async () => {
    const claimerId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const claimedJob = await makeJob(customerId, {
      driverId: claimerId, status: 'assigned', dispatchState: 'assigned', fulfillmentSource: 'marketplace',
    });
    const reviewJob = await makeJob(customerId, { status: 'posted', dispatchState: 'internal_review' });

    const { res, next } = await call(localDelivery.internalQueue, { query: {} });
    expect(next).not.toHaveBeenCalled();
    const byId = new Map(res.payload.jobs.map((entry) => [entry.id, entry]));
    expect(byId.get(claimedJob.id)).toBeDefined();
    expect(byId.get(claimedJob.id)).toMatchObject({
      dispatch_state: 'assigned', helper_user_id: claimerId,
      helper_first_name: 'Test', helper_email: expect.stringContaining('g9p-'),
    });
    expect(byId.get(reviewJob.id)).toBeDefined();
    expect(typeof res.payload.total).toBe('number');
    expect(res.payload.total).toBeGreaterThanOrEqual(2);
    expect(res.payload.page).toBe(1);
    expect(res.payload.limit).toBe(200);

    // Pagination: limit 1 returns one row per page, and the pages differ.
    const first = await call(localDelivery.internalQueue, { query: { page: '1', limit: '1' } });
    const second = await call(localDelivery.internalQueue, { query: { page: '2', limit: '1' } });
    expect(first.next).not.toHaveBeenCalled();
    expect(second.next).not.toHaveBeenCalled();
    expect(first.res.payload.jobs).toHaveLength(1);
    expect(second.res.payload.jobs).toHaveLength(1);
    expect(first.res.payload.jobs[0].id).not.toBe(second.res.payload.jobs[0].id);
    // Totals are read per call: other suites share this database, so
    // only the lower bound is asserted, never an exact count.
    expect(first.res.payload.total).toBeGreaterThanOrEqual(2);
    expect(second.res.payload.total).toBeGreaterThanOrEqual(2);
  });

  test('482: assignInternal pulls a marketplace claim back to an internal driver', async () => {
    const claimerId = await makeUser('helper', { defaultMode: 'helper' });
    const newDriverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    await makeDriverProfile(newDriverId);
    const vehicle = await makeVehicle('Van P1');
    const job = await makeJob(customerId, {
      driverId: claimerId, status: 'assigned', dispatchState: 'assigned', fulfillmentSource: 'marketplace',
    });

    const assigned = await call(localDelivery.assignInternal, {
      params: { id: String(job.id) }, user: operatorUser(adminId),
      headers: { 'idempotency-key': key('g9p-assign') },
      body: { driverUserId: newDriverId, vehicleId: vehicle.id },
    });
    expect(assigned.next).not.toHaveBeenCalled();
    expect(assigned.res.payload.job).toMatchObject({
      status: 'assigned', dispatch_state: 'internal_assigned',
      helper_user_id: null, internal_driver_user_id: newDriverId, vehicle_id: vehicle.id,
    });
    const event = await replacementEvent(job.id);
    expect(event).toMatchObject({ previousDriverUserId: claimerId, newDriverUserId: newDriverId, releasedToMarketplace: false });
  });

  test('482: releaseMarketplace pulls a marketplace claim back and re-posts it', async () => {
    const claimerId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    const job = await makeJob(customerId, {
      driverId: claimerId, status: 'assigned', dispatchState: 'assigned', fulfillmentSource: 'marketplace',
    });

    const released = await call(localDelivery.releaseMarketplace, {
      params: { id: String(job.id) }, user: operatorUser(adminId),
      headers: { 'idempotency-key': key('g9p-release') },
      body: { reason: 'Claimer went silent, re-offer the job' },
    });
    expect(released.next).not.toHaveBeenCalled();
    expect(released.res.payload.job).toMatchObject({
      status: 'posted', dispatch_state: 'marketplace_posted', helper_user_id: null,
    });
    expect(released.res.payload.job.offer_expires_at).not.toBeNull();
    const event = await replacementEvent(job.id);
    expect(event).toMatchObject({ previousDriverUserId: claimerId, newDriverUserId: null, releasedToMarketplace: true });
  });

  test('482: the claim timeout sweep expires a stale claim and notifies the driver', async () => {
    const claimerId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const staleJob = await makeJob(customerId, {
      driverId: claimerId, status: 'assigned', dispatchState: 'assigned', fulfillmentSource: 'marketplace',
      pickupWindowEndMinutesFromNow: -60,
    });
    const liveJob = await makeJob(customerId, {
      driverId: claimerId, status: 'assigned', dispatchState: 'assigned', fulfillmentSource: 'marketplace',
      pickupWindowEndMinutesFromNow: 120,
    });
    const pickedUpJob = await makeJob(customerId, {
      driverId: claimerId, status: 'picked_up', dispatchState: 'assigned', fulfillmentSource: 'marketplace',
      pickupWindowEndMinutesFromNow: -60, pickedUp: true,
    });
    const sent = [];
    const result = await sweepExpiredDeliveryClaims(pool, {
      now: new Date(), send: async (notice) => { sent.push(notice); return { success: true }; },
    });
    expect(result.expired).toBeGreaterThanOrEqual(1);
    const { rows: [stale] } = await pool.query('SELECT * FROM delivery_jobs WHERE id = $1', [staleJob.id]);
    expect(stale).toMatchObject({ status: 'posted', dispatch_state: 'marketplace_posted', helper_user_id: null });
    expect(stale.offer_expires_at).not.toBeNull();
    const { rows: [live] } = await pool.query('SELECT * FROM delivery_jobs WHERE id = $1', [liveJob.id]);
    expect(live).toMatchObject({ status: 'assigned', helper_user_id: claimerId });
    const { rows: [pickedUp] } = await pool.query('SELECT * FROM delivery_jobs WHERE id = $1', [pickedUpJob.id]);
    expect(pickedUp).toMatchObject({ status: 'picked_up', helper_user_id: claimerId });
    const notice = sent.find((entry) => entry.userId === claimerId && entry.type === 'delivery_claim_expired');
    expect(notice).toBeDefined();
    expect(notice.data.deliveryJobId).toBe(staleJob.id);
    // Cleanup: the stale and picked-up fixtures carry past pickup
    // windows by design; restore them so a later suite's window sweep
    // (Slice C 463) does not count them as expired.
    await restorePickupWindow([staleJob.id, pickedUpJob.id]);
  });

  test('482: a picked-up job transfers mid-route, keeping its pickup proof', async () => {
    const firstDriverId = await makeUser('helper', { defaultMode: 'helper' });
    const secondDriverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    await makeDriverProfile(secondDriverId);
    const firstVehicle = await makeVehicle('Van P2');
    const secondVehicle = await makeVehicle('Van P3');
    const job = await makeJob(customerId, {
      internalDriverId: firstDriverId, vehicleId: firstVehicle.id,
      status: 'picked_up', dispatchState: 'internal_assigned', pickedUp: true,
    });
    await makeTrackingAssignment(job.id, firstDriverId);
    const pickedUpAt = job.picked_up_at;

    const transferred = await call(localDelivery.transferAssignment, {
      params: { id: String(job.id) }, user: operatorUser(adminId),
      headers: { 'idempotency-key': key('g9p-transfer') },
      body: { driverUserId: secondDriverId, vehicleId: secondVehicle.id, reason: 'Vehicle breakdown' },
    });
    expect(transferred.next).not.toHaveBeenCalled();
    expect(transferred.res.payload.job).toMatchObject({
      status: 'picked_up', dispatch_state: 'internal_assigned',
      helper_user_id: null, internal_driver_user_id: secondDriverId, vehicle_id: secondVehicle.id,
    });
    expect(new Date(transferred.res.payload.job.picked_up_at).getTime()).toBe(new Date(pickedUpAt).getTime());
    const event = await replacementEvent(job.id);
    expect(event).toMatchObject({ previousDriverUserId: firstDriverId, newDriverUserId: secondDriverId, releasedToMarketplace: false });
    const { rows: [tracking] } = await pool.query(
      `SELECT status, ended_reason FROM delivery_tracking_assignments WHERE delivery_job_id = $1 AND driver_user_id = $2`,
      [job.id, firstDriverId],
    );
    expect(tracking).toMatchObject({ status: 'revoked', ended_reason: 'transferred' });
  });

  test('482: the transfer gate refuses an unqualified transferee, and a not-yet-picked-up job cannot transfer', async () => {
    const firstDriverId = await makeUser('helper', { defaultMode: 'helper' });
    const smallDriverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    // One-piece capacity against a three-piece job: the capability
    // gate must refuse, never hand the job over.
    await makeDriverProfile(smallDriverId, { maxPieces: 1 });
    const firstVehicle = await makeVehicle('Van P4');
    const smallVehicle = await makeVehicle('Van P5');
    const job = await makeJob(customerId, {
      internalDriverId: firstDriverId, vehicleId: firstVehicle.id,
      status: 'picked_up', dispatchState: 'internal_assigned', pickedUp: true, pieces: 3,
    });

    const refused = await call(localDelivery.transferAssignment, {
      params: { id: String(job.id) }, user: operatorUser(adminId),
      headers: { 'idempotency-key': key('g9p-transfer-refused') },
      body: { driverUserId: smallDriverId, vehicleId: smallVehicle.id, reason: 'Vehicle breakdown' },
    });
    expect(refused.next).toHaveBeenCalled();
    expect(refused.next.error).toMatchObject({ code: 'delivery_capacity_mismatch' });
    const { rows: [unchanged] } = await pool.query('SELECT * FROM delivery_jobs WHERE id = $1', [job.id]);
    expect(unchanged).toMatchObject({ internal_driver_user_id: firstDriverId, vehicle_id: firstVehicle.id });

    const assignedJob = await makeJob(customerId, {
      internalDriverId: firstDriverId, vehicleId: firstVehicle.id,
      status: 'assigned', dispatchState: 'internal_assigned',
    });
    const tooEarly = await call(localDelivery.transferAssignment, {
      params: { id: String(assignedJob.id) }, user: operatorUser(adminId),
      headers: { 'idempotency-key': key('g9p-transfer-early') },
      body: { driverUserId: smallDriverId, vehicleId: smallVehicle.id, reason: 'Too early' },
    });
    expect(tooEarly.next).toHaveBeenCalled();
    expect(tooEarly.next.error).toMatchObject({ code: 'delivery_transfer_conflict' });
  });

  test('485: the delay sweep escalates a pickup no-show and leaves an on-time pickup alone', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const noShowJob = await makeJob(customerId, {
      driverId, status: 'assigned', dispatchState: 'assigned',
      pickupWindowEndMinutesFromNow: -60, deliveryWindowEndMinutesFromNow: 240, etaMinutesFromNow: 30,
    });
    const onTimeJob = await makeJob(customerId, {
      driverId, status: 'picked_up', dispatchState: 'assigned', pickedUp: true,
      pickupWindowEndMinutesFromNow: -60, deliveryWindowEndMinutesFromNow: 240, etaMinutesFromNow: 30,
    });
    const futureJob = await makeJob(customerId, {
      driverId, status: 'assigned', dispatchState: 'assigned',
      pickupWindowEndMinutesFromNow: 120, deliveryWindowEndMinutesFromNow: 240, etaMinutesFromNow: 30,
    });

    const result = await sweepDelayedDeliveries(pool, { now: new Date() });
    expect(result.escalated).toBeGreaterThanOrEqual(1);
    const { rows: [noShowIssue] } = await pool.query(
      `SELECT metadata FROM delivery_issues WHERE delivery_job_id = $1 AND code = 'delay' AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
      [noShowJob.id],
    );
    expect(noShowIssue).toBeDefined();
    expect(noShowIssue.metadata).toMatchObject({ autoDetected: true, trigger: 'pickup_no_show' });
    const { rows: [noShow] } = await pool.query('SELECT delay_escalated_at FROM delivery_jobs WHERE id = $1', [noShowJob.id]);
    expect(noShow.delay_escalated_at).not.toBeNull();
    const { rows: onTimeIssues } = await pool.query(
      `SELECT id FROM delivery_issues WHERE delivery_job_id = $1 AND code = 'delay' AND status = 'open'`,
      [onTimeJob.id],
    );
    expect(onTimeIssues).toHaveLength(0);
    const { rows: futureIssues } = await pool.query(
      `SELECT id FROM delivery_issues WHERE delivery_job_id = $1 AND code = 'delay' AND status = 'open'`,
      [futureJob.id],
    );
    expect(futureIssues).toHaveLength(0);
    // Cleanup: the no-show and on-time fixtures carry past pickup
    // windows by design; restore them so a later suite's window sweep
    // (Slice C 463) does not count the no-show job as expired.
    await restorePickupWindow([noShowJob.id, onTimeJob.id]);
  });
});
