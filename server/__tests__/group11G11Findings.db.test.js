'use strict';

// G11 findings batch acceptance: A1/A3 payment proof + owner
// counter-signature, A2 listing-delete guard, A4 identity TTL, A6 grant
// revocation unpublish, B3/B6/B7 deposit + refund + reschedule guards,
// B2/A5 rental notifications, B4 overdue block, LOW batch, S-F1/S-F2.
// Runs against a dedicated fresh database (credit_statement_test_g11g)
// so batch fixtures never pollute the shared credit_statement_test DB.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP11_G11FINDINGS_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g11g') {
    throw new Error('G11 findings DB tests require the loopback credit_statement_test_g11g database');
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
      email: req.get('x-test-email') || `g11g-${id}@example.invalid`,
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
const mockSendNotification = jest.fn().mockResolvedValue({ success: true });
jest.mock('../services/notificationService', () => ({
  sendNotification: (...args) => mockSendNotification(...args),
}));
const mockSendPaymentProofReceived = jest.fn();
const mockSendPaymentConfirmed = jest.fn();
const mockSendBookingCancelledToOwner = jest.fn();
const mockSendPaymentConfirmedToOwner = jest.fn();
jest.mock('../services/bookingEmailService', () => ({
  sendBookingConfirmation: jest.fn(),
  sendBookingApproved: jest.fn(),
  sendBookingDeclined: jest.fn(),
  sendPaymentProofReceived: (...args) => mockSendPaymentProofReceived(...args),
  sendPaymentConfirmed: (...args) => mockSendPaymentConfirmed(...args),
  sendBookingCancelledToOwner: (...args) => mockSendBookingCancelledToOwner(...args),
  sendPaymentConfirmedToOwner: (...args) => mockSendPaymentConfirmedToOwner(...args),
}));
jest.mock('../growth/emit', () => ({
  emitDomainEvent: jest.fn().mockResolvedValue(undefined),
  commerceEventProps: (value) => value,
}));
jest.mock('../utils/invoiceEmail', () => ({
  sendInvoiceEmail: jest.fn().mockResolvedValue({ success: true }),
}));

// G11-A6 (D-610): the revoke-flip tests call the review service directly;
// it reads DATABASE_URL at require time, which the block above already
// pointed at the g11g database.
const reviewService = require('../services/access/reviewService');

const describeDb = dbUrl ? describe : describe.skip;

