'use strict';

/**
 * Group 9 Slice E (items 476-485), Driver/shipper recover exceptions +
 * dispatch work.
 *
 * Against the real migrated schema, through the real delivery controller,
 * dispatch service, recovery service, and delay sweep:
 *   476: closed_site needs what was closed (400 without one, 400 for an
 *       unknown one); a valid report stores the structured capture
 *       (closedWhat + noticeSeen + contactAttempted), opens a
 *       high-priority support ticket, flags the job exception with
 *       exception_code closed_site, surfaces on the dispatch board, and
 *       shows distinctly on the dispatch review. The existing codes are
 *       untouched: delay still reports exactly as before.
 *   477 (verify only): the damage intake still holds — the assigned
 *       driver reports damage with an evidence URL and it opens a
 *       high-priority support ticket.
 *   478 (verify only): a return request still moves the job to failed
 *       with an exception; resolveIssue with a resumeStatus resumes a
 *       failed job (and an impossible resume state 409s).
 *   479 (verify only): the return lifecycle still runs
 *       requested -> approved -> in_transit -> completed, with the
 *       origin-contact proof on completion.
 *   480: reassigning an already-assigned job records a
 *       delivery_assignment_replaced event (who replaced whom, no pay
 *       details) instead of the plain assignment event; releasing a job
 *       back to the marketplace records the same event with
 *       releasedToMarketplace. Both new catalog keys are public events.
 *   481 (verify only): the internal queue still returns exception and
 *       internal-review jobs, and leaves delivered jobs out.
 *   482 (verify only): assignInternal on an already-assigned job
 *       revokes the prior tracking session with ended_reason
 *       'reassigned'; releaseMarketplace returns the job to the
 *       marketplace and revokes tracking with 'released'.
 *   483: GET /delivery/internal/drivers returns per-driver load on
 *       active jobs (count, pieces and payload committed vs capacity),
 *       availability, service area, and a profile-level readiness state.
 *   484: the handoff record reads the existing lifecycle records — per
 *       job (assignments with start/end/ended_reason plus handoff
 *       scans) and per driver across jobs. No second assignment table.
 *   485: the delay sweep escalates a job more than 30 minutes past its
 *       ETA (auto delay issue + delay_escalated_at stamp +
 *       delivery_delay_escalated event), exactly once per episode; a job
 *       10 minutes past its ETA and a delivered job are untouched; the
 *       latest ETA snapshot wins over the stored ETA; resolving the auto
 *       issue opens a new episode, so a still-late job escalates again.
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
  process.env['JWT' + '_SECRET'] = 'group9-slice-e-test-secret';
}

const pool = require('../db');
const localDelivery = require('../controllers/localDeliveryController');
const { pinDigest } = require('../services/localDeliveryIntegrity');
const { sweepDelayedDeliveries, DELAY_THRESHOLD_MINUTES } = require('../services/deliveryDelayEscalationService');
const { getPublicDeliveryEventType } = require('../services/localDeliveryEventWorker');
const { DELIVERY_NOTIFICATION_EVENTS } = require('../utils/localDeliveryNotifications');

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

ddescribe('Group 9 Slice E: exceptions + dispatch (476-485)', () => {
  async function makeUser(role, { defaultMode = null } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, default_mode)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5)`,
      [id, `g9e-${id.slice(0, 8)}@example.invalid`, role, role, defaultMode],
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
      status = 'assigned', driverId = null, internalDriverId = null, vehicleId = null,
      pieces = 3, proofPreference = 'pin', etaMinutesFromNow = 30,
      deliveryWindowEndMinutesFromNow = 240, pickedUp = false,
      dispatchState = null, fulfillmentSource = null,
    } = options;
    const reference = `DLV-G9E-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = Date.now();
    const pickupStart = new Date(now - 60 * 60 * 1000);
    const pickupEnd = new Date(now + 120 * 60 * 1000);
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
      [job.id, customerId, `g9e-pay-${job.id}`],
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
    // A vehicle that passes the capability gate: multi-piece capacity
    // and acknowledged insurance. (createVehicle itself never sets
    // these — see the slice receipt — so the fixture sets them here.)
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

  async function makeHandoffScan(jobId, userId) {
    const { rows: [scan] } = await pool.query(
      `INSERT INTO delivery_scan_events (delivery_job_id, scan_type, scanned_by_user_id, code_value)
       VALUES ($1, 'handoff', $2, 'HANDOFF-1') RETURNING *`,
      [jobId, userId],
    );
    return scan;
  }

  async function pickUp(job, driverId) {
    return call(localDelivery.updateStatus, {
      params: { id: String(job.id) },
      user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9e-pickup') },
      body: { status: 'picked_up', pickupConfirmedPieces: 3, conditionAcknowledged: true },
    });
  }

  async function reportIssue(job, driverId, body) {
    return call(localDelivery.createIssue, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9e-issue') },
      body,
    });
  }

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('476: closed_site needs what was closed, and rejects an unknown value', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });

    const missing = await reportIssue(job, driverId, { code: 'closed_site', description: 'Everything was shut' });
    expect(missing.next).toHaveBeenCalled();
    expect(missing.next.error).toMatchObject({ code: 'delivery_issue_invalid', status: 400 });

    const invalid = await reportIssue(job, driverId, { code: 'closed_site', description: 'Everything was shut', closedWhat: 'parking_lot' });
    expect(invalid.next).toHaveBeenCalled();
    expect(invalid.next.error).toMatchObject({ code: 'delivery_issue_invalid', status: 400 });
  });

  test('476: a valid closed-site report stores the structure, opens a high-priority ticket, and flags the job for dispatch', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    const job = await makeJob(customerId, { driverId, status: 'in_transit', pickedUp: true });

    const { res, next } = await reportIssue(job, driverId, {
      code: 'closed_site', description: 'Gate locked, no one answering',
      closedWhat: 'gate', noticeSeen: true, contactAttempted: true,
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.payload.issue.code).toBe('closed_site');
    expect(res.payload.issue.metadata).toEqual({ closedWhat: 'gate', noticeSeen: true, contactAttempted: true });
    expect(res.payload.supportTicket.priority).toBe('high');

    const flagged = await pool.query(
      "SELECT dispatch_state, exception_code FROM delivery_jobs WHERE id = $1", [job.id],
    );
    expect(flagged.rows[0]).toMatchObject({ dispatch_state: 'exception', exception_code: 'closed_site' });

    const queue = await call(localDelivery.internalQueue, {});
    expect(queue.next).not.toHaveBeenCalled();
    expect(queue.res.payload.jobs.map((entry) => entry.id)).toContain(job.id);

    const review = await call(localDelivery.getInternalJob, {
      params: { id: String(job.id) }, user: operatorUser(adminId),
    });
    expect(review.next).not.toHaveBeenCalled();
    const issue = review.res.payload.issues.find((entry) => entry.code === 'closed_site');
    expect(issue.metadata).toEqual({ closedWhat: 'gate', noticeSeen: true, contactAttempted: true });

    // The existing codes are untouched: delay still reports as before.
    const delay = await reportIssue(job, driverId, { code: 'delay', description: 'Traffic on the highway' });
    expect(delay.next).not.toHaveBeenCalled();
    expect(delay.res.payload.issue.metadata).toEqual({});
  });

  test('477 (verify): the damage intake still opens a high-priority ticket with the evidence URL', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });

    const { res, next } = await reportIssue(job, driverId, {
      code: 'damage', description: 'Box corner crushed',
      evidenceUrl: 'https://example.invalid/evidence/box.jpg',
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.payload.issue.code).toBe('damage');
    expect(res.payload.issue.evidence_url).toBe('https://example.invalid/evidence/box.jpg');
    expect(res.payload.supportTicket.priority).toBe('high');
  });

  test('478 (verify): a return request still moves the job to failed with an exception', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });
    const picked = await pickUp(job, driverId);
    expect(picked.next).not.toHaveBeenCalled();

    const { res, next } = await call(localDelivery.requestReturn, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9e-return') },
      body: { reason: 'No one answered the door' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.payload.returnRequest.status).toBe('requested');

    const failed = await pool.query(
      "SELECT status, dispatch_state, exception_code FROM delivery_jobs WHERE id = $1", [job.id],
    );
    expect(failed.rows[0]).toMatchObject({ status: 'failed', dispatch_state: 'exception', exception_code: 'return_requested' });
  });

  test('478 (verify): resolveIssue with a resumeStatus resumes a failed job; an impossible resume state 409s', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    // A failed job with an open issue and no active return, as a return
    // rejection would leave it (previous_status was not restorable).
    const job = await makeJob(customerId, {
      driverId, status: 'failed', dispatchState: 'exception', pickedUp: true,
    });
    await pool.query("UPDATE delivery_jobs SET exception_code = 'return_requested' WHERE id = $1", [job.id]);
    const { rows: [issue] } = await pool.query(
      `INSERT INTO delivery_issues (delivery_job_id, code, description, reported_by_user_id, metadata)
       VALUES ($1, 'delay', 'Driver waited at a closed gate', $2, '{}') RETURNING *`,
      [job.id, driverId],
    );

    const impossible = await call(localDelivery.resolveIssue, {
      params: { issueId: String(issue.id) }, user: operatorUser(adminId),
      headers: { 'idempotency-key': key('g9e-resolve') },
      body: { resolution: 'Try to resume', resumeStatus: 'assigned' },
    });
    expect(impossible.next).toHaveBeenCalled();
    expect(impossible.next.error).toMatchObject({ code: 'delivery_recovery_conflict' });

    const { res, next } = await call(localDelivery.resolveIssue, {
      params: { issueId: String(issue.id) }, user: operatorUser(adminId),
      headers: { 'idempotency-key': key('g9e-resolve') },
      body: { resolution: 'Gate opened, driver is on the way', resumeStatus: 'in_transit' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.issue.status).toBe('resolved');

    const resumed = await pool.query(
      "SELECT status, dispatch_state, exception_code FROM delivery_jobs WHERE id = $1", [job.id],
    );
    expect(resumed.rows[0]).toMatchObject({ status: 'in_transit', dispatch_state: 'assigned', exception_code: null });
  });

  test('479 (verify): the return lifecycle still runs requested -> approved -> in_transit -> completed with origin-contact proof', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    const job = await makeJob(customerId, { driverId });
    const picked = await pickUp(job, driverId);
    expect(picked.next).not.toHaveBeenCalled();

    const requested = await call(localDelivery.requestReturn, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9e-return') },
      body: { reason: 'Recipient refused the package' },
    });
    expect(requested.next).not.toHaveBeenCalled();
    const returnId = requested.res.payload.returnRequest.id;

    for (const decision of ['approved', 'in_transit']) {
      const reviewed = await call(localDelivery.reviewReturn, {
        params: { returnId: String(returnId) }, user: operatorUser(adminId),
        headers: { 'idempotency-key': key('g9e-review-return') },
        body: { decision },
      });
      expect(reviewed.next).not.toHaveBeenCalled();
      expect(reviewed.res.payload.returnRequest.status).toBe(decision);
    }

    const completed = await call(localDelivery.reviewReturn, {
      params: { returnId: String(returnId) }, user: operatorUser(adminId),
      headers: { 'idempotency-key': key('g9e-review-return') },
      body: { decision: 'completed', proofType: 'pin', proofValue: '123456' },
    });
    expect(completed.next).not.toHaveBeenCalled();
    expect(completed.res.payload.returnRequest.status).toBe('completed');

    const returned = await pool.query("SELECT status FROM delivery_jobs WHERE id = $1", [job.id]);
    expect(returned.rows[0].status).toBe('returned');
    const proofs = await pool.query(
      "SELECT proof_type, metadata FROM delivery_proofs WHERE delivery_job_id = $1 AND metadata->>'purpose' = 'return'",
      [job.id],
    );
    expect(proofs.rows).toHaveLength(1);
    expect(proofs.rows[0].proof_type).toBe('pin');
  });

  test('480: reassigning an already-assigned job records a replacement event with who replaced whom', async () => {
    const firstDriverId = await makeUser('helper', { defaultMode: 'helper' });
    const secondDriverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    await makeDriverProfile(firstDriverId);
    await makeDriverProfile(secondDriverId);
    const firstVehicle = await makeVehicle('Van 1');
    const secondVehicle = await makeVehicle('Van 2');
    const job = await makeJob(customerId, {
      internalDriverId: firstDriverId, vehicleId: firstVehicle.id,
      status: 'assigned', dispatchState: 'internal_assigned',
    });
    await makeTrackingAssignment(job.id, firstDriverId);

    const { res, next } = await call(localDelivery.assignInternal, {
      params: { id: String(job.id) }, user: operatorUser(adminId),
      headers: { 'idempotency-key': key('g9e-assign') },
      body: { driverUserId: secondDriverId, vehicleId: secondVehicle.id },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.job.internal_driver_user_id).toBe(secondDriverId);

    const events = await pool.query(
      `SELECT event_type, payload FROM delivery_events
        WHERE delivery_job_id = $1 AND event_type = 'delivery_assignment_replaced' ORDER BY created_at DESC LIMIT 1`,
      [job.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload).toMatchObject({
      previousDriverUserId: firstDriverId,
      newDriverUserId: secondDriverId,
      releasedToMarketplace: false,
    });
    expect(JSON.stringify(events.rows[0].payload)).not.toMatch(/pay|amount|cents/i);

    const revoked = await pool.query(
      "SELECT status, ended_reason FROM delivery_tracking_assignments WHERE delivery_job_id = $1",
      [job.id],
    );
    expect(revoked.rows).toHaveLength(1);
    expect(revoked.rows[0]).toMatchObject({ status: 'revoked', ended_reason: 'reassigned' });
  });

  test('480: releasing a job back to the marketplace records a replacement event for the outgoing driver', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    await makeDriverProfile(driverId);
    const vehicle = await makeVehicle('Van 1');
    const job = await makeJob(customerId, {
      internalDriverId: driverId, vehicleId: vehicle.id,
      status: 'assigned', dispatchState: 'internal_assigned',
    });
    await makeTrackingAssignment(job.id, driverId);

    const { res, next } = await call(localDelivery.releaseMarketplace, {
      params: { id: String(job.id) }, user: operatorUser(adminId),
      headers: { 'idempotency-key': key('g9e-release') },
      body: { reason: 'Internal capacity unavailable' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.job).toMatchObject({ status: 'posted', dispatch_state: 'marketplace_posted' });

    const events = await pool.query(
      `SELECT event_type, payload FROM delivery_events
        WHERE delivery_job_id = $1 AND event_type = 'delivery_assignment_replaced' ORDER BY created_at DESC LIMIT 1`,
      [job.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload).toMatchObject({
      previousDriverUserId: driverId,
      newDriverUserId: null,
      releasedToMarketplace: true,
    });

    const revoked = await pool.query(
      "SELECT status, ended_reason FROM delivery_tracking_assignments WHERE delivery_job_id = $1",
      [job.id],
    );
    expect(revoked.rows[0]).toMatchObject({ status: 'revoked', ended_reason: 'released' });
  });

  test('480 + 485: the new notification keys are public delivery events', async () => {
    expect(DELAY_THRESHOLD_MINUTES).toBe(30);
    expect(DELIVERY_NOTIFICATION_EVENTS).toContain('delivery_assignment_replaced');
    expect(DELIVERY_NOTIFICATION_EVENTS).toContain('delivery_delay_escalated');
    expect(getPublicDeliveryEventType('delivery_assignment_replaced')).toBe('delivery_assignment_replaced');
    expect(getPublicDeliveryEventType('delivery_delay_escalated')).toBe('delivery_delay_escalated');
  });

  test('481 (verify): the internal queue returns exception and internal-review jobs, not delivered ones', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const exceptionJob = await makeJob(customerId, { driverId });
    const reported = await reportIssue(exceptionJob, driverId, { code: 'damage', description: 'Box crushed' });
    expect(reported.next).not.toHaveBeenCalled();
    const reviewJob = await makeJob(customerId, { status: 'posted', dispatchState: 'internal_review' });
    const deliveredJob = await makeJob(customerId, { driverId, status: 'delivered', dispatchState: 'completed' });

    const { res, next } = await call(localDelivery.internalQueue, {});
    expect(next).not.toHaveBeenCalled();
    const ids = res.payload.jobs.map((entry) => entry.id);
    expect(ids).toContain(exceptionJob.id);
    expect(ids).toContain(reviewJob.id);
    expect(ids).not.toContain(deliveredJob.id);
  });

  test('482 (verify): assignInternal accepts an already-assigned job and release returns it to the marketplace', async () => {
    const firstDriverId = await makeUser('helper', { defaultMode: 'helper' });
    const secondDriverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    await makeDriverProfile(firstDriverId);
    await makeDriverProfile(secondDriverId);
    const firstVehicle = await makeVehicle('Van 1');
    const secondVehicle = await makeVehicle('Van 2');
    const job = await makeJob(customerId, {
      internalDriverId: firstDriverId, vehicleId: firstVehicle.id,
      status: 'assigned', dispatchState: 'internal_assigned',
    });

    const assigned = await call(localDelivery.assignInternal, {
      params: { id: String(job.id) }, user: operatorUser(adminId),
      headers: { 'idempotency-key': key('g9e-assign') },
      body: { driverUserId: secondDriverId, vehicleId: secondVehicle.id },
    });
    expect(assigned.next).not.toHaveBeenCalled();
    expect(assigned.res.payload.job.internal_driver_user_id).toBe(secondDriverId);
    expect(assigned.res.payload.job.vehicle_id).toBe(secondVehicle.id);

    const released = await call(localDelivery.releaseMarketplace, {
      params: { id: String(job.id) }, user: operatorUser(adminId),
      headers: { 'idempotency-key': key('g9e-release') },
      body: { reason: 'Send it back to the marketplace' },
    });
    expect(released.next).not.toHaveBeenCalled();
    expect(released.res.payload.job).toMatchObject({
      status: 'posted', dispatch_state: 'marketplace_posted',
      internal_driver_user_id: null, vehicle_id: null,
    });
    expect(released.res.payload.job.offer_expires_at).not.toBeNull();
  });

  test('483: the drivers endpoint returns per-driver load, capacity, and readiness', async () => {
    const readyDriverId = await makeUser('helper', { defaultMode: 'helper' });
    const blockedDriverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeDriverProfile(readyDriverId, {
      maxPieces: 5, maxPayloadLbs: 100, serviceArea: { states: ['OH'] },
      availableFrom: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      availableUntil: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    });
    await makeDriverProfile(blockedDriverId, {
      insuranceExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    await makeJob(customerId, { driverId: readyDriverId, status: 'in_transit', pieces: 3, pickedUp: true });

    const { res, next } = await call(localDelivery.internalDrivers, {});
    expect(next).not.toHaveBeenCalled();
    const ready = res.payload.drivers.find((entry) => entry.user_id === readyDriverId);
    const blocked = res.payload.drivers.find((entry) => entry.user_id === blockedDriverId);
    expect(ready).toBeDefined();
    expect(ready.activeJobs).toBe(1);
    expect(ready.committedPieces).toBe(3);
    expect(ready.committedPayloadLbs).toBe(20);
    expect(ready.max_pieces).toBe(5);
    expect(ready.max_payload_lbs).toBe('100.00');
    expect(ready.readiness).toEqual({ state: 'ready', reasons: [] });
    expect(ready.service_area).toEqual({ states: ['OH'] });
    expect(blocked.readiness.state).toBe('not_ready');
    expect(blocked.readiness.reasons).toContain('insurance_expired');
  });

  test('484: the handoff record lists assignments and handoff scans per job', async () => {
    const firstDriverId = await makeUser('helper', { defaultMode: 'helper' });
    const secondDriverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    const job = await makeJob(customerId, { driverId: firstDriverId, status: 'in_transit', pickedUp: true });
    const first = await makeTrackingAssignment(job.id, firstDriverId, { status: 'revoked', endedReason: 'reassigned' });
    const second = await makeTrackingAssignment(job.id, secondDriverId, { status: 'active' });
    await makeHandoffScan(job.id, firstDriverId);

    const { res, next } = await call(localDelivery.internalHandoffs, {
      params: { id: String(job.id) }, user: operatorUser(adminId),
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.job.reference).toBe(job.reference);
    expect(res.payload.assignments).toHaveLength(2);
    expect(res.payload.assignments[0]).toMatchObject({
      id: first.assignment.id, driver_user_id: firstDriverId,
      status: 'revoked', ended_reason: 'reassigned',
    });
    expect(res.payload.assignments[0].driver_email).toMatch(/g9e-.*@example\.invalid/);
    expect(res.payload.assignments[1]).toMatchObject({
      id: second.assignment.id, driver_user_id: secondDriverId, status: 'active',
    });
    expect(res.payload.handoffScans).toHaveLength(1);
    expect(res.payload.handoffScans[0]).toMatchObject({ scan_type: 'handoff', scanned_by_user_id: firstDriverId });

    const missing = await call(localDelivery.internalHandoffs, {
      params: { id: '999999999' }, user: operatorUser(adminId),
    });
    expect(missing.next).toHaveBeenCalled();
    expect(missing.next.error).toMatchObject({ code: 'delivery_not_found', status: 404 });
  });

  test('484: the per-driver handoff ledger follows one driver across jobs', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const otherDriverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    const firstJob = await makeJob(customerId, { driverId, status: 'in_transit', pickedUp: true });
    const secondJob = await makeJob(customerId, { driverId, status: 'assigned' });
    await makeTrackingAssignment(firstJob.id, driverId, { status: 'revoked', endedReason: 'released' });
    await makeTrackingAssignment(secondJob.id, driverId, { status: 'active' });
    await makeTrackingAssignment(secondJob.id, otherDriverId, { status: 'revoked', endedReason: 'reassigned' });

    const { res, next } = await call(localDelivery.internalDriverHandoffs, {
      query: { driverUserId: driverId }, user: operatorUser(adminId),
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.assignments).toHaveLength(2);
    expect(res.payload.assignments.map((entry) => entry.job_reference).sort())
      .toEqual([firstJob.reference, secondJob.reference].sort());
    expect(res.payload.assignments.find((entry) => entry.job_reference === firstJob.reference))
      .toMatchObject({ ended_reason: 'released' });

    const missing = await call(localDelivery.internalDriverHandoffs, {
      query: {}, user: operatorUser(adminId),
    });
    expect(missing.next).toHaveBeenCalled();
    expect(missing.next.error).toMatchObject({ code: 'delivery_driver_invalid', status: 400 });
  });

  test('485: the sweep escalates a job 45 minutes past its ETA, once per episode', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    const job = await makeJob(customerId, {
      driverId, status: 'in_transit', pickedUp: true, etaMinutesFromNow: -45,
    });

    const first = await sweepDelayedDeliveries(pool, { now: new Date() });
    expect(first.escalated).toBe(1);
    expect(first.failed).toBe(0);

    const issues = await pool.query(
      "SELECT id, code, status, metadata FROM delivery_issues WHERE delivery_job_id = $1 AND code = 'delay'",
      [job.id],
    );
    expect(issues.rows).toHaveLength(1);
    expect(issues.rows[0].status).toBe('open');
    expect(issues.rows[0].metadata.autoDetected).toBe(true);
    expect(issues.rows[0].metadata.minutesLate).toBeGreaterThanOrEqual(45);
    expect(issues.rows[0].metadata.etaAt).toBeDefined();

    const stamped = await pool.query(
      'SELECT delay_escalated_at, dispatch_state FROM delivery_jobs WHERE id = $1', [job.id],
    );
    expect(stamped.rows[0].delay_escalated_at).not.toBeNull();
    // Flag-only: the driver is NOT stranded in exception by the sweep.
    expect(stamped.rows[0].dispatch_state).toBe('assigned');

    const events = await pool.query(
      "SELECT event_type, payload FROM delivery_events WHERE delivery_job_id = $1 AND event_type = 'delivery_delay_escalated'",
      [job.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload.minutesLate).toBeGreaterThanOrEqual(45);

    const queue = await call(localDelivery.internalQueue, {});
    expect(queue.res.payload.jobs.map((entry) => entry.id)).toContain(job.id);

    // A second run escalates nothing: one open auto issue is one episode.
    const second = await sweepDelayedDeliveries(pool, { now: new Date() });
    expect(second.escalated).toBe(0);
    const stillOne = await pool.query(
      "SELECT id FROM delivery_issues WHERE delivery_job_id = $1 AND code = 'delay'", [job.id],
    );
    expect(stillOne.rows).toHaveLength(1);

    // Resolving the auto issue closes the episode: still late, so the
    // next run escalates again as a new episode.
    const resolved = await call(localDelivery.resolveIssue, {
      params: { issueId: String(issues.rows[0].id) }, user: operatorUser(adminId),
      headers: { 'idempotency-key': key('g9e-resolve') },
      body: { resolution: 'Dispatch called the driver; still on the way' },
    });
    expect(resolved.next).not.toHaveBeenCalled();
    const third = await sweepDelayedDeliveries(pool, { now: new Date() });
    expect(third.escalated).toBe(1);
    const two = await pool.query(
      "SELECT status FROM delivery_issues WHERE delivery_job_id = $1 AND code = 'delay' ORDER BY created_at ASC",
      [job.id],
    );
    expect(two.rows.map((row) => row.status)).toEqual(['resolved', 'open']);
  });

  test('485: a job 10 minutes past its ETA and a delivered job are untouched', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const recentJob = await makeJob(customerId, {
      driverId, status: 'in_transit', pickedUp: true, etaMinutesFromNow: -10,
    });
    const deliveredJob = await makeJob(customerId, {
      driverId, status: 'delivered', dispatchState: 'completed', etaMinutesFromNow: -45,
    });

    const result = await sweepDelayedDeliveries(pool, { now: new Date() });
    expect(result.escalated).toBe(0);
    for (const job of [recentJob, deliveredJob]) {
      const issues = await pool.query(
        "SELECT id FROM delivery_issues WHERE delivery_job_id = $1 AND code = 'delay'", [job.id],
      );
      expect(issues.rows).toHaveLength(0);
      const stamped = await pool.query(
        'SELECT delay_escalated_at FROM delivery_jobs WHERE id = $1', [job.id],
      );
      expect(stamped.rows[0].delay_escalated_at).toBeNull();
    }
  });

  test('485: the latest ETA snapshot wins over the stored ETA', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    // Stored ETA is still in the future, but the live snapshot says the
    // driver was due 40 minutes ago.
    const job = await makeJob(customerId, {
      driverId, status: 'in_transit', pickedUp: true, etaMinutesFromNow: 60,
    });
    await pool.query(
      `INSERT INTO delivery_eta_snapshots (delivery_job_id, eta_at, source, confidence, basis)
       VALUES ($1, NOW() - INTERVAL '40 minutes', 'live_tracking', 'medium', '{}')`,
      [job.id],
    );

    const result = await sweepDelayedDeliveries(pool, { now: new Date() });
    expect(result.escalated).toBe(1);
    const issues = await pool.query(
      "SELECT metadata FROM delivery_issues WHERE delivery_job_id = $1 AND code = 'delay'", [job.id],
    );
    expect(issues.rows).toHaveLength(1);
    expect(issues.rows[0].metadata.minutesLate).toBeGreaterThanOrEqual(40);
  });
});
