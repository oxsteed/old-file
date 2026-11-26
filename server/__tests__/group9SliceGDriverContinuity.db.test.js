'use strict';

/**
 * Group 9 Slice G (items 496-500), Driver/shipper manage continuity.
 *
 * Against the real migrated schema, through the real delivery
 * controller, shift service, and tracking service:
 *   496 (server leg): a status update replayed with the same
 *       idempotency key returns the stored duplicate instead of
 *       applying twice — the replay contract the offline outbox
 *       flush relies on (stable key `delivery-outbox:<entry id>`).
 *       The outbox queue/flush/checklist logic itself is covered
 *       by client/src/utils/driverOfflineOutbox.test.mjs.
 *   497: after a job changes hands, the outgoing driver's detail
 *       read 404s and the incoming driver's succeeds — the signal
 *       the reconnect-and-resync flow reconciles against (a status
 *       change likewise shows up on the fresh read). The
 *       reassignment itself is covered by
 *       localDeliveryDispatchRecovery.test.js; this test covers the
 *       resync visibility of the handover.
 *   498: a driver's job access expires 7 days after the terminal
 *       stamp (410 delivery_access_expired); inside the window it
 *       still reads; the customer and ops keep access; the driver's
 *       history list, payout history, and receipt download stay
 *       readable after expiry.
 *   499: device transfer moves the live tracking assignment and
 *       consent to the new device and revokes the old one; another
 *       driver's device cannot be transferred; an already-revoked
 *       device cannot be transferred again.
 *   500: one open shift per driver (second start 409s); closeout
 *       refuses with the active-job list while a job is in
 *       progress; after the job completes, closeout summarizes the
 *       shift (jobs, distance, pieces, worked minutes, earnings,
 *       exceptions); open issues need an explicit confirmation;
 *       closing twice 409s; the closed shift is listed and readable.
 *
 * DB: disposable loopback database credit_statement_test only; the suite
 * skips otherwise. Run with STATEMENT_TEST_DATABASE_URL pointed at it.
 */
jest.unmock('pg');
jest.unmock('../db');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(async () => ({ success: true })),
}));

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test(_pr804_d|_group9g)?$/.test(url.pathname);
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
  process.env['JWT' + '_SECRET'] = 'group9-slice-g-test-secret';
}

const pool = require('../db');
const localDelivery = require('../controllers/localDeliveryController');
const trackingController = require('../controllers/deliveryTrackingController');
const trackingOpsController = require('../controllers/deliveryTrackingOpsController');
const trackingService = require('../services/deliveryTrackingService');
const recoveryService = require('../services/localDeliveryRecoveryService');
const { pinDigest } = require('../services/localDeliveryIntegrity');

