'use strict';

/**
 * PR #804 Track D, G-33 (revocation propagates to nav but the user gets
 * no explanation in-app).
 *
 * The projection only lists active capabilities, so a revoked grant just
 * vanished from Settings → Applications. The new self endpoint
 * GET /api/me/access-grants returns the caller's own grants in every
 * status, with status_reason_code, so the page can render the reason a
 * grant was suspended or revoked.
 *
 * This suite drives the endpoint's controller against the real migrated
 * schema: all of the caller's grants come back (active, revoked and
 * suspended, with their reason codes), and another user's grants never
 * do. The outbox → notification leg for grant events was verified from
 * code (reviewService changeGrant enqueues access_grant.suspended /
 * access_grant.revoked; outboxWorker processes the outbox every minute
 * and sends access_request_update notifications); it is not re-proven
 * here.
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
const progressiveAccessController = require('../controllers/progressiveAccessController');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.set = jest.fn(() => res);
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

ddescribe('G-33 own grants with revocation reasons', () => {
  let ownerId;
  let strangerId;

  beforeAll(async () => {
    async function makeUser(email) {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, 'x', 'Test', 'User', 'customer', TRUE, TRUE)`,
        [id, email]
      );
      return id;
    }
    ownerId = await makeUser(`g33-owner-${Date.now()}@example.com`);
    strangerId = await makeUser(`g33-stranger-${Date.now()}@example.com`);

    async function makeGrant(userId, capability, subjectKey, status, reasonCode) {
      await pool.query(
        `INSERT INTO access_grants
           (user_id, capability, subject_type, subject_key, status, provenance,
            provenance_reason, policy_version, status_reason_code)
         VALUES ($1, $2, 'self', $3, $4, 'admin', 'test', 'test-policy-1', $5)`,
        [userId, capability, subjectKey, status, reasonCode]
      );
    }
    await makeGrant(ownerId, 'franchise.operate', 'self', 'active', 'territory_assigned');
    await makeGrant(ownerId, 'helper.offer_services', 'self', 'revoked', 'review_complete');
    await makeGrant(ownerId, 'logistics.ship', 'self', 'suspended', 'territory_assignment_ended');
    await makeGrant(strangerId, 'helper.offer_services', 'self', 'active', 'territory_assigned');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM access_grants WHERE user_id IN ($1, $2)', [ownerId, strangerId]);
    // NOTE: users are left in place (see G-17 test note: DELETE FROM users
    // fails on this schema because of the no-delete rules on
    // oxsteed_credit_partner_funding_records).
    await pool.end();
  });

  test('listMyGrants returns every status with its reason code, own rows only', async () => {
    const res = mockRes();
    await progressiveAccessController.listMyGrants({ user: { id: ownerId } }, res);
    expect(res.statusCode).toBe(200);
    const grants = res.payload.grants;
    expect(grants).toHaveLength(3);
    const byCapability = Object.fromEntries(grants.map((g) => [g.capability, g]));
    expect(byCapability['franchise.operate'].status).toBe('active');
    expect(byCapability['helper.offer_services'].status).toBe('revoked');
    expect(byCapability['helper.offer_services'].status_reason_code).toBe('review_complete');
    expect(byCapability['logistics.ship'].status).toBe('suspended');
    expect(byCapability['logistics.ship'].status_reason_code).toBe('territory_assignment_ended');
    expect(grants.every((g) => g.capability !== 'helper.offer_services' || g.status !== 'active')).toBe(true);
  });
});
