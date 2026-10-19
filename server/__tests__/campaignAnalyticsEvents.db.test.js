'use strict';

/**
 * DB tests: campaign analytics events (Analytics platform, Phase 2, Item 10).
 *
 * Covers server/analytics/campaignAnalytics.js:
 *   1. Emission is best-effort: emitCampaignEvent / emitCampaignImpressions
 *      NEVER reject — even when the insert fails — so instrumentation can
 *      never break the instrumented flow (search, checkout).
 *   2. Event rows land in campaign_analytics_events with the right shape.
 *   3. getCampaignPerformance aggregates per-campaign
 *      impressions/clicks/conversions + click-through and conversion rates,
 *      with NULL rates on zero denominators.
 *   4. resolveFeaturedCampaignIds maps effectively-featured restaurants to
 *      their approved placement request (campaign) ids.
 *   5. The business campaign-performance endpoint returns the funnel for the
 *      business's own campaigns, scoped by business_id.
 *
 * Run with e.g.
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     npx jest __tests__/campaignAnalyticsEvents.db.test.js
 * Without it, the DB describes skip (fail closed) instead of touching a DB.
 */
jest.unmock('pg');

const crypto = require('crypto');

const { disposableDatabaseOptIn, isDisposableDatabase, assertMigratedSchema } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('CAMPAIGN_ANALYTICS_TEST_DATABASE_URL');

const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = 'test-jwt-secret';
}

const pool = require('../db');
const {
  emitCampaignEvent,
  emitCampaignImpressions,
  resolveFeaturedCampaignIds,
  getCampaignPerformance,
  actorKeyFor,
} = require('../analytics/campaignAnalytics');

// A db handle whose query always fails — proves emission never rejects.
const failingDb = {
  query: () => Promise.reject(new Error('simulated analytics outage')),
};

async function newUser() {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Campaign', 'Fixture', 'customer', TRUE, TRUE)`,
    [id, `campaign-${id}@example.invalid`]);
  return id;
}

async function newBusiness(ownerId) {
  const { rows: [b] } = await pool.query(
    'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
    [ownerId, `Campaign Biz ${crypto.randomUUID().slice(0, 8)}`]);
  return b.id;
}

async function newRestaurant(businessId, ownerId) {
  const { rows: [r] } = await pool.query(
    'INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, $3) RETURNING id',
    [businessId, ownerId, `Campaign Diner ${crypto.randomUUID().slice(0, 8)}`]);
  return Number(r.id);
}

