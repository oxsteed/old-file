'use strict';

/**
 * DB tests: Phase 8 multi-location (goal goal_a0fc7c0f0394, baseline
 * gap 18) — FX policy + converted rollups, per-store tip pools,
 * cross-restaurant pay-run consolidations, staged brand menu
 * rollouts, inter-store labor borrowing, franchise reporting, and
 * scheduled HQ / franchise digests.
 *
 * Service-level, inside one rolled-back transaction, so no fixture
 * rows survive. Controller-level scope/dual-control checks live in
 * restaurantPhase8PayRunScope.db.test.js.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     npx jest __tests__/restaurantPhase8.db.test.js
 */

const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Phase 8 fixtures require the disposable statement test database');
  }
  process.env.DATABASE_URL = url;
}
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');
const db = require('../db');
const fx = require('../services/restaurantFxService');
const consolidations = require('../services/restaurantPayRunConsolidationService');
const rollouts = require('../services/restaurantBrandMenuRolloutService');
const borrows = require('../services/restaurantLaborBorrowService');
const franchiseReport = require('../services/restaurantFranchiseReportService');
const scheduledReports = require('../services/restaurantScheduledReports');

const describeDb = url ? describe : describe.skip;
const TAG = 'Phase8Test';

describeDb('Phase 8 multi-location', () => {
  let client;
  let ownerId;
  let checkerId;
  let workerId;
  let businessId;
  let brandId;
  let restaurantA;
  let restaurantB;
  let outsiderRestaurant;
  let storeA1;
  let storeA2;
  let storeB1;

  beforeAll(async () => {
    client = await db.connect();
    await client.query('BEGIN');
    ownerId = crypto.randomUUID();
    checkerId = crypto.randomUUID();
    workerId = crypto.randomUUID();
    for (const [id, email] of [
      [ownerId, `p8-owner-${ownerId.slice(0, 8)}@example.invalid`],
      [checkerId, `p8-checker-${checkerId.slice(0, 8)}@example.invalid`],
      [workerId, `p8-worker-${workerId.slice(0, 8)}@example.invalid`],
    ]) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, 'x', 'Phase8', 'User', 'customer', TRUE, TRUE)`,
        [id, email]
      );
    }
    businessId = (await client.query(
      `INSERT INTO businesses (business_name, user_id) VALUES ($1, $2) RETURNING id`,
      [`${TAG} Biz`, ownerId]
    )).rows[0].id;
    const outsiderBusiness = (await client.query(
      `INSERT INTO businesses (business_name, user_id) VALUES ($1, $2) RETURNING id`,
      [`${TAG} Outsider Biz`, ownerId]
    )).rows[0].id;
    const mkRestaurant = async (business, name, currency) =>
      (await client.query(
        `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
         VALUES ($1, $2, $3, 'America/New_York', $4) RETURNING id, brand_id`,
        [business, ownerId, `${TAG} ${name}`, currency]
      )).rows[0];
    const a = await mkRestaurant(businessId, 'Alpha Diner', 'USD');
    const b = await mkRestaurant(businessId, 'Beta Diner', 'HTG');
    const out = await mkRestaurant(outsiderBusiness, 'Outsider Diner', 'USD');
    restaurantA = a.id;
    restaurantB = b.id;
    outsiderRestaurant = out.id;
    brandId = a.brand_id;
    await client.query('UPDATE food_restaurants SET brand_id = $1 WHERE id = $2', [brandId, restaurantB]);
    // The default-store trigger gave each restaurant one store; shape
    // them (currency, city, timezone) and add a second store to A.
    const storesOf = async (restaurant) =>
      (await client.query(
        'SELECT id FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY id',
        [restaurant]
      )).rows.map((row) => Number(row.id));
    [storeA1] = await storesOf(restaurantA);
    [storeB1] = await storesOf(restaurantB);
    await client.query(
      `UPDATE restaurant_locations
          SET currency_code = 'USD', address_city = 'Springfield', address_state = 'OH',
              timezone = 'America/New_York', is_primary = TRUE
        WHERE id = $1`,
      [storeA1]
    );
    storeA2 = (await client.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, timezone, currency_code, address_city, address_state)
       VALUES ($1, $2, 'America/New_York', 'HTG', 'Cap-Haitien', 'Nord') RETURNING id`,
      [restaurantA, `${TAG} Second Store`]
    )).rows[0].id;
    await client.query(
      `UPDATE restaurant_locations
          SET currency_code = 'HTG', address_city = 'Cap-Haitien', address_state = 'Nord',
              timezone = 'America/Port-au-Prince', is_primary = TRUE
        WHERE id = $1`,
      [storeB1]
    );
    // Worker: active member assigned to store A1 (home store).
    const { rows: [membership] } = await client.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
       VALUES ($1, $2, $3, 'manager', $4, 'active') RETURNING id`,
      [businessId, ownerId, workerId, `p8-worker-${workerId.slice(0, 8)}@example.invalid`]
    );
    await client.query(
      `INSERT INTO restaurant_location_memberships (membership_id, restaurant_id, location_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [membership.id, restaurantA, storeA1]
    );
    // Source menu for the staged rollout: one category, two items.
    const categoryId = (await client.query(
      `INSERT INTO food_menu_categories (restaurant_id, name) VALUES ($1, $2) RETURNING id`,
      [restaurantA, `${TAG} Mains`]
    )).rows[0].id;
    for (const [name, price] of [['Burger', 1299], ['Fries', 499]]) {
      await client.query(
        `INSERT INTO food_menu_items (restaurant_id, category_id, name, price_cents)
         VALUES ($1, $2, $3, $4)`,
        [restaurantA, categoryId, `${TAG} ${name}`, price]
      );
    }
    // Franchise: a launched application + agreement whose territory
    // is Springfield OH (store A1) with stored royalty terms.
    const programId = (await client.query(
      `SELECT id FROM franchise_programs ORDER BY id LIMIT 1`
    )).rows[0]?.id;
    if (programId) {
      const applicationId = (await client.query(
        `INSERT INTO franchise_applications
           (program_id, owner_user_id, applicant_user_id, first_name, last_name, email,
            desired_country, desired_city, desired_region, status)
         VALUES ($1, $2, $2, 'Phase8', 'Owner', $3, 'US', 'Springfield', 'OH', 'launched') RETURNING id`,
        [programId, ownerId, `p8-franchise-${ownerId.slice(0, 8)}@example.invalid`]
      )).rows[0].id;
      const agreementId = (await client.query(
        `INSERT INTO franchise_agreements
           (application_id, royalty_bps, marketing_fee_bps, initial_fee_cents, currency, signed_at)
         VALUES ($1, 500, 100, 100000, 'USD', NOW()) RETURNING id`,
        [applicationId]
      )).rows[0].id;
      // Item 44: the store's agreement is explicit now, never
      // string-matched. Record the mapping the backfill would have
      // made for this Springfield OH store.
      await client.query(
        `INSERT INTO franchise_location_agreements (location_id, agreement_id, source, ambiguous, ambiguous_candidate_count)
         VALUES ($1, $2, 'backfill', FALSE, 0)`,
        [storeA1, agreementId]
      );
    }
    // One paid order at store A1 (USD 100.00) so the franchise
    // report has real sales to price royalties on.
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

  // ── Track A: FX ────────────────────────────────────────────────

  test('same-currency conversion is exactly 1 with no stored rate', async () => {
    const converted = await fx.convertAmount(client, {
      amountCents: 12345, fromCurrency: 'USD', toCurrency: 'USD', rateDate: '2026-10-15',
    });
    expect(converted.missingRate).toBe(false);
    expect(converted.convertedCents).toBe(12345);
    expect(converted.rate).toBe(1);
  });

  test('stored rates price as of the rate date; a missing rate fails closed', async () => {
    await fx.createRate(client, {
      baseCurrency: 'HTG', quoteCurrency: 'USD', rate: 0.0075, rateDate: '2026-10-01', actorUserId: ownerId,
    });
    await fx.createRate(client, {
      baseCurrency: 'HTG', quoteCurrency: 'USD', rate: 0.0076, rateDate: '2026-10-10', actorUserId: ownerId,
    });
    // As of Oct 5 the Oct 1 rate is in force, not the Oct 10 one.
    const early = await fx.convertAmount(client, {
      amountCents: 100000, fromCurrency: 'HTG', toCurrency: 'USD', rateDate: '2026-10-05',
    });
    expect(early.convertedCents).toBe(750);
    expect(early.rateDate).toBe('2026-10-01');
    // EUR has no stored rate at all: fail closed, never a guess.
    const missing = await fx.convertAmount(client, {
      amountCents: 10000, fromCurrency: 'EUR', toCurrency: 'USD', rateDate: '2026-10-05',
    });
    expect(missing.missingRate).toBe(true);
  });

  test('convertBreakdown keeps native detail and nulls the total when a currency lacks a rate', async () => {
    const converted = await fx.convertBreakdown(client, {
      entries: [
        { currencyCode: 'USD', amountCents: 10000 },
        { currencyCode: 'HTG', amountCents: 100000 },
        { currencyCode: 'EUR', amountCents: 5000 },
      ],
      reportingCurrency: 'USD',
      rateDate: '2026-10-15',
    });
    expect(converted.lines).toHaveLength(3);
    expect(converted.lines[0]).toMatchObject({ currencyCode: 'USD', amountCents: 10000, convertedCents: 10000 });
    expect(converted.lines[1]).toMatchObject({ currencyCode: 'HTG', missingRate: false, rate: 0.0076 });
    expect(converted.lines[2]).toMatchObject({ currencyCode: 'EUR', missingRate: true, convertedCents: null });
    expect(converted.convertedTotalCents).toBeNull();
    expect(converted.missingCurrencies).toEqual(['EUR']);
  });

  test('FX policy defaults to the primary location currency; a stored policy wins', async () => {
    const fallback = await fx.getFxPolicy(client, { restaurantId: restaurantA });
    expect(fallback.isDefault).toBe(true);
    expect(fallback.reportingCurrency).toBe('USD');
    expect(fallback.rateDateMode).toBe('period_end');
    const saved = await fx.setFxPolicy(client, {
      restaurantId: restaurantA,
      reportingCurrency: 'EUR',
      rateSource: 'admin_entered',
      rateDateMode: 'rate_date',
      rateDate: '2026-10-15',
      actorUserId: ownerId,
    });
    expect(saved.isDefault).toBe(false);
    expect(saved.reportingCurrency).toBe('EUR');
    const again = await fx.getFxPolicy(client, { restaurantId: restaurantA });
    expect(again.reportingCurrency).toBe('EUR');
    expect(again.rateDate).toBe('2026-10-15');
    // A rate-date policy without a date is rejected, not defaulted.
    await expect(fx.setFxPolicy(client, {
      brandId,
      reportingCurrency: 'USD',
      rateDateMode: 'rate_date',
      actorUserId: ownerId,
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rate validation rejects same-currency pairs and non-positive rates', async () => {
    await expect(fx.createRate(client, {
      baseCurrency: 'USD', quoteCurrency: 'USD', rate: 1, rateDate: '2026-10-01',
    })).rejects.toMatchObject({ statusCode: 400 });
    await expect(fx.createRate(client, {
      baseCurrency: 'EUR', quoteCurrency: 'USD', rate: 0, rateDate: '2026-10-01',
    })).rejects.toMatchObject({ statusCode: 400 });
    await expect(fx.createRate(client, {
      baseCurrency: 'EU', quoteCurrency: 'USD', rate: 1.1, rateDate: '2026-10-01',
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  // ── Track B: per-store tip pools ───────────────────────────────
  // NOTE: restaurantPayrollService is pool-bound (it reads the
  // module-level pool, not a transaction client), so the tip-pool
  // fallback is covered at controller level in
  // restaurantPhase8PayRunScope.db.test.js, not in this rolled-back
  // transaction suite — a pool read cannot see uncommitted rows.

  // ── Track C: consolidations ────────────────────────────────────

  // Finding 8: member runs must be individually approved (by a second
  // manager, distinct from the finalizer) before they can join a
  // consolidation, so the fixture stamps the checker's approval.
  async function insertFinalizedRun(restaurantId, totals, locationIds = []) {
    const { rows: [run] } = await client.query(
      `INSERT INTO restaurant_pay_runs
         (restaurant_id, period_from, period_to, status, totals, created_by, finalized_by, finalized_at, approved_by, approved_at, location_ids, currency_code)
       VALUES ($1, '2026-10-01'::date, '2026-10-15'::date, 'finalized', $2::jsonb, $3, $3, NOW(), $5, NOW(), $4::bigint[], $6)
       RETURNING id`,
      [restaurantId, JSON.stringify(totals), ownerId, locationIds, checkerId, totals.currency]
    );
    return Number(run.id);
  }

  test('consolidation groups finalized runs with per-currency and converted totals', async () => {
    const runA = await insertFinalizedRun(restaurantA, { currency: 'USD', total_pay_cents: 10000 }, [storeA1]);
    const runB = await insertFinalizedRun(restaurantB, { currency: 'HTG', total_pay_cents: 100000 }, [storeB1]);
    const id = await consolidations.createConsolidation(client, {
      brandId,
      anchorRestaurantId: restaurantA,
      payRunIds: [runA, runB],
      actorUserId: ownerId,
    });
    const row = await consolidations.getConsolidation(client, { consolidationId: id, brandId });
    expect(row.status).toBe('draft');
    expect(row.members).toHaveLength(2);
    expect(row.members.find((m) => m.payRunId === runA).attribution).toEqual({ type: 'single_store', locationIds: [storeA1] });
    expect(row.totals.perCurrency).toEqual(expect.arrayContaining([
      { currencyCode: 'USD', totalPayCents: 10000 },
      { currencyCode: 'HTG', totalPayCents: 100000 },
    ]));
    // HTG 100000 * 0.0076 = 760 USD; USD 10000 stays 10000.
    expect(row.totals.converted.convertedTotalCents).toBe(10760);
    expect(row.totals.converted.reportingCurrency).toBe('USD');
    expect(row.totals.converted.missingCurrencies).toEqual([]);
    // The cross-store view lists both runs with attribution.
    const view = await consolidations.listBrandPayRuns(client, {
      brandId, restaurantIds: [restaurantA, restaurantB], from: '2026-10-01', to: '2026-10-15',
    });
    expect(view.map((r) => r.payRunId)).toEqual(expect.arrayContaining([runA, runB]));
    // Maker cannot approve; the checker can; void dissolves the group.
    await expect(consolidations.approveConsolidation(client, {
      consolidationId: id, actorUserId: ownerId,
    })).rejects.toMatchObject({ code: 'consolidation_not_finalized' });
    const finalized = await consolidations.finalizeConsolidation(client, { consolidationId: id, actorUserId: ownerId });
    expect(finalized.status).toBe('finalized');
    expect(finalized.finalized_by).toBe(ownerId);
    await expect(consolidations.approveConsolidation(client, {
      consolidationId: id, actorUserId: ownerId,
    })).rejects.toMatchObject({ code: 'consolidation_self_approval' });
    const approved = await consolidations.approveConsolidation(client, { consolidationId: id, actorUserId: checkerId });
    expect(approved.status).toBe('approved');
    expect(approved.approved_by).toBe(checkerId);
    // Money-flows audit R8: voiding an approved consolidation is
    // two-step now — the maker requests, a different manager who
    // also differs from the finalizer completes it.
    const requested = await consolidations.voidConsolidation(client, { consolidationId: id, actorUserId: ownerId });
    expect(requested.status).toBe('approved');
    expect(requested.requested).toBe(true);
    expect(requested.void_requested_by).toBe(ownerId);
    const voided = await consolidations.approveVoidConsolidation(client, { consolidationId: id, actorUserId: checkerId });
    expect(voided.status).toBe('voided');
    // Members are untouched: still finalized runs.
    const { rows: [member] } = await client.query(
      'SELECT status FROM restaurant_pay_runs WHERE id = $1', [runA]
    );
    expect(member.status).toBe('finalized');
  });

  test('consolidation rejects draft members, period mismatch, regrouping, and cross-brand members', async () => {
    const draft = (await client.query(
      `INSERT INTO restaurant_pay_runs
         (restaurant_id, period_from, period_to, status, totals, created_by, location_ids, currency_code)
       VALUES ($1, '2026-10-01'::date, '2026-10-15'::date, 'draft', '{"currency":"USD","total_pay_cents":100}'::jsonb, $2, '{}'::bigint[], 'USD')
       RETURNING id`,
      [restaurantA, ownerId]
    )).rows[0].id;
    await expect(consolidations.createConsolidation(client, {
      brandId, anchorRestaurantId: restaurantA, payRunIds: [Number(draft)], actorUserId: ownerId,
    })).rejects.toMatchObject({ code: 'pay_run_not_finalized' });
    const runA = await insertFinalizedRun(restaurantA, { currency: 'USD', total_pay_cents: 100 }, [storeA1]);
    const runOtherPeriod = (await client.query(
      `INSERT INTO restaurant_pay_runs
         (restaurant_id, period_from, period_to, status, totals, created_by, finalized_by, finalized_at, location_ids, currency_code)
       VALUES ($1, '2026-10-16'::date, '2026-10-31'::date, 'finalized', '{"currency":"HTG","total_pay_cents":100}'::jsonb, $2, $2, NOW(), $3::bigint[], 'HTG')
       RETURNING id`,
      [restaurantB, ownerId, [storeB1]]
    )).rows[0].id;
    await expect(consolidations.createConsolidation(client, {
      brandId, anchorRestaurantId: restaurantA, payRunIds: [runA, Number(runOtherPeriod)], actorUserId: ownerId,
    })).rejects.toMatchObject({ code: 'consolidation_period_mismatch' });
    const outsiderRun = await insertFinalizedRun(outsiderRestaurant, { currency: 'USD', total_pay_cents: 100 }, []);
    await expect(consolidations.createConsolidation(client, {
      brandId, anchorRestaurantId: restaurantA, payRunIds: [runA, outsiderRun], actorUserId: ownerId,
    })).rejects.toMatchObject({ code: 'consolidation_brand_mismatch' });
    // Group runA once, then try to group it again while open.
    const first = await consolidations.createConsolidation(client, {
      brandId, anchorRestaurantId: restaurantA, payRunIds: [runA], actorUserId: ownerId,
    });
    expect(Number(first)).toBeGreaterThan(0);
    await expect(consolidations.createConsolidation(client, {
      brandId, anchorRestaurantId: restaurantA, payRunIds: [runA], actorUserId: ownerId,
    })).rejects.toMatchObject({ code: 'pay_run_already_consolidated' });
    await consolidations.voidConsolidation(client, { consolidationId: first });
  });

  test('finding 8: a finalized-but-unapproved member run cannot join a consolidation', async () => {
    const unapproved = (await client.query(
      `INSERT INTO restaurant_pay_runs
         (restaurant_id, period_from, period_to, status, totals, created_by, finalized_by, finalized_at, location_ids, currency_code)
       VALUES ($1, '2026-10-01'::date, '2026-10-15'::date, 'finalized', '{"currency":"USD","total_pay_cents":100}'::jsonb, $2, $2, NOW(), $3::bigint[], 'USD')
       RETURNING id`,
      [restaurantA, ownerId, [storeA1]]
    )).rows[0].id;
    let caught = null;
    try {
      await consolidations.createConsolidation(client, {
        brandId, anchorRestaurantId: restaurantA, payRunIds: [Number(unapproved)], actorUserId: ownerId,
      });
    } catch (err) { caught = err; }
    expect(caught).toMatchObject({ code: 'pay_run_not_approved' });
    expect(String(caught.message)).toContain(String(unapproved));
    // A second manager's approval of the member run unblocks the join.
    await client.query(
      'UPDATE restaurant_pay_runs SET approved_by = $2, approved_at = NOW() WHERE id = $1',
      [unapproved, checkerId]
    );
    const id = await consolidations.createConsolidation(client, {
      brandId, anchorRestaurantId: restaurantA, payRunIds: [Number(unapproved)], actorUserId: ownerId,
    });
    expect(Number(id)).toBeGreaterThan(0);
    await consolidations.voidConsolidation(client, { consolidationId: id });
  });

  test('finding 8: finalize/approve re-verify member approval, not just join time', async () => {
    const runA = await insertFinalizedRun(restaurantA, { currency: 'USD', total_pay_cents: 100 }, [storeA1]);
    const id = await consolidations.createConsolidation(client, {
      brandId, anchorRestaurantId: restaurantA, payRunIds: [runA], actorUserId: ownerId,
    });
    // Simulate the member approval disappearing after joining (no API
    // clears it; the re-check is defense in depth): finalize must fail.
    await client.query('UPDATE restaurant_pay_runs SET approved_by = NULL, approved_at = NULL WHERE id = $1', [runA]);
    await expect(consolidations.finalizeConsolidation(client, {
      consolidationId: id, actorUserId: ownerId,
    })).rejects.toMatchObject({ code: 'pay_run_not_approved' });
    await client.query(
      'UPDATE restaurant_pay_runs SET approved_by = $2, approved_at = NOW() WHERE id = $1',
      [runA, checkerId]
    );
    const finalized = await consolidations.finalizeConsolidation(client, { consolidationId: id, actorUserId: ownerId });
    expect(finalized.status).toBe('finalized');
    await client.query('UPDATE restaurant_pay_runs SET approved_by = NULL, approved_at = NULL WHERE id = $1', [runA]);
    await expect(consolidations.approveConsolidation(client, {
      consolidationId: id, actorUserId: checkerId,
    })).rejects.toMatchObject({ code: 'pay_run_not_approved' });
    // Money-flows audit R8: the finalized consolidation voids
    // two-step now.
    await consolidations.voidConsolidation(client, { consolidationId: id, actorUserId: ownerId });
    await consolidations.approveVoidConsolidation(client, { consolidationId: id, actorUserId: checkerId });
  });

  // ── Track D: staged rollouts + borrowing ───────────────────────

  test('staged rollout publishes to the pilot first, then to the rest', async () => {
    const rollout = await rollouts.createRollout(client, {
      brandId,
      sourceRestaurantId: restaurantA,
      pilotRestaurantIds: [restaurantB],
      targetRestaurantIds: [restaurantB],
      idempotencyKey: `${TAG}-rollout-1`,
      actorUserId: ownerId,
    });
    expect(rolloutShapeStage(rollout)).toBe('created');
    const afterPilot = await rollouts.advanceRollout(client, { rolloutId: Number(rollout.id), actorUserId: ownerId });
    const pilotStage = rollouts.rolloutShape(afterPilot);
    expect(pilotStage.stage).toBe('pilot_published');
    expect(pilotStage.stageResults).toHaveLength(1);
    expect(pilotStage.stageResults[0].stage).toBe('pilot');
    expect(pilotStage.stageResults[0].synced).toBe(2);
    // Target copies exist at the pilot restaurant only.
    const { rows: copies } = await client.query(
      `SELECT restaurant_id, COUNT(*)::int AS n FROM food_menu_items
        WHERE brand_source_item_id IS NOT NULL AND restaurant_id = ANY($1::bigint[])
        GROUP BY restaurant_id`,
      [[restaurantA, restaurantB]]
    );
    expect(copies).toEqual([{ restaurant_id: restaurantB, n: 2 }]);
    // A second open rollout for the same brand is rejected.
    await expect(rollouts.createRollout(client, {
      brandId,
      sourceRestaurantId: restaurantA,
      pilotRestaurantIds: [restaurantB],
      targetRestaurantIds: [restaurantB],
      idempotencyKey: `${TAG}-rollout-2`,
      actorUserId: ownerId,
    })).rejects.toMatchObject({ code: 'rollout_already_open' });
    // No remaining targets: the full stage has nothing to publish,
    // so advancing again fails closed instead of closing silently.
    await expect(rollouts.advanceRollout(client, { rolloutId: Number(rollout.id), actorUserId: ownerId }))
      .rejects.toMatchObject({ code: 'rollout_no_targets' });
    const cancelled = await rollouts.cancelRollout(client, { rolloutId: Number(rollout.id), actorUserId: ownerId });
    expect(rollouts.rolloutShape(cancelled).status).toBe('cancelled');
    // A cancelled rollout cannot advance.
    await expect(rollouts.advanceRollout(client, { rolloutId: Number(rollout.id), actorUserId: ownerId }))
      .rejects.toMatchObject({ code: 'rollout_cancelled' });
  });

  function rolloutShapeStage(row) {
    return rollouts.rolloutShape(row).stage;
  }

  test('labor borrowing: request, self-approval blocked, conflict blocked, approve, complete', async () => {
    const requested = await borrows.requestBorrow(client, {
      restaurantId: restaurantA,
      businessId,
      staffUserId: workerId,
      homeLocationId: storeA1,
      borrowLocationId: storeA2,
      shiftDate: '2026-10-20',
      startTime: '09:00',
      endTime: '13:00',
      roleLabel: 'Server',
      requestedBy: ownerId,
    });
    expect(requested.status).toBe('requested');
    // The requester cannot approve their own borrow.
    await expect(borrows.reviewBorrow(client, {
      borrowId: Number(requested.id), restaurantId: restaurantA, businessId,
      status: 'approved', reviewerUserId: ownerId,
    })).rejects.toMatchObject({ code: 'borrow_self_approval' });
    // A published shift overlapping the borrow blocks approval.
    await client.query(
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label)
       VALUES ($1, $2, '2026-10-20'::date, '12:00'::time, '16:00'::time, 'Server')`,
      [businessId, workerId]
    );
    await expect(borrows.reviewBorrow(client, {
      borrowId: Number(requested.id), restaurantId: restaurantA, businessId,
      status: 'approved', reviewerUserId: checkerId,
    })).rejects.toMatchObject({ code: 'borrow_shift_conflict' });
    // Remove the conflicting shift: approval succeeds.
    await client.query(
      `DELETE FROM business_staff_shifts WHERE business_id = $1 AND user_id = $2 AND shift_date = '2026-10-20'::date`,
      [businessId, workerId]
    );
    const approved = await borrows.reviewBorrow(client, {
      borrowId: Number(requested.id), restaurantId: restaurantA, businessId,
      status: 'approved', reviewerUserId: checkerId,
    });
    expect(approved.status).toBe('approved');
    expect(approved.reviewed_by).toBe(checkerId);
    // A second overlapping borrow for the same worker now conflicts.
    await expect(borrows.requestBorrow(client, {
      restaurantId: restaurantA,
      businessId,
      staffUserId: workerId,
      homeLocationId: storeA1,
      borrowLocationId: storeA2,
      shiftDate: '2026-10-20',
      startTime: '12:30',
      endTime: '15:00',
      requestedBy: ownerId,
    })).rejects.toMatchObject({ code: 'borrow_overlap' });
    const completed = await borrows.transitionBorrow(client, {
      borrowId: Number(requested.id), restaurantId: restaurantA,
      fromStatuses: ['approved'], toStatus: 'completed', code: 'borrow_not_completed',
    });
    expect(completed.status).toBe('completed');
    // The shared roster shows the worker at the home store with the
    // borrow visible in the window.
    const roster = await borrows.getSharedRoster(client, {
      restaurantId: restaurantA, businessId, from: '2026-10-20', to: '2026-10-20',
    });
    const worker = roster.staff.find((entry) => entry.userId === workerId);
    expect(worker.homeLocationId).toBe(storeA1);
    expect(worker.approvedBorrows).toHaveLength(0); // completed borrows are not "approved" anymore
    const listed = await borrows.listBorrows(client, { restaurantId: restaurantA, from: '2026-10-20', to: '2026-10-20' });
    expect(listed.some((entry) => entry.id === Number(requested.id) && entry.status === 'completed')).toBe(true);
  });

  test('borrowing rejects a worker who is not assigned to the home store', async () => {
    await expect(borrows.requestBorrow(client, {
      restaurantId: restaurantA,
      businessId,
      staffUserId: workerId,
      homeLocationId: storeA2,
      borrowLocationId: storeA1,
      shiftDate: '2026-10-21',
      startTime: '09:00',
      endTime: '13:00',
      requestedBy: ownerId,
    })).rejects.toMatchObject({ code: 'borrow_not_home_staff' });
  });

  // ── Track E: franchise reporting ───────────────────────────────

  test('franchise report prices royalties from stored terms and converts totals', async () => {
    const report = await franchiseReport.getFranchiseReport(client, {
      brandId,
      accessibleRestaurantIds: [restaurantA, restaurantB],
      from: '2026-10-01',
      to: '2026-10-15',
    });
    expect(report.view).toBeUndefined();
    const storeA = report.stores.find((store) => store.locationId === storeA1);
    expect(storeA).toBeDefined();
    expect(storeA.sales).toEqual([{ currencyCode: 'USD', orderCount: 1, netCollectedCents: 10000 }]);
    expect(storeA.agreement).toMatchObject({ royaltyBps: 500, marketingFeeBps: 100, initialFeeCents: 100000, currency: 'USD' });
    expect(storeA.royalty).toEqual([{
      currencyCode: 'USD', salesCents: 10000, royaltyBps: 500, royaltyCents: 500,
      marketingFeeBps: 100, marketingCents: 100,
    }]);
    expect(report.totals.salesByCurrency).toEqual([{ currencyCode: 'USD', amountCents: 10000 }]);
    expect(report.totals.royaltyByCurrency).toEqual([{ currencyCode: 'USD', amountCents: 500 }]);
    expect(report.totals.marketingFeeByCurrency).toEqual([{ currencyCode: 'USD', amountCents: 100 }]);
    expect(report.totals.initialFeesByCurrency).toEqual([{ currencyCode: 'USD', amountCents: 100000 }]);
    expect(report.totals.salesConvertedCents).toBe(10000);
    // Store B1 (Cap-Haitien, HTG) matches no agreement: listed, no royalty.
    const storeB = report.stores.find((store) => store.locationId === storeB1);
    expect(storeB).toBeDefined();
    expect(storeB.noAgreement).toBe(true);
    expect(storeB.royalty).toEqual([]);
  });

  test('franchisee boundary: an agreement owner sees only their matching stores', async () => {
    const report = await franchiseReport.getFranchiseReport(client, {
      brandId,
      accessibleRestaurantIds: [restaurantA, restaurantB],
      from: '2026-10-01',
      to: '2026-10-15',
      franchiseeUserId: ownerId,
    });
    expect(report.stores.map((store) => store.locationId)).toEqual([storeA1]);
    expect(report.agreements).toHaveLength(1);
  });

  // ── Track D/E: scheduled digests ───────────────────────────────

  test('digest schedules require a brand; HQ digest builds with converted totals', async () => {
    expect(() => scheduledReports.validateScheduleInput({
      reportType: 'hq_digest', frequency: 'weekly', deliveryChannel: 'in_app',
      recipients: [{ user_id: ownerId }],
    })).toThrow('A brand is required');
    const input = scheduledReports.validateScheduleInput({
      reportType: 'hq_digest', frequency: 'weekly', deliveryChannel: 'in_app',
      recipients: [{ user_id: ownerId }], brandId,
    });
    expect(input.brandId).toBe(Number(brandId));
    const payload = await scheduledReports.buildScheduledReport(client, {
      restaurant: { id: restaurantA, business_id: businessId, timezone: 'America/New_York', currency_code: 'USD' },
      schedule: {
        id: 999001, restaurant_id: restaurantA, brand_id: brandId,
        report_type: 'hq_digest', frequency: 'weekly', delivery_channel: 'in_app',
        recipients: [{ user_id: ownerId }],
      },
      businessDate: '2026-10-15',
    });
    expect(payload.snapshot).toBe(true);
    expect(payload.locked_close).toBe(false);
    expect(payload.report.storeCount).toBeGreaterThanOrEqual(2);
    expect(payload.report.converted.reportingCurrency).toBe('USD');
    expect(payload.summary).toContain('HQ digest');
    const franchisePayload = await scheduledReports.buildScheduledReport(client, {
      restaurant: { id: restaurantA, business_id: businessId, timezone: 'America/New_York', currency_code: 'USD' },
      schedule: {
        id: 999002, restaurant_id: restaurantA, brand_id: brandId,
        report_type: 'franchise_digest', frequency: 'weekly', delivery_channel: 'in_app',
        recipients: [{ user_id: ownerId }],
      },
      businessDate: '2026-10-15',
    });
    expect(franchisePayload.report.stores.length).toBeGreaterThanOrEqual(1);
    expect(franchisePayload.summary).toContain('Franchise digest');
    // A digest whose anchor left the brand fails closed at build time.
    await expect(scheduledReports.buildScheduledReport(client, {
      restaurant: { id: outsiderRestaurant, business_id: businessId, timezone: 'UTC', currency_code: 'USD' },
      schedule: {
        id: 999003, restaurant_id: outsiderRestaurant, brand_id: brandId,
        report_type: 'hq_digest', frequency: 'weekly', delivery_channel: 'in_app',
        recipients: [{ user_id: ownerId }],
      },
      businessDate: '2026-10-15',
    })).rejects.toThrow('no longer belongs');
  });
});
