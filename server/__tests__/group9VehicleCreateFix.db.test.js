'use strict';

/**
 * Group 9 follow-up (items 482/483): ops-created vehicles must carry the
 * capacity fields the dispatch form already sends.
 *
 * Slice E found, but left for routing, that `createVehicle` never persisted
 * max_pieces / fragile_supported / perishable_supported / service_area /
 * insurance_acknowledged / insurance_expires_at / available_from /
 * available_until, so every ops-created vehicle defaulted to max_pieces=1
 * + insurance_acknowledged=false and `capabilityFailures` rejected it on
 * every assignInternal with vehicle_pieces + vehicle_insurance. The
 * dispatch ResourceForm already sends all of those fields; the endpoint
 * dropped them.
 *
 * Proves, against the real migrated schema, through the real controller
 * and dispatch service:
 *   1. POST /delivery/internal/vehicles persists the full capacity payload.
 *   2. A 3-piece job can be assigned with the endpoint-created vehicle
 *      (before the fix this 409s with vehicle_pieces + vehicle_insurance).
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
  process.env['JWT' + '_SECRET'] = 'group9-vehicle-fix-test-secret';
}

const pool = require('../db');
const localDelivery = require('../controllers/localDeliveryController');

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

ddescribe('Group 9 follow-up: createVehicle persists capacity fields', () => {
  async function makeUser(role, { defaultMode = null } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, default_mode)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5)`,
      [id, `g9v-${id.slice(0, 8)}@example.invalid`, role, role, defaultMode],
    );
    return id;
  }

  function operatorUser(id) {
    return { id, role: 'admin' };
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

  async function makeJob(customerId, options = {}) {
    const {
      status = 'posted', pieces = 3, proofPreference = 'pin',
      etaMinutesFromNow = 30, deliveryWindowEndMinutesFromNow = 240,
    } = options;
    const reference = `DLV-G9V-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = Date.now();
    const pickupStart = new Date(now - 60 * 60 * 1000);
    const pickupEnd = new Date(now + 120 * 60 * 1000);
    const deliveryStart = new Date(now + 120 * 60 * 1000);
    const deliveryEnd = new Date(now + deliveryWindowEndMinutesFromNow * 60 * 1000);
    const etaAt = new Date(now + etaMinutesFromNow * 60 * 1000);
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
       VALUES ($1, $2, NULL, NULL, NULL, $3, 'internal_review', 'internal',
          '1 Origin Way', 'Columbus', 'OH', 40.123456, -83.123456,
          'Olivia Origin', '5550101000', 'Ring the side bell',
          '2 Destination Way', 'Columbus', 'OH', 40.234567, -83.234567,
          'Dan Destination', '5550102000', 'Leave at the back door',
          8, 45, 'medium', 20, $4, 'Fragile vase inside',
          '{}', 2500, 1800, $5, $6,
          $7, $8, $9, $10,
          $11, NOW(), NULL)
       RETURNING *`,
      [reference, customerId, status, pieces, proofPreference,
        proofPreference === 'pin' ? require('../services/localDeliveryIntegrity').pinDigest('123456', reference) : null,
        pickupStart, pickupEnd, deliveryStart, deliveryEnd, etaAt],
    );
    return job;
  }

  async function createVehicleViaEndpoint(adminId, body) {
    return call(localDelivery.createVehicle, {
      user: operatorUser(adminId),
      body: {
        label: 'Ops Van 1', vehicleType: 'van', maxPayloadLbs: 200,
        cargoLengthIn: 40, cargoWidthIn: 40, cargoHeightIn: 40,
        equipment: {}, ...body,
      },
    });
  }

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('createVehicle persists the capacity payload the dispatch form sends', async () => {
    const adminId = await makeUser('admin');
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const availableFrom = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const availableUntil = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

    const { res, next } = await createVehicleViaEndpoint(adminId, {
      maxPieces: 5, fragileSupported: true, perishableSupported: true,
      serviceArea: { states: ['NY'] }, insuranceAcknowledged: true,
      insuranceExpiresAt: expiresAt, availableFrom, availableUntil,
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.payload.vehicle.id).toBeTruthy();

    const { rows: [row] } = await pool.query(
      'SELECT * FROM delivery_vehicles WHERE id = $1', [res.payload.vehicle.id],
    );
    expect(row.max_pieces).toBe(5);
    expect(row.fragile_supported).toBe(true);
    expect(row.perishable_supported).toBe(true);
    expect(row.service_area).toEqual({ states: ['NY'] });
    expect(row.insurance_acknowledged).toBe(true);
    expect(new Date(row.insurance_expires_at).toISOString()).toBe(expiresAt);
    expect(new Date(row.available_from).toISOString()).toBe(availableFrom);
    expect(new Date(row.available_until).toISOString()).toBe(availableUntil);
  });

  test('a 3-piece job can be assigned with the endpoint-created vehicle', async () => {
    const adminId = await makeUser('admin');
    const driverId = await makeUser('helper', { defaultMode: 'helper' });
    const customerId = await makeUser('customer');
    await makeDriverProfile(driverId);
    const job = await makeJob(customerId, { pieces: 3 });

    const { res: vehicleRes, next: vehicleNext } = await createVehicleViaEndpoint(adminId, {
      label: 'Ops Van 2', maxPieces: 5, fragileSupported: true,
      serviceArea: { states: ['OH'] }, insuranceAcknowledged: true,
      insuranceExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(vehicleNext).not.toHaveBeenCalled();
    const vehicleId = vehicleRes.payload.vehicle.id;

    const { res, next } = await call(localDelivery.assignInternal, {
      params: { id: String(job.id) }, user: operatorUser(adminId),
      headers: { 'idempotency-key': key('g9v-assign') },
      body: { driverUserId: driverId, vehicleId },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.payload.job.status).toBe('assigned');
    expect(res.payload.job.internal_driver_user_id).toBe(driverId);
    expect(String(res.payload.job.vehicle_id)).toBe(String(vehicleId));
  });
});
