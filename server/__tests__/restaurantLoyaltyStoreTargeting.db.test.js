'use strict';

/**
 * DB tests: per-store loyalty campaign and segment targeting.
 *
 * Proves on the real migrated schema (migration 1500):
 *   - segments accept locationIds criteria and evaluate the audience per store
 *   - campaigns accept locationIds (validated against the restaurant's stores)
 *   - queue-time audience evaluation is store-scoped (campaign x segment
 *     intersection) and deliveries are attributed to the qualifying store
 *   - listCampaigns returns a per-store breakdown; previewSegment supports
 *     ?locationId= and a byLocation breakdown
 *   - the approval SoD flow is unchanged (draft -> approved -> queue)
 *
 * Honors STATEMENT_TEST_DATABASE_URL (or RESTAURANT_LOYALTY_TARGETING_TEST_DATABASE_URL);
 * skipped when absent so the default unit suite never needs a database.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');

const { disposableDatabaseOptIn, isDisposableDatabase } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('RESTAURANT_LOYALTY_TARGETING_TEST_DATABASE_URL');

const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = 'test-secret-for-loyalty-targeting';
}

const pool = require('../db');
const loyalty = require('../controllers/restaurantLoyaltyController');
const campaignService = require('../services/restaurantLoyaltyCampaignService');

function uid() {
  return crypto.randomUUID();
}

async function newUser() {
  const id = uid();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Loyal', 'Target', 'customer', TRUE, TRUE)`,
    [id, `loyal-target-${id}@example.invalid`]
  );
  return id;
}

async function newBusiness(ownerId) {
  const { rows: [b] } = await pool.query(
    'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
    [ownerId, `Loyal Biz ${uid().slice(0, 8)}`]
  );
  return b.id;
}

async function newRestaurant(businessId, ownerId) {
  const { rows: [r] } = await pool.query(
    `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone)
     VALUES ($1, $2, $3, 'America/New_York') RETURNING id`,
    [businessId, ownerId, `Loyal Diner ${uid().slice(0, 8)}`]
  );
  const { rows: [primary] } = await pool.query(
    `SELECT id, name FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = TRUE LIMIT 1`,
    [r.id]
  );
  const { rows: [second] } = await pool.query(
    `INSERT INTO restaurant_locations (restaurant_id, name, is_primary, status)
     VALUES ($1, 'Downtown', FALSE, 'active') RETURNING id, name`,
    [r.id]
  );
  return { id: r.id, primary: { id: Number(primary.id), name: primary.name }, second: { id: Number(second.id), name: second.name } };
}

async function newLoyaltyAccount(restaurantId, customerId, lifetimePoints = 0) {
  await pool.query(
    `INSERT INTO food_loyalty_accounts (restaurant_id, customer_id, points_balance, lifetime_points)
     VALUES ($1, $2, $3, $3)
     ON CONFLICT (restaurant_id, customer_id) DO UPDATE SET lifetime_points = EXCLUDED.lifetime_points`,
    [restaurantId, customerId, lifetimePoints]
  );
}

let queueCounter = 9000;
async function newPaidOrder(restaurantId, businessId, locationId, customerId) {
  const { rows: [o] } = await pool.query(
    `INSERT INTO food_orders
       (restaurant_id, business_id, location_id, customer_id, status, payment_status, queue_number, subtotal_cents, total_cents)
     VALUES ($1, $2, $3, $4, 'completed', 'paid', $5, 2000, 2000) RETURNING id`,
    [restaurantId, businessId, locationId, customerId, queueCounter++]
  );
  return o.id;
}

function invoke(handler, { params = {}, body = {}, query = {}, user } = {}) {
  const req = { params, body, query, user, get: () => undefined };
  const res = { statusCode: 200 };
  return new Promise((resolve, reject) => {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (value) => resolve({ status: res.statusCode, body: value });
    Promise.resolve(handler(req, res, (err) => resolve({ error: err }))).catch(reject);
  });
}

let ownerId;
let businessId;
let restaurantId;
let primary;
let second;
let customerA; // orders at primary only
let customerB; // orders at second only
let customerC; // orders at both
let approverId; // SoD: campaign approver must differ from the creator (finding 41)

ddescribe('per-store loyalty targeting', () => {
  beforeAll(async () => {
    ownerId = await newUser();
    businessId = await newBusiness(ownerId);
    ({ id: restaurantId, primary, second } = await newRestaurant(businessId, ownerId));

    // Second admin for approvals: active manager so resolveRestaurantAccess
    // grants restaurant scope, but a different user than the creator.
    approverId = await newUser();
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'manager', $4, 'active', NOW())`,
      [businessId, ownerId, approverId, `loyal-approver-${approverId}@example.invalid`]
    );

    customerA = await newUser();
    customerB = await newUser();
    customerC = await newUser();
    await newLoyaltyAccount(restaurantId, customerA, 100);
    await newLoyaltyAccount(restaurantId, customerB, 100);
    await newLoyaltyAccount(restaurantId, customerC, 100);
    await newPaidOrder(restaurantId, businessId, primary.id, customerA);
    await newPaidOrder(restaurantId, businessId, second.id, customerB);
    await newPaidOrder(restaurantId, businessId, primary.id, customerC);
    await newPaidOrder(restaurantId, businessId, second.id, customerC);
  });

  test('segment locationIds criteria evaluates the audience per store', async () => {
    const created = await invoke(loyalty.createSegment, {
      params: { restaurantId: String(restaurantId) },
      body: { name: `Downtown regulars ${uid().slice(0, 6)}`, criteria: { locationIds: [second.id] } },
      user: { id: ownerId },
    });
    expect(created.error).toBeUndefined();
    expect(created.status).toBe(201);
    expect(created.body.segment.criteria).toEqual({ location_ids: [second.id] });
    // B (downtown only) and C (both) qualify; A (uptown only) does not.
    expect(created.body.segment.audience.matchingCustomers).toBe(2);

    const preview = await invoke(loyalty.previewSegment, {
      params: { restaurantId: String(restaurantId), segmentId: String(created.body.segment.id) },
      user: { id: ownerId },
    });
    expect(preview.error).toBeUndefined();
    expect(preview.body.segment.audience.matchingCustomers).toBe(2);
    // A stored store targeting means no byLocation breakdown (already scoped).
    expect(preview.body.segment.audience.byLocation).toBeUndefined();

    const scoped = await invoke(loyalty.previewSegment, {
      params: { restaurantId: String(restaurantId), segmentId: String(created.body.segment.id) },
      query: { locationId: String(primary.id) },
      user: { id: ownerId },
    });
    expect(scoped.error).toBeUndefined();
    // ?locationId= overrides the stored targeting for this preview.
    expect(scoped.body.segment.audience.matchingCustomers).toBe(2);
  });

  test('untargeted segment preview includes a per-store audience breakdown', async () => {
    const created = await invoke(loyalty.createSegment, {
      params: { restaurantId: String(restaurantId) },
      body: { name: `All regulars ${uid().slice(0, 6)}`, criteria: { minOrders: 1 } },
      user: { id: ownerId },
    });
    expect(created.error).toBeUndefined();
    const preview = await invoke(loyalty.previewSegment, {
      params: { restaurantId: String(restaurantId), segmentId: String(created.body.segment.id) },
      user: { id: ownerId },
    });
    expect(preview.error).toBeUndefined();
    const byLocation = preview.body.segment.audience.byLocation;
    expect(byLocation).toHaveLength(2);
    const primaryRow = byLocation.find((row) => row.locationId === primary.id);
    const secondRow = byLocation.find((row) => row.locationId === second.id);
    expect(primaryRow.matchingCustomers).toBe(2); // A + C
    expect(secondRow.matchingCustomers).toBe(2); // B + C
  });

  test('campaign store targeting validates stores and narrows queue-time audience', async () => {
    const segment = await invoke(loyalty.createSegment, {
      params: { restaurantId: String(restaurantId) },
      body: { name: `Targeted base ${uid().slice(0, 6)}`, criteria: { minOrders: 1 } },
      user: { id: ownerId },
    });
    const segmentId = segment.body.segment.id;

    // A store from another restaurant is rejected before the DB trigger.
    const otherRestaurant = await pool.query(
      `SELECT id FROM food_restaurants WHERE id <> $1 LIMIT 1`, [restaurantId]
    );
    const otherStore = otherRestaurant.rows.length
      ? (await pool.query(`SELECT id FROM restaurant_locations WHERE restaurant_id = $1 LIMIT 1`, [otherRestaurant.rows[0].id])).rows[0]?.id
      : 999999999;
    const bad = await invoke(loyalty.createCampaign, {
      params: { restaurantId: String(restaurantId) },
      body: { segmentId, name: `Bad target ${uid().slice(0, 6)}`, channel: 'in_app', body: 'Hi', locationIds: [Number(otherStore)] },
      user: { id: ownerId },
    });
    expect(bad.error).toBeDefined();
    expect(bad.error.statusCode).toBe(400);

    const created = await invoke(loyalty.createCampaign, {
      params: { restaurantId: String(restaurantId) },
      body: { segmentId, name: `Downtown push ${uid().slice(0, 6)}`, channel: 'in_app', body: 'Downtown deal', locationIds: [second.id] },
      user: { id: ownerId },
    });
    expect(created.error).toBeUndefined();
    expect(created.status).toBe(201);
    expect(created.body.campaign.locationIds).toEqual([second.id]);
    expect(created.body.campaign.status).toBe('draft');

    // Approval SoD flow is unchanged: only drafts approve.
    const approved = await invoke(loyalty.approveCampaign, {
      params: { restaurantId: String(restaurantId), campaignId: String(created.body.campaign.id) },
      user: { id: approverId },
    });
    expect(approved.error).toBeUndefined();
    expect(approved.body.campaign.status).toBe('approved');
    const reapprove = await invoke(loyalty.approveCampaign, {
      params: { restaurantId: String(restaurantId), campaignId: String(created.body.campaign.id) },
      user: { id: approverId },
    });
    expect(reapprove.error?.code).toBe('loyalty_campaign_not_draft');

    const queued = await invoke(loyalty.queueCampaign, {
      params: { restaurantId: String(restaurantId), campaignId: String(created.body.campaign.id) },
      user: { id: ownerId },
    });
    expect(queued.error).toBeUndefined();
    expect(queued.body.queuedRecipients).toBe(2); // B + C, not A

    const { rows: deliveries } = await pool.query(
      `SELECT customer_id, location_id FROM restaurant_loyalty_campaign_deliveries WHERE campaign_id = $1`,
      [created.body.campaign.id]
    );
    expect(deliveries).toHaveLength(2);
    const byCustomer = new Map(deliveries.map((d) => [d.customer_id, d.location_id === null ? null : Number(d.location_id)]));
    expect(byCustomer.has(customerA)).toBe(false);
    expect(byCustomer.get(customerB)).toBe(second.id);
    expect(byCustomer.get(customerC)).toBe(second.id);
  });

  test('listCampaigns reports a per-store breakdown with store-scoped audiences', async () => {
    const segment = await invoke(loyalty.createSegment, {
      params: { restaurantId: String(restaurantId) },
      body: { name: `Report base ${uid().slice(0, 6)}`, criteria: { minOrders: 1 } },
      user: { id: ownerId },
    });
    const created = await invoke(loyalty.createCampaign, {
      params: { restaurantId: String(restaurantId) },
      body: { segmentId: segment.body.segment.id, name: `Report push ${uid().slice(0, 6)}`, channel: 'in_app', body: 'Deal', locationIds: [primary.id] },
      user: { id: ownerId },
    });
    await invoke(loyalty.approveCampaign, {
      params: { restaurantId: String(restaurantId), campaignId: String(created.body.campaign.id) },
      user: { id: approverId },
    });
    await invoke(loyalty.queueCampaign, {
      params: { restaurantId: String(restaurantId), campaignId: String(created.body.campaign.id) },
      user: { id: ownerId },
    });

    const listed = await invoke(loyalty.listCampaigns, {
      params: { restaurantId: String(restaurantId) },
      user: { id: ownerId },
    });
    expect(listed.error).toBeUndefined();
    const campaign = listed.body.campaigns.find((c) => c.id === created.body.campaign.id);
    expect(campaign).toBeDefined();
    expect(campaign.locationIds).toEqual([primary.id]);
    const breakdown = campaign.storeBreakdown;
    expect(breakdown).toHaveLength(2);
    const primaryRow = breakdown.find((row) => row.locationId === primary.id);
    const secondRow = breakdown.find((row) => row.locationId === second.id);
    expect(primaryRow.targeted).toBe(true);
    expect(secondRow.targeted).toBe(false);
    // Store-scoped audiences: A + C at the targeted primary store; the
    // untargeted downtown store shows zero (the campaign cannot reach it).
    expect(primaryRow.audience.matchingCustomers).toBe(2);
    expect(secondRow.audience.matchingCustomers).toBe(0);
    // Deliveries went only to primary-store customers (A + C).
    expect(primaryRow.deliveries).toBe(2);
    expect(secondRow.deliveries).toBe(0);
    expect(campaign.counts.deliveryCount).toBe(2);
  });

  test('database trigger backstops cross-restaurant store targeting', async () => {
    const segment = await invoke(loyalty.createSegment, {
      params: { restaurantId: String(restaurantId) },
      body: { name: `Trigger base ${uid().slice(0, 6)}`, criteria: {} },
      user: { id: ownerId },
    });
    await expect(pool.query(
      `INSERT INTO restaurant_loyalty_campaigns (restaurant_id, segment_id, name, channel, body, location_ids)
       VALUES ($1, $2, 'trigger-test', 'in_app', 'x', $3)`,
      [restaurantId, segment.body.segment.id, [987654321]]
    )).rejects.toThrow(/outside this restaurant/);
  });
});
