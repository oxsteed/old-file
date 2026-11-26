'use strict';

// Group 11 Slice 2e acceptance: Disputes + Maintain + Review
// (586, 587, 589, 590, 591, 594, 595, 597, 600).
// Runs against a dedicated fresh database (credit_statement_test_g11e) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 586: dedicated damage claim — amount + description + linked report,
//   visible to both parties, resolved by the other party, recorded only
//   (no platform money movement, D-257).
// 587: photo evidence on condition reports + timeline view (readBooking
//   carries evidence rows per report).
// 589: rental-specific escalation thread with status tracking + admin
//   replies in the same thread.
// 590: explicit acknowledgment of a resolution (damage claim, missing
//   accessory, deposit) — accept, or dispute and reopen.
// 591: maintenance calendar per tool; completion can create a repair
//   record (593).
// 594: safety document upload per listing, listed for renters and in the
//   admin moderation view.
// 595: return-to-availability checklist, server-enforced on the
//   is_available flip.
// 597: utilization report (booked vs available days over a period).
// 600: repeat renters (2+ completed bookings) + recorded follow-up.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP11_SLICE2E_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g11e') {
    throw new Error('Group 11 Slice 2e DB tests require the loopback credit_statement_test_g11e database');
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
      email: req.get('x-test-email') || `g11e-${id}@example.invalid`,
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
// Upload validation (malware scan + EXIF strip) is exercised in
// fileScanUpload.test.js; acceptance here uses the passthrough, the same
// pattern as group10SliceE. Multer's own file filter still applies.
jest.mock('../middleware/validateFileUpload', () => (req, res, next) => next());

const describeDb = dbUrl ? describe : describe.skip;

// Minimal 1x1 PNG (valid magic bytes for the upload validator).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF_MINIMAL = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8');

