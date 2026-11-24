'use strict';

// Group 11 Slice 2a acceptance: Get started (551, 552, 554, 555).
// Runs against a dedicated fresh database (credit_statement_test_g11a) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 551: equipment fields on the owner-application form (policy v2).
// 555: owner activation-status surface (GET /me carries the flags).
// 554: pickup eligibility check before booking.
// 552: listing readiness checklist (server-computed, in GET /me).

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP11_SLICE2A_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g11a') {
    throw new Error('Group 11 Slice 2a DB tests require the loopback credit_statement_test_g11a database');
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
      email: req.get('x-test-email') || `g11a-${id}@example.invalid`,
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
const TOOL_OWNER = 'tool_owner.list_equipment';

describeDb('Group 11 Slice 2a: Get started (551, 552, 554, 555)', () => {
  let db;
  let app;
  const savedFlags = { ...process.env };

  beforeAll(async () => {
    process.env.SIGNED_URL_SECRET = 'test-signed-url-secret';
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    db = require('../db');
    app = express();
    app.use(express.json());
    const progressiveAccess = require('../routes/progressiveAccess');
    app.use('/api/me', progressiveAccess.meRouter);
    const testAuthenticate = (req, res, next) => {
      const id = req.get('x-test-user');
      if (!id) return res.sendStatus(401);
      req.user = {
        id,
        role: mockRoles.get(id) || 'customer',
        email: req.get('x-test-email') || `g11a-${id}@example.invalid`,
        email_verified: !req.get('x-test-unverified'),
      };
      return next();
    };
    app.use('/api/admin/access-requests', testAuthenticate, progressiveAccess.adminRouter);
    app.use('/api/tool-rentals', require('../routes/toolRentals'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });

  afterEach(() => {
    for (const key of ['ACCESS_TOOL_OWNER_ENFORCEMENT', 'ACCESS_REQUESTS_ENABLED']) {
      if (savedFlags[key] === undefined) delete process.env[key];
      else process.env[key] = savedFlags[key];
    }
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
  });

  afterAll(async () => { await db?.end(); });

  async function addUser(role = 'customer') {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Equipment', 'Fixture', $3, $4, TRUE, TRUE)`,
      [id, `g11a-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
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
    const { rows } = await db.query(
      `INSERT INTO tool_rentals
         (user_id, name, category, description, daily_rate, hourly_rate, deposit_amount,
          condition, brand, model, is_available, requires_deposit, delivery_available,
          pickup_only, location_city, location_state, image_gallery, moderation_hold)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [ownerId, row.name, row.category, row.description, row.daily_rate, row.hourly_rate,
        row.deposit_amount, row.condition, row.brand, row.model, row.is_available,
        row.requires_deposit, row.delivery_available, row.pickup_only, row.location_city,
        row.location_state, row.image_gallery, row.moderation_hold],
    );
    return rows[0];
  }

  const ownerAnswers = {
    serviceArea: { country: 'US', region: 'TX', city: 'Austin', postalCode: '78701' },
    equipmentOwned: ['Cordless drill', 'Circular saw'],
    ownershipAttestation: 'owned_outright',
    equipmentCondition: 'good',
    pickupLocation: { country: 'US', region: 'TX', city: 'Austin', postalCode: '78701' },
  };

  describe('551: equipment owner application', () => {
    test('policy v2 lists the equipment fields after serviceArea', async () => {
      const applicant = await addUser();
      const res = await request(app)
        .get('/api/me/access-policies/tool_owner.list_equipment')
        .set('x-test-user', applicant)
        .expect(200);
      const policy = res.body.policy || res.body;
      expect(policy.policyVersion).toBe('tool-owner-policy-2');
      const names = (policy.form?.fields || []).map((f) => f.name);
      expect(names).toEqual([
        'serviceArea',
        'equipmentOwned',
        'ownershipAttestation',
        'equipmentCondition',
        'pickupLocation',
      ]);
      const byName = Object.fromEntries((policy.form?.fields || []).map((f) => [f.name, f]));
      expect(byName.equipmentOwned.type).toBe('string_list');
      expect(byName.ownershipAttestation.type).toBe('enum');
      expect(byName.equipmentCondition.type).toBe('enum');
      expect(byName.pickupLocation.type).toBe('service_area');
    });

    test('an application with the new fields submits and is reviewable with answers visible', async () => {
      const applicant = await addUser();
      const reviewer = await addUser('super_admin');
      const access = require('../services/access/accessService');
      const { body: { request: application } } = await access.createRequest(applicant, {
        capability: TOOL_OWNER,
        submit: true,
        answers: ownerAnswers,
      });
      expect(application.status).toBe('submitted');
      expect(application.policyVersion).toBe('tool-owner-policy-2');
      const stored = await db.query('SELECT answers FROM access_requests WHERE id = $1', [application.id]);
      expect(stored.rows[0].answers).toMatchObject({
        equipmentOwned: ['Cordless drill', 'Circular saw'],
        ownershipAttestation: 'owned_outright',
        equipmentCondition: 'good',
        pickupLocation: { country: 'US', city: 'Austin' },
      });
      // The admin review detail carries the current policy form (which the
      // review UI maps over generically) and the stored answers, so the new
      // fields render in the review view.
      const review = await request(app)
        .get(`/api/admin/access-requests/${application.id}`)
        .set('x-test-user', reviewer)
        .expect(200);
      expect((review.body.policy?.form?.fields || []).map((f) => f.name)).toContain('equipmentOwned');
      expect(JSON.stringify(review.body)).toContain('Circular saw');
      expect(JSON.stringify(review.body)).toContain('owned_outright');
      expect(JSON.stringify(review.body)).toContain('Austin');
    });

    test('submitting without the new equipment fields fails validation', async () => {
      const applicant = await addUser();
      const access = require('../services/access/accessService');
      let thrown = null;
      try {
        await access.createRequest(applicant, {
          capability: TOOL_OWNER,
          submit: true,
          answers: { serviceArea: ownerAnswers.serviceArea },
        });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).not.toBeNull();
      expect(thrown.code).toBe('validation_failed');
      expect(thrown.fields).toMatchObject({
        equipmentOwned: 'required',
        ownershipAttestation: 'required',
        equipmentCondition: 'required',
        pickupLocation: 'required',
      });
    });
  });
  describe('555: listing activation status', () => {
    const getMyTools = (user) => request(app)
      .get('/api/tool-rentals/me')
      .set('x-test-user', user);

    test('a granted owner sees published status with the activation flags', async () => {
      process.env.ACCESS_TOOL_OWNER_ENFORCEMENT = 'enforce';
      const owner = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      const res = await getMyTools(owner).expect(200);
      const mine = res.body.tools.find((t) => t.id === tool.id);
      expect(mine).toMatchObject({
        publication_blocked: false,
        activation_status: 'published',
        moderation_hold: false,
        is_available: true,
      });
      expect(mine.image_gallery).toEqual(['https://example.invalid/drill.jpg']);
    });

    test('an owner without the grant sees publication blocked with the reason', async () => {
      process.env.ACCESS_TOOL_OWNER_ENFORCEMENT = 'enforce';
      const owner = await addUser();
      const tool = await insertTool(owner);
      const res = await getMyTools(owner).expect(200);
      const mine = res.body.tools.find((t) => t.id === tool.id);
      expect(mine).toMatchObject({ publication_blocked: true, activation_status: 'blocked_access' });
    });

    test('enforcement off never blocks publication', async () => {
      process.env.ACCESS_TOOL_OWNER_ENFORCEMENT = 'off';
      const owner = await addUser();
      const tool = await insertTool(owner);
      const res = await getMyTools(owner).expect(200);
      const mine = res.body.tools.find((t) => t.id === tool.id);
      expect(mine).toMatchObject({ publication_blocked: false, activation_status: 'published' });
    });

    test('a moderation hold beats the other states', async () => {
      process.env.ACCESS_TOOL_OWNER_ENFORCEMENT = 'enforce';
      const owner = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, { moderation_hold: true });
      const res = await getMyTools(owner).expect(200);
      const mine = res.body.tools.find((t) => t.id === tool.id);
      expect(mine).toMatchObject({ moderation_hold: true, activation_status: 'blocked_hold' });
    });

    test('a granted owner who turned the listing off sees unavailable', async () => {
      process.env.ACCESS_TOOL_OWNER_ENFORCEMENT = 'enforce';
      const owner = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, { is_available: false });
      const res = await getMyTools(owner).expect(200);
      const mine = res.body.tools.find((t) => t.id === tool.id);
      expect(mine).toMatchObject({ publication_blocked: false, activation_status: 'unavailable' });
    });
  });

  describe('554: pickup eligibility check', () => {
    const book = (toolId, renter, body) => request(app)
      .post('/api/tool-rentals/bookings')
      .set('x-test-user', renter)
      .send({
        toolId,
        startDate: '2030-06-01',
        endDate: '2030-06-03',
        renterAgreementAccepted: true,
        ...body,
      });

    test('delivery is refused on a pickup-only listing, pickup succeeds', async () => {
      const owner = await addUser();
      const renter = await addUser();
      const tool = await insertTool(owner, { pickup_only: true, delivery_available: false });
      const refused = await book(tool.id, renter, { fulfillment: 'delivery' }).expect(409);
      expect(refused.body.code).toBe('fulfillment_not_available');
      const ok = await book(tool.id, renter, { fulfillment: 'pickup' }).expect(201);
      expect(ok.body.agreement_snapshot.rental.fulfillment).toBe('pickup');
    });

    test('delivery succeeds when the listing offers it and is not pickup-only', async () => {
      const owner = await addUser();
      const renter = await addUser();
      const tool = await insertTool(owner, { pickup_only: false, delivery_available: true });
      const ok = await book(tool.id, renter, { fulfillment: 'delivery' }).expect(201);
      expect(ok.body.agreement_snapshot.rental.fulfillment).toBe('delivery');
    });

    test('pickup-only wins even when delivery_available is also set', async () => {
      const owner = await addUser();
      const renter = await addUser();
      const tool = await insertTool(owner, { pickup_only: true, delivery_available: true });
      const refused = await book(tool.id, renter, { fulfillment: 'delivery' }).expect(409);
      expect(refused.body.code).toBe('fulfillment_not_available');
    });

    test('no fulfillment defaults to pickup', async () => {
      const owner = await addUser();
      const renter = await addUser();
      const tool = await insertTool(owner);
      const ok = await book(tool.id, renter, {}).expect(201);
      expect(ok.body.agreement_snapshot.rental.fulfillment).toBe('pickup');
    });

    test('an unknown fulfillment value is a validation error', async () => {
      const owner = await addUser();
      const renter = await addUser();
      const tool = await insertTool(owner);
      const res = await book(tool.id, renter, { fulfillment: 'courier' }).expect(400);
      expect(res.body.code).toBe('validation_failed');
    });

    test('a listing whose owner lost email verification cannot be booked by direct id', async () => {
      const owner = await addUser();
      await db.query('UPDATE users SET email_verified = FALSE WHERE id = $1', [owner]);
      const renter = await addUser();
      const tool = await insertTool(owner);
      const res = await book(tool.id, renter, { fulfillment: 'pickup' }).expect(404);
      expect(res.body.code).toBe('not_found');
    });
  });

  describe('552: listing readiness checklist', () => {
    const getMyTools = (user) => request(app)
      .get('/api/tool-rentals/me')
      .set('x-test-user', user);
    const readinessOf = async (owner, toolId) => {
      const res = await getMyTools(owner).expect(200);
      return res.body.tools.find((t) => t.id === toolId).readiness;
    };

    test('a complete listing is ready on every check', async () => {
      const owner = await addUser();
      const tool = await insertTool(owner);
      expect(await readinessOf(owner, tool.id)).toEqual({
        ready: true,
        checks: { photos: true, specs: true, pricing: true, fulfillment: true },
        missing: [],
      });
    });

    test('no photos fails only the photos check', async () => {
      const owner = await addUser();
      const tool = await insertTool(owner, { image_gallery: [] });
      const readiness = await readinessOf(owner, tool.id);
      expect(readiness.ready).toBe(false);
      expect(readiness.checks.photos).toBe(false);
      expect(readiness.missing).toEqual(['photos']);
    });

    test('missing brand and model fails the specs check', async () => {
      const owner = await addUser();
      const tool = await insertTool(owner, { brand: null, model: '' });
      const readiness = await readinessOf(owner, tool.id);
      expect(readiness.checks.specs).toBe(false);
      expect(readiness.missing).toContain('specs');
    });

    test('a zero daily rate fails pricing, and a required but unset deposit fails pricing', async () => {
      const owner = await addUser();
      const noPrice = await insertTool(owner, { daily_rate: 0 });
      expect((await readinessOf(owner, noPrice.id)).checks.pricing).toBe(false);
      const noDeposit = await insertTool(owner, { requires_deposit: true, deposit_amount: 0 });
      expect((await readinessOf(owner, noDeposit.id)).checks.pricing).toBe(false);
    });

    test('no pickup and no delivery fails the fulfillment check', async () => {
      const owner = await addUser();
      const tool = await insertTool(owner, { pickup_only: false, delivery_available: false });
      const readiness = await readinessOf(owner, tool.id);
      expect(readiness.checks.fulfillment).toBe(false);
      expect(readiness.missing).toContain('fulfillment');
    });
  });
});