describeDb('G11 findings batch: payment, delete guard, identity, notifications', () => {
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
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed, didit_status, didit_verified_at, identity_verified, id_verified, identity_verified_at)
       VALUES ($1, $2, 'x', 'Equipment', 'Fixture', $3, $4, TRUE, TRUE, TRUE, $5, $6, $7, $8, $9)`,
      [id, `g11g-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer',
        identity.diditStatus || 'pending', identity.diditVerifiedAt || null,
        identity.identityVerified || false, identity.idVerified || false, identity.identityVerifiedAt || null],
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

  async function revokeToolOwner(userId) {
    await db.query(
      `UPDATE access_grants SET status = 'revoked' WHERE user_id = $1 AND capability = 'tool_owner.list_equipment'`,
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

  async function insertPaymentMethod(ownerId) {
    await db.query(
      `INSERT INTO owner_payment_methods (owner_id, payment_type, payment_identifier)
       VALUES ($1, 'venmo', '@owner') ON CONFLICT (owner_id) DO NOTHING`,
      [ownerId],
    );
  }

  async function insertTermsAcceptance(bookingId, userId, role = 'owner') {
    await db.query(
      `INSERT INTO tool_rental_terms_acceptance (booking_id, user_id, user_role, terms_version, ip_address, user_agent)
       VALUES ($1, $2, $3, '1.1', '127.0.0.1', 'test')`,
      [bookingId, userId, role],
    );
  }

  const attemptInvoice = (ownerId, bookingId) => request(app)
    .post('/api/tool-rentals/invoices')
    .set('x-test-user', ownerId)
    .set('Idempotency-Key', randomUUID())
    .send({ bookingId, deliveryMethod: 'in_platform' });

  // A booking at invoice_sent with a deposit due: rental 54 (3 days) + deposit 40
  // = invoice total 94. The booking goes through the API so the
  // agreement snapshot (which the deposit amount is read from) is real.
  // Returns { owner, renter, tool, booking, invoice }.
  async function invoiceSentBooking() {
    const owner = await addUser();
    const renter = await addUser();
    await grantToolOwner(owner);
    const tool = await insertTool(owner, { name: 'Invoice drill', requires_deposit: true, deposit_amount: 40 });
    const created = await request(app)
      .post('/api/tool-rentals/bookings')
      .set('x-test-user', renter)
      .send({ toolId: tool.id, startDate: '2026-12-10', endDate: '2026-12-12', renterAgreementAccepted: true });
    expect(created.status).toBe(201);
    const booking = created.body;
    await insertPaymentMethod(owner);
    await request(app).post(`/api/tool-rentals/bookings/${booking.id}/approve`).set('x-test-user', owner).expect(200);
    await insertTermsAcceptance(booking.id, owner, 'owner');
    const invoiceRes = await attemptInvoice(owner, booking.id);
    expect(invoiceRes.status).toBe(200);
    const { rows } = await db.query('SELECT * FROM tool_rental_invoices WHERE booking_id = $1', [booking.id]);
    expect(rows[0]).toBeTruthy();
    return { owner, renter, tool, booking, invoice: rows[0] };
  }

  describe('G11-A1/A3: two-step payment confirmation (D-603)', () => {
    test('owner cannot confirm receipt before the renter records proof', async () => {
      const { owner, invoice } = await invoiceSentBooking();
      const res = await request(app)
        .post(`/api/tool-rentals/invoices/${invoice.id}/confirm-payment`)
        .set('x-test-user', owner)
        .send({});
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('payment_proof_required');
    });

    test('renter cannot confirm payment (owner-only endpoint)', async () => {
      const { renter, invoice } = await invoiceSentBooking();
      const res = await request(app)
        .post(`/api/tool-rentals/invoices/${invoice.id}/confirm-payment`)
        .set('x-test-user', renter)
        .send({});
      expect(res.status).toBe(404);
    });

    test('recording proof needs a reference and the exact invoice total', async () => {
      const { renter, invoice } = await invoiceSentBooking();
      const noRef = await request(app)
        .post(`/api/tool-rentals/invoices/${invoice.id}/record-payment`)
        .set('x-test-user', renter)
        .send({ reference: '  ', amount: 94 });
      expect(noRef.status).toBe(400);
      expect(noRef.body.code).toBe('reference_required');
      const wrongAmount = await request(app)
        .post(`/api/tool-rentals/invoices/${invoice.id}/record-payment`)
        .set('x-test-user', renter)
        .send({ reference: 'VENMO-123', amount: 75 });
      expect(wrongAmount.status).toBe(400);
      expect(wrongAmount.body.code).toBe('amount_mismatch');
      expect(wrongAmount.body.expected_amount).toBe(94);
    });

    test('strangers cannot record proof on an invoice', async () => {
      const { invoice } = await invoiceSentBooking();
      const stranger = await addUser();
      const res = await request(app)
        .post(`/api/tool-rentals/invoices/${invoice.id}/record-payment`)
        .set('x-test-user', stranger)
        .send({ reference: 'VENMO-123', amount: 94 });
      expect(res.status).toBe(404);
    });

    test('proof then owner confirmation flips the booking and holds the deposit', async () => {
      mockSendNotification.mockClear();
      mockSendPaymentProofReceived.mockClear();
      mockSendPaymentConfirmed.mockClear();
      const { owner, renter, booking, invoice } = await invoiceSentBooking();

      const record = await request(app)
        .post(`/api/tool-rentals/invoices/${invoice.id}/record-payment`)
        .set('x-test-user', renter)
        .send({ reference: 'VENMO-ABC-123', amount: 94 });
      expect(record.status).toBe(200);
      expect(record.body.payment_proof_reference).toBe('VENMO-ABC-123');
      expect(record.body.payment_proof_amount).toBe(94);

      // Recording proof alone never flips the booking.
      const { rows: stillSent } = await db.query(
        'SELECT status, deposit_status FROM tool_rentals_bookings WHERE id = $1', [booking.id],
      );
      expect(stillSent[0].status).toBe('invoice_sent');
      expect(stillSent[0].deposit_status).toBe('due');
      expect(mockSendPaymentProofReceived).toHaveBeenCalled();
      expect(mockSendNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: String(owner), type: 'tool_rental_payment_proof_submitted',
      }));

      const confirm = await request(app)
        .post(`/api/tool-rentals/invoices/${invoice.id}/confirm-payment`)
        .set('x-test-user', owner)
        .send({});
      expect(confirm.status).toBe(200);
      expect(confirm.body.status).toBe('payment_confirmed');

      const { rows: confirmed } = await db.query(
        'SELECT status, deposit_status FROM tool_rentals_bookings WHERE id = $1', [booking.id],
      );
      expect(confirmed[0].status).toBe('payment_confirmed');
      expect(confirmed[0].deposit_status).toBe('held');
      expect(mockSendPaymentConfirmed).toHaveBeenCalled();
      expect(mockSendNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: String(renter), type: 'tool_rental_payment_confirmed',
      }));

      // Double confirmation is refused (invoice immutability).
      const again = await request(app)
        .post(`/api/tool-rentals/invoices/${invoice.id}/confirm-payment`)
        .set('x-test-user', owner)
        .send({});
      expect(again.status).toBe(400);

      // The receipt carries the proof.
      const receipt = await request(app)
        .get(`/api/tool-rentals/bookings/${booking.id}/receipt`)
        .set('x-test-user', renter)
        .expect(200);
      expect(receipt.body.invoice.payment_proof_reference).toBe('VENMO-ABC-123');
      expect(Number(receipt.body.invoice.payment_proof_amount)).toBe(94);
    });
  });
  describe('G11-A2: listing delete refuses while a booking is live (D-604)', () => {
    test('a pending booking blocks the delete with 409', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      await insertBooking(tool.id, renter, owner, '2026-12-10', '2026-12-12', 'pending');
      const res = await request(app).delete(`/api/tool-rentals/${tool.id}`).set('x-test-user', owner);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('active_bookings');
      expect(res.body.active_bookings).toBe(1);
      const { rows } = await db.query('SELECT id FROM tool_rentals WHERE id = $1', [tool.id]);
      expect(rows).toHaveLength(1);
    });

    test('an invoice_sent booking blocks, and a returned booking blocks', async () => {
      const { owner, tool } = await invoiceSentBooking();
      const blocked = await request(app).delete(`/api/tool-rentals/${tool.id}`).set('x-test-user', owner);
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('active_bookings');

      const owner2 = await addUser();
      const renter2 = await addUser();
      await grantToolOwner(owner2);
      const tool2 = await insertTool(owner2);
      await insertBooking(tool2.id, renter2, owner2, '2026-12-10', '2026-12-12', 'returned');
      const blocked2 = await request(app).delete(`/api/tool-rentals/${tool2.id}`).set('x-test-user', owner2);
      expect(blocked2.status).toBe(409);
      expect(blocked2.body.code).toBe('active_bookings');
    });

    test('cancelled and completed bookings do not block', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      await insertBooking(tool.id, renter, owner, '2026-12-10', '2026-12-12', 'cancelled');
      const tool2 = await insertTool(owner, { name: 'Second drill' });
      await insertBooking(tool2.id, renter, owner, '2026-12-10', '2026-12-12', 'completed');
      expect((await request(app).delete(`/api/tool-rentals/${tool.id}`).set('x-test-user', owner)).status).toBe(200);
      expect((await request(app).delete(`/api/tool-rentals/${tool2.id}`).set('x-test-user', owner)).status).toBe(200);
    });

    test('a stranger still gets 404, never the 409', async () => {
      const owner = await addUser();
      const renter = await addUser();
      const stranger = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      await insertBooking(tool.id, renter, owner, '2026-12-10', '2026-12-12', 'pending');
      const res = await request(app).delete(`/api/tool-rentals/${tool.id}`).set('x-test-user', stranger);
      expect(res.status).toBe(404);
    });
  });

  describe('G11-A4: identity flags count only while their verification time is fresh (D-605)', () => {
    const { rentalIdentityStatus } = require('../utils/rentalIdentity');
    const freshAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const staleAt = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString();

    test('a bare flag with no timestamp is fail-closed (the A4 hole)', () => {
      expect(rentalIdentityStatus({ identity_verified: true, id_verified: true }).verified).toBe(false);
      expect(rentalIdentityStatus({ identity_verified: true, id_verified: true }).status).toBe('not_started');
    });

    test('a flag with a fresh timestamp verifies, and reports that time', () => {
      const s = rentalIdentityStatus({ identity_verified: true, id_verified: true, identity_verified_at: freshAt });
      expect(s.verified).toBe(true);
      expect(s.status).toBe('verified');
      expect(new Date(s.verifiedAt).getTime()).toBe(new Date(freshAt).getTime());
    });

    test('a flag with a stale timestamp does not verify', () => {
      const s = rentalIdentityStatus({ identity_verified: true, id_verified: true, identity_verified_at: staleAt });
      expect(s.verified).toBe(false);
    });

    test('a fresh Didit approval still verifies, a stale one does not', () => {
      expect(rentalIdentityStatus({ didit_status: 'verified', didit_verified_at: freshAt }).verified).toBe(true);
      const s = rentalIdentityStatus({ didit_status: 'verified', didit_verified_at: staleAt });
      expect(s.verified).toBe(false);
      expect(s.status).toBe('expired');
    });

    test('a fresh flag rescues a stale Didit approval', () => {
      const s = rentalIdentityStatus({
        didit_status: 'verified', didit_verified_at: staleAt,
        identity_verified: true, identity_verified_at: freshAt,
      });
      expect(s.verified).toBe(true);
    });

    test('skipped is still not verified', () => {
      expect(rentalIdentityStatus({ didit_status: 'skipped' }).verified).toBe(false);
    });

    test('the bookings list carries the TTL verdict end to end', async () => {
      const owner = await addUser();
      const staleRenter = await addUser('customer', { identityVerified: true, identityVerifiedAt: staleAt });
      const freshRenter = await addUser('customer', { identityVerified: true, identityVerifiedAt: freshAt });
      await grantToolOwner(owner);
      const staleTool = await insertTool(owner);
      const freshTool = await insertTool(owner, { name: 'Second drill' });
      await insertBooking(staleTool.id, staleRenter, owner, '2026-12-10', '2026-12-12', 'pending');
      await insertBooking(freshTool.id, freshRenter, owner, '2026-12-10', '2026-12-12', 'pending');
      const staleList = await request(app).get('/api/tool-rentals/bookings/my').set('x-test-user', staleRenter).expect(200);
      expect(staleList.body[0].renter_identity.verified).toBe(false);
      const freshList = await request(app).get('/api/tool-rentals/bookings/my').set('x-test-user', freshRenter).expect(200);
      expect(freshList.body[0].renter_identity.verified).toBe(true);
    });
  });

  // A booking at payment_confirmed with the deposit held (rental 54 +
  // deposit 40 = invoice total 94, proof recorded, owner confirmed).
  async function paymentConfirmedBooking() {
    const ctx = await invoiceSentBooking();
    const { owner, renter, booking, invoice } = ctx;
    await request(app)
      .post(`/api/tool-rentals/invoices/${invoice.id}/record-payment`)
      .set('x-test-user', renter)
      .send({ reference: 'VENMO-ABC-123', amount: 94 })
      .expect(200);
    await request(app)
      .post(`/api/tool-rentals/invoices/${invoice.id}/confirm-payment`)
      .set('x-test-user', owner)
      .send({})
      .expect(200);
    return ctx;
  }

  const setStatus = (bookingId, userId, status) => request(app)
    .put(`/api/tool-rentals/bookings/${bookingId}`)
    .set('x-test-user', userId)
    .send({ status });

  const resolveDeposit = (bookingId, userId, body) => request(app)
    .post(`/api/tool-rentals/bookings/${bookingId}/deposit/resolve`)
    .set('x-test-user', userId)
    .send(body);

  describe('G11-B3/A7: deposit resolves only once the rental is over (D-606)', () => {
    test('mid-rental resolve is refused; returned resolves', async () => {
      const { owner, booking } = await paymentConfirmedBooking();
      const midRental = await resolveDeposit(booking.id, owner, { action: 'return' });
      expect(midRental.status).toBe(409);
      await setStatus(booking.id, owner, 'returned').then((r) => expect(r.status).toBe(200));
      const resolved = await resolveDeposit(booking.id, owner, { action: 'return' });
      expect(resolved.status).toBe(200);
      expect(resolved.body.deposit_status).toBe('returned');
    });

    test('a cancelled paid booking resolves instead of leaving the deposit held', async () => {
      const { owner, renter, booking } = await paymentConfirmedBooking();
      await setStatus(booking.id, renter, 'cancelled').then((r) => expect(r.status).toBe(200));
      const resolved = await resolveDeposit(booking.id, owner, { action: 'return' });
      expect(resolved.status).toBe(200);
      expect(resolved.body.deposit_status).toBe('returned');
    });

    test('completed resolves, and withhold still needs a reason', async () => {
      const { owner, booking } = await paymentConfirmedBooking();
      await setStatus(booking.id, owner, 'returned').then((r) => expect(r.status).toBe(200));
      await setStatus(booking.id, owner, 'completed').then((r) => expect(r.status).toBe(200));
      const noNote = await resolveDeposit(booking.id, owner, { action: 'withhold', amount: 10 });
      expect(noNote.status).toBe(400);
      const withheld = await resolveDeposit(booking.id, owner, { action: 'withhold', amount: 10, note: 'Chipped chuck, repair quote attached.' });
      expect(withheld.status).toBe(200);
      expect(withheld.body.deposit_status).toBe('partially_withheld');
    });
  });

  describe('G11-B6: only the payer settles, with a payment reference (D-607)', () => {
    async function agreedSettlement(amount = 18, direction = 'owner_to_renter') {
      const { owner, renter, booking } = await paymentConfirmedBooking();
      await setStatus(booking.id, renter, 'cancelled').then((r) => expect(r.status).toBe(200));
      const proposed = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/recovery/refund`)
        .set('x-test-user', owner)
        .send({ amount, direction, note: 'Half back for the unused days.' });
      expect(proposed.status).toBe(200);
      const confirmed = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/recovery/confirm`)
        .set('x-test-user', renter);
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.recovery.refund_status).toBe('agreed');
      return { owner, renter, booking };
    }
    const settle = (bookingId, userId, body) => request(app)
      .post(`/api/tool-rentals/bookings/${bookingId}/recovery/settle`)
      .set('x-test-user', userId)
      .send(body || {});

    test('the non-payer cannot settle; the payer needs a reference', async () => {
      const { owner, renter, booking } = await agreedSettlement();
      const byNonPayer = await settle(booking.id, renter, { reference: 'VENMO-999' });
      expect(byNonPayer.status).toBe(403);
      expect(byNonPayer.body.code).toBe('not_payer');
      const noReference = await settle(booking.id, owner, {});
      expect(noReference.status).toBe(400);
      expect(noReference.body.code).toBe('reference_required');
      const settled = await settle(booking.id, owner, { reference: 'VENMO-999' });
      expect(settled.status).toBe(200);
      expect(settled.body.recovery.refund_status).toBe('settled');
      expect(settled.body.recovery.settled_reference).toBe('VENMO-999');
      expect(settled.body.recovery.settled_by).toBe(owner);
    });

    test('a renter-to-owner direction flips the payer', async () => {
      const { owner, renter, booking } = await agreedSettlement(12, 'renter_to_owner');
      const byOwner = await settle(booking.id, owner, { reference: 'VENMO-111' });
      expect(byOwner.status).toBe(403);
      const settled = await settle(booking.id, renter, { reference: 'VENMO-111' });
      expect(settled.status).toBe(200);
      expect(settled.body.recovery.settled_by).toBe(renter);
    });

    test('a zero-amount settlement needs no reference and either party may settle', async () => {
      const { owner, renter, booking } = await agreedSettlement(0, 'none');
      const settled = await settle(booking.id, renter, {});
      expect(settled.status).toBe(200);
      expect(settled.body.recovery.refund_status).toBe('settled');
      expect(settled.body.recovery.settled_reference).toBeNull();
    });
  });

  describe('G11-B7: reschedule decisions need a live booking and a future date (D-608)', () => {
    test('a past return date is refused', async () => {
      // Past-date case isolated from the after-pickup rule: a booking
      // whose rental already started, proposing a return in the past.
      const pastOwner = await addUser();
      const pastRenter = await addUser();
      await grantToolOwner(pastOwner);
      const pastTool = await insertTool(pastOwner);
      const pastBooking = await insertBooking(pastTool.id, pastRenter, pastOwner, '2026-11-01', '2026-11-10', 'payment_confirmed');
      const res = await request(app)
        .post(`/api/tool-rentals/bookings/${pastBooking.id}/return-reschedule`)
        .set('x-test-user', pastRenter)
        .send({ proposedEndDate: '2026-11-20' });
      expect(res.status).toBe(400);
      expect(res.body.fields.proposedEndDate).toMatch(/past/);
    });

    test('approve and decline on a non-live booking are refused', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      const booking = await insertBooking(tool.id, renter, owner, '2026-12-10', '2026-12-12', 'invoice_sent', {
        return_reschedule_status: 'proposed',
        return_reschedule_proposed_end_date: '2026-12-20',
      });
      const approve = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule/approve`)
        .set('x-test-user', owner);
      expect(approve.status).toBe(409);
      const decline = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule/decline`)
        .set('x-test-user', owner)
        .send({ reason: 'No longer available then.' });
      expect(decline.status).toBe(409);
    });

    test('happy path: propose a future date, owner approves, end date moves', async () => {
      const { owner, renter, booking } = await paymentConfirmedBooking();
      const proposed = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule`)
        .set('x-test-user', renter)
        .send({ proposedEndDate: '2026-12-20' });
      expect(proposed.status).toBe(200);
      expect(proposed.body.return_reschedule_status).toBe('proposed');
      const approved = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule/approve`)
        .set('x-test-user', owner);
      expect(approved.status).toBe(200);
      expect(approved.body.return_reschedule_status).toBe('approved');
      expect(String(approved.body.end_date).slice(0, 10)).toBe('2026-12-20');
    });

    test('owner can decline with a reason', async () => {
      const { owner, renter, booking } = await paymentConfirmedBooking();
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule`)
        .set('x-test-user', renter)
        .send({ proposedEndDate: '2026-12-20' })
        .expect(200);
      const declined = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule/decline`)
        .set('x-test-user', owner)
        .send({ reason: 'Need it back for another job.' });
      expect(declined.status).toBe(200);
      expect(declined.body.return_reschedule_status).toBe('declined');
    });
  });

  describe('G11-B2/A5: rental lifecycle events notify the other party (D-609)', () => {
    // The notification service is mocked, so the assertion is on its
    // calls: type + recipient. Cleared before each test so an earlier
    // flow (approve inside invoiceSentBooking, etc.) cannot leak in.
    beforeEach(() => {
      mockSendNotification.mockClear();
      mockSendBookingCancelledToOwner.mockClear();
      mockSendPaymentConfirmedToOwner.mockClear();
    });
    const notified = (type, userId) => mockSendNotification.mock.calls
      .filter(([call]) => call?.type === type && String(call?.userId) === String(userId));

    async function pendingBooking() {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      const created = await request(app)
        .post('/api/tool-rentals/bookings')
        .set('x-test-user', renter)
        .send({ toolId: tool.id, startDate: '2026-12-10', endDate: '2026-12-12', renterAgreementAccepted: true });
      expect(created.status).toBe(201);
      return { owner, renter, tool, booking: created.body };
    }

    async function openEscalation(owner, renter, booking) {
      const opened = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/escalations`)
        .set('x-test-user', renter)
        .send({ category: 'damage', message: 'The drill came back cracked.' });
      expect(opened.status).toBe(201);
      return opened.body.escalation.id;
    }

    async function setNotifyBookings(userId, value) {
      await db.query(
        `INSERT INTO tool_rental_notifications (user_id, notify_bookings) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET notify_bookings = EXCLUDED.notify_bookings`,
        [userId, value],
      );
    }

    test('approval and decline notify the renter in-app', async () => {
      const first = await pendingBooking();
      await request(app).post(`/api/tool-rentals/bookings/${first.booking.id}/approve`).set('x-test-user', first.owner).expect(200);
      expect(notified('tool_rental_booking_approved', first.renter).length).toBe(1);

      const second = await pendingBooking();
      await request(app)
        .post(`/api/tool-rentals/bookings/${second.booking.id}/decline`)
        .set('x-test-user', second.owner)
        .send({ reason: 'Out on loan that week.' })
        .expect(200);
      expect(notified('tool_rental_booking_declined', second.renter).length).toBe(1);
    });

    test('invoice sent notifies the renter even for in-platform delivery', async () => {
      const { renter } = await invoiceSentBooking();
      expect(notified('tool_rental_invoice_sent', renter).length).toBe(1);
    });

    test('payment confirmation notifies the renter and emails the owner a record', async () => {
      const { owner, renter } = await paymentConfirmedBooking();
      expect(notified('tool_rental_payment_confirmed', renter).length).toBe(1);
      expect(mockSendPaymentConfirmedToOwner.mock.calls.length).toBe(1);
      expect(mockSendPaymentConfirmedToOwner.mock.calls[0][2].email).toContain('g11g-');
      expect(mockSendPaymentConfirmedToOwner.mock.calls[0][0].id).toBeTruthy();
      expect(owner).toBeTruthy();
    });

    test('renter cancel tells the owner by email and in-app; owner cancel tells the renter in-app only', async () => {
      const first = await paymentConfirmedBooking();
      await setStatus(first.booking.id, first.renter, 'cancelled').then((r) => expect(r.status).toBe(200));
      expect(notified('tool_rental_booking_cancelled', first.owner).length).toBe(1);
      expect(mockSendBookingCancelledToOwner.mock.calls.length).toBe(1);

      mockSendNotification.mockClear();
      mockSendBookingCancelledToOwner.mockClear();
      const second = await paymentConfirmedBooking();
      await setStatus(second.booking.id, second.owner, 'cancelled').then((r) => expect(r.status).toBe(200));
      expect(notified('tool_rental_booking_cancelled', second.renter).length).toBe(1);
      expect(mockSendBookingCancelledToOwner.mock.calls.length).toBe(0);
    });

    test('marking a return notifies the counterparty', async () => {
      const { owner, renter, booking } = await paymentConfirmedBooking();
      await setStatus(booking.id, owner, 'returned').then((r) => expect(r.status).toBe(200));
      expect(notified('tool_rental_return_marked', renter).length).toBe(1);
    });

    test('damage claim filed, resolved and acknowledged each notify the waiting party', async () => {
      const { owner, renter, booking } = await paymentConfirmedBooking();
      const filed = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims`)
        .set('x-test-user', owner)
        .send({ amount: 25, description: 'Cracked housing.' });
      expect(filed.status).toBe(201);
      expect(notified('tool_rental_damage_claim_filed', renter).length).toBe(1);

      const resolved = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims/${filed.body.claim.id}/resolve`)
        .set('x-test-user', renter)
        .send({ decision: 'agreed', agreed_amount: 20 });
      expect(resolved.status).toBe(200);
      expect(notified('tool_rental_damage_claim_resolved', owner).length).toBe(1);

      const acked = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/damage-claims/${filed.body.claim.id}/acknowledge`)
        .set('x-test-user', owner)
        .send({ decision: 'acknowledged' });
      expect(acked.status).toBe(200);
      expect(notified('tool_rental_damage_claim_acknowledged', renter).length).toBe(1);
    });

    test('escalation replies notify the counterparty; an admin reply tells both parties', async () => {
      const { owner, renter, booking } = await paymentConfirmedBooking();
      const escalationId = await openEscalation(owner, renter, booking);
      mockSendNotification.mockClear();
      const reply = await request(app)
        .post(`/api/tool-rentals/escalations/${escalationId}/messages`)
        .set('x-test-user', renter)
        .send({ message: 'Here is a photo of the crack.' });
      expect(reply.status).toBe(201);
      expect(notified('tool_rental_escalation_replied', owner).length).toBe(1);
      expect(notified('tool_rental_escalation_replied', renter).length).toBe(0);

      mockSendNotification.mockClear();
      const admin = await addUser('super_admin');
      const adminReply = await request(app)
        .post(`/api/tool-rentals/admin/escalations/${escalationId}/messages`)
        .set('x-test-user', admin)
        .send({ message: 'Looking into this now.' });
      expect(adminReply.status).toBe(201);
      expect(notified('tool_rental_escalation_replied', owner).length).toBe(1);
      expect(notified('tool_rental_escalation_replied', renter).length).toBe(1);
    });

    test('reschedule proposed, approved and declined notify the waiting party', async () => {
      const first = await paymentConfirmedBooking();
      await request(app)
        .post(`/api/tool-rentals/bookings/${first.booking.id}/return-reschedule`)
        .set('x-test-user', first.renter)
        .send({ proposedEndDate: '2026-12-20' })
        .expect(200);
      expect(notified('tool_rental_reschedule_proposed', first.owner).length).toBe(1);
      await request(app)
        .post(`/api/tool-rentals/bookings/${first.booking.id}/return-reschedule/approve`)
        .set('x-test-user', first.owner)
        .expect(200);
      expect(notified('tool_rental_reschedule_approved', first.renter).length).toBe(1);

      const second = await paymentConfirmedBooking();
      await request(app)
        .post(`/api/tool-rentals/bookings/${second.booking.id}/return-reschedule`)
        .set('x-test-user', second.renter)
        .send({ proposedEndDate: '2026-12-20' })
        .expect(200);
      await request(app)
        .post(`/api/tool-rentals/bookings/${second.booking.id}/return-reschedule/decline`)
        .set('x-test-user', second.owner)
        .send({ reason: 'Need it back for another job.' })
        .expect(200);
      expect(notified('tool_rental_reschedule_declined', second.renter).length).toBe(1);
    });

    test('refund proposed, confirmed and settled notify the waiting party', async () => {
      const { owner, renter, booking } = await paymentConfirmedBooking();
      await setStatus(booking.id, renter, 'cancelled').then((r) => expect(r.status).toBe(200));
      mockSendNotification.mockClear();
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/recovery/refund`)
        .set('x-test-user', owner)
        .send({ amount: 18, direction: 'owner_to_renter', note: 'Half back for the unused days.' })
        .expect(200);
      expect(notified('tool_rental_refund_proposed', renter).length).toBe(1);
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/recovery/confirm`)
        .set('x-test-user', renter)
        .expect(200);
      expect(notified('tool_rental_refund_confirmed', owner).length).toBe(1);
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/recovery/settle`)
        .set('x-test-user', owner)
        .send({ reference: 'VENMO-999' })
        .expect(200);
      expect(notified('tool_rental_refund_settled', renter).length).toBe(1);
    });

    test('deposit resolved and acknowledged notify the waiting party', async () => {
      const { owner, renter, booking } = await paymentConfirmedBooking();
      await setStatus(booking.id, owner, 'returned').then((r) => expect(r.status).toBe(200));
      mockSendNotification.mockClear();
      await resolveDeposit(booking.id, owner, { action: 'return' }).then((r) => expect(r.status).toBe(200));
      expect(notified('tool_rental_deposit_resolved', renter).length).toBe(1);
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/deposit/acknowledge`)
        .set('x-test-user', renter)
        .send({ decision: 'acknowledged' })
        .expect(200);
      expect(notified('tool_rental_deposit_acknowledged', owner).length).toBe(1);
    });

    test('a renter who silenced booking notices gets none, but a safety-thread reply still arrives', async () => {
      const { owner, renter, booking } = await pendingBooking();
      await setNotifyBookings(renter, false);
      await request(app).post(`/api/tool-rentals/bookings/${booking.id}/approve`).set('x-test-user', owner).expect(200);
      expect(notified('tool_rental_booking_approved', renter).length).toBe(0);

      // The same renter, toggle still off, opens an escalation; the
      // owner's reply reaches them because the safety thread ignores
      // the bookings toggle.
      const escalationId = await openEscalation(owner, renter, booking);
      mockSendNotification.mockClear();
      await request(app)
        .post(`/api/tool-rentals/escalations/${escalationId}/messages`)
        .set('x-test-user', owner)
        .send({ message: 'Can you describe the damage?' })
        .expect(201);
      expect(notified('tool_rental_escalation_replied', renter).length).toBe(1);
    });
  });

  // Dates relative to the database CURRENT_DATE (America/New_York on the
  // test database): an overdue booking ends before today, a booking ending
  // today is not overdue yet.
  function nyToday() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }
  function dayOffset(days) {
    const [y, m, d] = nyToday().split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  }
  async function grantRow(userId) {
    const { rows } = await db.query(
      `SELECT id, version, status, expires_at FROM access_grants
        WHERE user_id = $1 AND capability = 'tool_owner.list_equipment'`,
      [userId],
    );
    return rows[0];
  }
  const browseIds = (toolId) => request(app).get(`/api/tool-rentals?ids=${toolId}`);
  const bookAs = (renterId, toolId, startDate, endDate) => request(app)
    .post('/api/tool-rentals/bookings')
    .set('x-test-user', renterId)
    .send({ toolId, startDate, endDate, renterAgreementAccepted: true });

  describe('G11-A6: grant revocation unpublishes listings (D-610)', () => {
    test('revoking the grant through the review API flips listings to unavailable in the same step', async () => {
      const owner = await addUser();
      const admin = await addUser('super_admin');
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      const before = await grantRow(owner);
      expect(before.status).toBe('active');
      const out = await reviewService.changeGrant({ id: admin }, String(before.id), {
        action: 'revoke', expectedVersion: before.version, reasonCode: 'policy_not_met',
      });
      expect(out.status).toBe(200);
      expect(out.body.grant.status).toBe('revoked');
      const { rows } = await db.query('SELECT is_available FROM tool_rentals WHERE id = $1', [tool.id]);
      expect(rows[0].is_available).toBe(false);
    });

    test('a revoked owner’s listing disappears from browse and public detail, and booking is refused', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      expect((await browseIds(tool.id)).body.tools.map((t) => t.id)).toContain(tool.id);
      await revokeToolOwner(owner);
      expect((await browseIds(tool.id)).body.tools).toEqual([]);
      await request(app).get(`/api/tool-rentals/public/${tool.id}`).expect(404);
      const res = await bookAs(renter, tool.id, dayOffset(10), dayOffset(12));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('owner_access_revoked');
    });

    test('an expired grant hides the listing too', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      await db.query(
        `UPDATE access_grants SET expires_at = NOW() - INTERVAL '1 day'
          WHERE user_id = $1 AND capability = 'tool_owner.list_equipment'`,
        [owner],
      );
      expect((await browseIds(tool.id)).body.tools).toEqual([]);
      await request(app).get(`/api/tool-rentals/public/${tool.id}`).expect(404);
    });

    test('a revoked owner cannot re-publish via PUT', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      await revokeToolOwner(owner);
      const res = await request(app)
        .put(`/api/tool-rentals/${tool.id}`)
        .set('x-test-user', owner)
        .send({ is_available: true });
      expect(res.status).toBe(200);
      expect(res.body.tool.is_available).toBe(false);
      expect(res.body.publication_blocked).toBe(true);
    });

    test('suspension hides but does not unpublish; reinstate restores', async () => {
      const owner = await addUser();
      const admin = await addUser('super_admin');
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      const g1 = await grantRow(owner);
      const suspended = await reviewService.changeGrant({ id: admin }, String(g1.id), {
        action: 'suspend', expectedVersion: g1.version, reasonCode: 'policy_not_met',
      });
      expect(suspended.status).toBe(200);
      const { rows: stillAvailable } = await db.query('SELECT is_available FROM tool_rentals WHERE id = $1', [tool.id]);
      expect(stillAvailable[0].is_available).toBe(true);
      expect((await browseIds(tool.id)).body.tools).toEqual([]);
      const g2 = await grantRow(owner);
      const reinstated = await reviewService.changeGrant({ id: admin }, String(g2.id), {
        action: 'reinstate', expectedVersion: g2.version, reasonCode: 'review_complete',
      });
      expect(reinstated.status).toBe(200);
      expect((await browseIds(tool.id)).body.tools.map((t) => t.id)).toContain(tool.id);
    });
  });

  describe('G11-B4: an overdue unreturned rental hard-blocks the next booking (D-611)', () => {
    async function overdueSetup() {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      const firstRenter = await addUser();
      // A paid rental that ended two days ago and was never returned.
      const overdue = await insertBooking(tool.id, firstRenter, owner, dayOffset(-9), dayOffset(-2), 'payment_confirmed');
      return { owner, renter, tool, overdue };
    }

    test('a new booking is refused while a previous rental is overdue and unreturned', async () => {
      const { renter, tool, overdue } = await overdueSetup();
      // Dates that do not overlap the overdue booking: only the B4 block
      // can refuse this, not the calendar conflict.
      const res = await bookAs(renter, tool.id, dayOffset(10), dayOffset(12));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('previous_rental_overdue');
      const { rows } = await db.query('SELECT COUNT(*) AS n FROM tool_rentals_bookings WHERE tool_id = $1', [tool.id]);
      expect(Number(rows[0].n)).toBe(1);
      expect(overdue.status).toBe('payment_confirmed');
    });

    test('a booking ending today is not overdue', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      const firstRenter = await addUser();
      await insertBooking(tool.id, firstRenter, owner, dayOffset(-3), dayOffset(0), 'payment_confirmed');
      const res = await bookAs(renter, tool.id, dayOffset(10), dayOffset(12));
      expect(res.status).toBe(201);
    });

    test('marking the overdue rental returned unblocks booking', async () => {
      const { renter, tool, overdue } = await overdueSetup();
      await db.query(`UPDATE tool_rentals_bookings SET status = 'returned' WHERE id = $1`, [overdue.id]);
      const res = await bookAs(renter, tool.id, dayOffset(10), dayOffset(12));
      expect(res.status).toBe(201);
    });

    test('a pending booking in the past does not block', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner);
      const firstRenter = await addUser();
      await insertBooking(tool.id, firstRenter, owner, dayOffset(-9), dayOffset(-2), 'pending');
      const res = await bookAs(renter, tool.id, dayOffset(10), dayOffset(12));
      expect(res.status).toBe(201);
    });

    test('the calendar-guard trigger refuses a direct insert while a rental is overdue', async () => {
      const { tool, owner } = await overdueSetup();
      const otherRenter = await addUser();
      await expect(
        insertBooking(tool.id, otherRenter, owner, dayOffset(10), dayOffset(12), 'pending'),
      ).rejects.toThrow(/overdue/i);
    });

    test('the public detail carries overdue_unreturned', async () => {
      const { tool } = await overdueSetup();
      const res = await request(app).get(`/api/tool-rentals/public/${tool.id}`);
      expect(res.status).toBe(200);
      expect(res.body.tool.overdue_unreturned).toBe(true);
      const owner2 = await addUser();
      await grantToolOwner(owner2);
      const tool2 = await insertTool(owner2);
      const res2 = await request(app).get(`/api/tool-rentals/public/${tool2.id}`);
      expect(res2.status).toBe(200);
      expect(res2.body.tool.overdue_unreturned).toBe(false);
    });
  });
});