jest.setTimeout(120000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.set = jest.fn(() => res);
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  res.send = jest.fn((payload) => { res.payload = payload; return res; });
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

ddescribe('Group 9 Slice G: manage continuity (496-500)', () => {
  async function makeUser(role, { defaultMode = null, timezone = null } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, default_mode, timezone)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5, $6)`,
      [id, `g9g-${id.slice(0, 8)}@example.invalid`, role, role, defaultMode, timezone],
    );
    return id;
  }

  function helperUser(id) {
    return { id, role: 'helper', default_mode: 'helper' };
  }

  function customerUser(id) {
    return { id, role: 'customer' };
  }

  function operatorUser(id) {
    return { id, role: 'admin' };
  }

  async function makeJob(customerId, options = {}) {
    const {
      status = 'assigned', driverId = null, internalDriverId = null,
      pieces = 3, proofPreference = 'pin',
      pickedUpAt = null, deliveredAt = null, cancelledAt = null,
    } = options;
    const reference = `DLV-G9G-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = Date.now();
    const pickupStart = new Date(now - 60 * 60 * 1000);
    const pickupEnd = new Date(now + 120 * 60 * 1000);
    const deliveryStart = new Date(now + 120 * 60 * 1000);
    const deliveryEnd = new Date(now + 240 * 60 * 1000);
    const etaAt = new Date(now + 30 * 60 * 1000);
    const dispatchState = status === 'delivered' ? 'completed'
      : status === 'posted' ? 'internal_review'
      : status === 'cancelled' ? 'completed' : 'assigned';
    const { rows: [job] } = await pool.query(
      `INSERT INTO delivery_jobs
         (reference, customer_user_id, helper_user_id, internal_driver_user_id,
          status, dispatch_state, fulfillment_source,
          origin_address, origin_city, origin_state, origin_lat, origin_lng,
          origin_contact_name, origin_contact_phone, origin_instructions,
          destination_address, destination_city, destination_state, destination_lat, destination_lng,
          destination_contact_name, destination_contact_phone, destination_instructions,
          distance_miles, duration_minutes, package_type, weight_lbs, pieces, notes,
          price_snapshot, customer_total_cents, driver_payout_cents, proof_preference, proof_pin_digest,
          pickup_window_start, pickup_window_end,
          delivery_window_start, delivery_window_end,
          estimated_arrival_at, eta_updated_at, picked_up_at, delivered_at, cancelled_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'marketplace',
          '1 Origin Way', 'Columbus', 'OH', 40.123456, -83.123456,
          'Olivia Origin', '5550101000', 'Ring the side bell',
          '2 Destination Way', 'Columbus', 'OH', 40.234567, -83.234567,
          'Dan Destination', '5550102000', 'Leave at the back door',
          8, 45, 'medium', 20, $7, 'Fragile vase inside',
          '{}', 2500, 1800, $8, $9,
          $10, $11, $12, $13,
          $14, NOW(), $15, $16, $17)
       RETURNING *`,
      [reference, customerId, driverId, internalDriverId, status, dispatchState,
        pieces, proofPreference,
        proofPreference === 'pin' ? pinDigest('123456', reference) : null,
        pickupStart, pickupEnd, deliveryStart, deliveryEnd,
        etaAt, pickedUpAt, deliveredAt, cancelledAt],
    );
    await pool.query(
      `INSERT INTO delivery_payments (delivery_job_id, delivery_extra_id, customer_user_id, amount_cents, status, captured_at, idempotency_key)
       VALUES ($1, NULL, $2, 2500, 'paid', NOW(), $3)`,
      [job.id, customerId, `g9g-pay-${job.id}`],
    );
    return job;
  }

  async function makeDriverProfile(userId, patch = {}) {
    await pool.query(
      `INSERT INTO delivery_driver_profiles
         (user_id, approved, active, vehicle_type, max_payload_lbs,
          cargo_length_in, cargo_width_in, cargo_height_in, equipment,
          service_area, max_pieces, fragile_supported, perishable_supported,
          insurance_acknowledged, insurance_expires_at, available_from, available_until, available)
       VALUES ($1, TRUE, TRUE, 'van', 200, 40, 40, 40, '{}'::jsonb, '{}'::jsonb, 10, TRUE, TRUE, TRUE, NULL, NULL, NULL, TRUE)`,
      [userId],
    );
  }

  async function makePayout(job, driverId, { status = 'accrued' } = {}) {
    const { rows: [payout] } = await pool.query(
      `INSERT INTO delivery_driver_payouts (delivery_job_id, driver_user_id, payout_cents, status, created_at, paid_at, payment_reference)
       VALUES ($1, $2, 1800, $3, NOW(), $4, $5) RETURNING *`,
      [job.id, driverId, status, status === 'paid' ? new Date() : null, status === 'paid' ? `g9g-ref-${job.id}` : null],
    );
    return payout;
  }

  async function startShift(driverId) {
    return call(localDelivery.startDriverShift, { user: helperUser(driverId), body: {} });
  }

  async function closeShift(driverId, shiftId, body = {}) {
    return call(localDelivery.closeDriverShift, { params: { id: String(shiftId) }, user: helperUser(driverId), body });
  }

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('496: a replayed status update returns the stored duplicate instead of applying twice', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId, status: 'assigned' });
    const replayKey = `delivery-outbox:${crypto.randomUUID()}`;
    const body = { status: 'picked_up', pickupConfirmedPieces: 3, conditionAcknowledged: true };
    const first = await call(localDelivery.updateStatus, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': replayKey }, body,
    });
    expect(first.next).not.toHaveBeenCalled();
    expect(first.res.payload.success).toBe(true);
    const second = await call(localDelivery.updateStatus, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': replayKey }, body,
    });
    expect(second.next).not.toHaveBeenCalled();
    expect(second.res.payload.duplicate).toBe(true);
    const { rows: [row] } = await pool.query('SELECT status, picked_up_at FROM delivery_jobs WHERE id = $1', [job.id]);
    expect(row.status).toBe('picked_up');
    expect(row.picked_up_at).toBeTruthy();
  });

  test('497: after a job changes hands, the outgoing driver loses the detail read and the incoming driver gains it', async () => {
    const driverA = await makeUser('helper', { defaultMode: 'helper' });
    const driverB = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId: driverA, status: 'assigned' });

    const before = await call(localDelivery.get, { params: { id: String(job.id) }, user: helperUser(driverA) });
    expect(before.next).not.toHaveBeenCalled();
    expect(before.res.payload.job.status).toBe('assigned');

    // The handover itself (assignInternal) is covered by
    // localDeliveryDispatchRecovery.test.js; here the job row is
    // moved to the new driver the way a reassignment leaves it.
    await pool.query(
      'UPDATE delivery_jobs SET helper_user_id = $2, internal_driver_user_id = NULL, updated_at = NOW() WHERE id = $1',
      [job.id, driverB],
    );

    const outgoing = await call(localDelivery.get, { params: { id: String(job.id) }, user: helperUser(driverA) });
    expect(outgoing.next).toHaveBeenCalled();
    expect(outgoing.next.error.code).toBe('delivery_not_found');
    const incoming = await call(localDelivery.get, { params: { id: String(job.id) }, user: helperUser(driverB) });
    expect(incoming.next).not.toHaveBeenCalled();
    expect(incoming.res.payload.job.status).toBe('assigned');

    // A status change while "offline" likewise shows up on the
    // fresh read: the resync reconciliation sees the new status.
    await pool.query("UPDATE delivery_jobs SET status = 'picked_up', picked_up_at = NOW() WHERE id = $1", [job.id]);
    const resynced = await call(localDelivery.get, { params: { id: String(job.id) }, user: helperUser(driverB) });
    expect(resynced.next).not.toHaveBeenCalled();
    expect(resynced.res.payload.job.status).toBe('picked_up');
  });

  test('498: driver job access expires 7 days after the terminal stamp; customer, ops, history, payouts, and receipts keep working', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const oldJob = await makeJob(customerId, { driverId, status: 'delivered', pickedUpAt: eightDaysAgo, deliveredAt: eightDaysAgo });
    const freshJob = await makeJob(customerId, { driverId, status: 'delivered', pickedUpAt: sixDaysAgo, deliveredAt: sixDaysAgo });
    await makeDriverProfile(driverId);
    await makePayout(oldJob, driverId);

    const expired = await call(localDelivery.get, { params: { id: String(oldJob.id) }, user: helperUser(driverId) });
    expect(expired.next).toHaveBeenCalled();
    expect(expired.next.error.status).toBe(410);
    expect(expired.next.error.code).toBe('delivery_access_expired');

    const inside = await call(localDelivery.get, { params: { id: String(freshJob.id) }, user: helperUser(driverId) });
    expect(inside.next).not.toHaveBeenCalled();
    expect(inside.res.payload.job.id).toBe(String(freshJob.id));

    const customer = await call(localDelivery.get, { params: { id: String(oldJob.id) }, user: customerUser(customerId) });
    expect(customer.next).not.toHaveBeenCalled();
    const ops = await call(localDelivery.getInternalJob, { params: { id: String(oldJob.id) }, user: operatorUser(adminId) });
    expect(ops.next).not.toHaveBeenCalled();

    // The driver's history list still returns the expired job.
    const list = await call(localDelivery.list, { user: helperUser(driverId), query: {} });
    expect(list.next).not.toHaveBeenCalled();
    expect(list.res.payload.jobs.map((entry) => String(entry.id))).toContain(String(oldJob.id));

    // Payout history still returns the accrued payout.
    const payouts = await call(localDelivery.listDriverPayouts, { user: helperUser(driverId), query: {} });
    expect(payouts.next).not.toHaveBeenCalled();
    expect(payouts.res.payload.payouts.map((entry) => String(entry.delivery_job_id))).toContain(String(oldJob.id));

    // The receipt download stays available after expiry (D-91).
    const receipt = await call(localDelivery.downloadJobReceipt, { params: { id: String(oldJob.id) }, user: helperUser(driverId) });
    expect(receipt.next).not.toHaveBeenCalled();
    expect(Buffer.isBuffer(receipt.res.payload)).toBe(true);
  });

  test('499: device transfer moves the live assignment and consent to the new device and revokes the old one', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const otherId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId, status: 'assigned' });
    const { rows: [oldDevice] } = await pool.query(
      `INSERT INTO delivery_tracking_devices (kind, driver_user_id, device_label, platform, status)
       VALUES ('driver_phone', $1, 'Old phone', 'test', 'active') RETURNING *`,
      [driverId],
    );
    await trackingService.grantConsent({ deliveryJobId: job.id, driverUserId: driverId, deviceId: oldDevice.id });
    const assignment = await trackingService.startTracking({ deliveryJobId: job.id, deviceId: oldDevice.id, driverUserId: driverId });
    expect(assignment.status).toBe('active');

    const transferred = await call(trackingController.transferDevice, {
      user: helperUser(driverId),
      body: { oldDeviceId: oldDevice.id, deviceLabel: 'New phone', platform: 'test' },
    });
    expect(transferred.next).not.toHaveBeenCalled();
    expect(transferred.res.statusCode).toBe(201);
    const newDevice = transferred.res.payload.device;
    expect(newDevice.kind).toBe('driver_phone');
    expect(String(newDevice.driver_user_id)).toBe(driverId);
    expect(transferred.res.payload.transferredAssignments).toHaveLength(1);
    expect(transferred.res.payload.transferredAssignments[0].deliveryJobId).toBe(job.id);

    const { rows: [moved] } = await pool.query('SELECT device_id, status FROM delivery_tracking_assignments WHERE id = $1', [assignment.id]);
    expect(String(moved.device_id)).toBe(String(newDevice.id));
    expect(moved.status).toBe('active');
    const { rows: [oldRow] } = await pool.query('SELECT status FROM delivery_tracking_devices WHERE id = $1', [oldDevice.id]);
    expect(oldRow.status).toBe('revoked');
    const { rows: [consent] } = await pool.query(
      'SELECT device_id FROM delivery_tracking_consent WHERE delivery_job_id = $1 AND driver_user_id = $2 AND revoked_at IS NULL',
      [job.id, driverId],
    );
    expect(String(consent.device_id)).toBe(String(newDevice.id));

    // Another driver's device cannot be transferred. The tracking
    // controller answers errors on res (sendServiceError), not next.
    const { rows: [strangerDevice] } = await pool.query(
      `INSERT INTO delivery_tracking_devices (kind, driver_user_id, device_label, status)
       VALUES ('driver_phone', $1, 'Stranger phone', 'active') RETURNING *`,
      [otherId],
    );
    const forbidden = await call(trackingController.transferDevice, {
      user: helperUser(driverId),
      body: { oldDeviceId: strangerDevice.id, deviceLabel: 'Takeover', platform: 'test' },
    });
    expect(forbidden.next).not.toHaveBeenCalled();
    expect(forbidden.res.statusCode).toBe(403);
    expect(forbidden.res.payload.error).toBe('tracking_forbidden');

    // An already-revoked device cannot be transferred again.
    const again = await call(trackingController.transferDevice, {
      user: helperUser(driverId),
      body: { oldDeviceId: oldDevice.id, deviceLabel: 'Retry', platform: 'test' },
    });
    expect(again.next).not.toHaveBeenCalled();
    expect(again.res.statusCode).toBe(409);
    expect(again.res.payload.error).toBe('tracking_device_revoked');
  });

  // Group 9 partials Wave 2 Batch Q (491, G9-B11, D-559): the driver
  // history list filters by status and pages, so a driver with 100+
  // jobs can find an old completed delivery.
  test('491: the driver history list filters by status and pages', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const now = new Date();
    const activeJob = await makeJob(customerId, { driverId, status: 'assigned' });
    const doneA = await makeJob(customerId, { driverId, status: 'delivered', pickedUpAt: now, deliveredAt: now });
    const doneB = await makeJob(customerId, { driverId, status: 'delivered', pickedUpAt: now, deliveredAt: now });

    const completed = await call(localDelivery.list, { user: helperUser(driverId), query: { mine: '1', status: 'completed' } });
    expect(completed.next).not.toHaveBeenCalled();
    expect(completed.res.payload.jobs.map((entry) => String(entry.id)).sort())
      .toEqual([String(doneA.id), String(doneB.id)].sort());
    expect(completed.res.payload.total).toBe(2);

    const active = await call(localDelivery.list, { user: helperUser(driverId), query: { mine: '1', status: 'active' } });
    expect(active.next).not.toHaveBeenCalled();
    expect(active.res.payload.jobs.map((entry) => String(entry.id))).toEqual([String(activeJob.id)]);
    expect(active.res.payload.total).toBe(1);

    // Second page of the completed history: one row, same total.
    const page2 = await call(localDelivery.list, { user: helperUser(driverId), query: { mine: '1', status: 'completed', limit: '1', offset: '1' } });
    expect(page2.next).not.toHaveBeenCalled();
    expect(page2.res.payload.jobs).toHaveLength(1);
    expect(page2.res.payload.total).toBe(2);
    expect([String(doneA.id), String(doneB.id)]).toContain(String(page2.res.payload.jobs[0].id));

    // The unfiltered list still returns all three jobs.
    const all = await call(localDelivery.list, { user: helperUser(driverId), query: {} });
    expect(all.next).not.toHaveBeenCalled();
    expect(all.res.payload.jobs.map((entry) => String(entry.id))).toEqual(
      expect.arrayContaining([String(activeJob.id), String(doneA.id), String(doneB.id)]),
    );
  });

  // Group 9 partials Wave 2 Batch Q (498, G9-B3, D-560): the live
  // tracking session ends with the job, and ingest is refused after.
  async function startLiveTracking(job, driverId) {
    const { rows: [device] } = await pool.query(
      `INSERT INTO delivery_tracking_devices (kind, driver_user_id, device_label, platform, status)
       VALUES ('driver_phone', $1, 'Test phone', 'test', 'active') RETURNING *`,
      [driverId],
    );
    await trackingService.grantConsent({ deliveryJobId: job.id, driverUserId: driverId, deviceId: device.id });
    const assignment = await trackingService.startTracking({ deliveryJobId: job.id, deviceId: device.id, driverUserId: driverId });
    return { device, assignment };
  }

  async function walkToDelivered(job, driverId) {
    const picked = await call(localDelivery.updateStatus, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9q-pickup') },
      body: { status: 'picked_up', pickupConfirmedPieces: 3, conditionAcknowledged: true },
    });
    expect(picked.next).not.toHaveBeenCalled();
    const transit = await call(localDelivery.updateStatus, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9q-transit') },
      body: { status: 'in_transit' },
    });
    expect(transit.next).not.toHaveBeenCalled();
    const delivered = await call(localDelivery.updateStatus, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9q-delivered') },
      body: { status: 'delivered', proofType: 'pin', proofValue: '123456' },
    });
    expect(delivered.next).not.toHaveBeenCalled();
    expect(delivered.res.payload.job.status).toBe('delivered');
  }

  async function ingest(job, driverId) {
    return call(trackingController.ingestLocations, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      body: { points: [{ latitude: 40.123456, longitude: -83.123456, recordedAt: new Date().toISOString() }] },
    });
  }

  test('498 (G9-B3): delivering a job ends its live tracking session and ingest is refused', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId, status: 'assigned' });
    const { device, assignment } = await startLiveTracking(job, driverId);
    expect(assignment.status).toBe('active');

    await walkToDelivered(job, driverId);

    const { rows: [ended] } = await pool.query(
      'SELECT status, ended_reason FROM delivery_tracking_assignments WHERE id = $1', [assignment.id],
    );
    expect(ended.status).toBe('completed');
    expect(ended.ended_reason).toBe('delivered');

    const refused = await ingest(job, driverId);
    expect(refused.next).not.toHaveBeenCalled();
    expect(refused.res.statusCode).toBe(409);
    expect(refused.res.payload.error).toBe('tracking_job_terminal');

    // No new tracking session can start for the delivered job.
    const restart = await call(trackingController.startTracking, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      body: { deviceId: device.id, sourcePolicy: 'driver_gps' },
    });
    expect(restart.next).not.toHaveBeenCalled();
    expect(restart.res.statusCode).toBe(400);
    expect(restart.res.payload.error).toBe('tracking_invalid_delivery_status');
  });

  test('498 (G9-B3): cancelling a job revokes its live tracking session', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId, status: 'assigned' });
    const { assignment } = await startLiveTracking(job, driverId);

    const cancelled = await call(localDelivery.updateStatus, {
      params: { id: String(job.id) }, user: customerUser(customerId),
      headers: { 'idempotency-key': key('g9q-cancel') },
      body: { status: 'cancelled', reason: 'Customer changed mind' },
    });
    expect(cancelled.next).not.toHaveBeenCalled();
    expect(cancelled.res.payload.job.status).toBe('cancelled');

    const { rows: [ended] } = await pool.query(
      'SELECT status, ended_reason FROM delivery_tracking_assignments WHERE id = $1', [assignment.id],
    );
    expect(ended.status).toBe('revoked');
    expect(ended.ended_reason).toBe('cancelled');

    const refused = await ingest(job, driverId);
    expect(refused.res.statusCode).toBe(409);
    expect(refused.res.payload.error).toBe('tracking_job_terminal');
  });

  test('498 (G9-B6): a driver cannot file issues or extras on a job whose access expired; inside the window and the customer can', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const oldJob = await makeJob(customerId, { driverId, status: 'delivered', pickedUpAt: eightDaysAgo, deliveredAt: eightDaysAgo });
    const freshJob = await makeJob(customerId, { driverId, status: 'delivered', pickedUpAt: sixDaysAgo, deliveredAt: sixDaysAgo });

    const expiredIssue = await call(localDelivery.createIssue, {
      params: { id: String(oldJob.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9q-old-issue') },
      body: { code: 'delay', description: 'Traffic on the highway' },
    });
    expect(expiredIssue.next).toHaveBeenCalled();
    expect(expiredIssue.next.error).toMatchObject({ code: 'delivery_access_expired', status: 410 });

    const expiredExtra = await call(localDelivery.createExtra, {
      params: { id: String(oldJob.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9q-old-extra') },
      body: { category: 'waiting', amountCents: 500, notes: 'Waited at the gate' },
    });
    expect(expiredExtra.next).toHaveBeenCalled();
    expect(expiredExtra.next.error).toMatchObject({ code: 'delivery_access_expired', status: 410 });

    // Inside the 7-day window the driver can still report.
    const freshIssue = await call(localDelivery.createIssue, {
      params: { id: String(freshJob.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9q-fresh-issue') },
      body: { code: 'delay', description: 'Traffic on the highway' },
    });
    expect(freshIssue.next).not.toHaveBeenCalled();
    expect(freshIssue.res.statusCode).toBe(201);

    const freshExtra = await call(localDelivery.createExtra, {
      params: { id: String(freshJob.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9q-fresh-extra') },
      body: { category: 'waiting', amountCents: 500, notes: 'Waited at the gate' },
    });
    expect(freshExtra.next).not.toHaveBeenCalled();
    expect(freshExtra.res.statusCode).toBe(201);

    // The shipper's access never expires: the customer can still
    // file on the old delivered job.
    const customerIssue = await call(localDelivery.createIssue, {
      params: { id: String(oldJob.id) }, user: customerUser(customerId),
      headers: { 'idempotency-key': key('g9q-customer-issue') },
      body: { code: 'damage', description: 'Box arrived dented' },
    });
    expect(customerIssue.next).not.toHaveBeenCalled();
    expect(customerIssue.res.statusCode).toBe(201);
  });

  test('498 (G9-B6, runner): a driver reschedule request on an expired job 410s before the operation runs', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const oldJob = await makeJob(customerId, { driverId, status: 'delivered', pickedUpAt: eightDaysAgo, deliveredAt: eightDaysAgo });
    const res = mockRes();
    const next = mockNext();
    await recoveryService.requestReschedule({
      params: { id: String(oldJob.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9q-runner') }, body: {},
    }, res, next);
    expect(next).toHaveBeenCalled();
    expect(next.error).toMatchObject({ code: 'delivery_access_expired', status: 410 });
  });

  test('499 (G9-B7): a transfer with a stranded outbox records strand rows ops can list and reconcile', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const otherId = await makeUser('helper', { defaultMode: 'helper' });
    const adminId = await makeUser('admin');
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId, status: 'assigned' });
    const strangerJob = await makeJob(customerId, { driverId: otherId, status: 'assigned' });
    const { rows: [oldDevice] } = await pool.query(
      `INSERT INTO delivery_tracking_devices (kind, driver_user_id, device_label, platform, status)
       VALUES ('driver_phone', $1, 'Old phone', 'test', 'active') RETURNING *`,
      [driverId],
    );
    await trackingService.grantConsent({ deliveryJobId: job.id, driverUserId: driverId, deviceId: oldDevice.id });
    await trackingService.startTracking({ deliveryJobId: job.id, deviceId: oldDevice.id, driverUserId: driverId });

    const transferred = await call(trackingController.transferDevice, {
      user: helperUser(driverId),
      body: {
        oldDeviceId: oldDevice.id, deviceLabel: 'New phone', platform: 'test',
        strandedOutbox: [
          { deliveryJobId: job.id, queuedActions: 2, unsyncedPoints: 5 },
          { deliveryJobId: strangerJob.id, queuedActions: 9, unsyncedPoints: 9 },
        ],
      },
    });
    expect(transferred.next).not.toHaveBeenCalled();
    expect(transferred.res.statusCode).toBe(201);
    // Only the driver's own job is recorded; counts for a job the
    // driver does not participate in are skipped, never stored.
    expect(transferred.res.payload.stranded).toHaveLength(1);
    expect(transferred.res.payload.stranded[0]).toMatchObject({
      delivery_job_id: job.id, queued_actions: 2, unsynced_points: 5,
      source: 'transfer', status: 'pending',
    });
    const strandId = transferred.res.payload.stranded[0].id;

    const listed = await call(trackingOpsController.listDeviceStrands, { user: operatorUser(adminId), query: {} });
    expect(listed.next).not.toHaveBeenCalled();
    expect(listed.res.statusCode).toBe(200);
    expect(listed.res.payload.strands.map((entry) => String(entry.id))).toContain(String(strandId));

    const reconciled = await call(trackingOpsController.reconcileDeviceStrand, {
      params: { strandId: String(strandId) }, user: operatorUser(adminId),
      body: { note: 'Re-keyed the pickup from the driver by phone' },
    });
    expect(reconciled.next).not.toHaveBeenCalled();
    expect(reconciled.res.payload.strand.status).toBe('reconciled');
    expect(reconciled.res.payload.strand.reconcile_note).toBe('Re-keyed the pickup from the driver by phone');

    const twice = await call(trackingOpsController.reconcileDeviceStrand, {
      params: { strandId: String(strandId) }, user: operatorUser(adminId),
      body: { note: 'Again' },
    });
    expect(twice.next).not.toHaveBeenCalled();
    expect(twice.res.statusCode).toBe(409);
    expect(twice.res.payload.code).toBe('tracking_strand_unavailable');
  });

  test('499 (G9-B7): a lost-device report records strands; another driver cannot report them', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const otherId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId, status: 'assigned' });
    const { rows: [device] } = await pool.query(
      `INSERT INTO delivery_tracking_devices (kind, driver_user_id, device_label, platform, status)
       VALUES ('driver_phone', $1, 'Lost phone', 'test', 'active') RETURNING *`,
      [driverId],
    );

    const reported = await call(trackingController.reportDeviceStrands, {
      user: helperUser(driverId),
      body: { deviceId: device.id, strandedOutbox: [{ deliveryJobId: job.id, queuedActions: 1, unsyncedPoints: 0 }] },
    });
    expect(reported.next).not.toHaveBeenCalled();
    expect(reported.res.statusCode).toBe(201);
    expect(reported.res.payload.stranded).toHaveLength(1);
    expect(reported.res.payload.stranded[0]).toMatchObject({
      delivery_job_id: job.id, queued_actions: 1, source: 'lost', status: 'pending',
    });

    const forbidden = await call(trackingController.reportDeviceStrands, {
      user: helperUser(otherId),
      body: { deviceId: device.id, strandedOutbox: [{ deliveryJobId: job.id, queuedActions: 1, unsyncedPoints: 0 }] },
    });
    expect(forbidden.next).not.toHaveBeenCalled();
    expect(forbidden.res.statusCode).toBe(403);
    expect(forbidden.res.payload.error).toBe('tracking_forbidden');

    const invalid = await call(trackingController.reportDeviceStrands, {
      user: helperUser(driverId),
      body: { deviceId: device.id, strandedOutbox: [{ deliveryJobId: job.id, queuedActions: -1, unsyncedPoints: 0 }] },
    });
    expect(invalid.next).not.toHaveBeenCalled();
    expect(invalid.res.statusCode).toBe(400);
    expect(invalid.res.payload.error).toBe('tracking_stranded_invalid');
  });

  test('500: one open shift; closeout blocks on active jobs, summarizes after completion, and needs open-issue confirmation', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeDriverProfile(driverId);

    const started = await startShift(driverId);
    expect(started.next).not.toHaveBeenCalled();
    expect(started.res.statusCode).toBe(201);
    expect(started.res.payload.shift.status).toBe('open');
    const shiftId = started.res.payload.shift.id;

    const second = await startShift(driverId);
    expect(second.next).toHaveBeenCalled();
    expect(second.next.error.code).toBe('delivery_shift_already_open');

    const job = await makeJob(customerId, { driverId, status: 'assigned' });
    const blocked = await closeShift(driverId, shiftId, {});
    expect(blocked.next).toHaveBeenCalled();
    expect(blocked.next.error.code).toBe('delivery_shift_active_job');
    expect(blocked.next.error.fields.activeJobs.map((entry) => String(entry.id))).toContain(String(job.id));

    // Complete the job inside the shift window, with its payout.
    // The state-integrity trigger enforces the state machine, so
    // the job walks assigned -> picked_up -> in_transit ->
    // delivered, and the delivered transition needs proof_verified_at.
    const pickedUpAt = new Date(Date.now() - 45 * 60 * 1000);
    await pool.query(
      "UPDATE delivery_jobs SET status = 'picked_up', picked_up_at = $2, updated_at = NOW() WHERE id = $1",
      [job.id, pickedUpAt],
    );
    await pool.query(
      "UPDATE delivery_jobs SET status = 'in_transit', updated_at = NOW() WHERE id = $1",
      [job.id],
    );
    await pool.query(
      "UPDATE delivery_jobs SET status = 'delivered', dispatch_state = 'completed', delivered_at = NOW(), proof_verified_at = NOW(), updated_at = NOW() WHERE id = $1",
      [job.id],
    );
    await makePayout(job, driverId);
    await pool.query(
      `INSERT INTO delivery_issues (delivery_job_id, code, description, status, created_at)
       VALUES ($1, 'delay', 'Traffic on the highway', 'open', NOW())`,
      [job.id],
    );

    const unconfirmed = await closeShift(driverId, shiftId, {});
    expect(unconfirmed.next).toHaveBeenCalled();
    expect(unconfirmed.next.error.code).toBe('delivery_shift_open_issues');
    expect(unconfirmed.next.error.fields.openIssues).toHaveLength(1);
    expect(unconfirmed.next.error.fields.openIssues[0].code).toBe('delay');

    const closed = await closeShift(driverId, shiftId, { confirmOpenIssues: true });
    expect(closed.next).not.toHaveBeenCalled();
    expect(closed.res.payload.shift.status).toBe('closed');
    const summary = closed.res.payload.shift.closeoutSummary;
    expect(summary.jobsCompleted).toBe(1);
    expect(summary.distanceMiles).toBe(8);
    expect(summary.pieces).toBe(3);
    expect(summary.workedMinutes).toBeGreaterThanOrEqual(44);
    expect(summary.earningsAccruedCents).toBe(1800);
    expect(summary.exceptionsCount).toBe(1);
    expect(summary.openIssuesConfirmed).toBe(true);
    expect(summary.jobs[0].reference).toBe(job.reference);

    const twice = await closeShift(driverId, shiftId, { confirmOpenIssues: true });
    expect(twice.next).toHaveBeenCalled();
    expect(twice.next.error.code).toBe('delivery_shift_already_closed');

    const open = await call(localDelivery.getOpenDriverShift, { user: helperUser(driverId) });
    expect(open.next).not.toHaveBeenCalled();
    expect(open.res.payload.shift).toBeNull();

    const list = await call(localDelivery.listDriverShifts, { user: helperUser(driverId) });
    expect(list.next).not.toHaveBeenCalled();
    expect(list.res.payload.shifts.map((entry) => String(entry.id))).toContain(String(shiftId));
    const one = await call(localDelivery.getDriverShift, { params: { id: String(shiftId) }, user: helperUser(driverId) });
    expect(one.next).not.toHaveBeenCalled();
    expect(one.res.payload.shift.status).toBe('closed');
  });

  test('500 (G9-B2): a voided payout does not count in the shift closeout', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeDriverProfile(driverId);

    const started = await startShift(driverId);
    expect(started.next).not.toHaveBeenCalled();
    const shiftId = started.res.payload.shift.id;

    const job = await makeJob(customerId, { driverId, status: 'assigned' });
    const pickedUpAt = new Date(Date.now() - 45 * 60 * 1000);
    await pool.query(
      "UPDATE delivery_jobs SET status = 'picked_up', picked_up_at = $2, updated_at = NOW() WHERE id = $1",
      [job.id, pickedUpAt],
    );
    await pool.query(
      "UPDATE delivery_jobs SET status = 'in_transit', updated_at = NOW() WHERE id = $1",
      [job.id],
    );
    await pool.query(
      "UPDATE delivery_jobs SET status = 'delivered', dispatch_state = 'completed', delivered_at = NOW(), proof_verified_at = NOW(), updated_at = NOW() WHERE id = $1",
      [job.id],
    );
    // One live accrued payout and one voided payout in the window.
    await makePayout(job, driverId);
    const voidedJob = await makeJob(customerId, {
      driverId, status: 'delivered',
      pickedUpAt: new Date(Date.now() - 30 * 60 * 1000),
      deliveredAt: new Date(),
    });
    await makePayout(voidedJob, driverId, { status: 'voided' });

    const closed = await closeShift(driverId, shiftId, { confirmOpenIssues: true });
    expect(closed.next).not.toHaveBeenCalled();
    expect(closed.res.payload.shift.status).toBe('closed');
    const summary = closed.res.payload.shift.closeoutSummary;
    expect(summary.jobsCompleted).toBe(2);
    // The voided $18.00 is not accrued earnings and not a live payout.
    expect(summary.earningsAccruedCents).toBe(1800);
    expect(summary.payoutsCount).toBe(1);
  });
});
