'use strict';

// G-38 (PR #804 Track C): the franchisee view of the franchise report
// must show per-agreement accrual status (accrued / failed / pending),
// sourced from franchise_royalty_failures filtered to the caller's
// agreements plus the platform_ledger accrual evidence.
// Reproduction: before the fix the report's agreements carry no
// accrualStatus at all, so a franchisee cannot tell a computed royalty
// from an accrued one.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const TEST_DB_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
if (!TEST_DB_URL.includes('/credit_statement_test_pr804_c')) {
  throw new Error('Refusing to run: STATEMENT_TEST_DATABASE_URL must point at credit_statement_test_pr804_c');
}
// The shared jest setup points DATABASE_URL at a dummy; the real pool
// reads DATABASE_URL at require time, so point it at our DB first.
process.env.DATABASE_URL = TEST_DB_URL;

const crypto = require('crypto');
const db = require('../db');
const franchiseReport = require('../services/restaurantFranchiseReportService');

const TAG = 'G38Test';

describe('G-38 franchise royalty accrual status', () => {
  let client;
  let ownerId;
  let otherOwnerId;
  let businessId;
  let brandId;
  let restaurantA;
  let storeA1;
  let agreementId;

  beforeAll(async () => {
    client = await db.connect();
    await client.query('BEGIN');
    ownerId = crypto.randomUUID();
    otherOwnerId = crypto.randomUUID();
    for (const [id, email] of [
      [ownerId, `g38-owner-${ownerId.slice(0, 8)}@example.invalid`],
      [otherOwnerId, `g38-other-${otherOwnerId.slice(0, 8)}@example.invalid`],
    ]) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, 'x', 'G38', 'User', 'customer', TRUE, TRUE)`,
        [id, email]
      );
    }
    businessId = (await client.query(
      `INSERT INTO businesses (business_name, user_id) VALUES ($1, $2) RETURNING id`,
      [`${TAG} Biz`, ownerId]
    )).rows[0].id;
    const restaurant = (await client.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id, brand_id`,
      [businessId, ownerId, `${TAG} Diner`]
    )).rows[0];
    restaurantA = restaurant.id;
    brandId = restaurant.brand_id;
    [storeA1] = (await client.query(
      'SELECT id FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY id',
      [restaurantA]
    )).rows.map((row) => Number(row.id));
    await client.query(
      `UPDATE restaurant_locations
          SET currency_code = 'USD', address_city = 'Springfield', address_state = 'OH',
              timezone = 'America/New_York', is_primary = TRUE
        WHERE id = $1`,
      [storeA1]
    );
    const programId = (await client.query(
      'SELECT id FROM franchise_programs ORDER BY id LIMIT 1'
    )).rows[0]?.id;
    expect(programId).toBeTruthy();
    const applicationId = (await client.query(
      `INSERT INTO franchise_applications
         (program_id, owner_user_id, applicant_user_id, first_name, last_name, email,
          desired_country, desired_city, desired_region, status)
       VALUES ($1, $2, $2, 'G38', 'Owner', $3, 'US', 'Springfield', 'OH', 'launched') RETURNING id`,
      [programId, ownerId, `g38-franchise-${ownerId.slice(0, 8)}@example.invalid`]
    )).rows[0].id;
    agreementId = (await client.query(
      `INSERT INTO franchise_agreements
         (application_id, royalty_bps, marketing_fee_bps, initial_fee_cents, currency, signed_at)
       VALUES ($1, 500, 100, 100000, 'USD', NOW()) RETURNING id`,
      [applicationId]
    )).rows[0].id;
    await client.query(
      `INSERT INTO franchise_location_agreements (location_id, agreement_id, source, ambiguous, ambiguous_candidate_count)
       VALUES ($1, $2, 'backfill', FALSE, 0)`,
      [storeA1, agreementId]
    );
    // One paid order at store A1 (USD 100.00): computed royalty 500c.
    await client.query(
      `INSERT INTO food_orders (restaurant_id, business_id, location_id, status, payment_status, total_cents, currency_code, queue_number, created_at)
       VALUES ($1, $2, $3, 'completed', 'paid', 10000, 'USD', 1, '2026-10-05T12:00:00Z')`,
      [restaurantA, businessId, storeA1]
    );
  }, 60000);

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    await db.end();
  });

  const reportFor = (franchiseeUserId) => franchiseReport.getFranchiseReport(client, {
    brandId,
    accessibleRestaurantIds: [restaurantA],
    from: '2026-10-01',
    to: '2026-10-15',
    ...(franchiseeUserId ? { franchiseeUserId } : {}),
  });
  const agreementOf = (report) => {
    expect(report.agreements).toHaveLength(1);
    return report.agreements[0];
  };

  test('computed royalty with no accrual and no failure reads pending', async () => {
    const report = await reportFor();
    const agreement = agreementOf(report);
    expect(agreement.royaltyBps).toBe(500);
    expect(agreement.accrualStatus).toBe('pending');
    expect(agreement.computedRoyaltyByCurrency).toEqual([{ currencyCode: 'USD', amountCents: 500 }]);
    expect(agreement.accruedRoyaltyByCurrency).toEqual([]);
    // The per-store row carries the same status for the table column.
    const store = report.stores.find((row) => row.locationId === storeA1);
    expect(store.agreement.accrualStatus).toBe('pending');
  });

  test('a matching ledger accrual inside the period reads accrued', async () => {
    await client.query(
      `INSERT INTO platform_ledger (user_id, type, amount_cents, description, metadata, source_type, idempotency_key, created_at)
       VALUES ($1, 'franchise_royalty', 500, 'G38 accrual', $2, 'franchise_royalty', $3, '2026-10-06T12:00:00Z')`,
      [ownerId, JSON.stringify({ agreement_id: String(agreementId) }), `${TAG}-accrual-1`]
    );
    const report = await reportFor();
    const agreement = agreementOf(report);
    expect(agreement.accrualStatus).toBe('accrued');
    expect(agreement.accruedRoyaltyByCurrency).toEqual([{ currencyCode: 'USD', amountCents: 500 }]);
  });

  test('an unresolved failure for the agreement reads failed, and a failure on another agreement does not leak', async () => {
    await client.query(
      `INSERT INTO franchise_royalty_failures
         (source_type, source_id, agreement_id, amount_cents, location_id, city, region, description, error)
       VALUES ('food_order', $1, $2, 500, $3, 'Springfield', 'OH', 'G38 failure', 'boom')`,
      [`${TAG}-order-1`, agreementId, storeA1]
    );
    // A failure keyed to no agreement at all (accrual failed before
    // an agreement was resolved) must not change this agreement's
    // status either.
    await client.query(
      `INSERT INTO franchise_royalty_failures
         (source_type, source_id, agreement_id, amount_cents, description, error)
       VALUES ('food_order', $1, NULL, 900, 'unresolved agreement failure', 'boom')`,
      [`${TAG}-order-other`]
    );
    const report = await reportFor();
    const agreement = agreementOf(report);
    expect(agreement.accrualStatus).toBe('failed');
    expect(agreement.failedAccrualCount).toBe(1);
    expect(agreement.failedAmountCents).toBe(500);
    expect(agreement.lastFailedAt).toBeTruthy();
    // Failure overrides the ledger evidence: the accrual above still
    // exists, but the open failure is what the franchisee must see.
  });

  test('a resolved failure no longer counts as failed', async () => {
    await client.query(
      `UPDATE franchise_royalty_failures SET resolved_at = NOW() WHERE agreement_id = $1 AND resolved_at IS NULL`,
      [agreementId]
    );
    const report = await reportFor();
    expect(agreementOf(report).accrualStatus).toBe('accrued');
  });

  test('franchisee view shows only the caller agreement with its status', async () => {
    const report = await reportFor(ownerId);
    expect(report.stores.map((store) => store.locationId)).toEqual([storeA1]);
    const agreement = agreementOf(report);
    expect(String(agreement.agreementId)).toBe(String(agreementId));
    expect(agreement.accrualStatus).toBe('accrued');
    // A non-owner sees nothing at the service boundary: no stores,
    // no agreements.
    const outsider = await reportFor(otherOwnerId);
    expect(outsider.stores).toEqual([]);
    expect(outsider.agreements).toEqual([]);
  });
});
