'use strict';

/**
 * Behavior tests for the admin grant-lookup query behind requirePermission /
 * hasGlobalGrant. The UNION query must be valid PostgreSQL: an ORDER BY
 * expression over a UNION was rejected by Postgres (0A000), which turned
 * every non-super-admin permission check into a 500. These tests run the
 * real query against the disposable credit_statement_test database only.
 *
 * Run with e.g.
 *   ADMIN_GRANT_TEST_DATABASE_URL=postgresql://pgtest@127.0.0.1:54331/credit_statement_test?sslmode=disable
 *     npx jest __tests__/adminGrantLookup.test.js
 * Without it, the DB describes skip (fail closed) instead of touching a DB.
 */
jest.unmock('pg');

const crypto = require('crypto');

const { disposableDatabaseOptIn, isDisposableDatabase, assertMigratedSchema } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('ADMIN_GRANT_TEST_DATABASE_URL');


const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = 'test-secret-for-grant-lookup';
}

const pool = require('../db');
const { hasGlobalGrant } = require('../middleware/adminAuth');

async function newUser(role = 'admin') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Grant', 'Fixture', $3, TRUE, TRUE)`,
    [id, `grant-${id}@example.invalid`, role]);
  return id;
}

async function newRegion(createdBy) {
  const { rows: [region] } = await pool.query(
    `INSERT INTO admin_regions (name, boundary_definition, created_by)
     VALUES ($1, '{"type":"city_state","entries":[]}', $2) RETURNING id`,
    [`statement-grant-${crypto.randomUUID()}`, createdBy]);
  return region.id;
}

ddescribe('admin grant lookup (UNION query)', () => {
  beforeAll(async () => { await assertMigratedSchema(pool); });

  beforeEach(async () => {
    await pool.query('TRUNCATE delegation_grants, admin_permission_grants RESTART IDENTITY CASCADE');
  });

  test('direct global grant authorizes without a query error', async () => {
    const admin = await newUser('admin');
    const grantor = await newUser('super_admin');
    await pool.query(
      `INSERT INTO admin_permission_grants (grantor_id, grantee_id, permissions, region_id, expires_at)
       VALUES ($1, $2, '["view_financials"]', NULL, NOW() + INTERVAL '1 day')`,
      [grantor, admin]);
    // Before the fix this threw 0A000 "invalid UNION/INTERSECT/EXCEPT ORDER
    // BY clause", surfacing as HTTP 500 for every non-super-admin.
    await expect(hasGlobalGrant(admin, 'view_financials')).resolves.toBe(true);
  });

  test('regional-only direct grant does not satisfy a global check', async () => {
    const admin = await newUser('admin');
    const grantor = await newUser('super_admin');
    const regionId = await newRegion(grantor);
    await pool.query(
      `INSERT INTO admin_permission_grants (grantor_id, grantee_id, permissions, region_id, expires_at)
       VALUES ($1, $2, '["view_financials"]', $3, NOW() + INTERVAL '1 day')`,
      [grantor, admin, regionId]);
    await expect(hasGlobalGrant(admin, 'view_financials')).resolves.toBe(false);
  });

  test('global grant is preferred over a regional one', async () => {
    const admin = await newUser('admin');
    const grantor = await newUser('super_admin');
    const regionId = await newRegion(grantor);
    await pool.query(
      `INSERT INTO admin_permission_grants (grantor_id, grantee_id, permissions, region_id, expires_at)
       VALUES ($1, $2, '["view_financials"]', $3, NOW() + INTERVAL '1 day'),
              ($1, $2, '["view_financials"]', NULL, NOW() + INTERVAL '1 day')`,
      [grantor, admin, regionId]);
    await expect(hasGlobalGrant(admin, 'view_financials')).resolves.toBe(true);
  });

  test('delegated grant through a super-admin grantor authorizes', async () => {
    const admin = await newUser('admin');
    const superAdmin = await newUser('super_admin');
    await pool.query(
      `INSERT INTO delegation_grants (grantor_admin_id, grantee_admin_id, scopes, status, expires_at)
       VALUES ($1, $2, ARRAY['manage_operations'], 'active', NOW() + INTERVAL '1 day')`,
      [superAdmin, admin]);
    await expect(hasGlobalGrant(admin, 'manage_operations')).resolves.toBe(true);
  });

  test('expired grant does not authorize', async () => {
    const admin = await newUser('admin');
    const grantor = await newUser('super_admin');
    await pool.query(
      `INSERT INTO admin_permission_grants (grantor_id, grantee_id, permissions, region_id, expires_at)
       VALUES ($1, $2, '["view_financials"]', NULL, NOW() - INTERVAL '1 day')`,
      [grantor, admin]);
    await expect(hasGlobalGrant(admin, 'view_financials')).resolves.toBe(false);
  });

  test('unknown permission does not authorize', async () => {
    const admin = await newUser('admin');
    await expect(hasGlobalGrant(admin, 'no_such_permission')).resolves.toBe(false);
  });
});
