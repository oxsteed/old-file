// PR804 Track C — G-19: location-scoped managers get a finance view.
// A member with active restaurant_location_memberships rows sees a
// `location_reports` scope in the statement center (their stores' sales
// report, with an explicit HQ-only note for settlement) and still gets NO
// restaurant-wide settlement standing, balance, or document.
// DB-backed; runs only against credit_statement_test_pr804_c.
'use strict';

const DB_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
if (!DB_URL.includes('/credit_statement_test_pr804_c')) {
  throw new Error('Refusing to run: STATEMENT_TEST_DATABASE_URL must point at credit_statement_test_pr804_c');
}
process.env.DATABASE_URL = DB_URL;

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const pool = require('../db');
const { getStatementCenter } = require('../services/statementCenterService');
const { memberFinanceReadStanding, memberLocationFinanceStanding } = require('../services/access/financeStanding');

const suffix = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

let owner;
let locationManager;
let plainManager;
let businessId;
let restaurantId;
let locationId;

async function makeUser(role) {
  const s = suffix();
  const { rows: [row] } = await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role)
     VALUES ($1, 'x', 'Track', 'C', $2) RETURNING id`,
    [`g19-${role}-${s}@example.test`, role]);
  return row;
}

beforeAll(async () => {
  owner = await makeUser('customer');
  locationManager = await makeUser('customer');
  plainManager = await makeUser('customer');
  const s = suffix();
  const { rows: [biz] } = await pool.query(
    `INSERT INTO businesses (business_name, user_id, is_active) VALUES ($1, $2, TRUE) RETURNING id`,
    [`G19 Biz ${s}`, owner.id]);
  businessId = biz.id;
  for (const [user, role] of [[locationManager, 'manager'], [plainManager, 'manager']]) {
    await pool.query(
      `INSERT INTO business_members (business_id, member_id, role, status, owner_id, invite_email)
       VALUES ($1, $2, $3, 'active', $4, $5)`,
      [businessId, user.id, role, owner.id, `g19-${s}@example.test`]);
  }
  const { rows: [rest] } = await pool.query(
    `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, slug)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [businessId, owner.id, `G19 Restaurant ${s}`, `g19-rest-${s}`]);
  restaurantId = rest.id;
  const { rows: [loc] } = await pool.query(
    `INSERT INTO restaurant_locations (restaurant_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [restaurantId, `Downtown ${s}`]);
  locationId = loc.id;
  const { rows: [membership] } = await pool.query(
    `SELECT id FROM business_members WHERE business_id = $1 AND member_id = $2`,
    [businessId, locationManager.id]);
  await pool.query(
    `INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status)
     VALUES ($1, $2, $3, 'active')`,
    [restaurantId, locationId, membership.id]);
});

afterAll(async () => {
  try { await pool.query(`DELETE FROM restaurant_location_memberships WHERE restaurant_id = $1`, [restaurantId]); } catch (_) {}
  try { await pool.query(`DELETE FROM restaurant_locations WHERE id = $1`, [locationId]); } catch (_) {}
  try { await pool.query(`DELETE FROM food_restaurants WHERE id = $1`, [restaurantId]); } catch (_) {}
  try { await pool.query(`DELETE FROM business_members WHERE business_id = $1`, [businessId]); } catch (_) {}
  try { await pool.query(`DELETE FROM businesses WHERE id = $1`, [businessId]); } catch (_) {}
  try { await pool.query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [[owner.id, locationManager.id, plainManager.id]]); } catch (_) {}
  await pool.end();
});

describe('G-19 location-scoped finance view', () => {
  test('location standing lists exactly the assigned stores', async () => {
    const standing = await memberLocationFinanceStanding(pool, { businessId, userId: locationManager.id, restaurantId });
    expect(standing).not.toBeNull();
    expect(standing.standing).toBe('location_reports');
    expect(standing.locationIds).toEqual([String(locationId)]);
    expect(standing.locationNames[0]).toMatch(/Downtown/);
    expect(await memberLocationFinanceStanding(pool, { businessId, userId: plainManager.id, restaurantId })).toBeNull();
  });

  test('restaurant-wide settlement standing stays null for the location manager', async () => {
    expect(await memberFinanceReadStanding(pool, {
      businessId, userId: locationManager.id, restaurantId, allowDelegated: true,
    })).toBeNull();
  });

  test('statement center shows a location_reports scope with no numbers', async () => {
    const center = await getStatementCenter(locationManager.id);
    const settlement = center.products.restaurantSettlement;
    expect(settlement.hasAccount).toBe(true);
    const scope = settlement.scopes.find((item) => item.restaurantId === String(restaurantId));
    expect(scope).toBeDefined();
    expect(scope.statementStatus).toBe('location_reports');
    expect(scope.locationIds).toEqual([String(locationId)]);
    expect(scope.latestDocumentId).toBeNull();
    expect(scope.summary).toEqual({ outstanding: null, invoiced: null, collected: null, adjusted: null });
  });

  test('owner still sees the normal settlement scope, not a location scope', async () => {
    const center = await getStatementCenter(owner.id);
    const scope = center.products.restaurantSettlement.scopes.find((item) => item.restaurantId === String(restaurantId));
    expect(scope).toBeDefined();
    expect(scope.statementStatus).not.toBe('location_reports');
  });

  test('a manager without location rows keeps the normal finance scope', async () => {
    // The location boundary only bites when assignments exist: a plain
    // manager holding a finance read code still gets restaurant-wide access.
    expect(await memberFinanceReadStanding(pool, {
      businessId, userId: plainManager.id, restaurantId, allowDelegated: true,
    })).toBe('finance');
    const center = await getStatementCenter(plainManager.id);
    const scope = center.products.restaurantSettlement.scopes.find((item) => item.restaurantId === String(restaurantId));
    expect(scope).toBeDefined();
    expect(scope.statementStatus).not.toBe('location_reports');
  });
});
