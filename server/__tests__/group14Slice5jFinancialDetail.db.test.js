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
  let driver;
  let driver2;
  let admin;

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
    driver = await makeUser('helper');
    driver2 = await makeUser('helper');
    admin = await makeUser('super_admin');
    await makeDriverProfile(driver.id);
    await makeDriverProfile(driver2.id);
    const receiptsRouter = require('../routes/receipts');
    const localDeliveryRouter = require('../routes/localDelivery');
    app = express();
    app.use(express.json());
    app.use('/receipts', receiptsRouter);
    app.use('/delivery', localDeliveryRouter);
  });

  afterAll(async () => { if (pool) await pool.end(); });

  async function makeDriverProfile(userId) {
    await pool.query(
      `INSERT INTO delivery_driver_profiles
         (user_id, approved, active, vehicle_type, max_payload_lbs,
          cargo_length_in, cargo_width_in, cargo_height_in, equipment,
          service_area, max_pieces, fragile_supported, perishable_supported,
          insurance_acknowledged, insurance_expires_at, available_from, available_until, available)
       VALUES ($1, TRUE, TRUE, 'van', 200, 40, 40, 40, '{}'::jsonb, '{}'::jsonb, 10, TRUE, TRUE, TRUE, NULL, NULL, NULL, TRUE)`,
      [userId],
    );
  }

  async function makeDeliveryJob(customerId, driverId) {
    const reference = `DLV-G14J-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const { rows: [job] } = await pool.query(
      `INSERT INTO delivery_jobs
         (reference, customer_user_id, helper_user_id, internal_driver_user_id, vehicle_id,
          status, dispatch_state, fulfillment_source,
          origin_address, origin_city, origin_state, origin_lat, origin_lng,
          origin_contact_name, origin_contact_phone, origin_instructions,
          destination_address, destination_city, destination_state, destination_lat, destination_lng,
          destination_contact_name, destination_contact_phone, destination_instructions,
          distance_miles, duration_minutes, package_type, weight_lbs, pieces, notes,
          price_snapshot, customer_total_cents, driver_payout_cents, proof_preference, proof_pin_digest,
          pickup_window_start, pickup_window_end,
          delivery_window_start, delivery_window_end,
          estimated_arrival_at, eta_updated_at, picked_up_at)
       VALUES ($1, $2, $3, NULL, NULL,
          'delivered', 'completed', 'marketplace',
          '1 Origin Way', 'Columbus', 'OH', 40.123456, -83.123456,
          'Olivia Origin', '5550101000', 'Ring the side bell',
          '2 Destination Way', 'Columbus', 'OH', 40.234567, -83.234567,
          'Dan Destination', '5550102000', 'Leave at the back door',
          8, 45, 'medium', 20, 3, 'Fragile vase inside',
          '{}', 2500, 1800, 'photo', NULL,
          NOW() - INTERVAL '2 hours', NOW() + INTERVAL '2 hours',
          NOW() + INTERVAL '2 hours', NOW() + INTERVAL '4 hours',
          NOW() + INTERVAL '30 minutes', NOW(), NOW() - INTERVAL '30 minutes')
       RETURNING *`,
      [reference, customerId, driverId],
    );
    return job;
  }

  async function makePayout(jobId, driverId, overrides = {}) {
    const {
      status = 'accrued', payoutCents = 1800, note = null,
      approvedBy = null, approvedAt = null, paidBy = null, paidAt = null, paymentReference = null,
    } = overrides;
    const { rows: [payout] } = await pool.query(
      `INSERT INTO delivery_driver_payouts
         (delivery_job_id, driver_user_id, payout_cents, status, note,
          approved_by_user_id, approved_at, paid_by_user_id, paid_at, payment_reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [jobId, driverId, payoutCents, status, note, approvedBy, approvedAt, paidBy, paidAt, paymentReference],
    );
    return payout;
  }

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

  // 747: payout detail view.
  test('747: driver reads their own payout with adjustments, disputes, and timeline', async () => {
    const job = await makeDeliveryJob(customer.id, driver.id);
    const payout = await makePayout(job.id, driver.id, {
      status: 'approved', note: 'Toll review passed', approvedBy: admin.id, approvedAt: '2026-11-20T10:00:00Z',
    });
    await pool.query(
      `INSERT INTO delivery_payout_adjustments
         (payout_id, previous_payout_cents, new_payout_cents, reason, adjusted_by_user_id)
       VALUES ($1, 1500, 1800, 'Toll correction', $2)`,
      [payout.id, admin.id],
    );
    await pool.query(
      `INSERT INTO delivery_driver_disputes
         (delivery_job_id, payout_id, driver_user_id, subject, description, status)
       VALUES ($1, $2, $3, 'payout_amount', 'The toll was missing.', 'open')`,
      [job.id, payout.id, driver.id],
    );

    const res = await getAs(driver, `/delivery/driver-payouts/${payout.id}`).expect(200);
    expect(res.body.success).toBe(true);
    const detail = res.body.payout;
    expect(detail.id).toBe(String(payout.id));
    expect(detail.payout_cents).toBe(1800);
    expect(detail.currency).toBe('USD');
    expect(detail.status).toBe('approved');
    expect(detail.job_reference).toBe(job.reference);
    expect(detail.note).toBe('Toll review passed');
    expect(detail.adjustments).toHaveLength(1);
    expect(detail.adjustments[0].reason).toBe('Toll correction');
    expect(detail.adjustments[0].previous_payout_cents).toBe(1500);
    expect(detail.adjustments[0].new_payout_cents).toBe(1800);
    expect(detail.disputes).toHaveLength(1);
    expect(detail.disputes[0].subject).toBe('payout_amount');
    expect(detail.timeline.map((e) => e.status)).toEqual(['accrued', 'approved']);
    expect(detail.timeline[1].by).toBe('Test super_admin');
  });

  test('747: paid payout timeline carries the paid event with its reference', async () => {
    const job = await makeDeliveryJob(customer.id, driver.id);
    const payout = await makePayout(job.id, driver.id, {
      status: 'paid',
      approvedBy: admin.id, approvedAt: '2026-11-20T10:00:00Z',
      paidBy: admin.id, paidAt: '2026-11-21T10:00:00Z', paymentReference: 'tr_test123',
    });
    const res = await getAs(driver, `/delivery/driver-payouts/${payout.id}`).expect(200);
    expect(res.body.payout.timeline.map((e) => e.status)).toEqual(['accrued', 'approved', 'paid']);
    expect(res.body.payout.payment_reference).toBe('tr_test123');
  });

  test('747: another driver gets 404, a non-driver gets 403, garbage ids 404', async () => {
    const job = await makeDeliveryJob(customer.id, driver.id);
    const payout = await makePayout(job.id, driver.id, {});
    await getAs(driver2, `/delivery/driver-payouts/${payout.id}`).expect(404);
    await getAs(stranger, `/delivery/driver-payouts/${payout.id}`).expect(403);
    await getAs(driver, '/delivery/driver-payouts/999999999').expect(404);
    await getAs(driver, '/delivery/driver-payouts/not-an-id').expect(404);
  });

  test('747: ops reads any payout with the driver identity; non-ops gets 403', async () => {
    const job = await makeDeliveryJob(customer.id, driver.id);
    const payout = await makePayout(job.id, driver.id, { status: 'accrued' });
    const res = await getAs(admin, `/delivery/internal/driver-payouts/${payout.id}`).expect(200);
    expect(res.body.payout.id).toBe(String(payout.id));
    expect(res.body.payout.driver.id).toBe(driver.id);
    expect(res.body.payout.driver.email).toBe(driver.email);
    await getAs(customer, `/delivery/internal/driver-payouts/${payout.id}`).expect(403);
    await getAs(admin, '/delivery/internal/driver-payouts/999999999').expect(404);
  });
});
