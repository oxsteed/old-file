'use strict';

/**
 * DB tests: explicit franchise store-to-agreement mapping
 * (design-review item 44, goal goal_a0fc7c0f0394).
 *
 * The defect: reporting matched a store to a launched agreement by
 * city/region text, most recently updated wins, so two launched
 * agreements covering the same city misattributed the store (and its
 * royalty / marketing fee) to the wrong franchisee. The fix maps
 * stores explicitly in franchise_location_agreements; the report and
 * the store-revenue accrual read that table, and an unmapped store
 * reports (and accrues) nothing — never string-matched.
 *
 * Service-level, inside one rolled-back transaction, so no fixture
 * rows survive. The migration file itself is executed against the
 * fixtures to prove the backfill rule (same deterministic winner as
 * the old match, ambiguity flagged) rather than a copy of it.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantFranchiseLocationAgreement.db.test.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Item 44 fixtures require the disposable statement test database');
  }
  process.env.DATABASE_URL = url;
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const fx = require('../services/restaurantFxService');
const franchiseReport = require('../services/restaurantFranchiseReportService');
const mappings = require('../services/restaurantFranchiseLocationAgreementService');
const { accrueTerritoryRoyalty } = require('../services/franchiseRoyaltyService');

const describeDb = url ? describe : describe.skip;
const TAG = 'Item44Test';
const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '20261107140001_franchise_location_agreements.sql'),
  'utf8'
);

describeDb('explicit franchise store-to-agreement mapping (item 44)', () => {
  let client;
  let ownerA;
  let ownerB;
  let hqOwnerId;
  let businessId;
  let brandId;
  let restaurantId;
  let store1;
  let store2;
  let store3;
  let outsiderStore;
  let agreementA;
  let agreementB;

  beforeAll(async () => {
    client = await db.connect();
    await client.query('BEGIN');
    ownerA = crypto.randomUUID();
    ownerB = crypto.randomUUID();
    hqOwnerId = crypto.randomUUID();
    for (const [id, email] of [
      [ownerA, `i44-a-${ownerA.slice(0, 8)}@example.invalid`],
      [ownerB, `i44-b-${ownerB.slice(0, 8)}@example.invalid`],
      [hqOwnerId, `i44-hq-${hqOwnerId.slice(0, 8)}@example.invalid`],
    ]) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, 'x', 'Item44', 'User', 'customer', TRUE, TRUE)`,
        [id, email]
      );
    }
    businessId = (await client.query(
      'INSERT INTO businesses (business_name, user_id) VALUES ($1, $2) RETURNING id',
      [`${TAG} Biz`, hqOwnerId]
    )).rows[0].id;
    const outsiderBusiness = (await client.query(
      'INSERT INTO businesses (business_name, user_id) VALUES ($1, $2) RETURNING id',
      [`${TAG} Outsider Biz`, hqOwnerId]
    )).rows[0].id;
    const mkRestaurant = async (business) =>
      (await client.query(
        `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
         VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id, brand_id`,
        [business, hqOwnerId, `${TAG} Diner`]
      )).rows[0];
    const main = await mkRestaurant(businessId);
    const outsider = await mkRestaurant(outsiderBusiness);
    restaurantId = main.id;
    brandId = main.brand_id;
    // The default-store trigger gave each restaurant one store; shape
    // the main one as Springfield OH and add a second Springfield
    // store plus a Cap-Haitien store that matches no agreement.
    [store1] = (await client.query(
      'SELECT id FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY id',
      [restaurantId]
    )).rows.map((row) => Number(row.id));
    [outsiderStore] = (await client.query(
      'SELECT id FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY id',
      [outsider.id]
    )).rows.map((row) => Number(row.id));
    await client.query(
      `UPDATE restaurant_locations
          SET currency_code = 'USD', address_city = 'Springfield', address_state = 'OH',
              timezone = 'America/New_York', is_primary = TRUE
        WHERE id = $1`,
      [store1]
    );
    store2 = Number((await client.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, timezone, currency_code, address_city, address_state)
       VALUES ($1, $2, 'America/New_York', 'USD', 'Springfield', 'OH') RETURNING id`,
      [restaurantId, `${TAG} Second Store`]
    )).rows[0].id);
    store3 = Number((await client.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, timezone, currency_code, address_city, address_state)
       VALUES ($1, $2, 'America/Port-au-Prince', 'HTG', 'Cap-Haitien', 'Nord') RETURNING id`,
      [restaurantId, `${TAG} Third Store`]
    )).rows[0].id);
    // Two launched agreements covering the SAME city (Springfield OH)
    // with different royalty terms. A is older, B is newer: under the
    // old most-recent-wins string match, B won every Springfield store.
    const programId = (await client.query(
      'SELECT id FROM franchise_programs ORDER BY id LIMIT 1'
    )).rows[0]?.id;
    const mkAgreement = async (owner, royaltyBps, marketingBps, initialFeeCents) => {
      const applicationId = (await client.query(
        `INSERT INTO franchise_applications
           (program_id, owner_user_id, applicant_user_id, first_name, last_name, email,
            desired_country, desired_city, desired_region, status)
         VALUES ($1, $2, $2, 'Item44', 'Owner', $3, 'US', 'Springfield', 'OH', 'launched') RETURNING id`,
        [programId, owner, `i44-${owner.slice(0, 8)}@example.invalid`]
      )).rows[0].id;
      const agreementId = (await client.query(
        `INSERT INTO franchise_agreements
           (application_id, royalty_bps, marketing_fee_bps, initial_fee_cents, currency, signed_at)
         VALUES ($1, $2, $3, $4, 'USD', NOW()) RETURNING id`,
        [applicationId, royaltyBps, marketingBps, initialFeeCents]
      )).rows[0].id;
      return { applicationId, agreementId };
    };
    agreementA = await mkAgreement(ownerA, 500, 100, 100000);
    agreementB = await mkAgreement(ownerB, 900, 300, 200000);
    await client.query(
      "UPDATE franchise_agreements SET updated_at = NOW() - interval '2 days' WHERE id = $1",
      [agreementA.agreementId]
    );
    // Real sales at both Springfield stores so royalties are priced.
    await client.query(
      `INSERT INTO food_orders (restaurant_id, business_id, location_id, status, payment_status, total_cents, currency_code, queue_number, created_at)
       VALUES ($1, $2, $3, 'completed', 'paid', 10000, 'USD', 1, '2026-10-05T12:00:00Z')`,
      [restaurantId, businessId, store1]
    );
    await client.query(
      `INSERT INTO food_orders (restaurant_id, business_id, location_id, status, payment_status, total_cents, currency_code, queue_number, created_at)
       VALUES ($1, $2, $3, 'completed', 'paid', 20000, 'USD', 2, '2026-10-06T12:00:00Z')`,
      [restaurantId, businessId, store2]
    );
  }, 60000);

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    await db.end();
  });

  async function report(franchiseeUserId = null) {
    return franchiseReport.getFranchiseReport(client, {
      brandId,
      accessibleRestaurantIds: [restaurantId],
      from: '2026-10-01',
      to: '2026-10-15',
      ...(franchiseeUserId ? { franchiseeUserId } : {}),
    });
  }

  test('migration backfill keeps the old deterministic winner and flags the overlap', async () => {
    // No mapping exists yet: both Springfield stores are unmapped
    // even though the old string match would have matched them.
    expect(await mappings.findLocationAgreement(client, store1)).toBeNull();
    const before = await report();
    expect(before.stores.find((s) => s.locationId === store1).noAgreement).toBe(true);
    expect(before.unmappedStores.map((s) => s.locationId)).toContain(store1);
    // Same-currency-only rollup: the staleness fields are present
    // and report nothing stale (age 0 on the same-currency lines).
    expect(before.stale).toBe(false);
    expect(before.staleCurrencies).toEqual([]);
    expect(before.maxRateAgeDays).toBe(0);
    expect(before.stalestRateDate).toBe('2026-10-15');

    // Run the actual migration file against the fixtures.
    await client.query(MIGRATION_SQL);

    // Same winner the old rule picked (B, most recently updated),
    // but now explicit — and flagged ambiguous with 2 candidates.
    for (const storeId of [store1, store2]) {
      const mapped = await mappings.findLocationAgreement(client, storeId);
      expect(mapped).toMatchObject({
        agreementId: String(agreementB.agreementId),
        mappingSource: 'backfill',
        mappingAmbiguous: true,
        ambiguousCandidateCount: 2,
      });
    }
    // Cap-Haitien matched nothing: still unmapped.
    expect(await mappings.findLocationAgreement(client, store3)).toBeNull();
    const after = await report();
    expect(after.ambiguousStores.map((s) => s.locationId).sort()).toEqual([store1, store2].sort());
    expect(after.unmappedStores.map((s) => s.locationId)).toEqual([store3]);
  });

  test('overlapping agreements attribute per the explicit mapping, not most-recent-wins', async () => {
    // Reassign store1 to the OLDER agreement A (500 bps). B stays
    // mapped to store2 (900 bps). Same city, different franchisees.
    await mappings.assignLocationAgreement(client, {
      brandId, locationId: store1, agreementId: agreementA.agreementId, actorUserId: hqOwnerId,
    });
    const result = await report();
    const s1 = result.stores.find((s) => s.locationId === store1);
    expect(s1.agreement).toMatchObject({ agreementId: String(agreementA.agreementId), royaltyBps: 500 });
    expect(s1.royalty).toEqual([{
      currencyCode: 'USD', salesCents: 10000, royaltyBps: 500, royaltyCents: 500,
      marketingFeeBps: 100, marketingCents: 100,
    }]);
    expect(s1.mappingSource).toBe('manual');
    expect(s1.mappingAmbiguous).toBe(false);
    const s2 = result.stores.find((s) => s.locationId === store2);
    expect(s2.agreement).toMatchObject({ agreementId: String(agreementB.agreementId), royaltyBps: 900 });
    expect(s2.royalty).toEqual([{
      currencyCode: 'USD', salesCents: 20000, royaltyBps: 900, royaltyCents: 1800,
      marketingFeeBps: 300, marketingCents: 600,
    }]);
    // The franchisee boundary follows the mapping, not the city:
    // owner A sees only store1, owner B only store2.
    expect((await report(ownerA)).stores.map((s) => s.locationId)).toEqual([store1]);
    expect((await report(ownerB)).stores.map((s) => s.locationId)).toEqual([store2]);
  });

  test('an unmapped store reports as unmapped, never string-matched', async () => {
    await mappings.removeLocationAgreement(client, { brandId, locationId: store1 });
    const result = await report();
    const s1 = result.stores.find((s) => s.locationId === store1);
    // Springfield still matches both agreements by city text — the
    // report must NOT fall back to that match.
    expect(s1.noAgreement).toBe(true);
    expect(s1.agreement).toBeNull();
    expect(s1.royalty).toEqual([]);
    expect(s1.sales).toEqual([{ currencyCode: 'USD', orderCount: 1, netCollectedCents: 10000 }]);
    expect(result.unmappedStores.map((s) => s.locationId)).toEqual(expect.arrayContaining([store1, store3]));
    // And the franchisee sees nothing for the unmapped store.
    expect((await report(ownerA)).stores.map((s) => s.locationId)).not.toContain(store1);
  });

  test('store-revenue accrual follows the explicit mapping; territory points keep the string match', async () => {
    await mappings.assignLocationAgreement(client, {
      brandId, locationId: store1, agreementId: agreementA.agreementId, actorUserId: hqOwnerId,
    });
    // Food order at store1: the older agreement A governs (500 bps),
    // not the most-recent B.
    const accruedA = await accrueTerritoryRoyalty({
      client, amountCents: 10000, locationId: store1,
      city: 'Springfield', region: 'OH',
      sourceType: 'food_order', sourceId: 'item44-order-1',
      description: 'item 44 test',
    });
    expect(accruedA).toMatchObject({ agreementId: String(agreementA.agreementId), ownerUserId: ownerA, royaltyCents: 500, marketingCents: 100 });
    const ledgerA = await client.query(
      "SELECT user_id, amount_cents FROM platform_ledger WHERE idempotency_key = 'franchise-royalty:food_order:item44-order-1'"
    );
    expect(ledgerA.rows).toHaveLength(1);
    expect(ledgerA.rows[0].user_id).toBe(ownerA);
    expect(ledgerA.rows[0].amount_cents).toBe(500);

    // Store2 is still mapped to B: 900 bps.
    const accruedB = await accrueTerritoryRoyalty({
      client, amountCents: 10000, locationId: store2,
      city: 'Springfield', region: 'OH',
      sourceType: 'food_order', sourceId: 'item44-order-2',
      description: 'item 44 test',
    });
    expect(accruedB).toMatchObject({ agreementId: String(agreementB.agreementId), ownerUserId: ownerB, royaltyCents: 900 });

    // Unmapped store: fail closed, no string fallback, even though
    // Springfield matches two launched agreements.
    expect(await accrueTerritoryRoyalty({
      client, amountCents: 10000, locationId: store3,
      city: 'Springfield', region: 'OH',
      sourceType: 'food_order', sourceId: 'item44-order-3',
      description: 'item 44 test',
    })).toBeNull();

    // Territory-point revenue (a job in Springfield, no store) has
    // nothing to map: it keeps the deterministic string match, most
    // recent wins, and credits B. (The store accruals above bumped
    // A's updated_at via the marketing-fee UPDATE, which is the
    // recency tiebreak, so pin B newest first — as the royalty
    // suite does — to assert the match rule itself, not the bump.)
    await client.query(
      "UPDATE franchise_agreements SET updated_at = NOW() + interval '1 minute' WHERE id = $1",
      [agreementB.agreementId]
    );
    const territory = await accrueTerritoryRoyalty({
      client, amountCents: 10000,
      city: 'Springfield', region: 'OH',
      sourceType: 'job', sourceId: 'item44-job-1',
      description: 'item 44 test',
    });
    expect(territory).toMatchObject({ agreementId: String(agreementB.agreementId), ownerUserId: ownerB, royaltyCents: 900 });
  });

  test('assign rejects a non-launched agreement, an unknown agreement, and a foreign location', async () => {
    const programId = (await client.query(
      'SELECT id FROM franchise_programs ORDER BY id LIMIT 1'
    )).rows[0].id;
    const draftApplication = (await client.query(
      `INSERT INTO franchise_applications
         (program_id, owner_user_id, applicant_user_id, first_name, last_name, email,
          desired_country, desired_city, desired_region, status)
       VALUES ($1, $2, $2, 'Item44', 'Draft', $3, 'US', 'Springfield', 'OH', 'inquiry') RETURNING id`,
      [programId, ownerA, `i44-draft-${ownerA.slice(0, 8)}@example.invalid`]
    )).rows[0].id;
    const draftAgreement = (await client.query(
      'INSERT INTO franchise_agreements (application_id, royalty_bps, marketing_fee_bps) VALUES ($1, 500, 100) RETURNING id',
      [draftApplication]
    )).rows[0].id;
    await expect(mappings.assignLocationAgreement(client, {
      brandId, locationId: store1, agreementId: draftAgreement, actorUserId: hqOwnerId,
    })).rejects.toMatchObject({ code: 'agreement_not_found' });
    await expect(mappings.assignLocationAgreement(client, {
      brandId, locationId: store1, agreementId: crypto.randomUUID(), actorUserId: hqOwnerId,
    })).rejects.toMatchObject({ code: 'agreement_not_found' });
    await expect(mappings.assignLocationAgreement(client, {
      brandId, locationId: outsiderStore, agreementId: agreementA.agreementId, actorUserId: hqOwnerId,
    })).rejects.toMatchObject({ code: 'location_not_found' });
    await expect(mappings.removeLocationAgreement(client, {
      brandId, locationId: outsiderStore,
    })).rejects.toMatchObject({ code: 'location_not_found' });
  });

  test('list surfaces mappings, unmapped stores, and launched agreements for assignment', async () => {
    const listed = await mappings.listBrandLocationAgreements(client, { brandId });
    expect(listed.mappings.map((m) => m.locationId)).toEqual(expect.arrayContaining([store1, store2]));
    const mapped1 = listed.mappings.find((m) => m.locationId === store1);
    expect(mapped1.agreement).toMatchObject({ agreementId: String(agreementA.agreementId), royaltyBps: 500 });
    expect(listed.unmappedStores.map((s) => s.locationId)).toEqual([store3]);
    expect(listed.agreements.map((a) => a.agreementId).sort()).toEqual(
      [String(agreementA.agreementId), String(agreementB.agreementId)].sort()
    );
    expect(listed.agreements.find((a) => a.agreementId === String(agreementA.agreementId)))
      .toMatchObject({ territoryCity: 'Springfield', territoryRegion: 'OH', royaltyBps: 500 });
  });

  test('a franchise rollup built on a >30-day-old rate reports stale with the rate date', async () => {
    // HTG sales at the Cap-Haitien store, priced by a rate stored
    // 2026-08-01 — 75 days before the report rate date 2026-10-15.
    await client.query(
      `INSERT INTO food_orders (restaurant_id, business_id, location_id, status, payment_status, total_cents, currency_code, queue_number, created_at)
       VALUES ($1, $2, $3, 'completed', 'paid', 13000, 'HTG', 3, '2026-10-07T12:00:00Z')`,
      [restaurantId, businessId, store3]
    );
    await fx.createRate(client, {
      baseCurrency: 'HTG', quoteCurrency: 'USD', rate: 0.0075, rateDate: '2026-08-01', actorUserId: hqOwnerId,
    });
    const result = await report();
    expect(result.stores.find((s) => s.locationId === store3).sales)
      .toEqual([{ currencyCode: 'HTG', orderCount: 1, netCollectedCents: 13000 }]);
    // The converted total still prices (the rate exists), but the
    // report carries the breakdown's staleness fields, same shape as
    // the HQ rollups: stale, the stale currencies, the oldest rate's
    // age in days, and that rate's date.
    expect(result.totals.salesConvertedCents).not.toBeNull();
    expect(result.stale).toBe(true);
    expect(result.staleCurrencies).toEqual(['HTG']);
    expect(result.maxRateAgeDays).toBe(75);
    expect(result.stalestRateDate).toBe('2026-08-01');
  });
});
