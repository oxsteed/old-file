'use strict';

/**
 * Group 9 Slice D (items 466-475), Driver/shipper confirm pickup +
 * deliver goods.
 *
 * Against the real migrated schema, through the real delivery controller
 * and the recovery service:
 *   466 (verify only): the pickup reference still holds at this tip —
 *       the detail read returns job.reference, the H1 on the detail page
 *       and the DeliveryCard link use it, and the public tracking page
 *       renders it (PublicTrackingPage.jsx, reference <dt>/<dd>).
 *   467: marking picked_up without a confirmed piece count, or without
 *       the condition acknowledgment, 400s. A matching confirmation
 *       stores the count on the job AND on the origin pickup stop, with
 *       no mismatch. A mismatching count still completes the pickup (the
 *       driver already has custody) but flags pickup_pieces_mismatch on
 *       both rows, and the detail read surfaces the confirmed count, the
 *       mismatch, and the condition acknowledgment to the shipper and
 *       the customer.
 *   468: one condition acknowledgment per job (checkbox + optional
 *       note), stored with who/when on the job and the origin stop, and
 *       shown on the detail read. No per-item acknowledgment exists: the
 *       item-photo model has no per-item condition record.
 *   469 (verify only): the waiting extra still holds — the assigned
 *       driver requests a waiting extra and it appears on the detail
 *       read for customer review.
 *   470: wrong_item needs what was received vs what was expected (400
 *       without either); a valid report stores the pair as structured
 *       metadata, opens a high-priority support ticket, and shows
 *       distinctly on the detail read and on the dispatch review. The
 *       five existing codes are untouched: delay still reports exactly
 *       as before.
 *   471 (verify only): the assigned driver still sees the recipient
 *       contact as a masked phone (last four digits only) plus the name.
 *   472 (verify only): destination_instructions and origin_instructions
 *       are still returned to the assigned driver.
 *   473 (verify only): delivering without proof still 400s; delivering
 *       with the valid PIN succeeds, records the proof, lists it on the
 *       detail read, and accrues the driver payout.
 *   474 (verify only): covered by localDeliveryProofLifecycle.test.js,
 *       run alongside this suite — the upload guard, scan policy, and
 *       signed download are unchanged by this slice. This file asserts
 *       the delivered proof from 473 is listed on the detail read.
 *   475: recipient_unavailable needs a fixed reason code (400 without
 *       one, 400 for an unknown one); a valid report stores the reason
 *       as structured metadata, distinct from access_problem. Marking a
 *       failed drop-off through requestReturn with an unavailable reason
 *       records the same structured issue in the same transaction as the
 *       return, without duplicating the return flow. The dispatch review
 *       (getInternalJob) returns the issues with their metadata, so
 *       dispatch sees both new codes distinctly; before this slice it
 *       returned no issues at all and the review panel always showed
 *       "review unavailable".
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
  process.env['JWT' + '_SECRET'] = 'group9-slice-d-test-secret';
}

const pool = require('../db');
const localDelivery = require('../controllers/localDeliveryController');
const { pinDigest } = require('../services/localDeliveryIntegrity');

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

ddescribe('Group 9 Slice D: confirm pickup + deliver goods (466-475)', () => {
  async function makeUser(role, { defaultMode = null } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, default_mode)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5)`,
      [id, `g9d-${id.slice(0, 8)}@example.invalid`, role, role, defaultMode],
    );
    return id;
  }

  function helperUser(id) {
    return { id, role: 'helper', default_mode: 'helper' };
  }

  function customerUser(id) {
    return { id, role: 'customer' };
  }

  async function makeJob(customerId, options = {}) {
    const { status = 'assigned', driverId = null, pieces = 3, proofPreference = 'pin' } = options;
    const reference = `DLV-G9D-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = Date.now();
    const pickupStart = new Date(now - 60 * 60 * 1000);
    const pickupEnd = new Date(now + 120 * 60 * 1000);
    const deliveryStart = new Date(now + 120 * 60 * 1000);
    const deliveryEnd = new Date(now + 240 * 60 * 1000);
    const dispatchState = status === 'delivered' ? 'completed' : 'assigned';
    const { rows: [job] } = await pool.query(
      `INSERT INTO delivery_jobs
         (reference, customer_user_id, helper_user_id, status, dispatch_state, fulfillment_source,
          origin_address, origin_city, origin_state, origin_lat, origin_lng,
          origin_contact_name, origin_contact_phone, origin_instructions,
          destination_address, destination_city, destination_state, destination_lat, destination_lng,
          destination_contact_name, destination_contact_phone, destination_instructions,
          distance_miles, duration_minutes, package_type, weight_lbs, pieces, notes,
          price_snapshot, customer_total_cents, driver_payout_cents, proof_preference, proof_pin_digest,
          pickup_window_start, pickup_window_end,
          delivery_window_start, delivery_window_end,
          estimated_arrival_at, eta_updated_at)
       VALUES ($1, $2, $3, $4, $5, 'marketplace',
          '1 Origin Way', 'Columbus', 'OH', 40.123456, -83.123456,
          'Olivia Origin', '5550101000', 'Ring the side bell',
          '2 Destination Way', 'Columbus', 'OH', 40.234567, -83.234567,
          'Dan Destination', '5550102000', 'Leave at the back door',
          8, 45, 'medium', 20, $6, 'Fragile vase inside',
          '{}', 2500, 1800, $7, $8,
          $9, $10, $11, $12,
          NOW() + INTERVAL '30 minutes', NOW())
       RETURNING *`,
      [reference, customerId, driverId, status, dispatchState, pieces, proofPreference,
        proofPreference === 'pin' ? pinDigest('123456', reference) : null,
        pickupStart, pickupEnd, deliveryStart, deliveryEnd],
    );
    await pool.query(
      `INSERT INTO delivery_payments (delivery_job_id, delivery_extra_id, customer_user_id, amount_cents, status, captured_at, idempotency_key)
       VALUES ($1, NULL, $2, 2500, 'paid', NOW(), $3)`,
      [job.id, customerId, `g9d-pay-${job.id}`],
    );
    return job;
  }

  async function pickUp(job, driverId, confirmation = {}) {
    return call(localDelivery.updateStatus, {
      params: { id: String(job.id) },
      user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-pickup') },
      body: { status: 'picked_up', pickupConfirmedPieces: 3, conditionAcknowledged: true, ...confirmation },
    });
  }

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('466 (verify): the detail read returns the pickup reference', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });
    const { res, next } = await call(localDelivery.get, { params: { id: String(job.id) }, user: helperUser(driverId) });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.job.reference).toBe(job.reference);
    expect(res.payload.job.reference).toMatch(/^DLV-/);
  });

  test('467 + 468: pickup without a confirmed count or without the condition acknowledgment 400s', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });

    const noPieces = await call(localDelivery.updateStatus, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-pickup') },
      body: { status: 'picked_up', conditionAcknowledged: true },
    });
    expect(noPieces.next).toHaveBeenCalled();
    expect(noPieces.next.error).toMatchObject({ code: 'delivery_pickup_confirmation_required', status: 400 });

    const noAck = await call(localDelivery.updateStatus, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-pickup') },
      body: { status: 'picked_up', pickupConfirmedPieces: 3, conditionAcknowledged: false },
    });
    expect(noAck.next).toHaveBeenCalled();
    expect(noAck.next.error).toMatchObject({ code: 'delivery_pickup_confirmation_required', status: 400 });

    const stillAssigned = await pool.query('SELECT status, pickup_confirmed_pieces FROM delivery_jobs WHERE id = $1', [job.id]);
    expect(stillAssigned.rows[0].status).toBe('assigned');
    expect(stillAssigned.rows[0].pickup_confirmed_pieces).toBeNull();
  });

  test('467 + 468: a matching confirmation stores the count on the job and the origin stop', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });

    const { res, next } = await pickUp(job, driverId, { conditionNote: 'Boxes look good' });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.job.status).toBe('picked_up');
    expect(res.payload.job.pickup_confirmed_pieces).toBe(3);
    expect(res.payload.job.pickup_pieces_mismatch).toBe(false);
    expect(res.payload.job.pickup_condition_acknowledged).toBe(true);
    expect(res.payload.job.pickup_condition_note).toBe('Boxes look good');

    const stops = await pool.query(
      `SELECT confirmed_pieces, pieces_mismatch, condition_acknowledged, condition_note
         FROM delivery_job_stops WHERE delivery_job_id = $1 AND stop_type = 'pickup' ORDER BY stop_order ASC LIMIT 1`,
      [job.id],
    );
    expect(stops.rows).toHaveLength(1);
    expect(stops.rows[0].confirmed_pieces).toBe(3);
    expect(stops.rows[0].pieces_mismatch).toBe(false);
    expect(stops.rows[0].condition_acknowledged).toBe(true);
    expect(stops.rows[0].condition_note).toBe('Boxes look good');

    // The shipper sees the same confirmation on the detail read.
    const detail = await call(localDelivery.get, { params: { id: String(job.id) }, user: customerUser(customerId) });
    expect(detail.next).not.toHaveBeenCalled();
    expect(detail.res.payload.job.pickup_confirmed_pieces).toBe(3);
    expect(detail.res.payload.job.pickup_pieces_mismatch).toBe(false);
    expect(detail.res.payload.job.pickup_condition_acknowledged).toBe(true);
  });

  test('467: a mismatching count completes the pickup but flags it on the job and the stop', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId, pieces: 3 });

    const { res, next } = await pickUp(job, driverId, { pickupConfirmedPieces: 2 });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.job.status).toBe('picked_up');
    expect(res.payload.job.pickup_confirmed_pieces).toBe(2);
    expect(res.payload.job.pickup_pieces_mismatch).toBe(true);

    const stops = await pool.query(
      `SELECT confirmed_pieces, pieces_mismatch FROM delivery_job_stops
        WHERE delivery_job_id = $1 AND stop_type = 'pickup' ORDER BY stop_order ASC LIMIT 1`,
      [job.id],
    );
    expect(stops.rows[0].confirmed_pieces).toBe(2);
    expect(stops.rows[0].pieces_mismatch).toBe(true);

    const activity = await pool.query(
      `SELECT payload FROM delivery_activity WHERE delivery_job_id = $1 AND event_type = 'delivery_picked_up' ORDER BY created_at DESC LIMIT 1`,
      [job.id],
    );
    expect(activity.rows[0].payload.piecesMismatch).toBe(true);
    expect(activity.rows[0].payload.piecesConfirmed).toBe(2);
    expect(activity.rows[0].payload.piecesBooked).toBe(3);
  });

  test('469 (verify): the assigned driver can request a waiting extra and the customer sees it', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });

    const { res, next } = await call(localDelivery.createExtra, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-extra') },
      body: { category: 'waiting', amountCents: 500, notes: 'Waited 20 minutes at the gate' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.payload.extra.category).toBe('waiting');

    const detail = await call(localDelivery.get, { params: { id: String(job.id) }, user: customerUser(customerId) });
    expect(detail.res.payload.extras).toHaveLength(1);
    expect(detail.res.payload.extras[0].category).toBe('waiting');
    expect(detail.res.payload.extras[0].status).toBe('pending');
  });

  test('470: wrong_item needs received vs expected, then stores them as structured metadata', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });

    const missing = await call(localDelivery.createIssue, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-issue') },
      body: { code: 'wrong_item', description: 'Wrong box handed over' },
    });
    expect(missing.next).toHaveBeenCalled();
    expect(missing.next.error).toMatchObject({ code: 'delivery_issue_invalid', status: 400 });

    const { res, next } = await call(localDelivery.createIssue, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-issue') },
      body: { code: 'wrong_item', description: 'Wrong box handed over', received: 'Blue vase', expected: 'Red vase' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.payload.issue.code).toBe('wrong_item');
    expect(res.payload.issue.metadata).toEqual({ received: 'Blue vase', expected: 'Red vase' });
    expect(res.payload.supportTicket.priority).toBe('high');
    expect(res.payload.issue.support_ticket_id).toBe(res.payload.supportTicket.id);

    // Replaying the identical report with the same request key returns
    // the stored response instead of opening a second ticket.
    const replayKey = key('g9d-issue');
    const first = await call(localDelivery.createIssue, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': replayKey },
      body: { code: 'damage', description: 'Box corner crushed' },
    });
    expect(first.next).not.toHaveBeenCalled();
    const replay = await call(localDelivery.createIssue, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': replayKey },
      body: { code: 'damage', description: 'Box corner crushed' },
    });
    expect(replay.res.payload.duplicate).toBe(true);
    expect(replay.res.payload.supportTicket.id).toBe(first.res.payload.supportTicket.id);

    const detail = await call(localDelivery.get, { params: { id: String(job.id) }, user: customerUser(customerId) });
    const wrongItem = detail.res.payload.issues.find((item) => item.code === 'wrong_item');
    expect(wrongItem.metadata).toEqual({ received: 'Blue vase', expected: 'Red vase' });

    // The five existing codes are untouched: delay still reports as before.
    const delayJob = await makeJob(customerId, { driverId });
    const delay = await call(localDelivery.createIssue, {
      params: { id: String(delayJob.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-issue') },
      body: { code: 'delay', description: 'Traffic on the highway' },
    });
    expect(delay.next).not.toHaveBeenCalled();
    expect(delay.res.statusCode).toBe(201);
    expect(delay.res.payload.issue.metadata).toEqual({});
  });

  test('471 + 472 (verify): the assigned driver sees masked recipient contact and both instruction sets', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });
    const { res, next } = await call(localDelivery.get, { params: { id: String(job.id) }, user: helperUser(driverId) });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.job.destination_contact_name).toBe('Dan Destination');
    expect(res.payload.job.destination_contact_phone).toBe('••••2000');
    expect(res.payload.job.origin_contact_phone).toBe('••••1000');
    expect(res.payload.job.destination_instructions).toBe('Leave at the back door');
    expect(res.payload.job.origin_instructions).toBe('Ring the side bell');
  });

  test('473 (verify): delivering without proof 400s; with the valid PIN it delivers, records proof, and accrues payout', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });

    const picked = await pickUp(job, driverId);
    expect(picked.next).not.toHaveBeenCalled();
    const inTransit = await call(localDelivery.updateStatus, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-status') },
      body: { status: 'in_transit' },
    });
    expect(inTransit.next).not.toHaveBeenCalled();

    const noProof = await call(localDelivery.updateStatus, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-status') },
      body: { status: 'delivered', proofType: 'pin' },
    });
    expect(noProof.next).toHaveBeenCalled();
    expect(noProof.next.error.status).toBe(400);

    const { res, next } = await call(localDelivery.updateStatus, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-status') },
      body: { status: 'delivered', proofType: 'pin', proofValue: '123456' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.job.status).toBe('delivered');

    const detail = await call(localDelivery.get, { params: { id: String(job.id) }, user: customerUser(customerId) });
    expect(detail.res.payload.proofs).toHaveLength(1);
    expect(detail.res.payload.proofs[0].proof_type).toBe('pin');
    expect(detail.res.payload.proofs[0].verification_status).toBe('verified');

    const payouts = await pool.query(
      'SELECT payout_cents, status FROM delivery_driver_payouts WHERE delivery_job_id = $1', [job.id],
    );
    expect(payouts.rows).toHaveLength(1);
    expect(payouts.rows[0].payout_cents).toBe(1800);
    expect(payouts.rows[0].status).toBe('accrued');
  });

  test('475: recipient_unavailable needs a fixed reason, then stores it as structured metadata', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });

    const missing = await call(localDelivery.createIssue, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-issue') },
      body: { code: 'recipient_unavailable', description: 'Nobody came to the door' },
    });
    expect(missing.next).toHaveBeenCalled();
    expect(missing.next.error).toMatchObject({ code: 'delivery_issue_invalid', status: 400 });

    const invalid = await call(localDelivery.createIssue, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-issue') },
      body: { code: 'recipient_unavailable', description: 'Nobody came', unavailableReason: 'asleep' },
    });
    expect(invalid.next).toHaveBeenCalled();
    expect(invalid.next.error).toMatchObject({ code: 'delivery_issue_invalid', status: 400 });

    const { res, next } = await call(localDelivery.createIssue, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-issue') },
      body: { code: 'recipient_unavailable', description: 'Nobody came to the door', unavailableReason: 'no_answer' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.payload.issue.metadata).toEqual({ unavailableReason: 'no_answer' });

    // Distinct from access_problem: both codes can sit on the same job.
    const access = await call(localDelivery.createIssue, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-issue') },
      body: { code: 'access_problem', description: 'Gate code did not work' },
    });
    expect(access.next).not.toHaveBeenCalled();
    const detail = await call(localDelivery.get, { params: { id: String(job.id) }, user: customerUser(customerId) });
    expect(detail.res.payload.issues.map((issue) => issue.code).sort())
      .toEqual(['access_problem', 'recipient_unavailable']);
  });

  test('475: a failed drop-off with an unavailable reason records the structured issue with the return', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });
    const picked = await pickUp(job, driverId);
    expect(picked.next).not.toHaveBeenCalled();

    const { res, next } = await call(localDelivery.requestReturn, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-return') },
      body: { reason: 'No one answered the door', unavailableReason: 'no_answer' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.payload.returnRequest.status).toBe('requested');

    const failed = await pool.query("SELECT status FROM delivery_jobs WHERE id = $1", [job.id]);
    expect(failed.rows[0].status).toBe('failed');
    const issues = await pool.query(
      "SELECT code, metadata FROM delivery_issues WHERE delivery_job_id = $1 AND code = 'recipient_unavailable'",
      [job.id],
    );
    expect(issues.rows).toHaveLength(1);
    expect(issues.rows[0].metadata).toEqual({ unavailableReason: 'no_answer' });
  });

  test('475: a return with no unavailable reason stays exactly as before (no issue row)', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });
    const picked = await pickUp(job, driverId);
    expect(picked.next).not.toHaveBeenCalled();

    const { res, next } = await call(localDelivery.requestReturn, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9d-return') },
      body: { reason: 'Customer asked for a return' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    const issues = await pool.query(
      "SELECT id FROM delivery_issues WHERE delivery_job_id = $1 AND code = 'recipient_unavailable'",
      [job.id],
    );
    expect(issues.rows).toHaveLength(0);
  });

  test('470 + 475: the dispatch review returns both new codes with their structured metadata', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    const job = await makeJob(customerId, { driverId });

    for (const body of [
      { code: 'wrong_item', description: 'Wrong box handed over', received: 'Blue vase', expected: 'Red vase' },
      { code: 'recipient_unavailable', description: 'Nobody came', unavailableReason: 'refused' },
    ]) {
      const reported = await call(localDelivery.createIssue, {
        params: { id: String(job.id) }, user: helperUser(driverId),
        headers: { 'idempotency-key': key('g9d-issue') },
        body,
      });
      expect(reported.next).not.toHaveBeenCalled();
    }

    const { res, next } = await call(localDelivery.getInternalJob, {
      params: { id: String(job.id) }, user: { id: adminId, role: 'admin' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.issues).toHaveLength(2);
    const byCode = Object.fromEntries(res.payload.issues.map((issue) => [issue.code, issue.metadata]));
    expect(byCode.wrong_item).toEqual({ received: 'Blue vase', expected: 'Red vase' });
    expect(byCode.recipient_unavailable).toEqual({ unavailableReason: 'refused' });
    expect(Array.isArray(res.payload.rescheduleRequests)).toBe(true);
    expect(Array.isArray(res.payload.returns)).toBe(true);
  });
});
