'use strict';

// Group 11 Slice 2b acceptance: Find equipment (562, 563, 564, 565).
// Runs against a dedicated fresh database (credit_statement_test_g11b) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 562: browse-level date filter (per-date availability join in browse).
// 563: capacity/size/weight fields + filters.
// 564: pickup distance filter (haversine in SQL) + lat/lng on listings.
// 565: listing comparison (browse ?ids= + compare cap 3).

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP11_SLICE2B_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g11b') {
    throw new Error('Group 11 Slice 2b DB tests require the loopback credit_statement_test_g11b database');
  }
  process.env.DATABASE_URL = dbUrl;
}

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g11b-${id}@example.invalid`,
      email_verified: !req.get('x-test-unverified'),
    };
    return next();
  };
  return { authenticate, authenticateIfPresent: (req, res, next) => (
    req.get('x-test-user') ? authenticate(req, res, next) : next()
  ) };
});
jest.mock('../middleware/adminAuth', () => ({
  ...jest.requireActual('../middleware/adminAuth'),
  requireAdmin: (req, res, next) => {
    if (req.user?.role !== 'super_admin') return res.sendStatus(403);
    req.isSuper = true;
    return next();
  },
}));
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
  sendEmailOrThrow: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/bookingEmailService', () => ({
  sendBookingConfirmation: jest.fn(),
  sendBookingApproved: jest.fn(),
  sendBookingDeclined: jest.fn(),
}));
jest.mock('../growth/emit', () => ({
  emitDomainEvent: jest.fn().mockResolvedValue(undefined),
  commerceEventProps: (value) => value,
}));

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 11 Slice 2b: Find equipment (562, 563, 564, 565)', () => {
  let db;
  let app;

  beforeAll(async () => {
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/tool-rentals', require('../routes/toolRentals'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });

  afterAll(async () => { await db?.end(); });

  async function addUser(role = 'customer') {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed)
       VALUES ($1, $2, 'x', 'Equipment', 'Fixture', $3, $4, TRUE, TRUE, TRUE)`,
      [id, `g11b-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
    );
    mockRoles.set(id, role);
    return id;
  }

  async function grantToolOwner(userId) {
    await db.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES ($1, 'tool_owner.list_equipment', 'self', 'self', 'active', 'legacy_backfill', 'tool-owner-policy-2')
       ON CONFLICT DO NOTHING`,
      [userId],
    );
  }

  async function insertTool(ownerId, overrides = {}) {
    const row = {
      name: 'Cordless drill',
      category: 'Power Tools',
      description: '18V cordless drill with two batteries.',
      daily_rate: 18,
      hourly_rate: null,
      deposit_amount: 40,
      condition: 'good',
      brand: 'DeWalt',
      model: 'DCD771',
      is_available: true,
      requires_deposit: false,
      delivery_available: false,
      pickup_only: true,
      location_city: 'Austin',
      location_state: 'TX',
      image_gallery: ['https://example.invalid/drill.jpg'],
      moderation_hold: false,
      ...overrides,
    };
    const cols = ['user_id', 'name', 'category', 'description', 'daily_rate', 'hourly_rate',
      'deposit_amount', 'condition', 'brand', 'model', 'is_available', 'requires_deposit',
      'delivery_available', 'pickup_only', 'location_city', 'location_state',
      'image_gallery', 'moderation_hold'];
    const vals = [ownerId, row.name, row.category, row.description, row.daily_rate,
      row.hourly_rate, row.deposit_amount, row.condition, row.brand, row.model,
      row.is_available, row.requires_deposit, row.delivery_available, row.pickup_only,
      row.location_city, row.location_state, row.image_gallery, row.moderation_hold];
    // 563/564 columns are added by the slice migrations; include them when
    // the caller supplies them so fixtures can set capacity/coords directly.
    for (const col of ['capacity_value', 'capacity_unit', 'weight_kg', 'size_length_cm',
      'size_width_cm', 'size_height_cm', 'location_lat', 'location_lng']) {
      if (row[col] !== undefined) {
        cols.push(col);
        vals.push(row[col]);
      }
    }
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(
      `INSERT INTO tool_rentals (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      vals,
    );
    return rows[0];
  }

  async function insertBooking(toolId, customerId, ownerId, startDate, endDate, status = 'pending') {
    const { rows } = await db.query(
      `INSERT INTO tool_rentals_bookings (tool_id, customer_id, owner_id, start_date, end_date, total_price, status)
       VALUES ($1, $2, $3, $4, $5, 36, $6) RETURNING *`,
      [toolId, customerId, ownerId, startDate, endDate, status],
    );
    return rows[0];
  }

  const browse = (query = {}) => request(app).get('/api/tool-rentals/browse').query(query);

  describe('562: browse-level date filter', () => {
    test('without dates, browse returns every available listing', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      await insertTool(owner, { name: 'Drill A' });
      await insertTool(owner, { name: 'Saw B', category: 'Cutting Tools' });
      const res = await browse().expect(200);
      const names = res.body.tools.map((t) => t.name);
      expect(names).toContain('Drill A');
      expect(names).toContain('Saw B');
    });

    test('a listing booked across the requested range is excluded, others stay', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const booked = await insertTool(owner, { name: 'Booked drill' });
      const free = await insertTool(owner, { name: 'Free saw', category: 'Cutting Tools' });
      await insertBooking(booked.id, renter, owner, '2026-12-10', '2026-12-12');
      const res = await browse({ startDate: '2026-12-11', endDate: '2026-12-13' }).expect(200);
      const ids = res.body.tools.map((t) => t.id);
      expect(ids).not.toContain(booked.id);
      expect(ids).toContain(free.id);
    });

    test('a booking that only touches the boundary day still overlaps', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, { name: 'Boundary drill' });
      await insertBooking(tool.id, renter, owner, '2026-12-10', '2026-12-12');
      // Requested range starts on the booking's last day: end_date >= start.
      const overlapping = await browse({ startDate: '2026-12-12', endDate: '2026-12-14' }).expect(200);
      expect(overlapping.body.tools.map((t) => t.id)).not.toContain(tool.id);
      // Requested range ends the day before the booking starts: no overlap.
      const clear = await browse({ startDate: '2026-12-07', endDate: '2026-12-09' }).expect(200);
      expect(clear.body.tools.map((t) => t.id)).toContain(tool.id);
    });

    test('a cancelled booking does not block the dates', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, { name: 'Cancelled drill' });
      await insertBooking(tool.id, renter, owner, '2026-12-10', '2026-12-12', 'cancelled');
      const res = await browse({ startDate: '2026-12-10', endDate: '2026-12-12' }).expect(200);
      expect(res.body.tools.map((t) => t.id)).toContain(tool.id);
    });

    test('a live invoice_sent booking blocks, and bad ranges are rejected', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, { name: 'Invoiced drill' });
      await insertBooking(tool.id, renter, owner, '2026-12-10', '2026-12-12', 'invoice_sent');
      const blocked = await browse({ startDate: '2026-12-11', endDate: '2026-12-13' }).expect(200);
      expect(blocked.body.tools.map((t) => t.id)).not.toContain(tool.id);

      await browse({ startDate: '2026-12-11' }).expect(400);
      await browse({ startDate: '2026-12-12', endDate: '2026-12-11' }).expect(400);
      await browse({ startDate: '2026-12-12', endDate: '2026-12-12' }).expect(400);
      await browse({ startDate: '2026-02-30', endDate: '2026-03-02' }).expect(400);
      const bad = await browse({ startDate: '2026-12-12', endDate: '2026-12-11' }).expect(400);
      expect(bad.body.code).toBe('validation_failed');
    });
  });

  describe('563: capacity and size filters', () => {
    const createTool = (user, body) => request(app)
      .post('/api/tool-rentals')
      .set('x-test-user', user)
      .send({
        name: 'Generator',
        category: 'Generators & Power',
        description: 'Portable generator.',
        daily_rate: 45,
        location_city: 'Austin',
        location_state: 'TX',
        owner_attestation_accepted: true,
        ...body,
      });

    test('create stores capacity/size/weight and browse returns them', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      const res = await createTool(owner, {
        capacity_value: 2200, capacity_unit: 'W', weight_kg: 28,
        size_length_cm: 60, size_width_cm: 40, size_height_cm: 45,
      }).expect(201);
      expect(res.body.tool.capacity_value).toBe('2200.00');
      expect(res.body.tool.capacity_unit).toBe('W');
      expect(res.body.tool.weight_kg).toBe('28.00');
      expect(res.body.tool.size_length_cm).toBe('60.00');
      const browseRes = await browse({ name: 'Generator' }).expect(200);
      const found = browseRes.body.tools.find((t) => t.id === res.body.tool.id);
      expect(found.capacity_value).toBe('2200.00');
      expect(found.capacity_unit).toBe('W');
      expect(found.weight_kg).toBe('28.00');
    });

    test('capacity value without a unit, a bad unit, and a negative weight are rejected', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      await createTool(owner, { capacity_value: 10 }).expect(400);
      await createTool(owner, { capacity_value: 10, capacity_unit: 'furlongs' }).expect(400);
      await createTool(owner, { capacity_value: 10, capacity_unit: 'kg', weight_kg: -1 }).expect(400);
      const bad = await createTool(owner, { capacity_value: 10 }).expect(400);
      expect(bad.body.code).toBe('validation_failed');
      expect(bad.body.fields.capacity_unit).toMatch(/required/);
    });

    test('browse filters by minimum capacity with unit, max weight, and max length', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      const big = await insertTool(owner, {
        name: 'Big generator', category: 'Generators & Power',
        capacity_value: 3000, capacity_unit: 'W', weight_kg: 45, size_length_cm: 80,
      });
      const small = await insertTool(owner, {
        name: 'Small generator', category: 'Generators & Power',
        capacity_value: 1000, capacity_unit: 'W', weight_kg: 12, size_length_cm: 40,
      });
      const heavyKg = await insertTool(owner, {
        name: 'Heavy hoist', category: 'Lifting & Material Handling',
        capacity_value: 500, capacity_unit: 'kg', weight_kg: 120, size_length_cm: 150,
      });

      const byCapacity = await browse({ capacityMin: 2000, capacityUnit: 'W' }).expect(200);
      const capIds = byCapacity.body.tools.map((t) => t.id);
      expect(capIds).toContain(big.id);
      expect(capIds).not.toContain(small.id);
      expect(capIds).not.toContain(heavyKg.id); // different unit: kg is not W

      const byWeight = await browse({ weightMax: 20 }).expect(200);
      const weightIds = byWeight.body.tools.map((t) => t.id);
      expect(weightIds).toContain(small.id);
      expect(weightIds).not.toContain(big.id);
      expect(weightIds).not.toContain(heavyKg.id);

      const byLength = await browse({ lengthMax: 50 }).expect(200);
      const lengthIds = byLength.body.tools.map((t) => t.id);
      expect(lengthIds).toContain(small.id);
      expect(lengthIds).not.toContain(big.id);

      const byUnitOnly = await browse({ capacityUnit: 'kg' }).expect(200);
      const unitIds = byUnitOnly.body.tools.map((t) => t.id);
      expect(unitIds).toContain(heavyKg.id);
      expect(unitIds).not.toContain(big.id);

      await browse({ capacityMin: 10 }).expect(400); // unit required
      await browse({ capacityMin: 10, capacityUnit: 'furlongs' }).expect(400);
      await browse({ weightMax: -5 }).expect(400);
      await browse({ weightMax: 'heavy' }).expect(400);
    });

    test('partial update inherits the stored unit for the pair check', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      const noCapacity = await insertTool(owner, { name: 'Plain drill' });
      // Value alone with no stored unit: rejected.
      await request(app).put(`/api/tool-rentals/${noCapacity.id}`)
        .set('x-test-user', owner)
        .send({ capacity_value: 5 }).expect(400);
      // Value + unit together: accepted.
      const set = await request(app).put(`/api/tool-rentals/${noCapacity.id}`)
        .set('x-test-user', owner)
        .send({ capacity_value: 5, capacity_unit: 'kg' }).expect(200);
      expect(set.body.tool.capacity_value).toBe('5.00');
      expect(set.body.tool.capacity_unit).toBe('kg');
      // Value alone now inherits the stored unit: accepted.
      const bumped = await request(app).put(`/api/tool-rentals/${noCapacity.id}`)
        .set('x-test-user', owner)
        .send({ capacity_value: 8 }).expect(200);
      expect(bumped.body.tool.capacity_value).toBe('8.00');
      expect(bumped.body.tool.capacity_unit).toBe('kg');
    });
  });

  describe('564: pickup distance filter', () => {
    // Austin TX; Houston is ~146 mi away, Dallas ~195 mi.
    const AUSTIN = { lat: 30.2672, lng: -97.7431 };
    const HOUSTON = { lat: 29.7604, lng: -95.3698 };
    const DALLAS = { lat: 32.7767, lng: -96.7970 };

    const createTool = (user, body) => request(app)
      .post('/api/tool-rentals')
      .set('x-test-user', user)
      .send({
        name: 'Generator',
        category: 'Generators & Power',
        description: 'Portable generator.',
        daily_rate: 45,
        location_city: 'Austin',
        location_state: 'TX',
        owner_attestation_accepted: true,
        ...body,
      });

    test('create stores pickup coordinates and rejects a lone or out-of-range coordinate', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      const res = await createTool(owner, { location_lat: AUSTIN.lat, location_lng: AUSTIN.lng }).expect(201);
      expect(Number(res.body.tool.location_lat)).toBeCloseTo(AUSTIN.lat, 4);
      expect(Number(res.body.tool.location_lng)).toBeCloseTo(AUSTIN.lng, 4);
      await createTool(owner, { location_lat: AUSTIN.lat }).expect(400);
      await createTool(owner, { location_lat: 91, location_lng: 0 }).expect(400);
      await createTool(owner, { location_lat: 0, location_lng: 181 }).expect(400);
      const bad = await createTool(owner, { location_lat: AUSTIN.lat }).expect(400);
      expect(bad.body.code).toBe('validation_failed');
    });

    test('browse within a radius returns only nearby listings, nearest first, with distance_miles', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      const near = await insertTool(owner, {
        name: 'Near drill', location_city: 'Austin',
        location_lat: AUSTIN.lat, location_lng: AUSTIN.lng,
      });
      const houston = await insertTool(owner, {
        name: 'Houston saw', category: 'Cutting Tools', location_city: 'Houston',
        location_lat: HOUSTON.lat, location_lng: HOUSTON.lng,
      });
      const dallas = await insertTool(owner, {
        name: 'Dallas sander', category: 'Sanding & Finishing', location_city: 'Dallas',
        location_lat: DALLAS.lat, location_lng: DALLAS.lng,
      });
      const noCoords = await insertTool(owner, { name: 'Nowhere wrench', location_city: 'Austin' });

      // Fixtures from earlier tests share this database, so scope every
      // assertion to the three listings created here.
      const inScope = (rows) => rows.filter((t) => [near.id, houston.id, dallas.id].includes(t.id));
      const distanceOf = (rows, id) => Number(rows.find((t) => t.id === id).distance_miles);

      const tight = await browse({ lat: AUSTIN.lat, lng: AUSTIN.lng, radius: 10 }).expect(200);
      expect(inScope(tight.body.tools).map((t) => t.id)).toEqual([near.id]);
      expect(distanceOf(tight.body.tools, near.id)).toBeLessThan(0.1);

      const mid = await browse({ lat: AUSTIN.lat, lng: AUSTIN.lng, radius: 160 }).expect(200);
      const midIds = inScope(mid.body.tools).map((t) => t.id);
      expect(midIds).toEqual([near.id, houston.id]);
      expect(distanceOf(mid.body.tools, houston.id)).toBeGreaterThan(130);
      expect(distanceOf(mid.body.tools, houston.id)).toBeLessThan(160);
      expect(mid.body.tools.map((t) => t.id)).not.toContain(noCoords.id); // no coordinates: never matches

      const wide = await browse({ lat: AUSTIN.lat, lng: AUSTIN.lng, radius: 250 }).expect(200);
      expect(inScope(wide.body.tools).map((t) => t.id)).toEqual([near.id, houston.id, dallas.id]);
      expect(distanceOf(wide.body.tools, dallas.id)).toBeGreaterThan(180);
      expect(distanceOf(wide.body.tools, dallas.id)).toBeLessThan(210);

      // Explicit distance sort agrees with the default order under a filter.
      const sorted = await browse({ lat: AUSTIN.lat, lng: AUSTIN.lng, radius: 250, sort: 'distance' }).expect(200);
      expect(inScope(sorted.body.tools).map((t) => t.id)).toEqual([near.id, houston.id, dallas.id]);

      // Without a distance filter, no distance_miles is computed.
      const plain = await browse().expect(200);
      const plainNear = plain.body.tools.find((t) => t.id === near.id);
      expect(plainNear.distance_miles).toBeUndefined();
    });

    test('incomplete or invalid distance filters are rejected', async () => {
      await browse({ radius: 10 }).expect(400);
      await browse({ lat: AUSTIN.lat, lng: AUSTIN.lng }).expect(400);
      await browse({ lat: 91, lng: 0, radius: 10 }).expect(400);
      await browse({ lat: AUSTIN.lat, lng: AUSTIN.lng, radius: 0 }).expect(400);
      await browse({ lat: AUSTIN.lat, lng: AUSTIN.lng, radius: 501 }).expect(400);
      await browse({ sort: 'distance' }).expect(400);
      const bad = await browse({ lat: AUSTIN.lat, lng: AUSTIN.lng, radius: 0 }).expect(400);
      expect(bad.body.code).toBe('validation_failed');
    });

    test('partial update inherits the stored coordinate for the pair check', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, { name: 'Plain drill' });
      await request(app).put(`/api/tool-rentals/${tool.id}`)
        .set('x-test-user', owner)
        .send({ location_lat: AUSTIN.lat }).expect(400);
      const set = await request(app).put(`/api/tool-rentals/${tool.id}`)
        .set('x-test-user', owner)
        .send({ location_lat: AUSTIN.lat, location_lng: AUSTIN.lng }).expect(200);
      expect(Number(set.body.tool.location_lat)).toBeCloseTo(AUSTIN.lat, 4);
      const moved = await request(app).put(`/api/tool-rentals/${tool.id}`)
        .set('x-test-user', owner)
        .send({ location_lat: HOUSTON.lat }).expect(200);
      expect(Number(moved.body.tool.location_lat)).toBeCloseTo(HOUSTON.lat, 4);
      expect(Number(moved.body.tool.location_lng)).toBeCloseTo(AUSTIN.lng, 4);
    });
  });

  describe('565: listing comparison', () => {
    test('browse ?ids= returns the requested listings in the requested order', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      const first = await insertTool(owner, { name: 'Compare A', daily_rate: 10 });
      const second = await insertTool(owner, { name: 'Compare B', category: 'Cutting Tools', daily_rate: 20 });
      const third = await insertTool(owner, { name: 'Compare C', category: 'Sanding & Finishing', daily_rate: 30 });
      const res = await browse({ ids: `${third.id},${first.id}` }).expect(200);
      expect(res.body.tools.map((t) => t.id)).toEqual([third.id, first.id]);
      expect(res.body.tools[0].name).toBe('Compare C');
      expect(res.body.tools[1].daily_rate).toBe('10.00');
      const all = await browse({ ids: `${first.id},${second.id},${third.id}` }).expect(200);
      expect(all.body.tools.map((t) => t.id)).toEqual([first.id, second.id, third.id]);
    });

    test('compare fetch still applies the public gates', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      const visible = await insertTool(owner, { name: 'Visible drill' });
      const hidden = await insertTool(owner, { name: 'Hidden drill', is_available: false });
      const held = await insertTool(owner, { name: 'Held drill', moderation_hold: true });
      const res = await browse({ ids: `${visible.id},${hidden.id},${held.id}` }).expect(200);
      expect(res.body.tools.map((t) => t.id)).toEqual([visible.id]);
    });

    test('unknown ids return an empty list; bad ids are rejected', async () => {
      const none = await browse({ ids: '987654321' }).expect(200);
      expect(none.body.tools).toEqual([]);
      await browse({ ids: '1,2,3,4' }).expect(400); // cap is 3
      await browse({ ids: 'abc' }).expect(400);
      await browse({ ids: '' }).expect(400);
      await browse({ ids: '1.5' }).expect(400);
      const bad = await browse({ ids: '1,2,3,4' }).expect(400);
      expect(bad.body.code).toBe('validation_failed');
    });
  });
});
