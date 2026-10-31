'use strict';

// Real-database test for the dual-posting auto-provision carve-out.
//
// Migration 488 requires every oxsteed_credit_partners row to carry an
// active administrator creator. That is correct for admin-registered
// partners, but live dual-posting auto-provision (ensureRestaurantPartner)
// creates a `pending` row with no administrator in the path, so before the
// carve-out migration the auto-provision INSERT failed the trigger every
// time. The carve-out is narrow: partners table only, INSERT only,
// auto_provisioned marker only, pending status only, NULL creator only.
// This suite proves both halves against the real database: the exempt
// insert succeeds, and every non-exempt creator-less insert still fails.
//
// Explicit opt-in to the shared disposable synthetic database; never load .env.
jest.unmock('pg');
const databaseUrl = process.env.STATEMENT_TEST_DATABASE_URL;
const permitted = (() => {
  try {
    const u = new URL(databaseUrl);
    return ['postgres:', 'postgresql:'].includes(u.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
      && u.pathname === '/credit_statement_test';
  } catch { return false; }
})();
if (permitted) process.env.DATABASE_URL = databaseUrl;

const dbDescribe = permitted ? describe : describe.skip;
const crypto = require('crypto');

const pool = require('../db');
const { ensureRestaurantPartner } = require('../services/oxsteedCreditSubBankService');

test('partner auto-provision DB suite requires explicit synthetic disposable database opt-in', () => {
  expect(permitted).toBe(Boolean(databaseUrl && permitted));
});

dbDescribe('credit partner auto-provision trigger carve-out against the real database', () => {
  const tag = crypto.randomBytes(8).toString('hex');
  let adminId;
  let ownerId;
  let businessId;
  const restaurantIds = [];
  const partnerIds = [];

  async function makeRestaurant() {
    const { rows: [r] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [businessId, ownerId, `autoprov-${tag}-${restaurantIds.length}`]
    );
    restaurantIds.push(r.id);
    return r.id;
  }

  beforeAll(async () => {
    const { rows: [admin] } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, 'synthetic', 'Auto', 'ProvAdmin', 'admin', TRUE) RETURNING id`,
      [`autoprov-admin-${tag}@example.invalid`]
    );
    adminId = admin.id;
    const { rows: [owner] } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, 'synthetic', 'Auto', 'ProvOwner', 'customer', TRUE) RETURNING id`,
      [`autoprov-owner-${tag}@example.invalid`]
    );
    ownerId = owner.id;
    const { rows: [b] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id`,
      [ownerId, `autoprov-${tag}`]
    );
    businessId = b.id;
  });

  afterAll(async () => {
    // NOTE: plain DELETE FROM food_restaurants/businesses/users hits a
    // pre-existing quirk of the disposable test DB: the append-only ledger
    // rewrite rules break Postgres' referential-integrity check for ANY such
    // delete ("referential integrity query ... gave unexpected result",
    // reproduced with zero referencing rows; documented by
    // restaurantScopeModel.db.test.js and staffMembershipLifecycle.db.test.js).
    // Cleanup therefore runs with row triggers bypassed inside one
    // transaction — fixture rows only, schema untouched. Partners reference
    // restaurants with RESTRICT, so partners go first.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      if (partnerIds.length) {
        await client.query(`DELETE FROM oxsteed_credit_partners WHERE id = ANY($1::bigint[])`, [partnerIds]);
      }
      if (restaurantIds.length) {
        await client.query(`DELETE FROM food_restaurants WHERE id = ANY($1::bigint[])`, [restaurantIds]);
      }
      if (businessId) await client.query(`DELETE FROM businesses WHERE id = $1`, [businessId]);
      if (ownerId) await client.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
      if (adminId) await client.query(`DELETE FROM users WHERE id = $1`, [adminId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  test('ensureRestaurantPartner auto-provisions a pending row with no admin creator', async () => {
    const restaurantId = await makeRestaurant();
    const client = await pool.connect();
    try {
      const partner = await ensureRestaurantPartner(client, restaurantId);
      expect(partner.status).toBe('pending');
      expect(partner.created_by).toBeNull();
      expect(partner.auto_provisioned).toBe(true);
      partnerIds.push(partner.id);
    } finally {
      client.release();
    }
    // Second call replays against the existing row instead of inserting.
    const replayClient = await pool.connect();
    try {
      const again = await ensureRestaurantPartner(replayClient, restaurantId);
      expect(String(again.id)).toBe(String(partnerIds[partnerIds.length - 1]));
    } finally {
      replayClient.release();
    }
  });

  test('pending insert without the auto-provision marker still fails', async () => {
    const restaurantId = await makeRestaurant();
    await expect(pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, settlement_currency_code, status, notes)
       VALUES ($1, $2, 'USD', 'pending', 'synthetic no-marker')`,
      [restaurantId, businessId]
    )).rejects.toThrow('OxSteed Credit control records require an active administrator creator');
  });

  test('non-pending insert without an admin creator still fails, even with the marker', async () => {
    const restaurantId = await makeRestaurant();
    await expect(pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, settlement_currency_code, status, notes, auto_provisioned)
       VALUES ($1, $2, 'USD', 'active', 'synthetic marked active', TRUE)`,
      [restaurantId, businessId]
    )).rejects.toThrow('OxSteed Credit control records require an active administrator creator');
  });

  test('non-pending insert without an admin creator still fails without the marker', async () => {
    const restaurantId = await makeRestaurant();
    await expect(pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, settlement_currency_code, status, notes)
       VALUES ($1, $2, 'USD', 'active', 'synthetic active')`,
      [restaurantId, businessId]
    )).rejects.toThrow('OxSteed Credit control records require an active administrator creator');
  });

  test('admin-attributed insert still succeeds (existing behavior preserved)', async () => {
    const restaurantId = await makeRestaurant();
    const { rows: [row] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, settlement_currency_code, status, notes, created_by)
       VALUES ($1, $2, 'USD', 'pending', 'synthetic admin', $3) RETURNING *`,
      [restaurantId, businessId, adminId]
    );
    expect(row.created_by).toBe(adminId);
    expect(row.auto_provisioned).toBe(false);
    partnerIds.push(row.id);
  });

  test('UPDATE OF created_by is never exempt: clearing the creator still fails', async () => {
    const restaurantId = await makeRestaurant();
    const { rows: [row] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, settlement_currency_code, status, notes, created_by)
       VALUES ($1, $2, 'USD', 'pending', 'synthetic admin 2', $3) RETURNING *`,
      [restaurantId, businessId, adminId]
    );
    partnerIds.push(row.id);
    await expect(pool.query(
      `UPDATE oxsteed_credit_partners SET created_by = NULL WHERE id = $1`,
      [row.id]
    )).rejects.toThrow('OxSteed Credit control records require an active administrator creator');
  });

  test('auto-provisioned pending row can still be activated by a status-only update', async () => {
    const restaurantId = await makeRestaurant();
    const client = await pool.connect();
    let partner;
    try {
      partner = await ensureRestaurantPartner(client, restaurantId);
    } finally {
      client.release();
    }
    partnerIds.push(partner.id);
    // Status-only UPDATEs do not fire the migration 488 trigger (it fires
    // on INSERT and UPDATE OF created_by), so activation is unaffected by
    // the carve-out. Admin activation itself goes through transitionPartner
    // with its own actor and restaurant-active guards.
    const { rows: [updated] } = await pool.query(
      `UPDATE oxsteed_credit_partners SET status = 'active' WHERE id = $1 RETURNING *`,
      [partner.id]
    );
    expect(updated.status).toBe('active');
  });
});
