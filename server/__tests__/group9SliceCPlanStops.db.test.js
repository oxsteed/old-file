'use strict';

/**
 * Group 9 Slice C (items 461-465), Driver/shipper plan stops.
 *
 * Against the real migrated schema, through the real delivery controller
 * and the window-warning sweep:
 *   461 (verify only): the pickup itinerary still holds at this tip —
 *       the detail read returns origin/destination addresses, contacts,
 *       instructions, windows, ETA, pieces, and weight for the assigned
 *       driver.
 *   462: a job with no stop rows reads as its two legacy stops (origin
 *       pickup, destination dropoff); the shipper adds a stop before
 *       pickup (409 after pickup); the assigned driver reorders and
 *       completes stops; completing the last dropoff does not change the
 *       job status; the owner cannot complete a stop (403); adding
 *       materializes the virtual stops as stored rows. Pricing/ETA stay
 *       whole-job: the job totals are unchanged by stops.
 *   463: the sweep warns the assigned driver once when a window is
 *       closing (within 60 minutes) and once when it has passed without
 *       the stop completing; a second run sends nothing; delivered jobs
 *       and unassigned jobs get no warning; the detail read surfaces the
 *       same warnings. The sweep never cancels or reschedules.
 *   464 (verify only): route notes (job.notes plus origin/destination
 *       instructions) are returned to the assigned driver.
 *   465 (data contract): the assigned driver gets exact coordinates and
 *       addresses for navigation; a marketplace driver opening the same
 *       posted offer read-only gets rounded coordinates and no address,
 *       contact, or instructions.
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
  process.env['JWT' + '_SECRET'] = 'group9-slice-c-test-secret';
}

const pool = require('../db');
const localDelivery = require('../controllers/localDeliveryController');
const { sweepDeliveryWindowWarnings } = require('../services/deliveryWindowWarningService');
const { WINDOW_CLOSING_MINUTES } = require('../services/deliveryJobStopsService');

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

ddescribe('Group 9 Slice C: driver plan stops (461-465)', () => {
  async function makeUser(role, { defaultMode = null } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, default_mode)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5)`,
      [id, `g9c-${id.slice(0, 8)}@example.invalid`, role, role, defaultMode],
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
    const {
      status = 'assigned',
      driverId = null,
      pickupEndMinutes = 30,
      deliveryEndMinutes = 240,
      originLat = 40.123456,
      originLng = -83.123456,
      destinationLat = 40.234567,
      destinationLng = -83.234567,
    } = options;
    const now = Date.now();
    const pickupStart = new Date(now - 60 * 60 * 1000);
    const pickupEnd = new Date(now + pickupEndMinutes * 60 * 1000);
    const deliveryStart = new Date(now + 120 * 60 * 1000);
    const deliveryEnd = new Date(now + deliveryEndMinutes * 60 * 1000);
    const dispatchState = status === 'delivered' ? 'completed' : status === 'returned' ? 'returned' : 'assigned';
    const { rows: [job] } = await pool.query(
      `INSERT INTO delivery_jobs
         (reference, customer_user_id, helper_user_id, status, dispatch_state, fulfillment_source,
          origin_address, origin_city, origin_state, origin_lat, origin_lng,
          origin_contact_name, origin_contact_phone, origin_instructions,
          destination_address, destination_city, destination_state, destination_lat, destination_lng,
          destination_contact_name, destination_contact_phone, destination_instructions,
          distance_miles, duration_minutes, package_type, weight_lbs, pieces, notes,
          price_snapshot, customer_total_cents, driver_payout_cents,
          pickup_window_start, pickup_window_end,
          delivery_window_start, delivery_window_end,
          estimated_arrival_at, eta_updated_at)
       VALUES ($1, $2, $3, $4, $5, 'marketplace',
          '1 Origin Way', 'Columbus', 'OH', $6, $7,
          'Olivia Origin', '5550101000', 'Ring the side bell',
          '2 Destination Way', 'Columbus', 'OH', $8, $9,
          'Dan Destination', '5550102000', 'Leave at the back door',
          8, 45, 'medium', 20, 3, 'Fragile vase inside',
          '{}', 2500, 1800,
          $10, $11, $12, $13,
          NOW() + INTERVAL '30 minutes', NOW())
       RETURNING *`,
      [`DLV-G9C-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, customerId, driverId, status, dispatchState,
        originLat, originLng, destinationLat, destinationLng,
        pickupStart, pickupEnd, deliveryStart, deliveryEnd],
    );
    return job;
  }

  async function makePostedJob(customerId) {
    const now = Date.now();
    const pickupStart = new Date(now + 24 * 60 * 60 * 1000);
    const pickupEnd = new Date(now + 26 * 60 * 60 * 1000);
    const deliveryStart = new Date(now + 27 * 60 * 60 * 1000);
    const deliveryEnd = new Date(now + 28 * 60 * 60 * 1000);
    const { rows: [job] } = await pool.query(
      `INSERT INTO delivery_jobs
         (reference, customer_user_id, status, dispatch_state, fulfillment_source,
          origin_address, origin_city, origin_state, origin_lat, origin_lng,
          destination_address, destination_city, destination_state, destination_lat, destination_lng,
          distance_miles, package_type, weight_lbs, pieces,
          price_snapshot, customer_total_cents, driver_payout_cents,
          pickup_window_start, pickup_window_end,
          delivery_window_start, delivery_window_end,
          offer_expires_at, offer_deadline_hours)
       VALUES ($1, $2, 'posted', 'marketplace_posted', 'marketplace',
          '1 Origin Way', 'Columbus', 'OH', 40.123456, -83.123456,
          '2 Destination Way', 'Columbus', 'OH', 40.234567, -83.234567,
          8, 'medium', 20, 1,
          '{}', 1000, 700, $3, $4, $5, $6,
          NOW() + INTERVAL '24 hours', 24)
       RETURNING *`,
      [`DLV-G9C-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, customerId, pickupStart, pickupEnd, deliveryStart, deliveryEnd],
    );
    return job;
  }

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('461 + 464 (verify): the detail read carries the full pickup itinerary and route notes', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });
    const { res, next } = await call(localDelivery.get, { params: { id: String(job.id) }, user: helperUser(driverId) });
    expect(next).not.toHaveBeenCalled();
    const payload = res.payload;
    // 461: origin/destination addresses, contacts, instructions, windows,
    // ETA, pieces, weight.
    expect(payload.job.origin_address).toBe('1 Origin Way');
    expect(payload.job.destination_address).toBe('2 Destination Way');
    expect(payload.job.origin_contact_name).toBe('Olivia Origin');
    expect(payload.job.destination_contact_name).toBe('Dan Destination');
    expect(payload.job.origin_instructions).toBe('Ring the side bell');
    expect(payload.job.destination_instructions).toBe('Leave at the back door');
    expect(payload.job.pickup_window_start).toBeTruthy();
    expect(payload.job.pickup_window_end).toBeTruthy();
    expect(payload.job.delivery_window_start).toBeTruthy();
    expect(payload.job.delivery_window_end).toBeTruthy();
    expect(payload.job.eta.available).toBe(true);
    expect(payload.job.eta.estimatedArrivalAt).toBeTruthy();
    expect(payload.job.pieces).toBe(3);
    expect(Number(payload.job.weight_lbs)).toBe(20);
    // 464: job.notes plus the per-stop instructions above.
    expect(payload.job.notes).toBe('Fragile vase inside');
  });

  test('462: a job with no stop rows reads as its two legacy stops', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });
    await pool.query('DELETE FROM delivery_job_stops WHERE delivery_job_id = $1', [job.id]);
    const { res, next } = await call(localDelivery.listStops, { params: { id: String(job.id) }, user: helperUser(driverId) });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.stops).toHaveLength(2);
    const [pickup, dropoff] = res.payload.stops;
    expect(pickup.stop_type).toBe('pickup');
    expect(pickup.stop_order).toBe(1);
    expect(pickup.address).toBe('1 Origin Way');
    expect(pickup.contact_name).toBe('Olivia Origin');
    expect(dropoff.stop_type).toBe('dropoff');
    expect(dropoff.stop_order).toBe(2);
    expect(dropoff.address).toBe('2 Destination Way');
    expect(dropoff.contact_name).toBe('Dan Destination');
    // The detail read carries the same sequence.
    const detail = await call(localDelivery.get, { params: { id: String(job.id) }, user: helperUser(driverId) });
    expect(detail.res.payload.stops).toHaveLength(2);
  });

  test('462: shipper adds a stop, driver reorders and completes, job status never moves', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });
    const before = await pool.query('SELECT customer_total_cents, driver_payout_cents, duration_minutes FROM delivery_jobs WHERE id = $1', [job.id]);

    const added = await call(localDelivery.addStop, {
      params: { id: String(job.id) },
      user: customerUser(customerId),
      body: { stopType: 'pickup', address: '9 Key Office', city: 'Columbus', state: 'OH', contactName: 'Key Keeper' },
    });
    expect(added.next).not.toHaveBeenCalled();
    expect(added.res.statusCode).toBe(201);
    expect(added.res.payload.stop.stop_order).toBe(3);
    expect(added.res.payload.stop.stop_type).toBe('pickup');
    // Adding materialized the two virtual stops as stored rows.
    const stored = await pool.query('SELECT COUNT(*)::int AS n FROM delivery_job_stops WHERE delivery_job_id = $1', [job.id]);
    expect(stored.rows[0].n).toBe(3);

    const listed = await call(localDelivery.listStops, { params: { id: String(job.id) }, user: helperUser(driverId) });
    const ids = listed.res.payload.stops.map((stop) => stop.id);
    const reordered = await call(localDelivery.reorderStops, {
      params: { id: String(job.id) },
      user: helperUser(driverId),
      body: { stopIds: [ids[2], ids[0], ids[1]] },
    });
    expect(reordered.next).not.toHaveBeenCalled();
    expect(reordered.res.payload.stops.map((stop) => stop.stop_type)).toEqual(['pickup', 'pickup', 'dropoff']);
    expect(reordered.res.payload.stops[0].address).toBe('9 Key Office');

    const firstStop = reordered.res.payload.stops[0];
    const completed = await call(localDelivery.completeStop, {
      params: { id: String(job.id), stopId: String(firstStop.id) },
      user: helperUser(driverId),
    });
    expect(completed.next).not.toHaveBeenCalled();
    expect(completed.res.payload.stop.status).toBe('completed');
    expect(completed.res.payload.stop.completed_by_user_id).toBe(driverId);

    // Completing the last dropoff does not deliver the job: the job
    // status, payout, and ETA stay whole-job and unchanged.
    const dropoff = reordered.res.payload.stops.find((stop) => stop.stop_type === 'dropoff');
    await call(localDelivery.completeStop, {
      params: { id: String(job.id), stopId: String(dropoff.id) },
      user: helperUser(driverId),
    });
    const after = await pool.query('SELECT status, customer_total_cents, driver_payout_cents, duration_minutes FROM delivery_jobs WHERE id = $1', [job.id]);
    expect(after.rows[0].status).toBe('assigned');
    expect(after.rows[0].customer_total_cents).toBe(before.rows[0].customer_total_cents);
    expect(after.rows[0].driver_payout_cents).toBe(before.rows[0].driver_payout_cents);
    expect(after.rows[0].duration_minutes).toBe(before.rows[0].duration_minutes);

    // A completed stop cannot be completed again.
    const again = await call(localDelivery.completeStop, {
      params: { id: String(job.id), stopId: String(firstStop.id) },
      user: helperUser(driverId),
    });
    expect(again.next.error?.code || again.next.error?.status).toBeTruthy();
    expect(again.next.mock.calls[0][0].status).toBe(409);
  });

  test('462: the shipper cannot complete a stop, and no stop can be added after pickup', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId });
    const listed = await call(localDelivery.listStops, { params: { id: String(job.id) }, user: helperUser(driverId) });
    const firstStop = listed.res.payload.stops[0];
    const forbidden = await call(localDelivery.completeStop, {
      params: { id: String(job.id), stopId: String(firstStop.id) },
      user: customerUser(customerId),
    });
    expect(forbidden.next.mock.calls[0][0].status).toBe(403);
    expect(forbidden.next.mock.calls[0][0].code).toBe('delivery_stop_forbidden');

    const pickedUp = await makeJob(customerId, { driverId, status: 'picked_up' });
    const late = await call(localDelivery.addStop, {
      params: { id: String(pickedUp.id) },
      user: customerUser(customerId),
      body: { stopType: 'dropoff', address: '3 Late Way' },
    });
    expect(late.next.mock.calls[0][0].status).toBe(409);
    expect(late.next.mock.calls[0][0].code).toBe('delivery_stop_unavailable');
  });

  test('463: the sweep warns once when a window is closing, and again once when it passes', async () => {
    expect(WINDOW_CLOSING_MINUTES).toBe(60);
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeJob(customerId, { driverId, pickupEndMinutes: 30, deliveryEndMinutes: 240 });
    const sent = [];
    const send = jest.fn(async (notification) => { sent.push(notification); });
    // The sweep scans every active assigned job, so earlier tests' jobs
    // may warn too: assert on this job's notifications only.
    const forJob = () => sent.filter((notification) => notification.data.deliveryJobId === job.id);
    const first = await sweepDeliveryWindowWarnings(pool, { send });
    expect(first.closing).toBeGreaterThanOrEqual(1);
    expect(first.expired).toBe(0);
    expect(first.failed).toBe(0);
    expect(forJob()).toHaveLength(1);
    expect(forJob()[0].userId).toBe(driverId);
    expect(forJob()[0].type).toBe('delivery_window_warning');
    expect(forJob()[0].data.kind).toBe('closing');
    expect(forJob()[0].action_url).toBe(`/delivery/jobs/${job.id}`);
    // A second run sends nothing for this job: the closing stamp is set.
    const second = await sweepDeliveryWindowWarnings(pool, { send });
    expect(second.failed).toBe(0);
    expect(forJob()).toHaveLength(1);

    // The window passes without the stop completing: one expired warning.
    await pool.query('UPDATE delivery_jobs SET pickup_window_end = NOW() - INTERVAL \'10 minutes\' WHERE id = $1', [job.id]);
    await pool.query(
      `UPDATE delivery_job_stops SET window_end = NOW() - INTERVAL '10 minutes'
        WHERE delivery_job_id = $1 AND stop_type = 'pickup'`,
      [job.id],
    );
    const third = await sweepDeliveryWindowWarnings(pool, { send });
    expect(third.expired).toBeGreaterThanOrEqual(1);
    expect(forJob()).toHaveLength(2);
    expect(forJob()[1].data.kind).toBe('expired');
    // And the job was not changed by the sweep.
    const after = await pool.query('SELECT status FROM delivery_jobs WHERE id = $1', [job.id]);
    expect(after.rows[0].status).toBe('assigned');
  });

  test('463: delivered jobs and unassigned jobs get no warning; the detail read surfaces warnings', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const delivered = await makeJob(customerId, { driverId, status: 'delivered', pickupEndMinutes: 10 });
    const unassigned = await makeJob(customerId, { driverId: null, pickupEndMinutes: 10 });
    const sent = [];
    const send = jest.fn(async (notification) => { sent.push(notification); });
    const result = await sweepDeliveryWindowWarnings(pool, { send });
    const warnedIds = sent.map((notification) => notification.data.deliveryJobId);
    expect(warnedIds).not.toContain(delivered.id);
    expect(warnedIds).not.toContain(unassigned.id);
    expect(result.failed).toBe(0);

    // The detail read surfaces the closing warning for the assigned driver.
    const active = await makeJob(customerId, { driverId, pickupEndMinutes: 20, deliveryEndMinutes: 300 });
    const detail = await call(localDelivery.get, { params: { id: String(active.id) }, user: helperUser(driverId) });
    expect(detail.next).not.toHaveBeenCalled();
    expect(detail.res.payload.windowWarnings).toHaveLength(1);
    expect(detail.res.payload.windowWarnings[0].kind).toBe('closing');
    expect(detail.res.payload.windowWarnings[0].stopType).toBe('pickup');
  });

  test('465: the assigned driver gets exact navigation data; a marketplace driver gets rounded coords only', async () => {
    const browserId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makePostedJob(customerId);
    await pool.query('DELETE FROM delivery_job_stops WHERE delivery_job_id = $1', [job.id]);

    // A stranger (not the owner, not a driver) cannot read the stops.
    const strangerId = await makeUser('customer');
    const stranger = await call(localDelivery.listStops, { params: { id: String(job.id) }, user: customerUser(strangerId) });
    expect(stranger.next.mock.calls[0][0].status).toBe(404);

    // The marketplace driver opening the posted offer read-only sees the
    // sequence with rounded coordinates and no address, contact, or
    // instructions (D-63/D-65).
    const offered = await call(localDelivery.listStops, { params: { id: String(job.id) }, user: helperUser(browserId) });
    expect(offered.next).not.toHaveBeenCalled();
    expect(offered.res.payload.stops).toHaveLength(2);
    const [pickup, dropoff] = offered.res.payload.stops;
    expect(Number(pickup.lat)).toBe(40.12);
    expect(Number(pickup.lng)).toBe(-83.12);
    expect(Number(dropoff.lat)).toBe(40.23);
    expect(Number(dropoff.lng)).toBe(-83.23);
    expect(pickup.address).toBeUndefined();
    expect(pickup.contact_name).toBeUndefined();
    expect(pickup.instructions).toBeUndefined();
    expect(dropoff.address).toBeUndefined();

    // Once assigned, the same driver gets the exact coordinates and the
    // addresses the navigation handoff needs.
    await pool.query(
      `UPDATE delivery_jobs SET helper_user_id = $1, status = 'assigned', dispatch_state = 'assigned' WHERE id = $2`,
      [browserId, job.id],
    );
    const exact = await call(localDelivery.listStops, { params: { id: String(job.id) }, user: helperUser(browserId) });
    expect(exact.next).not.toHaveBeenCalled();
    expect(Number(exact.res.payload.stops[0].lat)).toBe(40.123456);
    expect(Number(exact.res.payload.stops[0].lng)).toBe(-83.123456);
    expect(exact.res.payload.stops[0].address).toBe('1 Origin Way');
    expect(exact.res.payload.stops[1].address).toBe('2 Destination Way');
  });
});
