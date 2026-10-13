'use strict';

/**
 * Bundle G-bizhub (P2-3) broken-findings regression tests.
 *
 * F01: membership remove is core team management, not a Vortex code flow, so
 *      the route must not 503 behind VORTEX_ENABLED; approve/deny stay gated
 *      and the UI only renders them when the feature is launched.
 * F02: manager invite/revoke 404'd because the controller used the
 *      owner-only ownedBusiness() lookup despite the route's
 *      bizIdAccess('manager') gate.
 * F03: business_service_blocked_times had zero writers; the new CRUD
 *      endpoints are the writers.
 * F07: quoteOrder restaurant eligibility must match createOrder (no kiosk
 *      bypass, no paused/unlisted allowance).
 * F08: the customer-facing slot endpoint must subtract blocked times like
 *      the merchant slot engine does.
 * F09: payout request/approve/reject notify the owner (i18n entries exist).
 * F11: invites to emails without an account send an invitation email.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

const content = require('../controllers/businessContentController');
const members = require('../controllers/businessMembersController');
const booking = require('../controllers/bookingController');
const food = require('../controllers/foodController');
const { tNotif, tNotifEmail } = require('../utils/i18n');

const emailUtils = require('../utils/email');
emailUtils.sendBusinessInviteEmail = jest.fn().mockResolvedValue({ success: true, id: 'x' });

const OWNER = { id: '00000000-0000-4000-8000-000000000111', email: 'owner@example.com', first_name: 'Olive' };
const MANAGER = { id: '00000000-0000-4000-8000-000000000222', email: 'manager@example.com', first_name: 'Moe' };
const BIZ = { id: 7, business_name: 'Acme Services', owner_id: OWNER.id };

function buildBlockedTimesApp(user = OWNER) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.get('/api/businesses/:businessId/services/:serviceId/blocked-times', content.listServiceBlockedTimes);
  app.post('/api/businesses/:businessId/services/:serviceId/blocked-times', content.createServiceBlockedTime);
  app.delete('/api/businesses/:businessId/services/:serviceId/blocked-times/:blockId', content.deleteServiceBlockedTime);
  app.use(errorHandler);
  return app;
}

function buildInviteApp(user = MANAGER) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    // Simulate bizIdAccess('manager') having attached the business.
    req.business = { ...BIZ };
    next();
  });
  app.post('/api/businesses/:id/members', members.inviteMember);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

// ── F03: blocked-time writers ────────────────────────────────────────────────
describe('F03 service blocked times', () => {
  const future = () => {
    const s = new Date(Date.now() + 48 * 3600 * 1000);
    const e = new Date(Date.now() + 50 * 3600 * 1000);
    return { start: s.toISOString(), end: e.toISOString() };
  };

  test('creates a block for a manager (201)', async () => {
    const { start, end } = future();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: BIZ.id, owner_id: OWNER.id }] }) // canEditProfile
      .mockResolvedValueOnce({ rows: [{ id: 9 }] })                          // service belongs to business
      .mockResolvedValueOnce({ rows: [] })                                   // no overlap
      .mockResolvedValueOnce({ rows: [{ id: 'b1', service_id: 9, business_id: 7, start_time: start, end_time: end }] });
    const res = await request(buildBlockedTimesApp())
      .post('/api/businesses/7/services/9/blocked-times')
      .send({ start_time: start, end_time: end, reason: 'Vacation' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('b1');
    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO business_service_blocked_times/.test(sql));
    expect(insertCall).toBeTruthy();
    // created_by_id is the acting manager, business scoping is the business id
    // (params arrive as strings from req.params)
    expect(insertCall[1]).toEqual(expect.arrayContaining(['9', null, '7']));
  });

  test('rejects end_time before start_time (400)', async () => {
    const { start, end } = future();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: BIZ.id, owner_id: OWNER.id }] }); // canEditProfile
    const res = await request(buildBlockedTimesApp())
      .post('/api/businesses/7/services/9/blocked-times')
      .send({ start_time: end, end_time: start });
    expect(res.status).toBe(400);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO business_service_blocked_times/.test(sql))).toBe(false);
  });

  test('rejects overlapping blocks (409)', async () => {
    const { start, end } = future();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: BIZ.id, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [{ id: 9 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'existing' }] });
    const res = await request(buildBlockedTimesApp())
      .post('/api/businesses/7/services/9/blocked-times')
      .send({ start_time: start, end_time: end });
    expect(res.status).toBe(409);
  });

  test('404s when the service does not belong to the business', async () => {
    const { start, end } = future();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: BIZ.id, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(buildBlockedTimesApp())
      .post('/api/businesses/7/services/999/blocked-times')
      .send({ start_time: start, end_time: end });
    expect(res.status).toBe(404);
  });

  test('lists blocks for a service', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: BIZ.id, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [{ id: 9 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'b1' }, { id: 'b2' }] });
    const res = await request(buildBlockedTimesApp()).get('/api/businesses/7/services/9/blocked-times');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('deletes a block scoped to the business+service', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: BIZ.id, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(buildBlockedTimesApp()).delete('/api/businesses/7/services/9/blocked-times/b1');
    expect(res.status).toBe(200);
    const delCall = mockQuery.mock.calls.find(([sql]) => /DELETE FROM business_service_blocked_times/.test(sql));
    expect(delCall[1]).toEqual(['b1', '7', '9']);
  });

  test('delete 404s when the block is not found', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: BIZ.id, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(buildBlockedTimesApp()).delete('/api/businesses/7/services/9/blocked-times/nope');
    expect(res.status).toBe(404);
  });
});

// ── F02: manager invite no longer 404s; owner_id is the business owner ───────
describe('F02 manager invite', () => {
  test('a manager can invite (201) and the row is scoped to the business owner', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // no existing account
      .mockResolvedValueOnce({ rows: [{ id: 55, business_id: 7, owner_id: OWNER.id, status: 'pending' }] });
    const res = await request(buildInviteApp())
      .post('/api/businesses/7/members')
      .send({ email: 'newbie@example.com', role: 'representative' });
    expect(res.status).toBe(201);
    expect(res.body.user_found).toBe(false);
    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO business_members/.test(sql));
    expect(insertCall).toBeTruthy();
    // [business_id, owner_id=business owner (not the manager), member_id, role, email]
    expect(insertCall[1][0]).toBe(7);
    expect(insertCall[1][1]).toBe(OWNER.id);
    expect(insertCall[1][1]).not.toBe(MANAGER.id);
  });
});

// ── F11: invite email to non-account users ────────────────────────────────────
describe('F11 invite email', () => {
  test('emails the invitee when they have no account', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 56, business_id: 7, owner_id: OWNER.id, status: 'pending' }] });
    const res = await request(buildInviteApp())
      .post('/api/businesses/7/members')
      .send({ email: 'ghost@example.com', role: 'manager' });
    expect(res.status).toBe(201);
    expect(emailUtils.sendBusinessInviteEmail).toHaveBeenCalledTimes(1);
    expect(emailUtils.sendBusinessInviteEmail).toHaveBeenCalledWith(
      'ghost@example.com',
      expect.objectContaining({ businessName: 'Acme Services', role: 'manager', inviteId: 56 })
    );
  });

  test('does not email when the invitee already has an account', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'u9', first_name: 'Nia', email: 'nia@example.com' }] })
      .mockResolvedValueOnce({ rows: [{ id: 57, business_id: 7, owner_id: OWNER.id, status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [] }); // in-app notification insert
    const res = await request(buildInviteApp())
      .post('/api/businesses/7/members')
      .send({ email: 'nia@example.com', role: 'representative' });
    expect(res.status).toBe(201);
    expect(res.body.user_found).toBe(true);
    expect(emailUtils.sendBusinessInviteEmail).not.toHaveBeenCalled();
  });
});

// ── F01: remove ungated, approve/deny stay vortex-gated ───────────────────────
describe('F01 vortex gating on team routes', () => {
  const router = require('../routes/businessTeam');
  const stackNames = (path, method) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    expect(layer).toBeTruthy();
    return layer.route.stack.map((l) => l.handle.name || 'anonymous');
  };

  test('remove membership is NOT behind the vortex feature flag', () => {
    const names = stackNames('/:businessId/memberships/:membershipId/remove', 'post');
    expect(names).not.toContain('featureFlagMiddleware');
    expect(names).toContain('requirePermissionMw');
  });

  test('approve/deny membership stay vortex-gated (code flow)', () => {
    expect(stackNames('/:businessId/memberships/:membershipId/approve', 'post')).toContain('featureFlagMiddleware');
    expect(stackNames('/:businessId/memberships/:membershipId/deny', 'post')).toContain('featureFlagMiddleware');
  });
});

// ── F07: quoteOrder eligibility matches createOrder ───────────────────────────
describe('F07 quote/create eligibility parity', () => {
  test('quoteOrder uses the strict createOrder restaurant predicate', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = OWNER; next(); });
    app.post('/api/food/restaurants/:restaurantId/orders/quote', food.quoteOrder);
    app.use(errorHandler);

    // First query is the restaurant lookup; return no restaurant so the
    // controller 404s AFTER building the eligibility query.
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/food/restaurants/44/orders/quote')
      .send({ items: [{ menuItemId: 1, quantity: 1 }], orderSource: 'kiosk' });
    expect(res.status).toBe(404);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/fr\.status = 'active'/);
    expect(sql).not.toMatch(/IN \('active','paused'\)/);
    expect(sql).toMatch(/fr\.discovery_status = 'visible'/);
    expect(sql).toMatch(/b\.is_listed = TRUE/);
    expect(sql).not.toContain('$2');
    expect(params).toEqual([44]);
  });
});

// ── F08: customer slots subtract blocked times ────────────────────────────────
describe('F08 slot endpoint honors blocked times', () => {
  test('getBusinessAvailableSlots queries business_service_blocked_times', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = OWNER; next(); });
    app.get('/api/bookings/business/:businessId/available-slots', booking.getBusinessAvailableSlots);
    app.use(errorHandler);

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, is_active: true, is_listed: true, is_hidden_by_admin: false }] })
      .mockResolvedValueOnce({ rows: [{ schedule_configured: true }] })
      .mockResolvedValueOnce({ rows: [{ start_time: '09:00:00', end_time: '17:00:00' }] })
      .mockResolvedValueOnce({ rows: [{ duration_minutes: 60 }] })
      .mockResolvedValueOnce({ rows: [] }) // appointments
      .mockResolvedValueOnce({ rows: [{ start_time: '12:00:00', end_time: '13:00:00' }] }); // blocked
    const res = await request(app).get('/api/bookings/business/7/available-slots?date=2026-10-20&serviceId=9');
    expect(res.status).toBe(200);
    const blockedCall = mockQuery.mock.calls.find(([sql]) => /FROM business_service_blocked_times/.test(sql));
    expect(blockedCall).toBeTruthy();
    expect(blockedCall[0]).toMatch(/bt\.service_id = \$3 OR bt\.service_id IS NULL/);
    const slots = res.body.data.slots;
    const noonSlot = slots.find((s) => s.startTime === '12:00');
    expect(noonSlot).toBeTruthy();
    expect(noonSlot.available).toBe(false);
  });
});

// ── F09: payout notification i18n entries ─────────────────────────────────────
describe('F09 payout notification copy', () => {
  for (const type of ['payout_requested', 'payout_approved', 'payout_rejected']) {
    test(`${type} has title/body in all five languages`, () => {
      for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
        const { title, body } = tNotif(type, lang);
        expect(title).toBeTruthy();
        expect(body).toBeTruthy();
      }
    });
    test(`${type} has an email CTA`, () => {
      const { buttonText } = tNotifEmail(type, 'en');
      expect(buttonText).toBeTruthy();
    });
  }
});
