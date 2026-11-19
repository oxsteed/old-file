'use strict';

/**
 * PR #804 Track D, G-6 (book for another person) and G-7 (site contact).
 *
 * Against the real migrated schema, through the real booking controller:
 *   - a booking created with recipientUserId + recipient name/phone stores
 *     booked_by_user_id = booker and the recipient; the deposit payer stays
 *     the booker (booking.customer_id);
 *   - the recipient can read the booking and cancel it; a stranger 403s;
 *   - a booking created with a site contact mints a status_token, and the
 *     public token endpoint returns status + arrival window only (no
 *     customer/helper identity, no amounts, no billing); an unknown token 404s.
 *
 * DB: disposable loopback database credit_statement_test_pr804_d only; the
 * suite skips otherwise. Run with STATEMENT_TEST_DATABASE_URL pointed at it.
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

test('suite targets only the disposable Track D test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'pr804-track-d-test-secret';
}

const pool = require('../db');
const bookingController = require('../controllers/bookingController');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

function tomorrow() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

ddescribe('G-6 book for another person / G-7 site contact', () => {
  let booker;
  let helper;
  let recipient;
  let stranger;

  beforeAll(async () => {
    async function makeUser(role) {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE)`,
        [id, `pr804d-${id.slice(0, 8)}@example.invalid`, role, role],
      );
      return id;
    }
    booker = await makeUser('customer');
    helper = await makeUser('helper');
    recipient = await makeUser('customer');
    stranger = await makeUser('customer');
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  async function createBooking({ asUser, overrides = {} } = {}) {
    const res = mockRes();
    await bookingController.createBookingRequest({
      user: { id: asUser || booker },
      body: {
        helperId: helper,
        serviceName: 'Fix the sink',
        requestedDate: tomorrow(),
        requestedStartTime: '10:00',
        requestedEndTime: '11:00',
        serviceLocation: '12 Main St',
        description: 'Leaky tap',
        confirmationHours: 24,
        ...overrides,
      },
    }, res);
    return res;
  }

  test('G-6: booking for another person stores booker + recipient; recipient reads and cancels', async () => {
    const created = await createBooking({
      overrides: { recipientUserId: recipient, recipientName: 'Mom', recipientPhone: '555-0100' },
    });
    expect(created.statusCode).toBe(201);
    const booking = created.payload.data;
    expect(booking.customerId).toBe(booker);
    expect(booking.bookedByUserId).toBe(booker);
    expect(booking.recipientUserId).toBe(recipient);
    expect(booking.recipientName).toBe('Mom');

    const { rows } = await pool.query('SELECT customer_id, booked_by_user_id, recipient_user_id FROM booking_requests WHERE id = $1', [booking.id]);
    expect(rows[0].customer_id).toBe(booker);
    expect(rows[0].booked_by_user_id).toBe(booker);
    expect(rows[0].recipient_user_id).toBe(recipient);

    // Recipient reads.
    const read = mockRes();
    await bookingController.getBookingRequest({ params: { bookingId: booking.id }, user: { id: recipient } }, read);
    expect(read.statusCode).toBe(200);
    expect(read.payload.data.id).toBe(booking.id);

    // Stranger cannot read.
    const denied = mockRes();
    await bookingController.getBookingRequest({ params: { bookingId: booking.id }, user: { id: stranger } }, denied);
    expect(denied.statusCode).toBe(403);

    // Recipient cancels.
    const cancelled = mockRes();
    await bookingController.cancelBookingRequest({ params: { bookingId: booking.id }, user: { id: recipient }, body: {} }, cancelled);
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.payload.data.status).toBe('cancelled');
  });

  test('G-6: booking for yourself as recipient is rejected', async () => {
    const res = await createBooking({ overrides: { recipientUserId: booker } });
    expect(res.statusCode).toBe(400);
  });

  test('G-7: site contact mints a status token; public status shows no billing or identities', async () => {
    const created = await createBooking({
      overrides: { siteContactName: 'Concierge', siteContactPhone: '555-0200' },
    });
    expect(created.statusCode).toBe(201);
    const booking = created.payload.data;
    expect(booking.siteContactName).toBe('Concierge');
    expect(typeof booking.statusToken).toBe('string');
    expect(booking.statusToken).toHaveLength(64);

    const pub = mockRes();
    await bookingController.getPublicBookingStatus({ params: { token: booking.statusToken } }, pub);
    expect(pub.statusCode).toBe(200);
    expect(pub.payload.data.serviceName).toBe('Fix the sink');
    expect(pub.payload.data.status).toBe('pending');
    expect(pub.payload.data.requestedDate).toBeTruthy();
    // Nothing identifying the parties and nothing money-shaped leaks.
    expect(pub.payload.data).not.toHaveProperty('customerId');
    expect(pub.payload.data).not.toHaveProperty('helperId');
    expect(pub.payload.data).not.toHaveProperty('customer_id');
    expect(JSON.stringify(pub.payload.data)).not.toMatch(/cents|amount|price|payment|deposit/i);

    const missing = mockRes();
    await bookingController.getPublicBookingStatus({ params: { token: '0'.repeat(64) } }, missing);
    expect(missing.statusCode).toBe(404);
  });
});
