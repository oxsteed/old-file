'use strict';

/**
 * WP-004 / WP-005 / WP-013 (compat): legacy mode writes never raise authority
 * while progressive access is on. Real database, real controllers.
 * Skips unless ACCESS_TEST_DATABASE_URL is a loopback disposable database.
 */

jest.unmock('pg');

const crypto = require('crypto');

const RAW_URL = process.env.ACCESS_TEST_DATABASE_URL || '';
function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/(credit_statement_test|pa_t\d+)$/.test(url.pathname);
  } catch { return false; }
}
const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;
if (CAN_RUN_DB) process.env.DATABASE_URL = RAW_URL;

jest.setTimeout(60000);

function fakeRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.setHeader = res.set;
  res.cookie = () => res;
  res.clearCookie = () => res;
  res.getHeader = (k) => res.headers[k];
  return res;
}

ddescribe('legacy mode writes under progressive access (real database)', () => {
  let pool;
  let ctrl;

  beforeAll(() => {
    pool = require('../db');
    // The shared setup mock predates revokeAccessTokenId (used once sessions exist).
    require('../services/tokenRevocationService').revokeAccessTokenId = jest.fn().mockResolvedValue(undefined);
    ctrl = require('../controllers/authController');
  });
  afterEach(() => { delete process.env.ACCESS_CUSTOMER_FIRST_SIGNUP; delete process.env.ACCESS_LEGACY_SWITCH_RETIRED; });
  afterAll(async () => { if (pool) await pool.end(); });

  async function makeUser(role = 'customer', mode = 'customer') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Mode', 'Fixture', $3, $4, TRUE, TRUE)`,
      [id, `pa-mode-${id}@example.invalid`, role, mode],
    );
    const { rows: [u] } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return u;
  }
  const req = (user, body) => ({ user, body, headers: {}, ip: '127.0.0.1', socket: {}, get: () => undefined, cookies: {} });
  const roleOf = async (id) => (await pool.query('SELECT role::text, default_mode, preferred_language FROM users WHERE id = $1', [id])).rows[0];

  test('profile PATCH with a language change and a privileged mode saves only the profile (WP-005)', async () => {
    process.env.ACCESS_CUSTOMER_FIRST_SIGNUP = 'true';
    const u = await makeUser();
    const res = fakeRes();
    await ctrl.updateProfile(req(u, { preferred_language: 'es', default_mode: 'helper' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.mode_switched).toBe(false);
    expect(res.body.mode_change_ignored).toEqual({ code: 'access_required', capability: 'helper.offer_services' });
    expect(await roleOf(u.id)).toEqual({ role: 'customer', default_mode: 'customer', preferred_language: 'es' });
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM access_grants WHERE user_id = $1', [u.id])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM helper_profiles WHERE user_id = $1', [u.id])).rows[0].n).toBe(0);
  });

  test('switch-role to a helper view without a grant is denied with access_required (WP-013 compat)', async () => {
    process.env.ACCESS_LEGACY_SWITCH_RETIRED = 'true';
    const u = await makeUser();
    const res = fakeRes();
    await ctrl.switchRole(req(u, { mode: 'business_owner' }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'access_required', capability: 'business.own' });
    expect((await roleOf(u.id)).role).toBe('customer');
  });

  test('a customer-class view is still switchable, and a held grant unlocks its view', async () => {
    process.env.ACCESS_LEGACY_SWITCH_RETIRED = 'true';
    const u = await makeUser();
    const r1 = fakeRes();
    await ctrl.switchRole(req(u, { mode: 'restaurant_customer' }), r1);
    expect(r1.statusCode).toBe(200);
    await pool.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES ($1, 'helper.offer_services', 'self', 'self', 'active', 'admin', 'helper-policy-1')`,
      [u.id],
    );
    const fresh = (await pool.query('SELECT * FROM users WHERE id = $1', [u.id])).rows[0];
    const r2 = fakeRes();
    await ctrl.switchRole(req(fresh, { mode: 'helper' }), r2);
    expect(r2.statusCode).toBe(200);
    expect((await roleOf(u.id)).role).toBe('helper');
  });

  test('an existing helper keeps switching between views (no access lost)', async () => {
    process.env.ACCESS_LEGACY_SWITCH_RETIRED = 'true';
    const u = await makeUser('helper', 'helper');
    const res = fakeRes();
    await ctrl.switchRole(req(u, { mode: 'business_owner' }), res);
    expect(res.statusCode).toBe(200);
  });

  test('flags off: legacy switch behaviour unchanged', async () => {
    const u = await makeUser();
    const res = fakeRes();
    await ctrl.switchRole(req(u, { mode: 'helper' }), res);
    expect(res.statusCode).toBe(200);
    expect((await roleOf(u.id)).role).toBe('helper');
  });
});
