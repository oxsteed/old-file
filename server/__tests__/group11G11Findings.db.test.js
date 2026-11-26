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
jest.mock('../services/bookingEmailService', () => ({
  sendBookingConfirmation: jest.fn(),
  sendBookingApproved: jest.fn(),
  sendBookingDeclined: jest.fn(),
  sendPaymentProofReceived: (...args) => mockSendPaymentProofReceived(...args),
  sendPaymentConfirmed: (...args) => mockSendPaymentConfirmed(...args),
}));
jest.mock('../growth/emit', () => ({
  emitDomainEvent: jest.fn().mockResolvedValue(undefined),
  commerceEventProps: (value) => value,
}));
jest.mock('../utils/invoiceEmail', () => ({
  sendInvoiceEmail: jest.fn().mockResolvedValue({ success: true }),
}));

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
});
