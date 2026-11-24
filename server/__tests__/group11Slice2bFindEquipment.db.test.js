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
});
