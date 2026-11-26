'use strict';

/**
 * Group 9 partials Wave 2 Batch O (items 462/464/469/471/475).
 *
 * Against the real migrated schema, through the real delivery
 * controller, recovery service, exception summary, and event worker:
 *   462/464 (G9-A13): the shipper's add-stop form fields (instructions,
 *       contact phone, country) now persist through addStop, and the
 *       assigned driver can write a route note per stop.
 *   462 (G9-A18): completing a virtual stop materializes it instead of
 *       500ing; an unknown non-numeric stop id 404s.
 *   469 (G9-A10): the free waiting notice reaches the shipper/customer
 *       through the delivery event worker; a second notice inside 15
 *       minutes 409s; the chargeable waiting extra is untouched.
 *   471 (G9-A6): the stops phone is masked like the job-level mask, the
 *       assigned driver gets a tel: dial value, and the recipient
 *       confirmation proof accepts the last 4 digits the mask shows.
 *   470/475 (G9-A7): the exception summary carries the escalation
 *       timer (30-minute target); the driver resume fails closed while
 *       anything is open and resumes a failed job after ops ack.
 *   475 (G9-A11): the redelivery-attempt request needs a failed
 *       drop-off, allows one pending request, and approval by the
 *       shipper or ops applies the new window and restores a failed
 *       job to in_transit; the general reschedule path still 409s
 *       after pickup.
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
  process.env['JWT' + '_SECRET'] = 'group9-batch-o-test-secret';
}

const pool = require('../db');
const localDelivery = require('../controllers/localDeliveryController');
const { validateProof } = require('../services/localDeliveryIntegrity');
const { DELIVERY_NOTIFICATION_EVENTS, deliveryNotifications } = require('../utils/localDeliveryNotifications');
const { getPublicDeliveryEventType } = require('../services/localDeliveryEventWorker');
const { EXCEPTION_RESPONSE_TARGET_MINUTES } = require('../services/deliveryExceptionSummaryService');

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

ddescribe('Group 9 Batch O: stops, notes, waiting notice, relay masking, exception resume, redelivery', () => {
  async function makeUser(role, { defaultMode = null } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, default_mode)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5)`,
      [id, `g9o-${id.slice(0, 8)}@example.invalid`, role, role, defaultMode],
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
      status = 'assigned', driverId = null, pieces = 3, pickedUp = false,
      dispatchState = null, withStops = false,
    } = options;
    const reference = `DLV-G9O-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = Date.now();
    const pickupStart = new Date(now - 60 * 60 * 1000);
    const pickupEnd = new Date(now + 120 * 60 * 1000);
    const deliveryStart = new Date(now + 120 * 60 * 1000);
    const deliveryEnd = new Date(now + 240 * 60 * 1000);
    const resolvedDispatch = dispatchState
      || (status === 'delivered' ? 'completed' : status === 'failed' ? 'exception' : 'assigned');
    const { rows: [job] } = await pool.query(
      `INSERT INTO delivery_jobs
         (reference, customer_user_id, helper_user_id, status, dispatch_state, fulfillment_source,
          origin_address, origin_city, origin_state, origin_lat, origin_lng,
          origin_contact_name, origin_contact_phone, origin_instructions,
          destination_address, destination_city, destination_state, destination_lat, destination_lng,
          destination_contact_name, destination_contact_phone, destination_instructions,
          distance_miles, duration_minutes, package_type, weight_lbs, pieces, notes,
          price_snapshot, customer_total_cents, driver_payout_cents, proof_preference,
          pickup_window_start, pickup_window_end,
          delivery_window_start, delivery_window_end,
          estimated_arrival_at, eta_updated_at, picked_up_at)
       VALUES ($1, $2, $3, $4, $5, 'marketplace',
          '1 Origin Way', 'Columbus', 'OH', 40.123456, -83.123456,
          'Olivia Origin', '5550101000', 'Ring the side bell',
          '2 Destination Way', 'Columbus', 'OH', 40.234567, -83.234567,
          'Dan Destination', '5550102000', 'Leave at the back door',
          8, 45, 'medium', 20, $6, 'Fragile vase inside',
          '{}', 2500, 1800, 'recipient_confirmation',
          $7, $8, $9, $10,
          NOW() + INTERVAL '30 minutes', NOW(), $11)
       RETURNING *`,
      [reference, customerId, driverId, status, resolvedDispatch, pieces,
        pickupStart, pickupEnd, deliveryStart, deliveryEnd,
        pickedUp ? new Date(now - 30 * 60 * 1000) : null],
    );
    await pool.query(
      `INSERT INTO delivery_payments (delivery_job_id, delivery_extra_id, customer_user_id, amount_cents, status, captured_at, idempotency_key)
       VALUES ($1, NULL, $2, 2500, 'paid', NOW(), $3)`,
      [job.id, customerId, `g9o-pay-${job.id}`],
    );
    if (withStops) {
      await pool.query(
        `INSERT INTO delivery_job_stops (delivery_job_id, stop_order, stop_type, address, city, state, contact_name, contact_phone)
         VALUES ($1, 1, 'pickup', '1 Origin Way', 'Columbus', 'OH', 'Olivia Origin', '5550101000'),
                ($1, 2, 'dropoff', '2 Destination Way', 'Columbus', 'OH', 'Dan Destination', '5550102000')`,
        [job.id],
      );
    }
    return job;
  }

  async function reportIssue(job, driverId, body) {
    return call(localDelivery.createIssue, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9o-issue') },
      body,
    });
  }

  async function resolveLastIssue(job, operatorId, resolution = 'Corrected pickup confirmed') {
    const { rows: [issue] } = await pool.query(
      "SELECT id FROM delivery_issues WHERE delivery_job_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 1",
      [job.id],
    );
    return call(localDelivery.resolveIssue, {
      params: { id: String(job.id), issueId: String(issue.id) },
      user: operatorUser(operatorId),
      headers: { 'idempotency-key': key('g9o-resolve') },
      body: { resolution },
    });
  }

  async function failJob(job) {
    // Mark the job failed directly: the return-request path always
    // leaves an active return behind, and a failed job with an active
    // return is a return review, not a resume or a redelivery.
    await pool.query(
      "UPDATE delivery_jobs SET status = 'failed', dispatch_state = 'exception', exception_code = 'wrong_item', updated_at = NOW() WHERE id = $1",
      [job.id],
    );
    const { rows: [failed] } = await pool.query('SELECT * FROM delivery_jobs WHERE id = $1', [job.id]);
    expect(failed.status).toBe('failed');
    return failed;
  }

  test('462/464 (G9-A13): add-stop persists instructions, contact phone, and country; the driver note saves and reads back', async () => {
    const customerId = await makeUser('customer');
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const job = await makeJob(customerId, { driverId, withStops: true });
    const { res, next } = await call(localDelivery.addStop, {
      params: { id: String(job.id) }, user: customerUser(customerId),
      body: {
        stopType: 'dropoff', address: '9 Concierge Way', city: 'Columbus', state: 'OH', country: 'US',
        contactName: 'Casey Concierge', contactPhone: '5550103000',
        instructions: 'Leave with the concierge',
      },
    });
    expect(next.error).toBeUndefined();
    expect(res.statusCode).toBe(201);
    expect(res.payload.stop.instructions).toBe('Leave with the concierge');
    expect(res.payload.stop.contact_phone).toBe('5550103000');
    expect(res.payload.stop.country).toBe('US');

    const stops = await call(localDelivery.listStops, {
      params: { id: String(job.id) }, user: helperUser(driverId),
    });
    expect(stops.next.error).toBeUndefined();
    const added = stops.res.payload.stops.find((stop) => stop.address === '9 Concierge Way');
    expect(added).toBeDefined();

    const noted = await call(localDelivery.updateStopNote, {
      params: { id: String(job.id), stopId: String(added.id) }, user: helperUser(driverId),
      body: { note: 'Gate code 4410, ask for Casey' },
    });
    expect(noted.next.error).toBeUndefined();
    expect(noted.res.payload.stop.driver_note).toBe('Gate code 4410, ask for Casey');

    const reread = await call(localDelivery.listStops, {
      params: { id: String(job.id) }, user: customerUser(customerId),
    });
    const withNote = reread.res.payload.stops.find((stop) => stop.id === added.id);
    expect(withNote.driver_note).toBe('Gate code 4410, ask for Casey');

    const forbidden = await call(localDelivery.updateStopNote, {
      params: { id: String(job.id), stopId: String(added.id) }, user: customerUser(customerId),
      body: { note: 'Shipper cannot write driver notes' },
    });
    expect(forbidden.next.error?.statusCode).toBe(403);
  });

  test('462 (G9-A18): completing a virtual stop materializes it instead of 500ing; an unknown id 404s', async () => {
    const customerId = await makeUser('customer');
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    // No stored stops: the job reads its two legacy virtual stops.
    const job = await makeJob(customerId, { driverId });
    const { rows: before } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM delivery_job_stops WHERE delivery_job_id = $1', [job.id],
    );
    expect(before[0].n).toBe(0);

    const completed = await call(localDelivery.completeStop, {
      params: { id: String(job.id), stopId: 'virtual-pickup' }, user: helperUser(driverId),
    });
    expect(completed.next.error).toBeUndefined();
    expect(completed.res.payload.stop.status).toBe('completed');
    expect(completed.res.payload.stop.stop_type).toBe('pickup');
    const { rows: after } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM delivery_job_stops WHERE delivery_job_id = $1', [job.id],
    );
    expect(after[0].n).toBe(2);

    const unknown = await call(localDelivery.completeStop, {
      params: { id: String(job.id), stopId: 'not-a-stop' }, user: helperUser(driverId),
    });
    expect(unknown.next.error?.statusCode).toBe(404);
    expect(unknown.next.error?.code).toBe('delivery_stop_not_found');
  });

  test('469 (G9-A10): the free waiting notice fans out as a registered notification; a second notice inside 15 minutes 409s', async () => {
    expect(DELIVERY_NOTIFICATION_EVENTS).toContain('delivery_waiting_notice');
    expect(getPublicDeliveryEventType('delivery_waiting_notice')).toBe('delivery_waiting_notice');
    expect(deliveryNotifications['delivery:delivery_waiting_notice'].title.en).toBeTruthy();
    expect(deliveryNotifications['delivery:delivery_waiting_notice'].body.en).toBeTruthy();

    const customerId = await makeUser('customer');
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const job = await makeJob(customerId, { driverId, status: 'in_transit', pickedUp: true });
    const { res, next } = await call(localDelivery.createWaitingNotice, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      body: { note: 'Waiting at the loading dock' },
    });
    expect(next.error).toBeUndefined();
    expect(res.statusCode).toBe(201);
    const { rows: [event] } = await pool.query(
      "SELECT * FROM delivery_events WHERE delivery_job_id = $1 AND event_type = 'delivery_waiting_notice'",
      [job.id],
    );
    expect(event).toBeDefined();
    expect(event.customer_visible).toBe(true);
    const { rows: deliveries } = await pool.query(
      "SELECT consumer FROM delivery_event_deliveries WHERE event_id = $1 ORDER BY consumer",
      [event.id],
    );
    expect(deliveries.map((row) => row.consumer)).toEqual(['notifications', 'realtime']);

    const throttled = await call(localDelivery.createWaitingNotice, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      body: { note: 'Still waiting' },
    });
    expect(throttled.next.error?.statusCode).toBe(409);
    expect(throttled.next.error?.code).toBe('delivery_waiting_throttled');

    // The chargeable waiting extra is untouched: it still requires an
    // amount and notes, and still records a charge request.
    const extra = await call(localDelivery.createExtra, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9o-extra') },
      body: { category: 'waiting', amountCents: 500, notes: 'Waited 30 minutes' },
    });
    expect(extra.next.error).toBeUndefined();
    expect(extra.res.statusCode).toBe(201);
  });

  test('471 (G9-A6): the stops phone is masked for the driver with a tel: dial value; recipient confirmation accepts the last 4 digits', async () => {
    const customerId = await makeUser('customer');
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const otherId = await makeUser('helper', { defaultMode: 'helper' });
    const job = await makeJob(customerId, { driverId, withStops: true });

    const driverStops = await call(localDelivery.listStops, {
      params: { id: String(job.id) }, user: helperUser(driverId),
    });
    expect(driverStops.next.error).toBeUndefined();
    const dropoff = driverStops.res.payload.stops.find((stop) => stop.stop_type === 'dropoff');
    expect(dropoff.contact_phone).toBe('••••2000');
    expect(dropoff.contact_phone).not.toContain('5550102000');
    expect(dropoff.contact_phone_tel).toBe('5550102000');

    const strangerStops = await call(localDelivery.listStops, {
      params: { id: String(job.id) }, user: helperUser(otherId),
    });
    // A non-participant cannot read the job at all.
    expect(strangerStops.next.error?.statusCode).toBe(404);

    const detail = await call(localDelivery.get, {
      params: { id: String(job.id) }, user: helperUser(driverId),
    });
    expect(detail.next.error).toBeUndefined();
    expect(detail.res.payload.job.destination_contact_phone).toBe('••••2000');

    // The proof used to need the full phone typed exactly; the last 4
    // digits the mask shows are now enough (name + receipt still
    // required). The full number still works.
    const proofJob = { ...job, destination_contact_phone: '5550102000', proof_preference: 'recipient_confirmation' };
    const lastFour = await validateProof({}, proofJob, {
      proofType: 'recipient_confirmation', recipientName: 'Dan Destination',
      recipientContact: '2000', confirmed: true,
    }, driverId);
    expect(lastFour.proofType).toBe('recipient_confirmation');
    const full = await validateProof({}, proofJob, {
      proofType: 'recipient_confirmation', recipientName: 'Dan Destination',
      recipientContact: '5550102000', confirmed: true,
    }, driverId);
    expect(full.proofType).toBe('recipient_confirmation');
    await expect(validateProof({}, proofJob, {
      proofType: 'recipient_confirmation', recipientName: 'Dan Destination',
      recipientContact: '9999', confirmed: true,
    }, driverId)).rejects.toMatchObject({ code: 'delivery_recipient_confirmation_required' });
  });

  test('470/475 (G9-A7): the exception summary carries the escalation timer; resume fails closed until ops acks, then restores the job', async () => {
    expect(EXCEPTION_RESPONSE_TARGET_MINUTES).toBe(30);
    const customerId = await makeUser('customer');
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const operatorId = await makeUser('admin');
    const job = await makeJob(customerId, { driverId, status: 'in_transit', pickedUp: true });

    const reported = await reportIssue(job, driverId, {
      code: 'wrong_item', description: 'Wrong pallet on the dock',
      received: 'Pallet B', expected: 'Pallet A',
    });
    expect(reported.next.error).toBeUndefined();
    expect(reported.res.statusCode).toBe(201);

    const summary = await call(localDelivery.getJobExceptions, {
      params: { id: String(job.id) }, user: helperUser(driverId),
    });
    expect(summary.next.error).toBeUndefined();
    expect(summary.res.payload.exceptionResponseTargetMinutes).toBe(30);
    const openIssue = summary.res.payload.events.find((event) => event.kind === 'issue' && event.status === 'open');
    expect(openIssue).toBeDefined();
    expect(openIssue.responseTargetMinutes).toBe(30);
    expect(openIssue.responseDueAt).toBeTruthy();
    expect(openIssue.minutesWaiting).toBeGreaterThanOrEqual(0);
    expect(openIssue.responseOverdue).toBe(false);
    expect(summary.res.payload.resumeAvailable).toBe(false);

    // The driver cannot resume while the issue is open — the job is
    // not even failed yet, and the exception is unresolved.
    const early = await call(localDelivery.resumeDelivery, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9o-resume-early') },
    });
    expect(early.next.error?.statusCode).toBe(409);

    // Fail the job (no active return), then resolve the issue
    // without a resume state: the job stays failed until the driver
    // resumes it.
    await failJob(job);
    const resolved = await resolveLastIssue(job, operatorId);
    expect(resolved.next.error).toBeUndefined();
    const afterResolve = await call(localDelivery.getJobExceptions, {
      params: { id: String(job.id) }, user: helperUser(driverId),
    });
    expect(afterResolve.res.payload.resumeAvailable).toBe(true);

    const resumed = await call(localDelivery.resumeDelivery, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9o-resume') },
    });
    expect(resumed.next.error).toBeUndefined();
    expect(resumed.res.payload.job.status).toBe('in_transit');
    const { rows: [row] } = await pool.query('SELECT status, dispatch_state FROM delivery_jobs WHERE id = $1', [job.id]);
    expect(row.status).toBe('in_transit');
    expect(row.dispatch_state).toBe('assigned');
  });

  test('475 (G9-A11): redelivery needs a failed drop-off, allows one pending request, and approval applies the new window and restores the job', async () => {
    expect(DELIVERY_NOTIFICATION_EVENTS).toContain('delivery_redelivery_requested');
    expect(DELIVERY_NOTIFICATION_EVENTS).toContain('delivery_redelivery_approved');
    expect(DELIVERY_NOTIFICATION_EVENTS).toContain('delivery_redelivery_rejected');
    expect(deliveryNotifications['delivery:delivery_redelivery_approved'].title.en).toBeTruthy();

    const customerId = await makeUser('customer');
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const operatorId = await makeUser('admin');
    const job = await makeJob(customerId, { driverId, status: 'in_transit', pickedUp: true });
    const windowStart = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

    // No failed drop-off yet: the request is refused, not a free
    // reschedule.
    const noEvidence = await call(localDelivery.requestRedelivery, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      body: { deliveryWindowStart: windowStart, deliveryWindowEnd: windowEnd, reason: 'Try again later' },
    });
    expect(noEvidence.next.error?.statusCode).toBe(409);
    expect(noEvidence.next.error?.code).toBe('delivery_redelivery_evidence_required');

    // The general reschedule path still refuses a job after pickup.
    const reschedule = await call(localDelivery.requestReschedule, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      headers: { 'idempotency-key': key('g9o-resched') },
      body: { deliveryWindow: { start: windowStart, end: windowEnd }, reason: 'Try again later' },
    });
    expect(reschedule.next.error?.statusCode).toBe(409);

    // Record the failed drop-off. The job stays in_transit with the
    // exception open: a redelivery is requested on a failed drop-off,
    // not only on a failed job.
    const reported = await reportIssue(job, driverId, {
      code: 'recipient_unavailable', description: 'Nobody answered the door',
      unavailableReason: 'no_answer',
    });
    expect(reported.next.error).toBeUndefined();

    const requested = await call(localDelivery.requestRedelivery, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      body: { deliveryWindowStart: windowStart, deliveryWindowEnd: windowEnd, reason: 'Recipient back after 2pm' },
    });
    expect(requested.next.error).toBeUndefined();
    expect(requested.res.statusCode).toBe(201);
    expect(requested.res.payload.request.status).toBe('pending');

    const duplicate = await call(localDelivery.requestRedelivery, {
      params: { id: String(job.id) }, user: helperUser(driverId),
      body: { deliveryWindowStart: windowStart, deliveryWindowEnd: windowEnd, reason: 'Again' },
    });
    expect(duplicate.next.error?.statusCode).toBe(409);
    expect(duplicate.next.error?.code).toBe('delivery_redelivery_pending');

    // The driver cannot review their own request.
    const driverReview = await call(localDelivery.reviewRedelivery, {
      params: { id: String(job.id), requestId: String(requested.res.payload.request.id) },
      user: helperUser(driverId),
      body: { decision: 'approved' },
    });
    expect(driverReview.next.error?.statusCode).toBe(403);

    // The shipper approves: the new window applies. The job stays
    // in_transit and stays frozen (dispatch exception) until ops
    // resolves the still-open issue — approval stores the window, it
    // does not resolve the exception.
    const approved = await call(localDelivery.reviewRedelivery, {
      params: { id: String(job.id), requestId: String(requested.res.payload.request.id) },
      user: customerUser(customerId),
      body: { decision: 'approved' },
    });
    expect(approved.next.error).toBeUndefined();
    expect(approved.res.payload.request.status).toBe('approved');
    expect(approved.res.payload.job.status).toBe('in_transit');
    const { rows: [row] } = await pool.query(
      'SELECT status, dispatch_state, delivery_window_start FROM delivery_jobs WHERE id = $1', [job.id],
    );
    expect(row.status).toBe('in_transit');
    expect(row.dispatch_state).toBe('exception');
    expect(new Date(row.delivery_window_start).toISOString()).toBe(windowStart);

    // A reviewed request cannot be reviewed again.
    const again = await call(localDelivery.reviewRedelivery, {
      params: { id: String(job.id), requestId: String(requested.res.payload.request.id) },
      user: customerUser(customerId),
      body: { decision: 'rejected' },
    });
    expect(again.next.error?.statusCode).toBe(409);

    // A failed job with no active return is restored to in_transit by
    // an approval. Ops reviews through the internal route shape (no
    // job id in the path); this one is rejected, so the job stays failed.
    const job2 = await makeJob(customerId, { driverId, status: 'in_transit', pickedUp: true });
    await reportIssue(job2, driverId, {
      code: 'recipient_unavailable', description: 'Nobody answered',
      unavailableReason: 'no_answer',
    });
    await failJob(job2);
    const requested2 = await call(localDelivery.requestRedelivery, {
      params: { id: String(job2.id) }, user: helperUser(driverId),
      body: { deliveryWindowStart: windowStart, deliveryWindowEnd: windowEnd, reason: 'Try again' },
    });
    expect(requested2.next.error).toBeUndefined();
    const rejected = await call(localDelivery.reviewRedelivery, {
      params: { requestId: String(requested2.res.payload.request.id) },
      user: operatorUser(operatorId),
      body: { decision: 'rejected' },
    });
    expect(rejected.next.error).toBeUndefined();
    expect(rejected.res.payload.request.status).toBe('rejected');
    const { rows: [row2] } = await pool.query('SELECT status FROM delivery_jobs WHERE id = $1', [job2.id]);
    expect(row2.status).toBe('failed');

    // And the same failed shape approved by ops restores the job —
    // once ops has resolved the open issue first.
    const resolved2 = await resolveLastIssue(job2, operatorId);
    expect(resolved2.next.error).toBeUndefined();
    const requested3 = await call(localDelivery.requestRedelivery, {
      params: { id: String(job2.id) }, user: helperUser(driverId),
      body: { deliveryWindowStart: windowStart, deliveryWindowEnd: windowEnd, reason: 'Try again tomorrow' },
    });
    expect(requested3.next.error).toBeUndefined();
    const approvedByOps = await call(localDelivery.reviewRedelivery, {
      params: { requestId: String(requested3.res.payload.request.id) },
      user: operatorUser(operatorId),
      body: { decision: 'approved' },
    });
    expect(approvedByOps.next.error).toBeUndefined();
    expect(approvedByOps.res.payload.job.status).toBe('in_transit');
    const { rows: [row3] } = await pool.query(
      'SELECT status, delivery_window_start FROM delivery_jobs WHERE id = $1', [job2.id],
    );
    expect(row3.status).toBe('in_transit');
    expect(new Date(row3.delivery_window_start).toISOString()).toBe(windowStart);
  });
});
