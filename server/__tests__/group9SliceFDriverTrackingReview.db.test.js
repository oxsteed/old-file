'use strict';

/**
 * Group 9 Slice F (items 486-495), Driver/shipper track shipments +
 * review work.
 *
 * Against the real migrated schema, through the real delivery
 * controller, services, and weekly-report sweep:
 *   486 (verify only): a signed tracking link resolves through the
 *       public endpoint — reference, milestones, ETA, masked
 *       addresses — and the public page now also lists the shipment's
 *       documents (D-82).
 *   487 (verify only): the milestone notification catalog still
 *       carries the full milestone set.
 *   488: the per-shipment exception summary mixes issues, returns,
 *       reschedules, failed dispatch attempts, and delay escalations
 *       into one timeline with an open count; the ops aggregate groups
 *       open issues by code and lists open-exception jobs; a stranger
 *       gets a 404.
 *   489: the participant document list names verified proofs and
 *       item photos with their signed-URL paths; a stranger gets a
 *       404; the public tracking response carries the same list.
 *   490: the OxSteed receipt builds from the job record (reference,
 *       route, dates, pieces, driver, proof, amounts) and downloads
 *       as a PDF for the customer and the driver; a stranger gets a
 *       404; the Stripe receipt link is untouched (still on the
 *       payment row).
 *   491 (verify only): the driver job list still returns delivered
 *       and cancelled jobs as completed history.
 *   492 (verify only): the driver payout history still returns the
 *       accrued payout with its job reference.
 *   493: an ops payout adjustment persists the reason with the
 *       before/after amounts and the operator, and the driver history
 *       surfaces it; a missing reason 400s, a paid payout 409s, and
 *       an unchanged amount 400s.
 *   494: a driver files a dispute on a delivered assignment (own
 *       subject + status, linked support ticket); a second open
 *       dispute on the same subject 409s; a dispute on a posted job
 *       409s; ops moves it under_review then resolved with a
 *       resolution, and the driver sees the status.
 *   495: week bounds are Monday-Sunday in the driver's timezone
 *       (a Monday 02:00 UTC delivery is still the previous week in
 *       America/New_York); the weekly report aggregates completed
 *       jobs, distance, pieces, worked minutes, accrued/paid
 *       earnings, adjustments, and exceptions; the sweep stores one
 *       report per driver per week, only for active weeks, and a
 *       re-run stores nothing new.
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
  process.env['JWT' + '_SECRET'] = 'group9-slice-f-test-secret';
}

const pool = require('../db');
const localDelivery = require('../controllers/localDeliveryController');
const trackingLinkController = require('../controllers/deliveryTrackingLinkController');
const linkService = require('../services/deliveryTrackingLinkService');
const { pinDigest } = require('../services/localDeliveryIntegrity');
const { DELIVERY_NOTIFICATION_EVENTS } = require('../utils/localDeliveryNotifications');
const { buildDeliveryReceiptData } = require('../services/deliveryReceiptPdf');
const {
  weekBoundsForDate, buildWeeklyReport, generateWeeklyReports,
} = require('../services/deliveryWeeklyReportService');

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

ddescribe('Group 9 Slice F: track shipments + review work (486-495)', () => {
  async function makeUser(role, { defaultMode = null, timezone = null } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, default_mode, timezone)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5, $6)`,
      [id, `g9f-${id.slice(0, 8)}@example.invalid`, role, role, defaultMode, timezone],
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
    const reference = `DLV-G9F-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
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
      [job.id, customerId, `g9f-pay-${job.id}`],
    );
    return job;
  }

  async function makeDriverProfile(userId, patch = {}) {
    const profile = {
      approved: true, active: true, vehicleType: 'van', maxPayloadLbs: 200,
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
          insurance_acknowledged, insurance_expires_at, available_from, available_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16, $17)`,
      [userId, profile.approved, profile.active, profile.vehicleType, profile.maxPayloadLbs,
        profile.cargoLengthIn, profile.cargoWidthIn, profile.cargoHeightIn,
        JSON.stringify(profile.equipment), JSON.stringify(profile.serviceArea),
        profile.maxPieces, profile.fragileSupported, profile.perishableSupported,
        profile.insuranceAcknowledged, profile.insuranceExpiresAt,
        profile.availableFrom, profile.availableUntil],
    );
    return profile;
  }

  async function makePayout(job, driverId, { status = 'accrued', createdAt = null, paidAt = null } = {}) {
    const { rows: [payout] } = await pool.query(
      `INSERT INTO delivery_driver_payouts (delivery_job_id, driver_user_id, payout_cents, status, created_at, paid_at, payment_reference)
       VALUES ($1, $2, 1800, $3, COALESCE($4, NOW()), $5, $6) RETURNING *`,
      [job.id, driverId, status, createdAt, paidAt, status === 'paid' ? `g9f-ref-${job.id}` : null],
    );
    return payout;
  }

  async function reportIssue(job, driverId, body) {
    return call(localDelivery.createIssue, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9f-issue') },
      body,
    });
  }

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('486 (verify): a signed tracking link resolves to milestones, ETA, masked addresses, and the shipment documents', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId, status: 'delivered', pickedUpAt: new Date(Date.now() - 60 * 60 * 1000), deliveredAt: new Date() });
    await pool.query(
      `INSERT INTO delivery_proofs (delivery_job_id, proof_type, proof_value, object_key, submitted_by_user_id, verification_status, verified_at)
       VALUES ($1, 'pin', '123456', 'delivery-private/proof.jpg', $2, 'verified', NOW())`,
      [job.id, driverId],
    );
    const link = await linkService.createLink({ deliveryJobId: job.id, createdByUserId: customerId });
    const { res, next } = await call(trackingLinkController.publicTrack, { params: { token: link.token } });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.reference).toBe(job.reference);
    expect(Array.isArray(res.payload.milestones)).toBe(true);
    expect(res.payload.milestones.length).toBeGreaterThan(0);
    expect(res.payload.milestones.map((entry) => entry.key)).toContain('delivered');
    expect(res.payload.maskedPickup).toBeTruthy();
    expect(res.payload.maskedDropoff).toBeTruthy();
    expect(res.payload.eta).toBeDefined();
    expect(Array.isArray(res.payload.documents)).toBe(true);
    const proof = res.payload.documents.find((entry) => entry.kind === 'proof');
    expect(proof).toBeDefined();
    expect(proof.proofType).toBe('pin');
    expect(proof.verificationStatus).toBe('verified');
  });

  test('487 (verify): the milestone notification catalog still carries the full milestone set', () => {
    for (const event of ['delivery_posted', 'delivery_assigned', 'delivery_picked_up', 'delivery_in_transit', 'delivery_delivered', 'delivery_cancelled', 'delivery_failed', 'delivery_returned', 'delivery_exception_reported', 'delivery_reschedule_requested', 'delivery_return_requested', 'delivery_extra_requested', 'delivery_eta_updated']) {
      expect(DELIVERY_NOTIFICATION_EVENTS).toContain(event);
    }
  });

  test('488: the per-shipment exception summary mixes issues, returns, reschedules, and failed attempts into one timeline; ops sees the aggregate', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    const job = await makeJob(customerId, { driverId, status: 'in_transit', pickedUpAt: new Date(Date.now() - 30 * 60 * 1000) });

    const issue = await reportIssue(job, driverId, { code: 'delay', description: 'Traffic on the highway' });
    expect(issue.next).not.toHaveBeenCalled();
    // Backdate the issue: the ops aggregate lists open-exception jobs
    // oldest-first with a 100-row cap, and the shared test database
    // accumulates open issues from earlier runs. An old stamp keeps
    // this job first in the list no matter what else is open.
    await pool.query(
      "UPDATE delivery_issues SET created_at = '2020-01-01T00:00:00Z' WHERE delivery_job_id = $1",
      [job.id],
    );
    await pool.query(
      `INSERT INTO delivery_returns (delivery_job_id, requested_by_user_id, reason, status) VALUES ($1, $2, 'Recipient not home', 'requested')`,
      [job.id, driverId],
    );
    await pool.query(
      `INSERT INTO delivery_reschedule_requests (delivery_job_id, requested_by_user_id, reason, status) VALUES ($1, $2, 'Customer asked to move the window', 'pending')`,
      [job.id, driverId],
    );
    await pool.query(
      `INSERT INTO delivery_dispatch_attempts (delivery_job_id, source, action, reason, actor_user_id) VALUES ($1, 'marketplace', 'assignment_failed', 'delivery_capacity_mismatch', $2)`,
      [job.id, adminId],
    );

    const { res, next } = await call(localDelivery.getJobExceptions, {
      params: { id: String(job.id) }, user: helperUser(driverId),
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.job.reference).toBe(job.reference);
    expect(res.payload.openCount).toBeGreaterThanOrEqual(3);
    const kinds = res.payload.events.map((entry) => entry.kind);
    expect(kinds).toContain('issue');
    expect(kinds).toContain('return');
    expect(kinds).toContain('reschedule');
    expect(kinds).toContain('failed_attempt');
    const issueEvent = res.payload.events.find((entry) => entry.kind === 'issue');
    expect(issueEvent.code).toBe('delay');
    expect(issueEvent.status).toBe('open');

    const aggregate = await call(localDelivery.getInternalExceptions, { user: operatorUser(adminId) });
    expect(aggregate.next).not.toHaveBeenCalled();
    const delayBucket = aggregate.res.payload.byCode.find((entry) => entry.code === 'delay');
    expect(delayBucket).toBeDefined();
    expect(delayBucket.openCount).toBeGreaterThanOrEqual(1);
    expect(aggregate.res.payload.jobs.map((entry) => entry.id)).toContain(job.id);
    const listed = aggregate.res.payload.jobs.find((entry) => entry.id === job.id);
    expect(listed.latestOpenIssueCode).toBe('delay');

    const strangerId = await makeUser('customer');
    const denied = await call(localDelivery.getJobExceptions, {
      params: { id: String(job.id) }, user: customerUser(strangerId),
    });
    expect(denied.next).toHaveBeenCalled();
    expect(denied.next.error).toMatchObject({ status: 404 });
  });

  test('489: the participant document list names proofs and item photos; a stranger gets a 404', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId, status: 'delivered', deliveredAt: new Date() });
    await pool.query(
      `INSERT INTO delivery_proofs (delivery_job_id, proof_type, proof_value, object_key, submitted_by_user_id, verification_status, verified_at)
       VALUES ($1, 'pin', '123456', 'delivery-private/proof.jpg', $2, 'verified', NOW())`,
      [job.id, driverId],
    );
    await pool.query(
      `INSERT INTO delivery_job_item_photos (delivery_job_id, owner_user_id, object_key, content_type, size_bytes, sha256, scan_status)
       VALUES ($1, $2, $3, 'image/jpeg', 1234, $4, 'clean')`,
      [job.id, customerId, `delivery-private/item-${job.id}.jpg`, 'a'.repeat(64)],
    );

    const { res, next } = await call(localDelivery.listJobDocuments, {
      params: { id: String(job.id) }, user: customerUser(customerId),
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.documents.map((entry) => entry.kind).sort()).toEqual(['item_photo', 'proof']);
    const proof = res.payload.documents.find((entry) => entry.kind === 'proof');
    expect(proof.verificationStatus).toBe('verified');
    const photo = res.payload.documents.find((entry) => entry.kind === 'item_photo');
    expect(photo.contentType).toBe('image/jpeg');

    const strangerId = await makeUser('customer');
    const denied = await call(localDelivery.listJobDocuments, {
      params: { id: String(job.id) }, user: customerUser(strangerId),
    });
    expect(denied.next).toHaveBeenCalled();
    expect(denied.next.error).toMatchObject({ status: 404 });
  });

  test('490: the OxSteed receipt builds from the job record and downloads as a PDF for the customer and the driver', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, {
      driverId, status: 'delivered',
      pickedUpAt: new Date(Date.now() - 60 * 60 * 1000), deliveredAt: new Date(),
    });
    await pool.query(
      `INSERT INTO delivery_proofs (delivery_job_id, proof_type, proof_value, object_key, submitted_by_user_id, verification_status, verified_at)
       VALUES ($1, 'pin', '123456', 'delivery-private/proof.jpg', $2, 'verified', NOW())`,
      [job.id, driverId],
    );

    const data = await buildDeliveryReceiptData(pool, job.id);
    expect(data.reference).toBe(job.reference);
    expect(data.origin).toMatch(/Columbus/);
    expect(data.destination).toMatch(/Columbus/);
    expect(data.pieces).toBe(3);
    expect(data.driverPayoutCents).toBe(1800);
    expect(data.paidCents).toBe(2500);
    expect(data.proof).toMatchObject({ type: 'pin' });

    for (const user of [customerUser(customerId), helperUser(driverId)]) {
      const { res, next } = await call(localDelivery.downloadJobReceipt, {
        params: { id: String(job.id) }, user,
      });
      expect(next).not.toHaveBeenCalled();
      expect(Buffer.isBuffer(res.payload)).toBe(true);
      expect(res.payload.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(res.payload.length).toBeGreaterThan(500);
    }

    const strangerId = await makeUser('customer');
    const denied = await call(localDelivery.downloadJobReceipt, {
      params: { id: String(job.id) }, user: customerUser(strangerId),
    });
    expect(denied.next).toHaveBeenCalled();
    expect(denied.next.error).toMatchObject({ status: 404 });

    // The Stripe receipt link is untouched: still on the payment row.
    const { rows: [payment] } = await pool.query(
      'SELECT status FROM delivery_payments WHERE delivery_job_id = $1', [job.id],
    );
    expect(payment.status).toBe('paid');
  });

  test('491 (verify): the driver job list still returns delivered and cancelled jobs as completed history', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeDriverProfile(driverId);
    const delivered = await makeJob(customerId, { driverId, status: 'delivered', deliveredAt: new Date() });
    const cancelled = await makeJob(customerId, { driverId, status: 'cancelled', cancelledAt: new Date() });
    const { res, next } = await call(localDelivery.list, { user: helperUser(driverId), query: {} });
    expect(next).not.toHaveBeenCalled();
    const ids = res.payload.jobs.map((entry) => entry.id);
    expect(ids).toContain(delivered.id);
    expect(ids).toContain(cancelled.id);
    expect(res.payload.jobs.find((entry) => entry.id === delivered.id).status).toBe('delivered');
    expect(res.payload.jobs.find((entry) => entry.id === cancelled.id).status).toBe('cancelled');
  });

  test('492 (verify): the driver payout history still returns the accrued payout with its job reference', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeDriverProfile(driverId);
    const job = await makeJob(customerId, { driverId, status: 'delivered', deliveredAt: new Date() });
    await makePayout(job, driverId);
    const { res, next } = await call(localDelivery.listDriverPayouts, {
      user: helperUser(driverId), query: {},
    });
    expect(next).not.toHaveBeenCalled();
    const payout = res.payload.payouts.find((entry) => entry.delivery_job_id === job.id);
    expect(payout).toBeDefined();
    expect(payout.status).toBe('accrued');
    expect(payout.payout_cents).toBe(1800);
    expect(payout.job_reference).toBe(job.reference);
    expect(payout.adjustments).toEqual([]);
    expect(payout.disputes).toEqual([]);

    // G9-B1 (D-524): the status filter runs against the real schema
    // (the old unqualified `status = $2` was ambiguous with the
    // joined job's status) and the paged response carries the total
    // and the server-side lifetime totals.
    const filtered = await call(localDelivery.listDriverPayouts, {
      user: helperUser(driverId), query: { status: 'paid' },
    });
    expect(filtered.next).not.toHaveBeenCalled();
    expect(filtered.res.payload.payouts.map((entry) => entry.delivery_job_id)).not.toContain(job.id);
    expect(filtered.res.payload.total).toBe(0);
    expect(filtered.res.payload.totals).toEqual({ paidCents: 0, pendingCents: 1800 });
    expect(filtered.res.payload.limit).toBe(100);
    expect(filtered.res.payload.offset).toBe(0);
  });

  test('493: an ops payout adjustment persists the reason and before/after amounts, and the driver history surfaces it', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    await makeDriverProfile(driverId);
    const job = await makeJob(customerId, { driverId, status: 'delivered', deliveredAt: new Date() });
    const payout = await makePayout(job, driverId);

    const missing = await call(localDelivery.adjustDriverPayout, {
      params: { payoutId: String(payout.id) }, user: operatorUser(adminId),
      body: { newPayoutCents: 1500, reason: 'too short' },
    });
    expect(missing.next).toHaveBeenCalled();
    expect(missing.next.error).toMatchObject({ code: 'driver_payout_adjustment_reason_required', status: 400 });

    const same = await call(localDelivery.adjustDriverPayout, {
      params: { payoutId: String(payout.id) }, user: operatorUser(adminId),
      body: { newPayoutCents: 1800, reason: 'No change is needed here at all' },
    });
    expect(same.next).toHaveBeenCalled();
    expect(same.next.error).toMatchObject({ code: 'driver_payout_adjustment_invalid', status: 400 });

    const { res, next } = await call(localDelivery.adjustDriverPayout, {
      params: { payoutId: String(payout.id) }, user: operatorUser(adminId),
      body: { newPayoutCents: 1500, reason: 'Waiting time was double counted in the quote' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.payout.payout_cents).toBe(1500);
    expect(res.payload.adjustment).toMatchObject({
      previous_payout_cents: 1800, new_payout_cents: 1500,
      reason: 'Waiting time was double counted in the quote',
    });
    expect(String(res.payload.adjustment.adjusted_by_user_id)).toBe(adminId);

    const history = await call(localDelivery.listDriverPayouts, {
      user: helperUser(driverId), query: {},
    });
    expect(history.next).not.toHaveBeenCalled();
    const listed = history.res.payload.payouts.find((entry) => entry.id === payout.id);
    expect(listed.payout_cents).toBe(1500);
    expect(listed.adjustments).toHaveLength(1);
    expect(listed.adjustments[0]).toMatchObject({
      previous_payout_cents: 1800, new_payout_cents: 1500,
      reason: 'Waiting time was double counted in the quote',
    });

    // A paid payout is money that already moved: it cannot be adjusted.
    const paidJob = await makeJob(customerId, { driverId, status: 'delivered', deliveredAt: new Date() });
    const paidPayout = await makePayout(paidJob, driverId, { status: 'paid', paidAt: new Date() });
    const paid = await call(localDelivery.adjustDriverPayout, {
      params: { payoutId: String(paidPayout.id) }, user: operatorUser(adminId),
      body: { newPayoutCents: 1000, reason: 'Trying to change a paid payout' },
    });
    expect(paid.next).toHaveBeenCalled();
    expect(paid.next.error).toMatchObject({ code: 'driver_payout_adjustment_invalid', status: 409 });
  });

  test('494: a driver disputes a delivered assignment, ops resolves it, and the driver sees the status', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    await makeDriverProfile(driverId);
    const job = await makeJob(customerId, { driverId, status: 'delivered', deliveredAt: new Date() });
    const payout = await makePayout(job, driverId);

    const posted = await makeJob(customerId, { driverId, status: 'posted' });
    const tooEarly = await call(localDelivery.createDispute, {
      params: { id: String(posted.id) }, user: helperUser(driverId),
      body: { subject: 'payout_amount', description: 'The payout looks wrong to me here' },
    });
    expect(tooEarly.next).toHaveBeenCalled();
    expect(tooEarly.next.error).toMatchObject({ code: 'delivery_dispute_assignment_not_completed', status: 409 });

    const { res, next } = await call(localDelivery.createDispute, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      body: { subject: 'payout_amount', description: 'The payout is short by the waiting extra' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.payload.dispute).toMatchObject({ status: 'open', subject: 'payout_amount' });
    expect(res.payload.dispute.payout_id).toBe(payout.id);
    expect(res.payload.supportTicket).toBeDefined();
    expect(res.payload.dispute.support_ticket_id).toBe(res.payload.supportTicket.id);

    const duplicate = await call(localDelivery.createDispute, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      body: { subject: 'payout_amount', description: 'Filing the same dispute a second time' },
    });
    expect(duplicate.next).toHaveBeenCalled();
    expect(duplicate.next.error).toMatchObject({ code: 'delivery_dispute_duplicate', status: 409 });

    // A different subject on the same job is a different dispute.
    const other = await call(localDelivery.createDispute, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      body: { subject: 'rating', description: 'The rating on this assignment is unfair' },
    });
    expect(other.next).not.toHaveBeenCalled();
    expect(other.res.payload.dispute.subject).toBe('rating');

    const disputeId = res.payload.dispute.id;
    const reviewing = await call(localDelivery.resolveDispute, {
      params: { disputeId: String(disputeId) }, user: operatorUser(adminId),
      body: { status: 'under_review' },
    });
    expect(reviewing.next).not.toHaveBeenCalled();
    expect(reviewing.res.payload.dispute.status).toBe('under_review');

    const noResolution = await call(localDelivery.resolveDispute, {
      params: { disputeId: String(disputeId) }, user: operatorUser(adminId),
      body: { status: 'resolved', resolution: 'short' },
    });
    expect(noResolution.next).toHaveBeenCalled();
    expect(noResolution.next.error).toMatchObject({ code: 'delivery_dispute_resolution_required', status: 400 });

    const resolved = await call(localDelivery.resolveDispute, {
      params: { disputeId: String(disputeId) }, user: operatorUser(adminId),
      body: { status: 'resolved', resolution: 'Waiting extra approved; payout adjusted by $3.00' },
    });
    expect(resolved.next).not.toHaveBeenCalled();
    expect(resolved.res.payload.dispute).toMatchObject({ status: 'resolved' });
    expect(resolved.res.payload.dispute.resolution).toMatch(/Waiting extra/);

    const mine = await call(localDelivery.listMyDisputes, { user: helperUser(driverId), query: {} });
    expect(mine.next).not.toHaveBeenCalled();
    const seen = mine.res.payload.disputes.find((entry) => entry.id === disputeId);
    expect(seen).toMatchObject({ status: 'resolved', job_reference: job.reference });

    const queue = await call(localDelivery.listInternalDisputes, { user: operatorUser(adminId), query: { status: 'resolved' } });
    expect(queue.next).not.toHaveBeenCalled();
    expect(queue.res.payload.disputes.map((entry) => entry.id)).toContain(disputeId);

    // The dispute never moved the payout: that stays on the adjustment path.
    const { rows: [unchanged] } = await pool.query(
      'SELECT payout_cents FROM delivery_driver_payouts WHERE id = $1', [payout.id],
    );
    expect(unchanged.payout_cents).toBe(1800);
  });

  test('495: week bounds are Monday-Sunday in the driver timezone', () => {
    const wednesday = weekBoundsForDate(new Date('2026-11-18T12:00:00Z'), 'UTC');
    expect(wednesday.weekStartDate).toBe('2026-11-16');
    expect(wednesday.weekEndDate).toBe('2026-11-22');
    // Monday 02:00 UTC is still Sunday evening in New York, so it
    // belongs to the previous week there.
    const mondayEarly = weekBoundsForDate(new Date('2026-11-16T02:00:00Z'), 'America/New_York');
    expect(mondayEarly.weekStartDate).toBe('2026-11-09');
    expect(mondayEarly.weekEndDate).toBe('2026-11-15');
    const mondayLate = weekBoundsForDate(new Date('2026-11-16T12:00:00Z'), 'America/New_York');
    expect(mondayLate.weekStartDate).toBe('2026-11-16');
  });

  test('495: the weekly report aggregates the week, and the sweep stores one report per driver per week', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper', timezone: 'America/New_York' });
    const customerId = await makeUser('customer');
    await makeDriverProfile(driverId);
    // Previous week in New York, relative to Monday 2026-11-23 07:00 UTC.
    const now = new Date('2026-11-23T07:00:00Z');
    const weekStart = '2026-11-16';
    const deliveredAt = new Date('2026-11-18T12:00:00Z');
    const pickedUpAt = new Date('2026-11-18T11:15:00Z');
    const job = await makeJob(customerId, {
      driverId, status: 'delivered', pickedUpAt, deliveredAt,
    });
    await makePayout(job, driverId, { createdAt: new Date('2026-11-18T13:00:00Z') });
    const issue = await reportIssue(job, driverId, { code: 'delay', description: 'Traffic on the highway' });
    expect(issue.next).not.toHaveBeenCalled();
    // The issue was reported "now" (outside the week); move it into the
    // week so the report counts it — the report reads stored rows.
    await pool.query(
      "UPDATE delivery_issues SET created_at = '2026-11-18T13:30:00Z' WHERE delivery_job_id = $1",
      [job.id],
    );

    const report = await buildWeeklyReport(pool, driverId, weekStart, 'America/New_York');
    expect(report.weekStartDate).toBe('2026-11-16');
    expect(report.weekEndDate).toBe('2026-11-22');
    expect(report.jobsCompleted).toBe(1);
    expect(report.distanceMiles).toBe(8);
    expect(report.pieces).toBe(3);
    expect(report.workedMinutes).toBe(45);
    expect(report.earningsAccruedCents).toBe(1800);
    expect(report.exceptionsCount).toBe(1);
    expect(report.exceptionsByCode).toEqual([{ code: 'delay', count: 1 }]);
    expect(report.hasActivity).toBe(true);
    expect(report.jobs).toHaveLength(1);
    expect(report.jobs[0].reference).toBe(job.reference);

    // A Monday 02:00 UTC delivery is Sunday evening in New York, so it
    // belongs to this same previous week, not the current one.
    const lateSunday = await makeJob(customerId, {
      driverId, status: 'delivered',
      pickedUpAt: new Date('2026-11-23T01:00:00Z'),
      deliveredAt: new Date('2026-11-23T02:00:00Z'),
    });
    const withLate = await buildWeeklyReport(pool, driverId, weekStart, 'America/New_York');
    expect(withLate.jobsCompleted).toBe(2);
    expect(withLate.jobs.map((entry) => entry.id)).toContain(lateSunday.id);

    const first = await generateWeeklyReports(pool, { now });
    expect(first.generated).toBeGreaterThanOrEqual(1);
    const { rows: [stored] } = await pool.query(
      'SELECT * FROM delivery_driver_weekly_reports WHERE driver_user_id = $1 AND week_start = $2',
      [driverId, weekStart],
    );
    expect(stored).toBeDefined();
    expect(stored.jobs_completed).toBe(2);
    expect(stored.earnings_accrued_cents).toBe(1800);
    expect(stored.payload.jobs).toHaveLength(2);

    const second = await generateWeeklyReports(pool, { now });
    const { rows: again } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM delivery_driver_weekly_reports WHERE driver_user_id = $1 AND week_start = $2',
      [driverId, weekStart],
    );
    expect(again[0].count).toBe(1);
    expect(second.generated).toBe(0);

    // An idle driver gets no report and no notification.
    const idleId = await makeUser('helper', { defaultMode: 'helper' });
    await makeDriverProfile(idleId);
    const idleReport = await buildWeeklyReport(pool, idleId, weekStart, 'UTC');
    expect(idleReport.hasActivity).toBe(false);
    const { rows: [idleRow] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM delivery_driver_weekly_reports WHERE driver_user_id = $1',
      [idleId],
    );
    expect(idleRow.count).toBe(0);
  });

  test('495 (G9-B2/G9-B12): a voided payout does not count as accrued earnings, and a cancellations-only week still produces a report', async () => {
    const weekStart = '2026-11-16';
    const now = new Date('2026-11-23T07:00:00Z');
    const customerId = await makeUser('customer');

    // One live accrued payout plus one voided payout in the same week.
    const driverId = await makeUser('helper', { defaultMode: 'helper', timezone: 'America/New_York' });
    await makeDriverProfile(driverId);
    const job = await makeJob(customerId, {
      driverId, status: 'delivered',
      pickedUpAt: new Date('2026-11-18T11:15:00Z'), deliveredAt: new Date('2026-11-18T12:00:00Z'),
    });
    await makePayout(job, driverId, { createdAt: new Date('2026-11-18T13:00:00Z') });
    const voidedJob = await makeJob(customerId, {
      driverId, status: 'delivered',
      pickedUpAt: new Date('2026-11-19T11:15:00Z'), deliveredAt: new Date('2026-11-19T12:00:00Z'),
    });
    await makePayout(voidedJob, driverId, { status: 'voided', createdAt: new Date('2026-11-19T13:00:00Z') });

    const report = await buildWeeklyReport(pool, driverId, weekStart, 'America/New_York');
    expect(report.jobsCompleted).toBe(2);
    // The voided $18.00 is not accrued earnings, but its bucket is
    // still visible in the per-status breakdown.
    expect(report.earningsAccruedCents).toBe(1800);
    expect(report.payoutsByStatus).toContainEqual({ status: 'voided', count: 1, cents: 1800 });
    expect(report.hasActivity).toBe(true);

    // A driver whose week was all cancellations: no deliveries, no
    // payouts, just cancelled jobs — the week still gets a report.
    const cancelledId = await makeUser('helper', { defaultMode: 'helper', timezone: 'America/New_York' });
    await makeDriverProfile(cancelledId);
    await makeJob(customerId, {
      driverId: cancelledId, status: 'cancelled',
      cancelledAt: new Date('2026-11-18T13:00:00Z'),
    });
    const cancelledReport = await buildWeeklyReport(pool, cancelledId, weekStart, 'America/New_York');
    expect(cancelledReport.jobsCompleted).toBe(0);
    expect(cancelledReport.jobsCancelled).toBe(1);
    expect(cancelledReport.earningsAccruedCents).toBe(0);
    expect(cancelledReport.hasActivity).toBe(true);

    // The Monday sweep stores that report: the candidate set must
    // include cancelled-job drivers, not only delivered/payout ones.
    const sweep = await generateWeeklyReports(pool, { now });
    expect(sweep.generated).toBeGreaterThanOrEqual(1);
    const { rows: [stored] } = await pool.query(
      'SELECT * FROM delivery_driver_weekly_reports WHERE driver_user_id = $1 AND week_start = $2',
      [cancelledId, weekStart],
    );
    expect(stored).toBeDefined();
    expect(stored.jobs_completed).toBe(0);
    expect(stored.jobs_cancelled).toBe(1);
    expect(stored.earnings_accrued_cents).toBe(0);
  });
});