describeDb('Group 11 Slice 2e: Disputes + Maintain + Review (586, 587, 589, 590, 591, 594, 595, 597, 600)', () => {
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
      [id, `g11e-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer',
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
      accessories: JSON.stringify([{ name: 'Battery', quantity: 2 }]),
      condition_checklist: JSON.stringify(['Blade guard intact']),
      ...overrides,
    };
    const cols = ['user_id', 'name', 'category', 'description', 'daily_rate', 'hourly_rate',
      'deposit_amount', 'condition', 'brand', 'model', 'is_available', 'requires_deposit',
      'delivery_available', 'pickup_only', 'location_city', 'location_state',
      'image_gallery', 'moderation_hold', 'accessories', 'condition_checklist'];
    const vals = [ownerId, row.name, row.category, row.description, row.daily_rate,
      row.hourly_rate, row.deposit_amount, row.condition, row.brand, row.model,
      row.is_available, row.requires_deposit, row.delivery_available, row.pickup_only,
      row.location_city, row.location_state, row.image_gallery, row.moderation_hold,
      row.accessories, row.condition_checklist];
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(
      `INSERT INTO tool_rentals (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      vals,
    );
    return rows[0];
  }

  async function insertBooking(toolId, customerId, ownerId, startDate, endDate, status = 'payment_confirmed', extra = {}) {
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

  async function paidPair({ toolOverrides = {}, bookingExtra = {} } = {}) {
    const owner = await addUser();
    const renter = await addUser();
    await grantToolOwner(owner);
    const tool = await insertTool(owner, toolOverrides);
    const booking = await insertBooking(tool.id, renter, owner, '2026-12-10', '2026-12-12', 'payment_confirmed', bookingExtra);
    return { owner, renter, tool, booking };
  }

  // A return-phase condition report (counts match the pickup snapshot, so
  // no missing accessories are derived).
  async function fileReturnReport(userId, booking, counts = [2], checklist = [true]) {
    const res = await request(app)
      .post(`/api/tool-rentals/operations/bookings/${booking.id}/reports`)
      .set('x-test-user', userId)
      .send({ phase: 'return', counts, checklist, notes: 'Returned in good shape.', expectedVersion: 0 });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function filePickupReport(userId, booking, counts = [2], checklist = [true]) {
    const res = await request(app)
      .post(`/api/tool-rentals/operations/bookings/${booking.id}/reports`)
      .set('x-test-user', userId)
      .send({ phase: 'pickup', counts, checklist, notes: 'Picked up as described.', expectedVersion: 0 });
    expect(res.status).toBe(201);
    return res.body;
  }

  describe('586: damage claim', () => {
    test('owner files a claim with an amount; both parties see it; the renter resolves and the owner acknowledges', async () => {
      const { owner, renter, booking } = await paidPair();
      const filed = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims`)
        .set('x-test-user', owner)
        .send({ amount: 40, description: 'Chuck is cracked; replacement part needed.' })
        .expect(201);
      expect(filed.body.claim.status).toBe('open');
      expect(Number(filed.body.claim.amount)).toBe(40);
      expect(filed.body.claim.filed_by).toBe(owner);
      // Both parties see the same claim.
      const asRenter = await request(app)
        .get(`/api/tool-rentals/bookings/${booking.id}/damage-claims`)
        .set('x-test-user', renter)
        .expect(200);
      expect(asRenter.body.claims).toHaveLength(1);
      expect(asRenter.body.claims[0].id).toBe(filed.body.claim.id);
      // A stranger learns nothing.
      const stranger = await addUser();
      await request(app)
        .get(`/api/tool-rentals/bookings/${booking.id}/damage-claims`)
        .set('x-test-user', stranger)
        .expect(404);
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims`)
        .set('x-test-user', stranger)
        .send({ amount: 5, description: 'Nope.' })
        .expect(404);
      // The filer cannot resolve their own claim.
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims/${filed.body.claim.id}/resolve`)
        .set('x-test-user', owner)
        .send({ decision: 'agreed', agreed_amount: 25 })
        .expect(403);
      // The renter agrees a lower amount (recorded only; no money moves).
      const resolved = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims/${filed.body.claim.id}/resolve`)
        .set('x-test-user', renter)
        .send({ decision: 'agreed', agreed_amount: 25, reason: 'Agreed on the part cost.' })
        .expect(200);
      expect(resolved.body.claim.status).toBe('resolved');
      expect(Number(resolved.body.claim.agreed_amount)).toBe(25);
      expect(resolved.body.claim.ack_status).toBe('pending');
      // The filer acknowledges.
      const acked = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims/${filed.body.claim.id}/acknowledge`)
        .set('x-test-user', owner)
        .send({ decision: 'acknowledged' })
        .expect(200);
      expect(acked.body.claim.ack_status).toBe('acknowledged');
      expect(acked.body.claim.acknowledged_by).toBe(owner);
      // Acknowledging twice is refused.
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims/${filed.body.claim.id}/acknowledge`)
        .set('x-test-user', owner)
        .send({ decision: 'acknowledged' })
        .expect(409);
    });

    test('validation: no amount, an agreed amount over the claim, a decline without a reason, a second open claim', async () => {
      const { owner, renter, booking } = await paidPair();
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims`)
        .set('x-test-user', owner)
        .send({ amount: 0, description: 'Nothing.' })
        .expect(400);
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims`)
        .set('x-test-user', owner)
        .send({ amount: 40, description: '' })
        .expect(400);
      const filed = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims`)
        .set('x-test-user', owner)
        .send({ amount: 40, description: 'Scratched housing.' })
        .expect(201);
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims`)
        .set('x-test-user', renter)
        .send({ amount: 10, description: 'Second claim while one is open.' })
        .expect(409);
      const over = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims/${filed.body.claim.id}/resolve`)
        .set('x-test-user', renter)
        .send({ decision: 'agreed', agreed_amount: 41 });
      expect(over.status).toBe(400);
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims/${filed.body.claim.id}/resolve`)
        .set('x-test-user', renter)
        .send({ decision: 'declined' })
        .expect(400);
      // Decline with a reason, then the filer disputes: the claim reopens.
      const declined = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims/${filed.body.claim.id}/resolve`)
        .set('x-test-user', renter)
        .send({ decision: 'declined', reason: 'That scratch was already there at pickup.' })
        .expect(200);
      expect(declined.body.claim.status).toBe('declined');
      const disputed = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims/${filed.body.claim.id}/acknowledge`)
        .set('x-test-user', owner)
        .send({ decision: 'disputed' })
        .expect(200);
      expect(disputed.body.claim.status).toBe('open');
      expect(disputed.body.claim.ack_status).toBe('disputed');
    });

    test('a claim can link a condition report as evidence', async () => {
      const { owner, renter, booking } = await paidPair();
      const report = await fileReturnReport(owner, booking);
      const filed = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims`)
        .set('x-test-user', owner)
        .send({ amount: 15, description: 'See the return report.', evidence_report_id: report.id })
        .expect(201);
      expect(filed.body.claim.evidence_report_id).toBe(report.id);
      void renter;
    });

    test('claims only open once the rental is underway', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      const pending = await insertBooking(tool.id, renter, owner, '2026-12-10', '2026-12-12', 'pending');
      const res = await request(app)
        .post(`/api/tool-rentals/bookings/${pending.id}/damage-claims`)
        .set('x-test-user', owner)
        .send({ amount: 10, description: 'Too early.' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('state_conflict');
    });
  });

  describe('587: evidence timeline', () => {
    test('a party uploads a photo to a report; the timeline shows it with the report', async () => {
      const { owner, renter, booking } = await paidPair();
      const report = await fileReturnReport(owner, booking);
      const uploaded = await request(app)
        .post(`/api/tool-rentals/operations/bookings/${booking.id}/evidence`)
        .set('x-test-user', owner)
        .attach('image', PNG_1X1, 'damage.png')
        .field('report_id', report.id)
        .expect(201);
      expect(uploaded.body.image_url).toBeTruthy();
      expect(uploaded.body.report_id).toBe(report.id);
      // A stranger cannot attach evidence.
      const stranger = await addUser();
      await request(app)
        .post(`/api/tool-rentals/operations/bookings/${booking.id}/evidence`)
        .set('x-test-user', stranger)
        .attach('image', PNG_1X1, 'damage.png')
        .field('report_id', report.id)
        .expect(404);
      // The timeline (readBooking) carries the photo with its report.
      const timeline = await request(app)
        .get(`/api/tool-rentals/operations/bookings/${booking.id}`)
        .set('x-test-user', renter)
        .expect(200);
      expect(timeline.body.evidence).toHaveLength(1);
      expect(timeline.body.evidence[0].report_id).toBe(report.id);
      expect(timeline.body.evidence[0].image_url).toBe(uploaded.body.image_url);
      expect(timeline.body.reports.map((r) => r.id)).toContain(report.id);
    });

    test('evidence needs a real report on the booking and an image', async () => {
      const { owner, booking } = await paidPair();
      await request(app)
        .post(`/api/tool-rentals/operations/bookings/${booking.id}/evidence`)
        .set('x-test-user', owner)
        .attach('image', PNG_1X1, 'damage.png')
        .field('report_id', randomUUID())
        .expect(404);
      const report = await fileReturnReport(owner, booking);
      const pdf = await request(app)
        .post(`/api/tool-rentals/operations/bookings/${booking.id}/evidence`)
        .set('x-test-user', owner)
        .attach('image', PDF_MINIMAL, 'notes.pdf')
        .field('report_id', report.id);
      expect(pdf.status).toBe(400);
    });
  });

  describe('589: support escalation', () => {
    test('renter opens a thread, owner replies, admin replies and resolves; both parties track the status', async () => {
      const { owner, renter, booking } = await paidPair();
      const opened = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/escalations`)
        .set('x-test-user', renter)
        .send({ category: 'damage', message: 'The drill came back with a cracked chuck.' })
        .expect(201);
      expect(opened.body.escalation.status).toBe('open');
      expect(opened.body.escalation.messages).toHaveLength(1);
      expect(opened.body.escalation.messages[0].author_role).toBe('renter');
      const escalationId = opened.body.escalation.id;
      // The owner replies in the same thread.
      const ownerMsg = await request(app)
        .post(`/api/tool-rentals/escalations/${escalationId}/messages`)
        .set('x-test-user', owner)
        .send({ message: 'I have photos from pickup showing it was fine.' })
        .expect(201);
      expect(ownerMsg.body.message.author_role).toBe('owner');
      // A stranger sees nothing.
      const stranger = await addUser();
      await request(app)
        .post(`/api/tool-rentals/escalations/${escalationId}/messages`)
        .set('x-test-user', stranger)
        .send({ message: 'Hello?' })
        .expect(404);
      // The owner sees the thread with both messages.
      const asOwner = await request(app)
        .get(`/api/tool-rentals/bookings/${booking.id}/escalations`)
        .set('x-test-user', owner)
        .expect(200);
      expect(asOwner.body.escalations[0].messages).toHaveLength(2);
      // Admin: list, reply, move to in_review, then resolve.
      const admin = await addUser('super_admin');
      const listed = await request(app)
        .get('/api/tool-rentals/admin/escalations')
        .set('x-test-user', admin)
        .expect(200);
      expect(listed.body.escalations.map((e) => e.id)).toContain(escalationId);
      await request(app)
        .post(`/api/tool-rentals/admin/escalations/${escalationId}/messages`)
        .set('x-test-user', admin)
        .send({ message: 'We are reviewing the pickup and return reports.' })
        .expect(201);
      const reviewing = await request(app)
        .post(`/api/tool-rentals/admin/escalations/${escalationId}/status`)
        .set('x-test-user', admin)
        .send({ status: 'in_review' })
        .expect(200);
      expect(reviewing.body.escalation.status).toBe('in_review');
      const resolved = await request(app)
        .post(`/api/tool-rentals/admin/escalations/${escalationId}/status`)
        .set('x-test-user', admin)
        .send({ status: 'resolved' })
        .expect(200);
      expect(resolved.body.escalation.status).toBe('resolved');
      expect(resolved.body.escalation.resolved_at).toBeTruthy();
      // A resolved thread takes no more messages.
      await request(app)
        .post(`/api/tool-rentals/escalations/${escalationId}/messages`)
        .set('x-test-user', renter)
        .send({ message: 'One more thing.' })
        .expect(409);
      // Both parties see the resolved status.
      const asRenter = await request(app)
        .get(`/api/tool-rentals/bookings/${booking.id}/escalations`)
        .set('x-test-user', renter)
        .expect(200);
      expect(asRenter.body.escalations[0].status).toBe('resolved');
      expect(asRenter.body.escalations[0].messages).toHaveLength(3);
      expect(asRenter.body.escalations[0].messages[2].author_role).toBe('admin');
    });

    test('bad category or empty message is refused; a non-admin cannot use the admin routes', async () => {
      const { owner, renter, booking } = await paidPair();
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/escalations`)
        .set('x-test-user', renter)
        .send({ category: 'billing', message: 'Wrong category.' })
        .expect(400);
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/escalations`)
        .set('x-test-user', renter)
        .send({ category: 'other', message: '   ' })
        .expect(400);
      await request(app)
        .get('/api/tool-rentals/admin/escalations')
        .set('x-test-user', owner)
        .expect(403);
      void owner;
    });

    // Wave 3 (589, D-572/D-569): opening notifies the counterparty and
    // the moderation admins, and both types are cataloged and templated
    // (the catalog-sync test pins literal sendNotification types).
    test('opening an escalation notifies the counterparty and the moderation admins', async () => {
      const { owner, renter, booking } = await paidPair();
      const admin = await addUser('super_admin');
      const { sendNotification } = require('../services/notificationService');
      jest.clearAllMocks();
      const opened = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/escalations`)
        .set('x-test-user', renter)
        .send({ category: 'deposit', message: 'The deposit was never returned.' })
        .expect(201);
      const escalationId = opened.body.escalation.id;
      expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
        type: 'tool_rental_escalation_opened',
        userId: owner,
      }));
      expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
        type: 'tool_rental_escalation_opened',
        userId: admin,
      }));
      // The opener is never notified about their own escalation.
      expect(sendNotification).not.toHaveBeenCalledWith(expect.objectContaining({
        type: 'tool_rental_escalation_opened',
        userId: renter,
      }));
      // Both types resolve to a real template in every locale the panel
      // and the email path can send (en + ar spot-checked).
      const { tNotif } = require('../utils/i18n');
      for (const type of ['tool_rental_escalation_opened', 'tool_rental_escalation_resolved']) {
        expect(tNotif(type, 'en').title).toBeTruthy();
        expect(tNotif(type, 'ar').title).toBeTruthy();
      }
      void escalationId;
    });

    // Wave 3 (589, D-569): a fresh admin resolution arms the
    // acknowledgment and notifies both parties; a party can accept, and
    // a dispute reopens the thread so an admin can look again.
    test('admin resolve arms acknowledgment and notifies both parties; accept settles it, a dispute reopens', async () => {
      const { owner, renter, booking } = await paidPair();
      const admin = await addUser('super_admin');
      const { sendNotification } = require('../services/notificationService');
      const opened = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/escalations`)
        .set('x-test-user', renter)
        .send({ category: 'condition', message: 'The tool came back damaged.' })
        .expect(201);
      const escalationId = opened.body.escalation.id;
      jest.clearAllMocks();
      const resolved = await request(app)
        .post(`/api/tool-rentals/admin/escalations/${escalationId}/status`)
        .set('x-test-user', admin)
        .send({ status: 'resolved' })
        .expect(200);
      expect(resolved.body.escalation.ack_status).toBe('pending');
      expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
        type: 'tool_rental_escalation_resolved',
        userId: owner,
      }));
      expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
        type: 'tool_rental_escalation_resolved',
        userId: renter,
      }));
      // The renter accepts; a second accept is refused.
      const accepted = await request(app)
        .post(`/api/tool-rentals/escalations/${escalationId}/acknowledge`)
        .set('x-test-user', renter)
        .send({ decision: 'acknowledged' })
        .expect(200);
      expect(accepted.body.escalation.ack_status).toBe('acknowledged');
      expect(accepted.body.escalation.acknowledged_by).toBe(renter);
      await request(app)
        .post(`/api/tool-rentals/escalations/${escalationId}/acknowledge`)
        .set('x-test-user', owner)
        .send({ decision: 'acknowledged' })
        .expect(409);
      // A second escalation: the owner disputes, the thread reopens, and
      // a fresh admin resolution arms the acknowledgment again.
      const second = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/escalations`)
        .set('x-test-user', owner)
        .send({ category: 'other', message: 'The renter left the site a mess.' })
        .expect(201);
      const secondId = second.body.escalation.id;
      await request(app)
        .post(`/api/tool-rentals/admin/escalations/${secondId}/status`)
        .set('x-test-user', admin)
        .send({ status: 'resolved' })
        .expect(200);
      const disputed = await request(app)
        .post(`/api/tool-rentals/escalations/${secondId}/acknowledge`)
        .set('x-test-user', renter)
        .send({ decision: 'disputed' })
        .expect(200);
      expect(disputed.body.escalation.status).toBe('open');
      expect(disputed.body.escalation.ack_status).toBe('disputed');
      expect(disputed.body.escalation.resolved_at).toBeNull();
      const reResolved = await request(app)
        .post(`/api/tool-rentals/admin/escalations/${secondId}/status`)
        .set('x-test-user', admin)
        .send({ status: 'resolved' })
        .expect(200);
      expect(reResolved.body.escalation.ack_status).toBe('pending');
      expect(reResolved.body.escalation.acknowledged_by).toBeNull();
    });

    test('acknowledge guards: open thread, bad decision, stranger', async () => {
      const { owner, renter, booking } = await paidPair();
      const admin = await addUser('super_admin');
      const opened = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/escalations`)
        .set('x-test-user', renter)
        .send({ category: 'other', message: 'Need help.' })
        .expect(201);
      const escalationId = opened.body.escalation.id;
      // An open thread cannot be acknowledged.
      await request(app)
        .post(`/api/tool-rentals/escalations/${escalationId}/acknowledge`)
        .set('x-test-user', renter)
        .send({ decision: 'acknowledged' })
        .expect(409);
      await request(app)
        .post(`/api/tool-rentals/admin/escalations/${escalationId}/status`)
        .set('x-test-user', admin)
        .send({ status: 'resolved' })
        .expect(200);
      // A bad decision is refused.
      await request(app)
        .post(`/api/tool-rentals/escalations/${escalationId}/acknowledge`)
        .set('x-test-user', owner)
        .send({ decision: 'maybe' })
        .expect(400);
      // A stranger sees nothing.
      const stranger = await addUser();
      await request(app)
        .post(`/api/tool-rentals/escalations/${escalationId}/acknowledge`)
        .set('x-test-user', stranger)
        .send({ decision: 'acknowledged' })
        .expect(404);
    });

    // Wave 3 (589, G11-B9): the server never gated opening an escalation
    // by booking status; a pending booking with no history can open one.
    test('a pending booking can open an escalation', async () => {
      const { owner, renter, tool } = await paidPair();
      const pending = await insertBooking(tool.id, renter, owner, '2026-12-20', '2026-12-22', 'pending');
      const opened = await request(app)
        .post(`/api/tool-rentals/bookings/${pending.id}/escalations`)
        .set('x-test-user', renter)
        .send({ category: 'other', message: 'The owner has not replied since booking.' })
        .expect(201);
      expect(opened.body.escalation.status).toBe('open');
    });
  });

  describe('590: resolution acknowledgment', () => {
    test('renter acknowledges the owner missing-accessory resolution; a dispute clears it for a fresh resolve', async () => {
      const { owner, renter, booking } = await paidPair();
      await filePickupReport(owner, booking);
      // Return one battery short: a missing-accessory record is derived.
      const returned = await fileReturnReport(renter, booking, [1], [true]);
      const resolved = await request(app)
        .post(`/api/tool-rentals/operations/bookings/${booking.id}/missing/${returned.id}`)
        .set('x-test-user', owner)
        .send({ notes: 'Renter will drop the battery off tomorrow.', expectedVersion: 1 })
        .expect(200);
      expect(resolved.body.resolution).toBe('Renter will drop the battery off tomorrow.');
      // The owner cannot acknowledge their own resolution.
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/missing/${returned.id}/acknowledge`)
        .set('x-test-user', owner)
        .send({ decision: 'acknowledged' })
        .expect(403);
      // The renter disputes: the resolution is cleared, the owner can
      // resolve again with the bumped version.
      const disputed = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/missing/${returned.id}/acknowledge`)
        .set('x-test-user', renter)
        .send({ decision: 'disputed' })
        .expect(200);
      expect(disputed.body.missing.ack_status).toBe('disputed');
      expect(disputed.body.missing.resolved_at).toBeNull();
      const reResolved = await request(app)
        .post(`/api/tool-rentals/operations/bookings/${booking.id}/missing/${returned.id}`)
        .set('x-test-user', owner)
        .send({ notes: 'Battery received; case closed.', expectedVersion: 3 })
        .expect(200);
      expect(reResolved.body.resolved_at).toBeTruthy();
      // Now the renter acknowledges.
      const acked = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/missing/${returned.id}/acknowledge`)
        .set('x-test-user', renter)
        .send({ decision: 'acknowledged' })
        .expect(200);
      expect(acked.body.missing.ack_status).toBe('acknowledged');
      expect(acked.body.missing.acknowledged_by).toBe(renter);
    });

    test('renter acknowledges the deposit resolution; the owner cannot', async () => {
      const { owner, renter, booking } = await paidPair({
        bookingExtra: { deposit_status: 'held', deposit_amount: 40 },
      });
      const resolved = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/deposit/resolve`)
        .set('x-test-user', owner)
        .send({ action: 'return' })
        .expect(200);
      expect(resolved.body.deposit_status).toBe('returned');
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/deposit/acknowledge`)
        .set('x-test-user', owner)
        .send({ decision: 'acknowledged' })
        .expect(403);
      const acked = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/deposit/acknowledge`)
        .set('x-test-user', renter)
        .send({ decision: 'acknowledged' })
        .expect(200);
      expect(acked.body.deposit.deposit_ack_status).toBe('acknowledged');
      // Acknowledging twice is refused.
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/deposit/acknowledge`)
        .set('x-test-user', renter)
        .send({ decision: 'acknowledged' })
        .expect(409);
    });

    test('no deposit resolution yet means nothing to acknowledge', async () => {
      const { renter, booking } = await paidPair({
        bookingExtra: { deposit_status: 'held', deposit_amount: 40 },
      });
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/deposit/acknowledge`)
        .set('x-test-user', renter)
        .send({ decision: 'acknowledged' })
        .expect(409);
    });
  });

  describe('591: maintenance calendar', () => {
    test('owner schedules, completes with a repair record, and cancels events; strangers get 404', async () => {
      const { owner, tool } = await paidPair();
      const created = await request(app)
        .post(`/api/tool-rentals/${tool.id}/maintenance`)
        .set('x-test-user', owner)
        .send({ title: 'Replace the chuck', scheduled_date: '2026-12-20', notes: 'Wobble reported by the last renter.' })
        .expect(201);
      expect(created.body.event.status).toBe('scheduled');
      const second = await request(app)
        .post(`/api/tool-rentals/${tool.id}/maintenance`)
        .set('x-test-user', owner)
        .send({ title: 'Oil the gearbox', scheduled_date: '2026-12-22' })
        .expect(201);
      const listed = await request(app)
        .get(`/api/tool-rentals/${tool.id}/maintenance`)
        .set('x-test-user', owner)
        .expect(200);
      expect(listed.body.events.map((e) => e.title)).toEqual(['Replace the chuck', 'Oil the gearbox']);
      // Complete with a repair record: the record appears in the tool's
      // repair history (593).
      const completed = await request(app)
        .post(`/api/tool-rentals/${tool.id}/maintenance/${created.body.event.id}/complete`)
        .set('x-test-user', owner)
        .send({ create_repair_record: true, notes: 'Chuck replaced.' })
        .expect(200);
      expect(completed.body.event.status).toBe('completed');
      expect(completed.body.event.repair_record_id).toBeTruthy();
      const ops = await request(app)
        .get(`/api/tool-rentals/operations/tools/${tool.id}`)
        .set('x-test-user', owner)
        .expect(200);
      expect(ops.body.repairs.map((r) => r.id)).toContain(completed.body.event.repair_record_id);
      // Completing again is refused; cancelling the other works.
      await request(app)
        .post(`/api/tool-rentals/${tool.id}/maintenance/${created.body.event.id}/complete`)
        .set('x-test-user', owner)
        .send({})
        .expect(409);
      const cancelled = await request(app)
        .post(`/api/tool-rentals/${tool.id}/maintenance/${second.body.event.id}/cancel`)
        .set('x-test-user', owner)
        .send({})
        .expect(200);
      expect(cancelled.body.event.status).toBe('cancelled');
      // A stranger cannot read or create maintenance for the tool.
      const stranger = await addUser();
      await request(app).get(`/api/tool-rentals/${tool.id}/maintenance`).set('x-test-user', stranger).expect(404);
      await request(app)
        .post(`/api/tool-rentals/${tool.id}/maintenance`)
        .set('x-test-user', stranger)
        .send({ title: 'Nope', scheduled_date: '2026-12-20' })
        .expect(404);
    });

    test('a repair record needs notes; a bad date is refused', async () => {
      const { owner, tool } = await paidPair();
      await request(app)
        .post(`/api/tool-rentals/${tool.id}/maintenance`)
        .set('x-test-user', owner)
        .send({ title: 'Check', scheduled_date: '2026-02-30' })
        .expect(400);
      const created = await request(app)
        .post(`/api/tool-rentals/${tool.id}/maintenance`)
        .set('x-test-user', owner)
        .send({ title: 'Check', scheduled_date: '2026-12-20' })
        .expect(201);
      await request(app)
        .post(`/api/tool-rentals/${tool.id}/maintenance/${created.body.event.id}/complete`)
        .set('x-test-user', owner)
        .send({ create_repair_record: true })
        .expect(400);
      // Completing without a repair record is fine.
      const done = await request(app)
        .post(`/api/tool-rentals/${tool.id}/maintenance/${created.body.event.id}/complete`)
        .set('x-test-user', owner)
        .send({})
        .expect(200);
      expect(done.body.event.repair_record_id).toBeNull();
    });
  });

  describe('594: safety documentation', () => {
    test('owner uploads a PDF manual; renters see it on the public listing; admin sees it in moderation; owner deletes it', async () => {
      const { owner, tool } = await paidPair();
      const uploaded = await request(app)
        .post(`/api/tool-rentals/${tool.id}/safety-documents`)
        .set('x-test-user', owner)
        .attach('document', PDF_MINIMAL, 'manual.pdf')
        .field('title', 'Manufacturer safety manual')
        .expect(201);
      expect(uploaded.body.document.title).toBe('Manufacturer safety manual');
      expect(uploaded.body.document.mime_type).toBe('application/pdf');
      const asOwner = await request(app)
        .get(`/api/tool-rentals/${tool.id}/safety-documents`)
        .set('x-test-user', owner)
        .expect(200);
      expect(asOwner.body.documents).toHaveLength(1);
      // Public listing carries the document for renters.
      const pub = await request(app).get(`/api/tool-rentals/public/${tool.id}`).expect(200);
      expect(pub.body.tool.safety_documents.map((d) => d.title)).toContain('Manufacturer safety manual');
      // Admin moderation view.
      const admin = await addUser('super_admin');
      const moderated = await request(app)
        .get(`/api/tool-rentals/admin/tool-rentals/${tool.id}/safety-documents`)
        .set('x-test-user', admin)
        .expect(200);
      expect(moderated.body.documents).toHaveLength(1);
      expect(moderated.body.documents[0].tool_name).toBe(tool.name);
      // A stranger cannot upload or list the owner's documents.
      const stranger = await addUser();
      await request(app)
        .post(`/api/tool-rentals/${tool.id}/safety-documents`)
        .set('x-test-user', stranger)
        .attach('document', PDF_MINIMAL, 'manual.pdf')
        .field('title', 'Nope')
        .expect(404);
      await request(app)
        .get(`/api/tool-rentals/${tool.id}/safety-documents`)
        .set('x-test-user', stranger)
        .expect(404);
      // Delete removes it from the public listing too.
      await request(app)
        .delete(`/api/tool-rentals/${tool.id}/safety-documents/${uploaded.body.document.id}`)
        .set('x-test-user', owner)
        .expect(200);
      const pubAfter = await request(app).get(`/api/tool-rentals/public/${tool.id}`).expect(200);
      expect(pubAfter.body.tool.safety_documents).toHaveLength(0);
    });

    test('a non-PDF/image file is refused', async () => {
      const { owner, tool } = await paidPair();
      const res = await request(app)
        .post(`/api/tool-rentals/${tool.id}/safety-documents`)
        .set('x-test-user', owner)
        .attach('document', Buffer.from('MZ fake exe', 'utf8'), 'manual.exe')
        .field('title', 'Not a manual');
      expect([400]).toContain(res.status);
    });
  });

  describe('595: return-to-availability checklist', () => {
    test('the flip is blocked until the checklist is complete, then allowed', async () => {
      const { owner, renter, tool, booking } = await paidPair({
        toolOverrides: { is_available: false },
      });
      // No return report yet: the flip is refused with the failing checks.
      const blocked = await request(app)
        .put(`/api/tool-rentals/${tool.id}`)
        .set('x-test-user', owner)
        .send({ is_available: true });
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('availability_checklist_incomplete');
      expect(blocked.body.checks.condition_report_filed).toBe(false);
      expect(blocked.body.checks.cleaning_confirmed).toBe(false);
      // The checklist read shows the same state.
      const read = await request(app)
        .get(`/api/tool-rentals/${tool.id}/availability-checklist`)
        .set('x-test-user', owner)
        .expect(200);
      expect(read.body.complete).toBe(false);
      expect(read.body.last_booking_id).toBe(booking.id);
      // File the return report, then confirm cleaning: the flip works.
      await fileReturnReport(renter, booking);
      const stillBlocked = await request(app)
        .put(`/api/tool-rentals/${tool.id}`)
        .set('x-test-user', owner)
        .send({ is_available: true });
      expect(stillBlocked.status).toBe(409);
      expect(stillBlocked.body.checks.cleaning_confirmed).toBe(false);
      const flipped = await request(app)
        .put(`/api/tool-rentals/${tool.id}`)
        .set('x-test-user', owner)
        .send({ is_available: true, cleaning_confirmed: true });
      expect(flipped.status).toBe(200);
      expect(flipped.body.tool.is_available).toBe(true);
    });

    test('an unresolved missing accessory and an open damage claim both block the flip', async () => {
      const { owner, renter, tool, booking } = await paidPair({
        toolOverrides: { is_available: false },
      });
      await filePickupReport(owner, booking);
      await fileReturnReport(renter, booking, [1], [true]);
      // Missing accessory unresolved + open damage claim.
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims`)
        .set('x-test-user', owner)
        .send({ amount: 20, description: 'Battery is missing.' })
        .expect(201);
      const blocked = await request(app)
        .put(`/api/tool-rentals/${tool.id}`)
        .set('x-test-user', owner)
        .send({ is_available: true, cleaning_confirmed: true });
      expect(blocked.status).toBe(409);
      expect(blocked.body.checks.no_unresolved_missing_accessories).toBe(false);
      expect(blocked.body.checks.no_open_damage_claim).toBe(false);
      expect(blocked.body.checks.condition_report_filed).toBe(true);
    });

    test('a tool with no prior rental only needs cleaning confirmed', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, { is_available: false });
      const blocked = await request(app)
        .put(`/api/tool-rentals/${tool.id}`)
        .set('x-test-user', owner)
        .send({ is_available: true });
      expect(blocked.status).toBe(409);
      expect(blocked.body.checks.condition_report_filed).toBe(true);
      const flipped = await request(app)
        .put(`/api/tool-rentals/${tool.id}`)
        .set('x-test-user', owner)
        .send({ is_available: true, cleaning_confirmed: true });
      expect(flipped.status).toBe(200);
      expect(flipped.body.tool.is_available).toBe(true);
    });
  });

  describe('597: utilization report', () => {
    test('booked days vs available days over a period, per tool and overall', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const busy = await insertTool(owner, { name: 'Busy drill' });
      const idle = await insertTool(owner, { name: 'Idle drill' });
      await insertBooking(busy.id, renter, owner, '2026-12-10', '2026-12-12', 'payment_confirmed');
      await insertBooking(busy.id, renter, owner, '2026-12-20', '2026-12-21', 'completed');
      // A cancelled booking occupies no days.
      await insertBooking(busy.id, renter, owner, '2026-12-25', '2026-12-27', 'cancelled');
      const res = await request(app)
        .get('/api/tool-rentals/analytics/utilization')
        .set('x-test-user', owner)
        .query({ startDate: '2026-12-01', endDate: '2026-12-31' })
        .expect(200);
      expect(res.body.available_days).toBe(31);
      const busyRow = res.body.tools.find((t) => t.tool_id === busy.id);
      expect(busyRow.booked_days).toBe(5);
      expect(busyRow.utilization).toBeCloseTo(5 / 31, 3);
      const idleRow = res.body.tools.find((t) => t.tool_id === idle.id);
      expect(idleRow.booked_days).toBe(0);
      expect(idleRow.utilization).toBe(0);
      expect(res.body.total_booked_days).toBe(5);
      expect(res.body.overall_utilization).toBeCloseTo(5 / 62, 3);
      // Defaults to the last 30 days when no period is given.
      const def = await request(app)
        .get('/api/tool-rentals/analytics/utilization')
        .set('x-test-user', owner)
        .expect(200);
      expect(def.body.available_days).toBe(30);
      // A stranger's utilization is their own (empty), not the owner's.
      const stranger = await addUser();
      const theirs = await request(app)
        .get('/api/tool-rentals/analytics/utilization')
        .set('x-test-user', stranger)
        .expect(200);
      expect(theirs.body.tools).toHaveLength(0);
      // An over-long period is refused.
      await request(app)
        .get('/api/tool-rentals/analytics/utilization')
        .set('x-test-user', owner)
        .query({ startDate: '2025-01-01', endDate: '2026-12-31' })
        .expect(400);
    });
  });

  describe('600: repeat renter follow-up', () => {
    test('renters with 2+ completed bookings are listed; a follow-up note is recorded', async () => {
      const owner = await addUser();
      const repeat = await addUser();
      const once = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, { name: 'Repeat drill' });
      await insertBooking(tool.id, repeat, owner, '2026-11-01', '2026-11-03', 'completed');
      await insertBooking(tool.id, repeat, owner, '2026-11-10', '2026-11-12', 'completed');
      await insertBooking(tool.id, once, owner, '2026-11-15', '2026-11-16', 'completed');
      // A pending booking does not count toward repeat status.
      await insertBooking(tool.id, once, owner, '2026-12-10', '2026-12-12', 'pending');
      const listed = await request(app)
        .get('/api/tool-rentals/renters/repeat')
        .set('x-test-user', owner)
        .expect(200);
      expect(listed.body.renters.map((r) => r.renter_id)).toEqual([repeat]);
      expect(listed.body.renters[0].completed_bookings).toBe(2);
      // Record a follow-up note.
      const noted = await request(app)
        .post('/api/tool-rentals/renters/followups')
        .set('x-test-user', owner)
        .send({ renter_id: repeat, tool_id: tool.id, note: 'Thanks for renting twice — the new sander is available next week.' })
        .expect(201);
      expect(noted.body.followup.note).toContain('Thanks for renting twice');
      // The note shows on the repeat list.
      const again = await request(app)
        .get('/api/tool-rentals/renters/repeat')
        .set('x-test-user', owner)
        .expect(200);
      expect(again.body.renters[0].followups).toHaveLength(1);
      // A one-time renter cannot get a follow-up.
      await request(app)
        .post('/api/tool-rentals/renters/followups')
        .set('x-test-user', owner)
        .send({ renter_id: once, note: 'Not a repeat renter yet.' })
        .expect(404);
      // Another owner sees none of these renters.
      const otherOwner = await addUser();
      const theirs = await request(app)
        .get('/api/tool-rentals/renters/repeat')
        .set('x-test-user', otherOwner)
        .expect(200);
      expect(theirs.body.renters).toHaveLength(0);
    });
  });
});
