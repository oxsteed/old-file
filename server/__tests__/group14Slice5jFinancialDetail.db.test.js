'use strict';

// Group 14 Slice 5j acceptance: read financial detail (746-750). The last
// Group 14 slice; Group 14 is READ-ONLY (D-408): nothing here moves money.
//   746 Receipt archive: GET /receipts gains server-side year/month, kind,
//       search, and pagination; the vault list had none of them.
//   747 Payout detail view: single-payout read for driver and ops.
//   748 Refund status history: refund attempts for a payment, payer/payee
//       or admin only.
//   749 Currency-aware formatting: formatMoney stops forcing 2 fraction
//       digits; the ops/finance renders use currency-aware helpers.
//   750 Approved balance snapshots: HELD (D-793) — no approval meaning
//       for snapshots exists in code; not built. See the decision.
// Dedicated database (credit_statement_test_g14j); the suite skips
// without GROUP14_SLICE5J_TEST_DATABASE_URL.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP14_SLICE5J_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g14j') {
    throw new Error('Group 14 Slice 5j DB tests require the loopback credit_statement_test_g14j database');
  }
  process.env.DATABASE_URL = dbUrl;
}
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = 'g14j-test-secret';

jest.setTimeout(120000);

const describeDb = dbUrl ? describe : describe.skip;

const runId = crypto.randomUUID().slice(0, 8);

