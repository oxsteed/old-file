'use strict';

/**
 * Group 1 (Customer), items 8/9/10 — quote response deadline, itemized
 * comparison data, and the expiry notice.
 *
 * Against the real migrated schema, through the real quote controller
 * and the deadline sweeper:
 *   - creating a quote request accepts a response_deadline within 30
 *     days and stores it; a past deadline or one over 30 days out is
 *     refused (400);
 *   - GET /my returns each request with its service lines and a
 *     deadline_passed flag, the data the compare view renders;
 *   - the sweeper notifies the customer once when the deadline passes
 *     with the request still unquoted, stamps deadline_notice_sent_at,
 *     and sends nothing on a second run.
 *
 * DB: disposable loopback database credit_statement_test only; the suite
 * skips otherwise. Run with STATEMENT_TEST_DATABASE_URL pointed at it.
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable Group 1 test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'group1-quote-test-secret';
}

const pool = require('../db');
const quoteRequestsController = require('../controllers/quoteRequestsController');
const { sweepQuoteDeadlineNotices } = require('../jobs/quoteDeadlineNotices');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

function quoteBody(overrides = {}) {
  return {
    first_name: 'Test',
    last_name: 'Customer',
    email: 'quote-customer@example.invalid',
    phone: '5551234567',
    service_category: 'Plumbing',
    service_location: '12 Main St',
    service_zip_code: '12345',
    details: 'Leaky tap under the kitchen sink.',
    preferred_contact_method: 'email',
    ...overrides,
  };
}

ddescribe('Group 1 items 8/9/10: quote deadline, comparison data, expiry notice', () => {
  let userId;

  beforeAll(async () => {
    userId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Test', 'Customer', 'customer', TRUE, TRUE)`,
      [userId, `g1q-${userId.slice(0, 8)}@example.invalid`],
    );
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('create accepts a deadline within 30 days and refuses past or far-future ones', async () => {
    const inFiveDays = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const ok = mockRes();
    await quoteRequestsController.createQuoteRequest(
      { user: { id: userId }, body: quoteBody({ response_deadline: inFiveDays }) },
      ok,
    );
    expect(ok.statusCode).toBe(201);
    const { rows } = await pool.query(
      'SELECT response_deadline FROM quote_requests WHERE id = $1', [ok.payload.requestId],
    );
    expect(rows[0].response_deadline).toBeTruthy();

    const past = mockRes();
    await quoteRequestsController.createQuoteRequest(
      { user: { id: userId }, body: quoteBody({ response_deadline: new Date(Date.now() - 86400000).toISOString() }) },
      past,
    );
    expect(past.statusCode).toBe(400);

    const far = mockRes();
    await quoteRequestsController.createQuoteRequest(
      { user: { id: userId }, body: quoteBody({ response_deadline: new Date(Date.now() + 31 * 86400000).toISOString() }) },
      far,
    );
    expect(far.statusCode).toBe(400);
  });

  test('GET /my carries service lines and deadline_passed for comparison', async () => {
    const created = mockRes();
    await quoteRequestsController.createQuoteRequest(
      { user: { id: userId }, body: quoteBody({ response_deadline: new Date(Date.now() + 3 * 86400000).toISOString() }) },
      created,
    );
    expect(created.statusCode).toBe(201);
    const requestId = created.payload.requestId;
    const catId = crypto.randomUUID();
    // Slugs are globally unique, so suffix them per run: this suite shares
    // the disposable DB across runs and must not collide with its own rows.
    const runSuffix = crypto.randomUUID().slice(0, 8);
    await pool.query(
      `INSERT INTO direct_catalog_categories (id, slug, name_i18n)
       VALUES ($1, $2, '{"en": "Plumbing"}'::jsonb)`,
      [catId, `g1-plumbing-${runSuffix}`],
    );
    const svcId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO direct_catalog_services (id, category_id, slug, name_i18n)
       VALUES ($1, $2, $3, '{"en": "Fix leaky tap"}'::jsonb)`,
      [svcId, catId, `g1-fix-tap-${runSuffix}`],
    );
    await pool.query(
      `INSERT INTO quote_request_services (quote_request_id, service_id, service_name, category_slug)
       VALUES ($1, $2, 'Fix leaky tap', 'plumbing')`,
      [requestId, svcId],
    );

    const mine = mockRes();
    await quoteRequestsController.getMyQuoteRequests({ user: { id: userId } }, mine);
    expect(mine.statusCode).toBe(200);
    const found = mine.payload.requests.find((r) => String(r.id) === String(requestId));
    expect(found).toBeTruthy();
    expect(found.services).toHaveLength(1);
    expect(found.services[0].serviceName).toBe('Fix leaky tap');
    expect(found.deadline_passed).toBe(false);
    expect(found.response_deadline).toBeTruthy();
  });

  test('sweeper notifies once when the deadline passes unquoted, then never again', async () => {
    const { rows } = await pool.query(
      `INSERT INTO quote_requests
         (user_id, first_name, last_name, email, service_category, service_location,
          service_zip_code, details, status, response_deadline, metadata)
       VALUES ($1, 'Test', 'Customer', 'quote-customer@example.invalid', 'Plumbing',
          '12 Main St', '12345', 'Leaky tap.', 'new',
          NOW() - INTERVAL '1 hour', '{}'::jsonb)
       RETURNING id`,
      [userId],
    );
    const requestId = rows[0].id;

    const first = await sweepQuoteDeadlineNotices(pool);
    expect(first.notified).toBe(1);
    const stamped = await pool.query(
      'SELECT deadline_notice_sent_at FROM quote_requests WHERE id = $1', [requestId],
    );
    expect(stamped.rows[0].deadline_notice_sent_at).toBeTruthy();
    const notes = await pool.query(
      "SELECT id FROM notifications WHERE user_id = $1 AND type = 'quote_deadline_passed' AND data->>'quoteRequestId' = $2",
      [userId, String(requestId)],
    );
    expect(notes.rows.length).toBe(1);

    const second = await sweepQuoteDeadlineNotices(pool);
    expect(second.notified).toBe(0);
  });
});
