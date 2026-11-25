'use strict';

/**
 * Group 9 partials Wave 2 Batch M (items 454, 456, 459, 460).
 *
 * Against the real migrated schema, through the real delivery controller
 * and dispatch service:
 *   G9-A2 (454/456, D-534): a claim with no service area set 409s with
 *       delivery_service_area_required; a set area claims.
 *   G9-A2 (454/456, D-535): the claim enforces a 50-mile sanity from the
 *       driver's sent location, and the feed's 50-mile filter engages
 *       from an explicit lat/lng and from the stored service-area center
 *       when the client sends none.
 *   G9-A3 (459, D-536): claim and assignInternal refuse an offline
 *       driver with delivery_driver_offline; going online restores both.
 *   G9-A19 (456, D-537): the feed paginates (limit/offset + total).
 *   G9-A9 (456, D-538): the hourly offer digest notifies only approved,
 *       active, available drivers whose service area covers the job,
 *       caps at 10 jobs per driver, marks a job only once per release,
 *       and re-digests a re-offer; the type sends through the real send
 *       path with a non-empty localized title.
 *   G9-A14 (457/460, D-539): declining an expired offer still succeeds
 *       server-side (the leg the UI fix exposes).
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
  process.env['JWT' + '_SECRET'] = 'group9-batch-m-test-secret';
}

const pool = require('../db');
const localDelivery = require('../controllers/localDeliveryController');
const dispatchService = require('../services/localDeliveryDispatchService');
const { hasServiceArea, serviceAreaCenter, haversineMiles } = dispatchService;
const { sweepDeliveryOfferDigest } = require('../services/deliveryOfferDigestService');
const { tNotif } = require('../utils/i18n');
const dispatch = dispatchService.createDispatchService();
const claimAction = dispatch.actions.claim;
const declineAction = dispatch.actions.decline;
const assignAction = dispatch.actions.assignInternal;

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

ddescribe('Group 9 Batch M: feed, geo, availability, offers (454/456/459/460)', () => {
  async function makeUser(role, { defaultMode = null } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, default_mode)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5)`,
      [id, `g9m-${id.slice(0, 8)}@example.invalid`, role, role, defaultMode],
    );
    return id;
  }

  function helperUser(id) {
    return { id, role: 'helper', default_mode: 'helper' };
  }

  function opsUser(id) {
    return { id, role: 'admin' };
  }

  async function makeProfile(driverId, { serviceArea = { states: ['OH'] }, available = true } = {}) {
    await pool.query(
      `INSERT INTO delivery_driver_profiles
         (user_id, approved, active, vehicle_type, max_payload_lbs, cargo_length_in, cargo_width_in, cargo_height_in,
          equipment, service_area, insurance_acknowledged, max_pieces, available)
       VALUES ($1, TRUE, TRUE, 'car', 500, 40, 40, 40, '{}', $2::jsonb, TRUE, 3, $3)
       ON CONFLICT (user_id) DO UPDATE SET approved = TRUE, active = TRUE, service_area = EXCLUDED.service_area, available = EXCLUDED.available`,
      [driverId, JSON.stringify(serviceArea), available],
    );
  }

  async function makeVehicle(label = 'Van M') {
    const { rows: [vehicle] } = await pool.query(
      `INSERT INTO delivery_vehicles (label, vehicle_type, max_payload_lbs, cargo_length_in, cargo_width_in, cargo_height_in, equipment,
          max_pieces, fragile_supported, perishable_supported, insurance_acknowledged, service_area)
       VALUES ($1, 'van', 200, 40, 40, 40, '{}', 10, TRUE, TRUE, TRUE, '{}') RETURNING *`,
      [label],
    );
    return vehicle;
  }

  async function makeMarketplaceJob(customerId, {
    originState = 'OH', destinationState = 'OH',
    originLat = 40.123456, originLng = -83.123456,
    destinationLat = 40.234567, destinationLng = -83.234567,
    offerExpiresAt = null, releasedAt = null,
  } = {}) {
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
          offer_expires_at, offer_deadline_hours, marketplace_released_at, marketplace_release_reason)
       VALUES ($1, $2, 'posted', 'marketplace_posted', 'marketplace',
          '1 Origin Way', 'Columbus', $3, $4, $5, '2 Destination Way', 'Columbus', $6, $7, $8,
          8, 'medium', 20, 1,
          '{}', 1000, 700, $9, $10, $9, $11,
          $12, 24, $13, 'batch M fixture')`,
      [`DLV-G9M-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, customerId, originState, originLat, originLng,
        destinationState, destinationLat, destinationLng, start, pickupEnd, deliveryEnd,
        offerExpiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        releasedAt || new Date().toISOString()],
    );
    await pool.query(
      `INSERT INTO delivery_payments (delivery_job_id, delivery_extra_id, customer_user_id, amount_cents, status, captured_at, idempotency_key)
       VALUES ($1, NULL, $2, 1000, 'paid', NOW(), $3)`,
      [job.id, customerId, `g9m-pay-${job.id}`],
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
      [`DLV-G9M-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, customerId, start, pickupEnd, deliveryEnd],
    );
    await pool.query(
      `INSERT INTO delivery_payments (delivery_job_id, delivery_extra_id, customer_user_id, amount_cents, status, captured_at, idempotency_key)
       VALUES ($1, NULL, $2, 1000, 'paid', NOW(), $3)`,
      [job.id, customerId, `g9m-pay-${job.id}`],
    );
    return job;
  }

  function actionReq({ jobId, user, body = {}, key }) {
    return {
      params: { id: String(jobId) },
      body,
      user,
      headers: { 'idempotency-key': key || `g9m-${crypto.randomUUID()}` },
    };
  }

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('hasServiceArea / serviceAreaCenter / haversineMiles agree on the area shapes', () => {
    expect(hasServiceArea(null)).toBe(false);
    expect(hasServiceArea({})).toBe(false);
    expect(hasServiceArea('{}')).toBe(false);
    expect(hasServiceArea('not json')).toBe(false);
    expect(hasServiceArea({ states: [] })).toBe(false);
    expect(hasServiceArea({ states: ['OH'] })).toBe(true);
    expect(hasServiceArea({ cities: ['Columbus'] })).toBe(true);
    expect(hasServiceArea('{"states":["OH"]}')).toBe(true);
    expect(hasServiceArea({ center: { lat: 40, lng: -83 } })).toBe(false);
    expect(hasServiceArea({ center: { lat: 40, lng: -83 }, radiusMiles: 25 })).toBe(true);
    expect(serviceAreaCenter({ center: { lat: 40, lng: -83 }, radiusMiles: 25 })).toEqual({ lat: 40, lng: -83 });
    expect(serviceAreaCenter({ states: ['OH'] })).toBeNull();
    expect(serviceAreaCenter('{"center":{"lat":40,"lng":-83}}')).toEqual({ lat: 40, lng: -83 });
    expect(haversineMiles(40.123456, -83.123456, 40.123456, -83.123456)).toBeCloseTo(0, 6);
    expect(haversineMiles(40.123456, -83.123456, 34.0522, -118.2437)).toBeGreaterThan(1000);
    expect(haversineMiles(40.123456, -83.123456, 40.234567, -83.234567)).toBeLessThan(50);
  });

  test('G9-A2 (D-534): a claim with no service area set 409s; a set area claims', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeProfile(driverId, { serviceArea: {} });
    const job = await makeMarketplaceJob(customerId);

    await expect(claimAction(actionReq({ jobId: job.id, user: helperUser(driverId) })))
      .rejects.toMatchObject({ code: 'delivery_service_area_required' });

    // Setting the area (the fix the error points at) unblocks the claim.
    await makeProfile(driverId, { serviceArea: { states: ['OH'] } });
    const claimed = await claimAction(actionReq({ jobId: job.id, user: helperUser(driverId) }));
    expect(claimed.response.success).toBe(true);
    expect(claimed.response.job.status).toBe('assigned');
  });

  test('G9-A2 (D-535): the claim refuses a pickup more than 50 miles from the sent location', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeProfile(driverId, { serviceArea: { states: ['OH'] } });
    const job = await makeMarketplaceJob(customerId);

    // Los Angeles is ~1,900 miles from the Columbus pickup: the area
    // covers the job (OH), so only the distance sanity refuses.
    await expect(claimAction(actionReq({
      jobId: job.id, user: helperUser(driverId), body: { lat: 34.0522, lng: -118.2437 },
    }))).rejects.toMatchObject({ code: 'delivery_claim_too_far' });

    // At the pickup, the same driver claims the same job.
    const claimed = await claimAction(actionReq({
      jobId: job.id, user: helperUser(driverId), body: { lat: 40.123456, lng: -83.123456 },
    }));
    expect(claimed.response.success).toBe(true);
    expect(claimed.response.job.status).toBe('assigned');
  });

  test('G9-A3 (D-536): claim and assignInternal refuse an offline driver; online restores both', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    const adminId = await makeUser('admin');
    await makeProfile(driverId, { serviceArea: { states: ['OH'] }, available: false });
    const job = await makeMarketplaceJob(customerId);
    const internalJob = await makeInternalJob(customerId);
    const vehicle = await makeVehicle();

    await expect(claimAction(actionReq({ jobId: job.id, user: helperUser(driverId) })))
      .rejects.toMatchObject({ code: 'delivery_driver_offline' });
    await expect(assignAction(actionReq({
      jobId: internalJob.id, user: opsUser(adminId),
      body: { driverUserId: driverId, vehicleId: String(vehicle.id) },
    }))).rejects.toMatchObject({ code: 'delivery_driver_offline' });

    await call(localDelivery.setDriverAvailability, { user: helperUser(driverId), body: { available: true } });

    const claimed = await claimAction(actionReq({ jobId: job.id, user: helperUser(driverId) }));
    expect(claimed.response.success).toBe(true);
    const assigned = await assignAction(actionReq({
      jobId: internalJob.id, user: opsUser(adminId),
      body: { driverUserId: driverId, vehicleId: String(vehicle.id) },
    }));
    expect(assigned.response.success).toBe(true);
    expect(assigned.response.job.internal_driver_user_id).toBe(driverId);
  });

  test('G9-A19 (D-537): the feed paginates with limit/offset and a total', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeProfile(driverId, { serviceArea: { states: ['OH'] } });
    await makeMarketplaceJob(customerId);
    await makeMarketplaceJob(customerId);
    await makeMarketplaceJob(customerId);

    const first = await call(localDelivery.list, { user: helperUser(driverId), query: { limit: '2', offset: '0' } });
    expect(first.next).not.toHaveBeenCalled();
    expect(first.res.payload.jobs).toHaveLength(2);
    expect(first.res.payload.limit).toBe(2);
    expect(first.res.payload.offset).toBe(0);
    expect(first.res.payload.total).toBeGreaterThanOrEqual(3);

    const total = first.res.payload.total;
    const last = await call(localDelivery.list, { user: helperUser(driverId), query: { limit: '2', offset: String(total - 1) } });
    expect(last.res.payload.jobs).toHaveLength(1);
    expect(last.res.payload.total).toBe(total);

    const all = await call(localDelivery.list, { user: helperUser(driverId), query: {} });
    expect(all.res.payload.limit).toBe(100);
    expect(all.res.payload.total).toBe(total);
  });

  test('G9-A2 (D-535): the feed geo filter engages from an explicit location and from the stored center', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeProfile(driverId, {
      serviceArea: { states: ['OH'], center: { lat: 40.123456, lng: -83.123456 }, radiusMiles: 25 },
    });
    const nearJob = await makeMarketplaceJob(customerId);
    const farJob = await makeMarketplaceJob(customerId, {
      originState: 'CA', destinationState: 'CA',
      originLat: 34.0522, originLng: -118.2437, destinationLat: 34.0622, destinationLng: -118.2537,
    });

    // Explicit Los Angeles location: the Columbus job is out of range.
    const fromFar = await call(localDelivery.list, {
      user: helperUser(driverId), query: { lat: '34.0522', lng: '-118.2437' },
    });
    expect(fromFar.next).not.toHaveBeenCalled();
    const fromFarIds = fromFar.res.payload.jobs.map((entry) => String(entry.id));
    expect(fromFarIds).toContain(String(farJob.id));
    expect(fromFarIds).not.toContain(String(nearJob.id));

    // No location sent: the stored Columbus center is the fallback, so
    // the Los Angeles job drops out and the Columbus job stays.
    const fromCenter = await call(localDelivery.list, { user: helperUser(driverId), query: {} });
    expect(fromCenter.next).not.toHaveBeenCalled();
    const fromCenterIds = fromCenter.res.payload.jobs.map((entry) => String(entry.id));
    expect(fromCenterIds).toContain(String(nearJob.id));
    expect(fromCenterIds).not.toContain(String(farJob.id));
  });

  test('G9-A9 (D-538): the digest notifies only covering, available drivers, once per release', async () => {
    // Michigan isolates this test from the Ohio jobs other tests in this
    // file leave posted: only a Michigan-area driver can cover it.
    const customerId = await makeUser('customer');
    const coveringId = await makeUser('helper', { defaultMode: 'helper' });
    const farAreaId = await makeUser('helper', { defaultMode: 'helper' });
    const offlineId = await makeUser('helper', { defaultMode: 'helper' });
    await makeProfile(coveringId, { serviceArea: { states: ['MI'] }, available: true });
    await makeProfile(farAreaId, { serviceArea: { states: ['CA'] }, available: true });
    await makeProfile(offlineId, { serviceArea: { states: ['MI'] }, available: false });
    const job = await makeMarketplaceJob(customerId, {
      originState: 'MI', destinationState: 'MI', originLat: 42.3314, originLng: -83.0458,
      destinationLat: 42.3414, destinationLng: -83.0558,
    });

    const sent = [];
    const first = await sweepDeliveryOfferDigest(pool, {
      send: async (notification) => { sent.push(notification); return { success: true }; },
    });
    expect(first.notified).toBeGreaterThanOrEqual(1);
    const mine = sent.filter((n) => n.userId === coveringId && n.type === 'delivery_offer_digest'
      && (n.data.deliveryJobIds || []).includes(String(job.id)));
    expect(mine).toHaveLength(1);
    expect(mine[0].data.params.count).toBeGreaterThanOrEqual(1);
    expect(mine[0].action_url).toBe('/delivery');
    expect(sent.some((n) => n.userId === farAreaId
      && (n.data.deliveryJobIds || []).includes(String(job.id)))).toBe(false);
    expect(sent.some((n) => n.userId === offlineId
      && (n.data.deliveryJobIds || []).includes(String(job.id)))).toBe(false);

    // A second run notifies nobody about the same release.
    const sentAgain = [];
    const second = await sweepDeliveryOfferDigest(pool, {
      send: async (notification) => { sentAgain.push(notification); return { success: true }; },
    });
    expect(sentAgain.filter((n) => (n.data.deliveryJobIds || []).includes(String(job.id)))).toHaveLength(0);
    expect(second.notified).toBe(0);

    // A re-offer (fresh release timestamp) is digested again.
    await pool.query(
      'UPDATE delivery_jobs SET marketplace_released_at = NOW(), offer_expires_at = NOW() + INTERVAL \'24 hours\' WHERE id = $1',
      [job.id],
    );
    const sentReoffer = [];
    const third = await sweepDeliveryOfferDigest(pool, {
      send: async (notification) => { sentReoffer.push(notification); return { success: true }; },
    });
    expect(third.notified).toBeGreaterThanOrEqual(1);
    expect(sentReoffer.filter((n) => n.userId === coveringId && n.type === 'delivery_offer_digest'
      && (n.data.deliveryJobIds || []).includes(String(job.id)))).toHaveLength(1);
  });

  test('G9-A9 (D-538): the digest caps at 10 jobs per driver and leaves unreached jobs unmarked', async () => {
    const customerId = await makeUser('customer');
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    await makeProfile(driverId, { serviceArea: { states: ['MI'] }, available: true });
    const jobs = [];
    for (let i = 0; i < 12; i += 1) {
      jobs.push(await makeMarketplaceJob(customerId, {
        originState: 'MI', destinationState: 'MI', originLat: 42.3314, originLng: -83.0458,
        destinationLat: 42.3414, destinationLng: -83.0558,
      }));
    }

    const sent = [];
    const result = await sweepDeliveryOfferDigest(pool, {
      send: async (notification) => { sent.push(notification); return { success: true }; },
    });
    expect(result.notified).toBeGreaterThanOrEqual(1);
    const mine = sent.filter((n) => n.userId === driverId && n.type === 'delivery_offer_digest');
    expect(mine).toHaveLength(1);
    expect(mine[0].data.params.count).toBeLessThanOrEqual(10);
    expect(mine[0].data.deliveryJobIds).toHaveLength(mine[0].data.params.count);

    // The jobs past the cap were not digested: no activity row marks
    // them, so a later run can still reach the driver about them.
    const { rows: marked } = await pool.query(
      `SELECT delivery_job_id FROM delivery_activity
        WHERE delivery_job_id = ANY($1::bigint[]) AND event_type = 'delivery_offer_digest_sent'`,
      [jobs.map((job) => job.id)],
    );
    const markedIds = new Set(marked.map((row) => String(row.delivery_job_id)));
    const unmarked = jobs.filter((job) => !markedIds.has(String(job.id)));
    expect(unmarked.length).toBeGreaterThanOrEqual(2);
  });

  test('G9-A9 (D-538): the digest type sends through the real path with a localized title', async () => {
    for (const language of ['en', 'es', 'fr', 'ht', 'ar']) {
      const text = tNotif('delivery_offer_digest', language, { count: 2 });
      expect(text.title.length).toBeGreaterThan(0);
      expect(text.body).toContain('2');
    }
    const customerId = await makeUser('customer');
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    await makeProfile(driverId, { serviceArea: { states: ['MI'] }, available: true });
    await pool.query(
      `INSERT INTO notification_preferences (user_id, email_notifications, unsubscribe_all)
       VALUES ($1, FALSE, FALSE) ON CONFLICT (user_id) DO UPDATE SET email_notifications = FALSE`,
      [driverId],
    );
    await makeMarketplaceJob(customerId, {
      originState: 'MI', destinationState: 'MI', originLat: 42.3314, originLng: -83.0458,
      destinationLat: 42.3414, destinationLng: -83.0558,
    });
    const result = await sweepDeliveryOfferDigest(pool);
    expect(result.notified).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query(
      `SELECT title, body FROM notifications WHERE user_id = $1 AND type = 'delivery_offer_digest'
        ORDER BY created_at DESC LIMIT 1`,
      [driverId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('New delivery offers');
    expect(rows[0].body.length).toBeGreaterThan(0);
    expect(/\d+/.test(rows[0].body)).toBe(true);
  });

  test('G9-A9 (D-538): a failed send leaves the job unmarked for the next run', async () => {
    const customerId = await makeUser('customer');
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    await makeProfile(driverId, { serviceArea: { states: ['MI'] }, available: true });
    const job = await makeMarketplaceJob(customerId, {
      originState: 'MI', destinationState: 'MI', originLat: 42.3314, originLng: -83.0458,
      destinationLat: 42.3414, destinationLng: -83.0558,
    });

    const failed = await sweepDeliveryOfferDigest(pool, {
      send: async () => ({ success: false, reason: 'injected failure' }),
    });
    expect(failed.failed).toBeGreaterThanOrEqual(1);
    const { rows: marked } = await pool.query(
      `SELECT id FROM delivery_activity WHERE delivery_job_id = $1 AND event_type = 'delivery_offer_digest_sent'`,
      [job.id],
    );
    expect(marked).toHaveLength(0);

    const sent = [];
    const retried = await sweepDeliveryOfferDigest(pool, {
      send: async (notification) => { sent.push(notification); return { success: true }; },
    });
    expect(retried.notified).toBeGreaterThanOrEqual(1);
    expect(sent.some((n) => (n.data.deliveryJobIds || []).includes(String(job.id)))).toBe(true);
  });

  test('G9-A14 (D-539): declining an expired offer still succeeds server-side', async () => {
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeProfile(driverId, { serviceArea: { states: ['OH'] } });
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const job = await makeMarketplaceJob(customerId, { offerExpiresAt: past });

    const declined = await declineAction(actionReq({
      jobId: job.id, user: helperUser(driverId), body: { reasonCode: 'too_far', note: 'Too far after expiry' },
    }));
    expect(declined.response.success).toBe(true);
    expect(declined.response.decline.reason_code).toBe('too_far');

    await expect(claimAction(actionReq({ jobId: job.id, user: helperUser(driverId) })))
      .rejects.toMatchObject({ code: 'delivery_offer_expired' });
  });
});
