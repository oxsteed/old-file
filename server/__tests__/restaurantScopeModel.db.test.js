'use strict';

/**
 * Regression tests: restaurant access checks migrated to the canonical
 * scope-model gate (Analytics platform, Phase 1, Item 6).
 *
 * The ~17 local `requireRestaurantAccess` copies (plus 2 `isRestaurantOwner`
 * variants) across the restaurant controllers were replaced by
 * server/services/scopeModel.js `resolveRestaurantAccess` /
 * `isRestaurantOwner`. These tests prove authorization behavior is
 * UNCHANGED: for each historical variant family and a role matrix covering
 * all 7 platform user_role values (customer, helper, helper_pro, broker,
 * admin, super_admin, employee), the legacy implementation (copied verbatim
 * from the pre-migration tree at bf4cb933 — see "Historical reference"
 * below) and the new code path must produce identical outcomes:
 * allow with the same effective role and the same column values on every
 * column the legacy variant selected, or deny with the same
 * status/code/message.
 *
 * Run with e.g.
 *   RESTAURANT_SCOPE_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     npx jest __tests__/restaurantScopeModel.db.test.js
 * (STATEMENT_TEST_DATABASE_URL is also honored.) Without it, the DB
 * describes skip (fail closed) instead of touching a DB.
 */
jest.unmock('pg');

const crypto = require('crypto');

const { disposableDatabaseOptIn, isDisposableDatabase, assertMigratedSchema } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('RESTAURANT_SCOPE_TEST_DATABASE_URL');

const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = 'restaurant-scope-test-secret';
}

const pool = require('../db');
const AppError = require('../utils/appError');
const {
  resolveScope,
  resolveBusinessAccess,
  resolveRestaurantAccess,
  isRestaurantOwner,
} = require('../services/scopeModel');

/* ── Historical reference implementations ─────────────────────────────
 * Copied verbatim from the pre-migration tree (branch
 * feat/analytics-platform @ bf4cb933, before the scope-model migration).
 * Each is labeled with its source file. They are the "before" side of the
 * parity check; the "after" side is the scope model (plus the tiny
 * call-site wrappers, replicated here as current* helpers).
 */