async function newPlacementRequest(businessId, restaurantId, status = 'approved') {
  const { rows: [r] } = await pool.query(
    `INSERT INTO business_featured_placement_requests
       (business_id, status, featured_restaurant_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [businessId, status, restaurantId]);
  // Mirror the live state the approval flow writes onto the restaurant.
  await pool.query(
    `UPDATE food_restaurants
        SET is_featured = TRUE, featured_until = NOW() + INTERVAL '30 days'
      WHERE id = $1`,
    [restaurantId]);
  return Number(r.id);
}

ddescribe('campaign analytics events', () => {
  let F = {};

  beforeAll(async () => {
    await assertMigratedSchema(pool);
    const owner = await newUser();
    const businessId = await newBusiness(owner);
    const restaurantId = await newRestaurant(businessId, owner);
    const campaignId = await newPlacementRequest(businessId, restaurantId, 'approved');
    // A second business with an approved request but no events yet.
    const owner2 = await newUser();
    const businessId2 = await newBusiness(owner2);
    const restaurantId2 = await newRestaurant(businessId2, owner2);
    const campaignId2 = await newPlacementRequest(businessId2, restaurantId2, 'approved');
    F = { owner, businessId, restaurantId, campaignId, owner2, businessId2, restaurantId2, campaignId2 };

    // Funnel: 10 impressions, 4 clicks, 1 conversion.
    await emitCampaignImpressions(pool, Array.from({ length: 10 }, (_, i) => ({
      campaignId,
      actorKey: null,
      metadata: { source: 'food_search', position: i, restaurant_id: restaurantId },
    })));
    for (let i = 0; i < 4; i++) {
      await emitCampaignEvent(pool, {
        campaignId, eventType: 'click', actorKey: `user:${owner}`,
        metadata: { source: 'food_home_card', restaurant_id: restaurantId },
      });
    }
    const { rows: [order] } = await pool.query(`INSERT INTO food_orders(restaurant_id,business_id,customer_id,status,payment_status,total_cents,queue_number)
      VALUES($1,$2,$3,'completed','paid',2500,9001) RETURNING id`, [restaurantId,businessId,owner]);
    F.orderId = Number(order.id);
    await emitCampaignEvent(pool, {
      campaignId, eventType: 'conversion', actorKey: `user:${owner}`,
      metadata: { order_id: F.orderId, total_cents: 2500, restaurant_id: restaurantId },
    });
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('conversion retries dedupe and unpaid/refunded orders do not convert', async () => {
    await emitCampaignEvent(pool,{ campaignId: F.campaignId,eventType: 'conversion',actorKey: `user:${F.owner}`,
      metadata: { order_id: F.orderId,restaurant_id: F.restaurantId } });
    const { rows: [count] } = await pool.query("SELECT COUNT(*)::INT AS n FROM campaign_analytics_events WHERE campaign_id=$1 AND event_type='conversion'",[F.campaignId]);
    expect(count.n).toBe(1);
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE food_orders SET payment_status='unpaid' WHERE id=$1",[F.orderId]);
      expect((await getCampaignPerformance(client,[F.campaignId]))[0].conversions).toBe(0);
      await client.query("UPDATE food_orders SET payment_status='paid',status='refunded' WHERE id=$1",[F.orderId]);
      expect((await getCampaignPerformance(client,[F.campaignId]))[0].conversions).toBe(0);
    } finally { await client.query('ROLLBACK');client.release(); }
  });

  test('emission never rejects when the events insert fails', async () => {
    await expect(emitCampaignEvent(failingDb, {
      campaignId: 1, eventType: 'click', metadata: {},
    })).resolves.toBe(false);
    await expect(emitCampaignImpressions(failingDb, [
      { campaignId: 1, metadata: {} },
    ])).resolves.toBe(0);
    // Invalid payloads are dropped, not thrown.
    await expect(emitCampaignEvent(pool, { campaignId: null, eventType: 'click' })).resolves.toBe(false);
    await expect(emitCampaignEvent(pool, { campaignId: 1, eventType: 'bogus' })).resolves.toBe(false);
    await expect(emitCampaignImpressions(pool, [])).resolves.toBe(0);
  });

  test('emission failure does not break the instrumented flow', async () => {
    // Simulates what listRestaurants/createOrder do: fire-and-forget
    // emission, then continue serving the real response.
    const emission = emitCampaignEvent(failingDb, { campaignId: 1, eventType: 'impression' });
    const mainFlow = pool.query('SELECT 1 AS ok');
    const [emitted, main] = await Promise.all([emission, mainFlow]);
    expect(emitted).toBe(false);
    expect(main.rows[0].ok).toBe(1);
  });

  test('event rows are stored with campaign, type, actor and metadata', async () => {
    const { rows } = await pool.query(
      `SELECT event_type, actor_key, metadata
         FROM campaign_analytics_events
        WHERE campaign_id = $1 AND event_type = 'conversion'`,
      [F.campaignId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_key).toBe(`user:${F.owner}`);
    expect(rows[0].metadata.order_id).toBe(F.orderId);
    expect(rows[0].metadata.total_cents).toBe(2500);
  });

  test('performance aggregates: impressions, clicks, conversions, ctr, cvr', async () => {
    const [perf] = await getCampaignPerformance(pool, [F.campaignId]);
    expect(perf.campaign_id).toBe(F.campaignId);
    expect(perf.impressions).toBe(10);
    expect(perf.clicks).toBe(4);
    expect(perf.conversions).toBe(1);
    expect(perf.click_through_rate).toBeCloseTo(0.4, 10);
    expect(perf.conversion_rate).toBeCloseTo(0.25, 10);
  });

  test('campaign with no events: zeros and NULL rates (not 0%)', async () => {
    const [perf] = await getCampaignPerformance(pool, [F.campaignId2]);
    expect(perf.impressions).toBe(0);
    expect(perf.clicks).toBe(0);
    expect(perf.conversions).toBe(0);
    expect(perf.click_through_rate).toBeNull();
    expect(perf.conversion_rate).toBeNull();
  });

  test('resolveFeaturedCampaignIds maps restaurant -> approved request', async () => {
    const map = await resolveFeaturedCampaignIds(pool, [F.restaurantId, F.restaurantId2, 999999999]);
    expect(map.get(F.restaurantId)).toBe(F.campaignId);
    expect(map.get(F.restaurantId2)).toBe(F.campaignId2);
    expect(map.has(999999999)).toBe(false);
    expect(await resolveFeaturedCampaignIds(pool, [])).toEqual(new Map());
  });

  test('actorKeyFor: signed-in user vs anonymous', () => {
    expect(actorKeyFor({ user: { id: 'abc' } })).toBe('user:abc');
    expect(actorKeyFor({})).toBeNull();
    expect(actorKeyFor(null)).toBeNull();
  });

  test('business campaign-performance endpoint: scoped funnel for own campaigns', async () => {
    const ctrl = require('../controllers/businessMarketingController');
    const req = { params: { businessId: String(F.businessId) } };
    let body;
    const res = { json: (b) => { body = b; } };
    const next = (err) => { throw err || new Error('next() called'); };
    await ctrl.getCampaignPerformance(req, res, next);
    expect(Array.isArray(body.campaigns)).toBe(true);
    expect(body.campaigns).toHaveLength(1);
    const c = body.campaigns[0];
    expect(c.campaign_id).toBe(F.campaignId);
    expect(c.impressions).toBe(10);
    expect(c.clicks).toBe(4);
    expect(c.conversions).toBe(1);
    expect(c.click_through_rate).toBeCloseTo(0.4, 10);
    expect(c.conversion_rate).toBeCloseTo(0.25, 10);
    expect(c.is_live).toBe(true);
    // The other business's campaign must not leak in.
    const req2 = { params: { businessId: String(F.businessId2) } };
    let body2;
    await ctrl.getCampaignPerformance(req2, { json: (b) => { body2 = b; } }, next);
    expect(body2.campaigns.map((x) => x.campaign_id)).toEqual([F.campaignId2]);
  });
});
