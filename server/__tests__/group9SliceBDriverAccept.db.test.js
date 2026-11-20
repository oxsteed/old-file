'use strict';

/**
 * Group 9 Slice B (items 456-460), Driver/shipper accept work.
 *
 * Against the real migrated schema, through the real delivery controller
 * and dispatch service:
 *   456 (verify only): the offered-assignment inbox still holds at this
 *       tip — GET /delivery/jobs returns posted marketplace jobs with
 *       the claim path, and POST /delivery/jobs/:id/claim assigns one.
 *   457: releaseMarketplace stamps an offer deadline (default 24h,
 *       configurable 1-168h); a claim past the deadline 409s with
 *       delivery_offer_expired; the hourly sweep stamps offer_expired_at
 *       and notifies the customer exactly once; the expired job stays
 *       posted and surfaces on the dispatch board; a re-offer stamps a
 *       fresh deadline and clears the marker.
 *   458 (data contract): a marketplace offer carries rounded (~1 km)
 *       coordinates for the route preview and no exact addresses; the
 *       assigned driver gets the exact coordinates.
 *   459 (verify only): PATCH /delivery/driver-profile/availability
 *       flips the flag, and claiming stays ungated by it (the toggle
 *       gates the feed only, by design).
 *   460: POST /delivery/jobs/:id/decline records a reason code + note,
 *       upserts per driver per job, never blocks claiming (the same job
 *       or any other), and surfaces to dispatch in getInternalJob and
 *       on the list as my_decline.
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
  process.env['JWT' + '_SECRET'] = 'group9-slice-b-test-secret';
}

const pool = require('../db');
const localDelivery = require('../controllers/localDeliveryController');
const dispatchService = require('../services/localDeliveryDispatchService');
const { customerSafeJob } = require('../services/localDeliveryIntegrity');
const { sweepExpiredDeliveryOffers } = require('../services/deliveryOfferExpiryService');
const dispatch = dispatchService.createDispatchService();
const claimAction = dispatch.actions.claim;
const declineAction = dispatch.actions.decline;
const releaseAction = dispatch.actions.releaseMarketplace;

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

ddescribe('Group 9 Slice B: driver accept work (456-460)', () => {
  async function makeUser(role, { defaultMode = null } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, default_mode)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5)`,
      [id, `g9b-${id.slice(0, 8)}@example.invalid`, role, role, defaultMode],
    );
    return id;
  }

  function helperUser(id) {
    return { id, role: 'helper', default_mode: 'helper' };
  }

  function opsUser(id) {
    return { id, role: 'admin' };
  }

  async function makeApprovedProfile(driverId) {
    await pool.query(
      `INSERT INTO delivery_driver_profiles
         (user_id, approved, active, vehicle_type, max_payload_lbs, cargo_length_in, cargo_width_in, cargo_height_in,
          equipment, service_area, insurance_acknowledged, max_pieces, available)
       VALUES ($1, TRUE, TRUE, 'car', 500, 40, 40, 40, '{}', '{}'::jsonb, TRUE, 3, TRUE)
       ON CONFLICT (user_id) DO UPDATE SET approved = TRUE, active = TRUE`,
      [driverId],
    );
  }

  async function makeMarketplaceJob(customerId, { originState = 'OH', destinationState = 'OH', offerExpiresAt = null } = {}) {
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
          delivery_window_start, delivery_window_end,
          offer_expires_at, offer_deadline_hours)
       VALUES ($1, $2, 'posted', 'marketplace_posted', 'marketplace',
          '1 Origin Way', 'Columbus', $3, 40.123456, -83.123456, '2 Destination Way', 'Columbus', $4, 40.234567, -83.234567,
          8, 'medium', 20, 1,
          '{}', 1000, 700, $5, $6, $5, $7, $8, 24)
       RETURNING *`,
      [`DLV-G9B-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, customerId, originState, destinationState, start, pickupEnd, deliveryEnd,
        offerExpiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()],
    );
    await pool.query(
      `INSERT INTO delivery_payments (delivery_job_id, delivery_extra_id, customer_user_id, amount_cents, status, captured_at, idempotency_key)
       VALUES ($1, NULL, $2, 1000, 'paid', NOW(), $3)`,
      [job.id, customerId, `g9b-pay-${job.id}`],
    );
    return job;
  }

  async function makeInternalJob(customerId) {
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
       VALUES ($1, $2, 'posted', 'internal_review', 'internal',
          '1 Origin Way', 'Columbus', 'OH', 40.0, -83.0, '2 Destination Way', 'Columbus', 'OH', 40.1, -83.1,
          8, 'medium', 20, 1,
          '{}', 1000, 700, $3, $4, $3, $5)
       RETURNING *`,
      [`DLV-G9B-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, customerId, start, pickupEnd, deliveryEnd],
    );
    await pool.query(
      `INSERT INTO delivery_payments (delivery_job_id, delivery_extra_id, customer_user_id, amount_cents, status, captured_at, idempotency_key)
       VALUES ($1, NULL, $2, 1000, 'paid', NOW(), $3)`,
      [job.id, customerId, `g9b-pay-${job.id}`],
    );
    return job;
  }

  function actionReq({ jobId, user, body = {}, key }) {
    return {
      params: { id: String(jobId) },
      body,
      user,
      headers: { 'idempotency-key': key || `g9b-${crypto.randomUUID()}` },
    };
  }

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('456 (verify): the inbox lists posted marketplace jobs and claim assigns one', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeApprovedProfile(driverId);
    const job = await makeMarketplaceJob(customerId);

    const listed = await call(localDelivery.list, { user: helperUser(driverId), query: {} });
    expect(listed.next).not.toHaveBeenCalled();
    const offered = listed.res.payload.jobs.find((entry) => String(entry.id) === String(job.id));
    expect(offered).toBeTruthy();
    expect(offered.status).toBe('posted');
    expect(offered.marketplace_available).toBe(true);
    expect(offered.offer_expires_at).toBeTruthy();
    expect(offered.offer_deadline_hours).toBe(24);
    expect(offered.offer_expired).toBe(false);
    expect(offered.my_decline).toBeNull();

    const claimed = await claimAction(actionReq({ jobId: job.id, user: helperUser(driverId) }));
    expect(claimed.response.success).toBe(true);
    expect(claimed.response.job.status).toBe('assigned');
    expect(claimed.response.job.is_assigned_operator).toBe(true);
  });

  test('457: release stamps the deadline (default 24h, custom hours); invalid hours 400', async () => {
    const opsId = await makeUser('admin');
    const customerId = await makeUser('customer');
    const job = await makeInternalJob(customerId);

    const released = await releaseAction(actionReq({
      jobId: job.id, user: opsUser(opsId), body: { reason: 'no internal driver free' },
    }));
    expect(released.response.success).toBe(true);
    expect(released.response.job.dispatch_state).toBe('marketplace_posted');
    const deadline = new Date(released.response.job.offer_expires_at).getTime();
    expect(deadline).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(deadline).toBeLessThan(Date.now() + 25 * 60 * 60 * 1000);
    expect(released.response.job.offer_deadline_hours).toBe(24);
    expect(released.response.job.offer_expired_at).toBeNull();

    const job2 = await makeInternalJob(customerId);
    const released48 = await releaseAction(actionReq({
      jobId: job2.id, user: opsUser(opsId), body: { reason: 'weekend coverage', offerDeadlineHours: 48 },
    }));
    expect(released48.response.job.offer_deadline_hours).toBe(48);
    const deadline48 = new Date(released48.response.job.offer_expires_at).getTime();
    expect(deadline48).toBeGreaterThan(Date.now() + 47 * 60 * 60 * 1000);

    const job3 = await makeInternalJob(customerId);
    await expect(releaseAction(actionReq({
      jobId: job3.id, user: opsUser(opsId), body: { reason: 'bad hours', offerDeadlineHours: 200 },
    }))).rejects.toMatchObject({ code: 'delivery_offer_deadline_invalid' });
  });

  test('457: a claim past the deadline 409s; the sweep stamps, notifies once, and the job stays posted', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeApprovedProfile(driverId);
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const job = await makeMarketplaceJob(customerId, { offerExpiresAt: past });

    await expect(claimAction(actionReq({ jobId: job.id, user: helperUser(driverId) })))
      .rejects.toMatchObject({ code: 'delivery_offer_expired' });

    const sent = [];
    const first = await sweepExpiredDeliveryOffers(pool, {
      send: async (notification) => { sent.push(notification); return { success: true }; },
    });
    expect(first.expired).toBeGreaterThanOrEqual(1);
    const mine = sent.filter((n) => n.userId === customerId);
    expect(mine).toHaveLength(1);
    expect(mine[0].type).toBe('delivery_offer_expired');
    expect(mine[0].data.deliveryJobId).toBe(String(job.id));

    const stamped = (await pool.query(
      'SELECT status, dispatch_state, offer_expired_at, offer_expiry_notice_sent_at FROM delivery_jobs WHERE id = $1',
      [job.id],
    )).rows[0];
    expect(stamped.status).toBe('posted');
    expect(stamped.dispatch_state).toBe('marketplace_posted');
    expect(stamped.offer_expired_at).toBeTruthy();
    expect(stamped.offer_expiry_notice_sent_at).toBeTruthy();

    const sentAgain = [];
    const second = await sweepExpiredDeliveryOffers(pool, {
      send: async (notification) => { sentAgain.push(notification); return { success: true }; },
    });
    expect(second.notified).toBe(0);
    expect(sentAgain.filter((n) => n.userId === customerId)).toHaveLength(0);

    // The expired offer is back with dispatch: it surfaces on the board.
    const queue = await call(localDelivery.internalQueue, {});
    expect(queue.next).not.toHaveBeenCalled();
    const onBoard = queue.res.payload.jobs.find((entry) => String(entry.id) === String(job.id));
    expect(onBoard).toBeTruthy();
    expect(onBoard.offer_expired_at).toBeTruthy();
  });

  test('457: a re-offer stamps a fresh deadline and clears the expired marker', async () => {
    const opsId = await makeUser('admin');
    const customerId = await makeUser('customer');
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const job = await makeMarketplaceJob(customerId, { offerExpiresAt: past });
    await pool.query('UPDATE delivery_jobs SET offer_expired_at = NOW(), offer_expiry_notice_sent_at = NOW() WHERE id = $1', [job.id]);

    const reoffered = await releaseAction(actionReq({
      jobId: job.id, user: opsUser(opsId), body: { reason: 'second chance for drivers', offerDeadlineHours: 12 },
    }));
    expect(reoffered.response.success).toBe(true);
    expect(reoffered.response.job.offer_expired_at).toBeNull();
    expect(reoffered.response.job.offer_expiry_notice_sent_at).toBeNull();
    expect(reoffered.response.job.offer_deadline_hours).toBe(12);
    const deadline = new Date(reoffered.response.job.offer_expires_at).getTime();
    expect(deadline).toBeGreaterThan(Date.now() + 11 * 60 * 60 * 1000);

    // A live offer re-released is a duplicate, not a new deadline.
    const again = await releaseAction(actionReq({
      jobId: job.id, user: opsUser(opsId), body: { reason: 'already live' },
    }));
    expect(again.response.duplicate).toBe(true);
    expect(again.response.job.offer_deadline_hours).toBe(12);
  });

  test('458: a marketplace offer carries rounded coordinates and no exact address; the assigned driver gets exact ones', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const job = await makeMarketplaceJob(customerId);
    const row = (await pool.query('SELECT * FROM delivery_jobs WHERE id = $1', [job.id])).rows[0];

    const offered = customerSafeJob(row, { id: driverId });
    expect(offered.marketplace_available).toBe(true);
    expect(offered.origin_lat).toBe(40.12);
    expect(offered.origin_lng).toBe(-83.12);
    expect(offered.destination_lat).toBe(40.23);
    expect(offered.destination_lng).toBe(-83.23);
    expect(offered.origin_address).toBeUndefined();
    expect(offered.destination_address).toBeUndefined();
    expect(offered.origin_contact_name).toBeUndefined();

    const assigned = customerSafeJob({ ...row, helper_user_id: driverId }, { id: driverId });
    expect(Number(assigned.origin_lat)).toBe(40.123456);
    expect(Number(assigned.destination_lng)).toBe(-83.234567);
    expect(assigned.origin_address).toBe('1 Origin Way');
  });

  test('459 (verify): the availability toggle flips the flag and never gates claiming', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeApprovedProfile(driverId);
    const job = await makeMarketplaceJob(customerId);

    const off = await call(localDelivery.setDriverAvailability, {
      user: helperUser(driverId), body: { available: false },
    });
    expect(off.next).not.toHaveBeenCalled();
    expect(off.res.payload.profile.available).toBe(false);

    // Offline gates the feed only: the claim path never reads `available`.
    const claimed = await claimAction(actionReq({ jobId: job.id, user: helperUser(driverId) }));
    expect(claimed.response.success).toBe(true);
    expect(claimed.response.job.status).toBe('assigned');
    expect(claimed.response.job.is_assigned_operator).toBe(true);

    const on = await call(localDelivery.setDriverAvailability, {
      user: helperUser(driverId), body: { available: true },
    });
    expect(on.res.payload.profile.available).toBe(true);
  });

  test('460: decline records a reason + note, upserts per driver, and never blocks claiming', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const otherId = await makeUser('helper', { defaultMode: 'helper' });
    const opsId = await makeUser('admin');
    const customerId = await makeUser('customer');
    await makeApprovedProfile(driverId);
    await makeApprovedProfile(otherId);
    const job = await makeMarketplaceJob(customerId);

    const declined = await declineAction(actionReq({
      jobId: job.id, user: helperUser(driverId),
      body: { reasonCode: 'too_far', note: '45 miles out' },
    }));
    expect(declined.response.success).toBe(true);
    expect(declined.response.decline.reason_code).toBe('too_far');
    expect(declined.response.decline.note).toBe('45 miles out');

    // A second decline from the same driver updates the one row.
    const changed = await declineAction(actionReq({
      jobId: job.id, user: helperUser(driverId),
      body: { reasonCode: 'pay', note: '' },
    }));
    expect(changed.response.decline.reason_code).toBe('pay');
    const rows = await pool.query(
      'SELECT * FROM delivery_job_declines WHERE delivery_job_id = $1 AND driver_user_id = $2',
      [job.id, driverId],
    );
    expect(rows.rows).toHaveLength(1);

    // Another driver's decline is a separate row, and the list shows
    // each driver only their own decline.
    await declineAction(actionReq({
      jobId: job.id, user: helperUser(otherId), body: { reasonCode: 'schedule_conflict' },
    }));
    const listed = await call(localDelivery.list, { user: helperUser(driverId), query: {} });
    const offered = listed.res.payload.jobs.find((entry) => String(entry.id) === String(job.id));
    expect(offered.my_decline.reason_code).toBe('pay');
    const listedOther = await call(localDelivery.list, { user: helperUser(otherId), query: {} });
    const offeredOther = listedOther.res.payload.jobs.find((entry) => String(entry.id) === String(job.id));
    expect(offeredOther.my_decline.reason_code).toBe('schedule_conflict');

    // Dispatch sees both declines on the job review.
    const review = await call(localDelivery.getInternalJob, { user: opsUser(opsId), params: { id: String(job.id) } });
    expect(review.next).not.toHaveBeenCalled();
    expect(review.res.payload.declines).toHaveLength(2);
    expect(review.res.payload.declines.map((d) => d.reason_code).sort()).toEqual(['pay', 'schedule_conflict']);

    // Declining never blocks claiming: the same driver claims the job.
    const claimed = await claimAction(actionReq({ jobId: job.id, user: helperUser(driverId) }));
    expect(claimed.response.success).toBe(true);
    expect(claimed.response.job.status).toBe('assigned');
  });

  test('460: decline rejects bad reasons and non-offered jobs', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeApprovedProfile(driverId);
    const job = await makeMarketplaceJob(customerId);

    await expect(declineAction(actionReq({
      jobId: job.id, user: helperUser(driverId), body: { reasonCode: 'not_a_reason' },
    }))).rejects.toMatchObject({ code: 'delivery_decline_reason_invalid' });
    await expect(declineAction(actionReq({
      jobId: job.id, user: helperUser(driverId), body: {},
    }))).rejects.toMatchObject({ code: 'delivery_decline_reason_invalid' });

    // Once claimed, the job is no longer an offer to decline.
    await claimAction(actionReq({ jobId: job.id, user: helperUser(driverId) }));
    await expect(declineAction(actionReq({
      jobId: job.id, user: helperUser(driverId), body: { reasonCode: 'pay' },
    }))).rejects.toMatchObject({ code: 'delivery_decline_unavailable' });
  });
});