// foodController.js — full row + membership id, sets access_user_id, no
// fast-fail guard.
async function legacyFull(userId, restaurantId) {
  const { rows } = await pool.query(
    `SELECT fr.*, b.user_id AS business_owner_id,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role,
            (SELECT bm.id
               FROM business_members bm
              WHERE bm.business_id = fr.business_id
                AND bm.member_id = $2
                AND bm.status = 'active'
              LIMIT 1) AS effective_membership_id
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [restaurantId, userId]
  );
  const restaurant = rows[0];
  if (!restaurant || !restaurant.effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  restaurant.access_user_id = userId;
  return restaurant;
}

// The 9-file narrow family (restaurantCrew/Help/Kiosk/Ops/Payout/Pos/
// Runner/Training/Audits controllers) — id + business_id + effective_role,
// with the fast-fail guard.
async function legacyNarrow(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [restaurantId, userId]
  );
  const restaurant = rows[0];
  if (!restaurant || !restaurant.effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  return restaurant;
}

// foodWalletController.js / foodCreditDisputeController.js — narrow display
// columns + effective_role, no fast-fail guard.
async function legacyWallet(userId, restaurantId) {
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id, fr.owner_user_id, fr.display_name, fr.currency_code,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1
      LIMIT 1`,
    [restaurantId, userId]
  );
  if (!rows[0] || !rows[0].effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  return rows[0];
}

// restaurantInventoryController.js — narrow + membership_id alias, guard.
async function legacyInventory(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role FROM business_members bm
                 WHERE bm.business_id = fr.business_id AND bm.member_id = $2 AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role,
            (
              SELECT bm.id FROM business_members bm
               WHERE bm.business_id = fr.business_id AND bm.member_id = $2 AND bm.status = 'active'
               LIMIT 1
            ) AS membership_id
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [restaurantId, userId]
  );
  const restaurant = rows[0];
  if (!restaurant || !restaurant.effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  return restaurant;
}

// restaurantSupportController.js — narrow + display/owner/currency/country,
// guard.
async function legacySupport(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id, fr.display_name, fr.owner_user_id, fr.currency_code, fr.address_country,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [restaurantId, userId]
  );
  const restaurant = rows[0];
  if (!restaurant || !restaurant.effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  return restaurant;
}

const LEGACY_MANAGE_ROLES = new Set(['owner', 'manager']);

// restaurantReportsController.js — narrow + guard + manager-only 403.
async function legacyReports(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [restaurantId, userId]
  );
  const restaurant = rows[0];
  if (!restaurant || !restaurant.effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  if (!LEGACY_MANAGE_ROLES.has(restaurant.effective_role)) {
    throw new AppError('You do not have permission to view reports', 403, 'forbidden');
  }
  return restaurant;
}

// restaurantCreditFundingController.js — operator_role alias, no guard.
async function legacyFunding(userId, restaurantId) {
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id, fr.owner_user_id, fr.display_name, fr.currency_code,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS operator_role
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1
      LIMIT 1`,
    [restaurantId, userId]
  );
  if (!rows[0] || !rows[0].operator_role) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  return rows[0];
}

// restaurantMediaVideoController.js — boolean owner check, no guard.
async function legacyIsOwnerMedia(userId, restaurantId) {
  const { rows } = await pool.query(
    `SELECT 1
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1 AND (fr.owner_user_id = $2 OR b.user_id = $2)`,
    [restaurantId, userId]
  );
  return rows.length > 0;
}

// restaurantTopupController.js — boolean owner check with !userId guard.
async function legacyIsOwnerTopup(userId, restaurantId) {
  if (!userId) return false;
  const { rows } = await pool.query(
    `SELECT 1
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1 AND (b.user_id = $2 OR fr.owner_user_id = $2)
      LIMIT 1`,
    [restaurantId, userId]
  );
  return !!rows[0];
}

/* ── "After" paths: the migrated call shapes ─────────────────────────── */
// Replicas of the 4-line call-site wrappers (guard preserved at the call
// site, exactly as in the migrated controllers).
async function currentGuarded(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  return resolveRestaurantAccess(userId, restaurantId);
}
const currentDirect = (userId, restaurantId) => resolveRestaurantAccess(userId, restaurantId);
async function currentReports(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await resolveRestaurantAccess(userId, restaurantId);
  if (!LEGACY_MANAGE_ROLES.has(restaurant.effective_role)) {
    throw new AppError('You do not have permission to view reports', 403, 'forbidden');
  }
  return restaurant;
}

// Normalize an allow/deny outcome for comparison.
async function capture(fn, userId, restaurantId) {
  try {
    const row = await fn(userId, restaurantId);
    return { ok: true, row };
  } catch (err) {
    return {
      ok: false,
      status: err.status ?? err.statusCode ?? null,
      code: err.code ?? null,
      message: err.message ?? String(err),
    };
  }
}

function expectSameOutcome(legacyOutcome, currentOutcome, label) {
  expect({ label, ok: currentOutcome.ok }).toEqual({ label, ok: legacyOutcome.ok });
  if (!legacyOutcome.ok) {
    // Deny: identical status/code/message.
    expect({
      status: currentOutcome.status,
      code: currentOutcome.code,
      message: currentOutcome.message,
    }).toEqual({
      status: legacyOutcome.status,
      code: legacyOutcome.code,
      message: legacyOutcome.message,
    });
    return;
  }
  // Allow: identical role, and every column the legacy variant selected
  // must be present with an identical value in the new row.
  const legacyRole = legacyOutcome.row.effective_role ?? legacyOutcome.row.operator_role;
  const currentRole = currentOutcome.row.effective_role ?? currentOutcome.row.operator_role;
  expect({ label, role: currentRole }).toEqual({ label, role: legacyRole });
  for (const key of Object.keys(legacyOutcome.row)) {
    expect({ label, key, value: currentOutcome.row[key] })
      .toEqual({ label, key, value: legacyOutcome.row[key] });
  }
}

/* ── Fixtures ─────────────────────────────────────────────────────────── */
const F = {};

async function newUser(role) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Scope', 'Fixture', $3, TRUE, TRUE)`,
    [id, `scope-${id}@example.invalid`, role]);
  return id;
}

async function newBusiness(ownerId, name) {
  const { rows: [b] } = await pool.query(
    'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
    [ownerId, name]);
  return b.id;
}

