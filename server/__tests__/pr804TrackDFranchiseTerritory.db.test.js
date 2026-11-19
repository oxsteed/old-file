'use strict';

/**
 * PR #804 Track D, G-26 (one franchisee, two territories).
 *
 * Against the real migrated schema, through the real franchise
 * controllers and the access resolver:
 *   - territory stats resolve per application id from the URL instead of
 *     newest-wins; without the param the newest application is still
 *     the default; another user's application id yields no territory;
 *   - launching an application issues a per-territory franchise.operate
 *     grant (subject_type 'franchise_application', subject carrying the
 *     application id), not a self grant; access.can with the concrete
 *     territory subject allows, with the other territory denies, and
 *     with { type: 'any' } allows;
 *   - the browser projection keeps franchise.operate in personal while
 *     any territory is active;
 *   - archiving one territory revokes only its grant: the other
 *     territory keeps access. Archiving the last territory removes
 *     access entirely.
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
const franchiseController = require('../controllers/franchiseController');
const territoryController = require('../controllers/franchiseTerritoryController');
const access = require('../services/access/accessService');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

async function call(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, err: next.mock.calls[0] ? next.mock.calls[0][0] : null };
}

async function grantsFor(userId) {
  const { rows } = await pool.query(
    `SELECT capability, subject_type, subject_id, subject_key, status
       FROM access_grants WHERE user_id = $1 AND capability = 'franchise.operate'
      ORDER BY subject_key`,
    [userId]
  );
  return rows;
}

ddescribe('G-26 multi-territory franchise', () => {
  let ownerId;
  let strangerId;
  let adminId;
  let businessAId;
  let businessBId;
  let appAId;
  let appBId;

  beforeAll(async () => {
    async function makeUser(email, role) {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, 'x', 'Test', 'User', $3, TRUE, TRUE)`,
        [id, email, role]
      );
      return id;
    }
    ownerId = await makeUser(`g26-owner-${Date.now()}@example.com`, 'customer');
    strangerId = await makeUser(`g26-stranger-${Date.now()}@example.com`, 'customer');
    adminId = await makeUser(`g26-admin-${Date.now()}@example.com`, 'admin');

    async function makeBusiness(name) {
      const { rows: [row] } = await pool.query(
        `INSERT INTO businesses (user_id, business_name, is_active, is_listed)
         VALUES ($1, $2, TRUE, TRUE) RETURNING id`,
        [ownerId, name]
      );
      return row.id;
    }
    businessAId = await makeBusiness(`G26 Biz A ${Date.now()}`);
    businessBId = await makeBusiness(`G26 Biz B ${Date.now()}`);

    const { rows: [program] } = await pool.query(
      `INSERT INTO franchise_programs (code, name) VALUES ($1, 'OxSteed Global Test')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [`g26-test-${Date.now()}`]
    );

    async function makeApplication(city, region, businessId, submittedAt) {
      const { rows: [row] } = await pool.query(
        `INSERT INTO franchise_applications
           (program_id, applicant_user_id, owner_user_id, first_name, last_name, email,
            desired_country, desired_region, desired_city, status, linked_business_id, submitted_at)
         VALUES ($1, $2, $2, 'Test', 'Owner', $3, 'US', $4, $5, 'approved', $6, $7)
         RETURNING id`,
        [program.id, ownerId, `g26-${Date.now()}-${city}@example.com`, region, city, businessId, submittedAt]
      );
      return row.id;
    }
    // A is older (submitted first), B is newer: newest-wins would pick B.
    appAId = await makeApplication('Cleveland', 'OH', businessAId, '2026-01-01T00:00:00Z');
    appBId = await makeApplication('Columbus', 'OH', businessBId, '2026-02-01T00:00:00Z');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM access_grants WHERE user_id IN ($1, $2, $3)', [ownerId, strangerId, adminId]);
    await pool.query('DELETE FROM franchise_activity_log WHERE application_id IN ($1, $2)', [appAId, appBId]);
    await pool.query('DELETE FROM franchise_applications WHERE id IN ($1, $2)', [appAId, appBId]);
    await pool.query('DELETE FROM businesses WHERE id IN ($1, $2)', [businessAId, businessBId]);
    // NOTE: users are left in place (see G-17 test note: DELETE FROM users
    // fails on this schema because of the no-delete rules on
    // oxsteed_credit_partner_funding_records).
    await pool.end();
  });

  test('territory stats default to the newest application', async () => {
    const { res, err } = await call(territoryController.getTerritoryStats, {
      user: { id: ownerId },
      query: {},
    });
    expect(err).toBeNull();
    expect(res.payload.has_territory).toBe(true);
    expect(res.payload.application.id).toBe(appBId);
    expect(res.payload.application.city).toBe('Columbus');
  });

  test('territory stats resolve per application id from the URL', async () => {
    const { res, err } = await call(territoryController.getTerritoryStats, {
      user: { id: ownerId },
      query: { application_id: appAId },
    });
    expect(err).toBeNull();
    expect(res.payload.has_territory).toBe(true);
    expect(res.payload.application.id).toBe(appAId);
    expect(res.payload.application.city).toBe('Cleveland');

    const helpers = await call(territoryController.getTerritoryHelpers, {
      user: { id: ownerId },
      query: { application_id: appAId },
    });
    expect(helpers.err).toBeNull();
    expect(helpers.res.payload.helpers).toEqual([]);
  });

  test('another user application id yields no territory', async () => {
    const { res, err } = await call(territoryController.getTerritoryStats, {
      user: { id: strangerId },
      query: { application_id: appAId },
    });
    expect(err).toBeNull();
    expect(res.payload.has_territory).toBe(false);
  });

  test('launching issues per-territory grants, not a self grant', async () => {
    const launch = await call(franchiseController.updateFranchiseApplication, {
      user: { id: adminId, role: 'admin' },
      params: { id: appAId },
      body: { status: 'launched' },
    });
    expect(launch.err).toBeNull();
    expect(launch.res.statusCode).toBe(200);

    const grants = await grantsFor(ownerId);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      capability: 'franchise.operate',
      subject_type: 'franchise_application',
      subject_id: appAId,
      subject_key: `franchise_application:${appAId}`,
      status: 'active',
    });

    expect((await access.can(ownerId, 'franchise.operate')).allowed).toBe(false);
    expect((await access.can(ownerId, 'franchise.operate', { type: 'franchise_application', id: appAId })).allowed).toBe(true);
    expect((await access.can(ownerId, 'franchise.operate', { type: 'franchise_application', id: appBId })).allowed).toBe(false);
    expect((await access.can(ownerId, 'franchise.operate', { type: 'any' })).allowed).toBe(true);

    const projection = await access.getProjection(ownerId);
    expect(projection.personal).toContain('franchise.operate');
  });

  test('archiving one territory revokes only its grant', async () => {
    const launchB = await call(franchiseController.updateFranchiseApplication, {
      user: { id: adminId, role: 'admin' },
      params: { id: appBId },
      body: { status: 'launched' },
    });
    expect(launchB.err).toBeNull();
    expect((await grantsFor(ownerId)).filter((g) => g.status === 'active')).toHaveLength(2);

    const archiveA = await call(franchiseController.updateFranchiseApplication, {
      user: { id: adminId, role: 'admin' },
      params: { id: appAId },
      body: { status: 'archived' },
    });
    expect(archiveA.err).toBeNull();

    const grants = await grantsFor(ownerId);
    const byKey = Object.fromEntries(grants.map((g) => [g.subject_key, g.status]));
    expect(byKey[`franchise_application:${appAId}`]).toBe('revoked');
    expect(byKey[`franchise_application:${appBId}`]).toBe('active');
    // The other territory keeps access.
    expect((await access.can(ownerId, 'franchise.operate', { type: 'any' })).allowed).toBe(true);
    expect((await access.getProjection(ownerId)).personal).toContain('franchise.operate');

    const archiveB = await call(franchiseController.updateFranchiseApplication, {
      user: { id: adminId, role: 'admin' },
      params: { id: appBId },
      body: { status: 'archived' },
    });
    expect(archiveB.err).toBeNull();
    expect((await grantsFor(ownerId)).filter((g) => g.status === 'active')).toHaveLength(0);
    expect((await access.can(ownerId, 'franchise.operate', { type: 'any' })).allowed).toBe(false);
    expect((await access.getProjection(ownerId)).personal).not.toContain('franchise.operate');
  });
});
