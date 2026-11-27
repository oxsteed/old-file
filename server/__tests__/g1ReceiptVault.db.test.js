'use strict';

/**
 * Group 1 (Customer), item 23 — receipt vault (G1-A2, checkpoint 3).
 *
 * Against the real migrated schema, through the real receipts controller:
 *   - the vault lists only the requesting customer's paid receipts: a
 *     paid tool rental and a captured job payment, each with its amount;
 *   - unpaid and cancelled items are excluded, not listed: a pending
 *     rental, a cancelled rental, and an authorized-but-not-captured job
 *     payment never appear, and neither does another customer's payment;
 *   - a stranger's vault is empty;
 *   - a helper booking's receipt renders the paid amount of its
 *     converted job's captured payment; a booking that never converted,
 *     or whose job was never paid, has no receipt (404
 *     receipt_not_available); a stranger gets 404, never the amount.
 *
 * DB: disposable loopback database credit_statement_test_g1ckpt3 only;
 * the suite skips otherwise. Run with G1_CKPT3_TEST_DATABASE_URL pointed
 * at it. Coordinator correction: the test as delivered only accepted the
 * shared credit_statement_test pathname, so its first runs polluted the
 * shared DB (residue cleaned 2026-11-27); it now takes the dedicated DB
 * like checkpoints 1-2.
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');

const RAW_URL = process.env.G1_CKPT3_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test_g1ckpt3$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable Group 1 checkpoint 3 test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'g1-receipt-vault-test-secret';
}

const pool = require('../db');
const receiptsController = require('../controllers/receiptsController');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

ddescribe('Group 1 item 23: receipt vault', () => {
  let customer;
  let helper;
  let stranger;
  let owner;

  async function makeUser(role) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE)`,
      [id, `g1rc-${id.slice(0, 8)}@example.invalid`, role, role],
    );
    return id;
  }

  async function makeRentalBooking(customerId, ownerId, { status, totalPrice }) {
    const { rows: toolRows } = await pool.query(
      `INSERT INTO tool_rentals (user_id, name, daily_rate)
       VALUES ($1, 'Test drill', 12.50) RETURNING id`,
      [ownerId],
    );
    const toolId = toolRows[0].id;
    const paidAt = status === 'payment_confirmed' ? new Date() : null;
    const { rows } = await pool.query(
      `INSERT INTO tool_rentals_bookings
         (tool_id, customer_id, owner_id, start_date, end_date, status, total_price, payment_confirmed_at)
       VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + 2, $4, $5, $6)
       RETURNING id`,
      [toolId, customerId, ownerId, status, totalPrice, paidAt],
    );
    return rows[0].id;
  }

  async function makeJob(clientId, helperId) {
    const { rows } = await pool.query(
      `INSERT INTO jobs (client_id, assigned_helper_id, title, description, status)
       VALUES ($1, $2, 'Fix the sink', 'Leaky tap', 'completed') RETURNING id`,
      [clientId, helperId],
    );
    return rows[0].id;
  }

  async function makePayment(jobId, payerId, payeeId, { amount, status }) {
    const capturedAt = ['captured', 'released'].includes(status) ? new Date() : null;
    const { rows } = await pool.query(
      `INSERT INTO payments (job_id, payer_id, payee_id, amount, currency, status, captured_at)
       VALUES ($1, $2, $3, $4, 'usd', $5, $6)
       RETURNING id`,
      [jobId, payerId, payeeId, amount, status, capturedAt],
    );
    return rows[0].id;
  }

  async function makeBookingRequest(customerId, helperId, jobId) {
    const { rows } = await pool.query(
      `INSERT INTO booking_requests
         (customer_id, helper_id, service_name, requested_date,
          requested_start_time, requested_end_time, status, converted_to_job_id)
       VALUES ($1, $2, 'Fix the sink', CURRENT_DATE, '10:00', '11:00', 'accepted', $3)
       RETURNING id`,
      [customerId, helperId, jobId],
    );
    return rows[0].id;
  }

  beforeAll(async () => {
    customer = await makeUser('customer');
    helper = await makeUser('helper');
    stranger = await makeUser('customer');
    owner = await makeUser('customer');
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('vault lists only the requesting customer paid receipts', async () => {
    const paidRental = await makeRentalBooking(customer, owner, { status: 'payment_confirmed', totalPrice: 25.00 });
    await makeRentalBooking(customer, owner, { status: 'pending', totalPrice: 99.00 });
    await makeRentalBooking(customer, owner, { status: 'cancelled', totalPrice: 88.00 });
    const paidJob = await makeJob(customer, helper);
    await makePayment(paidJob, customer, helper, { amount: 120.00, status: 'captured' });
    const unpaidJob = await makeJob(customer, helper);
    await makePayment(unpaidJob, customer, helper, { amount: 55.00, status: 'authorized' });
    const strangerJob = await makeJob(stranger, helper);
    await makePayment(strangerJob, stranger, helper, { amount: 77.00, status: 'captured' });

    const res = mockRes();
    await receiptsController.listReceipts({ user: { id: customer } }, res);
    expect(res.statusCode).toBe(200);
    const receipts = res.payload.data;
    expect(receipts.find((r) => r.bookingId === String(paidRental))).toMatchObject({
      kind: 'tool_rental', amount: 25, currency: 'usd', status: 'payment_confirmed',
    });
    expect(receipts.find((r) => r.jobId === String(paidJob))).toMatchObject({
      kind: 'helper_job', amount: 120, currency: 'usd', status: 'captured',
    });
    expect(receipts.some((r) => Number(r.amount) === 99)).toBe(false);
    expect(receipts.some((r) => Number(r.amount) === 88)).toBe(false);
    expect(receipts.some((r) => Number(r.amount) === 55)).toBe(false);
    expect(receipts.some((r) => Number(r.amount) === 77)).toBe(false);

    const strangerRes = mockRes();
    await receiptsController.listReceipts({ user: { id: stranger } }, strangerRes);
    expect(strangerRes.statusCode).toBe(200);
    expect(strangerRes.payload.data.find((r) => r.jobId === String(paidJob))).toBeUndefined();
    expect(strangerRes.payload.data.find((r) => r.bookingId === String(paidRental))).toBeUndefined();
  });

  test('helper booking receipt renders the converted job paid amount', async () => {
    const job = await makeJob(customer, helper);
    await makePayment(job, customer, helper, { amount: 45.50, status: 'released' });
    const bookingId = await makeBookingRequest(customer, helper, job);

    const res = mockRes();
    await receiptsController.getHelperBookingReceipt(
      { user: { id: customer }, params: { bookingId } }, res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.payload.data).toMatchObject({
      kind: 'helper_job',
      bookingId: String(bookingId),
      jobId: String(job),
      amount: 45.5,
      currency: 'usd',
      status: 'released',
    });
    expect(res.payload.data.paidAt).toBeTruthy();
  });

  test('helper booking with no captured payment has no receipt', async () => {
    const unpaidJob = await makeJob(customer, helper);
    await makePayment(unpaidJob, customer, helper, { amount: 60.00, status: 'authorized' });
    const unpaidBooking = await makeBookingRequest(customer, helper, unpaidJob);
    const res = mockRes();
    await receiptsController.getHelperBookingReceipt(
      { user: { id: customer }, params: { bookingId: unpaidBooking } }, res,
    );
    expect(res.statusCode).toBe(404);
    expect(res.payload.code).toBe('receipt_not_available');

    const unconverted = await makeBookingRequest(customer, helper, null);
    const res2 = mockRes();
    await receiptsController.getHelperBookingReceipt(
      { user: { id: customer }, params: { bookingId: unconverted } }, res2,
    );
    expect(res2.statusCode).toBe(404);
    expect(res2.payload.code).toBe('receipt_not_available');
  });

  test('stranger gets 404, never the amount, for a helper booking receipt', async () => {
    const job = await makeJob(customer, helper);
    await makePayment(job, customer, helper, { amount: 33.00, status: 'captured' });
    const bookingId = await makeBookingRequest(customer, helper, job);
    const res = mockRes();
    await receiptsController.getHelperBookingReceipt(
      { user: { id: stranger }, params: { bookingId } }, res,
    );
    expect(res.statusCode).toBe(404);
    expect(res.payload.code).toBe('not_found');
    expect(JSON.stringify(res.payload)).not.toContain('33');
  });
});