async function addMember(businessId, ownerId, memberId, role, status = 'active') {
  await pool.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [businessId, ownerId, memberId, `scope-${memberId}@example.invalid`, role, status]);
}

async function newRestaurant(businessId, ownerUserId, name) {
  const { rows: [r] } = await pool.query(
    'INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, $3) RETURNING id',
    [businessId, ownerUserId, name]);
  return r.id;
}

ddescribe('restaurant access parity: legacy copies vs scopeModel', () => {
  beforeAll(async () => {
    await assertMigratedSchema(pool);

    // One user per platform user_role value.
    F.uBizOwner = await newUser('customer');      // owns B1
    F.uRestOwner = await newUser('helper');       // fr.owner_user_id on R2
    F.uManager = await newUser('helper_pro');     // active manager on B1
    F.uRep = await newUser('broker');             // active representative on B1
    F.uEmployee = await newUser('employee');      // active employee on B1
    F.uInactive = await newUser('customer');      // INACTIVE manager on B1
    F.uAdmin = await newUser('admin');            // owns B2, no standing on B1
    F.uSuper = await newUser('super_admin');      // no standing anywhere

    F.b1 = await newBusiness(F.uBizOwner, 'Scope B1');
    F.b2 = await newBusiness(F.uAdmin, 'Scope B2');
    // One restaurant per business (UNIQUE on food_restaurants.business_id),
    // so the fr.owner_user_id path needs its own business.
    F.b3 = await newBusiness(F.uBizOwner, 'Scope B3');

    for (const biz of [F.b1, F.b3]) {
      await addMember(biz, F.uBizOwner, F.uManager, 'manager', 'active');
      await addMember(biz, F.uBizOwner, F.uRep, 'representative', 'active');
      await addMember(biz, F.uBizOwner, F.uEmployee, 'employee', 'active');
      // 'revoked' is the schema's non-active status (status CHECK allows only
      // pending/active/revoked); the access queries only honor 'active'.
      await addMember(biz, F.uBizOwner, F.uInactive, 'manager', 'revoked');
    }

    F.r1 = await newRestaurant(F.b1, F.uBizOwner, 'Scope R1');
    F.r2 = await newRestaurant(F.b3, F.uRestOwner, 'Scope R2');
    F.r3 = await newRestaurant(F.b2, F.uAdmin, 'Scope R3');
    F.missing = 999999999;
  });

  afterAll(async () => {
    // NOTE: plain DELETE FROM businesses hits a pre-existing quirk of the
    // disposable test DB: the RI check query for the
    // food_customer_wallet_operator_audit_events_business_id_fkey raises
    // "gave unexpected result" even with zero referencing rows (reproduced
    // on a pristine insert/delete; no DDL in this change). Cleanup therefore
    // runs with row triggers bypassed inside one transaction — fixture rows
    // only, schema untouched. (mediaDiscovery.db.test.js works around the
    // same quirk with .catch(() => {}).)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      await client.query('DELETE FROM food_restaurants WHERE id = ANY($1)', [[F.r1, F.r2, F.r3]]);
      await client.query('DELETE FROM business_members WHERE business_id = ANY($1)', [[F.b1, F.b2, F.b3]]);
      await client.query('DELETE FROM businesses WHERE id = ANY($1)', [[F.b1, F.b2, F.b3]]);
      await client.query(
        'DELETE FROM users WHERE id = ANY($1)',
        [[F.uBizOwner, F.uRestOwner, F.uManager, F.uRep, F.uEmployee, F.uInactive, F.uAdmin, F.uSuper]]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // [userKey, restaurantKey, label]
  const accessCases = [
    ['uBizOwner', 'r1', 'business owner via businesses.user_id'],
    ['uRestOwner', 'r2', 'owner via food_restaurants.owner_user_id'],
    ['uRestOwner', 'r1', 'restaurant owner of a different restaurant denied'],
    ['uManager', 'r1', 'active manager member'],
    ['uManager', 'r2', 'active manager member (second business)'],
    ['uRep', 'r1', 'active representative member'],
    ['uEmployee', 'r2', 'active employee member'],
    ['uInactive', 'r1', 'revoked member denied'],
    ['uAdmin', 'r1', 'platform admin with no standing denied'],
    ['uSuper', 'r1', 'platform super_admin with no standing denied'],
    ['uBizOwner', 'r3', 'owner of another business denied'],
    ['uBizOwner', 'missing', 'nonexistent restaurant denied'],
  ];

  const variants = [
    ['foodController (full row)', legacyFull, currentDirect, 'nonguard'],
    ['narrow family x9 (guard)', legacyNarrow, currentGuarded, 'guard'],
    ['foodWallet/foodCreditDispute (narrow)', legacyWallet, currentDirect, 'nonguard'],
    ['restaurantInventory (membership_id)', legacyInventory, currentGuarded, 'guard'],
    ['restaurantSupport (display columns)', legacySupport, currentGuarded, 'guard'],
    ['restaurantReports (manager-only 403)', legacyReports, currentReports, 'guard'],
    ['restaurantCreditFunding (operator_role)', legacyFunding, currentDirect, 'nonguard'],
  ];

  for (const [name, legacy, current, guardKind] of variants) {
    test(`${name}: identical allow/deny across the role matrix`, async () => {
      for (const [userKey, restKey, label] of accessCases) {
        const before = await capture(legacy, F[userKey], F[restKey]);
        const after = await capture(current, F[userKey], F[restKey]);
        expectSameOutcome(before, after, `${name} / ${label}`);
      }
    });

    test(`${name}: falsy restaurant id behaves identically`, async () => {
      const before = await capture(legacy, F.uBizOwner, undefined);
      const after = await capture(current, F.uBizOwner, undefined);
      expectSameOutcome(before, after, `${name} / falsy id`);
      if (guardKind === 'guard') {
        // Guarded variants 404 without touching the DB.
        expect(before.ok).toBe(false);
        expect(before.status).toBe(404);
      } else {
        // Unguarded variants let the driver reject; both paths reject
        // identically (same bind params into pg).
        expect(before.ok).toBe(false);
        expect(after.message).toBe(before.message);
      }
    });
  }

  test('representative is denied by the reports 403 on both paths', async () => {
    const before = await capture(legacyReports, F.uRep, F.r1);
    const after = await capture(currentReports, F.uRep, F.r1);
    expect(before.ok).toBe(false);
    expect(before.status).toBe(403);
    expect(before.message).toBe('You do not have permission to view reports');
    expectSameOutcome(before, after, 'reports 403');
  });

  test('manager passes the reports gate on both paths', async () => {
    const before = await capture(legacyReports, F.uManager, F.r1);
    const after = await capture(currentReports, F.uManager, F.r1);
    expect(before.ok).toBe(true);
    expectSameOutcome(before, after, 'reports allow');
  });

  describe('isRestaurantOwner parity', () => {
    const ownerCases = [
      ['uBizOwner', 'r1', true, 'business owner'],
      ['uRestOwner', 'r2', true, 'restaurant owner_user_id'],
      ['uRestOwner', 'r1', false, 'restaurant owner of another restaurant'],
      ['uManager', 'r1', false, 'member is not owner'],
      ['uAdmin', 'r3', true, 'business owner of other business'],
      ['uAdmin', 'r1', false, 'admin without standing'],
      ['uSuper', 'r1', false, 'super_admin without standing'],
      ['uBizOwner', 'missing', false, 'missing restaurant'],
    ];
    test('media variant (no guard) matches for defined user ids', async () => {
      for (const [userKey, restKey, expected, label] of ownerCases) {
        const before = await legacyIsOwnerMedia(F[userKey], F[restKey]);
        const after = await isRestaurantOwner(F[userKey], F[restKey]);
        expect(after).toBe(expected);
        expect(before).toBe(expected);
      }
    });
    test('topup variant (guard) matches, including falsy user id', async () => {
      for (const [userKey, restKey, expected, label] of ownerCases) {
        const before = await legacyIsOwnerTopup(F[userKey], F[restKey]);
        const after = await isRestaurantOwner(F[userKey], F[restKey]);
        expect(after).toBe(expected);
        expect(before).toBe(expected);
      }
      // The shared primitive keeps the topup variant's `!userId -> false`
      // guard. The media variant had no guard (pg 500 on undefined); its
      // only caller passes an authenticated id, so this is a safe
      // fail-closed improvement, asserted here explicitly.
      expect(await legacyIsOwnerTopup(undefined, F.r1)).toBe(false);
      expect(await isRestaurantOwner(undefined, F.r1)).toBe(false);
    });
  });

  describe('resolveBusinessAccess mirrors requireBusinessAccess row semantics', () => {
    test('owner resolves with role owner and null membership', async () => {
      const row = await resolveBusinessAccess(F.uBizOwner, F.b1);
      expect(row.effective_role).toBe('owner');
      expect(row.membership_id).toBeNull();
      expect(row.owner_id).toBe(F.uBizOwner);
    });
    test('active member resolves with their role and membership id', async () => {
      const row = await resolveBusinessAccess(F.uManager, F.b1);
      expect(row.effective_role).toBe('manager');
      expect(row.membership_id).not.toBeNull();
    });
    test('no standing, missing business, and soft-deleted business resolve to null', async () => {
      await expect(resolveBusinessAccess(F.uAdmin, F.b1)).resolves.toBeNull();
      await expect(resolveBusinessAccess(F.uBizOwner, 999999999)).resolves.toBeNull();
      const { rows: [del] } = await pool.query(
        'INSERT INTO businesses (user_id, business_name, deleted_at) VALUES ($1, $2, NOW()) RETURNING id',
        [F.uBizOwner, 'Scope deleted']);
      const client = await pool.connect();
      try {
        await expect(resolveBusinessAccess(F.uBizOwner, del.id)).resolves.toBeNull();
      } finally {
        // Same disposable-DB RI quirk as afterAll: bypass row triggers.
        await client.query('BEGIN');
        await client.query("SET LOCAL session_replication_role = 'replica'");
        await client.query('DELETE FROM businesses WHERE id = $1', [del.id]);
        await client.query('COMMIT');
        client.release();
      }
    });
  });

  describe('resolveScope', () => {
    test('owner sees owned businesses and restaurants with owner role', async () => {
      const scope = await resolveScope({ id: F.uBizOwner, role: 'customer' });
      expect(scope.global).toBe(false);
      expect(scope.businessIds).toEqual(expect.arrayContaining([Number(F.b1), Number(F.b3)]));
      expect(scope.businesses.find((b) => b.id === Number(F.b1)).role).toBe('owner');
      expect(scope.restaurantIds).toEqual(expect.arrayContaining([Number(F.r1), Number(F.r2)]));
      expect(scope.restaurants.find((r) => r.id === Number(F.r1)).role).toBe('owner');
      // fr.owner_user_id path still resolves to owner
      expect(scope.restaurants.find((r) => r.id === Number(F.r2)).role).toBe('owner');
    });
    test('member sees the businesses and their restaurants with member role', async () => {
      const scope = await resolveScope({ id: F.uManager, role: 'helper_pro' });
      expect(scope.businessIds).toEqual(expect.arrayContaining([Number(F.b1), Number(F.b3)]));
      expect(scope.businesses.every((b) => b.role === 'manager')).toBe(true);
      expect(scope.restaurantIds).toEqual(expect.arrayContaining([Number(F.r1), Number(F.r2)]));
      expect(scope.restaurants.every((r) => r.role === 'manager')).toBe(true);
    });
    test('inactive member sees nothing', async () => {
      const scope = await resolveScope({ id: F.uInactive, role: 'customer' });
      expect(scope.businessIds).toEqual([]);
      expect(scope.restaurantIds).toEqual([]);
    });
    test('admin without ownership gets global scope but no restaurant ids', async () => {
      const scope = await resolveScope({ id: F.uSuper, role: 'super_admin' });
      expect(scope.global).toBe(true);
      expect(scope.isSuperAdmin).toBe(true);
      expect(scope.restaurantIds).toEqual([]);
      expect(scope.regionRestricted).toBe(false);
    });
    test('admin who owns a business sees it (ownership still applies)', async () => {
      const scope = await resolveScope({ id: F.uAdmin, role: 'admin' });
      expect(scope.global).toBe(true);
      expect(scope.isAdmin).toBe(true);
      expect(scope.businessIds).toContain(Number(F.b2));
      expect(scope.restaurantIds).toContain(Number(F.r3));
    });
    test('anonymous caller gets an empty scope without throwing', async () => {
      const scope = await resolveScope({ id: null, role: null });
      expect(scope.businessIds).toEqual([]);
      expect(scope.restaurantIds).toEqual([]);
      expect(scope.global).toBe(false);
    });
  });
});