describeDb('Group 14 Slice 5j: read financial detail (746-750)', () => {
  let pool;
  let app;
  let customer;
  let helper;
  let stranger;
  let owner;

  const tokenFor = (user) => require('../middleware/auth').generateTokens(user).accessToken;
  const authAs = (user, req) => req.set('Authorization', `Bearer ${tokenFor(user)}`);
  const getAs = (user, path) => authAs(user, request(app).get(path));

  async function makeUser(role) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE)`,
      [id, `g14j-${role}-${id.slice(0, 8)}@example.invalid`, role, role],
    );
    return { id, role, email: `g14j-${role}-${id.slice(0, 8)}@example.invalid` };
  }

  async function makeRentalBooking(customerId, ownerId, { status, totalPrice, paidAt, name = 'Test drill' }) {
    const { rows: toolRows } = await pool.query(
      `INSERT INTO tool_rentals (user_id, name, daily_rate)
       VALUES ($1, $2, 12.50) RETURNING id`,
      [ownerId, name],
    );
    const toolId = toolRows[0].id;
    const { rows } = await pool.query(
      `INSERT INTO tool_rentals_bookings
         (tool_id, customer_id, owner_id, start_date, end_date, status, total_price, payment_confirmed_at)
       VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + 2, $4, $5, $6)
       RETURNING id`,
      [toolId, customerId, ownerId, status, totalPrice, paidAt],
    );
    return rows[0].id;
  }

  async function makeJob(clientId, helperId, title = 'Fix the sink') {
    const { rows } = await pool.query(
      `INSERT INTO jobs (client_id, assigned_helper_id, title, description, status)
       VALUES ($1, $2, $3, 'Leaky tap', 'completed') RETURNING id`,
      [clientId, helperId, title],
    );
    return rows[0].id;
  }

  async function makePayment(jobId, payerId, payeeId, { amount, status, capturedAt, releasedAt }) {
    const { rows } = await pool.query(
      `INSERT INTO payments (job_id, payer_id, payee_id, amount, currency, status, captured_at, released_at)
       VALUES ($1, $2, $3, $4, 'usd', $5, $6, $7)
       RETURNING id`,
      [jobId, payerId, payeeId, amount, status, capturedAt, releasedAt],
    );
    return rows[0].id;
  }

  beforeAll(async () => {
    pool = require('../db');
    customer = await makeUser('customer');
    helper = await makeUser('helper');
    stranger = await makeUser('customer');
    owner = await makeUser('customer');
    const receiptsRouter = require('../routes/receipts');
    app = express();
    app.use(express.json());
    app.use('/receipts', receiptsRouter);
  });

  afterAll(async () => { if (pool) await pool.end(); });

  // 746: receipt archive.
  test('746: archive pages, filters by period/kind/search, and stays scoped', async () => {
    const marchRental = await makeRentalBooking(customer.id, owner.id, {
      status: 'payment_confirmed', totalPrice: 25.00, paidAt: '2026-03-15T10:00:00Z', name: 'March drill',
    });
    const juneRental = await makeRentalBooking(customer.id, owner.id, {
      status: 'payment_confirmed', totalPrice: 40.00, paidAt: '2026-06-15T10:00:00Z', name: 'June saw',
    });
    await makeRentalBooking(customer.id, owner.id, {
      status: 'pending', totalPrice: 99.00, paidAt: null, name: 'Unpaid wrench',
    });
    const marchJob = await makeJob(customer.id, helper.id, 'Fix the sink');
    await makePayment(marchJob, customer.id, helper.id, {
      amount: 120.00, status: 'released', capturedAt: '2026-03-09T10:00:00Z', releasedAt: '2026-03-10T10:00:00Z',
    });
    const oldJob = await makeJob(customer.id, helper.id, 'Paint the fence');
    await makePayment(oldJob, customer.id, helper.id, {
      amount: 80.00, status: 'captured', capturedAt: '2025-01-05T10:00:00Z', releasedAt: null,
    });

    const all = await getAs(customer, '/receipts').expect(200);
    expect(all.body.success).toBe(true);
    expect(all.body.total).toBe(4);
    expect(all.body.limit).toBe(50);
    expect(all.body.offset).toBe(0);
    // Newest first: June rental, March rental, March job, January job.
    expect(all.body.data[0].id).toBe(`rental-${juneRental}`);
    expect(all.body.data[1].id).toBe(`rental-${marchRental}`);
    expect(all.body.data[2].title).toBe('Fix the sink');
    expect(all.body.data[3].title).toBe('Paint the fence');

    const march = await getAs(customer, '/receipts?year=2026&month=3').expect(200);
    expect(march.body.total).toBe(2);
    expect(march.body.data.map((r) => r.title).sort()).toEqual(['Fix the sink', 'March drill']);

    const yearOnly = await getAs(customer, '/receipts?year=2025').expect(200);
    expect(yearOnly.body.total).toBe(1);
    expect(yearOnly.body.data[0].title).toBe('Paint the fence');

    const rentalsOnly = await getAs(customer, '/receipts?kind=tool_rental').expect(200);
    expect(rentalsOnly.body.total).toBe(2);
    expect(rentalsOnly.body.data.every((r) => r.kind === 'tool_rental')).toBe(true);

    const jobsOnly = await getAs(customer, '/receipts?kind=helper_job').expect(200);
    expect(jobsOnly.body.total).toBe(2);
    expect(jobsOnly.body.data.every((r) => r.kind === 'helper_job')).toBe(true);

    const search = await getAs(customer, '/receipts?q=sink').expect(200);
    expect(search.body.total).toBe(1);
    expect(search.body.data[0].title).toBe('Fix the sink');

    // Pagination walks the newest-first list; the total stays whole.
    const page1 = await getAs(customer, '/receipts?limit=2&offset=0').expect(200);
    expect(page1.body.data.length).toBe(2);
    expect(page1.body.total).toBe(4);
    const page2 = await getAs(customer, '/receipts?limit=2&offset=2').expect(200);
    expect(page2.body.data.length).toBe(2);
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);

    // A stranger's archive is empty by construction.
    const strangerRes = await getAs(stranger, '/receipts').expect(200);
    expect(strangerRes.body.total).toBe(0);
    expect(strangerRes.body.data).toEqual([]);
  });

  test('746: archive rejects a month without a year and bad filter values', async () => {
    const monthOnly = await getAs(customer, '/receipts?month=3').expect(400);
    expect(monthOnly.body.code).toBe('receipt_archive_invalid_period');
    const badYear = await getAs(customer, '/receipts?year=1999').expect(400);
    expect(badYear.body.code).toBe('receipt_archive_invalid_period');
    const badMonth = await getAs(customer, '/receipts?year=2026&month=13').expect(400);
    expect(badMonth.body.code).toBe('receipt_archive_invalid_period');
    const badKind = await getAs(customer, '/receipts?kind=invoice').expect(400);
    expect(badKind.body.code).toBe('receipt_archive_invalid_filter');
  });
});
