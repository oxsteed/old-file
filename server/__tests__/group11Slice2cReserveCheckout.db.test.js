'use strict';

// Group 11 Slice 2c acceptance: Reserve + Checkout (566, 568, 570, 571, 574, 575).
// Runs against a dedicated fresh database (credit_statement_test_g11c) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 566: availability calendar UI on the existing availability endpoint;
//   blocked dates cannot be selected (client helper) or submitted (server).
// 568: explicit owner approve/decline on a pending request, distinct from
//   invoicing; approval precedes the first invoice (D-258).
// 570: in-app confirmation receipt (booking + terms + invoice).
// 571: identity check status from the platform Didit state; an unverified
//   renter cannot complete pickup (D-259).
// 574: pickup appointment time slot (owner pickup window + renter pick).
// 575: distinct checkout acknowledgment at pickup, with the pickup
//   condition report attached as evidence (D-260).

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP11_SLICE2C_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g11c') {
    throw new Error('Group 11 Slice 2c DB tests require the loopback credit_statement_test_g11c database');
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
      email: req.get('x-test-email') || `g11c-${id}@example.invalid`,
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
jest.mock('../utils/invoiceEmail', () => ({
  sendInvoiceEmail: jest.fn().mockResolvedValue({ success: true }),
}));

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 11 Slice 2c: Reserve + Checkout (566, 568, 570, 571, 574, 575)', () => {
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

  async function addUser(role = 'customer', identity = {}) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed, didit_status, didit_verified_at)
       VALUES ($1, $2, 'x', 'Equipment', 'Fixture', $3, $4, TRUE, TRUE, TRUE, $5, $6)`,
      [id, `g11c-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer',
        identity.diditStatus || 'pending', identity.diditVerifiedAt || null],
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
    for (const col of ['capacity_value', 'capacity_unit', 'weight_kg', 'size_length_cm',
      'size_width_cm', 'size_height_cm', 'location_lat', 'location_lng',
      'pickup_window_start', 'pickup_window_end']) {
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

  async function insertBooking(toolId, customerId, ownerId, startDate, endDate, status = 'pending', extra = {}) {
    const cols = ['tool_id', 'customer_id', 'owner_id', 'start_date', 'end_date', 'total_price', 'status'];
    const vals = [toolId, customerId, ownerId, startDate, endDate, 36, status];
    for (const [col, value] of Object.entries(extra)) {
      cols.push(col);
      vals.push(value);
    }
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(
      `INSERT INTO tool_rentals_bookings (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      vals,
    );
    return rows[0];
  }

  async function createBookingViaApi(renterId, toolId, startDate, endDate, extra = {}) {
    return request(app)
      .post('/api/tool-rentals/bookings')
      .set('x-test-user', renterId)
      .send({
        toolId, startDate, endDate, renterAgreementAccepted: true, ...extra,
      });
  }

  async function insertPickupReport(bookingId, actorId, phase = 'pickup') {
    const { rows } = await db.query(
      `INSERT INTO equipment_reports (booking_id, actor_id, phase, version, counts, checklist, notes)
       VALUES ($1, $2, $3, 1, '[]'::jsonb, '[]'::jsonb, 'Checked at pickup') RETURNING *`,
      [bookingId, actorId, phase],
    );
    return rows[0];
  }

  async function setBookingStatus(bookingId, status) {
    await db.query('UPDATE tool_rentals_bookings SET status = $2 WHERE id = $1', [bookingId, status]);
  }

  describe('566: availability calendar', () => {
    test('availability returns the booked ranges the calendar renders', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, { name: 'Calendar drill' });
      await insertBooking(tool.id, renter, owner, '2026-12-10', '2026-12-12');
      const res = await request(app)
        .get(`/api/tool-rentals/${tool.id}/availability`)
        .expect(200);
      expect(res.body.booked_dates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ start_date: expect.stringContaining('2026-12-10'), end_date: expect.stringContaining('2026-12-12') }),
        ]),
      );
    });

    test('a range over booked dates cannot be submitted, even if the client allowed it', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, { name: 'Blocked drill' });
      await insertBooking(tool.id, renter, owner, '2026-12-10', '2026-12-12');
      // Overlapping the booked range: refused.
      const blocked = await createBookingViaApi(renter, tool.id, '2026-12-11', '2026-12-13');
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('conflict');
      // Touching the boundary day: still overlap (inclusive rule).
      const boundary = await createBookingViaApi(renter, tool.id, '2026-12-12', '2026-12-14');
      expect(boundary.status).toBe(409);
      // Clear range: accepted.
      const clear = await createBookingViaApi(renter, tool.id, '2026-12-13', '2026-12-15');
      expect(clear.status).toBe(201);
    });
  });
});
